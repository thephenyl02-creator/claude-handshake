'use strict';
// The release artifact: what goes into the zip, and whether it builds twice the
// same way.
//
// Why this file exists: scripts/build-plugin-zip.js is the whole release
// pipeline and had no test at all. The one safety check it carries points in
// the harmless direction — it hard-fails when an INCLUDE entry has VANISHED
// (fs.existsSync, then "missing: " and exit 1). The dangerous direction is the
// opposite one and it is silent: add a file under lib/ or hooks/, forget to
// widen INCLUDE, and the zip still builds, still hashes, still installs — and
// the plugin dies on the first require() of the file nobody shipped. Nothing
// noticed. So this file asserts:
//
//   1. Every file the installed plugin actually LOADS is in the archive. The
//      runtime set is COMPUTED here — walk the manifests the host reads, follow
//      require() out from them — never a list someone typed, because a typed
//      list drifts in exactly the way INCLUDE drifts.
//   2. INCLUDE and package.json "files" name the same set. The comment above
//      INCLUDE claims this; until this test existed it was false, because
//      "files" listed the whole `.claude-plugin` directory and so would have
//      swept in the very marketplace.json the script excludes on purpose.
//   3. Building twice produces byte-identical output. The release pins the
//      archive's sha256 in plugins[].source.sha256
//      [C .claude-plugin/marketplace.json], and the installers' primary route
//      verifies it [C docs/SECURITY.md:310] — a rebuild that shifted one byte
//      would strand every later installer on a hash the artifact no longer has.
//
// Builds run against a staged copy in a temp dir, never the repo: the script
// writes to <root>/dist [C scripts/build-plugin-zip.js], and a test has no
// business leaving artifacts there. Staging each build independently also means
// their on-disk mtimes differ, which is the likeliest way determinism leaks.
//
// Reads files, spawns node, writes only under os.tmpdir(). No network, no git.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = 'scripts/build-plugin-zip.js';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));

// -------------------------------------------------------------- INCLUDE -----

