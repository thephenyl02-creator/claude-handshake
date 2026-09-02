'use strict';

// commands/handshake.md is the routing table the /handshake slash command
// reads, and its own standing rule is "unknown first word -> print the verb
// list, run nothing". So a verb the CLI routes but the table omits does not
// degrade politely: the model prints a list the verb is not on and runs
// nothing at all. `note`, `warn`, `presence`, `change` and `leave` were all
// missing that way while the CLI's own USAGE documented every one of them.
// The first test below is the guard: COMMANDS is the authority, and every key
// in it has to be spawnable from the doc.
//
// The second is the guard for the other half. The doc cites source with
// `[C file:line]`, and those citations rot silently every time a function
// moves - four of them were pointing at unrelated code one rewrite later, and
// a citation that names the wrong line is worse than no citation, because it
// reads as verified. A pure line-count bound catches only deletions, so the
// load-bearing ones are pinned to a substring the cited range must still
// contain. When this file goes red after a refactor, the fix is to retarget
// the citation in the doc, never to loosen the anchor.
//
// Reads files only: no network, no workspace, no install.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DOC_REL = 'commands/handshake.md';

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

const doc = read(DOC_REL);

// docs/SECURITY.md's bin/handshake.js citations are pinned here too - scoped to
// that ONE source file on purpose. It is the file that moves most, and six of
// these citations were found pointing at unrelated lines within a day of being
// written, because nothing checked them. Citations into lib/ and relay/ move
// rarely and stay review-checked; widening the net to every [C ...] in
// SECURITY.md would make this file red on every doc edit, and a guard that
// cries wolf gets deleted.
const SECURITY_REL = 'docs/SECURITY.md';
const securityDoc = read(SECURITY_REL);
const { COMMANDS, USAGE } = require('../bin/handshake.js');

test('every verb the CLI routes is spawnable from commands/handshake.md', () => {
  const missing = Object.keys(COMMANDS).filter((verb) => {
    // The exact shape the model executes: `node "<root>/bin/handshake.js" <verb>`.
    // Anchoring on the spawn form rather than on a bare mention is what keeps
    // this honest - `leave` appears in the prose of a doc that cannot run it.
    const re = new RegExp('bin/handshake\\.js"\\s+' + verb.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '(?![\\w-])');
    return !re.test(doc);
  });
  assert.deepEqual(missing, [],
    'commands/handshake.md routes an unknown first word to "print the verb list, run nothing", ' +
    'so a verb missing from it silently does nothing when a human asks for it');
});

