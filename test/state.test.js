'use strict';
// Local state: sender_seq (PROTOCOL 2.6), cursors and the consumed watermark
// (6.3-6.4), own claims (9.3 resurrection) and the offline queue (10.3).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const St = require('../lib/state');
const E = require('../lib/envelope');

const WS = '0123456789abcdef0123456789abcdef';
const SECRET = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
const { kSig } = E.deriveKeys(SECRET, WS);
const FROM = { member: 'alice', machine: 'm-11223344', session: 's-0011223344556677' };

let counter = 0;
function tmpState() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-state-' + (counter++) + '-'));
  return St.openState(WS, { dir });
}

function envOf(type, body, ts) {
  return E.build({
    ws: WS, from: FROM, type, body,
    ts: ts === undefined ? Date.now() : ts,
    sender_seq: 1, kSig,
  });
}

// ------------------------------------------------------------- locations ---

test('state root: the CLI and hooks resolve the SAME dir (HANDSHAKE_STATE_DIR > CLAUDE_CONFIG_DIR/handshake > ~/.claude/handshake)', () => {
  // Explicit override wins, used as-is.
  assert.equal(St.stateRoot({ HANDSHAKE_STATE_DIR: path.join(os.tmpdir(), 'pd') }), path.resolve(path.join(os.tmpdir(), 'pd')));
  // A custom config dir: both CLI and hook inherit it, so they still agree.
  assert.equal(St.stateRoot({ CLAUDE_CONFIG_DIR: path.join(os.tmpdir(), 'cfg') }), path.join(path.resolve(path.join(os.tmpdir(), 'cfg')), 'handshake'));
  // Default.
  assert.equal(St.stateRoot({}), path.join(os.homedir(), '.claude', 'handshake'));
  // CLAUDE_PLUGIN_DATA is the ASYMMETRIC var (hook has it, Bash-tool CLI does
  // not) and MUST be ignored, or a workspace made by the CLI is invisible to
  // the hook. This assertion is the regression guard for the empty-block bug.
  assert.equal(St.stateRoot({ CLAUDE_PLUGIN_DATA: path.join(os.tmpdir(), 'pd') }), path.join(os.homedir(), '.claude', 'handshake'));
  // No literal "~" ever reaches the filesystem.
  assert.equal(St.stateRoot({}).includes('~'), false);
  assert.equal(St.stateDir(WS, {}), path.join(os.homedir(), '.claude', 'handshake', WS));
});

test('state dir is writable and files land 0600 on POSIX', () => {
  const s = tmpState();
  assert.equal(s.writable().ok, true);
  s.write({ ws: WS, hello: 1 });
  const mode = fs.statSync(s.files.state).mode & 0o777;
  if (process.platform === 'win32') {
    // Documented, not asserted: Windows maps mode bits onto the read-only
    // attribute only; the user-profile ACL is the real control.
    assert.equal(typeof St.WINDOWS_ACL_NOTE, 'string');
  } else {
    assert.equal(mode, 0o600);
  }
});

// ------------------------------------------------------------ sender_seq ---

test('2.6: sender_seq initializes to the current Unix ms when absent', () => {
  const s = tmpState();
  assert.equal(s.senderSeq(), null);
  const before = Date.now();
  const first = s.nextSenderSeq();
  assert.ok(first >= before && first <= Date.now() + 5);
});

test('2.6: sender_seq is strictly increasing and persists across handles', () => {
  const s = tmpState();
  const a = s.nextSenderSeq();
  const b = s.nextSenderSeq();
  assert.equal(b, a + 1);
  const reopened = St.openState(WS, { dir: s.dir });
  assert.equal(reopened.nextSenderSeq(), b + 1);
});

test('2.6: after local state loss the counter restarts at now, not at 0', () => {
  const s = tmpState();
  s.nextSenderSeq();
  fs.rmSync(s.files.state);
  const restored = St.openState(WS, { dir: s.dir }).nextSenderSeq();
  assert.ok(restored > 1e12, 'restored counter must be a ms timestamp, got ' + restored);
});

// ----------------------------------------------------- cursors / watermark --

