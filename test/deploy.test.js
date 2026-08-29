'use strict';
// The wrapped relay deploy (`handshake deploy-relay`).
//
// NO real Cloudflare and NO network anywhere in this file. Two mocking layers:
//
//   1. A fake `npx` shim script put FIRST on PATH, driven through the REAL
//      lib/deploy runner - so the Windows `cmd.exe /d /s /c npx ...` path (which
//      exists precisely because Node 24 refuses to spawn npx.cmd with
//      shell:false) is exercised end-to-end, not stubbed away.
//   2. An in-JS fake runner + fake fetch injected at the lib/deploy boundary,
//      for the orchestration, the 503-propagation retry, and the full
//      cmdDeployRelay flow (persist + invite + recovery-key-once).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const deployLib = require('../lib/deploy');
const inviteLib = require('../lib/invite');
const stateLib = require('../lib/state');

const REPO_RELAY = path.join(__dirname, '..', 'relay');
const CLI = path.join(__dirname, '..', 'bin', 'handshake.js');

let n = 0;
function tmp(tag) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hs-deploy-' + (tag || '') + (n++) + '-')));
}

const FAKE_URL = 'https://claude-handshake-relay.fenil.workers.dev';
const WS_ID = '0123456789abcdef0123456789abcdef';
const ENROLL = 'hsk_' + 'a'.repeat(64) + '_deadbeef';
const RECOVERY = 'hsr_' + 'b'.repeat(64) + '_c0ffee01';

// ============================================================ fake wrangler ==
// An in-JS runner matching lib/deploy.defaultRunner's return shape. It records
// every call (argv, cwd, stdin) so tests can prove what did and did not travel
// on the argv.

function makeFakeRunner(opts) {
  const o = opts || {};
  const calls = [];
  const st = { loggedIn: o.loggedIn === true, wranglerCached: o.wranglerCached !== false, npxMissing: o.npxMissing === true };
  const ok = (stdout, extra) => Object.assign({ ok: true, status: 0, stdout: stdout || '', stderr: '', error: null, timedOut: false, missing: false }, extra || {});
  const fail = (stderr, extra) => Object.assign({ ok: false, status: 1, stdout: '', stderr: stderr || '', error: null, timedOut: false, missing: false }, extra || {});
  const runner = (npxArgs, callOpts) => {
    const co = callOpts || {};
    calls.push({ argv: npxArgs.slice(), cwd: co.cwd, input: co.input, inherit: Boolean(co.inherit) });
    const s = npxArgs.join(' ');
    if (st.npxMissing) return fail('npx is not recognized as an internal or external command', { missing: true, status: 9009 });
    if (s === '--version') return ok('10.9.0\n');
    if (/--no-install .*wrangler.* --version/.test(s)) {
      return st.wranglerCached ? ok('wrangler 4.99.0\n') : fail('npm ERR! could not determine executable to run');
    }
    if (/\bwhoami\b/.test(s)) {
      return ok(st.loggedIn
        ? 'Getting User settings...\nYou are logged in with an OAuth Token, associated with the email dev@example.com.\n'
        : 'Getting User settings...\nYou are not authenticated. Please run `wrangler login`.\n');
    }
    if (/\blogin\b/.test(s)) { st.loggedIn = true; return ok('Attempting to login via OAuth...\nOpen https://dash.cloudflare.com/oauth2/auth\n'); }
    if (/\bdeploy\b/.test(s)) {
      return ok('Total Upload: 12 KiB\nUploaded claude-handshake-relay (1.2 sec)\nDeployed claude-handshake-relay triggers (2.0 sec)\n  ' + FAKE_URL + '\nCurrent Version ID: abc123\n');
    }
    if (/secret put/.test(s)) return ok('Success! Uploaded secret RELAY_CREATE_TOKEN\n');
    return fail('unknown command');
  };
  runner.calls = calls;
  runner.state = st;
  return runner;
}

