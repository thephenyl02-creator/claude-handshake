import { describe, expect, it } from 'vitest';
import { call, createWorkspace, join, setup } from './helpers.js';

describe('authentication', () => {
  it('401s a bad, missing or malformed member token', async () => {
    const { ws, members } = await setup(['alice']);
    const path = '/ws/' + ws.ws + '/heartbeat';
    const good = members.alice.token;

    const cases = [
      undefined,
      'not-a-token',
      'hsm_' + '0'.repeat(16) + '_' + '0'.repeat(64),
      good.slice(0, -1) + (good.endsWith('a') ? 'b' : 'a'),
      ws.enrollment_token,
      ws.recovery_key
    ];
    for (const token of cases) {
      const res = await call('POST', path, { token, body: { state: 'working' } });
      expect(res.status, JSON.stringify(token)).toBe(401);
      expect(res.body.error).toBe('invalid_token');
      // The relay never echoes the credential it rejected.
      if (token) expect(res.text).not.toContain(token);
    }
  });

  it('401s a member token against a different workspace', async () => {
    const { members } = await setup(['alice']);
    const other = await createWorkspace();
    await join(other, 'bob');
    const res = await call('POST', '/ws/' + other.ws + '/heartbeat', {
      token: members.alice.token,
      body: { state: 'working' }
    });
    expect(res.status).toBe(401);
  });

  it('404s every operation on a workspace id that was never created', async () => {
    const ghost = '0'.repeat(31) + '1';
    const paths = [
      ['POST', '/heartbeat'],
      ['POST', '/claim'],
      ['POST', '/release'],
      ['POST', '/post'],
      ['GET', '/sync'],
      ['POST', '/rotate'],
      ['POST', '/purge']
    ];
    for (const [method, suffix] of paths) {
      const res = await call(method, '/ws/' + ghost + suffix, {
        token: 'hsm_' + '0'.repeat(16) + '_' + '0'.repeat(64),
        body: method === 'GET' ? undefined : {}
      });
      expect(res.status, suffix).toBe(404);
      expect(res.body.error).toBe('workspace_not_found');
    }
  });

  it('rate-limits repeated auth failures from one IP', async () => {
    const { ws } = await setup(['alice']);
    const ip = '198.51.100.7';
    const bad = 'hsm_' + '0'.repeat(16) + '_' + '1'.repeat(64);
    let sawLimit = null;
    for (let i = 0; i < 14; i++) {
      const res = await call('POST', '/ws/' + ws.ws + '/heartbeat', { token: bad, ip, body: { state: 'working' } });
      if (res.status === 429) {
        sawLimit = res;
        break;
      }
      expect(res.status).toBe(401);
    }
    expect(sawLimit, 'expected a 429 within 14 failures').not.toBeNull();
    expect(sawLimit.body.error).toBe('rate_limited');
    expect(Number(sawLimit.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('never blocks a valid credential, even from the IP that was failing', async () => {
    const { ws, members } = await setup(['alice']);
    const bad = 'hsm_' + '0'.repeat(16) + '_' + '2'.repeat(64);
    const shared = '198.51.100.8';
    for (let i = 0; i < 20; i++) {
      await call('POST', '/ws/' + ws.ws + '/heartbeat', { token: bad, ip: shared, body: { state: 'working' } });
    }

    // Same IP: a NAT or corporate proxy puts every member behind one address,
    // so a hot failure bucket must not become a lockout for good tokens.
    const sameIp = await call('POST', '/ws/' + ws.ws + '/heartbeat', {
      token: members.alice.token,
      ip: shared,
      body: { state: 'working' }
    });
    expect(sameIp.status).toBe(200);

    const otherIp = await call('POST', '/ws/' + ws.ws + '/heartbeat', {
      token: members.alice.token,
      ip: '198.51.100.9',
      body: { state: 'working' }
    });
    expect(otherIp.status).toBe(200);
  });
});

describe('credential exposure', () => {
  it('never returns another member secret, or any workspace credential, after creation', async () => {
    const { ws, members } = await setup(['alice', 'bob']);
    await call('POST', '/ws/' + ws.ws + '/heartbeat', { token: members.bob.token, body: { state: 'working' } });
    await call('POST', '/ws/' + ws.ws + '/claim', { token: members.bob.token, body: { subject: 'work' } });

    const responses = [
      await call('GET', '/ws/' + ws.ws + '/sync', { token: members.alice.token }),
      await call('POST', '/ws/' + ws.ws + '/heartbeat', { token: members.alice.token, body: { state: 'working' } }),
      await call('POST', '/ws/' + ws.ws + '/claim', { token: members.alice.token, body: { subject: 'other work' } })
    ];
    const leaks = [ws.enrollment_token, ws.recovery_key, members.bob.secret, members.bob.token];
    for (const res of responses) {
      for (const secret of leaks) {
        expect(res.text).not.toContain(secret);
      }
    }
    // Peers do learn each other's member ids — that is the point of `from`.
    expect(responses[0].text).toContain(members.bob.member_id);
  });
});

describe('member removal', () => {
  it('invalidates that member sub-token and releases its claims', async () => {
    const { ws, members } = await setup(['alice', 'bob']);
    await call('POST', '/ws/' + ws.ws + '/claim', {
      token: members.bob.token,
      body: { subject: 'bob work' }
    });

    const removed = await call('POST', '/ws/' + ws.ws + '/members/' + members.bob.member_id + '/remove', {
      token: ws.recovery_key,
      body: {}
    });
    expect(removed.status).toBe(200);
    expect(removed.body.claims_released).toBe(1);

    const after = await call('POST', '/ws/' + ws.ws + '/heartbeat', {
      token: members.bob.token,
      body: { state: 'working' }
    });
    expect(after.status).toBe(403);
    expect(after.body.error).toBe('member_revoked');

    const view = await call('GET', '/ws/' + ws.ws + '/sync', { token: members.alice.token });
    expect(view.body.claims).toHaveLength(0);
    expect(view.body.members.map((m) => m.name)).toEqual(['alice']);
  });

  it('requires the recovery key, not a member or enrollment token', async () => {
    const { ws, members } = await setup(['alice', 'bob']);
    for (const token of [members.alice.token, ws.enrollment_token]) {
      const res = await call('POST', '/ws/' + ws.ws + '/members/' + members.bob.member_id + '/remove', {
        token,
        body: {}
      });
      expect(res.status).toBe(401);
    }
    const missing = await call('POST', '/ws/' + ws.ws + '/members/deadbeefdeadbeef/remove', {
      token: ws.recovery_key,
      body: {}
    });
    expect(missing.status).toBe(404);
  });
});
