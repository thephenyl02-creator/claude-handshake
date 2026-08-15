'use strict';
// claude-handshake M4/M5: session classification and workspace resolution.
//
// Normative: PROTOCOL section 7.1 (child-mode detection and its safe fallback)
// and section 8 (every hook is a sub-10 ms no-op outside a handshake
// workspace, resolved by walking up from cwd to .handshake/workspace.json,
// cached).
//
// The guarded half of workspace.json - workspace secret, ntfy topic, relay
// tokens - is M8's business and is NEVER returned by this module. What comes
// out of resolveWorkspace() is the public part only, through an allowlist, so
// a future change to the split file cannot leak a credential through this path.

const fs = require('fs');
const path = require('path');

// M8: .handshake/* is untrusted data even when this client wrote it - a repo
// reader, a bad merge or a non-member commit can have changed it since
// (SECURITY.md 5.4). The public part reaches a model context through `status`
// and the standing block, so it is escaped on the way out of this module with
// the SAME escaper the transport receive path uses. Escaping here is a no-op
// on every well-formed value (a 32-hex id, a URL, "relay", "on"), which is the
// point: it costs nothing until the file is hostile.
const escape = require('./escape');

const WORKSPACE_DIR = '.handshake';
const WORKSPACE_FILE = 'workspace.json';
const MAX_WALK_DEPTH = 64;

// PROTOCOL section 7.1
const CHILD_ENV_VAR = 'CLAUDE_CODE_CHILD_SESSION';
const PARENT_ID_ENV_VAR = 'CLAUDE_CODE_SESSION_ID';
const INTERACTIVE_SOURCES = Object.freeze(['startup', 'resume', 'clear']);

// A monitor's sentinel is only fresh while the monitor is ticking; the monitor
// tick was measured at 60.0 s +/- 20 ms [S5], so three ticks is the generous
// bound that still fails toward "no monitor".
const MONITOR_SENTINEL_MAX_AGE_MS = 3 * 60 * 1000;

// ----------------------------------------------------- child-mode (7.1) ----

// Monitors start only in interactive CLI sessions [S5], which is what makes a
// live monitor a valid interactive marker.
function monitorAlive(sentinelPath, now) {
  if (!sentinelPath) return false;
  try {
    const st = fs.statSync(sentinelPath);
    const t = Number.isInteger(now) ? now : Date.now();
    return t - st.mtimeMs <= MONITOR_SENTINEL_MAX_AGE_MS;
  } catch (_) {
    return false;
  }
}

// Returns {child, reason, parent_session, markers}.
//
// Rule 1: CLAUDE_CODE_CHILD_SESSION=1 -> child, full stop.
// Rule 2 (the safe fallback, MUST): the variable absent -> child ANYWAY,
//   unless an interactive marker is present. A session that cannot prove it is
//   a parent behaves as a child. The fallback fails toward silence, never
//   toward a phantom teammate.
function detectChildMode(opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const now = Number.isInteger(o.now) ? o.now : Date.now();
  const raw = env[CHILD_ENV_VAR];
  const parent = typeof env[PARENT_ID_ENV_VAR] === 'string' && env[PARENT_ID_ENV_VAR].length
    ? env[PARENT_ID_ENV_VAR] : null;

  if (raw === '1') {
    return {
      child: true, reason: 'child_env_var', parent_session: parent,
      markers: { child_env: '1', monitor: null, source: o.source || null },
    };
  }

  const monitor = o.monitorRunning !== undefined
    ? Boolean(o.monitorRunning)
    : monitorAlive(o.monitorSentinel, now);
  const source = typeof o.source === 'string' ? o.source : null;
  // "in an interactive host": a SessionStart source only counts when the host
  // is interactive. A headless `claude -p` run reports a source too.
  const interactiveHost = o.interactiveHost === undefined ? true : Boolean(o.interactiveHost);
  const sourceMarker = Boolean(source && INTERACTIVE_SOURCES.includes(source) && interactiveHost);

  if (monitor || sourceMarker) {
    return {
      child: false,
      reason: monitor ? 'interactive_marker_monitor' : 'interactive_marker_source',
      parent_session: null,
      markers: { child_env: raw === undefined ? null : String(raw), monitor, source },
    };
  }
  return {
    child: true, reason: 'safe_fallback_no_interactive_marker', parent_session: parent,
    markers: { child_env: raw === undefined ? null : String(raw), monitor, source },
  };
}

