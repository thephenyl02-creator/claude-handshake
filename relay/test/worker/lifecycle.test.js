import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { CREATE_TOKEN, call, createWorkspace, join, setup, workspaceStub } from './helpers.js';

describe('workspace creation', () => {
  it('mints a 128-bit id, an enrollment token and a recovery key, once', async () => {
    const ws = await createWorkspace('demo');
    expect(ws.ws).toMatch(/^[0-9a-f]{32}$/);
    expect(ws.enrollment_token).toMatch(/^hsk_[0-9a-f]{64}_[0-9a-f]{8}$/);
    expect(ws.recovery_key).toMatch(/^hsr_[0-9a-f]{64}_[0-9a-f]{8}$/);
    expect(ws.name).toBe('demo');

    // Two creates never collide and never return the same credentials.
    const other = await createWorkspace('demo');
    expect(other.ws).not.toBe(ws.ws);
    expect(other.enrollment_token).not.toBe(ws.enrollment_token);
  });

  it('refuses creation without the relay create token', async () => {
    const res = await call('POST', '/ws', { token: 'hsk_' + '0'.repeat(64) + '_deadbeef', body: {} });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
  });

  it('stores no recoverable copy of the credentials', async () => {
    const ws = await createWorkspace();
    const stored = await runInDurableObject(workspaceStub(ws.ws), (_instance, state) =>
      state.storage.sql.exec('SELECT k, v FROM meta').toArray()
    );
    const dump = JSON.stringify(stored);
    expect(dump).not.toContain(ws.enrollment_token);
    expect(dump).not.toContain(ws.recovery_key);
    expect(dump).toContain('enroll_hash');
  });
});

