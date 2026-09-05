'use strict';
// Stage 1 (V2-PLAN section 10.1): the git write layer for `handshake/state`.
//
// The load-bearing tests in this file are the INVARIANT ones. This is the first
// code in the product that writes a git ref without a human in the way, and the
// failure mode it exists to make impossible is silent loss of uncommitted human
// work: `.git/index` read or written, `HEAD` moved, a checkout performed. Every
// one of those is asserted byte-identical across a hundred automated commits on
// a dirty tree, because the obvious implementation (`checkout --orphan` + `add`
// + `commit`) passes a "`git log main` is byte-identical" test while destroying
// exactly that.
//
// Real git in tmpdir repos for the plumbing; the injected runner for the
// negative assertions - "refused with NO git process spawned" is only provable
// by counting the calls that were not made.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const sb = require('../lib/state-branch');
const stateLib = require('../lib/state');

let n = 0;
function tmpDir(tag) {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hs-sbr-' + (tag || '') + (n++) + '-')));
}

const WS = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

// Identity and the two settings that make a scratch repo deterministic are
// passed with -c on every call, so nothing here reads the developer's config.
function raw(dir, args) {
  return spawnSync('git', ['-C', dir,
    '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false',
    '-c', 'user.email=owner@example.com', '-c', 'user.name=Owner',
  ].concat(args), { encoding: 'utf8', windowsHide: true });
}
function g(dir, ...args) {
  const r = raw(dir, args);
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ' failed: ' + (r.stderr || r.stdout));
  return String(r.stdout || '');
}

function makeRepo(opts) {
  const o = opts || {};
  const dir = tmpDir('repo');
  g(dir, '-c', 'init.defaultBranch=main', 'init', '-q');
  g(dir, 'config', 'user.email', 'owner@example.com');
  g(dir, 'config', 'user.name', 'Owner');
  g(dir, 'config', 'commit.gpgsign', 'false');
  g(dir, 'config', 'core.autocrlf', 'false');
  if (o.remote !== null) g(dir, 'remote', 'add', 'origin', o.remote || 'https://github.com/acme/widgets.git');
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n');
  g(dir, 'add', '-A');
  g(dir, 'commit', '-q', '-m', 'first');
  return dir;
}

function makeState(tag) {
  const dir = tmpDir('state' + (tag || ''));
  const st = stateLib.openState(WS, { dir });
  st.ensure();
  return st;
}

function writeShard(root, member, body) {
  const rel = sb.allowlistFor(member)[0];
  const abs = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, 'utf8');
  return { rel, abs };
}

function optIn(state, visibility) {
  return sb.writeOptIn(state, {
    enabled: true,
    visibility: Object.assign({ verdict: 'private', reason: 'affirmative_private' }, visibility || {}),
  });
}

const PRIVATE = { private: true, verdict: 'private', reason: 'affirmative_private', explanation: 'gh reported isPrivate: true' };

// A scripted runner. Records every (cmd, args, opts) so a test can assert on
// the argv that was NOT emitted, which is the only way to prove "no git
// process spawned".
function fakeRunner(script) {
  const calls = [];
  const fn = (cmd, args, opts) => {
    calls.push({ cmd, args: args.slice(), opts: opts || {} });
    const hit = script ? script(cmd, args, opts, calls) : null;
    return Object.assign({ ok: false, code: 1, stdout: '', stderr: '', error: null, timedOut: false }, hit || {});
  };
  fn.calls = calls;
  return fn;
}

// Delegates to the real git but records every call, so the invariant tests can
// scan the whole argv corpus of a real run for a bare `--force`.
function recordingRunner() {
  const repoLib = require('../lib/repo');
  const calls = [];
  const fn = (cmd, args, opts) => {
    calls.push({ cmd, args: args.slice(), opts: opts || {} });
    return repoLib.defaultRunner(cmd, args, opts);
  };
  fn.calls = calls;
  return fn;
}

// ------------------------------------------------- the allowlist, derived ---

test('the path allowlist is derived from the member and cannot be widened', () => {
  assert.deepEqual(sb.allowlistFor('alex'), ['.handshake/tasks/alex.md']);
  // A traversing member id becomes a filename, never a path.
  const bad = sb.allowlistFor('../../etc/passwd');
  assert.equal(bad.length, 1);
  assert.ok(!bad[0].includes('..'), bad[0]);
  assert.ok(bad[0].startsWith('.handshake/tasks/'), bad[0]);
  // There is no parameter that accepts a path.
  assert.equal(sb.allowlistFor.length, 1);
});

test('a member id that would collide with the state ref is reserved away', () => {
  assert.equal(sb.memberRefSegment('state'), 'state-member');
  assert.equal(sb.memberRefSegment('alex.lock'), 'alex');
  assert.equal(sb.ownRef('alex'), 'refs/heads/handshake/alex');
  assert.notEqual(sb.ownRef('state'), sb.STATE_REF);
});

test('a peer-authored member id cannot forge a git ident and cannot empty one', () => {
  // Git strips `<`, `>` and newlines from an author name itself, so the ident
  // cannot be forged; the case it does not survive is a name that strips to
  // nothing, which is `fatal: empty ident name`.
  assert.equal(sb.authorNameFor('bad\nname <inject>'), 'bad name inject');
  assert.equal(sb.authorNameFor('<>'), sb.memberRefSegment('<>'));
  assert.ok(sb.authorNameFor('<>').length > 0);
  assert.ok(!/[<>\n\r]/.test(sb.authorNameFor('a <b>\nc')));

  const root = makeRepo();
  const state = makeState();
  writeShard(root, '<>', 'mine\n');
  const built = sb.buildStateCommit({ root, state, member: '<>', parent: null });
  assert.equal(built.ok, true, built.reason || '');
  sb.moveRef({ root, ref: sb.STATE_REF, commit: built.commit });
  const ident = g(root, 'cat-file', 'commit', built.commit).split(/\r?\n/).filter((l) => /^author /.test(l));
  assert.equal(ident.length, 1, 'exactly one author line');
  assert.match(ident[0], /^author \S.* <[^<>]+> \d+ [-+]\d{4}$/);
});

// ------------------------------------------------ author, committer, marker -

test('the commit is authored as the member and committed by the tool', () => {
  const root = makeRepo();
  const state = makeState();
  writeShard(root, 'alex', '# shard\n- one\n');

  const built = sb.buildStateCommit({ root, state, member: 'alex', parent: null });
  assert.equal(built.ok, true, built.reason || '');
  assert.equal(built.changed, true);
  const moved = sb.moveRef({ root, ref: sb.STATE_REF, commit: built.commit });
  assert.equal(moved.ok, true, moved.reason || '');

  const line = g(root, 'log', sb.STATE_REF, '-1', '--format=%an%x09%ae%x09%cn%x09%ce').trim();
  const [an, ae, cn, ce] = line.split('\t');
  assert.equal(an, 'alex');
  assert.equal(ae, 'owner@example.com');            // the member's own git identity
  assert.equal(cn, sb.TOOL_IDENTITY.name);
  assert.equal(ce, sb.TOOL_IDENTITY.email);
  assert.notEqual(an, cn);
});

test('every commit message this stage writes ends with [skip ci]', () => {
  const root = makeRepo();
  const state = makeState();
  writeShard(root, 'alex', 'a\n');
  const built = sb.buildStateCommit({ root, state, member: 'alex', parent: null });
  sb.moveRef({ root, ref: sb.STATE_REF, commit: built.commit });
  const msg = g(root, 'log', sb.STATE_REF, '-1', '--format=%B');
  assert.ok(/\[skip ci\]\s*$/.test(msg.trim()), JSON.stringify(msg));

  // ... and a message that does not carry it is refused rather than written.
  writeShard(root, 'alex', 'b\n');
  const bad = sb.buildStateCommit({
    root, state, member: 'alex', parent: built.commit, message: 'no marker here',
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'message_missing_skip_ci');
  assert.equal(bad.commit, null);
});

// ------------------------------------------------------- the invariants -----

// THE invariant test, and the one that would have caught a `checkout --orphan`
// implementation. Both invariant sets ride one hundred-commit loop because the
// loop is what costs; the assertions stay separate and separately named.
test('after 100 state commits on a dirty tree: main is untouched, the branch is orphan, and HEAD / symbolic-ref / status / .git/index are byte-identical', () => {
  const root = makeRepo();
  const state = makeState();

  // A dirty tree with staged, unstaged and untracked work - the human's.
  fs.writeFileSync(path.join(root, 'README.md'), 'hello\nedited but not staged\n');
  fs.writeFileSync(path.join(root, 'staged.txt'), 'staged work\n');
  g(root, 'add', 'staged.txt');
  fs.writeFileSync(path.join(root, 'untracked.txt'), 'untracked work\n');
  // The shard exists before the baseline is taken, because the plugin's own
  // hooks write it and this test is about what the STATE-BRANCH WRITER changes.
  // The loop below only rewrites its contents, so a byte-identical
  // `status --porcelain` is a real assertion rather than one arranged by
  // leaving the file out.
  writeShard(root, 'alex', '# shard\nrecord -1\n');

  // Settle git's stat cache before the baseline, so a later `status` cannot
  // rewrite the index for a reason that has nothing to do with this module.
  const idxFile = path.join(root, '.git', 'index');
  g(root, 'status', '--porcelain');
  g(root, 'status', '--porcelain');
  const before = {
    log: g(root, 'log', 'main', '--format=%H%x09%an%x09%ae%x09%s'),
    head: g(root, 'rev-parse', 'HEAD'),
    sym: g(root, 'symbolic-ref', 'HEAD'),
    status: g(root, 'status', '--porcelain'),
    index: fs.readFileSync(idxFile),
    readme: fs.readFileSync(path.join(root, 'README.md'), 'utf8'),
    untracked: fs.readFileSync(path.join(root, 'untracked.txt'), 'utf8'),
  };

  let parent = null;
  for (let i = 0; i < 100; i++) {
    writeShard(root, 'alex', '# shard\nrecord ' + i + '\n');
    const built = sb.buildStateCommit({
      root, state, member: 'alex', parent, fileMode: false, authorEmail: 'owner@example.com',
    });
    assert.equal(built.ok, true, 'commit ' + i + ': ' + built.reason + ' / ' + built.error);
    assert.equal(built.changed, true);
    const moved = sb.moveRef({ root, ref: sb.STATE_REF, commit: built.commit, expectedOld: parent });
    assert.equal(moved.ok, true, moved.reason || '');
    parent = built.commit;
  }

  // `.git/index` is never read and never written: byte-identical, not merely
  // "the status looks the same". Read FIRST, before any git call of this test's
  // own can refresh the stat cache.
  assert.ok(before.index.equals(fs.readFileSync(idxFile)), '.git/index was rewritten');
  assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), before.readme);
  assert.equal(fs.readFileSync(path.join(root, 'untracked.txt'), 'utf8'), before.untracked);

  // HEAD never moved, and the human's view of their own tree is unchanged.
  assert.equal(g(root, 'rev-parse', 'HEAD'), before.head);
  assert.equal(g(root, 'symbolic-ref', 'HEAD'), before.sym);
  assert.equal(g(root, 'status', '--porcelain'), before.status);

  // `git log main` is byte-identical after a hundred coordination commits.
  assert.equal(g(root, 'log', 'main', '--format=%H%x09%an%x09%ae%x09%s'), before.log);
  assert.equal(g(root, 'rev-list', '--count', sb.STATE_REF).trim(), '100');

  // Orphan: it shares no commit with main.
  const mainSha = g(root, 'rev-parse', 'main').trim();
  assert.notEqual(raw(root, ['merge-base', '--is-ancestor', mainSha, sb.STATE_REF]).status, 0,
    'main must not be an ancestor of the state branch');
  assert.notEqual(raw(root, ['merge-base', mainSha, sb.STATE_REF]).status, 0,
    'there must be no merge base at all');

  // And the temp index lives in the state dir, not in the repo - asserted by
  // SHAPE and not against one constant, because there is no constant any more:
  // the path is unique per build (`indexPath`, and the data-loss bug it
  // documents) and the file is removed in a `finally` when the build returns.
  const idxA = sb.indexPath(state);
  const idxB = sb.indexPath(state);
  assert.notEqual(idxA, idxB, 'a second build must not be handed the first build\'s index path');
  for (const p of [idxA, idxB]) {
    assert.equal(path.dirname(p), state.dir, 'the temp index belongs in the state dir');
    assert.ok(!p.startsWith(root), 'and never inside the repository');
    assert.ok(path.basename(p).startsWith(sb.INDEX_PREFIX) && p.endsWith(sb.INDEX_SUFFIX), p);
  }
  // Nothing was left behind by a hundred builds.
  const strays = fs.readdirSync(state.dir).filter((f) => f.startsWith(sb.INDEX_PREFIX) && f.endsWith(sb.INDEX_SUFFIX));
  assert.deepEqual(strays, [], 'a temp index must not outlive the build that made it: ' + strays.join(', '));
});

