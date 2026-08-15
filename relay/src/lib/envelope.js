// Envelope shape validation.
//
// PROTOCOL section 2.1: clients send {v, ws, from, type, body, ts, nonce,
// sender_seq, sig}. The relay validates SHAPE, ts freshness and the workspace
// binding only. It does NOT verify `sig` in v1 — the HMAC is end-to-end
// between clients — and it must never strip or rewrite any field it does not
// understand (`enc`/`alg` are reserved for a later version).

export const ENVELOPE_VERSION = 1;
export const MAX_BODY_BYTES = 2048;
export const MAX_ENVELOPE_BYTES = 8192;
export const TS_SKEW_MS = 5 * 60 * 1000;

const TYPE_RE = /^[a-z][a-z0-9]{0,15}\.[a-z][a-z0-9_]{0,31}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{8,128}$/;
const FROM_FIELDS = Object.freeze(['member', 'machine', 'session']);

// PROTOCOL section 3.1, carriage per transport: on the relay these four ARE
// the server's own state, reached through their own endpoints, and are never
// envelopes. The catalog is otherwise open here on purpose (Appendix B B3):
// forward compatibility lives at the transport, semantics live at the client.
const TYPES_NOT_CARRIED = Object.freeze(['presence.update', 'task.claim', 'task.release', 'state.request']);

export function isCarriedByRelay(type) {
  return !TYPES_NOT_CARRIED.includes(type);
}

// `ts` units are not settled by the M1 freeze yet. Anything below 1e11 cannot
// be a millisecond stamp from this century (1e11 ms = 1973), so it is read as
// seconds; everything else as milliseconds.
export function normalizeTs(ts) {
  if (!Number.isInteger(ts) || ts <= 0) return null;
  return ts < 1e11 ? ts * 1000 : ts;
}

function byteLength(value) {
  return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value ?? null)).length;
}

// `ws` is the workspace id the envelope was addressed to. It is REQUIRED here:
// the field sits inside the signed canonical serialization (PROTOCOL section
// 2.2), so an envelope carrying a different id was signed for a different
// workspace and cannot legitimately land in this one.
export function validateEnvelope(envelope, now, ws) {
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { ok: false, code: 'envelope_missing' };
  }
  if (envelope.v !== ENVELOPE_VERSION) return { ok: false, code: 'envelope_version' };
  // Fails closed when no expected id is supplied: with nothing to match
  // against there is no way to tell a cross-workspace replay from a local one.
  if (typeof ws !== 'string' || typeof envelope.ws !== 'string' || envelope.ws !== ws) {
    return { ok: false, code: 'envelope_ws' };
  }
  if (typeof envelope.type !== 'string' || !TYPE_RE.test(envelope.type)) {
    return { ok: false, code: 'envelope_type' };
  }
  if (!('body' in envelope) || envelope.body === undefined) return { ok: false, code: 'envelope_body_missing' };
  if (byteLength(envelope.body) > MAX_BODY_BYTES) return { ok: false, code: 'envelope_body_too_large' };
  const ts = normalizeTs(envelope.ts);
  if (ts === null) return { ok: false, code: 'envelope_ts' };
  if (Math.abs(now - ts) > TS_SKEW_MS) {
    return { ok: false, code: 'envelope_ts_skew', skew_ms: now - ts, window_ms: TS_SKEW_MS };
  }
  if (typeof envelope.nonce !== 'string' || !NONCE_RE.test(envelope.nonce)) {
    return { ok: false, code: 'envelope_nonce' };
  }
  // Per-sender dedupe counter. Named `sender_seq` because the relay assigns a
  // `seq` of its own to every stored message and the two are different numbers
  // (PROTOCOL section 2.6).
  if (!Number.isInteger(envelope.sender_seq) || envelope.sender_seq < 0) {
    return { ok: false, code: 'envelope_sender_seq' };
  }
  if (typeof envelope.sig !== 'string' || envelope.sig.length < 1 || envelope.sig.length > 512) {
    return { ok: false, code: 'envelope_sig' };
  }
  // `from` is REQUIRED and complete (PROTOCOL section 2.1): all three parts are
  // inside the canonical serialization, so an envelope missing any of them
  // cannot be verified by the receiver that ultimately has to check the HMAC.
  const from = envelope.from;
  if (from === null || typeof from !== 'object' || Array.isArray(from)) {
    return { ok: false, code: 'envelope_from' };
  }
  for (const field of FROM_FIELDS) {
    if (typeof from[field] !== 'string' || from[field].length === 0) {
      return { ok: false, code: 'envelope_from' };
    }
  }
  if (byteLength(envelope) > MAX_ENVELOPE_BYTES) return { ok: false, code: 'envelope_too_large' };
  return { ok: true, ts };
}

export function isPriorityType(type) {
  return typeof type === 'string' && (type.startsWith('warn.') || type === 'note.blocker');
}
