'use strict';
// Child-mode detection (PROTOCOL 7.1) and workspace resolution (PROTOCOL 8).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const S = require('../lib/session');

let n = 0;
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'hs-sess-' + (n++) + '-')); }

// ------------------------------------------------ the child-mode matrix ----

// Every combination of the three inputs section 7.1 names. The safe fallback
// is the load-bearing row set: absent variable + no interactive marker MUST
// come out as a child, because a session that cannot prove it is a parent
// behaves as a child.
const MATRIX = [
  // [CLAUDE_CODE_CHILD_SESSION, monitorRunning, source, interactiveHost, expectedChild, reason]
  ['1', false, null, true, true, 'child_env_var'],
  ['1', true, 'startup', true, true, 'child_env_var'],          // the variable wins outright
  [undefined, false, null, true, true, 'safe_fallback_no_interactive_marker'],
  [undefined, false, 'compact', true, true, 'safe_fallback_no_interactive_marker'],
  [undefined, false, 'startup', true, false, 'interactive_marker_source'],
  [undefined, false, 'resume', true, false, 'interactive_marker_source'],
  [undefined, false, 'clear', true, false, 'interactive_marker_source'],
  [undefined, false, 'startup', false, true, 'safe_fallback_no_interactive_marker'],   // headless host
  [undefined, true, null, true, false, 'interactive_marker_monitor'],
  [undefined, true, 'compact', true, false, 'interactive_marker_monitor'],
  ['0', false, null, true, true, 'safe_fallback_no_interactive_marker'],
  ['true', false, null, true, true, 'safe_fallback_no_interactive_marker'],            // only "1" counts
  ['', false, 'startup', true, false, 'interactive_marker_source'],
];

test('7.1: the child-mode matrix', () => {
  for (const [childEnv, monitorRunning, source, interactiveHost, expectedChild, reason] of MATRIX) {
    const env = {};
    if (childEnv !== undefined) env[S.CHILD_ENV_VAR] = childEnv;
    const r = S.detectChildMode({ env, monitorRunning, source, interactiveHost });
    const label = JSON.stringify({ childEnv, monitorRunning, source, interactiveHost });
    assert.equal(r.child, expectedChild, label);
    assert.equal(r.reason, reason, label);
  }
});

test('7.1: the parent session id is carried when this is a child', () => {
  const env = { [S.CHILD_ENV_VAR]: '1', [S.PARENT_ID_ENV_VAR]: 'parent-abc' };
  const r = S.detectChildMode({ env });
  assert.equal(r.child, true);
  assert.equal(r.parent_session, 'parent-abc');
});

test('7.1: the fallback fails toward silence - unknown inputs never yield a parent', () => {
  for (const source of [null, undefined, 'compact', 'subagent', 'weird']) {
    assert.equal(S.detectChildMode({ env: {}, monitorRunning: false, source }).child, true);
  }
});

test('7.1: a monitor sentinel counts only while it is fresh', () => {
  const dir = tmpDir();
  const sentinel = path.join(dir, 'monitor.alive');
  assert.equal(S.monitorAlive(sentinel), false, 'a missing sentinel is not a monitor');
  fs.writeFileSync(sentinel, 'x');
  assert.equal(S.monitorAlive(sentinel), true);
  const stale = Date.now() - (S.MONITOR_SENTINEL_MAX_AGE_MS + 60_000);
  fs.utimesSync(sentinel, new Date(stale), new Date(stale));
  assert.equal(S.monitorAlive(sentinel), false, 'a stale sentinel must not read as a live monitor');
  assert.equal(S.detectChildMode({ env: {}, monitorSentinel: sentinel }).child, true);
});

test('7.2: the four child rules are stated where callers can read them', () => {
  assert.deepEqual(S.CHILD_RULES, {
    may_join: false, may_hold_presence: false, may_claim: false, may_post: false,
    must_run_pretooluse_gate: true, gate_source: 'parent_local_cache',
    may_do_network_io: false, appends_files_to_parent: true,
    aggregates_into: 'presence.update.agents',
  });
});

