import { DurableObject } from 'cloudflare:workers';
import { sha256Hex, timingSafeEqual } from '../lib/crypto.js';
import {
  ENROLL_PREFIX,
  RECOVERY_PREFIX,
  credentialWellFormed,
  mintCredential,
  mintMemberToken,
  newMemberId,
  parseMemberToken
} from '../lib/tokens.js';
import { isCarriedByRelay, validateEnvelope } from '../lib/envelope.js';
import { MAX_SUBJECT_CHARS, normalizeSubject } from '../lib/subject.js';
import { selectFair } from '../lib/fairness.js';
import { cfg } from '../lib/config.js';

// One workspace per Durable Object. SQLite-backed (see wrangler.toml
// migrations: new_sqlite_classes) — the KV backend is paid-plan only and this
// has to deploy on a free account.
//
// Credentials are never stored in the clear: only SHA-256 digests, compared in
// constant time. Admin credentials arrive in the Authorization header and are
// never accepted in a request body, so they cannot land in a proxy's body log.

const NAME_RE = /^[\x20-\x7e]{1,64}$/;
const PRESENCE_STATES = Object.freeze(['working', 'waiting', 'blocked', 'tooling_broken']);
const TABLES = Object.freeze(['messages', 'claims', 'presence', 'members', 'authfail', 'meta']);
const ZERO_DIGEST = '0'.repeat(64);

// Bumped whenever an existing workspace's tables need changing. Durable Object
// storage survives a redeploy, so a schema change has to reach workspaces that
// were created by an earlier version — see #upgradeSchema.
const SCHEMA_VERSION = '2';

// C0 and C1 controls, the bidi embedding/override/isolate set, and the
// zero-width class. A display name reaches every peer's model context, so the
// characters that can forge an injection boundary, reorder a rendered line or
// hide one name inside another are removed outright rather than escaped
// (PROTOCOL section 1, SECURITY section 5.3).
const DISPLAY_NAME_STRIP = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
const MAX_DISPLAY_NAME_CHARS = 40;