test('6.4: cursor shapes are transport-specific and do not cross', () => {
  const s = tmpState();
  assert.equal(St.cursorKind('relay'), 'seq');
  assert.equal(St.cursorKind('ntfy'), 'message_id+unix_ts');
  assert.equal(s.setCursor('relay', 12), 12);
  assert.deepEqual(s.setCursor('ntfy', { message_id: 'abc', unix_ts: 5 }), { message_id: 'abc', unix_ts: 5 });
  // A relay integer offered to ntfy is not a cursor.
  assert.equal(s.setCursor('ntfy', 12), null);
});

test('6.3: the watermark moves forward only', () => {
  const s = tmpState();
  assert.equal(s.advanceWatermark('relay', 10).advanced, true);
  assert.equal(s.getWatermark('relay'), 10);
  const back = s.advanceWatermark('relay', 4);
  assert.equal(back.advanced, false);
  assert.equal(s.getWatermark('relay'), 10);
});

test('6.3: reading does not move the watermark (the two are separate stores)', () => {
  const s = tmpState();
  s.setCursor('relay', 99);
  assert.equal(s.getWatermark('relay'), 0);
});

// ------------------------------------------------------------ own claims ---

test('9.3: own claims persist, expire on TTL, and keep the original acquired_at', () => {
  const s = tmpState();
  s.addOwnClaim({ subject: 'onboarding flow', subject_key: 'onboarding flow', acquired_at: 1000, ttl: 7200 });
  s.addOwnClaim({ subject: 'billing webhooks', subject_key: 'billing webhooks', acquired_at: 500, ttl: 7200 });
  const claims = s.getOwnClaims();
  assert.equal(claims.length, 2);
  assert.deepEqual(claims.map((c) => c.subject_key), ['billing webhooks', 'onboarding flow']);   // acquired_at ascending

  // Re-adoption preserves acquired_at - it is the tiebreak input (5.3).
  s.addOwnClaim({ subject: 'onboarding flow', subject_key: 'onboarding flow', acquired_at: 9999, ttl: 7200 });
  assert.equal(s.getOwnClaims().find((c) => c.subject_key === 'onboarding flow').acquired_at, 1000);

  s.removeOwnClaim('billing webhooks');
  assert.equal(s.getOwnClaims().length, 1);
  // renewed_at + ttl*1000 <= now -> gone
  assert.equal(s.getOwnClaims(Date.now() + 7201 * 1000).length, 0);
});

// ---------------------------------------------------------------- dedupe ---

test('2.6: (from.member, sender_seq) dedupe persists once flushed', () => {
  const s = tmpState();
  const d = s.dedupe();
  assert.equal(d.has('alice', 7), false);
  d.add('alice', 7, 'nonce-a');
  assert.equal(d.has('alice', 7), true);
  d.flush();
  assert.equal(St.openState(WS, { dir: s.dir }).dedupe().has('alice', 7), true);
});

// ----------------------------------------------------------- loud flags ----

test('10.2: a loud condition reports once per session and stops posting', () => {
  const s = tmpState();
  const f = s.session('sess-1');
  assert.equal(f.shouldReport('401'), true);
  assert.equal(f.shouldReport('401'), false);
  f.stopPosting('relay', '401');
  assert.equal(s.session('sess-1').postingStopped('relay').code, '401');
  // A new session starts clean.
  assert.equal(s.session('sess-2').postingStopped('relay'), null);
  assert.equal(s.session('sess-2').shouldReport('401'), true);
});

// ---------------------------------------------------------- offline queue --

test('10.3: per-type expiry - presence 2.5xK, task by claim TTL, note 3600s, ws.leave 86400s', () => {
  const ts = 1_000_000_000_000;
  assert.equal(St.queueExpiryAt({ type: 'presence.update', ts, body: {} }, 60), ts + 150_000);
  assert.equal(St.queueExpiryAt({ type: 'presence.update', ts, body: {} }, 600), ts + 1_500_000);
  assert.equal(St.queueExpiryAt({ type: 'task.claim', ts, body: { ttl: 300 } }, 60), ts + 300_000);
  assert.equal(St.queueExpiryAt({ type: 'task.claim', ts, body: {} }, 60), ts + 7_200_000);
  assert.equal(St.queueExpiryAt({ type: 'note.info', ts, body: {} }, 60), ts + 3_600_000);
  assert.equal(St.queueExpiryAt({ type: 'warn.overlap', ts, body: {} }, 60), ts + 3_600_000);
  assert.equal(St.queueExpiryAt({ type: 'ws.leave', ts, body: {} }, 60), ts + 86_400_000);
});

