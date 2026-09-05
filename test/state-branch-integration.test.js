'use strict';
// V2-PLAN Stage 1 (section 10.1), WIRED: the batch clock, the three hooks that
// drive it, and the whole chain from one human typing a learning to the other
// human's first prompt carrying it.
//
// WHAT THIS FILE ADDS that the two builder suites do not. test/state-branch.js
// proves the write layer in isolation and test/shard-ref.js proves the read
// half in isolation; each mocks the other's side of the seam. Everything below
// runs BOTH halves, through the real monitor beat, the real Stop hook, the real
// SessionEnd hook, the real SessionStart hook and the real CLI, against a real
// bare remote on disk. The properties it exists for are all seam properties:
//
//   * the ≤ 1/min clock is one clock shared by two PROCESSES with no shared
//     memory - the monitor holds `lastBeat` in a variable and a hook cannot,
//     so "two batches inside one minute produce one commit" is only true if
//     the clock is on disk and both read it;
//   * the opt-in gates the whole path before any process is spawned, which is
//     a claim about what does NOT happen;
//   * SessionEnd flushes, and the one session in twenty-one that loses its
//     flush [S4] leaves the batch for the NEXT session start - late instead of
//     lost;
//   * and the chain: a learning written on one machine is in the other
//     machine's knowledge cache after a fetch it never asked for.
//
// No network anywhere: the remote is a bare repository in os.tmpdir() and the
// transport endpoint is the discard port.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const stateLib = require('../lib/state');
const sb = require('../lib/state-branch');
const scan = require('../lib/shard-scan');
const C = require('../hooks/common');
const H = require('../monitors/heartbeat');

// This test process runs INSIDE a Claude Code session, which exports
// CLAUDE_CODE_CHILD_SESSION=1. Every in-process call to the beat below would
// otherwise take the PROTOCOL 7.2 rule 1 refusal and pass its assertions for
// the wrong reason - so the variable is cleared here, at load, and set again
// only by the one test that is about a child.
for (const k of ['CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID',
  'HANDSHAKE_SESSION_ID', 'CLAUDE_PROJECT_DIR', 'CLAUDE_CONFIG_DIR']) delete process.env[k];

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'handshake.js');
const HOOKS = path.join(ROOT, 'hooks');
const DEAD_ENDPOINT = 'http://127.0.0.1:9';
const PRIVATE = {
  private: true, verdict: 'private', reason: 'affirmative_private',
  explanation: 'gh reported isPrivate: true', checked_at: Date.now(), stale: false,
};

const temps = [];
after(() => {
  for (const d of temps) {
    // A just-killed child can still hold a directory on Windows; failing to
    // delete scratch is not a test result [C test/heartbeat.test.js].
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
});

let n = 0;
function tmp(tag) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hs-sbi-' + tag + '-' + (n++) + '-')));
  temps.push(dir);
  return dir;
}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60000, windowsHide: true });
  assert.equal(r.status, 0, 'git ' + args.join(' ') + ': ' + (r.stdout || '') + (r.stderr || ''));
  return r.stdout || '';
}
function gitRaw(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60000, windowsHide: true });
}

function baseEnv(extra) {
  const env = Object.assign({}, process.env);
  for (const k of ['CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID',
    'HANDSHAKE_SESSION_ID', 'CLAUDE_PROJECT_DIR', 'CLAUDE_CONFIG_DIR']) delete env[k];
  return Object.assign(env, extra || {});
}

// ---------------------------------------------------------------- fixtures --

function bareRemote(root) {
  const bare = path.join(root, 'remote.git');
  fs.mkdirSync(bare);
  git(bare, ['init', '-q', '--bare', '--initial-branch=main']);
  return bare;
}

// One member: a real git clone, a real joined workspace, its own state dir.
function member(root, who, bare, opts) {
  const o = opts || {};
  const work = path.join(root, who);
  const data = path.join(root, who + '-data');
  fs.mkdirSync(work);
  git(work, ['init', '-q', '--initial-branch=main']);
  git(work, ['config', 'user.email', who + '@example.com']);
  git(work, ['config', 'user.name', who]);
  git(work, ['config', 'commit.gpgsign', 'false']);
  git(work, ['config', 'core.autocrlf', 'false']);
  git(work, ['remote', 'add', 'origin', bare.split(path.sep).join('/')]);
  if (o.seed !== false) {
    fs.writeFileSync(path.join(work, 'README.md'), 'hi\n');
    git(work, ['add', '-A']);
    git(work, ['commit', '-q', '-m', 'first']);
    const r = gitRaw(work, ['push', '-q', 'origin', 'main']);
    if (r.status !== 0) git(work, ['fetch', '-q', 'origin', 'main']);
  } else {
    git(work, ['fetch', '-q', 'origin']);
  }

  const m = { who, work, data, bare };
  cli(m, ['init', '--ntfy', DEAD_ENDPOINT, '--name', 'widgets', '--as', who]);
  m.ws = JSON.parse(cli(m, ['status', '--json']).out).workspace.ws;
  m.state = stateLib.openState(m.ws, { env: { HANDSHAKE_STATE_DIR: data } });
  // The guard cache is what every non-CLI path reads [C lib/repo.js
  // cachedVerdict]; seeding it is how a fixture with no `gh` on PATH reaches
  // the private arm, and it is the same record `handshake pair` writes.
  m.state.update((s) => {
    s.repo_guard = { private: true, reason: 'affirmative_private', checked_at: Date.now(), slug: 'acme/widgets', root: work };
    return s;
  });
  // SessionStart classifies a session once and every later hook reads the
  // verdict [C hooks/common.js recordRole]; seeding it is what makes these
  // fixtures a monitor-less PARENT, which is the case the fallback is for.
  if (o.session) beParent(m, o.session);
  return m;
}

