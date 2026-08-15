'use strict';
// claude-handshake M6: shared hook plumbing.
//
// Normative: PROTOCOL section 8 (the hook cadence contract) and
// docs/spike-findings.md [S1]-[S7]. Four rules bind EVERY script in this
// directory, and they are implemented here once so no hook can forget one:
//
//   1. bounded stdin read with a 600 ms backstop, always [S1]
//   2. exit 0 always - a hook must never fail the turn it observes
//   3. nothing on stdout except a designed injection
//   4. sub-10 ms no-op outside a handshake workspace, resolved by walking up
//      from cwd (lib/session.js), cached
//
// Everything required from ../lib is READ-ONLY: this milestone owns hooks/,
// monitors/ and the plugin manifest, and consumes lib/ through its public API.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const STDIN_BACKSTOP_MS = 600;                                  // [S1]
const CLI = path.join(__dirname, '..', 'bin', 'handshake.js');

// Sentinel and marker files, all inside the per-workspace state dir so they
// inherit its 0700 and never land in the repo.
const SENTINELS = Object.freeze({
  monitorAlive: 'monitor.alive',      // written by monitors/heartbeat.js, read by lib/session.js
  monitorDisarm: 'monitor.disarm',    // written by `handshake rest` - the ONLY mid-session disarm [S5]
  syncPending: 'sync.pending',        // SessionStart writes, UserPromptSubmit waits <= 500 ms on it
  postToolTick: 'posttool.tick',      // the PostToolUse mtime gate [S6]
  activity: 'activity.mark',          // last tool activity, for the monitor's honest presence state
  ticks: 'hooks.ticks.json',          // PostToolUse tick counter (opportunistic sync every ~5th)
});

// PostToolUse fires at p50 0.4 s / p90 3.1 s in agent workloads [S7] and 218
// spawns were observed in 1.7 h [S6]. The mtime gate collapses a burst; the
// window is deliberately short because files[] is appended progressively and a
// missed append is advisory data, not correctness.
const POSTTOOL_GATE_MS = 1000;
const SYNC_EVERY_N_TICKS = 5;
const PENDING_WAIT_MS = 500;          // PROTOCOL section 8: UserPromptSubmit waits <= 500 ms

// --------------------------------------------------------------- lifetime ---

// Exit 0 always. Registered by every script before it does anything else.
function armSafety(budgetMs) {
  process.on('uncaughtException', () => { try { process.exit(0); } catch (_) { /* ignore */ } });
  process.on('unhandledRejection', () => { try { process.exit(0); } catch (_) { /* ignore */ } });
  // The host also enforces a timeout, but its unit has changed across
  // versions (the reference docs now specify SECONDS). An in-process watchdog
  // makes the PROTOCOL section 8 budget real regardless of how the host reads
  // hooks.json. unref() so it never keeps an otherwise-finished hook alive.
  if (budgetMs > 0) {
    const t = setTimeout(() => { try { process.exit(0); } catch (_) { /* ignore */ } }, budgetMs);
    if (t.unref) t.unref();
  }
}

function done() { try { process.exit(0); } catch (_) { /* ignore */ } }

// ------------------------------------------------------------------ stdin ---

// [S1]: stdin arrived on every firing but one SessionStart stayed open past
// 600 ms, and the backstop still had a parseable payload. So: bounded, always.
function readPayload(cb) {
  let raw = '';
  let finished = false;
  const finish = (why) => {
    if (finished) return;
    finished = true;
    let ctx = {};
    try { ctx = JSON.parse(raw.replace(/^\ufeff/, '').trim() || '{}') || {}; } catch (_) { ctx = {}; }
    if (ctx === null || typeof ctx !== 'object') ctx = {};
    try { cb(ctx, why, raw.length); } catch (_) { done(); }
  };
  try {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { raw += c; });
    process.stdin.on('end', () => finish('end'));
    process.stdin.on('error', () => finish('error'));
    process.stdin.on('close', () => finish('close'));
  } catch (_) { /* no stdin at all */ }
  setTimeout(() => finish('timeout'), STDIN_BACKSTOP_MS);
}

