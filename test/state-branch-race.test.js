'use strict';
// Stage 1 (V2-PLAN section 10.1): the concurrency protocol - ONE branch, TWO
// writers - against a real bare remote and two real clones.
//
// The floor forbids both of the usual escapes on a shared ref (force-push and
// merging), so the whole protocol is: fetch first, adopt never re-create, build
// on the fetched head, and on a non-fast-forward REBUILD rather than retry.
// The test that matters is the one the protocol exists for: two members
// committing in the same second both land, and neither loses a record.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const sb = require('../lib/state-branch');
const repoLib = require('../lib/repo');
const stateLib = require('../lib/state');

let n = 0;
function tmpDir(tag) {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hs-sbc-' + (tag || '') + (n++) + '-')));
}

const WS = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const PRIVATE = { private: true, verdict: 'private', reason: 'affirmative_private', explanation: 'gh reported isPrivate: true' };

function raw(dir, args) {
  return spawnSync('git', ['-C', dir,
    '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false',
    '-c', 'user.email=owner@example.com', '-c', 'user.name=Owner',
  ].concat(args), { encoding: 'utf8', windowsHide: true });
}
function g(dir, ...args) {
  const r = raw(dir, args);
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + (r.stderr || r.stdout));
  return String(r.stdout || '');
}

// A remote that is a real git repository and needs no network and no
// credentials: everything the protocol does is exercised for real.
function bareRemote() {
  const dir = tmpDir('bare');
  g(dir, '-c', 'init.defaultBranch=main', 'init', '--bare', '-q');
  return { dir, url: dir.split(path.sep).join('/') };
}

function makeClone(remoteUrl, who) {
  const dir = tmpDir('clone-' + who);
  g(dir, '-c', 'init.defaultBranch=main', 'init', '-q');
  g(dir, 'config', 'user.email', who + '@example.com');
  g(dir, 'config', 'user.name', who);
  g(dir, 'config', 'commit.gpgsign', 'false');
  g(dir, 'config', 'core.autocrlf', 'false');
  g(dir, 'remote', 'add', 'origin', remoteUrl);
  const state = stateLib.openState(WS, { dir: tmpDir('state-' + who) });
  state.ensure();
  sb.writeOptIn(state, { enabled: true, visibility: { verdict: 'private', reason: 'affirmative_private' } });
  return { dir, state, member: who };
}

function writeShard(root, member, body) {
  const rel = sb.allowlistFor(member)[0];
  const abs = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, 'utf8');
  return rel;
}

function beat(clone, opts) {
  return sb.runBeat(Object.assign({
    root: clone.dir, state: clone.state, member: clone.member, verdict: PRIVATE,
  }, opts || {}));
}

// Delegates to the real git and records every call, so a test can both drive
// real git and assert on the argv corpus.
function recordingRunner(intercept) {
  const calls = [];
  const fn = (cmd, args, opts) => {
    calls.push({ cmd, args: args.slice(), opts: opts || {} });
    if (intercept) {
      const hit = intercept(cmd, args, opts, calls);
      if (hit) return Object.assign({ ok: false, code: 1, stdout: '', stderr: '', error: null, timedOut: false }, hit);
    }
    return repoLib.defaultRunner(cmd, args, opts);
  };
  fn.calls = calls;
  return fn;
}

function remoteTree(bare) {
  return g(bare.dir, 'ls-tree', '-r', '--name-only', sb.STATE_REF).split(/\r?\n/).filter(Boolean).sort();
}
function remoteFile(bare, rel) {
  return g(bare.dir, 'show', sb.STATE_REF + ':' + rel);
}

// ------------------------------------------------------- the happy path -----

