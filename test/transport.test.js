'use strict';
// Transport adapters against a MOCKED fetch. Nothing here touches the network.
//
// Covers: the section 9.1 capabilities() shape, relay endpoints and the
// wrapper-from MUST of 9.2, the 10.1/10.2 silent-vs-loud split, the ntfy
// encrypted form and cursor ladder of 9.3/6.4, claim resurrection, and the
// deterministic per-sender-fair selection of 6.1.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const E = require('../lib/envelope');
const T = require('../lib/transport');
const relay = require('../lib/transport-relay');
const ntfy = require('../lib/transport-ntfy');

const WS = '0123456789abcdef0123456789abcdef';
const SECRET = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
const { kSig, kEnc } = E.deriveKeys(SECRET, WS);
const ORIGIN = 'https://relay.example.workers.dev';
const TOKEN = 'hsm_3f2a1b0c4d5e6f70_' + 'a'.repeat(64);
const MEMBER = '3f2a1b0c4d5e6f70';

function res(status, body, asText) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (asText !== undefined ? asText : JSON.stringify(body)),
  };
}

// Records every call so the tests can assert on headers and URLs.
function mockFetch(handler) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return handler(url, init, calls.length - 1); };
  fn.calls = calls;
  return fn;
}

function signedEnvelope(overrides) {
  const base = Object.assign({
    v: 1, ws: WS,
    from: { member: MEMBER, machine: 'm-7d3f9a2c', session: 's-1a2b3c4d' },
    type: 'note.info', body: { text: 'hello' },
    ts: Date.now(), nonce: E.newNonce(), sender_seq: Date.now(),
  }, overrides || {});
  return Object.assign({}, base, { sig: E.sign(base, kSig) });
}

// ============================================================ capabilities ==

test('9.1: capabilities() has exactly the frozen shape on both transports', () => {
  const keys = ['authenticated_from', 'server_claims', 'durable_layer', 'encrypts_body', 'keepalive_seconds', 'cursor_kind'];
  const r = relay.createRelayTransport({ origin: ORIGIN, ws: WS, token: TOKEN, kSig }).capabilities();
  const n = ntfy.createNtfyTransport({ topic: 'a'.repeat(32), ws: WS, kSig, kEnc }).capabilities();
  assert.deepEqual(Object.keys(r).sort(), keys.slice().sort());
  assert.deepEqual(Object.keys(n).sort(), keys.slice().sort());

  assert.deepEqual(r, { authenticated_from: true, server_claims: true, durable_layer: false, encrypts_body: false, keepalive_seconds: 60, cursor_kind: 'seq' });
  assert.deepEqual(n, { authenticated_from: false, server_claims: false, durable_layer: false, encrypts_body: true, keepalive_seconds: 600, cursor_kind: 'message_id+unix_ts' });
});

// ================================================================== relay ===

