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

const path = require('path');

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
  // sessionId: buildView scopes the ' · posting stopped (auth)' note to the
  // session that latched it [C hooks/common.js ownsRecord]. Without an identity
  // here it falls back to the environment, and on a host exporting none of the
  // session variables the note is dropped rather than shown - a true line lost.
  // The payload always carries it, so pass it.
  const view = C.buildView(state, found, { now, syncPending, sessionId: f.sessionId });
  const { block, plan } = R.renderWithPlan(view);
  process.stdout.write(block + '\n');

  const child = C.isChild(state, f);
  advance(state, view, now, child, plan);

  // KNOWLEDGE.md 3.2: the knowledge block goes LAST, after the standing block
  // has already reached stdout and after the watermark has advanced. Both are
  // deliberate. The standing block is charged to every turn and must never
  // wait on a cache read that may find nothing; and a throw in here must not
  // cost the digest its consumption, which is why this is its own try and its
  // own function rather than another branch of run().
  try { injectKnowledge(state, view, f, child, now); } catch (_) { /* a block, never a failed turn */ }
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

// ------------------------------------------------- the knowledge block ------
// KNOWLEDGE.md 3.2 / 3.3 / 9.K2. Once per session, from a cache SessionStart's
// shard scan wrote (K1, `knowledge.json` beside peers.json / digest.json), on
// its own budget, taking ZERO characters of the standing block's.

// The cache file name. It is also lib/shard-scan.js's CACHE_FILE, and this is
// a literal rather than a require of that module on purpose: the scan pulls in
// workspace-files, repo and state behind it, and this hook pays its module
// loads on EVERY turn of every session inside a 3 s budget, to read a file it
// usually finds absent. One string is the cheaper duplication, and the name is
// fixed by KNOWLEDGE.md 3.2 rather than by either module.
const KNOWLEDGE_CACHE = 'knowledge.json';
const LATCH_MAX = 16;                       // KNOWLEDGE.md 3.2: "newest 16 kept"

function injectKnowledge(state, view, f, child, now) {
  // A child never injects, and therefore never keys the map and never clears
  // the parent's entry. PROTOCOL 7.2 rule 2 lets a child read the parent's
  // local cache, so this is a scope choice rather than a prohibition: the
  // block is the parent session's opening context, and a subagent is given the
  // facts it needs in the prompt that spawned it.
  if (child && child.child) return;

  // KNOWLEDGE.md 5.3: `mute` suppresses this block too. It is peer chatter by
  // any reading, and a local switch that silences some peer prose and not
  // other peer prose is a lie about what it does.
  if (view.digest && view.digest.muted) return;

  // No session identity, no latch key - and a block that cannot be latched
  // would print on EVERY turn, which is the per-turn cost KNOWLEDGE.md 3.4
  // refuses to pay. The scan_session test below fails closed on the same
  // input; this states the answer where it is decided.
  const sessionId = f.sessionId ? String(f.sessionId) : null;
  if (!sessionId) return;

  // The cheapest read first: in steady state (already printed, or a session
  // that never gets a cache) this is the only extra file this turn touches.
  const latchFile = C.sentinel(state, 'knowledgeInjected');
  const latch = C.readRecord(latchFile);
  const sessions = latch && latch.sessions && typeof latch.sessions === 'object' && !Array.isArray(latch.sessions)
    ? latch.sessions : {};
  if (sessions[sessionId]) return;                       // already printed in this session

  const entries = readKnowledgeCache(state, sessionId);
  if (!entries.length) return;                           // absent, mis-shaped, or another session's scan

  const block = R.renderLearned({
    ws: view.ws, entries, claimFiles: ownClaimFiles(state, now),
  }, { now });
  if (!block) return;

  process.stdout.write(block + '\n');

  // LATCH ON A PRINT, NEVER ON A CHECK. This is the watermark's own rule in a
  // cheaper currency: advance() consumes exactly what was rendered because
  // "marking five consumed when two were rendered would delete peer traffic
  // nobody ever saw". A latch burned on a block nobody saw loses the block for
  // the whole session, and every early return above therefore leaves the
  // sentinel untouched so the next prompt re-checks.
  sessions[sessionId] = now;
  const keys = Object.keys(sessions).sort((a, b) => Number(sessions[a] || 0) - Number(sessions[b] || 0));
  const kept = {};
  for (const k of keys.slice(-LATCH_MAX)) kept[k] = sessions[k];
  C.touch(latchFile, JSON.stringify({ sessions: kept }) + '\n');
}