// A fetch-like impl: /health and POST /ws only. Optionally 503s the create call
// a few times first, to exercise the secret-propagation retry.
function makeFakeFetch(opts) {
  const o = opts || {};
  let create503 = Number(o.create503) || 0;
  const ws = o.ws || WS_ID;
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
    if (/\/ws$/.test(u) && (i.method === 'POST')) {
      if (create503 > 0) { create503--; return resp(503, { error: 'relay_not_configured' }); }
      const name = (() => { try { return JSON.parse(i.body || '{}').name || ''; } catch (_) { return ''; } })();
      return resp(201, { ws, name, created_at: Date.now(), enrollment_token: ENROLL, recovery_key: RECOVERY });
    }
    return resp(404, { error: 'not_found' });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

// =================================================== pure-function unit tests =

test('extractDeployedUrl finds the workers.dev URL and ignores cloudflare.com noise', () => {
  const good = 'Uploaded x (1s)\nDeployed x triggers (2s)\n  https://claude-handshake-relay.sub.workers.dev\nCurrent Version ID: y\n';
  assert.equal(deployLib.extractDeployedUrl(good), 'https://claude-handshake-relay.sub.workers.dev');
  // The two-label form wrangler prints for a bare subdomain.
  assert.equal(deployLib.extractDeployedUrl('  https://sub.workers.dev\n'), 'https://sub.workers.dev');
  // A deploy whose only URLs are Terms/dashboard links must NOT be mistaken for
  // the deployment URL.
  const noisy = 'Continuing means you accept Cloudflare\'s Terms of Service (https://www.cloudflare.com/terms/)\nClaim URL: https://dash.cloudflare.com/claim-preview?claimToken=z\n';
  assert.equal(deployLib.extractDeployedUrl(noisy), null);
});

test('wranglerSpecFrom reads the pinned major from relay/package.json', () => {
  const spec = deployLib.wranglerSpecFrom(REPO_RELAY);
  assert.equal(spec.major, 4);
  assert.equal(spec.spec, 'wrangler@4');
});

test('locateRelayDir finds the bundled relay from bin/, and null when absent', () => {
  // bin/ is a sibling of relay/, so from <repo>/bin the relay resolves.
  const found = deployLib.locateRelayDir(path.join(__dirname, '..', 'bin'));
  assert.ok(found && fs.existsSync(path.join(found, 'wrangler.toml')));
  assert.equal(deployLib.locateRelayDir(tmp('norelay')), null);
});

test('prepareWorkDir refuses a missing relay dir with guidance, not a stack', () => {
  assert.throws(() => deployLib.prepareWorkDir(null, tmp('w')), (e) => {
    assert.equal(e.name, 'DeployError');
    assert.equal(e.code, 'relay-missing');
    assert.match(e.guidance, /deploy it by hand|relay\//i);
    return true;
  });
});

test('prepareWorkDir copies src + wrangler.toml + package.json into a writable dir', () => {
  const work = path.join(tmp('work'), 'relay');
  deployLib.prepareWorkDir(REPO_RELAY, work);
  assert.ok(fs.existsSync(path.join(work, 'wrangler.toml')));
  assert.ok(fs.existsSync(path.join(work, 'package.json')));
  assert.ok(fs.existsSync(path.join(work, 'src', 'worker.js')));
  // test/ and node_modules are NOT copied.
  assert.equal(fs.existsSync(path.join(work, 'test')), false);
  assert.equal(fs.existsSync(path.join(work, 'node_modules')), false);
});

test('wranglerAvailable classifies ok / needs-download / npx-missing', () => {
  assert.equal(deployLib.wranglerAvailable({ runner: makeFakeRunner(), relayDir: REPO_RELAY }).status, 'ok');
  assert.equal(deployLib.wranglerAvailable({ runner: makeFakeRunner({ wranglerCached: false }), relayDir: REPO_RELAY }).status, 'needs-download');
  assert.equal(deployLib.wranglerAvailable({ runner: makeFakeRunner({ npxMissing: true }), relayDir: REPO_RELAY }).status, 'npx-missing');
});

test('whoami parses logged-in vs not-authenticated from the text, not the exit code', () => {
  const inn = deployLib.whoami({ runner: makeFakeRunner({ loggedIn: true }), spec: 'wrangler@4' });
  assert.equal(inn.loggedIn, true);
  assert.equal(inn.email, 'dev@example.com');
  assert.equal(deployLib.whoami({ runner: makeFakeRunner({ loggedIn: false }), spec: 'wrangler@4' }).loggedIn, false);
});

test('whoami separates "wrangler said you are not logged in" from "wrangler said nothing"', () => {
  // A timeout or a crash also yields loggedIn:false. Without `answered`, the
  // guidance printed after it would assert a fact wrangler never stated.
  const silent = () => ({ ok: false, status: 1, stdout: '', stderr: '', error: null, timedOut: true, missing: false });
  const dead = deployLib.whoami({ runner: silent, spec: 'wrangler@4' });
  assert.equal(dead.loggedIn, false);
  assert.equal(dead.answered, false);
  assert.equal(deployLib.whoami({ runner: makeFakeRunner({ loggedIn: true }), spec: 'wrangler@4' }).answered, true);
  assert.equal(deployLib.whoami({ runner: makeFakeRunner({ loggedIn: false }), spec: 'wrangler@4' }).answered, true);
});

test('login refuses in ~no time when stdin is not a terminal, instead of hanging out the login timeout', () => {
  const runner = makeFakeRunner({ loggedIn: false });
  assert.throws(() => deployLib.login({ runner, spec: 'wrangler@4', interactive: false }), (e) => {
    assert.equal(e.name, 'DeployError');
    assert.equal(e.code, 'login-needs-terminal');
    // The guidance must name the command that works where they can run it, and
    // how to come back - not just report the refusal.
    assert.match(e.guidance, /npx --yes wrangler@4 login/);
    assert.match(e.guidance, /own terminal/i);
    assert.match(e.guidance, /re-run `handshake deploy-relay`/);
    // And it must say what the wait would have cost, since that silence is the
    // whole bug being fixed.
    assert.match(e.guidance, new RegExp(String(Math.round(deployLib.TIMEOUTS.login / 60000)) + ' minutes'));
    return true;
  });
  assert.equal(runner.calls.length, 0, 'nothing may be spawned: the point is to fail before the wait');
});

test('the terminal check defaults to this process\'s own stdin', (t) => {
  // Under `node --test` stdin is a pipe - the same shape a Claude Code Bash
  // call has - so the DEFAULT (no `interactive` passed, exactly how bin/ calls
  // it) must refuse. This is the seam the whole finding turns on.
  if (process.stdin.isTTY) return t.skip('this test process has a real terminal on stdin');
  assert.equal(deployLib.stdinIsTerminal({}), false);
  assert.equal(deployLib.stdinIsTerminal({ interactive: true }), true, 'an explicit caller still wins');
  const runner = makeFakeRunner({ loggedIn: false });
  assert.throws(() => deployLib.login({ runner, spec: 'wrangler@4' }), (e) => e.code === 'login-needs-terminal');
});

// `interactive: true` stands in for the founder's real terminal: under
// `node --test` this process's stdin is a pipe, and login now refuses that
// outright (see the login-needs-terminal tests below).
test('login declares success only after a follow-up whoami confirms it', () => {
  const runner = makeFakeRunner({ loggedIn: false });
  const res = deployLib.login({ runner, spec: 'wrangler@4', interactive: true });
  assert.equal(res.loggedIn, true);
  const subs = runner.calls.map((c) => c.argv.join(' '));
  assert.ok(subs.some((s) => /\blogin\b/.test(s)), 'must have called login');
  assert.ok(subs.filter((s) => /\bwhoami\b/.test(s)).length >= 1, 'must confirm with whoami after login');
});

test('createWorkspaceWithRetry rides out a 503 relay_not_configured while the secret propagates', async () => {
  const fetchImpl = makeFakeFetch({ create503: 2 });
  const created = await deployLib.createWorkspaceWithRetry({
    origin: FAKE_URL, createToken: 'tok', name: 'demo', fetchImpl, delayMs: 5, attempts: 6,
  });
  assert.equal(created.ws, WS_ID);
  assert.equal(created.enrollment_token, ENROLL);
  // 2 x 503 + 1 x 201 = three POST /ws attempts.
  assert.equal(fetchImpl.calls.filter((c) => c.method === 'POST').length, 3);
});

test('createWorkspaceWithRetry surfaces a real refusal (401) as one-line guidance', async () => {
  const fetchImpl = (url, init) => Promise.resolve({ ok: false, status: 401, text: async () => JSON.stringify({ error: 'invalid_token' }) });
  await assert.rejects(deployLib.createWorkspaceWithRetry({ origin: FAKE_URL, createToken: 'bad', fetchImpl, delayMs: 1, attempts: 3 }), (e) => {
    assert.equal(e.name, 'DeployError');
    assert.match(e.guidance, /create token|re-run/i);
    return true;
  });
});

test('probeHealth rejects a protocol mismatch loudly', async () => {
  const fetchImpl = (url) => Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, protocol: 2 }) });
  await assert.rejects(deployLib.probeHealth({ origin: FAKE_URL, fetchImpl, attempts: 1 }), (e) => {
    assert.equal(e.code, 'protocol-mismatch');
    return true;
  });
});