// The payload contract measured at M0.5 is camelCase [S1]; the current
// reference docs specify snake_case. Both are read - a hook that guesses one
// naming and is wrong goes silently blind, which is the worst failure mode
// available to it.
function fields(ctx) {
  const c = ctx || {};
  const ti = c.toolInput || c.tool_input || {};
  return {
    event: c.hookEventName || c.hook_event_name || c.event || null,
    sessionId: c.sessionId || c.session_id || null,
    toolName: c.toolName || c.tool_name || null,
    filePath: ti.file_path || ti.notebook_path || ti.path || null,
    toolInput: ti,
    cwd: c.workingDirectory || c.cwd || process.cwd(),
    source: c.source || null,
    reason: c.reason || null,
    agentType: c.agent_type || c.agentType || null,
    agentId: c.agent_id || c.agentId || null,
  };
}

// ------------------------------------------------------------------- libs ---

function lib(name) {
  try { return require(path.join(__dirname, '..', 'lib', name)); } catch (_) { return null; }
}

// ------------------------------------------------------- workspace resolve --

// PROTOCOL section 8: a sub-10 ms no-op outside a handshake workspace.
// Resolution order mirrors the CLI's: the repo layer first (lib/session.js,
// PUBLIC half only - a hook never touches key material), then the local
// project index written by init/join.
function resolveWorkspace(cwd) {
  const sessionLib = lib('session.js');
  if (!sessionLib) return null;
  const wf = lib('workspace-files.js');
  let found = null;
  try {
    // lib/session.js performs the bounded walk up from cwd; the public half is
    // then re-read through lib/workspace-files.js, which escapes on read
    // because .handshake/* is untrusted data exactly like transport content
    // (SECURITY 5.4). A hook never opens that file itself.
    const r = sessionLib.resolveWorkspace(cwd || process.cwd(), { noCache: true });
    if (r && r.ok && r.public && r.public.ws) {
      let pub = r.public;
      if (wf && typeof wf.readWorkspacePublic === 'function') {
        try {
          const doc = wf.readWorkspacePublic(r.root);
          if (doc && doc.public && doc.public.ws) pub = doc.public;
        } catch (_) { /* keep the session.js allowlist view */ }
      }
      found = { ws: String(pub.ws), root: r.root, public: pub, source: 'repo' };
    }
  } catch (_) { /* fall through */ }
  if (!found) {
    const stateLib = lib('state.js');
    if (!stateLib) return null;
    try {
      const linked = stateLib.lookupProject(cwd || process.cwd());
      if (linked) found = { ws: String(linked.ws), root: linked.dir, public: {}, source: 'local_index' };
    } catch (_) { /* not in a workspace */ }
  }
  return found;
}

function openState(ws) {
  const stateLib = lib('state.js');
  if (!stateLib) return null;
  try { return stateLib.openState(ws); } catch (_) { return null; }
}

// The transport kind comes from the workspace config (the public half) and
// falls back to local state. Nothing else in a hook needs to know it.
function transportOf(found, cfg) {
  const t = (found && found.public && found.public.transport) || (cfg && cfg.transport) || 'ntfy';
  return t === 'relay' ? 'relay' : 'ntfy';
}

function keepaliveSeconds(transport) { return transport === 'relay' ? 60 : 600; }

// PROTOCOL section 5.2: the path gate MAY block only when the workspace config
// sets overlap_gate "block"; the default is warn.
function overlapGate(found, cfg) {
  const v = (found && found.public && found.public.overlap_gate) || (cfg && cfg.overlap_gate) || 'warn';
  return String(v) === 'block' ? 'block' : 'warn';
}

// --------------------------------------------------------------- sentinels --

function sentinel(state, key) {
  return path.join(state.dir, SENTINELS[key] || key);
}

function touch(file, body) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, body === undefined ? String(Date.now()) + '\n' : body, { mode: 0o600 });
    return true;
  } catch (_) { return false; }
}

function ageMs(file, now) {
  try {
    const st = fs.statSync(file);
    return (Number.isInteger(now) ? now : Date.now()) - st.mtimeMs;
  } catch (_) { return null; }               // absent == infinitely old
}

function isFresh(file, windowMs, now) {
  const a = ageMs(file, now);
  return a !== null && a >= 0 && a < windowMs;
}

function remove(file) { try { fs.unlinkSync(file); return true; } catch (_) { return false; } }

