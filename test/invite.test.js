'use strict';
// The invite blob: PROTOCOL section 9.1.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const I = require('../lib/invite');

const WS = '0123456789abcdef0123456789abcdef';
const TOPIC = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const SECRET = crypto.randomBytes(32).toString('base64url');

// Assert on the machine-readable .code, not on prose: the message is for
// humans and is allowed to change.
function throwsCode(fn, code, label) {
  try {
    fn();
  } catch (e) {
    assert.equal(e.name, 'InviteError', label);
    if (Array.isArray(code)) assert.ok(code.includes(e.code), (label || '') + ' got ' + e.code);
    else assert.equal(e.code, code, label);
    return;
  }
  assert.fail((label || 'expected a throw') + ' but nothing was thrown');
}

const RELAY_INLINE = { t: 'relay', e: 'https://relay.example.workers.dev', ws: WS, n: 'acme app', loc: 'inline', s: SECRET, tok: 'hsk_' + 'a'.repeat(64) + '_deadbeef' };
const NTFY_INLINE = { t: 'ntfy', e: 'https://ntfy.sh', ws: WS, n: 'acme app', loc: 'inline', s: SECRET, topic: TOPIC };
const REPO_ONLY = { t: 'relay', e: 'https://relay.example.workers.dev', ws: WS, n: 'acme app', loc: 'repo' };

test('roundtrip: relay inline, ntfy inline and repo-located invites all survive', () => {
  for (const fields of [RELAY_INLINE, NTFY_INLINE, REPO_ONLY]) {
    const blob = I.encode(fields);
    assert.match(blob, /^hsi1_[A-Za-z0-9_-]+$/);
    const back = I.decode(blob);
    for (const [k, v] of Object.entries(fields)) assert.equal(back[k], v, k);
    assert.equal(back.p, 1);
    assert.match(back.c, /^[0-9a-f]{8}$/);
  }
});

test('the blob is base64url of canonical JSON, so it is stable across runs', () => {
  assert.equal(I.encode(RELAY_INLINE), I.encode(RELAY_INLINE));
  const decoded = JSON.parse(Buffer.from(I.encode(NTFY_INLINE).slice('hsi1_'.length), 'base64url').toString('utf8'));
  assert.deepEqual(Object.keys(decoded), ['c', 'e', 'loc', 'n', 'p', 's', 't', 'topic', 'ws']);   // sorted
});

test('checksum: c is the first 4 bytes of SHA-256 over every key except c', () => {
  const blob = I.encode(NTFY_INLINE);
  const fields = I.decode(blob);
  const recomputed = I.checksumOf(fields);
  assert.equal(recomputed, fields.c);
  const byHand = crypto.createHash('sha256')
    .update(require('../lib/envelope').canonicalJson({ e: fields.e, loc: fields.loc, n: fields.n, p: fields.p, s: fields.s, t: fields.t, topic: fields.topic, ws: fields.ws }), 'utf8')
    .digest('hex').slice(0, 8);
  assert.equal(fields.c, byHand);
});

test('tamper: flipping any field without recomputing c is refused', () => {
  const blob = I.encode(RELAY_INLINE);
  const fields = I.decode(blob);
  for (const key of ['e', 'ws', 'n', 's', 'tok', 't']) {
    const tampered = Object.assign({}, fields);
    tampered[key] = key === 'ws' ? 'f'.repeat(32) : (key === 't' ? 'ntfy' : String(tampered[key]) + 'x');
    const forged = 'hsi1_' + Buffer.from(JSON.stringify(tampered), 'utf8').toString('base64url');
    throwsCode(() => I.decode(forged),
      ['invite_checksum_mismatch', 'invite_ws', 'invite_token', 'invite_topic', 'invite_transport'],
      'tampering with ' + key + ' must be caught');
  }
});

test('tamper: a corrupted checksum itself is refused', () => {
  const fields = I.decode(I.encode(NTFY_INLINE));
  fields.c = fields.c === '00000000' ? '11111111' : '00000000';
  const forged = 'hsi1_' + Buffer.from(JSON.stringify(fields), 'utf8').toString('base64url');
  throwsCode(() => I.decode(forged), 'invite_checksum_mismatch');
});

test('tamper: truncating the blob is refused', () => {
  const blob = I.encode(NTFY_INLINE);
  assert.throws(() => I.decode(blob.slice(0, blob.length - 6)));
});

test('shape rules: s/tok/topic are present exactly when the spec says', () => {
  throwsCode(() => I.encode({ t: 'ntfy', e: 'https://ntfy.sh', ws: WS, n: 'x', loc: 'inline' }), 'invite_secret');
  throwsCode(() => I.encode(Object.assign({}, REPO_ONLY, { s: SECRET })), 'invite_secret');
  throwsCode(() => I.encode({ t: 'relay', e: 'https://r', ws: WS, n: 'x', loc: 'inline', s: SECRET }), 'invite_token');
  throwsCode(() => I.encode({ t: 'ntfy', e: 'https://ntfy.sh', ws: WS, n: 'x', loc: 'inline', s: SECRET, topic: 'nothex' }), 'invite_topic');
  throwsCode(() => I.encode(Object.assign({}, REPO_ONLY, { ws: 'short' })), 'invite_ws');
  throwsCode(() => I.encode(Object.assign({}, REPO_ONLY, { n: 'x'.repeat(65) })), 'invite_name');
  throwsCode(() => I.encode(Object.assign({}, REPO_ONLY, { t: 'carrier-pigeon' })), 'invite_transport');
});

test('prefix and encoding are enforced', () => {
  throwsCode(() => I.decode('hsi2_abc'), 'invite_prefix');
  throwsCode(() => I.decode('hsi1_not base64!'), 'invite_encoding');
  throwsCode(() => I.decode('hsi1_' + Buffer.from('[]').toString('base64url')), 'invite_json');
  throwsCode(() => I.decode(null), 'invite_missing');
});

test('describe: exactly what join must print before asking for confirmation', () => {
  const d = I.describe(I.decode(I.encode(RELAY_INLINE)));
  assert.equal(d.transport, 'relay');
  assert.equal(d.endpoint_host, 'relay.example.workers.dev');
  assert.equal(d.workspace_name, 'acme app');
  assert.equal(d.ws, WS);
  assert.equal(d.carries_credentials, true);
  assert.equal(d.authenticated_from, true);

  const n = I.describe(I.decode(I.encode(NTFY_INLINE)));
  assert.equal(n.endpoint_host, 'ntfy.sh');
  assert.equal(n.authenticated_from, false, 'ntfy from is self-declared and must never read as verified');

  const r = I.describe(I.decode(I.encode(REPO_ONLY)));
  assert.equal(r.carries_credentials, false);
});
