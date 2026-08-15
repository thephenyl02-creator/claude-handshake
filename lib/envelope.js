'use strict';
// claude-handshake M4: envelope canonicalization, key derivation, signing and
// the ntfy encrypted form.
//
// Normative source: docs/PROTOCOL.md sections 2.1-2.6 (fields, canonical
// serialization, signing, body-encryption key, validity limits, dedupe) and
// section 9.3 (ntfy encrypted wire form). Appendix A conformance vectors are
// reproduced byte-for-byte by test/envelope.test.js.
//
// Node stdlib only. No npm dependencies, ever (PLAN section 4).

const crypto = require('crypto');
const { sendGate } = require('./outbound');

// -------------------------------------------------------------- constants --

const PROTOCOL_VERSION = 1;
const MAX_BODY_BYTES = 2048;        // PROTOCOL section 2.5
const MAX_ENVELOPE_BYTES = 8192;    // PROTOCOL section 2.5
const TS_SKEW_MS = 5 * 60 * 1000;   // PROTOCOL section 2.5, +/- 300000 ms

const TYPE_RE = /^[a-z][a-z0-9]{0,15}\.[a-z][a-z0-9_]{0,31}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{8,128}$/;
const KEY_RE = /^[a-z][a-z0-9_]*$/;     // PROTOCOL section 2.1
const SIG_RE = /^[0-9a-f]{64}$/;
const WS_RE = /^[0-9a-f]{32}$/;

const HKDF_INFO_SIG = 'claude-handshake/v1 sig';    // PROTOCOL section 2.3
const HKDF_INFO_ENC = 'claude-handshake/v1 body';   // PROTOCOL section 2.4

// The eight signed fields, in canonical (code-point ascending) order.
const SIGNED_FIELDS = Object.freeze([
  'body', 'from', 'nonce', 'sender_seq', 'ts', 'type', 'v', 'ws',
]);
// ntfy section 9.3: which of the eight travel in the clear, which are hidden.
const NTFY_CLEAR_FIELDS = Object.freeze(['sender_seq', 'ts', 'v', 'ws']);
const NTFY_HIDDEN_FIELDS = Object.freeze(['body', 'from', 'nonce', 'type']);

// PROTOCOL section 3: closed catalog for v1 SENDERS. Receivers ignore unknown
// types silently (and count them) so a v2 peer degrades rather than breaks.
const TYPES = Object.freeze([
  'presence.update', 'task.claim', 'task.release', 'task.done', 'task.change',
  'note.discovery', 'note.error', 'note.fix', 'note.blocker', 'note.info',
  'warn.overlap', 'ws.join', 'ws.leave', 'ws.migrate', 'state.request',
]);

// PROTOCOL section 3.1: on the relay these four are server-state endpoints and
// MUST NOT be posted as envelopes (Appendix B A6 enforces it server-side too).
const RELAY_NON_CARRIED_TYPES = Object.freeze([
  'presence.update', 'task.claim', 'task.release', 'state.request',
]);

function isPriorityType(type) {
  return typeof type === 'string' && (type.startsWith('warn.') || type === 'note.blocker');
}

// ------------------------------------------- canonical serialization (2.2) --

function canonicalString(s) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    // Lone surrogates MUST NOT appear (section 2.2 rule 7).
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new CanonicalError('lone_surrogate');
      out += s[i] + s[i + 1];
      i++;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) throw new CanonicalError('lone_surrogate');
    const ch = s[i];
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (code === 0x08) out += '\\b';
    else if (code === 0x0c) out += '\\f';
    else if (code === 0x0a) out += '\\n';
    else if (code === 0x0d) out += '\\r';
    else if (code === 0x09) out += '\\t';
    else if (code <= 0x1f) out += '\\u' + code.toString(16).padStart(4, '0');
    // Everything else - including '/', U+007F and every non-ASCII character -
    // is emitted literally as UTF-8.
    else out += ch;
  }
  return out + '"';
}

class CanonicalError extends Error {
  constructor(code) {
    super('canonicalization failed: ' + code);
    this.name = 'CanonicalError';
    this.code = code;
  }
}

