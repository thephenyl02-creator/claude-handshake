'use strict';
// The three loose ends the adversarial pass over audit-fixes-2026-08-28 found.
// Each is a case where a fix landed correctly in one place and the seam beside
// it was left open, so each test below is pinned to the SEAM, not to the fix.
//
//   1. The relay create token is now PRINTED to its operator (deploy-relay, and
//      the deploy-in-place branch of upgrade), which puts it in a model's
//      context - yet it was the one handshake credential with no shape in
//      lib/secret-shapes.js, leaving the entropy heuristic as its only catch.
//      It now carries an `hsc_` prefix like hsk_/hsr_/hsm_/hsi1_.
//   2. `handshake upgrade` with no --relay deploys a relay in place and spends
//      its create token on one workspace. Without a print, that founder can
//      never create a SECOND workspace on the relay they own - the exact gap
//      seam 2 closed for deploy-relay. With --relay the founder supplied the
//      token themselves, so it must NOT be echoed back.
//   3. Below the Jaccard floor `warn overlap` still refuses, but SKILL.md 3.3
//      now routes the judged case to a note - so the refusal has to name that
//      route rather than read as "stay silent".
//
// No network anywhere: the wrangler runner and fetch are injected at the same
// lib/deploy seam test/deploy.test.js and test/seams.test.js use, and the ntfy
// endpoint is the discard port.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const filter = require('../lib/filter');
const deployLib = require('../lib/deploy');
const { HANDSHAKE_CREDENTIAL_SHAPES } = require('../lib/secret-shapes');

const CLI = path.join(__dirname, '..', 'bin', 'handshake.js');
const RELAY_SRC = path.join(__dirname, '..', 'relay', 'src');
const DEAD_ENDPOINT = 'http://127.0.0.1:9';     // discard port: always refused

const FAKE_URL = 'https://claude-handshake-relay.example.workers.dev';
const WS_ID = 'fedcba9876543210fedcba9876543210';
const ENROLL = 'hsk_' + 'a'.repeat(64) + '_deadbeef';
const RECOVERY = 'hsr_' + 'b'.repeat(64) + '_c0ffee01';
const MEMBER_ID = 'hsm_0123456789abcdef';
const MEMBER_TOKEN = 'hsm_0123456789abcdef_' + 'd'.repeat(64);

let n = 0;
function tmp(tag) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hs-loose-' + (tag || '') + (n++) + '-')));
}

// ================================ 1. the create token is caught by SHAPE =====

test('a freshly minted create token is blocked by its own registered shape, not by entropy', () => {
  const token = deployLib.newCreateToken();
  assert.match(token, /^hsc_[A-Za-z0-9_-]{40,}$/,
    'the create token carries a greppable prefix, like every other handshake credential');

  // The finding id is the assertion: `high-entropy-token` would mean the shape
  // is absent and the heuristic happened to save it - which is the ~1-in-3 gap
  // hsr_/hsm_/hsi1_ were given prefixes to close.
  const r = filter.check('here is the relay create token ' + token + ' keep it safe');
  assert.equal(r.ok, false);
  assert.ok(r.findings.some((f) => f.id === 'relay-create-token'),
    'caught by shape; got ' + r.findings.map((f) => f.id).join(','));
});

test('the shape survives the mangles that beat the entropy heuristic', () => {
  const token = deployLib.newCreateToken();
  const caught = (text) => {
    const r = filter.check(text);
    assert.equal(r.ok, false, 'expected BLOCKED: ' + text.slice(0, 40));
    assert.ok(r.findings.some((f) => f.id === 'relay-create-token'),
      'shape must carry it, not entropy: ' + r.findings.map((f) => f.id).join(','));
  };
  caught('FYI' + token + 'ok');                 // glued to prose: kills \b anchors
  caught(token.toUpperCase());                  // the uppercase evasion
  caught('a\n' + token + '\nb');
});

test('every credential the CLI prints to its operator has an entry in the shape list', () => {
  // The list is the single source of truth lib/filter.js and lib/repo.js both
  // consume, so a credential missing from it is a gap in BOTH.
  const ids = HANDSHAKE_CREDENTIAL_SHAPES.map((s) => s.id);
  for (const id of ['enrollment-token', 'recovery-key', 'member-sub-token', 'inline-invite', 'relay-create-token']) {
    assert.ok(ids.includes(id), 'missing shape: ' + id);
  }
});