test('9.2: credentials travel only in Authorization, never in a URL or a body', async () => {
  const f = mockFetch(() => res(201, { seq: 5, received_at: 1 }));
  const a = relay.createRelayTransport({ origin: ORIGIN, ws: WS, token: TOKEN, member: MEMBER, kSig, fetchImpl: f });
  await a.publish(signedEnvelope());
  const call = f.calls[0];
  assert.equal(call.init.headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(call.url.includes(TOKEN), false, 'the token must never appear in a URL');
  assert.equal(String(call.init.body).includes(TOKEN), false, 'the token must never appear in a body');
  assert.equal(call.url, ORIGIN + '/ws/' + WS + '/post');
  assert.deepEqual(Object.keys(JSON.parse(call.init.body)), ['envelope']);
});

test('3.1: the four server-state types are refused as envelopes on the relay', async () => {
  const f = mockFetch(() => res(201, { seq: 1 }));
  const a = relay.createRelayTransport({ origin: ORIGIN, ws: WS, token: TOKEN, kSig, fetchImpl: f });
  for (const type of ['presence.update', 'task.claim', 'task.release', 'state.request']) {
    await assert.rejects(() => a.publish(signedEnvelope({ type, body: { state: 'working' } })), (e) => {
      assert.equal(e.code, 'envelope_type_not_carried');
      assert.equal(e.kind, 'loud');
      return true;
    });
  }
  assert.equal(f.calls.length, 0, 'nothing may reach the network');
});

test('2.4: enc/ct on the relay is refused client-side', async () => {
  const a = relay.createRelayTransport({ origin: ORIGIN, ws: WS, token: TOKEN, kSig, fetchImpl: mockFetch(() => res(201, {})) });
  await assert.rejects(() => a.publish(Object.assign(signedEnvelope(), { enc: 'A256GCM', ct: 'x' })), (e) => e.code === 'envelope_enc_on_relay');
});

test('9.2 MUST: a wrapper `from` that differs from envelope.from.member is rejected', async () => {
  const good = signedEnvelope();
  const f = mockFetch(() => res(200, {
    now: Date.now(), cursor: 0, next_cursor: 2, stored_cursor: 0, more: 0,
    members: [], presence: [], claims: [],
    messages: [
      { seq: 1, from: MEMBER, from_name: 'alice', received_at: Date.now(), envelope: good },
      { seq: 2, from: 'someone-else', from_name: 'mallory', received_at: Date.now(), envelope: good },
    ],
  }));
  const a = relay.createRelayTransport({ origin: ORIGIN, ws: WS, token: TOKEN, member: MEMBER, kSig, fetchImpl: f });
  const out = await a.fetch(0);
  assert.equal(out.messages.length, 1);
  assert.equal(out.messages[0].seq, 1);
  assert.equal(a.stats.from_mismatch, 1);
  assert.equal(out.rejected[0].code, 'from_mismatch');
  assert.equal(out.rejected[0].kind, 'loud');
});

test('2.3: a message with a bad signature is discarded on receive', async () => {
  const forged = signedEnvelope();
  forged.body = { text: 'rewritten after signing' };
  const f = mockFetch(() => res(200, {
    now: Date.now(), messages: [{ seq: 1, from: MEMBER, envelope: forged }], members: [], presence: [], claims: [], more: 0,
  }));
  const a = relay.createRelayTransport({ origin: ORIGIN, ws: WS, token: TOKEN, member: MEMBER, kSig, fetchImpl: f });
  const outcome = await a.fetch(0);
  assert.equal(outcome.messages.length, 0);
  assert.equal(a.stats.sig_invalid, 1);
});

test('10.2: never report a truncated read as an empty one', async () => {
  const f = mockFetch(() => res(200, { now: Date.now(), messages: [], members: [], presence: [], claims: [], more: 12 }));
  const a = relay.createRelayTransport({ origin: ORIGIN, ws: WS, token: TOKEN, member: MEMBER, kSig, fetchImpl: f });
  const outcome = await a.fetch(0);
  assert.equal(outcome.messages.length, 0);
  assert.equal(outcome.more, 12);
  assert.equal(outcome.truncated, true);
});

test('10.1 silent: network failure and 5xx do not interrupt the user', async () => {
  for (const handler of [
    () => { throw Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }); },
    () => res(500, { error: 'internal' }),
    () => res(503, { error: 'overloaded' }),
  ]) {
    const a = relay.createRelayTransport({ origin: ORIGIN, ws: WS, token: TOKEN, kSig, fetchImpl: mockFetch(handler) });
    await assert.rejects(() => a.publish(signedEnvelope()), (e) => {
      assert.equal(e.kind, 'silent');
      return true;
    });
  }
});

test('10.2 loud: 401, 403, 429, 400 envelope_* and workspace_not_found stop posting', async () => {
  const cases = [
    [401, { error: 'invalid_token' }],
    [403, { error: 'from_mismatch' }],
    [429, { error: 'rate_limited' }],
    [400, { error: 'envelope_sender_seq' }],
    [404, { error: 'workspace_not_found' }],
  ];
  for (const [status, body] of cases) {
    const stops = [];
    const flags = { postingStopped: () => null, stopPosting: (t, c) => stops.push([t, c]) };
    const a = relay.createRelayTransport({ origin: ORIGIN, ws: WS, token: TOKEN, kSig, sessionFlags: flags, fetchImpl: mockFetch(() => res(status, body)) });
    await assert.rejects(() => a.publish(signedEnvelope()), (e) => {
      assert.equal(e.kind, 'loud', status + ' must be loud');
      assert.equal(e.code, body.error);
      return true;
    });
    assert.deepEqual(stops, [['relay', body.error]], status + ' must stop posting');
  }
});