test('the first beat creates the orphan root and pushes it, and the second adopts it', () => {
  const bare = bareRemote();
  const a = makeClone(bare.url, 'alex');
  fs.writeFileSync(path.join(a.dir, 'README.md'), 'hi\n');
  g(a.dir, 'add', '-A'); g(a.dir, 'commit', '-q', '-m', 'first');
  g(a.dir, 'push', '-q', 'origin', 'main');

  writeShard(a.dir, 'alex', '# alex\n- r1\n');
  const first = beat(a);
  assert.equal(first.outcome, sb.OUTCOMES.ok, JSON.stringify(first));
  assert.equal(first.created_root, true);
  assert.equal(first.pushed, true);
  assert.deepEqual(remoteTree(bare), ['.handshake/tasks/alex.md']);
  assert.equal(sb.recordedHead(a.state, sb.STATE_REF), first.commit);
  assert.equal(sb.deferredCount(a.state), 0);

  // Orphan on the remote too: no shared commit with main.
  assert.notEqual(raw(bare.dir, ['merge-base', 'main', sb.STATE_REF]).status, 0);

  // The second beat with nothing changed makes no second commit.
  const second = beat(a);
  assert.equal(second.outcome, sb.OUTCOMES.unchanged, JSON.stringify(second));
  assert.equal(g(bare.dir, 'rev-list', '--count', sb.STATE_REF).trim(), '1');

  // A second clone ADOPTS the branch rather than re-creating a root.
  const b = makeClone(bare.url, 'bob');
  writeShard(b.dir, 'bob', '# bob\n- r1\n');
  const bfirst = beat(b);
  assert.equal(bfirst.outcome, sb.OUTCOMES.ok, JSON.stringify(bfirst));
  assert.equal(bfirst.created_root, false, 'the remote branch must be adopted, never re-created');
  assert.equal(bfirst.parent, first.commit);
  assert.deepEqual(remoteTree(bare), ['.handshake/tasks/alex.md', '.handshake/tasks/bob.md']);
});

// ---------------------------------------- the same-second collision --------

test('two clones committing in the same second both land: the loser rebuilds and no record is lost', () => {
  const bare = bareRemote();
  const a = makeClone(bare.url, 'alex');
  const b = makeClone(bare.url, 'bob');
  fs.writeFileSync(path.join(a.dir, 'README.md'), 'hi\n');
  g(a.dir, 'add', '-A'); g(a.dir, 'commit', '-q', '-m', 'first');
  g(a.dir, 'push', '-q', 'origin', 'main');

  // Bootstrap: the branch exists with alex's first record.
  writeShard(a.dir, 'alex', '# alex\n- r1\n');
  const bootstrap = beat(a);
  assert.equal(bootstrap.outcome, sb.OUTCOMES.ok);

  // Now both write, and both fetch the same head. The collision is forced
  // deterministically through the runner: the instant bob's beat finishes its
  // FIRST fetch, alex's beat runs to completion and moves the remote head. Bob
  // is therefore building on a head that is already stale - the same-second
  // race, without a scheduler.
  writeShard(a.dir, 'alex', '# alex\n- r1\n- r2 (alex, the winner)\n');
  writeShard(b.dir, 'bob', '# bob\n- r1 (bob, the loser)\n');

  let fired = false;
  let alexResult = null;
  const runner = recordingRunner((cmd, args) => {
    if (args[0] === 'fetch' && !fired) {
      fired = true;
      // Let bob's own fetch complete first, then move the head under him.
      const r = repoLib.defaultRunner(cmd, args, { cwd: b.dir, timeout: 15000 });
      alexResult = beat(a);
      return r;
    }
    return null;
  });

  const bobResult = beat(b, { runner });
  assert.equal(alexResult.outcome, sb.OUTCOMES.ok, JSON.stringify(alexResult));
  assert.equal(bobResult.outcome, sb.OUTCOMES.ok, JSON.stringify(bobResult));
  assert.ok(bobResult.attempts >= 2, 'bob must have REBUILT, not retried: ' + bobResult.attempts);
  assert.equal(bobResult.parent, alexResult.commit, "the loser rebuilds on the winner's head");

  // Both members' files are present and neither record is lost.
  assert.deepEqual(remoteTree(bare), ['.handshake/tasks/alex.md', '.handshake/tasks/bob.md']);
  assert.match(remoteFile(bare, '.handshake/tasks/alex.md'), /r2 \(alex, the winner\)/);
  assert.match(remoteFile(bare, '.handshake/tasks/bob.md'), /r1 \(bob, the loser\)/);

  // The rebuilt commit carries the marker too - a marker present on three paths
  // out of four is a marker that bills on the fourth.
  const messages = g(bare.dir, 'log', sb.STATE_REF, '--format=%B%x00').split('\0').filter((s) => s.trim());
  assert.ok(messages.length >= 3);
  for (const m of messages) assert.ok(/\[skip ci\]\s*$/.test(m.trim()), JSON.stringify(m));

  // The branch is still linear and still orphan.
  assert.equal(g(bare.dir, 'rev-list', '--count', '--merges', sb.STATE_REF).trim(), '0');
  assert.notEqual(raw(bare.dir, ['merge-base', 'main', sb.STATE_REF]).status, 0);
});

