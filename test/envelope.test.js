'use strict';
// Conformance: PROTOCOL Appendix A, byte for byte.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const E = require('../lib/envelope');

// ---------------------------------------------------------- Appendix A ------

const SECRET = Buffer.from(Array.from({ length: 32 }, (_, i) => i));   // 0x00..0x1f
const WS = '0123456789abcdef0123456789abcdef';

const VECTOR = {
  v: 1, ws: WS,
  from: { member: '3f2a1b0c4d5e6f70', machine: 'm-7d3f9a2c', session: 's-1a2b3c4d' },
  type: 'task.claim',
  body: {
    subject: 'onboarding flow', subject_key: 'onboarding flow', ttl: 7200,
    acquired_at: 1755230000000, files: ['src/auth/login.ts'],
  },
  ts: 1755230000000,
  nonce: 'Zm9vYmFyYmF6cXV1eDEyMw',
  sender_seq: 1755229999123,
};

const CANONICAL = '{"body":{"acquired_at":1755230000000,"files":["src/auth/login.ts"],"subject":"onboarding flow","subject_key":"onboarding flow","ttl":7200},"from":{"machine":"m-7d3f9a2c","member":"3f2a1b0c4d5e6f70","session":"s-1a2b3c4d"},"nonce":"Zm9vYmFyYmF6cXV1eDEyMw","sender_seq":1755229999123,"ts":1755230000000,"type":"task.claim","v":1,"ws":"0123456789abcdef0123456789abcdef"}';
const K_SIG = '9423002550cfd15c777858d2fd3cf6bc3599ce2606249fd1600dd6f9e1922572';
const K_ENC = '922c7ece027a9f03b14701b4126fabbabb2c63a41f0997232954e2683a78e902';
const SIG = '5ab13740c6397336f3d23a74189d8961f6c22b97eba568f187f6ff4a553d9343';
const PLAINTEXT = '{"body":{"acquired_at":1755230000000,"files":["src/auth/login.ts"],"subject":"onboarding flow","subject_key":"onboarding flow","ttl":7200},"from":{"machine":"m-7d3f9a2c","member":"3f2a1b0c4d5e6f70","session":"s-1a2b3c4d"},"nonce":"Zm9vYmFyYmF6cXV1eDEyMw","type":"task.claim"}';
const AAD = '{"sender_seq":1755229999123,"ts":1755230000000,"v":1,"ws":"0123456789abcdef0123456789abcdef"}';
const CT = 'AAECAwQFBgcICQoLlOj7aUXLPPauFnZNvJZ8j_vA2sLnrAQ9Cq8nMYrhDIjDZ4Abcq79c9gMfRwNDEt52LQWp2E3udTlHxsvgKM4FdJsdg058BKbyX2L4o_0K7Dk2HlEnACaCJAv4dO-Gk5UwfkzlW9LrWRqOEsz2vObzOIsXtOVEOKSolLH1O-bGdwWgI50G187hkT-EWEfIdiiM00R6wPvQl-e5aSsksbbvEqiQp-PXGpJ9nHExwk4TKVXmhqzQT0-NXXbRP1IsiO-cNZko0GGterbZvo_BtB6y-QMOjMtQ4AlWkZNMKCQ4ed9Y2baHCpaKXDo8lCzjMDIt5J7CbI2sVFwS872JZ-hIvxqZo9SxmSLyB3Fut-Ai6SZiTluAOiCQy0qfaTaI1mEa_Gq';

test('Appendix A: canonical serialization is 367 bytes and byte-identical', () => {
  const bytes = E.canonicalBytes(VECTOR);
  assert.equal(bytes.length, 367);
  assert.equal(bytes.toString('utf8'), CANONICAL);
});

test('Appendix A: HKDF derives K_sig and K_enc exactly', () => {
  const { kSig, kEnc } = E.deriveKeys(SECRET, WS);
  assert.equal(kSig.toString('hex'), K_SIG);
  assert.equal(kEnc.toString('hex'), K_ENC);
});

test('Appendix A: the signature matches', () => {
  const { kSig } = E.deriveKeys(SECRET, WS);
  assert.equal(E.sign(VECTOR, kSig), SIG);
  assert.equal(E.verify(Object.assign({}, VECTOR, { sig: SIG }), kSig), true);
});

test('Appendix A: the ntfy encrypted form reproduces the fixed-IV ciphertext', () => {
  const { kSig, kEnc } = E.deriveKeys(SECRET, WS);
  const signed = Object.assign({}, VECTOR, { sig: E.sign(VECTOR, kSig) });
  const iv = Buffer.from(Array.from({ length: 12 }, (_, i) => i));   // 0x00..0x0b
  const wire = E.encryptForNtfy(signed, kEnc, iv);
  assert.equal(wire.ct, CT);
  assert.equal(wire.enc, 'A256GCM');
  assert.equal(wire.alg, 'HS256');
  // Only v, ws, ts, sender_seq, sig, alg, enc, ct travel in the clear.
  assert.deepEqual(Object.keys(wire).sort(), ['alg', 'ct', 'enc', 'sender_seq', 'sig', 'ts', 'v', 'ws']);
});