// Deterministic JSON per PROTOCOL section 2.2. Never transmitted; both sides
// recompute it.
function canonicalJson(value) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') {
    // Section 2.1: all numbers MUST be integers; -0 MUST NOT appear.
    if (!Number.isInteger(value)) throw new CanonicalError('non_integer_number');
    if (Object.is(value, -0)) throw new CanonicalError('negative_zero');
    return String(value);
  }
  if (t === 'string') return canonicalString(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (t === 'object') {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)   // rule 5: omit absent values
      .sort();                                  // rule 3: code-point ascending
    for (const k of keys) {
      if (!KEY_RE.test(k)) throw new CanonicalError('bad_key:' + k);
    }
    return '{' + keys.map((k) => canonicalString(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  }
  throw new CanonicalError('unsupported_type:' + t);
}

function pick(obj, fields) {
  const out = {};
  for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f];
  return out;
}

// The HMAC input: UTF-8 bytes of the canonical serialization of exactly the
// eight signed fields. sig/alg/enc/ct and unknown fields are excluded.
function canonicalBytes(envelope) {
  return Buffer.from(canonicalJson(pick(envelope, SIGNED_FIELDS)), 'utf8');
}

// ---------------------------------------------------- key derivation (2.3) --

// secret: 32 raw bytes (Buffer) or the base64url form stored in workspace.json.
function secretBytes(secret) {
  if (Buffer.isBuffer(secret)) return secret;
  if (typeof secret === 'string') return Buffer.from(secret, 'base64url');
  throw new TypeError('workspace secret must be a Buffer or base64url string');
}

function deriveKey(secret, ws, info) {
  const ikm = secretBytes(secret);
  if (ikm.length !== 32) throw new RangeError('workspace secret must be 32 bytes');
  // salt = ASCII bytes of the workspace id (32 bytes).
  return Buffer.from(crypto.hkdfSync('sha256', ikm, Buffer.from(ws, 'ascii'), Buffer.from(info, 'utf8'), 32));
}

function deriveKeys(secret, ws) {
  return {
    kSig: deriveKey(secret, ws, HKDF_INFO_SIG),
    kEnc: deriveKey(secret, ws, HKDF_INFO_ENC),
  };
}

function newSecret() {
  return crypto.randomBytes(32);
}

function newNonce() {
  // 16 bytes as base64url unpadded = 22 chars (PROTOCOL section 2.1).
  return crypto.randomBytes(16).toString('base64url');
}

// -------------------------------------------------------- signing (2.3) ----

function signBytes(kSig, bytes) {
  return crypto.createHmac('sha256', kSig).update(bytes).digest('hex');
}

function sign(envelope, kSig) {
  return signBytes(kSig, canonicalBytes(envelope));
}

