// Envelope shape validation.
//
// PLAN section 2: clients send {v, type, body, ts, nonce, seq, sig}. The relay
// validates SHAPE and ts freshness only. It does NOT verify `sig` in v1 — the
// HMAC is end-to-end between clients — and it must never strip or rewrite any
// field it does not understand (`enc`/`alg` are reserved for a later version).

export const ENVELOPE_VERSION = 1;
export const MAX_BODY_BYTES = 2048;
export const MAX_ENVELOPE_BYTES = 8192;
export const TS_SKEW_MS = 5 * 60 * 1000;

const TYPE_RE = /^[a-z][a-z0-9]{0,15}\.[a-z][a-z0-9_]{0,31}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{8,128}$/;

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

export function validateEnvelope(envelope, now) {
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { ok: false, code: 'envelope_missing' };
  }
  if (envelope.v !== ENVELOPE_VERSION) return { ok: false, code: 'envelope_version' };
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
  if (!Number.isInteger(envelope.seq) || envelope.seq < 0) return { ok: false, code: 'envelope_seq' };
  if (typeof envelope.sig !== 'string' || envelope.sig.length < 1 || envelope.sig.length > 512) {
    return { ok: false, code: 'envelope_sig' };
  }
  if ('from' in envelope) {
    const from = envelope.from;
    if (from === null || typeof from !== 'object' || Array.isArray(from) || typeof from.member !== 'string') {
      return { ok: false, code: 'envelope_from' };
    }
  }
  if (byteLength(envelope) > MAX_ENVELOPE_BYTES) return { ok: false, code: 'envelope_too_large' };
  return { ok: true, ts };
}

export function isPriorityType(type) {
  return typeof type === 'string' && (type.startsWith('warn.') || type === 'note.blocker');
}
