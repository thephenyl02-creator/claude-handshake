'use strict';
// claude-handshake M6: the Stop-hook heartbeat fallback.
//
// PROTOCOL section 8 ends with a MUST that shipped only half-built: "Monitors
// do not start in headless or subagent sessions [S5]; a host without monitors
// MUST fall back to heartbeating on the Stop hook and MUST say so in
// `/handshake status` (section 10.2)." `handshake status` said so from v0.1.0
// [C bin/handshake.js:1293] while hooks/hooks.json registered no Stop hook at
// all, so the sentence was true about a beat that did not exist. This file
// exists to keep that from happening again in either direction: it proves the
// hook beats, and - the larger half - that it does NOT beat in the five cases
// where a per-turn post would be the rate-limit amplifier section 10.2
// forbids.
//
// Everything drives the real layers, the way test/hooks.test.js and
// test/heartbeat.test.js do: the real hook process, the real lib/state.js, and
// the real CLI. The transport endpoint is the discard port, so a beat that
// happens lands in the OFFLINE QUEUE - which is what makes "did it beat?" a
// file on disk rather than a mock's call count, with no network anywhere.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const stateLib = require('../lib/state');

const ROOT = path.join(__dirname, '..');
const HOOKS = path.join(ROOT, 'hooks');
const STOP = path.join(HOOKS, 'stop.js');
const CLI = path.join(ROOT, 'bin', 'handshake.js');
const DEAD_ENDPOINT = 'http://127.0.0.1:9';        // discard port: always refused
const WS = '0123456789abcdef0123456789abcdef';     // the hand-built relay fixture
const SESSION = 'sess-stop-1';

const NTFY_K_MS = 600 * 1000;                      // PROTOCOL section 8 keepalive
const RELAY_K_MS = 60 * 1000;

