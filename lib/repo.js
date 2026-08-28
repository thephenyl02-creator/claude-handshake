'use strict';
// claude-handshake M8: the private-repo guard and the repo intelligence it
// needs.
//
// Normative: SECURITY.md section 6 (fail-closed guard, 600 s TTL, visibility
// flip = loud + demand rotation, doctor's two history checks), section 3.1
// (the true holder set of anything in the repo), PROTOCOL section 10.2 (guard
// failure is a loud-rejected condition: reported once per session, posting
// stops on that transport, reading continues).
//
// THE VERDICT RULE, and it is the whole module in one sentence: only an
// affirmative `isPrivate: true` from an authenticated `gh repo view` permits
// committing the guarded part; `isPrivate: false`, a non-zero exit, a timeout,
// a missing `gh`, an unauthenticated call, unparseable output, a missing
// field, a non-boolean field and a repo with no GitHub remote ALL come out as
// public. There is no third value and no "probably private" - a guess in this
// position writes a team-wide credential into a public repo forever
// (SECURITY.md 3.1: rotation never un-leaks git history).

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { HANDSHAKE_CREDENTIAL_SHAPES } = require('./secret-shapes');

const GUARD_TTL_MS = 600 * 1000;          // SECURITY.md section 6 [F]
const PROBE_TIMEOUT_MS = 8000;
const GIT_TIMEOUT_MS = 5000;
const HISTORY_TIMEOUT_MS = 15000;
const HISTORY_MAX_COUNT = 20;

// The loud code used with lib/state.js session flags (PROTOCOL 10.2).
const LOUD_CODE = 'private_repo_guard';

// Reasons, enumerated so status/doctor never have to invent prose. Everything
// except `affirmative_private` is a public verdict.
const REASONS = Object.freeze({
  affirmative_private: 'gh reported isPrivate: true',
  affirmative_public: 'gh reported isPrivate: false',
  not_a_repo: 'not inside a git working tree',
  no_remote: 'the git working tree has no remote',
  no_github_remote: 'the remote is not a github.com repository',
  gh_missing: 'the gh CLI is not installed or not on PATH',
  gh_unauthenticated: 'gh is installed but not authenticated for this repo',
  gh_error: 'gh exited non-zero',
  gh_timeout: 'gh did not answer within the probe timeout',
  ambiguous: 'gh answered, but not with a boolean isPrivate',
  stale_affirmative: 'the cached affirmative is older than the TTL, so it is not an affirmative',
});

// --------------------------------------------------------------- runner ----

// One place that shells out, so tests can inject a fake and so every call is
// bounded in time and output. Never uses a shell: argv goes straight to the
// process, so no repo-supplied string can become shell syntax.
function defaultRunner(cmd, args, opts) {
  const o = opts || {};
  const attempts = process.platform === 'win32' ? [cmd, cmd + '.exe', cmd + '.cmd'] : [cmd];
  let last = null;
  for (const bin of attempts) {
    const r = spawnSync(bin, args, {
      cwd: o.cwd,
      encoding: 'utf8',
      timeout: Number(o.timeout) || GIT_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      shell: false,
      env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' }),
    });
    last = {
      ok: r.error === undefined && r.status === 0,
      code: r.status === null ? null : r.status,
      stdout: r.stdout || '',
      stderr: r.stderr || '',
      error: r.error ? String(r.error.code || r.error.message) : null,
      timedOut: Boolean(r.error && r.error.code === 'ETIMEDOUT'),
    };
    if (!(r.error && (r.error.code === 'ENOENT' || r.error.code === 'EACCES'))) return last;
  }
  return last || { ok: false, code: null, stdout: '', stderr: '', error: 'ENOENT', timedOut: false };
}

function git(root, args, opts) {
  const o = opts || {};
  return (o.runner || defaultRunner)('git', args, { cwd: root, timeout: o.timeout || GIT_TIMEOUT_MS });
}

// ------------------------------------------------------- repo detection ----

