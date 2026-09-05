'use strict';
// claude-handshake Stage 1 (V2-PLAN section 10.1): THE GIT WRITE LAYER for the
// orphan `handshake/state` branch.
//
// Normative: V2-PLAN section 10.1 (the write mechanism - temp-index plumbing,
// never HEAD; the concurrency protocol - one branch, two writers; credentials,
// signing, rejection), section 4.1 (the floor and ruling D1's three lease
// rules), section 4.2 items 2/3/4 (ruling D2's private-only default with the
// reason-branched refusal, the opt-in gate, `[skip ci]`), section 4.4 (the
// three visibility rules), section 2.5 (the wall-clock budget), section 14
// items 1, 39, 41, 46, 47, 48, 49.
//
// THE ONE SENTENCE THIS MODULE IS: it writes a commit to
// refs/heads/handshake/state without ever reading or writing `.git/index`,
// without ever moving `HEAD`, and without ever checking anything out - because
// the Claude and the human share one working tree and one `.git`, and the
// obvious implementation (`checkout --orphan` + `add` + `commit`) silently
// destroys uncommitted human work while still passing a "`git log main` is
// byte-identical" test.
//
// Every git call goes through lib/repo.js's bounded `git()` runner: argv
// straight to the process, `shell: false`, a timeout on every call, and a
// `runner` option on every function so tests can inject a fake and assert on
// the argv that was NOT emitted.

const fs = require('fs');
const path = require('path');

const repo = require('./repo');
const stateLib = require('./state');
const escape = require('./escape');
const { shardFileName, MAX_SHARD_BYTES } = require('./workspace-files');

// ------------------------------------------------------------- constants ----

const STATE_BRANCH = 'handshake/state';
const STATE_REF = 'refs/heads/handshake/state';
const REMOTE_STATE_REF = 'refs/remotes/origin/handshake/state';
const HANDSHAKE_REF_PREFIX = 'refs/heads/handshake/';

// The marker every commit this tool writes carries (section 4.2 item 4). It is
// the literal both GitHub and GitLab accept, and the message ENDS with it.
const SKIP_CI = '[skip ci]';

// section 2.5: network git gets its own constant, separate from lib/repo.js's
// GIT_TIMEOUT_MS (5,000 ms, right for `rev-parse` and wrong for `fetch`).
// It is a CEILING for off-hook callers (the monitor's clock and the CLI); every
// hook path passes a `deadline` and gets a slice of what is left instead.
//
// IT LIVES IN lib/repo.js, beside GIT_TIMEOUT_MS and HISTORY_TIMEOUT_MS, and is
// re-exported here rather than re-declared: section 10.1's Touches put "the
// network timeout of section 2.5" in that module with the other two, and two
// declarations of one bound are two numbers to keep in step.
const GIT_NETWORK_TIMEOUT_MS = repo.GIT_NETWORK_TIMEOUT_MS;

// section 2.5's per-beat split. Each is a ceiling; the deadline wins when it is
// tighter, and a step with nothing left is skipped rather than started in order
// to be killed [C monitors/heartbeat.js:196-213].
const FETCH_BUDGET_MS = 1500;
// section 2.5's commit row. It is a DESIGN TARGET for the whole local-plumbing
// step and a gate on whether there is room to start it - NOT a kill timer on
// each of the six-to-eight git processes inside it. Measured on Windows: one
// git spawn is 40-150 ms and more under load, so 500 ms per CALL kills the
// sequence mid-way (observed: `write-tree` ETIMEDOUT at commit 55 of 100 under
// a parallel test run). Each call is bounded by GIT_CALL_TIMEOUT_MS or by
// what is left of the CALLER'S deadline, whichever is smaller - the threading
// rule of section 2.5, applied where the deadline actually lives - and the step
// reports how long it really took so the run can measure this row rather than
// assert it.
const COMMIT_BUDGET_MS = 500;
const GIT_CALL_TIMEOUT_MS = 5000;   // = lib/repo.js's GIT_TIMEOUT_MS, for local calls
const PUSH_CEILING_MS = 5000;
const LSREMOTE_CEILING_MS = 2000;
const MIN_SPAWN_MS = 50;

// section 10.1 rule 4: bounded at 3 REBUILD attempts per beat, then the batch
// defers to the next beat. An attempt ceiling, not a time commitment.
const MAX_REBUILDS = 3;

// The committer. The author is the member; the committer is the tool, and the
// split is what gives the state branch's author check its meaning (section
// 10.1's read half). `.invalid` is reserved by RFC 2606, so this address can
// never collide with a real one or be mistaken for a forge account.
const TOOL_IDENTITY = Object.freeze({
  name: 'claude-handshake',
  email: 'handshake@claude-handshake.invalid',
});

// git's empty tree, and the all-zero object id that `update-ref` reads as
// "this ref must not exist". The zero form is used rather than an empty argv
// string because an empty argument is quoted differently on Windows.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const ZERO_OID = '0000000000000000000000000000000000000000';

// Files this module owns in the per-workspace state directory. Both sit beside
// the existing sentinels [C hooks/common.js:26-50] and NOT in state.json, which
// hooks read-modify-write on hot paths (section 10.1 Touches).
const OPT_IN_FILE = 'state-branch.optin.json';
const HEADS_FILE = 'state-branch.heads.json';
// The temp index is PER BUILD, not per workspace, and the suffix is what makes
// it so. See `indexPath` for the failure a single shared path produced.
const INDEX_PREFIX = 'state-branch.';
const INDEX_SUFFIX = '.index';
// The cross-process mutual exclusion for a whole batch. Two writers in ONE
// clone share a state directory, and the <= 1/min clock is not a lock (see
// `acquireBatchLock`).
const LOCK_FILE = 'state-branch.batch.lock';
// A lock older than this is a crashed holder's, not a live one's. It is the
// monitor's own per-beat ceiling [C monitors/heartbeat.js STATE_BEAT_MS], so a
// beat that ran to its bound and died still cannot wedge the next one.
const LOCK_STALE_MS = 20000;

// The outcome vocabulary. Distinct and reported, every one of them.
//   ok        a commit was made and pushed
//   unchanged nothing on the allowlist changed; no commit (the batching rule)
//   deferred  the beat ran out of time or out of rebuild attempts; retried next
//   offline   the network failed; the LOCAL commit stands and is pushed later
//   rejected  the remote said no, permanently; the deferred count does NOT grow
//   refused   a gate said no before any write (child, opt-in, visibility)
//   paused    handshake/state is checked out somewhere; nothing written at all
//   absent    no remote at all: no branch, no commit, no push - and NOT deferred
const OUTCOMES = Object.freeze({
  ok: 'ok', unchanged: 'unchanged', deferred: 'deferred', offline: 'offline',
  rejected: 'rejected', refused: 'refused', paused: 'paused', absent: 'absent',
});

// The base word behind the not-enabled value. The printed value carries the
// verb that switches the capability on, because section 4.4 rule 2 wants a next
// move on every line and not a bare verdict; the base is what section 4.4
// rule 1's list enumerates, and `pushWord` strips back to it.
const NOT_ENABLED_WORD = 'off — not enabled';

// section 4.4 rule 1: the closed `push:` vocabulary, owned per stage.
// THIRTEEN VALUES, TEN OF THEM STAGE 1'S. The plan's own list is the authority
// (section 4.4 rule 1, amended at this build on 2026-09-05); the arrays below
// are what the code counts, and the two must never disagree.
const PUSH_STATES = Object.freeze({
  pushing: 'pushing',
  gh_unauthenticated: 'off — gh unauthenticated',
  visibility_unproven: 'off — visibility unproven',
  forge_rejected: 'rejected — forge ruleset: ',   // + the forge's own line
  deferred: 'deferred (no time in the beat)',
  offline: 'offline',
  no_remote: 'off — no remote',
  // ADMITTED BY THE OWNER ON 2026-09-05, with the two below it. A human checks
  // `handshake/state` out, `moveRef`'s guard refuses to move a ref out from
  // under their working tree, and nothing is written. None of the other words
  // is true of that state and going silent is exactly what rule 1 exists to
  // forbid, so it gets its own.
  paused_checked_out: 'paused — handshake/state is checked out',
  // THE NOT-YET-ENABLED STATE. Rule 1 says the `push:` line is ALWAYS
  // populated; before the opt-in an earlier build printed no line at all and
  // argued the capability was rule 3's business instead. The owner's ruling of
  // 2026-09-05 is that rule 1 means what it says and the state gets a word, so
  // both surfaces carry one field in every state of the world. The verb rides
  // in the value because rule 2 wants the next move on the same line.
  not_enabled: NOT_ENABLED_WORD + ' (handshake pair --state-branch)',
  // Stage 2's three, named here only so nothing invents prose for them later.
  secret_scan: 'refused — secret scan, ',
  no_lease: 'no recorded lease',
  paused_head: 'paused — remote head is not the one this tool pushed',
  // THE SECOND DEFERRAL. Section 14 item 49 added "(no time in the beat)" to
  // `deferred` so a climbing deferred count says which cause it is - and that
  // parenthesis is a LIE on the one other deferral Stage 1 can reach: a
  // non-fast-forward that exhausts rule 4's three rebuild attempts had all the
  // time in the world and ran out of ATTEMPTS. Rule 4 is an attempt ceiling,
  // not a time bound, so the words have to be different or one of them is false.
  deferred_attempts: 'deferred (rebuild attempts exhausted)',
});

// THE TEN STAGE 1 OWNS. Section 4.4 rule 1 and section 14 item 48 enumerated
// seven; the owner admitted three more at this build on 2026-09-05 - the
// checked-out pause, the attempts-exhausted deferral and the not-yet-enabled
// state, each because a paused, deferred or off write has to leave a line that
// is TRUE - and closed the set there. The count below is a pinned number and
// not a length that grows with the file: an eleventh word needs a ruling, not
// a commit.
const STAGE1_PUSH_STATES = Object.freeze([
  PUSH_STATES.pushing, PUSH_STATES.gh_unauthenticated, PUSH_STATES.visibility_unproven,
  PUSH_STATES.forge_rejected, PUSH_STATES.deferred, PUSH_STATES.deferred_attempts,
  PUSH_STATES.offline, PUSH_STATES.no_remote, PUSH_STATES.paused_checked_out,
  PUSH_STATES.not_enabled,
]);

// THE ONE VALUE STAGE 1 REACHES THAT IT DOES NOT OWN, kept in its own array so
// the code and the plan never count differently.
//
//   `refused — secret scan, <file>`
//       The plan assigns this word to Stage 2 because the full SCANNER is
//       Stage 2's. Section 4.2 item 1 is a REQUIRED and ungated guardrail,
//       though - "every automated commit, on either branch, is scanned before
//       it is created" - and Stage 1 is the stage that removes the human commit
//       which used to stand between a shard and the remote. So Stage 1 runs
//       `lib/filter.js`'s `check()` per record before every automated commit
//       (see `scanCommitBytes`, and the owner's ruling of 2026-09-05) and
//       therefore reaches this word early. The WORD is unchanged and the closed
//       set does not grow: only the stage that first prints it does.
const STAGE1_PROPOSED_PUSH_STATES = Object.freeze([
  PUSH_STATES.secret_scan,
]);

// Every value Stage 1 can actually print. `STAGE1_PUSH_STATES` is what the plan
// ratified; this is what the build emits, and the difference between the two
// arrays is the ratification ask above.
const STAGE1_REACHABLE_PUSH_STATES = Object.freeze(
  STAGE1_PUSH_STATES.concat(STAGE1_PROPOSED_PUSH_STATES),
);

// The closed-set VALUE behind a printed one. Three of the thirteen carry
// appended text rather than being whole words - the forge's own rejection line,
// the scanned file's name and the not-enabled verb - and this strips those, so
// a membership test can be an equality test against section 4.4 rule 1's own
// list. The two `deferred` values are NOT collapsed: rule 1 counts them
// separately, because they name different causes.
function pushWord(value) {
  const v = String(value === null || value === undefined ? '' : value);
  if (!v) return null;
  if (v.startsWith(PUSH_STATES.forge_rejected)) return 'rejected — forge ruleset';
  if (v.startsWith(PUSH_STATES.secret_scan)) return 'refused — secret scan';
  if (v.startsWith(NOT_ENABLED_WORD)) return NOT_ENABLED_WORD;
  return v;
}

// The older spelling of the checked-out word, kept because two call sites and
// two tests reach for it. It resolves to the SAME string, never to a second one.
const EXTRA_PUSH_STATES = Object.freeze({
  paused_checked_out: PUSH_STATES.paused_checked_out,
});

// ------------------------------------------------------------- utilities ----

function nowMs(now) { return Number.isInteger(now) ? now : Date.now(); }

// A step's real bound: the smaller of its own ceiling and what is left of the
// caller's absolute deadline. `null` means "nothing left - skip this step".
function slice(deadline, ceiling, now) {
  if (deadline === null || deadline === undefined || !Number.isFinite(Number(deadline))) return ceiling;
  const left = Number(deadline) - nowMs(now);
  if (left < MIN_SPAWN_MS) return null;
  return Math.max(MIN_SPAWN_MS, Math.min(ceiling, Math.floor(left)));
}

// Remote-authored and forge-authored text reaches `status`, so it is escaped on
// the way in, never on the way out (escape-on-read, SECURITY.md 5.4).
function safeLine(text, max) {
  return escape.escapeText(text, { singleLine: true, max: Number.isInteger(max) ? max : 240 });
}

// Git paths are always `/`-separated, on every platform. The allowlist is
// built in that shape and only ever converted on the way to `fs`, so a
// backslash can never reach an argv git reads as a path.
function fromPosix(root, rel) { return path.join(root, ...String(rel).split('/')); }

function fileExists(p) { try { fs.statSync(p); return true; } catch (_) { return false; } }

// -------------------------------------------------------- the allowlist -----

// section 14 item 1: `handshake/state` carries an ENUMERATED path allowlist -
// `.handshake/tasks/<shardFileName(self)>` only, DERIVED and never accepted.
// This function takes a member id and nothing else; there is no parameter a
// caller could use to widen it, which is the traversal-closed-by-construction
// posture the plan cites four times [C lib/workspace-files.js:292-298].
function allowlistFor(member) {
  return Object.freeze(['.handshake/tasks/' + shardFileName(member)]);
}

