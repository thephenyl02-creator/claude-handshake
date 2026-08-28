'use strict';
// Can a user actually RUN this thing, by any of the routes the docs promise?
//
// Why this file exists: every piece worked and the seam between them did not.
// package.json declared no `bin` map, so no install route on any platform
// produced the `handshake <verb>` executable that README.md and
// docs/INSTALL.md told people to type. Meanwhile commands/handshake.md - the
// file the /handshake slash command routes through - and SKILL.md, the other
// file that tells the model how to spawn the CLI, gave every verb as
// `node bin/handshake.js <verb>`: a path relative to the plugin root, executed
// from the human's project directory, where nothing of the sort exists. The
// pieces were fine. Nobody walked from "install" to "type a verb".
//
// Nothing here needs a network, a workspace, or a real install: every claim is
// a property of files that ship. Reads files only.
//
// The doc rule below (a bare `handshake <verb>` must sit near the npm route
// that creates it) is deliberately a LOCALITY check rather than a
// whole-file one. Co-occurrence anywhere in a 500-line document is not what a
// reader gets; a reader gets the paragraph they are looking at, and the whole
// defect was a true-somewhere claim landing where it read as true-everywhere.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));

// The docs that speak to a human installing this. PLAN.md is excluded on
// purpose: it is a design record, not instructions to type.
const USER_DOCS = ['README.md', 'docs/INSTALL.md'];

// How far above an occurrence the qualifying route may sit. Wide enough to
// cover a fenced example and its lead-in sentence, narrow enough that a
// mention in a different section cannot vouch for it.
const NEAR_LINES = 8;

test('package.json maps the CLI onto a real, executable file', () => {
  assert.ok(pkg.bin && typeof pkg.bin === 'object',
    'no "bin" map: npm creates no shim, so `handshake` exists nowhere');
  assert.equal(pkg.bin.handshake, 'bin/handshake.js',
    'the docs promise the verb `handshake`; the map must be the thing that supplies it');

  for (const [name, rel] of Object.entries(pkg.bin)) {
    const abs = path.join(ROOT, rel);
    assert.ok(fs.existsSync(abs), `bin["${name}"] points at a missing file: ${rel}`);
    // Without the shebang, npm's POSIX shim execs the file directly and the
    // kernel has no interpreter for it. npm does not check this; nothing did.
    const first = read(rel).split('\n', 1)[0];
    assert.equal(first, '#!/usr/bin/env node',
      `bin["${name}"] (${rel}) needs a node shebang to be executable as a shim`);
  }
});

test('the bin target is inside the published file list', () => {
  // A `bin` map naming a file that "files" excludes installs a dangling shim:
  // npm publishes happily, and the command fails at first use.
  const files = pkg.files || [];
  for (const rel of Object.values(pkg.bin || {})) {
    const covered = files.some((f) => rel === f || rel.startsWith(f.replace(/\/$/, '') + '/'));
    assert.ok(covered, `"files" does not ship ${rel}, so the shim would dangle`);
  }
});

// Both files the MODEL reads to learn how to spawn the CLI. The slash command
// routes the typed verbs; SKILL.md carries its own CLI map plus the commands
// woven through the tiebreak, note and sign-off procedures - and a model
// following §3.1 step 1 spawns from SKILL.md without ever opening the command
// file. Fixing one and not the other leaves the defect fully live.
const SPAWN_DOCS = ['commands/handshake.md', 'skills/handshake-coordination/SKILL.md'];

test('no file tells the model to spawn the CLI by a project-relative path', () => {
  // These files are read and executed from the USER'S project directory.
  // A bare `bin/handshake.js` there resolves against their repo.
  // Only SPAWN forms matter here: `[C bin/handshake.js:848]` citations and
  // prose naming the broken form are not something the model executes.
  for (const rel of SPAWN_DOCS) {
    const src = read(rel);
    const bare = [];
    for (const m of src.matchAll(/node\s+"?([^"\s]*bin\/handshake\.js)/g)) {
      const p = m[1];
      if (!p.includes('CLAUDE_PLUGIN_ROOT') && !path.isAbsolute(p)) bare.push(m[0]);
    }
    assert.deepEqual(bare, [],
      `each spawned bin/handshake.js in ${rel} must be reached through CLAUDE_PLUGIN_ROOT or an absolute path`);
    assert.match(src, /node "\$CLAUDE_PLUGIN_ROOT\/bin\/handshake\.js"/,
      `${rel} must actually show the resolvable invocation form`);
  }
});

test('the command file keeps its fallback recipe rewritable-proof', () => {
  // The installers' fallback route substitutes every literal `$CLAUDE_PLUGIN_ROOT`
  // and `${CLAUDE_PLUGIN_ROOT}` in this file for an absolute directory
  // [C installers/install.sh:836-858]. That is wanted on the command paths and
  // fatal in the prose that explains what to do when the variable is EMPTY -
  // a rewritten fallback recipe cannot act as a fallback.
  const lines = read('commands/handshake.md').split('\n');
  const rewritable = /\$\{?CLAUDE_PLUGIN_ROOT\}?(?![:\w])/;
  const offenders = lines
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => rewritable.test(line) && !line.includes('bin/handshake.js'));
  assert.deepEqual(offenders.map((o) => o.n), [],
    'outside a CLI path, spell it CLAUDE_PLUGIN_ROOT or ${CLAUDE_PLUGIN_ROOT:-…} so the installer leaves it alone');
});

test('user docs offer a bare `handshake <verb>` only beside the route that creates it', () => {
  for (const rel of USER_DOCS) {
    const lines = read(rel).split('\n');
    lines.forEach((line, i) => {
      // `/handshake doctor` is the slash command and always fine; the bare
      // form is the one that needs an npm install behind it.
      if (!/(^|[^/\w`])`handshake [a-z]/.test(line) && !/^\s*handshake [a-z]/.test(line)) return;
      const near = lines.slice(Math.max(0, i - NEAR_LINES), i + 1).join('\n');
      assert.match(near, /npm install -g/,
        `${rel}:${i + 1} promises \`handshake …\` with no npm route within ${NEAR_LINES} lines: ${line.trim()}`);
    });
  }
});

test('PLAN.md does not describe the Stop hook as syncing or writing the digest', () => {
  // PLAN.md ships inside the plugin zip [C package.json "files"], so a wrong
  // sentence here is distributed, not internal. hooks/stop.js requires only
  // ./common and ../monitors/heartbeat: there is no inbound path in it at all.
  const stop = read('hooks/stop.js');
  assert.equal(/require\(['"]\.\/sync['"]\)/.test(stop), false,
    'stop.js gained an inbound sync - PLAN.md row and this guard both need revisiting');

  const row = read('PLAN.md').split('\n').find((l) => /^\| Stop \|/.test(l));
  assert.ok(row, 'PLAN.md lost its Stop hook row');
  assert.equal(/sync-and-write-digest/.test(row), false,
    'PLAN.md claims the Stop hook syncs and writes the digest; it only beats');
  assert.match(row, /hooks\/stop\.js/, 'the corrected row should cite the code it describes');
});