const SLUG_RES = [
  /^(?:https?:\/\/)(?:[^@/]+@)?([^/]+)\/([^/]+)\/(.+?)(?:\.git)?\/?$/i,   // https://host/owner/repo
  /^(?:ssh:\/\/)?(?:git@)([^:/]+)[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/i,      // git@host:owner/repo
];

function parseRemote(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  for (const re of SLUG_RES) {
    const m = re.exec(raw);
    if (m) {
      const host = m[1].toLowerCase().replace(/:\d+$/, '');
      const owner = m[2];
      const repo = m[3].replace(/\.git$/i, '');
      if (!owner || !repo) return null;
      return { host, owner, repo, slug: owner + '/' + repo, is_github: host === 'github.com' };
    }
  }
  return null;
}

// {ok, root, remote, slug, host, is_github, reason}
function detectRepo(cwd, opts) {
  const o = opts || {};
  const start = path.resolve(cwd || process.cwd());
  const top = git(start, ['rev-parse', '--show-toplevel'], o);
  if (!top.ok) {
    return { ok: false, root: null, remote: null, slug: null, host: null, is_github: false, reason: 'not_a_repo' };
  }
  const root = path.resolve(top.stdout.trim());
  const remoteName = o.remote || 'origin';
  let url = null;
  const origin = git(root, ['remote', 'get-url', remoteName], o);
  if (origin.ok && origin.stdout.trim()) url = origin.stdout.trim();
  if (!url) {
    const list = git(root, ['remote'], o);
    const first = list.ok ? list.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] : null;
    if (first) {
      const got = git(root, ['remote', 'get-url', first], o);
      if (got.ok) url = got.stdout.trim();
    }
  }
  if (!url) return { ok: true, root, remote: null, slug: null, host: null, is_github: false, reason: 'no_remote' };
  const parsed = parseRemote(url);
  if (!parsed) return { ok: true, root, remote: url, slug: null, host: null, is_github: false, reason: 'no_github_remote' };
  return {
    ok: true, root, remote: url, slug: parsed.slug, host: parsed.host,
    is_github: parsed.is_github, reason: parsed.is_github ? null : 'no_github_remote',
  };
}

// ---------------------------------------------------------- the probe ------

// STRICT. Returns {private, reason, raw?} and `private` is `true` on exactly
// one path through this function.
function probeVisibility(repo, opts) {
  const o = opts || {};
  if (!repo || !repo.ok) return { private: false, reason: 'not_a_repo' };
  if (!repo.slug) return { private: false, reason: repo.reason || 'no_remote' };
  if (!repo.is_github) return { private: false, reason: 'no_github_remote' };

  const r = (o.runner || defaultRunner)('gh', ['repo', 'view', repo.slug, '--json', 'isPrivate'], {
    cwd: repo.root, timeout: Number(o.timeout) || PROBE_TIMEOUT_MS,
  });
  if (r.timedOut) return { private: false, reason: 'gh_timeout' };
  if (r.error === 'ENOENT' || r.error === 'EACCES') return { private: false, reason: 'gh_missing' };
  if (!r.ok) {
    const stderr = String(r.stderr || '');
    const unauth = /auth login|not logged|authentication|gh auth|HTTP 401|Bad credentials/i.test(stderr);
    return { private: false, reason: unauth ? 'gh_unauthenticated' : 'gh_error', detail: stderr.slice(0, 200).trim() || null };
  }
  let parsed;
  try { parsed = JSON.parse(r.stdout); } catch (_) { return { private: false, reason: 'ambiguous' }; }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.isPrivate !== 'boolean') {
    return { private: false, reason: 'ambiguous' };
  }
  // The one affirmative path.
  if (parsed.isPrivate === true) return { private: true, reason: 'affirmative_private' };
  return { private: false, reason: 'affirmative_public' };
}

// ------------------------------------------------------------- verdict -----

function shape(v) {
  return {
    private: Boolean(v.private),
    verdict: v.private ? 'private' : 'public',
    reason: v.reason,
    detail: v.detail === undefined ? null : v.detail,
    explanation: REASONS[v.reason] || String(v.reason || 'unknown'),
    checked_at: v.checked_at,
    age_ms: v.age_ms === undefined ? 0 : v.age_ms,
    source: v.source || 'fresh',
    stale: Boolean(v.stale),
    slug: v.slug === undefined ? null : v.slug,
    root: v.root === undefined ? null : v.root,
    flip: Boolean(v.flip),
    previous: v.previous === undefined ? null : v.previous,
    ttl_ms: GUARD_TTL_MS,
  };
}