// A member id is peer-authored free text and here it becomes a REF segment.
// Stage 2 owns the full ref-name rule (section 14 item 2) including
// `git check-ref-format`; this is the conservative subset Stage 1's lease guard
// needs, and it spawns no process - the refusal in `leasePush` must reach its
// verdict with no git process spawned at all.
function memberRefSegment(member) {
  const id = escape.escapeMemberId(member);
  let safe = String(id).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '').replace(/[.-]+$/, '').slice(0, 64);
  safe = safe.replace(/\.lock$/i, '');                 // git refuses a ref ending `.lock`
  safe = safe.replace(/\.{2,}/g, '.');                 // git refuses `..`
  safe = safe.replace(/^[.-]+/, '').replace(/[.-]+$/, '');
  if (!safe) safe = 'member';
  if (safe.toLowerCase() === 'state') safe = 'state-member';  // reserved: a DIRECT collision
  return safe;
}

function ownRef(member) { return HANDSHAKE_REF_PREFIX + memberRefSegment(member); }

// The member id becomes a git IDENT, which has its own disallowed set. Git
// strips `<`, `>` and newlines from an author name itself - verified on 2.53,
// `GIT_AUTHOR_NAME='bad <inject>'` is stored as `bad inject` - so the ident
// cannot be forged through it. The reason to do it here anyway is the case git
// does NOT survive: a name that strips to nothing is `fatal: empty ident name`,
// which would wedge that member's batches forever.
function authorNameFor(member) {
  const stripped = String(escape.escapeMemberId(member))
    .replace(/[<>\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 64).trim();
  return stripped || memberRefSegment(member);
}

// ------------------------------------------------------------- git calls ----

// Every call in this module goes through here, so there is exactly one place
// that decides the timeout, the env and the runner. `net: true` marks a call
// that talks to a remote: it carries GIT_TERMINAL_PROMPT=0 EXPLICITLY in the
// options the runner sees, so a credential helper that would prompt fails
// instead of hanging AND a test can assert the property on the argv rather than
// trusting `defaultRunner`'s own env [C lib/repo.js:67].
function run(root, args, opts) {
  const o = opts || {};
  // `null` is what `slice()` returns when the caller's deadline is spent, and
  // it MUST NOT reach `repo.git()`: that function reads `o.timeout || 5000`, so
  // a null there silently becomes a fresh five-second bound - the exact
  // opposite of "a spawn with nothing left is skipped rather than started in
  // order to be killed" [C monitors/heartbeat.js:196-213]. Nothing is spawned.
  if (o.timeout === null) {
    return { ok: false, code: null, stdout: '', stderr: '', error: 'no_time', timedOut: false, skipped: true };
  }
  const env = Object.assign({}, o.env || null);
  if (o.net) env.GIT_TERMINAL_PROMPT = '0';
  if (o.indexFile) env.GIT_INDEX_FILE = o.indexFile;
  const r = repo.git(root, args, {
    runner: o.runner,
    timeout: o.timeout,
    env: Object.keys(env).length ? env : undefined,
    // Content on a pipe, for the one call that hashes bytes instead of a path.
    input: typeof o.input === 'string' ? o.input : undefined,
  });
  return r;
}

// A defensive gate on every argv this module hands to a remote. Bare `--force`
// and `-f` are above the floor on EVERY ref without exception (section 4.1);
// the one permitted rewrite is `--force-with-lease=<ref>:<sha>` on
// refs/heads/handshake/<self>. This is belt and braces on top of the fact that
// nothing below constructs those flags: a future edit that does trips here
// rather than on a human's branch.
//
// IT IS AN ALLOWLIST OF FLAG SHAPES, NOT A DENYLIST OF FOUR STRINGS. As a
// denylist it had the holes that matter, every one of them measured against
// this function: `+refs/heads/main:refs/heads/main` (a forcing refspec spelled
// the long way, exempted by the very rule that exists to catch it),
// `--mirror` (which DELETES every remote ref not present locally),
// `--delete` (section 4.1: the tool never deletes a branch),
// `--receive-pack=<anything>` and `--force-if-includes` all passed. So the
// destructive and program-naming flags are refused by SHAPE, the plus-prefixed
// refspec is permitted only on a `fetch` whose destination is a
// remote-tracking ref, and `--force-with-lease` is permitted only in its
// valued `<ref>:<40 hex>` form.
const FORCE_FLAG_RE = /^(?:--force|-f|--force-if-includes|--force-with-lease)$/;
const FORBIDDEN_FLAG_RE = /^(?:--force|-f|--mirror|--delete|-d|--prune|--prune-tags|--force-if-includes|--force-with-lease|--all|--tags|--follow-tags)$/;
const FORBIDDEN_ASSIGN_RE = /^--(?:receive-pack|upload-pack|exec)=/;
const LEASE_RE = /^--force-with-lease=[^\s:]+:[0-9a-f]{40}$/;

function assertNoBareForce(args) {
  const refuse = (why, s) => {
    const e = new Error('handshake: refused to emit ' + why + ' (' + s + ')');
    e.code = 'bare_force_refused';
    throw e;
  };
  const verb = String(args[0] || '');
  for (const a of args) {
    const s = String(a);
    if (s === '+') refuse('a bare force push', s);
    if (FORBIDDEN_FLAG_RE.test(s)) {
      refuse(FORCE_FLAG_RE.test(s) ? 'a bare force push' : 'a bare force push or a destructive git flag', s);
    }
    if (FORBIDDEN_ASSIGN_RE.test(s)) refuse('a program-naming git option', s);
    if (/^--force-with-lease=/.test(s) && !LEASE_RE.test(s)) {
      refuse('a bare force push wearing a lease that is not <ref>:<40 hex>', s);
    }
    if (/^\+/.test(s)) {
      // A `+src:dst` refspec is a force push wearing a plus sign - EXCEPT on a
      // fetch into a remote-tracking ref, which is the ordinary fetch form and
      // is the only shape this module builds one for.
      const dst = s.split(':')[1] || '';
      if (verb !== 'fetch' || !/^refs\/remotes\//.test(dst)) {
        refuse('a forcing refspec', s);
      }
    }
  }
  return args;
}

function gitVersion(root, opts) {
  const o = opts || {};
  const r = run(root, ['--version'], { runner: o.runner, timeout: o.timeout || 5000 });
  if (!r.ok) return { ok: false, version: null, raw: null };
  const raw = String(r.stdout || '').trim();
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(raw);
  return {
    ok: true,
    raw: safeLine(raw, 80),
    version: m ? m[0] : null,
    major: m ? Number(m[1]) : null,
    minor: m ? Number(m[2]) : null,
  };
}

// `git config --bool --get commit.gpgsign`. Reported, never acted on: the
// plumbing path passes `-c commit.gpgsign=false` on commit-tree so it can never
// sign, and the preflight is where the human is told.
function gpgSignConfig(root, opts) {
  const o = opts || {};
  const r = run(root, ['config', '--bool', '--get', 'commit.gpgsign'], { runner: o.runner, timeout: o.timeout });
  if (!r.ok) return { set: false, on: false };
  const v = String(r.stdout || '').trim();
  return { set: v.length > 0, on: v === 'true' };
}

function coreFileMode(root, opts) {
  const o = opts || {};
  const r = run(root, ['config', '--bool', '--get', 'core.filemode'], { runner: o.runner, timeout: o.timeout });
  if (!r.ok) return false;
  return String(r.stdout || '').trim() === 'true';
}

function revParse(root, rev, opts) {
  const o = opts || {};
  const r = run(root, ['rev-parse', '--verify', '-q', rev], { runner: o.runner, timeout: o.timeout });
  if (!r.ok) return null;
  const sha = String(r.stdout || '').trim().split(/\s+/)[0];
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

// The default branch, for rule 1's SECOND refspec. Local and bounded; the
// caller may pass `defaultBranch` and skip it entirely.
function defaultBranchName(root, opts) {
  const o = opts || {};
  const sym = run(root, ['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD'], { runner: o.runner, timeout: o.timeout });
  if (sym.ok) {
    const v = String(sym.stdout || '').trim().replace(/^origin\//, '');
    if (v) return v;
  }
  const head = run(root, ['symbolic-ref', '--short', '-q', 'HEAD'], { runner: o.runner, timeout: o.timeout });
  if (head.ok) {
    const v = String(head.stdout || '').trim();
    if (v) return v;
  }
  const cfg = run(root, ['config', '--get', 'init.defaultBranch'], { runner: o.runner, timeout: o.timeout });
  if (cfg.ok) {
    const v = String(cfg.stdout || '').trim();
    if (v) return v;
  }
  return 'main';
}

// ------------------------------------------------- the checked-out guard ----

// section 10.1 / the task's rule 5: before ANY update-ref of a handshake/* ref,
// ask whether a worktree has it checked out. `update-ref` on a checked-out
// branch moves the human's HEAD out from under their index and working tree,
// which is exactly the loss this module exists to make impossible.
function checkedOut(root, ref, opts) {
  const o = opts || {};
  const out = { checked_out: false, head: null, by: [], ok: true };

  const sym = run(root, ['symbolic-ref', '-q', 'HEAD'], { runner: o.runner, timeout: o.timeout });
  out.head = sym.ok ? String(sym.stdout || '').trim() || null : null;
  if (out.head === ref) {
    out.checked_out = true;
    out.by.push({ worktree: root, branch: ref });
  }

  const wt = run(root, ['worktree', 'list', '--porcelain'], { runner: o.runner, timeout: o.timeout });
  if (!wt.ok) {
    // Unknown is not clean. An older git without `worktree list --porcelain`
    // still answers the symbolic-ref question above, which covers the main
    // tree; we report the read failure rather than claiming a clean verdict.
    out.ok = false;
    return out;
  }
  let cur = null;
  for (const raw of String(wt.stdout || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('worktree ')) { cur = line.slice(9).trim(); continue; }
    if (line.startsWith('branch ')) {
      const b = line.slice(7).trim();
      if (b === ref) {
        out.checked_out = true;
        if (!out.by.some((e) => e.worktree === cur)) out.by.push({ worktree: cur, branch: b });
      }
    }
  }
  return out;
}

// ------------------------------------------ the state-dir records (JSON) ----

function optInPath(state) { return path.join(state.dir, OPT_IN_FILE); }
function headsPath(state) { return path.join(state.dir, HEADS_FILE); }
function lockPath(state) { return path.join(state.dir, LOCK_FILE); }

// THE TEMP INDEX IS PER BUILD, AND THE REASON IS A MEASURED DATA-LOSS BUG.
//
// It used to be one fixed path per state directory, unlinked at the TOP of each
// build ("a fresh index every time"). Two writers in one clone share that
// directory - the monitor, SessionEnd and SessionStart's late flush all reach
// `runBeat`, the <= 1/min clock is read before eight git spawns and written
// after, and both hook flushes pass `force: true`, which bypasses it entirely.
// Measured, with three concurrent processes against one clone and one bare
// remote seeded with a peer's shard: the remote tip lost the peer's file, 12 of
// 16 commits in the chain were missing it, and the deterministic reproduction
// is one line long - unlink the shared index at the moment another build's
// `update-index --add` is about to run and its `write-tree` emits a tree
// holding only its OWN path. The push is then a clean fast-forward, nothing
// rejects it, the CAS in `moveRef` passes, and the beat reports `ok`.
//
// A unique path per build removes the shared mutable file; `acquireBatchLock`
// removes the concurrency; and the tree post-condition in `buildStateCommit`
// refuses the commit if a path outside this member's allowlist changed anyway.
// Three layers, because the failure is silent and the blast radius is the
// flagship scenario of section 11.2.
let indexSeq = 0;
function indexPath(state, token) {
  const tag = token === undefined || token === null
    ? String(process.pid) + '.' + (++indexSeq)
    : String(token).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 64);
  return path.join(state.dir, INDEX_PREFIX + tag + INDEX_SUFFIX);
}

// One batch at a time per state directory, across processes, with `wx` -
// `O_CREAT | O_EXCL`, which is atomic on both platforms this ships to.
//
// The <= 1/min clock is NOT mutual exclusion and never was: `stateBatch` reads
// it before roughly eight git spawns and writes it after, and SessionEnd and
// SessionStart's late flush both pass `force: true`, which skips it. This is
// the control.
function acquireBatchLock(state, opts) {
  const o = opts || {};
  const file = lockPath(state);
  const body = JSON.stringify({ pid: process.pid, at: nowMs(o.now), where: o.where || null }) + '\n';
  state.ensure();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      try { fs.writeSync(fd, body); } finally { fs.closeSync(fd); }
      return {
        held: true,
        release() { try { fs.unlinkSync(file); } catch (_) { /* already gone */ } },
      };
    } catch (e) {
      if (!e || e.code !== 'EEXIST') return { held: false, reason: 'lock_unwritable', release() {} };
      // A holder that died leaves its file behind, so staleness is checked by
      // mtime and the stale one is removed ONCE before a second attempt. Two
      // racers both reaching this arm is fine: `wx` lets exactly one win.
      let st = null;
      try { st = fs.statSync(file); } catch (_) { continue; }
      if (nowMs(o.now) - st.mtimeMs < (Number.isInteger(o.staleMs) ? o.staleMs : LOCK_STALE_MS)) {
        return { held: false, reason: 'locked', release() {} };
      }
      try { fs.unlinkSync(file); } catch (_) { /* somebody else cleared it */ }
    }
  }
  return { held: false, reason: 'locked', release() {} };
}

// The opt-in marker (section 4.2 item 3, the `handshake pair --state-branch`
// gate). Fail closed: absent, unparseable or `enabled !== true` all mean OFF.
// The integrator writes it from the CLI; the shape is defined here so the two
// halves cannot drift.
//
//   { v: 1, enabled: true, at: <ms>, verb: 'handshake pair --state-branch',
//     visibility: {
//       verdict: 'private' | 'public' | 'unprovable',
//       reason: <lib/repo.js REASONS key at grant time>,
//       checked_at: <ms>,
//       override: <bool>,             // the typed public-repo override (D2)
//       unprovable_confirmed: <bool>  // the no_github_remote / no_remote arm
//     } }
function readOptIn(state) {
  const raw = stateLib.readJsonFile(optInPath(state), null);
  const vis = raw && typeof raw.visibility === 'object' && raw.visibility ? raw.visibility : {};
  return {
    enabled: Boolean(raw && raw.enabled === true),
    at: raw && Number.isFinite(Number(raw.at)) ? Number(raw.at) : null,
    verb: (raw && typeof raw.verb === 'string' && raw.verb) || 'handshake pair --state-branch',
    visibility: {
      verdict: typeof vis.verdict === 'string' ? vis.verdict : null,
      reason: typeof vis.reason === 'string' ? vis.reason : null,
      checked_at: Number.isFinite(Number(vis.checked_at)) ? Number(vis.checked_at) : null,
      override: vis.override === true,
      unprovable_confirmed: vis.unprovable_confirmed === true,
    },
    present: Boolean(raw),
  };
}