// ------------------------------------------------- offline, and the replay --

test('a push failure leaves the local commit intact, reports offline, and grows the deferred count', () => {
  const bare = bareRemote();
  const a = makeClone(bare.url, 'alex');
  fs.writeFileSync(path.join(a.dir, 'README.md'), 'hi\n');
  g(a.dir, 'add', '-A'); g(a.dir, 'commit', '-q', '-m', 'first');
  g(a.dir, 'push', '-q', 'origin', 'main');
  writeShard(a.dir, 'alex', '# alex\n- r1\n');
  const first = beat(a);
  assert.equal(first.outcome, sb.OUTCOMES.ok);

  // The remote goes away mid-day: fetch, ls-remote and push all fail.
  g(a.dir, 'remote', 'set-url', 'origin', bare.url + '-gone');
  writeShard(a.dir, 'alex', '# alex\n- r1\n- r2\n');
  const offline = beat(a);
  assert.equal(offline.outcome, sb.OUTCOMES.offline, JSON.stringify(offline));
  assert.equal(offline.push, sb.PUSH_STATES.offline);
  assert.ok(offline.commit, 'the local commit must be made');
  assert.equal(g(a.dir, 'rev-parse', sb.STATE_REF).trim(), offline.commit);
  assert.equal(g(a.dir, 'rev-list', '--count', sb.STATE_REF).trim(), '2');
  assert.equal(sb.deferredCount(a.state), 1);
  assert.match(offline.message, /next beat/);
  // The recorded head is NOT advanced by a push that did not happen.
  assert.equal(sb.recordedHead(a.state, sb.STATE_REF), first.commit);
});

