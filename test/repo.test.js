'use strict';
// The fail-closed private-repo guard (SECURITY.md section 6) and the repo
// intelligence around it.
//
// The verdict matrix is the load-bearing test in this file. Every row that is
// not an affirmative `isPrivate: true` MUST come out public, because the cost
// of a wrong "private" is a team-wide credential committed to a public repo
// forever - and rotation never un-leaks git history (SECURITY.md 3.1, 6).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = require('../lib/repo');
const stateLib = require('../lib/state');

let n = 0;
function tmpDir(tag) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hs-repo-' + (tag || '') + (n++) + '-')));
}

// A throwaway git repo. Nothing here touches the developer's real config:
// identity is passed per-command with -c.
function gitRepo(opts) {
  const o = opts || {};
  const dir = tmpDir('git');
  const g = (...args) => spawnSync('git', ['-C', dir].concat(args), { encoding: 'utf8', windowsHide: true });
  g('init', '-q');
  g('config', 'user.email', o.email || 'owner@example.com');
  g('config', 'user.name', o.name || 'Owner');
  g('config', 'commit.gpgsign', 'false');
  if (o.remote !== null) g('remote', 'add', 'origin', o.remote || 'https://github.com/acme/widgets.git');
  return { dir, git: g };
}

function commit(box, message, email) {
  box.git('add', '-A');
  const args = ['-c', 'user.email=' + (email || 'owner@example.com'), '-c', 'user.name=Someone', 'commit', '-q', '-m', message];
  return spawnSync('git', ['-C', box.dir].concat(args), { encoding: 'utf8', windowsHide: true });
}

// A scripted `gh`/`git`. Records calls so the TTL test can prove the cache
// actually prevented a probe rather than merely returning the same answer.
function fakeRunner(script) {
  const calls = [];
  const fn = (cmd, args, opts) => {
    calls.push({ cmd, args: args.slice(), opts });
    const hit = script(cmd, args, opts);
    return Object.assign({ ok: false, code: 1, stdout: '', stderr: '', error: null, timedOut: false }, hit || {});
  };
  fn.calls = calls;
  return fn;
}

function ghSays(payload) {
  return fakeRunner((cmd) => (cmd === 'gh'
    ? { ok: true, code: 0, stdout: typeof payload === 'string' ? payload : JSON.stringify(payload) }
    : { ok: true, code: 0, stdout: '' }));
}

const GH_REPO = { ok: true, root: '/tmp/x', slug: 'acme/widgets', host: 'github.com', is_github: true, remote: 'https://github.com/acme/widgets.git' };

// ------------------------------------------------------- remote parsing ----

test('remote URLs resolve to an owner/repo slug, and only github.com counts', () => {
  const rows = [
    ['https://github.com/acme/widgets.git', 'acme/widgets', true],
    ['https://github.com/acme/widgets', 'acme/widgets', true],
    ['https://user@github.com/acme/widgets.git', 'acme/widgets', true],
    ['git@github.com:acme/widgets.git', 'acme/widgets', true],
    ['ssh://git@github.com/acme/widgets.git', 'acme/widgets', true],
    ['https://gitlab.com/acme/widgets.git', 'acme/widgets', false],
    ['git@bitbucket.org:acme/widgets.git', 'acme/widgets', false],
  ];
  for (const [url, slug, isGithub] of rows) {
    const parsed = repo.parseRemote(url);
    assert.ok(parsed, url + ' must parse');
    assert.equal(parsed.slug, slug, url);
    assert.equal(parsed.is_github, isGithub, url);
  }
  assert.equal(repo.parseRemote(''), null);
  assert.equal(repo.parseRemote('not a url at all'), null);
});

// --------------------------------------------------- THE VERDICT MATRIX ----

