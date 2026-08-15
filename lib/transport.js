'use strict';
// claude-handshake M4: pieces both transport adapters share.
//
// The adapter interface is frozen in PROTOCOL section 9.1:
//
//   publish(envelope)      -> {handle}          // relay seq | ntfy message_id
//   fetch(cursor, limit)   -> {messages, cursor, more}
//   presence()             -> {members, presence, claims}
//   commitCursor(cursor)   -> {cursor}
//   capabilities()         -> {authenticated_from, server_claims, durable_layer,
//                              encrypts_body, keepalive_seconds, cursor_kind}
//
// capabilities() is what makes the honesty rules of section 10.2 mechanical
// rather than editorial, so it is returned verbatim in that shape.

// PROTOCOL section 6.1
const SYNC_FETCH_CAP = 20;
const RESERVED_PRIORITY_SLOTS = 5;
const SYNC_CANDIDATE_WINDOW = 200;

// PROTOCOL section 4.3 keepalive intervals
const KEEPALIVE_RELAY_SECONDS = 60;
const KEEPALIVE_NTFY_SECONDS = 600;
const GONE_AFTER_MS = 7200 * 1000;   // the default claim TTL

// -------------------------------------------------- failure taxonomy (10) --

// Two classes, and nothing in between (PROTOCOL section 10).
class TransportError extends Error {
  constructor(kind, code, message, extra) {
    super(message || code);
    this.name = 'TransportError';
    this.kind = kind;              // 'silent' | 'loud'
    this.code = code;
    Object.assign(this, extra || {});
  }
}

// section 10.2: the enumerated loud set.
const LOUD_STATUS = new Set([401, 403, 429]);

function classifyStatus(status, code) {
  if (status === 404 && code === 'workspace_not_found') return 'loud';
  if (LOUD_STATUS.has(status)) return 'loud';
  if (status === 400 && typeof code === 'string' && code.startsWith('envelope_')) return 'loud';
  if (status === 409) return 'expected';       // claim_conflict is normal traffic
  if (status >= 500) return 'silent';          // 5xx is "offline as designed"
  if (status === 404) return 'silent';         // an unknown path is not a credential problem
  if (status >= 400) return 'loud';            // anything else the server refused
  return null;
}

// section 10.1: DNS failure, connection refused, TLS failure, timeout, no
// network. The client MUST NOT interrupt the user; peers see it go quiet.
function silentError(err, code) {
  return new TransportError('silent', code || 'unreachable', String(err && err.message || err), { cause: err });
}

function loudError(code, message, extra) {
  return new TransportError('loud', code, message, extra);
}

// ------------------------------------------------- reader-side staleness ---

// PROTOCOL section 4.3. Labels are reader-side only; a client MUST NOT put
// them in an envelope.
function presenceLabel(ageMs, keepaliveSeconds) {
  const K = Number(keepaliveSeconds) * 1000;
  if (ageMs > GONE_AFTER_MS) return 'gone';
  if (ageMs <= 2.5 * K) return 'live';
  if (ageMs <= 6 * K) return 'quiet';
  return 'stale';
}

// ------------------------------------------------ per-sender-fair selection -

// PROTOCOL section 6.1, reproducing relay/src/lib/fairness.js exactly: one
// chatty peer must not be able to bury a quiet peer's warn.overlap or
// note.blocker. Sender order within a round is by each sender's OLDEST pending
// item - deterministic, never Map insertion order.
//
// candidates: [{order, sender, type, ...}] sorted by `order` ascending.
function roundRobin(items, budget, taken) {
  const groups = new Map();
  // The relay's version documents "candidates sorted by seq ascending" as a
  // precondition. Sorting a copy here makes the determinism unconditional
  // rather than a property of the caller, which matters on ntfy where the
  // candidate list is assembled client-side from an NDJSON stream.
  const sorted = items.slice().sort((a, b) => a.order - b.order);
  for (const item of sorted) {
    if (taken.has(item.order)) continue;
    let group = groups.get(item.sender);
    if (!group) groups.set(item.sender, (group = []));
    group.push(item);
  }
  const order = [...groups.values()].sort((a, b) => a[0].order - b[0].order);
  const out = [];
  for (let round = 0; out.length < budget; round++) {
    let progressed = false;
    for (const group of order) {
      if (out.length >= budget) break;
      if (group.length > round) { out.push(group[round]); progressed = true; }
    }
    if (!progressed) break;
  }
  return out;
}

function isPriorityType(type) {
  return typeof type === 'string' && (type.startsWith('warn.') || type === 'note.blocker');
}

function selectFair(candidates, cap, reserved) {
  const capN = cap === undefined ? SYNC_FETCH_CAP : cap;
  const reservedN = reserved === undefined ? RESERVED_PRIORITY_SLOTS : reserved;
  const taken = new Set();
  const chosen = [];
  const priority = candidates.filter((c) => isPriorityType(c.type));
  const floor = Math.min(reservedN, capN);
  for (const item of roundRobin(priority, floor, taken)) { taken.add(item.order); chosen.push(item); }
  for (const item of roundRobin(candidates, capN - chosen.length, taken)) { taken.add(item.order); chosen.push(item); }
  chosen.sort((a, b) => a.order - b.order);
  return chosen;
}

// ------------------------------------------------------------ http helper --

// One place that turns fetch() outcomes into the section 10 taxonomy. Network
// failures are silent; refusals are classified by status.
async function httpJson(fetchImpl, url, init, opts) {
  const o = opts || {};
  const timeoutMs = o.timeoutMs || 10000;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let res;
  try {
    res = await fetchImpl(url, Object.assign({}, init, controller ? { signal: controller.signal } : {}));
  } catch (err) {
    throw silentError(err, 'network_unreachable');
  } finally {
    if (timer) clearTimeout(timer);
  }
  const text = await res.text().catch(() => '');
  let json = null;
  if (text) { try { json = JSON.parse(text); } catch (_) { json = null; } }
  if (!res.ok) {
    const code = (json && (json.error || json.code)) || ('http_' + res.status);
    const kind = classifyStatus(res.status, code);
    if (kind === 'silent') throw silentError(new Error(code), code);
    if (kind === 'expected') {
      const e = new TransportError('expected', code, code, { status: res.status, body: json });
      throw e;
    }
    throw loudError(code, code, { status: res.status, body: json });
  }
  return { status: res.status, json, text };
}

module.exports = {
  SYNC_FETCH_CAP, RESERVED_PRIORITY_SLOTS, SYNC_CANDIDATE_WINDOW,
  KEEPALIVE_RELAY_SECONDS, KEEPALIVE_NTFY_SECONDS, GONE_AFTER_MS,
  TransportError, classifyStatus, silentError, loudError,
  presenceLabel, selectFair, roundRobin, isPriorityType, httpJson,
};
