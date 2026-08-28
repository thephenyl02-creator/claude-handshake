'use strict';
// claude-handshake: the wrapped relay deploy.
//
// ONE command (`handshake deploy-relay`) so a team founder deploys their own
// Cloudflare relay without ever typing `wrangler` directly. Everything here is
// the mechanics of driving wrangler through `npx` and turning its raw output
// and failures into one honest line of guidance - never a stack trace.
//
// Normative: PROTOCOL §9.2 (the create-token -> enrollment-token -> recovery-key
// ladder; `POST /ws` -> {ws, name, created_at, enrollment_token, recovery_key},
// the ONLY time those credentials are shown; `503 relay_not_configured` when the
// deploy secret is unset), §9.4 step 1 ("script the wrangler deploy; create the
// workspace; write the new config"). SECURITY.md §3: RELAY_CREATE_TOKEN is a
// deploy secret set via `wrangler secret put`, NEVER a `[vars]` entry, and it is
// piped over stdin here, never argv (SECURITY.md §3, the same rule the CLI keeps
// for every other credential).
//
// THREE invariants bind every path in this file:
//   1. No credential is ever an argv token. The create token goes to
//      `wrangler secret put` over stdin; the enrollment token and recovery key
//      come back over HTTPS in the Authorization-gated `POST /ws` body.
//   2. Every spawn is shell:false. On Windows `npx` is `npx.cmd`, and Node 24
//      refuses to spawn a `.cmd` with shell:false (EINVAL) - so on win32 we
//      launch `cmd.exe /d /s /c npx ...` (an .exe, no EINVAL) with a FIXED,
//      non-interpolated argv. No repo- or user-supplied string is ever a token
//      in that argv, so there is nothing for cmd.exe to mis-parse.
//   3. wrangler writes `.wrangler/` into its working directory; the installed
//      plugin cache may be read-only, so we deploy from a WRITABLE copy of the
//      relay dir, never from the bundled original.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const relay = require('./transport-relay');
const envelope = require('./envelope');
const stateLib = require('./state');

// Bounded, and generous only where a human or a cold `npx` download is in the
// loop (login opens a browser; a first deploy fetches wrangler once).
const T = {
  npxProbe: 20000,
  wranglerProbe: 45000,
  whoami: 45000,
  login: 300000,
  deploy: 300000,
  secret: 90000,
};

// --------------------------------------------------------- error surface ----

// A deploy failure the caller prints as ONE line and never as a stack. `code`
// is a stable slug; `guidance` is the user-facing sentence.
class DeployError extends Error {
  constructor(code, guidance, extra) {
    super(guidance || code);
    this.name = 'DeployError';
    this.code = code;
    this.guidance = guidance || code;
    Object.assign(this, extra || {});
  }
}

// --------------------------------------------------------------- runner ------

// The one place that shells out to npx. Windows-safe (see invariant 2), always
// shell:false, always bounded. `npxArgs` is everything AFTER `npx`
// (e.g. ['--yes','wrangler@4','deploy']); the credential value, when there is
// one, travels in `opts.input` (stdin), never here.
function defaultRunner(npxArgs, opts) {
  const o = opts || {};
  const base = {
    cwd: o.cwd,
    timeout: Number(o.timeoutMs) || T.wranglerProbe,
    windowsHide: true,
    shell: false,
    maxBuffer: 8 * 1024 * 1024,
    killSignal: 'SIGKILL',
    env: Object.assign({}, process.env, {
      // Keep wrangler non-interactive for capture; login re-enables a TTY via
      // stdio:'inherit', which overrides this for that one call.
      WRANGLER_SEND_METRICS: 'false',
      npm_config_yes: 'true',
    }, o.env || {}),
  };
  if (o.inherit) base.stdio = 'inherit';
  else {
    base.encoding = 'utf8';
    if (o.input !== undefined) base.input = o.input;
  }

  let r;
  if (process.platform === 'win32') {
    r = spawnSync('cmd.exe', ['/d', '/s', '/c', 'npx'].concat(npxArgs), base);
  } else {
    r = spawnSync('npx', npxArgs, base);
  }

  const stdout = o.inherit ? '' : (r.stdout || '');
  const stderr = o.inherit ? '' : (r.stderr || '');
  const errCode = r.error ? String(r.error.code || r.error.message) : null;
  const timedOut = Boolean(r.error && r.error.code === 'ETIMEDOUT');
  // Windows funnels "command not found" through cmd.exe as exit 9009 / a
  // "not recognized" message rather than an ENOENT on npx itself.
  const notRecognized = /is not recognized as an internal or external command|not recognized as the name of a cmdlet/i.test(stderr);
  const missing = errCode === 'ENOENT' || r.status === 9009 || (r.status !== 0 && notRecognized && !stdout);
  return {
    ok: r.error === undefined && r.status === 0,
    status: r.status === null ? null : r.status,
    stdout, stderr, error: errCode, timedOut, missing,
  };
}