function storedVerdict(state) {
  if (!state) return null;
  const s = state.read();
  const g = s && s.repo_guard;
  return g && typeof g === 'object' ? g : null;
}

// Read-only view of the cache, for `status` and any caller that must not shell
// out. A stale affirmative is DOWNGRADED here, not reported as private:
// "a stale affirmative older than the TTL is not an affirmative" (SECURITY 6).
function cachedVerdict(state, opts) {
  const o = opts || {};
  const now = Number.isInteger(o.now) ? o.now : Date.now();
  const ttl = Number.isInteger(o.ttlMs) ? o.ttlMs : GUARD_TTL_MS;
  const g = storedVerdict(state);
  if (!g) return null;
  const age = now - Number(g.checked_at || 0);
  const stale = age >= ttl;
  if (stale && g.private) {
    return shape({
      private: false, reason: 'stale_affirmative', checked_at: g.checked_at, age_ms: age,
      source: 'cache', stale: true, slug: g.slug, root: g.root, previous: 'private',
    });
  }
  return shape({
    private: Boolean(g.private) && !stale, reason: g.reason, detail: g.detail,
    checked_at: g.checked_at, age_ms: age, source: 'cache', stale,
    slug: g.slug, root: g.root,
  });
}

// The guard. Cached with a 600 s TTL in local state; re-probed when stale or
// when `force` is set; the verdict is persisted so `status` can report it
// without shelling out and so a flip is detectable across runs.
function guard(opts) {
  const o = opts || {};
  const now = Number.isInteger(o.now) ? o.now : Date.now();
  const ttl = Number.isInteger(o.ttlMs) ? o.ttlMs : GUARD_TTL_MS;
  const state = o.state || null;
  const prior = storedVerdict(state);

  if (!o.force && prior) {
    const age = now - Number(prior.checked_at || 0);
    if (age < ttl) {
      return shape({
        private: Boolean(prior.private), reason: prior.reason, detail: prior.detail,
        checked_at: prior.checked_at, age_ms: age, source: 'cache', stale: false,
        slug: prior.slug, root: prior.root,
      });
    }
  }

  const repo = o.repo || detectRepo(o.cwd || process.cwd(), o);
  const probe = probeVisibility(repo, o);
  const flip = Boolean(prior && prior.private === true && probe.private === false);
  const verdict = shape({
    private: probe.private, reason: probe.reason, detail: probe.detail,
    checked_at: now, age_ms: 0, source: 'fresh', stale: false,
    slug: repo.slug, root: repo.root, flip,
    previous: prior ? (prior.private ? 'private' : 'public') : null,
  });

  if (state) {
    state.update((s) => {
      const before = s.repo_guard && typeof s.repo_guard === 'object' ? s.repo_guard : {};
      s.repo_guard = Object.assign({}, before, {
        private: verdict.private, reason: verdict.reason, detail: verdict.detail,
        checked_at: now, slug: verdict.slug, root: verdict.root,
        flip: flip || Boolean(before.flip),
        first_affirmative_at: verdict.private ? (before.first_affirmative_at || now) : (before.first_affirmative_at || null),
      });
      return s;
    });
  }
  return verdict;
}

// ------------------------------------------- tracked-secret / history ------

// Shapes that mean "this tracked file carries workspace key material".
// Frozen once in lib/secret-shapes.js and shared with the outbound filter so
// the two guards can never drift (SECURITY.md §3).
const SECRET_SHAPES = HANDSHAKE_CREDENTIAL_SHAPES;