function beParent(m, sessionId) {
  m.state.update((s) => {
    s.session_roles = { [sessionId]: { child: false, reason: 'interactive_marker_source', at: Date.now() } };
    return s;
  });
}

function optIn(m, extra) {
  sb.writeOptIn(m.state, Object.assign({
    enabled: true, visibility: { verdict: 'private', reason: 'affirmative_private' },
  }, extra || {}));
}

function cli(m, args, stdin, envExtra) {
  const r = spawnSync(process.execPath, [CLI].concat(args), {
    cwd: m.work, input: stdin === undefined ? '' : stdin, encoding: 'utf8', timeout: 60000,
    env: baseEnv(Object.assign({ HANDSHAKE_STATE_DIR: m.data, HANDSHAKE_SKIP_HOST_CHECKS: '1' }, envExtra || {})),
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', all: (r.stdout || '') + (r.stderr || '') };
}

// A real hook process, driven the way the host drives it.
function hook(m, file, event, ctx, envExtra) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(HOOKS, file), event], {
      cwd: m.work, stdio: ['pipe', 'pipe', 'pipe'],
      env: baseEnv(Object.assign({ HANDSHAKE_STATE_DIR: m.data }, envExtra || {})),
    });
    let out = ''; let errText = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { errText += c; });
    child.stdin.end(JSON.stringify(Object.assign({
      hookEventName: event, workingDirectory: m.work,
    }, ctx || {})));
    child.on('close', (code) => resolve({ code, out, err: errText }));
  });
}

// The workspace handle the monitor/hook code resolves for itself.
function found(m) {
  const f = C.resolveWorkspace(m.work);
  assert.ok(f, 'the fixture must resolve as a handshake workspace');
  return f;
}

function beat(m, opts) {
  const prev = process.env.HANDSHAKE_STATE_DIR;
  process.env.HANDSHAKE_STATE_DIR = m.data;
  try {
    return H.stateBatch(m.state, { root: m.work, ws: m.ws }, opts || {});
  } finally {
    if (prev === undefined) delete process.env.HANDSHAKE_STATE_DIR; else process.env.HANDSHAKE_STATE_DIR = prev;
  }
}

function learn(m, text) {
  const r = cli(m, ['learn', text, '--paths', 'src/net/retry.ts']);
  assert.equal(r.code, 0, 'learn: ' + r.all);
  return r;
}

function remoteCommits(bare) {
  const r = gitRaw(bare, ['rev-list', '--count', 'refs/heads/handshake/state']);
  return r.status === 0 ? Number(String(r.stdout).trim()) : 0;
}

// ============================================== 1. no commit before opt-in ===

test('with no opt-in the beat writes nothing, pushes nothing and spawns no git at all', async () => {
  const root = tmp('optin');
  const bare = bareRemote(root);
  const alex = member(root, 'alex', bare);
  learn(alex, 'The retry budget is per-host.');

  const r = await beat(alex);
  assert.equal(r.ran, false);
  assert.equal(r.reason, 'not_enabled', JSON.stringify(r));
  assert.equal(remoteCommits(bare), 0, 'no commit is created before the opt-in');
  assert.equal(gitRaw(alex.work, ['rev-parse', '--verify', '-q', 'refs/heads/handshake/state']).status !== 0, true,
    'and no local ref either');
  assert.equal(fs.existsSync(path.join(alex.state.dir, 'state.beat')), false,
    'nothing was even recorded: a workspace that never opted in pays nothing');
});

test('a proven child creates nothing, even with the opt-in present', async () => {
  const root = tmp('child');
  const bare = bareRemote(root);
  const alex = member(root, 'alex', bare);
  optIn(alex);
  learn(alex, 'Children never write to a remote.');

  const prev = process.env.CLAUDE_CODE_CHILD_SESSION;
  process.env.CLAUDE_CODE_CHILD_SESSION = '1';
  let r;
  try { r = await beat(alex); } finally {
    if (prev === undefined) delete process.env.CLAUDE_CODE_CHILD_SESSION;
    else process.env.CLAUDE_CODE_CHILD_SESSION = prev;
  }
  assert.equal(r.ran, false);
  assert.equal(r.reason, 'child', JSON.stringify(r));
  assert.equal(remoteCommits(bare), 0, 'PROTOCOL 7.2 rule 1: a child never writes to a remote');
});