// --------------------------------------------------- version / availability -

// The pinned wrangler MAJOR, read from relay/package.json so the version the
// deploy uses is the version the relay was written and tested against, and
// nothing is ever installed globally.
function wranglerSpecFrom(relayDir) {
  let major = 4;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(relayDir, 'package.json'), 'utf8'));
    const dep = (pkg.devDependencies && pkg.devDependencies.wrangler) ||
      (pkg.dependencies && pkg.dependencies.wrangler) || '';
    const m = /(\d+)/.exec(String(dep));
    if (m) major = Number(m[1]);
  } catch (_) { /* fall back to the pinned default */ }
  return { major, spec: 'wrangler@' + major };
}

// { status: 'ok' | 'needs-download' | 'npx-missing', version? }
//   - npx itself unreachable        -> npx-missing (refuse, install guidance)
//   - npx ok, wrangler not cached    -> needs-download (proceed; npx --yes fetches once)
//   - npx ok, wrangler cached/usable -> ok
// The probe never triggers the big download itself: it asks npx for its own
// version first, then asks (with --no-install) whether wrangler is already there.
function wranglerAvailable(opts) {
  const o = opts || {};
  const run = o.runner || defaultRunner;
  const spec = (o.spec || wranglerSpecFrom(o.relayDir || process.cwd())).spec ||
    (o.spec) || wranglerSpecFrom(o.relayDir || process.cwd()).spec;

  const npx = run(['--version'], { timeoutMs: o.npxTimeoutMs || T.npxProbe });
  if (npx.missing || (!npx.ok && !/[0-9]+\.[0-9]+/.test(npx.stdout))) {
    return { status: 'npx-missing' };
  }
  const probe = run(['--no-install', spec, '--version'], { timeoutMs: o.timeoutMs || T.wranglerProbe });
  const version = extractWranglerVersion(probe.stdout + '\n' + probe.stderr);
  if (probe.ok && version) return { status: 'ok', version };
  // --no-install could not resolve wrangler: it is simply not cached yet.
  return { status: 'needs-download', version: version || null };
}

function extractWranglerVersion(text) {
  const m = /wrangler[^0-9]*([0-9]+\.[0-9]+\.[0-9]+)/i.exec(String(text || '')) ||
    /^\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$/m.exec(String(text || ''));
  return m ? m[1] : null;
}

// ------------------------------------------------------------- whoami --------

// { loggedIn: bool, email: string|null }. wrangler prints a logged-in line
// ("You are logged in ... associated with the email X") or a not-authenticated
// line; older versions exit 0 in BOTH cases, so the text governs, not the code.
function whoami(opts) {
  const o = opts || {};
  const run = o.runner || defaultRunner;
  const spec = o.spec || wranglerSpecFrom(o.relayDir || process.cwd()).spec;
  const r = run(['--yes', spec, 'whoami'], { timeoutMs: o.timeoutMs || T.whoami });
  if (r.missing) throw new DeployError('npx-missing', npxMissingGuidance());
  const text = (r.stdout || '') + '\n' + (r.stderr || '');
  const emailMatch = /associated with the email\s+(\S+@\S+)/i.exec(text) ||
    /logged in.*?\b(\S+@\S+)/i.exec(text);
  const loggedIn = /you are logged in|associated with the email/i.test(text);
  const notLoggedIn = /not authenticated|not logged in|you are not/i.test(text);
  return {
    loggedIn: loggedIn && !notLoggedIn,
    email: emailMatch ? emailMatch[1].replace(/[.,;]+$/, '') : null,
    raw: text,
  };
}

