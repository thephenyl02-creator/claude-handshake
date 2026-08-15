'use strict';
// Parity with PROTOCOL section 5.1 (normalization) and 5.2 (Jaccard), plus the
// deterministic tiebreak of 5.4.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/subject');

// The reference table of PROTOCOL section 5.1, verbatim.
const REFERENCE_5_1 = [
  ['Fix the API issue', 'fix api issue'],
  ['fix API issue', 'fix api issue'],
  ['Onboarding-Flow', 'onboarding flow'],
  ['Refactor the Café Menu!', 'refactor cafe menu'],
  ['the and of', 'the and of'],
];

test('5.1 reference table: every row normalizes exactly', () => {
  for (const [input, expected] of REFERENCE_5_1) {
    assert.equal(S.normalizeSubject(input), expected, JSON.stringify(input));
  }
});

test('5.1: the stopword list is exactly the 27 frozen entries, in order', () => {
  assert.deepEqual(S.STOPWORDS, [
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'in',
    'into', 'is', 'it', 'its', 'my', 'of', 'on', 'or', 'our', 'that', 'the',
    'their', 'this', 'to', 'with',
  ]);
  assert.equal(S.STOPWORDS.length, 27);
});

test('5.1 step 4: combining marks are DELETED, not turned into separators', () => {
  // "café" decomposes under NFKD to "cafe" + U+0301; deleting the mark keeps
  // ONE token. Replacing it with a separator would produce two.
  assert.equal(S.normalizeSubject('café'), 'cafe');
  assert.equal(S.normalizeSubject('café'), 'cafe');
  assert.equal(S.normalizeSubject('café').split(' ').length, 1);
});

test('5.1 step 2 before step 3: lowercasing precedes NFKD', () => {
  // U+FB01 (fi ligature) folds to "fi" under NFKD; the Kelvin sign U+212A
  // lowercases to "k" first and would survive as a non-[a-z] char otherwise.
  assert.equal(S.normalizeSubject('ﬁx the API'), 'fix api');
  assert.equal(S.normalizeSubject('Kelvin fix'), 'kelvin fix');
});

test('5.1 step 5: punctuation, underscores, hyphens and non-ASCII fold to one space', () => {
  assert.equal(S.normalizeSubject('a__b--c!!!d'), 'b c d');
  assert.equal(S.normalizeSubject('fix   the\t\napi'), 'fix api');
  assert.equal(S.normalizeSubject('用户 login flow'), 'login flow');
});

test('5.1 step 8: an all-stopword subject falls back to its raw tokens', () => {
  assert.equal(S.normalizeSubject('the and of'), 'the and of');
  assert.equal(S.normalizeSubject('THE THE THE'), 'the the the');
  assert.notEqual(S.normalizeSubject('the and of'), '');
});

test('5.1 step 1: over 200 chars is refused; the empty key is refused', () => {
  assert.throws(() => S.normalizeSubject('x'.repeat(201)), /too_long/);
  assert.equal(S.normalizeSubject('x'.repeat(200)), 'x'.repeat(200));
  assert.throws(() => S.subjectKey('!!!'), /empty/);
});

test('5.1: no stemming, no reordering, no synonym folding', () => {
  assert.notEqual(S.normalizeSubject('fix logins'), S.normalizeSubject('fix login'));
  assert.notEqual(S.normalizeSubject('auth refactor'), S.normalizeSubject('refactor auth'));
});

// The reference values of PROTOCOL section 5.2, verbatim.
const REFERENCE_5_2 = [
  ['fix api issue', 'fix api response shape', 0.40, false],
  ['onboarding flow', 'onboarding flow copy', 2 / 3, true],
  ['refactor auth middleware', 'refactor auth', 2 / 3, true],
  ['onboarding flow', 'billing webhooks', 0.00, false],
];

test('5.2 reference values: Jaccard matches to two decimals', () => {
  for (const [a, b, expected, candidate] of REFERENCE_5_2) {
    assert.equal(Number(S.jaccard(a, b).toFixed(2)), Number(expected.toFixed(2)), a + ' vs ' + b);
    assert.equal(S.isOverlapCandidate(a, b), candidate, a + ' vs ' + b);
  }
});

test('5.2: jaccardPercent is round(100 x J) and warn.overlap floors at 50', () => {
  assert.equal(S.jaccardPercent('fix api issue', 'fix api response shape'), 40);
  assert.equal(S.jaccardPercent('onboarding flow', 'onboarding flow copy'), 67);
  assert.equal(S.jaccardPercent('refactor auth middleware', 'refactor auth'), 67);
  assert.equal(S.jaccardPercent('onboarding flow', 'billing webhooks'), 0);
  assert.ok(S.jaccardPercent('onboarding flow', 'onboarding flow copy') >= 50);
});

test('5.2: token SETS - duplicates collapse and order is ignored', () => {
  assert.equal(S.jaccard('fix fix api', 'api fix'), 1);
  assert.equal(S.jaccard('a b', 'b a'), 1);
});

test('5.2: equal keys COLLIDE and are therefore not merely candidates', () => {
  assert.equal(S.collides('onboarding flow', 'onboarding flow'), true);
  assert.equal(S.isOverlapCandidate('onboarding flow', 'onboarding flow'), false);
});

test('5.4: earliest acquired_at wins; ties break on the byte-wise smallest member id', () => {
  const early = { acquired_at: 1000, member: 'zzzz' };
  const late = { acquired_at: 2000, member: 'aaaa' };
  assert.equal(S.tiebreak(early, late) < 0, true);
  assert.equal(S.losesTiebreak(late, early), true);
  assert.equal(S.losesTiebreak(early, late), false);

  const a = { acquired_at: 1000, member: 'alice' };
  const b = { acquired_at: 1000, member: 'bob' };
  assert.equal(S.tiebreak(a, b) < 0, true);
  assert.equal(S.losesTiebreak(b, a), true);
});

test('5.4: the tiebreak compares UTF-8 bytes, not JS code units', () => {
  // "Z" (0x5a) sorts before "a" (0x61) byte-wise, which is also code-unit
  // order here; the interesting case is a non-BMP id, where UTF-8 bytes and
  // UTF-16 code units disagree in general.
  const upper = { acquired_at: 1, member: 'Z' };
  const lower = { acquired_at: 1, member: 'a' };
  assert.equal(S.tiebreak(upper, lower) < 0, true);
  const ascii = { acquired_at: 1, member: '~' };            // 0x7e
  const high = { acquired_at: 1, member: 'é' };        // 0xc3 0xa9 in UTF-8
  assert.equal(S.tiebreak(ascii, high) < 0, true);
});

test('5.4: the rule is total - identical inputs are the only 0', () => {
  const x = { acquired_at: 5, member: 'same' };
  assert.equal(S.tiebreak(x, { acquired_at: 5, member: 'same' }), 0);
});
