'use strict';
// claude-handshake M6: the Stop-hook heartbeat fallback.
//
// PROTOCOL section 8 ends with a MUST that shipped only half-built: "Monitors
// do not start in headless or subagent sessions [S5]; a host without monitors
// MUST fall back to heartbeating on the Stop hook and MUST say so in
// `/handshake status` (section 10.2)." `handshake status` said so from v0.1.0
// [C bin/handshake.js:1239] while hooks/hooks.json registered no Stop hook at
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

function cli(box, args, stdin) {
  const r = spawnSync(process.execPath, [CLI].concat(args), {
    cwd: box.project, input: stdin === undefined ? '' : stdin, encoding: 'utf8', timeout: 30000,
    env: baseEnv({ HANDSHAKE_STATE_DIR: box.data, HANDSHAKE_SKIP_HOST_CHECKS: '1' }),
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
});
