'use strict';
// V2-PLAN 10.1 / 4.2 items 2 and 3, and section 4.4 rules 1-3, as the HUMAN
// meets them: the opt-in gate, the refusals, and the two read-only surfaces
// that have to say what the gate decided.
//
// WHY THIS FILE IS SEPARATE from test/state-branch.test.js. That file proves
// the write layer refuses correctly when it is called; this one proves the
// only thing a human ever actually touches - a real `bin/handshake.js` process,
// driven the way a terminal drives it, with its stdin, its exit code and every
// line it printed. Three of the properties below are FALSE of any check made
// inside the module and true only of the process:
//
//   1. `--yes` is refused. A flag is only refused by the argument parser that
//      reads it, and "the model may not pass --yes" is a claim about the CLI.
//   2. A proven child is refused BEFORE a workspace is even resolved.
//   3. The world-readable sentence is printed on exactly one arm. Which arm
//      printed which paragraph is a property of stdout, not of a return value.
//
// Everything runs against a real git repository with a real bare remote on
// disk, so nothing here reaches a network, and `gh` is never installed in the
// fixture - which is itself one of the arms under test.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const stateLib = require('../lib/state');
const sb = require('../lib/state-branch');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'handshake.js');
const DEAD_ENDPOINT = 'http://127.0.0.1:9';        // discard port: always refused

const temps = [];
after(() => {
  for (const d of temps) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
});

let n = 0;
function tmp(tag) {
  // realpathSync.native: a Windows 8.3 short name in the temp path makes every
  // repo-relative comparison below wrong [C test/shard-ref.test.js, same rule].
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hs-pair-' + tag + '-' + (n++) + '-')));
  temps.push(dir);
  return dir;
}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60000, windowsHide: true });
  assert.equal(r.status, 0, 'git ' + args.join(' ') + ': ' + (r.stdout || '') + (r.stderr || ''));
  return r.stdout || '';
}

// The test process runs inside a Claude Code session, which exports
// CLAUDE_CODE_CHILD_SESSION. Inheriting it would make every case below a
// proven child and the assertions would pass for the wrong reason.
function baseEnv(extra) {
  const env = Object.assign({}, process.env);
  for (const k of ['CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID',
    'HANDSHAKE_SESSION_ID', 'CLAUDE_PROJECT_DIR', 'CLAUDE_CONFIG_DIR']) delete env[k];
  return Object.assign(env, extra || {});
}

// A real repo with a real (file-path) remote and a real joined workspace. The
// remote is a bare repository on disk: every git operation below is real and
// none of them touches a network.
function box(tag, opts) {
  const o = opts || {};
  const root = tmp(tag);
  const bare = path.join(root, 'remote.git');
  const work = path.join(root, 'work');
  const data = path.join(root, 'data');
  fs.mkdirSync(bare); fs.mkdirSync(work);
  git(bare, ['init', '-q', '--bare', '--initial-branch=main']);
  git(work, ['init', '-q', '--initial-branch=main']);
  git(work, ['config', 'user.email', 'alex@example.com']);
  git(work, ['config', 'user.name', 'alex']);
  git(work, ['config', 'commit.gpgsign', 'false']);
  git(work, ['config', 'core.autocrlf', 'false']);
  if (o.remote !== false) git(work, ['remote', 'add', 'origin', bare.split(path.sep).join('/')]);
  fs.writeFileSync(path.join(work, 'README.md'), 'hi\n');
  git(work, ['add', '-A']);
  git(work, ['commit', '-q', '-m', 'first']);
  if (o.remote !== false) git(work, ['push', '-q', 'origin', 'main']);

  const b = { root, bare, work, data };
  cli(b, ['init', '--ntfy', DEAD_ENDPOINT, '--name', 'widgets', '--as', 'alex']);
  // Set AFTER the seed commit: a fixture that turns signing on first cannot
  // make its own first commit, and this test needs a repository with history
  // and signing on, which is the state a real developer is in.
  if (o.gpgsign === true) git(work, ['config', 'commit.gpgsign', 'true']);
  b.ws = JSON.parse(cli(b, ['status', '--json']).out).workspace.ws;
  b.state = stateLib.openState(b.ws, { env: { HANDSHAKE_STATE_DIR: data } });
  return b;
}

