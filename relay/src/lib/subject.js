// Claim-subject normalization.
//
// PLAN section 2 says subjects are semantic-first free text, normalized
// (case/stopwords) under "a frozen fuzzy-match rule". That rule is an M1
// deliverable; this is the conservative floor the relay needs in order to have
// an atomic one-winner key, and it must be kept byte-identical to whatever M1
// freezes so client and relay agree on what counts as the same subject.
//
// Deliberately NOT done here: stemming, token reordering, synonym folding.
// Each of those merges genuinely different subjects, and a false merge means a
// peer is refused a claim it should have won.

// Frozen array rather than a Set: a module-scope Set cannot be made immutable,
// and everything at module scope in this Worker has to be provably constant.
const STOPWORDS = Object.freeze([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'in',
  'into', 'is', 'it', 'its', 'my', 'of', 'on', 'or', 'our', 'that', 'the',
  'their', 'this', 'to', 'with'
]);

export const MAX_SUBJECT_CHARS = 200;

export function normalizeSubject(subject) {
  const tokens = String(subject)
    .toLowerCase()
    .normalize('NFKD')
    // Combining marks are dropped, not turned into separators: otherwise
    // "café" would normalize to two tokens ("cafe" and the mark's remains).
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const kept = tokens.filter((t) => !STOPWORDS.includes(t));
  // A subject made entirely of stopwords keeps its raw tokens rather than
  // normalizing to the empty key, which every such claim would collide on.
  return (kept.length ? kept : tokens).join(' ');
}
