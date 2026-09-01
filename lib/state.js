'use strict';
// claude-handshake M4: local state - cursors, sender_seq, peer cache, consumed
// watermark, dedupe memory, session flags and the offline queue.
//
// Normative: PROTOCOL section 2.6 (sender_seq persistence + init rule),
// section 6.3-6.4 (watermark and per-transport cursor shapes), section 10.2
// (loud conditions reported once per session, posting stops) and section 10.3
// (offline queue policy). SECURITY.md section 3 (key material lives here, 0600,
// never in the repo) and section 4 (filter at enqueue AND at send).
//
// Layout, all under one directory per workspace:
//   state.json    identity, sender_seq, cursors, watermarks, credential state
//   peers.json    peer cache (members / presence / claims) from the last sync
//   queue.json    offline queue + its transport binding fingerprint
//   seen.json     dedupe memory: (from.member, sender_seq) pairs and nonces
//   session.json  per-session loud-condition flags (section 10.2)
//   digest.json   the injected-digest cache (section 6.2/6.3)

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const envelope = require('./envelope');

const QUEUE_MAX = 200;                    // section 10.3
const NOTE_EXPIRY_MS = 3600 * 1000;       // note.* / warn.* after 3600 s
const LEAVE_EXPIRY_MS = 86400 * 1000;     // ws.leave: keep until sent or 86400 s
const DEFAULT_CLAIM_TTL = 7200;           // section 5.3
const SEEN_PAIR_TTL_MS = 3600 * 1000;
const SEEN_MAX = 4000;
const FILE_MODE = 0o600;                  // section 10.3 "file mode 0600"

// On POSIX the mode bits above are the control. On Windows they are advisory:
// Node maps them onto the read-only attribute only, and real protection comes
// from the per-user ACL that %LOCALAPPDATA% / the user profile already carries.
// We do not shell out to icacls - a best-effort ACL tweak that can silently
// fail is worse than a stated limitation, so `doctor` and `status` report this
// verbatim instead of implying a guarantee we do not have.
const WINDOWS_ACL_NOTE =
  'on Windows file modes are advisory: state is protected by the user-profile ACL, not by 0600';

// ------------------------------------------------------------- locations ----

// The state directory MUST be computed identically by the CLI and by every
// hook, or a workspace created by one is invisible to the other. The plugin
// HOOK runs with CLAUDE_PLUGIN_DATA set (to the plugin's data dir), but the CLI
// runs from the Bash tool with CLAUDE_PLUGIN_DATA UNSET (verified live on
// Claude Code 2.1.x) - so keying off CLAUDE_PLUGIN_DATA made `init` (CLI) write
// one place and the standing-block hook read another, and the block was always
// empty in a real session. The anchor below is computed the SAME way in both
// contexts:
//   1. HANDSHAKE_STATE_DIR - explicit override (tests, power users), used as-is.
//   2. CLAUDE_CONFIG_DIR/handshake - both CLI and hook inherit CLAUDE_CONFIG_DIR
//      from the session, so they still agree when a custom config dir is set.
//   3. ~/.claude/handshake - the default both fall back to.
// CLAUDE_PLUGIN_DATA is deliberately NOT consulted: it is the asymmetric one.
function stateRoot(env) {
  const e = env || process.env;
  const explicit = e.HANDSHAKE_STATE_DIR;
  if (explicit && String(explicit).trim()) return path.resolve(String(explicit).trim());
  const cfg = e.CLAUDE_CONFIG_DIR;
  if (cfg && String(cfg).trim()) return path.join(path.resolve(String(cfg).trim()), 'handshake');
  return path.join(os.homedir(), '.claude', 'handshake');
}

// Both minters produce exactly 32 lowercase hex - the CLI's local mint and the
// relay's server-side one (its WS_ID_RE is this same rule). Anything else is
// refused HERE, at the one place a workspace id becomes a filesystem path:
// `.handshake/workspace.json` is repo content and therefore untrusted
// (SECURITY.md 5.4), and a repo-supplied ws of `../../x` must never turn into
// a directory outside the state root. CLI verbs surface the error; hooks wrap
// their run in a catch and no-op, which is already their failure contract.
const WS_ID_RE = /^[0-9a-f]{32}$/;
function stateDir(ws, env) {
  if (!WS_ID_RE.test(String(ws))) {
    const e = new Error('invalid workspace id (expected 32 hex chars): ' + String(ws).slice(0, 40));
    e.code = 'bad_workspace_id';
    throw e;
  }
  return path.join(stateRoot(env), String(ws));
}