// ================================================ 2. the ≤ 1/min batch clock ==

test('two batches inside one minute produce ONE commit, and the clock is shared across processes', async () => {
  const root = tmp('clock');
  const bare = bareRemote(root);
  const alex = member(root, 'alex', bare, { session: 'sess-clock' });
  optIn(alex);
  learn(alex, 'One.');

  const first = await beat(alex);
  assert.equal(first.outcome, 'ok', JSON.stringify(first));
  assert.equal(remoteCommits(bare), 1);

  // A second batch in the same minute, with NEW content, from this process.
  learn(alex, 'Two, in the same minute.');
  const second = await beat(alex);
  assert.equal(second.ran, false);
  assert.equal(second.reason, 'not_due');
  assert.equal(remoteCommits(bare), 1, 'still one commit: the batch is the point');

  // ...and from a DIFFERENT PROCESS. The monitor holds `lastBeat` in a
  // variable; the Stop hook is a fresh process every turn, so the clock has to
  // be on disk or the fallback would commit once per turn.
  await hook(alex, 'stop.js', 'Stop', { sessionId: 'sess-clock' });
  assert.equal(remoteCommits(bare), 1,
    'the Stop-hook fallback reads the same clock the monitor wrote');

  // Force past the window the way the wall clock would: age the record.
  const rec = stateLib.readStateBeat(alex.state);
  stateLib.writeStateBeat(alex.state, Object.assign({}, rec, { at: Date.now() - H.STATE_BATCH_MS - 1000 }));
  const third = await beat(alex);
  assert.equal(third.outcome, 'ok', JSON.stringify(third));
  assert.equal(remoteCommits(bare), 2, 'past the minute, the queued batch goes out as one commit');

  // Both records are in the ONE tree, in one file, and both commits carry the
  // marker (section 4.2 item 4: present on three paths out of four is a marker
  // that bills on the fourth).
  const shard = git(bare, ['show', 'refs/heads/handshake/state:.handshake/tasks/alex.md']);
  assert.match(shard, /One\./);
  assert.match(shard, /Two, in the same minute\./);
  for (const line of git(bare, ['log', '--format=%B', 'refs/heads/handshake/state']).split('\n\n\n')) {
    if (line.trim()) assert.match(line, /\[skip ci\]/, 'every commit message this stage writes carries [skip ci]');
  }
});

test('`force` may skip the CLOCK but never the LOCK: a forced flush stands aside for a live beat', async () => {
  // The ≤ 1/min clock is a CADENCE, not mutual exclusion - it is read before
  // eight git spawns and written after, and both hook flushes pass `force`,
  // which skips it entirely. That is exactly how two writers in one clone ended
  // up seeding one shared temp index and pushing a fast-forward that deleted
  // the peer's shard. The lock lives inside the beat, below `force`, so a
  // forced flush is bound by it like everything else.
  const root = tmp('forcelock');
  const bare = bareRemote(root);
  const alex = member(root, 'alex', bare, { session: 'sess-lock' });
  optIn(alex);
  learn(alex, 'The record a peer is waiting on.');

  // Another process in this clone is mid-batch.
  const holder = sb.acquireBatchLock(alex.state, { now: Date.now(), where: 'monitor' });
  assert.equal(holder.held, true);

  const forced = await beat(alex, { force: true, where: 'session_end' });
  assert.equal(forced.reason, 'locked', JSON.stringify(forced));
  assert.equal(forced.outcome, 'deferred');
  assert.equal(remoteCommits(bare), 0, 'nothing was committed behind a held lock');
  assert.equal(stateLib.readStateBeat(alex.state).at, null,
    'and the clock did not move: the holder writes its own record, not this one');
  assert.ok(stateLib.statePending(alex.state) !== null, 'the batch is still owed');

  // The holder finishes; the very next forced flush goes out.
  holder.release();
  const after = await beat(alex, { force: true, where: 'session_end' });
  assert.equal(after.outcome, 'ok', JSON.stringify(after));
  assert.equal(remoteCommits(bare), 1);
});

test('a beat with nothing changed makes no commit and leaves the clock honest', async () => {
  const root = tmp('unchanged');
  const bare = bareRemote(root);
  const alex = member(root, 'alex', bare);
  optIn(alex);
  learn(alex, 'Only one record exists.');
  assert.equal((await beat(alex)).outcome, 'ok');

  const rec = stateLib.readStateBeat(alex.state);
  stateLib.writeStateBeat(alex.state, Object.assign({}, rec, { at: Date.now() - H.STATE_BATCH_MS - 1000 }));
  const again = await beat(alex);
  assert.equal(again.outcome, 'unchanged', JSON.stringify(again));
  assert.equal(remoteCommits(bare), 1, 'commit-only-if-changed');
});

// ============================================ 3. the deferred vocabulary ====