// Constant-time comparison (PROTOCOL section 2.3 MUST). Length is fixed at 64
// hex chars, so an early length return leaks nothing an attacker can use.
function verify(envelope, kSig) {
  try {
    const got = envelope && envelope.sig;
    if (typeof got !== 'string' || !SIG_RE.test(got)) return false;
    const want = sign(envelope, kSig);
    const a = Buffer.from(got, 'utf8');
    const b = Buffer.from(want, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;   // fail closed: an unserializable envelope never verifies
  }
}

// ------------------------------------------------- outbound field gating ----

// SECURITY.md section 4: EVERY outbound field is filter input - presence notes,
// branch names, files[], claim subjects, not just note bodies.
//
// What is gated: everything a human or a model authored. What is deliberately
// NOT gated: protocol machinery this client generates itself (`ws`, `nonce`,
// `sig`, `ct`, machine/session pseudonyms). Those are 128-bit random hex by
// construction, so the filter's high-entropy heuristic would refuse every
// message ever sent, and they carry no user data to disclose. `from.member` IS
// gated because on ntfy it is the self-assigned member name (PROTOCOL section 1).
function authoredFields(type, body, from) {
  const f = {};
  const b = body || {};
  const put = (k, v) => { if (v !== undefined && v !== null) f[k] = v; };

  if (from && typeof from.member === 'string') put('from_member', from.member);

  switch (type) {
    case 'presence.update':
      put('note', b.note);
      put('branch', b.branch);
      if (b.tooling) put('tooling_reason', b.tooling.reason);
      if (Array.isArray(b.claims)) {
        put('claims_subjects', b.claims.map((c) => String(c && c.subject)));
        put('claims_keys', b.claims.map((c) => String(c && c.subject_key)));
      }
      break;
    case 'task.claim':
      put('subject', b.subject); put('subject_key', b.subject_key); put('files', b.files);
      break;
    case 'task.release':
      put('subject', b.subject); put('subject_key', b.subject_key);
      break;
    case 'task.done':
      put('subject', b.subject); put('subject_key', b.subject_key);
      put('summary', b.summary); put('files', b.files);
      break;
    case 'task.change':
      put('subject', b.subject); put('subject_key', b.subject_key);
      put('note', b.note); put('files_added', b.files_added);
      break;
    case 'warn.overlap':
      put('subject', b.subject); put('subject_key', b.subject_key);
      put('peer_member', b.peer_member);
      put('peer_subject', b.peer_subject); put('peer_subject_key', b.peer_subject_key);
      put('paths', b.paths);
      break;
    case 'ws.join':
      put('member_name', b.member_name); put('display_name', b.display_name);
      put('client', b.client);
      break;
    case 'ws.leave':
      put('summary', b.summary); put('open_claims', b.open_claims);
      break;
    case 'ws.migrate':
      put('name', b.name); put('endpoint', b.endpoint);
      break;
    case 'state.request':
      break;                                  // {want} is a closed enum
    default:
      if (type && type.startsWith('note.')) {
        put('text', b.text); put('paths', b.paths);
        put('subject', b.subject); put('subject_key', b.subject_key);
      }
      break;
  }
  return f;
}

// The mandatory chokepoint. Throws FilterViolation (lib/outbound.js) on a hit.
function gate(type, body, from, filterOpts) {
  return sendGate(authoredFields(type, body, from), filterOpts);
}

// ------------------------------------------------------------- building -----

// Build a fully-signed envelope. Every construction path in this client goes
// through here, which is what makes the sendGate chokepoint real.
function build(params) {
  const { ws, from, type, body, kSig } = params;
  const ts = params.ts === undefined ? Date.now() : params.ts;
  const nonce = params.nonce === undefined ? newNonce() : params.nonce;
  const senderSeq = params.sender_seq !== undefined ? params.sender_seq : params.senderSeq;

  if (!TYPES.includes(type)) {
    // Section 3: the catalog is closed for v1 senders.
    throw new Error('refusing to originate a type outside the v1 catalog: ' + type);
  }
  if (!Number.isInteger(senderSeq)) throw new Error('sender_seq is required and must be an integer (PROTOCOL 2.6)');
  if (!from || typeof from.member !== 'string' || !from.member.length) {
    throw new Error('from.member is required - join the workspace first (PROTOCOL 2.1)');
  }
  gate(type, body, from, params.filterOpts);

  const envelope = {
    v: PROTOCOL_VERSION, ws, from, type, body, ts, nonce, sender_seq: senderSeq,
  };
  if (params.alg) envelope.alg = params.alg;
  envelope.sig = sign(envelope, kSig);
  const bodyBytes = Buffer.byteLength(canonicalJson(body), 'utf8');
  if (bodyBytes > MAX_BODY_BYTES) throw new Error('body exceeds ' + MAX_BODY_BYTES + ' bytes');
  if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > MAX_ENVELOPE_BYTES) {
    throw new Error('envelope exceeds ' + MAX_ENVELOPE_BYTES + ' bytes');
  }
  return envelope;
}

// Re-sign a queued envelope with a current ts, a fresh nonce and a NEW
// sender_seq rather than backdating (PROTOCOL section 10.3).
function resign(envelope, { kSig, ts, senderSeq }) {
  const fresh = Object.assign({}, envelope, {
    ts: ts === undefined ? Date.now() : ts,
    nonce: newNonce(),
    sender_seq: senderSeq,
  });
  delete fresh.sig;
  delete fresh.enc;
  delete fresh.ct;
  fresh.sig = sign(fresh, kSig);
  return fresh;
}