// The script does its work at require time and exits when argv[2] is not a
// version, so it cannot be require()d for its list. Read the literal out of the
// source instead — the same move test/version.test.js makes for CLIENT.
function includeList() {
  const m = read(SCRIPT).match(/\nconst INCLUDE = \[\n([\s\S]*?)\n\];\n/);
  assert.ok(m, SCRIPT + ' declares a single INCLUDE array literal');
  const items = (m[1].match(/'[^']+'/g) || []).map((s) => s.slice(1, -1));
  assert.ok(items.length > 5, 'INCLUDE parsed as a non-trivial list');
  return items;
}

// An INCLUDE entry is either a file or a directory root; the script walks the
// directories whole [C scripts/build-plugin-zip.js, function walk].
const coveredBy = (entries, rel) =>
  entries.some((e) => rel === e || rel.startsWith(e + '/'));

// -------------------------------------------------------- the runtime set ---

// What the installed plugin loads, derived rather than declared.
//
// The seeds are the two manifests the host opens BY NAME: the plugin manifest
// [C .claude-plugin/plugin.json] and the hooks manifest whose command shape
// test/hooks.test.js already pins [C test/hooks.test.js:751]. Everything else is
// followed out of file contents.
function runtimeSet() {
  const found = new Set();
  const queue = [];
  const addJs = (rel) => { if (!found.has(rel)) { found.add(rel); queue.push(rel); } };

  // Manifests point at further manifests through "./..." values (today that is
  // plugin.json's experimental.monitors), and each one names the scripts the
  // host executes as "${CLAUDE_PLUGIN_ROOT}/<path>".
  const manifests = ['.claude-plugin/plugin.json', 'hooks/hooks.json'];
  for (const rel of manifests) {
    found.add(rel);
    const src = read(rel);
    for (const v of leaves(JSON.parse(src))) {
      if (typeof v === 'string' && v.startsWith('./') && v.endsWith('.json')) {
        const sub = v.slice(2);
        if (!manifests.includes(sub)) manifests.push(sub);
      }
    }
    for (const m of src.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9._/-]+\.js)/g)) addJs(m[1]);
  }

  // The CLI is reached the other way round: the shipped command file and skill
  // are what tell the model to run it [C commands/handshake.md, the verb table;
  // C skills/handshake-coordination/SKILL.md:329].
  for (const md of markdownUnder(['commands', 'skills'])) {
    for (const m of read(md).matchAll(/(?:\$\{?CLAUDE_PLUGIN_ROOT\}?\/)?(bin\/[A-Za-z0-9._-]+\.js)/g)) addJs(m[1]);
  }

  // Transitive require() closure. Two shapes exist in this tree, both string
  // literals: ordinary relative requires, and hooks/common.js's lib() helper,
  // which joins a bare filename onto ../lib [C hooks/common.js:109].
  while (queue.length) {
    const rel = queue.shift();
    const src = read(rel);
    const dir = path.posix.dirname(rel);
    for (const m of src.matchAll(/require\('(\.[^']+)'\)/g)) {
      let target = path.posix.normalize(path.posix.join(dir, m[1]));
      if (!target.endsWith('.js')) target += '.js';
      addJs(target);
    }
    for (const m of src.matchAll(/\blib\('([A-Za-z0-9._-]+\.js)'\)/g)) addJs('lib/' + m[1]);
  }

  // `deploy-relay` refuses to run unless it finds the bundled relay, so whatever
  // it probes for is a runtime file too. The probes are read out of the source
  // rather than restated, so a third one gets picked up on its own
  // [C lib/deploy.js:417, function locateRelayDir].
  for (const m of read('lib/deploy.js').matchAll(/fs\.existsSync\(path\.join\(c, ([^)]+)\)\)/g)) {
    const parts = (m[1].match(/'[^']+'/g) || []).map((s) => s.slice(1, -1));
    if (parts.length) found.add(['relay'].concat(parts).join('/'));
  }

  return [...found].sort();
}

// Every leaf value of a parsed manifest, so a path is spotted wherever that
// manifest's schema happens to put it.
function leaves(node, out) {
  out = out || [];
  if (node && typeof node === 'object') for (const v of Object.values(node)) leaves(v, out);
  else out.push(node);
  return out;
}

function markdownUnder(dirs) {
  const out = [];
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(ROOT, rel))) {
      const child = rel + '/' + name;
      if (fs.statSync(path.join(ROOT, child)).isDirectory()) walk(child);
      else if (name.endsWith('.md')) out.push(child);
    }
  };
  for (const d of dirs) walk(d);
  return out;
}

// ------------------------------------------------------------- the build ----

const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });

// Stage exactly the INCLUDE tree plus the script into a fresh temp root and run
// the real builder there. ROOT inside the script is __dirname/.., so the staged
// root is what it sees and dist/ lands in the temp dir.
function build(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handshake-zip-'));
  temps.push(dir);
  fs.mkdirSync(path.join(dir, path.dirname(SCRIPT)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, SCRIPT), path.join(dir, SCRIPT));
  for (const item of includeList()) {
    const dst = path.join(dir, item);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.cpSync(path.join(ROOT, item), dst, { recursive: true });
  }
  const r = spawnSync(process.execPath, [path.join(dir, SCRIPT), version], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, 'builder exited 0, stderr: ' + (r.stderr || ''));
  const zip = fs.readFileSync(path.join(dir, 'dist', 'claude-handshake-plugin-' + version + '.zip'));
  return { zip, stdout: r.stdout };
}

// The archive's own table of contents, so "what shipped" is read back off the
// bytes instead of re-derived from INCLUDE. Central-directory layout per
// APPNOTE 4.3.12; the builder writes a zero-length archive comment, so the EOCD
// is the last 22 bytes [C scripts/build-plugin-zip.js, the eocd buffer].
function entryNames(buf) {
  const eocd = buf.length - 22;
  assert.equal(buf.readUInt32LE(eocd), 0x06054b50, 'end-of-central-directory signature');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(off), 0x02014b50, 'central directory header ' + i);
    const nameLen = buf.readUInt16LE(off + 28);
    names.push(buf.toString('utf8', off + 46, off + 46 + nameLen));
    off += 46 + nameLen + buf.readUInt16LE(off + 30) + buf.readUInt16LE(off + 32);
  }
  return names;
}