function writeOptIn(state, record) {
  const r = record || {};
  const vis = r.visibility || {};
  const doc = {
    v: 1,
    enabled: r.enabled === true,
    at: Number.isFinite(Number(r.at)) ? Number(r.at) : Date.now(),
    verb: 'handshake pair --state-branch',
    visibility: {
      verdict: typeof vis.verdict === 'string' ? vis.verdict : null,
      reason: typeof vis.reason === 'string' ? vis.reason : null,
      checked_at: Number.isFinite(Number(vis.checked_at)) ? Number(vis.checked_at) : Date.now(),
      override: vis.override === true,
      unprovable_confirmed: vis.unprovable_confirmed === true,
    },
  };
  state.ensure();
  stateLib.writeJsonFile(optInPath(state), doc);
  return doc;
}

function clearOptIn(state) {
  try { fs.unlinkSync(optInPath(state)); return true; } catch (_) { return false; }
}

// The recorded heads (ruling D1 rule 1: the lease value is the tool's OWN
// recorded head, never the remote-tracking ref and never read back from the
// remote), plus the deferred counters section 4.4 rule 1's `push:` line needs.
function readHeads(state) {
  const raw = stateLib.readJsonFile(headsPath(state), null);
  const refs = raw && typeof raw.refs === 'object' && raw.refs ? raw.refs : {};
  const deferred = raw && typeof raw.deferred === 'object' && raw.deferred ? raw.deferred : {};
  return {
    v: 1,
    refs,
    deferred: {
      count: Number.isInteger(deferred.count) ? deferred.count : 0,
      since: Number.isFinite(Number(deferred.since)) ? Number(deferred.since) : null,
      reason: typeof deferred.reason === 'string' ? deferred.reason : null,
      at: Number.isFinite(Number(deferred.at)) ? Number(deferred.at) : null,
    },
    git_version: raw && typeof raw.git_version === 'string' ? raw.git_version : null,
    last_push_at: raw && Number.isFinite(Number(raw.last_push_at)) ? Number(raw.last_push_at) : null,
    preflight: raw && typeof raw.preflight === 'object' ? raw.preflight : null,
  };
}

function writeHeads(state, doc) {
  state.ensure();
  stateLib.writeJsonFile(headsPath(state), doc);
  return doc;
}

// Written in the SAME critical section as the push that moved it (D1 rule 1:
// "a create is followed by a lease that works rather than by ten more minutes
// of stale info").
function recordHead(state, ref, sha, opts) {
  const o = opts || {};
  const doc = readHeads(state);
  doc.refs[ref] = { sha: String(sha), at: nowMs(o.now) };
  doc.last_push_at = nowMs(o.now);
  doc.deferred = { count: 0, since: null, reason: null, at: null };
  return writeHeads(state, doc);
}

function recordedHead(state, ref) {
  const doc = readHeads(state);
  const rec = doc.refs[ref];
  if (!rec || typeof rec.sha !== 'string' || !/^[0-9a-f]{40}$/.test(rec.sha)) return null;
  return rec.sha;
}

function bumpDeferred(state, reason, opts) {
  const o = opts || {};
  const doc = readHeads(state);
  doc.deferred = {
    count: doc.deferred.count + 1,
    since: doc.deferred.since || nowMs(o.now),
    reason: String(reason || 'deferred'),
    at: nowMs(o.now),
  };
  writeHeads(state, doc);
  return doc.deferred;
}

function deferredCount(state) { return readHeads(state).deferred.count; }

// ----------------------------------------------------------- the gate ------

// section 4.2 item 2 / section 14 item 46: the refusal branches on the reason.
// Three arms plus one for the reasons that are neither installable nor
// permanent, and ONLY the `affirmative_public` arm prints the world-readable
// sentence, because only there is it true.
const WORLD_READABLE =
  'task subjects, file paths, declared symbols, learnings, coordination outcomes and in-progress code ' +
  'would become world-readable';

function visibilityArm(verdict, optIn, remoteUrl) {
  const reason = (verdict && verdict.reason) || 'unknown';
  if (verdict && verdict.private === true) return { arm: 'private', allowed: true };

  if (reason === 'gh_missing' || reason === 'gh_unauthenticated') {
    return {
      arm: 'gh',
      allowed: false,
      push: PUSH_STATES.gh_unauthenticated,
      message: 'handshake: the automated push path is off — install the GitHub CLI and run `gh auth login`; ' +
        "this repository's visibility cannot be read until then.",
    };
  }
  if (reason === 'no_github_remote' || reason === 'no_remote') {
    if (optIn.visibility.unprovable_confirmed) return { arm: 'unprovable', allowed: true, recorded: 'unprovable' };
    return {
      arm: 'unprovable',
      allowed: false,
      push: PUSH_STATES.visibility_unproven,
      message: 'handshake: the automated push path is off — visibility cannot be proved for a non-github.com remote; ' +
        'confirm yourself that `' + safeLine(remoteUrl || 'origin', 120) + '` is private with ' +
        '`handshake pair --state-branch`, which records the answer as `unprovable` and not as an override.',
    };
  }
  if (reason === 'affirmative_public') {
    if (optIn.visibility.override === true) return { arm: 'public', allowed: true, recorded: 'public, overridden' };
    return {
      arm: 'public',
      allowed: false,
      push: PUSH_STATES.visibility_unproven,
      message: 'handshake: the automated push path is off — this repository is PUBLIC, so ' + WORLD_READABLE +
        '. Re-run `handshake pair --state-branch` and type the second confirmation to publish anyway; ' +
        'the override is recorded on the `status` line.',
    };
  }
  // gh_error / gh_timeout / ambiguous / stale_affirmative / not_a_repo: readable
  // states that clear themselves, so no override is offered for them.
  return {
    arm: 'unreadable',
    allowed: false,
    push: PUSH_STATES.visibility_unproven,
    message: 'handshake: the automated push path is off — visibility unproven (' +
      safeLine((verdict && verdict.explanation) || reason, 120) + '). Run ' +
      '`gh repo view --json isPrivate` yourself and re-run `handshake pair --state-branch`.',
  };
}

function refusal(fields) {
  return Object.assign({
    ok: false, outcome: OUTCOMES.refused, reason: null, push: null, message: null,
    detail: null, commit: null, ref: STATE_REF, branch: STATE_BRANCH, attempts: 0,
    deferred_count: null, spawned: false,
  }, fields);
}

// 1. A proven child never writes to a remote (PROTOCOL 7.2 rule 1). Its own
//    function, and called before ANYTHING else, because it must reach its
//    verdict without spawning a single process - a subagent that shells out to
//    `git rev-parse` to be told it may not write has already paid for the write.
function childRefusal(opts) {
  const o = opts || {};
  const child = o.child === true || (o.childVerdict && o.childVerdict.child === true);
  if (!child) return null;
  return refusal({
    reason: 'child_session',
    push: null,
    message: 'handshake: a subagent session creates and pushes nothing (PROTOCOL 7.2 rule 1). ' +
      'The parent session commits this batch on its next beat — run `handshake status` there to see it.',
  });
}

// The refusal arms, as plain return values the CLI can print. `null` means the
// path is open. Nothing here spawns git except `detectRepo` and the visibility
// guard, both of which the caller may supply pre-computed.
function gate(opts) {
  const o = opts || {};
  const state = o.state;

  const child = childRefusal(o);
  if (child) return child;

  // 2. The repo itself.
  const detected = o.repo || repo.detectRepo(o.cwd || o.root || process.cwd(), { runner: o.runner, timeout: o.timeout });
  if (!detected || !detected.ok) {
    return refusal({
      reason: 'not_a_repo',
      push: null,
      message: 'handshake: not inside a git working tree, so there is no state branch to write. ' +
        'Run `handshake status` from inside the project.',
      repo: detected || null,
    });
  }

  // 3. No remote: today's behaviour, said plainly. NOT deferred, and the
  //    deferred count stays zero (section 4.1).
  if (detected.reason === 'no_remote') {
    return refusal({
      outcome: OUTCOMES.absent,
      reason: 'no_remote',
      push: PUSH_STATES.no_remote,
      message: 'handshake: this working tree has no git remote, so there is no state branch — no commit and ' +
        'no push is attempted. The shard is written and rides your next commit. ' +
        'Add a remote with `git remote add origin <url>` to enable it.',
      repo: detected,
      deferred_count: 0,
    });
  }

  // 4. The opt-in gate. Checked before the visibility probe, because the probe
  //    costs a `gh` process and a workspace that never opted in must not pay it.
  const optIn = readOptIn(state);
  if (!optIn.enabled) {
    return refusal({
      reason: 'not_opted_in',
      // Rule 1's field is populated here too, and with the word that is true:
      // the capability is off and the value names the verb that turns it on.
      push: PUSH_STATES.not_enabled,
      message: 'handshake: the state branch is off — nobody has opted in on this machine. ' +
        'Run `handshake pair --state-branch` to see what it publishes and enable it.',
      repo: detected,
      opt_in: optIn,
    });
  }

  // 5. Ruling D2: automated push is private-repo-only. The verdict comes from
  //    lib/repo.js's guard, which is fail closed and cached on a 600 s TTL -
  //    it is REUSED here, never re-implemented.
  const verdict = o.verdict || (o.cachedOnly
    ? repo.cachedVerdict(state, { now: o.now })
    : repo.guard({ state, cwd: detected.root, repo: detected, runner: o.runner, now: o.now }));
  const arm = visibilityArm(verdict, optIn, detected.remote);
  if (!arm.allowed) {
    return refusal({
      reason: 'visibility_' + arm.arm,
      push: arm.push,
      message: arm.message,
      repo: detected,
      verdict: verdict || null,
      opt_in: optIn,
    });
  }

  return null;
}

// -------------------------------------- section 4.2 item 1: the commit gate --
//
// THE FAIL-CLOSED HALF OF THE COMMIT SCANNER, SHIPPED IN STAGE 1 BECAUSE
// STAGE 1 IS THE STAGE THAT REMOVES THE HUMAN COMMIT.
//
// Section 4.2 item 1 is a REQUIRED, ungated guardrail - "each is a gate on the
// automatic path, not a note", "every automated commit, on either branch, is
// scanned before it is created, and a finding REFUSES the commit". The plan
// puts the full scanner in Stage 2 (`lib/commit-scan.js`, with the needle
// filter and the false-positive work section 12.2 prices). What Stage 1 does
// is delete the human commit that used to stand between `.handshake/tasks/
// <me>.md` and the remote: measured before this fix, an AWS key pasted into
// that file by a human - or written there by the model - was on the remote
// inside 60 seconds with outcome `ok`, no scan, no refusal and no line.
//
// THE SCANNER IS `lib/filter.js`'s `check()` AND NOT A SECOND BATTERY BESIDE
// IT (the owner's ruling of 2026-09-05). An earlier build assembled its own
// subset of `filter.PATTERNS` here to dodge the false positives section 12.2
// prices, which is a second spelling of the one control this product has for
// "may these bytes leave the machine" - and a second spelling drifts.
//
// `check()` IS APPLIED PER RECORD, and that is the ruling's other half as well
// as the only way the function can be used at all: it refuses any text past
// `MAX_BYTES` (2 KB, the envelope body cap) with a `size-cap` finding, and a
// shard is append-only and outgrows that on day one. A record is bounded text,
// and it is exactly the unit the WRITE side already puts through this same
// function - `appendShardRecord` gates every field through `sendGate`
// [C lib/outbound.js sendGate] [C bin/handshake.js writeShard]. So a record the
// tool itself wrote has ALREADY passed this battery, which is why using the
// identical battery here adds no new false-positive class to the tool's own
// path. What it newly catches is precisely what Stage 1 newly publishes with no
// human in the way: bytes a person pasted, or the model wrote, straight into
// `.handshake/tasks/<me>.md`.
//
// The tripwire's needle corpus is hoisted once per scan through
// `opts.secretFiles` (section 14 item 39) so a beat does not walk the project
// every minute; `check()` takes the same option and uses the same corpus.
//
// Fail-closed on its own failure, the posture lib/filter.js already takes: any
// internal error, and any unit this splitter could not reach, is a finding
// rather than a pass.

// WHAT IS SCANNED IS WHAT THIS COMMIT PUBLISHES, AND NOTHING ELSE.
//
// The first build of this gate scanned the whole shard on every beat and gave
// up past a UNIT CEILING, reporting `scan-truncated` as a finding - which meant
// a perfectly ordinary shard, once it held more records than the ceiling,
// REFUSED every batch from then on. A ceiling a normal file reaches is not a
// guardrail, it is an off switch with a delay on it (the owner's ruling of
// 2026-09-05).
//
// So the unit is the DIFF: the lines this commit adds to the parent tree's copy
// of the shard, split at record boundaries and scanned per record. A shard is
// append-only in normal use, so a beat scans the one or two records the session
// just wrote; the bytes already on the branch were scanned when they were
// published and are not re-scanned. The first commit of a shard has no parent
// blob, so all of it is added and all of it is scanned - correctly, because all
// of it is what that commit publishes.
//
// AND THE BOUND IS TIME, NOT COUNT, BECAUSE THE TWO FAIL DIFFERENTLY. A count
// bound that trips has to choose between refusing (a false accusation) and
// passing (a scanner that fails open). A time bound that trips says the beat
// ran out of milliseconds, which is a DEFERRAL - the batch stays on disk, the
// deferred count grows, and the next beat scans the same bytes again. A shard
// is refused only on an actual finding.
const SCAN_BUDGET_MS = 750;
// A unit past `check()`'s cap is WINDOWED and never skipped: skipping is how a
// scanner fails open. The overlap is what keeps a value that straddles a window
// boundary whole inside one of them - the longest shape in the battery is a
// PEM body, and 256 bytes covers every keyed pattern in it.
const SCAN_WINDOW_OVERLAP = 256;