// ------------------------------------------------------------- child mode ---

// PROTOCOL section 7.1. The safe fallback is applied for HOOK sessions: a
// session that cannot prove it is a parent behaves as a child.
//
// Re-verified at M6 on this machine: a human-typed `claude -p ...` run reports
// CLAUDE_CODE_CHILD_SESSION=1 when it is launched from inside another Claude
// Code session (the variable is inherited). It is therefore proof of "not the
// top-level interactive session", which is exactly what rule 1 needs, and the
// no-op logic below never depends on it being absent.
function childMode(state, source, opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const sessionLib = lib('session.js');
  if (!sessionLib) return { child: true, reason: 'session_lib_unavailable', parent_session: null, markers: {} };
  // The payload carries `agent_id`/`agent_type` when the session runs with
  // --agent or inside a subagent. That is a documented, positive marker of a
  // child, and it settles the one case section 7.1's fallback cannot: a
  // headless session that reports an interactive-looking SessionStart `source`.
  if (o.agentMarker) {
    return {
      child: true, reason: 'agent_payload_marker',
      parent_session: parentSessionId(env),
      markers: { child_env: env.CLAUDE_CODE_CHILD_SESSION || null, agent: true, source: source || null },
    };
  }
  return sessionLib.detectChildMode({
    env,
    source: source || null,
    monitorSentinel: state ? sentinel(state, 'monitorAlive') : null,
  });
}

// Only SessionStart sees an interactive `source`, and only an interactive CLI
// session has a monitor to point at [S5]. Every later hook in the same session
// carries neither marker, so the verdict is classified ONCE at SessionStart
// and recorded per session id. Without this a monitor-less parent - a
// configuration section 8 explicitly supports ("monitors unavailable,
// heartbeating on turn boundaries") - would be classified a child on every
// turn and could never advance its own watermark.
const ROLE_MAX = 16;

function recordRole(state, sessionId, verdict) {
  if (!state || !sessionId) return false;
  try {
    state.update((s) => {
      const roles = (s.session_roles && typeof s.session_roles === 'object' && !Array.isArray(s.session_roles))
        ? s.session_roles : {};
      roles[String(sessionId)] = { child: Boolean(verdict && verdict.child), reason: (verdict && verdict.reason) || null, at: Date.now() };
      const keys = Object.keys(roles);
      if (keys.length > ROLE_MAX) {
        keys.sort((a, b) => Number(roles[a].at || 0) - Number(roles[b].at || 0));
        for (const k of keys.slice(0, keys.length - ROLE_MAX)) delete roles[k];
      }
      s.session_roles = roles;
      return s;
    });
    return true;
  } catch (_) { return false; }
}

function roleOf(state, sessionId) {
  if (!state || !sessionId) return null;
  try {
    const s = state.read();
    const r = s.session_roles && s.session_roles[String(sessionId)];
    return r && typeof r === 'object' ? r : null;
  } catch (_) { return null; }
}

// The verdict every hook other than SessionStart uses, in precedence order:
// proven child > documented agent marker > this session's recorded verdict >
// section 7.1's safe fallback.
function isChild(state, f, env) {
  const e = env || process.env;
  if (provenChild(e)) return { child: true, reason: 'child_env_var', parent_session: parentSessionId(e) };
  if (f && (f.agentId || f.agentType)) return { child: true, reason: 'agent_payload_marker', parent_session: parentSessionId(e) };
  const rec = roleOf(state, f && f.sessionId);
  if (rec) return { child: Boolean(rec.child), reason: 'session_role/' + (rec.reason || 'recorded'), parent_session: parentSessionId(e) };
  return childMode(state, f && f.source, { env: e });
}

function provenChild(env) {
  const e = env || process.env;
  return e.CLAUDE_CODE_CHILD_SESSION === '1';
}

function parentSessionId(env) {
  const e = env || process.env;
  const v = e.CLAUDE_CODE_SESSION_ID;
  return typeof v === 'string' && v.length ? v : null;
}

// -------------------------------------------------------------- the CLI -----