// ===================================================== orchestrator (mocked) =

test('provisionRelay runs the whole flow: login path, create token never on argv, matches the bearer', async () => {
  const runner = makeFakeRunner({ loggedIn: false });   // forces the login path
  const fetchImpl = makeFakeFetch();
  const out = [];
  const prov = await deployLib.provisionRelay({
    relayDir: REPO_RELAY, workDir: path.join(tmp('prov'), 'relay'),
    name: 'demo', runner, fetchImpl, interactive: true, out: (l) => out.push(l), err: () => {},
  });

  assert.equal(prov.origin, FAKE_URL);
  assert.equal(prov.created.ws, WS_ID);
  assert.equal(prov.created.recovery_key, RECOVERY);
  assert.equal(prov.health.protocol, 1);

  // not-logged-in -> login path was taken.
  const subs = runner.calls.map((c) => c.argv.join(' '));
  assert.ok(subs.some((s) => /\blogin\b/.test(s)), 'login must have run');
  assert.ok(out.some((l) => /opening your browser/i.test(l)), 'must announce the browser login');

  // The create token: piped to `secret put` on STDIN, and used as the POST /ws
  // bearer - but NEVER an argv token anywhere.
  const token = prov.createToken;
  assert.ok(token && token.length >= 40);
  for (const c of runner.calls) {
    assert.equal(c.argv.join('\x00').includes(token), false, 'the create token must never be an argv token');
  }
  const secretCall = runner.calls.find((c) => c.argv.join(' ').includes('secret put'));
  assert.ok(secretCall, 'secret put must have been called');
  assert.equal(String(secretCall.input || '').includes(token), true, 'the token must arrive on stdin');
  assert.deepEqual(secretCall.argv.slice(-3), ['secret', 'put', 'RELAY_CREATE_TOKEN']);

  const postWs = fetchImpl.calls.find((c) => c.method === 'POST' && /\/ws$/.test(c.url));
  assert.equal(postWs.headers.Authorization, 'Bearer ' + token, 'the same token authorizes POST /ws');
  // The deploy ran IN the writable work dir (wrangler writes .wrangler there).
  const deployCall = runner.calls.find((c) => c.argv.join(' ').includes(' deploy'));
  assert.ok(deployCall.cwd && deployCall.cwd.endsWith('relay'), 'deploy runs in the work dir');
});

