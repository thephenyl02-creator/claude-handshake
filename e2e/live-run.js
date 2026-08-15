'use strict';
// M12(b) live leg: the flagship scenario against a REAL deployed relay over
// the real network. Two independent simulated members (separate state dirs,
// separate git working copies) join via a REAL invite and coordinate.
//
//   HANDSHAKE_LIVE_INVITE=hsi1_... node e2e/live-run.js
//
// The invite comes from the environment on purpose: it is a credential and
// must never be committed. This script asserts behavior AND measures real
// round-trip latency. It does not purge the workspace at the end (the
// workspace under test is disposable by agreement).

const fs = require('fs');
const os = require('os');
const path = require('path');

const H = require('./lib/harness');
const { Member } = require('./lib/members');
const filter = require('../lib/filter');

const INVITE = process.env.HANDSHAKE_LIVE_INVITE;
if (!INVITE || !INVITE.startsWith('hsi1_')) {
  console.error('set HANDSHAKE_LIVE_INVITE to the live invite blob (hsi1_...)');
  process.exit(2);
}

let pass = 0, fail = 0;
const times = [];
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  [' + detail + ']' : '')); }
}
async function timed(label, fn) {
  const t0 = Date.now();
  const r = await fn();
  const ms = Date.now() - t0;
  times.push({ label, ms });
  console.log('  (' + ms + ' ms) ' + label);
  return r;
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-live-'));
  // Member names are permanently unique per workspace (retired forever on
  // removal, held while live) - a rerun must not collide with the last run.
  const run = Math.random().toString(36).slice(2, 7);
  const A = new Member({ root, label: 'A', name: 'alice-' + run }).init();
  const B = new Member({ root, label: 'B', name: 'bob-' + run }).init();
  A.commitAll('base'); B.commitAll('base');

  console.log('== live leg: joining the deployed relay ==');
  const ja = await timed('A joins via the real invite', () =>
    A.cli(['join', INVITE, '--as', A.name], { stdin: 'y\n' }));
  ok(ja.code === 0, 'A join exit 0', ja.stderr.slice(0, 200));
  const jb = await timed('B joins via the real invite', () =>
    B.cli(['join', INVITE, '--as', B.name], { stdin: 'y\n' }));
  ok(jb.code === 0, 'B join exit 0', jb.stderr.slice(0, 200));
  // the Member helpers key state dirs by workspace id — take it from the
  // invite itself, the one shape guaranteed by PROTOCOL 9.1
  const wsId = (() => {
    try {
      const json = Buffer.from(INVITE.slice('hsi1_'.length), 'base64url').toString('utf8');
      return JSON.parse(json).ws;
    } catch (_) { return null; }
  })();
  A.ws = wsId; B.ws = wsId;
  ok(Boolean(wsId), 'workspace id resolved: ' + wsId);

  console.log('== claim / see / gate ==');
  const c1 = await timed('A claims "feature X"', () =>
    A.cli(['claim', 'feature X', '--files', 'src/api.js']));
  ok(c1.code === 0, 'A claim accepted', c1.stderr.slice(0, 200));

  await timed('B syncs (SessionStart)', () => B.sessionStart());
  const bClaims = (B.peers().claims || []).map((c) => c.subject_key);
  ok(bClaims.includes('feature x'), 'B sees A\'s claim over the real relay', JSON.stringify(bClaims));

  const ups = await B.userPromptSubmit();
  ok(/feature x/i.test(ups.stdout), 'B\'s standing block renders the claim');
  ok(/alice/.test(ups.stdout) || /—/.test(ups.stdout), 'with an owner attribution');

  const gate = await B.preToolUse(B.repoFile('src/api.js'));
  ok(/claim|feature x/i.test(gate.stdout), 'PreToolUse gate warns B before touching A\'s claimed file');

  console.log('== discovery note, exactly-once ==');
  // The workspace carries backlog (this and prior runs' ws.join/leave traffic)
  // and the inject cap is 5 with carry-forward — drain first, exactly as the
  // Member driver documents, so the ONE new item's landing turn is observable.
  await timed('A drains its backlog', () => A.drain());
  const note = await timed('B posts note.discovery', () =>
    B.cli(['note', 'discovery', 'response shape of /signup is changing to 202', '--subject', 'feature X']));
  ok(note.code === 0, 'note accepted', note.stderr.slice(0, 200));

  await timed('A syncs', () => A.sessionStart());
  const aUps1 = await A.userPromptSubmit();
  ok(/202|response shape/.test(aUps1.stdout), 'A\'s next turn surfaces the discovery');
  const aUps2 = await A.userPromptSubmit();
  ok(!/202|response shape/.test(aUps2.stdout), 'and it is injected exactly once (watermark)');

  console.log('== conflict: one winner, named ==');
  const c2 = await timed('B tries to claim the same subject', () =>
    B.cli(['claim', 'feature x']));
  ok(c2.code !== 0, 'B\'s duplicate claim is refused');
  ok(/held by/.test(c2.stdout), 'the holder is named', c2.stdout.slice(0, 160));
  ok(!/undefined/.test(c2.stdout), 'and is not "undefined"');
  ok(/tiebreak/.test(c2.stdout), 'with the 5.4 tiebreak verdict');

  console.log('== done, release, parting ==');
  const done = await timed('A marks the work done', () =>
    A.cli(['done', 'feature X', '--summary', 'shipped feature X']));
  ok(done.code === 0, 'done accepted', done.stderr.slice(0, 200));
  await timed('B syncs again', () => B.sessionStart());
  const bClaims2 = (B.peers().claims || []).map((c) => c.subject_key);
  ok(!bClaims2.includes('feature x'), 'the claim is released for B', JSON.stringify(bClaims2));

  const bye = await A.sessionEnd();
  ok(bye.code === 0, 'A\'s SessionEnd parting note exits clean');

  console.log('== secret-scan gate over the REAL stream ==');
  // a fresh member starts at cursor 0 and reads the whole retained stream
  const C = new Member({ root, label: 'C', name: 'carol-' + run }).init();
  C.commitAll('base');
  const jc = await C.cli(['join', INVITE, '--as', C.name], { stdin: 'y\n' });
  ok(jc.code === 0, 'scanner member joins');
  C.ws = wsId;
  const sync = await C.cli(['sync', '--json']);
  let findings = 0, scanned = 0, sawTripwire = 0;
  try {
    const body = JSON.parse(sync.stdout);
    for (const m of body.messages || []) {
      const env = m.envelope || {};
      const b = env.body || {};
      for (const v of [b.text, b.subject, b.summary, b.note, b.branch].filter(Boolean)) {
        scanned++;
        if (!filter.check(String(v)).ok) findings++;
        if (String(v).includes(A.tripwire) || String(v).includes(B.tripwire)) sawTripwire++;
      }
    }
  } catch (e) { ok(false, 'sync --json parse', String(e.message)); }
  ok(findings === 0, 'zero secret-filter findings across ' + scanned + ' authored fields on the live relay');
  ok(sawTripwire === 0, 'no planted .env value ever reached the relay');

  console.log('\n== summary ==');
  console.log('  checks: ' + (pass + fail) + '  (' + pass + ' pass, ' + fail + ' fail)');
  const net = times.filter((t) => /join|claim|sync|note|done/.test(t.label)).map((t) => t.ms).sort((a, b) => a - b);
  if (net.length) {
    console.log('  real network round-trips: min ' + net[0] + ' ms · median ' +
      net[Math.floor(net.length / 2)] + ' ms · max ' + net[net.length - 1] + ' ms over ' + net.length + ' ops');
  }
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('live-run crashed:', e); process.exit(1); });