// One place that shells out to bin/handshake.js. stdio is never inherited:
// a hook's child process must not be able to write to the session's stdout.
// The environment is passed through UNCHANGED - stripping
// CLAUDE_CODE_CHILD_SESSION here would let a child post, which section 7.2
// rule 1 forbids.
function runCli(args, opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    let child;
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; resolve(r); } };
    try {
      child = spawn(process.execPath, [CLI].concat(args), {
        cwd: o.cwd || process.cwd(),
        stdio: ['ignore', o.capture ? 'pipe' : 'ignore', 'ignore'],
        windowsHide: true,
      });
    } catch (err) {
      return finish({ ok: false, code: null, stdout: '', error: String(err && err.message) });
    }
    let stdout = '';
    if (o.capture && child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (c) => { stdout += c; });
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) { /* ignore */ }
      finish({ ok: false, code: null, stdout, timedOut: true });
    }, o.timeoutMs || 8000);
    if (timer.unref) timer.unref();
    child.on('error', (err) => { clearTimeout(timer); finish({ ok: false, code: null, stdout, error: String(err && err.message) }); });
    child.on('close', (code) => { clearTimeout(timer); finish({ ok: code === 0, code, stdout }); });
  });
}

// `sync --json` prints one JSON object; it also refreshes the peer cache as a
// side effect and advances NOTHING (the watermark moves at injection time).
function parseJsonStdout(stdout) {
  const s = String(stdout || '').trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch (_) { /* fall through */ }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch (_) { return null; }
  }
  return null;
}

// ------------------------------------------------------------------ paths ---

// Claim files[] are repo-relative POSIX paths (PROTOCOL section 3.2).
function repoRelative(root, filePath) {
  if (!filePath) return null;
  try {
    const abs = path.resolve(String(filePath));
    const rel = path.relative(path.resolve(root || process.cwd()), abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;   // outside the repo
    return rel.split(path.sep).join('/').slice(0, 300);
  } catch (_) { return null; }
}

// The gate is a PATH comparison, never a subject one (PROTOCOL section 5.2).
// A claim entry may be an exact repo-relative path or a glob; both are matched
// against the target path only.
function globToRegExp(glob) {
  const g = String(glob);
  let out = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { out += '.*'; i++; if (g[i + 1] === '/') i++; }
      else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + out + '$', 'i');     // case-insensitive: Windows paths
}

function pathMatches(target, entry) {
  if (!target || !entry) return false;
  const t = String(target).toLowerCase();
  const e = String(entry).replace(/\\/g, '/').trim();
  if (!e) return false;
  const el = e.toLowerCase();
  if (t === el) return true;
  if (/[*?]/.test(e)) { try { return globToRegExp(e).test(target); } catch (_) { return false; } }
  // A claimed directory covers what is under it.
  if (el.endsWith('/') && t.startsWith(el)) return true;
  return false;
}

// ------------------------------------------------------------- the view -----

