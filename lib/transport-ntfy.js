'use strict';
// claude-handshake M4: the ntfy zero-setup transport adapter.
//
// Normative: PROTOCOL section 9.3 (topic + `-p` suffix, encrypted wire form,
// claim resurrection, publish budget), section 6.1 (the client performs the
// per-sender-fair selection the transport does not), section 6.4 (the
// message_id / unix_ts / beyond-the-cache-window cursor ladder) and section 5.5
// (claims here are unauthenticated-advisory and MUST be labelled as such).
//
// Honesty, not decoration: `from` on this transport is self-declared-but-HMAC-
// signed. Any holder of the workspace secret can sign as any member, so
// capabilities().authenticated_from is false and every status surface that
// consumes it must say so.

const envelope = require('./envelope');
const T = require('./transport');

const KEEPALIVE_SECONDS = T.KEEPALIVE_NTFY_SECONDS;   // 600 s
const PRESENCE_SUFFIX = '-p';

// section 6.4: 11 h is a deliberate margin under ntfy's ~12 h message cache,
// which is operator-controlled and undocumented.
const MESSAGE_ID_MAX_AGE_MS = 11 * 3600 * 1000;
const CACHE_WINDOW_MS = 12 * 3600 * 1000;

// section 9.3 publish budget: ~150 transport operations per day per member,
// counting EVERY operation including heartbeats, or the first 429.
const UPGRADE_NUDGE_OPS_PER_DAY = 150;

// Client-side guard: ntfy's default per-message body cap is 4 KiB, well under
// the protocol's 8192-byte envelope cap. Refusing locally with a named error
// beats a silent server-side truncation of an encrypted payload.
const NTFY_MAX_MESSAGE_BYTES = 4096;

// section 3.2 response duty: answer a state.request at most once per 60 s
// regardless of how many arrive, or a rejoining peer triggers a broadcast storm.
const STATE_ANSWER_MIN_INTERVAL_MS = 60 * 1000;

const ADVISORY_LINE = 'zero-setup: claims are advisory; no durable layer';

function joinUrl(base, pathname) {
  return String(base).replace(/\/+$/, '') + pathname;
}

class NtfyTransport {
  constructor(opts) {
    const o = opts || {};
    this.name = 'ntfy';
    this.baseUrl = String(o.baseUrl || 'https://ntfy.sh').replace(/\/+$/, '');
    this.topic = o.topic;
    this.presenceTopic = String(o.topic) + PRESENCE_SUFFIX;
    this.ws = o.ws;
    this.kSig = o.kSig;
    this.kEnc = o.kEnc;
    this.member = o.member;
    this.fetchImpl = o.fetchImpl || globalThis.fetch;
    this.dedupe = o.dedupe || null;
    this.sessionFlags = o.sessionFlags || null;
    this.timeoutMs = o.timeoutMs || 10000;
    this.filterOpts = o.filterOpts || {};
    this._durableLayer = Boolean(o.durableLayer);
    this.ops = Number(o.ops) || 0;
    this.sawRateLimit = false;
    this._lastStateAnswerAt = Number(o.lastStateAnswerAt) || 0;
    this.stats = { rejected: 0, sig_invalid: 0, decrypt_failed: 0, unknown_type: 0, newer_protocol: 0, duplicates: 0 };
  }

  // PROTOCOL section 9.1, verbatim shape. Every value here is a fact about
  // this transport, which is what makes section 10.2 mechanical.
  capabilities() {
    return {
      authenticated_from: false,      // self-declared `from`; no server exists
      server_claims: false,           // advisory only (section 5.5)
      durable_layer: this._durableLayer,
      encrypts_body: true,            // A256GCM over {body, from, nonce, type}
      keepalive_seconds: KEEPALIVE_SECONDS,
      cursor_kind: 'message_id+unix_ts',
    };
  }

  advisoryNotice() {
    return this._durableLayer ? null : ADVISORY_LINE;
  }

  _guardPosting() {
    if (this.sessionFlags) {
      const stopped = this.sessionFlags.postingStopped(this.name);
      if (stopped) throw T.loudError('posting_stopped', 'posting stopped this session after ' + stopped.code, { already_reported: true });
    }
  }

