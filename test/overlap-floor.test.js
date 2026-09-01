'use strict';
// Why this file exists: `handshake post warn.overlap` used to let an explicit
// --jaccard 50..100 WIN over the value computed from the two subject keys, so
// a real overlap of 40 could go out on the wire labelled 80, and a claimed
// number could carry an emission past the PROTOCOL 5.2 floor. The computed
// value now governs and --jaccard is accepted-but-ignored, which keeps the
// SKILL.md 8 command form working unchanged. Nothing else in the suite pins
// that: test/cli.test.js drives warn.overlap without --jaccard, and
// test/subject.test.js checks jaccardPercent in isolation, never what reaches
// the envelope.
//
// The transport points at a closed loopback port, so every emission lands in
// the offline queue - which is where the WIRE form can be read, exactly as
// test/cli.test.js does it.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'handshake.js');
const DEAD_ENDPOINT = 'http://127.0.0.1:9';     // discard port: always refused

const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });

let n = 0;
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-overlap-' + (n++) + '-'));
  temps.push(root);
  const project = path.join(root, 'project');
  fs.mkdirSync(project, { recursive: true });
  return { root, project, data: path.join(root, 'data') };
}

function run(box, args, opts) {
  const o = opts || {};
  const r = spawnSync(process.execPath, [CLI].concat(args), {
    cwd: box.project,
    input: o.stdin === undefined ? '' : o.stdin,
    encoding: 'utf8',
    timeout: 30000,
    env: Object.assign({}, process.env, {
      HANDSHAKE_STATE_DIR: box.data,
      HANDSHAKE_SESSION_ID: 'test-session',
      CLAUDE_CODE_CHILD_SESSION: '',
      // doctor otherwise shells out to `claude plugin list`; a unit test must not.
      HANDSHAKE_SKIP_HOST_CHECKS: '1',
    }),
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// init + invite + join: the shortest path to a workspace that can post.
function joinedSandbox() {
  const box = sandbox();
  const init = run(box, ['init', '--ntfy', DEAD_ENDPOINT, '--name', 'acme app']);
  assert.equal(init.code, 0, init.err);
  const blob = run(box, ['invite', '--inline']).out.trim().split('\n').pop().trim();
  assert.match(blob, /^hsi1_/);
  run(box, ['join', blob, '--as', 'tester'], { stdin: 'y\n' });
  box.ws = JSON.parse(run(box, ['status', '--json']).out).workspace.ws;
  return box;
}

function queued(box, type) {
  const file = path.join(box.data, box.ws, 'queue.json');
  if (!fs.existsSync(file)) return [];
  const q = JSON.parse(fs.readFileSync(file, 'utf8'));
  return (q.entries || []).map((e) => e.envelope).filter((e) => !type || e.type === type);
}

// The fixtures, with the arithmetic spelled out so the expected integers are
// checkable without re-running lib/subject.js. None of these words is a
// PROTOCOL 5.1 stopword, so each token set is just its words:
//
//   BELOW: {fix,api,issue} vs {fix,api,response,shape}
//          |n| = 2, |u| = 3 + 4 - 2 = 5  ->  2/5 = 0.40  ->  40
//   ABOVE: {onboarding,flow} vs {onboarding,flow,copy}
//          |n| = 2, |u| = 2 + 3 - 2 = 3  ->  2/3 = 0.667 ->  67 (round)
//   EDGE:  {onboarding,flow} vs {onboarding,flow,copy,tweaks}
//          |n| = 2, |u| = 2 + 4 - 2 = 4  ->  2/4 = 0.50  ->  50 (floor is >=)
const BELOW = ['fix api issue', 'fix api response shape', 40];
const ABOVE = ['onboarding flow', 'onboarding flow copy', 67];
const EDGE = ['onboarding flow', 'onboarding flow copy tweaks', 50];

function postOverlap(box, pair, extra) {
  return run(box, ['post', 'warn.overlap', '--subject', pair[0],
    '--peer', 'bob', '--peer-subject', pair[1]].concat(extra || []));
}

test('a claimed --jaccard cannot carry a below-floor overlap past the 50% floor', () => {
  const box = joinedSandbox();
  const r = postOverlap(box, BELOW, ['--jaccard', '80']);
  assert.match(r.err, /jaccard is 40% - below the 50% floor/,
    'the refusal must quote the COMPUTED 40, not the claimed 80');
  assert.equal(/warn\.overlap/.test(r.out), false, 'nothing may be reported as emitted');
  assert.deepEqual(queued(box, 'warn.overlap'), [],
    'and nothing may reach the wire: PROTOCOL 5.2 makes the >= 50 check a MUST on the emitter');
});

test('above the floor the COMPUTED value goes on the wire, not the claimed one', () => {
  const box = joinedSandbox();
  const r = postOverlap(box, ABOVE, ['--jaccard', '99']);
  assert.match(r.out, /queued warn\.overlap|posted warn\.overlap/, r.err);
  const envs = queued(box, 'warn.overlap');
  assert.equal(envs.length, 1);
  assert.equal(envs[0].body.jaccard, ABOVE[2],
    'jaccard on the wire is a measurement of these two keys (PROTOCOL 3.2), never an assertion');
  assert.equal(envs[0].body.subject_key, 'onboarding flow');
  assert.equal(envs[0].body.peer_subject_key, 'onboarding flow copy');
  assert.equal(envs[0].body.peer_member, 'bob');
});

test('the claimed value changes nothing: 99, 50, absent and junk all emit the same integer', () => {
  const box = joinedSandbox();
  // The same subjects four times, so the ONLY difference between the envelopes
  // is the --jaccard a model would have supplied. A pass-through would show up
  // here as four different numbers.
  for (const extra of [['--jaccard', '99'], ['--jaccard', '50'], [], ['--jaccard', 'not-a-number']]) {
    const r = postOverlap(box, ABOVE, extra);
    assert.match(r.out, /queued warn\.overlap|posted warn\.overlap/, r.err);
  }
  assert.deepEqual(queued(box, 'warn.overlap').map((e) => e.body.jaccard), [67, 67, 67, 67]);
});

test('a claimed value cannot pull a passing overlap DOWN below the floor either', () => {
  const box = joinedSandbox();
  // The old rule ignored out-of-range claims, so this direction never broke -
  // but it is the same wire field, and the guarantee is that the field IS the
  // measurement, not merely that it is >= 50.
  const r = postOverlap(box, ABOVE, ['--jaccard', '3']);
  assert.match(r.out, /queued warn\.overlap|posted warn\.overlap/, r.err);
  assert.equal(queued(box, 'warn.overlap')[0].body.jaccard, 67);
});

test('exactly 50 is inside the floor (PROTOCOL 5.2 is >=, not >)', () => {
  const box = joinedSandbox();
  const r = postOverlap(box, EDGE);
  assert.match(r.out, /queued warn\.overlap|posted warn\.overlap/, r.err);
  assert.equal(queued(box, 'warn.overlap')[0].body.jaccard, EDGE[2]);
});

test('the `warn overlap` sugar reaches the same computed-value rule', () => {
  const box = joinedSandbox();
  // SKILL.md 8 documents the sugar, not `post warn.overlap`, so the sugar is
  // the form a live session actually runs.
  const low = run(box, ['warn', 'overlap', '--subject', BELOW[0], '--peer', 'bob',
    '--peer-subject', BELOW[1], '--jaccard', '80']);
  assert.match(low.err, /jaccard is 40% - below the 50% floor/);
  assert.deepEqual(queued(box, 'warn.overlap'), []);

  const high = run(box, ['warn', 'overlap', '--subject', ABOVE[0], '--peer', 'bob',
    '--peer-subject', ABOVE[1], '--jaccard', '80']);
  assert.match(high.out, /queued warn\.overlap|posted warn\.overlap/, high.err);
  assert.equal(queued(box, 'warn.overlap')[0].body.jaccard, 67);
});