// Map local state onto the renderer's input. Local cache ONLY - this runs on
// the synchronous UserPromptSubmit path, where PROTOCOL section 8 allows zero
// network and nothing may block.
function buildView(state, found, opts) {
  const o = opts || {};
  const now = Number.isInteger(o.now) ? o.now : Date.now();
  const render = require('./render');
  const stateLib = lib('state.js');
  const T = lib('transport.js');
  // M8: lib/escape.js is the PRIMARY receive-path control. Peer-authored
  // strings are escaped HERE, at the boundary where cached transport data
  // enters the injection pipeline, not left for the renderer's belt-and-braces
  // pass (SECURITY 5.3/5.4).
  const esc = lib('escape.js');
  const field = (name, v) => (esc ? esc.escapeField(name, v, { singleLine: true }) : v);
  const memberId = (v) => (esc ? esc.escapeMemberId(v) : v);
  const cfg = state.read();
  const transport = transportOf(found, cfg);
  const K = keepaliveSeconds(transport);
  const labelOf = (age) => (T ? T.presenceLabel(age, K)
    : (age <= 2.5 * K * 1000 ? 'live' : age <= 6 * K * 1000 ? 'quiet' : 'stale'));
  const isPriority = (type) => (T ? T.isPriorityType(type)
    : (typeof type === 'string' && (type.startsWith('warn.') || type === 'note.blocker')));

  const peers = state.getPeers();
  const me = cfg.member || null;
  const ownerOf = (c) => c.owner || c.member || c.member_id || null;
  // Member ids and names reach a model context, so both go through the shared
  // escaper: ids are restricted to printable ASCII [D8], names take the
  // section 3.2 cap.
  const names = new Map();
  for (const m of peers.members || []) {
    const id = m.member || m.member_id;
    if (id) names.set(id, field('name', m.name || m.display_name || id));
  }
  for (const p of peers.presence || []) {
    const id = p.member || p.member_id;
    if (id && !names.has(id)) names.set(id, field('name', p.name || p.display_name || id));
  }
  const nameFor = (id, fallback) => names.get(id) || field('name', fallback) || memberId(id) || 'peer';

  // roster ------------------------------------------------------------------
  const roster = [];
  for (const p of peers.presence || []) {
    const id = p.member || p.member_id;
    if (!id || (me && id === me)) continue;                 // never render yourself as a peer
    const age = now - Number(p.updated_at || 0);
    const label = labelOf(age);
    if (label === 'gone') continue;                         // section 4.3: gone is not present
    const held = (peers.claims || [])
      .filter((c) => ownerOf(c) === id)
      .sort((a, b) => Number(b.acquired_at || 0) - Number(a.acquired_at || 0))[0];
    roster.push({
      name: nameFor(id, p.name), state: field('name', p.state) || null,
      claim: held ? field('subject', held.subject || held.subject_key) : null,
      label, age_ms: age,
      agents: Number.isInteger(p.agents) ? p.agents : 0,     // section 7.2 rule 4
    });
  }
  const rank = { live: 0, quiet: 1, stale: 2 };
  roster.sort((a, b) => (rank[a.label] - rank[b.label]) || (a.age_ms - b.age_ms));

  // claims ------------------------------------------------------------------
  const claims = [];
  const seen = new Set();
  for (const c of peers.claims || []) {
    const key = c.subject_key || c.subject;
    const expires = Number(c.expires_at) ||
      (Number(c.renewed_at || c.acquired_at || 0) + Number(c.ttl || 7200) * 1000);
    if (expires <= now) continue;                            // section 5.3 expiry test
    const owner = ownerOf(c);
    const own = Boolean(me && owner === me);
    const details = [];
    // section 5.5: on an unauthenticated transport a claim is advisory, and
    // the label is never dropped (standing-block.md truncation rule 5).
    if (transport !== 'relay') details.push('advisory');
    const remaining = expires - now;
    if (own ? remaining < 30 * 60000 : remaining < 90 * 60000) details.push(render.timeLeft(remaining));
    claims.push({
      subject: field('subject', c.subject || key), owner: own ? 'you' : nameFor(owner, c.owner_name),
      own, details, acquired_at: Number(c.acquired_at) || 0,
    });
    if (key) seen.add(key);
  }
  for (const c of state.getOwnClaims(now)) {
    if (c.subject_key && seen.has(c.subject_key)) continue;  // already in the transport's view
    const details = transport !== 'relay' ? ['advisory'] : [];
    claims.push({ subject: field('subject', c.subject || c.subject_key), owner: 'you', own: true, details, acquired_at: Number(c.acquired_at) || 0 });
  }
  claims.sort((a, b) => a.acquired_at - b.acquired_at);

  // PROTOCOL 5.4: a genuinely-concurrent double-claim on an unauthenticated
  // transport is only discoverable at sync time - neither side knew when it
  // claimed. The deterministic verdict rides as a local notice (never
  // watermark-consumable), and the model runs the 5.4 loser sequence from it.
  const conflictNotices = [];
  const subjectLib = lib('subject.js');
  if (subjectLib && me) {
    const ownByKey = new Map();
    for (const c of state.getOwnClaims(now)) if (c.subject_key) ownByKey.set(c.subject_key, c);
    for (const c of peers.claims || []) {
      const key = c.subject_key;
      if (!key || !ownByKey.has(key)) continue;
      const owner = ownerOf(c);
      if (!owner || owner === me) continue;
      const expires = Number(c.expires_at) ||
        (Number(c.renewed_at || c.acquired_at || 0) + Number(c.ttl || 7200) * 1000);
      if (expires <= now) continue;
      const mineC = ownByKey.get(key);
      const lost = subjectLib.losesTiebreak(
        { acquired_at: Number(mineC.acquired_at) || 0, member: me },
        { acquired_at: Number(c.acquired_at) || 0, member: owner });
      conflictNotices.push('claim conflict on "' + field('subject', key) + '": you ' +
        (lost ? 'lose the tiebreak (5.4) - release it, post task.change, one line to your user'
          : 'win the tiebreak (5.4) - the peer releases'));
    }
  }

  // digest ------------------------------------------------------------------
  const dg = state.getDigest();
  const items = (dg.items || []).map((it) => ({
    type: field('name', it.type), member: field('member_name', it.member_name || it.member || it.from || 'peer'),
    text: field('text', it.text) || '(no text)', priority: isPriority(it.type),
    // `from` and `seq` are dedupe keys, never rendered: they keep their raw
    // transport values so the pair still matches what the adapter accepted.
    seq: it.seq, from: it.member || it.from, nonce: it.nonce,
  }));
  // PROTOCOL section 6.1: priority items hold the reserved floor and sort
  // first. Array#sort is stable, so equal-priority order is preserved.
  items.sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0));

  // notes -------------------------------------------------------------------
  // session.json is read READ-ONLY here: state.session() rewrites the file
  // when the session id differs, and a synchronous injection hook must not
  // fight the CLI over per-session flags.
  let stopped = false;
  if (stateLib) {
    const s = stateLib.readJsonFile(state.files.session, null);
    stopped = Boolean(s && s.posting_stopped && s.posting_stopped[transport]);
  }

  // Repo posture, read from STATE only - no git, no subprocess. The injection
  // path is synchronous and zero-network (PROTOCOL section 8), so the guard
  // verdict is whatever `handshake guard`/`doctor` last stored.
  const repoStatus = typeof state.repoStatus === 'function' ? state.repoStatus() : { guard: null, warnings: null, rotation_demanded: false };
  const repoLib = lib('repo.js');
  const verdict = repoLib && typeof repoLib.cachedVerdict === 'function' ? repoLib.cachedVerdict(state, { now }) : null;
  const warnings = repoStatus.warnings || {};

  // SECURITY sections 5.4 and 6: a demanded rotation and an unprovable
  // private-repo verdict are both states the human must see, and neither is
  // peer traffic - so they ride as local notices, never as digest items that
  // the watermark could consume.
  const notices = [...conflictNotices];
  if (repoStatus.rotation_demanded) {
    notices.push('rotate the workspace secret: key material was tracked in a repo not proven private');
  } else if (verdict && verdict.private === false) {
    notices.push('private-repo guard: not private (' + (verdict.reason || 'unknown') + '); the guarded part stays out of the repo');
  }

  return {
    ws: (found && found.public && found.public.name) || cfg.name || String(found && found.ws || '').slice(0, 8),
    tier: transport === 'relay' ? 'relay' : 'zero-setup',
    transport,
    roster,
    claims,
    digest: {
      items, more: Math.max(0, Number(dg.more) || 0), muted: Boolean(cfg.muted),
      cursor: dg.next_cursor, notices,
    },
    notes: {
      sync_pending: Boolean(o.syncPending),
      posting_stopped: stopped,
      older_chatter_gone: Boolean(peers.truncated),
      // The template's own literal for exactly this condition. Sourced from
      // the M8 shard-author check rather than a local flag.
      non_member_tasks: warnings.flag === 'non_member_commit',
    },
    repo: { guard: repoStatus.guard, verdict, warnings, rotation_demanded: repoStatus.rotation_demanded },
  };
}

// A real sleep, not a spin: the UserPromptSubmit wait on the pending-sync
// marker is bounded at 500 ms (PROTOCOL section 8) and must not burn CPU.
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_) { /* ignore */ }
}

module.exports = {
  STDIN_BACKSTOP_MS, POSTTOOL_GATE_MS, SYNC_EVERY_N_TICKS, PENDING_WAIT_MS, SENTINELS, CLI,
  buildView, sleepSync,
  armSafety, done, readPayload, fields, lib,
  resolveWorkspace, openState, transportOf, keepaliveSeconds, overlapGate,
  sentinel, touch, ageMs, isFresh, remove,
  childMode, provenChild, parentSessionId, recordRole, roleOf, isChild,
  runCli, parseJsonStdout, repoRelative, pathMatches, globToRegExp,
};
