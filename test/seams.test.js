'use strict';
// The seams between commands, not the commands themselves. Each piece below
// passed its own tests while the handoff between two of them was broken:
//
//   1. `deploy-relay` created a workspace and never enrolled the founder in it,
//      so the founder's very next relay call sent an undefined bearer token and
//      got 401 - invisibly, because the monitor runs with stdio ignored.
//   2. `deploy-relay` minted RELAY_CREATE_TOKEN, piped it to `wrangler secret
//      put` and dropped it, while `init --relay` / `upgrade --relay` prompt for
//      exactly that token - so the founder could never create a second
//      workspace on the relay they own.
//   3. `join` asks twice (typed confirmation, then member name - section 9.1
//      forbids --yes) but ask()'s piped branch threw away everything it had
//      already read past the first newline, so the second prompt got nothing.
//
// No network anywhere: the wrangler runner and fetch are injected at the same
// lib/deploy seam test/deploy.test.js uses, and the ntfy endpoint is the
// discard port.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'handshake.js');
const DEAD_ENDPOINT = 'http://127.0.0.1:9';     // discard port: always refused

const FAKE_URL = 'https://claude-handshake-relay.example.workers.dev';
const WS_ID = 'fedcba9876543210fedcba9876543210';
const ENROLL = 'hsk_' + 'a'.repeat(64) + '_deadbeef';
const RECOVERY = 'hsr_' + 'b'.repeat(64) + '_c0ffee01';
const MEMBER_ID = 'hsm_0123456789abcdef';
const MEMBER_TOKEN = 'hsm_0123456789abcdef_' + 'd'.repeat(64);

let n = 0;
function tmp(tag) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hs-seam-' + (tag || '') + (n++) + '-')));
}

// ------------------------------------------------------------- fake wrangler --
// Same shape lib/deploy.defaultRunner returns. The stdin of the `secret put`
// call is recorded because that is the only other place the create token ever
// appears - the test cross-checks the printed one against it.

function makeFakeRunner() {
  const calls = [];
  const ok = (stdout) => ({ ok: true, status: 0, stdout: stdout || '', stderr: '', error: null, timedOut: false, missing: false });
  const runner = (npxArgs, callOpts) => {
    const co = callOpts || {};
    calls.push({ argv: npxArgs.slice(), input: co.input });
    const s = npxArgs.join(' ');
    if (s === '--version') return ok('10.9.0\n');
    if (/--no-install .*wrangler.* --version/.test(s)) return ok('wrangler 4.99.0\n');
    if (/\bwhoami\b/.test(s)) return ok('You are logged in with an OAuth Token, associated with the email dev@example.com.\n');
    if (/\bdeploy\b/.test(s)) return ok('Deployed claude-handshake-relay triggers (2.0 sec)\n  ' + FAKE_URL + '\nCurrent Version ID: abc123\n');
    if (/secret put/.test(s)) return ok('Success! Uploaded secret RELAY_CREATE_TOKEN\n');
    return { ok: false, status: 1, stdout: '', stderr: 'unknown command', error: null, timedOut: false, missing: false };
  };
  runner.calls = calls;
  return runner;
}

