// OPTIONAL display_name on join and heartbeat (PROTOCOL section 1, Appendix B
// A4). `name` stays the authoritative handle; display_name is a label, UTF-8,
// sanitized and capped at 40 characters AFTER sanitization.

import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { call, createWorkspace, join, setup, workspaceStub } from './helpers.js';

const heartbeat = (ws, token, body) => call('POST', '/ws/' + ws.ws + '/heartbeat', { token, body });
const sync = (ws, token) => call('GET', '/ws/' + ws.ws + '/sync', { token });

// Built by code point so no invisible character has to survive a round trip
// through this file's own source.
const ch = (code) => String.fromCodePoint(code);

// The classes the sanitizer removes: C0, C1, zero-width and directional marks,
// bidi embeddings/overrides, invisible operators, bidi isolates, and the BOM.
const STRIPPED_RANGES = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff]
];

function stripped(value) {
  return [...value].filter((c) =>
    STRIPPED_RANGES.some(([lo, hi]) => c.codePointAt(0) >= lo && c.codePointAt(0) <= hi)
  );
}

async function rosterOf(ws, token, name) {
  const view = await sync(ws, token);
  return {
    member: view.body.members.find((m) => m.name === name),
    presence: view.body.presence.find((p) => p.name === name)
  };
}

describe('display_name on join', () => {
  it('stores a label beside the authoritative name and returns it in members[]', async () => {
    const ws = await createWorkspace();
    const alice = await join(ws, 'alice', { display_name: 'Alice Ansgar' });
    const { member } = await rosterOf(ws, alice.token, 'alice');
    expect(member.name).toBe('alice');
    expect(member.display_name).toBe('Alice Ansgar');
  });

  it('is optional — a member without one reads as absent, not as empty', async () => {
    const { ws, members } = await setup(['alice']);
    const { member } = await rosterOf(ws, members.alice.token, 'alice');
    expect(member.display_name).toBeNull();
  });

  it('never refuses a join, whatever it is handed', async () => {
    const ws = await createWorkspace();
    const junk = [42, null, true, { a: 1 }, ['x'], '', '   ', ch(0x200b) + ch(0x202e)];
    for (const [index, display_name] of junk.entries()) {
      const res = await call('POST', '/ws/' + ws.ws + '/join', {
        token: ws.enrollment_token,
        body: { member: 'member' + index, display_name }
      });
      expect(res.status, JSON.stringify(display_name)).toBe(201);
    }
    const view = await sync(ws, (await join(ws, 'watcher')).token);
    for (const member of view.body.members) {
      expect(member.display_name).toBeNull();
    }
  });

  it('does not become a second identity — two members may share a label', async () => {
    const ws = await createWorkspace();
    const alice = await join(ws, 'alice', { display_name: 'Sam' });
    await join(ws, 'bob', { display_name: 'Sam' });
    const view = await sync(ws, alice.token);
    expect(view.body.members.map((m) => m.display_name)).toEqual(['Sam', 'Sam']);
    expect(view.body.members.map((m) => m.name)).toEqual(['alice', 'bob']);
  });
});

describe('display_name on heartbeat', () => {
  it('sets and corrects the label without a re-join, and shows in presence[]', async () => {
    const { ws, members } = await setup(['alice', 'bob']);
    await heartbeat(ws, members.alice.token, { state: 'working', display_name: 'Alice A.' });
    let roster = await rosterOf(ws, members.bob.token, 'alice');
    expect(roster.member.display_name).toBe('Alice A.');
    expect(roster.presence.display_name).toBe('Alice A.');
    expect(roster.presence.state).toBe('working');

    await heartbeat(ws, members.alice.token, { state: 'waiting', display_name: 'Alice Ansgar' });
    roster = await rosterOf(ws, members.bob.token, 'alice');
    expect(roster.presence.display_name).toBe('Alice Ansgar');
  });

  it('leaves a stored label alone when the heartbeat omits it', async () => {
    const ws = await createWorkspace();
    const alice = await join(ws, 'alice', { display_name: 'Alice Ansgar' });
    // Every keepalive from a client that does not carry one would otherwise
    // erase the name the member set at join.
    await heartbeat(ws, alice.token, { state: 'working' });
    const { member } = await rosterOf(ws, alice.token, 'alice');
    expect(member.display_name).toBe('Alice Ansgar');
  });

  it('clears it when the member explicitly sends nothing visible', async () => {
    const ws = await createWorkspace();
    const alice = await join(ws, 'alice', { display_name: 'Alice Ansgar' });
    await heartbeat(ws, alice.token, { state: 'working', display_name: '  ' + ch(0x200b) + '  ' });
    const { member } = await rosterOf(ws, alice.token, 'alice');
    expect(member.display_name).toBeNull();
  });

  it('never refuses a heartbeat over a bad label', async () => {
    const { ws, members } = await setup(['alice']);
    for (const display_name of [42, null, { a: 1 }, ch(0x0007)]) {
      const res = await heartbeat(ws, members.alice.token, { state: 'working', display_name });
      expect(res.status, JSON.stringify(display_name)).toBe(200);
    }
  });
});