test('two batches with no change to the allowlist produce one commit', () => {
  const root = makeRepo();
  const state = makeState();
  writeShard(root, 'alex', 'one record\n');

  const first = sb.buildStateCommit({ root, state, member: 'alex', parent: null });
  assert.equal(first.changed, true);
  sb.moveRef({ root, ref: sb.STATE_REF, commit: first.commit });

  const second = sb.buildStateCommit({ root, state, member: 'alex', parent: first.commit });
  assert.equal(second.ok, true);
  assert.equal(second.changed, false, 'an unchanged allowlist must not make a second commit');
  assert.equal(second.reason, 'unchanged');
  assert.equal(second.commit, null);
  assert.equal(g(root, 'rev-list', '--count', sb.STATE_REF).trim(), '1');
});

test('nothing outside the path allowlist is ever committed', () => {
  const root = makeRepo();
  const state = makeState();
  writeShard(root, 'alex', 'mine\n');
  const hs = path.join(root, '.handshake');
  fs.mkdirSync(path.join(hs, 'tasks'), { recursive: true });
  // The one file that must never be committed, a peer's shard, and a file a
  // future version of this plugin might drop into the directory.
  fs.writeFileSync(path.join(hs, 'secret.json'), '{"secret":"hsk_deadbeef"}\n');
  fs.writeFileSync(path.join(hs, 'workspace.json'), '{}\n');
  fs.writeFileSync(path.join(hs, 'future-feature.json'), '{}\n');
  fs.writeFileSync(path.join(hs, 'tasks', 'bob.md'), "bob's shard\n");

  const built = sb.buildStateCommit({ root, state, member: 'alex', parent: null });
  sb.moveRef({ root, ref: sb.STATE_REF, commit: built.commit });
  const listed = g(root, 'ls-tree', '-r', '--name-only', sb.STATE_REF).split(/\r?\n/).filter(Boolean);
  assert.deepEqual(listed, ['.handshake/tasks/alex.md']);
});

// ----------------------------- section 4.2 item 1: the commit scan, ungated --
//
// Stage 1 is the stage that DELETES the human commit which used to stand
// between `.handshake/tasks/<me>.md` and the remote. Measured before this gate:
// an AWS key appended to that file reached a bare remote inside 60 s with
// outcome `ok`, no scan, no refusal and no line. Section 4.2 item 1 is a
// required and ungated guardrail - "every automated commit, on either branch,
// is scanned before it is created" - so these are the tests that keep it one.

// A shard the way the tool writes it: `## <ts> <kind>` records, one field a line.
function shardWith(records) {
  const head = '# claude-handshake task shard - alex\n\n' +
    '<!-- handshake-shard: {"v":1,"member":"alex","email":null} -->\n\n';
  return head + records.map((r, i) =>
    '## 2026-09-0' + ((i % 9) + 1) + 'T10:0' + (i % 6) + ':00Z  learned\n' + r + '\n').join('\n');
}

test('a credential in the shard REFUSES the commit before the blob is written', () => {
  const root = makeRepo();
  const state = makeState();
  writeShard(root, 'alex', shardWith(['- text: the key is AKIAIOSFODNN7EXAMPLE, do not lose it']));

  const runner = recordingRunner();
  const built = sb.buildStateCommit({ root, state, member: 'alex', parent: null, runner });
  assert.equal(built.ok, false);
  assert.equal(built.reason, 'secret_scan');
  assert.deepEqual(built.findings, ['aws-access-key']);
  assert.equal(built.scanned_path, '.handshake/tasks/alex.md');
  assert.equal(built.commit, null);
  // "Nothing partial is written": the scan runs BEFORE `hash-object -w`, so no
  // blob for those bytes exists in the object store at all.
  for (const c of runner.calls) {
    assert.notEqual(c.args[0], 'hash-object', 'a blob was written for a refused commit');
    assert.notEqual(c.args[0], 'commit-tree');
  }
  assert.notEqual(raw(root, ['rev-parse', '--verify', '--quiet', sb.STATE_REF]).status, 0,
    'and no ref was moved');
});

test('the refusal is `refused - secret scan, <file>` and names the source and the next move', () => {
  const root = makeRepo();
  const state = makeState();
  optIn(state);
  writeShard(root, 'alex', shardWith(['- text: ghp_' + 'a'.repeat(36)]));

  // Every network call is scripted, so a refusal that leaked past the gate
  // would still be visible as a push in the recorded argv.
  const runner = fakeRunner((cmd, args) => {
    if (args[0] === 'fetch') return { ok: true, code: 0, stdout: '' };
    if (args[0] === 'ls-remote') return { ok: false, code: 2, stdout: '' };
    if (args[0] === 'rev-parse') return { ok: false, code: 1, stdout: '' };
    return { ok: true, code: 0, stdout: '' };
  });
  const out = sb.runBeat({
    root, state, member: 'alex', runner, verdict: PRIVATE,
    repo: { ok: true, root, remote: 'https://github.com/acme/w.git', slug: 'acme/w', host: 'github.com', is_github: true, reason: null },
  });
  assert.equal(out.outcome, sb.OUTCOMES.refused);
  assert.equal(out.reason, 'secret_scan');
  // section 4.4 rule 1: the closed vocabulary's word, with the file appended.
  assert.equal(out.push, sb.PUSH_STATES.secret_scan + '.handshake/tasks/alex.md');
  assert.equal(sb.pushWord(out.push), 'refused — secret scan');
  // section 4.4 rule 2: a cause and a next move, not a bare verdict.
  assert.match(out.message, /github-token/);
  assert.match(out.message, /`\.handshake\/tasks\/alex\.md`/);
  assert.match(out.message, /Remove the value/);
  // The deferred count does NOT grow: this is a refusal, not a deferral.
  assert.equal(sb.deferredCount(state), 0);
  for (const c of runner.calls) assert.notEqual(c.args[0], 'push', 'a refused batch must never reach the remote');
});

test('the scan is PER RECORD, so a shard far past the 2 KB envelope cap is still scanned whole', () => {
  // `filter.check()` refuses anything over MAX_BYTES with a `size-cap` finding,
  // and a shard is append-only. Fed whole it would come back `size-cap` on day
  // one - a finding that is not a secret and a scanner that sees nothing. The
  // credential is in the LAST record, past 2 KB by a wide margin.
  const root = makeRepo();
  const state = makeState();
  const filler = [];
  for (let i = 0; i < 140; i++) filler.push('- text: an ordinary learning about the retry budget, number ' + i);
  filler.push('- text: pasted by mistake AKIAIOSFODNN7EXAMPLE');
  const body = shardWith(filler);
  assert.ok(Buffer.byteLength(body, 'utf8') > 4 * require('../lib/filter').MAX_BYTES, 'the fixture must dwarf the cap');
  writeShard(root, 'alex', body);

  const built = sb.buildStateCommit({ root, state, member: 'alex', parent: null });
  assert.equal(built.reason, 'secret_scan', JSON.stringify(built));
  assert.ok(built.findings.includes('aws-access-key'), JSON.stringify(built.findings));
  assert.ok(!built.findings.includes('size-cap'), 'the shard must never be fed to the 2 KB cap whole');
  assert.ok(!built.findings.includes('scan-truncated'), 'and every record must have been reached');
});

test('a long shard of ordinary coordination records commits with no finding', () => {
  // The false-positive pin. Every record here is the shape the tool itself
  // writes, and every field on that path has ALREADY passed this same
  // `check()` through sendGate [C lib/outbound.js] - which is the argument for
  // using the identical battery rather than a second one.
  const root = makeRepo();
  const state = makeState();
  const recs = [];
  for (let i = 0; i < 40; i++) {
    recs.push('- subject: refactor the retry budget in src/net/retry.ts\n' +
      '- files: src/net/retry.ts, src/net/index.ts\n' +
      '- summary: split the per-host budget out of the global one, run ' + i);
  }
  writeShard(root, 'alex', shardWith(recs));
  const built = sb.buildStateCommit({ root, state, member: 'alex', parent: null });
  assert.equal(built.ok, true, built.reason + ' ' + JSON.stringify(built.findings));
  assert.equal(built.changed, true);
  assert.equal(built.findings, null);
});

test("the local-secret tripwire refuses a value copied out of the project's own .env", () => {
  const root = makeRepo();
  const state = makeState();
  fs.writeFileSync(path.join(root, '.env'), 'DEPLOY_PASSPHRASE=correct-horse-battery-staple-42\n');
  writeShard(root, 'alex', shardWith(['- summary: it fails unless you pass correct-horse-battery-staple-42']));
  // The corpus is hoisted by the caller (section 14 item 39) and passed in, so
  // a beat does not walk the project every minute.
  const files = sb._internals.secretFilesFor(root, { now: Date.now() });
  assert.ok(files.some((f) => f.endsWith('.env')), 'the fixture must be in the corpus: ' + files.join(', '));
  const built = sb.buildStateCommit({ root, state, member: 'alex', parent: null, secretFiles: files });
  assert.equal(built.reason, 'secret_scan');
  assert.deepEqual(built.findings, ['local-secret-tripwire']);
});

test('the commit MESSAGE goes through the same battery as the bytes', () => {
  const root = makeRepo();
  const state = makeState();
  writeShard(root, 'alex', shardWith(['- text: nothing to see here']));
  const built = sb.buildStateCommit({
    root, state, member: 'alex', parent: null,
    message: 'handshake state: alex\n\nsk-ant-' + 'x'.repeat(24) + '\n\n[skip ci]',
  });
  assert.equal(built.reason, 'secret_scan');
  assert.equal(built.scanned_path, '<commit message>');
  assert.ok(built.findings.length >= 1, JSON.stringify(built.findings));
});

