#!/usr/bin/env node
'use strict';
// claude-handshake M6: SessionEnd - the parting note.
//
// SYNCHRONOUS, 3 s budget (PROTOCOL section 8). SessionEnd fired in 20 of 21
// measured sessions [S4] - the miss was a killed process - so this is where
// graceful shutdown work rides. It is best-effort by contract, never a
// guarantee: the monitor is hard-killed at session end with no signal and no
// exit event [S5], which is precisely why the parting note cannot live there.
//
// A child never posts (section 7.2 rule 1). bin/handshake.js refuses `leave`
// from a proven child on its own, but this hook does not even spawn it - a
// subagent tree would otherwise fire one `ws.leave` per agent.

const C = require('./common');

C.armSafety(2900);

C.readPayload((ctx) => { run(C.fields(ctx)).catch(() => C.done()); });

async function run(f) {
  const found = C.resolveWorkspace(f.cwd);
  if (!found) return C.done();                       // sub-10 ms no-op, section 8
  const state = C.openState(found.ws);
  if (!state) return C.done();

  // The monitor died with the session, so its liveness sentinel must not
  // outlive it: a stale monitor.alive is an interactive marker (section 7.1)
  // and would make the NEXT session misclassify itself as a parent.
  C.remove(C.sentinel(state, 'monitorAlive'));
  C.remove(C.sentinel(state, 'syncPending'));

  const child = C.isChild(state, f);
  if (child.child) return C.done();

  // The disarm sentinel is a per-SESSION switch: `rest` prints "broadcasting
  // stopped for this session" [C bin/handshake.js:1849]. Nothing ever removed
  // it, so it outlived the session that meant it and silenced the Stop-hook
  // fallback in every later one [C hooks/stop.js]. It dies here with the
  // session that armed it, for the same reason monitor.alive does above.
  //
  // Two deliberate narrowings. It is removed AFTER the child check, never
  // before: monitor.alive is self-healing (the monitor re-touches it every
  // poll) and this file is not, so a subagent's SessionEnd must not re-arm its
  // parent's heartbeat. And it is removed only when it is THIS session's, or
  // when nobody can be shown to own it - two parent sessions in one project
  // share this state dir, and deleting the other one's disarm would start
  // beating for a session that deliberately stopped.
  const disarm = C.sentinel(state, 'monitorDisarm');
  const owner = C.recordOwner(C.readRecord(disarm));
  if (owner === null || C.sessionIdentities(f).has(owner)) C.remove(disarm);

  // `ws.leave` with reason session_end (section 3.2). The CLI owns signing,
  // the offline queue (a queued parting note is kept up to 24 h) and the local
  // task-shard record; this hook only starts it and bounds the wait.
  await C.runCli(['leave', '--reason', 'session_end'], {
    cwd: found.root, timeoutMs: 2500,
  });
  C.done();
}

// The ids this session answers to and the reader for the record above live in
// hooks/common.js: the sweep here and the DECISION in hooks/stop.js and
// monitors/heartbeat.js must be the same rule, or the sweep would remove a
// sentinel the readers still honour, or leave one they already ignore
// [C hooks/common.js session ownership].
//
// One deliberate difference from the readers. They treat an unattributable
// record as SOMEONE ELSE'S; the sweep treats it as sweepable. Both choices push
// the same way - toward heartbeating - because a record nobody can be shown to
// own is one no reader will ever honour again, so leaving it on disk buys
// nothing and removing it is how it stops accumulating.