// Is any GUARDED material tracked by git right now? `git ls-files` is the
// question that matters - a file that exists on disk but is ignored is not a
// leak, and a file that is tracked is in every clone (SECURITY.md 3.1).
function trackedSecrets(root, opts) {
  const o = opts || {};
  if (!root) return { ok: false, reason: 'not_a_repo', tracked: [], secrets: [], any: false };
  const ls = git(root, ['ls-files', '--', '.handshake'], o);
  if (!ls.ok) return { ok: false, reason: 'git_error', tracked: [], secrets: [], any: false };
  const tracked = ls.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const secrets = [];
  for (const rel of tracked.slice(0, 200)) {
    const base = rel.split('/').pop();
    if (base === 'secret.json') { secrets.push({ file: rel, id: 'guarded-part-tracked' }); continue; }
    let body = '';
    try { body = fs.readFileSync(path.join(root, rel), 'utf8').slice(0, 256 * 1024); } catch (_) { continue; }
    for (const shapeRe of SECRET_SHAPES) {
      if (shapeRe.re.test(body)) { secrets.push({ file: rel, id: shapeRe.id }); break; }
    }
  }
  return { ok: true, reason: null, tracked, secrets, any: secrets.length > 0 };
}

// SECURITY.md 6: doctor checks for token-in-history. Bounded in both time and
// output - `-S` over all refs is a full-history scan, and an unbounded one on
// a large repo is a hang, not a check. A failure is reported as UNKNOWN, never
// as "clean": claiming a clean history we did not verify is exactly the kind
// of overclaim section 4 forbids.
function tokenInHistory(root, opts) {
  const o = opts || {};
  if (!root) return { ok: false, reason: 'not_a_repo', hits: [], checked: [] };
  // Full credential SHAPES, not bare prefixes: a doctor that fires on any doc
  // or pattern definition mentioning "hsk_" is a doctor users learn to ignore.
  // (Observed on this project's own repo: 24 false-positive commits.)
  // Derived from the shared shape list, not restated: this list did NOT learn
  // about the create token when secret-shapes.js gained it, which is precisely
  // the drift that file exists to prevent. Only the prefixed token family is
  // used as a pickaxe needle - the JSON-field shapes (`"secret": …`,
  // `"topic": …`) match their own pattern definitions and every doc that shows
  // an example record, which is the false-positive class above.
  // The shapes are case-insensitive by design (the /i flag does not survive
  // into a git pickaxe pattern), so the scan passes -i rather than restating
  // each hex class as [0-9a-fA-F].
  const needles = o.needles || HANDSHAKE_CREDENTIAL_SHAPES
    .filter((s) => /^hs/.test(s.re.source))
    .map((s) => s.re.source);
  const hits = [];
  const checked = [];
  for (const needle of needles) {
    const r = git(root, ['log', '--all', '-i', '-S', needle, '--pickaxe-regex', '--oneline', '--max-count=' + HISTORY_MAX_COUNT],
      { runner: o.runner, timeout: Number(o.timeout) || HISTORY_TIMEOUT_MS });
    if (!r.ok) {
      return { ok: false, reason: r.timedOut ? 'timeout' : 'git_error', hits, checked, needle };
    }
    checked.push(needle);
    for (const line of r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
      const m = /^([0-9a-f]{7,40})\s+(.*)$/.exec(line);
      hits.push({ needle, sha: m ? m[1] : line.slice(0, 12), subject: m ? m[2].slice(0, 120) : '' });
    }
  }
  return { ok: true, reason: null, hits, checked, truncated: hits.length >= HISTORY_MAX_COUNT };
}

// Last committing email of a path. Used for the non-member-commit warning
// (SECURITY.md 5.4). An uncommitted path answers `null` rather than guessing.
function lastCommitEmail(root, relPath, opts) {
  const o = opts || {};
  if (!root) return { ok: false, reason: 'not_a_repo', email: null, sha: null };
  const r = git(root, ['log', '-1', '--format=%ae%x09%H', '--', relPath], o);
  if (!r.ok) {
    // A repo with no commits yet has no HEAD, and `git log` exits non-zero
    // saying so. That is "uncommitted", not a broken git - and reporting it as
    // an error would make every fresh workspace look like a failed check.
    if (/does not have any commits|unknown revision|bad default revision|ambiguous argument .HEAD./i.test(r.stderr || '')) {
      return { ok: true, reason: 'uncommitted', email: null, sha: null };
    }
    return { ok: false, reason: 'git_error', email: null, sha: null };
  }
  const line = r.stdout.split(/\r?\n/)[0] || '';
  if (!line.trim()) return { ok: true, reason: 'uncommitted', email: null, sha: null };
  const [email, sha] = line.split('\t');
  return { ok: true, reason: null, email: (email || '').trim() || null, sha: (sha || '').trim() || null };
}