test('the scanner fails CLOSED on an unreadable path', () => {
  const root = makeRepo();
  const state = makeState();
  // A directory where the shard should be: `readFileSync` throws, and
  // unreadable is not clean.
  const rel = sb.allowlistFor('alex')[0];
  fs.mkdirSync(path.join(root, ...rel.split('/')), { recursive: true });
  const built = sb.buildStateCommit({ root, state, member: 'alex', parent: null });
  assert.equal(built.reason, 'secret_scan_unreadable', JSON.stringify(built));
});

// ------------------- the scan is INCREMENTAL and bounded by TIME, not count --
//
// The first build of this gate scanned the whole shard every beat and gave up
// past a UNIT CEILING, reporting `scan-truncated` as a FINDING - so an ordinary
// shard, once it held more records than the ceiling, refused every batch from
// then on. A ceiling a normal file reaches is an off switch with a delay on it.
// These four tests are what keep it out.

test('the splitter has NO count ceiling: a shard far past the old 512 units scans whole and clean', () => {
  const many = [];
  for (let i = 0; i < 900; i++) many.push('- text: an ordinary coordination record, number ' + i);
  const res = sb.scanCommitBytes(shardWith(many), { secretFiles: [], budgetMs: 60000 });
  assert.deepEqual(res.ids, [], 'an honest shard must never be accused: ' + res.ids.join(', '));
  assert.equal(res.timed_out, false);
  assert.ok(res.units > 512, 'the fixture must dwarf the old ceiling: ' + res.units);
  assert.equal(res.scanned, res.units, 'and every unit must have been reached');
});

test('only what this commit ADDS is scanned: the parent blob is diffed and skipped', () => {
  // The bytes already on the branch were scanned when they were published.
  // Re-scanning them every minute is the work the ceiling existed to bound.
  const root = makeRepo();
  const state = makeState();
  const history = [];
  for (let i = 0; i < 900; i++) history.push('- text: an ordinary coordination record, number ' + i);
  const first = shardWith(history);
  writeShard(root, 'alex', first);
  const one = sb.buildStateCommit({ root, state, member: 'alex', parent: null });
  assert.equal(one.ok, true, one.reason);
  assert.equal(one.scan_bytes, Buffer.byteLength(first, 'utf8'),
    'the FIRST commit has no parent blob, so all of what it publishes is scanned');
  assert.equal(raw(root, ['update-ref', sb.STATE_REF, one.commit]).status, 0);

  // Append three records to a shard of nine hundred. The scan must touch the
  // three and not the nine hundred.
  const appended = '\n## 2026-09-02T11:00:00Z  learned\n- text: appended one\n' +
    '\n## 2026-09-02T11:01:00Z  learned\n- text: appended two\n' +
    '\n## 2026-09-02T11:02:00Z  learned\n- text: appended three\n';
  writeShard(root, 'alex', first + appended);
  const two = sb.buildStateCommit({ root, state, member: 'alex', parent: one.commit });
  assert.equal(two.ok, true, two.reason + ' ' + JSON.stringify(two.findings));
  assert.ok(two.scan_bytes > 0, 'the appended records must have been scanned');
  assert.ok(two.scan_bytes < 400, 'the parent`s bytes must not be re-scanned: ' + two.scan_bytes +
    ' of ' + Buffer.byteLength(first, 'utf8'));

  // And a credential in a NEW record is still caught, on the same parent.
  writeShard(root, 'alex', first + appended + '\n## 2026-09-02T12:00:00Z  learned\n- text: AKIAIOSFODNN7EXAMPLE\n');
  const three = sb.buildStateCommit({ root, state, member: 'alex', parent: one.commit });
  assert.equal(three.reason, 'secret_scan', JSON.stringify(three));
  assert.deepEqual(three.findings, ['aws-access-key']);
});

test('the bytes committed are the bytes SCANNED: a write landing mid-build is never published', () => {
  // THE SCAN AND THE COMMIT MUST NAME THE SAME BYTES. The build spends several
  // git processes between the scan's read and the hash - `cat-file blob`,
  // `read-tree`, `core.fileMode`, `ls-tree`, roughly 100-300 ms on Windows -
  // and a write landing in that window used to be committed unscanned. Worse,
  // permanently: the NEXT beat diffs against the committed blob, so those bytes
  // count as already published and are never scanned again. `hash-object -w
  // --stdin --path=<p>` closes the window instead of narrowing it.
  const root = makeRepo();
  const state = makeState();
  const rel = sb.allowlistFor('alex')[0];
  const clean = shardWith(['- text: an ordinary learning about the retry budget']);
  const dirty = clean + '\n## 2026-09-03T10:00:00Z  learned\n- text: AKIA' + 'IOSFODNN7EXAMPLE\n';
  writeShard(root, 'alex', clean);

  // `read-tree` is inside the window: after the scan, before the hash.
  const repoLib = require('../lib/repo');
  let injected = false;
  const runner = (cmd, args, opts) => {
    if (!injected && args[0] === 'read-tree') { injected = true; writeShard(root, 'alex', dirty); }
    return repoLib.defaultRunner(cmd, args, opts);
  };

  const built = sb.buildStateCommit({ root, state, member: 'alex', parent: null, runner });
  assert.equal(built.ok, true, built.reason + ' ' + JSON.stringify(built.findings));
  assert.ok(injected, 'the fixture must actually have raced the build');
  const blob = raw(root, ['cat-file', 'blob', built.commit + ':' + rel]);
  assert.equal(blob.status, 0, blob.stderr);
  assert.equal(blob.stdout, clean, 'the committed blob must be the bytes the scan cleared, not the file');
  assert.ok(!blob.stdout.includes('AKIA'), 'a credential written after the scan may never ride out unscanned');

  // ...and the miss is not made permanent either: the bytes were never
  // published, so the NEXT beat diffs them as ADDED and refuses.
  const next = sb.buildStateCommit({ root, state, member: 'alex', parent: built.commit });
  assert.equal(next.reason, 'secret_scan', JSON.stringify(next));
  assert.deepEqual(next.findings, ['aws-access-key']);
});

test('the scan bound is TIME and it DEFERS, never refuses: nothing is accused of anything', () => {
  const root = makeRepo();
  const state = makeState();
  const many = [];
  for (let i = 0; i < 900; i++) many.push('- text: an ordinary coordination record, number ' + i);
  const body = shardWith(many);
  assert.ok(Buffer.byteLength(body, 'utf8') < sb.MAX_SHARD_BYTES, 'the fixture must clear the write cap');
  writeShard(root, 'alex', body);

  // 1 ms of budget: the first unit still runs (a started unit always finishes)
  // and the rest do not, so the verdict is UNKNOWN rather than clean or dirty.
  const built = sb.buildStateCommit({ root, state, member: 'alex', parent: null, scanBudgetMs: 1 });
  assert.equal(built.reason, 'secret_scan_no_time', JSON.stringify(built));
  assert.equal(built.findings, null, 'a budget that ran out is not a finding');
  assert.equal(built.commit, null);
  assert.match(built.error, /ran out of its budget/);

  // The beat turns it into a DEFERRAL with the deferred word, not a refusal.
  optIn(state);
  const runner = fakeRunner((cmd, args) => {
    if (args[0] === 'fetch') return { ok: true, code: 0, stdout: '' };
    if (args[0] === 'ls-remote') return { ok: false, code: 2, stdout: '' };
    if (args[0] === 'rev-parse') return { ok: false, code: 1, stdout: '' };
    if (args[0] === 'config') return { ok: true, code: 0, stdout: 'false\n' };
    return { ok: true, code: 0, stdout: '' };
  });
  const out = sb.runBeat({
    root, state, member: 'alex', runner, verdict: PRIVATE, scanBudgetMs: 1,
    repo: { ok: true, root, remote: 'https://github.com/acme/w.git', slug: 'acme/w', host: 'github.com', is_github: true, reason: null },
  });
  assert.equal(out.outcome, sb.OUTCOMES.deferred, JSON.stringify(out));
  assert.equal(out.reason, 'secret_scan_no_time');
  assert.equal(out.push, sb.PUSH_STATES.deferred, 'the deferred word, not the secret-scan word');
  assert.match(out.message, /DEFERRED, not refused/);
  assert.ok(sb.deferredCount(state) > 0, 'a deferral says it deferred (section 4.1)');
  for (const c of runner.calls) assert.notEqual(c.args[0], 'push', 'nothing may go out on an unknown verdict');
});

test('the diff is exact on an append and conservative on a rewrite, and CRLF does not defeat it', () => {
  const added = sb._internals.addedText;
  assert.equal(added('a\nb\n', 'a\nb\nc\nd\n'), 'c\nd', 'an append yields exactly the appended lines');
  assert.equal(added('a\nb\n', 'a\nb\n'), '', 'no change yields nothing');
  assert.equal(added('', 'a\nb\n'), 'a\nb\n', 'no parent blob means every byte is new');
  // The blob comes back from `cat-file` as stored (LF); a Windows checkout with
  // core.autocrlf=true has CRLF on disk. Without the strip every line reads as
  // changed and the "incremental" scan is the whole-file scan again.
  assert.equal(added('a\r\nb\r\n', 'a\nb\nc\n'), 'c');
  // A rewrite scans MORE, never less.
  assert.equal(added('a\nb\nc\n', 'a\nZ\nc\n'), 'Z');
});

// ---------------------------------------------- the removal and mode arms ---

test('a path deleted from disk leaves the tree instead of silently resurrecting', () => {
  const root = makeRepo();
  const state = makeState();
  const { abs } = writeShard(root, 'alex', 'mine\n');
  const first = sb.buildStateCommit({ root, state, member: 'alex', parent: null });
  sb.moveRef({ root, ref: sb.STATE_REF, commit: first.commit });
  assert.equal(g(root, 'ls-tree', '-r', '--name-only', sb.STATE_REF).trim(), '.handshake/tasks/alex.md');

  fs.unlinkSync(abs);                       // e.g. `handshake scrub`
  const second = sb.buildStateCommit({ root, state, member: 'alex', parent: first.commit });
  assert.equal(second.ok, true, second.reason || '');
  assert.equal(second.changed, true, 'a deletion is a change');
  assert.deepEqual(second.removed, ['.handshake/tasks/alex.md']);
  sb.moveRef({ root, ref: sb.STATE_REF, commit: second.commit, expectedOld: first.commit });
  assert.equal(g(root, 'ls-tree', '-r', '--name-only', sb.STATE_REF).trim(), '');
});

test('a rename publishes one copy and not two', () => {
  // Renaming the shard is what a member-id change looks like from here: the old
  // allowlist path is gone from disk and the new one is present.
  const root = makeRepo();
  const state = makeState();
  writeShard(root, 'alex', 'mine\n');
  const first = sb.buildStateCommit({ root, state, member: 'alex', parent: null });
  sb.moveRef({ root, ref: sb.STATE_REF, commit: first.commit });

  fs.renameSync(
    path.join(root, '.handshake', 'tasks', 'alex.md'),
    path.join(root, '.handshake', 'tasks', 'alexandra.md'));

  // The old member's beat removes the old path; the new member's beat adds the
  // new one on top of it. Both are the same allowlist mechanism.
  const drop = sb.buildStateCommit({ root, state, member: 'alex', parent: first.commit });
  sb.moveRef({ root, ref: sb.STATE_REF, commit: drop.commit, expectedOld: first.commit });
  const add = sb.buildStateCommit({ root, state, member: 'alexandra', parent: drop.commit });
  sb.moveRef({ root, ref: sb.STATE_REF, commit: add.commit, expectedOld: drop.commit });

  const listed = g(root, 'ls-tree', '-r', '--name-only', sb.STATE_REF).split(/\r?\n/).filter(Boolean);
  assert.deepEqual(listed, ['.handshake/tasks/alexandra.md']);
});

