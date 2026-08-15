#!/usr/bin/env node
'use strict';
// claude-handshake M6: UserPromptSubmit - the standing block.
//
// SYNCHRONOUS, LOCAL-CACHE-ONLY, ZERO NETWORK, 3 s budget (PROTOCOL section 8).
// Measured cost basis is p50 100-140 ms for a full hook [S2], and this one is
// charged to EVERY turn of EVERY session, so it does exactly four things:
// wait <= 500 ms on the pending-sync marker, render, print, advance.
//
// It is the only script in this plugin that writes to stdout.
//
// The standing block ALWAYS ships - roster, claims, standing rules - plus the
// digest when one is pending (section 6.2). The trust framing is part of the
// block and never assumes SKILL.md is loaded; a digest injected without its
// framing is a defect, not a degraded mode (SECURITY section 5.1).

const C = require('./common');
const R = require('./render');

C.armSafety(2800);                       // inside the 3 s hook budget

C.readPayload((ctx) => {
  try { run(C.fields(ctx)); } catch (_) { C.done(); }
});

function run(f) {
  const found = C.resolveWorkspace(f.cwd);
  if (!found) return C.done();                       // sub-10 ms no-op, section 8
  const state = C.openState(found.ws);
  if (!state) return C.done();

  // Wait, bounded, on the marker SessionStart wrote. A still-pending marker is
  // reported honestly in the block rather than rendered as an empty roster
  // (section 10.2), and it never delays the turn beyond 500 ms.
  const pending = C.sentinel(state, 'syncPending');
  const deadline = Date.now() + C.PENDING_WAIT_MS;
  while (C.ageMs(pending) !== null && Date.now() < deadline) C.sleepSync(25);
  // A marker older than the SessionStart budget is a crashed sync, not a
  // running one; treating it as pending forever would make the note a lie.
  const syncPending = C.isFresh(pending, 15000);

  const now = Date.now();
  const view = C.buildView(state, found, { now, syncPending });
  const { block, plan } = R.renderWithPlan(view);
  process.stdout.write(block + '\n');

  advance(state, view, now, C.isChild(state, f), plan);
  C.done();
}

// PROTOCOL section 6.3: the consumed watermark advances AT INJECTION TIME,
// not at fetch time, and so does the dedupe memory - "whatever is rendered
// here is consumed and will not appear again".
function advance(state, view, now, child, plan) {
  const digest = view.digest || {};
  // Muted injects no items, so nothing was consumed (SECURITY section 5.4).
  if (digest.muted) return;

  // Section 7.2 rule 1/3: a child is never a member and never speaks for one.
  // Consuming the parent's watermark here would delete items the parent has
  // not seen, so a child renders the block (it needs the trust framing and the
  // claims as much as anyone) and advances nothing.
  if (child && child.child) return;

  const items = digest.items || [];
  if (!items.length) return;

  // Consume exactly what the model was shown. Trimming can drive the digest
  // below the inject cap, and marking five consumed when two were rendered
  // would delete peer traffic nobody ever saw (PROTOCOL section 6.3).
  const shown = Math.max(0, Math.min(Number(plan && plan.digestCap), R.INJECT_CAP)) || 0;
  if (!shown) return;
  const rendered = items.slice(0, shown);
  const carried = items.slice(shown);

  try {
    const dedupe = state.dedupe(now);
    for (const it of rendered) {
      if (it.from && Number.isInteger(it.seq)) dedupe.add(it.from, it.seq, it.nonce || undefined);
    }
    dedupe.flush();
  } catch (_) { /* dedupe is memory, never a reason to fail a turn */ }

  const stored = state.getDigest();
  // What was rendered is consumed; what the fetch cap brought back but the
  // inject cap could not show is CARRIED, not dropped - the `+N more` line
  // that referred to it must stay true (section 10.2).
  state.setDigest(Object.assign({}, stored, {
    items: carried.map((it) => ({
      type: it.type, member: it.from || it.member, member_name: it.member,
      text: it.text, at: it.at, seq: it.seq, nonce: it.nonce,
    })),
    injected_at: now,
  }));

  if (stored.next_cursor !== null && stored.next_cursor !== undefined) {
    const adv = state.advanceWatermark(view.transport, stored.next_cursor);
    if (adv.advanced) {
      // The relay's cursor endpoint is a network call and this hook has none;
      // the next async tick pushes it (see hooks/sync.js commitPendingCursor).
      state.update((s) => { s.pending_cursor_commit = true; return s; });
    }
  }
}