const temps = [];
after(() => {
  for (const d of temps) {
    // Failing to delete scratch is not a test result, so it must not fail the
    // file [C test/heartbeat.test.js, same pattern].
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
});

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

// This test process runs inside a Claude Code session, which exports
// CLAUDE_CODE_CHILD_SESSION / CLAUDE_CODE_SESSION_ID. Inheriting either would
// make every "parent" case below a proven child, and the hook would no-op for
// the wrong reason while the assertions still passed.
function baseEnv(extra) {
  const env = Object.assign({}, process.env);
  for (const k of ['CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID',
    'CLAUDE_SESSION_ID', 'HANDSHAKE_SESSION_ID', 'CLAUDE_PROJECT_DIR']) delete env[k];
  return Object.assign(env, extra || {});
}

// ---------------------------------------------------------------- fixtures --

let n = 0;

// A real joined ntfy workspace, built by the real CLI, pointed at the discard
// port. `handshake presence` therefore queues instead of posting, which is the
// section 10.1 silent-offline path [C test/cli.test.js].
function joinedNtfy() {
  const root = tmpDir('hs-stop-' + (n++) + '-');
  const box = { project: path.join(root, 'project'), data: path.join(root, 'data') };
  fs.mkdirSync(box.project, { recursive: true });
  cli(box, ['init', '--ntfy', DEAD_ENDPOINT, '--name', 'acme app']);
  const blob = cli(box, ['invite', '--inline']).out.trim().split('\n').pop().trim();
  assert.match(blob, /^hsi1_/, 'the fixture needs a real invite blob');
  cli(box, ['join', blob, '--as', 'tester'], 'y\n');

  box.ws = JSON.parse(cli(box, ['status', '--json']).out).workspace.ws;
  box.state = stateLib.openState(box.ws, { env: { HANDSHAKE_STATE_DIR: box.data } });
  beParent(box, SESSION);
  return box;
}

// A relay workspace, hand-built the way test/hooks.test.js builds its fixtures.
// Only the transport kind matters to the branch under test, and building it by
// hand keeps the relay cases from ever reaching a network call.
function relayWorkspace() {
  const root = tmpDir('hs-stop-relay-' + (n++) + '-');
  const box = { project: path.join(root, 'project'), data: path.join(root, 'data'), ws: WS };
  fs.mkdirSync(path.join(box.project, '.handshake'), { recursive: true });
  fs.writeFileSync(path.join(box.project, '.handshake', 'workspace.json'), JSON.stringify({
    ws: WS, name: 'acme-api', transport: 'relay', endpoint: DEAD_ENDPOINT,
    overlap_gate: 'warn', protocol: 1,
  }));
  box.state = stateLib.openState(WS, { env: { HANDSHAKE_STATE_DIR: box.data } });
  box.state.ensure();
  box.state.write({ ws: WS, name: 'acme-api', transport: 'relay', member: 'me00', protocol: 1 });
  beParent(box, SESSION);
  return box;
}

// SessionStart classifies the session once and records the verdict, because it
// is the only hook that sees the interactive `source` marker [C
// hooks/common.js recordRole]. Every later hook - this one included - reads
// that record. Seeding it is what makes these fixtures the case the fallback
// is FOR: a monitor-less parent.
function beParent(box, sessionId) {
  box.state.update((s) => {
    s.session_roles = { [sessionId]: { child: false, reason: 'interactive_marker_source', at: Date.now() } };
    return s;
  });
}

// `envExtra` exists for one reason: the CLI derives its session id from the
// ENVIRONMENT [C bin/handshake.js:133-137], so a test that wants `rest` to
// stamp its sentinel with a known session has to say which one.
function cli(box, args, stdin, envExtra) {
  const r = spawnSync(process.execPath, [CLI].concat(args), {
    cwd: box.project, input: stdin === undefined ? '' : stdin, encoding: 'utf8', timeout: 30000,
    env: baseEnv(Object.assign({ HANDSHAKE_STATE_DIR: box.data, HANDSHAKE_SKIP_HOST_CHECKS: '1' }, envExtra || {})),
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function stop(box, opts) {
  const o = opts || {};
  const r = spawnSync(process.execPath, [STOP, 'Stop'], {
    input: JSON.stringify(Object.assign({
      hookEventName: 'Stop', sessionId: SESSION, workingDirectory: box.project,
    }, o.payload || {})),
    encoding: 'utf8', cwd: o.cwd || box.project, timeout: 30000,
    env: baseEnv(Object.assign({ HANDSHAKE_STATE_DIR: box.data }, o.env || {})),
  });
  // Every case in this file asserts the two rules that bind every hook
  // (PROTOCOL section 8): exit 0 always, and nothing on stdout. A Stop hook's
  // stdout is worse than noise - a JSON object there is read as a decision
  // that can block the stop - so this is checked on every single firing.
  assert.equal(r.status, 0, 'a hook exits 0 always; stderr: ' + r.stderr);
  assert.equal(r.stdout, '', 'the Stop hook writes nothing to stdout');
  return r;
}

// The offline queue is the wire form, on disk [C test/cli.test.js].
function queued(box, type) {
  let q;
  try { q = JSON.parse(fs.readFileSync(path.join(box.data, box.ws, 'queue.json'), 'utf8')); } catch (_) { return []; }
  return (q.entries || []).map((e) => e.envelope).filter((e) => !type || e.type === type);
}

const marker = (box) => path.join(box.state.dir, 'stop.beat');
const markerBody = (box) => { try { return fs.readFileSync(marker(box), 'utf8').trim(); } catch (_) { return null; } };
const markerMtime = (box) => { try { return fs.statSync(marker(box)).mtimeMs; } catch (_) { return null; } };

// Move the marker back in time. mtime IS the clock here, exactly as the
// PostToolUse gate uses it [C hooks/common.js POSTTOOL_GATE_MS], so ageing it
// is how a cadence window is crossed without sleeping through one.
function ageMarker(box, ms) {
  const t = new Date(Date.now() - ms);
  fs.utimesSync(marker(box), t, t);
}

// ================================================================ it beats ===

test('with no monitor and no marker, the Stop hook beats (section 8 fallback)', () => {
  const box = joinedNtfy();
  const before = queued(box, 'presence.update').length;
  assert.equal(markerBody(box), null, 'the fixture starts with no beat on record');

  stop(box);

  assert.equal(queued(box, 'presence.update').length, before + 1,
    'one presence beat reached the transport (queued: the endpoint is the discard port)');
  // Derived from real tool activity, not asserted: no activity mark exists in
  // a fresh fixture, so the honest state is `waiting` [C monitors/heartbeat.js].
  assert.equal(markerBody(box), 'waiting',
    'the marker records the state that beat asserted - ntfy\'s state-change clause needs it');
  assert.ok(Date.now() - markerMtime(box) < 30000, 'and its mtime is the beat timestamp');
});

test('the presence post is taken FIRST, ahead of the change-delta push', () => {
  // beat() spawns TWO CLI calls when the session has files peers have not been
  // told about [C monitors/heartbeat.js pendingPush], at up to 8 s each, under
  // this hook's 9.5 s watchdog [C hooks/stop.js BUDGET_MS]. So on a transport
  // that accepts a connection and never answers, one of the two is going to be
  // the half that gets truncated - and the order decides which.
  //
  // It has to be the push. A missed delta is re-derived on the next beat
  // (`pushed_files` only advances on success); a missed presence post is a hole
  // in the section 8 clock that nothing refills, because the cadence marker is
  // stamped BEFORE the beat and the next window is a whole keepalive away.
  //
  // Order is checked on the wire rather than in the source: the offline queue
  // is append-ordered, so it records which call actually went out first.
  const box = joinedNtfy();
  const r = cli(box, ['claim', 'the seam', '--files', 'src/a.js']);
  assert.equal(r.code, 0, r.err);
  const before = queued(box).length;

  stop(box);

  assert.deepEqual(queued(box).slice(before).map((e) => e.type),
    ['presence.update', 'task.change'],
    'the beat renews presence before it pushes the delta, so a truncated beat still has a heartbeat in it');
});

// ============================================================ the cadence ====

test('it does not beat twice inside one cadence window, and beats once past it', () => {
  const box = joinedNtfy();
  stop(box);
  const after = queued(box, 'presence.update').length;
  const stamp = markerMtime(box);

  // A second turn ending seconds later. Turn boundaries are at least as bursty
  // as tool ones [S7]; without the gate this is a post per turn.
  stop(box);
  assert.equal(queued(box, 'presence.update').length, after, 'the second turn posted nothing');
  assert.equal(markerMtime(box), stamp, 'and did not move the clock forward either');

  // Past the 600 s ntfy keepalive the same firing must land.
  ageMarker(box, NTFY_K_MS + 5000);
  stop(box);
  assert.equal(queued(box, 'presence.update').length, after + 1,
    'the cadence gate delays the beat, it does not cancel it');
});

test('on ntfy a presence STATE CHANGE beats inside the window; on relay it does not', () => {
  // Section 8 gives the two transports different clocks, and the monitor
  // implements exactly that split: relay beats on elapsed time only, ntfy also
  // on a state change [C monitors/heartbeat.js tick()]. A fallback that
  // collapsed them would either go quiet on ntfy or over-post on the relay.
  const ntfy = joinedNtfy();
  stop(ntfy);
  const after = queued(ntfy, 'presence.update').length;
  assert.equal(markerBody(ntfy), 'waiting');

  // What PostToolUse writes on real tool activity; it is what flips the
  // derived state to `working`.
  fs.writeFileSync(path.join(ntfy.state.dir, 'activity.mark'), String(Date.now()));
  stop(ntfy);
  assert.equal(queued(ntfy, 'presence.update').length, after + 1,
    'ntfy beats on the change, seconds into a 600 s window');
  assert.equal(markerBody(ntfy), 'working', 'and the marker carries the new state');

  const relay = relayWorkspace();
  // Seeded rather than beaten out, so this case never spawns the CLI at all:
  // the assertion is about the gate, and the relay endpoint is dead anyway.
  fs.writeFileSync(marker(relay), 'waiting\n');
  fs.writeFileSync(path.join(relay.state.dir, 'activity.mark'), String(Date.now()));
  const stamp = markerMtime(relay);

  stop(relay);
  assert.equal(markerBody(relay), 'waiting', 'the relay clock ignores the state change');
  assert.equal(markerMtime(relay), stamp, 'nothing beat inside the 60 s relay window');

  ageMarker(relay, RELAY_K_MS + 5000);
  stop(relay);
  assert.ok(markerMtime(relay) > stamp, 'elapsed time, and only elapsed time, is what moves it');
});

// =============================================================== it defers ===

test('a live monitor owns the clock: the fallback stays out of its way', () => {
  const box = joinedNtfy();
  const before = queued(box, 'presence.update').length;
  // What monitors/heartbeat.js touches on every poll, and what lib/session.js
  // reads as "a monitor is running" (section 7.1).
  fs.writeFileSync(path.join(box.state.dir, 'monitor.alive'), String(Date.now()));

  stop(box);
  assert.equal(queued(box, 'presence.update').length, before, 'no second beat alongside the monitor');
  assert.equal(markerBody(box), null, 'and no marker: the hook did not even reach the gate');

  // The bound is lib/session.js's three-tick freshness window, not "the file
  // exists" - a monitor killed with the session must not silence the fallback
  // for the next one [C lib/session.js MONITOR_SENTINEL_MAX_AGE_MS].
  const dead = new Date(Date.now() - 4 * 60 * 1000);
  fs.utimesSync(path.join(box.state.dir, 'monitor.alive'), dead, dead);
  stop(box);
  assert.equal(queued(box, 'presence.update').length, before + 1,
    'a stale liveness sentinel is not a running monitor');
});

test('section 7.2 rule 1: a proven child never beats', () => {
  const box = joinedNtfy();
  const before = queued(box, 'presence.update').length;

  stop(box, { env: { CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_SESSION_ID: 'parent-uuid-7' } });
  assert.equal(queued(box, 'presence.update').length, before, 'a child posts nothing, ever');
  assert.equal(markerBody(box), null);

  // The documented agent payload marker is the same verdict by another route,
  // and it is the one that catches a subagent tree: Stop fires per agent turn.
  stop(box, { payload: { agent_id: 'agent-1', agent_type: 'general-purpose' } });
  assert.equal(queued(box, 'presence.update').length, before, 'nor does a payload-marked subagent');
  assert.equal(markerBody(box), null);
});

test('a session with no recorded role does not beat (7.1 safe fallback)', () => {
  const box = joinedNtfy();
  const before = queued(box, 'presence.update').length;
  // No monitor, no interactive `source` on a Stop payload, and nothing
  // recorded by SessionStart: the session cannot prove it is a parent, so
  // section 7.1 says it behaves as a child. Failing toward silence is the
  // whole point - a phantom teammate is worse than a missed beat.
  box.state.update((s) => { delete s.session_roles; return s; });

  stop(box);
  assert.equal(queued(box, 'presence.update').length, before);
  assert.equal(markerBody(box), null);
});

test('`handshake rest` stops the fallback too, via the disarm sentinel', () => {
  const box = joinedNtfy();
  const before = queued(box, 'presence.update').length;
  // The ONLY mid-session disarm the monitor contract allows [S5]. Without this
  // gate, `rest` would silence the monitor and be ignored by the very sessions
  // that have no monitor to silence.
  fs.writeFileSync(path.join(box.state.dir, 'monitor.disarm'), JSON.stringify({ session: SESSION, at: Date.now() }));

  stop(box);
  assert.equal(queued(box, 'presence.update').length, before, 'resting means resting');
  assert.equal(markerBody(box), null);
});

test('section 10.2: the posting_stopped latch is honored per transport', () => {
  const box = joinedNtfy();
  const before = queued(box, 'presence.update').length;
  // Once posting has stopped on this transport for the session it stays
  // stopped; spawning the CLI to be refused every turn is the retry loop 10.2
  // exists to forbid.
  fs.writeFileSync(box.state.files.session, JSON.stringify({
    session: SESSION, reported: {}, posting_stopped: { ntfy: true }, counts: {}, at: Date.now(),
  }));

  stop(box);
  assert.equal(queued(box, 'presence.update').length, before, 'the latch holds');
  assert.equal(markerBody(box), null);

  // Latched on the OTHER transport, this one is still free - the flag is keyed
  // by transport and reading it as a global switch would silence a healthy one.
  fs.writeFileSync(box.state.files.session, JSON.stringify({
    session: SESSION, reported: {}, posting_stopped: { relay: true }, counts: {}, at: Date.now(),
  }));
  stop(box);
  assert.equal(queued(box, 'presence.update').length, before + 1);
});

// ================================================ per-session, not forever ===
//
// Both switches above are per-SESSION by contract - `rest` says "broadcasting
// stopped for this session" [C bin/handshake.js:1849] and section 10.2 says
// "for the rest of the session" - and both are read out of files that outlive
// the session that wrote them. The monitor could ignore that, because it is one
// process per session that quits anyway [C monitors/heartbeat.js:60]; this hook
// is a fresh process every turn, forever, so an unscoped read of either file
// meant ONE `rest` (or one previous session's auth failure) silenced the
// fallback in every session that machine would ever run - while `status` went
// on promising a beat [C bin/handshake.js:1293].

test('a PREVIOUS session\'s disarm sentinel does not silence this one', () => {
  const box = joinedNtfy();
  const before = queued(box, 'presence.update').length;
  // The shape `rest` writes [C bin/handshake.js:1842], stamped with somebody
  // else's session. Nothing on disk distinguishes "left by a session that
  // ended" from "written a second ago" except this field.
  fs.writeFileSync(path.join(box.state.dir, 'monitor.disarm'),
    JSON.stringify({ session: 's-0000000000000000', at: Date.now() }) + '\n');

  stop(box);
  assert.equal(queued(box, 'presence.update').length, before + 1,
    'another session\'s rest is not this session\'s rest');
  assert.equal(markerBody(box), 'waiting');
});

test('a disarm sentinel nobody owns is not honoured either', () => {
  const box = joinedNtfy();
  const before = queued(box, 'presence.update').length;
  // The deliberate direction of the unattributable case. Ignoring it costs one
  // session of beating at the transport's own keepalive, which is visible and
  // recoverable; honouring it is silent and permanent, which is the defect.
  fs.writeFileSync(path.join(box.state.dir, 'monitor.disarm'), 'not json, no session, no owner\n');

  stop(box);
  assert.equal(queued(box, 'presence.update').length, before + 1);
});

test('a PREVIOUS session\'s posting_stopped latch does not silence this one', () => {
  const box = joinedNtfy();
  const before = queued(box, 'presence.update').length;
  // session.json is rewritten whole whenever the id differs [C lib/state.js:434],
  // so `session` on it names the session that latched. A latch from a session
  // that is over is not "posting has stopped for the rest of the session".
  fs.writeFileSync(box.state.files.session, JSON.stringify({
    session: 's-1111111111111111', reported: {}, posting_stopped: { ntfy: true }, counts: {}, at: Date.now(),
  }));

  stop(box);
  assert.equal(queued(box, 'presence.update').length, before + 1, 'a stale latch is not this session\'s latch');
});

test('`handshake rest` disarms the session that ran it - and no session after it', () => {
  const box = joinedNtfy();

  // The REAL command, run as this session: `rest` writes both switches at once
  // - the disarm sentinel and the section 10.2 latch [C bin/handshake.js:1841-1846]
  // - so this one call exercises both gates through the code that ships.
  const r = cli(box, ['rest'], '', { HANDSHAKE_SESSION_ID: SESSION });
  assert.equal(r.code, 0, r.err);
  const sentinel = path.join(box.state.dir, 'monitor.disarm');
  assert.equal(JSON.parse(fs.readFileSync(sentinel, 'utf8')).session,
    stateLib.State.sessionId(SESSION), 'rest stamps the sentinel with the session that rested');

  const rested = queued(box, 'presence.update').length;
  stop(box);
  assert.equal(queued(box, 'presence.update').length, rested, 'resting means resting, in the session that rested');
  assert.equal(markerBody(box), null);

  // A NEW session in the same project, sharing the same state dir. Both files
  // are still there - nothing removes them mid-session - and both belong to a
  // session that is over.
  const NEXT = 'sess-stop-next';
  beParent(box, NEXT);
  stop(box, { payload: { sessionId: NEXT } });
  assert.equal(queued(box, 'presence.update').length, rested + 1,
    'the next session gets its heartbeat back');
  assert.ok(fs.existsSync(sentinel), 'and the Stop hook never deletes the sentinel to get it');
});

// ---------------------------------------------------------- and it is swept --

// The belt to the Stop hook's braces. `rest` is a per-session switch, so the
// sentinel dies with the session that armed it, exactly like monitor.alive
// [C hooks/session-end.js:30]. SessionEnd is best-effort (20 of 21 [S4]), which
// is why the scoping above still has to hold on its own.

function sessionEnd(box, opts) {
  const o = opts || {};
  const r = spawnSync(process.execPath, [path.join(HOOKS, 'session-end.js'), 'SessionEnd'], {
    input: JSON.stringify(Object.assign({
      hookEventName: 'SessionEnd', sessionId: SESSION, workingDirectory: box.project, reason: 'clear',
    }, o.payload || {})),
    encoding: 'utf8', cwd: box.project, timeout: 30000,
    env: baseEnv(Object.assign({ HANDSHAKE_STATE_DIR: box.data }, o.env || {})),
  });
  assert.equal(r.status, 0, 'a hook exits 0 always; stderr: ' + r.stderr);
  return r;
}

test('SessionEnd sweeps THIS session\'s disarm sentinel, and only this session\'s', () => {
  const box = joinedNtfy();
  const sentinel = path.join(box.state.dir, 'monitor.disarm');

  // A subagent's SessionEnd must not re-arm its parent's heartbeat: unlike
  // monitor.alive, this file is not self-healing, so the sweep sits after the
  // child check [C hooks/session-end.js].
  fs.writeFileSync(sentinel, JSON.stringify({ session: SESSION, at: Date.now() }) + '\n');
  sessionEnd(box, { payload: { agent_id: 'agent-1', agent_type: 'general-purpose' } });
  assert.equal(fs.existsSync(sentinel), true, 'a child sweeps nothing');

  // Another parent session in the same project shares this state dir; deleting
  // its disarm would start beating for a session that deliberately stopped.
  fs.writeFileSync(sentinel, JSON.stringify({ session: 's-2222222222222222', at: Date.now() }) + '\n');
  sessionEnd(box);
  assert.equal(fs.existsSync(sentinel), true, 'another session\'s rest survives this session\'s end');

  fs.writeFileSync(sentinel, JSON.stringify({ session: SESSION, at: Date.now() }) + '\n');
  sessionEnd(box);
  assert.equal(fs.existsSync(sentinel), false, 'this session\'s rest ends with this session');
});

// =========================================== the founder is a member too =====

// SECURITY.md 5.4's non-member-commit check compares a shard's last committer
// against the member emails RECORDED AT JOIN. The founder never joins - `init`
// is their join - so a founder whose email is never recorded makes the check
// inert for the one member who is always present: every shard they write comes
// back `no_recorded_email_for_member` [C lib/workspace-files.js:428].

function gitProject() {
  const root = fs.realpathSync.native(tmpDir('hs-stop-git-' + (n++) + '-'));
  const box = { project: path.join(root, 'project'), data: path.join(root, 'data') };
  fs.mkdirSync(box.project, { recursive: true });
  const g = (...a) => spawnSync('git', ['-C', box.project].concat(a), { encoding: 'utf8', windowsHide: true });
  g('init', '-q');
  g('config', 'user.email', 'founder@example.com');
  g('config', 'user.name', 'Founder');
  g('config', 'commit.gpgsign', 'false');
  // No remote: with no GitHub slug the private-repo guard never shells out to
  // `gh`, which keeps this hermetic [C test/cli.test.js gitSandbox].
  return box;
}

test('init records the founder\'s own git email, the way join records a joiner\'s', () => {
  const box = gitProject();
  const r = cli(box, ['init', '--ntfy', DEAD_ENDPOINT, '--name', 'acme app', '--as', 'alice']);
  assert.equal(r.code, 0, r.err);
  const ws = JSON.parse(cli(box, ['status', '--json']).out).workspace.ws;
  const cfg = JSON.parse(fs.readFileSync(path.join(box.data, ws, 'state.json'), 'utf8'));

  assert.equal(cfg.git_email, 'founder@example.com', 'the local git identity is read at init');
  assert.deepEqual(cfg.member_emails, { alice: 'founder@example.com' },
    'and it is recorded AGAINST THE MEMBER ID - the only form checkShardAuthors reads');
});

test('both founder sites do what join does: announce the derived name, record the email', () => {
  // `init` is driven end to end above and below; `deploy-relay` reaches the same
  // two lines only behind a mock wrangler runner and a mock fetch that live in
  // test/deploy.test.js, so the second site is held to the invariant instead of
  // re-staged here: wherever the founder's name is DERIVED it is announced, and
  // wherever the founder's git email is READ it is recorded.
  const src = fs.readFileSync(CLI, 'utf8').split('\n');
  // A window, not adjacency: each site carries its own citation comment.
  const near = (i, needle) => src.slice(i, i + 14).some((l) => l.includes(needle));

  const derives = src.map((l, i) => [l, i]).filter(([l]) => /=\s*asFlag\s*\|\|\s*defaultMemberName\(\)/.test(l));
  assert.equal(derives.length, 2, 'exactly two founder sites derive a name: init and deploy-relay');
  for (const [, i] of derives) {
    assert.ok(near(i, "out('member name: "), 'a derived member name is announced at line ' + (i + 1));
  }

  const reads = src.map((l, i) => [l, i]).filter(([l]) => l.includes('repoLib.localGitEmail('));
  assert.equal(reads.length, 3, 'three sites read the local git email: init, join, deploy-relay');
  for (const [, i] of reads) {
    assert.ok(near(i, 'wsFiles.recordMemberEmail('),
      'a git email that is read is recorded against the member at line ' + (i + 1));
  }
});

// ============================================ the name that goes on the wire ==

test('init announces a member name derived from the machine username, and only then', () => {
  // docs/SECURITY.md 9 is about what the PROTOCOL carries; with --as absent the
  // member name is os.userInfo().username [C bin/handshake.js:389-394] and it
  // goes out as ws.join's `member_name` [C lib/envelope.js:241] and then, on
  // ntfy, as `from.member` on every later envelope [C lib/envelope.js:201-202].
  // Deriving it is fine.
  // Deriving it silently is what made the doc read as a promise it could not keep.
  const a = tmpDir('hs-stop-name-a-' + (n++) + '-');
  const boxA = { project: path.join(a, 'project'), data: path.join(a, 'data') };
  fs.mkdirSync(boxA.project, { recursive: true });
  const r = cli(boxA, ['init', '--ntfy', DEAD_ENDPOINT, '--name', 'acme app', '--no-repo']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^member name: \S.*machine's username/m, 'the derived name is shown before anything is sent');
  const shown = (r.out.match(/^member name: (.+?)\s\s/m) || [])[1];
  const cfgWs = JSON.parse(cli(boxA, ['status', '--json']).out).workspace;
  assert.equal(shown, cfgWs.member_name, 'and it is the name that was actually taken');

  const b = tmpDir('hs-stop-name-b-' + (n++) + '-');
  const boxB = { project: path.join(b, 'project'), data: path.join(b, 'data') };
  fs.mkdirSync(boxB.project, { recursive: true });
  const named = cli(boxB, ['init', '--ntfy', DEAD_ENDPOINT, '--name', 'acme app', '--no-repo', '--as', 'alice']);
  assert.equal(named.code, 0, named.err);
  assert.equal(/member name:/.test(named.out), false, 'nothing was derived, so there is nothing to announce');
});

// ============================================================== the wiring ===

test('outside a handshake workspace the Stop hook is a no-op', () => {
  const bare = tmpDir('hs-stop-bare-');
  const r = spawnSync(process.execPath, [STOP, 'Stop'], {
    input: JSON.stringify({ hookEventName: 'Stop', sessionId: SESSION, workingDirectory: bare }),
    encoding: 'utf8', cwd: bare, timeout: 20000,
    env: baseEnv({ HANDSHAKE_STATE_DIR: path.join(bare, 'data') }),
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('hooks.json registers Stop, async, in the exec form section 8 requires', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(HOOKS, 'hooks.json'), 'utf8'));
  assert.deepEqual(Object.keys(cfg.hooks).sort(),
    ['PostToolUse', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit'],
    'the registered set, with Stop now among it - the beat half of the section 8 MUST');
  const h = cfg.hooks.Stop[0].hooks[0];
  assert.equal(h.type, 'command');
  // Exec form with the plugin-root variable, exactly like its neighbours; a
  // shell-form command would be interpreted differently per platform.
  assert.equal(h.command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/stop.js" Stop');
  // ASYNC by deliberate choice: the beat spawns the CLI, and a Stop hook the
  // user waits on would charge every turn ending for a transport round trip.
  // Nothing downstream reads its result, so there is nothing to wait for.
  assert.equal(h.async, true, 'Stop must never make the user wait');
  assert.equal(cfg.hooks.Stop[0].matcher, undefined, 'Stop takes no matcher');
  assert.ok(fs.existsSync(STOP));
  // SubagentStop is deliberately NOT registered: section 7.2 rule 1 means a
  // subagent has nothing to post, so the cheapest correct handling of it is to
  // never spawn the interpreter at all.
  assert.equal(cfg.hooks.SubagentStop, undefined);
});

test('the Stop hook writes nothing to stdout, and takes the monitor\'s own beat', () => {
  // Comments discuss stdout at length; only code counts [C test/hooks.test.js].
  const code = fs.readFileSync(STOP, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(!/process\.stdout\.write|console\.log/.test(code), 'no stdout in the Stop hook');
  // A second copy of the beat would drift from the monitor's on the fold, the
  // push delta or the local renewal, and only be caught in production.
  assert.match(code, /require\('\.\.\/monitors\/heartbeat'\)/,
    'the fallback imports the monitor\'s beat rather than reimplementing it');
  assert.equal(typeof require('../monitors/heartbeat').beat, 'function',
    'and monitors/heartbeat.js exports it');

  // The budget must be handed to the WORK, not only to the killer. What the
  // beat then does with a deadline is executed rather than described
  // [C test/heartbeat.test.js, the budget]; what cannot be observed from
  // outside this process is that the two numbers are the SAME one - a hook
  // whose watchdog and whose beat disagree is exactly the defect (9.5 s of
  // budget handed to 16 s of work), and it is invisible on the clock because
  // both spellings exit at the watchdog.
  assert.match(code, /armSafety\(BUDGET_MS\)/, 'the watchdog is armed from the budget');
  assert.match(code, /H\.beat\(.*deadline: ARMED_AT \+ BUDGET_MS/,
    'and the same budget is handed to the beat as a deadline');
});

test('cmdPresence\'s own usage line and USAGE name the same flags', () => {
  // Parked here with the other bin/handshake.js source invariant above: the
  // presence command is this file's subject, and `--reason` is the flag the
  // fallback's own `tooling_broken` beat would use.
  //
  // Two spellings of one command's flags is how a real flag goes missing from
  // the message written FOR the person who just got the command wrong: USAGE
  // gained `--reason`, cmdPresence's error string did not, and a user reading
  // the error was told a flag the parser accepts does not exist.
  const src = fs.readFileSync(CLI, 'utf8');
  const errLine = (src.match(/usage: handshake presence [^']*/) || [])[0];
  const usageLine = (src.match(/' {2}presence {2}[^']*'/) || [])[0];
  assert.ok(errLine && usageLine, 'both spellings are still findable');
  const flags = (s) => (s.match(/--[a-z-]+/g) || []).slice().sort();
  assert.deepEqual(flags(errLine), flags(usageLine),
    'the error a user sees names every flag `handshake help` does');
});