// -------------------------------------------- workspace resolution (8) -----

function makeWorkspace(contents) {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, '.handshake'), { recursive: true });
  fs.writeFileSync(path.join(root, '.handshake', 'workspace.json'), JSON.stringify(contents, null, 2));
  return root;
}

test('8: resolution walks up from cwd and stops at the filesystem root', () => {
  S.clearCache();
  const root = makeWorkspace({ ws: 'a'.repeat(32), name: 'demo', transport: 'ntfy', endpoint: 'https://ntfy.sh' });
  const deep = path.join(root, 'src', 'a', 'b', 'c');
  fs.mkdirSync(deep, { recursive: true });

  const found = S.resolveWorkspace(deep, { noCache: true });
  assert.equal(found.root, root);
  assert.equal(found.public.ws, 'a'.repeat(32));
  assert.equal(found.public.name, 'demo');
  assert.equal(S.inWorkspace(deep, { noCache: true }), true);

  const outside = tmpDir();
  assert.equal(S.resolveWorkspace(outside, { noCache: true }), null);
  assert.equal(S.inWorkspace(outside, { noCache: true }), false);
});

test('8: only the PUBLIC allowlist comes back - no credential ever leaves this module', () => {
  S.clearCache();
  const root = makeWorkspace({
    ws: 'b'.repeat(32), name: 'demo', transport: 'relay', endpoint: 'https://r.example',
    secret: 'SUPER-SECRET-VALUE', topic: 'c'.repeat(32),
    enrollment_token: 'hsk_' + 'a'.repeat(64) + '_deadbeef',
    recovery_key: 'hsr_' + 'b'.repeat(64) + '_cafebabe',
    member_token: 'hsm_1_2', guarded: { secret: 'also secret' },
  });
  const found = S.resolveWorkspace(root, { noCache: true });
  assert.equal(found.has_guarded, true);
  const serialized = JSON.stringify(found.public);
  for (const leak of ['SUPER-SECRET-VALUE', 'hsk_', 'hsr_', 'hsm_', 'also secret', 'c'.repeat(32)]) {
    assert.equal(serialized.includes(leak), false, 'public part must not carry ' + leak);
  }
  assert.deepEqual(Object.keys(found.public).sort(), ['endpoint', 'name', 'transport', 'ws']);
});

test('8: the split file format with a nested `public` block is understood', () => {
  S.clearCache();
  const root = makeWorkspace({
    public: { ws: 'd'.repeat(32), name: 'split', transport: 'ntfy', endpoint: 'https://ntfy.sh', inject: 'on' },
    guarded: { secret: 'nope' },
  });
  const found = S.resolveWorkspace(root, { noCache: true });
  assert.equal(found.public.ws, 'd'.repeat(32));
  assert.equal(found.public.inject, 'on');
  assert.equal(found.has_guarded, true);
  assert.equal(JSON.stringify(found.public).includes('nope'), false);
});

test('8: malformed workspace.json is reported, never thrown, and yields no fields', () => {
  S.clearCache();
  const root = tmpDir();
  fs.mkdirSync(path.join(root, '.handshake'), { recursive: true });
  fs.writeFileSync(path.join(root, '.handshake', 'workspace.json'), '{ not json');
  const found = S.resolveWorkspace(root, { noCache: true });
  assert.equal(found.ok, false);
  assert.ok(found.error);
  assert.deepEqual(found.public, {});
});

test('8: the out-of-workspace no-op path is cached and fast', () => {
  S.clearCache();
  const outside = tmpDir();
  S.resolveWorkspace(outside);                       // prime the cache
  const start = process.hrtime.bigint();
  for (let i = 0; i < 200; i++) S.resolveWorkspace(outside);
  const perCallMs = Number(process.hrtime.bigint() - start) / 1e6 / 200;
  assert.ok(perCallMs < 10, 'cached no-op must stay well under 10 ms, got ' + perCallMs.toFixed(3) + ' ms');
});