test('COMPATIBILITY: the relay compares the create token opaquely, so old tokens keep working', () => {
  // The reason changing the generator is safe at all. If this ever stops
  // holding, an already-deployed relay holding a pre-hsc_ `wrangler secret`
  // would start refusing its own founder.
  const worker = fs.readFileSync(path.join(RELAY_SRC, 'worker.js'), 'utf8');
  const create = worker.slice(worker.indexOf('async function handleCreate'));
  const body = create.slice(0, create.indexOf('\nasync function route'));

  assert.match(body, /timingSafeEqual\(await sha256Hex\(/,
    'the create path is a constant-time digest comparison');
  assert.match(body, /sha256Hex\(env\.RELAY_CREATE_TOKEN\)/,
    'and what it hashes is the stored secret itself, as an opaque value');
  assert.equal(/credentialWellFormed|CRED_RE|startsWith|\.length\s*===/.test(body), false,
    'nothing on the create path may parse or validate the token format');

  // bearer() is the only other thing that touches it, and it accepts any
  // non-space run after `Bearer`.
  assert.match(worker, /\/\^Bearer\\s\+\(\\S\+\)\$\/i/,
    'bearer() imposes no format beyond "one non-space run"');

  // And the format gate that DOES exist is scoped to the enrollment token and
  // the recovery key only.
  const dor = fs.readFileSync(path.join(RELAY_SRC, 'do', 'workspace.js'), 'utf8');
  const gated = dor.match(/credentialWellFormed\(token, (\w+)\)/g) || [];
  assert.deepEqual(gated.sort(), [
    'credentialWellFormed(token, ENROLL_PREFIX)',
    'credentialWellFormed(token, RECOVERY_PREFIX)',
  ], 'the well-formedness gate must not reach the create token');
});

// =============================== 2. upgrade shows the token it minted ========

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

function makeFakeFetch() {
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
    if (/\/ws\/[0-9a-f]+\/join$/.test(u) && i.method === 'POST') return resp(200, { member_id: MEMBER_ID, token: MEMBER_TOKEN });
    return resp(404, { error: 'not_found' });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

// The test runner's own reporter reaches process.stdout through a piped
// transform, so its output for ALREADY-FINISHED tests can still be in flight
// when a capture window opens - and a capture that swallows it makes those
// tests vanish from the report even though they passed. Let the pipeline drain
// first; it costs two event-loop turns.
const drainReporter = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)));

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