// ------------------------------------------------------------- login ---------

// `wrangler login` INHERITS stdio so the browser flow and its printed URL reach
// the user directly. Success is only ever declared after a follow-up whoami
// confirms it - a zero exit from `login` alone is not proof.
function login(opts) {
  const o = opts || {};
  const run = o.runner || defaultRunner;
  const spec = o.spec || wranglerSpecFrom(o.relayDir || process.cwd()).spec;
  const r = run(['--yes', spec, 'login'], { timeoutMs: o.timeoutMs || T.login, inherit: true });
  if (r.missing) throw new DeployError('npx-missing', npxMissingGuidance());
  const after = whoami({ runner: run, spec, timeoutMs: o.whoamiTimeoutMs });
  if (!after.loggedIn) {
    throw new DeployError('not-logged-in',
      'Cloudflare login did not complete. Re-run `handshake deploy-relay`, or run `npx ' + spec + ' login` yourself and try again.');
  }
  return after;
}

// ------------------------------------------------------------- work dir ------

// wrangler writes `.wrangler/` into cwd; the plugin cache may be read-only, so
// copy the three deployable pieces (src/, wrangler.toml, package.json - NOT
// test/, NOT node_modules) into a writable dir and deploy from there.
function prepareWorkDir(relayDir, workDir) {
  if (!relayDir) throw new DeployError('relay-missing', relayMissingGuidance());
  fs.mkdirSync(workDir, { recursive: true });
  const copy = (rel) => {
    const from = path.join(relayDir, rel);
    const to = path.join(workDir, rel);
    if (!fs.existsSync(from)) return;
    fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(from, to, { recursive: true });
  };
  copy('src');
  copy('wrangler.toml');
  copy('package.json');
  if (!fs.existsSync(path.join(workDir, 'wrangler.toml'))) {
    throw new DeployError('relay-missing', relayMissingGuidance());
  }
  return workDir;
}

// ------------------------------------------------------------- deploy --------

// Runs `npx --yes wrangler@<major> deploy` in a writable work dir and extracts
// the deployed URL. Returns { url, raw }.
function deploy(opts) {
  const o = opts || {};
  const run = o.runner || defaultRunner;
  const spec = o.spec || wranglerSpecFrom(o.relayDir || o.workDir || process.cwd()).spec;
  const workDir = o.workDir;
  if (!workDir) throw new DeployError('deploy-failed', 'internal: no work dir for the deploy');
  const r = run(['--yes', spec, 'deploy'], { cwd: workDir, timeoutMs: o.timeoutMs || T.deploy });
  if (r.missing) throw new DeployError('npx-missing', npxMissingGuidance());
  const text = (r.stdout || '') + '\n' + (r.stderr || '');
  if (!r.ok) throw new DeployError('deploy-failed', deployFailureGuidance(text, r));
  const url = extractDeployedUrl(text);
  if (!url) {
    throw new DeployError('deploy-no-url',
      'wrangler deploy finished but no https://<name>.<subdomain>.workers.dev URL was found in its output. Run `npx ' + spec + ' deploy` from ' + workDir + ' to see it.');
  }
  return { url, raw: text };
}

// The deployed URL sits on its own indented line after "Deployed <name>
// triggers": `https://<name>.<subdomain>.workers.dev` (or the 2-label
// `https://<subdomain>.workers.dev`). Take the FIRST workers.dev URL.
function extractDeployedUrl(text) {
  const m = /https:\/\/[a-z0-9][a-z0-9.-]*\.workers\.dev\b/i.exec(String(text || ''));
  return m ? m[0].replace(/[).,]+$/, '') : null;
}

