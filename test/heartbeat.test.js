'use strict';
// claude-handshake M6: the monitor's fold/push logic, executed rather than
// described.
//
// PROTOCOL section 7.2 rule 3 - "the parent's next heartbeat carries the
// union" - is the one child rule whose PARENT half nothing exercised:
// test/hooks.test.js proves the child appends upward and stops there, and the
// e2e legs stop at the same child write. Everything below drives the real
// state layer (lib/state.js), not a stand-in, because the union, the cap and
// the pushed-files bookkeeping are all statements ABOUT that file's on-disk
// shape.
//
// The second reason this file exists: monitors/heartbeat.js is started as a
// script by the host [C monitors/monitors.json], so it may only be requirable
// if requiring it starts nothing. That property is itself under test here -
// a monitor that silently stops beating is far worse than an untested fold.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const St = require('../lib/state');

const ROOT = path.join(__dirname, '..');
const MONITOR = path.join(ROOT, 'monitors', 'heartbeat.js');
const WS = '0123456789abcdef0123456789abcdef';
const TTL = 7200;                                   // seconds; the section 3.2 default

// ------------------------------------------------- load-time guard check ----
// Deliberately at module scope, BEFORE the require below, and deliberately not
// inside a test().
//
// monitors/heartbeat.js is only requirable because main() sits behind
// `if (require.main === module)` [C monitors/heartbeat.js:196]. Delete that
// guard and require() runs main(), which - on any cwd that is not a handshake
// workspace, which is what `npm test` has - falls straight through to
// quit(), i.e. process.exit(0) [C monitors/heartbeat.js:188]. The require
// would then kill this process mid-load, and `node --test` reports the file as
// GREEN with every test in it silently missing: the failure mode that looks
// most like success. An assertion here throws at load time instead, which
// `node --test` reports as a failing file. Loud beats fast.
// Normalized: this checkout is LF, but core.autocrlf=true (the Git-for-Windows
// default, and set globally on the dev machine) gives a fresh clone CRLF, and
// there is no .gitattributes pinning it. An eol-sensitive regex here would pass
// on this machine and fail on someone else's - and on the ubuntu CI leg.
const MONITOR_SRC = fs.readFileSync(MONITOR, 'utf8').split('\r\n').join('\n');
assert.match(MONITOR_SRC, /\nif \(require\.main === module\) \{\n[\s\S]*?\n  main\(\);\n\}\n/,
  'monitors/heartbeat.js must call main() behind `if (require.main === module)`; ' +
  'without that guard, requiring it below would process.exit(0) and this whole file would ' +
  'vanish from the run without a single failure being reported');

const H = require('../monitors/heartbeat');

