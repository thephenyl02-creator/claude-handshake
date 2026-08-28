#!/usr/bin/env node
'use strict';
// claude-handshake M6: Stop - the heartbeat fallback.
//
// ASYNC, 10 s budget. PROTOCOL section 8 closes with a MUST that had no
// implementation: "Monitors do not start in headless or subagent sessions
// [S5]; a host without monitors MUST fall back to heartbeating on the Stop
// hook and MUST say so in `/handshake status` (section 10.2)." The saying-so
// half shipped [C bin/handshake.js:1239]; this file is the beating half.
//
// The same section says the heartbeat rides the MONITOR's clock, never tool
// cadence [S7]. That is not in tension with this hook, it is the reason for
// every gate below: a Stop hook that posted once per turn would be the
// rate-limit amplifier section 10.2 exists to prevent, and turn cadence is at
// least as bursty as tool cadence. So this hook is the monitor's clock,
// re-implemented for a process that only wakes at turn boundaries - it beats
// AT MOST at the transport's keepalive (60 s relay / 600 s ntfy) and usually
// does nothing at all.
//
// The one thing a hook cannot inherit from the monitor is memory: the monitor
// holds `lastBeat`/`lastState` in a variable because it is one long-lived
// process, and this is a fresh process every turn. Both live in the
// `stop.beat` sentinel instead, in the idiom this codebase already uses for
// cross-process timing [C hooks/common.js SENTINELS, POSTTOOL_GATE_MS]: mtime
// is the timestamp, and the body is the presence state that beat asserted.
//
// The beat itself is monitors/heartbeat.js's own `beat()`, imported rather
// than copied. Requiring that module starts nothing - main() sits behind
// `require.main === module`, a property test/heartbeat.test.js asserts at load
// time.
//
// This hook writes NOTHING to stdout. A Stop hook's stdout is transcript-only,
// but a JSON object on it is read as a decision that can BLOCK the stop, so
// silence here is not merely tidy (PROTOCOL section 8: nothing on stdout
// except a designed injection).

const C = require('./common');
const H = require('../monitors/heartbeat');

C.armSafety(9500);

C.readPayload((ctx) => { run(C.fields(ctx)).catch(() => C.done()); });

async function run(f) {
  const found = C.resolveWorkspace(f.cwd);
  if (!found) return C.done();                       // sub-10 ms no-op, section 8
  const state = C.openState(found.ws);
  if (!state) return C.done();

  // ---- 1. a live monitor owns the clock ------------------------------------
  // This is a FALLBACK. Beating alongside a running monitor would double the
  // post rate on the one transport whose cadence the protocol pins. Liveness
  // is decided by lib/session.js, the module that already defines what "a
  // monitor is running" means for section 7.1 - re-deriving it here would let
  // the two answers drift apart.
  const sessionLib = C.lib('session.js');
  if (!sessionLib) return C.done();
  if (sessionLib.monitorAlive(C.sentinel(state, 'monitorAlive'))) return C.done();

  // ---- 2. the disarm sentinel --------------------------------------------
  // `handshake rest` stops broadcasting for the session, and the sentinel file
  // is the ONLY mid-session disarm the monitor contract allows [S5]. A
  // fallback that kept posting through `rest` would make the command a lie in
  // exactly the sessions that have no monitor to obey it.
  if (C.ageMs(C.sentinel(state, 'monitorDisarm')) !== null) return C.done();

  // ---- 3. section 7.2 rule 1: a child never posts --------------------------
  // Same verdict every other hook uses. It matters more here than anywhere
  // else: Stop fires once per agent turn, so a subagent tree that failed this
  // check would put one presence post per agent per turn on the wire.
  const child = C.isChild(state, f);
  if (child.child) return C.done();

  const cfg = state.read();
  const transport = C.transportOf(found, cfg);
  const K = C.keepaliveSeconds(transport) * 1000;    // 60 s relay / 600 s ntfy

  // ---- 4. section 10.2: the posting_stopped latch --------------------------
  // Once posting has stopped on this transport for the session it stays
  // stopped. Spawning the CLI to be refused every turn is the retry loop that
  // rule forbids.
  const stateLib = C.lib('state.js');
  if (stateLib) {
    const s = stateLib.readJsonFile(state.files.session, null);
    if (s && s.posting_stopped && s.posting_stopped[transport]) return C.done();
  }

  // ---- 5. the cadence gate, the monitor's own `due` -----------------------
  // Derived from the marker instead of from memory. An absent marker is
  // infinitely old [C hooks/common.js ageMs], which lines up with the
  // monitor's `lastBeat = 0` start: relay's `now - lastBeat >= K` is true at 0,
  // and ntfy's first-beat clause fires explicitly.
  const mark = C.sentinel(state, 'stopBeat');
  const age = C.ageMs(mark);
  const desired = C.isFresh(C.sentinel(state, 'activity'), 2.5 * K) ? 'working' : 'waiting';
  const last = lastStateOf(mark);
  const stateChanged = last !== null && desired !== last;
  const due = transport === 'relay'
    ? (age === null || age >= K)
    : (age === null || stateChanged || age >= K);
  if (!due) return C.done();

  // The marker is stamped BEFORE the beat, not after. The monitor can set
  // lastBeat afterwards because a `busy` flag holds the next tick off while one
  // beat is in flight; separate processes have no such flag, so two turns
  // landing close together would both find the marker stale and both post.
  // Stamping first costs at most one skipped window when the beat fails - which
  // is what the monitor's own catch does anyway ("silent, and no retry storm").
  C.touch(mark, desired + '\n');

  // The monitor's real beat: fold the agent tree's touched files, push the
  // delta, then renew presence. Section 10.1 - a transport failure here is
  // silent by design, and armSafety() bounds the whole thing regardless.
  try {
    await H.beat(state, found, desired);
  } catch (_) { /* never fail the turn this hook observes */ }
  C.done();
}

// The presence state the last beat asserted, or null when the marker is absent
// or unreadable. Only ntfy's state-change clause consumes it, and an
// unreadable marker degrades to "no change", i.e. toward beating less.
function lastStateOf(file) {
  const fs = require('fs');
  try {
    const v = fs.readFileSync(file, 'utf8').trim();
    return v.length ? v : null;
  } catch (_) { return null; }
}