function filterMaxBytes() {
  try {
    const n = require('./filter').MAX_BYTES;
    return Number.isInteger(n) && n > 0 ? n : 2048;
  } catch (_) { return 2048; }
}

// Returns { units }. Never throws. There is no count ceiling: every byte handed
// to this function reaches a unit, and the caller's TIME bound is what stops a
// pathological input. A splitter that silently dropped the tail would be a
// scanner that fails open, and one that reported the drop as a finding would
// refuse an honest shard - which is exactly what the old ceiling did.
function scanUnits(text) {
  const s = typeof text === 'string' ? text : String(text === null || text === undefined ? '' : text);
  if (!s) return { units: [] };
  // `\r?$` because a shard checked out on Windows with `core.autocrlf=true`
  // has CRLF line endings: without it every header misses, the whole text
  // becomes one unit and the split degrades to blind 2 KB windows. It still
  // SCANS (nothing fails open), it just stops lining up with the records.
  const re = /^##[ \t]+\S+[ \t]+\S+[ \t]*\r?$/gm;
  const starts = [];
  let m;
  while ((m = re.exec(s)) !== null) {
    starts.push(m.index);
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  const records = [];
  if (!starts.length) {
    records.push(s);
  } else {
    if (starts[0] > 0) records.push(s.slice(0, starts[0]));
    for (let i = 0; i < starts.length; i++) {
      records.push(s.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : s.length));
    }
  }
  const max = filterMaxBytes();
  const units = [];
  for (const u of records) {
    if (Buffer.byteLength(u, 'utf8') <= max) { units.push(u); continue; }
    let i = 0;
    while (i < u.length) {
      // Shrink by halves until the window fits the cap in BYTES: a slice is
      // taken in characters and one character is up to four bytes.
      let n = Math.min(max, u.length - i);
      let piece = u.slice(i, i + n);
      while (n > 1 && Buffer.byteLength(piece, 'utf8') > max) {
        n = Math.ceil(n / 2);
        piece = u.slice(i, i + n);
      }
      units.push(piece);
      if (i + n >= u.length) break;
      i += Math.max(1, n - SCAN_WINDOW_OVERLAP);
    }
  }
  return { units };
}

// The added half of a line diff between the parent tree's blob and the file on
// disk: the common prefix and the common suffix are dropped and what is left of
// the NEW side is what this commit publishes.
//
// It is a prefix/suffix diff and not a minimal one on purpose. For an append -
// which is what a shard does - it is exact. For a rewrite it is CONSERVATIVE:
// the common region shrinks and more text is scanned, never less. Comparison
// strips a trailing `\r` from both sides because `cat-file` hands back the blob
// as stored (LF) while a Windows checkout with `core.autocrlf=true` has CRLF on
// disk, and without that every line would read as changed.
function addedText(parentText, newText) {
  const b = String(newText === null || newText === undefined ? '' : newText).split('\n');
  const a = String(parentText === null || parentText === undefined ? '' : parentText).split('\n');
  if (!parentText) return String(newText || '');
  const cr = (s) => (s.length && s.charCodeAt(s.length - 1) === 13 ? s.slice(0, -1) : s);
  const na = a.map(cr);
  const nb = b.map(cr);
  let p = 0;
  while (p < na.length && p < nb.length && na[p] === nb[p]) p++;
  let s = 0;
  while (s < na.length - p && s < nb.length - p && na[na.length - 1 - s] === nb[nb.length - 1 - s]) s++;
  if (p >= nb.length - s) return '';
  return b.slice(p, nb.length - s).join('\n');
}

// The secret-file corpus, walked at most once per this many ms per root. The
// walk is bounded inside lib/filter.js (40 files, depth 3); this stops a beat
// from paying even that once a minute forever.
const SECRET_FILES_TTL_MS = 600 * 1000;
const secretFilesCache = new Map();

function secretFilesFor(root, opts) {
  const o = opts || {};
  if (Array.isArray(o.secretFiles)) return o.secretFiles;
  const key = String(root || '');
  const hit = secretFilesCache.get(key);
  const now = nowMs(o.now);
  if (hit && now - hit.at < SECRET_FILES_TTL_MS) return hit.files;
  let files = [];
  try {
    const filter = require('./filter');
    files = typeof filter.defaultSecretFiles === 'function' ? filter.defaultSecretFiles(root) : [];
  } catch (_) { files = []; }
  secretFilesCache.set(key, { at: now, files });
  return files;
}

// Returns { ids, units, scanned, timed_out, elapsed_ms }.
//
//   ids        finding ids; EMPTY means clean. A finding refuses the commit.
//   timed_out  the budget ran out with units left. NOT a finding: the caller
//              DEFERS, the bytes stay on disk and the next beat scans them
//              again. `ids` may still be empty here, and empty-with-timed_out
//              must never be read as clean - which is why the shape is an
//              object and not the bare array the first build returned.
//
// Never throws: a thrown scanner is a scanner that fails OPEN, and this one may
// not. Every internal failure is a `filter-error` finding instead.
function scanCommitBytes(text, opts) {
  const o = opts || {};
  const started = Date.now();
  const budget = Number.isInteger(o.budgetMs) ? o.budgetMs : SCAN_BUDGET_MS;
  const deadline = Number.isFinite(Number(o.deadline)) ? Number(o.deadline) : started + Math.max(1, budget);
  const done = (ids, units, scanned, timedOut) => ({
    ids, units, scanned, timed_out: Boolean(timedOut), elapsed_ms: Date.now() - started,
  });
  try {
    let filter = null;
    try { filter = require('./filter'); } catch (_) { filter = null; }
    if (!filter || typeof filter.check !== 'function') return done(['filter-error'], 0, 0, false);
    const files = Array.isArray(o.secretFiles) ? o.secretFiles : [];
    const split = scanUnits(text);
    const ids = [];
    let scanned = 0;
    let timedOut = false;
    for (const unit of split.units) {
      // The clock is read per unit rather than per byte: one `check()` over a
      // 2 KB window is bounded work, so a unit that has started always finishes
      // and the overshoot is one unit's worth.
      if (scanned && Date.now() >= deadline) { timedOut = true; break; }
      scanned++;
      let res = null;
      try { res = filter.check(unit, { secretFiles: files }); } catch (_) { res = null; }
      if (!res) { ids.push('filter-error'); continue; }
      if (res.ok === true) continue;
      const found = Array.isArray(res.findings) ? res.findings : [];
      if (!found.length) { ids.push('filter-error'); continue; }
      for (const f of found) ids.push((f && f.id) || 'filter-error');
    }
    const seen = new Set();
    return done(ids.filter((id) => !seen.has(id) && seen.add(id)), split.units.length, scanned, timedOut);
  } catch (_) {
    return done(['filter-error'], 0, 0, false);
  }
}

// -------------------------------------------- the temp-index write path -----

// Read the mode for one path (section 10.1's mode rule, both arms):
//   in the parent tree  -> the parent entry's mode, read with `ls-tree`
//   not in it           -> 100644, unless the file is executable on disk AND
//                          core.fileMode is true, in which case 100755
// Never hardcoded, never taken from a bare disk stat.
function modeFor(root, parent, rel, opts) {
  const o = opts || {};
  if (parent) {
    const r = run(root, ['ls-tree', parent, '--', rel], { runner: o.runner, timeout: o.timeout });
    if (r.ok) {
      const line = String(r.stdout || '').split(/\r?\n/)[0] || '';
      const m = /^(\d{6})\s/.exec(line.trim());
      if (m) return m[1];
    }
  }
  if (o.fileMode) {
    try {
      const st = fs.statSync(fromPosix(root, rel));
      if ((st.mode & 0o111) !== 0) return '100755';
    } catch (_) { /* absent: handled by the caller's removal arm */ }
  }
  return '100644';
}

function commitMessage(member, rel, opts) {
  const o = opts || {};
  const who = escape.escapeMemberId(member);
  const subject = 'handshake state: ' + who;
  const body = rel.length === 1 ? rel[0] : rel.length + ' paths';
  // The marker is LAST, on its own line, because both forges evaluate the
  // commit message of the pushed commit and a marker buried mid-body is a
  // marker a reader deletes.
  const parts = [subject, '', body];
  if (o.note) parts.push('', safeLine(o.note, 200));
  parts.push('', SKIP_CI);
  return parts.join('\n');
}