// Every mkdtemp in this file registers here. Without it the run leaves ~14
// state dirs behind in os.tmpdir() every time, which is how a test suite
// quietly becomes a disk leak [C test/build-plugin-zip.test.js, same pattern].
const temps = [];
after(() => {
  for (const d of temps) {
    // Unlike the zip test's dirs, one of these was the cwd of a spawned child;
    // on Windows a just-killed process can still hold it briefly. Failing to
    // delete scratch is not a test result, so it must not fail the file.
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
});

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

let counter = 0;
function tmpState() {
  const dir = tmpDir('hs-hb-' + (counter++) + '-');
  const state = St.openState(WS, { dir });
  state.ensure();
  state.write({ ws: WS, name: 'acme-api', transport: 'relay', member: 'me00', protocol: 1 });
  return state;
}

// The claim the monitor folds into: getOwnClaims() sorts by acquired_at, and
// both fold() and pendingPush() target the LAST one.
function claim(state, files, extra) {
  const now = Date.now();
  state.addOwnClaim(Object.assign({
    subject: 'api rate limiting', subject_key: 'api rate limiting',
    ttl: TTL, acquired_at: now, files: files || [],
  }, extra || {}));
  return now;
}

// Both fold() and renewLocal() re-add through state.addOwnClaim, and
// lib/state.js preserves `prev.acquired_at` on ANY re-add that matches an
// existing subject_key [C lib/state.js:340]. Reading acquired_at back off the
// STORED claim therefore holds no matter what the monitor passed - it is state
// asserting on itself. The only falsifiable statement is about the argument the
// monitor hands over, so record that instead.
function spyAddOwnClaim(state) {
  const seen = [];
  const real = state.addOwnClaim.bind(state);
  state.addOwnClaim = (c) => { seen.push(c); return real(c); };
  return seen;
}

// What hooks/post-tool-use.js writes for a child, keyed by the parent session
// id (PROTOCOL section 7.2 rule 3).
function childTouches(state, buckets) {
  state.update((s) => { s.child_touches = buckets; return s; });
}

// The test process runs inside a Claude Code session, which exports
// CLAUDE_CODE_CHILD_SESSION. Inheriting it would make the spawned monitor a
// proven child and it would exit before ever beating (heartbeat.js:33).
function baseEnv(extra) {
  const env = Object.assign({}, process.env);
  for (const k of ['CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_PROJECT_DIR']) delete env[k];
  return Object.assign(env, extra || {});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ==================================================================== fold ===

test('the parent folds every child bucket into its own claim (7.2 rule 3)', () => {
  const state = tmpState();
  const acquired = claim(state, ['src/parent.ts']);
  childTouches(state, {
    'parent-uuid-7': { files: ['src/child.ts', 'src/parent.ts'], at: Date.now() },
    'parent-uuid-8': { files: ['src/other.ts'], at: Date.now() },
  });

  const readded = spyAddOwnClaim(state);
  assert.equal(H.fold(state, Date.now()), 3, 'three distinct incoming paths across both buckets');

  const held = state.getOwnClaims()[0];
  assert.deepEqual(held.files, ['src/parent.ts', 'src/child.ts', 'src/other.ts'],
    'the union is de-duplicated and the parent\'s own paths keep their order');
  assert.equal(readded.length, 1, 'the fold re-adds the target claim exactly once');
  assert.equal(readded[0].subject_key, 'api rate limiting', 'and re-adds it under its own key');
  assert.equal(readded[0].acquired_at, acquired,
    'fold PASSES the original acquired_at - the section 5.4 tiebreak input. Asserted on the ' +
    'argument, not on state: state preserves it either way [C lib/state.js:340]');
  assert.equal(state.read().child_touches, undefined, 'the folded buckets are cleared');
});

test('fold keeps the buckets when the parent holds no claim', () => {
  const state = tmpState();
  childTouches(state, { 'parent-uuid-7': { files: ['src/child.ts'], at: Date.now() } });

  assert.equal(H.fold(state, Date.now()), 0);
  // Dropping them here would lose the child's work permanently; the parent may
  // claim later in the session and fold them then.
  assert.deepEqual(state.read().child_touches['parent-uuid-7'].files, ['src/child.ts']);
});

test('fold is a no-op with no child_touches and ignores a non-object bucket map', () => {
  const state = tmpState();
  claim(state, ['src/parent.ts']);
  assert.equal(H.fold(state, Date.now()), 0);

  // child_touches arrives from a JSON file on disk, so its shape is not a
  // given: an array passes a bare `typeof x === 'object'` check, and only the
  // Array.isArray() half of the guard rejects it [C monitors/heartbeat.js:120].
  //
  // The buckets below are deliberately WELL-FORMED - Object.keys() on an array
  // yields '0', '1', so with the guard removed fold() would happily read
  // .files off each element, union them in and return 2. A fixture of bare
  // strings (what this test used to carry) yields 0 with or without the guard,
  // which pins nothing.
  state.update((s) => {
    s.child_touches = [
      { files: ['src/child.ts'], at: Date.now() },
      { files: ['src/other.ts'], at: Date.now() },
    ];
    return s;
  });
  assert.equal(H.fold(state, Date.now()), 0, 'rejected on shape, not by the fixture being empty');
  assert.deepEqual(state.getOwnClaims()[0].files, ['src/parent.ts'], 'the claim is untouched');
});

test('the folded union is capped at 64 files (PROTOCOL 2.5)', () => {
  const state = tmpState();
  assert.equal(H.MAX_FILES, 64, 'the cap the protocol table states for files per claim');

  const own = Array.from({ length: 40 }, (_, i) => 'src/own' + i + '.ts');
  const kid = Array.from({ length: 40 }, (_, i) => 'src/kid' + i + '.ts');
  claim(state, own);
  childTouches(state, { 'parent-uuid-7': { files: kid, at: Date.now() } });

  H.fold(state, Date.now());
  const files = state.getOwnClaims()[0].files;
  assert.equal(files.length, 64);
  // slice(-64) keeps the tail, so the 16 oldest of the parent's own paths are
  // what falls off - the newest footprint is the useful one.
  assert.equal(files[0], 'src/own16.ts');
  assert.equal(files[63], 'src/kid39.ts');
});

// ============================================================= pendingPush ===

test('pendingPush offers only what peers have not been told about', () => {
  const state = tmpState();
  claim(state, ['src/a.ts', 'src/b.ts', 'src/c.ts']);
  state.update((s) => { s.pushed_files = { 'api rate limiting': ['src/a.ts'] }; return s; });

  const push = H.pendingPush(state, Date.now());
  assert.equal(push.subject, 'api rate limiting');
  assert.equal(push.subject_key, 'api rate limiting');
  assert.deepEqual(push.delta, ['src/b.ts', 'src/c.ts'], 'only the delta is posted');
  assert.deepEqual(push.all, ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    'but the FULL set is what gets marked pushed once the post succeeds');
});

test('pendingPush is null with nothing claimed, no files, or nothing new', () => {
  const state = tmpState();
  assert.equal(H.pendingPush(state, Date.now()), null, 'no claim');

  claim(state, []);
  assert.equal(H.pendingPush(state, Date.now()), null, 'a claim with an empty footprint');

  claim(state, ['src/a.ts']);
  state.update((s) => { s.pushed_files = { 'api rate limiting': ['src/a.ts'] }; return s; });
  assert.equal(H.pendingPush(state, Date.now()), null, 'everything already pushed');
});

test('pendingPush ignores a claim that has expired', () => {
  const state = tmpState();
  claim(state, ['src/a.ts']);
  // Section 5.3 expiry test: renewed_at + ttl*1000 <= now.
  assert.equal(H.pendingPush(state, Date.now() + (TTL + 1) * 1000), null);
});

test('the push delta itself is bounded by the 64-file cap', () => {
  const state = tmpState();
  const many = Array.from({ length: 80 }, (_, i) => 'src/f' + i + '.ts');
  // The claim is written directly: addOwnClaim stores what it is given, and
  // an over-long files[] can reach state from a resurrected peer claim.
  claim(state, many);

  const push = H.pendingPush(state, Date.now());
  assert.equal(push.delta.length, 64, 'one `change --change files` call never carries more than the cap');
  assert.equal(push.all.length, 80, 'the local record is not truncated by the push decision');
});

// ============================================================== markPushed ===

test('markPushed closes the loop: the same files are not offered twice', () => {
  const state = tmpState();
  claim(state, ['src/a.ts', 'src/b.ts']);

  const push = H.pendingPush(state, Date.now());
  H.markPushed(state, push.subject_key, push.all);
  assert.deepEqual(state.read().pushed_files['api rate limiting'], ['src/a.ts', 'src/b.ts']);
  assert.equal(H.pendingPush(state, Date.now()), null);

  // A later append is the only thing that reopens it.
  claim(state, ['src/a.ts', 'src/b.ts', 'src/c.ts']);
  assert.deepEqual(H.pendingPush(state, Date.now()).delta, ['src/c.ts']);
});

test('markPushed keeps its own bookkeeping under the 64-file cap', () => {
  const state = tmpState();
  H.markPushed(state, 'api rate limiting', Array.from({ length: 80 }, (_, i) => 'src/f' + i + '.ts'));

  const pushed = state.read().pushed_files['api rate limiting'];
  assert.equal(pushed.length, 64);
  assert.equal(pushed[0], 'src/f16.ts', 'the tail is kept, matching the claim\'s own cap');
});

test('markPushed does not clobber another subject\'s record', () => {
  const state = tmpState();
  state.update((s) => { s.pushed_files = { 'onboarding flow': ['src/x.ts'] }; return s; });
  H.markPushed(state, 'api rate limiting', ['src/a.ts']);

  assert.deepEqual(state.read().pushed_files, {
    'onboarding flow': ['src/x.ts'],
    'api rate limiting': ['src/a.ts'],
  });
});

// ============================================================== renewLocal ===

test('renewLocal moves renewed_at so a live claim does not self-expire', () => {
  const state = tmpState();
  const acquired = claim(state, ['src/a.ts']);
  // A claim heartbeating along happily, 100 s short of its TTL.
  const stale = Date.now() - (TTL - 100) * 1000;
  state.update((s) => { s.own_claims[0].renewed_at = stale; return s; });

  const soon = Date.now() + 200 * 1000;
  assert.equal(state.getOwnClaims(soon).length, 0, 'without a renewal it is gone 200 s from now');

  const readded = spyAddOwnClaim(state);
  H.renewLocal(state, Date.now());
  const held = state.getOwnClaims(soon);
  assert.equal(held.length, 1, 'the renewal carries it past that horizon');
  assert.ok(held[0].renewed_at > stale);
  assert.equal(readded.length, 1, 'one re-add per held claim');
  assert.equal(readded[0].acquired_at, acquired,
    'renewLocal CARRIES the original acquired_at forward rather than restamping it. Asserted ' +
    'on the argument: the stored value is preserved regardless [C lib/state.js:340]');
  assert.deepEqual(held[0].files, ['src/a.ts'], 'and the folded footprint survives the renewal');
});

test('renewLocal never throws, and renews every held claim', () => {
  const state = tmpState();
  H.renewLocal(state, Date.now());                    // nothing claimed at all

  claim(state, ['src/a.ts']);
  claim(state, ['src/b.ts'], { subject: 'onboarding flow', subject_key: 'onboarding flow' });
  const before = state.getOwnClaims().map((c) => c.renewed_at);
  H.renewLocal(state, Date.now());
  const after = state.getOwnClaims().map((c) => c.renewed_at);
  assert.equal(after.length, 2);
  for (let i = 0; i < after.length; i++) assert.ok(after[i] >= before[i]);
});

// ================================================================= disarm ====
//
// `handshake rest` writes monitor.disarm and NOTHING on the posting path ever
// removes it, so the monitor's read of that file decides whether one `rest`
// disarms one session or every session the workspace will ever have. It read it
// with a bare existence check, which made it the latter - and because this is
// the PRIMARY heartbeat, that took presence down outright rather than only the
// Stop-hook fallback [C hooks/stop.js]. The two rules below are the fix, in the
// order the monitor applies them.

const OWNER = St.State.sessionId('sess-hb-disarm');

function disarmFile(body, ageMs) {
  const dir = tmpDir('hs-hb-disarm-');
  const file = path.join(dir, 'monitor.disarm');
  fs.writeFileSync(file, body);
  if (ageMs) { const t = new Date(Date.now() - ageMs); fs.utimesSync(file, t, t); }
  return file;
}

test('rule 1: the monitor obeys its OWN disarm and ignores another session\'s', () => {
  const mine = new Set(['sess-hb-disarm', OWNER]);
  const startedAt = Date.now() - 60000;

  assert.equal(H.disarmedHere(path.join(tmpDir('hs-hb-none-'), 'nope'), mine, startedAt), false,
    'an absent sentinel is nothing to obey');

  const own = disarmFile(JSON.stringify({ session: OWNER, at: Date.now() }));
  assert.equal(H.disarmedHere(own, mine, startedAt), true, '`rest` still stops the session that ran it');

  // The whole defect, as one assertion: a sentinel left behind by a session
  // that is over, sitting in the shared state dir, mtime irrelevant.
  const theirs = disarmFile(JSON.stringify({ session: 's-1111111111111111', at: Date.now() }));
  assert.equal(H.disarmedHere(theirs, mine, startedAt), false,
    'another session\'s disarm is not this session\'s, however recently it was written');
});

test('rule 2: with no identity to compare, the monitor\'s own start time decides', () => {
  // A host that exports none of the three session variables gives the monitor
  // an EMPTY identity set - it has no payload to fall back on, unlike a hook
  // [C monitors/monitors.json]. Ownership cannot answer, so lifetime does: a
  // monitor's lifetime is its session's lifetime [S5].
  const none = new Set();
  const startedAt = Date.now() - 60000;

  const old = disarmFile('not json, no session, no owner\n', 120000);
  assert.equal(H.disarmedHere(old, none, startedAt), false,
    'written before this monitor existed, so it belongs to a session that is over');

  const fresh = disarmFile('not json, no session, no owner\n');
  assert.equal(H.disarmedHere(fresh, none, startedAt), true,
    'written while this monitor was running, so `rest` still means rest');

  // Same fallback when the record names an owner but this process has no
  // identity at all to weigh it against.
  const stamped = disarmFile(JSON.stringify({ session: 's-1111111111111111', at: Date.now() }), 120000);
  assert.equal(H.disarmedHere(stamped, none, startedAt), false);

  // And an unreadable record does NOT get the ownership branch even when the
  // monitor does have an identity: nobody owns it, so lifetime decides.
  assert.equal(H.disarmedHere(old, new Set(['sess-hb-disarm', OWNER]), startedAt), false);
});

test('the two rules compose: a sentinel bearing MY id, older than me, is a leftover', () => {
  // Session ids are not guaranteed distinct across sessions. HANDSHAKE_SESSION_ID
  // is read straight out of the environment [C bin/handshake.js:135], so any
  // setup that PINS it rather than minting one per session - the e2e members do
  // exactly that [C e2e/lib/members.js:112] - hands consecutive sessions the
  // same id.
  //
  // Ownership alone cannot tell those apart, and it used to be asked first and
  // trusted alone: one `rest`, plus the one SessionEnd sweep in twenty-one that
  // does not fire [S4], left a sentinel stamped with THIS id that every later
  // monitor obeyed on its first poll - the permanent, silent disarm the whole
  // gate exists to close, back through the front door. A monitor's lifetime IS
  // its session's lifetime [S5], so the sentinel has to be younger than the
  // process reading it whatever name is on it.
  const mine = new Set(['sess-hb-disarm', OWNER]);
  const startedAt = Date.now() - 60000;

  const stale = disarmFile(JSON.stringify({ session: OWNER, at: Date.now() }), 120000);
  assert.equal(H.disarmedHere(stale, mine, startedAt), false,
    'written before this monitor existed: the session that rested is over, id reuse or not');

  // The cost of the extra conjunct is nil in the case that matters: `rest` is
  // typed by a human into a session whose monitor has been running since it
  // started, so its sentinel is always the younger of the two.
  const fresh = disarmFile(JSON.stringify({ session: OWNER, at: Date.now() }));
  assert.equal(H.disarmedHere(fresh, mine, startedAt), true, 'and a live `rest` still means rest');
});

// ================================================= the section 10.2 latch ====
//
// The monitor's OTHER unscoped read of a per-session record: session.json's
// posting_stopped. Taken bare, a previous session's auth failure kept the
// primary heartbeat silent in every later session - the same shape as the
// disarm above, minus the disarm's permanence (the CLI relatches per session).
//
// "Did it beat?" is answered by a file on disk, not a mock: the endpoint is the
// discard port, so a beat that happens lands in the OFFLINE queue with no
// network anywhere [C test/stop-hook.test.js, same device].

const CLI = path.join(ROOT, 'bin', 'handshake.js');
const DEAD_ENDPOINT = 'http://127.0.0.1:9';         // discard port: always refused
const BEATER = 'sess-hb-beat';

function joinedNtfy() {
  const root = tmpDir('hs-hb-ntfy-');
  const box = { project: path.join(root, 'project'), data: path.join(root, 'data') };
  fs.mkdirSync(box.project, { recursive: true });
  const run = (args, stdin) => spawnSync(process.execPath, [CLI].concat(args), {
    cwd: box.project, input: stdin === undefined ? '' : stdin, encoding: 'utf8', timeout: 30000,
    env: baseEnv({ HANDSHAKE_STATE_DIR: box.data, HANDSHAKE_SKIP_HOST_CHECKS: '1', HANDSHAKE_SESSION_ID: BEATER }),
  });
  run(['init', '--ntfy', DEAD_ENDPOINT, '--name', 'acme app']);
  const blob = run(['invite', '--inline']).stdout.trim().split('\n').pop().trim();
  assert.match(blob, /^hsi1_/, 'the fixture needs a real invite blob');
  run(['join', blob, '--as', 'tester'], 'y\n');
  box.ws = JSON.parse(run(['status', '--json']).stdout).workspace.ws;
  box.state = St.openState(box.ws, { env: { HANDSHAKE_STATE_DIR: box.data } });
  return box;
}

function queuedPresence(box) {
  try {
    const q = JSON.parse(fs.readFileSync(path.join(box.data, box.ws, 'queue.json'), 'utf8'));
    return (q.entries || []).filter((e) => e.envelope && e.envelope.type === 'presence.update').length;
  } catch (_) { return 0; }
}

function latch(box, session) {
  fs.writeFileSync(box.state.files.session, JSON.stringify({
    session, reported: {}, posting_stopped: { ntfy: { code: 'auth', at: Date.now() } },
    counts: {}, at: Date.now(),
  }));
}

async function runMonitorOnce(box, waitFor) {
  const child = spawn(process.execPath, [MONITOR], {
    cwd: box.project, stdio: 'ignore',
    env: baseEnv({ HANDSHAKE_STATE_DIR: box.data, HANDSHAKE_SESSION_ID: BEATER }),
  });
  try {
    let waited = 0;
    while (waited < waitFor) { if (queuedPresence(box) > 0) break; await sleep(200); waited += 200; }
  } finally {
    try { child.kill(); } catch (_) { /* already gone */ }
    await sleep(200);
  }
}

test('a PREVIOUS session\'s posting_stopped latch does not silence the monitor', async () => {
  const box = joinedNtfy();
  // session.json is rewritten whole whenever the id differs [C lib/state.js:434],
  // so `session` on it names the session that latched. A latch from a session
  // that is over is not "posting has stopped for the rest of the session".
  latch(box, St.State.sessionId('sess-hb-earlier'));
  assert.equal(queuedPresence(box), 0, 'the fixture starts with nothing on the wire');

  await runMonitorOnce(box, 20000);
  assert.ok(queuedPresence(box) > 0,
    'the primary heartbeat beats: a stale latch is not this session\'s latch');
});

test('this session\'s own posting_stopped latch does silence the monitor', async () => {
  const box = joinedNtfy();
  latch(box, St.State.sessionId(BEATER));

  // The beat rides the FIRST tick, which runs immediately [C monitors/heartbeat.js
  // main()] - the positive case above lands inside two seconds. A full poll
  // window of silence is the negative, without paying for three of them.
  await runMonitorOnce(box, H.POLL_MS);
  assert.equal(queuedPresence(box), 0,
    'section 10.2: once posting has stopped for THIS session it stays stopped');
});

// ============================================================ the budget =====
//
// beat() spawns up to two CLI calls at CLI_TIMEOUT_MS each - up to 16 s - and
// hooks/stop.js runs it under a 9.5 s watchdog [C hooks/stop.js BUDGET_MS]. On
// a transport that accepts a connection and never answers, that watchdog used
// to fire in the middle of the SECOND call: the delta push burnt the budget and
// the presence post - the one thing the section 8 fallback exists to send -
// reached nothing, not even the offline queue, with the cadence marker already
// stamped and the window therefore burnt. Two changes close it, and both are
// stated here: presence goes first, and each spawn is sized to what is left of
// the caller's deadline rather than to a constant that can outlast it.
//
// The observables are an ORDER and a TIMEOUT, and a timeout leaves no trace on
// disk, so this is the one place in this file that stands in for a layer: the
// single seam beat() shells out through [C hooks/common.js runCli]. What those
// two calls actually DO is proved against the real CLI and the real offline
// queue instead, through the real hook [C test/stop-hook.test.js].
const C = require('../hooks/common');

// `spend` is how long the stubbed CLI takes, i.e. how much of its slice a real
// call would eat before the next one is sized.
async function beatCalls(opts, spend) {
  const state = tmpState();
  claim(state, ['src/a.ts']);                         // unpushed files: both halves have work
  const calls = [];
  const real = C.runCli;
  C.runCli = async (args, o) => {
    calls.push({ cmd: args[0], timeoutMs: o.timeoutMs });
    if (spend) await sleep(Math.min(spend, o.timeoutMs));
    return { ok: true };
  };
  let ok;
  try { ok = await H.beat(state, { root: state.dir }, 'waiting', opts); } finally { C.runCli = real; }
  return { calls, ok };
}

test('the monitor\'s own beat is unchanged: two calls, each bounded by CLI_TIMEOUT_MS', async () => {
  // The monitor has no watchdog above it and passes no deadline, so this
  // constant IS its bound - the fix for the hook must not shorten it.
  const { calls } = await beatCalls(undefined);
  assert.deepEqual(calls.map((c) => c.cmd), ['presence', 'change'],
    'presence is renewed before the delta is pushed');
  assert.deepEqual(calls.map((c) => c.timeoutMs), [H.CLI_TIMEOUT_MS, H.CLI_TIMEOUT_MS]);
});

test('beat() sizes each spawn to what is left of the caller\'s deadline', async () => {
  const { calls } = await beatCalls({ deadline: Date.now() + 1200 }, 400);
  assert.deepEqual(calls.map((c) => c.cmd), ['presence', 'change']);
  assert.ok(calls[0].timeoutMs > 0 && calls[0].timeoutMs <= 1200,
    'the first spawn takes the wall, not the 8 s constant (' + calls[0].timeoutMs + ' ms)');
  assert.ok(calls[1].timeoutMs > 0 && calls[1].timeoutMs < calls[0].timeoutMs,
    'and the second takes what the first left, so the pair fits inside one budget (' +
    calls[1].timeoutMs + ' ms)');
});

test('beat() skips a spawn it cannot pay for rather than starting one to kill it', async () => {
  // The presence post consumes the whole wall; the push is not started.
  const { calls } = await beatCalls({ deadline: Date.now() + 400 }, 400);
  assert.deepEqual(calls.map((c) => c.cmd), ['presence'],
    'the half that matters is the half that ran');

  // And with nothing left at all, nothing is spawned - a node boot paid for
  // solely to be killed is the cost this arithmetic exists to avoid.
  const spent = await beatCalls({ deadline: Date.now() - 1 });
  assert.deepEqual(spent.calls, []);
  assert.equal(spent.ok, false, 'and the caller is told no beat went out');
});

// ========================================================= module hygiene ====

test('requiring the monitor starts nothing and installs no process handlers', () => {
  // If requiring the file armed the POLL_MS interval, this child would never
  // exit and spawnSync would come back on its timeout instead of cleanly.
  const res = spawnSync(process.execPath, ['-e',
    'const b=process.listenerCount("uncaughtException")+process.listenerCount("unhandledRejection");' +
    'require(process.argv[1]);' +
    'process.stdout.write("handlers:"+(process.listenerCount("uncaughtException")+process.listenerCount("unhandledRejection")-b));',
    MONITOR], { encoding: 'utf8', timeout: 15000, env: baseEnv() });

  assert.equal(res.status, 0, 'the require returned and the process exited on its own');
  assert.equal(res.signal, null, 'not killed on the timeout, i.e. no interval was left running');
  // Exit-0-on-any-error belongs to a long-lived monitor. Installed on require,
  // it would swallow the failures of whatever host required this file.
  assert.equal(res.stdout, 'handlers:0');
  for (const fn of ['fold', 'pendingPush', 'markPushed', 'renewLocal']) {
    assert.equal(typeof H[fn], 'function', fn + ' is exported');
  }
});

test('spawned as a script the monitor still beats, and still disarms', async () => {
  const tmp = tmpDir('hs-hb-run-');
  const proj = path.join(tmp, 'proj');
  const data = path.join(tmp, 'data');
  fs.mkdirSync(path.join(proj, '.handshake'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.handshake', 'workspace.json'), JSON.stringify({
    ws: WS, name: 'acme-api', transport: 'relay', overlap_gate: 'warn', protocol: 1,
  }));
  const state = St.openState(WS, { env: { HANDSHAKE_STATE_DIR: data } });
  state.ensure();
  state.write({ ws: WS, name: 'acme-api', transport: 'relay', member: 'me00', protocol: 1 });
  // Section 10.2: once posting has stopped on this transport it stays stopped.
  // That is a real monitor state, and it is the one that lets this test run the
  // whole clock - poll, presence decision, disarm - with zero network I/O and
  // no CLI spawn.
  fs.writeFileSync(state.files.session, JSON.stringify({
    session: 's-0011223344556677', reported: {}, posting_stopped: { relay: true }, counts: {}, at: Date.now(),
  }));

  const alive = path.join(state.dir, 'monitor.alive');
  const child = spawn(process.execPath, [MONITOR], {
    cwd: proj, stdio: 'ignore', env: baseEnv({ HANDSHAKE_STATE_DIR: data }),
  });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  try {
    // The liveness sentinel is what lib/session.js reads as "a monitor is
    // running" (section 7.1); it appearing is the proof main() ran.
    let waited = 0;
    while (!fs.existsSync(alive) && waited < 10000) { await sleep(100); waited += 100; }
    assert.ok(fs.existsSync(alive), 'the monitor wrote its liveness sentinel');

    // Sentinel-file disarm is the ONLY mid-session stop the contract allows [S5].
    fs.writeFileSync(path.join(state.dir, 'monitor.disarm'), String(Date.now()));
    // Cleared either way: a live timer here would hold the runner's event loop
    // open for its full duration after the test has already passed.
    let bomb = null;
    const code = await Promise.race([exited, new Promise((r) => { bomb = setTimeout(() => r('timeout'), 3 * H.POLL_MS); })]);
    clearTimeout(bomb);
    assert.equal(code, 0, 'it exits 0 on the disarm sentinel');
    assert.ok(!fs.existsSync(alive), 'and clears the liveness sentinel on the way out');
  } finally {
    try { child.kill(); } catch (_) { /* already gone */ }
  }
});
