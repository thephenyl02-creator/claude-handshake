#!/usr/bin/env node
'use strict';
// claude-handshake M6: SessionStart.
//
// ASYNC, 10 s budget (PROTOCOL section 8). This is the ONE hook allowed to
// touch the network, so it carries everything that needs a transport:
//
//   1. write the `pending` sync marker (UserPromptSubmit waits <= 500 ms on it)
//   2. scan the durable layer's shards into the knowledge cache - local disk
//      only, BEFORE the network (KNOWLEDGE.md 3.2) - then, inside its own
//      1,500 + 500 ms bound, fetch the state ref and re-scan from it
//      (V2-PLAN 10.1's read half, 2.5's SessionStart row)
//   3. run one bounded sync and write the digest cache
//   4. restart-recovery reconcile - re-adopt this member's own still-live
//      claims, preserving acquired_at (section 5.3 / 5.4)
//   5. clear the marker, push any watermark the injector advanced locally
//
// It branches on the payload `source`. A child session does none of it:
// section 7.2 rule 2 - "a child performs no network I/O for handshake
// purposes".

const C = require('./common');
const S = require('./sync');
const K = require('../lib/shard-scan');
const H = require('../monitors/heartbeat');

const ARMED_AT = Date.now();
const BUDGET_MS = 9500;
const MARGIN_MS = 500;

C.armSafety(BUDGET_MS);

// THE ABSOLUTE WALL EVERY STEP BELOW SHARES, and the reason it exists rather
// than three independent budgets that happen to sum correctly: `armSafety` is a
// hard `process.exit(0)` [C hooks/common.js armSafety] and the LAST thing this
// hook does is clear the `pending` marker. A hook that dies holding that marker
// leaves every later turn reporting `sync pending` [C hooks/render.js:67] for a
// sync that is not running - the exact failure the sync's own catch arm already
// exists to prevent. So each step takes what is left of this wall rather than a
// fresh budget of its own (V2-PLAN section 2.5's threading rule), and the
// clearing always happens on this side of the watchdog.
const DEADLINE = ARMED_AT + BUDGET_MS - MARGIN_MS;

// V2-PLAN 10.1, the late-not-lost arm. SessionEnd is best-effort by contract -
// it fired in 20 of 21 measured sessions [S4] - so the one session in
// twenty-one that loses its flush leaves `state.pending` behind and THIS is
// where the batch is committed: late instead of for good. A sequenced peer
// waiting on the closing `task.done` then waits until the next session rather
// than forever.
//
// THE FLUSH IS ITS OWN ROW BESIDE THE SYNC'S, NOT A SLICE TAKEN QUIETLY OUT OF
// IT (the owner's ruling of 2026-09-05 on this hook's arithmetic). Section 2.5's
// SessionStart row is written as 1,500 + 500 + 7,000 and has no fourth number in
// it; this hook now has a fourth step, so the row is spelled out here in full
// and the sync's own ceiling is what gives way on the rare session that flushes:
//
//     1,500  fetch          [C lib/shard-scan.js FETCH_BUDGET_MS]
//       500  the whole scan [C lib/shard-scan.js REF_SCAN_BUDGET_MS]
//     5,000  the late flush (this constant)
//     2,000  the sync, on a session that flushed - 7,000 on every other one
//     -----
//     9,000  inside armSafety(9500) with the same 500 ms margin hooks/stop.js
//            computes for itself
//
// The row is ARITHMETIC and not decoration: it summed to 9,500 under a 9,000
// label in the first draft of this comment, and a later change that trusts a
// wrong row is how a budget overruns its watchdog. 1,500 + 500 + 5,000 leaves
// 2,000, and 2,000 is what the sync gets on the rare session that flushes.
//
// 5,000 AND NOT 2,000, and the number is a measurement rather than a taste.
// One flush is ~15 git processes - a fetch, the eight-step temp-index build,
// the checked-out guard, the update-ref and the push - and it measures 3,540 ms
// warm on this machine against a local bare remote (probe, 2026-09-05), and
// half again as long when the machine is busy. At 2,000 it never once lands,
// and at 4,000 it lands only on an idle machine, which turns "late instead of lost" from the
// recovery arm into a step that ships dead - and it is the arm that makes
// SessionEnd's own deferral survivable, because SessionEnd keeps the plan's
// 3,000 ms window and therefore usually DOES defer [C hooks/session-end.js].
// This is the one place in the two hooks where a batch a peer is waiting on
// still has room to go out, so it gets the room and the sync's CEILING is what
// gives way - explicitly, in the row above, on the rare session that flushes at
// all. The common session pays one `statSync` for the marker and nothing else.
const LATE_FLUSH_MS = 5000;
const SYNC_BUDGET_MS = 7000;
// SYNC_FLOOR_MS is the least wall worth starting a sync on, and it is a
// THRESHOLD rather than a floor under the timeout. The distinction is the bug
// the first draft carried: `Math.max(SYNC_FLOOR_MS, ...)` on a wall that had
// already run out started a 1,500 ms sync AT the deadline - 500 ms past
// armSafety(9500), with the `pending` marker still uncleared, which is the one
// failure the shared wall above exists to prevent. It is reachable: the flush's
// own bound is `min(started + 5,000, DEADLINE)` and a git spawn can overrun its
// slice, so "the flush ends at the wall" is a real session, not a hypothetical.
//
// So: below this much left, the sync is SKIPPED and the hook goes straight to
// clearing the marker. A skipped sync is the same posture as an unreachable
// transport - already silent by contract (section 10.1), the marker cleared, the
// injector reporting a stale digest rather than a hang - and the next turn's
// UserPromptSubmit refresh picks it up. Above it, the sync gets what the wall
// actually leaves (2,000 after a flush, 7,000 without one) and never more.
const SYNC_FLOOR_MS = 1500;