// ------------------------------------------------------------ file utils ----

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    try { fs.chmodSync(dir, 0o700); } catch (_) { /* best effort */ }
  }
}

function readJsonFile(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed === null || typeof parsed !== 'object' ? fallback : parsed;
  } catch (_) {
    return fallback;
  }
}

function writeJsonFile(file, value) {
  ensureDir(path.dirname(file));
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: FILE_MODE });
  if (process.platform !== 'win32') {
    try { fs.chmodSync(tmp, FILE_MODE); } catch (_) { /* best effort */ }
  }
  try {
    fs.renameSync(tmp, file);
  } catch (_) {
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: FILE_MODE });
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
  }
}

// ------------------------------------------------------- cursor helpers -----

// PROTOCOL section 6.4: cursors are transport-specific and MUST NOT move
// between transports. Relay = a single non-negative integer (the relay seq).
// ntfy = {message_id, unix_ts}.
function cursorKind(transport) {
  return transport === 'relay' ? 'seq' : 'message_id+unix_ts';
}

function normalizeCursor(transport, cursor) {
  if (transport === 'relay') {
    const n = Number(cursor);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  }
  if (cursor && typeof cursor === 'object' && typeof cursor.message_id === 'string') {
    return { message_id: cursor.message_id, unix_ts: Number(cursor.unix_ts) || 0 };
  }
  return null;
}

// Forward-only (section 6.3). For ntfy "forward" is by unix_ts.
function cursorIsAhead(transport, next, current) {
  if (next === null || next === undefined) return false;
  if (current === null || current === undefined) return true;
  if (transport === 'relay') return Number(next) > Number(current);
  return Number(next.unix_ts || 0) >= Number(current.unix_ts || 0);
}

// --------------------------------------------------------- queue expiry -----

// section 10.3. keepaliveSeconds is the transport's K (relay 60, ntfy 600);
// a presence entry is dropped once it is no longer `live` by section 4.3,
// i.e. once age exceeds 2.5 x K.
function queueExpiryAt(env, keepaliveSeconds) {
  const type = String(env && env.type || '');
  const body = (env && env.body) || {};
  const base = Number(env && env.ts) || Date.now();
  if (type.startsWith('presence.')) return base + 2500 * Number(keepaliveSeconds || 60);
  if (type.startsWith('task.')) {
    const ttl = Number.isInteger(body.ttl) && body.ttl > 0 ? body.ttl : DEFAULT_CLAIM_TTL;
    return base + ttl * 1000;
  }
  if (type === 'ws.leave') return base + LEAVE_EXPIRY_MS;
  // note.* and warn.* are frozen at 3600 s; ws.join / ws.migrate /
  // state.request are not enumerated in section 10.3, so they take the same
  // 3600 s bound - a join or a migrate notice older than an hour is stale news.
  return base + NOTE_EXPIRY_MS;
}

// The queue is hard-discarded on any transport, topic, endpoint or token
// change. The fingerprint deliberately hashes the credential rather than
// storing it: queue.json must not become a second copy of the token.
function bindingFingerprint(binding) {
  const b = binding || {};
  const parts = [b.transport || '', b.endpoint || '', b.topic || '', b.token || ''];
  return crypto.createHash('sha256').update(parts.join('\u0000'), 'utf8').digest('hex').slice(0, 32);
}

// ------------------------------------------------------------- the class ----

class State {
  constructor(ws, opts) {
    const o = opts || {};
    this.ws = String(ws);
    this.dir = o.dir ? path.resolve(o.dir) : stateDir(this.ws, o.env);
    this.files = {
      state: path.join(this.dir, 'state.json'),
      peers: path.join(this.dir, 'peers.json'),
      queue: path.join(this.dir, 'queue.json'),
      seen: path.join(this.dir, 'seen.json'),
      session: path.join(this.dir, 'session.json'),
      digest: path.join(this.dir, 'digest.json'),
    };
    this.windowsAclNote = WINDOWS_ACL_NOTE;
  }

