import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { call, send, setup, workspaceStub } from './helpers.js';

const sync = (ws, token, cursor) =>
  call('GET', '/ws/' + ws.ws + '/sync' + (cursor === undefined ? '' : '?cursor=' + cursor), { token });

// One sender's messages go out together (the Durable Object serializes them
// anyway), but separate floods stay sequential so sender order is stable.
async function flood(ws, member, count, type, from) {
  const results = await Promise.all(
    Array.from({ length: count }, (_, i) => send(ws, member, type, { sender_seq: (from || 0) + i }))
  );
  for (const res of results) {
    if (res.status !== 201) throw new Error('post failed: ' + res.text);
  }
}

describe('sync cursor', () => {
  it('returns only messages after the cursor and reports the overflow', async () => {
    const { ws, members } = await setup(['alice', 'bob']);
    await flood(ws, members.alice, 3, 'note.info');

    const all = await sync(ws, members.bob.token, 0);
    expect(all.body.messages).toHaveLength(3);
    expect(all.body.more).toBe(0);
    expect(all.body.next_cursor).toBe(all.body.messages[2].seq);

    const after = await sync(ws, members.bob.token, all.body.messages[0].seq);
    expect(after.body.messages).toHaveLength(2);
    expect(after.body.messages[0].seq).toBe(all.body.messages[1].seq);
  });

  it('caps a fetch at 20 and counts the rest as more', async () => {
    const { ws, members } = await setup(['alice', 'bob']);
    await flood(ws, members.alice, 25, 'note.info');
    const view = await sync(ws, members.bob.token, 0);
    expect(view.body.messages).toHaveLength(20);
    expect(view.body.more).toBe(5);
  });

  it('does not move the stored cursor by itself — the client advances it', async () => {
    const { ws, members } = await setup(['alice', 'bob']);
    await flood(ws, members.alice, 2, 'note.info');

    const first = await sync(ws, members.bob.token);
    expect(first.body.stored_cursor).toBe(0);
    expect(first.body.messages).toHaveLength(2);

    // Re-injection is suppressed only once the client says it consumed them.
    const again = await sync(ws, members.bob.token);
    expect(again.body.messages).toHaveLength(2);

    const write = await call('POST', '/ws/' + ws.ws + '/cursor', {
      token: members.bob.token,
      body: { seq: first.body.next_cursor }
    });
    expect(write.status).toBe(200);
    expect(write.body.cursor).toBe(first.body.next_cursor);

    const third = await sync(ws, members.bob.token);
    expect(third.body.messages).toHaveLength(0);
    expect(third.body.stored_cursor).toBe(first.body.next_cursor);
  });

  it('keeps cursor writes to their owner and never moves one backwards', async () => {
    const { ws, members } = await setup(['alice', 'bob']);
    await flood(ws, members.alice, 2, 'note.info');
    const view = await sync(ws, members.bob.token);
    await call('POST', '/ws/' + ws.ws + '/cursor', { token: members.bob.token, body: { seq: view.body.next_cursor } });

    // A rewind attempt is clamped, not honoured.
    const rewind = await call('POST', '/ws/' + ws.ws + '/cursor', { token: members.bob.token, body: { seq: 0 } });
    expect(rewind.body.cursor).toBe(view.body.next_cursor);
    expect(rewind.body.advanced).toBe(false);

    // Alice writing her own cursor cannot touch Bob's.
    await call('POST', '/ws/' + ws.ws + '/cursor', { token: members.alice.token, body: { seq: 1 } });
    const bobView = await sync(ws, members.bob.token);
    expect(bobView.body.stored_cursor).toBe(view.body.next_cursor);
    const aliceView = await sync(ws, members.alice.token);
    expect(aliceView.body.stored_cursor).toBe(1);
  });

  it('carries the presence snapshot and active claims alongside messages', async () => {
    const { ws, members } = await setup(['alice', 'bob']);
    await call('POST', '/ws/' + ws.ws + '/heartbeat', { token: members.alice.token, body: { state: 'working' } });
    await call('POST', '/ws/' + ws.ws + '/claim', { token: members.alice.token, body: { subject: 'feature x' } });
    await send(ws, members.alice, 'task.done');

    const view = await sync(ws, members.bob.token, 0);
    expect(view.body.members).toHaveLength(2);
    expect(view.body.presence).toHaveLength(1);
    expect(view.body.claims).toHaveLength(1);
    expect(view.body.claims[0].subject).toBe('feature x');
    expect(view.body.messages).toHaveLength(1);
    expect(view.body.ws).toBe(ws.ws);
  });
});

