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

// The bound on ONE CLI spawn. The monitor has no watchdog above it - it is the
// long-lived process, not a hook - so for the monitor this constant IS the
// bound. A caller that does have a wall passes `beat(..., {deadline})` and each
// spawn takes the smaller of the two.
const CLI_TIMEOUT_MS = 8000;

function main() {
  // The monitor's own start. A monitor's lifetime IS its session's lifetime
  // (section 8), so this is the only clock that tells "written during my
  // session" from "left behind by an earlier one" - see disarmedHere().
  const startedAt = Date.now();
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

  // Every id this monitor answers to. Unlike a hook it is launched as a bare
  // command with no stdin payload [C monitors/monitors.json], so it has no
  // `session_id` field to offer: the environment is its only source - which is
  // also the CLI's only source [C bin/handshake.js:135], so the two agree
  // wherever the host exports one of the three variables. Where it exports
  // none, this set is EMPTY, and disarmedHere() below is what keeps `rest`
  // working anyway.
  const mine = C.sessionIdentities(null);

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
    // mid-session disarm the monitor contract allows [S5]. THIS session's,
    // though - a bare existence check here was the worst instance of the
    // unscoped read, because this is the PRIMARY heartbeat: nothing on any
    // path removes the sentinel while a session runs, so one `rest` made every
    // future monitor in the workspace quit on its first poll, permanently.
    if (disarmedHere(disarm, mine, startedAt)) { cleanup(); return quit(); }
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

    // section 10.2: once posting has stopped on this transport FOR THE SESSION
    // it stays stopped. Spawning the CLI to be refused every minute would be a
    // rate-limit amplifier.
    //
    // "for the session" is the whole rule, and session.json names whose: the
    // file is rewritten from scratch whenever the id differs
    // [C lib/state.js:434]. Unlike the disarm above there is no time fallback
    // here, and deliberately so: this latch is an OPTIMISATION (it saves a
    // spawn that would be refused), so ignoring a latch we cannot attribute
    // costs one CLI spawn per keepalive - the transport's own sanctioned
    // cadence, not an amplification of it - and the CLI re-derives its own
    // flags on that spawn and re-latches if posting really is still refused.
    if (stateLib) {
      const s = stateLib.readJsonFile(state.files.session, null);
      if (C.ownsRecord(s, mine) && s.posting_stopped && s.posting_stopped[transport]) return;
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

// Is this disarm sentinel THIS session's? Two rules, and they COMPOSE - the
// lifetime one is a precondition on the ownership one, not a fallback for it.
//
// 1. START TIME, always. A monitor's lifetime is its session's lifetime
//    (section 8, [S5]), so a sentinel whose mtime predates this process was
//    necessarily left behind by a session that is over - whatever name is
//    stamped on it. A hook cannot make this test: it is a fresh process every
//    turn with no idea when its session began, which is why hooks/stop.js has
//    ownership and nothing else.
//
// 2. OWNERSHIP, when it can decide - the shared rule every other reader of this
//    file uses [C hooks/common.js ownsRecord]. `rest` stamps the sentinel with
//    the session that wrote it [C bin/handshake.js:1842], and another session's
//    disarm is not this session's, however recently it was written. It cannot
//    decide when the record names nobody (an older client, or a torn write) or
//    when this process has no identity at all because the host exports none of
//    the three session variables; then rule 1 stands alone.
//
// Rule 1 used to sit BEHIND rule 2, reached only when ownership had no answer,
// and that hole had the shape of the defect this whole gate exists to close:
// session ids repeat whenever HANDSHAKE_SESSION_ID is pinned rather than minted
// per session (the e2e members do exactly that [C e2e/lib/members.js:112]), so
// one `rest` plus one missed SessionEnd sweep - and SessionEnd is best-effort,
// 20 of 21 [S4] - left a sentinel bearing THIS id that every future monitor
// obeyed on its first poll, silently and forever. Requiring the sentinel to be
// younger than the process reading it costs nothing real: `rest` is typed by a
// human into a session whose monitor is already running.
//
// Rule 1 is not decoration in the other direction either. Without it, an
// env-less host would trade the permanent disarm for a `rest` that no longer
// stops the monitor at all - the user's own command silently ignored, which is
// a worse failure than the one being fixed. Alone it errs toward stopping (a
// second parent session in the same project resting would stop this monitor
// too, on such a host); stopping is visible in `status` and recoverable by
// restarting the session, and it is the direction that keeps `rest` honest.
function disarmedHere(file, mine, startedAt) {
  const mtime = C.mtimeMs(file);
  if (mtime === null) return false;                   // absent: nothing to obey
  if (mtime < startedAt) return false;                // rule 1: a session that is over
  const owner = C.recordOwner(C.readRecord(file));
  if (owner !== null && mine && mine.size) return mine.has(owner);
  return true;                                        // rule 2 cannot decide; rule 1 already did
}

// One heartbeat: fold the whole agent tree's file footprint into the claim,
// renew presence, then carry the delta to peers.
//
// ORDER. Presence is posted FIRST and the change-delta push second, and the
// order is load-bearing rather than incidental, because the two halves are not
// equally recoverable. A missed presence post is a hole in the section 8 clock
// that nothing refills: the caller's cadence marker is already stamped
// [C hooks/stop.js], so the next attempt is a whole keepalive away and peers
// watch the member go quiet meanwhile. A missed delta push costs nothing
// durable - `pushed_files` is only advanced on success, so pendingPush()
// re-derives the same delta on the very next beat [C pendingPush below]. When
// only one of the two fits, it must be the presence post.
//
// fold() still runs before BOTH: on ntfy the presence body carries the full
// claim set (section 9.3), so the folded child files belong in it.
//
// BUDGET. Two spawns at CLI_TIMEOUT_MS each is up to 16 s, and hooks/stop.js
// runs under a 9.5 s watchdog [C hooks/stop.js BUDGET_MS]. Against a transport
// that accepts a connection and never answers, that watchdog used to fire in
// the middle of the SECOND call - so the push burnt the budget and the presence
// post reached nothing, not even the offline queue, with the cadence marker
// already stamped. `opts.deadline` is an absolute wall-clock ms: each spawn
// gets the smaller of CLI_TIMEOUT_MS and what is left of it, and a spawn with
// nothing left is skipped rather than started in order to be killed. The
// monitor passes no deadline and is bounded by CLI_TIMEOUT_MS exactly as
// before.
async function beat(state, found, desired, opts) {
  const o = opts || {};
  const deadline = Number.isFinite(o.deadline) ? o.deadline : null;
  const slice = () => (deadline === null ? CLI_TIMEOUT_MS : Math.min(CLI_TIMEOUT_MS, deadline - Date.now()));

  const now = Date.now();
  fold(state, now);
  const push = pendingPush(state, now);

  const presenceMs = slice();
  if (presenceMs <= 0) return false;
  const res = await C.runCli(['presence', desired], { cwd: found.root, timeoutMs: presenceMs });
  if (res.ok) renewLocal(state, now);

  if (push) {
    // section 7.2 rule 3: "the parent's next heartbeat carries the union".
    // `change --change files` posts task.change AND, on the relay, makes the
    // matching claim call that updates server state (section 3.1).
    const changeMs = slice();
    if (changeMs > 0) {
      const r = await C.runCli(['change', push.subject, '--change', 'files', '--files', push.delta.join(',')],
        { cwd: found.root, timeoutMs: changeMs });
      if (r.ok) markPushed(state, push.subject_key, push.all);
    }
  }
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
module.exports = { beat, fold, pendingPush, markPushed, renewLocal, disarmedHere, MAX_FILES, POLL_MS, CLI_TIMEOUT_MS };