test('an unreachable remote defers, the count climbs, and status names offline - not deferred', async () => {
  const root = tmp('offline');
  const bare = bareRemote(root);
  const alex = member(root, 'alex', bare);
  optIn(alex);
  learn(alex, 'Written while the remote was there.');
  assert.equal((await beat(alex)).outcome, 'ok');

  // The remote goes away. `rev-list` on a path that is not a repository is the
  // "could not reach it" class, not the "it said no" class.
  fs.rmSync(bare, { recursive: true, force: true });
  learn(alex, 'Written while the remote was gone.');
  const rec = stateLib.readStateBeat(alex.state);
  stateLib.writeStateBeat(alex.state, Object.assign({}, rec, { at: Date.now() - H.STATE_BATCH_MS - 1000 }));

  const r = await beat(alex);
  assert.equal(r.outcome, 'offline', JSON.stringify(r));
  assert.equal(r.push, sb.PUSH_STATES.offline);
  assert.ok(sb.deferredCount(alex.state) >= 1, 'a deferred write that does not say it was deferred is a lie');

  const out = cli(alex, ['status']).out;
  assert.match(out, /push: offline/);
  assert.doesNotMatch(out, /push: deferred/, 'offline and `deferred (no time in the beat)` are different words');
  assert.match(out, /deferred: [1-9]/);
});

test('a beat with no time left records `deferred (no time in the beat)` WITHOUT moving the clock', async () => {
  const root = tmp('notime');
  const bare = bareRemote(root);
  const alex = member(root, 'alex', bare);
  optIn(alex);
  learn(alex, 'Queued.');

  // A deadline already in the past: nothing may be spawned, and the next turn
  // must retry rather than wait out a minute this beat did not spend.
  const r = await beat(alex, { deadline: Date.now() - 1 });
  assert.equal(r.ran, false);
  assert.equal(r.reason, 'no_time');
  assert.equal(r.push, sb.PUSH_STATES.deferred);
  assert.equal(remoteCommits(bare), 0);
  assert.equal(stateLib.readStateBeat(alex.state).at, null, 'the CLOCK did not move; only the outcome was recorded');
  assert.match(cli(alex, ['status']).out, /push: deferred \(no time in the beat\)/);

  // ...and the very next beat, with time, goes out.
  const ok = await beat(alex);
  assert.equal(ok.outcome, 'ok', JSON.stringify(ok));
  assert.equal(remoteCommits(bare), 1);
});

// ======================================= 4. the hooks: end, and late-not-lost =