test('Appendix A: the hidden and cleartext canonical halves match the vector', () => {
  assert.equal(E.canonicalJson({ body: VECTOR.body, from: VECTOR.from, nonce: VECTOR.nonce, type: VECTOR.type }), PLAINTEXT);
  assert.equal(E.canonicalJson({ sender_seq: VECTOR.sender_seq, ts: VECTOR.ts, v: VECTOR.v, ws: VECTOR.ws }), AAD);
});

// ------------------------------------------------ canonicalization rules ----

test('canonical: keys are code-point ascending at every level', () => {
  const s = E.canonicalJson({ z: 1, a: { y: 2, b: 3 }, m: [3, 1] });
  assert.equal(s, '{"a":{"b":3,"y":2},"m":[3,1],"z":1}');
});

test('canonical: undefined keys are omitted, explicit null is emitted', () => {
  assert.equal(E.canonicalJson({ a: undefined, b: null }), '{"b":null}');
});

test('canonical: only ", \\ and C0 are escaped; / and non-ASCII stay literal', () => {
  assert.equal(E.canonicalJson('a/b'), '"a/b"');
  assert.equal(E.canonicalJson('café '), '"café "');
  assert.equal(E.canonicalJson('a"b\\c'), '"a\\"b\\\\c"');
  assert.equal(E.canonicalJson('\n\t\r\b\f'), '"\\n\\t\\r\\b\\f"');
  assert.equal(E.canonicalJson(''), '"\\u0001"');
});

test('canonical: non-integer numbers, -0 and bad keys are refused', () => {
  assert.throws(() => E.canonicalJson({ a: 1.5 }), /non_integer_number/);
  assert.throws(() => E.canonicalJson({ a: -0 }), /negative_zero/);
  assert.throws(() => E.canonicalJson({ Bad: 1 }), /bad_key/);
});

test('canonical: a lone surrogate is refused', () => {
  assert.throws(() => E.canonicalJson('\ud800'), /lone_surrogate/);
  assert.equal(E.canonicalJson('😀'), '"😀"');
});

test('canonical: sig, alg, enc, ct and unknown fields are outside the signature', () => {
  const noisy = Object.assign({}, VECTOR, { sig: 'x', alg: 'HS256', enc: 'A256GCM', ct: 'zz', future_field: 1 });
  assert.equal(E.canonicalBytes(noisy).toString('utf8'), CANONICAL);
});

// ---------------------------------------------------------- verify/tamper ---

test('verify: any tampered signed field fails', () => {
  const { kSig } = E.deriveKeys(SECRET, WS);
  const signed = Object.assign({}, VECTOR, { sig: SIG });
  assert.equal(E.verify(signed, kSig), true);
  for (const mutate of [
    (e) => { e.ts += 1; },
    (e) => { e.body = Object.assign({}, e.body, { ttl: 7201 }); },
    (e) => { e.from = Object.assign({}, e.from, { member: 'someone-else' }); },
    (e) => { e.nonce = 'AAAAAAAAAAAAAAAAAAAAAA'; },
    (e) => { e.sender_seq += 1; },
    (e) => { e.ws = 'f'.repeat(32); },
  ]) {
    const copy = JSON.parse(JSON.stringify(signed));
    mutate(copy);
    assert.equal(E.verify(copy, kSig), false);
  }
});

test('verify: a wrong-length or malformed sig fails closed, never throws', () => {
  const { kSig } = E.deriveKeys(SECRET, WS);
  assert.equal(E.verify(Object.assign({}, VECTOR, { sig: 'abc' }), kSig), false);
  assert.equal(E.verify(Object.assign({}, VECTOR, { sig: SIG.toUpperCase() }), kSig), false);
  assert.equal(E.verify(null, kSig), false);
});

test('verify: a different workspace secret does not verify', () => {
  const other = E.deriveKeys(crypto.randomBytes(32), WS);
  assert.equal(E.verify(Object.assign({}, VECTOR, { sig: SIG }), other.kSig), false);
});

// --------------------------------------------------------- ntfy roundtrip ---

test('ntfy: encrypt -> decrypt roundtrips the four hidden fields', () => {
  const { kSig, kEnc } = E.deriveKeys(SECRET, WS);
  const signed = Object.assign({}, VECTOR, { sig: E.sign(VECTOR, kSig) });
  const wire = E.encryptForNtfy(signed, kEnc);
  const back = E.decryptFromNtfy(wire, kEnc);
  assert.deepEqual(back.from, VECTOR.from);
  assert.equal(back.type, VECTOR.type);
  assert.equal(back.nonce, VECTOR.nonce);
  assert.deepEqual(back.body, VECTOR.body);
  assert.equal(E.verify(back, kSig), true);
});