  ensure() { ensureDir(this.dir); return this.dir; }

  writable() {
    try {
      ensureDir(this.dir);
      const probe = path.join(this.dir, '.probe-' + process.pid);
      fs.writeFileSync(probe, 'ok', { mode: FILE_MODE });
      fs.unlinkSync(probe);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err && err.message) };
    }
  }

  // ---------------------------------------------------------- main state --

  read() {
    return readJsonFile(this.files.state, {
      ws: this.ws, protocol: envelope.PROTOCOL_VERSION,
      cursors: {}, watermarks: {}, credential_state: 'unknown',
    });
  }

  write(next) { writeJsonFile(this.files.state, next); return next; }

  update(fn) {
    const cur = this.read();
    const next = fn(cur) || cur;
    return this.write(next);
  }

  // ------------------------------------------------------- sender_seq -----

  // section 2.6: strictly increasing per member, persisted locally. When no
  // counter exists (fresh install, restored machine, post-rebind) it is
  // initialized to the current Unix ms - forward progress after local state
  // loss with no server round trip, and no silently-swallowed duplicate.
  nextSenderSeq(now) {
    const t = Number.isInteger(now) ? now : Date.now();
    let value;
    this.update((s) => {
      value = Number.isInteger(s.sender_seq) ? s.sender_seq + 1 : t;
      if (value <= 0) value = t;
      s.sender_seq = value;
      return s;
    });
    return value;
  }

  senderSeq() {
    const s = this.read();
    return Number.isInteger(s.sender_seq) ? s.sender_seq : null;
  }

  // ---------------------------------------------------------- identity ----

  identity() {
    const s = this.read();
    return {
      member: s.member || null, member_name: s.member_name || null,
      display_name: s.display_name || null,
      machine: s.machine || null, session: s.session || null,
    };
  }

  // Per-install pseudonym, never a hostname (PROTOCOL section 1).
  machineId() {
    const s = this.read();
    if (typeof s.machine === 'string' && s.machine.length) return s.machine;
    const id = 'm-' + crypto.randomBytes(4).toString('hex');
    this.update((st) => { st.machine = id; return st; });
    return id;
  }

  // s- + first 16 hex of SHA-256 of the host session id.
  static sessionId(hostSessionId) {
    const src = String(hostSessionId || 'no-session');
    return 's-' + crypto.createHash('sha256').update(src, 'utf8').digest('hex').slice(0, 16);
  }

  // ----------------------------------------------------------- cursors ----

  getCursor(transport) {
    const s = this.read();
    const raw = (s.cursors || {})[transport];
    return normalizeCursor(transport, raw === undefined ? (transport === 'relay' ? 0 : null) : raw);
  }

  setCursor(transport, cursor) {
    const value = normalizeCursor(transport, cursor);
    this.update((s) => {
      s.cursors = s.cursors || {};
      s.cursors[transport] = value;
      return s;
    });
    return value;
  }

  // section 6.3: the consumed watermark advances at INJECTION time, never at
  // fetch time, and only ever forward.
  getWatermark(transport) {
    const s = this.read();
    const raw = (s.watermarks || {})[transport];
    return normalizeCursor(transport, raw === undefined ? (transport === 'relay' ? 0 : null) : raw);
  }

  advanceWatermark(transport, cursor) {
    const next = normalizeCursor(transport, cursor);
    let result = null;
    let advanced = false;
    this.update((s) => {
      s.watermarks = s.watermarks || {};
      const cur = normalizeCursor(transport, s.watermarks[transport]);
      if (cursorIsAhead(transport, next, cur)) {
        s.watermarks[transport] = next;
        advanced = true;
        result = next;
      } else {
        result = cur;
      }
      return s;
    });
    return { cursor: result, advanced };
  }

  // -------------------------------------------------------- peer cache ----

  getPeers() {
    return readJsonFile(this.files.peers, { members: [], presence: [], claims: [], at: 0, truncated: false });
  }

  setPeers(peers) {
    const value = Object.assign({ members: [], presence: [], claims: [], at: Date.now(), truncated: false }, peers || {});
    writeJsonFile(this.files.peers, value);
    return value;
  }

  // ------------------------------------------------------- own claims ----

  // On ntfy every heartbeat carries the sender's FULL active claim set for
  // resurrection past the ~12 h cache (PROTOCOL section 9.3), so the client
  // has to know its own claims without asking a server that does not exist.
  getOwnClaims(now) {
    const t = Number.isInteger(now) ? now : Date.now();
    const s = this.read();
    const claims = Array.isArray(s.own_claims) ? s.own_claims : [];
    // Expiry test: renewed_at + ttl*1000 <= now (section 5.3).
    return claims.filter((c) => Number(c.renewed_at || c.acquired_at) + Number(c.ttl) * 1000 > t)
      .sort((a, b) => Number(a.acquired_at) - Number(b.acquired_at));
  }

  addOwnClaim(claim) {
    this.update((s) => {
      const list = Array.isArray(s.own_claims) ? s.own_claims : [];
      const idx = list.findIndex((c) => c.subject_key === claim.subject_key);
      if (idx >= 0) {
        // Re-adoption MUST preserve the original acquired_at - it is the
        // tiebreak input (section 5.3 restart recovery).
        const prev = list[idx];
        list[idx] = Object.assign({}, prev, claim, { acquired_at: prev.acquired_at, renewed_at: Date.now() });
      } else {
        list.push(Object.assign({ renewed_at: Date.now() }, claim));
      }
      s.own_claims = list;
      return s;
    });
    return this.getOwnClaims();
  }

  removeOwnClaim(subjectKey) {
    let removed = false;
    this.update((s) => {
      const list = Array.isArray(s.own_claims) ? s.own_claims : [];
      s.own_claims = list.filter((c) => {
        const hit = c.subject_key === subjectKey;
        if (hit) removed = true;
        return !hit;
      });
      return s;
    });
    return removed;
  }

  // ------------------------------------------------------ repo/git state --

  // M8. The private-repo guard's cached verdict (SECURITY.md 6, TTL 600 s) and
  // the non-member-commit warning (SECURITY.md 5.4) are written into the same
  // state.json by lib/repo.js and lib/workspace-files.js. This reader exists so
  // `status`, `doctor` and the digest can surface them WITHOUT shelling out to
  // git or gh - a digest that re-probes GitHub on every injection is a rate
  // limit and a latency bug, and a stale affirmative must be reported as stale
  // rather than silently trusted.
  repoStatus() {
    const s = this.read();
    const guard = s.repo_guard && typeof s.repo_guard === 'object' ? s.repo_guard : null;
    const warnings = s.repo_warnings && typeof s.repo_warnings === 'object' ? s.repo_warnings : null;
    return {
      guard,
      warnings,
      rotation_demanded: Boolean(guard && guard.rotation_demanded),
      member_emails: s.member_emails && typeof s.member_emails === 'object' ? s.member_emails : {},
    };
  }

  // ----------------------------------------------------------- digest -----

  getDigest() { return readJsonFile(this.files.digest, { items: [], at: 0, more: 0 }); }
  setDigest(digest) { writeJsonFile(this.files.digest, digest); return digest; }

  // ----------------------------------------------------------- dedupe -----

  // section 2.6: discard an envelope whose (from.member, sender_seq) pair was
  // already accepted; keep seen nonces for the length of the freshness window.
  dedupe(now) {
    const self = this;
    const t = Number.isInteger(now) ? now : Date.now();
    let store = readJsonFile(this.files.seen, { pairs: {}, nonces: {} });
    const prune = () => {
      for (const [k, at] of Object.entries(store.pairs)) {
        if (t - at > SEEN_PAIR_TTL_MS) delete store.pairs[k];
      }
      for (const [k, at] of Object.entries(store.nonces)) {
        if (t - at > envelope.TS_SKEW_MS * 2) delete store.nonces[k];
      }
      const keys = Object.keys(store.pairs);
      if (keys.length > SEEN_MAX) {
        keys.sort((a, b) => store.pairs[a] - store.pairs[b]);
        for (const k of keys.slice(0, keys.length - SEEN_MAX)) delete store.pairs[k];
      }
    };
    prune();
    return {
      has(member, seq, nonce) {
        if (store.pairs[member + '\u0000' + seq] !== undefined) return true;
        return nonce !== undefined && store.nonces[nonce] !== undefined;
      },
      add(member, seq, nonce) {
        store.pairs[member + '\u0000' + seq] = t;
        if (nonce) store.nonces[nonce] = t;
      },
      flush() { prune(); writeJsonFile(self.files.seen, store); },
      size() { return Object.keys(store.pairs).length; },
    };
  }

  // ---------------------------------------------- per-session loud flags --

  // section 10.2: report once per session, in one line; then stop posting on
  // that transport for the rest of the session; keep reading if reading works.
  session(sessionId) {
    const self = this;
    const id = String(sessionId || 'no-session');
    let s = readJsonFile(this.files.session, null);
    if (!s || s.session !== id) s = { session: id, reported: {}, posting_stopped: {}, counts: {}, at: Date.now() };
    const save = () => writeJsonFile(self.files.session, s);
    return {
      raw() { return s; },
      // True the FIRST time a given loud code is seen this session.
      shouldReport(code) {
        if (s.reported[code]) return false;
        s.reported[code] = Date.now();
        save();
        return true;
      },
      reported(code) { return Boolean(s.reported[code]); },
      stopPosting(transport, code) {
        s.posting_stopped[transport] = { code, at: Date.now() };
        save();
      },
      postingStopped(transport) { return s.posting_stopped[transport] || null; },
      count(bucket, n) {
        s.counts[bucket] = (s.counts[bucket] || 0) + (n === undefined ? 1 : n);
        save();
        return s.counts[bucket];
      },
      counts() { return Object.assign({}, s.counts); },
      reset() {
        s = { session: id, reported: {}, posting_stopped: {}, counts: {}, at: Date.now() };
        save();
      },
    };
  }

  // ---------------------------------------------------- the offline queue --

  queue(binding) {
    return new OfflineQueue(this, binding);
  }
}

