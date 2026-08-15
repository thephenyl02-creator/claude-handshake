import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { call, envelope, post, send, setup, workspaceStub } from './helpers.js';

const sync = (ws, token, cursor) =>
  call('GET', '/ws/' + ws.ws + '/sync' + (cursor === undefined ? '' : '?cursor=' + cursor), { token });

describe('message append', () => {
  it('assigns a monotonic seq and stamps from as the authenticated member', async () => {
    const { ws, members } = await setup(['alice', 'bob']);
    const one = await send(ws, members.alice, 'note.discovery', { sender_seq: 1 });
    const two = await send(ws, members.bob, 'note.info', { sender_seq: 1 });
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
      members.bob,
      envelope(ws, members.bob, 'note.info', {
        from: { member: members.alice.member_id, machine: 'm-abcdef01', session: 's-abcdef01' }
      })
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('from_mismatch');
    expect(res.body.expected).toBe(members.bob.member_id);

    const honest = await send(ws, members.bob, 'note.info');
    expect(honest.status).toBe(201);
  });

  it('stores and returns the envelope verbatim, including sig and reserved fields', async () => {
    const { ws, members } = await setup(['alice']);
    const sent = envelope(ws, members.alice, 'warn.overlap', {
      sig: 'a'.repeat(64),
      enc: 'aes-256-gcm',
      alg: 'HS256',
      body: { paths: ['src/a.js'], nested: { deep: [1, 2, 3] } }
    });
    await post(ws, members.alice, sent);
    const view = await sync(ws, members.alice.token, 0);
    expect(view.body.messages[0].envelope).toEqual(sent);
    expect(view.body.messages[0].envelope.sig).toBe(sent.sig);
    expect(view.body.messages[0].envelope.enc).toBe('aes-256-gcm');
    // The whole signed field set survives the round trip, `from` included.
    expect(view.body.messages[0].envelope.from).toEqual(sent.from);
    expect(view.body.messages[0].envelope.sender_seq).toBe(sent.sender_seq);
  });

  it('is idempotent for a replayed (sender, sender_seq) pair', async () => {
    const { ws, members } = await setup(['alice']);
    const env = envelope(ws, members.alice, 'note.fix', { sender_seq: 42 });
    const first = await post(ws, members.alice, env);
    const replay = await post(ws, members.alice, env);
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
    expect(replay.body.seq).toBe(first.body.seq);

    const view = await sync(ws, members.alice.token, 0);
    expect(view.body.messages).toHaveLength(1);
  });

  it('dedupes per sender, not globally — two members may use the same sender_seq', async () => {
    const { ws, members } = await setup(['alice', 'bob']);
    const one = await send(ws, members.alice, 'note.info', { sender_seq: 7 });
    const two = await send(ws, members.bob, 'note.info', { sender_seq: 7 });
    expect(one.status).toBe(201);
    expect(two.status).toBe(201);
    expect(two.body.duplicate).toBeUndefined();
    expect(two.body.seq).not.toBe(one.body.seq);
  });
});

describe('envelope validation', () => {
  const bad = {
    envelope_version: { v: 2 },
    envelope_type: { type: 'NotAType' },
    envelope_nonce: { nonce: 'x' },
    envelope_sender_seq: { sender_seq: -1 },
    envelope_sig: { sig: 123 },
    envelope_ts: { ts: 'now' },
    envelope_body_too_large: { body: { blob: 'x'.repeat(3000) } }
  };

  it('rejects each malformed envelope with its own code', async () => {
    const { ws, members } = await setup(['alice']);
    for (const [code, override] of Object.entries(bad)) {
      const res = await send(ws, members.alice, 'note.info', override);
      expect(res.status, code).toBe(400);
      expect(res.body.error, code).toBe(code);
    }
  });

  it('rejects a fractional or missing sender_seq under its own code', async () => {
    const { ws, members } = await setup(['alice']);
    for (const override of [{ sender_seq: 1.5 }, { sender_seq: '3' }, { sender_seq: undefined }, { seq: 4 }]) {
      const env = envelope(ws, members.alice, 'note.info', override);
      // The old field name is not an alias: `seq` alone leaves sender_seq unset.
      if ('seq' in override) delete env.sender_seq;
      const res = await post(ws, members.alice, env);
      expect(res.status, JSON.stringify(override)).toBe(400);
      expect(res.body.error).toBe('envelope_sender_seq');
    }
  });

  it('requires a complete from triple', async () => {
    const { ws, members } = await setup(['alice']);
    const id = members.alice.member_id;
    const cases = [
      undefined,
      null,
      'alice',
      { member: id },
      { member: id, machine: 'm-1' },
      { member: id, session: 's-1' },
      { machine: 'm-1', session: 's-1' },
      { member: id, machine: 'm-1', session: 42 },
      { member: '', machine: 'm-1', session: 's-1' },
      [id, 'm-1', 's-1']
    ];
    for (const from of cases) {
      const env = envelope(ws, members.alice, 'note.info', { from });
      if (from === undefined) delete env.from;
      const res = await post(ws, members.alice, env);
      expect(res.status, JSON.stringify(from)).toBe(400);
      expect(res.body.error, JSON.stringify(from)).toBe('envelope_from');
    }

    const complete = await send(ws, members.alice, 'note.info');
    expect(complete.status).toBe(201);
  });

  it('refuses an envelope addressed to another workspace', async () => {
    const { ws, members } = await setup(['alice']);
    const cases = ['f'.repeat(32), '', 'not-a-ws-id', 42, undefined];
    for (const value of cases) {
      const env = envelope(ws, members.alice, 'note.info', { ws: value });
      if (value === undefined) delete env.ws;
      const res = await post(ws, members.alice, env);
      expect(res.status, JSON.stringify(value)).toBe(400);
      expect(res.body.error, JSON.stringify(value)).toBe('envelope_ws');
    }
  });

  it('refuses an envelope minted for a real other workspace, and stores nothing', async () => {
    const { ws, members } = await setup(['alice']);
    const other = await setup(['alice']);
    const res = await post(ws, members.alice, envelope(other.ws, members.alice, 'note.info'));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('envelope_ws');

    const view = await sync(ws, members.alice.token, 0);
    expect(view.body.messages).toHaveLength(0);
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
      const res = await send(ws, members.alice, 'note.info', { ts: Date.now() + offset });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('envelope_ts_skew');
      expect(res.body.window_ms).toBe(300000);
    }
    const edge = await send(ws, members.alice, 'note.info', { ts: Date.now() - 4 * 60 * 1000 });
    expect(edge.status).toBe(201);
  });

  it('accepts a second-precision ts as well as milliseconds', async () => {
    const { ws, members } = await setup(['alice']);
    const res = await send(ws, members.alice, 'note.info', { ts: Math.floor(Date.now() / 1000) });
    expect(res.status).toBe(201);
  });
});

