// Unit tests for the pure modules. They import cleanly under Node (Web Crypto
// and TextEncoder only), so the edge cases that are awkward to drive over HTTP
// get tested directly and fast.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { timingSafeEqual } from '../../src/lib/crypto.js';
import { ENROLL_PREFIX, credentialWellFormed, mintCredential, parseMemberToken } from '../../src/lib/tokens.js';
import { normalizeSubject } from '../../src/lib/subject.js';
import { selectFair } from '../../src/lib/fairness.js';
import { validateEnvelope } from '../../src/lib/envelope.js';

describe('timingSafeEqual', () => {
  it('matches only identical strings', () => {
    assert.equal(timingSafeEqual('abc', 'abc'), true);
    assert.equal(timingSafeEqual('abc', 'abd'), false);
    assert.equal(timingSafeEqual('abc', 'ab'), false);
    assert.equal(timingSafeEqual('', ''), true);
    // Fail closed on non-strings rather than coercing them to ''.
    assert.equal(timingSafeEqual(undefined, ''), false);
    assert.equal(timingSafeEqual(undefined, undefined), false);
    assert.equal(timingSafeEqual(null, 'a'), false);
  });
});

describe('credentials', () => {
  it('accepts a minted token and rejects a tampered one', async () => {
    const token = await mintCredential(ENROLL_PREFIX);
    assert.match(token, /^hsk_[0-9a-f]{64}_[0-9a-f]{8}$/);
    assert.equal(await credentialWellFormed(token, ENROLL_PREFIX), true);

    const [prefix, secret, sum] = token.split('_');
    const flipped = secret.slice(0, -1) + (secret.endsWith('a') ? 'b' : 'a');
    assert.equal(await credentialWellFormed(prefix + '_' + flipped + '_' + sum, ENROLL_PREFIX), false);
    assert.equal(await credentialWellFormed(token, 'hsr'), false);
    assert.equal(await credentialWellFormed('hsk_short_00000000', ENROLL_PREFIX), false);
    assert.equal(await credentialWellFormed(undefined, ENROLL_PREFIX), false);
  });

  it('parses member tokens and rejects malformed ones', () => {
    assert.deepEqual(parseMemberToken('hsm_' + 'a'.repeat(16) + '_' + 'b'.repeat(64)), {
      memberId: 'a'.repeat(16),
      secret: 'b'.repeat(64)
    });
    assert.equal(parseMemberToken('hsm_short_' + 'b'.repeat(64)), null);
    assert.equal(parseMemberToken('hsk_' + 'a'.repeat(64) + '_deadbeef'), null);
  });
});

describe('subject normalization', () => {
  it('folds case, punctuation and stopwords but keeps word order', () => {
    assert.equal(normalizeSubject('The Onboarding Flow!'), 'onboarding flow');
    assert.equal(normalizeSubject('  onboarding   flow  '), 'onboarding flow');
    assert.equal(normalizeSubject('fix the API-issue'), 'fix api issue');
    assert.equal(normalizeSubject('café résumé'), 'cafe resume');
  });

  it('keeps genuinely different subjects apart', () => {
    assert.notEqual(normalizeSubject('login flow'), normalizeSubject('flow login'));
    assert.notEqual(normalizeSubject('auth'), normalizeSubject('authz'));
  });

  it('never normalizes to an empty key', () => {
    assert.equal(normalizeSubject('the a of'), 'the a of');
  });
});

describe('fair selection', () => {
  const make = (sender, seq, type) => ({ sender, seq, type: type || 'note.info' });

  it('round-robins across senders in oldest-sender-first order', () => {
    const candidates = [
      ...Array.from({ length: 5 }, (_, i) => make('a', i + 1)),
      ...Array.from({ length: 5 }, (_, i) => make('b', i + 10))
    ];
    const chosen = selectFair(candidates, 4, 0);
    assert.deepEqual(
      chosen.map((c) => c.sender),
      ['a', 'a', 'b', 'b']
    );
  });

  it('gives priority types a floor even when posted last', () => {
    const candidates = [
      ...Array.from({ length: 30 }, (_, i) => make('loud', i + 1)),
      make('quiet', 100, 'warn.overlap'),
      make('quiet', 101, 'note.blocker')
    ];
    const chosen = selectFair(candidates, 5, 2);
    const types = chosen.map((c) => c.type);
    assert.ok(types.includes('warn.overlap'));
    assert.ok(types.includes('note.blocker'));
    assert.equal(chosen.length, 5);
  });

  it('does not let the reserved floor crowd out normal traffic', () => {
    const candidates = Array.from({ length: 30 }, (_, i) => make('a', i + 1, 'warn.overlap'));
    assert.equal(selectFair(candidates, 20, 5).length, 20);
  });

  it('returns messages in seq order and never duplicates one', () => {
    const candidates = [make('a', 3, 'warn.overlap'), make('b', 1), make('a', 2), make('b', 4)];
    const chosen = selectFair(candidates, 10, 2);
    assert.deepEqual(
      chosen.map((c) => c.seq),
      [1, 2, 3, 4]
    );
  });
});

describe('envelope validation', () => {
  const base = () => ({
    v: 1,
    type: 'note.info',
    body: { a: 1 },
    ts: Date.now(),
    nonce: 'abcdefgh',
    seq: 0,
    sig: 'x'
  });

  it('accepts a well-formed envelope', () => {
    assert.equal(validateEnvelope(base(), Date.now()).ok, true);
  });

  it('preserves nothing and rejects everything malformed', () => {
    const now = Date.now();
    const cases = [
      [null, 'envelope_missing'],
      [{ ...base(), v: 2 }, 'envelope_version'],
      [{ ...base(), type: 'nodot' }, 'envelope_type'],
      [(() => { const e = base(); delete e.body; return e; })(), 'envelope_body_missing'],
      [{ ...base(), body: undefined }, 'envelope_body_missing'],
      [{ ...base(), nonce: 'short' }, 'envelope_nonce'],
      [{ ...base(), seq: 1.5 }, 'envelope_seq'],
      [{ ...base(), sig: '' }, 'envelope_sig'],
      [{ ...base(), from: { machine: 'x' } }, 'envelope_from'],
      [{ ...base(), ts: now - 400000 }, 'envelope_ts_skew']
    ];
    for (const [envelope, code] of cases) {
      const result = validateEnvelope(envelope, now);
      assert.equal(result.ok, false, code);
      assert.equal(result.code, code);
    }
  });

  it('reads a second-precision ts as seconds', () => {
    const now = Date.now();
    const result = validateEnvelope({ ...base(), ts: Math.floor(now / 1000) }, now);
    assert.equal(result.ok, true);
    assert.ok(Math.abs(result.ts - now) < 1000);
  });
});
