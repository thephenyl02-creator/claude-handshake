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

  // `ws.leave` with reason session_end (section 3.2). The CLI owns signing,
  // the offline queue (a queued parting note is kept up to 24 h) and the local
  // task-shard record; this hook only starts it and bounds the wait.
  await C.runCli(['leave', '--reason', 'session_end'], {
    cwd: found.root, timeoutMs: 2500,
  });
  C.done();
}