test('ntfy: a fresh IV is used per message', () => {
  const { kSig, kEnc } = E.deriveKeys(SECRET, WS);
  const signed = Object.assign({}, VECTOR, { sig: E.sign(VECTOR, kSig) });
  const a = E.encryptForNtfy(signed, kEnc).ct;
  const b = E.encryptForNtfy(signed, kEnc).ct;
  assert.notEqual(a, b);
});

test('ntfy: AAD binding makes cleartext-header tampering fail decryption', () => {
  const { kSig, kEnc } = E.deriveKeys(SECRET, WS);
  const signed = Object.assign({}, VECTOR, { sig: E.sign(VECTOR, kSig) });
  for (const field of ['ts', 'sender_seq', 'ws', 'v']) {
    const wire = E.encryptForNtfy(signed, kEnc);
    wire[field] = field === 'ws' ? 'f'.repeat(32) : (typeof wire[field] === 'number' ? wire[field] + 1 : wire[field]);
    assert.throws(() => E.decryptFromNtfy(wire, kEnc));
  }
});

test('ntfy: a truncated or garbage ct is refused', () => {
  const { kEnc } = E.deriveKeys(SECRET, WS);
  assert.throws(() => E.decryptFromNtfy({ enc: 'A256GCM', ct: 'AAAA', v: 1, ws: WS, ts: 1, sender_seq: 1 }, kEnc), /ntfy_ct_short/);
  assert.throws(() => E.decryptFromNtfy({ enc: 'none', ct: 'x' }, kEnc), /ntfy_enc_unsupported/);
});

// -------------------------------------------------------------- validate ----

function freshEnvelope(overrides) {
  const { kSig } = E.deriveKeys(SECRET, WS);
  const base = Object.assign({}, VECTOR, { ts: Date.now() }, overrides || {});
  return Object.assign({}, base, { sig: E.sign(base, kSig) });
}

test('validate: accepts a fresh well-formed envelope', () => {
  assert.deepEqual(E.validate(freshEnvelope()), { ok: true });
});

test('validate: v > 1 is discarded with a distinguishable code', () => {
  const r = E.validate(Object.assign({}, freshEnvelope(), { v: 2 }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'envelope_version_newer');
});

test('validate: from is REQUIRED with member, machine and session', () => {
  for (const from of [undefined, {}, { member: 'a' }, { member: 'a', machine: 'b' }, { member: 1, machine: 'b', session: 'c' }]) {
    const r = E.validate(freshEnvelope({ from }));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'envelope_from');
  }
});

test('validate: ws mismatch is refused (relay patch A5, cross-workspace replay)', () => {
  const r = E.validate(freshEnvelope(), { ws: 'a'.repeat(32) });
  assert.equal(r.code, 'envelope_ws');
});

test('validate: ts outside +/-300000 ms is refused', () => {
  const r = E.validate(freshEnvelope({ ts: Date.now() - 300001 }));
  assert.equal(r.code, 'envelope_ts_skew');
});

// A hostile peer can put anything on the wire, including values this client
// could never have signed - so these are built unsigned, not through sign().
function hostileEnvelope(overrides) {
  return Object.assign({}, VECTOR, { ts: Date.now(), sig: 'a'.repeat(64) }, overrides || {});
}

test('validate: sender_seq must be a non-negative integer', () => {
  assert.equal(E.validate(hostileEnvelope({ sender_seq: -1 })).code, 'envelope_sender_seq');
  assert.equal(E.validate(hostileEnvelope({ sender_seq: 1.5 })).code, 'envelope_sender_seq');
});

test('validate: a body key outside [a-z][a-z0-9_]* is refused', () => {
  const r = E.validate(hostileEnvelope({ body: { Bad: 1 } }));
  assert.equal(r.code, 'envelope_key_charset');
});

test('validate: a non-integer number anywhere in the body is refused', () => {
  assert.equal(E.validate(hostileEnvelope({ body: { ttl: 1.5 } })).code, 'envelope_non_integer');
});

test('validate: a body over 2048 bytes is refused', () => {
  const r = E.validate(freshEnvelope({ body: { text: 'x'.repeat(2100) } }));
  assert.equal(r.code, 'envelope_body_too_large');
});

// ---------------------------------------------------------------- accept ----

