'use strict';
// `handshake scrub` - detaching a PROJECT from the repo layer - and the
// cloner-facing `.handshake/README.md` that explains the directory to somebody
// who never installed this tool.
//
// The three things under test, in order of how badly they fail if wrong:
//
//  1. scrub stops the repo-write paths. There is no new mode flag: every writer
//     is gated on `.handshake/` existing, which is the same state
//     `init --no-repo` leaves behind, so the proof is behavioural - claim after
//     scrub must write no shard, and no writer may re-create the directory.
//  2. scrub does NOT touch membership, credentials, the offline queue or the
//     standing rotation demand. A scrub that quietly cleared "we leaked, rotate"
//     would turn a security demand into silence.
//  3. the CLAUDE.md block is removed by its exact span and nothing else - the
//     human's own text around it survives byte-for-byte.
//
// No network: the transport endpoint is the discard port, so every posting
// command takes the section 10.1 silent-offline path into the local queue.
// Every git tree is a throwaway under the OS temp dir.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const wf = require('../lib/workspace-files');

const CLI = path.join(__dirname, '..', 'bin', 'handshake.js');
const DEAD_ENDPOINT = 'http://127.0.0.1:9';

let n = 0;
function sandbox(opts) {
  const o = opts || {};
  // realpathSync.native, not plain realpathSync: plain leaves a Windows 8.3
  // SHORT NAME alone, and git reports the long form - the mismatch shows up as
  // a '../..' escape in a path this suite compares.
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hs-scrub-' + (n++) + '-')));
  const project = path.join(root, 'project');
  fs.mkdirSync(project, { recursive: true });
  const box = { root, project, data: path.join(root, 'data') };
  if (o.git !== false) {
    const g = (...args) => spawnSync('git', ['-C', project].concat(args), { encoding: 'utf8', windowsHide: true });
    g('init', '-q');
    g('config', 'user.email', 'owner@example.com');
    g('config', 'user.name', 'Owner');
    g('config', 'commit.gpgsign', 'false');
    g('remote', 'add', 'origin', 'https://github.com/acme/widgets.git');
    box.git = g;
  }
  return box;
}

