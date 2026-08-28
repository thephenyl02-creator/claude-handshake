'use strict';
// Why this file exists: the plugin-load verdict is branch-tested in isolation
// [C test/doctor-classifier.test.js] but its INTEGRATION POINT was never
// executed. classifyPluginList() is a pure function; the thing that makes it a
// doctor check is one call site - `add('plugin loaded', verdict.level,
// verdict.message)` [C bin/handshake.js:1375] - and no test reached it. Every
// CLI test runs with HANDSHAKE_SKIP_HOST_CHECKS=1 [C test/cli.test.js:41],
// which throws before the spawn [C bin/handshake.js:1365] and lands in the
// outer catch, so the check they observe is always the 'skipped' one. The
// classifier could have been deleted, or wired to the wrong level, and the
// whole suite would have stayed green.
//
// So this file runs the real `doctor --json` with the skip flag UNSET and a
// fake `claude` first on PATH. That exercises the production spawn shape as
// written - `cmd.exe /d /s /c claude plugin list` on win32, bare `claude` with
// shell:false elsewhere [C bin/handshake.js:1366-1369] - which is why the shim
// is a .cmd on Windows and an executable /bin/sh script on Linux and macOS
// (this repo is developed on Windows and CI also runs ubuntu-latest).
//
// Two listings, not one: a healthy listing alone would still pass if the call
// site hardcoded 'pass', so a failed-to-load listing is run too. Together they
// pin that the CLASSIFIER'S level and message are what reach the report.
//
// The doctor runs from a temp cwd, so it is outside any workspace and any git
// working tree - no transport, no relay, no network. It spawns git and the
// shim; nothing else.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'handshake.js');
const WIN = process.platform === 'win32';

const temps = [];
after(() => {
  for (const d of temps) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
});

// A `claude` that prints `lines` and exits 0. Returned as the directory to put
// FIRST on PATH, so a real host CLI on this machine cannot decide the result.
function fakeClaude(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-doctor-'));
  temps.push(dir);
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  if (WIN) {
    // cmd.exe resolves the bare word `claude` through PATHEXT, so the shim has
    // to carry one of those extensions. `@echo off` first: the shipped code
    // reads stdout, and cmd would otherwise echo the script's own lines into it.
    fs.writeFileSync(path.join(bin, 'claude.cmd'),
      ['@echo off'].concat(lines.map((l) => 'echo ' + l)).join('\r\n') + '\r\n');
  } else {
    // A quoted heredoc so nothing in the listing is expanded by the shell.
    const p = path.join(bin, 'claude');
    fs.writeFileSync(p, '#!/bin/sh\ncat <<\'HSEOF\'\n' + lines.join('\n') + '\nHSEOF\n');
    fs.chmodSync(p, 0o755);
  }
  return bin;
}

function doctorEnv(bin) {
  const env = Object.assign({}, process.env, {
    PATH: bin + path.delimiter + process.env.PATH,
    HANDSHAKE_STATE_DIR: path.join(path.dirname(bin), 'data'),
  });
  // The whole point of this file: the check must actually RUN, so the flag the
  // rest of the suite sets must not be inherited from the parent environment.
  delete env.HANDSHAKE_SKIP_HOST_CHECKS;
  if (WIN) env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
  return env;
}

// The shim has to be spawnable before its absence means anything. A noexec
// TMPDIR (some hardened CI images) would make `claude` unrunnable and doctor
// would then warn perfectly correctly - an environment limitation, not a
// regression. Detect that here so the test can skip with a reason instead of
// failing, or worse, flaking.
function shimSpawns(bin) {
  const env = doctorEnv(bin);
  const r = WIN
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'claude', 'plugin', 'list'], { encoding: 'utf8', env, timeout: 30000 })
    : spawnSync('claude', ['plugin', 'list'], { encoding: 'utf8', env, timeout: 30000, shell: false });
  return !r.error && String(r.stdout || '').includes('claude-handshake');
}

function runDoctor(bin) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-doctor-cwd-'));
  temps.push(cwd);
  const r = spawnSync(process.execPath, [CLI, 'doctor', '--json'], {
    cwd, input: '', encoding: 'utf8', timeout: 120000, env: doctorEnv(bin),
  });
  assert.equal(r.signal, null, 'doctor was killed, stderr: ' + (r.stderr || ''));
  let report;
  try { report = JSON.parse(r.stdout); } catch (e) {
    assert.fail('doctor --json did not print JSON: ' + (r.stdout || '') + (r.stderr || ''));
  }
  const check = report.checks.find((c) => c.check === 'plugin loaded');
  assert.ok(check, 'doctor must carry a `plugin loaded` check; got ' +
    report.checks.map((c) => c.check).join(', '));
  return check;
}

// The three-valued vocabulary doctor knows how to print [C bin/handshake.js,
// the --json branch of cmdDoctor and worst()].
const LEVELS = ['pass', 'warn', 'fail'];

test('doctor turns a real `claude plugin list` run into the `plugin loaded` check', (t) => {
  const bin = fakeClaude(['Plugins:', '  claude-handshake@0.1.4 (marketplace)  Status: enabled']);
  if (!shimSpawns(bin)) {
    t.skip('cannot execute a shim from ' + os.tmpdir() + ' (noexec temp dir?), ' +
      'so `claude` cannot be faked on PATH here');
    return;
  }

  const check = runDoctor(bin);
  assert.ok(LEVELS.includes(check.verdict), 'unknown level ' + check.verdict);
  assert.ok(check.detail && check.detail.length > 0, 'the check carries a message');
  // The negative half matters as much as the positive one: this is the state
  // every other test in the repo observes, and observing it here would mean
  // the spawn never happened and nothing was integration-tested.
  assert.ok(!/plugin-load check skipped/.test(check.detail),
    'the check must have RUN, not been skipped: ' + check.detail);
  // classifyPluginList's own pass wording [C bin/handshake.js:1343], so the
  // assertion fails if the call site stops using the classifier's result.
  assert.equal(check.verdict, 'pass');
  assert.equal(check.detail, 'claude plugin list reports it enabled');
});

test('a failed-to-load listing reaches the report as fail, cause and all', (t) => {
  const bin = fakeClaude([
    'Plugins:',
    '  claude-handshake@0.1.4  Status: x',
    '    Error: duplicate hooks key in plugin.json',
  ]);
  if (!shimSpawns(bin)) {
    t.skip('cannot execute a shim from ' + os.tmpdir() + ' (noexec temp dir?), ' +
      'so `claude` cannot be faked on PATH here');
    return;
  }

  const check = runDoctor(bin);
  assert.ok(LEVELS.includes(check.verdict), 'unknown level ' + check.verdict);
  // Not just "some level": the LEVEL travels, so a hardcoded verdict at the
  // call site is caught, and the cause travels with it so the operator has a
  // lead rather than a bare verdict.
  assert.equal(check.verdict, 'fail');
  assert.match(check.detail, /FAILED TO LOAD - no hook fires/);
  assert.match(check.detail, /duplicate hooks key in plugin\.json/);
});