test('section 6: only an affirmative isPrivate:true permits committing secrets', () => {
  const rows = [
    // [label, runner, expected private, expected reason]
    ['affirmative private', ghSays({ isPrivate: true }), true, 'affirmative_private'],
    ['affirmative public', ghSays({ isPrivate: false }), false, 'affirmative_public'],
    ['gh missing (ENOENT)', fakeRunner((c) => (c === 'gh' ? { error: 'ENOENT' } : { ok: true, code: 0 })), false, 'gh_missing'],
    ['gh not executable', fakeRunner((c) => (c === 'gh' ? { error: 'EACCES' } : { ok: true, code: 0 })), false, 'gh_missing'],
    ['gh timeout', fakeRunner((c) => (c === 'gh' ? { timedOut: true, error: 'ETIMEDOUT' } : { ok: true, code: 0 })), false, 'gh_timeout'],
    ['gh unauthenticated', fakeRunner((c) => (c === 'gh' ? { ok: false, code: 1, stderr: 'To get started with GitHub CLI, please run: gh auth login' } : { ok: true, code: 0 })), false, 'gh_unauthenticated'],
    ['gh HTTP 401', fakeRunner((c) => (c === 'gh' ? { ok: false, code: 1, stderr: 'HTTP 401: Bad credentials' } : { ok: true, code: 0 })), false, 'gh_unauthenticated'],
    ['gh 404 / other error', fakeRunner((c) => (c === 'gh' ? { ok: false, code: 1, stderr: 'GraphQL: Could not resolve to a Repository' } : { ok: true, code: 0 })), false, 'gh_error'],
    ['unparseable output', ghSays('<html>rate limited</html>'), false, 'ambiguous'],
    ['isPrivate as a string', ghSays({ isPrivate: 'true' }), false, 'ambiguous'],
    ['isPrivate missing', ghSays({ nameWithOwner: 'acme/widgets' }), false, 'ambiguous'],
    ['empty object', ghSays({}), false, 'ambiguous'],
    ['null answer', ghSays('null'), false, 'ambiguous'],
  ];
  for (const [label, runner, expectPrivate, expectReason] of rows) {
    const v = repo.probeVisibility(GH_REPO, { runner });
    assert.equal(v.private, expectPrivate, label + ': private');
    assert.equal(v.reason, expectReason, label + ': reason');
  }
});

test('section 6: no repo, no remote and a non-GitHub remote are all public', () => {
  const runner = ghSays({ isPrivate: true });     // gh would say private - it is never asked
  const rows = [
    [{ ok: false }, 'not_a_repo'],
    [{ ok: true, root: '/x', slug: null, is_github: false, reason: 'no_remote' }, 'no_remote'],
    [{ ok: true, root: '/x', slug: 'acme/widgets', is_github: false, reason: 'no_github_remote' }, 'no_github_remote'],
  ];
  for (const [detected, reason] of rows) {
    const v = repo.probeVisibility(detected, { runner });
    assert.equal(v.private, false, reason);
    assert.equal(v.reason, reason);
  }
  assert.equal(runner.calls.filter((c) => c.cmd === 'gh').length, 0, 'gh must not be probed without a github slug');
});

test('a boolean-looking-but-not-boolean payload never reaches the affirmative branch', () => {
  for (const payload of [{ isPrivate: 1 }, { isPrivate: 'yes' }, { isPrivate: [true] }, { isPrivate: { value: true } }]) {
    assert.equal(repo.probeVisibility(GH_REPO, { runner: ghSays(payload) }).private, false, JSON.stringify(payload));
  }
});

// ------------------------------------------------------------ TTL cache ----