// ----------------------------------------------------------- validation ----

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Recursively enforce section 2.1: key charset, integers only, no functions.
function structureCode(value, depth) {
  if (depth > 8) return 'envelope_too_deep';
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isInteger(value) ? null : 'envelope_non_integer';
  if (Array.isArray(value)) {
    for (const v of value) { const c = structureCode(v, depth + 1); if (c) return c; }
    return null;
  }
  if (isPlainObject(value)) {
    for (const k of Object.keys(value)) {
      if (!KEY_RE.test(k)) return 'envelope_key_charset';
      const c = structureCode(value[k], depth + 1); if (c) return c;
    }
    return null;
  }
  return 'envelope_unsupported_value';
}

// Shape + freshness validation. Returns {ok:true} or {ok:false, code, kind}.
// `kind` follows the section 10 taxonomy: everything here is a loud rejection.
function validate(envelope, opts) {
  const o = opts || {};
  const now = o.now === undefined ? Date.now() : o.now;
  if (!isPlainObject(envelope)) return { ok: false, code: 'envelope_missing', kind: 'loud' };
  if (envelope.v !== PROTOCOL_VERSION) {
    // Section 11: v > 1 is a discard-and-count, surfaced once per session.
    return {
      ok: false,
      code: Number.isInteger(envelope.v) && envelope.v > PROTOCOL_VERSION ? 'envelope_version_newer' : 'envelope_version',
      kind: 'loud',
    };
  }
  if (typeof envelope.ws !== 'string' || !envelope.ws.length) return { ok: false, code: 'envelope_ws', kind: 'loud' };
  if (o.ws !== undefined && envelope.ws !== o.ws) return { ok: false, code: 'envelope_ws', kind: 'loud' };
  if (typeof envelope.type !== 'string' || !TYPE_RE.test(envelope.type)) {
    return { ok: false, code: 'envelope_type', kind: 'loud' };
  }
  if (!isPlainObject(envelope.from)) return { ok: false, code: 'envelope_from', kind: 'loud' };
  for (const k of ['member', 'machine', 'session']) {
    // Appendix B A2: from is REQUIRED with all three parts, all strings.
    if (typeof envelope.from[k] !== 'string' || !envelope.from[k].length) {
      return { ok: false, code: 'envelope_from', kind: 'loud' };
    }
  }
  if (!isPlainObject(envelope.body)) return { ok: false, code: 'envelope_body_missing', kind: 'loud' };
  if (!Number.isInteger(envelope.ts) || envelope.ts <= 0) return { ok: false, code: 'envelope_ts', kind: 'loud' };
  if (Math.abs(now - envelope.ts) > TS_SKEW_MS) {
    return { ok: false, code: 'envelope_ts_skew', kind: 'loud', skew_ms: now - envelope.ts };
  }
  if (typeof envelope.nonce !== 'string' || !NONCE_RE.test(envelope.nonce)) {
    return { ok: false, code: 'envelope_nonce', kind: 'loud' };
  }
  if (!Number.isInteger(envelope.sender_seq) || envelope.sender_seq < 0) {
    return { ok: false, code: 'envelope_sender_seq', kind: 'loud' };
  }
  if (typeof envelope.sig !== 'string' || !SIG_RE.test(envelope.sig)) {
    return { ok: false, code: 'envelope_sig', kind: 'loud' };
  }
  if (envelope.alg !== undefined && envelope.alg !== 'HS256') {
    return { ok: false, code: 'envelope_alg', kind: 'loud' };
  }
  const structure = structureCode(pick(envelope, SIGNED_FIELDS), 0);
  if (structure) return { ok: false, code: structure, kind: 'loud' };
  if (Buffer.byteLength(JSON.stringify(envelope.body), 'utf8') > MAX_BODY_BYTES) {
    return { ok: false, code: 'envelope_body_too_large', kind: 'loud' };
  }
  if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > MAX_ENVELOPE_BYTES) {
    return { ok: false, code: 'envelope_too_large', kind: 'loud' };
  }
  return { ok: true };
}

