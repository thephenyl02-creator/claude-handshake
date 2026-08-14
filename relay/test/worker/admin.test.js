import { describe, expect, it } from 'vitest';
import { call, envelope, setup } from './helpers.js';

const post = (ws, token, env) => call('POST', '/ws/' + ws.ws + '/post', { token, body: { envelope: env } });
const sync = (ws, token, cursor) =>
  call('GET', '/ws/' + ws.ws + '/sync' + (cursor === undefined ? '' : '?cursor=' + cursor), { token });
const joinWith = (ws, token, member) => call('POST', '/ws/' + ws.ws + '/join', { token, body: { member } });

describe('rotation', () => {
  it('mints a new enrollment token and honours a 24h grace on the previous one', async () => {
    const { ws } = await setup(['alice']);
    const rotated = await call('POST', '/ws/' + ws.ws + '/rotate', { token: ws.recovery_key, body: {} });
    expect(rotated.status).toBe(200);
    expect(rotated.body.enrollment_token).toMatch(/^hsk_[0-9a-f]{64}_[0-9a-f]{8}$/);
    expect(rotated.body.enrollment_token).not.toBe(ws.enrollment_token);
    expect(rotated.body.grace_seconds).toBe(86400);
    expect(rotated.body.previous_valid_until).toBeGreaterThan(Date.now() + 86_000_000);

    const withNew = await joinWith(ws, rotated.body.enrollment_token, 'bob');
    expect(withNew.status).toBe(201);
    expect(withNew.body.enrollment_grace).toBe(false);

    // The old invite keeps working during the grace window — a peer mid-join
    // is not broken by a rotation.
    const withOld = await joinWith(ws, ws.enrollment_token, 'carol');
    expect(withOld.status).toBe(201);
    expect(withOld.body.enrollment_grace).toBe(true);
  });

  it('closes the grace window immediately when the founder asks for it', async () => {
    const { ws } = await setup(['alice']);
    const rotated = await call('POST', '/ws/' + ws.ws + '/rotate', {
      token: ws.recovery_key,
      body: { grace_seconds: 0 }
    });
    expect(rotated.status).toBe(200);

    const withOld = await joinWith(ws, ws.enrollment_token, 'bob');
    expect(withOld.status).toBe(401);
    expect(withOld.body.error).toBe('enrollment_token_expired');

    const withNew = await joinWith(ws, rotated.body.enrollment_token, 'bob');
    expect(withNew.status).toBe(201);
  });

  it('requires the recovery key — the current bearer is not enough', async () => {
    const { ws, members } = await setup(['alice']);
    for (const token of [ws.enrollment_token, members.alice.token, undefined]) {
      const res = await call('POST', '/ws/' + ws.ws + '/rotate', { token, body: {} });
      expect(res.status).toBe(401);
    }
    const bad = await call('POST', '/ws/' + ws.ws + '/rotate', { token: ws.recovery_key, body: { grace_seconds: -1 } });
    expect(bad.status).toBe(400);
  });

  it('leaves existing member sub-tokens working', async () => {
    const { ws, members } = await setup(['alice']);
    await call('POST', '/ws/' + ws.ws + '/rotate', { token: ws.recovery_key, body: {} });
    const beat = await call('POST', '/ws/' + ws.ws + '/heartbeat', {
      token: members.alice.token,
      body: { state: 'working' }
    });
    expect(beat.status).toBe(200);
  });
});

describe('purge', () => {
  it('clears live chatter without rewinding sequence numbers', async () => {
    const { ws, members } = await setup(['alice', 'bob']);
    await post(ws, members.alice.token, envelope('note.info', { seq: 1 }));
    await post(ws, members.alice.token, envelope('note.info', { seq: 2 }));
    await call('POST', '/ws/' + ws.ws + '/claim', { token: members.alice.token, body: { subject: 'kept work' } });

    const purged = await call('POST', '/ws/' + ws.ws + '/purge', { token: ws.recovery_key, body: {} });
    expect(purged.status).toBe(200);
    expect(purged.body.messages_purged).toBe(2);
    expect(purged.body.next_seq).toBe(3);

    const view = await sync(ws, members.bob.token, 0);
    expect(view.body.messages).toHaveLength(0);
    // Claims and presence survive a plain purge: it clears chatter, not work.
    expect(view.body.claims).toHaveLength(1);

    const next = await post(ws, members.alice.token, envelope('note.info', { seq: 3 }));
    expect(next.body.seq).toBe(3);
  });

  it('clears claims and presence too when asked', async () => {
    const { ws, members } = await setup(['alice']);
    await call('POST', '/ws/' + ws.ws + '/heartbeat', { token: members.alice.token, body: { state: 'working' } });
    await call('POST', '/ws/' + ws.ws + '/claim', { token: members.alice.token, body: { subject: 'work' } });
    const purged = await call('POST', '/ws/' + ws.ws + '/purge', { token: ws.recovery_key, body: { all: true } });
    expect(purged.body.claims_purged).toBe(1);

    const view = await sync(ws, members.alice.token, 0);
    expect(view.body.claims).toHaveLength(0);
    expect(view.body.presence).toHaveLength(0);
    // Membership itself is untouched — purge is not offboarding.
    expect(view.body.members).toHaveLength(1);
  });

  it('requires the recovery key', async () => {
    const { ws, members } = await setup(['alice']);
    for (const token of [members.alice.token, ws.enrollment_token]) {
      const res = await call('POST', '/ws/' + ws.ws + '/purge', { token, body: {} });
      expect(res.status).toBe(401);
    }
  });
});

describe('destroy', () => {
  it('leaves nothing behind and does not let the id be re-bound', async () => {
    const { ws, members } = await setup(['alice']);
    await post(ws, members.alice.token, envelope('note.info'));

    const gone = await call('DELETE', '/ws/' + ws.ws, { token: ws.recovery_key });
    expect(gone.status).toBe(200);
    expect(gone.body.destroyed).toBe(true);

    const after = await sync(ws, members.alice.token, 0);
    expect(after.status).toBe(404);

    const rejoin = await joinWith(ws, ws.enrollment_token, 'mallory');
    expect(rejoin.status).toBe(404);
    expect(rejoin.body.error).toBe('workspace_not_found');
  });

  it('requires the recovery key', async () => {
    const { ws, members } = await setup(['alice']);
    for (const token of [members.alice.token, ws.enrollment_token]) {
      const res = await call('DELETE', '/ws/' + ws.ws, { token });
      expect(res.status).toBe(401);
    }
    const alive = await sync(ws, members.alice.token, 0);
    expect(alive.status).toBe(200);
  });
});