function cli(box, args, opts) {
  const o = opts || {};
  const r = spawnSync(process.execPath, [CLI].concat(args), {
    cwd: box.project,
    input: o.stdin === undefined ? '' : o.stdin,
    encoding: 'utf8',
    timeout: 30000,
    env: Object.assign({}, process.env, {
      HANDSHAKE_STATE_DIR: box.data,
      HANDSHAKE_SESSION_ID: 'loose-session',
      CLAUDE_CODE_CHILD_SESSION: '',
      HANDSHAKE_SKIP_HOST_CHECKS: '1',
    }),
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// A zero-setup (ntfy) workspace on the discard port: exactly what `upgrade`
// migrates from. The migrate post fails silently into the offline queue, which
// is correct here and irrelevant to the seam under test.
function ntfyBox() {
  const root = tmp('box');
  const project = path.join(root, 'project');
  fs.mkdirSync(project, { recursive: true });
  const box = { root, project, data: path.join(root, 'data') };
  const init = cli(box, ['init', '--ntfy', DEAD_ENDPOINT, '--name', 'acme app', '--no-repo']);
  assert.equal(init.code, 0, init.err);
  return box;
}

// Runs cmdUpgrade in-process against the mock seams, restoring every piece of
// ambient state it has to touch.
async function upgrade(box, flags) {
  const mod = require('../bin/handshake');
  const runner = makeFakeRunner();
  const fetchImpl = makeFakeFetch();
  await drainReporter();
  const io = captureIo();
  const savedCwd = process.cwd();
  const savedChild = process.env.CLAUDE_CODE_CHILD_SESSION;
  const savedData = process.env.HANDSHAKE_STATE_DIR;
  const savedExit = process.exitCode;
  delete process.env.CLAUDE_CODE_CHILD_SESSION;
  process.env.HANDSHAKE_STATE_DIR = box.data;
  process.chdir(box.project);
  let exitCode;
  try {
    await mod.COMMANDS.upgrade({
      _: [],
      flags: Object.assign({ yes: true, 'work-dir': path.join(tmp('work'), 'relay') }, flags || {}),
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
  const raw = fs.readFileSync(path.join(box.data, WS_ID, 'state.json'), 'utf8');
  return { stdout: io.out(), stderr: io.err(), raw, cfg: JSON.parse(raw), runner, fetchImpl, exitCode };
}

test('upgrade that deploys the relay in place shows the create token it minted, ONCE', async () => {
  const r = await upgrade(ntfyBox());

  // The token piped to `wrangler secret put` is the token the founder is shown -
  // one value, not two, and it is the only copy they will ever get.
  const put = r.runner.calls.filter((c) => c.argv.join(' ').includes('secret put'));
  assert.equal(put.length, 1);
  const token = String(put[0].input || '').trim();
  assert.ok(token.length >= 32, 'the create token is real key material');
  const shown = (r.stdout.match(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  assert.equal(shown, 1, 'shown exactly ONCE, like the recovery key');

  assert.match(r.stdout, /These are shown ONCE/);
  assert.match(r.stdout, /create token:/);
  assert.match(r.stdout, /handshake init --relay/);
  assert.match(r.stdout, /wrangler secret put RELAY_CREATE_TOKEN/);

  // Same rule deploy-relay keeps (SECURITY.md 3): its home is the Cloudflare
  // secret store, and local state is not a second home for it.
  assert.equal(r.raw.includes(token), false, 'the create token must never land in local state');
  assert.equal(r.cfg.create_token, undefined);
  for (const c of r.runner.calls) {
    assert.equal(c.argv.join('\x00').includes(token), false, 'credentials never go on argv');
  }

  // and the migration itself still happened.
  assert.equal(r.cfg.transport, 'relay');
  assert.equal(r.cfg.endpoint, FAKE_URL);
  assert.equal(r.cfg.member_token, MEMBER_TOKEN);
});

test('upgrade --relay never echoes the create token the founder typed in', async () => {
  const box = ntfyBox();
  const mod = require('../bin/handshake');
  const fetchImpl = makeFakeFetch();
  await drainReporter();
  const io = captureIo();
  const savedCwd = process.cwd();
  const savedData = process.env.HANDSHAKE_STATE_DIR;
  const savedChild = process.env.CLAUDE_CODE_CHILD_SESSION;
  const savedExit = process.exitCode;
  const TYPED = deployLib.newCreateToken();
  delete process.env.CLAUDE_CODE_CHILD_SESSION;
  process.env.HANDSHAKE_STATE_DIR = box.data;
  process.chdir(box.project);
  let out;
  try {
    // The --relay branch reads the token from stdin. ask() is the CLI's own
    // prompt, so the answer is fed the way a pipe would feed it.
    const stdinFile = path.join(tmp('stdin'), 'in.txt');
    fs.writeFileSync(stdinFile, TYPED + '\n');
    const savedStdin = Object.getOwnPropertyDescriptor(process, 'stdin');
    Object.defineProperty(process, 'stdin', {
      configurable: true, value: fs.createReadStream(stdinFile),
    });
    try {
      await mod.COMMANDS.upgrade({
        _: [], flags: { relay: FAKE_URL }, hooks: { fetchImpl },
      });
    } finally {
      Object.defineProperty(process, 'stdin', savedStdin);
    }
    out = io.out();
  } finally {
    io.restore();
    process.chdir(savedCwd);
    if (savedData === undefined) delete process.env.HANDSHAKE_STATE_DIR; else process.env.HANDSHAKE_STATE_DIR = savedData;
    if (savedChild === undefined) delete process.env.CLAUDE_CODE_CHILD_SESSION; else process.env.CLAUDE_CODE_CHILD_SESSION = savedChild;
    process.exitCode = savedExit;
  }

  assert.match(out, /These are shown ONCE/, 'the migration still completed');
  assert.equal(out.includes(TYPED), false,
    'a token the founder supplied is not ours to print back into the transcript');
  assert.equal(/create token:/.test(out), false, 'no create-token line on the --relay branch');
});

// ============================ 3. the sub-floor refusal names the note route ==

test('a sub-floor warn overlap points at the note route SKILL.md 3.3 opened', () => {
  const box = ntfyBox();
  //   {auth,rework} vs {login,flow,overhaul}: |n| = 0, |u| = 5 -> 0
  const r = cli(box, ['warn', 'overlap', '--subject', 'auth rework',
    '--peer', 'bob', '--peer-subject', 'login flow overhaul']);
  assert.match(r.err, /jaccard is 0% - below the 50% floor/, r.out);
  assert.match(r.err, /note info/,
    'the floor governs the WARNING; a judged overlap still has a route, and the refusal must name it');
  assert.match(r.err, /--subject "auth rework"/,
    'the suggested note is linked to the caller\'s own subject, not a generic placeholder');
});