function ok(body, status) {
  return { status: status || 200, body };
}
function err(status, code, extra) {
  return { status, body: { error: code, ...(extra || {}) } };
}
function str(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

// OPTIONAL human label; never authoritative — `name` stays the handle every
// decision is made on. Sanitized, then capped, in that order: the cap is on
// what survives, so padding a name with invisibles cannot buy length. Returns
// null for anything that sanitizes away to nothing, which stores as "no
// display name" rather than as an empty one.
function displayName(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(DISPLAY_NAME_STRIP, '').trim();
  if (!cleaned) return null;
  // Sliced by code point, so the cap can never cut an astral character in half
  // and leave a lone surrogate in the roster.
  return [...cleaned].slice(0, MAX_DISPLAY_NAME_CHARS).join('');
}

export class WorkspaceDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // Deliberately NOT migrating here. The schema is created only by `init`,
    // so a caller probing random workspace ids gets a 404 without causing a
    // single row to be written — otherwise every guess would materialize a
    // persistent SQLite database that nothing can ever reclaim.
  }

  #schemaExists() {
    return (
      this.sql
        .exec("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'meta' LIMIT 1")
        .toArray().length > 0
    );
  }

  #migrate() {
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS members (' +
        'member_id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, display_name TEXT, secret_hash TEXT NOT NULL, ' +
        'joined_at INTEGER NOT NULL, revoked_at INTEGER, cursor INTEGER NOT NULL DEFAULT 0)'
    );
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS presence (' +
        'member_id TEXT PRIMARY KEY, state TEXT NOT NULL, note TEXT, branch TEXT, ' +
        'machine TEXT, session TEXT, updated_at INTEGER NOT NULL)'
    );
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS claims (' +
        'subject_key TEXT PRIMARY KEY, subject TEXT NOT NULL, owner TEXT NOT NULL, ' +
        'acquired_at INTEGER NOT NULL, renewed_at INTEGER NOT NULL, ttl INTEGER NOT NULL, ' +
        'files TEXT NOT NULL DEFAULT \'[]\')'
    );
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS messages (' +
        'seq INTEGER PRIMARY KEY, sender TEXT NOT NULL, type TEXT NOT NULL, ' +
        'client_seq INTEGER NOT NULL, received_at INTEGER NOT NULL, envelope TEXT NOT NULL)'
    );
    this.sql.exec('CREATE UNIQUE INDEX IF NOT EXISTS messages_dedupe ON messages (sender, client_seq)');
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS authfail (ip TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL)'
    );
    this.#setMeta('schema_version', SCHEMA_VERSION);
  }

  // Durable Object storage survives a redeploy, so a workspace created by an
  // earlier version still has that version's tables. This brings one forward in
  // place, on its first request after the deploy; afterwards the meta key makes
  // it a single indexed read. The column is added, never rewritten — no member
  // row is touched and nothing is dropped.
  #upgradeSchema() {
    if (this.#meta('schema_version') === SCHEMA_VERSION) return;
    const table = this.sql
      .exec("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'members'")
      .toArray()[0];
    if (table && !/\bdisplay_name\b/.test(table.sql)) {
      this.sql.exec('ALTER TABLE members ADD COLUMN display_name TEXT');
    }
    this.#setMeta('schema_version', SCHEMA_VERSION);
  }

  // ---- meta -------------------------------------------------------------

  #meta(key) {
    const row = this.sql.exec('SELECT v FROM meta WHERE k = ?', key).toArray()[0];
    return row ? row.v : null;
  }

  #setMeta(key, value) {
    this.sql.exec(
      'INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
      key,
      String(value)
    );
  }

  #initialized() {
    return this.#meta('ws_id') !== null;
  }

  // ---- rate limiting ----------------------------------------------------
  // Per-IP, per-workspace, counted only on authentication failures. It rides
  // the request the DO is already handling, so it costs no extra hop. Guessing
  // a workspace id is not rate-limited here on purpose: ids are 128-bit
  // CSPRNG and each guess lands on a different (empty) object, which returns
  // 404 without writing anything — a prober cannot grow storage.

  #authBlocked(ip, now) {
    const windowMs = cfg(this.env, 'AUTH_FAIL_WINDOW_SECONDS') * 1000;
    const row = this.sql.exec('SELECT count, window_start FROM authfail WHERE ip = ?', ip).toArray()[0];
    if (!row || now - row.window_start >= windowMs) return 0;
    if (row.count < cfg(this.env, 'AUTH_FAIL_MAX')) return 0;
    return Math.max(1, Math.ceil((row.window_start + windowMs - now) / 1000));
  }

  #recordAuthFail(ip, now) {
    const windowMs = cfg(this.env, 'AUTH_FAIL_WINDOW_SECONDS') * 1000;
    const row = this.sql.exec('SELECT count, window_start FROM authfail WHERE ip = ?', ip).toArray()[0];
    const fresh = !row || now - row.window_start >= windowMs;
    this.sql.exec(
      'INSERT INTO authfail (ip, count, window_start) VALUES (?, ?, ?) ' +
        'ON CONFLICT(ip) DO UPDATE SET count = excluded.count, window_start = excluded.window_start',
      ip,
      fresh ? 1 : row.count + 1,
      fresh ? now : row.window_start
    );
    this.sql.exec('DELETE FROM authfail WHERE window_start < ?', now - windowMs * 4);
  }

  // The rate limit is applied to the failure, never to the request. Gating
  // every request on the IP's failure count would let ten bad guesses from one
  // NAT lock out every member behind it — including the revoked member's own
  // monitor knocking its colleagues offline.
  #denyAuth(ip, now, status, code) {
    this.#recordAuthFail(ip, now);
    const wait = this.#authBlocked(ip, now);
    if (wait) {
      return {
        status: 429,
        body: { error: 'rate_limited', retry_after: wait },
        headers: { 'retry-after': String(wait) }
      };
    }
    return err(status, code);
  }

  // ---- auth -------------------------------------------------------------

  async #authMember(token) {
    const parsed = parseMemberToken(token);
    // A malformed token still pays for a digest so the failure path has the
    // same shape whether the member id exists or not.
    const digest = await sha256Hex(parsed ? parsed.secret : String(token || ''));
    if (!parsed) return { fail: 'invalid_token' };
    const row = this.sql
      .exec('SELECT member_id, name, revoked_at, secret_hash, cursor FROM members WHERE member_id = ?', parsed.memberId)
      .toArray()[0];
    if (!timingSafeEqual(row ? row.secret_hash : ZERO_DIGEST, digest)) return { fail: 'invalid_token' };
    if (row.revoked_at) return { fail: 'member_revoked' };
    return { member: row };
  }

  async #authEnroll(token, now) {
    if (!(await credentialWellFormed(token, ENROLL_PREFIX))) return { fail: 'invalid_token' };
    const digest = await sha256Hex(token);
    if (timingSafeEqual(this.#meta('enroll_hash') || ZERO_DIGEST, digest)) return { ok: true, grace: false };
    const prev = this.#meta('enroll_prev_hash');
    const until = Number(this.#meta('enroll_prev_expires') || 0);
    if (prev && timingSafeEqual(prev, digest)) {
      if (now < until) return { ok: true, grace: true, grace_until: until };
      return { fail: 'enrollment_token_expired' };
    }
    return { fail: 'invalid_token' };
  }

  async #authRecovery(token) {
    if (!(await credentialWellFormed(token, RECOVERY_PREFIX))) return { fail: 'invalid_token' };
    const digest = await sha256Hex(token);
    if (!timingSafeEqual(this.#meta('recovery_hash') || ZERO_DIGEST, digest)) return { fail: 'invalid_token' };
    return { ok: true };
  }

  // ---- claims / messages upkeep -----------------------------------------

  #expireClaims(now) {
    this.sql.exec('DELETE FROM claims WHERE renewed_at + (ttl * 1000) <= ?', now);
  }

  #claimRows(now) {
    return this.sql
      .exec(
        'SELECT c.*, m.name AS owner_name FROM claims c LEFT JOIN members m ON m.member_id = c.owner ' +
          'WHERE c.renewed_at + (c.ttl * 1000) > ? ORDER BY c.acquired_at ASC',
        now
      )
      .toArray()
      .map((row) => ({
        subject: row.subject,
        subject_key: row.subject_key,
        owner: row.owner,
        owner_name: row.owner_name,
        acquired_at: row.acquired_at,
        renewed_at: row.renewed_at,
        ttl: row.ttl,
        expires_at: row.renewed_at + row.ttl * 1000,
        files: JSON.parse(row.files)
      }));
  }

  // TTL and the count bound are enforced together (PLAN section 3). Both run
  // on write paths only; reads filter by TTL in the query so a read never
  // needs a write to be correct.
  #pruneMessages(now) {
    const ttl = cfg(this.env, 'MESSAGE_TTL_SECONDS');
    this.sql.exec('DELETE FROM messages WHERE received_at <= ?', now - ttl * 1000);
    const max = cfg(this.env, 'MESSAGE_MAX');
    this.sql.exec(
      'DELETE FROM messages WHERE seq NOT IN (SELECT seq FROM messages ORDER BY seq DESC LIMIT ?)',
      max
    );
  }

  #messageFloor(now) {
    return now - cfg(this.env, 'MESSAGE_TTL_SECONDS') * 1000;
  }

  // ---- dispatch ---------------------------------------------------------

  async dispatch(op, input) {
    const now = Date.now();
    if (op === 'init') return this.#init(input, now);
    if (!this.#schemaExists() || !this.#initialized()) return err(404, 'workspace_not_found');
    this.#upgradeSchema();

    const ip = typeof input.ip === 'string' && input.ip ? input.ip : 'unknown';

    switch (op) {
      case 'join':
        return this.#join(input, now, ip);
      case 'rotate':
        return this.#rotate(input, now, ip);
      case 'purge':
        return this.#purge(input, now, ip);
      case 'destroy':
        return this.#destroy(input, now, ip);
      case 'member_remove':
        return this.#memberRemove(input, now, ip);
      case 'member_rebind':
        return this.#memberRebind(input, now, ip);
      case 'heartbeat':
      case 'claim':
      case 'release':
      case 'post':
      case 'sync':
      case 'cursor':
        return this.#memberOp(op, input, now, ip);
      default:
        return err(404, 'unknown_op');
    }
  }

  async #memberOp(op, input, now, ip) {
    const auth = await this.#authMember(input.auth);
    if (auth.fail) {
      return this.#denyAuth(ip, now, auth.fail === 'member_revoked' ? 403 : 401, auth.fail);
    }
    switch (op) {
      case 'heartbeat':
        return this.#heartbeat(auth.member, input, now);
      case 'claim':
        return this.#claim(auth.member, input, now);
      case 'release':
        return this.#release(auth.member, input, now);
      case 'post':
        return this.#post(auth.member, input, now);
      case 'sync':
        return this.#sync(auth.member, input, now);
      case 'cursor':
        return this.#cursor(auth.member, input, now);
      default:
        return err(404, 'unknown_op');
    }
  }

  // ---- operations -------------------------------------------------------

  async #init(input, now) {
    this.#migrate();
    if (this.#initialized()) return err(409, 'workspace_exists');
    const enrollment = await mintCredential(ENROLL_PREFIX);
    const recovery = await mintCredential(RECOVERY_PREFIX);
    const enrollHash = await sha256Hex(enrollment);
    const recoveryHash = await sha256Hex(recovery);
    // Re-checked after the awaits: a Durable Object serializes requests, but
    // an await inside a handler still yields, so the check and the writes must
    // sit in one synchronous run to be atomic.
    if (this.#initialized()) return err(409, 'workspace_exists');
    this.#setMeta('ws_id', input.ws);
    this.#setMeta('ws_name', str(input.body?.name, 64) || 'workspace');
    this.#setMeta('created_at', now);
    this.#setMeta('next_seq', 1);
    this.#setMeta('enroll_hash', enrollHash);
    this.#setMeta('recovery_hash', recoveryHash);
    return ok(
      {
        ws: input.ws,
        name: this.#meta('ws_name'),
        created_at: now,
        // Returned exactly once. Nothing recoverable is kept server-side.
        enrollment_token: enrollment,
        recovery_key: recovery
      },
      201
    );
  }

  async #join(input, now, ip) {
    const auth = await this.#authEnroll(input.auth, now);
    if (auth.fail) return this.#denyAuth(ip, now, 401, auth.fail);
    const name = str(input.body?.member, 64);
    if (!name || !NAME_RE.test(name)) return err(400, 'member_name_invalid');
    // OPTIONAL, and never a reason to refuse a join: a display name that
    // sanitizes away simply stores as absent (PROTOCOL section 1).
    const display = displayName(input.body?.display_name);

    // Minted and hashed BEFORE the duplicate check so that the check and the
    // insert run in one synchronous stretch. With an await in between, two
    // simultaneous joins of the same name could both pass the check.
    const memberId = newMemberId();
    const token = mintMemberToken(memberId);
    const secret = parseMemberToken(token).secret;
    const secretHash = await sha256Hex(secret);

    // Duplicate name binding is rejected outright (PLAN section 2), including
    // for a removed member: re-binding a retired name would let a new secret
    // inherit that name's history in every peer's roster.
    const existing = this.sql.exec('SELECT member_id, revoked_at FROM members WHERE name = ?', name).toArray()[0];
    if (existing) {
      return err(409, 'member_name_taken', { member_id: existing.member_id, revoked: Boolean(existing.revoked_at) });
    }
    const count = this.sql.exec('SELECT COUNT(*) AS n FROM members').toArray()[0].n;
    if (count >= cfg(this.env, 'MAX_MEMBERS')) return err(409, 'workspace_full');

    this.sql.exec(
      'INSERT INTO members (member_id, name, display_name, secret_hash, joined_at, cursor) VALUES (?, ?, ?, ?, ?, ?)',
      memberId,
      name,
      display,
      secretHash,
      now,
      0
    );
    return ok(
      {
        ws: this.#meta('ws_id'),
        name: this.#meta('ws_name'),
        member_id: memberId,
        member: name,
        // {member_id, secret} per PLAN; `token` is the two joined into the
        // single value that goes in the Authorization header.
        secret,
        token,
        joined_at: now,
        enrollment_grace: Boolean(auth.grace)
      },
      201
    );
  }

  #heartbeat(member, input, now) {
    const body = input.body || {};
    const state = typeof body.state === 'string' ? body.state : 'working';
    if (!PRESENCE_STATES.includes(state)) return err(400, 'presence_state_invalid');
    this.#expireClaims(now);
    this.sql.exec(
      'INSERT INTO presence (member_id, state, note, branch, machine, session, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(member_id) DO UPDATE SET ' +
        'state = excluded.state, note = excluded.note, branch = excluded.branch, ' +
        'machine = excluded.machine, session = excluded.session, updated_at = excluded.updated_at',
      member.member_id,
      state,
      str(body.note, 280),
      str(body.branch, 200),
      str(body.machine, 64),
      str(body.session, 64),
      now
    );
    // A display name may ride the heartbeat so it can be set or corrected
    // without re-joining. Omitting it leaves the stored one alone — otherwise
    // every keepalive from a client that does not carry one would erase it.
    if (body.display_name !== undefined) {
      this.sql.exec(
        'UPDATE members SET display_name = ? WHERE member_id = ?',
        displayName(body.display_name),
        member.member_id
      );
    }
    // The monitor's heartbeat is also the claim-renewal tick (PLAN section 1).
    if (body.renew_claims !== false) {
      this.sql.exec('UPDATE claims SET renewed_at = ? WHERE owner = ?', now, member.member_id);
    }
    return ok({
      ok: true,
      member_id: member.member_id,
      state,
      updated_at: now,
      claims: this.#claimRows(now).filter((c) => c.owner === member.member_id)
    });
  }

  #claim(member, input, now) {
    const body = input.body || {};
    const subject = str(body.subject, MAX_SUBJECT_CHARS);
    if (!subject) return err(400, 'claim_subject_invalid');
    const key = normalizeSubject(subject);
    if (!key) return err(400, 'claim_subject_invalid');

    const ttlMax = cfg(this.env, 'CLAIM_TTL_MAX_SECONDS');
    let ttl = cfg(this.env, 'CLAIM_TTL_DEFAULT_SECONDS');
    if (body.ttl !== undefined) {
      if (!Number.isInteger(body.ttl) || body.ttl <= 0 || body.ttl > ttlMax) return err(400, 'claim_ttl_invalid');
      ttl = body.ttl;
    }
    const files = this.#normalizeFiles(body.files);
    if (files === null) return err(400, 'claim_files_invalid');

    // OPTIONAL acquired_at (PROTOCOL Appendix B A7, section 9.4 step 3): the
    // tiebreak input (section 5.4) survives a client re-creating its OWN claim
    // — after a transport migration, or after a restart that re-adopts a lease
    // the relay had already expired. Without it, every migrated claim would be
    // reborn as the youngest and migration would silently reorder the tiebreak.
    //
    // Clamped rather than refused: a client whose clock runs ahead of the
    // relay's would otherwise store acquired_at > renewed_at and hand itself a
    // claim that loses every tiebreak. Backdating is bounded by where it is
    // honored, not by its value — see the insert branch below.
    let acquiredAt = now;
    if (body.acquired_at !== undefined) {
      if (!Number.isInteger(body.acquired_at)) return err(400, 'claim_acquired_at_invalid');
      acquiredAt = Math.min(body.acquired_at, now);
    }

    this.#expireClaims(now);
    const existing = this.sql.exec('SELECT * FROM claims WHERE subject_key = ?', key).toArray()[0];
    if (existing && existing.owner !== member.member_id) {
      // The DO serializes requests, so exactly one caller can be here first —
      // no deterministic tiebreak is needed server-side. The loser gets the
      // live claim in the body so its client can surface who holds it.
      const live = this.#claimRows(now).find((c) => c.subject_key === key);
      return err(409, 'claim_conflict', { claim: live });
    }
    if (existing) {
      // A renewal never rewrites acquired_at — not from the stored row, and not
      // from the request: the column is absent from this UPDATE on purpose. The
      // value is what the lease has been held since, so a member that renews
      // hourly must not be able to walk its own claim's age forward or back.
      const merged = this.#mergeFiles(JSON.parse(existing.files), files);
      this.sql.exec(
        'UPDATE claims SET subject = ?, renewed_at = ?, ttl = ?, files = ? WHERE subject_key = ?',
        subject,
        now,
        ttl,
        JSON.stringify(merged),
        key
      );
    } else {
      // Claims are the one table with no count bound from retention: they are
      // only removed by release or expiry, and a TTL can be a full day. Without
      // this cap one member's sub-token can fill the object with live rows.
      const held = this.sql.exec('SELECT COUNT(*) AS n FROM claims').toArray()[0].n;
      if (held >= cfg(this.env, 'MAX_CLAIMS')) return err(409, 'workspace_claims_full');
      // The only place a caller-supplied acquired_at is written. A live claim
      // belonging to anyone else has already returned 409 above, so backdating
      // can shape the caller's own row and nothing else — it never edits a
      // peer's lease and never changes who wins here, which the Durable Object
      // decides by arrival order (section 5.4). renewed_at stays `now`: a
      // migrated claim is old for the tiebreak but freshly live for its TTL.
      this.sql.exec(
        'INSERT INTO claims (subject_key, subject, owner, acquired_at, renewed_at, ttl, files) VALUES (?, ?, ?, ?, ?, ?, ?)',
        key,
        subject,
        member.member_id,
        acquiredAt,
        now,
        ttl,
        JSON.stringify(files)
      );
    }
    const claim = this.#claimRows(now).find((c) => c.subject_key === key);
    return ok({ ok: true, claim, renewed: Boolean(existing) }, existing ? 200 : 201);
  }

  #release(member, input, now) {
    const subject = str(input.body?.subject, MAX_SUBJECT_CHARS);
    if (!subject) return err(400, 'claim_subject_invalid');
    const key = normalizeSubject(subject);
    if (!key) return err(400, 'claim_subject_invalid');
    this.#expireClaims(now);
    const existing = this.sql.exec('SELECT * FROM claims WHERE subject_key = ?', key).toArray()[0];
    if (!existing) return err(404, 'claim_not_found');
    // Owner-authorized: a peer cannot release another peer's lease.
    if (existing.owner !== member.member_id) {
      return err(403, 'not_claim_owner', { owner: existing.owner });
    }
    this.sql.exec('DELETE FROM claims WHERE subject_key = ?', key);
    return ok({ ok: true, released: subject, subject_key: key });
  }

  #normalizeFiles(files) {
    if (files === undefined || files === null) return [];
    if (!Array.isArray(files)) return null;
    // Enforced here so it also covers the first claim: #mergeFiles only caps
    // the renewal path.
    if (files.length > cfg(this.env, 'MAX_FILES_PER_CLAIM')) return null;
    const out = [];
    for (const file of files) {
      const value = str(file, 300);
      if (!value) return null;
      out.push(value);
    }
    return out;
  }

  #mergeFiles(previous, next) {
    const max = cfg(this.env, 'MAX_FILES_PER_CLAIM');
    const seen = new Set(previous);
    for (const file of next) seen.add(file);
    return [...seen].slice(0, max);
  }

  async #post(member, input, now) {
    const envelope = input.body?.envelope;
    // The workspace id is checked against this object's own id: an envelope
    // signed for another workspace is refused here rather than stored.
    const check = validateEnvelope(envelope, now, this.#meta('ws_id'));
    if (!check.ok) return err(400, check.code, { skew_ms: check.skew_ms, window_ms: check.window_ms });

    // PROTOCOL section 3.1: presence, claims and releases are server state on
    // this transport and travel through their own endpoints; `state.request`
    // has nothing to ask for, because `sync` already returns the full state.
    // Accepting them as envelopes would build unauthenticated shadow state
    // beside the server's and spend the fetch budget re-sending it.
    if (!isCarriedByRelay(envelope.type)) {
      return err(400, 'envelope_type_not_carried', { type: envelope.type });
    }

    // `from` is server-authoritative. The client's own `from` is REQUIRED (it
    // is inside the HMAC), and a mismatch is refused rather than silently
    // rewritten — rewriting would invalidate a signature the relay cannot
    // recompute, and trusting it would let a member spoof a peer.
    if (envelope.from.member !== member.member_id) {
      return err(403, 'from_mismatch', { expected: member.member_id });
    }

    // Dedupe is on (sender, sender_seq) — the sender's own counter, stored in
    // the client_seq column to keep it distinct from the relay-assigned seq.
    const duplicate = this.sql
      .exec(
        'SELECT seq, received_at FROM messages WHERE sender = ? AND client_seq = ?',
        member.member_id,
        envelope.sender_seq
      )
      .toArray()[0];
    if (duplicate) {
      return ok({ seq: duplicate.seq, received_at: duplicate.received_at, duplicate: true });
    }

    const seq = Number(this.#meta('next_seq') || 1);
    this.#setMeta('next_seq', seq + 1);
    this.sql.exec(
      'INSERT INTO messages (seq, sender, type, client_seq, received_at, envelope) VALUES (?, ?, ?, ?, ?, ?)',
      seq,
      member.member_id,
      envelope.type,
      envelope.sender_seq,
      now,
      // Stored structurally verbatim: every field the client sent, including
      // `sig` and any field this version does not know about, is preserved.
      JSON.stringify(envelope)
    );
    this.#pruneMessages(now);
    return ok({ seq, received_at: now, from: member.member_id }, 201);
  }

  #sync(member, input, now) {
    const raw = input.query?.cursor;
    const parsed = raw === undefined || raw === null || raw === '' ? NaN : Number(raw);
    const cursor = Number.isInteger(parsed) && parsed >= 0 ? parsed : member.cursor;

    const cap = cfg(this.env, 'SYNC_FETCH_CAP');
    const reserved = cfg(this.env, 'SYNC_RESERVED_SLOTS');
    const floor = this.#messageFloor(now);
    const candidates = this.sql
      .exec(
        'SELECT seq, sender, type FROM messages WHERE seq > ? AND received_at > ? ORDER BY seq ASC LIMIT ?',
        cursor,
        floor,
        cfg(this.env, 'SYNC_CANDIDATE_WINDOW')
      )
      .toArray();
    // The candidate window is a bound on work, but it is ordered by seq, so a
    // warning posted after a few hundred routine messages would fall outside
    // it and the reserved slots would have nothing to fill them with. This
    // second bounded read makes the floor real. Its predicate must stay in
    // step with isPriorityType() in lib/envelope.js.
    const hot = this.sql
      .exec(
        "SELECT seq, sender, type FROM messages WHERE seq > ? AND received_at > ? " +
          "AND (type LIKE 'warn.%' OR type = 'note.blocker') ORDER BY seq ASC LIMIT ?",
        cursor,
        floor,
        reserved * 4
      )
      .toArray();
    const seen = new Set(candidates.map((c) => c.seq));
    for (const row of hot) {
      if (!seen.has(row.seq)) {
        seen.add(row.seq);
        candidates.push(row);
      }
    }
    candidates.sort((a, b) => a.seq - b.seq);

    const total = this.sql
      .exec('SELECT COUNT(*) AS n FROM messages WHERE seq > ? AND received_at > ?', cursor, floor)
      .toArray()[0].n;

    const chosen = selectFair(candidates, cap, reserved);
    let messages = [];
    if (chosen.length) {
      const placeholders = chosen.map(() => '?').join(',');
      const rows = this.sql
        .exec(
          'SELECT m.seq, m.sender, m.received_at, m.envelope, mem.name AS sender_name FROM messages m ' +
            'LEFT JOIN members mem ON mem.member_id = m.sender WHERE m.seq IN (' +
            placeholders +
            ') ORDER BY m.seq ASC',
          ...chosen.map((c) => c.seq)
        )
        .toArray();
      messages = rows.map((row) => ({
        seq: row.seq,
        from: row.sender,
        from_name: row.sender_name,
        received_at: row.received_at,
        envelope: JSON.parse(row.envelope)
      }));
    }

    // `name` is the authoritative handle in both lists; `display_name` is the
    // OPTIONAL label beside it, already sanitized on the way in.
    const members = this.sql
      .exec(
        'SELECT member_id, name, display_name, joined_at FROM members WHERE revoked_at IS NULL ORDER BY joined_at ASC'
      )
      .toArray();
    const presence = this.sql
      .exec(
        'SELECT p.*, m.name, m.display_name FROM presence p JOIN members m ON m.member_id = p.member_id ' +
          'WHERE m.revoked_at IS NULL ORDER BY p.updated_at DESC'
      )
      .toArray();

    return ok({
      ws: this.#meta('ws_id'),
      now,
      member_id: member.member_id,
      cursor,
      // The watermark advances at injection time on the client (PLAN section
      // 2), so sync never moves the stored cursor by itself.
      next_cursor: messages.length ? messages[messages.length - 1].seq : cursor,
      stored_cursor: member.cursor,
      members,
      presence,
      claims: this.#claimRows(now),
      messages,
      more: Math.max(0, total - messages.length)
    });
  }

  #cursor(member, input, now) {
    const seq = input.body?.seq;
    if (!Number.isInteger(seq) || seq < 0) return err(400, 'cursor_invalid');
    // Bounded by the highest seq the relay has ever ISSUED = next_seq - 1
    // (next_seq is what the next post will consume). A cursor at exactly
    // next_seq would forward-clamp the member past the very next message
    // posted, losing it (PROTOCOL §6.3).
    if (seq >= Number(this.#meta('next_seq'))) return err(400, 'cursor_ahead_of_stream');
    // Cursor writes are authorized to their owner: a member can only ever
    // write its own, and only forwards.
    const next = Math.max(seq, member.cursor);
    this.sql.exec('UPDATE members SET cursor = ? WHERE member_id = ?', next, member.member_id);
    return ok({ ok: true, member_id: member.member_id, cursor: next, advanced: next > member.cursor, at: now });
  }

  async #rotate(input, now, ip) {
    const auth = await this.#authRecovery(input.auth);
    if (auth.fail) return this.#denyAuth(ip, now, 401, auth.fail);
    let grace = cfg(this.env, 'ROTATE_GRACE_SECONDS');
    const requested = input.body?.grace_seconds;
    if (requested !== undefined) {
      if (!Number.isInteger(requested) || requested < 0 || requested > 86400) return err(400, 'grace_invalid');
      grace = requested;
    }
    const next = await mintCredential(ENROLL_PREFIX);
    const nextHash = await sha256Hex(next);
    // All three writes land in one synchronous stretch: an await between them
    // would let two concurrent rotations lose one of the new tokens while
    // leaving the superseded one in the grace slot.
    this.#setMeta('enroll_prev_hash', this.#meta('enroll_hash'));
    this.#setMeta('enroll_prev_expires', now + grace * 1000);
    this.#setMeta('enroll_hash', nextHash);
    return ok({
      ok: true,
      enrollment_token: next,
      previous_valid_until: now + grace * 1000,
      grace_seconds: grace
    });
  }

  async #purge(input, now, ip) {
    const auth = await this.#authRecovery(input.auth);
    if (auth.fail) return this.#denyAuth(ip, now, 401, auth.fail);
    const before = this.sql.exec('SELECT COUNT(*) AS n FROM messages').toArray()[0].n;
    this.sql.exec('DELETE FROM messages');
    let claims = 0;
    if (input.body?.all === true) {
      claims = this.sql.exec('SELECT COUNT(*) AS n FROM claims').toArray()[0].n;
      this.sql.exec('DELETE FROM claims');
      this.sql.exec('DELETE FROM presence');
    }
    // next_seq is deliberately NOT reset: reused sequence numbers would move
    // every member's cursor backwards and replay old traffic.
    return ok({ ok: true, messages_purged: before, claims_purged: claims, next_seq: Number(this.#meta('next_seq')) });
  }

  async #destroy(input, now, ip) {
    const auth = await this.#authRecovery(input.auth);
    if (auth.fail) return this.#denyAuth(ip, now, 401, auth.fail);
    // Dropped, not emptied: this actually returns the storage. TABLES is a
    // frozen literal list — no request value ever reaches this string.
    for (const table of TABLES) {
      this.sql.exec('DROP TABLE IF EXISTS ' + table);
    }
    // With the schema gone the workspace is uninitialized again, so every
    // later request — including join — gets 404 rather than re-binding the id.
    return ok({ ok: true, destroyed: true });
  }

  // The `:member` path segment is the member id. A name is accepted as a
  // fallback because a member that has lost its local state knows the name it
  // joined under and not necessarily the id it was minted — id first, so the
  // resolution stays deterministic even for a name shaped like an id.
  #findMember(target) {
    if (typeof target !== 'string' || !target) return null;
    const byId = this.sql
      .exec('SELECT member_id, name, revoked_at FROM members WHERE member_id = ?', target)
      .toArray()[0];
    if (byId) return byId;
    return (
      this.sql.exec('SELECT member_id, name, revoked_at FROM members WHERE name = ?', target).toArray()[0] || null
    );
  }

  async #memberRemove(input, now, ip) {
    const auth = await this.#authRecovery(input.auth);
    if (auth.fail) return this.#denyAuth(ip, now, 401, auth.fail);
    // Resolve id-first-then-name, exactly as #memberRebind does and as the
    // PROTOCOL §9.2 row-15 note asserts for rows 14-15. Offboarding admins
    // (SECURITY §7.1) naturally pass the departing member's NAME.
    const row = this.#findMember(input.params?.member);
    if (!row) return err(404, 'member_not_found');
    if (row.revoked_at) return ok({ ok: true, member_id: row.member_id, already_removed: true });
    this.sql.exec('UPDATE members SET revoked_at = ? WHERE member_id = ?', now, row.member_id);
    this.sql.exec('DELETE FROM presence WHERE member_id = ?', row.member_id);
    // A removed member must not keep holding leases the rest of the team is
    // deferring to.
    const claims = this.sql.exec('SELECT COUNT(*) AS n FROM claims WHERE owner = ?', row.member_id).toArray()[0].n;
    this.sql.exec('DELETE FROM claims WHERE owner = ?', row.member_id);
    return ok({ ok: true, member_id: row.member_id, member: row.name, claims_released: claims, removed_at: now });
  }

  // Lost-local-state recovery. Names are permanently retired on removal, so a
  // member that loses its sub-token cannot re-join under its own name; this
  // reissues one for the member that already exists, keeping the member id —
  // and with it that member's claims, cursor and place in every peer's roster.
  //
  // On the recovery key, never the enrollment token: on the enrollment token
  // any member could seize any other member's identity. It does NOT un-retire
  // a removed name — a revoked member is refused, and rebinding a retired name
  // would let a new secret inherit that name's history.
  async #memberRebind(input, now, ip) {
    const auth = await this.#authRecovery(input.auth);
    if (auth.fail) return this.#denyAuth(ip, now, 401, auth.fail);
    const row = this.#findMember(input.params?.member);
    if (!row) return err(404, 'member_not_found');
    if (row.revoked_at) return err(409, 'member_revoked', { member_id: row.member_id });

    const token = mintMemberToken(row.member_id);
    const secret = parseMemberToken(token).secret;
    const secretHash = await sha256Hex(secret);

    // Re-read after the await: the digest step yields, so a removal that lands
    // in between must not be undone by a rebind that started before it.
    const fresh = this.sql
      .exec('SELECT member_id, name, revoked_at FROM members WHERE member_id = ?', row.member_id)
      .toArray()[0];
    if (!fresh) return err(404, 'member_not_found');
    if (fresh.revoked_at) return err(409, 'member_revoked', { member_id: fresh.member_id });
    // The previous secret is invalidated by being overwritten: only the digest
    // was ever stored, and the old sub-token stops authenticating immediately.
    this.sql.exec('UPDATE members SET secret_hash = ? WHERE member_id = ?', secretHash, fresh.member_id);
    return ok({ ok: true, member_id: fresh.member_id, member: fresh.name, secret, token, rebound_at: now });
  }
}
