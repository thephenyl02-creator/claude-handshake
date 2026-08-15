#!/usr/bin/env node
'use strict';
// claude-handshake M6: PreToolUse - the overlap gate.
//
// SYNCHRONOUS, matcher Edit|Write|NotebookEdit, ~90 ms measured [S3], 3 s
// budget (PROTOCOL section 8). Local cache only.
//
// This gate is a PATH comparison, never a subject one (section 5.2): the
// target file_path is matched against peers' cached claim files[] and claim
// globs before the write. It MUST warn; it MAY block only when the workspace
// config sets overlap_gate "block". The default is warn.
//
// The gate stays active in a child session - section 7.2 rule 2 - reading the
// PARENT's local cache, which is the same per-workspace state directory. That
// is the one handshake duty a child never sheds.
//
// Output mechanism: plain stdout is NOT added to the model's context on
// PreToolUse (unlike UserPromptSubmit/SessionStart), so both verdicts are
// emitted as the documented control JSON and the process still exits 0 -
// which is what lets "block" coexist with section 8's "exit 0 always".

const C = require('./common');
const R = require('./render');
// This is the ONE injection path with no template and no char budget competing
// with it, so it carries the shared wrapper delimiters and the shared
// never-list verbatim: escape.MARKERS and escape.FRAMING, one definition each,
// travelling with the data (SECURITY 5.1/5.3).
const escape = require('../lib/escape');

C.armSafety(2800);

C.readPayload((ctx) => {
  try { run(C.fields(ctx)); } catch (_) { C.done(); }
});

function run(f) {
  if (!f.filePath) return C.done();
  const found = C.resolveWorkspace(f.cwd);
  if (!found) return C.done();                       // sub-10 ms no-op, section 8
  const state = C.openState(found.ws);
  if (!state) return C.done();

  const cfg = state.read();
  const me = cfg.member || null;
  const rel = C.repoRelative(found.root, f.filePath);
  if (!rel) return C.done();                         // outside the repo: not claimable

  const now = Date.now();
  const peers = state.getPeers();
  const hits = [];
  for (const c of peers.claims || []) {
    const owner = c.owner || c.member || c.member_id || null;
    if (me && owner === me) continue;                // your own claim is not an overlap
    const expires = Number(c.expires_at) ||
      (Number(c.renewed_at || c.acquired_at || 0) + Number(c.ttl || 7200) * 1000);
    if (expires <= now) continue;                    // section 5.3
    const files = Array.isArray(c.files) ? c.files : [];
    const match = files.find((entry) => C.pathMatches(rel, entry));
    if (match) {
      hits.push({
        subject: escape.escapeField('subject', c.subject || c.subject_key, { singleLine: true }),
        owner: escape.escapeMemberId(ownerName(peers, owner, c.owner_name)),
        entry: escape.escapeField('path', match, { singleLine: true }),
        advisory: C.transportOf(found, cfg) !== 'relay',
      });
    }
  }
  if (!hits.length) return C.done();

  const gate = C.overlapGate(found, cfg);
  const message = describe(rel, hits, gate);
  emit(gate, message);
  C.done();
}

function ownerName(peers, id, fallback) {
  for (const m of peers.members || []) {
    const mid = m.member || m.member_id;
    if (mid === id) return m.name || m.display_name || mid;
  }
  return fallback || id || 'a peer';
}

// Peer-authored strings (subjects, names, claimed paths) reach the model here,
// so they are escaped, wrapped in the shared delimiters and shipped with the
// shared never-list. An unframed gate line would be an unframed injection
// (SECURITY section 5.1); a locally-copied delimiter would be a breakout
// waiting to happen, which is why both come from lib/escape.js.
function describe(rel, hits, gate) {
  const target = R.escapeSlot(rel, 120, 'path');
  const shown = hits.slice(0, 3).map((h) =>
    '"' + R.escapeSlot(h.subject, 60, 'subject') + '" — ' + R.escapeSlot(h.owner, 24, 'member_name') +
    ' (claims ' + R.escapeSlot(h.entry, 60, 'path') + (h.advisory ? ', advisory' : '') + ')');
  const more = hits.length - shown.length;
  const head = 'handshake: ' + (gate === 'block' ? 'BLOCKED' : 'overlap') +
    ' — ' + target + ' is inside a peer claim.';
  return [
    head,
    escape.MARKERS.begin,
    '[peer claims - ' + escape.FRAMING + ']',
    shown.join(' · ') + (more > 0 ? ' · +' + more + ' more' : ''),
    escape.MARKERS.end,
    'Claims are advisory leases, not locks: decide for yourself, and coordinate',
    'with /handshake before overwriting their work.',
  ].join('\n');
}

function emit(gate, message) {
  const out = { hookSpecificOutput: { hookEventName: 'PreToolUse' } };
  if (gate === 'block') {
    out.hookSpecificOutput.permissionDecision = 'deny';
    out.hookSpecificOutput.permissionDecisionReason = message;
  } else {
    out.hookSpecificOutput.additionalContext = message;
  }
  try { process.stdout.write(JSON.stringify(out) + '\n'); } catch (_) { /* never fail the tool call */ }
}