test('section 6: the verdict is cached with a 600 s TTL, and re-probed past it', () => {
  assert.equal(repo.GUARD_TTL_MS, 600 * 1000, 'the TTL is frozen at 600 s');
  const state = stateLib.openState('w1', { dir: tmpDir('ttl') });
  const runner = ghSays({ isPrivate: true });
  const t0 = 1_000_000_000_000;

  const first = repo.guard({ repo: GH_REPO, state, runner, now: t0 });
  assert.equal(first.private, true);
  assert.equal(first.source, 'fresh');
  const probes1 = runner.calls.filter((c) => c.cmd === 'gh').length;
  assert.equal(probes1, 1);

  const cached = repo.guard({ repo: GH_REPO, state, runner, now: t0 + 599_000 });
  assert.equal(cached.source, 'cache');
  assert.equal(cached.private, true);
  assert.equal(runner.calls.filter((c) => c.cmd === 'gh').length, 1, 'inside the TTL the guard must not re-probe');

  const refreshed = repo.guard({ repo: GH_REPO, state, runner, now: t0 + 600_001 });
  assert.equal(refreshed.source, 'fresh');
  assert.equal(runner.calls.filter((c) => c.cmd === 'gh').length, 2, 'past the TTL the guard MUST re-probe');

  // --force re-probes regardless of age.
  repo.guard({ repo: GH_REPO, state, runner, now: t0 + 600_002, force: true });
  assert.equal(runner.calls.filter((c) => c.cmd === 'gh').length, 3);
});

test('section 6: a stale affirmative is NOT an affirmative', () => {
  const state = stateLib.openState('w2', { dir: tmpDir('stale') });
  const t0 = 1_000_000_000_000;
  repo.guard({ repo: GH_REPO, state, runner: ghSays({ isPrivate: true }), now: t0 });

  const fresh = repo.cachedVerdict(state, { now: t0 + 10_000 });
  assert.equal(fresh.private, true);
  assert.equal(fresh.stale, false);

  const stale = repo.cachedVerdict(state, { now: t0 + repo.GUARD_TTL_MS + 1 });
  assert.equal(stale.private, false, 'a stale affirmative must read as public');
  assert.equal(stale.verdict, 'public');
  assert.equal(stale.reason, 'stale_affirmative');
  assert.equal(stale.stale, true);
});

test('a cache read on a workspace that never ran the guard answers "unknown", not "private"', () => {
  const state = stateLib.openState('w3', { dir: tmpDir('none') });
  assert.equal(repo.cachedVerdict(state), null);
});

// ---------------------------------------------------- flip -> loud + rotate --

test('section 6 + PROTOCOL 10.2: a visibility flip with tracked secrets is loud and demands rotation', () => {
  const state = stateLib.openState('w4', { dir: tmpDir('flip') });
  const flags = state.session('session-a');
  const t0 = 1_000_000_000_000;

  const before = repo.guard({ repo: GH_REPO, state, runner: ghSays({ isPrivate: true }), now: t0 });
  assert.equal(before.private, true);

  const after = repo.guard({ repo: GH_REPO, state, runner: ghSays({ isPrivate: false }), now: t0 + repo.GUARD_TTL_MS + 1 });
  assert.equal(after.private, false);
  assert.equal(after.flip, true, 'the flip must be detected against the stored affirmative');
  assert.equal(after.previous, 'private');

  const tracked = { ok: true, any: true, tracked: ['.handshake/secret.json'], secrets: [{ file: '.handshake/secret.json', id: 'guarded-part-tracked' }] };
  const applied = repo.applyGuard({ state, flags, transport: 'relay', verdict: after, tracked });

  assert.equal(applied.hard_fail, true);
  assert.equal(applied.code, repo.LOUD_CODE);
  assert.equal(applied.report, true, 'the first hit of the session reports');
  assert.equal(applied.posting_stopped, true);
  assert.match(applied.message, /ROTATE the workspace secret/);
  assert.match(applied.message, /previously verified private/);
  assert.match(applied.message, /does NOT un-leak git history/);

  // PROTOCOL 10.2: posting stops on that transport for the rest of the session.
  assert.equal(flags.postingStopped('relay').code, repo.LOUD_CODE);
  assert.equal(repo.rotationDemanded(state), true);

  // ...and it is reported ONCE per session, not on every sync.
  const again = repo.applyGuard({ state, flags, transport: 'relay', verdict: after, tracked });
  assert.equal(again.hard_fail, true);
  assert.equal(again.report, false, 'a loud condition is reported once per session');

  // Only an explicit acknowledgement clears the demand - never a cache expiry.
  repo.acknowledgeRotation(state);
  assert.equal(repo.rotationDemanded(state), false);
});