describe('per-sender fairness', () => {
  it('shares the fetch cap across senders instead of letting one bury the rest', async () => {
    const { ws, members } = await setup(['alice', 'bob', 'carol', 'dave']);
    await flood(ws, members.alice, 30, 'note.info');
    await flood(ws, members.bob, 30, 'note.info');
    await flood(ws, members.carol, 2, 'note.info');

    const view = await sync(ws, members.dave.token, 0);
    expect(view.body.messages).toHaveLength(20);
    const bySender = {};
    for (const m of view.body.messages) bySender[m.from_name] = (bySender[m.from_name] || 0) + 1;
    expect(Object.keys(bySender).sort()).toEqual(['alice', 'bob', 'carol']);
    // The quiet sender is not starved, and neither loud sender takes the lot.
    expect(bySender.carol).toBe(2);
    expect(bySender.alice).toBe(9);
    expect(bySender.bob).toBe(9);
  });

  it('reserves slots for warn.* and note.blocker under a flood', async () => {
    const { ws, members } = await setup(['alice', 'bob', 'carol']);
    await flood(ws, members.alice, 40, 'note.info');
    // Posted last, so a plain oldest-first fetch would never reach them.
    await send(ws, members.bob, 'warn.overlap', { sender_seq: 900 });
    await send(ws, members.bob, 'note.blocker', { sender_seq: 901 });

    const view = await sync(ws, members.carol.token, 0);
    expect(view.body.messages).toHaveLength(20);
    const types = view.body.messages.map((m) => m.envelope.type);
    expect(types).toContain('warn.overlap');
    expect(types).toContain('note.blocker');
    expect(view.body.more).toBe(22);
  });

  it('still finds a warning that sits past the candidate window', async () => {
    const { ws, members } = await setup(['alice', 'bob', 'carol']);
    const now = Date.now();
    const loud = members.alice.member_id;
    const quiet = members.bob.member_id;
    // Seeded directly: the point is a backlog deeper than SYNC_CANDIDATE_WINDOW
    // (200), which is too slow to build one HTTP request at a time.
    await runInDurableObject(workspaceStub(ws.ws), (_instance, state) => {
      for (let i = 1; i <= 250; i++) {
        state.storage.sql.exec(
          'INSERT INTO messages (seq, sender, type, client_seq, received_at, envelope) VALUES (?, ?, ?, ?, ?, ?)',
          i,
          loud,
          'note.info',
          i,
          now,
          '{"v":1,"type":"note.info"}'
        );
      }
      state.storage.sql.exec(
        'INSERT INTO messages (seq, sender, type, client_seq, received_at, envelope) VALUES (?, ?, ?, ?, ?, ?)',
        251,
        quiet,
        'warn.overlap',
        1,
        now,
        '{"v":1,"type":"warn.overlap"}'
      );
      state.storage.sql.exec("UPDATE meta SET v = '252' WHERE k = 'next_seq'");
    });

    const view = await call('GET', '/ws/' + ws.ws + '/sync?cursor=0', { token: members.carol.token });
    expect(view.body.messages).toHaveLength(20);
    expect(view.body.messages.map((m) => m.seq)).toContain(251);
    expect(view.body.more).toBe(231);
  });

  it('does not let the reserved floor starve normal traffic', async () => {
    const { ws, members } = await setup(['alice', 'bob']);
    await flood(ws, members.alice, 30, 'warn.overlap');
    const view = await sync(ws, members.bob.token, 0);
    expect(view.body.messages).toHaveLength(20);
  });
});
