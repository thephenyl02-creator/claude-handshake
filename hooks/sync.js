'use strict';
// claude-handshake M6: the network-touching half of the hook set.
//
// Only the ASYNC hooks reach this module - SessionStart and the opportunistic
// PostToolUse tick. The synchronous UserPromptSubmit path (PROTOCOL section 8:
// "LOCAL-CACHE-ONLY ... zero network") never requires it.
//
// The transport work itself is delegated to bin/handshake.js, which owns the
// adapters, the signing keys and the failure taxonomy of section 10. A hook
// that re-implemented any of that would be a second, unreviewed client.

const C = require('./common');
const escape = require('../lib/escape');

// Mirrors bin/handshake.js summarize(): the one line a digest item shows.
function summarize(env) {
  const b = (env && env.body) || {};
  if (b.text) return String(b.text);
  if (b.summary) return String(b.summary);
  if (b.subject) return String(b.subject);
  if (b.member_name) return String(b.member_name);
  if (b.reason) return String(b.reason);
  return '(no text)';
}

// `sync --json` does not print next_cursor, so it is derived from the returned
// message handles. Deriving it can only LAG the adapter's own value (ntfy
// reports the last candidate, not the last chosen), never overshoot - and a
// lagging watermark re-reads, which dedupe absorbs, while an overshooting one
// would go permanently blind (PROTOCOL section 6.3).
function deriveCursor(transport, messages) {
  if (!Array.isArray(messages) || !messages.length) return null;
  if (transport === 'relay') {
    let max = null;
    for (const m of messages) {
      const seq = Number(m.seq !== undefined ? m.seq : m.handle);
      if (Number.isInteger(seq) && (max === null || seq > max)) max = seq;
    }
    return max;
  }
  let best = null;
  for (const m of messages) {
    const id = m.message_id || m.handle;
    const ts = Number(m.unix_ts) || 0;
    if (!id) continue;
    if (!best || ts >= best.unix_ts) best = { message_id: String(id), unix_ts: ts };
  }
  return best;
}

// Write the digest cache. This is a CACHE of what MAY be injected; nothing is
// consumed until UserPromptSubmit renders it (section 6.3).
function writeDigest(state, transport, parsed) {
  const messages = (parsed && parsed.messages) || [];
  // Escaped at the RECEIVE path, before it is ever cached: the cache is read
  // by the synchronous injection hook, which must not have to trust it
  // (SECURITY 5.3). `member` keeps its raw transport value because it is half
  // of the (from.member, sender_seq) dedupe key; `member_name` is the rendered
  // one and is escaped.
  const items = messages.map((m) => {
    const env = m.envelope || {};
    const from = (env.from && env.from.member) || m.from || null;
    return {
      type: escape.escapeField('name', env.type || '', { singleLine: true }) || null,
      member: from,
      member_name: escape.escapeMemberId(m.from_name || from),
      text: escape.escapeField('text', summarize(env), { singleLine: true }),
      at: Number(env.ts) || Number(m.received_at) || Date.now(),
      seq: Number(env.sender_seq) || null,
      nonce: env.nonce || null,
      handle: m.handle !== undefined ? m.handle : m.seq,
    };
  }).filter((it) => it.type);

  const digest = {
    items,
    at: Date.now(),
    more: Math.max(0, Number(parsed && parsed.more) || 0),
    truncated: Boolean(parsed && parsed.truncated),
    next_cursor: deriveCursor(transport, messages),
    transport,
  };
  state.setDigest(digest);
  return digest;
}