// PROTOCOL section 10.3, frozen: filtering at enqueue AND at send; 0600; cap
// 200 drop-oldest with the dropped count reported; per-type expiry; hard
// discard on transport/topic/endpoint/token change with the dropped count;
// re-sign (never backdate) on send.
class OfflineQueue {
  constructor(state, binding) {
    this.state = state;
    this.file = state.files.queue;
    this.binding = binding || {};
    this.fingerprint = bindingFingerprint(this.binding);
    this.keepaliveSeconds = Number(this.binding.keepalive_seconds) || (this.binding.transport === 'relay' ? 60 : 600);
  }

  _read() {
    return readJsonFile(this.file, { binding: this.fingerprint, entries: [], dropped_total: 0 });
  }

  _write(q) { writeJsonFile(this.file, q); return q; }

  // Hard discard when the transport binding changed. Reports the count.
  reconcileBinding() {
    const q = this._read();
    if (q.binding === this.fingerprint) return { discarded: 0, rebound: false };
    const discarded = (q.entries || []).length;
    this._write({ binding: this.fingerprint, entries: [], dropped_total: (q.dropped_total || 0) + discarded });
    return { discarded, rebound: true };
  }

  list() {
    return this._read().entries || [];
  }

  size() { return this.list().length; }

  // Drop entries whose per-type expiry has passed. Returns the count.
  sweep(now) {
    const t = Number.isInteger(now) ? now : Date.now();
    const q = this._read();
    const before = (q.entries || []).length;
    q.entries = (q.entries || []).filter((e) => Number(e.expires_at) > t);
    const expired = before - q.entries.length;
    if (expired) this._write(q);
    return expired;
  }

