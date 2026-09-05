#!/usr/bin/env node
'use strict';
// claude-handshake M6: SessionEnd - the parting note.
//
// SYNCHRONOUS, 3 s budget (PROTOCOL section 8, V2-PLAN 10.1), and the
// last-batch flush rides INSIDE that window rather than widening it.
// SessionEnd fired in 20 of 21
// measured sessions [S4] - the miss was a killed process - so this is where
// graceful shutdown work rides. It is best-effort by contract, never a
// guarantee: the monitor is hard-killed at session end with no signal and no
// exit event [S5], which is precisely why the parting note cannot live there.
//
// A child never posts (section 7.2 rule 1). bin/handshake.js refuses `leave`
// from a proven child on its own, but this hook does not even spawn it - a
// subagent tree would otherwise fire one `ws.leave` per agent.

const C = require('./common');
const H = require('../monitors/heartbeat');

const ARMED_AT = Date.now();

// THE WINDOW IS 3,000 ms AND IT IS NOT WIDENED FOR THE FLUSH. V2-PLAN 10.1
// puts the last-batch flush here - "the monitor is hard-killed at session end
// with no signal and no exit event, so the last batch, including the session's
// closing `task.done`, is committed nowhere" - and says it rides "inside its
// 3 s budget". A build that widened this hook to 7,000 made an offline machine
// pay 6.6 s at every session end, measured, which is a cost the plan never
// authorised; the owner's ruling of 2026-09-05 is to keep 3,000 and let the
// flush DEFER when it does not fit, rather than to buy the flush with the
// human's shutdown time.
//
// What that costs, stated rather than hidden: one flush measures ~1.8 s warm on
// Windows (`git fetch` 644 ms + the temp-index build 687 ms + `git push` 188 ms,
// plus four small local spawns), so the flush lands whenever `leave` returns
// promptly and DEFERS when it does not. Deferring is not losing: the batch stays
// on disk behind `state.pending` and the late-not-lost arm at the next session
// start commits it with one line [C hooks/session-start.js lateFlush].
//
// The two steps are SEQUENCED rather than overlapped, because `leave` writes the
// very record the flush is here to carry. `leave` therefore gets a CEILING and
// not the whole wall - at 2,500 it could eat the window entire and the flush
// would never once run, which is a step that ships dead. 1,200 ms is a full node
// boot plus the local write on this machine, and `leave`'s own network post is
// best-effort and queued behind its own bound anyway [C bin/handshake.js
// cmdLeave].
const BUDGET_MS = 3000;
const MARGIN_MS = 400;
const LEAVE_MS = 1200;

// The absolute wall both steps share. Each takes what is left of it rather than
// a fresh budget of its own - the threading rule of V2-PLAN section 2.5.
const DEADLINE = ARMED_AT + BUDGET_MS - MARGIN_MS;

C.armSafety(BUDGET_MS);

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
  //
  // AWAITED, not overlapped, and the order is the whole point. `leave` writes
  // this member's PARTING RECORD into the task shard [C bin/handshake.js
  // cmdLeave], and that record is precisely what V2-PLAN 10.1 says the last
  // batch carries - "the last batch, including the session's closing
  // `task.done`, is committed nowhere" is the failure the flush below exists
  // to close. Run concurrently, the flush hashes the shard while `leave` is
  // still starting up and publishes the session WITHOUT its sign-off, roughly
  // as often as not: a race for the one record the step was added for. So the
  // two are sequenced and the budget holds both.
  await C.runCli(['leave', '--reason', 'session_end'], {
    cwd: found.root, timeoutMs: Math.min(LEAVE_MS, Math.max(1, DEADLINE - Date.now())),
  });

  // The last-batch flush, best-effort exactly like everything else here.
  // `force` bypasses the ≤ 1/min CLOCK - this is the end of the session, there
  // is no next beat, and the batch that does not go now is the one a sequenced
  // peer waits on [C monitors/heartbeat.js stateBatch]. It does NOT bypass the
  // batch LOCK, which lives inside the beat: a monitor mid-batch in this same
  // clone is doing exactly this work, and two writers seeding one temp index is
  // the measured data-loss bug [C lib/state-branch.js indexPath].
  // It takes what `leave` left of the shared wall; with nothing left it does
  // nothing at all, and the late-not-lost path at the next session start picks
  // the batch up.
  try {
    await H.stateBatch(state, found, { deadline: DEADLINE, force: true, where: 'session_end' });
  } catch (_) { /* best-effort by contract, 20 of 21 [S4] */ }

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