// THE WRITE MECHANISM. `.git/index` is never read and never written, `HEAD`
// never moves, and no checkout ever happens. Returns the new commit sha WITHOUT
// moving any ref - `moveRef` does that, behind the checked-out guard.
//
//   GIT_INDEX_FILE=<state dir>  git read-tree <base tree | --empty>
//                               git hash-object -w -- <path>      (present)
//   GIT_INDEX_FILE=<...>        git update-index --add --cacheinfo <mode>,<sha>,<path>
//   GIT_INDEX_FILE=<...>        git update-index --force-remove -- <path>  (absent)
//   GIT_INDEX_FILE=<...>        git write-tree
//                               git commit-tree <tree> [-p <parent>] -m <msg>
function buildStateCommit(opts) {
  const o = opts || {};
  const root = o.root;
  const state = o.state;
  const member = o.member;
  const parent = o.parent || null;           // the fetched state head, or null
  const idx = o.indexFile || indexPath(state);
  const rel = allowlistFor(member);          // DERIVED. Never accepted.
  const started = Date.now();
  // Every call below is bounded by the smaller of its own ceiling and what is
  // left of the caller's ABSOLUTE deadline; a call with nothing left is skipped
  // rather than started in order to be killed.
  const ceiling = Number.isInteger(o.timeout) ? o.timeout : GIT_CALL_TIMEOUT_MS;
  const deadline = o.deadline === undefined ? null : o.deadline;
  const timeout = () => slice(deadline, ceiling);
  const gopt = () => ({ runner: o.runner, timeout: timeout() });
  const out = {
    ok: false, changed: false, commit: null, tree: null, parent, paths: rel.slice(),
    added: [], removed: [], message: null, reason: null, error: null, elapsed_ms: 0,
    findings: null, lost: null, bytes: null, index_file: idx,
    // How many bytes the commit scan actually looked at - the DIFF against the
    // parent tree, not the file - and which path (or `<commit message>`) it was
    // looking at when it stopped. Declared here so the shape is the same on
    // every arm rather than appearing only on the arms that set them.
    scan_bytes: 0, scanned_path: null,
  };
  const noTime = () => {
    out.reason = 'no_time';
    out.elapsed_ms = Date.now() - started;
    return out;
  };
  // A STEP THAT WAS KILLED BY THE CALLER'S DEADLINE IS `no_time`, NOT A BUILD
  // FAILURE, and the difference is the whole point of section 14 item 49: the
  // reason word reaches `status` beside the deferred count, and a beat that ran
  // out of its slice reported as `update_index_failed` tells a human their git
  // is broken when what happened is that the batch was short of milliseconds.
  // `run()` marks both arms - `skipped` for a call it refused to start,
  // `timedOut` for one the runner killed - and both mean the same thing here.
  const stepFail = (reason, r) => {
    if (r && (r.skipped === true || r.timedOut === true)) return noTime();
    out.reason = reason;
    out.error = safeLine((r && (r.stderr || r.error)) || null, 200);
    out.elapsed_ms = Date.now() - started;
    return out;
  };

  state.ensure();
  // A UNIQUE INDEX PER BUILD, REMOVED IN A `finally` RATHER THAN AT THE TOP OF
  // THE NEXT ONE. The old shape - one fixed path, unlinked here - is the
  // deletion bug `indexPath` documents: unlinking at the top of build B is what
  // destroys build A's seeded index mid-flight. Nothing shared, nothing to
  // unlink before use, and the file cannot outlive the call.
  try {
    return build();
  } finally {
    if (!o.indexFile) { try { fs.unlinkSync(idx); } catch (_) { /* already gone */ } }
  }

  function build() {

  if (timeout() === null) return noTime();

  // 0. THE WRITE-SIDE CAP, and it is a refusal rather than a truncation.
  //    The READ side caps every shard at MAX_SHARD_BYTES and the runner's own
  //    output buffer is 4 MB [C lib/repo.js defaultRunner], so a shard past
  //    that comes back EMPTY on every peer's machine - measured: a 5 MB shard
  //    committed with outcome `ok`, then read back as `exists=false`. An
  //    append-only shard that has outgrown the cap is a real condition a human
  //    has to see, so the batch stops here and says so, rather than publishing
  //    bytes nobody can read and growing a branch nobody prunes.
  for (const p of rel) {
    const abs = fromPosix(root, p);
    let st = null;
    try { st = fs.statSync(abs); } catch (_) { st = null; }
    if (st && st.isFile()) {
      out.bytes = st.size;
      if (st.size > MAX_SHARD_BYTES) {
        out.reason = 'shard_too_large';
        out.error = p + ' is ' + st.size + ' bytes, past the ' + MAX_SHARD_BYTES + '-byte shard cap';
        out.elapsed_ms = Date.now() - started;
        return out;
      }
    }
  }

  // 0b. THE COMMIT SCAN (section 4.2 item 1). Before `hash-object`, so nothing
  //     partial is written: a finding refuses the commit and the blob is never
  //     even created.
  //
  //     WHAT IS SCANNED IS THE DIFF against the parent tree's copy, per record,
  //     under a TIME bound. See SCAN_BUDGET_MS: the bytes already on the branch
  //     were scanned when they were published, a normal beat therefore scans
  //     the one or two records this session appended, and the bound that trips
  //     produces a DEFERRAL rather than an accusation.
  //
  //     AND THE BYTES SCANNED HERE ARE THE BYTES COMMITTED BELOW. `scanned`
  //     carries each path's text to step 1, which hashes it with
  //     `hash-object -w --stdin --path=<p>` instead of re-reading the file. The
  //     window between this read and that hash is several git spawns wide -
  //     `cat-file blob`, `read-tree`, `core.fileMode`, `ls-tree`, roughly
  //     100-300 ms on Windows - and a write landing inside it used to be
  //     committed unscanned AND, worse, permanently: the next beat's diff base
  //     is the committed blob, so those bytes become "already published" and
  //     are never scanned again. Hashing what was scanned closes the window
  //     rather than narrowing it.
  const scanned = new Map();
  if (o.scan !== false) {
    const files = secretFilesFor(root, { secretFiles: o.secretFiles, now: o.now });
    const scanDeadline = Date.now() + Math.max(1,
      slice(deadline, Number.isInteger(o.scanBudgetMs) ? o.scanBudgetMs : SCAN_BUDGET_MS) || 1);
    const deferScan = (where, res) => {
      out.reason = 'secret_scan_no_time';
      out.scanned_path = where;
      out.error = 'the commit scan reached ' + res.scanned + ' of ' + res.units +
        ' records in ' + res.elapsed_ms + ' ms and ran out of its budget';
      out.elapsed_ms = Date.now() - started;
      return out;
    };
    for (const p of rel) {
      const abs = fromPosix(root, p);
      // `null` records "absent when the scan looked", so step 1 takes the
      // removal arm from the SAME snapshot the scan cleared. Re-deciding
      // present-vs-absent down there would let a shard created after the scan
      // fall through to the path form and be committed unscanned - the same
      // hole in the other direction.
      if (!fileExists(abs)) { scanned.set(p, null); continue; }
      let text = null;
      try { text = fs.readFileSync(abs, 'utf8'); } catch (_) { text = null; }
      if (text === null) {
        // Unreadable is not clean (fail-closed, lib/filter.js's own posture).
        out.reason = 'secret_scan_unreadable';
        out.error = p + ' could not be read for the commit scan';
        out.elapsed_ms = Date.now() - started;
        return out;
      }
      scanned.set(p, text);
      // The parent tree's copy of this path. Absent, unreadable or out of time
      // all mean "assume nothing was published before", which scans MORE and
      // never less - the fail-closed direction.
      let published = '';
      if (parent) {
        const show = run(root, ['cat-file', 'blob', parent + ':' + p], gopt());
        if (show.ok) published = String(show.stdout || '');
      }
      const fresh = addedText(published, text);
      out.scan_bytes = (out.scan_bytes || 0) + Buffer.byteLength(fresh, 'utf8');
      if (!fresh) continue;
      const res = scanCommitBytes(fresh, { secretFiles: files, deadline: scanDeadline });
      if (res.ids.length) {
        out.reason = 'secret_scan';
        out.findings = res.ids;
        out.error = p + ': ' + res.ids.join(', ');
        out.scanned_path = p;
        out.elapsed_ms = Date.now() - started;
        return out;
      }
      // Clean SO FAR is not clean: units left unscanned mean the verdict is
      // unknown, and an unknown verdict defers rather than publishing.
      if (res.timed_out) return deferScan(p, res);
    }
    // The commit MESSAGE goes through the same battery (ruling D2's coverage
    // rule): a subject line is exactly where a pasted credential goes when the
    // diff is clean. It is generated and bounded, so it is scanned whole.
    const preview = o.message || commitMessage(member, rel, { note: o.note });
    const msg = scanCommitBytes(preview, { secretFiles: files, deadline: scanDeadline });
    if (msg.ids.length) {
      out.reason = 'secret_scan';
      out.findings = msg.ids;
      out.error = 'the commit message: ' + msg.ids.join(', ');
      out.scanned_path = '<commit message>';
      out.elapsed_ms = Date.now() - started;
      return out;
    }
    if (msg.timed_out) return deferScan('<commit message>', msg);
  }

  // 1. The base tree. Empty for the very first commit on the orphan branch,
  //    the fetched state head's tree otherwise.
  const seed = parent
    ? run(root, ['read-tree', parent], { runner: o.runner, timeout: timeout(), indexFile: idx })
    : run(root, ['read-tree', '--empty'], { runner: o.runner, timeout: timeout(), indexFile: idx });
  if (!seed.ok) return stepFail('read_tree_failed', seed);

  const fileMode = o.fileMode === undefined ? coreFileMode(root, gopt()) : Boolean(o.fileMode);

  for (const p of rel) {
    if (timeout() === null) return noTime();
    const abs = fromPosix(root, p);
    // ONE SNAPSHOT, TAKEN AT THE SCAN. `scanned` holds the text for a path that
    // existed then and `null` for one that did not; only a build with the scan
    // off re-asks the filesystem here.
    const snap = scanned.has(p) ? scanned.get(p) : undefined;
    if (snap === undefined ? fileExists(abs) : snap !== null) {
      // `hash-object -w` and not a plain `hash-object`: `--cacheinfo` NAMES a
      // blob, it does not create one and does not validate that one exists -
      // the failure surfaces two steps later as `write-tree` exit 128.
      //
      // AND `--stdin --path=<p>` RATHER THAN THE PATH ITSELF whenever step 0b
      // read the file, which is every scanned build. `--path` applies that
      // path's own eol conversion and attribute filters exactly as `git add`
      // would - the blob is the one `git add` would have stored FOR THESE BYTES
      // - and the bytes are the ones the commit scan cleared, so no write that
      // lands after the scan can ride out unscanned. The path form is kept as
      // the fallback for a build with the scan off, where there is nothing in
      // hand to hash.
      const h = typeof snap === 'string'
        ? run(root, ['hash-object', '-w', '--stdin', '--path=' + p],
          { runner: o.runner, timeout: timeout(), input: snap })
        : run(root, ['hash-object', '-w', '--', p], gopt());
      if (!h.ok) return stepFail('hash_object_failed', h);
      const sha = String(h.stdout || '').trim();
      if (!/^[0-9a-f]{40}$/.test(sha)) {
        out.reason = 'hash_object_bad_sha';
        return out;
      }
      const mode = modeFor(root, parent, p, { runner: o.runner, timeout: timeout(), fileMode });
      const u = run(root, ['update-index', '--add', '--cacheinfo', mode + ',' + sha + ',' + p],
        { runner: o.runner, timeout: timeout(), indexFile: idx });
      if (!u.ok) return stepFail('update_index_failed', u);
      out.added.push({ path: p, mode, sha });
    } else {
      // The removal arm. `--add` on a path that no longer exists exits 128 and
      // the `--cacheinfo` form cannot be constructed for it at all, so an
      // add-only builder SKIPS it and `write-tree` silently re-emits the
      // parent's blob: a deletion resurrects and a rename publishes both copies.
      const u = run(root, ['update-index', '--force-remove', '--', p],
        { runner: o.runner, timeout: timeout(), indexFile: idx });
      if (!u.ok) return stepFail('force_remove_failed', u);
      out.removed.push(p);
    }
  }

  // 2. The tree.
  if (timeout() === null) return noTime();
  const wt = run(root, ['write-tree'], { runner: o.runner, timeout: timeout(), indexFile: idx });
  if (!wt.ok) return stepFail('write_tree_failed', wt);
  const tree = String(wt.stdout || '').trim();
  if (!/^[0-9a-f]{40}$/.test(tree)) { out.reason = 'write_tree_bad_sha'; return out; }
  out.tree = tree;

  // 2b. THE POST-CONDITION, and it is the layer that turns the deletion bug
  //     into a refusal rather than a silent fast-forward. Whatever happened to
  //     the index between `read-tree` and `write-tree` - a concurrent build, a
  //     stale file, a future edit that widens the loop above - the only paths
  //     that may differ between the parent tree and the written one are THIS
  //     member's allowlisted paths. One `diff-tree`, one spawn, NUL-separated
  //     so a path can carry anything.
  //     Measured before this layer: a beat returned `ok`, pushed a clean
  //     fast-forward, and the peer's shard was gone from the branch.
  if (parent) {
    if (timeout() === null) return noTime();
    const dt = run(root, ['diff-tree', '-r', '-z', '--no-renames', '--name-status', parent, tree],
      { runner: o.runner, timeout: timeout() });
    if (!dt.ok) return stepFail('diff_tree_failed', dt);
    const allow = new Set(rel);
    const fields = String(dt.stdout || '').split('\0');
    const lost = [];
    const outside = [];
    for (let i = 0; i + 1 < fields.length; i += 2) {
      const status = (fields[i] || '').trim();
      const p = fields[i + 1] || '';
      if (!status || !p || allow.has(p)) continue;
      if (status.charAt(0) === 'D') lost.push(p); else outside.push(p);
    }
    if (lost.length || outside.length) {
      out.reason = lost.length ? 'tree_lost_paths' : 'tree_outside_allowlist';
      out.lost = lost.concat(outside).slice(0, 8);
      out.error = 'the written tree changed ' + (lost.length + outside.length) +
        ' path(s) outside this member\'s allowlist: ' + out.lost.join(', ');
      out.elapsed_ms = Date.now() - started;
      return out;
    }
  }

  // 3. Commit only if changed. Two batches inside one minute produce ONE
  //    commit because the second one's tree is the first one's tree.
  const parentTree = parent ? revParse(root, parent + '^{tree}', gopt()) : EMPTY_TREE;
  if (parentTree === tree) {
    out.ok = true;
    out.changed = false;
    out.reason = 'unchanged';
    return out;
  }
  if (!parent && tree === EMPTY_TREE) {
    out.ok = true;
    out.changed = false;
    out.reason = 'nothing_to_commit';
    return out;
  }

  if (timeout() === null) return noTime();

  // 4. The commit. Author = the member, committer = the tool, through the env
  //    on commit-tree and nowhere else. `-c commit.gpgsign=false` is explicit:
  //    commit-tree reads commit.gpgsign, and a developer with signing on gets a
  //    pinentry prompt with no controlling TTY.
  const message = o.message || commitMessage(member, rel, { note: o.note });
  if (!/\[skip ci\]\s*$/.test(message)) {
    out.reason = 'message_missing_skip_ci';
    return out;
  }
  out.message = message;

  const authorName = authorNameFor(member);
  const authorEmail = o.authorEmail || repo.localGitEmail(root, gopt()) || (memberRefSegment(member) + '@claude-handshake.invalid');
  const env = {
    GIT_AUTHOR_NAME: authorName,
    GIT_AUTHOR_EMAIL: authorEmail,
    GIT_COMMITTER_NAME: TOOL_IDENTITY.name,
    GIT_COMMITTER_EMAIL: TOOL_IDENTITY.email,
  };
  if (o.date) { env.GIT_AUTHOR_DATE = String(o.date); env.GIT_COMMITTER_DATE = String(o.date); }

  const args = ['-c', 'commit.gpgsign=false', 'commit-tree', tree];
  if (parent) args.push('-p', parent);
  args.push('-m', message);
  const ct = run(root, args, { runner: o.runner, timeout: timeout(), env });
  if (!ct.ok) return stepFail('commit_tree_failed', ct);
  const commit = String(ct.stdout || '').trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) { out.reason = 'commit_tree_bad_sha'; return out; }

  out.ok = true;
  out.changed = true;
  out.commit = commit;
  out.elapsed_ms = Date.now() - started;
  return out;
  }
}

// ONE `update-ref` with the expected old value, behind the checked-out guard.
function moveRef(opts) {
  const o = opts || {};
  const root = o.root;
  const ref = o.ref || STATE_REF;
  const g = { runner: o.runner, timeout: o.timeout };

  const guard = checkedOut(root, ref, g);
  if (guard.checked_out || !guard.ok) {
    return {
      ok: false,
      outcome: OUTCOMES.paused,
      reason: guard.checked_out ? 'checked_out' : 'worktree_unreadable',
      push: EXTRA_PUSH_STATES.paused_checked_out,
      message: guard.checked_out
        ? 'handshake: paused — `' + STATE_BRANCH + '` is checked out in ' +
          (guard.by.map((e) => e.worktree).filter(Boolean).join(', ') || 'this worktree') +
          ', so nothing was written. Switch that worktree to another branch ' +
          '(`git switch -`) and the tool resumes on the next beat.'
        : 'handshake: paused — `git worktree list` could not be read, so the tool cannot prove `' +
          STATE_BRANCH + '` is not checked out. Nothing was written.',
      guard,
    };
  }

  const expected = o.expectedOld === undefined ? revParse(root, ref, g) : o.expectedOld;
  const args = ['update-ref', ref, o.commit, expected === null || expected === undefined ? ZERO_OID : expected];
  const r = run(root, args, g);
  if (!r.ok) {
    return {
      ok: false,
      outcome: OUTCOMES.deferred,
      reason: 'update_ref_failed',
      push: PUSH_STATES.deferred,
      message: 'handshake: the local `' + STATE_BRANCH + '` ref moved under this beat, so nothing was written; ' +
        'the batch is rebuilt on the next beat.',
      detail: safeLine(r.stderr || r.error, 200),
      guard,
    };
  }
  return { ok: true, outcome: OUTCOMES.ok, ref, commit: o.commit, previous: expected, guard };
}

// ------------------------------------------------- network: the protocol ----

// section 10.1 rule 2's named primitive. `git ls-remote --exit-code --heads`
// gives the THREE-WAY answer the adopt-never-create rule needs, which the
// exact-refspec fetch of rule 1 cannot: 0 = present, 2 = proved absent,
// anything else = unknown, and unknown must never create a root.
function lsRemoteRef(root, ref, opts) {
  const o = opts || {};
  const timeout = o.timeout === undefined ? LSREMOTE_CEILING_MS : o.timeout;
  if (timeout === null) {
    return { present: null, sha: null, code: null, reason: 'no_time', spawned: false };
  }
  const args = assertNoBareForce(['ls-remote', '--exit-code', '--heads', o.remote || 'origin', ref]);
  const r = run(root, args, { runner: o.runner, timeout, net: true });
  if (r.ok) {
    const line = String(r.stdout || '').split(/\r?\n/)[0] || '';
    const sha = (line.split(/\s+/)[0] || '').trim();
    return { present: true, sha: /^[0-9a-f]{40}$/.test(sha) ? sha : null, code: 0, reason: 'present', spawned: true };
  }
  if (r.code === 2) return { present: false, sha: null, code: 2, reason: 'proved_absent', spawned: true };
  return {
    present: null, sha: null, code: r.code, spawned: true,
    reason: r.timedOut ? 'timeout' : 'unknown',
    detail: safeLine(r.stderr || r.error, 240),
  };
}