// ------------------------------------------------------------- putSecret -----

// Pipes the value to `wrangler secret put <name>` over STDIN, from the work dir.
// The value is NEVER an argv token (SECURITY.md §3). Returns { ok } or throws.
function putSecret(opts) {
  const o = opts || {};
  const run = o.runner || defaultRunner;
  const spec = o.spec || wranglerSpecFrom(o.relayDir || o.workDir || process.cwd()).spec;
  const name = o.name;
  const value = o.value;
  if (!name || value === undefined || value === null) {
    throw new DeployError('secret-failed', 'internal: secret name and value are required');
  }
  const r = run(['--yes', spec, 'secret', 'put', String(name)], {
    cwd: o.workDir,
    timeoutMs: o.timeoutMs || T.secret,
    input: String(value) + '\n',   // stdin, one line, trailing newline stripped by wrangler
  });
  if (r.missing) throw new DeployError('npx-missing', npxMissingGuidance());
  if (!r.ok) {
    const text = (r.stdout || '') + '\n' + (r.stderr || '');
    throw new DeployError('secret-failed',
      'Could not set the ' + name + ' deploy secret via `wrangler secret put`' +
      (/not authenticated|login/i.test(text) ? ' - the Cloudflare login may have expired.' : '.') +
      ' Nothing sensitive was printed; re-run `handshake deploy-relay`.');
  }
  return { ok: true };
}

// --------------------------------------------- create workspace (with 503) ---

// `POST /ws` with the freshly-put create token. The relay returns
// `503 relay_not_configured` until the secret has propagated to the isolate, so
// a just-deployed relay is retried a few times before it is believed. Returns
// {ws, name, created_at, enrollment_token, recovery_key}.
async function createWorkspaceWithRetry(opts) {
  const o = opts || {};
  const attempts = Number.isInteger(o.attempts) ? o.attempts : 6;
  const delayMs = Number.isInteger(o.delayMs) ? o.delayMs : 2000;
  let last = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const created = await relay.createWorkspace({
        origin: o.origin, createToken: o.createToken, name: o.name, fetchImpl: o.fetchImpl,
      });
      if (created && created.ws) return created;
      last = new DeployError('create-failed', 'The relay accepted the create call but returned no workspace id.');
    } catch (e) {
      last = e;
      const code = e && e.code;
      const propagating = code === 'relay_not_configured' || (e && e.kind === 'silent');
      if (!propagating) break;         // a real refusal (401, etc.) is not worth retrying
    }
    if (i < attempts - 1) await sleep(delayMs);
  }
  throw new DeployError('create-failed', createFailureGuidance(last, o.origin));
}

// ------------------------------------------------------- health probe --------

// Reuses the doctor health-probe (lib/transport-relay.health). Asserts
// {ok:true, protocol:1}. A just-deployed worker is retried once on a silent
// (network) miss. Returns the parsed health body.
async function probeHealth(opts) {
  const o = opts || {};
  const attempts = Number.isInteger(o.attempts) ? o.attempts : 3;
  const delayMs = Number.isInteger(o.delayMs) ? o.delayMs : 1500;
  let last = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const h = await relay.health({ origin: o.origin, fetchImpl: o.fetchImpl, timeoutMs: o.timeoutMs });
      if (h && h.ok === true && h.protocol === envelope.PROTOCOL_VERSION) return h;
      if (h && Number.isInteger(h.protocol) && h.protocol !== envelope.PROTOCOL_VERSION) {
        throw new DeployError('protocol-mismatch',
          'The deployed relay speaks protocol ' + h.protocol + ', but this client speaks ' + envelope.PROTOCOL_VERSION + '. Update the plugin (or the relay/ source) so the two match.');
      }
      last = new DeployError('health-bad', 'The relay /health check did not return {ok:true, protocol:' + envelope.PROTOCOL_VERSION + '}.');
    } catch (e) {
      if (e instanceof DeployError && e.code === 'protocol-mismatch') throw e;
      last = e;
    }
    if (i < attempts - 1) await sleep(delayMs);
  }
  throw new DeployError('health-unreachable',
    'Deployed, but GET ' + o.origin + '/health did not answer with {ok:true, protocol:' + envelope.PROTOCOL_VERSION + '}. Give it a few seconds and re-run, or check the Worker in your Cloudflare dashboard.' +
    (last && last.guidance ? ' (' + last.guidance + ')' : ''));
}