test('10.3: expired entries are swept, live ones survive', () => {
  const s = tmpState();
  const q = s.queue({ transport: 'ntfy', endpoint: 'https://ntfy.sh', topic: 't', token: '' });
  // A note.* queued more than 3600 s ago is already past its expiry, so the
  // next enqueue prunes it - expiry is enforced on the way in as well as by
  // sweep(), which is why the queue cannot fill with dead entries.
  q.enqueue(envOf('note.info', { text: 'stale' }, Date.now() - 4000 * 1000));
  assert.equal(q.size(), 1);
  q.enqueue(envOf('note.info', { text: 'fresh' }));
  assert.equal(q.size(), 1);
  assert.equal(q.list()[0].envelope.body.text, 'fresh');

  // sweep() alone, with the clock moved past a live entry's expiry.
  assert.equal(q.sweep(Date.now() + 3601 * 1000), 1);
  assert.equal(q.size(), 0);

  // A ws.leave is kept far longer than a note (86400 s vs 3600 s).
  q.enqueue(envOf('ws.leave', { reason: 'signoff' }, Date.now() - 4000 * 1000));
  assert.equal(q.size(), 1);
  assert.equal(q.sweep(), 0);
});

test('10.3: the 200 cap drops OLDEST and reports the dropped count', () => {
  const s = tmpState();
  const q = s.queue({ transport: 'ntfy', endpoint: 'https://ntfy.sh', topic: 't', token: '' });
  let lastReport = null;
  for (let i = 0; i < 205; i++) lastReport = q.enqueue(envOf('note.info', { text: 'n' + i }));
  assert.equal(q.size(), St.QUEUE_MAX);
  assert.equal(lastReport.dropped, 1);
  const texts = q.list().map((e) => e.envelope.body.text);
  assert.equal(texts[0], 'n5');                       // the first five were dropped
  assert.equal(texts[texts.length - 1], 'n204');
});

test('10.3: a transport/topic/endpoint/token change hard-discards with a count', () => {
  const s = tmpState();
  const bindingA = { transport: 'ntfy', endpoint: 'https://ntfy.sh', topic: 'aaa', token: '' };
  const qa = s.queue(bindingA);
  qa.enqueue(envOf('note.info', { text: 'one' }));
  qa.enqueue(envOf('note.info', { text: 'two' }));
  assert.equal(qa.size(), 2);

  for (const changed of [
    { transport: 'relay', endpoint: 'https://ntfy.sh', topic: 'aaa', token: '' },
    { transport: 'ntfy', endpoint: 'https://other.example', topic: 'aaa', token: '' },
    { transport: 'ntfy', endpoint: 'https://ntfy.sh', topic: 'bbb', token: '' },
    { transport: 'ntfy', endpoint: 'https://ntfy.sh', topic: 'aaa', token: 'hsm_x' },
  ]) {
    const fresh = tmpState();
    const q1 = fresh.queue(bindingA);
    q1.enqueue(envOf('note.info', { text: 'one' }));
    q1.enqueue(envOf('note.info', { text: 'two' }));
    const q2 = fresh.queue(changed);
    const r = q2.reconcileBinding();
    assert.equal(r.discarded, 2, JSON.stringify(changed));
    assert.equal(r.rebound, true);
    assert.equal(q2.size(), 0);
  }
  // The same binding does NOT discard.
  assert.equal(s.queue(bindingA).reconcileBinding().discarded, 0);
});

test('10.3: the binding fingerprint never stores the token itself', () => {
  const fp = St.bindingFingerprint({ transport: 'relay', endpoint: 'https://r', topic: '', token: 'hsm_deadbeef_secret' });
  assert.match(fp, /^[0-9a-f]{32}$/);
  assert.equal(fp.includes('hsm_'), false);
});