  // Filter at ENQUEUE (the first of the two mandated filter passes).
  enqueue(env, opts) {
    const o = opts || {};
    const now = Number.isInteger(o.now) ? o.now : Date.now();
    const rebind = this.reconcileBinding();
    envelope.gate(env.type, env.body, env.from, o.filterOpts);   // throws FilterViolation

    const q = this._read();
    q.entries = (q.entries || []).filter((e) => Number(e.expires_at) > now);
    q.entries.push({
      envelope: env,
      type: env.type,
      enqueued_at: now,
      expires_at: queueExpiryAt(env, this.keepaliveSeconds),
    });
    let dropped = 0;
    if (q.entries.length > QUEUE_MAX) {
      dropped = q.entries.length - QUEUE_MAX;
      q.entries = q.entries.slice(dropped);      // drop-OLDEST
      q.dropped_total = (q.dropped_total || 0) + dropped;
    }
    q.binding = this.fingerprint;
    this._write(q);
    return { queued: q.entries.length, dropped, discarded_on_rebind: rebind.discarded };
  }

  // Drain in FIFO order. Every entry is re-signed with a current ts, a fresh
  // nonce and a NEW sender_seq (never backdated - section 10.3) and filtered a
  // SECOND time immediately before it is handed to the transport.
  //
  // publish(envelope) must resolve, or throw an error carrying .kind:
  //   'silent' -> stop draining, keep the rest (section 10.1)
  //   'loud'   -> stop draining and stop posting (section 10.2)
  async drain(publish, opts) {
    const o = opts || {};
    const now = Number.isInteger(o.now) ? o.now : Date.now();
    const kSig = o.kSig;
    const nextSenderSeq = o.nextSenderSeq || (() => this.state.nextSenderSeq());
    const rebind = this.reconcileBinding();
    const expired = this.sweep(now);

    const q = this._read();
    const entries = q.entries || [];
    const result = {
      sent: 0, expired, filtered: 0, dropped_on_rebind: rebind.discarded,
      remaining: entries.length, stopped: null, handles: [],
    };

    while (result.remaining > 0) {
      const entry = entries[0];
      let out;
      try {
        out = envelope.resign(entry.envelope, { kSig, ts: Date.now(), senderSeq: nextSenderSeq() });
        envelope.gate(out.type, out.body, out.from, o.filterOpts);   // filter at SEND
      } catch (err) {
        // A filter refusal is itself a loud condition (section 10.2); the
        // entry is dropped rather than retried forever.
        entries.shift();
        result.remaining = entries.length;
        result.filtered++;
        this._write(q);
        result.stopped = { kind: 'loud', code: 'filter_refusal', detail: String(err && err.message) };
        break;
      }
      try {
        const handle = await publish(out);
        result.handles.push(handle);
        entries.shift();
        result.remaining = entries.length;
        result.sent++;
        this._write(q);
      } catch (err) {
        result.stopped = { kind: err && err.kind === 'loud' ? 'loud' : 'silent', code: err && err.code, detail: String(err && err.message) };
        break;
      }
    }
    this._write(q);
    return result;
  }