function run(box, args, opts) {
  const o = opts || {};
  const r = spawnSync(process.execPath, [CLI].concat(args), {
    cwd: o.cwd || box.project,
    input: o.stdin === undefined ? '' : o.stdin,
    encoding: 'utf8',
    timeout: 30000,
    env: Object.assign({}, process.env, {
      HANDSHAKE_STATE_DIR: box.data,
      HANDSHAKE_SESSION_ID: o.session || 'test-session',
      CLAUDE_CODE_CHILD_SESSION: o.child || '',
      HANDSHAKE_SKIP_HOST_CHECKS: '1',
      // The guard shells out to `gh`; PATH is left alone and the fail-closed
      // verdict (gh missing / unauthenticated / this fake slug) is what these
      // tests want anyway - the guarded part stays gitignored either way.
      GIT_TERMINAL_PROMPT: '0',
    }),
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function initHere(box, extra) {
  const r = run(box, ['init', '--ntfy', DEAD_ENDPOINT, '--name', 'widgets'].concat(extra || []));
  assert.equal(r.code, 0, 'init failed: ' + r.out + r.err);
  return r;
}

function dir(box) { return path.join(box.project, wf.DIR); }
function exists(p) { try { fs.statSync(p); return true; } catch (_) { return false; } }

// ------------------------------------------------- the cloner-facing README --

test('creating the repo layer writes the cloner-facing README once, at the workspace.json chokepoint', () => {
  const box = sandbox();
  initHere(box);
  const readme = path.join(dir(box), wf.README_FILE);
  assert.ok(exists(readme), 'init must leave a README in ' + wf.DIR + '/');

  const body = fs.readFileSync(readme, 'utf8');
  // The three questions a stranger actually has.
  assert.match(body, /no credentials in `workspace\.json`/i);
  assert.match(body, /PUBLIC_FIELDS/, 'it must name the allowlist mechanism, not just assert the property');
  assert.match(body, /git rm -r \.handshake/, 'a non-member must be told they can simply delete it');
  assert.match(body, /handshake scrub/, 'a member must be told the verb that detaches properly');
  // Every guarded field name is listed as refused-by-name.
  for (const k of wf.GUARDED_FIELDS) assert.ok(body.includes('`' + k + '`'), 'README must name ' + k);
});

test('the README is idempotent, and a hand-edited one is never overwritten', () => {
  const box = sandbox();
  initHere(box);
  const readme = path.join(dir(box), wf.README_FILE);

  const again = wf.ensureReadme(box.project);
  assert.equal(again.action, 'unchanged');

  fs.writeFileSync(readme, '# our own notes about this folder\n');
  const kept = wf.ensureReadme(box.project);
  assert.equal(kept.action, 'kept_hand_edited');
  assert.equal(fs.readFileSync(readme, 'utf8'), '# our own notes about this folder\n',
    'a README a human rewrote is theirs - refreshing it would discard what they added');
});

test('the README is not a shard and never lands in the projection', () => {
  const box = sandbox();
  initHere(box);
  run(box, ['claim', 'the onboarding flow']);
  const view = wf.projectTasks(box.project, {});
  assert.deepEqual(view.shards.filter((s) => s.file.endsWith('README.md')), [],
    wf.DIR + '/README.md must not be read as a task shard');
});

// ------------------------------------------------------------ scrub basics --

test('scrub removes the repo layer and says what it left alone', () => {
  const box = sandbox();
  initHere(box);
  run(box, ['claim', 'the onboarding flow']);
  assert.ok(exists(dir(box)));

  const r = run(box, ['scrub']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(exists(dir(box)), false, wf.DIR + '/ must be gone from the working tree');
  assert.match(r.out, /^scrubbed /m);
  assert.match(r.out, /task shard\(s\)/);
  // The honest lines, each load-bearing.
  assert.match(r.out, /still a member/i);
  assert.match(r.out, /NEXT commit/);
  assert.match(r.out, /HISTORY/);
  assert.match(r.out, /scrub --restore/);
});

test('scrub does not touch membership, credentials or the offline queue', () => {
  const box = sandbox();
  initHere(box);
  // The endpoint is the discard port, so this claim queues rather than sends.
  run(box, ['claim', 'the onboarding flow']);

  const stateFile = (() => {
    const wsDirs = fs.readdirSync(box.data).filter((d) => /^[0-9a-f]{8,}$/.test(d));
    assert.equal(wsDirs.length, 1, 'expected exactly one workspace state dir, got ' + wsDirs.join(','));
    return path.join(box.data, wsDirs[0]);
  })();
  const before = JSON.parse(fs.readFileSync(path.join(stateFile, 'state.json'), 'utf8'));
  const queueBefore = fs.readFileSync(path.join(stateFile, 'queue.json'), 'utf8');
  assert.ok(before.secret, 'precondition: the workspace secret is in local state');
  assert.ok(JSON.parse(queueBefore).entries.length > 0, 'precondition: something is queued');

  const r = run(box, ['scrub']);
  assert.equal(r.code, 0, r.out + r.err);

  const after = JSON.parse(fs.readFileSync(path.join(stateFile, 'state.json'), 'utf8'));
  assert.equal(after.secret, before.secret, 'the workspace secret must survive a scrub');
  assert.equal(after.member, before.member, 'membership must survive a scrub');
  assert.equal(after.transport, before.transport);
  assert.equal(after.endpoint, before.endpoint);
  assert.equal(fs.readFileSync(path.join(stateFile, 'queue.json'), 'utf8'), queueBefore,
    'the offline queue is local state, not repo content - scrub must not touch it');
  assert.match(r.out, /still queued for the live layer/,
    'a queue with unsent posts in it must be reported, not silently left');

  // And the workspace still resolves, through the local project index, so the
  // live layer keeps working from this directory.
  const st = run(box, ['status', '--json']);
  assert.equal(st.code, 0, st.out + st.err);
  assert.equal(JSON.parse(st.out).workspace.ws, before.ws);
});

test('scrub preserves a standing rotation demand - removing the folder does not un-leak a commit', () => {
  const box = sandbox();
  initHere(box);
  const wsDir = path.join(box.data, fs.readdirSync(box.data).filter((d) => /^[0-9a-f]{8,}$/.test(d))[0]);
  const file = path.join(wsDir, 'state.json');

  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  s.repo_guard = Object.assign({}, s.repo_guard, { rotation_demanded: true, last_hard_fail: { at: 1 } });
  s.repo_warnings = { at: 1, flag: 'non_member_commit', non_member_commits: [{ file: '.handshake/tasks/x.md' }], unverified: [] };
  fs.writeFileSync(file, JSON.stringify(s, null, 2));

  assert.equal(run(box, ['scrub']).code, 0);

  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(after.repo_guard.rotation_demanded, true,
    'a secret that was committed is still committed; scrub must not clear the rotation demand');
  assert.ok(after.repo_guard.last_hard_fail, 'the hard-fail record must survive too');
  assert.equal(after.repo_warnings, undefined,
    'the shard-authorship record lists files that no longer exist, so it goes');
});

// -------------------------------------------------- scrub stops the writers --

test('after scrub no repo-write path re-creates the directory', () => {
  const box = sandbox();
  initHere(box);
  assert.equal(run(box, ['scrub']).code, 0);

  // Every writer, in turn. None may bring `.handshake/` back.
  for (const argv of [
    ['claim', 'a subject'],
    ['done', 'a subject', '--summary', 'finished'],
    ['note', 'discovery', 'something'],
    ['presence', 'working'],
    ['leave', '--reason', 'signoff'],
    ['sync'],
    ['status'],
    ['guard'],
  ]) {
    run(box, argv);
    assert.equal(exists(dir(box)), false,
      '`handshake ' + argv[0] + '` re-created ' + wf.DIR + '/ after a scrub');
  }
});

test('after scrub a claim writes no task shard, exactly as in a --no-repo workspace', () => {
  const box = sandbox();
  initHere(box);
  run(box, ['claim', 'the first subject']);
  assert.ok(fs.readdirSync(path.join(dir(box), wf.TASKS_DIR)).length > 0, 'precondition: shards are being written');

  assert.equal(run(box, ['scrub']).code, 0);
  const r = run(box, ['claim', 'the second subject']);
  assert.equal(r.code, 0, 'a claim must still SUCCEED after a scrub - the live layer carried it');
  assert.equal(exists(path.join(box.project, wf.DIR, wf.TASKS_DIR)), false);
});

test('tasks after a scrub points at restore, not at init - init would mint a new workspace', () => {
  const box = sandbox();
  initHere(box);
  assert.equal(run(box, ['scrub']).code, 0);
  const r = run(box, ['tasks']);
  assert.equal(r.code, 2);
  assert.match(r.err, /scrub --restore/);
});

// ---------------------------------------------------------- the CLAUDE.md ---

test('scrub removes exactly the block span and leaves the human text byte-for-byte', () => {
  const box = sandbox();
  const md = path.join(box.project, 'CLAUDE.md');
  const before = '# widgets\n\nRun the tests with `npm test`.\n\n## Style\n\n    indented code block\n';
  fs.writeFileSync(md, before);
  initHere(box, ['--claude-md']);
  assert.ok(fs.readFileSync(md, 'utf8').includes(wf.MD_BEGIN), 'precondition: the block is in CLAUDE.md');

  assert.equal(run(box, ['scrub']).code, 0);
  assert.equal(fs.readFileSync(md, 'utf8'), before,
    'the block goes; every byte the human wrote around it stays, indentation included');
});

test('a block with the human\'s text BELOW it loses only the block and its blank lines', () => {
  // writeClaudeMdBlock appends, so this shape only happens once somebody has
  // moved the block or written under it - which is exactly when a greedy
  // "strip leading whitespace" would swallow the first line of an indented
  // code block that followed.
  const box = sandbox();
  initHere(box, ['--claude-md']);
  const md = path.join(box.project, 'CLAUDE.md');
  const block = fs.readFileSync(md, 'utf8').trim();
  const after = '    make all\n    make test\n';
  fs.writeFileSync(md, '# widgets\n\n' + block + '\n\n' + after);

  assert.equal(run(box, ['scrub']).code, 0);
  assert.equal(fs.readFileSync(md, 'utf8'), '# widgets\n\n' + after,
    'the indented lines under the block must survive with their indentation');
});

test('a CLAUDE.md that held nothing but the block is removed, not left as an empty file', () => {
  const box = sandbox();
  initHere(box, ['--claude-md']);
  const md = path.join(box.project, 'CLAUDE.md');
  assert.ok(exists(md));

  const r = run(box, ['scrub']);
  assert.equal(r.code, 0);
  assert.equal(exists(md), false);
  assert.match(r.out, /held nothing but the claude-handshake block/);
});

test('a CLAUDE.md with no handshake block is not touched', () => {
  const box = sandbox();
  const md = path.join(box.project, 'CLAUDE.md');
  fs.writeFileSync(md, '# ours\n');
  initHere(box);
  assert.equal(run(box, ['scrub']).code, 0);
  assert.equal(fs.readFileSync(md, 'utf8'), '# ours\n');
});

// --------------------------------------------------------- the edge cases ---

test('scrub on a workspace that never had a repo layer says so and changes nothing', () => {
  const box = sandbox();
  initHere(box, ['--no-repo']);
  assert.equal(exists(dir(box)), false, 'precondition: --no-repo writes no directory');

  const r = run(box, ['scrub']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /nothing to scrub/);
  assert.match(r.out, /membership/i);
  assert.equal(exists(dir(box)), false);
});

test('scrub outside any git tree still cleans up, and says there is no commit to make', () => {
  const box = sandbox({ git: false });
  const r0 = initHere(box);
  assert.match(r0.out, /no git working tree/);
  // Nothing was written, so there is nothing to remove - the honest answer.
  const r = run(box, ['scrub']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /nothing to scrub/);
  assert.match(r.out, /not a git working tree/i);
});

test('scrub outside a git tree removes a directory somebody copied in, and names the difference', () => {
  const box = sandbox({ git: false });
  initHere(box);
  // A `.handshake/` that arrived by copy rather than by git: no commit to make,
  // no history to worry about, but still a directory to remove.
  fs.mkdirSync(path.join(dir(box), wf.TASKS_DIR), { recursive: true });
  fs.writeFileSync(path.join(dir(box), wf.WORKSPACE_FILE), '{"schema":1,"public":{}}\n');

  const r = run(box, ['scrub']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(exists(dir(box)), false);
  assert.match(r.out, /commit to make and no history/);
});

test('a peer shard forces a typed confirmation, and the default is no', () => {
  const box = sandbox();
  initHere(box);
  fs.mkdirSync(path.join(dir(box), wf.TASKS_DIR), { recursive: true });
  fs.writeFileSync(path.join(dir(box), wf.TASKS_DIR, 'bob.md'), '# bob\n');

  const refused = run(box, ['scrub'], { stdin: '\n' });
  assert.equal(refused.code, 0);
  assert.match(refused.out, /WARNING: 1 task shard\(s\) here belong to other members/);
  assert.match(refused.out, /bob\.md/);
  assert.match(refused.out, /^not scrubbed$/m);
  assert.ok(exists(dir(box)), 'a bare newline is not a yes');

  const done = run(box, ['scrub'], { stdin: 'y\n' });
  assert.equal(done.code, 0, done.out + done.err);
  assert.equal(exists(dir(box)), false);
});

test('--yes skips the peer prompt', () => {
  const box = sandbox();
  initHere(box);
  fs.mkdirSync(path.join(dir(box), wf.TASKS_DIR), { recursive: true });
  fs.writeFileSync(path.join(dir(box), wf.TASKS_DIR, 'bob.md'), '# bob\n');

  const r = run(box, ['scrub', '--yes']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(exists(dir(box)), false);
  assert.match(r.out, /WARNING: 1 task shard/, 'skipping the prompt must not skip the warning');
});

test('your own shard alone is not a peer, so a solo scrub asks nothing', () => {
  const box = sandbox();
  initHere(box);
  run(box, ['claim', 'the onboarding flow']);
  // No stdin at all: if this path asked, confirm() would read EOF and refuse.
  const r = run(box, ['scrub']);
  assert.equal(r.code, 0);
  assert.equal(exists(dir(box)), false);
  assert.doesNotMatch(r.out, /belong to other members/);
});

test('a child session may not scrub', () => {
  const box = sandbox();
  initHere(box);
  const r = run(box, ['scrub'], { child: '1' });
  assert.equal(r.code, 3);
  assert.match(r.err, /child session/);
  assert.ok(exists(dir(box)), 'the directory must survive a refused scrub');
});

// ------------------------------------------------------------- re-attaching --

test('scrub --restore rewrites the layer for the SAME workspace', () => {
  const box = sandbox();
  initHere(box);
  const wsBefore = JSON.parse(fs.readFileSync(path.join(dir(box), wf.WORKSPACE_FILE), 'utf8')).public.ws;
  assert.equal(run(box, ['scrub']).code, 0);

  const r = run(box, ['scrub', '--restore']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.ok(exists(dir(box)), 'the layer must come back');
  const wsAfter = JSON.parse(fs.readFileSync(path.join(dir(box), wf.WORKSPACE_FILE), 'utf8')).public.ws;
  assert.equal(wsAfter, wsBefore, 'restore must NOT mint a new workspace');
  assert.ok(exists(path.join(dir(box), wf.README_FILE)), 'the cloner README comes back with it');
  assert.match(r.out, /re-attached/);
});

test('scrub --restore leaves the CLAUDE.md block alone without --claude-md, and writes it with', () => {
  const box = sandbox();
  initHere(box, ['--claude-md']);
  assert.equal(run(box, ['scrub']).code, 0);
  const md = path.join(box.project, 'CLAUDE.md');

  const plain = run(box, ['scrub', '--restore']);
  assert.equal(plain.code, 0, plain.out + plain.err);
  assert.equal(exists(md), false, 'writing into CLAUDE.md is a separate consent');
  assert.match(plain.out, /NOT restored without `--claude-md`/);

  const withFlag = run(box, ['scrub', '--restore', '--claude-md']);
  assert.equal(withFlag.code, 0, withFlag.out + withFlag.err);
  assert.ok(fs.readFileSync(md, 'utf8').includes(wf.MD_BEGIN));
});

test('scrub --restore outside a git tree refuses rather than writing a directory git will never carry', () => {
  const box = sandbox({ git: false });
  initHere(box);
  const r = run(box, ['scrub', '--restore']);
  assert.equal(r.code, 2);
  assert.match(r.err, /not inside a git working tree/);
  assert.equal(exists(dir(box)), false);
});