test('a client offline for seven days replays its queued batches as one chain, with no duplicate records', () => {
  const bare = bareRemote();
  const a = makeClone(bare.url, 'alex');
  fs.writeFileSync(path.join(a.dir, 'README.md'), 'hi\n');
  g(a.dir, 'add', '-A'); g(a.dir, 'commit', '-q', '-m', 'first');
  g(a.dir, 'push', '-q', 'origin', 'main');

  const records = ['day 0'];
  writeShard(a.dir, 'alex', '# alex\n- ' + records.join('\n- ') + '\n');
  assert.equal(beat(a).outcome, sb.OUTCOMES.ok);

  // Seven days with no remote at all.
  g(a.dir, 'remote', 'set-url', 'origin', bare.url + '-gone');
  for (let day = 1; day <= 7; day++) {
    records.push('day ' + day);
    writeShard(a.dir, 'alex', '# alex\n- ' + records.join('\n- ') + '\n');
    const out = beat(a);
    assert.equal(out.outcome, sb.OUTCOMES.offline, 'day ' + day + ': ' + JSON.stringify(out));
    assert.ok(out.commit);
  }
  assert.equal(sb.deferredCount(a.state), 7, 'seven deferred writes, and status says so');
  assert.equal(g(a.dir, 'rev-list', '--count', sb.STATE_REF).trim(), '8');
  assert.equal(g(bare.dir, 'rev-list', '--count', 'main').trim(), '1');   // the remote saw none of it

  // Day 8: the remote is back.
  g(a.dir, 'remote', 'set-url', 'origin', bare.url);
  const back = beat(a);
  assert.equal(back.outcome, sb.OUTCOMES.ok, JSON.stringify(back));
  assert.equal(sb.deferredCount(a.state), 0, 'the deferred count drains on the push that drained it');

  // The whole chain landed - eight commits, not one collapsed replay.
  assert.equal(g(bare.dir, 'rev-list', '--count', sb.STATE_REF).trim(), '8');
  const body = remoteFile(bare, '.handshake/tasks/alex.md');
  for (const r of records) {
    const hits = body.split('- ' + r + '\n').length - 1;
    assert.equal(hits, 1, 'record "' + r + '" appears ' + hits + ' times');
  }
  const messages = g(bare.dir, 'log', sb.STATE_REF, '--format=%B%x00').split('\0').filter((s) => s.trim());
  for (const m of messages) assert.ok(/\[skip ci\]\s*$/.test(m.trim()));
  // Author = the member on every one of them, committer = the tool.
  const who = new Set(g(bare.dir, 'log', sb.STATE_REF, '--format=%an|%cn').split(/\r?\n/).filter(Boolean));
  assert.deepEqual([...who], ['alex|' + sb.TOOL_IDENTITY.name]);
});

test('rule 2: an unreachable remote with nothing local creates NO orphan root', () => {
  const bare = bareRemote();
  const a = makeClone(bare.url + '-never-existed', 'alex');
  fs.writeFileSync(path.join(a.dir, 'README.md'), 'hi\n');
  g(a.dir, 'add', '-A'); g(a.dir, 'commit', '-q', '-m', 'first');
  writeShard(a.dir, 'alex', '# alex\n- r1\n');

  const out = beat(a);
  assert.equal(out.outcome, sb.OUTCOMES.offline, JSON.stringify(out));
  assert.equal(out.commit, null, 'no commit may be made on an unproved absence');
  assert.equal(g(a.dir, 'branch', '--list', sb.STATE_BRANCH).trim(), '', 'no root may be created');
  assert.equal(sb.deferredCount(a.state), 1);
});

// ---------------------------------- rejected is not offline, and never drains

test('a forge rejection reports `rejected`, prints the forge own line, and the deferred count does not grow', () => {
  const bare = bareRemote();
  const a = makeClone(bare.url, 'alex');
  fs.writeFileSync(path.join(a.dir, 'README.md'), 'hi\n');
  g(a.dir, 'add', '-A'); g(a.dir, 'commit', '-q', '-m', 'first');
  g(a.dir, 'push', '-q', 'origin', 'main');
  writeShard(a.dir, 'alex', '# alex\n- r1\n');
  assert.equal(beat(a).outcome, sb.OUTCOMES.ok);
  const before = sb.deferredCount(a.state);

  // An org ruleset that rejects every push, permanently. Everything else is
  // real git; only the push itself is answered by the forge.
  const FORGE =
    'remote: error: GH013: Repository rule violations found for refs/heads/handshake/state.\n' +
    'remote: - Commits must have verified signatures.\n' +
    ' ! [remote rejected] handshake/state -> handshake/state (push declined due to repository rule violations)\n';
  const runner = recordingRunner((cmd, args) => (args[0] === 'push' ? { ok: false, code: 1, stderr: FORGE } : null));

  writeShard(a.dir, 'alex', '# alex\n- r1\n- r2\n');
  const out = beat(a, { runner });
  assert.equal(out.outcome, sb.OUTCOMES.rejected, JSON.stringify(out));
  assert.notEqual(out.outcome, sb.OUTCOMES.offline, 'rejected is a different thing to tell a human than offline');
  assert.ok(out.push.startsWith(sb.PUSH_STATES.forge_rejected), out.push);
  assert.match(out.push, /GH013/);                       // the forge's own line, verbatim
  assert.match(out.message, /GH013/);
  assert.match(out.message, /will not drain by waiting/);
  assert.match(out.message, /handshake pair --state-branch --off|Exempt/);  // rule 2: a next move
  assert.equal(sb.deferredCount(a.state), before, 'a rejection must not grow the deferred count');
  // The local commit is kept, and it was NOT retried inside the beat.
  assert.ok(out.commit);
  assert.equal(out.attempts, 1);
  assert.equal(runner.calls.filter((c) => c.args[0] === 'push').length, 1);
});

