'use strict';
// claude-handshake M12(a): assertion + process plumbing for the acceptance
// harness.
//
// Rules this file exists to enforce:
//   - every assertion failure prints the failing step, what was expected and
//     what was actually seen;
//   - nothing is spawned through a shell (Windows-safe: node script paths,
//     never shell:true, never a .cmd);
//   - every child process is killed by TREE, because `wrangler dev` forks
//     workerd and killing the node parent leaves workerd running.
//
// Node stdlib only, matching the product's own no-dependencies rule.

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'bin', 'handshake.js');
const HOOKS = path.join(REPO_ROOT, 'hooks');

// ----------------------------------------------------------------- output ---

const C = process.env.NO_COLOR
  ? { pass: '', fail: '', dim: '', head: '', warn: '', off: '' }
  : { pass: '\x1b[32m', fail: '\x1b[31m', dim: '\x1b[90m', head: '\x1b[1m', warn: '\x1b[33m', off: '\x1b[0m' };

function line(s) { process.stdout.write(String(s) + '\n'); }

function show(v, cap) {
  const n = cap || 300;
  let s;
  if (typeof v === 'string') s = v;
  else { try { s = JSON.stringify(v); } catch (_) { s = String(v); } }
  s = String(s).replace(/\r/g, '').replace(/\n/g, '\\n');
  return s.length > n ? s.slice(0, n) + ' …(' + s.length + ' chars)' : s;
}

// ------------------------------------------------------------------ steps ---

class Step {
  constructor(id, title) {
    this.id = id;
    this.title = title;
    this.checks = [];
    this.notes = [];
    this.t0 = Date.now();
  }

  _record(ok, what, detail) {
    this.checks.push({ ok, what, detail: detail || null });
    return ok;
  }

  note(text) { this.notes.push(String(text)); return this; }

  assert(cond, what, detail) {
    return this._record(Boolean(cond), what, cond ? null : detail);
  }

  eq(actual, expected, what) {
    const ok = actual === expected;
    return this._record(ok, what, ok ? null : { expected: show(expected), actual: show(actual) });
  }

  deepEq(actual, expected, what) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    return this._record(a === b, what, a === b ? null : { expected: show(b), actual: show(a) });
  }

  has(haystack, needle, what) {
    const h = String(haystack === undefined || haystack === null ? '' : haystack);
    const ok = h.includes(needle);
    return this._record(ok, what, ok ? null : { expected: 'contains ' + show(needle, 120), actual: show(h, 400) });
  }

  hasnt(haystack, needle, what) {
    const h = String(haystack === undefined || haystack === null ? '' : haystack);
    const ok = !h.includes(needle);
    return this._record(ok, what, ok ? null : { expected: 'must NOT contain ' + show(needle, 120), actual: show(h, 400) });
  }

  match(value, re, what) {
    const s = String(value === undefined || value === null ? '' : value);
    const ok = re.test(s);
    return this._record(ok, what, ok ? null : { expected: 'matches ' + String(re), actual: show(s, 400) });
  }

  get failed() { return this.checks.some((c) => !c.ok); }
  get passed() { return this.checks.length > 0 && !this.failed; }
}

class Harness {
  constructor() {
    this.steps = [];
    this.t0 = Date.now();
    this.tempDirs = [];
    this.children = [];
    this.findings = [];
    this.deviations = [];
  }

  // Deduped: a note that applies to both legs is recorded by both, and should
  // still be reported once.
  finding(text) { const t = String(text); if (!this.findings.includes(t)) this.findings.push(t); }
  deviation(text) { const t = String(text); if (!this.deviations.includes(t)) this.deviations.push(t); }

  section(title) {
    line('');
    line(C.head + '== ' + title + ' ' + '='.repeat(Math.max(0, 66 - title.length)) + C.off);
  }

  async step(id, title, fn) {
    const s = new Step(id, title);
    this.steps.push(s);
    try {
      await fn(s);
      if (!s.checks.length) s.assert(false, 'step made no assertions');
    } catch (e) {
      s.assert(false, 'step threw', { expected: 'no exception', actual: show(String((e && e.stack) || e), 800) });
    }
    const ms = Date.now() - s.t0;
    const tag = s.failed ? C.fail + 'FAIL' + C.off : C.pass + 'PASS' + C.off;
    line(tag + '  [' + id + '] ' + title + C.dim + '  (' + ms + 'ms, ' + s.checks.length + ' checks)' + C.off);
    for (const n of s.notes) line('        ' + C.dim + '· ' + n + C.off);
    for (const c of s.checks) {
      if (c.ok) { line('        ' + C.dim + '✓ ' + c.what + C.off); continue; }
      line('        ' + C.fail + '✗ ' + c.what + C.off);
      if (c.detail && typeof c.detail === 'object') {
        line('            expected: ' + c.detail.expected);
        line('            actual:   ' + c.detail.actual);
      } else if (c.detail) {
        line('            ' + show(c.detail, 800));
      }
    }
    return s;
  }