describe('display_name sanitization', () => {
  it('strips C0 and C1 controls, keeping the visible text', async () => {
    const ws = await createWorkspace();
    const raw = 'Ali' + ch(0x0000) + 'ce' + ch(0x0009) + ch(0x000a) + 'Q' + ch(0x001b) + ch(0x0085) + ch(0x009f);
    const alice = await join(ws, 'alice', { display_name: raw });
    const { member } = await rosterOf(ws, alice.token, 'alice');
    expect(member.display_name).toBe('AliceQ');
    expect(stripped(member.display_name)).toEqual([]);
  });

  it('strips a bidi-override and zero-width attempt without losing the real name', async () => {
    const ws = await createWorkspace();
    // The classic spoof: RLO reverses what a human reads, zero-width joiners
    // hide a second name inside the first, and the whole thing lands in every
    // peer's model context.
    const raw =
      'alice' +
      ch(0x202e) +
      'nimda' +
      ch(0x202c) +
      ch(0x200b) +
      'admin' +
      ch(0x200d) +
      ch(0x2066) +
      'root' +
      ch(0x2069) +
      ch(0xfeff) +
      ch(0x200e) +
      ch(0x2060);
    const alice = await join(ws, 'alice', { display_name: raw });
    const { member } = await rosterOf(ws, alice.token, 'alice');

    expect(stripped(member.display_name)).toEqual([]);
    expect(member.display_name).toBe('alicenimdaadminroot');
    // Nothing invisible survived to be re-rendered anywhere.
    const view = await sync(ws, alice.token);
    expect(stripped(view.text)).toEqual([]);
    // And the authoritative handle was never touched by any of it.
    expect(member.name).toBe('alice');
  });

  it('caps at 40 characters, and the cap is applied after stripping', async () => {
    const ws = await createWorkspace();
    const long = await join(ws, 'long', { display_name: 'x'.repeat(60) });
    const padded = await join(ws, 'padded', {
      // 30 visible characters wearing 60 invisible ones: sanitizing first is
      // what stops the padding from buying room, or from stealing it.
      display_name: 'y'.repeat(30) + ch(0x200b).repeat(60)
    });
    const view = await sync(ws, long.token);
    const byName = Object.fromEntries(view.body.members.map((m) => [m.name, m.display_name]));

    expect(byName.long).toBe('x'.repeat(40));
    expect(byName.padded).toBe('y'.repeat(30));
    expect(padded.member_id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('counts code points, so the cap never splits an astral character', async () => {
    const ws = await createWorkspace();
    const alice = await join(ws, 'alice', { display_name: '🦦'.repeat(50) });
    const { member } = await rosterOf(ws, alice.token, 'alice');
    expect([...member.display_name]).toHaveLength(40);
    expect(member.display_name).toBe('🦦'.repeat(40));
    // No lone surrogate was left behind by the slice.
    expect(/[\uD800-\uDFFF]/.test(member.display_name.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''))).toBe(false);
  });
});

describe('display_name schema upgrade', () => {
  it('adds the column in place for a workspace created before it existed', async () => {
    const ws = await createWorkspace();
    const alice = await join(ws, 'alice');

    // Wind the object back to the pre-A4 schema: storage survives a redeploy,
    // so a live workspace really can arrive at this code without the column.
    await runInDurableObject(workspaceStub(ws.ws), (_instance, state) => {
      state.storage.sql.exec('ALTER TABLE members DROP COLUMN display_name');
      state.storage.sql.exec("DELETE FROM meta WHERE k = 'schema_version'");
    });

    const beat = await heartbeat(ws, alice.token, { state: 'working', display_name: 'Alice Ansgar' });
    expect(beat.status).toBe(200);
    const { member } = await rosterOf(ws, alice.token, 'alice');
    expect(member.display_name).toBe('Alice Ansgar');

    const meta = await runInDurableObject(workspaceStub(ws.ws), (_instance, state) =>
      state.storage.sql.exec("SELECT v FROM meta WHERE k = 'schema_version'").toArray()
    );
    expect(meta).toHaveLength(1);
  });
});
