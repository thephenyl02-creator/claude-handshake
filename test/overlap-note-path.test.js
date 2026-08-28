'use strict';
// Why this file exists: making `warn.overlap.jaccard` always a MEASUREMENT
// (test/overlap-floor.test.js) closed the only route a model had for the case
// most worth flagging - real overlap worded so differently that the token sets
// share nothing and score 0. SKILL.md 3.3 now routes that case to a
// `note.info` instead, on the reading that PROTOCOL 5.2's floor governs the
// WARNING and PROTOCOL 3.2's note schema ({text, paths?, subject?,
// subject_key?}) carries no score and no threshold.
//
// That reading is a claim about the CLI, so it is pinned here: at the same
// zero-scoring subject pair, `warn overlap` must refuse and `note info
// --subject` must go through carrying no jaccard field. Nothing else covers
// it - test/overlap-floor.test.js only ever asserts the refusal half, and
// test/cli.test.js posts notes without a --subject.
//
// The transport points at a closed loopback port, so every emission lands in
// the offline queue, which is where the WIRE form can be read.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'handshake.js');
const SKILL = path.join(__dirname, '..', 'skills', 'handshake-coordination', 'SKILL.md');
const DEAD_ENDPOINT = 'http://127.0.0.1:9';     // discard port: always refused

// SKILL.md 3.3's worked example, with the arithmetic spelled out so the
// expected integer is checkable without re-running lib/subject.js. No word
// here is a PROTOCOL 5.1 stopword, so each token set is just its words:
//
//   {auth,rework} vs {login,flow,overhaul}
//   |n| = 0, |u| = 2 + 3 - 0 = 5  ->  0/5 = 0.00  ->  0
const MINE = 'auth rework';
const THEIRS = 'login flow overhaul';

let n = 0;
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
      HANDSHAKE_SKIP_HOST_CHECKS: '1',
    }),
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// init + invite + join: the shortest path to a workspace that can post.
function joinedSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-notepath-' + (n++) + '-'));
  const project = path.join(root, 'project');
  fs.mkdirSync(project, { recursive: true });
  const box = { root, project, data: path.join(root, 'data') };
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

test('the semantic-overlap case scores 0, so no warn.overlap can carry it', () => {
  const box = joinedSandbox();
  const r = run(box, ['warn', 'overlap', '--subject', MINE, '--peer', 'bob',
    '--peer-subject', THEIRS]);
  assert.match(r.err, /jaccard is 0% - below the 50% floor/,
    'PROTOCOL 5.2 makes >= 50 a MUST on the emitter, and 0 is the honest score here');
  assert.deepEqual(queued(box, 'warn.overlap'), [],
    'nothing may reach the wire - this is the capability SKILL.md 3.3 reroutes');
});

test('the same judged overlap does go out as a note.info linked to the claim', () => {
  const box = joinedSandbox();
  const r = run(box, ['note', 'info',
    'your login flow overhaul and my auth rework read as one job to me',
    '--subject', MINE]);
  assert.match(r.out, /queued note\.info|posted note\.info/, r.err);

  const envs = queued(box, 'note.info');
  assert.equal(envs.length, 1, 'the note path is not score-gated: PROTOCOL 3.2 gives note.* no threshold');
  // The link back to the claim is what makes the note actionable for the peer:
  // without it the reader cannot tell which of your claims the judgement is about.
  assert.equal(envs[0].body.subject, MINE);
  assert.equal(envs[0].body.subject_key, MINE);
  assert.match(envs[0].body.text, /login flow overhaul/);
});

test('the note carries no jaccard field - a judgement must not look measured', () => {
  const box = joinedSandbox();
  run(box, ['note', 'info', 'these are one job', '--subject', MINE, '--jaccard', '80']);
  const body = queued(box, 'note.info')[0].body;
  assert.equal('jaccard' in body, false,
    'note.* is {text, paths?, subject?, subject_key?} (PROTOCOL 3.2); an unknown ' +
    'field here would put an asserted number under a name PROTOCOL 3.2 defines ' +
    'as a measurement, which is exactly what the warn.overlap fix removed');
  assert.deepEqual(Object.keys(body).sort(), ['subject', 'subject_key', 'text']);
});

// SKILL.md is instructional text with no runtime, but its 3.3 previously read
// "No warning, no note, no mention" - a blanket ban that forbade the note path
// the two tests above prove is open. A regression there is silent and only
// shows up in live sessions, so it is pinned as text.
test('SKILL.md 3.3 no longer forbids mentioning a sub-floor overlap', () => {
  const md = fs.readFileSync(SKILL, 'utf8');
  const s33 = md.slice(md.indexOf('### 3.3'), md.indexOf('### 3.4'));
  assert.notEqual(s33.length, 0, 'section 3.3 must still exist');
  assert.equal(/no note/i.test(s33), false, 'the blanket ban on a note must not come back');
  assert.match(s33, /note\.info/, 'and the note route must be named where the model will look for it');
});