test('a mode in the parent tree is preserved, and a path absent from it is committed 100644', () => {
  const root = makeRepo();
  const state = makeState();
  const rel = sb.allowlistFor('alex')[0];
  writeShard(root, 'alex', 'mine\n');

  // Seed a parent whose entry for the shard is 100755, the way a POSIX
  // checkout with core.fileMode true would have left it.
  const blob = g(root, 'hash-object', '-w', '--', rel).trim();
  const idx = path.join(tmpDir('idx'), 'index');
  const env = Object.assign({}, process.env, { GIT_INDEX_FILE: idx });
  spawnSync('git', ['-C', root, 'update-index', '--add', '--cacheinfo', '100755,' + blob + ',' + rel],
    { encoding: 'utf8', env, windowsHide: true });
  const tree = String(spawnSync('git', ['-C', root, 'write-tree'], { encoding: 'utf8', env, windowsHide: true }).stdout).trim();
  const parent = g(root, 'commit-tree', tree, '-m', 'seed [skip ci]').trim();
  assert.match(g(root, 'ls-tree', parent, '--', rel), /^100755 /);

  // core.fileMode is false, so a stat-derived mode would demote it to 100644.
  g(root, 'config', 'core.filemode', 'false');
  writeShard(root, 'alex', 'mine, edited\n');
  const built = sb.buildStateCommit({ root, state, member: 'alex', parent });
  assert.equal(built.ok, true, built.reason || '');
  assert.equal(built.added[0].mode, '100755', 'the parent entry mode must be read, never hardcoded');
  assert.match(g(root, 'ls-tree', built.commit, '--', rel), /^100755 /);

  // The add arm: a path that is NOT in the parent tree has no ls-tree answer.
  const fresh = sb.buildStateCommit({ root, state, member: 'newcomer', parent });
  writeShard(root, 'newcomer', 'new\n');
  const fresh2 = sb.buildStateCommit({ root, state, member: 'newcomer', parent });
  assert.equal(fresh.ok, true);
  assert.equal(fresh2.added[0].mode, '100644');
});

test('the blob is written before it is named: hash-object without -w makes write-tree exit 128', () => {
  // The pin for the `-w`. `--cacheinfo` NAMES a blob; it neither creates one
  // nor validates that one exists, and the failure surfaces two steps later.
  const root = makeRepo();
  const rel = '.handshake/tasks/alex.md';
  writeShard(root, 'alex', 'mine\n');
  const idx = path.join(tmpDir('idx2'), 'index');
  const env = Object.assign({}, process.env, { GIT_INDEX_FILE: idx });
  const call = (args) => spawnSync('git', ['-C', root].concat(args), { encoding: 'utf8', env, windowsHide: true });

  call(['read-tree', '--empty']);
  const noWrite = String(call(['hash-object', '--', rel]).stdout).trim();  // NO -w
  const ui = call(['update-index', '--add', '--cacheinfo', '100644,' + noWrite + ',' + rel]);
  assert.equal(ui.status, 0, 'update-index accepts a blob that does not exist - silently');
  const wt = call(['write-tree']);
  assert.equal(wt.status, 128);
  assert.match(String(wt.stderr), /invalid object|error building trees/i);

  // With -w, the identical sequence writes the tree.
  call(['read-tree', '--empty']);
  const written = String(call(['hash-object', '-w', '--', rel]).stdout).trim();
  call(['update-index', '--add', '--cacheinfo', '100644,' + written + ',' + rel]);
  const ok = call(['write-tree']);
  assert.equal(ok.status, 0);
});

// ------------------------------------------------- the checked-out guard ----

test('a checked-out handshake/state pauses the write and leaves HEAD untouched', () => {
  const root = makeRepo();
  const state = makeState();
  writeShard(root, 'alex', 'mine\n');
  const first = sb.buildStateCommit({ root, state, member: 'alex', parent: null });
  sb.moveRef({ root, ref: sb.STATE_REF, commit: first.commit });

  // The human opens the branch in a second worktree to look at it. (A checkout
  // in the main tree is the same verdict through `symbolic-ref HEAD`; a linked
  // worktree is the case only `worktree list --porcelain` can see, and it is
  // the one that leaves the main tree looking untouched.)
  const wt = path.join(tmpDir('wt'), 'look');
  g(root, 'worktree', 'add', '-q', wt, sb.STATE_BRANCH);
  const head = g(root, 'symbolic-ref', 'HEAD');
  const at = g(root, 'rev-parse', 'HEAD');
  assert.equal(head.trim(), 'refs/heads/main');

  const guard = sb.checkedOut(root, sb.STATE_REF);
  assert.equal(guard.checked_out, true);
  assert.ok(guard.by.length >= 1);

  writeShard(root, 'alex', 'mine, more\n');
  const second = sb.buildStateCommit({ root, state, member: 'alex', parent: first.commit });
  const moved = sb.moveRef({ root, ref: sb.STATE_REF, commit: second.commit });
  assert.equal(moved.ok, false);
  assert.equal(moved.outcome, sb.OUTCOMES.paused);
  assert.equal(moved.reason, 'checked_out');
  assert.equal(moved.push, sb.EXTRA_PUSH_STATES.paused_checked_out);
  assert.match(moved.message, /git switch/);              // rule 2: a next move
  assert.equal(g(root, 'symbolic-ref', 'HEAD'), head);
  assert.equal(g(root, 'rev-parse', 'HEAD'), at);
  assert.equal(g(root, 'rev-parse', sb.STATE_REF).trim(), first.commit);
});

test('a shard past the read-side cap REFUSES the batch rather than publishing bytes nobody can read', () => {
  // The write side had no cap at all. Measured: a 5 MB shard committed with
  // outcome `ok`, then read back on every peer as `exists=false` - because the
  // runner's own 4 MB output buffer blows and `git show` comes back empty from
  // a buffer nobody sees. One member could silently blank their own records for
  // the whole workspace and grow an append-only orphan branch nobody prunes.
  const root = makeRepo();
  const state = makeState();
  optIn(state);
  writeShard(root, 'alex', '# alex\n' + 'x'.repeat(sb.MAX_SHARD_BYTES + 4096) + '\n');

  const built = sb.buildStateCommit({ root, state, member: 'alex', parent: null });
  assert.equal(built.ok, false);
  assert.equal(built.reason, 'shard_too_large');
  assert.match(built.error, /shard cap/);
  assert.equal(built.commit, null);

  const runner = fakeRunner((cmd, args) => {
    if (args[0] === 'ls-remote') return { ok: false, code: 2, stdout: '' };
    if (args[0] === 'rev-parse') return { ok: false, code: 1, stdout: '' };
    return { ok: true, code: 0, stdout: '' };
  });
  const out = sb.runBeat({
    root, state, member: 'alex', runner, verdict: PRIVATE,
    repo: { ok: true, root, remote: 'https://github.com/acme/w.git', slug: 'acme/w', host: 'github.com', is_github: true, reason: null },
  });
  assert.equal(out.outcome, sb.OUTCOMES.refused);
  assert.equal(out.reason, 'shard_too_large');
  // section 4.4 rule 2: a cause and a next move. This one a human must act on -
  // an append-only shard that has outgrown the cap does not fix itself.
  assert.match(out.message, /Trim or rotate/);
  assert.match(out.message, /`\.handshake\/tasks\/alex\.md`/);
  assert.equal(sb.deferredCount(state), 0, 'a refusal is not a deferral');
  for (const c of runner.calls) assert.notEqual(c.args[0], 'push');
});

// ------------------------- one branch, TWO WRITERS IN ONE CLONE (SB-1) ------
//
// The measured bug: three concurrent processes against one clone and one bare
// remote seeded with a peer's shard lost that shard from the remote tip, in 12
// of 16 commits, with every beat reporting `ok`. The mechanism was a SHARED
// temp index - writer B unlinked it at the top of its build while writer A had
// already seeded it from the parent, so A's `write-tree` emitted a tree holding
// only A's own path and the push was a clean fast-forward that nothing
// rejected. Three layers close it and each has a test here: a unique index per
// build (above), a cross-process lock, and a tree post-condition that turns the
// residue into a refusal.

test('the batch lock is one batch at a time per state dir, across processes', () => {
  const state = makeState();
  const first = sb.acquireBatchLock(state, { now: 1000, where: 'monitor' });
  assert.equal(first.held, true);
  assert.ok(fs.existsSync(sb.lockPath(state)));

  // A second holder - another process in this clone - stands aside. It is NOT
  // an error and it does not grow anything: the holder is doing this work.
  const second = sb.acquireBatchLock(state, { now: 1100, where: 'session_end' });
  assert.equal(second.held, false);
  assert.equal(second.reason, 'locked');

  first.release();
  assert.equal(fs.existsSync(sb.lockPath(state)), false, 'release removes the file');
  const third = sb.acquireBatchLock(state, { now: 1200 });
  assert.equal(third.held, true);
  third.release();
});

test('a lock left by a crashed holder goes stale and is taken over exactly once', () => {
  const state = makeState();
  const held = sb.acquireBatchLock(state, { now: Date.now() });
  assert.equal(held.held, true);
  // The holder died: nothing releases the file. Inside the bound it still
  // blocks; past it, the next beat takes it over rather than wedging forever.
  assert.equal(sb.acquireBatchLock(state, { staleMs: 60000 }).held, false);
  // The clock is INJECTED rather than the bound set to zero: `now - mtimeMs`
  // can come back at or below zero on a filesystem whose timestamp granularity
  // is coarser than the two calls, and a staleness test that depends on that is
  // a flake, not a test.
  const after = sb.acquireBatchLock(state, { now: Date.now() + 600000, staleMs: 1000 });
  assert.equal(after.held, true, 'a stale lock must not wedge this clone for good');
  after.release();
});

test('a beat that cannot take the lock spawns nothing, writes nothing and does NOT grow the deferred count', () => {
  const root = makeRepo();
  const state = makeState();
  optIn(state);
  writeShard(root, 'alex', 'mine\n');
  const holder = sb.acquireBatchLock(state, { now: Date.now(), where: 'monitor' });
  assert.equal(holder.held, true);

  const runner = fakeRunner(() => ({ ok: true, code: 0, stdout: '' }));
  const out = sb.runBeat({
    root, state, member: 'alex', runner, verdict: PRIVATE,
    repo: { ok: true, root, remote: 'https://github.com/acme/w.git', slug: 'acme/w', host: 'github.com', is_github: true, reason: null },
  });
  assert.equal(out.outcome, sb.OUTCOMES.deferred);
  assert.equal(out.reason, 'locked');
  assert.equal(out.push, sb.PUSH_STATES.deferred);
  assert.equal(runner.calls.length, 0, 'nothing may be spawned behind a held lock');
  assert.equal(sb.deferredCount(state), 0,
    'the other process is doing this work and will record its own outcome');
  assert.match(out.message, /another session in this clone/);
  holder.release();
});