test('10.2: once posting is stopped, nothing further reaches the network', async () => {
  const f = mockFetch(() => res(201, {}));
  const flags = { postingStopped: () => ({ code: '401', at: 1 }), stopPosting: () => {} };
  const a = relay.createRelayTransport({ origin: ORIGIN, ws: WS, token: TOKEN, kSig, sessionFlags: flags, fetchImpl: f });
  await assert.rejects(() => a.publish(signedEnvelope()), (e) => e.code === 'posting_stopped' && e.already_reported === true);
  assert.equal(f.calls.length, 0);
});

test('5.4: a 409 claim_conflict is normal traffic, not a loud failure', async () => {
  const live = { subject_key: 'onboarding flow', member_id: 'other', acquired_at: 1000 };
  const a = relay.createRelayTransport({
    origin: ORIGIN, ws: WS, token: TOKEN, kSig,
    fetchImpl: mockFetch(() => res(409, { error: 'claim_conflict', claim: live })),
  });
  const out = await a.claim({ subject: 'Onboarding Flow' });
  assert.equal(out.ok, false);
  assert.deepEqual(out.conflict, live);
  assert.equal(out.subject_key, 'onboarding flow');
});

test('6.3: commitCursor is a separate POST, and reading never calls it', async () => {
  const f = mockFetch((url) => url.endsWith('/cursor')
    ? res(200, { ok: true, cursor: 42, advanced: true, at: 1 })
    : res(200, { now: Date.now(), messages: [], members: [], presence: [], claims: [], more: 0, stored_cursor: 7 }));
  const a = relay.createRelayTransport({ origin: ORIGIN, ws: WS, token: TOKEN, kSig, fetchImpl: f });
  await a.fetch(0);
  assert.equal(f.calls.some((c) => String(c.url).endsWith('/cursor')), false);
  const r = await a.commitCursor(42);
  assert.equal(r.cursor, 42);
  assert.deepEqual(JSON.parse(f.calls[1].init.body), { seq: 42 });
  await assert.rejects(() => a.commitCursor(-1), (e) => e.code === 'cursor_invalid');
  await assert.rejects(() => a.commitCursor({ message_id: 'x' }), (e) => e.code === 'cursor_invalid');
});

test('4.3: relay presence labels use K = 60 s', async () => {
  const now = Date.now();
  const f = mockFetch(() => res(200, {
    now, messages: [], members: [], claims: [], more: 0,
    presence: [
      { member_id: 'a', updated_at: now - 100 * 1000 },
      { member_id: 'b', updated_at: now - 200 * 1000 },
      { member_id: 'c', updated_at: now - 400 * 1000 },
      { member_id: 'd', updated_at: now - 8000 * 1000 },
    ],
  }));
  const a = relay.createRelayTransport({ origin: ORIGIN, ws: WS, token: TOKEN, kSig, fetchImpl: f });
  const p = await a.presence();
  assert.deepEqual(p.presence.map((x) => x.label), ['live', 'quiet', 'stale', 'gone']);
  assert.equal(p.advisory, false);
});

test('9.2: health and the unauthenticated helpers hit the right paths', async () => {
  const f = mockFetch(() => res(200, { ok: true, service: 'handshake-relay', version: '0.1.0', protocol: 1 }));
  const h = await relay.health({ origin: ORIGIN, fetchImpl: f });
  assert.equal(h.protocol, 1);
  assert.equal(f.calls[0].url, ORIGIN + '/health');
  assert.equal(f.calls[0].init.headers, undefined);
});

// =================================================================== ntfy ===

test('9.3: publish encrypts, hides from/type/body/nonce, and routes presence to <topic>-p', async () => {
  const topic = 'a'.repeat(32);
  const f = mockFetch(() => res(200, { id: 'msg1', time: 1755230000 }));
  const a = ntfy.createNtfyTransport({ baseUrl: 'https://ntfy.sh', topic, ws: WS, kSig, kEnc, fetchImpl: f });

  const note = signedEnvelope({ type: 'note.info', body: { text: 'a discovery' } });
  const r = await a.publish(note);
  assert.equal(r.handle, 'msg1');
  assert.equal(f.calls[0].url, 'https://ntfy.sh/' + topic);
  const wire = JSON.parse(f.calls[0].init.body);
  assert.deepEqual(Object.keys(wire).sort(), ['alg', 'ct', 'enc', 'sender_seq', 'sig', 'ts', 'v', 'ws']);
  // A passive subscriber holding the topic learns no type, path, name or text.
  const raw = f.calls[0].init.body;
  for (const leak of ['note.info', 'a discovery', MEMBER, 'm-7d3f9a2c']) {
    assert.equal(raw.includes(leak), false, 'ciphertext must not leak ' + leak);
  }

  const presence = signedEnvelope({ type: 'presence.update', body: { state: 'working' } });
  await a.publish(presence);
  assert.equal(f.calls[1].url, 'https://ntfy.sh/' + topic + '-p');
});