  clear() {
    const q = this._read();
    const n = (q.entries || []).length;
    this._write({ binding: this.fingerprint, entries: [], dropped_total: (q.dropped_total || 0) + n });
    return n;
  }
}

function openState(ws, opts) { return new State(ws, opts); }

// ------------------------------------------------------- project index ------

// Which workspace does this directory belong to? The repo-side answer is
// .handshake/workspace.json (lib/session.js, M8 owns writing it). Until that
// exists, `init` and `join` record the binding here so the CLI still resolves
// a workspace from any subdirectory of the project. Local only, never the repo.
function indexFile(env) { return path.join(stateRoot(env), 'workspaces.json'); }

function readIndex(env) {
  return readJsonFile(indexFile(env), { projects: {} });
}

function linkProject(dir, ws, env) {
  const key = path.resolve(dir);
  const idx = readIndex(env);
  idx.projects = idx.projects || {};
  idx.projects[key] = { ws: String(ws), at: Date.now() };
  writeJsonFile(indexFile(env), idx);
  return idx.projects[key];
}

// Walks up from `dir`, so `handshake status` works from any subdirectory.
function lookupProject(dir, env) {
  const idx = readIndex(env);
  const projects = idx.projects || {};
  let cur = path.resolve(dir);
  for (let i = 0; i < 64; i++) {
    if (projects[cur]) return { dir: cur, ws: projects[cur].ws };
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

module.exports = {
  State, OfflineQueue, openState,
  indexFile, readIndex, linkProject, lookupProject,
  stateRoot, stateDir, ensureDir, readJsonFile, writeJsonFile,
  queueExpiryAt, bindingFingerprint, cursorKind, normalizeCursor, cursorIsAhead,
  QUEUE_MAX, NOTE_EXPIRY_MS, LEAVE_EXPIRY_MS, DEFAULT_CLAIM_TTL, FILE_MODE,
  WINDOWS_ACL_NOTE,
};