// ============================================================ orchestrator ===

// Steps c-g of the deploy-relay flow, as reusable mechanics. Prints a short
// honest progress line per step through the injected `out`. Returns
//   { origin, createToken, health, created? }
// `createWorkspace:false` stops after the create token is set (the `upgrade`
// caller mints its OWN workspace carrying the migrated secret).
async function provisionRelay(opts) {
  const o = opts || {};
  const out = o.out || (() => {});
  const err = o.err || (() => {});
  const run = o.runner || defaultRunner;
  const fetchImpl = o.fetchImpl;
  const relayDir = o.relayDir;
  const spec = wranglerSpecFrom(relayDir).spec;

  // c. wrangler availability.
  const avail = wranglerAvailable({ runner: run, relayDir });
  if (avail.status === 'npx-missing') throw new DeployError('npx-missing', npxMissingGuidance());
  if (avail.status === 'needs-download') {
    out('  fetching wrangler ' + spec + ' once via npx (this is a one-time download)...');
  } else {
    out('  wrangler ' + (avail.version ? spec + ' (' + avail.version + ')' : spec) + ' is available');
  }

  // d. whoami -> login if needed.
  let who = whoami({ runner: run, spec });
  if (!who.loggedIn) {
    out('  opening your browser to authorize Cloudflare (one time)...');
    who = login({ runner: run, spec });
  }
  out('  signed in to Cloudflare' + (who.email ? ' as ' + who.email : ''));

  // prepare the writable work dir, then deploy.
  const workDir = prepareWorkDir(relayDir, o.workDir);
  out('  deploying the Worker (from ' + workDir + ')...');
  const deployed = deploy({ runner: run, spec, workDir });
  out('  deployed: ' + deployed.url);

  const origin = deployed.url.replace(/\/+$/, '');

  // e. health probe.
  const health = await probeHealth({ origin, fetchImpl });
  out('  /health ok - ' + (health.service || 'relay') + ' ' + (health.version || '') + ', protocol ' + health.protocol);

  // f. generate a strong create token, set it as a deploy secret (stdin).
  const createToken = o.createToken || newCreateToken();
  out('  setting the RELAY_CREATE_TOKEN deploy secret (piped over stdin, never argv)...');
  putSecret({ runner: run, spec, workDir, name: 'RELAY_CREATE_TOKEN', value: createToken });

  const result = { origin, createToken, health, workDir };
  if (o.createWorkspace === false) return result;

  // g. POST /ws with the create token (503-retry while the secret propagates).
  out('  creating the workspace on the relay...');
  result.created = await createWorkspaceWithRetry({ origin, createToken, name: o.name, fetchImpl });
  return result;
}

// --------------------------------------------------------- locate relay ------

// The bundled relay dir in the installed plugin. bin/ is a sibling of relay/,
// so from bin/handshake.js's __dirname the relay is ../relay. CLAUDE_PLUGIN_ROOT
// is honored when the host sets it. Returns an absolute path or null.
function locateRelayDir(fromDir, env) {
  const e = env || process.env;
  const candidates = [];
  if (fromDir) candidates.push(path.resolve(fromDir, '..', 'relay'));
  if (e.CLAUDE_PLUGIN_ROOT) candidates.push(path.join(String(e.CLAUDE_PLUGIN_ROOT), 'relay'));
  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, 'wrangler.toml')) && fs.existsSync(path.join(c, 'src', 'worker.js'))) {
        return path.resolve(c);
      }
    } catch (_) { /* keep looking */ }
  }
  return null;
}