test('a public repo with NO tracked secrets is not a hard fail - it just cannot commit them', () => {
  const state = stateLib.openState('w5', { dir: tmpDir('clean') });
  const flags = state.session('session-b');
  const verdict = repo.guard({ repo: GH_REPO, state, runner: ghSays({ isPrivate: false }) });
  const applied = repo.applyGuard({
    state, flags, transport: 'ntfy', verdict,
    tracked: { ok: true, any: false, tracked: ['.handshake/workspace.json'], secrets: [] },
  });
  assert.equal(applied.hard_fail, false);
  assert.equal(flags.postingStopped('ntfy'), null, 'posting must not stop when nothing is exposed');
  assert.equal(repo.rotationDemanded(state), false);
});

test('a repo that was public all along with a tracked secret hard-fails too, flip or no flip', () => {
  const state = stateLib.openState('w6', { dir: tmpDir('always') });
  const flags = state.session('session-c');
  const verdict = repo.guard({ repo: GH_REPO, state, runner: ghSays({ isPrivate: false }) });
  assert.equal(verdict.flip, false);
  const applied = repo.applyGuard({
    state, flags, transport: 'relay', verdict,
    tracked: { ok: true, any: true, tracked: [], secrets: [{ file: '.handshake/secret.json', id: 'guarded-part-tracked' }] },
  });
  assert.equal(applied.hard_fail, true, 'the leak is the tracked secret, not the transition');
  assert.equal(applied.report, true);
});

// ---------------------------------------------- real git: detect + checks --

test('detectRepo finds the working tree root and the origin slug', () => {
  const box = gitRepo();
  const detected = repo.detectRepo(box.dir);
  assert.equal(detected.ok, true);
  assert.equal(path.resolve(detected.root), path.resolve(box.dir));
  assert.equal(detected.slug, 'acme/widgets');
  assert.equal(detected.is_github, true);

  const sub = path.join(box.dir, 'a', 'b');
  fs.mkdirSync(sub, { recursive: true });
  assert.equal(path.resolve(repo.detectRepo(sub).root), path.resolve(box.dir), 'resolution walks up from a subdirectory');
});

test('detectRepo outside a working tree is not_a_repo, and that is a public verdict', () => {
  const dir = tmpDir('bare');
  const detected = repo.detectRepo(dir);
  assert.equal(detected.ok, false);
  assert.equal(detected.reason, 'not_a_repo');
  assert.equal(repo.probeVisibility(detected, { runner: ghSays({ isPrivate: true }) }).private, false);
});

test('a working tree with no remote is public, and gh is never asked', () => {
  const box = gitRepo({ remote: null });
  const detected = repo.detectRepo(box.dir);
  assert.equal(detected.ok, true);
  assert.equal(detected.reason, 'no_remote');
  const runner = ghSays({ isPrivate: true });
  assert.equal(repo.probeVisibility(detected, { runner }).private, false);
  assert.equal(runner.calls.length, 0);
});

test('trackedSecrets reports what git actually tracks, not what is on disk', () => {
  const box = gitRepo();
  const hs = path.join(box.dir, '.handshake');
  fs.mkdirSync(hs, { recursive: true });
  fs.writeFileSync(path.join(hs, 'workspace.json'), JSON.stringify({ public: { ws: 'a'.repeat(32) } }));
  fs.writeFileSync(path.join(hs, 'secret.json'), JSON.stringify({ secret: 'x'.repeat(43) }));
  fs.writeFileSync(path.join(hs, '.gitignore'), 'secret.json\n');
  commit(box, 'add handshake');

  const t = repo.trackedSecrets(box.dir);
  assert.equal(t.ok, true);
  assert.ok(t.tracked.includes('.handshake/workspace.json'));
  assert.equal(t.tracked.includes('.handshake/secret.json'), false, 'the gitignored guarded part is untracked');
  assert.equal(t.any, false, 'an untracked secret on disk is not a leak');

  // Now force it in, which is exactly the mistake the guard exists to catch.
  spawnSync('git', ['-C', box.dir, 'add', '-f', '.handshake/secret.json'], { encoding: 'utf8', windowsHide: true });
  commit(box, 'oops');
  const t2 = repo.trackedSecrets(box.dir);
  assert.equal(t2.any, true);
  assert.deepEqual(t2.secrets.map((s) => s.id), ['guarded-part-tracked']);
});