// -------------------------------------------------------------- the tests ---

test('every file the plugin loads at runtime is in the archive', () => {
  const runtime = runtimeSet();

  // A regex that quietly stopped matching would make the loop below vacuously
  // true, so first prove the derivation still reaches the whole graph: the CLI,
  // the monitor, the hook helpers and the lib/ modules they pull in.
  assert.ok(runtime.length >= 25, 'derived runtime set is non-trivial, got ' + runtime.length);
  for (const rel of ['bin/handshake.js', 'monitors/heartbeat.js', 'monitors/monitors.json',
    'hooks/common.js', 'hooks/render.js', 'hooks/sync.js', 'lib/state.js',
    'lib/secret-shapes.js', 'lib/outbound.js', 'relay/src/worker.js']) {
    assert.ok(runtime.includes(rel), 'derivation reached ' + rel);
  }
  for (const rel of runtime) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), 'derived path exists: ' + rel);
  }

  const shipped = new Set(entryNames(build(json('package.json').version).zip));
  for (const rel of runtime) {
    assert.ok(shipped.has(rel), rel + ' is loaded at runtime but the archive does not ship it');
  }
});

test('the archive and an npm tarball would carry the same set', () => {
  const include = includeList();
  const files = json('package.json').files;
  assert.deepEqual([...include].sort(), [...files].sort(),
    'INCLUDE in ' + SCRIPT + ' and package.json "files" must not drift');

  // The one file that has to stay out of the zip, because it states that zip's
  // own sha256 [C .claude-plugin/marketplace.json, plugins[].source.sha256].
  // Naming the `.claude-plugin` directory in either list would ship it.
  for (const list of [include, files]) {
    assert.ok(!coveredBy(list, '.claude-plugin/marketplace.json'),
      'marketplace.json carries this archive\'s own hash and must not be listed');
    assert.ok(coveredBy(list, '.claude-plugin/plugin.json'),
      'the manifest the plugin host reads is listed');
  }
});

test('building twice produces byte-identical output', () => {
  const version = json('package.json').version;
  const a = build(version);
  const b = build(version);

  assert.equal(a.zip.length, b.zip.length, 'same byte length');
  assert.ok(a.zip.equals(b.zip), 'two independent builds of the same tree differ');

  // The sha256 the builder prints is what a human copies into marketplace.json,
  // so it has to be the archive's real hash and not, say, the pre-zip content's.
  const sha = crypto.createHash('sha256').update(a.zip).digest('hex');
  assert.ok(a.stdout.includes('sha256: ' + sha), 'the printed sha256 is the archive\'s own');
  assert.equal(a.stdout.split('sha256: ')[1], b.stdout.split('sha256: ')[1],
    'both builds print the same sha256');
});

test('the archive ships nothing outside INCLUDE, in sorted order', () => {
  const include = includeList();
  const names = entryNames(build(json('package.json').version).zip);

  assert.ok(names.length > 0, 'the archive has entries');
  for (const rel of names) {
    assert.ok(coveredBy(include, rel), 'unexpected entry: ' + rel);
    // The reason this builder exists rather than Compress-Archive: backslash
    // entry names break extraction on Linux [C scripts/build-plugin-zip.js:4-6].
    assert.ok(!rel.includes('\\'), 'forward-slash entry names only: ' + rel);
  }
  // Sorted entries are half of what makes the build reproducible; the other
  // half is the fixed DOS timestamp [C scripts/build-plugin-zip.js, DOS_DATE].
  assert.deepEqual(names, [...names].sort(), 'entries are written in sorted order');
});