// Default writable work dir, under CLAUDE_PLUGIN_DATA when set (else
// ~/.claude/handshake) so it sits beside the rest of local state.
function defaultWorkDir(env) {
  return path.join(stateLib.stateRoot(env), 'deploy-relay', 'work');
}

// --------------------------------------------------------------- helpers -----

function newCreateToken() {
  // Strong, opaque, and not credential-shaped in a way the outbound filter would
  // trip on: 32 bytes of CSPRNG, base64url. It never leaves this machine except
  // as a `wrangler secret put` stdin value and an Authorization bearer.
  return crypto.randomBytes(32).toString('base64url');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function npxMissingGuidance() {
  return 'npx was not found. Install Node.js 18+ (which ships npx) from https://nodejs.org, reopen your terminal, and re-run `handshake deploy-relay`. Node also powers this CLI, so it is required either way.';
}

function relayMissingGuidance() {
  return 'The bundled relay source was not found in this install. Deploy it by hand from the relay/ directory of the claude-handshake repo (`npx wrangler deploy`), set RELAY_CREATE_TOKEN with `wrangler secret put`, then run `handshake upgrade --relay https://<your-worker>`.';
}

function deployFailureGuidance(text, r) {
  const t = String(text || '');
  if (r && r.timedOut) return 'wrangler deploy timed out. Check your network and re-run `handshake deploy-relay`.';
  if (/not authenticated|please run .*login|10000|credentials/i.test(t)) {
    return 'wrangler deploy was refused for authentication. Run `handshake deploy-relay` again to re-authorize Cloudflare.';
  }
  if (/workers\.dev.*not|register.*subdomain|subdomain/i.test(t) && /register|enable|not/i.test(t)) {
    return 'Cloudflare needs a one-time workers.dev subdomain enabled on your account. Open the Cloudflare dashboard, enable Workers, then re-run `handshake deploy-relay`.';
  }
  if (/free plan|exceeded|quota|limit/i.test(t)) {
    return 'Cloudflare refused the deploy against your plan limits. Check your account\'s Workers usage, then re-run `handshake deploy-relay`.';
  }
  const line = firstMeaningfulLine(t);
  return 'wrangler deploy failed' + (line ? ' (' + line + ')' : '') + '. Re-run `handshake deploy-relay`, or run `npx wrangler deploy` from the relay work dir to see the full output.';
}

function createFailureGuidance(last, origin) {
  const code = last && last.code;
  if (code === 'invalid_token') {
    return 'The relay rejected the create token it was just given. This is unusual right after a deploy; re-run `handshake deploy-relay`.';
  }
  if (code === 'relay_not_configured') {
    return 'The relay at ' + origin + ' still reports its create secret as unset after several tries. Wait a moment and re-run `handshake deploy-relay`; the deploy itself succeeded.';
  }
  if (last && last.guidance) return last.guidance;
  return 'Deployed and reachable, but creating the workspace on ' + origin + ' did not succeed (' + (code || 'unknown') + '). Re-run `handshake deploy-relay`.';
}

function firstMeaningfulLine(text) {
  const lines = String(text || '').split(/\r?\n/).map((s) => s.trim())
    .filter((s) => s && !/^\s*$/.test(s) && !/^[✔✘⛅️─]+/.test(s));
  const errLine = lines.find((s) => /error|✘|refused|failed/i.test(s));
  return (errLine || lines[0] || '').slice(0, 160);
}

module.exports = {
  DeployError,
  defaultRunner,
  wranglerSpecFrom,
  wranglerAvailable,
  extractWranglerVersion,
  whoami,
  login,
  prepareWorkDir,
  deploy,
  extractDeployedUrl,
  putSecret,
  createWorkspaceWithRetry,
  probeHealth,
  provisionRelay,
  locateRelayDir,
  defaultWorkDir,
  newCreateToken,
  TIMEOUTS: T,
};
