'use strict';
// claude-handshake M4: claim-subject normalization and overlap scoring.
//
// PROTOCOL section 5.1 freezes normalization "byte-identical client and relay",
// exactly as implemented in relay/src/lib/subject.js. The steps below are that
// implementation, in the frozen order (lowercase BEFORE NFKD; combining marks
// DELETED, not replaced by a separator). Deliberately absent: stemming, token
// reordering, synonym folding - each merges genuinely different subjects, and a
// false merge refuses a peer a claim it should have won.
//
// PROTOCOL section 5.2 freezes the overlap rule: token-set Jaccard >= 0.5 makes
// two subjects an overlap CANDIDATE, at which point the model - never the
// transport - judges whether the work genuinely overlaps.

const MAX_SUBJECT_CHARS = 200;   // PROTOCOL section 2.5 / 5.1 step 1

// Frozen list of exactly 27 entries (PROTOCOL section 5.1 step 7). The count
// line in that section originally read 28; the enumerated list was always
// right and matches relay/src/lib/subject.js, so nothing here changed.
const STOPWORDS = Object.freeze([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'in',
  'into', 'is', 'it', 'its', 'my', 'of', 'on', 'or', 'our', 'that', 'the',
  'their', 'this', 'to', 'with',
]);

class SubjectError extends Error {
  constructor(code) {
    super('claim_subject_invalid: ' + code);
    this.name = 'SubjectError';
    this.code = code;
  }
}

// Steps 1-9 of PROTOCOL section 5.1. Returns the subject_key.
function normalizeSubject(subject) {
  const raw = String(subject);
  if (raw.length > MAX_SUBJECT_CHARS) throw new SubjectError('too_long');
  const tokens = raw
    .toLowerCase()          // step 2, before NFKD - the order is part of the freeze
    .normalize('NFKD')      // step 3
    .replace(/\p{M}/gu, '') // step 4: delete combining marks ("cafe", one token)
    .replace(/[^a-z0-9]+/g, ' ')  // step 5
    .trim()                 // step 6
    .split(/\s+/)
    .filter(Boolean);
  const kept = tokens.filter((t) => !STOPWORDS.includes(t));   // step 7
  // Step 8: a subject made entirely of stopwords keeps its raw tokens rather
  // than normalizing to the empty key that every such claim would collide on.
  return (kept.length ? kept : tokens).join(' ');              // step 9
}

// Convenience wrapper: normalize, then reject the empty key (relay answers
// 400 claim_subject_invalid).
function subjectKey(subject) {
  const key = normalizeSubject(subject);
  if (!key.length) throw new SubjectError('empty');
  return key;
}

// The token SET of a subject_key: duplicates collapse, order ignored.
function tokenSet(subjectKey_) {
  return new Set(String(subjectKey_).split(' ').filter(Boolean));
}

// |A n B| / |A u B| over the token sets of two subject_keys.
function jaccard(keyA, keyB) {
  const a = tokenSet(keyA);
  const b = tokenSet(keyB);
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Same, from raw subjects.
function jaccardSubjects(a, b) {
  return jaccard(normalizeSubject(a), normalizeSubject(b));
}

// warn.overlap.jaccard is an integer percentage, round(100 * J) (section 3.2).
function jaccardPercent(keyA, keyB) {
  return Math.round(100 * jaccard(keyA, keyB));
}

const OVERLAP_THRESHOLD = 0.5;   // PROTOCOL section 5.2

// Two subjects COLLIDE when their subject_keys are equal - the one-winner key,
// and the only thing a transport ever decides.
function collides(keyA, keyB) {
  return String(keyA) === String(keyB);
}

// Above the threshold the MODEL judges. Below it, no warning is emitted.
function isOverlapCandidate(keyA, keyB) {
  return !collides(keyA, keyB) && jaccard(keyA, keyB) >= OVERLAP_THRESHOLD;
}

// PROTOCOL section 5.4: earliest acquired_at wins; on a tie the
// lexicographically smallest member id wins, compared byte-wise over UTF-8.
// Returns -1 when `a` wins, 1 when `b` wins, 0 only when both are identical.
function tiebreak(a, b) {
  if (a.acquired_at !== b.acquired_at) return a.acquired_at < b.acquired_at ? -1 : 1;
  const ba = Buffer.from(String(a.member), 'utf8');
  const bb = Buffer.from(String(b.member), 'utf8');
  return Buffer.compare(ba, bb);
}

// True when `mine` loses to `theirs` and must post task.change(tiebreak_loss)
// then task.release(tiebreak_loss) and stop work (section 5.4).
function losesTiebreak(mine, theirs) {
  return tiebreak(mine, theirs) > 0;
}

module.exports = {
  MAX_SUBJECT_CHARS, STOPWORDS, OVERLAP_THRESHOLD, SubjectError,
  normalizeSubject, subjectKey, tokenSet,
  jaccard, jaccardSubjects, jaccardPercent,
  collides, isOverlapCandidate, tiebreak, losesTiebreak,
};