test('provisionRelay with no terminal fails fast with guidance, before promising a browser', async () => {
  // `handshake deploy-relay` typed inside Claude Code: no TTY on stdin, and the
  // founder is not signed in yet. The old code announced the browser and then
  // sat on wrangler's dead prompt for the full login timeout.
  const runner = makeFakeRunner({ loggedIn: false });
  const out = [];
  await assert.rejects(deployLib.provisionRelay({
    relayDir: REPO_RELAY, workDir: path.join(tmp('provtty'), 'relay'),
    name: 'demo', runner, fetchImpl: makeFakeFetch(), interactive: false,
    out: (l) => out.push(l), err: () => {},
  }), (e) => {
    assert.equal(e.code, 'login-needs-terminal');
    assert.match(e.guidance, /npx --yes wrangler@4 login/);
    return true;
  });
  assert.equal(out.some((l) => /opening your browser/i.test(l)), false, 'no browser may be promised');
  const subs = runner.calls.map((c) => c.argv.join(' '));
  assert.equal(subs.some((s) => /\blogin\b/.test(s)), false, 'the interactive login must not be spawned');
  assert.equal(subs.some((s) => /\bdeploy\b/.test(s)), false, 'and nothing is deployed half-way');
});

test('an already-signed-in founder deploys with no terminal at all: whoami gates the interactive path', async () => {
  // The counterpart of the test above, and the reason deploy-relay is still a
  // one-command flow from inside Claude Code once the login is saved.
  const runner = makeFakeRunner({ loggedIn: true });
  const prov = await deployLib.provisionRelay({
    relayDir: REPO_RELAY, workDir: path.join(tmp('provsaved'), 'relay'),
    name: 'demo', runner, fetchImpl: makeFakeFetch(), interactive: false,
    out: () => {}, err: () => {},
  });
  assert.equal(prov.origin, FAKE_URL);
  assert.equal(prov.created.ws, WS_ID);
  assert.equal(runner.calls.some((c) => /\blogin\b/.test(c.argv.join(' '))), false,
    'a saved login must never reach the interactive path');
});