  summary() {
    const failed = this.steps.filter((s) => s.failed);
    const checks = this.steps.reduce((n, s) => n + s.checks.length, 0);
    const badChecks = this.steps.reduce((n, s) => n + s.checks.filter((c) => !c.ok).length, 0);
    line('');
    line(C.head + '== summary ' + '='.repeat(58) + C.off);
    line('  steps:   ' + this.steps.length + '  (' + (this.steps.length - failed.length) + ' pass, ' + failed.length + ' fail)');
    line('  checks:  ' + checks + '  (' + (checks - badChecks) + ' pass, ' + badChecks + ' fail)');
    line('  runtime: ' + ((Date.now() - this.t0) / 1000).toFixed(1) + 's');
    if (failed.length) {
      line('');
      line(C.fail + '  failing steps:' + C.off);
      for (const s of failed) line('    [' + s.id + '] ' + s.title);
    }
    if (this.findings.length) {
      line('');
      line(C.warn + '  product findings:' + C.off);
      for (const f of this.findings) line('    - ' + f);
    }
    if (this.deviations.length) {
      line('');
      line(C.dim + '  harness deviations from PLAN §6 wording:' + C.off);
      for (const d of this.deviations) line('    - ' + d);
    }
    return failed.length === 0;
  }

  // ------------------------------------------------------------ processes --

  track(child) { this.children.push(child); return child; }

  async killAll() {
    for (const ch of this.children.splice(0)) {
      try { killTree(ch.pid); } catch (_) { /* already gone */ }
    }
  }

  tempDir(prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    this.tempDirs.push(dir);
    return dir;
  }

  async cleanup() {
    await this.killAll();
    for (const dir of this.tempDirs.splice(0)) rmrf(dir);
  }
}

// ------------------------------------------------------------ process util --

// Kill the whole tree. `wrangler dev` spawns workerd as a grandchild and a
// plain child.kill() on Windows leaves it running and holding the port.
function killTree(pid) {
  if (!pid) return false;
  if (process.platform === 'win32') {
    const r = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true, stdio: 'ignore', timeout: 15000,
    });
    return r.status === 0;
  }
  try { process.kill(-pid, 'SIGKILL'); return true; } catch (_) { /* fall through */ }
  try { process.kill(pid, 'SIGKILL'); return true; } catch (_) { return false; }
}

function rmrf(dir) {
  for (let i = 0; i < 5; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 }); return true; }
    catch (_) { sleepBlocking(200); }
  }
  return false;
}

function sleepBlocking(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_) { /* ignore */ }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Never shell:true, never a .cmd shim: `node <script.js> ...` only.
function runNode(script, args, opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script].concat(args || []), {
      cwd: o.cwd || process.cwd(),
      env: o.env || process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, o.timeoutMs || 30000);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + String(e && e.message), timedOut, error: String(e && e.message) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    if (o.stdin !== undefined && o.stdin !== null) child.stdin.end(String(o.stdin));
    else child.stdin.end();
  });
}

// git, for the temp working copies. spawnSync is fine: these are fixture setup.
function git(cwd, args, opts) {
  const r = spawnSync('git', args, {
    cwd, encoding: 'utf8', windowsHide: true, timeout: (opts && opts.timeout) || 20000,
    env: Object.assign({}, process.env, {
      GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo',
      GIT_AUTHOR_NAME: 'e2e', GIT_COMMITTER_NAME: 'e2e',
    }),
  });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: String(r.stdout || ''),
    stderr: String(r.stderr || ''),
  };
}

// ------------------------------------------------------------------ ports ---

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, opts) {
  const o = opts || {};
  const deadline = Date.now() + (o.timeoutMs || 90000);
  let last = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'GET' });
      const text = await res.text();
      if (res.ok) { try { return { ok: true, json: JSON.parse(text), text }; } catch (_) { return { ok: true, json: null, text }; } }
      last = 'http ' + res.status;
    } catch (e) { last = String(e && e.message); }
    await sleep(300);
  }
  return { ok: false, error: last };
}

// ------------------------------------------------------------------- json ---

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

module.exports = {
  Harness, Step,
  REPO_ROOT, CLI, HOOKS,
  runNode, git, killTree, rmrf, sleep, freePort, waitForHttp, readJson, show, line, C,
};