// The four child rules of section 7.2, in one place so no caller has to
// remember them: never a member, honor the gate from the PARENT's local cache,
// append touched files upward, aggregate into presence.agents - never split.
const CHILD_RULES = Object.freeze({
  may_join: false, may_hold_presence: false, may_claim: false, may_post: false,
  must_run_pretooluse_gate: true, gate_source: 'parent_local_cache',
  may_do_network_io: false, appends_files_to_parent: true,
  aggregates_into: 'presence.update.agents',
});

// -------------------------------------------- workspace resolution (8) -----

// Public keys only. Anything not listed is dropped on the floor - including
// every credential name the guarded half might use.
const PUBLIC_KEYS = Object.freeze([
  'ws', 'name', 'transport', 'endpoint', 'protocol', 'client',
  'inject', 'overlap_gate', 'created_at', 'durable_layer', 'members',
]);
const GUARDED_KEYS = Object.freeze([
  'secret', 'topic', 'token', 'enrollment_token', 'recovery_key', 'member_token', 'guarded', 'private',
]);

// Strings escaped, numbers/booleans passed through, arrays escaped
// element-wise, everything else dropped. Non-scalars in a public field are not
// a shape this code understands, and passing an unknown shape through to a
// model context is precisely the bypass 5.4 closes.
function escapeValue(key, value) {
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return escape.escapeField(key, value, { singleLine: true });
  if (Array.isArray(value)) {
    return value.slice(0, 64)
      .filter((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
      .map((v) => escapeValue(key === 'members' ? 'member' : key, v));
  }
  return undefined;
}

const cache = new Map();
const CACHE_TTL_MS = 5000;

function clearCache() { cache.clear(); }

function readPublicPart(file) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { ok: false, error: String(err && err.message) };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'workspace.json is not a JSON object' };
  }
  // The split file format: public fields at the top level, with the guarded
  // half either inline under a guarded key (private repo) or absent entirely
  // (secret held out of band). Either way we take the allowlist and nothing else.
  const source = parsed.public && typeof parsed.public === 'object' && !Array.isArray(parsed.public)
    ? Object.assign({}, parsed, parsed.public)
    : parsed;
  const pub = {};
  for (const k of PUBLIC_KEYS) {
    if (source[k] === undefined) continue;
    const v = escapeValue(k, source[k]);
    if (v !== undefined) pub[k] = v;
  }
  const hasGuarded = GUARDED_KEYS.some((k) => source[k] !== undefined);
  return { ok: true, public: pub, has_guarded: hasGuarded };
}

// Walk up from `cwd` looking for <dir>/.handshake/workspace.json. Cached, so
// the out-of-workspace path stays a sub-10 ms no-op (section 8).
function resolveWorkspace(cwd, opts) {
  const o = opts || {};
  const start = path.resolve(cwd || process.cwd());
  const now = Number.isInteger(o.now) ? o.now : Date.now();
  if (!o.noCache) {
    const hit = cache.get(start);
    if (hit && now - hit.at < CACHE_TTL_MS) return hit.value;
  }

  let dir = start;
  let value = null;
  for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    const file = path.join(dir, WORKSPACE_DIR, WORKSPACE_FILE);
    let stat = null;
    try { stat = fs.statSync(file); } catch (_) { stat = null; }
    if (stat && stat.isFile()) {
      const parsed = readPublicPart(file);
      value = {
        root: dir,
        handshake_dir: path.join(dir, WORKSPACE_DIR),
        file,
        ok: parsed.ok,
        error: parsed.ok ? null : parsed.error,
        public: parsed.ok ? parsed.public : {},
        has_guarded: parsed.ok ? parsed.has_guarded : false,
      };
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;      // filesystem root, Windows drive root included
    dir = parent;
  }

  cache.set(start, { value, at: now });
  return value;
}

// Cheap boolean for hook fast-paths: "am I inside a handshake workspace?"
function inWorkspace(cwd, opts) {
  return resolveWorkspace(cwd, opts) !== null;
}

module.exports = {
  WORKSPACE_DIR, WORKSPACE_FILE, PUBLIC_KEYS, GUARDED_KEYS,
  CHILD_ENV_VAR, PARENT_ID_ENV_VAR, INTERACTIVE_SOURCES, CHILD_RULES,
  MONITOR_SENTINEL_MAX_AGE_MS, CACHE_TTL_MS,
  detectChildMode, monitorAlive, resolveWorkspace, inWorkspace, readPublicPart, clearCache,
};