test('a non-fast-forward exhausting its rebuild budget defers rather than looping', () => {
  const bare = bareRemote();
  const a = makeClone(bare.url, 'alex');
  fs.writeFileSync(path.join(a.dir, 'README.md'), 'hi\n');
  g(a.dir, 'add', '-A'); g(a.dir, 'commit', '-q', '-m', 'first');
  g(a.dir, 'push', '-q', 'origin', 'main');
  writeShard(a.dir, 'alex', '# alex\n- r1\n');
  assert.equal(beat(a).outcome, sb.OUTCOMES.ok);

  const NONFF = ' ! [rejected] handshake/state -> handshake/state (non-fast-forward)\nerror: failed to push some refs\n';
  const runner = recordingRunner((cmd, args) => (args[0] === 'push' ? { ok: false, code: 1, stderr: NONFF } : null));
  writeShard(a.dir, 'alex', '# alex\n- r1\n- r2\n');
  const out = beat(a, { runner });

  assert.equal(out.outcome, sb.OUTCOMES.deferred, JSON.stringify(out));
  assert.equal(out.reason, 'attempts_exhausted');
  // THE OUTCOME IS `deferred` AND THE WORD NAMES THE TRUE CAUSE. Section 14
  // item 49 added "(no time in the beat)" to distinguish a time-starved beat
  // from the other causes, and this beat may have had all the time in the world
  // - what it ran out of is rule 4's three rebuild ATTEMPTS. Rule 4 is an
  // attempt ceiling, not a time bound, so printing the time gloss here would be
  // the field asserting a cause it does not know. Both are in section 4.4
  // rule 1's closed set (amended 2026-09-05).
  assert.equal(out.push, sb.PUSH_STATES.deferred_attempts);
  assert.equal(out.push, 'deferred (rebuild attempts exhausted)');
  assert.notEqual(out.push, sb.PUSH_STATES.deferred);
  assert.ok(sb.STAGE1_PUSH_STATES.includes(out.push), 'and it is in the closed set, not beside it');
  assert.equal(out.attempts, sb.MAX_REBUILDS);
  // Bounded: exactly MAX_REBUILDS pushes, and a re-FETCH before each rebuild -
  // rebuild, never retry.
  assert.equal(runner.calls.filter((c) => c.args[0] === 'push').length, sb.MAX_REBUILDS);
  assert.ok(runner.calls.filter((c) => c.args[0] === 'fetch').length >= sb.MAX_REBUILDS);
  assert.equal(sb.deferredCount(a.state), 1);
  // The local commit stands.
  assert.ok(out.commit);
  assert.equal(g(a.dir, 'rev-parse', sb.STATE_REF).trim(), out.commit);
});

// ---------------------------------------------------- the whole-run argv ----