test('10.3: drain re-signs with a fresh ts, fresh nonce and a NEW sender_seq', async () => {
  const s = tmpState();
  const q = s.queue({ transport: 'ntfy', endpoint: 'https://ntfy.sh', topic: 't', token: '' });
  const old = envOf('note.info', { text: 'queued while offline' }, Date.now() - 120 * 1000);
  q.enqueue(old);

  const sent = [];
  const res = await q.drain(async (env) => { sent.push(env); return { handle: 'h1' }; }, { kSig });

  assert.equal(res.sent, 1);
  assert.equal(res.remaining, 0);
  assert.equal(sent.length, 1);
  const out = sent[0];
  assert.notEqual(out.ts, old.ts, 'a queued envelope MUST NOT be backdated');
  assert.ok(Math.abs(Date.now() - out.ts) < 5000);
  assert.notEqual(out.nonce, old.nonce);
  assert.notEqual(out.sender_seq, old.sender_seq);
  assert.equal(E.verify(out, kSig), true, 're-signed envelope must verify');
  assert.deepEqual(E.validate(out, { ws: WS }), { ok: true });
});

test('10.3: a silent failure stops the drain and keeps the rest queued', async () => {
  const s = tmpState();
  const q = s.queue({ transport: 'ntfy', endpoint: 'https://ntfy.sh', topic: 't', token: '' });
  q.enqueue(envOf('note.info', { text: 'a' }));
  q.enqueue(envOf('note.info', { text: 'b' }));
  q.enqueue(envOf('note.info', { text: 'c' }));

  let n = 0;
  const res = await q.drain(async () => {
    if (++n === 2) { const e = new Error('offline'); e.kind = 'silent'; e.code = 'network_unreachable'; throw e; }
    return { handle: n };
  }, { kSig });

  assert.equal(res.sent, 1);
  assert.equal(res.stopped.kind, 'silent');
  assert.equal(res.remaining, 2);
  assert.equal(q.size(), 2);
});

test('10.3: a loud failure stops the drain too, and the entry is preserved', async () => {
  const s = tmpState();
  const q = s.queue({ transport: 'relay', endpoint: 'https://r', topic: '', token: 'tok' });
  q.enqueue(envOf('note.info', { text: 'a' }));
  const res = await q.drain(async () => { const e = new Error('401'); e.kind = 'loud'; e.code = '401'; throw e; }, { kSig });
  assert.equal(res.sent, 0);
  assert.equal(res.stopped.kind, 'loud');
  assert.equal(q.size(), 1);
});

test('10.3: filtering happens at enqueue AND again at send', async () => {
  const s = tmpState();
  const q = s.queue({ transport: 'ntfy', endpoint: 'https://ntfy.sh', topic: 't', token: '' });
  // At enqueue: build() already gates, so craft the envelope by hand to prove
  // the queue's own enqueue-time pass exists.
  const dirty = envOf('note.info', { text: 'clean at first' });
  q.enqueue(dirty);
  assert.equal(q.size(), 1);

  const leaky = JSON.parse(JSON.stringify(dirty));
  leaky.body.text = 'AKIAIOSFODNN7EXAMPLE';
  assert.throws(() => q.enqueue(leaky), /outbound blocked/);

  // At send: mutate the stored entry behind the queue's back, then drain.
  const raw = JSON.parse(fs.readFileSync(q.file, 'utf8'));
  raw.entries[0].envelope.body.text = 'AKIAIOSFODNN7EXAMPLE';
  fs.writeFileSync(q.file, JSON.stringify(raw));
  const sent = [];
  const res = await q.drain(async (e) => { sent.push(e); return { handle: 1 }; }, { kSig });
  assert.equal(sent.length, 0, 'the send-time filter pass must catch it');
  assert.equal(res.filtered, 1);
  assert.equal(res.stopped.code, 'filter_refusal');
});

// ---------------------------------------------------------- project index --

test('project index: links a directory to a workspace and resolves from subdirs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-idx-'));
  const env = { CLAUDE_PLUGIN_DATA: path.join(root, 'data') };
  const project = path.join(root, 'proj');
  const nested = path.join(project, 'a', 'b');
  fs.mkdirSync(nested, { recursive: true });
  St.linkProject(project, WS, env);
  assert.equal(St.lookupProject(nested, env).ws, WS);
  assert.equal(St.lookupProject(root, env), null);
});

test('sessionId is s- plus 16 hex of SHA-256, stable for the same input', () => {
  const a = St.State.sessionId('host-session-abc');
  assert.match(a, /^s-[0-9a-f]{16}$/);
  assert.equal(a, St.State.sessionId('host-session-abc'));
  assert.notEqual(a, St.State.sessionId('host-session-abd'));
  const expected = 's-' + crypto.createHash('sha256').update('host-session-abc').digest('hex').slice(0, 16);
  assert.equal(a, expected);
});
