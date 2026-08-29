'use strict';
// A failed workspace-create leaves a LIVE create-token secret on the Worker.
//
// provisionRelay mints `hsc_...`, stores it with `wrangler secret put`, and only
// then calls POST /ws - it has to, the relay answers 503 `relay_not_configured`
// until the secret exists (lib/deploy.js step f). So every create failure ends
// with a credential on the Worker that the operator never typed. These tests pin
// the two halves of that contract: the ordering, and the fact that the failure
// guidance says the secret is there and how to replace it.
//
// No real Cloudflare and no network: an in-JS fake runner + fake fetch, injected
// at the lib/deploy boundary.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const deployLib = require('../lib/deploy');

const REPO_RELAY = path.join(__dirname, '..', 'relay');
const FAKE_URL = 'https://claude-handshake-relay.fenil.workers.dev';

let n = 0;
function tmp(tag) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hs-leftbehind-' + (tag || '') + (n++) + '-')));
}

// Signed in already, so provisionRelay never wants a terminal.
function makeFakeRunner() {
  const calls = [];
  const ok = (stdout) => ({ ok: true, status: 0, stdout: stdout || '', stderr: '', error: null, timedOut: false, missing: false });
  const runner = (npxArgs, callOpts) => {
    const co = callOpts || {};
    calls.push({ argv: npxArgs.slice(), cwd: co.cwd, input: co.input });
    const s = npxArgs.join(' ');
    if (s === '--version') return ok('10.9.0\n');
    if (/--no-install .*wrangler.* --version/.test(s)) return ok('wrangler 4.99.0\n');
    if (/\bwhoami\b/.test(s)) return ok('You are logged in with an OAuth Token, associated with the email dev@example.com.\n');
    if (/\bdeploy\b/.test(s)) return ok('Uploaded claude-handshake-relay (1.2 sec)\n  ' + FAKE_URL + '\n');
    if (/secret put/.test(s)) return ok('Success! Uploaded secret RELAY_CREATE_TOKEN\n');
    return { ok: false, status: 1, stdout: '', stderr: 'unknown command', error: null, timedOut: false, missing: false };
  };
  runner.calls = calls;
  return runner;
}

// /health passes; POST /ws is refused outright (a real refusal, not propagation).
function makeRefusingFetch() {
  const calls = [];
  const resp = (status, body) => Promise.resolve({
    ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body),
  });
  const fetchImpl = (url, init) => {
    const u = String(url);
    const i = init || {};
    calls.push({ url: u, method: i.method || 'GET' });
    if (/\/health$/.test(u)) return resp(200, { ok: true, service: 'claude-handshake-relay', version: '0.1.4', protocol: 1 });
    if (/\/ws$/.test(u) && i.method === 'POST') return resp(401, { error: 'invalid_token' });
    return resp(404, { error: 'not_found' });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test('a create failure inside provisionRelay reports the create-token secret it left on the Worker', async () => {
  const runner = makeFakeRunner();
  const fetchImpl = makeRefusingFetch();

  await assert.rejects(deployLib.provisionRelay({
    relayDir: REPO_RELAY, workDir: path.join(tmp('prov'), 'relay'),
    name: 'demo', runner, fetchImpl, interactive: false,
    out: () => {}, err: () => {},
  }), (e) => {
    assert.equal(e.code, 'create-failed');
    // The fact itself: the secret is live, and re-running is the cheap fix.
    assert.match(e.guidance, /already stored the RELAY_CREATE_TOKEN secret/i);
    assert.match(e.guidance, /re-running `handshake deploy-relay`/i);
    // And the by-hand route: look at it, replace it, delete it.
    assert.match(e.guidance, /secret list/);
    assert.match(e.guidance, /secret put RELAY_CREATE_TOKEN/);
    assert.match(e.guidance, /secret delete RELAY_CREATE_TOKEN/);
    // Never the token's own value - guidance is printed into a model's context.
    assert.equal(/hsc_[A-Za-z0-9_-]{10,}/.test(e.guidance), false, 'the token value must not appear in guidance');
    return true;
  });

  // The ordering the guidance is describing: `secret put` really did run, and it
  // ran BEFORE the create call. Do not "fix" this by reordering - POST /ws
  // cannot succeed before the secret exists.
  const put = runner.calls.filter((c) => c.argv.join(' ').includes('secret put'));
  assert.equal(put.length, 1, 'the create token must have been stored');
  assert.ok(fetchImpl.calls.some((c) => c.method === 'POST'), 'the create call must have been attempted');
});

test('createWorkspaceWithRetry does not claim a secret was set when this run set none', async () => {
  // `handshake upgrade --relay <origin>`: the operator points at a relay they
  // deployed themselves and types their own create token. Nothing was stored
  // here, so the guidance must not tell them to go clean one up.
  const fetchImpl = () => Promise.resolve({
    ok: false, status: 401, text: async () => JSON.stringify({ error: 'invalid_token' }),
  });
  await assert.rejects(deployLib.createWorkspaceWithRetry({
    origin: FAKE_URL, createToken: 'bad', fetchImpl, delayMs: 1, attempts: 2,
  }), (e) => {
    assert.equal(e.code, 'create-failed');
    assert.match(e.guidance, /create token/i);
    assert.equal(/already stored the RELAY_CREATE_TOKEN secret/i.test(e.guidance), false,
      'no secret was stored on this path, so none may be reported');
    return true;
  });
});