// The local git identity, recorded at join so the non-member check has at
// least one email it actually knows (SECURITY.md 5.4).
function localGitEmail(root, opts) {
  const r = git(root || process.cwd(), ['config', '--get', 'user.email'], opts || {});
  if (!r.ok) return null;
  const v = r.stdout.trim();
  return v || null;
}

// ------------------------------------------------- the loud-flag wiring ----

// PROTOCOL 10.2: a private-repo guard failure is a loud-rejected condition.
// Reported ONCE per session, posting stops on that transport for the rest of
// the session, reading continues, and rotation is demanded until the user
// acknowledges it. The hard-fail condition is "public verdict AND guarded
// material is tracked" - the visibility FLIP is the common way to arrive
// there, but a repo that was public all along with a tracked secret is the
// same leak and gets the same treatment.
function applyGuard(opts) {
  const o = opts || {};
  const verdict = o.verdict;
  const tracked = o.tracked || { any: false, secrets: [] };
  const state = o.state || null;
  const flags = o.flags || null;
  const transport = o.transport || 'unknown';

  const hardFail = Boolean(verdict && !verdict.private && tracked.any);
  const result = {
    hard_fail: hardFail,
    code: LOUD_CODE,
    report: false,
    posting_stopped: false,
    rotation_demanded: false,
    files: (tracked.secrets || []).map((s) => s.file),
    message: null,
  };
  if (!hardFail) {
    if (state && verdict) {
      state.update((s) => {
        s.repo_guard = Object.assign({}, s.repo_guard || {}, { last_hard_fail: (s.repo_guard || {}).last_hard_fail || null });
        return s;
      });
    }
    return result;
  }

  result.message =
    'handshake: private-repo guard FAILED - ' + (verdict.slug || 'this repo') + ' is ' + verdict.verdict +
    ' (' + verdict.explanation + ') and workspace key material is tracked in it (' +
    result.files.slice(0, 4).join(', ') + (result.files.length > 4 ? ', +' + (result.files.length - 4) + ' more' : '') +
    '). Posting stopped on ' + transport + ' for this session. ROTATE the workspace secret' +
    (verdict.flip ? ' - this repo was previously verified private, so the flip exposed it' : '') +
    '; rotation stops future use and does NOT un-leak git history (SECURITY.md 6).';

  if (flags) {
    result.report = flags.shouldReport(LOUD_CODE);
    flags.stopPosting(transport, LOUD_CODE);
    flags.count('loud_' + LOUD_CODE);
    result.posting_stopped = true;
  }
  if (state) {
    state.update((s) => {
      s.repo_guard = Object.assign({}, s.repo_guard || {}, {
        rotation_demanded: true,
        last_hard_fail: { at: Date.now(), verdict: verdict.verdict, reason: verdict.reason, files: result.files, flip: Boolean(verdict.flip) },
      });
      return s;
    });
    result.rotation_demanded = true;
  }
  return result;
}

// The user's acknowledgement that the rotation demanded above actually
// happened. Deliberately explicit: nothing clears this flag automatically,
// because "the guard stopped complaining" must never be a side effect of a
// cache expiry.
function acknowledgeRotation(state) {
  if (!state) return false;
  state.update((s) => {
    s.repo_guard = Object.assign({}, s.repo_guard || {}, {
      rotation_demanded: false, rotation_acknowledged_at: Date.now(),
    });
    return s;
  });
  return true;
}

function rotationDemanded(state) {
  const g = storedVerdict(state);
  return Boolean(g && g.rotation_demanded);
}

module.exports = {
  GUARD_TTL_MS, PROBE_TIMEOUT_MS, HISTORY_MAX_COUNT, LOUD_CODE, REASONS, SECRET_SHAPES,
  defaultRunner, git, parseRemote, detectRepo, probeVisibility,
  guard, cachedVerdict, storedVerdict,
  trackedSecrets, tokenInHistory, lastCommitEmail, localGitEmail,
  applyGuard, acknowledgeRotation, rotationDemanded,
};