test('9.3: a maximal spec-compliant envelope fits inside the ntfy per-message cap', async () => {
  const f = mockFetch(() => res(200, { id: 'x', time: 1 }));
  const a = ntfy.createNtfyTransport({ topic: 'a'.repeat(32), ws: WS, kSig, kEnc, fetchImpl: f });
  // A body at the 2048-byte cap of section 2.5 is the worst case a compliant
  // sender can produce. It must not be refused by the local ntfy guard - if it
  // were, the two caps would contradict each other.
  const body = { text: 'x'.repeat(2020) };
  assert.ok(Buffer.byteLength(JSON.stringify(body)) <= E.MAX_BODY_BYTES);
  await a.publish(signedEnvelope({ type: 'note.info', body }));
  const bytes = Buffer.byteLength(f.calls[0].init.body, 'utf8');
  assert.ok(bytes < ntfy.NTFY_MAX_MESSAGE_BYTES, 'worst-case wire size ' + bytes + ' must stay under ' + ntfy.NTFY_MAX_MESSAGE_BYTES);

  // Anything larger is stopped earlier still: the secret filter's own 2048-byte
  // size cap fires before the transport is reached. Three independent caps in
  // series (filter 2048 -> body 2048 -> ntfy 4096) is the intended ordering.
  await assert.rejects(
    () => a.publish(signedEnvelope({ type: 'note.info', body: { text: 'x'.repeat(4200) } })),
    (e) => e.name === 'FilterViolation');
  assert.equal(ntfy.NTFY_MAX_MESSAGE_BYTES, 4096);
});

test('6.4: the cursor ladder is message_id under 11 h, unix_ts under the cache window, truncated beyond', () => {
  const a = ntfy.createNtfyTransport({ topic: 'a'.repeat(32), ws: WS, kSig, kEnc });
  const now = 1_700_000_000_000;
  const at = (hoursAgo) => ({ message_id: 'mid', unix_ts: Math.floor((now - hoursAgo * 3600 * 1000) / 1000) });

  assert.deepEqual(a.sinceParam(null, now), { since: 'all', tier: 'all', truncated: false });
  assert.equal(a.sinceParam(at(1), now).tier, 'message_id');
  assert.equal(a.sinceParam(at(1), now).since, 'mid');
  assert.equal(a.sinceParam(at(10.9), now).tier, 'message_id');
  assert.equal(a.sinceParam(at(11.1), now).tier, 'unix_ts');
  assert.equal(a.sinceParam(at(11.1), now).since, String(at(11.1).unix_ts));
  const beyond = a.sinceParam(at(13), now);
  assert.equal(beyond.tier, 'beyond_cache_window');
  assert.equal(beyond.truncated, true);
  assert.match(beyond.note, /durable layer/);
});

function ntfyRow(id, time, envelopeObj) {
  return JSON.stringify({ id, time, event: 'message', topic: 't', message: JSON.stringify(E.encryptForNtfy(envelopeObj, kEnc)) });
}

test('9.3: fetch decrypts, verifies, and drops anything that fails either step', async () => {
  const good = signedEnvelope({ type: 'note.info', body: { text: 'ok' } });
  const forged = signedEnvelope({ type: 'note.info', body: { text: 'ok' } });
  forged.sig = 'a'.repeat(64);
  const lines = [
    ntfyRow('m1', 1700000001, good),
    ntfyRow('m2', 1700000002, forged),
    JSON.stringify({ id: 'm3', time: 1700000003, event: 'keepalive' }),
    JSON.stringify({ id: 'm4', time: 1700000004, event: 'message', message: 'not json' }),
  ].join('\n');
  const f = mockFetch(() => res(200, null, lines));
  const a = ntfy.createNtfyTransport({ topic: 'a'.repeat(32), ws: WS, kSig, kEnc, fetchImpl: f });
  const outcome = await a.fetch(null);
  assert.equal(outcome.messages.length, 1);
  assert.equal(outcome.messages[0].envelope.body.text, 'ok');
  assert.equal(a.stats.sig_invalid, 1);
  assert.equal(a.stats.decrypt_failed, 1);
  assert.match(f.calls[0].url, /\/json\?poll=1&since=all$/);
});