test('the two flush budgets are the numbers the plan names, and neither hook is widened for them', () => {
  // THE PINS ARE THE PLAN'S OWN NUMBERS. An earlier build widened SessionEnd
  // from 3 s to 7 s because one flush measures ~1.8 s warm on Windows and more
  // under load - which bought the flush with the human's shutdown time and made
  // an OFFLINE machine pay 6.6 s at every session end (measured). The owner's
  // ruling of 2026-09-05 is the other way round: keep the window the plan sizes,
  // and let a flush that does not fit DEFER. Deferring is not losing - the batch
  // stays behind `state.pending` and the late-not-lost arm commits it at the
  // next session start with one line.
  const end = fs.readFileSync(path.join(HOOKS, 'session-end.js'), 'utf8');
  const start = fs.readFileSync(path.join(HOOKS, 'session-start.js'), 'utf8');
  const num = (src, name) => Number((new RegExp('const ' + name + ' = (\\d+)').exec(src) || [])[1]);

  // SessionEnd: V2-PLAN 10.1 - the flush rides "inside its 3 s budget".
  const budget = num(end, 'BUDGET_MS');
  const margin = num(end, 'MARGIN_MS');
  const leave = num(end, 'LEAVE_MS');
  assert.equal(budget, 3000, 'V2-PLAN 10.1 sizes this window at 3 s and the flush rides inside it');
  assert.ok(Number.isFinite(margin) && Number.isFinite(leave));
  // `leave` and the flush are SEQUENCED - the flush publishes the record
  // `leave` writes - so `leave` gets a CEILING rather than the whole wall. At
  // 2,500 inside a 3,000 window the flush would never once run, which is a step
  // that ships dead.
  assert.ok(budget - margin - leave >= 1200,
    'the flush needs a real slice AFTER `leave`, or it is a step that never runs');
  assert.match(end, /const DEADLINE = ARMED_AT \+ BUDGET_MS - MARGIN_MS;/,
    'the wall is derived from the watchdog, never invented beside it');
  assert.match(end, /C\.armSafety\(BUDGET_MS\)/);
  assert.match(end, /await C\.runCli\(\['leave'/,
    '`leave` is AWAITED, not raced: the flush exists to publish the record it writes');

  // SessionStart: the flush is a ROW OF ITS OWN beside the sync's, not a slice
  // taken quietly out of it. Section 2.5's row is written 1,500 + 500 + 7,000
  // and has no fourth number; the fourth number is named here and the sync's
  // CEILING is what gives way on the rare session that actually flushes.
  const late = num(start, 'LATE_FLUSH_MS');
  const sync = num(start, 'SYNC_BUDGET_MS');
  const floor = num(start, 'SYNC_FLOOR_MS');
  const sBudget = num(start, 'BUDGET_MS');
  const sMargin = num(start, 'MARGIN_MS');
  const scanLib = require('../lib/shard-scan');
  const readHalf = scanLib.FETCH_BUDGET_MS + scanLib.REF_SCAN_BUDGET_MS;
  assert.equal(readHalf, 2000, 'section 2.5 SessionStart row: 1,500 fetch + 500 whole-scan');
  assert.equal(sBudget, 9500, 'the hook is NOT widened for the flush');
  assert.equal(sMargin, 500);
  assert.equal(sync, 7000, "the sync's own ceiling is untouched: it binds on every session that does not flush");
  // 5,000 is a measurement: one flush is ~15 git processes and measures 3,540 ms
  // warm on this machine, more under load. At 2,000 it never lands and at 4,000
  // only on an idle one - and this is the arm that makes SessionEnd's own
  // deferral survivable, so it gets margin rather than the tightest fit.
  assert.equal(late, 5000, 'a flush budget that fits no measured flush is a step that ships dead');
  // The whole row adds up inside the wall, and the sync still clears its floor
  // on the session that pays for every other step in full.
  assert.equal(readHalf + late + (sBudget - sMargin - readHalf - late), sBudget - sMargin);
  assert.ok(sBudget - sMargin - readHalf - late >= floor,
    'a flush budget that starves the sync below its floor is not a budget');
  assert.match(start, /const DEADLINE = ARMED_AT \+ BUDGET_MS - MARGIN_MS;/);
  assert.match(start, /C\.armSafety\(BUDGET_MS\)/);
  for (const re of [/deadline: readHalf/, /Math\.min\(started \+ LATE_FLUSH_MS, DEADLINE\)/, /DEADLINE - Date\.now\(\)/]) {
    assert.match(start, re, 'every step must take its slice of the shared wall: ' + re);
  }

  // THE SPELLED-OUT ROW IN THE COMMENT IS ARITHMETIC, AND THIS ADDS IT UP.
  // It shipped as 1,500 / 500 / 5,000 / 2,500 under a 9,000 label - which sums
  // to 9,500, half a second past the watchdog - and the row is what the next
  // change to this hook will trust. Parsed rather than eyeballed: a prose
  // budget nothing checks is a budget that drifts.
  const head = start.indexOf('//     1,500  fetch');
  assert.ok(head > 0, 'the budget row must still be in the hook, spelled out');
  const block = start.slice(head, start.indexOf('computes for itself'));
  const rows = [...block.matchAll(/^\/\/\s+([\d,]{3,})\s\s\S/gm)].map((m) => Number(m[1].replace(/,/g, '')));
  assert.equal(rows.length, 5, 'four steps and a total: ' + JSON.stringify(rows));
  assert.deepEqual(rows.slice(0, 4), [scanLib.FETCH_BUDGET_MS, scanLib.REF_SCAN_BUDGET_MS, late,
    sBudget - sMargin - readHalf - late], 'every row must be the constant it claims to be');
  assert.equal(rows[0] + rows[1] + rows[2] + rows[3], rows[4], 'the row must sum to its own total');
  assert.equal(rows[4], sBudget - sMargin, 'and the total must be the shared wall');

  // SYNC_FLOOR_MS is a THRESHOLD, not a floor under the timeout. `Math.max`
  // there starts a 1,500 ms sync on a wall that has already run out - 500 ms
  // past armSafety, with `pending` uncleared - which is the one failure the
  // shared wall exists to prevent.
  assert.match(start, /if \(left >= SYNC_FLOOR_MS\) \{/,
    'below the floor the sync is SKIPPED, and the marker-clearing still happens inside the wall');
  assert.doesNotMatch(start, /timeoutMs: Math\.max\(/,
    'a floor under the timeout starts a sync past the deadline instead of skipping it');
  assert.match(start, /timeoutMs: Math\.min\(SYNC_BUDGET_MS, left\)/,
    'and the sync that does run takes what the wall leaves, never more');
});

test('SessionEnd tries the last batch inside the plan 3 s window, and DEFERS rather than widening it', async () => {
  // MEASURED, AND THE NUMBER IS THE POINT (owner's ruling of 2026-09-05).
  // V2-PLAN 10.1 says the flush rides "inside its 3 s budget", and on this
  // machine it does not fit: `leave` costs 662 ms and one warm flush costs
  // 3,540 ms - roughly fifteen git processes, a fetch, the eight-step
  // temp-index build, the checked-out guard, the update-ref and the push. The
  // build that widened this hook to 7,000 to make it fit charged an OFFLINE
  // machine 6.6 s at every session end for the privilege. So the window stays
  // at the plan's 3,000 and the flush DEFERS, loudly - which is not losing: the
  // records are on disk, the marker stays set, and the late-not-lost arm at the
  // next session start is what commits them (the test below).
  const root = tmp('sessionend');
  const bare = bareRemote(root);
  const alex = member(root, 'alex', bare, { session: 'sess-end' });
  optIn(alex);
  learn(alex, 'An earlier record, already pushed.');
  assert.equal((await beat(alex)).outcome, 'ok');
  assert.equal(remoteCommits(bare), 1);

  learn(alex, 'The session closing record.');
  const recEnd = stateLib.readStateBeat(alex.state);
  stateLib.writeStateBeat(alex.state, Object.assign({}, recEnd, { at: Date.now() - H.STATE_BATCH_MS - 1000 }));

  const started = Date.now();
  const r = await hook(alex, 'session-end.js', 'SessionEnd', { sessionId: 'sess-end', reason: 'other' });
  const elapsed = Date.now() - started;
  assert.equal(r.code, 0, 'a hook exits 0 always; stderr: ' + r.err);
  // The window is the property under test: the hook must come back inside its
  // own watchdog and must not have quietly grown one.
  assert.ok(elapsed < 4500, 'SessionEnd must exit on its 3 s watchdog, took ' + elapsed + ' ms');

  // `leave` still ran and still wrote the closing record - that half of the
  // hook is unaffected and is what the flush exists to carry.
  const shard = fs.readFileSync(path.join(alex.work, '.handshake', 'tasks', 'alex.md'), 'utf8');
  assert.match(shard, /parting/i, "`leave` writes the parting record whether or not the flush fits");
  assert.match(shard, /The session closing record\./);

  // AND THE BATCH SAYS IT WAS DEFERRED. section 4.1's honesty rule: a deferred
  // write that does not say it was deferred is a lie.
  const rec = stateLib.readStateBeat(alex.state);
  assert.equal(rec.where, 'session_end', 'the flush really was attempted here: ' + JSON.stringify(rec));
  if (rec.outcome === 'ok') {
    // A fast machine: the flush fit. Then it must have landed WHOLE.
    assert.equal(remoteCommits(bare), 2);
    assert.match(git(bare, ['show', 'refs/heads/handshake/state:.handshake/tasks/alex.md']), /parting/i);
    assert.equal(stateLib.statePending(alex.state), null, 'a flushed batch clears the marker');
  } else {
    assert.equal(rec.outcome, 'deferred', JSON.stringify(rec));
    assert.equal(rec.push, sb.PUSH_STATES.deferred, 'and it names the cause it actually had');
    assert.ok(stateLib.statePending(alex.state) !== null,
      'nothing is LOST: the marker stays, and the next session start is what commits it');
    assert.match(cli(alex, ['status']).out, /push: deferred \(no time in the beat\)/,
      'section 4.4 rule 1: the human is told, on the one field that says why a branch is not moving');
  }
});

test('a session that dies without flushing leaves the batch, and the NEXT session start commits it and says so', async () => {
  const root = tmp('late');
  const bare = bareRemote(root);
  const alex = member(root, 'alex', bare, { session: 'sess-dead' });
  optIn(alex);
  learn(alex, 'An earlier session pushed this one.');
  assert.equal((await beat(alex)).outcome, 'ok');
  assert.equal(remoteCommits(bare), 1);

  // The session that dies: it writes a record and is then killed - no beat, no
  // SessionEnd. All that is left is the marker the shard write put down.
  learn(alex, 'Written by a session that was then killed.');
  const aged = stateLib.readStateBeat(alex.state);
  stateLib.writeStateBeat(alex.state, Object.assign({}, aged, { at: Date.now() - H.STATE_BATCH_MS - 1000 }));
  assert.ok(stateLib.statePending(alex.state) !== null,
    'the write path marks the batch as unflushed, so a session that never beat still leaves a trail');
  assert.equal(remoteCommits(bare), 1);
  assert.doesNotMatch(cli(alex, ['status']).out, /left over from your last session/);

  beParent(alex, 'sess-next');
  const r = await hook(alex, 'session-start.js', 'SessionStart', { sessionId: 'sess-next', source: 'startup' });
  assert.equal(r.code, 0, 'the hook never fails the turn it observes: ' + r.err);
  assert.equal(r.out, '', 'SessionStart is async: its stdout is not session context');

  assert.equal(remoteCommits(bare), 2, 'late instead of lost');
  assert.match(git(bare, ['show', 'refs/heads/handshake/state:.handshake/tasks/alex.md']),
    /Written by a session that was then killed\./);
  assert.match(cli(alex, ['status']).out,
    /committed a batch left over from your last session - late instead of lost/,
    'section 4.4 rule 1: the automated action leaves ONE line');
  assert.equal(fs.existsSync(path.join(alex.state.dir, 'sync.pending')), false,
    'and the pending marker is still cleared - the hook must never die holding it');
});

test('SessionStart with nothing pending does no state work and says no such line', async () => {
  const root = tmp('nolate');
  const bare = bareRemote(root);
  const alex = member(root, 'alex', bare, { session: 'sess-clean' });
  optIn(alex);
  // No shard write at all, so no marker.
  assert.equal(stateLib.statePending(alex.state), null);
  const r = await hook(alex, 'session-start.js', 'SessionStart', { sessionId: 'sess-clean', source: 'startup' });
  assert.equal(r.code, 0);
  assert.equal(remoteCommits(bare), 0);
  assert.doesNotMatch(cli(alex, ['status']).out, /left over from your last session/,
    'the negative assertion: the line must not become decoration');
});

// ============================================ 5. the Stop-hook fallback ======

test('with no monitor the Stop hook takes the batch, and takes it even when the transport is latched off', async () => {
  const root = tmp('stop');
  const bare = bareRemote(root);
  const alex = member(root, 'alex', bare, { session: 'sess-stop' });
  optIn(alex);
  learn(alex, 'A headless session still commits.');

  // The section 10.2 latch: posting on this transport was refused for the
  // session. That is a statement about the LIVE layer's credential and says
  // nothing about whether this machine may commit to a git branch - a `push:`
  // line that went silent because ntfy returned 403 would be exactly the lie
  // section 4.1 forbids.
  alex.state.update((s) => {
    s.session = 'x';
    return s;
  });
  fs.writeFileSync(path.join(alex.state.dir, 'session.json'), JSON.stringify({
    session: require('../lib/state').State.sessionId('sess-stop'),
    posting_stopped: { ntfy: { code: '403', at: Date.now() } },
  }));

  const r = await hook(alex, 'stop.js', 'Stop', { sessionId: 'sess-stop' }, { HANDSHAKE_SESSION_ID: 'sess-stop' });
  assert.equal(r.code, 0);
  assert.equal(r.out, '', 'the Stop hook writes nothing to stdout');
  assert.equal(remoteCommits(bare), 1, 'the state branch is git, not the transport');
});

// ==================================================== 6. THE WHOLE CHAIN =====

test('THE CHAIN: alex opts in, writes a learning, the beat pushes it, and bob\'s session start has it', async () => {
  // V2-PLAN 11.2 end to end, with BOTH halves real. Bob never checks the
  // branch out, never runs `git fetch` by hand and has nothing of alex's on
  // disk; his first prompt still carries alex's learning.
  const root = tmp('chain');
  const bare = bareRemote(root);
  const alex = member(root, 'alex', bare, { session: 'sess-alex' });
  const bob = member(root, 'bob', bare, { seed: false, session: 'sess-bob' });
  optIn(alex);
  optIn(bob);                        // the opt-in gates the FETCH on bob's side

  learn(alex, 'Token refresh is timer-driven; the 401 retry never fires.');
  const pushed = await beat(alex);
  assert.equal(pushed.outcome, 'ok', JSON.stringify(pushed));
  assert.equal(pushed.pushed, true);
  assert.equal(remoteCommits(bare), 1);

  // Author = the member, committer = the tool. This is the split that makes
  // the read half's author check a real verdict on the ref (section 10.1).
  const idents = git(bare, ['log', '-1', '--format=%an|%ae|%cn', 'refs/heads/handshake/state']).trim();
  assert.match(idents, /^alex\|alex@example\.com\|claude-handshake$/);

  // Bob has nothing of alex's on disk, and no handshake ref at all yet.
  const bobTasks = path.join(bob.work, '.handshake', 'tasks');
  const onDisk = fs.existsSync(bobTasks) ? fs.readdirSync(bobTasks).filter((f) => f.endsWith('.md')) : [];
  assert.deepEqual(onDisk.filter((f) => f === 'alex.md'), [], 'nothing of alex\'s is on bob\'s disk');
  assert.notEqual(gitRaw(bob.work, ['rev-parse', '--verify', '-q', sb.REMOTE_STATE_REF]).status, 0);

  const r = await hook(bob, 'session-start.js', 'SessionStart', { sessionId: 'sess-bob', source: 'startup' });
  assert.equal(r.code, 0, 'bob\'s hook: ' + r.err);

  const cache = scan.readCache(bob.state.dir);
  assert.ok(cache, 'bob has a knowledge cache');
  assert.equal(cache.v, 1, 'the injector\'s version check still passes unchanged');
  assert.equal(cache.scan_session, 'sess-bob');
  assert.equal(cache.source, 'ref', 'the records came from the fetched ref, not from the working tree');
  assert.equal(cache.scan_truncated, false);
  const texts = cache.records.map((rec) => rec.fields.text);
  assert.ok(texts.some((t) => /Token refresh is timer-driven/.test(t)),
    'alex\'s learning is in bob\'s knowledge cache: ' + JSON.stringify(texts));
  assert.equal(cache.records[0].member, 'alex', 'attributed to the shard\'s member');
  assert.ok(Number.isFinite(cache.fetch_ms), 'and the fetch duration is recorded for `status` to print');

  // Nothing was checked out, and no local branch was created by reading one.
  // Asserted as "no handshake ref" rather than as an exact listing: bob's clone
  // was seeded with `seed: false`, so it has no commit of its own and `git
  // branch` is legitimately EMPTY there - an exact-string assertion would be
  // testing the fixture's shape instead of the property.
  const bobBranches = git(bob.work, ['branch', '--list']).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  assert.deepEqual(bobBranches.filter((l) => /handshake/.test(l)), [],
    'reading a ref creates no local branch: ' + JSON.stringify(bobBranches));
  const stillOnDisk = fs.existsSync(bobTasks) ? fs.readdirSync(bobTasks).filter((f) => f.endsWith('.md')) : [];
  assert.deepEqual(stillOnDisk.filter((f) => f === 'alex.md'), []);

  // section 4.4 rule 1: `status` prints the number rather than a shrug.
  const statusOut = cli(bob, ['status']).out;
  assert.match(statusOut, /last SessionStart fetch: \d+ ms/);
  assert.match(statusOut, /shard scan: complete/);

  // And bob's side of rule 3: alex HAS a shard on the branch, so no
  // "not enabled yet" line is printed about him.
  bob.state.setPeers({ members: [{ member: 'alex', name: 'alex' }], claims: [], presence: [], at: Date.now() });
  assert.doesNotMatch(cli(bob, ['branches']).out, /alex: no state branch/);
});

test('THE CHAIN, second leg: bob answers back on the same branch and alex reads it', async () => {
  const root = tmp('chain2');
  const bare = bareRemote(root);
  const alex = member(root, 'alex', bare, { session: 'sess-a' });
  const bob = member(root, 'bob', bare, { seed: false, session: 'sess-b' });
  optIn(alex); optIn(bob);

  learn(alex, 'Alex learned the first thing.');
  assert.equal((await beat(alex)).outcome, 'ok');

  learn(bob, 'Bob learned the second thing.');
  const bobBeat = await beat(bob);
  assert.equal(bobBeat.outcome, 'ok', JSON.stringify(bobBeat));
  assert.equal(bobBeat.created_root, false, 'rule 2: adopt, never re-create');
  assert.equal(remoteCommits(bare), 2, 'one branch, two writers, a linear chain');

  const tree = git(bare, ['ls-tree', '-r', '--name-only', 'refs/heads/handshake/state']).split(/\r?\n/).filter(Boolean).sort();
  assert.deepEqual(tree, ['.handshake/tasks/alex.md', '.handshake/tasks/bob.md'],
    'both members\' files coexist in one tree because neither writes the other\'s');

  const r = await hook(alex, 'session-start.js', 'SessionStart', { sessionId: 'sess-a2', source: 'startup' });
  assert.equal(r.code, 0, r.err);
  const cache = scan.readCache(alex.state.dir);
  const texts = cache.records.map((rec) => rec.fields.text).join(' | ');
  assert.match(texts, /Bob learned the second thing/, 'alex reads bob\'s record off the ref: ' + texts);
});

// ============================== 7. the invariant the whole mechanism is for ==

test('a hundred batches leave HEAD, the index and a dirty working tree byte-identical', async () => {
  // The HEAD-invariant test, and the one that would have caught a
  // `checkout --orphan` implementation. Run through the WIRED path - the
  // monitor's own batch function - rather than through the write layer
  // directly, because the wiring is what a human's session actually runs.
  const root = tmp('invariant');
  const bare = bareRemote(root);
  const alex = member(root, 'alex', bare);
  optIn(alex);

  // A dirty tree: staged work, unstaged work and an untracked file, which is
  // what an ordinary mid-session working tree looks like.
  fs.writeFileSync(path.join(alex.work, 'staged.txt'), 'staged\n');
  git(alex.work, ['add', 'staged.txt']);
  fs.writeFileSync(path.join(alex.work, 'README.md'), 'edited, not staged\n');
  fs.writeFileSync(path.join(alex.work, 'untracked.txt'), 'untracked\n');

  const snapshot = () => ({
    head: git(alex.work, ['rev-parse', 'HEAD']).trim(),
    symbolic: git(alex.work, ['symbolic-ref', 'HEAD']).trim(),
    status: git(alex.work, ['status', '--porcelain']),
    index: fs.readFileSync(path.join(alex.work, '.git', 'index')),
    main: git(alex.work, ['log', '--format=%H %s', 'main']),
  });
  const before = snapshot();

  for (let i = 0; i < 100; i++) {
    learn(alex, 'batch ' + i);
    const rec = stateLib.readStateBeat(alex.state);
    stateLib.writeStateBeat(alex.state, Object.assign({}, rec, { at: Date.now() - H.STATE_BATCH_MS - 1000 }));
    const r = await beat(alex);
    assert.equal(r.outcome, 'ok', 'batch ' + i + ': ' + JSON.stringify(r));
  }

  const after = snapshot();
  assert.equal(after.head, before.head, 'HEAD never moves');
  assert.equal(after.symbolic, before.symbolic, 'and it is still a symbolic ref to the same branch');
  assert.equal(after.status, before.status, 'the human\'s staged, unstaged and untracked work is untouched');
  assert.equal(Buffer.compare(after.index, before.index), 0, '.git/index is never read and never written');
  assert.equal(after.main, before.main, '`git log main` is byte-identical after a hundred coordination commits');
  assert.equal(remoteCommits(bare), 100);
  assert.notEqual(gitRaw(bare, ['merge-base', 'main', 'refs/heads/handshake/state']).status, 0,
    'the branch is orphan: it shares no commit with main');
});