// /health, POST /ws and - the seam under test - POST /ws/:id/join.
// `joinStatus` drives the failure case.
function makeFakeFetch(opts) {
  const o = opts || {};
  const calls = [];
  const resp = (status, body) => {
    const text = JSON.stringify(body);
    return Promise.resolve({ ok: status >= 200 && status < 300, status, text: async () => text });
  };
  const fetchImpl = (url, init) => {
    const u = String(url);
    const i = init || {};
    calls.push({ url: u, method: i.method || 'GET', headers: i.headers || {}, body: i.body });
    if (/\/health$/.test(u)) return resp(200, { ok: true, service: 'claude-handshake-relay', version: '0.1.2', protocol: 1 });
    if (/\/ws$/.test(u) && i.method === 'POST') {
      return resp(201, { ws: WS_ID, created_at: Date.now(), enrollment_token: ENROLL, recovery_key: RECOVERY });
    }
    if (/\/ws\/[0-9a-f]+\/join$/.test(u) && i.method === 'POST') {
      if (o.joinStatus) return resp(o.joinStatus, { error: 'enrollment_closed' });
      return resp(200, { member_id: MEMBER_ID, token: MEMBER_TOKEN });
    }
    return resp(404, { error: 'not_found' });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function captureIo() {
  const outW = process.stdout.write.bind(process.stdout);
  const errW = process.stderr.write.bind(process.stderr);
  const o = [];
  const e = [];
  process.stdout.write = (s) => { o.push(String(s)); return true; };
  process.stderr.write = (s) => { e.push(String(s)); return true; };
  return {
    out: () => o.join(''),
    err: () => e.join(''),
    restore() { process.stdout.write = outW; process.stderr.write = errW; },
  };
}

// Runs cmdDeployRelay in-process with the mock seams, restoring every piece of
// ambient state it has to touch (cwd, state dir, the child-session marker this
// test process itself carries).
async function deployRelay(flags, fetchOpts) {
  const mod = require('../bin/handshake');
  const data = tmp('data');
  const project = tmp('proj');
  const runner = makeFakeRunner();
  const fetchImpl = makeFakeFetch(fetchOpts);
  const io = captureIo();
  const savedCwd = process.cwd();
  const savedChild = process.env.CLAUDE_CODE_CHILD_SESSION;
  const savedData = process.env.HANDSHAKE_STATE_DIR;
  const savedExit = process.exitCode;
  delete process.env.CLAUDE_CODE_CHILD_SESSION;
  process.env.HANDSHAKE_STATE_DIR = data;
  process.chdir(project);
  let exitCode;
  try {
    await mod.COMMANDS['deploy-relay']({
      _: [],
      flags: Object.assign({ yes: true, name: 'acme-relay', 'no-repo': true, 'work-dir': path.join(tmp('work'), 'relay') }, flags || {}),
      hooks: { runner, fetchImpl },
    });
    exitCode = process.exitCode;
  } finally {
    io.restore();
    process.chdir(savedCwd);
    if (savedChild === undefined) delete process.env.CLAUDE_CODE_CHILD_SESSION; else process.env.CLAUDE_CODE_CHILD_SESSION = savedChild;
    if (savedData === undefined) delete process.env.HANDSHAKE_STATE_DIR; else process.env.HANDSHAKE_STATE_DIR = savedData;
    process.exitCode = savedExit;
  }
  const raw = fs.readFileSync(path.join(data, WS_ID, 'state.json'), 'utf8');
  return { stdout: io.out(), stderr: io.err(), cfg: JSON.parse(raw), raw, runner, fetchImpl, exitCode };
}

// =========================================== seam 1: the founder is a member ==

test('deploy-relay enrols the founder, exactly as init does', async () => {
  const r = await deployRelay();

  // The join actually happened, against the workspace that was just created and
  // with the enrollment token as the bearer - not the (absent) member token.
  const join = r.fetchImpl.calls.filter((c) => /\/join$/.test(c.url));
  assert.equal(join.length, 1, 'deploy-relay must join the workspace it created');
  assert.equal(join[0].url, FAKE_URL + '/ws/' + WS_ID + '/join');
  assert.match(String(join[0].headers.Authorization || join[0].headers.authorization), new RegExp('^Bearer ' + ENROLL + '$'));

  // The persisted state carries the three member fields the next command reads.
  // Without them every relay call sends `Bearer undefined` and gets a 401 the
  // human never sees.
  assert.equal(r.cfg.member, MEMBER_ID);
  assert.equal(r.cfg.member_token, MEMBER_TOKEN);
  assert.ok(r.cfg.member_name && r.cfg.member_name.length >= 1);
  assert.ok(typeof r.cfg.joined_at === 'number' && r.cfg.joined_at > 0);

  assert.match(r.stdout, /member:\s+hsm_0123456789abcdef\b/);
});

test('deploy-relay --as names the founder, like init --as', async () => {
  // A name with a space in it cannot collide with the derived default, which
  // replaces whitespace - so this proves --as was READ, not merely matched.
  const r = await deployRelay({ as: '  Ada Lovelace  ' });
  assert.equal(r.cfg.member_name, 'Ada Lovelace', '--as is trimmed, not passed through raw');
  const body = JSON.parse(r.fetchImpl.calls.filter((c) => /\/join$/.test(c.url))[0].body);
  assert.equal(body.member, 'Ada Lovelace');
});

test('a refused enrolment is non-fatal and diagnosable, not a silent half-state', async () => {
  const r = await deployRelay(null, { joinStatus: 403 });

  // The workspace exists and the invite still works, so this is not an error
  // exit - but the human is told, in the words that name the fix.
  assert.equal(r.exitCode, undefined, 'the workspace was created; deploy-relay must not exit non-zero');
  assert.match(r.stderr, /workspace created, but enrolling you as a member failed \(enrollment_closed\)/);
  assert.match(r.stderr, /Run `handshake join <invite>` to finish/);
  assert.match(r.stdout, /NOT enrolled/);
  assert.match(r.stdout, /hsi1_/, 'the invite is still printed - it is what finishes the join');

  // The state is still written (ws, secret, tokens), just without a membership:
  // that is the state `handshake join` can complete.
  assert.equal(r.cfg.ws, WS_ID);
  assert.equal(r.cfg.enrollment_token, ENROLL);
  assert.ok(r.cfg.secret);
  assert.equal(r.cfg.member_token, undefined);
});

// ============================== seam 2: the create token reaches its founder ==

test('deploy-relay shows the create token once and persists it nowhere', async () => {
  const r = await deployRelay();

  // The token that was piped to `wrangler secret put` over stdin is the token
  // the founder is shown - one value, not two.
  const put = r.runner.calls.filter((c) => c.argv.join(' ').includes('secret put'));
  assert.equal(put.length, 1);
  const token = String(put[0].input || '').trim();
  assert.ok(token.length >= 32, 'the create token is real key material');
  const shown = (r.stdout.match(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  assert.equal(shown, 1, 'the create token is shown exactly ONCE, like the recovery key');

  // It is displayed in the ONCE block and says what it is for - `init --relay`
  // and `upgrade --relay` prompt for it, and nothing else can hand it over.
  assert.match(r.stdout, /These are shown ONCE/);
  assert.match(r.stdout, /create token:/);
  assert.match(r.stdout, /handshake init --relay/);
  assert.match(r.stdout, /wrangler secret put RELAY_CREATE_TOKEN/);

  // SECURITY.md §3: its home is the Cloudflare secret store. Local state is not
  // a second home for it, and no field of the persisted config carries it.
  assert.equal(r.raw.includes(token), false, 'the create token must never land in local state');
  assert.equal(r.cfg.create_token, undefined);

  // It never travelled on argv either (SECURITY.md §3, rule 2 of bin/handshake.js).
  for (const c of r.runner.calls) {
    assert.equal(c.argv.join(' ').includes(token), false, 'credentials never go on argv');
  }
});

// ================================= seam 3: two prompts down one piped stdin ===

function sandbox() {
  const root = tmp('cli');
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
      HANDSHAKE_SESSION_ID: 'seam-session',
      CLAUDE_CODE_CHILD_SESSION: '',
      HANDSHAKE_SKIP_HOST_CHECKS: '1',
    }),
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

test('join finishes over a pipe when --as is omitted: both answers survive one stdin', () => {
  const box = sandbox();
  const init = run(box, ['init', '--ntfy', DEAD_ENDPOINT, '--name', 'acme app']);
  assert.equal(init.code, 0, init.err);
  const blob = run(box, ['invite', '--inline']).out.trim().split('\n').pop().trim();
  assert.match(blob, /^hsi1_/);

  const peer = sandbox();
  // One write carrying both answers: the typed confirmation section 9.1
  // demands, then the member name. The second read used to get nothing.
  const joined = run(peer, ['join', blob], { stdin: 'y\nAlice\n' });
  assert.equal(joined.code, 0, joined.err);
  assert.match(joined.out, /joined acme app as Alice/);

  const status = JSON.parse(run(peer, ['status', '--json']).out);
  assert.equal(status.workspace.member_name, 'Alice');
});

test('the typed-confirmation rule still holds: a leading no joins nothing', () => {
  const box = sandbox();
  run(box, ['init', '--ntfy', DEAD_ENDPOINT, '--name', 'acme app']);
  const blob = run(box, ['invite', '--inline']).out.trim().split('\n').pop().trim();
  const peer = sandbox();

  // A queued member name after the refusal must not be mistaken for consent.
  const declined = run(peer, ['join', blob], { stdin: 'n\nAlice\n' });
  assert.equal(declined.code, 0);
  assert.match(declined.out, /not joined/);
  assert.equal(fs.existsSync(peer.data), false, 'nothing was persisted');

  // And --yes is still not a substitute for typing it.
  const forced = run(peer, ['join', blob, '--yes'], { stdin: '\nAlice\n' });
  assert.match(forced.err, /--yes is not accepted for join/);
  assert.match(forced.out, /not joined/);
});
