#!/usr/bin/env node
'use strict';
// claude-handshake M6: SessionStart.
//
// ASYNC, 10 s budget (PROTOCOL section 8). This is the ONE hook allowed to
// touch the network, so it carries everything that needs a transport:
//
//   1. write the `pending` sync marker (UserPromptSubmit waits <= 500 ms on it)
//   2. scan the durable layer's shards into the knowledge cache - local disk
//      only, BEFORE the network (KNOWLEDGE.md 3.2)
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

  // KNOWLEDGE.md 3.2, and the ordering is the whole argument: the shard scan
  // runs BEFORE the network sync, not after. It is local disk I/O, it makes no
  // network call and nothing in it depends on the sync's result - so placed
  // after S.refresh it would sit behind that 7 000 ms timeout while the
  // injector waits at most PENDING_WAIT_MS = 500 [C hooks/common.js:58] and
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
  K.scanToCache(state, found.root, { sessionId: f.sessionId, kinds: K.SESSION_START_KINDS });

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