// The cache is K1's file and this hook is a strict reader of it: an absent
// file, unreadable JSON or a shape it does not recognise are all "absent", and
// absent means print nothing and consume nothing (KNOWLEDGE.md 3.2). Nothing
// here re-escapes: records were escaped on read by parseShard at scan time,
// which is the one escape-on-read path the repo layer has (SECURITY.md 5.4),
// and escapeSlot in the renderer is the belt-and-braces pass on top.
function readKnowledgeCache(state, sessionId) {
  const doc = C.readRecord(path.join(state.dir, KNOWLEDGE_CACHE));
  if (!doc || typeof doc !== 'object') return [];
  // CACHE_VERSION is 1 [C lib/shard-scan.js:57]. A cache from a future scanner
  // whose records are still an array but whose fields mean something else must
  // read as absent here, not be rendered by an injector that predates it.
  // A cache that DECLARES a version other than 1 reads as absent (a future
  // scanner sets v); a cache with no v at all is a v1-shaped document and is
  // judged by shape below, not rejected - the scan itself always writes v:1.
  if (doc.v !== undefined && Number(doc.v) !== 1) return [];

  // A cache whose scan is not THIS session's is not rendered AND does not
  // consume the latch: after a week away the cache carries the previous
  // session's id, and it must be able neither to pass for this session's scan
  // nor to silence the fresh one that is about to land (KNOWLEDGE.md 10.2).
  if (!doc.scan_session || String(doc.scan_session) !== sessionId) return [];

  // The record shape is lib/shard-scan.js's: { member, shard, kind, at,
  // at_iso, fields, author_status }, newest first. Anything else - including
  // an older or newer cache version whose records are not an array - reads as
  // an empty cache rather than as a crash.
  if (!Array.isArray(doc.records)) return [];

  const out = [];
  for (const rec of doc.records) {
    if (!rec || typeof rec !== 'object') continue;
    if (String(rec.kind) !== 'learned') continue;
    if (flaggedShard(rec)) continue;
    const fields = rec.fields;
    if (!fields || typeof fields !== 'object') continue;
    if (!fields.text || !String(fields.text).trim()) continue;   // an id-only record shows nothing
    out.push({
      // Rule 2 of the scan: the member is the SHARD's own, from its header or
      // its filename, never from a field a record could have authored.
      member: rec.member || null,
      at: Number.isFinite(Number(rec.at)) ? Number(rec.at) : null,
      text: fields.text,
      paths: fields.paths,
    });
  }
  return out;
}

// KNOWLEDGE.md 3.3: an entry from a shard flagged `non_member_commit` is never
// injected - and the rule's reach is smaller than it looks. `mismatch` needs a
// RECORDED email for that member, and on any one machine that is the local
// member's own, so a peer's shard comes back `unknown` and can never be
// flagged here. This is a backstop on the reader's own shard, not a control on
// peer content; the line for peer entries is held by the framing, the escaping
// and the caps.
//
// The scan already drops these records rather than caching them, so this is
// the second net rather than the first. It is kept because the rule belongs at
// the injection point too: a cache is a file on disk that a later consumer -
// or a hand-written one - can reach without going through the scan.
function flaggedShard(rec) {
  return rec.author_status === 'mismatch' || rec.author_status === 'non_member_commit';
}

// The ranking input of KNOWLEDGE.md 3.3: the progressive files[] this member's
// own live claims have accumulated [C hooks/post-tool-use.js appendOwn]. No
// claims, or no files on them, is not an error - it is the newest-first floor,
// which is the common case on a cold startup.
function ownClaimFiles(state, now) {
  const files = [];
  try {
    for (const c of state.getOwnClaims(now)) {
      for (const p of (Array.isArray(c.files) ? c.files : [])) files.push(p);
    }
  } catch (_) { /* ranking input only, never a reason to drop the block */ }
  return files;
}