describe('join', () => {
  it('mints a per-member sub-token', async () => {
    const ws = await createWorkspace();
    const alice = await join(ws, 'alice');
    expect(alice.member_id).toMatch(/^[0-9a-f]{16}$/);
    expect(alice.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(alice.token).toBe('hsm_' + alice.member_id + '_' + alice.secret);
    expect(alice.token).not.toBe(ws.enrollment_token);
  });

  it('rejects a duplicate member name binding to a different secret', async () => {
    const ws = await createWorkspace();
    const alice = await join(ws, 'alice');
    const again = await call('POST', '/ws/' + ws.ws + '/join', {
      token: ws.enrollment_token,
      body: { member: 'alice' }
    });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('member_name_taken');
    expect(again.body.member_id).toBe(alice.member_id);
  });

  it('resolves two simultaneous joins of the same name to one winner', async () => {
    const ws = await createWorkspace();
    const both = await Promise.all([
      call('POST', '/ws/' + ws.ws + '/join', { token: ws.enrollment_token, body: { member: 'alice' } }),
      call('POST', '/ws/' + ws.ws + '/join', { token: ws.enrollment_token, body: { member: 'alice' } })
    ]);
    const statuses = both.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);

    const view = await call('GET', '/ws/' + ws.ws + '/sync', {
      token: both.find((r) => r.status === 201).body.token
    });
    expect(view.body.members).toHaveLength(1);
  });

  it('never auto-creates a workspace that was never created', async () => {
    const ghost = 'f'.repeat(32);
    const res = await call('POST', '/ws/' + ghost + '/join', {
      token: 'hsk_' + '0'.repeat(64) + '_00000000',
      body: { member: 'mallory' }
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('workspace_not_found');

    // And nothing was written — not even the schema. Probing random ids must
    // not materialize a database per guess, so the assertion is on
    // sqlite_master, not on a table whose existence is the thing in question.
    const rows = await runInDurableObject(workspaceStub(ghost), (_instance, state) =>
      state.storage.sql.exec("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").toArray()
    );
    expect(rows[0].n).toBe(0);
  });

  it('rejects an enrollment token from another workspace', async () => {
    const one = await createWorkspace();
    const two = await createWorkspace();
    const res = await call('POST', '/ws/' + two.ws + '/join', {
      token: one.enrollment_token,
      body: { member: 'alice' }
    });
    expect(res.status).toBe(401);
  });
});

describe('presence', () => {
  it('records a heartbeat and surfaces it to peers', async () => {
    const { ws, members } = await setup(['alice', 'bob']);
    const beat = await call('POST', '/ws/' + ws.ws + '/heartbeat', {
      token: members.alice.token,
      body: { state: 'blocked', note: 'waiting on review', branch: 'feat/x', machine: 'pale-otter' }
    });
    expect(beat.status).toBe(200);
    expect(beat.body.state).toBe('blocked');

    const sync = await call('GET', '/ws/' + ws.ws + '/sync', { token: members.bob.token });
    expect(sync.status).toBe(200);
    const alice = sync.body.presence.find((p) => p.name === 'alice');
    expect(alice.state).toBe('blocked');
    expect(alice.note).toBe('waiting on review');
    expect(alice.updated_at).toBeGreaterThan(0);
    // No hook ever asserts idle; readers derive it from updated_at.
    expect(sync.body.presence.some((p) => p.state === 'idle')).toBe(false);
  });

  it('rejects an unknown presence state', async () => {
    const { ws, members } = await setup(['alice']);
    const res = await call('POST', '/ws/' + ws.ws + '/heartbeat', {
      token: members.alice.token,
      body: { state: 'idle' }
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('presence_state_invalid');
  });
});

describe('claims', () => {
  it('grants one winner per normalized subject and 409s the loser with the live claim', async () => {
    const { ws, members } = await setup(['alice', 'bob']);
    const first = await call('POST', '/ws/' + ws.ws + '/claim', {
      token: members.alice.token,
      body: { subject: 'the onboarding flow', files: ['src/onboard.js'] }
    });
    expect(first.status).toBe(201);
    expect(first.body.claim.owner).toBe(members.alice.member_id);
    expect(first.body.claim.ttl).toBe(7200);

    // Different wording, same normalized subject.
    const second = await call('POST', '/ws/' + ws.ws + '/claim', {
      token: members.bob.token,
      body: { subject: 'Onboarding  FLOW!' }
    });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('claim_conflict');
    expect(second.body.claim.owner).toBe(members.alice.member_id);
    expect(second.body.claim.owner_name).toBe('alice');
    expect(second.body.claim.subject).toBe('the onboarding flow');
  });

  it('resolves two simultaneous claims on one subject to a single winner', async () => {
    const { ws, members } = await setup(['alice', 'bob']);
    const both = await Promise.all([
      call('POST', '/ws/' + ws.ws + '/claim', { token: members.alice.token, body: { subject: 'shared work' } }),
      call('POST', '/ws/' + ws.ws + '/claim', { token: members.bob.token, body: { subject: 'shared  WORK' } })
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);

    const view = await call('GET', '/ws/' + ws.ws + '/sync', { token: members.alice.token });
    expect(view.body.claims).toHaveLength(1);
    const winner = both.find((r) => r.status === 201).body.claim.owner;
    expect(view.body.claims[0].owner).toBe(winner);
  });

  it('lets the owner re-claim to renew and append files progressively', async () => {
    const { ws, members } = await setup(['alice']);
    await call('POST', '/ws/' + ws.ws + '/claim', {
      token: members.alice.token,
      body: { subject: 'feature x', files: ['a.js'] }
    });
    const renew = await call('POST', '/ws/' + ws.ws + '/claim', {
      token: members.alice.token,
      body: { subject: 'feature x', files: ['b.js', 'a.js'] }
    });
    expect(renew.status).toBe(200);
    expect(renew.body.renewed).toBe(true);
    expect(renew.body.claim.files.sort()).toEqual(['a.js', 'b.js']);
  });

  it('releases only for the owning member', async () => {
    const { ws, members } = await setup(['alice', 'bob']);
    await call('POST', '/ws/' + ws.ws + '/claim', {
      token: members.alice.token,
      body: { subject: 'api refactor' }
    });

    const stolen = await call('POST', '/ws/' + ws.ws + '/release', {
      token: members.bob.token,
      body: { subject: 'api refactor' }
    });
    expect(stolen.status).toBe(403);
    expect(stolen.body.error).toBe('not_claim_owner');

    const still = await call('GET', '/ws/' + ws.ws + '/sync', { token: members.bob.token });
    expect(still.body.claims).toHaveLength(1);

    const released = await call('POST', '/ws/' + ws.ws + '/release', {
      token: members.alice.token,
      body: { subject: 'API Refactor' }
    });
    expect(released.status).toBe(200);

    const after = await call('GET', '/ws/' + ws.ws + '/sync', { token: members.bob.token });
    expect(after.body.claims).toHaveLength(0);
  });

  it('404s a release of a claim nobody holds', async () => {
    const { ws, members } = await setup(['alice']);
    const res = await call('POST', '/ws/' + ws.ws + '/release', {
      token: members.alice.token,
      body: { subject: 'never claimed' }
    });
    expect(res.status).toBe(404);
  });

  it('auto-releases an expired lease so the next caller wins it', async () => {
    const { ws, members } = await setup(['alice', 'bob']);
    await call('POST', '/ws/' + ws.ws + '/claim', {
      token: members.alice.token,
      body: { subject: 'stale work', ttl: 60 }
    });
    // Age the lease past its TTL without waiting for it.
    await runInDurableObject(workspaceStub(ws.ws), (_instance, state) => {
      state.storage.sql.exec('UPDATE claims SET renewed_at = ?', Date.now() - 61_000);
    });

    const view = await call('GET', '/ws/' + ws.ws + '/sync', { token: members.bob.token });
    expect(view.body.claims).toHaveLength(0);

    const taken = await call('POST', '/ws/' + ws.ws + '/claim', {
      token: members.bob.token,
      body: { subject: 'stale work' }
    });
    expect(taken.status).toBe(201);
    expect(taken.body.claim.owner).toBe(members.bob.member_id);
  });

  it('renews the caller claims on the heartbeat tick', async () => {
    const { ws, members } = await setup(['alice']);
    await call('POST', '/ws/' + ws.ws + '/claim', {
      token: members.alice.token,
      body: { subject: 'long build', ttl: 120 }
    });
    await runInDurableObject(workspaceStub(ws.ws), (_instance, state) => {
      state.storage.sql.exec('UPDATE claims SET renewed_at = ?', Date.now() - 119_000);
    });
    const beat = await call('POST', '/ws/' + ws.ws + '/heartbeat', {
      token: members.alice.token,
      body: { state: 'working' }
    });
    expect(beat.body.claims).toHaveLength(1);
    expect(beat.body.claims[0].expires_at).toBeGreaterThan(Date.now() + 100_000);
  });

  it('bounds the file list on a first claim, not only on renewal', async () => {
    const { ws, members } = await setup(['alice']);
    const files = Array.from({ length: 65 }, (_, i) => 'src/file' + i + '.js');
    const res = await call('POST', '/ws/' + ws.ws + '/claim', {
      token: members.alice.token,
      body: { subject: 'wide claim', files }
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('claim_files_invalid');

    const ok = await call('POST', '/ws/' + ws.ws + '/claim', {
      token: members.alice.token,
      body: { subject: 'wide claim', files: files.slice(0, 64) }
    });
    expect(ok.status).toBe(201);
    expect(ok.body.claim.files).toHaveLength(64);
  });

  it('rejects an oversized ttl', async () => {
    const { ws, members } = await setup(['alice']);
    const res = await call('POST', '/ws/' + ws.ws + '/claim', {
      token: members.alice.token,
      body: { subject: 'forever', ttl: 999_999 }
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('claim_ttl_invalid');
  });
});

// PROTOCOL Appendix B A7 / section 9.4 step 3: /handshake upgrade re-broadcasts
// live claims on the new transport, and the tiebreak (section 5.4) is decided by
// the earliest acquired_at — so a migrated claim has to be able to carry its
// pre-migration age across.
describe('claim acquired_at (A7)', () => {
  it('honors a supplied acquired_at when the claim row is created', async () => {
    const { ws, members } = await setup(['alice']);
    const before = Date.now() - 3_600_000;
    const res = await call('POST', '/ws/' + ws.ws + '/claim', {
      token: members.alice.token,
      body: { subject: 'migrated work', acquired_at: before }
    });
    expect(res.status).toBe(201);
    expect(res.body.claim.acquired_at).toBe(before);
    // Old for the tiebreak, freshly live for its TTL: renewed_at is still now.
    expect(res.body.claim.renewed_at).toBeGreaterThanOrEqual(before + 3_500_000);
    expect(res.body.claim.expires_at).toBeGreaterThan(Date.now());

    // And it is what peers read, not just what the writer was told.
    const view = await call('GET', '/ws/' + ws.ws + '/sync', { token: members.alice.token });
    expect(view.body.claims[0].acquired_at).toBe(before);
  });

  it('clamps a future acquired_at to now', async () => {
    const { ws, members } = await setup(['alice']);
    const sent = Date.now() + 86_400_000;
    const floor = Date.now();
    const res = await call('POST', '/ws/' + ws.ws + '/claim', {
      token: members.alice.token,
      body: { subject: 'clock ahead', acquired_at: sent }
    });
    expect(res.status).toBe(201);
    expect(res.body.claim.acquired_at).toBeLessThan(sent);
    expect(res.body.claim.acquired_at).toBeGreaterThanOrEqual(floor);
    expect(res.body.claim.acquired_at).toBeLessThanOrEqual(Date.now());
    // Clamping keeps the invariant a future value would break.
    expect(res.body.claim.acquired_at).toBeLessThanOrEqual(res.body.claim.renewed_at);
  });

  it('honors it when re-adopting a lease the relay had already expired', async () => {
    const { ws, members } = await setup(['alice']);
    await call('POST', '/ws/' + ws.ws + '/claim', {
      token: members.alice.token,
      body: { subject: 'long job', ttl: 60 }
    });
    await runInDurableObject(workspaceStub(ws.ws), (_instance, state) => {
      state.storage.sql.exec('UPDATE claims SET renewed_at = ?', Date.now() - 61_000);
    });

    const original = Date.now() - 7_200_000;
    const readopt = await call('POST', '/ws/' + ws.ws + '/claim', {
      token: members.alice.token,
      body: { subject: 'long job', acquired_at: original }
    });
    // The expired row is gone, so this is a create — and the age carries over.
    expect(readopt.status).toBe(201);
    expect(readopt.body.renewed).toBe(false);
    expect(readopt.body.claim.acquired_at).toBe(original);
  });

  it('ignores it when renewing an existing own claim', async () => {
    const { ws, members } = await setup(['alice']);
    const first = await call('POST', '/ws/' + ws.ws + '/claim', {
      token: members.alice.token,
      body: { subject: 'steady work' }
    });
    expect(first.status).toBe(201);
    const stored = first.body.claim.acquired_at;

    // Neither direction moves it: not backwards to win a tiebreak...
    const older = await call('POST', '/ws/' + ws.ws + '/claim', {
      token: members.alice.token,
      body: { subject: 'steady work', acquired_at: 1 }
    });
    expect(older.status).toBe(200);
    expect(older.body.renewed).toBe(true);
    expect(older.body.claim.acquired_at).toBe(stored);

    // ...nor forwards.
    const newer = await call('POST', '/ws/' + ws.ws + '/claim', {
      token: members.alice.token,
      body: { subject: 'steady  WORK!', acquired_at: Date.now() }
    });
    expect(newer.status).toBe(200);
    expect(newer.body.claim.acquired_at).toBe(stored);

    const view = await call('GET', '/ws/' + ws.ws + '/sync', { token: members.alice.token });
    expect(view.body.claims[0].acquired_at).toBe(stored);
  });

  it('never lets a backdated acquired_at touch or take a peer live claim', async () => {
    const { ws, members } = await setup(['alice', 'bob']);
    const held = await call('POST', '/ws/' + ws.ws + '/claim', {
      token: members.alice.token,
      body: { subject: 'the onboarding flow' }
    });
    expect(held.status).toBe(201);
    const aliceAcquired = held.body.claim.acquired_at;

    const stolen = await call('POST', '/ws/' + ws.ws + '/claim', {
      token: members.bob.token,
      body: { subject: 'Onboarding  FLOW!', acquired_at: 0 }
    });
    // An older acquired_at is not a way in: the relay's own first-come result
    // stands and the 409 body still describes alice's untouched claim.
    expect(stolen.status).toBe(409);
    expect(stolen.body.error).toBe('claim_conflict');
    expect(stolen.body.claim.owner).toBe(members.alice.member_id);
    expect(stolen.body.claim.acquired_at).toBe(aliceAcquired);

    const row = await runInDurableObject(workspaceStub(ws.ws), (_instance, state) =>
      state.storage.sql.exec('SELECT owner, acquired_at FROM claims').toArray()
    );
    expect(row).toHaveLength(1);
    expect(row[0].owner).toBe(members.alice.member_id);
    expect(row[0].acquired_at).toBe(aliceAcquired);
  });

  it('rejects a non-integer acquired_at', async () => {
    const { ws, members } = await setup(['alice', 'bob']);
    for (const value of ['1755230000000', 1755230000000.5, null, true, NaN, { ms: 1 }]) {
      const res = await call('POST', '/ws/' + ws.ws + '/claim', {
        token: members.alice.token,
        body: { subject: 'typed wrong', acquired_at: value }
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('claim_acquired_at_invalid');
    }

    // Nothing was claimed by the bad requests, so the subject is still free.
    const free = await call('POST', '/ws/' + ws.ws + '/claim', {
      token: members.bob.token,
      body: { subject: 'typed wrong' }
    });
    expect(free.status).toBe(201);
  });
});

describe('method and shape guards', () => {
  it('rejects a GET on a POST endpoint', async () => {
    const { ws, members } = await setup(['alice']);
    const res = await call('GET', '/ws/' + ws.ws + '/claim', { token: members.alice.token });
    expect(res.status).toBe(405);
  });

  it('rejects a malformed workspace id without touching storage', async () => {
    const res = await call('POST', '/ws/not-a-workspace/join', { token: CREATE_TOKEN, body: { member: 'x' } });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('workspace_not_found');
  });
});
