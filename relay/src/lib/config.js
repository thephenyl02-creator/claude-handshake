// Tunables. Every one is readable from env so a team can adjust its own relay
// in wrangler.toml [vars] without editing code, and so tests can exercise the
// edges. Defaults are the numbers frozen in PLAN sections 2 and 3.

export const DEFAULTS = Object.freeze({
  CLAIM_TTL_DEFAULT_SECONDS: 7200, // advisory lease, PLAN: 2h
  CLAIM_TTL_MAX_SECONDS: 86400,
  MESSAGE_TTL_SECONDS: 604800, // PLAN: 7 days, alongside the count bound
  MESSAGE_MAX: 500,
  SYNC_FETCH_CAP: 20,
  SYNC_RESERVED_SLOTS: 5, // floor for warn.* / note.blocker
  SYNC_CANDIDATE_WINDOW: 200, // how deep the fair pass may look
  ROTATE_GRACE_SECONDS: 86400, // PLAN: 24h grace for the previous token
  MAX_MEMBERS: 200,
  MAX_CLAIMS: 500,
  MAX_FILES_PER_CLAIM: 64,
  AUTH_FAIL_MAX: 10,
  AUTH_FAIL_WINDOW_SECONDS: 600,
  PUBLIC_RATE_MAX: 120,
  PUBLIC_RATE_WINDOW_SECONDS: 60,
  CREATE_RATE_MAX: 20,
  CREATE_RATE_WINDOW_SECONDS: 3600
});

export function cfg(env, key) {
  const raw = env ? env[key] : undefined;
  if (raw === undefined || raw === null) return DEFAULTS[key];
  // Blank and whitespace-only values fall back rather than coercing to 0 —
  // `MESSAGE_MAX = " "` must not silently become a bound of zero messages.
  if (typeof raw === 'string' && raw.trim() === '') return DEFAULTS[key];
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : DEFAULTS[key];
}