test('provisionRelay with createWorkspace:false stops after setting the secret (the upgrade caller)', async () => {
  const runner = makeFakeRunner({ loggedIn: true });
  const fetchImpl = makeFakeFetch();
  const prov = await deployLib.provisionRelay({
    relayDir: REPO_RELAY, workDir: path.join(tmp('prov2'), 'relay'),
    name: 'demo', runner, fetchImpl, createWorkspace: false, out: () => {}, err: () => {},
  });
  assert.equal(prov.origin, FAKE_URL);
  assert.ok(prov.createToken);
  assert.equal(prov.created, undefined, 'upgrade mints its own workspace, not provisionRelay');
  assert.equal(fetchImpl.calls.some((c) => c.method === 'POST' && /\/ws$/.test(c.url)), false, 'no workspace was created');
});

// ============================================ full command, in-process (mock) =

function captureIo() {
  const outW = process.stdout.write.bind(process.stdout);
  const errW = process.stderr.write.bind(process.stderr);
  const out = [];
  const err = [];
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  process.stderr.write = (s) => { err.push(String(s)); return true; };
  return {
    out: () => out.join(''),
    err: () => err.join(''),
    restore() { process.stdout.write = outW; process.stderr.write = errW; },
  };
}

test('cmdDeployRelay persists the workspace, mints a round-trippable invite, shows the recovery key once', async () => {
  const mod = require('../bin/handshake');
  const data = tmp('data');
  const project = tmp('proj');
  const io = captureIo();
  const savedCwd = process.cwd();
  const savedChild = process.env.CLAUDE_CODE_CHILD_SESSION;
  const savedData = process.env.HANDSHAKE_STATE_DIR;
  const savedExit = process.exitCode;
  delete process.env.CLAUDE_CODE_CHILD_SESSION;      // this test process is itself a child; the flow refuses one
  process.env.HANDSHAKE_STATE_DIR = data;
  process.chdir(project);
  try {
    await mod.COMMANDS['deploy-relay']({
      _: [],
      flags: { yes: true, name: 'acme-relay', 'no-repo': true, 'work-dir': path.join(tmp('work'), 'relay') },
      hooks: { runner: makeFakeRunner({ loggedIn: true }), fetchImpl: makeFakeFetch() },
    });
  } finally {
    io.restore();
    process.chdir(savedCwd);
    if (savedChild === undefined) delete process.env.CLAUDE_CODE_CHILD_SESSION; else process.env.CLAUDE_CODE_CHILD_SESSION = savedChild;
    if (savedData === undefined) delete process.env.HANDSHAKE_STATE_DIR; else process.env.HANDSHAKE_STATE_DIR = savedData;
    process.exitCode = savedExit;
  }

  const stdout = io.out();

  // Persisted in the SAME config shape init writes.
  const cfg = JSON.parse(fs.readFileSync(path.join(data, WS_ID, 'state.json'), 'utf8'));
  assert.equal(cfg.transport, 'relay');
  assert.equal(cfg.endpoint, FAKE_URL);
  assert.equal(cfg.ws, WS_ID);
  assert.equal(cfg.enrollment_token, ENROLL);
  assert.equal(cfg.recovery_key, RECOVERY);
  assert.ok(cfg.secret && cfg.secret.length >= 43, 'the workspace secret is minted locally');

  // The invite blob is printed and round-trips through the real decoder.
  const blob = (stdout.match(/hsi1_[A-Za-z0-9_-]+/) || [])[0];
  assert.ok(blob, 'an hsi1_ invite must be printed');
  const fields = inviteLib.decode(blob);
  assert.equal(fields.t, 'relay');
  assert.equal(fields.e, FAKE_URL);
  assert.equal(fields.ws, WS_ID);
  assert.equal(fields.loc, 'inline');
  assert.equal(fields.s, cfg.secret);
  assert.equal(fields.tok, ENROLL);

  // The recovery key is shown ONCE (SECURITY.md §3) with the out-of-band note,
  // and the secret is never printed.
  assert.equal((stdout.match(new RegExp(RECOVERY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1, 'recovery key shown exactly once');
  assert.match(stdout, /OUT OF BAND/);
  // The raw workspace secret is never printed in the clear - it rides inside the
  // base64url invite (double-encoded), exactly as init never prints it.
  assert.equal(stdout.includes(cfg.secret), false, 'the workspace secret must never be printed in the clear');
  assert.match(stdout, /CREDENTIAL/);           // the invite is labelled a credential on stdout
  assert.match(io.err(), /password|workspace secret/);   // and warned about on stderr
});

// ================================================= real spawn via a fake npx ==
// Validates the actual lib/deploy.defaultRunner path - including the Windows
// `cmd.exe /d /s /c npx ...` indirection - against a fake `npx` FIRST on PATH.

function installShim() {
  const dir = tmp('shim');
  const shim = path.join(dir, 'npx-shim.js');
  fs.writeFileSync(shim, [
    'const fs=require("fs"),path=require("path");',
    'const args=process.argv.slice(2);const s=args.join(" ");',
    'const log=process.env.HS_SHIM_LOG,stateDir=process.env.HS_SHIM_STATE;',
    'const marker=path.join(stateDir||".","logged_in");',
    'let rec={argv:args,cwd:process.cwd()};',
    'if(/secret put/.test(s)){try{rec.stdin=fs.readFileSync(0,"utf8");}catch(e){rec.stdin="";}}',
    'if(log)fs.appendFileSync(log,JSON.stringify(rec)+"\\n");',
    'const o=t=>{process.stdout.write(t);process.exit(0)};',
    'if(s==="--version")o("10.9.0\\n");',
    'if(/--no-install .*wrangler.* --version/.test(s))o("wrangler 4.99.0\\n");',
    'if(/\\bwhoami\\b/.test(s))o(fs.existsSync(marker)?"You are logged in with an OAuth Token, associated with the email dev@example.com.\\n":"You are not authenticated. Please run `wrangler login`.\\n");',
    'if(/\\blogin\\b/.test(s)){try{fs.writeFileSync(marker,"1");}catch(e){}o("Open https://dash.cloudflare.com/oauth\\n");}',
    'if(/\\bdeploy\\b/.test(s))o("Uploaded claude-handshake-relay (1 sec)\\nDeployed claude-handshake-relay triggers (2 sec)\\n  ' + FAKE_URL + '\\nCurrent Version ID: x\\n");',
    'if(/secret put/.test(s))o("Success! Uploaded secret\\n");',
    'process.stdout.write("");process.exit(1);',
  ].join('\n'));
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, 'npx.cmd'), '@echo off\r\nnode "%~dp0npx-shim.js" %*\r\n');
  } else {
    const bin = path.join(dir, 'npx');
    fs.writeFileSync(bin, '#!/bin/sh\nexec node "$(dirname "$0")/npx-shim.js" "$@"\n');
    fs.chmodSync(bin, 0o755);
  }
  return dir;
}