test('NO option on runBeat skips the batch lock, and none skips the gates either', () => {
  // The lock is the one control that stops two writers in one clone losing a
  // peer's shard, and the gates are the only thing between a subagent, a
  // non-opted-in machine or a public repo and a remote. An earlier build
  // carried `lock: false` and `gate: null` as test seams on the PUBLIC api of
  // the one module in this product that writes to a remote. Both are gone: a
  // test that wants two beats to overlap gives them their own state dirs, and
  // the ungated body lives behind `_internals`.
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'state-branch.js'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.doesNotMatch(code, /o\.lock\s*===/, 'a lock bypass option');
  assert.doesNotMatch(code, /o\.gate\s*===\s*null/, 'a gate bypass option');
  assert.doesNotMatch(code, /staleMs:\s*o\./, 'a caller-set staleness bound is a lock bypass');
  assert.equal(typeof sb._internals.runBeatUngated, 'function', 'the seam is behind _internals');

  // Behaviourally: a held lock stops even a beat whose every gate is open, and
  // no option offered to `runBeat` changes that.
  const root = makeRepo();
  const state = makeState();
  optIn(state);
  writeShard(root, 'alex', 'mine\n');
  const holder = sb.acquireBatchLock(state, { now: Date.now(), where: 'monitor' });
  const runner = fakeRunner(() => ({ ok: true, code: 0, stdout: '' }));
  for (const extra of [{}, { force: true }, { lock: false }, { lockStaleMs: 0 }]) {
    const out = sb.runBeat(Object.assign({
      root, state, member: 'alex', runner, verdict: PRIVATE,
      repo: { ok: true, root, remote: 'https://github.com/acme/w.git', slug: 'acme/w', host: 'github.com', is_github: true, reason: null },
    }, extra));
    assert.equal(out.reason, 'locked', JSON.stringify(extra) + ' got past the lock: ' + JSON.stringify(out));
  }
  assert.equal(runner.calls.length, 0, 'nothing may be spawned behind a held lock, by any route');
  holder.release();

  // And an ungated `runBeat` with no opt-in commits nothing and spawns no push.
  const clean = makeState('nooptin');
  const out = sb.runBeat({
    root, state: clean, member: 'alex', runner, verdict: PRIVATE,
    repo: { ok: true, root, remote: 'https://github.com/acme/w.git', slug: 'acme/w', host: 'github.com', is_github: true, reason: null },
  });
  assert.equal(out.outcome, sb.OUTCOMES.refused);
  assert.equal(out.reason, 'not_opted_in');
  assert.equal(out.push, sb.PUSH_STATES.not_enabled, 'rule 1: the field is populated here too');
  for (const c of runner.calls) assert.notEqual(c.args[0], 'push');
});

test('a concurrent build that empties the temp index is REFUSED, never pushed as a fast-forward', () => {
  // The deterministic reproduction of the measured data loss: at the moment
  // `update-index --add` is about to run, another build removes the index this
  // one seeded from the parent. Without the post-condition the beat returns
  // `ok`, pushes a clean fast-forward and the peer's shard is gone from the
  // branch. With it, the commit is thrown away before it is made.
  const root = makeRepo();
  const state = makeState();
  writeShard(root, 'bob', "bob's records\n");
  const bobCommit = sb.buildStateCommit({ root, state, member: 'bob', parent: null });
  assert.equal(bobCommit.changed, true);
  sb.moveRef({ root, ref: sb.STATE_REF, commit: bobCommit.commit });
  writeShard(root, 'alex', "alex's records\n");

  const repoLib = require('../lib/repo');
  let armed = true;
  const sabotage = (cmd, args, opts) => {
    if (armed && args[0] === 'update-index' && args.includes('--add')) {
      armed = false;
      try { fs.unlinkSync(opts.env.GIT_INDEX_FILE); } catch (_) { /* already gone */ }
    }
    return repoLib.defaultRunner(cmd, args, opts);
  };
  const built = sb.buildStateCommit({ root, state, member: 'alex', parent: bobCommit.commit, runner: sabotage });
  assert.equal(armed, false, 'the fixture must have fired');
  assert.equal(built.ok, false, JSON.stringify(built));
  assert.equal(built.reason, 'tree_lost_paths');
  assert.ok((built.lost || []).includes('.handshake/tasks/bob.md'), JSON.stringify(built.lost));
  assert.equal(built.commit, null, 'nothing may be committed');
  assert.equal(g(root, 'rev-parse', sb.STATE_REF).trim(), bobCommit.commit, 'and the ref never moved');
  assert.equal(g(root, 'ls-tree', '-r', '--name-only', sb.STATE_REF).trim(), '.handshake/tasks/bob.md');
});

test("a normal build alongside a peer's shard keeps the peer's file in the tree", () => {
  // The control for the test above: the same two members, no sabotage, and
  // both files are present in the resulting tree.
  const root = makeRepo();
  const state = makeState();
  writeShard(root, 'bob', "bob's records\n");
  const bobCommit = sb.buildStateCommit({ root, state, member: 'bob', parent: null });
  sb.moveRef({ root, ref: sb.STATE_REF, commit: bobCommit.commit });
  writeShard(root, 'alex', "alex's records\n");
  const built = sb.buildStateCommit({ root, state, member: 'alex', parent: bobCommit.commit });
  assert.equal(built.ok, true, built.reason || '');
  sb.moveRef({ root, ref: sb.STATE_REF, commit: built.commit, expectedOld: bobCommit.commit });
  assert.deepEqual(g(root, 'ls-tree', '-r', '--name-only', sb.STATE_REF).split(/\r?\n/).filter(Boolean),
    ['.handshake/tasks/alex.md', '.handshake/tasks/bob.md']);
});

// ---------------------------------------------------- the refusal arms ------

test('a child session writes nothing and spawns no git process', () => {
  const state = makeState();
  optIn(state);
  const runner = fakeRunner(() => ({ ok: true, code: 0, stdout: '' }));
  const out = sb.runBeat({ root: makeRepo(), state, member: 'alex', runner, child: true, verdict: PRIVATE });
  assert.equal(out.outcome, sb.OUTCOMES.refused);
  assert.equal(out.reason, 'child_session');
  assert.equal(runner.calls.length, 0, 'a child must not even ask git a question');
  assert.match(out.message, /PROTOCOL 7\.2/);
});

test('no remote: no branch, no commit, no push - and the state is `absent`, never `deferred`', () => {
  const root = makeRepo({ remote: null });
  const state = makeState();
  optIn(state);
  writeShard(root, 'alex', 'mine\n');

  const runner = recordingRunner();
  const out = sb.runBeat({ root, state, member: 'alex', runner, verdict: PRIVATE });
  assert.equal(out.outcome, sb.OUTCOMES.absent);
  assert.equal(out.reason, 'no_remote');
  assert.equal(out.push, sb.PUSH_STATES.no_remote);
  assert.equal(out.deferred_count, 0);
  assert.equal(sb.deferredCount(state), 0, 'the deferred count must stay at zero');
  assert.match(out.message, /git remote add origin/);     // rule 2: a next move

  const verbs = runner.calls.map((c) => c.args[0]);
  assert.ok(!verbs.includes('commit-tree'), 'no commit');
  assert.ok(!verbs.includes('push'), 'no push');
  assert.ok(!verbs.includes('update-ref'), 'no branch');
  assert.equal(sb.STATE_REF in sb.readHeads(state).refs, false);
  const branches = g(root, 'branch', '--list', sb.STATE_BRANCH).trim();
  assert.equal(branches, '');
});

test('no commit is created before the opt-in', () => {
  const root = makeRepo();
  const state = makeState();                              // no opt-in written
  writeShard(root, 'alex', 'mine\n');
  const runner = recordingRunner();
  const out = sb.runBeat({ root, state, member: 'alex', runner, verdict: PRIVATE });
  assert.equal(out.outcome, sb.OUTCOMES.refused);
  assert.equal(out.reason, 'not_opted_in');
  assert.match(out.message, /handshake pair --state-branch/);
  assert.ok(!runner.calls.map((c) => c.args[0]).includes('commit-tree'));
  assert.equal(g(root, 'branch', '--list', sb.STATE_BRANCH).trim(), '');
});

test('a public verdict refuses the whole automated push path, and only that arm prints the world-readable sentence', () => {
  const root = makeRepo();
  const state = makeState();
  optIn(state, { verdict: 'public', reason: 'affirmative_public' });
  const pub = { private: false, verdict: 'public', reason: 'affirmative_public', explanation: 'gh reported isPrivate: false' };
  const runner = recordingRunner();
  const out = sb.runBeat({ root, state, member: 'alex', runner, verdict: pub });
  assert.equal(out.outcome, sb.OUTCOMES.refused);
  assert.equal(out.reason, 'visibility_public');
  assert.equal(out.push, sb.PUSH_STATES.visibility_unproven);
  assert.match(out.message, /world-readable/);
  assert.match(out.message, /handshake pair --state-branch/);
  assert.ok(!runner.calls.map((c) => c.args[0]).includes('commit-tree'));

  // With the recorded override the same verdict is allowed.
  optIn(state, { verdict: 'public', reason: 'affirmative_public', override: true });
  assert.equal(sb.gate({ state, root, cwd: root, verdict: pub }), null);
});

test('the visibility refusal branches on the reason, in three distinct arms', () => {
  const state = makeState();
  optIn(state);
  const armFor = (reason) => sb.visibilityArm(
    { private: false, reason, explanation: reason }, sb.readOptIn(state), 'git@gitlab.example.com:acme/w.git');

  const gh = armFor('gh_unauthenticated');
  assert.equal(gh.allowed, false);
  assert.equal(gh.push, sb.PUSH_STATES.gh_unauthenticated);
  assert.match(gh.message, /gh auth login/);
  assert.ok(!/world-readable/.test(gh.message));

  const unprovable = armFor('no_github_remote');
  assert.equal(unprovable.allowed, false);
  assert.equal(unprovable.push, sb.PUSH_STATES.visibility_unproven);
  assert.match(unprovable.message, /cannot be proved for a non-github\.com remote/);
  assert.match(unprovable.message, /gitlab\.example\.com/);
  assert.ok(!/world-readable/.test(unprovable.message), 'the unprovable arm must not certify something false');

  const pub = armFor('affirmative_public');
  assert.match(pub.message, /world-readable/);

  // The unprovable confirmation is recorded as `unprovable`, NOT as an override.
  optIn(state, { verdict: 'unprovable', reason: 'no_github_remote', unprovable_confirmed: true });
  const confirmed = sb.visibilityArm({ private: false, reason: 'no_github_remote' }, sb.readOptIn(state), 'x');
  assert.equal(confirmed.allowed, true);
  assert.equal(confirmed.recorded, 'unprovable');
  assert.equal(sb.readOptIn(state).visibility.override, false);
});

