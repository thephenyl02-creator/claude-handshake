#!/usr/bin/env node
'use strict';
// claude-handshake M6: SessionStart.
//
// ASYNC, 10 s budget (PROTOCOL section 8). This is the ONE hook allowed to
// touch the network, so it carries everything that needs a transport:
//
//   1. write the `pending` sync marker (UserPromptSubmit waits <= 500 ms on it)
//   2. run one bounded sync and write the digest cache
//   3. restart-recovery reconcile - re-adopt this member's own still-live
//      claims, preserving acquired_at (section 5.3 / 5.4)
//   4. clear the marker, push any watermark the injector advanced locally
//
// It branches on the payload `source`. A child session does none of it:
// section 7.2 rule 2 - "a child performs no network I/O for handshake
// purposes".

const C = require('./common');
const S = require('./sync');

C.armSafety(9500);

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
  try {
    const res = await S.refresh(state, found, { transport, limit: 20, timeoutMs: 7000 });
    if (res.ok) S.reconcileOwnClaims(state, res.parsed, cfg, Date.now());
  } catch (_) {
    // section 10.1: transport unreachable is silent by design. The marker is
    // still cleared below so the injector reports a stale cache, not a hang.
  }
  C.remove(pending);
  await S.commitPendingCursor(state, found, transport);
  C.done();
}