test('REAL spawn: the fake npx on PATH drives availability -> login -> deploy -> secret end to end', () => {
  const shimDir = installShim();
  const logFile = path.join(tmp('shimlog'), 'calls.jsonl');
  const stateDir = tmp('shimstate');
  const savedPath = process.env.PATH;
  const savedLog = process.env.HS_SHIM_LOG;
  const savedState = process.env.HS_SHIM_STATE;
  process.env.PATH = shimDir + path.delimiter + process.env.PATH;
  process.env.HS_SHIM_LOG = logFile;
  process.env.HS_SHIM_STATE = stateDir;
  try {
    const spec = 'wrangler@4';

    // availability: npx works, wrangler resolves.
    assert.equal(deployLib.wranglerAvailable({ relayDir: REPO_RELAY }).status, 'ok');

    // not logged in yet -> login writes the marker -> whoami confirms.
    assert.equal(deployLib.whoami({ spec }).loggedIn, false);
    // interactive:true stands in for the terminal a founder actually runs this
    // in; the real spawn is still defaultRunner's cmd.exe/npx path.
    const after = deployLib.login({ spec, interactive: true });
    assert.equal(after.loggedIn, true);
    assert.equal(after.email, 'dev@example.com');

    // deploy runs in a writable work dir and its URL is extracted.
    const work = path.join(tmp('work'), 'relay');
    deployLib.prepareWorkDir(REPO_RELAY, work);
    const deployed = deployLib.deploy({ spec, workDir: work });
    assert.equal(deployed.url, FAKE_URL);

    // secret put: the value is piped over stdin and never appears on argv.
    const token = deployLib.newCreateToken();
    deployLib.putSecret({ spec, workDir: work, name: 'RELAY_CREATE_TOKEN', value: token });

    const calls = fs.readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const secretCall = calls.find((c) => c.argv.join(' ').includes('secret put'));
    assert.ok(secretCall, 'the real spawn reached the secret-put shim');
    assert.equal(secretCall.argv.includes(token), false, 'the token must never be an argv token (real spawn)');
    assert.equal(String(secretCall.stdin || '').includes(token), true, 'the token arrived over stdin (real spawn)');
    const deployCall = calls.find((c) => c.argv.join(' ').includes(' deploy'));
    assert.ok(deployCall.cwd && deployCall.cwd.endsWith('relay'), 'deploy ran in the work dir (real spawn cwd)');
  } finally {
    process.env.PATH = savedPath;
    if (savedLog === undefined) delete process.env.HS_SHIM_LOG; else process.env.HS_SHIM_LOG = savedLog;
    if (savedState === undefined) delete process.env.HS_SHIM_STATE; else process.env.HS_SHIM_STATE = savedState;
  }
});