// The full receive pipeline: shape -> signature -> dedupe (section 2.6).
// `dedupe` is any object with has(member, seq)/add(member, seq, nonce).
function accept(envelope, opts) {
  const shape = validate(envelope, opts);
  if (!shape.ok) return shape;
  if (!verify(envelope, opts.kSig)) {
    return { ok: false, code: 'signature_invalid', kind: 'loud' };
  }
  if (opts.dedupe && opts.dedupe.has(envelope.from.member, envelope.sender_seq, envelope.nonce)) {
    // A duplicate is expected traffic (offline-queue replay), not a failure.
    return { ok: false, code: 'duplicate', kind: 'ignore' };
  }
  if (opts.dedupe) opts.dedupe.add(envelope.from.member, envelope.sender_seq, envelope.nonce);
  if (!TYPES.includes(envelope.type)) {
    // Section 3: receivers ignore unknown types silently, and count them.
    return { ok: false, code: 'unknown_type', kind: 'ignore' };
  }
  return { ok: true };
}

// --------------------------------------------- ntfy encrypted form (9.3) ----

// plaintext = canonical serialization of {body, from, nonce, type}
// aad       = canonical serialization of {sender_seq, ts, v, ws}
// ct        = base64url( iv || AES-256-GCM ciphertext || 16-byte tag )
function encryptForNtfy(envelope, kEnc, ivOverride) {
  const plaintext = Buffer.from(canonicalJson(pick(envelope, NTFY_HIDDEN_FIELDS)), 'utf8');
  const aad = Buffer.from(canonicalJson(pick(envelope, NTFY_CLEAR_FIELDS)), 'utf8');
  const iv = ivOverride || crypto.randomBytes(12);   // fresh per message; never reused
  if (iv.length !== 12) throw new RangeError('iv must be 12 bytes');
  const cipher = crypto.createCipheriv('aes-256-gcm', kEnc, iv);
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const ct = Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64url');
  const wire = {
    v: envelope.v, ws: envelope.ws, ts: envelope.ts, sender_seq: envelope.sender_seq,
    alg: envelope.alg || 'HS256', enc: 'A256GCM', sig: envelope.sig, ct,
  };
  return wire;
}

// Receive order (section 9.3): decrypt (authenticating the AAD) -> reassemble
// -> verify sig -> freshness/dedupe. A failure at any step discards.
function decryptFromNtfy(wire, kEnc) {
  if (!isPlainObject(wire)) throw new Error('ntfy_wire_missing');
  if (wire.enc !== 'A256GCM') throw new Error('ntfy_enc_unsupported');
  if (typeof wire.ct !== 'string') throw new Error('ntfy_ct_missing');
  const raw = Buffer.from(wire.ct, 'base64url');
  if (raw.length < 12 + 16) throw new Error('ntfy_ct_short');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const body = raw.subarray(12, raw.length - 16);
  const aad = Buffer.from(canonicalJson(pick(wire, NTFY_CLEAR_FIELDS)), 'utf8');
  const decipher = crypto.createDecipheriv('aes-256-gcm', kEnc, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  const hidden = JSON.parse(plaintext);
  if (!isPlainObject(hidden)) throw new Error('ntfy_plaintext_shape');
  const envelope = {
    v: wire.v, ws: wire.ws,
    from: hidden.from, type: hidden.type, body: hidden.body,
    ts: wire.ts, nonce: hidden.nonce, sender_seq: wire.sender_seq,
  };
  if (wire.alg && wire.alg !== 'HS256') throw new Error('ntfy_alg_unsupported');
  envelope.sig = wire.sig;
  return envelope;
}

module.exports = {
  PROTOCOL_VERSION, MAX_BODY_BYTES, MAX_ENVELOPE_BYTES, TS_SKEW_MS,
  TYPE_RE, NONCE_RE, KEY_RE, SIG_RE, WS_RE,
  HKDF_INFO_SIG, HKDF_INFO_ENC,
  SIGNED_FIELDS, NTFY_CLEAR_FIELDS, NTFY_HIDDEN_FIELDS,
  TYPES, RELAY_NON_CARRIED_TYPES, isPriorityType,
  CanonicalError, canonicalJson, canonicalBytes,
  deriveKeys, deriveKey, secretBytes, newSecret, newNonce,
  sign, signBytes, verify,
  authoredFields, gate, build, resign,
  validate, accept,
  encryptForNtfy, decryptFromNtfy,
};