test('every verb in commands/handshake.md is one the CLI actually routes', () => {
  const routed = new Set(Object.keys(COMMANDS));
  const invented = [];
  for (const m of doc.matchAll(/bin\/handshake\.js"\s+([a-z][a-z-]*)/g)) {
    if (!routed.has(m[1])) invented.push(m[1]);
  }
  assert.deepEqual([...new Set(invented)], [],
    'the doc offers a verb `main` would reject with "unknown command", exit 2');
});

test('the five verbs added for the routing gap keep their USAGE shapes', () => {
  // USAGE is the CLI's own answer to `handshake help`; the doc must not drift
  // into a second, different spelling of the same argument grammar.
  const shapes = {
    note: ['discovery|error|fix|blocker|info', '--paths a,b', '--subject'],
    warn: ['overlap', '--subject', '--peer ', '--peer-subject'],
    presence: ['working|waiting|blocked|tooling_broken', '--branch', '--agents'],
    change: ['--change files|ttl|tiebreak_loss|scope', '--files a,b', '--note'],
    leave: ['--reason signoff|session_end|error', '--summary'],
  };
  for (const [verb, fragments] of Object.entries(shapes)) {
    const row = doc.split('\n').find((l) => l.includes('bin/handshake.js" ' + verb + ' ') ||
      l.includes('bin/handshake.js" ' + verb + '`'));
    assert.ok(row, verb + ' has no spawn row in ' + DOC_REL);
    for (const frag of fragments) {
      // The doc escapes `|` for the markdown table; USAGE does not.
      assert.ok(row.replace(/\\\|/g, '|').includes(frag),
        verb + ' row is missing `' + frag + '`, which USAGE documents');
      assert.ok(USAGE.replace(/\s+/g, ' ').includes(frag.replace(/\s+$/, '')),
        'the pinned fragment `' + frag + '` is no longer in USAGE - re-derive it, do not delete the check');
    }
  }
});

test('every [C file:line] citation in the doc is inside the file it names', () => {
  const bad = [];
  for (const m of doc.matchAll(/\[C ([\w./-]+):([\d,\-]+)\]/g)) {
    const [, rel, spans] = m;
    let text;
    try { text = read(rel); } catch (e) { bad.push(rel + ' - no such file'); continue; }
    const total = text.split('\n').length;
    for (const span of spans.split(',')) {
      const [lo, hi] = span.split('-').map(Number);
      if (!lo || lo > total || (hi && (hi < lo || hi > total))) {
        bad.push(rel + ':' + span + ' - file has ' + total + ' lines');
      }
    }
  }
  assert.deepEqual(bad, [], 'a citation pointing past the end of its file cannot support anything');
});

// Each line-numbered citation in the doc, mapped to a substring THAT citation's
// own range must still contain - the sentence's actual evidence, not a nearby
// landmark. Pinned per citation rather than per file on purpose: a narrow
// citation that has drifted off its evidence otherwise hides inside a broader
// one that happens to overlap, which is exactly how the last four went stale
// unnoticed.
const PINNED = {
  '[C bin/handshake.js:42-56]': 'function parseArgs',
  '[C bin/handshake.js:515-525]': 'recordMemberEmail(state, founderMember',
  '[C bin/handshake.js:694-699]': 'recordMemberEmail(state, member',
  '[C bin/handshake.js:903-973]': 'async function cmdPost',
  '[C bin/handshake.js:907-910]': "const allowed = ['note.discovery'",
  '[C bin/handshake.js:911]': "args._.slice(1).join(' ')",
  '[C bin/handshake.js:941-947]': 'below the 50% floor',
  '[C bin/handshake.js:1124-1127]': 'args.flags.refresh !== undefined',
  '[C bin/handshake.js:1330-1332]': '--grace must be 0..86400',
  '[C bin/handshake.js:1351-1379]': 'async function cmdLeave',
  '[C bin/handshake.js:1355-1358]': '--reason must be session_end',
  '[C bin/handshake.js:1680-1689]': 'async function cmdNote',
  '[C bin/handshake.js:1681-1686]': '!kinds.includes(kind)',
  '[C bin/handshake.js:1690]': "args._.slice(1).join(' ').trim() ||",
  '[C bin/handshake.js:1694-1700]': 'async function cmdWarn',
  '[C bin/handshake.js:1695-1698]': "args._[0] !== 'overlap'",
  '[C bin/handshake.js:1705-1709]': "args.flags.change === 'string' ? args.flags.change : null",
  '[C bin/handshake.js:1715-1727]': 'body.files_added',
  '[C bin/handshake.js:1784-1787]': 'args.flags.reason.slice(0, 120)',
  '[C bin/handshake.js:1786-1808]': 'presence.update',
  '[C bin/handshake.js:1857-1863]': 'stopPosting',
  '[C bin/handshake.js:2005-2011]': 'recordMemberEmail(state, founderMember',
  '[C bin/handshake.js:2504-2512]': 'const COMMANDS = {',
  '[C bin/handshake.js:2522-2535]': "'  presence  working|waiting|blocked|tooling_broken",
  '[C lib/repo.js:25]': 'GUARD_TTL_MS = 600',
  '[C lib/repo.js:358-365]': "'config', '--get', 'user.email'",
  '[C lib/state.js:47-57]': 'CLAUDE_PLUGIN_DATA is deliberately NOT consulted',
  '[C lib/workspace-files.js:442-473]': 'function checkShardAuthors',
  '[C lib/workspace-files.js:454,458]': 'no_recorded_email_for_member',
  '[C lib/workspace-files.js:559-561]': 'unknown, which is not the same as clean',
  '[C installers/install.sh:57,750-751]': '$FALLBACK_ROOT/$VERSION',
  '[C installers/install.sh:836-860,889]': 'CLAUDE_PLUGIN_ROOT',
  '[C installers/install.ps1:814-845,866]': 'CLAUDE_PLUGIN_ROOT',
};

const SECURITY_PINNED = {
  '[C bin/handshake.js:402-407]': 'function defaultMemberName',
  '[C bin/handshake.js:405]': 'slice(0, 48)',
  '[C bin/handshake.js:406]': "return base || 'founder'",
  '[C bin/handshake.js:445-446]': 'asFlag || defaultMemberName()',
  '[C bin/handshake.js:631-633]': 'member name (printable ASCII, 1-64 chars)',
  '[C bin/handshake.js:634-636]': 'must be 1-64 printable ASCII chars',
  '[C bin/handshake.js:1259-1264]': 'shard_warning: (repoState.warnings',
  '[C bin/handshake.js:1297-1302]': "shard_warning === 'non_member_commit'",
  '[C bin/handshake.js:1948-1949]': 'asFlag || defaultMemberName()',
  '[C bin/handshake.js:524,698,2007]': 'recordMemberEmail(state',
  '[C bin/handshake.js:453,479]': 'founderMember = founderName',
  '[C bin/handshake.js:460,479,1958]': 'joined.member_id || founderName',
  '[C bin/handshake.js:175-177,206]': 'member: cfg.member',
};

// [doc path, doc text, pin table, which citations the unpinned check covers]
const DOCS = [
  [DOC_REL, doc, PINNED, /\[C [\w./-]+:[\d,\-]+\]/g],
  [SECURITY_REL, securityDoc, SECURITY_PINNED, /\[C bin\/handshake\.js:[\d,\-]+\]/g],
];

test('the load-bearing citations still land on the code they claim', () => {
  const drifted = [];
  for (const [docRel, docText, pins] of DOCS) {
  for (const [citation, needle] of Object.entries(pins)) {
    assert.ok(docText.includes(citation),
      docRel + ' no longer carries ' + citation + ' - if it was retargeted on purpose, ' +
      'move the pin to the new range here rather than deleting the check');
    const [, rel, spans] = citation.match(/\[C ([\w./-]+):([\d,\-]+)\]/);
    const lines = read(rel).split('\n');
    const text = spans.split(',')
      .map((span) => { const [lo, hi] = span.split('-').map(Number); return lines.slice(lo - 1, hi || lo).join('\n'); })
      .join('\n');
    if (!text.includes(needle)) drifted.push(docRel + ': ' + citation + ' no longer covers `' + needle + '`');
  }
  }
  assert.deepEqual(drifted, [],
    'the cited lines moved - retarget the citation in the doc named and update its pin');
});

test('no line-numbered citation in the doc is left unpinned', () => {
  // Without this, a new citation could be added stale and never checked.
  for (const [docRel, docText, pins, scope] of DOCS) {
    const unpinned = [...new Set([...docText.matchAll(scope)].map((m) => m[0]))]
      .filter((c) => !(c in pins));
    assert.deepEqual(unpinned, [],
      docRel + ': add each of these to its pin table with the evidence it is meant to show');
  }
});