// section 10.1 rule 1: fetch first, ALWAYS - and the same fetch carries a second
// refspec, the default branch's tip into refs/remotes/origin/<default>. One
// round trip, one budget row.
function fetchState(root, opts) {
  const o = opts || {};
  const remote = o.remote || 'origin';
  const def = o.defaultBranch || defaultBranchName(root, { runner: o.runner, timeout: o.timeout });
  const timeout = o.timeout === undefined ? FETCH_BUDGET_MS : o.timeout;
  if (timeout === null) {
    return { ok: false, reason: 'no_time', default_branch: def, refspecs: [], spawned: false };
  }
  const refspecs = [];
  if (o.stateRefspec !== false) {
    refspecs.push('+' + STATE_REF + ':' + REMOTE_STATE_REF);
  }
  refspecs.push('+refs/heads/' + def + ':refs/remotes/' + remote + '/' + def);

  // `+src:dst` INTO A REMOTE-TRACKING REF on a `fetch` is the ordinary fetch
  // form and is not a force push; that is the one exemption the argv guard
  // makes, and it is scoped to this verb and this destination shape, so these
  // pass deliberately and a `+refs/heads/x:refs/heads/x` never would.
  const args = assertNoBareForce(['fetch', '--no-tags', remote].concat(refspecs));
  const r = run(root, args, { runner: o.runner, timeout, net: true });
  return {
    ok: r.ok,
    reason: r.ok ? null : (r.timedOut ? 'timeout' : 'fetch_failed'),
    detail: r.ok ? null : safeLine(r.stderr || r.error, 240),
    timed_out: Boolean(r.timedOut),
    default_branch: def,
    refspecs,
    spawned: true,
  };
}