// The gate is a PATH comparison (section 5.2) and on ntfy the resurrected
// claim set carries no files[] - only task.* envelopes do. Harvesting them
// into the peer cache is what gives the PreToolUse gate anything to match on
// the zero-setup transport.
function mergeClaimFiles(state, parsed) {
  const messages = (parsed && parsed.messages) || [];
  const byKey = new Map();
  for (const m of messages) {
    const env = m.envelope || {};
    const b = env.body || {};
    if (!/^task\./.test(String(env.type || ''))) continue;
    const key = b.subject_key;
    if (!key) continue;
    const files = [].concat(Array.isArray(b.files) ? b.files : [], Array.isArray(b.files_added) ? b.files_added : []);
    if (!files.length) continue;
    const set = byKey.get(key) || new Set();
    for (const f of files) {
      if (typeof f !== 'string' || !f) continue;
      // A claimed path is peer-authored text that the gate later prints.
      const clean = escape.escapeField('path', f, { singleLine: true });
      if (clean) set.add(clean);
    }
    byKey.set(key, set);
  }
  if (!byKey.size) return 0;

  const peers = state.getPeers();
  let touched = 0;
  const claims = (peers.claims || []).map((c) => {
    const extra = byKey.get(c.subject_key);
    if (!extra) return c;
    const merged = new Set(Array.isArray(c.files) ? c.files : []);
    for (const f of extra) merged.add(f);
    touched++;
    return Object.assign({}, c, { files: [...merged].slice(0, 64) });   // section 2.5 cap
  });
  state.setPeers(Object.assign({}, peers, { claims }));
  return touched;
}

// PROTOCOL section 5.3 restart recovery: re-adopt this member's own still-live
// claims rather than re-claiming them as new, PRESERVING the original
// acquired_at, because that value is the tiebreak input (section 5.4).
function reconcileOwnClaims(state, parsed, cfg, now) {
  const t = Number.isInteger(now) ? now : Date.now();
  const me = cfg && cfg.member;
  const presence = (parsed && parsed.presence) || {};
  const live = (presence.claims || []).filter((c) => (c.owner || c.member || c.member_id) === me);
  if (!me || !live.length) return { readopted: 0, live: live.length, rewound: 0 };

  const before = new Map(state.getOwnClaims(t).map((c) => [c.subject_key, c]));
  let readopted = 0;
  let rewound = 0;
  for (const c of live) {
    const key = c.subject_key;
    if (!key) continue;
    const local = before.get(key);
    const remote = Number(c.acquired_at) || t;
    // addOwnClaim() keeps the LOCAL acquired_at when the key already exists.
    // If the transport remembers an earlier acquisition than local state does,
    // the earlier one is the true original, so the local row is dropped first
    // rather than allowed to win with a later timestamp.
    if (local && Number(local.acquired_at) > remote) { state.removeOwnClaim(key); rewound++; }
    const files = Array.isArray(c.files) ? c.files.slice(0, 64) : undefined;
    state.addOwnClaim({
      subject: c.subject || key, subject_key: key,
      ttl: Number(c.ttl) || 7200, acquired_at: remote, files,
    });
    if (!local) readopted++;
  }
  return { readopted, live: live.length, rewound };
}

// One bounded network round: refresh the peer cache and the digest cache.
// Never throws - a transport failure is silent by design (section 10.1) and
// the CLI has already applied the taxonomy on its side.
async function refresh(state, found, opts) {
  const o = opts || {};
  const transport = o.transport || 'ntfy';
  const res = await C.runCli(['sync', '--json', '--limit', String(o.limit || 20)], {
    cwd: (found && found.root) || process.cwd(),
    capture: true,
    timeoutMs: o.timeoutMs || 7000,
  });
  const parsed = C.parseJsonStdout(res.stdout);
  if (!parsed || parsed.offline) return { ok: false, offline: Boolean(parsed && parsed.offline) };
  const digest = writeDigest(state, transport, parsed);
  const merged = mergeClaimFiles(state, parsed);
  return { ok: true, parsed, digest, merged };
}

// The relay cursor is a separate owner-authorized endpoint ([R4]); the
// synchronous injection hook advances the LOCAL watermark and leaves a flag,
// and the next async tick pushes it. That keeps UserPromptSubmit at zero
// network without losing the server-side cursor.
async function commitPendingCursor(state, found, transport) {
  if (transport !== 'relay') return { skipped: true };
  const cfg = state.read();
  if (!cfg.pending_cursor_commit) return { skipped: true };
  const res = await C.runCli(['cursor', '--commit'], {
    cwd: (found && found.root) || process.cwd(), timeoutMs: 6000,
  });
  if (res.ok) state.update((s) => { delete s.pending_cursor_commit; return s; });
  return { committed: res.ok };
}

module.exports = {
  summarize, deriveCursor, writeDigest, mergeClaimFiles, reconcileOwnClaims,
  refresh, commitPendingCursor,
};
