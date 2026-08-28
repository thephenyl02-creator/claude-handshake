'use strict';
// One release, five places that state its number — and the wire.
//
// Why this file exists: `CLIENT` in bin/handshake.js said 0.0.1 through five
// tagged releases. It is not decoration: it goes into the `ws.join` body as
// PROTOCOL.md section 3's `client` field (client name/version, <= 40 chars),
// and init/join/deploy-relay/migrate persist it into local state and thence
// into the repo-committed .handshake/workspace.json public part
// (lib/workspace-files.js PUBLIC_FIELDS). A stale value misreports the
// software to the peer and to whoever reads that committed file. Nothing
// compared it to anything. This is that comparison.
//
// Normative: PROTOCOL.md section 9 (`client` is a real diagnostic field);
// relay/src/version.js line 1 ("bump RELAY_VERSION on every deploy-visible
// change") — doctor and lib/deploy.js both print what GET /health returns, so
// an operator can only tell two deployed relays apart by that number.
//
// Reads files only. No temp dirs, no network, no git.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));
const SEMVER = /^\d+\.\d+\.\d+$/;

test('every file that states the plugin version states the same one', () => {
  const pkg = json('package.json').version;
  assert.match(pkg, SEMVER, 'package.json version is x.y.z');

  assert.equal(json('.claude-plugin/plugin.json').version, pkg,
    '.claude-plugin/plugin.json — the manifest the plugin host reads');

  const mkt = json('.claude-plugin/marketplace.json');
  // House convention, not a marketplace-format rule: metadata.version versions
  // the catalog, which has held exactly this one plugin at every tag so far.
  // If a second plugin is ever listed here, this is the line to drop.
  assert.equal(mkt.metadata.version, pkg,
    'marketplace.json metadata.version (catalog version, kept in lockstep by convention)');
  const entry = mkt.plugins.find((p) => p.name === 'claude-handshake');
  assert.ok(entry, 'marketplace.json lists a claude-handshake plugin');
  assert.equal(entry.version, pkg, 'marketplace.json plugins[].version');
});

test('the CLIENT string on the wire names the released version', () => {
  const pkg = json('package.json').version;
  const m = read('bin/handshake.js').match(/^const CLIENT = '([^']*)';$/m);
  assert.ok(m, 'bin/handshake.js declares a single-quoted CLIENT constant');
  assert.equal(m[1], 'claude-handshake/' + pkg,
    'CLIENT rides in the ws.join body and into .handshake/workspace.json');
});

test('the marketplace archive URL points at the version it claims', () => {
  const entry = json('.claude-plugin/marketplace.json')
    .plugins.find((p) => p.name === 'claude-handshake');
  const src = entry.source || {};
  assert.equal(src.source, 'archive', 'the entry ships an archive');
  assert.ok(String(src.url).includes('/v' + entry.version + '/'),
    'the release tag in the URL is the entry version');
  assert.ok(String(src.url).endsWith('-' + entry.version + '.zip'),
    'the archive filename carries the entry version');
  assert.match(String(src.sha256 || ''), /^[0-9a-f]{64}$/,
    'the archive records a sha256 (SECURITY.md section 5.4)');
});

test('the relay states one deploy-visible version in both of its files', () => {
  const relayPkg = json('relay/package.json').version;
  assert.match(relayPkg, SEMVER, 'relay/package.json version is x.y.z');
  const m = read('relay/src/version.js').match(/RELAY_VERSION = '([^']*)'/);
  assert.ok(m, 'relay/src/version.js declares RELAY_VERSION');
  assert.equal(m[1], relayPkg,
    'GET /health serves RELAY_VERSION; relay/package.json must not disagree');

  // relay/README.md ships in the plugin zip and hard-codes a sample /health
  // body. It is the third file that states this number, and it drifted the
  // first time the other two moved.
  const sample = read('relay/README.md').match(/\{"ok":true,"service":"[^"]*","version":"([^"]*)","protocol":\d+\}/);
  assert.ok(sample, 'relay/README.md shows a sample GET /health body');
  assert.equal(sample[1], relayPkg,
    'the /health sample in relay/README.md must show the version the relay serves');
});