test('trackedSecrets also catches a credential pasted into a non-secret file', () => {
  const box = gitRepo();
  const hs = path.join(box.dir, '.handshake');
  fs.mkdirSync(hs, { recursive: true });
  fs.writeFileSync(path.join(hs, 'notes.md'), 'enrollment: hsk_' + 'a'.repeat(64) + '_deadbeef\n');
  commit(box, 'notes');
  const t = repo.trackedSecrets(box.dir);
  assert.equal(t.any, true);
  assert.equal(t.secrets[0].id, 'enrollment-token');
});

test('doctor check: token-in-history finds a credential that was committed and then removed', () => {
  const box = gitRepo();
  const file = path.join(box.dir, 'config.txt');
  fs.writeFileSync(file, 'token = hsk_' + 'b'.repeat(64) + '_cafebabe\n');
  commit(box, 'leak the token');
  fs.writeFileSync(file, 'token = (rotated)\n');
  commit(box, 'remove it');

  const hist = repo.tokenInHistory(box.dir);
  assert.equal(hist.ok, true);
  assert.ok(hist.hits.length >= 1, 'the removed credential is still in history - that is the point');
  // Needles are full credential SHAPES, not bare prefixes: scanning for "hsk_"
  // alone fired on this project's own docs and pattern definitions (24 false
  // positives), and a doctor that cries wolf is a doctor users ignore.
  assert.ok(hist.hits.some((h) => h.needle.startsWith('hsk_')), 'the enrollment-token shape matched');

  const clean = repo.tokenInHistory(gitRepo().dir);
  assert.equal(clean.ok, true);
  assert.deepEqual(clean.hits, []);
});

test('a history scan that cannot run is reported as unknown, never as clean', () => {
  const failing = fakeRunner(() => ({ ok: false, code: 128, stderr: 'fatal' }));
  const hist = repo.tokenInHistory('/anywhere', { runner: failing });
  assert.equal(hist.ok, false);
  assert.equal(hist.reason, 'git_error');
  assert.deepEqual(hist.hits, []);
  const timedOut = repo.tokenInHistory('/anywhere', { runner: fakeRunner(() => ({ timedOut: true, error: 'ETIMEDOUT' })) });
  assert.equal(timedOut.reason, 'timeout');
});

test('lastCommitEmail answers uncommitted rather than guessing', () => {
  const box = gitRepo();
  fs.writeFileSync(path.join(box.dir, 'a.txt'), 'hello\n');
  assert.equal(repo.lastCommitEmail(box.dir, 'a.txt').reason, 'uncommitted');
  commit(box, 'add a', 'alice@example.com');
  const last = repo.lastCommitEmail(box.dir, 'a.txt');
  assert.equal(last.ok, true);
  assert.equal(last.email, 'alice@example.com');
  assert.match(last.sha, /^[0-9a-f]{40}$/);
});

test('the runner never uses a shell, so a repo-supplied string cannot become shell syntax', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'repo.js'), 'utf8');
  assert.match(src, /shell: false/);
  // child_process.exec/execSync take a COMMAND STRING through a shell; a repo
  // name, branch or remote URL reaching one is a command-injection hole. Only
  // spawnSync (argv) may be imported here. (RegExp#exec is unrelated.)
  assert.match(src, /require\('child_process'\)/);
  assert.equal(/\bexecSync\b|child_process'\)\.exec\b|\bexec\s*,/.test(src), false, 'no exec/execSync: argv only');
  assert.equal(/require\('child_process'\)[\s\S]{0,80}\bexec\b/.test(src.slice(0, 2000)), false, 'child_process.exec must not be imported');
});
