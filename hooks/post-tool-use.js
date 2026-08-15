#!/usr/bin/env node
'use strict';
// claude-handshake M6: PostToolUse - touch-updates.
//
// ASYNC, matcher Edit|Write|NotebookEdit|Bash, 10 s budget (PROTOCOL
// section 8). 218 spawns were observed in 1.7 h of ordinary agent work [S6]
// and the inter-hook gap is p50 0.4 s / p90 3.1 s [S7], so the mtime sentinel
// is checked BEFORE any real work and a fresh sentinel exits immediately.
//
// What it does when it does run:
//   - append the touched file to this member's own claim files[] (capped
//     union, section 5.3 / [D12]); or, when this is a child session, append
//     UPWARD to the parent's claim state keyed by the parent session id
//     (section 7.2 rule 3) - the parent's next heartbeat carries the union
//   - mark tool activity, which is what lets the monitor assert `working` vs
//     `waiting` honestly instead of guessing
//   - every ~5th tick, one opportunistic sync
//
// The heartbeat NEVER rides this hook: tool cadence is bursty and goes silent
// during long builds, so liveness belongs on the monitor's own clock [S7].

const C = require('./common');
const S = require('./sync');

C.armSafety(9500);

const MAX_FILES = 64;                    // PROTOCOL section 2.5

C.readPayload((ctx) => { run(C.fields(ctx)).catch(() => C.done()); });

async function run(f) {
  const found = C.resolveWorkspace(f.cwd);
  if (!found) return C.done();                       // sub-10 ms no-op, section 8
  const state = C.openState(found.ws);
  if (!state) return C.done();

  // ---- the mtime-sentinel gate, before anything else -----------------------
  const tick = C.sentinel(state, 'postToolTick');
  if (C.isFresh(tick, C.POSTTOOL_GATE_MS)) return C.done();
  C.touch(tick);
  C.touch(C.sentinel(state, 'activity'));

  const child = C.isChild(state, f);
  const rel = C.repoRelative(found.root, f.filePath);
  if (rel) {
    if (child.child) appendUpward(state, rel, child);
    else appendOwn(state, rel);
  }

  await maybeSync(state, found, child);
  C.done();
}

// Section 7.2 rule 3: a child appends its touched files to the PARENT's local
// claim state, keyed by the parent session id (CLAUDE_CODE_SESSION_ID, which
// is the parent's id and is distinct from the payload's own sessionId). The
// child never claims, never posts and never renews - the parent folds this in
// on its next heartbeat.
function appendUpward(state, rel, child) {
  const parent = child.parent_session || C.parentSessionId() || 'unknown_parent';
  try {
    state.update((s) => {
      const all = (s.child_touches && typeof s.child_touches === 'object' && !Array.isArray(s.child_touches))
        ? s.child_touches : {};
      const bucket = all[parent] && Array.isArray(all[parent].files) ? all[parent] : { files: [], at: 0 };
      if (!bucket.files.includes(rel)) bucket.files.push(rel);
      if (bucket.files.length > MAX_FILES) bucket.files = bucket.files.slice(-MAX_FILES);
      bucket.at = Date.now();
      all[parent] = bucket;
      s.child_touches = all;
      return s;
    });
  } catch (_) { /* advisory data; never fail the turn */ }
}

// The member's own most recently acquired live claim is the one the work is
// against. files[] is appended progressively and is a capped union, never a
// replace [D12].
function appendOwn(state, rel) {
  try {
    const now = Date.now();
    const mine = state.getOwnClaims(now);
    if (!mine.length) return;                        // nothing claimed: nothing to append to
    const target = mine[mine.length - 1];            // getOwnClaims sorts by acquired_at ascending
    const files = Array.isArray(target.files) ? target.files.slice() : [];
    if (files.includes(rel)) return;
    files.push(rel);
    state.addOwnClaim({
      subject: target.subject, subject_key: target.subject_key, ttl: target.ttl,
      acquired_at: target.acquired_at, files: files.slice(-MAX_FILES),
    });
  } catch (_) { /* advisory data; never fail the turn */ }
}

// One opportunistic sync every ~5th tick. A child does no network I/O for
// handshake purposes (section 7.2 rule 2), so it never reaches this.
async function maybeSync(state, found, child) {
  if (child.child) return;
  const counter = C.sentinel(state, 'ticks');
  const stateLib = C.lib('state.js');
  if (!stateLib) return;
  let n = 1;
  try {
    const prev = stateLib.readJsonFile(counter, { n: 0 });
    n = (Number(prev.n) || 0) + 1;
    stateLib.writeJsonFile(counter, { n: n % C.SYNC_EVERY_N_TICKS, at: Date.now() });
  } catch (_) { return; }
  if (n % C.SYNC_EVERY_N_TICKS !== 0) return;

  const cfg = state.read();
  const transport = C.transportOf(found, cfg);
  // Do not spend a network round while SessionStart's own sync is in flight.
  if (C.isFresh(C.sentinel(state, 'syncPending'), 15000)) return;
  try {
    await S.refresh(state, found, { transport, limit: 20, timeoutMs: 6000 });
    await S.commitPendingCursor(state, found, transport);
  } catch (_) { /* section 10.1: silent by design */ }
}