describe('carriage per transport', () => {
  // PROTOCOL section 3.1: on the relay these four are server state behind their
  // own endpoints. Posting them as envelopes would create unauthenticated
  // shadow state beside the server's.
  const notCarried = ['presence.update', 'task.claim', 'task.release', 'state.request'];

  it('refuses every type the relay does not carry as an envelope', async () => {
    const { ws, members } = await setup(['alice']);
    for (const type of notCarried) {
      const res = await send(ws, members.alice, type);
      expect(res.status, type).toBe(400);
      expect(res.body.error, type).toBe('envelope_type_not_carried');
      expect(res.body.type, type).toBe(type);
    }

    const view = await sync(ws, members.alice.token, 0);
    expect(view.body.messages).toHaveLength(0);
  });

  it('still carries the types that are envelopes on this transport', async () => {
    const { ws, members } = await setup(['alice']);
    const carried = [
      'task.done',
      'task.change',
      'note.discovery',
      'note.error',
      'note.fix',
      'note.blocker',
      'note.info',
      'warn.overlap',
      'ws.join',
      'ws.leave',
      'ws.migrate'
    ];
    for (const [index, type] of carried.entries()) {
      const res = await send(ws, members.alice, type, { sender_seq: 100 + index });
      expect(res.status, type).toBe(201);
    }
  });

  it('does not touch the server-state endpoints those types replace', async () => {
    const { ws, members } = await setup(['alice']);
    // The refusal is about carriage only: the same information still flows,
    // through claim/heartbeat, and sync still returns it.
    const claimed = await call('POST', '/ws/' + ws.ws + '/claim', {
      token: members.alice.token,
      body: { subject: 'onboarding flow' }
    });
    expect(claimed.status).toBe(201);
    const beat = await call('POST', '/ws/' + ws.ws + '/heartbeat', {
      token: members.alice.token,
      body: { state: 'working' }
    });
    expect(beat.status).toBe(200);

    const view = await sync(ws, members.alice.token, 0);
    expect(view.body.claims).toHaveLength(1);
    expect(view.body.presence).toHaveLength(1);
    expect(view.body.messages).toHaveLength(0);
  });
});

describe('retention', () => {
  it('drops messages past the 7 day TTL', async () => {
    const { ws, members } = await setup(['alice']);
    const old = await send(ws, members.alice, 'note.info', { sender_seq: 1 });

    // Age the stored message past the TTL. Only received_at (server time) is
    // used for retention — a client cannot extend its own message's life.
    await runInDurableObject(workspaceStub(ws.ws), (_instance, state) => {
      state.storage.sql.exec('UPDATE messages SET received_at = ?', Date.now() - 8 * 24 * 60 * 60 * 1000);
    });

    const stale = await sync(ws, members.alice.token, 0);
    expect(stale.body.messages).toHaveLength(0);
    expect(stale.body.more).toBe(0);

    // The next write path actually deletes it.
    await send(ws, members.alice, 'note.info', { sender_seq: 2 });
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

    await send(ws, members.alice, 'note.info', { sender_seq: 99999 });
    const rows = await runInDurableObject(workspaceStub(ws.ws), (_instance, state) =>
      state.storage.sql.exec('SELECT COUNT(*) AS n, MIN(seq) AS lo, MAX(seq) AS hi FROM messages').toArray()
    );
    expect(rows[0].n).toBe(500);
    expect(rows[0].hi).toBe(1600);
    // 510 seeded + 1 posted = 511; the 11 oldest are dropped by the bound.
    expect(rows[0].lo).toBe(1011);
  });
});
