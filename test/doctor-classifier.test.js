'use strict';
// Why this file exists: doctor's `claude plugin list` verdict had ZERO test
// coverage and had already shipped a real bug because of it. Every other test
// sets HANDSHAKE_SKIP_HOST_CHECKS=1 (test/cli.test.js) so the check never runs
// under test, and at the old 20s timeout the CLI timed out 3/10 on Windows and
// a healthy, enabled plugin was reported as "not installed" - a slow CLI read
// as a missing one. The spawn itself still can't be unit-tested (it depends on
// a host CLI that may not exist), but the decision it feeds CAN be, so
// classifyPluginList() is pure and every branch is pinned here.
//
// The result objects below are hand-built stand-ins carrying only the fields
// the classifier actually reads - stdout, stderr, error, signal - not captured
// transcripts of a real `claude plugin list` run.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'handshake.js');

// ------------------------------------------------- load-time guard check ----
// At module scope, BEFORE the require below, and deliberately not inside a
// test(). bin/handshake.js is only safe to require because main() sits behind
// `if (require.main === module)` [C bin/handshake.js:2075]. Remove that guard
// and requiring it here runs main(process.argv.slice(2)) inside the test
// runner, where argv is node --test's own - so the CLI parses a test file path
// as a subcommand, prints usage to stdout and sets process.exitCode = 2
// [C bin/handshake.js:2062]. Worse, cmdDoctor and friends can process.exit()
// or hang on I/O, and a load-time exit makes `node --test` report this file as
// GREEN with every test in it silently missing. Assert first: a throw is
// reported as a failure, a dead process is not.
// Normalized for the same reason the guard regex below is anchored on newlines:
// core.autocrlf=true gives a fresh clone CRLF and there is no .gitattributes,
// so an eol-sensitive match would pass here and fail on a colleague's checkout.
const CLI_SRC = fs.readFileSync(CLI, 'utf8').split('\r\n').join('\n');
assert.match(CLI_SRC, /\nif \(require\.main === module\) \{\n\s*main\(process\.argv/,
  'bin/handshake.js must invoke main() behind `if (require.main === module)`; ' +
  'without that guard, requiring it below would run the CLI inside the test runner ' +
  'instead of exposing classifyPluginList');

const { classifyPluginList } = require(CLI);

// A spawnSync result with the defaults Node gives on a clean, successful run;
// each case overrides only the fields its scenario changes.
function result(fields) {
  return Object.assign({ stdout: '', stderr: '', status: 0, signal: null, error: undefined }, fields);
}

// Node attaches `code` to the Error it puts on r.error; both the code and the
// message are consulted by the timeout test, so cases can vary either.
function spawnError(message, code) {
  const e = new Error(message);
  if (code) e.code = code;
  return e;
}

const NOT_INSTALLED = /not installed/;

// ------------------------------------------------------------- timeout ----
// The shipped regression. A timeout is an UNKNOWN, never a verdict: the child
// was killed before it could answer, so its (absent) output is not evidence.

test('a timeout is warn, and specifically NOT the "not installed" wording', () => {
  const rows = [
    // What Node actually produces on `timeout:`: SIGTERM plus an ETIMEDOUT error.
    result({ signal: 'SIGTERM', status: null, error: spawnError('spawnSync claude ETIMEDOUT', 'ETIMEDOUT') }),
    // Either signal alone...
    result({ signal: 'SIGTERM', status: null, error: spawnError('spawnSync claude failed') }),
    // ...or the code alone is enough; neither may fall through.
    result({ signal: null, status: null, error: spawnError('spawnSync claude ETIMEDOUT', 'ETIMEDOUT') }),
  ];
  for (const r of rows) {
    const v = classifyPluginList(r);
    assert.equal(v.level, 'warn');
    assert.match(v.message, /did not answer within 60s/);
    assert.match(v.message, /UNKNOWN, not a verdict/);
    assert.ok(!NOT_INSTALLED.test(v.message),
      'a slow CLI must never be reported as a missing one: ' + v.message);
  }
});

test('a timeout stays UNKNOWN even when the killed child printed our name first', () => {
  // Partial output must not be mistaken for a complete listing in either
  // direction - not "installed", not "missing".
  const v = classifyPluginList(result({
    stdout: 'Plugins:\n  claude-handshake@0.1.4',
    signal: 'SIGTERM',
    status: null,
    error: spawnError('spawnSync claude ETIMEDOUT', 'ETIMEDOUT'),
  }));
  assert.equal(v.level, 'warn');
  assert.match(v.message, /UNKNOWN, not a verdict/);
});

// -------------------------------------------------------- CLI unavailable ---

test('a spawn error (no `claude` on PATH) is warn, not fail', () => {
  const rows = [
    spawnError('spawnSync claude ENOENT', 'ENOENT'),
    spawnError('spawnSync claude EACCES', 'EACCES'),
  ];
  for (const error of rows) {
    const v = classifyPluginList(result({ status: null, error }));
    assert.equal(v.level, 'warn');
    assert.match(v.message, /could not read `claude plugin list`/);
  }
});

test('output that never mentions claude-handshake is warn', () => {
  const rows = [
    '',                                            // silent success
    'Plugins:\n  some-other-plugin@1.0.0  Status: enabled\n',
    'error: unknown command "plugin"\n',           // an older host CLI
  ];
  for (const stdout of rows) {
    const v = classifyPluginList(result({ stdout }));
    assert.equal(v.level, 'warn');
    assert.match(v.message, /could not read `claude plugin list`/);
  }
});

test('stderr counts as output too, so a name printed there is still read', () => {
  const v = classifyPluginList(result({ stdout: '', stderr: 'claude-handshake@0.1.4  Status: enabled\n' }));
  assert.equal(v.level, 'pass');
});

// ------------------------------------------------------------ failed load ---
// The whole reason this check exists: a plugin can install "successfully" and
// still fail to load, at which point no hook fires and nothing coordinates.

test('a failed-to-load plugin is fail, in both spellings, with the Error line surfaced', () => {
  const rows = [
    'Plugins:\n  claude-handshake@0.1.4  Status: x\n    Error: duplicate hooks key in plugin.json\n',
    'Plugins:\n  claude-handshake@0.1.4  Status: ×\n    Error: duplicate hooks key in plugin.json\n',
    'Plugins:\n  claude-handshake@0.1.4 failed to load\n    Error: duplicate hooks key in plugin.json\n',
    'Plugins:\n  claude-handshake@0.1.4 FAILED TO LOAD\n    Error: duplicate hooks key in plugin.json\n',
  ];
  for (const stdout of rows) {
    const v = classifyPluginList(result({ stdout }));
    assert.equal(v.level, 'fail', stdout);
    assert.match(v.message, /FAILED TO LOAD - no hook fires/);
    // Without the cause the operator has a verdict and no lead to follow.
    assert.match(v.message, /duplicate hooks key in plugin\.json/);
  }
});

test('a failed load with no Error line is still fail, just without a cause', () => {
  const v = classifyPluginList(result({ stdout: 'claude-handshake@0.1.4  Status: x\n' }));
  assert.equal(v.level, 'fail');
  assert.equal(v.message, 'the plugin is installed but FAILED TO LOAD - no hook fires, so nothing coordinates.');
});

test('another plugin failing above ours is not charged to us', () => {
  // The verdict reads from our own entry onwards; a neighbour's breakage is
  // not our breakage.
  const v = classifyPluginList(result({
    stdout: 'Plugins:\n  other-plugin@2.0.0  Status: x\n    Error: not our problem\n' +
      '  claude-handshake@0.1.4  Status: enabled\n',
  }));
  assert.equal(v.level, 'pass');
});

// ----------------------------------------------------------------- healthy ---

test('an installed, enabled plugin is pass', () => {
  const rows = [
    'claude-handshake@0.1.4  Status: enabled\n',
    'Plugins:\n  claude-handshake@0.1.4 (marketplace)  Status: enabled\n  other@1.0.0  Status: enabled\n',
  ];
  for (const stdout of rows) {
    const v = classifyPluginList(result({ stdout }));
    assert.equal(v.level, 'pass');
    assert.equal(v.message, 'claude plugin list reports it enabled');
  }
});

test('every branch returns a level doctor knows how to print', () => {
  // doctor's three-valued contract: an unrecognised level would render as a
  // blank verdict rather than an error, so pin the vocabulary.
  const rows = [
    result({ signal: 'SIGTERM', status: null, error: spawnError('ETIMEDOUT', 'ETIMEDOUT') }),
    result({ status: null, error: spawnError('spawnSync claude ENOENT', 'ENOENT') }),
    result({ stdout: 'nothing here\n' }),
    result({ stdout: 'claude-handshake  Status: x\n' }),
    result({ stdout: 'claude-handshake  Status: enabled\n' }),
  ];
  for (const r of rows) {
    const v = classifyPluginList(r);
    assert.ok(['pass', 'warn', 'fail'].includes(v.level), 'unknown level ' + v.level);
    assert.equal(typeof v.message, 'string');
    assert.ok(v.message.length > 0);
  }
});

// ------------------------------------------------- attribution & disabled ---
// Added after doctor was found reading from our entry to the END of the
// output: a DIFFERENT plugin listed BELOW ours had its failure, and its Error:
// line, reported as ours. The entry now ends where the record ends. The record
// shape is the one installers/install.sh read_plugin_state() parses (header
// line, indented Status:/Error: fields, blank line terminates), and the older
// single-row rendering ("<id>  Status: enabled") is read too, because which
// one a given host prints has not been confirmed from a live listing.

test('a plugin failing BELOW ours is not charged to us', () => {
  const rows = [
    // multi-line records, blank-line separated
    'claude-handshake@claude-handshake\n  Status: enabled\n\n' +
      'other@mkt\n  Status: failed to load\n  Error:  Failed to load plugin other: bad manifest\n',
    // single-row rendering
    'Plugins:\n  claude-handshake@0.1.4  Status: enabled\n' +
      '  other@2.0.0  Status: x\n    Error: not our problem\n',
  ];
  for (const stdout of rows) {
    const v = classifyPluginList(result({ stdout }));
    assert.equal(v.level, 'pass', stdout);
    // The neighbour's cause must not be quoted at us either.
    assert.doesNotMatch(v.message, /not our problem|bad manifest/);
  }
});

test('our own Error line is a field, not the start of a new entry', () => {
  // The CLI renders "Error: Failed to load plugin <id>: ..." - which contains
  // our own id. Reading it as a header loses the most useful line in the
  // output; install.sh hit exactly this and its awk guards against it.
  const v = classifyPluginList(result({
    stdout: 'claude-handshake@claude-handshake\n  Status: failed to load\n' +
      '  Error:  Failed to load plugin claude-handshake@claude-handshake: Duplicate hooks file detected\n',
  }));
  assert.equal(v.level, 'fail');
  assert.match(v.message, /Duplicate hooks file detected/);
});

test('disabled is not enabled: it is a fail, with its own wording', () => {
  // This used to fall through to "reports it enabled" - the plugin host had
  // switched every hook off and doctor called it healthy.
  for (const stdout of [
    'claude-handshake@claude-handshake\n  Status: disabled\n',
    'claude-handshake@0.1.4  Status: disabled\n',
  ]) {
    const v = classifyPluginList(result({ stdout }));
    assert.equal(v.level, 'fail', stdout);
    assert.match(v.message, /DISABLED - no hook fires/);
    assert.doesNotMatch(v.message, /FAILED TO LOAD/);
  }
});

test('our name inside another plugin text is not us being installed', () => {
  const v = classifyPluginList(result({
    stdout: 'rival@market\n  Status: failed to load\n  Error:  conflicts with claude-handshake somehow\n',
  }));
  assert.equal(v.level, 'warn');
  assert.match(v.message, /not installed as a plugin/);
});

test('listed with a Status we cannot read is UNKNOWN, never pass', () => {
  const v = classifyPluginList(result({
    stdout: 'claude-handshake@claude-handshake\n  Version: 0.1.4\n',
  }));
  assert.equal(v.level, 'warn');
  assert.match(v.message, /Status line could not be read/);
});