// The five documented sources are startup | resume | clear | compact | fork.
// startup/resume/fork begin a transport-visible session and get the full path.
// clear/compact are context operations INSIDE a session that is already synced
// and whose watermark has already consumed those items; re-syncing there would
// spend a network round to re-inject nothing (section 6.3).
const NETWORK_SOURCES = new Set(['startup', 'resume', 'fork']);

C.readPayload((ctx) => { run(C.fields(ctx)).catch(() => C.done()); });

async function run(f) {
  const found = C.resolveWorkspace(f.cwd);
  if (!found) return C.done();                       // sub-10 ms no-op, section 8
  const state = C.openState(found.ws);
  if (!state) return C.done();

  const child = C.childMode(state, f.source, { agentMarker: Boolean(f.agentId || f.agentType) });
  // Classified once, here, where the interactive `source` marker exists; every
  // later hook in this session reads the verdict instead of re-deriving it.
  C.recordRole(state, f.sessionId, child);
  if (child.child) {
    // Rule 1 (never a member) and rule 2 (no network I/O). The child still
    // reads the parent's cache later, on the PreToolUse gate - it just never
    // refreshes it and never announces itself.
    return C.done();
  }

  const cfg = state.read();
  const transport = C.transportOf(found, cfg);
  const pending = C.sentinel(state, 'syncPending');

  if (!NETWORK_SOURCES.has(String(f.source || 'startup'))) {
    C.remove(pending);
    await S.commitPendingCursor(state, found, transport);
    return C.done();
  }

  C.touch(pending, JSON.stringify({ source: f.source || null, at: Date.now() }) + '\n');

  // KNOWLEDGE.md 3.2, and the ordering is the whole argument: the WORKING-TREE
  // shard scan runs BEFORE the network sync, not after. It is local disk I/O,
  // it makes no network call and nothing in it depends on the sync's result -
  // so placed after S.refresh it would sit behind that 7 000 ms timeout while
  // the injector waits at most PENDING_WAIT_MS = 500 [C hooks/common.js:58] and
  // then renders. On a fresh pull (no knowledge.json yet) the first prompt
  // would render before the scan finished, which is precisely the acceptance
  // run this feature exists for (KNOWLEDGE.md 10.1 step 5). Placed here it runs
  // inside the window the injector already waits on.
  //
  // It goes AFTER the marker rather than before it so a first prompt arriving
  // mid-scan is told `sync pending` [C hooks/render.js:67] rather than shown an
  // empty block. It never throws, so the sync below is unaffected either way,
  // and it is on this branch only: `clear`/`compact` are context operations
  // inside a session that has already scanned, and a child never gets here at
  // all (rule 7.2, the early return above).
  //
  // V2-PLAN 10.1's READ HALF rides the same call and does NOT disturb that
  // ordering: sessionStartScan writes the working-tree cache first, then spends
  // at most 1 500 ms fetching `handshake/state` and 500 ms re-scanning from the
  // fetched ref, replacing the cache only if the ref answers (section 2.5's
  // SessionStart row - 1 500 + 500 + the sync's 7 000 leaves the same 500 ms
  // margin under armSafety(9500) that hooks/stop.js computes for itself). A
  // peer who has been away for six days has the peer's shards on that ref and
  // nowhere on disk, which is the case the working-tree scan alone cannot serve
  // (11.2). The fetch is behind the same opt-in as the write half and is
  // abandoned, never waited on, so a session that never opted in - or one whose
  // remote is unreachable - pays exactly what it paid before.
  const readHalf = Math.min(Date.now() + K.FETCH_BUDGET_MS + K.REF_SCAN_BUDGET_MS, DEADLINE);
  await K.sessionStartScan(state, found.root, {
    sessionId: f.sessionId,
    kinds: K.SESSION_START_KINDS,
    // Explicit, always: `sessionStartScan`'s gate is fail-closed on an omitted
    // option, so this is the one place that says yes.
    enabled: stateBranchEnabled(state) === true,
    deadline: readHalf,
  });

  // The late-not-lost flush, AFTER the read half and BEFORE the sync. After,
  // because the read half's first act is the working-tree cache write the
  // injector waits 500 ms on and nothing may be put in front of it; before,
  // because the sync is the step with slack in it and the flush is the step
  // with a peer waiting on the other end.
  await lateFlush(state, found);

  try {
    // What is left of the shared wall, never a fresh 7,000: whatever the read
    // half and the flush overspent comes out of here, which is the step with
    // slack in it, and never out of the marker-clearing below. Under
    // SYNC_FLOOR_MS there is no sync at all rather than one that starts past
    // the wall (see the constant).
    const left = DEADLINE - Date.now();
    if (left >= SYNC_FLOOR_MS) {
      const res = await S.refresh(state, found, {
        transport, limit: 20, timeoutMs: Math.min(SYNC_BUDGET_MS, left),
      });
      if (res.ok) S.reconcileOwnClaims(state, res.parsed, cfg, Date.now());
    }
  } catch (_) {
    // section 10.1: transport unreachable is silent by design. The marker is
    // still cleared below so the injector reports a stale cache, not a hang.
  }
  C.remove(pending);
  await S.commitPendingCursor(state, found, transport);
  C.done();
}