test('across a full real run, bare --force is never emitted and every network call disables prompting', () => {
  const bare = bareRemote();
  const a = makeClone(bare.url, 'alex');
  fs.writeFileSync(path.join(a.dir, 'README.md'), 'hi\n');
  g(a.dir, 'add', '-A'); g(a.dir, 'commit', '-q', '-m', 'first');
  g(a.dir, 'push', '-q', 'origin', 'main');

  const runner = recordingRunner();
  for (let i = 0; i < 4; i++) {
    writeShard(a.dir, 'alex', '# alex\n- r' + i + '\n');
    beat(a, { runner });
  }
  sb.preflight({ root: a.dir, cwd: a.dir, state: a.state, verdict: PRIVATE, runner });

  assert.ok(runner.calls.length > 10);
  const NETWORK = new Set(['fetch', 'push', 'ls-remote']);
  let net = 0;
  for (const c of runner.calls) {
    for (const arg of c.args) {
      assert.notEqual(String(arg), '--force');
      assert.notEqual(String(arg), '-f');
      assert.ok(!/^--force-with-lease$/.test(String(arg)));
    }
    if (NETWORK.has(c.args[0])) {
      net++;
      assert.equal(c.opts.env && c.opts.env.GIT_TERMINAL_PROMPT, '0', c.args.join(' '));
    }
    // The human's index is never named on any call.
    if (c.opts.env && c.opts.env.GIT_INDEX_FILE) {
      assert.ok(!c.opts.env.GIT_INDEX_FILE.startsWith(a.dir), c.opts.env.GIT_INDEX_FILE);
    }
  }
  assert.ok(net >= 4, 'the run must have made network calls: ' + net);
  // And no path in this stage WRITES or EXECUTES a workflow file. (Reading one
  // is a different thing and it happens in exactly one place, the typed verb
  // `handshake pair` - pinned in test/pair-gate.test.js. No git call in a beat
  // names `.github` at all, which is what this line asserts.)
  assert.ok(!runner.calls.some((c) => c.args.some((x) => /\.github|workflows/.test(String(x)))));
});

test('the argv gate is an ALLOWLIST of shapes: the six that used to slip through are refused', () => {
  // Measured against the old denylist, every one of these passed. The primary
  // control (`refPermitted` / `leasePush`) held throughout - this is the
  // backstop, and a backstop with the holes that matter is not one.
  const refused = [
    ['push', 'origin', '+refs/heads/main:refs/heads/main'],  // a forcing refspec spelled the long way
    ['push', '--mirror', 'origin'],                          // deletes every remote ref not present locally
    ['push', '--delete', 'origin', 'handshake/state'],       // section 4.1: the tool never deletes a branch
    ['push', '--receive-pack=calc', 'origin'],               // names a program on the far end
    ['push', '--force-if-includes', 'origin'],
    ['push', '--upload-pack=calc', 'origin'],
    ['push', 'origin', '+main:main'],
    ['push', '--force-with-lease', 'origin', 'x'],           // valueless: no lease at all
    ['push', '--force-with-lease=refs/heads/handshake/alex:notasha', 'origin'],
  ];
  for (const argv of refused) {
    assert.throws(() => sb._internals.assertNoBareForce(argv.slice()),
      (e) => e && e.code === 'bare_force_refused',
      'this argv must never be emitted: ' + argv.join(' '));
  }
  // ...and the two shapes the module legitimately builds still pass.
  const allowed = [
    ['fetch', '--no-tags', 'origin', '+refs/heads/handshake/state:refs/remotes/origin/handshake/state'],
    ['push', '--force-with-lease=refs/heads/handshake/alex:' + 'a'.repeat(40), 'origin',
      'refs/heads/handshake/alex:refs/heads/handshake/alex'],
    ['push', '--porcelain', 'origin', sb.STATE_REF + ':' + sb.STATE_REF],
  ];
  for (const argv of allowed) {
    assert.deepEqual(sb._internals.assertNoBareForce(argv.slice()), argv, argv.join(' '));
  }
  // The plus-prefix exemption is scoped to the VERB and the destination: the
  // very shape it exists for, spelled onto a push, is refused.
  assert.throws(() => sb._internals.assertNoBareForce(
    ['push', 'origin', '+refs/heads/handshake/state:refs/remotes/origin/handshake/state']),
  (e) => e && e.code === 'bare_force_refused');
});
