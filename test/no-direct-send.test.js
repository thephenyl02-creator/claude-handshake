'use strict';
// The chokepoint rule, enforced structurally.
//
// SECURITY.md section 4: "filteredSend() is the single outbound chokepoint: no
// code may hand data to a transport except through it, and a test greps the
// tree for direct adapter calls." lib/outbound.js names this file as the place
// that enforcement lives once transports exist. It does now.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'lib');
const BIN = path.join(ROOT, 'bin');
// SECURITY.md section 4 and PLAN.md say the test greps "the tree", not just the
// library: hooks/ and monitors/ post too (hooks/stop.js is the heartbeat
// fallback [C hooks/stop.js:3], monitors/heartbeat.js is the beat itself
// [C hooks/stop.js:38]), so the chokepoint has to hold there as well.
const HOOKS = path.join(ROOT, 'hooks');
const MONITORS = path.join(ROOT, 'monitors');

// The only files allowed to touch the network. Everything else must go through
// an adapter, and every adapter gates before it publishes.
//
// Keyed on the REPO-RELATIVE PATH, not the basename. The scan covers four
// roots now, and a basename-keyed allowlist exempts the name in every one of
// them: a `hooks/transport.js` would have inherited lib/transport.js's licence
// to call fetch and never been scanned at all. The exemption has to name the
// one file it means.
const NETWORK_FILES = new Set([
  'lib/transport.js', 'lib/transport-relay.js', 'lib/transport-ntfy.js',
]);

function sourceFiles(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => ({
    name: f,
    rel: path.relative(ROOT, path.join(dir, f)).split(path.sep).join('/'),
    file: path.join(dir, f),
    text: fs.readFileSync(path.join(dir, f), 'utf8'),
  }));
}

test('only the transport adapters may reach the network', () => {
  const scanned = [LIB, BIN, HOOKS, MONITORS].reduce((acc, d) => acc.concat(sourceFiles(d)), []);
  assert.ok(scanned.some((f) => f.name === 'stop.js'), 'the hooks/ posting path must be in scope');
  assert.ok(scanned.some((f) => f.name === 'heartbeat.js'), 'the monitors/ posting path must be in scope');
  // Every allowlisted path must still exist, or the exemption is silently
  // protecting nothing while its name drifts.
  for (const rel of NETWORK_FILES) {
    assert.ok(scanned.some((f) => f.rel === rel), 'the allowlist names ' + rel + ', which is not in the scan');
  }
  for (const f of scanned) {
    if (NETWORK_FILES.has(f.rel)) continue;
    const hits = f.text.split('\n')
      .map((line, i) => ({ line, i }))
      // Ignore comments; we are looking at code, not prose about code.
      .filter(({ line }) => !/^\s*(\/\/|\*)/.test(line))
      .filter(({ line }) => /\bglobalThis\.fetch\b|\bfetchImpl\s*\(|(^|[^.\w])fetch\s*\(/.test(line));
    assert.deepEqual(hits.map((h) => h.i + 1), [], f.rel + ' must not call fetch directly');
  }
});

test('every publish path gates before it hands anything to a transport', () => {
  const relay = fs.readFileSync(path.join(LIB, 'transport-relay.js'), 'utf8');
  const ntfy = fs.readFileSync(path.join(LIB, 'transport-ntfy.js'), 'utf8');

  // Each adapter's publish() must call the gate before its POST.
  const relayPublish = /async publish\(env\)\s*\{[\s\S]*?\n  \}/.exec(relay)[0];
  assert.match(relayPublish, /envelope\.gate\(/, 'relay publish must gate');
  assert.ok(relayPublish.indexOf('envelope.gate(') < relayPublish.indexOf('this._post('), 'relay must gate BEFORE posting');

  const ntfyPublish = /async publish\(env, opts\)\s*\{[\s\S]*?\n  \}/.exec(ntfy)[0];
  assert.match(ntfyPublish, /envelope\.gate\(/, 'ntfy publish must gate');
  assert.ok(ntfyPublish.indexOf('envelope.gate(') < ntfyPublish.indexOf('encryptForNtfy'), 'ntfy must gate BEFORE encrypting');

  // The relay's server-state endpoints carry authored fields too (presence
  // notes, branches, claim subjects, file lists) and gate them directly.
  // Matched by method NAME, not by full signature: a signature grows an
  // argument now and then (relay v0.1.2 added acquired_at to claim), and a
  // brittle match here would silently stop checking the gate instead of
  // failing loudly.
  for (const method of ['async heartbeat(', 'async claim(', 'async release(']) {
    const at = relay.indexOf(method);
    assert.notEqual(at, -1, 'the relay adapter must still define ' + method);
    const body = relay.slice(at);
    const end = body.indexOf('\n  }');
    assert.match(body.slice(0, end), /sendGate\(/, method + ' must gate its authored fields');
  }
});

test('the CLI never builds or signs an envelope outside lib/envelope.js', () => {
  const cli = fs.readFileSync(path.join(BIN, 'handshake.js'), 'utf8');
  const code = cli.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  assert.equal(/\.sign\s*\(/.test(code), false, 'the CLI must not sign anything itself');
  assert.equal(/crypto\.(createHmac|hkdfSync|createCipheriv|createDecipheriv)\s*\(/.test(code), false,
    'the CLI must not do its own signing, key derivation or encryption');
  // Envelope construction has exactly one site.
  const builds = code.match(/envelope\.build\(/g) || [];
  assert.equal(builds.length, 1, 'envelope.build must be called from exactly one helper, got ' + builds.length);
});

test('the offline queue filters at enqueue and at send, in code as well as in test', () => {
  const state = fs.readFileSync(path.join(LIB, 'state.js'), 'utf8');
  const enqueue = state.slice(state.indexOf('  enqueue(env, opts) {'));
  assert.match(enqueue.slice(0, enqueue.indexOf('\n  }')), /envelope\.gate\(/, 'enqueue must gate');
  const drain = state.slice(state.indexOf('  async drain(publish, opts) {'));
  assert.match(drain.slice(0, drain.indexOf('\n  clear()')), /envelope\.gate\(/, 'drain must gate again at send');
});

test('lib/filter.js and lib/outbound.js are consumed, not modified', () => {
  // A guard against a future edit quietly weakening the chokepoint: these two
  // files are M2 deliverables and this milestone only consumes them.
  const outbound = fs.readFileSync(path.join(LIB, 'outbound.js'), 'utf8');
  assert.match(outbound, /function sendGate\(fields, opts\)/);
  assert.match(outbound, /Fail-closed/);
  const filter = fs.readFileSync(path.join(LIB, 'filter.js'), 'utf8');
  assert.match(filter, /Any internal error returns ok:false \(fail closed\), never throws/);
});