// ============================================================ CLI subprocess ==

function runCli(args, opts) {
  const o = opts || {};
  const env = Object.assign({}, process.env, {
    HANDSHAKE_STATE_DIR: o.data || tmp('clidata'),
    HANDSHAKE_SESSION_ID: 'deploy-test',
  });
  if (o.child) env.CLAUDE_CODE_CHILD_SESSION = '1';
  else delete env.CLAUDE_CODE_CHILD_SESSION;
  const r = spawnSync(process.execPath, [CLI].concat(args), {
    cwd: o.cwd || tmp('cliproj'), input: o.stdin === undefined ? '' : o.stdin,
    encoding: 'utf8', timeout: 30000, env,
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

test('CLI: deploy-relay --print-only is a networkless dry preview that locates the bundled relay', () => {
  const r = runCli(['deploy-relay', '--print-only', '--name', 'demo']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /dry preview/);
  assert.match(r.out, /relay source:.*relay/);
  assert.match(r.out, /npx --yes wrangler@4/);
  assert.match(r.out, /workspace:\s+demo/);
  assert.match(r.out, /never argv/);
});

test('CLI: a child session refuses to deploy (7.2 rule 1)', () => {
  const r = runCli(['deploy-relay', '--print-only'], { child: true });
  assert.equal(r.code, 3);
  assert.match(r.err, /child session/);
});

test('CLI: deploy-relay is listed in help and the command table', () => {
  const r = runCli(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.out, /^\s+deploy-relay\b/m);
});

test('CLI: declining the confirm deploys nothing', () => {
  const r = runCli(['deploy-relay', '--name', 'demo'], { stdin: 'n\n' });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /not deployed/);
});