test('accept: signature failure is loud; duplicate and unknown type are ignore', () => {
  const { kSig } = E.deriveKeys(SECRET, WS);
  const env = freshEnvelope();
  const seen = new Map();
  const dedupe = {
    has: (m, s) => seen.has(m + ' ' + s),
    add: (m, s) => seen.set(m + ' ' + s, 1),
  };
  assert.deepEqual(E.accept(env, { ws: WS, kSig, dedupe }), { ok: true });
  const dup = E.accept(env, { ws: WS, kSig, dedupe });
  assert.equal(dup.code, 'duplicate');
  assert.equal(dup.kind, 'ignore');

  const bad = Object.assign({}, freshEnvelope(), { sig: 'a'.repeat(64) });
  const r = E.accept(bad, { ws: WS, kSig });
  assert.equal(r.code, 'signature_invalid');
  assert.equal(r.kind, 'loud');
});

test('accept: an unknown but well-formed type is ignored, not errored', () => {
  const { kSig } = E.deriveKeys(SECRET, WS);
  const env = freshEnvelope({ type: 'future.thing' });
  const r = E.accept(env, { ws: WS, kSig });
  assert.equal(r.code, 'unknown_type');
  assert.equal(r.kind, 'ignore');
});

// ------------------------------------------------------------ build/gate ----

test('build: refuses a type outside the closed v1 catalog', () => {
  const { kSig } = E.deriveKeys(SECRET, WS);
  assert.throws(() => E.build({
    ws: WS, from: VECTOR.from, type: 'note.made_up', body: { text: 'hi' },
    sender_seq: 1, kSig,
  }), /outside the v1 catalog/);
});

test('build: every authored field goes through the secret filter', () => {
  const { kSig } = E.deriveKeys(SECRET, WS);
  const leak = 'AKIAIOSFODNN7EXAMPLE';
  // The note body, a claim subject and a presence note are all filter input.
  assert.throws(() => E.build({ ws: WS, from: VECTOR.from, type: 'note.info', body: { text: leak }, sender_seq: 1, kSig }), /outbound blocked/);
  assert.throws(() => E.build({ ws: WS, from: VECTOR.from, type: 'task.claim', body: { subject: leak, subject_key: 'k', ttl: 1, acquired_at: 1 }, sender_seq: 1, kSig }), /outbound blocked/);
  assert.throws(() => E.build({ ws: WS, from: VECTOR.from, type: 'presence.update', body: { state: 'working', note: leak }, sender_seq: 1, kSig }), /outbound blocked/);
  assert.throws(() => E.build({ ws: WS, from: VECTOR.from, type: 'presence.update', body: { state: 'working', branch: leak }, sender_seq: 1, kSig }), /outbound blocked/);
  assert.throws(() => E.build({ ws: WS, from: VECTOR.from, type: 'task.done', body: { subject: 's', subject_key: 's', files: ['ok.js', leak] }, sender_seq: 1, kSig }), /outbound blocked/);
});

test('build: protocol machinery is NOT filter input (a random ws must not self-block)', () => {
  const { kSig } = E.deriveKeys(SECRET, WS);
  // A 32-hex workspace id has ~4.0 bits/char of entropy and would trip the
  // filter's high-entropy-hex heuristic if it were gated. It must not be.
  const randomWs = crypto.randomBytes(16).toString('hex');
  const env = E.build({ ws: randomWs, from: VECTOR.from, type: 'note.info', body: { text: 'all good' }, sender_seq: 1, kSig });
  assert.equal(env.ws, randomWs);
  assert.match(env.sig, /^[0-9a-f]{64}$/);
});

test('build: sender_seq and from.member are required', () => {
  const { kSig } = E.deriveKeys(SECRET, WS);
  assert.throws(() => E.build({ ws: WS, from: VECTOR.from, type: 'note.info', body: { text: 'x' }, kSig }), /sender_seq is required/);
  assert.throws(() => E.build({ ws: WS, from: { machine: 'm', session: 's' }, type: 'note.info', body: { text: 'x' }, sender_seq: 1, kSig }), /from\.member is required/);
});

test('resign: fresh ts, fresh nonce, new sender_seq, valid signature, no backdating', () => {
  const { kSig } = E.deriveKeys(SECRET, WS);
  const old = Object.assign({}, VECTOR, { ts: 1755230000000, sig: SIG });
  const now = Date.now();
  const fresh = E.resign(old, { kSig, ts: now, senderSeq: 999 });
  assert.equal(fresh.ts, now);
  assert.notEqual(fresh.nonce, old.nonce);
  assert.equal(fresh.sender_seq, 999);
  assert.equal(E.verify(fresh, kSig), true);
  assert.deepEqual(E.validate(fresh, { ws: WS, now }), { ok: true });
});

test('isPriorityType: exactly warn.* and note.blocker', () => {
  assert.equal(E.isPriorityType('warn.overlap'), true);
  assert.equal(E.isPriorityType('note.blocker'), true);
  assert.equal(E.isPriorityType('note.info'), false);
  assert.equal(E.isPriorityType('task.claim'), false);
});