  _countOp() { this.ops++; return this.ops; }

  // section 9.3: the nudge fires at the budget OR at the first 429, and is
  // queued for the next SessionStart - never delivered mid-conflict.
  upgradeNudgeDue(opsToday) {
    const ops = Number.isInteger(opsToday) ? opsToday : this.ops;
    if (this.sawRateLimit) return { due: true, reason: 'rate_limited' };
    if (ops >= UPGRADE_NUDGE_OPS_PER_DAY) return { due: true, reason: 'ops_budget', ops };
    return { due: false, ops };
  }

  // -------------------------------------------------------------- publish --

  _topicFor(type) {
    // Presence rides a topic suffix so keepalive traffic cannot dominate the
    // event cursor. Both topics are equally secret - knowing either yields the
    // other (section 9.3).
    return type === 'presence.update' ? this.presenceTopic : this.topic;
  }

  async publish(env, opts) {
    const o = opts || {};
    this._guardPosting();
    envelope.gate(env.type, env.body, env.from, this.filterOpts);
    const wire = envelope.encryptForNtfy(env, this.kEnc, o.iv);
    const payload = JSON.stringify(wire);
    if (Buffer.byteLength(payload, 'utf8') > NTFY_MAX_MESSAGE_BYTES) {
      throw T.loudError('ntfy_message_too_large',
        'encrypted message exceeds the ntfy per-message cap (' + NTFY_MAX_MESSAGE_BYTES + ' bytes)');
    }
    const url = joinUrl(this.baseUrl, '/' + this._topicFor(env.type));
    this._countOp();
    try {
      const res = await T.httpJson(this.fetchImpl, url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'X-Title': 'handshake' },
        body: payload,
      }, { timeoutMs: this.timeoutMs });
      const j = res.json || {};
      return { handle: j.id, message_id: j.id, unix_ts: Number(j.time) || Math.floor(Date.now() / 1000) };
    } catch (err) {
      if (err && err.code === 'rate_limited') this.sawRateLimit = true;
      if (err && err.status === 429) this.sawRateLimit = true;
      if (err && err.kind === 'loud' && this.sessionFlags) this.sessionFlags.stopPosting(this.name, err.code);
      throw err;
    }
  }

  // --------------------------------------------------------- cursor ladder --

  // section 6.4, frozen:
  //   age < 11 h                 -> since=<message_id>
  //   11 h <= age < cache window -> since=<unix_ts>
  //   beyond the cache window    -> stop pretending: the read IS truncated
  sinceParam(cursor, now) {
    const t = Number.isInteger(now) ? now : Date.now();
    if (!cursor || typeof cursor !== 'object' || !cursor.message_id) {
      return { since: 'all', tier: 'all', truncated: false };
    }
    const ageMs = t - Number(cursor.unix_ts || 0) * 1000;
    if (ageMs < MESSAGE_ID_MAX_AGE_MS) {
      return { since: String(cursor.message_id), tier: 'message_id', truncated: false, age_ms: ageMs };
    }
    if (ageMs < CACHE_WINDOW_MS) {
      return { since: String(cursor.unix_ts), tier: 'unix_ts', truncated: false, age_ms: ageMs };
    }
    // A client MUST NOT report a gap as "nothing happened"; a truncated read is
    // a stated fact, not silence.
    return {
      since: 'all', tier: 'beyond_cache_window', truncated: true, age_ms: ageMs,
      note: 'older live chatter is gone from the ntfy cache - read the durable layer (.handshake/) for what happened before this point',
    };
  }

  async _poll(topic, since) {
    const url = joinUrl(this.baseUrl, '/' + topic + '/json?poll=1&since=' + encodeURIComponent(since));
    this._countOp();
    try {
      const res = await T.httpJson(this.fetchImpl, url, { method: 'GET' }, { timeoutMs: this.timeoutMs });
      const lines = String(res.text || '').split('\n').map((l) => l.trim()).filter(Boolean);
      const out = [];
      for (const line of lines) {
        let row;
        try { row = JSON.parse(line); } catch (_) { continue; }
        if (!row || row.event !== 'message' || typeof row.message !== 'string') continue;
        out.push(row);
      }
      return out;
    } catch (err) {
      if (err && err.status === 429) this.sawRateLimit = true;
      throw err;
    }
  }

  // Decrypt -> reassemble -> verify sig -> freshness/dedupe (section 9.3).
  //
  // useDedupe is false for presence(): presence is DERIVED CURRENT STATE, not
  // a consumed event stream. Running dedupe over it would make the second read
  // of the same heartbeat return an empty roster, which is exactly the
  // "reported a truncated read as an empty one" failure section 10.2 forbids.
  _decode(row, now, useDedupe) {
    let wire;
    try { wire = JSON.parse(row.message); } catch (_) { this.stats.decrypt_failed++; return null; }
    let env;
    try {
      env = envelope.decryptFromNtfy(wire, this.kEnc);
    } catch (_) {
      this.stats.decrypt_failed++; this.stats.rejected++;
      return null;
    }
    const verdict = envelope.accept(env, {
      ws: this.ws, now, kSig: this.kSig,
      dedupe: useDedupe === false ? null : this.dedupe,
    });
    if (!verdict.ok) {
      if (verdict.code === 'signature_invalid') this.stats.sig_invalid++;
      else if (verdict.code === 'unknown_type') this.stats.unknown_type++;
      else if (verdict.code === 'envelope_version_newer') this.stats.newer_protocol++;
      else if (verdict.code === 'duplicate') this.stats.duplicates++;
      if (verdict.kind === 'loud') this.stats.rejected++;
      return null;
    }
    return env;
  }

  // section 6.1: the ntfy server performs no fair selection, so the CLIENT
  // does - reserved priority floor first, then per-sender round robin, sender
  // order by each sender's oldest pending message.
  async fetch(cursor, limit, opts) {
    const o = opts || {};
    const now = Number.isInteger(o.now) ? o.now : Date.now();
    const plan = this.sinceParam(cursor, now);
    const rows = await this._poll(o.topic || this.topic, plan.since);

    const candidates = [];
    let order = 0;
    for (const row of rows.slice(0, T.SYNC_CANDIDATE_WINDOW)) {
      const env = this._decode(row, now, true);
      if (!env) { order++; continue; }
      candidates.push({
        order: order++, sender: env.from.member, type: env.type,
        handle: row.id, message_id: row.id, unix_ts: Number(row.time) || 0, envelope: env,
      });
    }
    const cap = Number.isInteger(limit) && limit >= 0 ? Math.min(limit, T.SYNC_FETCH_CAP) : T.SYNC_FETCH_CAP;
    const chosen = T.selectFair(candidates, cap, T.RESERVED_PRIORITY_SLOTS);
    const last = candidates.length ? candidates[candidates.length - 1] : null;
    const beyondWindow = Math.max(0, rows.length - T.SYNC_CANDIDATE_WINDOW);
    return {
      messages: chosen,
      cursor: cursor || null,
      next_cursor: last ? { message_id: last.message_id, unix_ts: last.unix_ts } : (cursor || null),
      more: Math.max(0, candidates.length - chosen.length) + beyondWindow,
      truncated: plan.truncated || beyondWindow > 0,
      truncation_note: plan.truncated ? plan.note : (beyondWindow > 0 ? 'more than the 200-message candidate window was pending' : null),
      cursor_tier: plan.tier,
      rejected: this.stats.rejected,
    };
  }

  // ------------------------------------------------------------- presence --

  // There is no server: presence, the roster and the live claim set are all
  // derived from presence.update envelopes on <topic>-p, and every heartbeat
  // carries the sender's FULL active claim set for resurrection past ntfy's
  // ~12 h cache (section 9.3).
  async presence(opts) {
    const o = opts || {};
    const now = Number.isInteger(o.now) ? o.now : Date.now();
    const plan = this.sinceParam(o.cursor, now);
    const rows = await this._poll(this.presenceTopic, plan.since);

    const latest = new Map();
    for (const row of rows) {
      const env = this._decode(row, now, false);
      if (!env || env.type !== 'presence.update') continue;
      const key = env.from.member;
      const prev = latest.get(key);
      // updated_at is RECEIVER time (section 4.1): a sender cannot make itself
      // look fresher than its last delivered message.
      const updatedAt = (Number(row.time) || 0) * 1000 || env.ts;
      if (!prev || updatedAt >= prev.updated_at) {
        latest.set(key, { envelope: env, updated_at: updatedAt });
      }
    }

    const members = [];
    const presence = [];
    const claims = [];
    for (const [member, rec] of latest) {
      const b = rec.envelope.body || {};
      members.push({ member, name: member, display_name: b.display_name || null });
      presence.push({
        member, name: member, state: b.state, note: b.note || null, branch: b.branch || null,
        agents: Number.isInteger(b.agents) ? b.agents : 0,
        tooling: b.tooling || null,
        machine: rec.envelope.from.machine, session: rec.envelope.from.session,
        updated_at: rec.updated_at,
        label: T.presenceLabel(now - rec.updated_at, KEEPALIVE_SECONDS),
      });
      // Claim resurrection.
      for (const c of Array.isArray(b.claims) ? b.claims : []) {
        claims.push({
          member, subject: c.subject, subject_key: c.subject_key,
          acquired_at: c.acquired_at, ttl: c.ttl,
          renewed_at: rec.updated_at,
          advisory: true,                      // section 5.5, never dropped
          truncated: Boolean(b.claims_truncated),
        });
      }
    }
    return {
      members, presence, claims, now,
      advisory: true,                          // unauthenticated-advisory
      advisory_note: this.advisoryNotice(),
      truncated: plan.truncated,
      truncation_note: plan.truncated ? plan.note : null,
    };
  }

  // ------------------------------------------------------------- cursor ----

  // No server holds a cursor here, so commitCursor is a local persist. The
  // caller (lib/state.js) is the store; this returns the normalized value so
  // the adapter interface of section 9.1 stays uniform.
  async commitCursor(cursor) {
    if (!cursor || typeof cursor !== 'object' || typeof cursor.message_id !== 'string') {
      throw T.loudError('cursor_invalid', 'ntfy cursor must be {message_id, unix_ts}');
    }
    return { cursor: { message_id: cursor.message_id, unix_ts: Number(cursor.unix_ts) || 0 } };
  }

  // ------------------------------------------------------ state.request ----

  // A new joiner posts state.request and waits at most one keepalive interval
  // before declaring the roster unknown-but-empty (section 9.3).
  async requestState(builder, want) {
    const env = builder({ type: 'state.request', body: { want: want || ['claims', 'presence'] } });
    return this.publish(env);
  }

  // Response duty (section 3.2): answer at most once per 60 s regardless of
  // how many requests arrive.
  stateAnswerAllowed(now) {
    const t = Number.isInteger(now) ? now : Date.now();
    return t - this._lastStateAnswerAt >= STATE_ANSWER_MIN_INTERVAL_MS;
  }

  markStateAnswered(now) {
    this._lastStateAnswerAt = Number.isInteger(now) ? now : Date.now();
    return this._lastStateAnswerAt;
  }
}

function createNtfyTransport(opts) { return new NtfyTransport(opts); }

// The topic is >= 128-bit CSPRNG, generated at init, and NEVER derived from any
// name (section 9.3). It is secret material under the same guard as the token.
function newTopic() {
  return require('crypto').randomBytes(16).toString('hex');
}

module.exports = {
  NtfyTransport, createNtfyTransport, newTopic,
  KEEPALIVE_SECONDS, PRESENCE_SUFFIX, ADVISORY_LINE,
  MESSAGE_ID_MAX_AGE_MS, CACHE_WINDOW_MS,
  UPGRADE_NUDGE_OPS_PER_DAY, NTFY_MAX_MESSAGE_BYTES, STATE_ANSWER_MIN_INTERVAL_MS,
};