test('9.3: presence derives the roster and RESURRECTS claims from presence.update.claims', async () => {
  const now = Date.now();
  const p = (member, claims, ts) => signedEnvelope({
    type: 'presence.update',
    from: { member, machine: 'm-1', session: 's-1' },
    body: { state: 'working', note: 'on it', claims },
    ts: ts || now,
  });
  const lines = [
    ntfyRow('p1', Math.floor(now / 1000) - 30, p('alice', [
      { subject: 'onboarding flow', subject_key: 'onboarding flow', acquired_at: 1000, ttl: 7200 },
      { subject: 'billing webhooks', subject_key: 'billing webhooks', acquired_at: 2000, ttl: 7200 },
    ])),
    ntfyRow('p2', Math.floor(now / 1000) - 5000, p('bob', [])),
  ].join('\n');
  const a = ntfy.createNtfyTransport({ topic: 'a'.repeat(32), ws: WS, kSig, kEnc, fetchImpl: mockFetch(() => res(200, null, lines)) });
  const view = await a.presence({ now });

  assert.equal(view.members.length, 2);
  assert.equal(view.claims.length, 2);
  assert.equal(view.claims.every((c) => c.advisory === true), true, 'ntfy claims are unauthenticated-advisory');
  assert.deepEqual(view.claims.map((c) => c.subject_key), ['onboarding flow', 'billing webhooks']);
  assert.equal(view.advisory, true);
  assert.equal(view.advisory_note, 'zero-setup: claims are advisory; no durable layer');
  // K = 600 s here: 30 s ago is live, 5000 s ago is stale.
  const labels = Object.fromEntries(view.presence.map((x) => [x.member, x.label]));
  assert.equal(labels.alice, 'live');
  assert.equal(labels.bob, 'stale');
});

test('9.3: presence is derived state - reading it twice must not empty the roster', async () => {
  const now = Date.now();
  const env = signedEnvelope({ type: 'presence.update', from: { member: 'alice', machine: 'm', session: 's' }, body: { state: 'working' } });
  const lines = ntfyRow('p1', Math.floor(now / 1000), env);
  const seen = new Map();
  const dedupe = { has: (m, s) => seen.has(m + s), add: (m, s) => seen.set(m + s, 1) };
  const a = ntfy.createNtfyTransport({ topic: 'a'.repeat(32), ws: WS, kSig, kEnc, dedupe, fetchImpl: mockFetch(() => res(200, null, lines)) });
  assert.equal((await a.presence({ now })).members.length, 1);
  assert.equal((await a.presence({ now })).members.length, 1, 'the second read must still see the roster');
});

test('9.3: 429 is a loud, user-visible state and arms the upgrade nudge', async () => {
  const a = ntfy.createNtfyTransport({ topic: 'a'.repeat(32), ws: WS, kSig, kEnc, fetchImpl: mockFetch(() => res(429, { error: 'rate_limited' })) });
  assert.deepEqual(a.upgradeNudgeDue(0), { due: false, ops: 0 });
  await assert.rejects(() => a.publish(signedEnvelope()), (e) => e.kind === 'loud');
  assert.equal(a.sawRateLimit, true);
  assert.equal(a.upgradeNudgeDue(0).due, true);
  assert.equal(a.upgradeNudgeDue(0).reason, 'rate_limited');
});

test('9.3: the ops budget arms the nudge at 150 operations per member per day', () => {
  const a = ntfy.createNtfyTransport({ topic: 'a'.repeat(32), ws: WS, kSig, kEnc });
  assert.equal(a.upgradeNudgeDue(149).due, false);
  assert.equal(a.upgradeNudgeDue(150).due, true);
  assert.equal(a.upgradeNudgeDue(150).reason, 'ops_budget');
});

test('3.2: a state.request answer is rate limited to once per 60 s', () => {
  const a = ntfy.createNtfyTransport({ topic: 'a'.repeat(32), ws: WS, kSig, kEnc });
  const now = 1_700_000_000_000;
  assert.equal(a.stateAnswerAllowed(now), true);
  a.markStateAnswered(now);
  assert.equal(a.stateAnswerAllowed(now + 59_000), false);
  assert.equal(a.stateAnswerAllowed(now + 60_000), true);
});