test('every refusal this stage emits names a cause and a next move (section 4.4 rule 2)', () => {
  const state = makeState();
  const root = makeRepo();
  const cases = [];
  cases.push(sb.gate({ state, root, cwd: root, child: true }));
  cases.push(sb.gate({ state, root, cwd: root, verdict: PRIVATE }));               // not opted in
  optIn(state);
  cases.push(sb.gate({ state, root: makeRepo({ remote: null }), cwd: makeRepo({ remote: null }), verdict: PRIVATE }));
  cases.push(sb.gate({ state, root, cwd: root, verdict: { private: false, reason: 'affirmative_public' } }));
  cases.push(sb.gate({ state, root, cwd: root, verdict: { private: false, reason: 'gh_missing' } }));
  cases.push(sb.leasePush({ root, state, member: 'alex', ref: 'refs/heads/main' }));
  for (const c of cases) {
    assert.ok(c, 'this arm must refuse');
    assert.ok(typeof c.message === 'string' && c.message.length > 20, JSON.stringify(c));
    // A command, a file, or a setting - never a bare verdict.
    assert.ok(/`[^`]+`/.test(c.message), 'no next move in: ' + c.message);
  }
});

test('every push: value this stage can emit is one of Stage 1 own TEN', () => {
  const allowed = new Set(sb.STAGE1_PUSH_STATES);
  const emitted = [
    sb.PUSH_STATES.no_remote,
    sb.PUSH_STATES.gh_unauthenticated,
    sb.PUSH_STATES.visibility_unproven,
    sb.PUSH_STATES.deferred,
    sb.PUSH_STATES.deferred_attempts,
    sb.PUSH_STATES.offline,
    sb.PUSH_STATES.pushing,
    sb.PUSH_STATES.paused_checked_out,
    sb.PUSH_STATES.not_enabled,
  ];
  for (const e of emitted) assert.ok(allowed.has(e), e);
  // The forge arm is a prefix plus the forge's own line.
  assert.ok(sb.STAGE1_PUSH_STATES.includes(sb.PUSH_STATES.forge_rejected));
  // Stage 2's three are named but are NOT in Stage 1's OWNED set. Stage 1
  // reaches exactly one of them early - `refused — secret scan, <file>` -
  // because section 4.2 item 1's guardrail is ungated and Stage 1 is the stage
  // that removes the human commit; it is kept in its own array so the code and
  // the plan never count differently.
  for (const s of [sb.PUSH_STATES.secret_scan, sb.PUSH_STATES.no_lease, sb.PUSH_STATES.paused_head]) {
    assert.ok(!sb.STAGE1_PUSH_STATES.includes(s), s);
  }
  assert.deepEqual(sb.STAGE1_PROPOSED_PUSH_STATES, [sb.PUSH_STATES.secret_scan]);
  assert.equal(sb.STAGE1_REACHABLE_PUSH_STATES.length, 11);
  // The owner admitted the checked-out pause, the attempts-exhausted deferral
  // and the not-yet-enabled state on 2026-09-05 and closed the set at TEN,
  // which is what section 4.4 rule 1 now says. This number is the pin: an
  // eleventh OWNED word needs a ruling, not a commit.
  assert.equal(sb.STAGE1_PUSH_STATES.length, 10);
  // The old spelling still resolves, to the SAME string and not to a second one.
  assert.equal(sb.EXTRA_PUSH_STATES.paused_checked_out, sb.PUSH_STATES.paused_checked_out);
  assert.equal(new Set(sb.STAGE1_PUSH_STATES).size, 10, 'no duplicate words in the closed set');
  // The code's count and the PLAN's count are pinned against each other, so a
  // word added on one side and not the other fails here rather than in a review.
  const plan = fs.readFileSync(path.join(__dirname, '..', 'docs', 'V2-PLAN.md'), 'utf8');
  assert.match(plan, /\*\*Stage 1 owns ten\*\*/, 'section 4.4 rule 1 must say ten');
  for (const w of sb.STAGE1_PUSH_STATES) {
    const word = sb.pushWord(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(plan, new RegExp('`' + word), 'section 4.4 rule 1 does not enumerate: ' + w);
  }
  // `pushWord` strips appended DATA and nothing else: the two deferrals are two
  // values, because they name two causes.
  assert.equal(sb.pushWord(sb.PUSH_STATES.forge_rejected + 'GH013: declined'), 'rejected — forge ruleset');
  assert.equal(sb.pushWord(sb.PUSH_STATES.secret_scan + 'a.md'), 'refused — secret scan');
  assert.equal(sb.pushWord(sb.PUSH_STATES.deferred), sb.PUSH_STATES.deferred);
  assert.equal(sb.pushWord(sb.PUSH_STATES.deferred_attempts), sb.PUSH_STATES.deferred_attempts);
  assert.notEqual(sb.PUSH_STATES.deferred, sb.PUSH_STATES.deferred_attempts);
});

test('no option on the public runBeat can switch every gate off at once', () => {
  // The old `gate: null` seam disabled the child refusal, the not-a-repo check,
  // the no-remote arm, the opt-in gate and ruling D2's visibility gate TOGETHER
  // - on the public API of the one module in this product that writes to a
  // remote. The ungated body still exists, for tests, but only behind
  // `_internals`, where no production caller reaches it by forgetting a flag.
  const root = makeRepo();
  const state = makeState();                       // deliberately NOT opted in
  writeShard(root, 'alex', 'mine\n');
  const detected = { ok: true, root, remote: 'https://github.com/acme/w.git', slug: 'acme/w', host: 'github.com', is_github: true, reason: null };
  for (const extra of [{}, { gate: null }, { gate: false }, { gate: undefined }, { gate: 0 }]) {
    const runner = fakeRunner(() => ({ ok: true, code: 0, stdout: '' }));
    const out = sb.runBeat(Object.assign({ root, state, member: 'alex', runner, verdict: PRIVATE, repo: detected }, extra));
    assert.equal(out.outcome, sb.OUTCOMES.refused, JSON.stringify(extra) + ' -> ' + JSON.stringify(out));
    assert.equal(runner.calls.length, 0, 'nothing may spawn before the opt-in: ' + JSON.stringify(extra));
  }
  assert.equal(sb.runBeatUngated, undefined, 'the ungated body is not on the public surface');
  assert.equal(typeof sb._internals.runBeatUngated, 'function');
});

// ------------------------------------------------- ruling D1: the lease -----

test('a force-push on any ref outside the pattern is refused with NO git process spawned', () => {
  const root = makeRepo();
  const state = makeState();
  for (const ref of ['refs/heads/main', 'refs/heads/release/1.0', 'refs/heads/handshake/bob',
    'refs/tags/v1', '--force', 'refs/heads/handshake/alex/extra']) {
    const runner = fakeRunner(() => ({ ok: true, code: 0 }));
    const out = sb.leasePush({ root, state, member: 'alex', ref, runner });
    assert.equal(out.outcome, sb.OUTCOMES.refused, ref);
    assert.equal(out.spawned, false, ref);
    assert.equal(runner.calls.length, 0, 'a git process was spawned for ' + ref);
  }
});

test('handshake/state is never force-pushed, and bare --force is refused on every ref', () => {
  const root = makeRepo();
  const state = makeState();
  const runner = fakeRunner(() => ({ ok: true, code: 0 }));
  const onState = sb.leasePush({ root, state, member: 'alex', ref: sb.STATE_REF, runner });
  assert.equal(onState.outcome, sb.OUTCOMES.refused);
  assert.equal(onState.reason, 'state_ref_never_forced');
  assert.equal(runner.calls.length, 0);

  const bare = sb.leasePush({ root, state, member: 'alex', ref: sb.ownRef('alex'), force: true, runner });
  assert.equal(bare.outcome, sb.OUTCOMES.refused);
  assert.equal(bare.reason, 'bare_force_refused');
  assert.equal(runner.calls.length, 0);

  // And the argv gate itself refuses to construct one.
  assert.throws(() => sb._internals.assertNoBareForce(['push', '--force', 'origin', 'x']), /bare force/i);
  assert.throws(() => sb._internals.assertNoBareForce(['push', '-f', 'origin', 'x']), /bare force/i);
  assert.throws(() => sb._internals.assertNoBareForce(['push', '--force-with-lease', 'origin', 'x']), /bare force/i);
});

test('ls-remote absent => a leaseless create; present => a lease at the recorded sha', () => {
  const root = makeRepo();
  const state = makeState();
  const ref = sb.ownRef('alex');
  const SHA = 'a'.repeat(40);

  // exit 2 = proved absent. The create carries no lease and no force at all.
  let runner = fakeRunner((cmd, args) => {
    if (args[0] === 'ls-remote') return { ok: false, code: 2 };
    if (args[0] === 'push') return { ok: true, code: 0, stdout: 'To origin\n' };
    if (args[0] === 'rev-parse') return { ok: true, code: 0, stdout: SHA + '\n' };
    return { ok: true, code: 0 };
  });
  let out = sb.leasePush({ root, state, member: 'alex', ref, runner });
  assert.equal(out.ok, true);
  assert.equal(out.created, true);
  const create = runner.calls.find((c) => c.args[0] === 'push');
  assert.ok(!create.args.some((a) => /force/.test(String(a))), create.args.join(' '));
  assert.equal(sb.recordedHead(state, ref), SHA);

  // exit 0 = present. The lease value is the tool's OWN recorded head.
  runner = fakeRunner((cmd, args) => {
    if (args[0] === 'ls-remote') return { ok: true, code: 0, stdout: 'b'.repeat(40) + '\t' + ref + '\n' };
    if (args[0] === 'push') return { ok: true, code: 0, stdout: 'To origin\n' };
    if (args[0] === 'rev-parse') return { ok: true, code: 0, stdout: 'c'.repeat(40) + '\n' };
    return { ok: true, code: 0 };
  });
  out = sb.leasePush({ root, state, member: 'alex', ref, runner });
  assert.equal(out.ok, true);
  const lease = runner.calls.find((c) => c.args[0] === 'push');
  assert.ok(lease.args.includes('--force-with-lease=' + ref + ':' + SHA),
    'the lease must carry the recorded sha, not the remote one: ' + lease.args.join(' '));
  // Never the remote-tracking value, and never the value read back from the remote.
  assert.ok(!lease.args.some((a) => String(a).includes('b'.repeat(40))));
});

test('a lease with no recorded head is refused, and nothing is overwritten', () => {
  const root = makeRepo();
  const state = makeState();                                  // no head recorded
  const ref = sb.ownRef('alex');
  const runner = fakeRunner((cmd, args) => {
    if (args[0] === 'ls-remote') return { ok: true, code: 0, stdout: 'b'.repeat(40) + '\t' + ref + '\n' };
    return { ok: true, code: 0 };
  });
  const out = sb.leasePush({ root, state, member: 'alex', ref, runner });
  assert.equal(out.outcome, sb.OUTCOMES.refused);
  assert.equal(out.reason, 'no_recorded_lease');
  assert.equal(out.push, sb.PUSH_STATES.no_lease);
  assert.ok(!runner.calls.some((c) => c.args[0] === 'push'), 'nothing may be pushed without a lease');
});

test('a lease at the wrong sha is refused by the remote and nothing is overwritten', () => {
  const root = makeRepo();
  const state = makeState();
  const ref = sb.ownRef('alex');
  sb.recordHead(state, ref, 'd'.repeat(40));
  const runner = fakeRunner((cmd, args) => {
    if (args[0] === 'ls-remote') return { ok: true, code: 0, stdout: 'e'.repeat(40) + '\t' + ref + '\n' };
    if (args[0] === 'push') {
      return { ok: false, code: 1, stderr: ' ! [rejected]        handshake/alex -> handshake/alex (stale info)\nerror: failed to push some refs\n' };
    }
    return { ok: true, code: 0 };
  });
  const out = sb.leasePush({ root, state, member: 'alex', ref, runner });
  assert.equal(out.outcome, sb.OUTCOMES.paused);
  assert.equal(out.reason, 'stale_lease');
  assert.equal(out.push, sb.PUSH_STATES.paused_head);
  assert.match(out.message, /force-with-lease/);
  // The recorded head is unchanged: a refusal never advances the lease.
  assert.equal(sb.recordedHead(state, ref), 'd'.repeat(40));
});

