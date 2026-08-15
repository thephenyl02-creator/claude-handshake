// POST /ws/:id/members/:member/rebind — the lost-local-state recovery path
// (PROTOCOL section 9.2 row 15, Appendix B A3, SECURITY section 7.3). Names are
// permanently retired on removal, so a member that loses its sub-token has no
// re-join; the recovery key reissues one for the member that already exists.

import { describe, expect, it } from 'vitest';
import { call, createWorkspace, join, send, setup } from './helpers.js';

const rebind = (ws, target, token) =>
  call('POST', '/ws/' + ws.ws + '/members/' + target + '/rebind', { token, body: {} });
const heartbeat = (ws, token) => call('POST', '/ws/' + ws.ws + '/heartbeat', { token, body: { state: 'working' } });
const sync = (ws, token) => call('GET', '/ws/' + ws.ws + '/sync', { token });

describe('member rebind', () => {
  it('reissues a sub-token and invalidates the previous secret', async () => {
    const { ws, members } = await setup(['alice', 'bob']);

    const res = await rebind(ws, members.alice.member_id, ws.recovery_key);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Same member, same name: a rebind is recovery, not a new identity.
    expect(res.body.member_id).toBe(members.alice.member_id);
    expect(res.body.member).toBe('alice');
    expect(res.body.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.token).toBe('hsm_' + res.body.member_id + '_' + res.body.secret);
    expect(res.body.token).not.toBe(members.alice.token);
    expect(res.body.rebound_at).toBeGreaterThan(0);

    // The lost sub-token stops working the moment the new one is minted.
    const stale = await heartbeat(ws, members.alice.token);
    expect(stale.status).toBe(401);
    expect(stale.body.error).toBe('invalid_token');

    const fresh = await heartbeat(ws, res.body.token);
    expect(fresh.status).toBe(200);
    expect(fresh.body.member_id).toBe(members.alice.member_id);

    // Nobody else is disturbed by one member's recovery.
    expect((await heartbeat(ws, members.bob.token)).status).toBe(200);
  });

  it('keeps that member claims, cursor and place in the roster', async () => {
    const { ws, members } = await setup(['alice', 'bob']);
    await call('POST', '/ws/' + ws.ws + '/claim', {
      token: members.alice.token,
      body: { subject: 'feature x', files: ['src/x.js'] }
    });
    await send(ws, members.bob, 'note.info', { sender_seq: 1 });
    const before = await sync(ws, members.alice.token);
    await call('POST', '/ws/' + ws.ws + '/cursor', {
      token: members.alice.token,
      body: { seq: before.body.next_cursor }
    });

    const res = await rebind(ws, members.alice.member_id, ws.recovery_key);
    const after = await sync(ws, res.body.token);

    expect(after.body.member_id).toBe(members.alice.member_id);
    expect(after.body.stored_cursor).toBe(before.body.next_cursor);
    expect(after.body.members.map((m) => m.name).sort()).toEqual(['alice', 'bob']);
    expect(after.body.claims).toHaveLength(1);
    expect(after.body.claims[0].owner).toBe(members.alice.member_id);

    // The claim is still that member's to release, under the new credential.
    const released = await call('POST', '/ws/' + ws.ws + '/release', {
      token: res.body.token,
      body: { subject: 'feature x' }
    });
    expect(released.status).toBe(200);
  });

  it('accepts the member name as well as the member id', async () => {
    const { ws, members } = await setup(['alice']);
    const res = await rebind(ws, 'alice', ws.recovery_key);
    expect(res.status).toBe(200);
    expect(res.body.member_id).toBe(members.alice.member_id);
    expect(res.body.member).toBe('alice');
    expect((await heartbeat(ws, res.body.token)).status).toBe(200);
  });

  it('404s a member that never existed', async () => {
    const { ws } = await setup(['alice']);
    for (const target of ['deadbeefdeadbeef', 'mallory']) {
      const res = await rebind(ws, target, ws.recovery_key);
      expect(res.status, target).toBe(404);
      expect(res.body.error, target).toBe('member_not_found');
    }
  });

  it('409s a removed member and does not un-retire the name', async () => {
    const { ws, members } = await setup(['alice', 'bob']);
    await call('POST', '/ws/' + ws.ws + '/members/' + members.bob.member_id + '/remove', {
      token: ws.recovery_key,
      body: {}
    });

    for (const target of [members.bob.member_id, 'bob']) {
      const res = await rebind(ws, target, ws.recovery_key);
      expect(res.status, target).toBe(409);
      expect(res.body.error, target).toBe('member_revoked');
    }

    // The name stays retired: rebind is not a way back in for a removed member.
    const rejoin = await call('POST', '/ws/' + ws.ws + '/join', {
      token: ws.enrollment_token,
      body: { member: 'bob' }
    });
    expect(rejoin.status).toBe(409);
    expect(rejoin.body.error).toBe('member_name_taken');
    expect(rejoin.body.revoked).toBe(true);

    // And the revoked sub-token is still dead, not resurrected by the attempt.
    const beat = await heartbeat(ws, members.bob.token);
    expect(beat.status).toBe(403);
    expect(beat.body.error).toBe('member_revoked');
  });

  it('requires the recovery key, not a member or enrollment token', async () => {
    const { ws, members } = await setup(['alice']);
    for (const token of [members.alice.token, ws.enrollment_token, undefined]) {
      const res = await rebind(ws, members.alice.member_id, token);
      expect(res.status, String(token)).toBe(401);
      expect(res.body.error).toBe('invalid_token');
    }
    // The member's own credential is untouched by the failed attempts: a
    // rebind nobody authorized must not cost that member its session.
    expect((await heartbeat(ws, members.alice.token)).status).toBe(200);
  });

  it('404s a workspace that was never created, and rejects a non-POST', async () => {
    const { ws, members } = await setup(['alice']);
    const ghost = await call('POST', '/ws/' + '9'.repeat(32) + '/members/alice/rebind', {
      token: ws.recovery_key,
      body: {}
    });
    expect(ghost.status).toBe(404);
    expect(ghost.body.error).toBe('workspace_not_found');

    const wrongMethod = await call('GET', '/ws/' + ws.ws + '/members/' + members.alice.member_id + '/rebind', {
      token: ws.recovery_key
    });
    expect(wrongMethod.status).toBe(405);

    const unknownSubPath = await call('POST', '/ws/' + ws.ws + '/members/' + members.alice.member_id + '/promote', {
      token: ws.recovery_key,
      body: {}
    });
    expect(unknownSubPath.status).toBe(404);
    expect(unknownSubPath.body.error).toBe('not_found');
  });

  it('leaves the dedupe history in place — the client restarts its counter', async () => {
    const { ws, members } = await setup(['alice']);
    expect((await send(ws, members.alice, 'note.info', { sender_seq: 5 })).status).toBe(201);

    const res = await rebind(ws, members.alice.member_id, ws.recovery_key);
    const rebound = { ...members.alice, token: res.body.token };

    // (sender, sender_seq) stays the dedupe key across a rebind — which is why
    // PROTOCOL section 2.6 restarts the counter at the current Unix ms after
    // local state loss instead of at zero.
    const replayed = await send(ws, rebound, 'note.info', { sender_seq: 5 });
    expect(replayed.status).toBe(200);
    expect(replayed.body.duplicate).toBe(true);

    const moved = await send(ws, rebound, 'note.info', { sender_seq: Date.now() });
    expect(moved.status).toBe(201);
  });

  it('is the recovery path a re-join cannot provide', async () => {
    const ws = await createWorkspace();
    const alice = await join(ws, 'alice');

    // Re-joining under a live name is refused too, not only a retired one.
    const rejoin = await call('POST', '/ws/' + ws.ws + '/join', {
      token: ws.enrollment_token,
      body: { member: 'alice' }
    });
    expect(rejoin.status).toBe(409);
    expect(rejoin.body.error).toBe('member_name_taken');

    const rebound = await rebind(ws, 'alice', ws.recovery_key);
    expect(rebound.status).toBe(200);
    expect(rebound.body.member_id).toBe(alice.member_id);
    expect((await heartbeat(ws, rebound.body.token)).status).toBe(200);
  });
});
