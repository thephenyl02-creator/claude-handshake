'use strict';
// claude-handshake M4: the team-relay transport adapter.
//
// Normative: PROTOCOL section 9.2 (endpoints, credential ladder, wrapper
// shape), section 3.1 (carriage: presence/claim/release are server-state
// endpoints, NOT envelopes), section 6.3-6.4 (cursor = one monotonic integer,
// moved only by the separate owner-authorized cursor endpoint) and section
// 10.1/10.2 (silent-offline vs loud-rejected).
//
// Credentials travel ONLY in `Authorization: Bearer <credential>`, never in a
// body, so they cannot land in a proxy's request-body log. This module never
// puts a token in a URL or a JSON body - if you are editing it, keep that true.

const envelope = require('./envelope');
const subject = require('./subject');
const { sendGate } = require('./outbound');
const T = require('./transport');

const KEEPALIVE_SECONDS = T.KEEPALIVE_RELAY_SECONDS;

function bearer(token) {
  return { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
}

function joinUrl(origin, pathname) {
  return String(origin).replace(/\/+$/, '') + pathname;
}

// ---------------------------------------------------- unauthenticated ops --

// GET /health -> {ok, service, version, protocol}: the stable shape `doctor`
// probes, and the only place the relay's protocol integer is published.
async function health({ origin, fetchImpl, timeoutMs }) {
  const f = fetchImpl || globalThis.fetch;
  const res = await T.httpJson(f, joinUrl(origin, '/health'), { method: 'GET' }, { timeoutMs });
  return res.json || {};
}

// POST /ws with the deploy-time create token. The ONLY time the enrollment
// token and recovery key are ever shown (section 9.2).
async function createWorkspace({ origin, createToken, name, fetchImpl, timeoutMs }) {
  const f = fetchImpl || globalThis.fetch;
  const body = {};
  if (name) body.name = sendGate({ name }).name;
  const res = await T.httpJson(f, joinUrl(origin, '/ws'), {
    method: 'POST', headers: bearer(createToken), body: JSON.stringify(body),
  }, { timeoutMs });
  return res.json || {};
}

// POST /ws/:id/join with the enrollment token -> the member sub-token.
async function joinWorkspace({ origin, ws, enrollmentToken, member, displayName, fetchImpl, timeoutMs }) {
  const f = fetchImpl || globalThis.fetch;
  const gated = sendGate({ member, display_name: displayName });
  const body = { member: gated.member };
  if (gated.display_name) body.display_name = gated.display_name;
  const res = await T.httpJson(f, joinUrl(origin, '/ws/' + ws + '/join'), {
    method: 'POST', headers: bearer(enrollmentToken), body: JSON.stringify(body),
  }, { timeoutMs });
  return res.json || {};
}

// POST /ws/:id/rotate with the recovery key. Replaces the enrollment token
// only: existing member sub-tokens keep working and the recovery key is
// immutable in v1 (PROTOCOL section 9.2, [D11]).
async function rotate({ origin, ws, recoveryKey, graceSeconds, fetchImpl, timeoutMs }) {
  const f = fetchImpl || globalThis.fetch;
  const body = {};
  if (graceSeconds !== undefined && graceSeconds !== null) body.grace_seconds = Number(graceSeconds);
  const res = await T.httpJson(f, joinUrl(origin, '/ws/' + ws + '/rotate'), {
    method: 'POST', headers: bearer(recoveryKey), body: JSON.stringify(body),
  }, { timeoutMs });
  return res.json || {};
}

// ------------------------------------------------------------- the adapter -

class RelayTransport {
  constructor(opts) {
    const o = opts || {};
    this.name = 'relay';
    this.origin = String(o.origin || '').replace(/\/+$/, '');
    this.ws = o.ws;
    this.token = o.token;                  // member sub-token, hsm_...
    this.member = o.member;                // authenticated member id
    this.kSig = o.kSig;
    this.fetchImpl = o.fetchImpl || globalThis.fetch;
    this.dedupe = o.dedupe || null;
    this.sessionFlags = o.sessionFlags || null;
    this.timeoutMs = o.timeoutMs || 10000;
    this.filterOpts = o.filterOpts || {};
    // A durable layer is the repo's .handshake/ (M8), not a property of the
    // relay: 7-day/500-message retention is retention, not durability.
    this._durableLayer = Boolean(o.durableLayer);
    this.stats = { rejected: 0, from_mismatch: 0, sig_invalid: 0, unknown_type: 0, newer_protocol: 0, duplicates: 0 };
  }

  // PROTOCOL section 9.1, verbatim shape.
  capabilities() {
    return {
      authenticated_from: true,       // the relay refuses a mismatched `from`
      server_claims: true,            // claims are server state, one winner
      durable_layer: this._durableLayer,
      encrypts_body: false,           // enc/ct MUST be absent on the relay (2.1)
      keepalive_seconds: KEEPALIVE_SECONDS,
      cursor_kind: 'seq',
    };
  }

  _url(p) { return joinUrl(this.origin, '/ws/' + this.ws + p); }

  _guardPosting() {
    if (this.sessionFlags) {
      const stopped = this.sessionFlags.postingStopped(this.name);
      if (stopped) {
        throw T.loudError('posting_stopped', 'posting stopped this session after ' + stopped.code, { already_reported: true });
      }
    }
  }

  async _post(pathname, body) {
    this._guardPosting();
    try {
      return await T.httpJson(this.fetchImpl, this._url(pathname), {
        method: 'POST', headers: bearer(this.token), body: JSON.stringify(body),
      }, { timeoutMs: this.timeoutMs });
    } catch (err) {
      if (err && err.kind === 'loud' && this.sessionFlags) this.sessionFlags.stopPosting(this.name, err.code);
      throw err;
    }
  }

  // --------------------------------------------------------- publish -----

  // section 3.1: on the relay a client MUST NOT post presence.update,
  // task.claim, task.release or state.request as envelopes - it would create
  // unauthenticated shadow state beside the server's and burn the message
  // budget on data `sync` already returns. (Relay patch A6 enforces the same
  // rule server-side; this check is the client half.)
  async publish(env) {
    if (envelope.RELAY_NON_CARRIED_TYPES.includes(env.type)) {
      throw T.loudError('envelope_type_not_carried',
        env.type + ' is a server-state endpoint on the relay (PROTOCOL 3.1), not an envelope');
    }
    if (env.enc !== undefined || env.ct !== undefined) {
      throw T.loudError('envelope_enc_on_relay', 'body encryption MUST NOT be used on the relay (PROTOCOL 2.4)');
    }
    envelope.gate(env.type, env.body, env.from, this.filterOpts);
    const res = await this._post('/post', { envelope: env });
    const j = res.json || {};
    return { handle: j.seq, seq: j.seq, received_at: j.received_at, duplicate: Boolean(j.duplicate) };
  }

  // POST /ws/:id/heartbeat - presence is server state here, so it is NOT an
  // envelope. `claims` MUST be absent on the relay (section 3.2).
  async heartbeat(presence) {
    const p = presence || {};
    const gated = sendGate({
      note: p.note, branch: p.branch, display_name: p.display_name,
      tooling_reason: p.tooling && p.tooling.reason,
    }, this.filterOpts);
    const body = { state: p.state };
    if (gated.note !== undefined) body.note = gated.note;
    if (gated.branch !== undefined) body.branch = gated.branch;
    if (gated.display_name !== undefined) body.display_name = gated.display_name;
    if (p.machine) body.machine = p.machine;
    if (p.session) body.session = p.session;
    if (p.renew_claims === false) body.renew_claims = false;
    const res = await this._post('/heartbeat', body);
    return res.json || {};
  }

  // POST /ws/:id/claim -> 201 acquire / 200 renew / 409 claim_conflict with
  // the live claim in the body (the tiebreak input, section 5.4).
  async claim({ subject: subj, ttl, files, acquired_at: acquiredAt }) {
    const gated = sendGate({ subject: subj, files }, this.filterOpts);
    const body = { subject: gated.subject };
    if (ttl !== undefined) body.ttl = ttl;
    if (gated.files) body.files = gated.files;
    // Appendix B A7 (relay v0.1.2): an optional client-supplied acquired_at,
    // clamped server-side to <= now and honored only on a fresh insert or an
    // adoption - never on a renewal. It is protocol machinery (an integer this
    // client already holds), so it is not filter input; omitting it lets the
    // relay derive the value, which is the correct default for a new claim.
    if (Number.isFinite(Number(acquiredAt)) && Number(acquiredAt) > 0) body.acquired_at = Math.floor(Number(acquiredAt));
    try {
      const res = await this._post('/claim', body);
      return Object.assign({ ok: true, conflict: null, status: res.status }, res.json || {});
    } catch (err) {
      if (err && err.kind === 'expected' && err.code === 'claim_conflict') {
        return { ok: false, conflict: (err.body && err.body.claim) || null, status: 409, subject_key: subject.normalizeSubject(subj) };
      }
      throw err;
    }
  }

  async release({ subject: subj }) {
    const gated = sendGate({ subject: subj }, this.filterOpts);
    const res = await this._post('/release', { subject: gated.subject });
    return res.json || {};
  }

  // ----------------------------------------------------------- fetch -----

  async _sync(cursor) {
    const c = Number.isInteger(cursor) ? cursor : 0;
    return T.httpJson(this.fetchImpl, this._url('/sync?cursor=' + encodeURIComponent(String(c))), {
      method: 'GET', headers: bearer(this.token),
    }, { timeoutMs: this.timeoutMs });
  }

  // Reading MUST NOT move the stored cursor (section 6.3).
  async fetch(cursor, limit) {
    const res = await this._sync(cursor);
    const j = res.json || {};
    const now = Number.isInteger(j.now) ? j.now : Date.now();
    const messages = [];
    const rejected = [];
    for (const wrapper of j.messages || []) {
      const env = wrapper && wrapper.envelope;
      // section 9.2 MUST: the wrapper `from` is the AUTHENTICATED member id;
      // that pairing, not the wrapper alone, is what relay attribution means.
      if (!env || typeof env !== 'object' || wrapper.from !== (env.from && env.from.member)) {
        this.stats.from_mismatch++; this.stats.rejected++;
        rejected.push({ seq: wrapper && wrapper.seq, code: 'from_mismatch', kind: 'loud' });
        continue;
      }
      const verdict = envelope.accept(env, { ws: this.ws, now, kSig: this.kSig, dedupe: this.dedupe });
      if (!verdict.ok) {
        if (verdict.code === 'signature_invalid') this.stats.sig_invalid++;
        else if (verdict.code === 'unknown_type') this.stats.unknown_type++;
        else if (verdict.code === 'envelope_version_newer') this.stats.newer_protocol++;
        else if (verdict.code === 'duplicate') this.stats.duplicates++;
        if (verdict.kind === 'loud') this.stats.rejected++;
        rejected.push({ seq: wrapper.seq, code: verdict.code, kind: verdict.kind });
        continue;
      }
      messages.push({
        handle: wrapper.seq, seq: wrapper.seq, from: wrapper.from,
        from_name: wrapper.from_name, received_at: wrapper.received_at, envelope: env,
      });
    }
    const sliced = Number.isInteger(limit) && limit >= 0 ? messages.slice(0, limit) : messages;
    return {
      messages: sliced,
      cursor: j.cursor,
      next_cursor: j.next_cursor,
      stored_cursor: j.stored_cursor,
      // section 10.2: never report a truncated read as an empty one.
      more: Number(j.more) || (messages.length - sliced.length),
      truncated: (Number(j.more) || 0) > 0,
      rejected,
      now,
    };
  }

  // GET /ws/:id/sync also carries full state, which is why state.request MUST
  // NOT be sent on this transport (section 3.1).
  async presence() {
    // Presence is derived from the same sync response; the cursor argument is
    // irrelevant to members[]/presence[]/claims[], which the relay always
    // returns in full. Reading it does not move the stored cursor (6.3).
    const res = await this._sync(0);
    const j = res.json || {};
    const now = Number.isInteger(j.now) ? j.now : Date.now();
    const presence = (j.presence || []).map((p) => Object.assign({}, p, {
      label: T.presenceLabel(now - Number(p.updated_at || 0), KEEPALIVE_SECONDS),
    }));
    return {
      members: j.members || [], presence, claims: j.claims || [],
      now, advisory: false, cursor: j.stored_cursor,
    };
  }

  // POST /ws/:id/cursor - a SEPARATE owner-authorized endpoint precisely so
  // that reading cannot move the watermark ([R4], section 6.3).
  async commitCursor(cursor) {
    const seq = Number(cursor);
    if (!Number.isInteger(seq) || seq < 0) throw T.loudError('cursor_invalid', 'relay cursor must be a non-negative integer');
    const res = await this._post('/cursor', { seq });
    const j = res.json || {};
    return { cursor: j.cursor, advanced: Boolean(j.advanced), at: j.at };
  }
}

function createRelayTransport(opts) { return new RelayTransport(opts); }

module.exports = {
  RelayTransport, createRelayTransport,
  health, createWorkspace, joinWorkspace, rotate,
  KEEPALIVE_SECONDS,
};