// The forge's own rejection line, captured verbatim (bounded and escaped) so
// the CLI can print it rather than paraphrasing it.
function forgeLine(stderr) {
  const lines = String(stderr || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const picked = [];
  for (const l of lines) {
    if (/^remote:/.test(l)) { picked.push(l.replace(/^remote:\s*/, '')); continue; }
    if (/^!\s*\[/.test(l)) picked.push(l);
  }
  const body = (picked.length ? picked : lines).slice(0, 3).join(' / ');
  return safeLine(body, 240) || null;
}

const OFFLINE_RE = /could not resolve host|unable to access|failed to connect|connection (?:timed out|refused|reset)|network is unreachable|operation timed out|temporary failure in name resolution|does not appear to be a git repository|no route to host|ssh: connect to host|early eof|the remote end hung up|rpc failed/i;
const AUTH_RE = /authentication failed|could not read username|could not read password|terminal prompts disabled|permission denied|access denied|403 forbidden|invalid username or password|repository not found/i;
const NONFF_RE = /non-fast-forward|\(fetch first\)|failed to push some refs/i;
const STALE_RE = /stale info/i;
const SIGN_RE = /gpg|signing failed|required signature|unsigned commits|signature/i;
// TRANSIENT REF CONTENTION, WHICH IS NOT A FORGE RULE. Two writers pushing the
// same ref inside the same instant make the receiving end fail to take its ref
// lock, and it says so in a `! [remote rejected]` line. Observed live: 2 of 36
// concurrent beats against a plain bare remote with no ruleset of ANY kind came
// back classified `forge_ruleset`, which told a human "the remote refused, this
// will not drain by waiting" and offered them a next move for a rule that does
// not exist - a violation of section 4.4 rule 2 and of section 4.1's honesty
// rule in one line. It self-heals on the next beat, so it is routed into
// rule 4's re-fetch-and-rebuild arm.
const CONTENDED_RE = /cannot lock ref|failed to update ref|reference already exists|cannot lock existing info\/refs|unable to create '[^']*index\.lock'|shallow update not allowed/i;
// What a real forge rule looks like. `[remote rejected]` is deliberately NOT in
// this set: it is the CONTAINER git prints for every server-side refusal, not a
// cause, and testing it first is what made a lock collision read as a ruleset.
const RULESET_RE = /pre-receive hook declined|protected branch|GH0\d\d|push declined|policy|ruleset|repository rule violation|required status check|hook declined/i;

// offline vs rejected vs non-fast-forward, distinct and reported. A deferred
// count that grows forever because every push is refused is exactly the lie
// section 4.1 spends a paragraph forbidding.
function classifyRemote(r) {
  if (!r) return { kind: 'offline', detail: null };
  if (r.error === 'ENOENT' || r.error === 'EACCES') {
    return { kind: 'refused', reason: 'git_missing', detail: 'git is not installed or not on PATH' };
  }
  if (r.timedOut) return { kind: 'offline', reason: 'timeout', detail: 'the push did not answer inside its bound' };
  const stderr = String(r.stderr || '') + '\n' + String(r.stdout || '');
  if (STALE_RE.test(stderr)) return { kind: 'stale_lease', reason: 'stale_lease', detail: forgeLine(stderr) };
  // Transient FIRST, and before the ruleset arm, because the two arrive inside
  // the same `[remote rejected]` envelope and only one of them drains.
  if (CONTENDED_RE.test(stderr)) {
    return { kind: 'nonff', reason: 'ref_contended', detail: forgeLine(stderr) };
  }
  if (AUTH_RE.test(stderr)) return { kind: 'rejected', reason: 'auth', detail: forgeLine(stderr) };
  if (RULESET_RE.test(stderr)) {
    return { kind: 'rejected', reason: SIGN_RE.test(stderr) ? 'forge_signing' : 'forge_ruleset', detail: forgeLine(stderr) };
  }
  if (NONFF_RE.test(stderr)) return { kind: 'nonff', reason: 'non_fast_forward', detail: forgeLine(stderr) };
  // A bare `[remote rejected]` with no cause this table recognises is still a
  // refusal by the remote - reported as one, with the forge's own line, and
  // never dressed up as a rule the tool cannot name.
  if (/\[remote rejected\]/.test(stderr)) {
    return { kind: 'rejected', reason: 'remote_rejected', detail: forgeLine(stderr) };
  }
  if (OFFLINE_RE.test(stderr)) return { kind: 'offline', reason: 'unreachable', detail: forgeLine(stderr) };
  return { kind: 'offline', reason: 'unknown', detail: forgeLine(stderr) };
}

// A plain push of the state ref. No lease and no force EVER: `handshake/state`
// is a shared two-writer ref, and rewriting it is above the floor (section 4.1).
function pushState(root, opts) {
  const o = opts || {};
  const remote = o.remote || 'origin';
  const timeout = o.timeout === undefined ? PUSH_CEILING_MS : o.timeout;
  if (timeout === null) {
    return { ok: false, kind: 'no_time', reason: 'no_time', detail: null, spawned: false };
  }
  const args = assertNoBareForce(['push', '--porcelain', remote, STATE_REF + ':' + STATE_REF]);
  const r = run(root, args, { runner: o.runner, timeout, net: true });
  if (r.ok) return { ok: true, kind: 'ok', reason: null, detail: null, spawned: true, raw: safeLine(r.stdout, 240) };
  const c = classifyRemote(r);
  return { ok: false, kind: c.kind, reason: c.reason, detail: c.detail, spawned: true };
}

// ------------------------------------------------ ruling D1's lease push ----

// The tool's OWN refs only, and the verdict for anything else is reached with
// NO GIT PROCESS SPAWNED - that is the control (section 4.1 rule 3, section
// 11.3). Stage 1 never calls this for the state branch: `handshake/state` is
// shared and is never force-pushed. It ships here because the helper and its
// refusal are Stage 1's write layer, and Stage 2's re-root is its first user.
function refPermitted(ref, member) {
  const r = String(ref || '');
  if (r === STATE_REF) return { permitted: true, kind: 'state' };
  if (member && r === ownRef(member)) return { permitted: true, kind: 'own' };
  return { permitted: false, kind: null };
}

function leasePush(opts) {
  const o = opts || {};
  const ref = String(o.ref || '');
  const member = o.member;
  const state = o.state;
  const root = o.root;
  const remote = o.remote || 'origin';

  // 1. The pattern IS the control, and it is checked before anything spawns.
  const perm = refPermitted(ref, member);
  if (!perm.permitted) {
    return {
      ok: false, outcome: OUTCOMES.refused, reason: 'ref_not_permitted', spawned: false,
      push: null, ref,
      message: 'handshake: refused to force-push `' + safeLine(ref, 120) + '` — the lease pattern permits ' +
        '`' + (member ? ownRef(member) : HANDSHAKE_REF_PREFIX + '<you>') + '` only, and never a shared or ' +
        "human-owned ref. Nothing was sent and no git process was started.",
    };
  }
  if (perm.kind === 'state') {
    return {
      ok: false, outcome: OUTCOMES.refused, reason: 'state_ref_never_forced', spawned: false,
      push: null, ref,
      message: 'handshake: refused to force-push `' + STATE_BRANCH + '` — it is a shared two-writer ref, ' +
        'and rewriting it is above the floor. The state branch is pushed fast-forward only.',
    };
  }
  if (o.force === true || o.bareForce === true) {
    return {
      ok: false, outcome: OUTCOMES.refused, reason: 'bare_force_refused', spawned: false,
      push: null, ref,
      message: 'handshake: refused — bare `--force` is above the floor on every ref without exception. ' +
        'The only permitted rewrite is `--force-with-lease=<ref>:<the tool\'s recorded head>`.',
    };
  }

  const timeout = o.timeout === undefined ? PUSH_CEILING_MS : o.timeout;
  if (timeout === null) {
    return { ok: false, outcome: OUTCOMES.deferred, reason: 'no_time', push: PUSH_STATES.deferred, spawned: false, ref };
  }

  // 2. Present / proved absent / unknown, from `ls-remote --exit-code --heads`.
  //    A ref that is not there cannot be clobbered, so the push that re-creates
  //    it carries no lease at all; unknown pushes nothing (D1 rule 1).
  const probe = lsRemoteRef(root, ref, { runner: o.runner, remote, timeout: Math.min(timeout, LSREMOTE_CEILING_MS) });
  if (probe.present === null) {
    return {
      ok: false, outcome: OUTCOMES.offline, reason: 'ls_remote_unknown', push: PUSH_STATES.offline,
      spawned: true, ref, detail: probe.detail || null,
      message: 'handshake: could not prove whether `' + safeLine(ref, 120) + '` exists on the remote, ' +
        'so nothing was pushed. Retried on the next beat.',
    };
  }

  let args;
  if (probe.present === false) {
    // A leaseless CREATE. Not a force: there is nothing on the remote to protect.
    args = assertNoBareForce(['push', '--porcelain', remote, ref + ':' + ref]);
  } else {
    // 3. The lease value is the tool's OWN recorded head. Never the
    //    remote-tracking ref (a background fetch silently updates it), never a
    //    valueless lease, and NEVER a value read back from the remote - a lease
    //    whose expected value is whatever the remote currently has can never
    //    fail. No record, or a record that does not parse, is a REFUSAL.
    const expected = o.expected === undefined ? recordedHead(state, ref) : o.expected;
    if (!expected || !/^[0-9a-f]{40}$/.test(String(expected))) {
      return {
        ok: false, outcome: OUTCOMES.refused, reason: 'no_recorded_lease', push: PUSH_STATES.no_lease,
        spawned: true, ref,
        message: 'handshake: refused — there is no recorded head for `' + safeLine(ref, 120) + '` on this machine, ' +
          'so a lease cannot be formed and a valueless lease protects nothing. ' +
          'The branch is frozen until you reset it yourself or clear it with `git push origin --delete ' +
          ref.replace(/^refs\/heads\//, '') + '`.',
      };
    }
    args = assertNoBareForce(['push', '--porcelain', '--force-with-lease=' + ref + ':' + expected, remote, ref + ':' + ref]);
  }

  const r = run(root, args, { runner: o.runner, timeout, net: true });
  if (r.ok) {
    const sha = o.sha || revParse(root, ref, { runner: o.runner, timeout: o.localTimeout });
    // Same critical section as the push that moved it.
    if (state && sha) recordHead(state, ref, sha, { now: o.now });
    return { ok: true, outcome: OUTCOMES.ok, reason: null, push: PUSH_STATES.pushing, spawned: true, ref, sha, created: probe.present === false };
  }
  const c = classifyRemote(r);
  if (c.kind === 'stale_lease') {
    return {
      ok: false, outcome: OUTCOMES.paused, reason: 'stale_lease', push: PUSH_STATES.paused_head,
      spawned: true, ref, detail: c.detail,
      message: 'handshake: paused — the remote head of `' + safeLine(ref, 120) + '` is not the one this tool pushed, ' +
        'so the lease refused rather than clobbering it. Open the PR from it as it stands, or reset it with ' +
        '`git push --force-with-lease origin <sha>:' + ref.replace(/^refs\/heads\//, '') + '`.',
    };
  }
  return {
    ok: false,
    outcome: c.kind === 'rejected' ? OUTCOMES.rejected : (c.kind === 'refused' ? OUTCOMES.refused : OUTCOMES.offline),
    reason: c.reason, spawned: true, ref, detail: c.detail,
    push: c.kind === 'rejected' ? PUSH_STATES.forge_rejected + (c.detail || 'the remote refused') : PUSH_STATES.offline,
  };
}

// ------------------------------------------------------------- preflight ----

const SYNC_ROOTS = [/onedrive/i, /dropbox/i, /google\s*drive/i, /googledrive/i, /icloud/i, /\bbox\b/i];

// The THREE preconditions (section 10.1): the visibility verdict per D2, a
// `git push --dry-run` that runs non-interactively, and `commit.gpgsign` off or
// resolved. Plus `git --version` recorded, and the two WARNINGS that do not
// block. Nothing here writes a ref or an object.
function preflight(opts) {
  const o = opts || {};
  const state = o.state;
  const detected = o.repo || repo.detectRepo(o.cwd || o.root || process.cwd(), { runner: o.runner, timeout: o.timeout });
  const root = detected && detected.root ? detected.root : (o.root || o.cwd || process.cwd());
  const g = { runner: o.runner, timeout: o.timeout };
  const out = {
    ok: false, root, repo: detected,
    checks: { visibility: null, push_dry_run: null, gpgsign: null },
    git_version: null, warnings: [], refusals: [],
  };

  const ver = gitVersion(root, g);
  out.git_version = ver.version;
  out.git_version_raw = ver.raw;

  // Precondition 0 (not one of the three, but it ends the run): a remote.
  if (!detected || !detected.ok || detected.reason === 'no_remote') {
    out.refusals.push({
      id: 'no_remote', push: PUSH_STATES.no_remote,
      message: 'handshake: this working tree has no git remote — no state branch is created, no commit is made ' +
        'and no push is attempted. Add one with `git remote add origin <url>`.',
    });
    return out;
  }

  // Precondition 1: the visibility verdict (ruling D2).
  const optIn = readOptIn(state);
  const verdict = o.verdict || repo.guard({ state, cwd: root, repo: detected, runner: o.runner, now: o.now });
  const arm = visibilityArm(verdict, optIn, detected.remote);
  out.checks.visibility = {
    ok: arm.allowed, arm: arm.arm, verdict: verdict ? verdict.verdict : null,
    reason: verdict ? verdict.reason : null, recorded: arm.recorded || null,
  };
  if (!arm.allowed) out.refusals.push({ id: 'visibility', push: arm.push, message: arm.message });

  // Precondition 2: `commit.gpgsign` off or resolved. Both arms are stated.
  const sign = gpgSignConfig(root, g);
  out.checks.gpgsign = { set: sign.set, on: sign.on, ok: !sign.on, resolved: o.gpgsignResolved === true };
  if (sign.on && o.gpgsignResolved !== true) {
    out.refusals.push({
      id: 'gpgsign', push: null,
      message: 'handshake: `commit.gpgsign` is true in this repository, and an automated commit with signing on ' +
        'either hangs on a `pinentry` prompt with no controlling TTY or fails every time. Two arms, and this tool ' +
        'takes the first: the automated path passes `-c commit.gpgsign=false` so its own commits never sign — ' +
        'run `handshake pair --state-branch --allow-unsigned` to accept that, or turn signing off for this ' +
        'repository with `git config commit.gpgsign false`. Your own commits are unaffected either way.',
    });
  }

  // Precondition 3: a `git push --dry-run` that runs non-interactively. It
  // proves the credential posture up front - GIT_TERMINAL_PROMPT=0 means a
  // helper that would prompt FAILS instead of hanging. `--dry-run` changes
  // nothing on the remote; the src is preferred in the order local state ref,
  // remote-tracking state ref, HEAD, so the probe names the intended ref
  // without proposing a real change.
  const src = revParse(root, STATE_REF, g) || revParse(root, REMOTE_STATE_REF, g) || revParse(root, 'HEAD', g);
  if (!src) {
    out.checks.push_dry_run = { ok: null, reason: 'no_commit_yet', src: null };
    out.warnings.push({
      id: 'push_dry_run_skipped',
      message: 'handshake: the push probe was skipped — this repository has no commit to name yet. ' +
        'It runs again at the first batch.',
    });
  } else {
    // GIT_NETWORK_TIMEOUT_MS and not the beat's 5,000 ms push ceiling: the
    // preflight is a CLI verb and never runs on a hook, and section 2.5 puts
    // this constant on off-hook paths ONLY - the monitor's own clock and the
    // CLI. A hook path takes a slice of its caller's deadline instead.
    const timeout = o.pushTimeout === undefined ? GIT_NETWORK_TIMEOUT_MS : o.pushTimeout;
    const args = assertNoBareForce(['push', '--dry-run', '--porcelain', o.remote || 'origin', src + ':' + STATE_REF]);
    const r = run(root, args, { runner: o.runner, timeout, net: true });
    if (r.ok) {
      out.checks.push_dry_run = { ok: true, reason: null, src, detail: null };
    } else {
      const c = classifyRemote(r);
      // A non-fast-forward answer is a PASS for this probe: the remote was
      // reached and answered non-interactively, which is the only thing the
      // probe is asking. Only a credential or network failure is a refusal.
      if (c.kind === 'nonff') {
        out.checks.push_dry_run = { ok: true, reason: 'non_fast_forward', src, detail: c.detail };
      } else {
        out.checks.push_dry_run = { ok: false, reason: c.reason, src, detail: c.detail };
        out.refusals.push({
          id: 'push_dry_run',
          push: c.kind === 'rejected' ? PUSH_STATES.forge_rejected + (c.detail || 'the remote refused') : PUSH_STATES.offline,
          message: 'handshake: `git push --dry-run` could not run non-interactively against ' +
            safeLine(detected.remote, 120) + ' — ' + (c.detail || c.reason) +
            '. Fix the credential helper (`git credential-manager configure`, or an SSH key with no passphrase ' +
            'prompt) and re-run `handshake pair --state-branch`; the tool never prompts and never will.',
        });
      }
    }
  }

  // The two `[skip ci]` warnings of section 4.2 item 4, which do NOT block.
  if (o.pullRequestTarget === true) {
    out.warnings.push({
      id: 'pull_request_target',
      message: 'handshake: a workflow in this repository uses `on: pull_request_target`, which GitHub documents as ' +
        'the one trigger `[skip ci]` does not suppress — expect a run per tool push, roughly one a minute, while ' +
        'a pull request from a handshake branch is open. Add a branch filter to that workflow if the cost matters.',
    });
  }
  if (detected.host && detected.host !== 'github.com') {
    out.warnings.push({
      id: 'forge_policy_unreadable',
      message: 'handshake: `' + safeLine(detected.host, 60) + '` is not github.com, so this tool cannot read whether a ' +
        'pipeline execution policy overrides `[skip ci]`. GitLab honours the marker unless such a policy forbids ' +
        'skipping; if yours does, expect a run per tool push, roughly one a minute.',
    });
  }
  // section 14 item 49: the Windows sync-root check, which otherwise produces
  // file-lock errors nobody can attribute.
  if (process.platform === 'win32' && state && SYNC_ROOTS.some((re) => re.test(state.dir))) {
    out.warnings.push({
      id: 'sync_root',
      message: 'handshake: the plugin state directory is inside a cloud-sync root (' + safeLine(state.dir, 160) + '). ' +
        'The sync client locks files under it and the tool will see errors it cannot attribute. ' +
        'Move it with `HANDSHAKE_STATE_DIR=<a local path>`.',
    });
  }

  out.ok = out.refusals.length === 0;

  // `git --version` is recorded, and so is the verdict, so `status` can report
  // both without shelling out.
  if (state) {
    const doc = readHeads(state);
    doc.git_version = ver.version;
    doc.preflight = {
      at: nowMs(o.now), ok: out.ok,
      checks: out.checks,
      refusals: out.refusals.map((x) => x.id),
      warnings: out.warnings.map((x) => x.id),
    };
    writeHeads(state, doc);
  }
  return out;
}

// --------------------------------------------------------------- the beat ---

function result(fields) {
  return Object.assign({
    ok: false, outcome: null, reason: null, push: null, message: null, detail: null,
    commit: null, pushed: false, ref: STATE_REF, branch: STATE_BRANCH,
    attempts: 0, deferred_count: null, parent: null, created_root: false,
  }, fields);
}

// One beat of the concurrency protocol (section 10.1, the five rules):
//   1. fetch first, always - two refspecs, one round trip
//   2. adopt, never re-create - a root only when `ls-remote --exit-code` PROVES
//      the ref absent, never on a fetch error
//   3. build with `commit-tree -p <the fetched head>`, this member's paths only
//   4. on a non-fast-forward rejection, re-fetch and REBUILD, never retry -
//      bounded at MAX_REBUILDS per beat, then defer
//   5. `rejected` is distinct from `offline`, and both are distinct from
//      `deferred (no time in the beat)`
// THE PUBLIC ENTRY POINT RUNS EVERY GATE, ALWAYS. There is no option on it that
// turns them off: the old `gate: null` seam disabled the child refusal, the
// not-a-repo check, the no-remote arm, the opt-in gate and ruling D2's
// visibility gate TOGETHER, on the public API of the one module in this product
// that writes to a remote. The ungated body is `_internals.runBeatUngated`,
// which tests reach deliberately and no production caller can reach by
// forgetting a flag.
function runBeat(opts) {
  const o = opts || {};

  // The child verdict is reached before `detectRepo`, so a subagent spawns
  // nothing at all.
  const isChild = childRefusal(o);
  if (isChild) return isChild;

  // One `detectRepo` for the whole beat: the gate needs it and so does every
  // git call below, and a second probe would be a second process for an answer
  // this beat already has.
  const detected = o.repo ||
    (o.root || o.cwd ? repo.detectRepo(o.root || o.cwd, { runner: o.runner, timeout: o.localTimeout }) : null);
  const blocked = o.gate || gate(Object.assign({}, o, { repo: detected }));
  if (blocked) return blocked;

  return runBeatUngated(Object.assign({}, o, { repo: detected }));
}

function runBeatUngated(opts) {
  const o = opts || {};
  const state = o.state;
  const member = o.member;
  const deadline = o.deadline === undefined ? null : o.deadline;
  const remote = o.remote || 'origin';
  const detected = o.repo || null;

  const root = (detected && detected.root) || o.root || o.cwd || process.cwd();
  const g = { runner: o.runner, timeout: o.localTimeout };

  // ONE BATCH AT A TIME PER STATE DIRECTORY, ACROSS PROCESSES. Everything below
  // this line reads the remote head, seeds a temp index from it and moves a
  // ref; two of those running at once in one clone is the data-loss bug
  // `indexPath` documents. The <= 1/min clock does not serialise them - it is
  // read before eight spawns and written after, and both hook flushes pass
  // `force: true` past it - so this does.
  //
  // THERE IS NO OPTION THAT SKIPS IT. An earlier build carried `lock: false` as
  // a test seam, which is a switch on the public API of the one module in this
  // product that writes to a remote for turning off the one control that stops
  // it losing a peer's data. A test that wants two beats to overlap gives them
  // their own state directories, which is what two clones really have; a test
  // that wants the contended arm calls `acquireBatchLock` itself. `force` may
  // skip the CLOCK. Nothing skips the LOCK.
  //
  // NEITHER THE STALENESS BOUND NOR THE CLOCK IS THE CALLER'S TO SET HERE.
  // `staleMs: 0` and an injected `now` far in the future are each a lock bypass
  // wearing an option's clothes, and staleness is measured against a real
  // file's real mtime, so a logical clock has no business deciding whether
  // another process is alive. Both stay on the primitive, for its own tests.
  const lock = acquireBatchLock(state, { where: o.where });
  if (!lock.held) {
    // Nothing was spawned and nothing was spent, so the deferred count does NOT
    // grow: another process in this clone is doing exactly this work right now
    // and will record its own outcome.
    return result({
      outcome: OUTCOMES.deferred, reason: 'locked', push: PUSH_STATES.deferred, attempts: 0,
      message: 'handshake: another session in this clone is committing the state batch right now; ' +
        'this beat stood aside and the next one picks it up.',
      deferred_count: deferredCount(state),
    });
  }
  try {
    return beatBody();
  } finally {
    lock.release();
  }

  function beatBody() {
  let attempts = 0;
  let fileMode = null;
  // The member's own git identity, read once per beat. It is the author of
  // every commit below, and re-reading `user.email` on each rebuild attempt
  // spends a process for an answer that cannot have changed inside one beat.
  let authorEmail = o.authorEmail;

  for (let attempt = 1; attempt <= (o.maxRebuilds || MAX_REBUILDS); attempt++) {
    attempts = attempt;

    // ---- rule 1: fetch first, always. Each rebuild's re-fetch takes its own
    //      slice of what is LEFT rather than a fresh 1,500 ms.
    const fetchBound = slice(deadline, FETCH_BUDGET_MS, o.now);
    if (fetchBound === null) return deferNoTime(state, attempts, o);
    const fetched = fetchState(root, {
      runner: o.runner, remote, timeout: fetchBound, defaultBranch: o.defaultBranch,
    });

    // The local copy of the ref this clone owns. It exists whenever this member
    // has ever committed a batch, pushed or not, and it is what makes the
    // offline arm a CHAIN rather than a single replayed commit.
    const localRef = revParse(root, STATE_REF, g);
    let remoteHead = null;
    let createdRoot = false;

    if (fetched.ok) {
      remoteHead = revParse(root, REMOTE_STATE_REF, g);
      if (!remoteHead) {
        // The fetch succeeded but the tracking ref is not there: treat it as
        // unproved and ask rule 2's primitive rather than guessing.
        const probe = lsRemoteRef(root, STATE_REF, { runner: o.runner, remote, timeout: slice(deadline, LSREMOTE_CEILING_MS, o.now) });
        if (probe.present !== false) return offlineOrDefer(state, probe, attempts, o);
        createdRoot = !localRef;
      }
    } else {
      // ---- rule 2: a local orphan root is created ONLY when the remote ref is
      //      PROVED absent - never on a fetch error, which is indistinguishable
      //      from a ref that is there.
      const probeBound = slice(deadline, LSREMOTE_CEILING_MS, o.now);
      if (probeBound === null) return deferNoTime(state, attempts, o);
      const probe = lsRemoteRef(root, STATE_REF, { runner: o.runner, remote, timeout: probeBound });
      if (probe.present !== false && !localRef) {
        // Nothing proved and nothing local to extend: create NOTHING. This is
        // rule 2's pin - the fetch's own exit code cannot tell an absent ref
        // from an unreachable remote, so neither may this.
        return offlineOrDefer(state, probe.present === null ? probe : { reason: 'fetch_failed', detail: fetched.detail }, attempts, o, fetched);
      }
      if (probe.present === false) {
        createdRoot = !localRef;
        // Rule 1's second refspec still deserves its round trip on the
        // bootstrap beat, so `handshake branches` has a fresh <default> to
        // measure against rather than the "not fetched this session" arm.
        const second = slice(deadline, FETCH_BUDGET_MS, o.now);
        if (second !== null) {
          fetchState(root, { runner: o.runner, remote, timeout: second, defaultBranch: o.defaultBranch, stateRefspec: false });
        }
      }
      // present === true or unknown, WITH a local ref: the local chain keeps
      // growing offline and the push below sorts out which head wins. It is
      // never a second orphan root beside the remote's.
    }

    // The base. The remote head when this clone is behind it (rule 3's
    // adopt-and-rebuild); the LOCAL head when the local chain already contains
    // the remote head, which is the offline replay - a chain of queued batches
    // that fast-forwards on reconnect rather than collapsing into one commit
    // that drops the days between.
    let parent = remoteHead;
    let ahead = false;
    if (localRef && (!remoteHead || localRef === remoteHead ||
      run(root, ['merge-base', '--is-ancestor', remoteHead, localRef], g).ok)) {
      parent = localRef;
      ahead = localRef !== remoteHead;
    }

    // ---- rule 3: build, this member's allowlisted paths only.
    // section 2.5's commit row is the gate on whether there is ROOM to start
    // the local plumbing, not a kill timer on each of its six-to-eight git
    // processes: the beat's own deadline is what bounds those, threaded down.
    if (slice(deadline, COMMIT_BUDGET_MS, o.now) === null) return deferNoTime(state, attempts, o);
    // `core.fileMode` is read once per beat rather than once per build: it is a
    // repository setting, and re-reading it on every rebuild attempt spends a
    // process for an answer that cannot have changed inside one beat.
    if (fileMode === null) fileMode = o.fileMode === undefined ? coreFileMode(root, g) : Boolean(o.fileMode);
    if (!authorEmail) authorEmail = repo.localGitEmail(root, g) || (memberRefSegment(member) + '@claude-handshake.invalid');
    const built = buildStateCommit({
      root, state, member, parent, runner: o.runner, deadline,
      message: o.message, note: o.note, authorEmail, date: o.date,
      fileMode, scan: o.scan, scanBudgetMs: o.scanBudgetMs, secretFiles: o.secretFiles, now: o.now,
    });
    if (!built.ok) {
      // THREE BUILD FAILURES ARE REFUSALS, NOT DEFERRALS, because retrying them
      // next minute changes nothing and a deferred count that climbs forever is
      // the lie section 4.1 spends a paragraph forbidding. Each names its cause
      // and its next move (section 4.4 rule 2).
      if (built.reason === 'secret_scan' || built.reason === 'secret_scan_unreadable') {
        const where = built.scanned_path || allowlistFor(member)[0];
        return result({
          outcome: OUTCOMES.refused, reason: built.reason, attempts, parent,
          push: PUSH_STATES.secret_scan + where,
          detail: built.error,
          findings: built.findings || null,
          message: 'handshake: the state commit was REFUSED before it was created — the commit scan found ' +
            (built.findings && built.findings.length
              ? built.findings.join(', ') + ' in `' + where + '`'
              : '`' + where + '` unreadable, and unreadable is not clean') +
            '. Nothing was committed and nothing was pushed. Remove the value from that file (or move it into ' +
            'a file the tool does not publish) and the next beat goes out; the shard is on your disk either way.',
          deferred_count: deferredCount(state),
        });
      }
      // THE SCAN THAT RAN OUT OF TIME IS A DEFERRAL AND NEVER A REFUSAL. The
      // bytes are not accused of anything - they are simply not yet cleared -
      // so the batch stays on disk, the deferred count grows and says which
      // cause it is, and the next beat scans the same records again. A count
      // ceiling here would have had to choose between a false accusation and a
      // scanner that fails open; a time bound has to choose neither.
      if (built.reason === 'secret_scan_no_time') {
        return result({
          outcome: OUTCOMES.deferred, reason: built.reason, push: PUSH_STATES.deferred, attempts, parent,
          detail: built.error,
          message: 'handshake: the state batch was DEFERRED, not refused — ' + safeLine(built.error, 200) +
            '. Nothing was committed and nothing is accused; the next beat scans the same records again.',
          deferred_count: bumpDeferred(state, built.reason, o).count,
        });
      }
      if (built.reason === 'shard_too_large') {
        return result({
          outcome: OUTCOMES.refused, reason: built.reason, attempts, parent, push: null,
          detail: built.error,
          message: 'handshake: the state commit was refused — ' + safeLine(built.error, 200) + '. Every peer reads ' +
            'shards through a ' + MAX_SHARD_BYTES + '-byte cap, so a shard past it publishes bytes nobody can ' +
            'read. Trim or rotate `' + allowlistFor(member)[0] + '` and the next beat goes out.',
          deferred_count: deferredCount(state),
        });
      }
      if (built.reason === 'tree_lost_paths' || built.reason === 'tree_outside_allowlist') {
        return result({
          outcome: OUTCOMES.deferred, reason: built.reason, push: PUSH_STATES.deferred, attempts, parent,
          detail: built.error, lost: built.lost || null,
          message: 'handshake: the state commit was thrown away before it was made — the tree it built would have ' +
            'changed ' + ((built.lost || []).join(', ') || 'paths') + ', which is outside this member\'s ' +
            'allowlist. Nothing was written. The batch is rebuilt on the next beat.',
          deferred_count: bumpDeferred(state, built.reason, o).count,
        });
      }
      return result({
        outcome: OUTCOMES.deferred, reason: built.reason, push: PUSH_STATES.deferred, attempts,
        detail: built.error,
        message: 'handshake: the state commit could not be built (' + safeLine(built.reason, 60) + '); ' +
          'the batch is rebuilt on the next beat.',
        deferred_count: bumpDeferred(state, built.reason, o).count, parent,
      });
    }
    // Nothing new to commit AND nothing queued behind: two batches inside one
    // minute produce one commit, and this is the beat that makes that true.
    if (!built.changed && !ahead) {
      return result({
        ok: true, outcome: OUTCOMES.unchanged, reason: built.reason, push: PUSH_STATES.pushing,
        attempts, parent, commit: null,
        message: 'handshake: nothing on the state allowlist changed since the last commit, so no commit was made.',
        deferred_count: deferredCount(state),
      });
    }

    // `head` is what gets pushed. When nothing changed but the local chain is
    // ahead of the remote, the chain IS the batch: a client that was offline
    // for a week pushes its queued commits rather than collapsing them into one
    // that drops the days between.
    let head = parent;
    if (built.changed) {
      // ---- the checked-out guard, then ONE update-ref with the expected old.
      // `expectedOld` is left to moveRef, which reads the local ref immediately
      // before the write: absent reads as ZERO_OID ("this ref must not exist"),
      // which is the create arm, and any other value is the concurrent-writer
      // check. Both arms are one `update-ref`.
      const moved = moveRef({
        root, ref: STATE_REF, commit: built.commit, runner: o.runner, timeout: o.localTimeout,
      });
      if (!moved.ok) {
        if (moved.outcome === OUTCOMES.paused) {
          return result({
            outcome: OUTCOMES.paused, reason: moved.reason, push: moved.push, message: moved.message,
            attempts, parent, deferred_count: deferredCount(state), guard: moved.guard,
          });
        }
        return result({
          outcome: moved.outcome, reason: moved.reason, push: moved.push, message: moved.message,
          detail: moved.detail, attempts, parent,
          deferred_count: bumpDeferred(state, moved.reason, o).count,
        });
      }
      head = built.commit;
    }

    // ---- the push. The local commit is already on the local ref, so every
    //      failure below leaves it intact and retries on the next beat.
    const pushBound = slice(deadline, o.pushCeilingMs || PUSH_CEILING_MS, o.now);
    if (pushBound === null) {
      return result({
        outcome: OUTCOMES.deferred, reason: 'no_time', push: PUSH_STATES.deferred, attempts,
        commit: head, parent, created_root: createdRoot,
        message: 'handshake: the batch was committed locally but there was no time left in the beat to push it; ' +
          'it goes out on the next beat.',
        deferred_count: bumpDeferred(state, 'no_time', o).count,
      });
    }
    const pushed = pushState(root, { runner: o.runner, remote, timeout: pushBound });
    if (pushed.ok) {
      recordHead(state, STATE_REF, head, { now: o.now });
      return result({
        ok: true, outcome: OUTCOMES.ok, reason: built.changed ? null : 'replayed', push: PUSH_STATES.pushing,
        attempts, commit: head, pushed: true, parent, created_root: createdRoot, replayed: !built.changed,
        commit_ms: built.elapsed_ms,
        message: built.changed
          ? 'handshake: committed and pushed one state batch to `' + STATE_BRANCH + '` (' + head.slice(0, 8) + ').'
          : 'handshake: pushed the state batches this machine had queued while it was offline, up to ' +
            head.slice(0, 8) + '.',
        deferred_count: 0,
      });
    }

    // ---- rule 4: a non-fast-forward rejection is not a network error and
    //      retrying it succeeds never. Re-fetch and REBUILD.
    if (pushed.kind === 'nonff') {
      if (attempt < (o.maxRebuilds || MAX_REBUILDS)) continue;
      return result({
        // The word is `deferred` and the parenthesis is the TRUE cause. The
        // beat may have had all the time in the world; what it ran out of is
        // rule 4's three rebuild attempts, and section 14 item 49 added
        // "(no time in the beat)" specifically to distinguish causes - so
        // printing it here would be the field asserting one it does not know.
        outcome: OUTCOMES.deferred, reason: 'attempts_exhausted',
        push: PUSH_STATES.deferred_attempts, attempts,
        commit: head, parent, detail: pushed.detail,
        message: 'handshake: `' + STATE_BRANCH + '` moved under this beat ' + attempts + ' times; the batch is ' +
          'rebuilt on the next beat. The local commit is intact.',
        deferred_count: bumpDeferred(state, 'attempts_exhausted', o).count,
      });
    }

    // ---- rule 5: rejected is distinct from offline, and the deferred count
    //      does NOT grow on a rejection.
    if (pushed.kind === 'rejected') {
      return result({
        outcome: OUTCOMES.rejected, reason: pushed.reason, attempts, commit: head, parent,
        detail: pushed.detail,
        push: PUSH_STATES.forge_rejected + (pushed.detail || 'the remote refused the push'),
        message: 'handshake: the remote REFUSED the push to `' + STATE_BRANCH + '` and said: ' +
          (pushed.detail || '(no reason given)') + '. This is not a network problem and it will not drain by ' +
          'waiting — the local commit is kept. ' +
          (pushed.reason === 'auth'
            ? 'Fix the credential (`gh auth login`, or an SSH key) and it resumes on the next beat.'
            : pushed.reason === 'forge_signing'
              ? 'Your forge requires signed commits; this tool never signs. Exempt `' + STATE_BRANCH +
                '` from that rule, or turn the state branch off with `handshake pair --state-branch --off`.'
              : 'Exempt `' + STATE_BRANCH + '` from the rule above, or turn the state branch off with ' +
                '`handshake pair --state-branch --off`.'),
        deferred_count: deferredCount(state),
      });
    }
    if (pushed.kind === 'refused') {
      return result({
        outcome: OUTCOMES.refused, reason: pushed.reason, attempts, commit: head, parent,
        detail: pushed.detail, push: null,
        message: 'handshake: ' + (pushed.detail || pushed.reason) + '.',
        deferred_count: deferredCount(state),
      });
    }

    // offline: the local commit stands and the push is retried on the next beat.
    return result({
      outcome: OUTCOMES.offline, reason: pushed.reason, push: PUSH_STATES.offline, attempts,
      commit: head, parent, created_root: createdRoot, detail: pushed.detail,
      message: 'handshake: the batch is committed locally at ' + String(head).slice(0, 8) +
        ' but the remote could not be reached; it is pushed on the next beat.',
      deferred_count: bumpDeferred(state, pushed.reason || 'offline', o).count,
    });
  }

  return deferNoTime(state, attempts, o);
  }
}

function deferNoTime(state, attempts, o) {
  return result({
    outcome: OUTCOMES.deferred, reason: 'no_time', push: PUSH_STATES.deferred, attempts,
    message: 'handshake: no time left in this beat for the state batch; it goes out on the next one.',
    deferred_count: bumpDeferred(state, 'no_time', o).count,
  });
}

function offlineOrDefer(state, probe, attempts, o, fetched) {
  const detail = (probe && probe.detail) || (fetched && fetched.detail) || null;
  return result({
    outcome: OUTCOMES.offline, reason: (probe && probe.reason) || 'unreachable', push: PUSH_STATES.offline,
    attempts, detail,
    message: 'handshake: the remote could not be reached, so nothing was committed — the parent would have been ' +
      'stale and a state commit on a stale parent is a lost record. Retried on the next beat.',
    deferred_count: bumpDeferred(state, 'offline', o).count,
  });
}

// ---------------------------------------------------------------- report ----

// A read-only summary for `handshake status`, computed from what this side
// already holds. Shells out to nothing.
function report(state, opts) {
  const o = opts || {};
  const heads = readHeads(state);
  const optIn = readOptIn(state);
  return {
    branch: STATE_BRANCH,
    ref: STATE_REF,
    opted_in: optIn.enabled,
    opted_in_at: optIn.at,
    visibility: optIn.visibility,
    recorded_head: heads.refs[STATE_REF] ? heads.refs[STATE_REF].sha : null,
    recorded_heads: heads.refs,
    deferred: heads.deferred,
    last_push_at: heads.last_push_at,
    git_version: heads.git_version,
    preflight: heads.preflight,
    last_push_state: o.push || null,
  };
}

module.exports = {
  // constants
  STATE_BRANCH, STATE_REF, REMOTE_STATE_REF, HANDSHAKE_REF_PREFIX, SKIP_CI,
  GIT_NETWORK_TIMEOUT_MS, GIT_CALL_TIMEOUT_MS, FETCH_BUDGET_MS, COMMIT_BUDGET_MS, PUSH_CEILING_MS,
  LSREMOTE_CEILING_MS, MAX_REBUILDS, MIN_SPAWN_MS,
  TOOL_IDENTITY, EMPTY_TREE, ZERO_OID,
  OPT_IN_FILE, HEADS_FILE, LOCK_FILE, LOCK_STALE_MS, INDEX_PREFIX, INDEX_SUFFIX,
  MAX_SHARD_BYTES,
  OUTCOMES, PUSH_STATES, STAGE1_PUSH_STATES, STAGE1_PROPOSED_PUSH_STATES,
  STAGE1_REACHABLE_PUSH_STATES, EXTRA_PUSH_STATES, pushWord,
  // derivation
  allowlistFor, memberRefSegment, ownRef, authorNameFor, refPermitted, commitMessage,
  // the commit gate (section 4.2 item 1's fail-closed half)
  scanCommitBytes, SCAN_BUDGET_MS, SCAN_WINDOW_OVERLAP, NOT_ENABLED_WORD,
  // records
  optInPath, headsPath, indexPath, lockPath, acquireBatchLock,
  readOptIn, writeOptIn, clearOptIn,
  readHeads, writeHeads, recordHead, recordedHead, bumpDeferred, deferredCount,
  // git primitives
  gitVersion, gpgSignConfig, coreFileMode, defaultBranchName, checkedOut, childRefusal,
  // the write path
  buildStateCommit, moveRef,
  // the network path
  fetchState, lsRemoteRef, pushState, leasePush, classifyRemote, forgeLine,
  // gates and drivers
  visibilityArm, gate, preflight, runBeat, report,
  // seams for tests. `runBeatUngated` is the beat with every gate ALREADY
  // decided: it is here, behind `_internals`, precisely so no single option on
  // the public `runBeat` can switch the child refusal, the repo check, the
  // no-remote arm, the opt-in gate and ruling D2's visibility gate off at once.
  _internals: { slice, modeFor, assertNoBareForce, run, runBeatUngated, secretFilesFor, scanUnits, addedText },
};
