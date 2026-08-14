import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { call, envelope, setup, workspaceStub } from './helpers.js';

const post = (ws, token, env) => call('POST', '/ws/' + ws.ws + '/post', { token, body: { envelope: env } });
const sync = (ws, token, cursor) =>
  call('GET', '/ws/' + ws.ws + '/sync' + (cursor === undefined ? '' : '?cursor=' + cursor), { token });

describe('message append', () => {
  it('assigns a monotonic seq and stamps from as the authenticated member', async () => {
    const { ws, members } = await setup(['alice', 'bob']);
    const one = await post(ws, members.alice.token, envelope('note.discovery', { seq: 1 }));
    const two = await post(ws, members.bob.token, envelope('note.info', { seq: 1 }));
    expect(one.status).toBe(201);
    expect(two.body.seq).toBe(one.body.seq + 1);
    expect(one.body.from).toBe(members.alice.member_id);

    const view = await sync(ws, members.bob.token, 0);
    expect(view.body.messages.map((m) => m.from)).toEqual([members.alice.member_id, members.bob.member_id]);
    expect(view.body.messages[0].from_name).toBe('alice');
  });

  it('refuses a spoofed from rather than silently rewriting it', async () => {
    const { ws, members } = await setup(['alice', 'bob']);
    const res = await post(
      ws,
      members.bob.token,
      envelope('note.info', { from: { member: members.alice.member_id, machine: 'x' } })
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('from_mismatch');
    expect(res.body.expected).toBe(members.bob.member_id);

    const honest = await post(
      ws,
      members.bob.token,
      envelope('note.info', { from: { member: members.bob.member_id, machine: 'pale-otter' } })
    );
    expect(honest.status).toBe(201);
  });

  it('stores and returns the envelope verbatim, including sig and reserved fields', async () => {
    const { ws, members } = await setup(['alice']);
    const sent = envelope('warn.overlap', {
      sig: 'a'.repeat(64),
      enc: 'aes-256-gcm',
      alg: 'HS256',
      body: { paths: ['src/a.js'], nested: { deep: [1, 2, 3] } }
    });
    await post(ws, members.alice.token, sent);
    const view = await sync(ws, members.alice.token, 0);
    expect(view.body.messages[0].envelope).toEqual(sent);
    expect(view.body.messages[0].envelope.sig).toBe(sent.sig);
    expect(view.body.messages[0].envelope.enc).toBe('aes-256-gcm');
  });

  it('is idempotent for a replayed per-sender seq', async () => {
    const { ws, members } = await setup(['alice']);
    const env = envelope('note.fix', { seq: 42 });
    const first = await post(ws, members.alice.token, env);
    const replay = await post(ws, members.alice.token, env);
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
    expect(replay.body.seq).toBe(first.body.seq);

    const view = await sync(ws, members.alice.token, 0);
    expect(view.body.messages).toHaveLength(1);
  });
});

describe('envelope validation', () => {
  const bad = {
    envelope_version: { v: 2 },
    envelope_type: { type: 'NotAType' },
    envelope_nonce: { nonce: 'x' },
    envelope_seq: { seq: -1 },
    envelope_sig: { sig: 123 },
    envelope_ts: { ts: 'now' },
    envelope_body_too_large: { body: { blob: 'x'.repeat(3000) } }
  };

  it('rejects each malformed envelope with its own code', async () => {
    const { ws, members } = await setup(['alice']);
    for (const [code, override] of Object.entries(bad)) {
      const res = await post(ws, members.alice.token, envelope('note.info', override));
      expect(res.status, code).toBe(400);
      expect(res.body.error, code).toBe(code);
    }
  });

  it('rejects a body that is not an envelope at all', async () => {
    const { ws, members } = await setup(['alice']);
    const res = await call('POST', '/ws/' + ws.ws + '/post', { token: members.alice.token, body: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('envelope_missing');
  });

  it('rejects a ts outside the 5 minute freshness window in both directions', async () => {
    const { ws, members } = await setup(['alice']);
    for (const offset of [-6 * 60 * 1000, 6 * 60 * 1000]) {
      const res = await post(ws, members.alice.token, envelope('note.info', { ts: Date.now() + offset }));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('envelope_ts_skew');
      expect(res.body.window_ms).toBe(300000);
    }
    const edge = await post(ws, members.alice.token, envelope('note.info', { ts: Date.now() - 4 * 60 * 1000 }));
    expect(edge.status).toBe(201);
  });

  it('accepts a second-precision ts as well as milliseconds', async () => {
    const { ws, members } = await setup(['alice']);
    const res = await post(ws, members.alice.token, envelope('note.info', { ts: Math.floor(Date.now() / 1000) }));
    expect(res.status).toBe(201);
  });
});

describe('retention', () => {
  it('drops messages past the 7 day TTL', async () => {
    const { ws, members } = await setup(['alice']);
    const old = await post(ws, members.alice.token, envelope('note.info', { seq: 1 }));

    // Age the stored message past the TTL. Only received_at (server time) is
    // used for retention — a client cannot extend its own message's life.
    await runInDurableObject(workspaceStub(ws.ws), (_instance, state) => {
      state.storage.sql.exec('UPDATE messages SET received_at = ?', Date.now() - 8 * 24 * 60 * 60 * 1000);
    });

    const stale = await sync(ws, members.alice.token, 0);
    expect(stale.body.messages).toHaveLength(0);
    expect(stale.body.more).toBe(0);

    // The next write path actually deletes it.
    await post(ws, members.alice.token, envelope('note.info', { seq: 2 }));
    const rows = await runInDurableObject(workspaceStub(ws.ws), (_instance, state) =>
      state.storage.sql.exec('SELECT seq FROM messages ORDER BY seq').toArray()
    );
    expect(rows.map((r) => r.seq)).not.toContain(old.body.seq);
    expect(rows).toHaveLength(1);
  });

  it('keeps only the last 500 messages', async () => {
    const { ws, members } = await setup(['alice']);
    const now = Date.now();
    const memberId = members.alice.member_id;
    await runInDurableObject(workspaceStub(ws.ws), (_instance, state) => {
      for (let i = 0; i < 510; i++) {
        state.storage.sql.exec(
          'INSERT INTO messages (seq, sender, type, client_seq, received_at, envelope) VALUES (?, ?, ?, ?, ?, ?)',
          1000 + i,
          memberId,
          'note.info',
          5000 + i,
          now,
          '{"v":1}'
        );
      }
      state.storage.sql.exec("UPDATE meta SET v = '1600' WHERE k = 'next_seq'");
    });

    await post(ws, members.alice.token, envelope('note.info', { seq: 99999 }));
    const rows = await runInDurableObject(workspaceStub(ws.ws), (_instance, state) =>
      state.storage.sql.exec('SELECT COUNT(*) AS n, MIN(seq) AS lo, MAX(seq) AS hi FROM messages').toArray()
    );
    expect(rows[0].n).toBe(500);
    expect(rows[0].hi).toBe(1600);
    // 510 seeded + 1 posted = 511; the 11 oldest are dropped by the bound.
    expect(rows[0].lo).toBe(1011);
  });
});