test('an unknown ls-remote answer creates nothing and pushes nothing', () => {
  const root = makeRepo();
  const state = makeState();
  const ref = sb.ownRef('alex');
  const runner = fakeRunner((cmd, args) => {
    if (args[0] === 'ls-remote') return { ok: false, code: 128, stderr: 'fatal: does not appear to be a git repository\n' };
    return { ok: true, code: 0 };
  });
  const out = sb.leasePush({ root, state, member: 'alex', ref, runner });
  assert.equal(out.outcome, sb.OUTCOMES.offline);
  assert.equal(out.reason, 'ls_remote_unknown');
  assert.ok(!runner.calls.some((c) => c.args[0] === 'push'));
});

// ------------------------------------------------ credentials on the wire ---

test('GIT_TERMINAL_PROMPT=0 is on every network argv, and bare --force is on none', () => {
  const root = makeRepo();
  const state = makeState();
  optIn(state);
  writeShard(root, 'alex', 'mine\n');

  const runner = fakeRunner((cmd, args) => {
    if (args[0] === 'ls-remote') return { ok: false, code: 2 };
    if (args[0] === 'fetch') return { ok: false, code: 128, stderr: "fatal: couldn't find remote ref\n" };
    if (args[0] === 'push') return { ok: true, code: 0, stdout: 'To origin\n' };
    if (args[0] === 'hash-object') return { ok: true, code: 0, stdout: '1'.repeat(40) + '\n' };
    if (args[0] === 'write-tree') return { ok: true, code: 0, stdout: '2'.repeat(40) + '\n' };
    if (args.includes('commit-tree')) return { ok: true, code: 0, stdout: '3'.repeat(40) + '\n' };
    if (args[0] === 'rev-parse') return { ok: false, code: 1 };
    if (args[0] === 'worktree') return { ok: true, code: 0, stdout: 'worktree ' + root + '\nbranch refs/heads/main\n' };
    if (args[0] === 'symbolic-ref') return { ok: true, code: 0, stdout: 'refs/heads/main\n' };
    return { ok: true, code: 0, stdout: '' };
  });

  const out = sb.runBeat({
    root, state, member: 'alex', runner, verdict: PRIVATE,
    repo: { ok: true, root, remote: 'https://github.com/acme/w.git', slug: 'acme/w', host: 'github.com', is_github: true, reason: null },
  });
  assert.equal(out.outcome, sb.OUTCOMES.ok, JSON.stringify(out));

  const NETWORK = new Set(['fetch', 'push', 'ls-remote']);
  const net = runner.calls.filter((c) => NETWORK.has(c.args[0]));
  assert.ok(net.length >= 2, 'the beat must make network calls: ' + net.length);
  for (const c of net) {
    assert.ok(c.opts && c.opts.env, 'no env on ' + c.args.join(' '));
    assert.equal(c.opts.env.GIT_TERMINAL_PROMPT, '0', 'prompting not disabled on ' + c.args.join(' '));
  }
  for (const c of runner.calls) {
    for (const a of c.args) {
      assert.notEqual(String(a), '--force');
      assert.notEqual(String(a), '-f');
    }
  }
  // ... and the commit-tree call carries the author/committer split and never signs.
  const ct = runner.calls.find((c) => c.args.includes('commit-tree'));
  assert.ok(ct.args.includes('-c') && ct.args.includes('commit.gpgsign=false'), ct.args.join(' '));
  assert.equal(ct.opts.env.GIT_AUTHOR_NAME, 'alex');
  assert.equal(ct.opts.env.GIT_COMMITTER_NAME, sb.TOOL_IDENTITY.name);
  // ... and the index it wrote is the temp one, never .git/index. By shape:
  // the path is unique per build, so there is no constant to compare against.
  const wt = runner.calls.find((c) => c.args[0] === 'write-tree');
  const idx = wt.opts.env.GIT_INDEX_FILE;
  assert.equal(path.dirname(idx), state.dir, 'the write-tree index must be the state dir temp one: ' + idx);
  assert.ok(path.basename(idx).startsWith(sb.INDEX_PREFIX) && idx.endsWith(sb.INDEX_SUFFIX), idx);
  assert.ok(!idx.startsWith(root), 'and never .git/index: ' + idx);
  // Every index-bearing call in the beat used the SAME temp index - one build,
  // one index - which is what makes the per-build path safe rather than merely
  // unique.
  const indexed = runner.calls.filter((c) => c.opts && c.opts.env && c.opts.env.GIT_INDEX_FILE);
  assert.ok(indexed.length >= 3, 'read-tree, update-index and write-tree all carry it');
  for (const c of indexed) assert.equal(c.opts.env.GIT_INDEX_FILE, idx, c.args.join(' '));
});

test('rule 2: a fetch error never creates an orphan root, because absence is proved and not inferred', () => {
  const root = makeRepo();
  const state = makeState();
  optIn(state);
  writeShard(root, 'alex', 'mine\n');
  const runner = fakeRunner((cmd, args) => {
    // The exact-refspec fetch exits 128 both when the ref is absent and when
    // the remote is unreachable: one exit class, two very different worlds.
    if (args[0] === 'fetch') return { ok: false, code: 128, stderr: 'fatal: does not appear to be a git repository\n' };
    if (args[0] === 'ls-remote') return { ok: false, code: 128, stderr: 'fatal: unable to access\n' };
    return { ok: true, code: 0, stdout: '' };
  });
  const out = sb.runBeat({
    root, state, member: 'alex', runner, verdict: PRIVATE,
    repo: { ok: true, root, remote: 'https://github.com/acme/w.git', slug: 'acme/w', host: 'github.com', is_github: true, reason: null },
  });
  assert.equal(out.outcome, sb.OUTCOMES.offline);
  assert.ok(!runner.calls.some((c) => c.args.includes('commit-tree')), 'no commit on an unproved absence');
  assert.ok(!runner.calls.some((c) => c.args[0] === 'update-ref'), 'no root created on an unproved absence');
  assert.equal(sb.deferredCount(state), 1);
});

test('a step with nothing left of the deadline is skipped rather than started in order to be killed', () => {
  const root = makeRepo();
  const state = makeState();
  optIn(state);
  writeShard(root, 'alex', 'mine\n');
  const runner = fakeRunner(() => ({ ok: true, code: 0, stdout: '' }));
  const out = sb.runBeat({
    root, state, member: 'alex', runner, verdict: PRIVATE, deadline: Date.now() - 1000,
    repo: { ok: true, root, remote: 'https://github.com/acme/w.git', slug: 'acme/w', host: 'github.com', is_github: true, reason: null },
  });
  assert.equal(out.outcome, sb.OUTCOMES.deferred);
  assert.equal(out.reason, 'no_time');
  assert.equal(out.push, sb.PUSH_STATES.deferred);
  assert.equal(runner.calls.length, 0, 'nothing may be spawned with nothing left');
  assert.equal(sb.deferredCount(state), 1);

  // The slice helper itself: a ceiling when there is no deadline, what is left
  // when the deadline is tighter, and null when there is nothing left.
  assert.equal(sb._internals.slice(null, 1500), 1500);
  assert.equal(sb._internals.slice(1000, 1500, 900), 100);
  assert.equal(sb._internals.slice(1000, 1500, 1000), null);
});

test("section 2.5's 500 ms commit row bounds the STEP, not each git process inside it", () => {
  // The bug this pins: applying the row as a per-CALL timeout kills the
  // six-to-eight-process temp-index sequence mid-way on Windows, where one git
  // spawn is 40-150 ms and more under load (observed: `write-tree` ETIMEDOUT at
  // commit 55 of 100). Each call is bounded by GIT_CALL_TIMEOUT_MS or by what
  // is left of the caller's deadline, whichever is smaller.
  const root = makeRepo();
  const state = makeState();
  writeShard(root, 'alex', 'mine\n');
  const runner = recordingRunner();

  const built = sb.buildStateCommit({ root, state, member: 'alex', parent: null, runner });
  assert.equal(built.ok, true, built.reason + ' / ' + built.error);
  assert.ok(Number.isInteger(built.elapsed_ms), 'the step reports how long it really took');
  for (const c of runner.calls) {
    assert.ok(c.opts.timeout > sb.COMMIT_BUDGET_MS,
      c.args[0] + ' was given the step budget as its own kill timer (' + c.opts.timeout + ' ms)');
    assert.ok(c.opts.timeout <= 5000, c.args[0] + ': ' + c.opts.timeout);
  }

  // A tighter caller deadline DOES bound each call, and an exhausted one stops
  // the sequence rather than starting a process in order to kill it.
  writeShard(root, 'alex', 'mine, more\n');
  const r2 = recordingRunner();
  const tight = sb.buildStateCommit({
    root, state, member: 'alex', parent: built.commit, runner: r2, deadline: Date.now() + 300,
  });
  for (const c of r2.calls) assert.ok(c.opts.timeout <= 300, c.args[0] + ': ' + c.opts.timeout);
  assert.ok(tight.ok || tight.reason === 'no_time', tight.reason);

  const r3 = recordingRunner();
  const spent = sb.buildStateCommit({
    root, state, member: 'alex', parent: built.commit, runner: r3, deadline: Date.now() - 1,
  });
  assert.equal(spent.ok, false);
  assert.equal(spent.reason, 'no_time');
  assert.equal(r3.calls.length, 0, 'nothing may be spawned with nothing left');
});

// ------------------------------------------------------------- preflight ----

test('the preflight refuses when commit.gpgsign is on and unresolved, and states both arms', () => {
  const root = makeRepo();
  const state = makeState();
  optIn(state);
  g(root, 'config', 'commit.gpgsign', 'true');
  const out = sb.preflight({ root, cwd: root, state, verdict: PRIVATE, remote: 'origin', pushTimeout: 1 });
  const sign = out.refusals.find((r) => r.id === 'gpgsign');
  assert.ok(sign, JSON.stringify(out.refusals));
  assert.match(sign.message, /commit\.gpgsign/);
  assert.match(sign.message, /git config commit\.gpgsign false/);
  assert.match(sign.message, /--allow-unsigned/);
  assert.equal(out.checks.gpgsign.on, true);
  assert.equal(out.ok, false);

  // Resolved: it is no longer a refusal.
  const ok = sb.preflight({ root, cwd: root, state, verdict: PRIVATE, gpgsignResolved: true, pushTimeout: 1 });
  assert.ok(!ok.refusals.some((r) => r.id === 'gpgsign'));
});