function cli(b, args, stdin, envExtra) {
  const r = spawnSync(process.execPath, [CLI].concat(args), {
    cwd: b.work, input: stdin === undefined ? '' : stdin, encoding: 'utf8', timeout: 60000,
    env: baseEnv(Object.assign({
      HANDSHAKE_STATE_DIR: b.data, HANDSHAKE_SKIP_HOST_CHECKS: '1',
    }, envExtra || {})),
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', all: (r.stdout || '') + (r.stderr || '') };
}

// The guard is fail-closed and cached in local state on a 600 s TTL
// [C lib/repo.js:25]. Seeding the cache is how a fixture with no `gh` on PATH
// reaches an arm other than "gh is missing" - and it is exactly what the real
// path does, because the gate reads the same cache.
function seedVerdict(b, fields) {
  b.state.update((s) => {
    s.repo_guard = Object.assign({
      private: false, reason: 'affirmative_public', checked_at: Date.now(),
      slug: 'acme/widgets', root: b.work,
    }, fields);
    return s;
  });
}

const WORLD_READABLE = /world-readable/i;

// ====================================================== the human-only gate ==

test('the gate refuses --yes and says confirmation must be typed', () => {
  const b = box('yes');
  seedVerdict(b, { private: true, reason: 'affirmative_private' });
  // `n` at the confirmation: the run must not be enabled, and the refusal of
  // --yes must be stated whether or not the human then says yes.
  const r = cli(b, ['pair', '--state-branch', '--yes'], 'n\n');
  assert.match(r.err, /--yes is not accepted for pair/,
    'section 4.2 item 3: the gate is join-shaped, and join refuses --yes [C bin/handshake.js:627]');
  assert.equal(sb.readOptIn(b.state).enabled, false, 'and --yes did not enable it');
});

test('--yes alone cannot enable it: the typed confirmation is still required', () => {
  const b = box('yes2');
  seedVerdict(b, { private: true, reason: 'affirmative_private' });
  const r = cli(b, ['pair', '--state-branch', '--yes'], '');   // stdin ends with no answer
  assert.equal(sb.readOptIn(b.state).enabled, false);
  assert.match(r.out, /not enabled/);
});

test('a proven child is refused, and nothing about the workspace is touched', () => {
  const b = box('child');
  seedVerdict(b, { private: true, reason: 'affirmative_private' });
  const r = cli(b, ['pair', '--state-branch'], 'y\ny\n', { CLAUDE_CODE_CHILD_SESSION: '1' });
  assert.equal(r.code, 3, 'the same exit code every other child refusal uses');
  assert.match(r.err, /child session \(PROTOCOL 7\.2 rule 1/);
  assert.equal(sb.readOptIn(b.state).enabled, false);
  assert.equal(fs.existsSync(path.join(b.state.dir, sb.OPT_IN_FILE)), false,
    'no opt-in file was even created');
});

test('the help text says the typed confirmation is a speed bump, not proof of consent', () => {
  const usage = require('../bin/handshake.js').USAGE;
  assert.match(usage, /pair\s+--state-branch/);
  assert.match(usage, /speed bump and an audit line, not proof of consent/,
    'section 4.2 item 3 / SECURITY.md 1.2: the model drives the terminal, so the gate is not consent');
});

// ================================================ ruling D2, the three arms ==

test('an affirmative PUBLIC verdict refuses, prints the world-readable sentence, and records nothing', () => {
  const b = box('public');
  seedVerdict(b, { private: false, reason: 'affirmative_public' });
  const r = cli(b, ['pair', '--state-branch'], 'nope\n');
  assert.match(r.out, WORLD_READABLE, 'ONLY this arm prints it, because only here is it true');
  assert.match(r.out, /This repository is PUBLIC/);
  assert.equal(r.code, 1);
  assert.match(r.err, /the automated push path stays OFF on a public repository/);
  assert.equal(sb.readOptIn(b.state).enabled, false, 'refused: no opt-in was recorded');
});

test('a PUBLIC verdict CAN be overridden, by a distinct typed phrase that names the consequence', () => {
  const b = box('public-ok');
  seedVerdict(b, { private: false, reason: 'affirmative_public' });
  const phrase = 'publish my in-progress work to a public repository';
  const r = cli(b, ['pair', '--state-branch'], phrase + '\ny\n');
  assert.equal(r.code, 0, r.all);
  const rec = sb.readOptIn(b.state);
  assert.equal(rec.enabled, true);
  assert.equal(rec.visibility.override, true, 'the override is RECORDED, not a setting nobody remembers making');
  assert.equal(rec.visibility.unprovable_confirmed, false);
  assert.equal(rec.visibility.verdict, 'public');
  // section 4.2 item 2: `unprovable` and `public, overridden` are never the
  // same word, on the screen or on the record.
  assert.match(cli(b, ['status']).out, /PUBLIC, overridden by a typed confirmation/);
});

test('the public override is not the same `y` that enables it on a private repo', () => {
  const b = box('public-y');
  seedVerdict(b, { private: false, reason: 'affirmative_public' });
  const r = cli(b, ['pair', '--state-branch'], 'y\ny\n');
  assert.equal(sb.readOptIn(b.state).enabled, false,
    'a bare y is what enables it on a PRIVATE repo; here it must not');
  assert.equal(r.code, 1);
});

test('a non-github.com remote records `unprovable`, NOT an override, and prints no world-readable sentence', () => {
  // The permanent case for every GitLab, Gitea, Bitbucket and self-hosted pair:
  // no install ever clears it, and asking such a human to certify that their
  // private repository is public is asking them to certify something false
  // (section 4.2 item 2, section 14 item 46).
  const b = box('unprovable');
  seedVerdict(b, { private: false, reason: 'no_github_remote' });
  const r = cli(b, ['pair', '--state-branch'], 'y\ny\n');
  assert.equal(r.code, 0, r.all);
  assert.doesNotMatch(r.out, WORLD_READABLE,
    'this arm must NOT print the world-readable sentence - it is not true here');
  assert.match(r.out, /Visibility cannot be proved for a non-github\.com remote/);
  assert.match(r.out, /Confirm yourself that/);
  const rec = sb.readOptIn(b.state);
  assert.equal(rec.enabled, true);
  assert.equal(rec.visibility.verdict, 'unprovable');
  assert.equal(rec.visibility.unprovable_confirmed, true);
  assert.equal(rec.visibility.override, false, 'recorded as unprovable and NEVER as an override of a public verdict');
  assert.match(cli(b, ['status']).out, /unprovable \(a non-github\.com remote/);
});

test('gh missing / unauthenticated refuses with the one command that clears it', () => {
  const b = box('gh');
  seedVerdict(b, { private: false, reason: 'gh_unauthenticated' });
  const r = cli(b, ['pair', '--state-branch'], 'y\ny\n');
  assert.equal(r.code, 1);
  assert.match(r.err, /install the GitHub CLI and run `gh auth login`/,
    'section 4.4 rule 2: a refusal names its cause AND the next move');
  assert.equal(sb.readOptIn(b.state).enabled, false);
  assert.doesNotMatch(r.all, WORLD_READABLE);
});

test('every refusal this gate can emit names a next move', () => {
  // section 4.4 rule 2, asserted as a rule rather than case by case: "a refusal
  // the human cannot act on is a stop wearing a gate's clothes."
  const arms = [
    { reason: 'gh_missing', private: false },
    { reason: 'gh_unauthenticated', private: false },
    { reason: 'affirmative_public', private: false },
    { reason: 'gh_error', private: false },
    { reason: 'ambiguous', private: false },
    { reason: 'stale_affirmative', private: false },
  ];
  const b = box('rule2');
  for (const arm of arms) {
    seedVerdict(b, arm);
    const r = cli(b, ['pair', '--state-branch'], 'no\n');
    assert.equal(r.code, 1, arm.reason + ' must refuse: ' + r.all);
    const text = r.all;
    const hasNextMove = /`[^`]+`/.test(text) || /Type exactly:/.test(text) || /re-run/i.test(text);
    assert.ok(hasNextMove, arm.reason + ' refused with no command, file or setting to act on:\n' + text);
  }
});

// ============================================== the three preconditions =====

test('commit.gpgsign on and unresolved refuses, states BOTH arms, and --allow-unsigned clears it', () => {
  const b = box('gpg', { gpgsign: true });
  seedVerdict(b, { private: true, reason: 'affirmative_private' });
  const refused = cli(b, ['pair', '--state-branch'], 'y\n');
  assert.equal(refused.code, 1, refused.all);
  assert.match(refused.err, /commit\.gpgsign/);
  assert.match(refused.err, /--allow-unsigned/, 'arm one: accept that the tool never signs');
  assert.match(refused.err, /git config commit\.gpgsign false/, 'arm two: turn it off for this repository');
  assert.equal(sb.readOptIn(b.state).enabled, false);

  const ok = cli(b, ['pair', '--state-branch', '--allow-unsigned'], 'y\n');
  assert.equal(ok.code, 0, ok.all);
  assert.equal(sb.readOptIn(b.state).enabled, true);
});

test('no remote at all refuses in the no-remote register, not the deferred one', () => {
  const b = box('noremote', { remote: false });
  seedVerdict(b, { private: false, reason: 'no_remote' });
  const r = cli(b, ['pair', '--state-branch'], 'y\ny\n');
  assert.equal(r.code, 1);
  assert.match(r.err, /no git remote/);
  assert.match(r.err, /rides your next\s+commit/, 'section 4.1: no remote is TODAY\'S BEHAVIOUR, said plainly');
  assert.match(r.err, /git remote add origin/);
  assert.equal(sb.readOptIn(b.state).enabled, false);
});

function seedWorkflows(b, spec) {
  const wf = path.join(b.work, '.github', 'workflows');
  fs.mkdirSync(wf, { recursive: true });
  for (const [name, body] of Object.entries(spec)) fs.writeFileSync(path.join(wf, name), body);
  return wf;
}

const PUSH_WF = 'on:\n  push:\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps: []\n';
const PRT_WF = 'on:\n  push:\n  pull_request_target:\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps: []\n';

test('four push-triggered workflows with no branch filter enable the path with no refusal', () => {
  // section 10.1's Tests, by fixture: "a repository with four push-triggered
  // workflows and no branch filter enables the automated push with no refusal".
  // `[skip ci]` is what makes that safe, so there is nothing here to gate on.
  const b = box('wf-push');
  seedVerdict(b, { private: true, reason: 'affirmative_private' });
  seedWorkflows(b, { 'ci.yml': PUSH_WF, 'lint.yml': PUSH_WF, 'release.yml': PUSH_WF, 'nightly.yml': PUSH_WF });

  const r = cli(b, ['pair', '--state-branch'], 'y\n');
  assert.equal(r.code, 0, 'four push-triggered workflows are not a refusal: ' + r.all);
  assert.equal(sb.readOptIn(b.state).enabled, true);
  // The NEGATIVE half of section 4.4 rule 3: the warning does not appear when
  // the condition it names does not exist, or it rots into decoration.
  assert.doesNotMatch(r.out, /pull_request_target/,
    'no workflow here uses it, so the warning must not print');
});

test('a pull_request_target workflow WARNS, names the file, and does not block', () => {
  // The owner's ruling of 2026-09-05: the preflight MAY read the workflow files,
  // read-only and bounded, to warn on this one trigger. Warn, never block.
  const b = box('wf-prt');
  seedVerdict(b, { private: true, reason: 'affirmative_private' });
  seedWorkflows(b, { 'ci.yml': PUSH_WF, 'label.yml': PRT_WF });

  const r = cli(b, ['pair', '--state-branch'], 'y\n');
  assert.equal(r.code, 0, 'a warning is not a gate: ' + r.all);
  assert.equal(sb.readOptIn(b.state).enabled, true, 'the opt-in still lands');
  assert.match(r.out, /warning: /);
  assert.match(r.out, /pull_request_target/);
  assert.match(r.out, /label\.yml/, 'rule 2: it names the file, not "one of your workflows"');
  assert.match(r.out, /a run per tool push/, 'and it names the cost');
});

test('NO HOOK PATH opens a workflow file - the read lives in the typed verb only', () => {
  // The plan sentence "no workflow file is opened by any path in this stage" is
  // scoped to HOOK paths by the same ruling, and this is that assertion,
  // stated exactly: every module a hook, the monitor or the beat can reach is
  // free of `.github`, and the one reader is bin/handshake.js's `cmdPair`.
  const hookReachable = [
    'hooks/session-start.js', 'hooks/session-end.js', 'hooks/stop.js', 'hooks/common.js',
    'hooks/post-tool-use.js', 'hooks/user-prompt-submit.js', 'hooks/sync.js', 'hooks/render.js',
    'monitors/heartbeat.js',
    'lib/state-branch.js', 'lib/shard-scan.js', 'lib/workspace-files.js', 'lib/repo.js', 'lib/state.js',
  ];
  for (const rel of hookReachable) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    const codeOnly = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.doesNotMatch(codeOnly, /\.github/,
      rel + ' names a workflow path, and it is reachable from a hook; section 10.1 forbids that');
  }
  // And the reader that does exist is called from exactly one place.
  const cliSrc = fs.readFileSync(CLI, 'utf8');
  const calls = cliSrc.split('\n').filter((l) => /workflowPullRequestTarget\(/.test(l) && !/^function /.test(l.trim()));
  assert.equal(calls.length, 1, 'the workflow read must have exactly one call site, in cmdPair');
});

test('NO path in this product WRITES a workflow file or EXECUTES one', () => {
  // The plan's flat "no workflow is read" cannot survive its own demand for the
  // `pull_request_target` warning, so the ruling of 2026-09-05 scopes the ban:
  // hook, monitor and lib paths open nothing (the test above), and the property
  // that holds ABSOLUTELY everywhere - including inside the typed verb - is
  // this one. A read cannot start a CI run; a write or a spawn can.
  const dirs = ['bin', 'hooks', 'lib', 'monitors'];
  const WRITE = /(writeFileSync|appendFileSync|rmSync|unlinkSync|renameSync|copyFileSync|mkdirSync|createWriteStream|writeFile\()/;
  const EXEC = /(spawnSync|spawn\(|execSync|execFile|exec\()/;
  let files = 0;
  for (const dir of dirs) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
      if (!name.endsWith('.js')) continue;
      files++;
      const src = fs.readFileSync(path.join(abs, name), 'utf8');
      src.split('\n').forEach((line, i) => {
        if (!/\.github|workflows/.test(line)) return;
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;                 // a comment about them is fine
        assert.doesNotMatch(line, WRITE, dir + '/' + name + ':' + (i + 1) + ' writes a workflow path');
        assert.doesNotMatch(line, EXEC, dir + '/' + name + ':' + (i + 1) + ' executes something at a workflow path');
      });
    }
  }
  assert.ok(files > 10, 'the scan must have covered the product: ' + files);

  // The one reader is bounded on BOTH axes - how many files and how big each
  // one may be - so a repository with a thousand workflows, or one enormous
  // one, cannot turn a typed verb into a walk of the tree.
  const cliSrc = fs.readFileSync(CLI, 'utf8');
  const maxFiles = Number((/const WF_MAX_FILES = (\d+)/.exec(cliSrc) || [])[1]);
  assert.ok(Number.isFinite(maxFiles) && maxFiles > 0 && maxFiles <= 64, 'a file-count bound: ' + maxFiles);
  assert.match(cliSrc, /const WF_MAX_BYTES = 256 \* 1024;/, 'a per-file byte bound');
  assert.match(cliSrc, /names\.length > WF_MAX_FILES/, 'the count bound must be enforced, not merely declared');
  assert.match(cliSrc, /st\.size > WF_MAX_BYTES/, 'the byte bound must be enforced, not merely declared');
});

test('the workflow read is bounded: an oversized file is skipped and SAID, never read whole', () => {
  const b = box('wf-big');
  seedVerdict(b, { private: true, reason: 'affirmative_private' });
  const wf = seedWorkflows(b, { 'ci.yml': PUSH_WF });
  // 300 KB, past the 256 KB cap, and it DOES contain the trigger - so a reader
  // that ignored its own bound would warn, and one that honours it says it
  // could not look instead of saying nothing.
  fs.writeFileSync(path.join(wf, 'huge.yml'), 'on:\n  pull_request_target:\n' + ('#' + 'x'.repeat(120) + '\n').repeat(2600));
  assert.ok(fs.statSync(path.join(wf, 'huge.yml')).size > 256 * 1024);

  const r = cli(b, ['pair', '--state-branch'], 'y\n');
  assert.equal(r.code, 0, r.all);
  assert.match(r.out, /huge\.yml/);
  assert.match(r.out, /could not be read/);
});

// ========================================================= --revoke =========

test('--revoke removes the opt-in and lists both delete commands, deleting nothing', () => {
  const b = box('revoke');
  seedVerdict(b, { private: true, reason: 'affirmative_private' });
  assert.equal(cli(b, ['pair', '--state-branch'], 'y\n').code, 0);
  assert.equal(sb.readOptIn(b.state).enabled, true);

  const r = cli(b, ['pair', '--state-branch', '--revoke']);
  assert.equal(r.code, 0, r.all);
  assert.equal(sb.readOptIn(b.state).enabled, false);
  assert.match(r.out, /git push origin --delete handshake\/state/);
  assert.match(r.out, /git branch -D handshake\/state/);
  assert.match(r.out, /never deletes a branch/);
});

test('there is exactly ONE record of the opt-in, and no second enable survives --revoke', () => {
  // section 4.2 item 3's gate is supposed to have exactly one record. An
  // earlier revision let `hooks/session-start.js` fall back to a `state_branch`
  // key inside `state.json` when the write half could not be required - a
  // second, undocumented enable that `--revoke` never cleared, in the one file
  // section 10.1's Touches deliberately keep this marker OUT of because hooks
  // read-modify-write it on hot paths.
  const b = box('revoke-one');
  seedVerdict(b, { private: true, reason: 'affirmative_private' });
  assert.equal(cli(b, ['pair', '--state-branch'], 'y\n').code, 0);
  b.state.update((s) => { s.state_branch = true; return s; });     // the ghost enable
  assert.equal(cli(b, ['pair', '--state-branch', '--revoke']).code, 0);
  assert.equal(sb.readOptIn(b.state).enabled, false);
  assert.equal(fs.existsSync(sb.optInPath(b.state)), false, 'the one record is gone');

  // And nothing reads the ghost: the fetch gate asks lib/state-branch.js and
  // asks nothing else.
  const src = fs.readFileSync(path.join(ROOT, 'hooks', 'session-start.js'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.doesNotMatch(code, /cfg\.state_branch|\.state_branch\b/,
    'a second enable in state.json is a gate --revoke cannot clear');
  assert.match(code, /require\('\.\.\/lib\/state-branch'\)/);
  assert.match(code, /readOptIn/);
});

// ================================== section 4.4 rule 1: the `push:` line ====

test('BEFORE the opt-in both surfaces still carry exactly one push: line - always populated', () => {
  // Section 4.4 rule 1: "One field, one place, always filled in". An earlier
  // build printed no field at all before the opt-in and argued the off state
  // was rule 3's business; the owner ruled on 2026-09-05 that "always" means
  // always and admitted the tenth Stage 1 word for it. Rule 3's own sentence is
  // printed beside it, because one closed-set value is not an explanation.
  const b = box('pushline');
  for (const verb of ['status', 'branches']) {
    const r = cli(b, [verb]);
    assert.equal(r.code, 0, verb + ': ' + r.all);
    const lines = r.out.split('\n').filter((l) => /^\s*push:/.test(l));
    assert.equal(lines.length, 1, verb + ' must carry exactly one push: line, in every state of the world');
    assert.equal(lines[0].trim(), 'push: ' + sb.PUSH_STATES.not_enabled);
    assert.equal(sb.pushWord(sb.PUSH_STATES.not_enabled), sb.NOT_ENABLED_WORD);
    assert.match(lines[0], /handshake pair --state-branch/, 'rule 2: a next move on the field itself');
    // The counters stay behind the capability: a deferred count for a path
    // that has never run is decoration, not information.
    assert.equal(r.out.split('\n').filter((l) => /^\s*deferred:/.test(l)).length, 0, verb);
    const off = r.out.split('\n').find((l) => /not enabled on this machine/.test(l));
    assert.ok(off, verb + ' must say the capability is off: ' + r.out);
    assert.match(off, /handshake pair --state-branch/, 'rule 2: a next move, not a bare verdict');
  }
});

test('after the opt-in BOTH surfaces carry exactly one push: line, always populated', () => {
  const b = box('pushline-on');
  seedVerdict(b, { private: true, reason: 'affirmative_private' });
  assert.equal(cli(b, ['pair', '--state-branch'], 'y\n').code, 0);
  for (const verb of ['status', 'branches']) {
    const r = cli(b, [verb]);
    assert.equal(r.code, 0, verb + ': ' + r.all);
    const lines = r.out.split('\n').filter((l) => /^\s*push:/.test(l));
    assert.equal(lines.length, 1, verb + ' must carry exactly one push: line');
    const value = lines[0].replace(/^\s*push:\s*/, '');
    assert.ok(value.length > 0, 'always POPULATED');
    assert.ok(sb.STAGE1_PUSH_STATES.some((s) => value === s || value.startsWith(s)),
      verb + ' printed a push: value outside the closed ten: ' + value);
    assert.notEqual(value, sb.PUSH_STATES.not_enabled, 'and the off word is gone once it is on');
    assert.doesNotMatch(r.out, /not enabled on this machine/, 'and the off line is gone');
  }
});

test('every Stage 1 push: value is reachable and prints itself and no other', () => {
  // section 4.4 rule 1: "a state reachable by no test at the stage that owns it
  // is a state that may not ship." All TEN are driven here: nine through the
  // recorded beat, which is exactly how a real one reaches `status`, and the
  // tenth - `off — not enabled` - through the absence of an opt-in, which is
  // the only way it can be reached and is asserted in its own test above.
  const b = box('vocab');
  const beforeOptIn = cli(b, ['status']).out.split('\n').find((l) => /^\s*push:/.test(l));
  assert.equal(beforeOptIn.trim(), 'push: ' + sb.PUSH_STATES.not_enabled);
  seedVerdict(b, { private: true, reason: 'affirmative_private' });
  assert.equal(cli(b, ['pair', '--state-branch'], 'y\n').code, 0);

  const reachable = [
    sb.PUSH_STATES.pushing,
    sb.PUSH_STATES.gh_unauthenticated,
    sb.PUSH_STATES.visibility_unproven,
    sb.PUSH_STATES.forge_rejected + 'refusing to allow an OAuth App to create a branch',
    sb.PUSH_STATES.deferred,
    sb.PUSH_STATES.deferred_attempts,
    sb.PUSH_STATES.offline,
    sb.PUSH_STATES.no_remote,
    sb.PUSH_STATES.paused_checked_out,
  ];
  assert.equal(reachable.length + 1, sb.STAGE1_PUSH_STATES.length,
    'every word in the closed set is driven here, and no word is driven that is not in it');
  const all = sb.STAGE1_PUSH_STATES;
  for (const value of reachable) {
    stateLib.writeStateBeat(b.state, { at: Date.now(), outcome: 'x', push: value, where: 'test' });
    const line = cli(b, ['status']).out.split('\n').find((l) => /^\s*push:/.test(l));
    assert.ok(line, 'no push: line for ' + value);
    assert.equal(line.trim(), 'push: ' + value);
    // ...and no OTHER value from the closed set appears on that line.
    for (const other of all) {
      if (value.startsWith(other) || other.startsWith(value)) continue;
      assert.ok(!line.includes(other), value + ' printed ' + other + ' as well');
    }
  }
});

test('the one Stage 2 word Stage 1 reaches early prints itself too', () => {
  // `refused — secret scan, <file>` belongs to Stage 2 in the plan because the
  // full scanner does. Stage 1 reaches it anyway: section 4.2 item 1 is an
  // ungated guardrail and Stage 1 is the stage that removes the human commit
  // between a shard and the remote, so it runs the scan and can refuse. The
  // WORD is unchanged and the closed set does not grow - only the stage that
  // first prints it does, which is the ratification this array asks for.
  const b = box('vocab-scan');
  seedVerdict(b, { private: true, reason: 'affirmative_private' });
  assert.equal(cli(b, ['pair', '--state-branch'], 'y\n').code, 0);
  const value = sb.PUSH_STATES.secret_scan + '.handshake/tasks/alex.md';
  stateLib.writeStateBeat(b.state, { at: Date.now(), outcome: 'refused', push: value, where: 'test' });
  const line = cli(b, ['status']).out.split('\n').find((l) => /^\s*push:/.test(l));
  assert.ok(line, 'no push: line at all');
  assert.equal(line.trim(), 'push: ' + value);
  assert.deepEqual(sb.STAGE1_PROPOSED_PUSH_STATES, [sb.PUSH_STATES.secret_scan]);
  assert.equal(sb.STAGE1_REACHABLE_PUSH_STATES.length, sb.STAGE1_PUSH_STATES.length + 1);
});

test('a refusal the closed vocabulary has no word for still names its cause and its next move', () => {
  // Two Stage 1 refusals carry no `push:` word - the shard is past the 256 KB
  // cap every peer reads through, and git is not on PATH. Neither drains by
  // waiting and neither is any of the ten, so the derived `push:` field would
  // say `pushing` while every beat refuses. Rule 2 is discharged on its own
  // line until rule 1 gets an eleventh word, which needs a ruling.
  const b = box('refusal-line');
  seedVerdict(b, { private: true, reason: 'affirmative_private' });
  assert.equal(cli(b, ['pair', '--state-branch'], 'y\n').code, 0);

  stateLib.writeStateBeat(b.state, {
    at: Date.now(), outcome: 'refused', reason: 'shard_too_large', push: null, where: 'test',
    detail: '.handshake/tasks/alex.md is 400000 bytes, past the 262144-byte shard cap',
  });
  let out = cli(b, ['status']).out;
  assert.match(out, /refused: \.handshake\/tasks\/alex\.md is 400000 bytes/);
  assert.match(out, /trim or rotate that shard/, 'rule 2: a next move, not a bare verdict');

  stateLib.writeStateBeat(b.state, {
    at: Date.now(), outcome: 'refused', reason: 'git_missing', push: null, where: 'test',
    detail: 'git is not installed or not on PATH',
  });
  out = cli(b, ['status']).out;
  assert.match(out, /refused: git is not installed or not on PATH/);
  assert.match(out, /install git, or put it on PATH/);

  // The negative half: an ordinary beat prints no refusal line, or the line
  // rots into decoration.
  stateLib.writeStateBeat(b.state, {
    at: Date.now(), outcome: 'ok', reason: null, push: sb.PUSH_STATES.pushing, where: 'test',
  });
  assert.doesNotMatch(cli(b, ['status']).out, /refused:/);
});

test('status names the deferred count, the fetch duration and whether the scan was truncated', () => {
  const b = box('numbers');
  seedVerdict(b, { private: true, reason: 'affirmative_private' });
  assert.equal(cli(b, ['pair', '--state-branch'], 'y\n').code, 0);

  sb.bumpDeferred(b.state, 'offline');
  sb.bumpDeferred(b.state, 'offline');
  stateLib.writeStateBeat(b.state, { at: Date.now(), outcome: 'offline', push: sb.PUSH_STATES.offline, where: 'test' });
  // The knowledge cache is the read half's own record of the SessionStart
  // fetch [C lib/shard-scan.js sessionStartScan].
  fs.writeFileSync(path.join(b.state.dir, 'knowledge.json'), JSON.stringify({
    v: 1, scan_session: 's1', records: [], source: 'ref', fetch_ms: 412,
    fetch_reason: null, scan_truncated: true,
  }));

  const out = cli(b, ['status']).out;
  assert.match(out, /deferred: 2 \(offline\)/, 'a climbing deferred count says which of the three it is');
  assert.match(out, /last SessionStart fetch: 412 ms/);
  assert.match(out, /shard scan: TRUNCATED/);
});

test('the late-not-lost line appears only when a batch really was recovered', () => {
  const b = box('late');
  seedVerdict(b, { private: true, reason: 'affirmative_private' });
  assert.equal(cli(b, ['pair', '--state-branch'], 'y\n').code, 0);
  assert.doesNotMatch(cli(b, ['status']).out, /left over from your last session/,
    'the negative assertion: the line must not become decoration');

  stateLib.writeStateBeat(b.state, {
    at: Date.now(), outcome: 'ok', push: sb.PUSH_STATES.pushing, where: 'session_start', late_flush: true,
  });
  assert.match(cli(b, ['status']).out, /committed a batch left over from your last session - late instead of lost/);
});

// ============================== section 4.4 rule 3: the derived asymmetry ===

test('a peer with no shard on the state branch is named; a peer with one is not', () => {
  const b = box('rule3');
  seedVerdict(b, { private: true, reason: 'affirmative_private' });
  assert.equal(cli(b, ['pair', '--state-branch'], 'y\n').code, 0);
  b.state.setPeers({ members: [{ member: 'bob', name: 'bob' }, { member: 'carol', name: 'carol' }], claims: [], presence: [], at: Date.now() });

  // WITH THE NETWORK REFUSED and nothing fetched, nothing may be claimed about
  // either peer. The honest line says what is unknown and what resolves it -
  // the negative half of rule 3, and the arm that stops "not enabled yet" from
  // being printed on evidence this side does not have.
  let out = cli(b, ['branches', '--no-network']).out;
  assert.match(out, /peer state branches: unknown/);
  assert.doesNotMatch(out, /bob: no state branch/);
  assert.doesNotMatch(out, /carol: no state branch/);

  // AND THE POSITIVE CLAIM IS DERIVED FROM `ls-remote`, NOT FROM A LOCAL REF -
  // section 10.1's Tests say so in those words. Nothing has been fetched into
  // this clone at all here; the remote itself is what answers, and it proves
  // the branch absent. The measured failure this closes is the opposite: a
  // clone whose last fetch predated the peer's opt-in printing "bob: not
  // enabled yet" about a bob who had opted in and pushed.
  out = cli(b, ['branches']).out;
  assert.doesNotMatch(out, /peer state branches: unknown/);
  assert.match(out, /bob: no state branch on the remote — not enabled yet/);
  assert.match(out, /carol: no state branch on the remote — not enabled yet/);

  // Now bob's shard exists on the branch and carol's does not. Built with plain
  // plumbing so this test does not depend on the write half, and PUSHED, so the
  // remote's answer and this clone's ref are the same sha.
  const rel = '.handshake/tasks/bob.md';
  const blobFile = path.join(b.root, 'bob.md');
  fs.writeFileSync(blobFile, '# bob\n');
  const sha = git(b.work, ['hash-object', '-w', '--', blobFile]).trim();
  const idx = path.join(b.root, 'idx');
  const env = Object.assign({}, process.env, { GIT_INDEX_FILE: idx });
  spawnSync('git', ['update-index', '--add', '--cacheinfo', '100644,' + sha + ',' + rel],
    { cwd: b.work, env, encoding: 'utf8' });
  const tree = spawnSync('git', ['write-tree'], { cwd: b.work, env, encoding: 'utf8' }).stdout.trim();

  // (a) A HAND-BUILT TREE, committed by somebody who is not this tool. Presence
  //     in a SHARED tree is not proof the peer's tool wrote it: every opted-in
  //     member pushes to this branch and the write allowlist is enforced only
  //     on the writer's own side, so a member who wanted to could add a file
  //     with another member's derived shard name and suppress their line. The
  //     one locally derivable counter-fact is the COMMITTER.
  const byHand = git(b.work, ['commit-tree', tree, '-m', 'state [skip ci]']).trim();
  git(b.work, ['push', '-q', 'origin', byHand + ':refs/heads/handshake/state']);
  git(b.work, ['update-ref', 'refs/remotes/origin/handshake/state', byHand]);
  out = cli(b, ['branches']).out;
  assert.doesNotMatch(out, /bob: no state branch/, 'the file IS there, so the absent line must not print');
  assert.match(out, /bob: state branch presence unproven/,
    'and presence alone may not be reported as the peer having opted in');
  assert.match(out, /carol: no state branch on the remote — not enabled yet/);

  // (b) The same tree, committed by the TOOL - which is what the write half
  //     does on every batch. Now bob has really opted in and gets no line at
  //     all, which is the negative assertion that stops rule 3's line from
  //     rotting into decoration.
  const byTool = spawnSync('git', ['commit-tree', tree, '-m', 'handshake state: bob\n\n[skip ci]'], {
    cwd: b.work, encoding: 'utf8',
    env: Object.assign({}, process.env, {
      GIT_COMMITTER_NAME: sb.TOOL_IDENTITY.name, GIT_COMMITTER_EMAIL: sb.TOOL_IDENTITY.email,
      GIT_AUTHOR_NAME: 'bob', GIT_AUTHOR_EMAIL: 'bob@example.com',
    }),
  }).stdout.trim();
  git(b.work, ['push', '-q', '-f', 'origin', byTool + ':refs/heads/handshake/state']);
  git(b.work, ['update-ref', 'refs/remotes/origin/handshake/state', byTool]);
  out = cli(b, ['branches']).out;
  assert.doesNotMatch(out, /bob: /, 'bob HAS opted in - every line about bob must disappear: ' + out);
  assert.match(out, /carol: no state branch on the remote — not enabled yet/);
});

test('a clone behind the remote says so rather than claiming the peer has not opted in', () => {
  // The staleness arm of section 4.4 rule 3. `ls-remote` answers `present` at a
  // sha this clone does not hold, so the local tree may not be read for the
  // peer roster at all - it is evidence about the past.
  const b = box('rule3-stale');
  seedVerdict(b, { private: true, reason: 'affirmative_private' });
  assert.equal(cli(b, ['pair', '--state-branch'], 'y\n').code, 0);
  b.state.setPeers({ members: [{ member: 'bob', name: 'bob' }], claims: [], presence: [], at: Date.now() });

  // A state branch on the REMOTE that this clone has never fetched.
  const other = path.join(b.root, 'other');
  fs.mkdirSync(other);
  git(other, ['init', '-q', '--initial-branch=main']);
  git(other, ['config', 'user.email', 'bob@example.com']);
  git(other, ['config', 'user.name', 'bob']);
  git(other, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(other, 'x.md'), '# bob\n');
  git(other, ['add', '-A']);
  git(other, ['commit', '-q', '-m', 'state [skip ci]']);
  git(other, ['push', '-q', b.bare.split(path.sep).join('/'), 'HEAD:refs/heads/handshake/state']);

  const out = cli(b, ['branches']).out;
  assert.match(out, /peer state branches: unknown/,
    'the branch exists on the remote and is not in this clone: nothing may be claimed');
  assert.doesNotMatch(out, /bob: no state branch/);
});

test('the headless clause is printed when there is no monitor and not when there is one', () => {
  const b = box('headless');
  const HEADLESS = /headless: state pushes ride the Stop hook, peer-branch evaluation is off/;
  assert.match(cli(b, ['status']).out, HEADLESS, 'no monitor: the second half of section 4.4 rule 3\'s clause');

  // lib/session.js decides what "a monitor is running" means; a fresh
  // monitor.alive sentinel is that verdict's own input.
  fs.writeFileSync(path.join(b.state.dir, 'monitor.alive'), String(Date.now()) + '\n');
  assert.doesNotMatch(cli(b, ['status']).out, HEADLESS,
    'a session WITH a monitor prints neither clause - the negative assertion again');
});

// ======================================================= handshake branches ==

test('branches reports the state branch and BOTH delete commands, and its ONE network call is bounded', () => {
  // THE TITLE USED TO SAY "and makes no network call" AND THE SUITE ITSELF
  // DISPROVED IT: the rule-3 staleness test above passes only because the
  // `ls-remote` probe reaches the bare remote. `branches` is read-only - it
  // writes nothing and moves no ref - but it is not offline, and the command
  // doc is what the model consults before running a verb unprompted, so the
  // bound is asserted here and the doc's claim is asserted with it.
  assert.ok(sb.LSREMOTE_CEILING_MS <= 2000,
    'the one probe behind the peer lines is bounded at 2 s: ' + sb.LSREMOTE_CEILING_MS);
  const cliSrc = fs.readFileSync(path.join(ROOT, 'bin', 'handshake.js'), 'utf8');
  assert.match(cliSrc, /timeout: stateBranch\.LSREMOTE_CEILING_MS/,
    'the probe must take the ceiling, not a fresh default');
  const docSrc = fs.readFileSync(path.join(ROOT, 'commands', 'handshake.md'), 'utf8');
  assert.doesNotMatch(docSrc, /makes no network call/,
    'commands/handshake.md may not tell the model a verb is offline when it spawns `ls-remote`');
  assert.match(docSrc, /branches \[--json\] \[--no-network\]/,
    'and the row must carry the flag that actually turns the probe off');

  const b = box('branches');
  seedVerdict(b, { private: true, reason: 'affirmative_private' });
  assert.equal(cli(b, ['pair', '--state-branch'], 'y\n').code, 0);

  const before = cli(b, ['branches']).out;
  assert.match(before, /no handshake\/state ref yet/);

  // One real state commit, by the real write layer.
  fs.mkdirSync(path.join(b.work, '.handshake', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(b.work, '.handshake', 'tasks', 'alex.md'), '# alex\n- learned something\n');
  const res = sb.runBeat({
    root: b.work, state: b.state, member: 'alex',
    verdict: { private: true, verdict: 'private', reason: 'affirmative_private', explanation: 'x' },
  });
  assert.equal(res.outcome, sb.OUTCOMES.ok, JSON.stringify(res));

  const after = cli(b, ['branches']);
  assert.equal(after.code, 0, after.all);
  assert.match(after.out, /on this clone: 1 commit\(s\), \d/);
  assert.match(after.out, /git push origin --delete handshake\/state/);
  assert.match(after.out, /git branch -D handshake\/state/);
  assert.match(after.out, /three refs, forever/i, 'the arithmetic, not reassurance (section 4.1)');
  assert.match(after.out, /also carries the LOCAL copies/, 'the clause about your own git branch');

  const asJson = JSON.parse(cli(b, ['branches', '--json']).out);
  assert.equal(asJson.state_branch.commits, 1);
  assert.equal(asJson.state_branch.enabled, true);
  assert.equal(asJson.delete.remote, 'git push origin --delete handshake/state');
  assert.equal(asJson.delete.local, 'git branch -D handshake/state');
});

test('scrub says the tool never commits to a branch you work on, and lists the refs it leaves', () => {
  const b = box('scrub');
  seedVerdict(b, { private: true, reason: 'affirmative_private' });
  assert.equal(cli(b, ['pair', '--state-branch'], 'y\n').code, 0);
  fs.mkdirSync(path.join(b.work, '.handshake', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(b.work, '.handshake', 'tasks', 'alex.md'), '# alex\n- x\n');
  sb.runBeat({
    root: b.work, state: b.state, member: 'alex',
    verdict: { private: true, verdict: 'private', reason: 'affirmative_private', explanation: 'x' },
  });

  const r = cli(b, ['scrub', '--yes']);
  assert.equal(r.code, 0, r.all);
  assert.match(r.out, /never commits to a\s+branch you work on/,
    'the old sentence ("never makes a coordination-only commit") is false from this stage on');
  assert.match(r.out, /REFS THIS DOES NOT TOUCH/);
  assert.match(r.out, /git push origin --delete handshake\/state/);
  assert.match(r.out, /git branch -D handshake\/state/);
  // ...and it deleted neither.
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '-q', 'refs/heads/handshake/state'],
    { cwd: b.work, encoding: 'utf8' }).status, 0, 'scrub LISTS refs; it never deletes a branch');
});
