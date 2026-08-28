#!/usr/bin/env node
'use strict';
// claude-handshake M6: the liveness clock.
//
// PROTOCOL section 8:
//   - heartbeat cadence: 60 s on the relay; state-change + 600 s keepalive on
//     ntfy
//   - the heartbeat rides the MONITOR's own clock, never tool cadence
//     (PostToolUse gaps are p50 0.4 s / p90 3.1 s and go silent entirely
//     during long builds [S7])
//   - monitor lifetime == session lifetime; it is hard-killed at session end
//     with no signal and no exit event [S5], so graceful work rides SessionEnd
//   - mid-session disarm is sentinel-file polling ONLY [S5]
//
// CRITICAL: this process writes NOTHING to stdout. A monitor's stdout lines are
// delivered into the Claude session as notifications, so every child process it
// starts has its stdio ignored and nothing here ever calls console.log.
//
// Monitors do not start in headless or subagent sessions [S5]; the child guard
// below is belt and braces, not the mechanism.

const C = require('../hooks/common');

const POLL_MS = 5000;                    // disarm responsiveness, not heartbeat cadence
const MAX_FILES = 64;                    // PROTOCOL section 2.5

function main() {
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const found = C.resolveWorkspace(cwd);
  if (!found) return quit();                          // not a handshake workspace: exit immediately
  const state = C.openState(found.ws);
  if (!state) return quit();
  if (C.provenChild()) return quit();                 // section 7.2 rule 1

  const cfg = state.read();
  const transport = C.transportOf(found, cfg);
  const K = C.keepaliveSeconds(transport) * 1000;     // 60 s relay / 600 s ntfy
  const alive = C.sentinel(state, 'monitorAlive');
  const disarm = C.sentinel(state, 'monitorDisarm');
  const activity = C.sentinel(state, 'activity');
  const stateLib = C.lib('state.js');

  let lastBeat = 0;
  let lastState = null;
  let busy = false;

  const cleanup = () => { C.remove(alive); };
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGBREAK']) {
    try { process.on(sig, () => { cleanup(); quit(); }); } catch (_) { /* unsupported on this platform */ }
  }

  // The alive sentinel is what lib/session.js reads as the "a monitor is
  // running" interactive marker (section 7.1). It is touched on every poll so
  // it stays inside that module's 3-tick freshness bound.
  C.touch(alive);

  const tick = async () => {
    // Sentinel-file disarm: `handshake rest` writes it, and it is the ONLY
    // mid-session disarm the monitor contract allows [S5].
    if (C.ageMs(disarm) !== null) { cleanup(); return quit(); }
    C.touch(alive);
    if (busy) return;

    // Honest presence. section 4.2 has no idle value, so the state is derived
    // from real tool activity rather than asserted: `working` while the
    // session is producing changes, `waiting` when it is sitting at the prompt
    // waiting on its human. Readers derive quiet/stale from age (section 4.3).
    const desired = C.isFresh(activity, 2.5 * K) ? 'working' : 'waiting';

    const stateChanged = lastState !== null && desired !== lastState;
    const due = transport === 'relay'
      ? (Date.now() - lastBeat >= K)
      : (lastBeat === 0 || stateChanged || Date.now() - lastBeat >= K);
    if (!due) return;

    // section 10.2: once posting has stopped on this transport for the
    // session, it stays stopped. Spawning the CLI to be refused every minute
    // would be a rate-limit amplifier.
    if (stateLib) {
      const s = stateLib.readJsonFile(state.files.session, null);
      if (s && s.posting_stopped && s.posting_stopped[transport]) return;
    }

    busy = true;
    try {
      await beat(state, found, desired);
      lastBeat = Date.now();
      lastState = desired;
    } catch (_) {
      lastBeat = Date.now();                          // section 10.1: silent, and no retry storm
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(() => { tick().catch(() => {}); }, POLL_MS);
  if (timer.unref) { /* deliberately NOT unref'd: the interval IS the process */ }
  tick().catch(() => {});
}

// One heartbeat: carry the whole agent tree's file footprint, then renew.
async function beat(state, found, desired) {
  const now = Date.now();
  fold(state, now);
  const push = pendingPush(state, now);
  if (push) {
    // section 7.2 rule 3: "the parent's next heartbeat carries the union".
    // `change --change files` posts task.change AND, on the relay, makes the
    // matching claim call that updates server state (section 3.1).
    const r = await C.runCli(['change', push.subject, '--change', 'files', '--files', push.delta.join(',')],
      { cwd: found.root, timeoutMs: 8000 });
    if (r.ok) markPushed(state, push.subject_key, push.all);
  }
  const res = await C.runCli(['presence', desired], { cwd: found.root, timeoutMs: 8000 });
  if (res.ok) renewLocal(state, now);
  return res.ok;
}

// section 7.2 rule 3: children append upward into child_touches, keyed by the
// parent session id. The parent folds the union into its own claim here.
// A child appending between the read and the clear loses that one path; the
// data is advisory and progressive, so that race costs nothing that matters.
function fold(state, now) {
  const cfg = state.read();
  const buckets = (cfg.child_touches && typeof cfg.child_touches === 'object' && !Array.isArray(cfg.child_touches))
    ? cfg.child_touches : null;
  if (!buckets) return 0;
  const incoming = [];
  for (const k of Object.keys(buckets)) {
    const b = buckets[k];
    if (b && Array.isArray(b.files)) for (const f of b.files) if (!incoming.includes(f)) incoming.push(f);
  }
  if (!incoming.length) return 0;
  const mine = state.getOwnClaims(now);
  if (!mine.length) return 0;                          // nothing claimed: keep the bucket for later
  const target = mine[mine.length - 1];
  const current = Array.isArray(target.files) ? target.files : [];
  const union = [];
  for (const f of current.concat(incoming)) if (!union.includes(f)) union.push(f);
  state.addOwnClaim({
    subject: target.subject, subject_key: target.subject_key, ttl: target.ttl,
    acquired_at: target.acquired_at, files: union.slice(-MAX_FILES),   // capped union [D12]
  });
  state.update((s) => { delete s.child_touches; return s; });
  return incoming.length;
}

// Everything appended locally (by this session's PostToolUse and by folded
// child touches) that peers have not been told about yet.
function pendingPush(state, now) {
  const mine = state.getOwnClaims(now);
  if (!mine.length) return null;
  const target = mine[mine.length - 1];
  const files = Array.isArray(target.files) ? target.files : [];
  if (!files.length) return null;
  const cfg = state.read();
  const pushed = (cfg.pushed_files && cfg.pushed_files[target.subject_key]) || [];
  const delta = files.filter((f) => !pushed.includes(f));
  if (!delta.length) return null;
  return { subject: target.subject, subject_key: target.subject_key, delta: delta.slice(0, MAX_FILES), all: files };
}

function markPushed(state, key, files) {
  try {
    state.update((s) => {
      s.pushed_files = (s.pushed_files && typeof s.pushed_files === 'object') ? s.pushed_files : {};
      s.pushed_files[key] = files.slice(-MAX_FILES);
      return s;
    });
  } catch (_) { /* advisory bookkeeping */ }
}

// The relay renews server-side on the heartbeat and ntfy carries the full
// claim set in the presence body (section 9.3); either way the local
// renewed_at must move or getOwnClaims() would expire a live claim.
// addOwnClaim preserves the original acquired_at - the tiebreak input.
function renewLocal(state, now) {
  try {
    for (const c of state.getOwnClaims(now)) {
      state.addOwnClaim({
        subject: c.subject, subject_key: c.subject_key, ttl: c.ttl,
        acquired_at: c.acquired_at, files: c.files,
      });
    }
  } catch (_) { /* never fail the clock */ }
}

function quit() { try { process.exit(0); } catch (_) { /* ignore */ } }

// The host starts this file as a SCRIPT - `node "${CLAUDE_PLUGIN_ROOT}/monitors/heartbeat.js"`
// [C monitors/monitors.json] - so the clock, and the exit-0 safety net that
// belongs to a long-lived monitor, are armed on direct execution only.
// Requiring the module (test/heartbeat.test.js reaches the fold/push helpers
// that way) must neither start a monitor nor install process-wide handlers in
// its host, which would swallow that host's own failures.
if (require.main === module) {
  process.on('uncaughtException', () => quit());
  process.on('unhandledRejection', () => quit());
  main();
}

// The fold/push surface exists so the rules of PROTOCOL section 7.2 rule 3 can
// be executed by a test instead of only described in one. `beat` is exported
// for a second reason: hooks/stop.js is section 8's no-monitor fallback and
// MUST take the same beat, not a second implementation of one - a duplicate
// would drift on the fold, the push delta or the local renewal and only be
// caught in production.
module.exports = { beat, fold, pendingPush, markPushed, renewLocal, MAX_FILES, POLL_MS };