test('the preflight records git --version and refuses a push probe that cannot run non-interactively', () => {
  const root = makeRepo();
  const state = makeState();
  optIn(state);
  const runner = fakeRunner((cmd, args) => {
    if (args[0] === '--version') return { ok: true, code: 0, stdout: 'git version 2.53.0.windows.2\n' };
    if (args[0] === 'push') {
      return { ok: false, code: 128, stderr: "fatal: could not read Username for 'https://github.com': terminal prompts disabled\n" };
    }
    if (args[0] === 'rev-parse') return { ok: true, code: 0, stdout: '9'.repeat(40) + '\n' };
    if (args[0] === 'config') return { ok: true, code: 0, stdout: 'false\n' };
    return { ok: true, code: 0, stdout: '' };
  });
  const out = sb.preflight({
    root, cwd: root, state, verdict: PRIVATE, runner,
    repo: { ok: true, root, remote: 'https://github.com/acme/w.git', slug: 'acme/w', host: 'github.com', is_github: true, reason: null },
  });
  assert.equal(out.git_version, '2.53.0');
  assert.equal(sb.readHeads(state).git_version, '2.53.0');
  const probe = out.refusals.find((r) => r.id === 'push_dry_run');
  assert.ok(probe, JSON.stringify(out));
  assert.match(probe.message, /credential/i);
  assert.equal(out.ok, false);
  // The probe is a dry run and it names the intended ref.
  const push = runner.calls.find((c) => c.args[0] === 'push');
  assert.ok(push.args.includes('--dry-run'));
  assert.ok(push.args.some((a) => String(a).endsWith(':' + sb.STATE_REF)));
  assert.equal(push.opts.env.GIT_TERMINAL_PROMPT, '0');
  // The preflight is a CLI verb, so its network bound is GIT_NETWORK_TIMEOUT_MS
  // and NOT a hook budget - section 2.5 puts that constant on off-hook paths
  // only, and no path in this module puts it on a hook.
  assert.equal(push.opts.timeout, sb.GIT_NETWORK_TIMEOUT_MS);
  assert.equal(sb.GIT_NETWORK_TIMEOUT_MS, 15000);
  assert.notEqual(sb.GIT_NETWORK_TIMEOUT_MS, sb.PUSH_CEILING_MS);
});

test('no hook-path git call is bounded at GIT_NETWORK_TIMEOUT_MS', () => {
  // The one constant that must never reach a hook. Every network call a beat
  // makes takes a slice of the caller's deadline, capped by its own row in
  // section 2.5's table - 1,500 / 1,500 / 5,000 - never 15,000, which would
  // sit inside a 9,500 ms watchdog.
  const root = makeRepo();
  const state = makeState();
  optIn(state);
  writeShard(root, 'alex', 'mine\n');
  const runner = fakeRunner((cmd, args) => {
    if (args[0] === 'ls-remote') return { ok: false, code: 2 };
    if (args[0] === 'fetch') return { ok: false, code: 128, stderr: "fatal: couldn't find remote ref\n" };
    if (args[0] === 'push') return { ok: true, code: 0, stdout: 'To origin\n' };
    if (args[0] === 'hash-object') return { ok: true, code: 0, stdout: '1'.repeat(40) + '\n' };
    if (args[0] === 'write-tree') return { ok: true, code: 0, stdout: '2'.repeat(40) + '\n' };
    if (args.includes('commit-tree')) return { ok: true, code: 0, stdout: '3'.repeat(40) + '\n' };
    if (args[0] === 'rev-parse') return { ok: false, code: 1 };
    if (args[0] === 'worktree') return { ok: true, code: 0, stdout: 'worktree ' + root + '\nbranch refs/heads/main\n' };
    return { ok: true, code: 0, stdout: '' };
  });
  sb.runBeat({
    root, state, member: 'alex', runner, verdict: PRIVATE, deadline: Date.now() + 9000,
    repo: { ok: true, root, remote: 'https://github.com/acme/w.git', slug: 'acme/w', host: 'github.com', is_github: true, reason: null },
  });
  const NETWORK = new Set(['fetch', 'push', 'ls-remote']);
  for (const c of runner.calls) {
    if (!NETWORK.has(c.args[0])) continue;
    assert.ok(c.opts.timeout <= sb.PUSH_CEILING_MS,
      c.args[0] + ' bounded at ' + c.opts.timeout + ', above the 5,000 ms ceiling');
    assert.notEqual(c.opts.timeout, sb.GIT_NETWORK_TIMEOUT_MS);
  }
});

test('the [skip ci] preflight conditions WARN and never block', () => {
  const root = makeRepo({ remote: 'git@gitlab.example.com:acme/widgets.git' });
  const state = makeState();
  optIn(state, { verdict: 'unprovable', reason: 'no_github_remote', unprovable_confirmed: true });
  const runner = fakeRunner((cmd, args) => {
    if (args[0] === '--version') return { ok: true, code: 0, stdout: 'git version 2.53.0\n' };
    if (args[0] === 'push') return { ok: true, code: 0, stdout: '' };
    if (args[0] === 'rev-parse') return { ok: true, code: 0, stdout: '9'.repeat(40) + '\n' };
    if (args[0] === 'config') return { ok: true, code: 0, stdout: 'false\n' };
    return { ok: true, code: 0, stdout: '' };
  });
  const out = sb.preflight({
    root, cwd: root, state, runner, pullRequestTarget: true,
    verdict: { private: false, reason: 'no_github_remote', explanation: 'not github' },
    repo: { ok: true, root, remote: 'git@gitlab.example.com:acme/widgets.git', slug: 'acme/widgets', host: 'gitlab.example.com', is_github: false, reason: 'no_github_remote' },
  });
  assert.equal(out.ok, true, JSON.stringify(out.refusals));
  const ids = out.warnings.map((w) => w.id);
  assert.ok(ids.includes('pull_request_target'), ids.join(','));
  assert.ok(ids.includes('forge_policy_unreadable'), ids.join(','));
  for (const w of out.warnings) assert.match(w.message, /a run per tool push|HANDSHAKE_STATE_DIR|branch filter/);
  // No workflow file is opened by any path in this stage.
  assert.ok(!runner.calls.some((c) => c.args.some((a) => /workflows/.test(String(a)))));
});

// --------------------------------------------------------------- records ----

test('the opt-in marker and the head record live in the state dir and fail closed', () => {
  const state = makeState();
  assert.equal(sb.readOptIn(state).enabled, false, 'absent means off');
  fs.writeFileSync(sb.optInPath(state), 'not json at all');
  assert.equal(sb.readOptIn(state).enabled, false, 'unparseable means off');
  optIn(state);
  assert.equal(sb.readOptIn(state).enabled, true);
  assert.equal(path.dirname(sb.optInPath(state)), state.dir);
  assert.equal(path.dirname(sb.headsPath(state)), state.dir);
  // Neither is state.json, which hooks read-modify-write on hot paths.
  assert.notEqual(sb.optInPath(state), state.files.state);
  assert.notEqual(sb.headsPath(state), state.files.state);

  sb.clearOptIn(state);
  assert.equal(sb.readOptIn(state).enabled, false);

  // The deferred counter is reported and resets on a successful push.
  sb.bumpDeferred(state, 'offline');
  sb.bumpDeferred(state, 'offline');
  assert.equal(sb.deferredCount(state), 2);
  sb.recordHead(state, sb.STATE_REF, 'f'.repeat(40));
  assert.equal(sb.deferredCount(state), 0);
  assert.equal(sb.recordedHead(state, sb.STATE_REF), 'f'.repeat(40));
  assert.equal(sb.report(state).recorded_head, 'f'.repeat(40));
});

test('a forge rejection line is captured verbatim and classified apart from offline', () => {
  const forge = {
    ok: false, code: 1, stderr:
      'remote: error: GH006: Protected branch update failed for refs/heads/handshake/state.\n' +
      'remote: error: Required status check "build" is expected.\n' +
      ' ! [remote rejected] handshake/state -> handshake/state (protected branch hook declined)\n',
  };
  const c = sb.classifyRemote(forge);
  assert.equal(c.kind, 'rejected');
  assert.match(c.detail, /GH006/);
  assert.match(c.detail, /Protected branch update failed/);

  const offline = sb.classifyRemote({ ok: false, code: 128, stderr: 'fatal: unable to access: Could not resolve host: github.com\n' });
  assert.equal(offline.kind, 'offline');

  const nonff = sb.classifyRemote({ ok: false, code: 1, stderr: ' ! [rejected] handshake/state -> handshake/state (non-fast-forward)\n' });
  assert.equal(nonff.kind, 'nonff');

  const stale = sb.classifyRemote({ ok: false, code: 1, stderr: ' ! [rejected] x -> x (stale info)\n' });
  assert.equal(stale.kind, 'stale_lease');

  assert.notEqual(c.kind, offline.kind);
});

test('a transient ref collision is NOT a forge ruleset: it re-fetches and rebuilds', () => {
  // Observed live: 2 of 36 concurrent beats against a plain bare remote with no
  // ruleset of ANY kind came back classified `forge_ruleset`, which told the
  // human "the remote refused, this will not drain by waiting" and offered them
  // a next move for a rule that does not exist - and advised switching the
  // feature off for a collision that self-heals on the next beat. The cause was
  // that `[remote rejected]` was tested as if it were a cause: it is the
  // CONTAINER git prints for every server-side refusal.
  const contended = [
    " ! [remote rejected] handshake/state -> handshake/state (cannot lock ref 'refs/heads/handshake/state': is at abc but expected def)\n",
    ' ! [remote rejected] handshake/state -> handshake/state (failed to update ref)\n',
    "error: cannot lock ref 'refs/heads/handshake/state': unable to resolve reference\n",
  ];
  for (const stderr of contended) {
    const r = sb.classifyRemote({ ok: false, code: 1, stderr });
    assert.equal(r.kind, 'nonff', stderr);
    assert.equal(r.reason, 'ref_contended', stderr);
  }
  // ...and a real forge rule is still a rejection, with the forge's own line.
  for (const stderr of [
    'remote: error: GH013: pre-receive hook declined\n',
    'remote: Protected branch update failed\n',
    'remote: error: push declined due to repository rule violations\n',
  ]) {
    const r = sb.classifyRemote({ ok: false, code: 1, stderr });
    assert.equal(r.kind, 'rejected', stderr);
  }
  // A bare `[remote rejected]` with no cause this table recognises is reported
  // as a refusal by the remote, never dressed up as a rule the tool cannot name.
  const bare = sb.classifyRemote({ ok: false, code: 1, stderr: ' ! [remote rejected] x -> x (something new)\n' });
  assert.equal(bare.kind, 'rejected');
  assert.equal(bare.reason, 'remote_rejected');
});

test('the hardening env is a property of the runner, not a default a caller can switch off', () => {
  // `GIT_TERMINAL_PROMPT=0` is what makes a credential helper that would prompt
  // FAIL instead of hanging - section 10.1 states it as "a stated property
  // rather than an accident". Merging the caller's env AFTER the defaults made
  // it a default any caller could turn off.
  const repoLib = require('../lib/repo');
  let seen = null;
  const spy = (cmd, args, opts) => { seen = opts; return { ok: true, code: 0, stdout: '', stderr: '' }; };
  repoLib.git(makeRepo(), ['status'], { runner: spy, env: { GIT_TERMINAL_PROMPT: '1', GIT_SSH_COMMAND: 'calc' } });
  assert.equal(seen.env.GIT_SSH_COMMAND, 'calc', "a caller's own keys still reach the child");

  // ...and the real runner re-applies the hardening over whatever it was given.
  const r = repoLib.defaultRunner(process.execPath,
    ['-e', 'process.stdout.write(String(process.env.GIT_TERMINAL_PROMPT) + "|" + String(process.env.GH_PROMPT_DISABLED))'],
    { timeout: 10000, env: { GIT_TERMINAL_PROMPT: '1', GH_PROMPT_DISABLED: '0' } });
  assert.equal(r.ok, true, r.stderr);
  assert.equal(r.stdout.trim(), '0|1', 'the hardening is applied LAST and a caller cannot unset it');
});