test('9.3: the topic is 32 hex of CSPRNG and is never derived from a name', () => {
  const a = ntfy.newTopic();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, ntfy.newTopic());
});

// ============================================================== fairness ====

test('6.1: the reserved priority floor is filled before the fair pass', () => {
  const candidates = [];
  for (let i = 0; i < 40; i++) candidates.push({ order: i, sender: 'chatty', type: 'note.info' });
  candidates.push({ order: 100, sender: 'quiet', type: 'note.blocker' });
  candidates.push({ order: 101, sender: 'quiet2', type: 'warn.overlap' });

  const chosen = T.selectFair(candidates, T.SYNC_FETCH_CAP, T.RESERVED_PRIORITY_SLOTS);
  assert.equal(chosen.length, 20);
  const priorityChosen = chosen.filter((c) => T.isPriorityType(c.type));
  assert.equal(priorityChosen.length, 2, 'both priority items survive 40 messages of chatter');
  assert.equal(chosen.every((c, i, arr) => i === 0 || arr[i - 1].order < c.order), true, 'output stays in order');
});

test('6.1: per-sender round robin - one chatty peer cannot bury a quiet one', () => {
  const candidates = [];
  for (let i = 0; i < 30; i++) candidates.push({ order: i, sender: 'chatty', type: 'note.info' });
  candidates.push({ order: 30, sender: 'quiet', type: 'note.info' });
  const chosen = T.selectFair(candidates, 20, 5);
  assert.equal(chosen.some((c) => c.sender === 'quiet'), true);
});

test('6.1: selection is deterministic and does not depend on insertion order', () => {
  const mk = () => {
    const c = [];
    for (let i = 0; i < 25; i++) c.push({ order: i, sender: 'a', type: 'note.info' });
    for (let i = 25; i < 40; i++) c.push({ order: i, sender: 'b', type: 'note.info' });
    c.push({ order: 40, sender: 'c', type: 'warn.overlap' });
    return c;
  };
  const first = T.selectFair(mk(), 20, 5).map((c) => c.order);
  for (let n = 0; n < 5; n++) {
    assert.deepEqual(T.selectFair(mk(), 20, 5).map((c) => c.order), first);
  }
  // Sender order is by each sender's OLDEST pending item, so shuffling the
  // input array cannot change the result.
  const shuffled = mk().sort(() => (crypto.randomInt(2) ? 1 : -1));
  assert.deepEqual(T.selectFair(shuffled, 20, 5).map((c) => c.order).sort((x, y) => x - y), first.slice().sort((x, y) => x - y));
});

test('6.1: the candidate window bounds the scan at 200 and reports the overflow', async () => {
  const now = Date.now();
  const lines = [];
  for (let i = 0; i < 260; i++) {
    lines.push(ntfyRow('m' + i, Math.floor(now / 1000), signedEnvelope({
      type: 'note.info', body: { text: 'n' + i }, from: { member: 'peer' + (i % 3), machine: 'm', session: 's' },
    })));
  }
  const a = ntfy.createNtfyTransport({ topic: 'a'.repeat(32), ws: WS, kSig, kEnc, fetchImpl: mockFetch(() => res(200, null, lines.join('\n'))) });
  const outcome = await a.fetch(null, undefined, { now });
  assert.equal(outcome.messages.length, 20);
  assert.equal(outcome.more, 200 - 20 + 60);
  assert.equal(outcome.truncated, true);
});

// ============================================================== staleness ===

test('4.3: the label ladder is 2.5xK live, 6xK quiet, then stale, then gone at 7200 s', () => {
  assert.equal(T.presenceLabel(150_000, 60), 'live');
  assert.equal(T.presenceLabel(150_001, 60), 'quiet');
  assert.equal(T.presenceLabel(360_000, 60), 'quiet');
  assert.equal(T.presenceLabel(360_001, 60), 'stale');
  assert.equal(T.presenceLabel(7_200_001, 60), 'gone');
  assert.equal(T.presenceLabel(1_500_000, 600), 'live');
  assert.equal(T.presenceLabel(3_600_000, 600), 'quiet');
  assert.equal(T.presenceLabel(3_600_001, 600), 'stale');
});
