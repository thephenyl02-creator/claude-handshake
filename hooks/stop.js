#!/usr/bin/env node
'use strict';
// claude-handshake M6: Stop - the heartbeat fallback.
//
// ASYNC, 10 s budget. PROTOCOL section 8 closes with a MUST that had no
// implementation: "Monitors do not start in headless or subagent sessions
// [S5]; a host without monitors MUST fall back to heartbeating on the Stop
// hook and MUST say so in `/handshake status` (section 10.2)." The saying-so
// half shipped [C bin/handshake.js:1293]; this file is the beating half.
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

// The budget, and - this is the part that was missing - the SAME number handed
// to the work as a deadline.
//
// section 8 makes Stop async, so nothing waits on this process; the budget is
// not about the user's latency, it is about not leaving a hook process behind
// once per turn. But a budget that only KILLS is a budget the work can overrun:
// beat() spawns up to two CLI calls at 8 s each [C monitors/heartbeat.js
// CLI_TIMEOUT_MS], so on a transport that accepts a connection and never
// answers the 9.5 s watchdog fired mid-beat, and the half it truncated was the
// presence post - the one thing this fallback exists to send - with the cadence
// marker already stamped below and the window therefore burnt.
//
// Raising the budget to fit 2 x 8 s was the wrong end to pull: a 16 s hook
// process every keepalive is its own problem, and it would have to grow again
// the next time beat() grows a third call. So the beat is given the deadline
// instead and sizes each spawn to what is left of it. MARGIN_MS is the beat's
// room to return and this process's room to exit before the watchdog fires.
const ARMED_AT = Date.now();
const BUDGET_MS = 9500;
const MARGIN_MS = 500;

C.armSafety(BUDGET_MS);

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

  const stateLib = C.lib('state.js');
  const mine = C.sessionIdentities(f);

  // ---- 2. the disarm sentinel, THIS session's --------------------------------
  // `handshake rest` stops broadcasting for the session, and the sentinel file
  // is the ONLY mid-session disarm the monitor contract allows [S5]. A
  // fallback that kept posting through `rest` would make the command a lie in
  // exactly the sessions that have no monitor to obey it.
  //
  // But the sentinel is a FILE, and nothing on the posting path removes it -
  // SessionEnd sweeps it [C hooks/session-end.js], and SessionEnd is
  // best-effort (20 of 21 [S4]), so the scoping has to hold on its own. The
  // monitor reads it under the same ownership rule for the same reason, with a
  // start-time fallback a per-turn process cannot have
  // [C monitors/heartbeat.js disarmedHere]. A bare existence check turned
  // one `rest` into a permanent disarm of every future session - silently,
  // with `status` still promising a beat [C bin/handshake.js:1293]. `rest`
  // already stamps the sentinel with the session that wrote it
  // [C bin/handshake.js:1842], so the fix is to read it: another session's
  // disarm is not this session's, and is treated as absent.
  const disarm = C.sentinel(state, 'monitorDisarm');
  if (C.ownsRecord(C.readRecord(disarm), mine)) return C.done();

  // ---- 3. section 7.2 rule 1: a child never posts --------------------------
  // Same verdict every other hook uses. It matters more here than anywhere
  // else: Stop fires once per agent turn, so a subagent tree that failed this
  // check would put one presence post per agent per turn on the wire.
  const child = C.isChild(state, f);
  if (child.child) return C.done();

  const cfg = state.read();
  const transport = C.transportOf(found, cfg);
  const K = C.keepaliveSeconds(transport) * 1000;    // 60 s relay / 600 s ntfy

  // ---- 4. section 10.2: the posting_stopped latch, THIS session's -----------
  // Once posting has stopped on this transport FOR THE SESSION it stays
  // stopped. Spawning the CLI to be refused every turn is the retry loop that
  // rule forbids.
  //
  // "for the session" is the whole rule, and session.json says whose: the file
  // is rewritten from scratch whenever the id differs [C lib/state.js:434], so
  // the `session` field on it is the session that latched. Reading the latch
  // without reading that field let a previous session's auth failure silence
  // the fallback in a new one, which is the same defect as the sentinel above.
  // The CLI re-derives its own session flags on the next spawn, so an ignored
  // stale latch costs at most one beat, and it re-latches (and reports once) if
  // posting really is still refused.
  if (stateLib) {
    const s = stateLib.readJsonFile(state.files.session, null);
    if (C.ownsRecord(s, mine) && s.posting_stopped && s.posting_stopped[transport]) return C.done();
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

  // The monitor's real beat: fold the agent tree's touched files, renew
  // presence, then push the delta. Section 10.1 - a transport failure here is
  // silent by design. The deadline is what makes the marker stamped above
  // honest: the presence post is taken first and is bounded by the budget, so
  // the beat this window paid for is the one that actually goes out
  // [C monitors/heartbeat.js beat()].
  try {
    await H.beat(state, found, desired, { deadline: ARMED_AT + BUDGET_MS - MARGIN_MS });
  } catch (_) { /* never fail the turn this hook observes */ }
  C.done();
}

// ------------------------------------------------------- session identity ---
//
// `sessionIdentities` and `ownsRecord` used to live here as this file's own
// copy; they moved to hooks/common.js when the monitor and the injected roster
// note turned out to need the identical rule [C hooks/common.js session
// ownership]. Three readers, one implementation - a second copy would drift on
// exactly the question ("whose record is this?") that has already been got
// wrong once.
//
// KNOWN DEGRADATION, on a host that exports NONE of HANDSHAKE_SESSION_ID /
// CLAUDE_SESSION_ID / CLAUDE_CODE_SESSION_ID.
//
// This hook still has an identity there - the host hands it `session_id` in
// the payload [C hooks/common.js fields()] - but the CLI has none: its
// sessionId() falls back to the constant 'cli' [C bin/handshake.js:135], so
// `rest` stamps the sentinel, and a failing post stamps the latch, with a
// hash of 'cli' that this hook must not admit (admitting a machine-wide
// constant would re-open the permanent disarm outright). The gates above then
// find no owner they recognise and BOTH OPEN:
//
//   - `handshake rest` no longer stops the Stop-hook fallback, in the very
//     session that ran it. The fallback keeps beating at the transport's
//     keepalive (60 s relay / 600 s ntfy) until the session ends.
//   - the section 10.2 latch is ignored, so the fallback spawns the CLI once
//     per keepalive to be refused again.
//
// So it degrades toward BEATING, never toward silence: the failure is visible
// in `handshake status` and ends with the session, where the defect this
// scoping replaced was silent and outlived every session in the workspace.
// That is the direction to fail in, but it is still a failure.
//
// It is NOT closed by having the hooks tell the CLI which session they are
// running for (an env var on C.runCli), which is the obvious fix and was
// tried on paper first. The blocker is that the fix cannot be complete:
// monitors/heartbeat.js spawns the same CLI [C monitors/heartbeat.js beat()]
// and is launched as a bare command with no payload [C monitors/monitors.json],
// so it has nothing to pass. session.json is ONE file whose `session` field is
// rewritten from scratch whenever the id differs [C lib/state.js:434], so
// hook-spawned runs stamping a payload id while monitor-spawned runs stamp
// 'cli' would reset `reported`, `posting_stopped` and `counts` on every
// alternation - breaking section 10.2's report-ONCE-per-session guarantee and
// re-arming the refused-post retry on hosts where both paths run. A partial
// fix here buys scoping by trading away the latch it is scoping. Closing this
// properly needs the CLI to learn the session from state rather than from the
// environment, which is bin/handshake.js's and lib/state.js's call to make.

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