// One flush of a batch the previous session left behind, and the ONE line that
// says it happened. The line is not printed here - SessionStart is async and
// its stdout is not session context - it is recorded on the beat record, and
// `handshake status` prints *"committed a batch left over from your last
// session - late instead of lost"* from it (section 4.4 rule 1: every automated
// action that changes what the human will see leaves one line).
//
// Bounded by the shared wall as well as by its own budget, so an overrun here
// comes out of the sync's slice and never out of the marker-clearing.
async function lateFlush(state, found) {
  const stateLib = C.lib('state.js');
  if (!stateLib || typeof stateLib.statePending !== 'function') return 0;
  if (stateLib.statePending(state) === null) return 0;   // the common case: one statSync
  const started = Date.now();
  try {
    const r = await H.stateBatch(state, found, {
      deadline: Math.min(started + LATE_FLUSH_MS, DEADLINE), force: true, where: 'session_start',
    });
    if (r && r.ran) {
      const rec = stateLib.readStateBeat(state);
      stateLib.writeStateBeat(state, Object.assign({}, rec, {
        late_flush: r.outcome === 'ok' || r.outcome === 'unchanged',
      }));
    }
  } catch (_) { /* best-effort: the marker stays and the next session tries again */ }
  return Date.now() - started;
}

// The opt-in gate for the FETCH. The record belongs to the write half -
// `handshake pair --state-branch` writes it and lib/state-branch.js reads it
// (V2-PLAN 4.2 item 3, section 14 item 5) - so this asks that module and asks
// NOTHING ELSE.
//
// THERE IS EXACTLY ONE RECORD OF THE OPT-IN AND THIS FUNCTION KNOWS ONLY THAT
// ONE. An earlier revision fell back to a `state_branch` key inside
// `state.json` when the write half could not be required, which was a second,
// undocumented enable that `handshake pair --state-branch --revoke` did not
// clear - and `state.json` is precisely the file section 10.1's Touches keep
// this marker OUT of, because hooks read-modify-write it on hot paths. If the
// write half is not installed there is no write half to fetch for, so the
// answer is no.
//
// It gates the network call and nothing else. The ref SCAN is local git and
// runs whenever the ref resolves - a client that fetched the branch by any
// route reads it - so a peer's records are never withheld because this side
// has not switched its own pushes on.
function stateBranchEnabled(state) {
  try {
    const sb = require('../lib/state-branch');
    if (sb && typeof sb.readOptIn === 'function') return Boolean(sb.readOptIn(state).enabled);
  } catch (_) { /* the write half is not installed: no fetch, and no second opinion */ }
  return false;
}
