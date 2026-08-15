'use strict';
// claude-handshake M12(a) - LEG 2: the zero-setup transport.
//
// e2e/mock-ntfy.js reproduces the ntfy publish/poll surface lib/transport-ntfy.js
// actually calls, so what is under test here is OUR adapter: the encrypted wire
// form (PROTOCOL 9.3), the cursor ladder and its beyond-the-cache-window
// truncation-honesty rule (PROTOCOL 6.4), claim resurrection, advisory
// semantics (PROTOCOL 5.5), and the deterministic tiebreak (PROTOCOL 5.4) in
// the one place it genuinely has to run client-side.

const fs = require('fs');
const path = require('path');

const H = require('./lib/harness');
const { Member } = require('./lib/members');
const scan = require('./lib/secret-scan');
const subjectLib = require('../lib/subject');
const envelopeLib = require('../lib/envelope');

const A_NAME = 'alice-e2e';
const B_NAME = 'bob-e2e';
const CLAIM_A = 'feature X';
const CLAIM_A_KEY = 'feature x';
const NEIGHBOUR = 'feature X copy';
const SHARED = 'onboarding flow';
const SHARED_KEY = 'onboarding flow';

const NTFY_WIRE_KEYS = ['alg', 'ct', 'enc', 'sender_seq', 'sig', 'ts', 'v', 'ws'];

function jsonOf(stdout) {
  const s = String(stdout || '').trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (_) { return null; }
}

// hooks/render.js measures CHARS, not bytes ("·" and "—" are one char, two bytes).
function charLen(s) { return Array.from(String(s)).length; }

function parseInit(stdout) {
  return { ws: (stdout.match(/^\s*id:\s+([0-9a-f]{32})\s*$/m) || [])[1] || null };
}

function carryRepoLayer(from, to) {
  const src = path.join(from.repoDir, '.handshake');
  const dst = path.join(to.repoDir, '.handshake');
  fs.mkdirSync(dst, { recursive: true });
  for (const f of ['workspace.json', '.gitignore']) {
    const s = path.join(src, f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(dst, f));
  }
}

function setOverlapGate(member, value) {
  const file = path.join(member.repoDir, '.handshake', 'workspace.json');
  const doc = H.readJson(file, null);
  if (!doc) return false;
  doc.public = doc.public || {};
  if (value === null) delete doc.public.overlap_gate;
  else doc.public.overlap_gate = value;
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  return true;
}

// Decode the mock's store the way a legitimate receiver would: with the
// workspace secret, through lib/envelope.js. Anything that will not decode
// stays as ciphertext, which is itself a result worth asserting.
function decodeStore(mock, ws, secretB64) {
  const keys = envelopeLib.deriveKeys(secretB64, ws);
  return mock.messages.map((row) => {
    let wire = null;
    let env = null;
    try { wire = JSON.parse(row.message); } catch (_) { wire = null; }
    if (wire) { try { env = envelopeLib.decryptFromNtfy(wire, keys.kEnc); } catch (_) { env = null; } }
    return { row, wire, envelope: env };
  });
}

async function run(h, ctx) {
  h.section('LEG 2 — zero-setup (mock ntfy, real lib/transport-ntfy.js)');

  h.deviation('PLAN section 6 says "A\'s Claude surfaces it at its next turn boundary WITHIN the same ' +
    'session". A turn boundary is simulated as SessionStart(sync) + UserPromptSubmit(inject) fed ' +
    'synthetic payloads; no model runs, so "surfaces" is asserted as "the standing block written to ' +
    'the hook\'s stdout contains the item exactly once", which is the mechanical part of that claim.');
  h.deviation('The brief expected "UserPromptSubmit as proven child -> no injection". The hook ' +
    'deliberately DOES render the block for a child and advances nothing (hooks/user-prompt-submit.js ' +
    'advance(): "a child renders the block ... and advances nothing"). PROTOCOL 7.2 freezes four rules ' +
    'and none forbids reading, so the harness asserts what 7.2 actually freezes: no watermark advance, ' +
    'nothing consumed from the digest, zero network.');
  h.deviation('PROTOCOL 6.4\'s beyond-the-cache-window tier needs a 12 h-old cursor, which a 3-minute ' +
    'run cannot produce by waiting. e2e/lib/members.js forceWatermark() writes the watermark a member ' +
    'would legitimately hold after being offline that long. The adapter, the mock\'s cache window and ' +
    'the CLI\'s reporting are all real; only the clock is fixtured (step L2.9).');
  h.deviation('SECURITY.md section 4 exempts protocol machinery (ws, nonce, sig, ct, machine/session ' +
    'pseudonyms) from the filter by design. The scan therefore runs filter.check() over the AUTHORED ' +
    'surface as lib/envelope.js authoredFields() defines it, plus a raw substring/12-char-window search ' +
    'for the planted .env values across the whole stored record including ciphertext. Scanning raw ' +
    'envelope JSON with the filter would fail on `ws` alone (32 random hex = high-entropy-hex) on every ' +
    'message ever sent.');
  h.deviation('PLAN section 6\'s "day-long ntfy publish budget" and "late joiner on zero-setup sees ' +
    'resurrected claims over a real 12 h cache" are M12(b) measurements. This leg proves the ' +
    'resurrection MECHANISM (step L2.2) and the truncation-honesty rule against a mock cache window; ' +
    'it makes no claim about ntfy.sh\'s real, operator-controlled limits.');

  const root = ctx.root;
  const mock = ctx.mock;
  const A = new Member({ label: 'A', name: A_NAME, root, sessionId: 'e2e-ntfy-A' }).init();
  const B = new Member({ label: 'B', name: B_NAME, root, sessionId: 'e2e-ntfy-B' }).init();
  let inviteBlob = null;

  // =========================================================== step 1 =====
  await h.step('L2.1a', 'A: init the zero-setup workspace and state the advisory tier honestly', async (s) => {
    const r = await A.cli(['init', '--ntfy', mock.baseUrl, '--name', 'hs']);
    s.eq(r.code, 0, 'init exit code');
    s.has(r.stdout, 'transport: ntfy', 'transport is ntfy');
    s.has(r.stdout, 'zero-setup: claims are advisory; no durable layer',
      'the verbatim advisory line is printed (PROTOCOL 9.3)');
    s.has(r.stdout, 'self-declared-but-HMAC-signed', '`from` is not claimed to be server-verified (PROTOCOL 9.3)');
    const p = parseInit(r.stdout);
    s.match(p.ws, /^[0-9a-f]{32}$/, 'ws id minted locally (no server exists)');
    A.ws = p.ws; B.ws = p.ws; ctx.ntfyWs = p.ws;

    const st = A.state();
    s.match(st.topic, /^[0-9a-f]{32}$/, 'the topic is 32 hex = >= 128-bit CSPRNG (PROTOCOL 9.3)');
    s.assert(!String(st.topic).includes('hs'), 'the topic is NEVER derived from the workspace name');
    ctx.topic = st.topic;
    ctx.secret = st.secret;
  });

  await h.step('L2.1b', 'A and B join; the invite blob is a credential and confirm is typed', async (s) => {
    const inv = await A.cli(['invite', '--inline', '--json']);
    const j = jsonOf(inv.stdout) || {};
    s.match(j.invite, /^hsi1_[A-Za-z0-9_-]+$/, 'invite blob shape');
    s.eq(j.describe && j.describe.transport, 'ntfy', 'blob names the ntfy transport');
    inviteBlob = j.invite;

    const a = await A.cli(['join', inviteBlob, '--as', A_NAME], { stdin: 'y\n' });
    s.eq(a.code, 0, 'A joined');
    A.memberId = A.state().member;
    s.eq(A.memberId, A_NAME, 'on ntfy the member id IS the self-assigned name (PROTOCOL 1)');

    carryRepoLayer(A, B);
    const no = await B.cli(['join', inviteBlob, '--as', B_NAME], { stdin: 'n\n' });
    s.has(no.stdout, 'not joined', 'a bare N refuses');
    s.has(no.stdout, 'self-declared', 'the join screen states attribution honestly before the yes');

    const yes = await B.cli(['join', inviteBlob, '--as', B_NAME], { stdin: 'y\n' });
    s.eq(yes.code, 0, 'B joined');
    B.memberId = B.state().member;
    s.eq(B.memberId, B_NAME, 'B member id');
  });

  // =========================================================== step 2 =====
  await h.step('L2.2', 'A claims "feature X"; resurrection puts it in B\'s cache; the block says advisory', async (s) => {
    const c = await A.cli(['claim', CLAIM_A, '--files', 'src/api.js']);
    s.eq(c.code, 0, 'claim exit code');
    s.has(c.stdout, '[advisory]', 'the CLI labels an ntfy claim advisory (PROTOCOL 5.5)');
    const p = await A.cli(['presence', 'working', '--note', 'on feature X']);
    s.has(p.stdout, 'with 1 claim(s)', 'the heartbeat carries the FULL active claim set (PROTOCOL 9.3)');
    await B.cli(['presence', 'working', '--note', 'reading']);

    const ss = await B.sessionStart({ source: 'startup' });
    s.eq(ss.code, 0, 'B SessionStart exit 0');
    const claim = (B.peers().claims || []).find((x) => x.subject_key === CLAIM_A_KEY);
    s.assert(Boolean(claim), 'B resurrected A\'s claim from the presence topic',
      { expected: CLAIM_A_KEY, actual: JSON.stringify((B.peers().claims || []).map((x) => x.subject_key)) });
    s.eq(claim && claim.advisory, true, 'the advisory flag is carried, never dropped');
    s.deepEq(claim && claim.files, ['src/api.js'],
      'files[] were harvested from the task.claim envelope (resurrection carries no files)');

    // Observation, not an assertion: what actually landed in the digest cache.
    const types = (B.digest().items || []).map((i) => i.type);
    s.note('B\'s digest after SessionStart: ' + JSON.stringify(types));
    if (types.includes('state.request')) {
      h.finding('state.request burns an inject slot with zero information. Every ntfy joiner posts ' +
        'state.request (PROTOCOL 9.3), whose body is `{want:[...]}` - pure machinery with no text. ' +
        'hooks/sync.js writeDigest() caches it like any other message and hooks/render.js renders it as ' +
        '`[request · <peer>] (no text)`, spending one of the five inject slots per joiner. Observed in ' +
        'a two-member workspace: 2 of 5 slots on the first injected turn went to `(no text)` lines. ' +
        'PROTOCOL 6.2 budgets those five slots tightly, and a body-less machinery type consuming one is ' +
        'pure loss. FIX: skip types with no renderable body in hooks/sync.js writeDigest(), the same ' +
        'place that already drops items with no `type`. REPRO: `npm run test:e2e -- --leg ntfy`, ' +
        'step L2.2 note.');
    }

    const ups = await B.userPromptSubmit();
    s.has(ups.stdout, 'tier:zero-setup', 'the block states the tier');
    s.has(ups.stdout, CLAIM_A, 'the claim line names the subject');
    s.has(ups.stdout, 'advisory', 'and marks it advisory (PROTOCOL 5.5, never dropped under truncation)');
  });

  // =========================================================== step 3 =====
  await h.step('L2.3', 'PreToolUse gate: warn by default, deny under overlap_gate:"block"', async (s) => {
    const warn = await B.preToolUse(B.repoFile('src/api.js'));
    const hs1 = (jsonOf(warn.stdout) || {}).hookSpecificOutput || {};
    s.assert(typeof hs1.additionalContext === 'string', 'warn emits additionalContext',
      { expected: 'string', actual: JSON.stringify(hs1) });
    s.has(hs1.additionalContext || '', ', advisory)', 'the gate line says the claim is advisory here');

    setOverlapGate(B, 'block');
    const deny = await B.preToolUse(B.repoFile('src/api.js'));
    const hs2 = (jsonOf(deny.stdout) || {}).hookSpecificOutput || {};
    s.eq(hs2.permissionDecision, 'deny', 'block mode denies');
    s.eq(deny.code, 0, 'and still exits 0');
    setOverlapGate(B, null);

    const miss = await B.preToolUse(B.repoFile('src/other.js'));
    s.eq(miss.stdout.trim(), '', 'unclaimed paths stay silent');
  });

  // =========================================================== step 4 =====
  await h.step('L2.4a', 'B posts note.discovery; A surfaces it exactly once', async (s) => {
    s.assert(await A.drain(), 'A starts the turn drained (setup backlog consumed)');
    const NOTE = 'ntfy leg: api returns data+meta now';
    const post = await B.cli(['note', 'discovery', NOTE, '--paths', 'src/api.js']);
    s.eq(post.code, 0, 'note posted');

    const before = A.watermark('ntfy');
    await A.sessionStart({ source: 'startup' });
    s.assert((A.digest().items || []).some((i) => i.type === 'note.discovery'), 'digest cached the discovery');
    s.deepEq(A.watermark('ntfy'), before, 'fetching did not move the watermark');

    const first = await A.userPromptSubmit();
    s.has(first.stdout, 'data+meta', 'injected once');
    const wm = A.watermark('ntfy');
    s.assert(wm && typeof wm.message_id === 'string', 'the ntfy watermark is {message_id, unix_ts} (PROTOCOL 6.4)',
      { expected: '{message_id,unix_ts}', actual: JSON.stringify(wm) });

    const second = await A.userPromptSubmit();
    s.hasnt(second.stdout, 'data+meta', 'not repeated on the next turn');
  });

  await h.step('L2.4b', 'fetch 20 / inject <=5 with >5 pending, client-side fair selection', async (s) => {
    s.assert(await A.drain(), 'A starts drained');
    for (let i = 1; i <= 6; i++) await B.cli(['note', 'info', 'z' + i]);
    await A.sessionStart({ source: 'startup' });
    s.eq((A.digest().items || []).length, 6, 'fetch cap 20 brought back all 6 (PROTOCOL 6.1)');

    const first = await A.userPromptSubmit();
    const shown = Number((first.stdout.match(/^new (\d+):/m) || [])[1]);
    const carried = (A.digest().items || []).length;
    s.note('plan chose digestCap=' + shown + ', block=' + charLen(first.stdout.trim()) + ' chars');
    s.assert(shown >= 1 && shown <= 5, 'inject cap 5 is respected (PROTOCOL 6.2)', { expected: '1..5', actual: String(shown) });
    s.assert(charLen(first.stdout.trim()) <= 600, 'and the ~600-char standing-block budget is respected',
      { expected: '<= 600', actual: String(charLen(first.stdout.trim())) });
    s.eq(shown + carried, 6, 'fetched == injected + carried: nothing was dropped');
    s.has(first.stdout, 'more — /handshake status', 'the overflow marker is present, verbatim');

    let seen = new Set(first.stdout.match(/z[1-6]\b/g) || []);
    let turns = 1;
    while ((A.digest().items || []).length && turns < 6) {
      const nxt = await A.userPromptSubmit();
      for (const t of nxt.stdout.match(/z[1-6]\b/g) || []) {
        s.assert(!seen.has(t), t + ' was injected exactly once across turns');
        seen.add(t);
      }
      turns++;
    }
    s.eq(seen.size, 6, 'all six were eventually injected, each exactly once');
  });

  // =========================================================== step 5 =====
  await h.step('L2.5', 'warn.overlap on the wire: jaccard 67, shape per PROTOCOL 3.2', async (s) => {
    await B.cli(['claim', NEIGHBOUR, '--files', 'src/other.js']);
    const w = await B.cli(['warn', 'overlap', '--subject', NEIGHBOUR, '--peer', A.memberId, '--peer-subject', CLAIM_A]);
    s.has(w.stdout, 'posted warn.overlap', 'emitted');

    const sync = jsonOf((await A.cli(['sync', '--json'])).stdout) || {};
    const warn = (sync.messages || []).map((m) => m.envelope).find((e) => e && e.type === 'warn.overlap');
    s.assert(Boolean(warn), 'A received the warn.overlap envelope');
    const b = (warn && warn.body) || {};
    s.eq(b.subject_key, 'feature x copy', 'body.subject_key');
    s.eq(b.peer_subject_key, CLAIM_A_KEY, 'body.peer_subject_key');
    s.eq(b.peer_member, A.memberId, 'body.peer_member');
    s.eq(b.jaccard, 67, 'body.jaccard = round(100*J)');
    s.assert(b.jaccard >= 50, 'and is >= the 50 floor');
    s.eq(warn.from.member, B.memberId, 'from.member is the self-declared sender');
  });

  // =========================================================== step 6 =====
  await h.step('L2.6', 'double-claim with distinct acquired_at: deterministic PROTOCOL 5.4 resolution', async (s) => {
    const a = await A.cli(['claim', SHARED]);
    s.eq(a.code, 0, 'A claimed the shared subject');
    await H.sleep(30);                       // guarantee distinct acquired_at
    const b = await B.cli(['claim', SHARED]);
    s.eq(b.code, 0, 'B also "claimed" it - no server arbitrates on ntfy (PROTOCOL 5.5)');

    const aClaim = (A.state().own_claims || []).find((c) => c.subject_key === SHARED_KEY);
    const bClaim = (B.state().own_claims || []).find((c) => c.subject_key === SHARED_KEY);
    s.assert(aClaim && bClaim, 'both members hold a local claim on the same subject_key');
    s.assert(Number(aClaim.acquired_at) < Number(bClaim.acquired_at), 'acquired_at values are distinct and ordered',
      { expected: 'A < B', actual: aClaim.acquired_at + ' vs ' + bClaim.acquired_at });

    const mine = { acquired_at: Number(bClaim.acquired_at), member: B.memberId };
    const theirs = { acquired_at: Number(aClaim.acquired_at), member: A.memberId };
    s.eq(subjectLib.losesTiebreak(mine, theirs), true, 'B loses: earliest acquired_at wins (PROTOCOL 5.4 rule 1)');
    s.eq(subjectLib.losesTiebreak(theirs, mine), false, 'A wins, evaluated identically by both sides');
    // Rule 2 is only reachable on an exact tie; assert it directly so the
    // byte-wise member-id comparison is covered rather than assumed.
    s.eq(subjectLib.losesTiebreak({ acquired_at: 5, member: 'zzz' }, { acquired_at: 5, member: 'aaa' }), true,
      'on an exact tie the lexicographically smallest member id wins (rule 2)');

    // Both sides can SEE the conflict: A's heartbeat resurrects its claim into
    // B's cache under the same subject_key B holds locally.
    await A.cli(['presence', 'working']);
    await B.sessionStart({ source: 'startup' });
    const peerHeld = (B.peers().claims || []).find((c) => c.subject_key === SHARED_KEY && c.member === A.memberId);
    s.assert(Boolean(peerHeld), 'B\'s cache shows A holding the same subject_key - the conflict is detectable',
      { expected: 'A holding ' + SHARED_KEY, actual: JSON.stringify((B.peers().claims || []).map((c) => c.member + ':' + c.subject_key)) });
    // The conflict was NOT knowable at claim time (B's cache was empty when it
    // claimed) - that case is covered by cmdClaim's knowable-conflict refusal,
    // asserted separately. The concurrent case resolves at sync time: the
    // standing block MUST now carry the deterministic 5.4 verdict as a local
    // notice so the model runs the loser sequence.
    const upsConflict = await B.userPromptSubmit();
    s.has(upsConflict.stdout, 'claim conflict', 'the standing block surfaces the sync-time conflict');
    s.assert(/lose the tiebreak \(5\.4\)/.test(upsConflict.stdout),
      'and states B loses, deterministically (5.4 rule 1)',
      { expected: 'lose the tiebreak (5.4)', actual: upsConflict.stdout.split('\n').filter((l) => /conflict/.test(l)).join(' | ') });

    // The loser's mandated sequence, in order (PROTOCOL 5.4).
    const change = await B.cli(['change', SHARED, '--change', 'tiebreak_loss', '--note', 'lost the tiebreak on acquired_at']);
    s.eq(change.code, 0, 'task.change posted');
    s.eq(change.stdout.trim().split('\n').length, 1, 'and reported to its own user in ONE line');
    const release = await B.cli(['release', SHARED, '--reason', 'tiebreak_loss']);
    s.eq(release.code, 0, 'task.release posted');
    s.eq(release.stdout.trim().split('\n').length, 1, 'also one line');
    s.assert(!(B.state().own_claims || []).some((c) => c.subject_key === SHARED_KEY), 'B stopped holding the subject');

    const decoded = decodeStore(mock, ctx.ntfyWs, ctx.secret).filter((d) => d.envelope);
    const changeIdx = decoded.findIndex((d) => d.envelope.type === 'task.change'
      && d.envelope.body.subject_key === SHARED_KEY && d.envelope.body.change === 'tiebreak_loss');
    const releaseIdx = decoded.findIndex((d) => d.envelope.type === 'task.release'
      && d.envelope.body.subject_key === SHARED_KEY && d.envelope.body.reason === 'tiebreak_loss');
    s.assert(changeIdx >= 0, 'task.change{change:"tiebreak_loss"} is on the wire', { expected: 'present', actual: String(changeIdx) });
    s.assert(releaseIdx >= 0, 'task.release{reason:"tiebreak_loss"} is on the wire', { expected: 'present', actual: String(releaseIdx) });
    s.assert(changeIdx >= 0 && releaseIdx > changeIdx, 'change strictly PRECEDES release, as 5.4 orders them',
      { expected: 'change before release', actual: 'change@' + changeIdx + ' release@' + releaseIdx });
  });

  // =========================================================== step 7 =====
  await h.step('L2.7', 'A: done -> task.done + task.release; SessionEnd -> ws.leave envelope', async (s) => {
    const d = await A.cli(['done', CLAIM_A, '--summary', 'feature X shipped', '--files', 'src/api.js']);
    s.eq(d.code, 0, 'done exit code');
    s.has(A.shardText(), 'done', 'the durable shard records it even on the zero-setup tier');

    const se = await A.sessionEnd({ reason: 'exit' });
    s.eq(se.code, 0, 'SessionEnd exit 0');
    s.has(A.shardText(), 'parting', 'the parting note is in the durable layer too (PROTOCOL 3.2)');

    const decoded = decodeStore(mock, ctx.ntfyWs, ctx.secret).filter((x) => x.envelope);
    const done = decoded.find((x) => x.envelope.type === 'task.done' && x.envelope.body.subject_key === CLAIM_A_KEY);
    const rel = decoded.find((x) => x.envelope.type === 'task.release' && x.envelope.body.subject_key === CLAIM_A_KEY);
    const leave = decoded.find((x) => x.envelope.type === 'ws.leave' && x.envelope.from.member === A.memberId);
    s.assert(Boolean(done), 'task.done is on the wire');
    s.eq(done && done.envelope.body.summary, 'feature X shipped', 'with the summary');
    s.assert(Boolean(rel), 'the matching task.release is on the wire (PROTOCOL 3.1 ntfy carriage)');
    s.eq(rel && rel.envelope.body.reason, 'done', 'release reason is done');
    s.assert(Boolean(leave), 'ws.leave is on the wire');
    s.eq(leave && leave.envelope.body.reason, 'session_end', 'ws.leave.reason = session_end');
  });

  // =========================================================== step 8 =====
  await h.step('L2.8a', 'child PostToolUse: ZERO HTTP requests to the transport (PROTOCOL 7.2 rules 1+2)', async (s) => {
    const before = mock.requestCount();
    const r = await A.postToolUse(A.repoFile('src/other.js'), { env: A.childEnv('parent-session-NTFY') });
    s.eq(r.code, 0, 'exit 0');
    s.eq(r.stdout, '', 'nothing printed');
    s.eq(mock.requestCount(), before, 'the mock saw NO request at all - a child performs no network I/O',
      { expected: String(before), actual: String(mock.requestCount()) });
    const touches = (A.state().child_touches || {})['parent-session-NTFY'];
    s.assert((touches && touches.files || []).includes('src/other.js'),
      'the touched file landed in the PARENT-keyed local state (rule 3)',
      { expected: 'src/other.js', actual: JSON.stringify(touches) });
  });

  await h.step('L2.8b', 'child UserPromptSubmit: no watermark advance, nothing consumed', async (s) => {
    s.assert(await A.drain(), 'A starts drained, so the one item under test is the one injected');
    await B.cli(['note', 'info', 'ntfy-child-window']);
    await A.sessionStart({ source: 'startup' });
    const wm = JSON.stringify(A.watermark('ntfy'));
    const pending = (A.digest().items || []).length;
    s.assert(pending > 0, 'a digest is pending', { expected: '> 0', actual: String(pending) });

    const before = mock.requestCount();
    const asChild = await A.userPromptSubmit({ env: A.childEnv('parent-session-NTFY') });
    s.eq(JSON.stringify(A.watermark('ntfy')), wm, 'watermark unchanged');
    s.eq((A.digest().items || []).length, pending, 'digest unchanged - the child consumed nothing');
    s.eq(mock.requestCount(), before, 'and UserPromptSubmit made zero network calls at all (PROTOCOL 8)');
    s.has(asChild.stdout, '<handshake ws:', 'the child still receives the block + trust framing (documented, hooks/user-prompt-submit.js)');

    const asParent = await A.userPromptSubmit();
    s.has(asParent.stdout, 'ntfy-child-window', 'the parent still gets the item');
  });

  // =========================================================== step 6.4 ===
  await h.step('L2.9', 'beyond the cache window the read is reported TRUNCATED, never as empty (PROTOCOL 6.4)', async (s) => {
    // A real message, re-stored as if it had been published 13 h ago: past both
    // the adapter's 11 h message_id tier and the 12 h cache window.
    const eventRows = mock.storedFor(ctx.topic);
    s.assert(eventRows.length > 0, 'there is real traffic on the event topic to age');
    const aged = mock.seed(ctx.topic, eventRows[0].message, 13 * 3600 * 1000);
    const polled = mock.poll(ctx.topic, 'all', Date.now()).rows.map((r) => r.id);
    s.assert(!polled.includes(aged.id), 'the mock genuinely evicts a message older than its cache window',
      { expected: 'evicted', actual: 'still returned' });

    // The state a member legitimately holds after half a day offline.
    B.forceWatermark('ntfy', { message_id: aged.id, unix_ts: Math.floor((Date.now() - 13 * 3600 * 1000) / 1000) });
    const jsonRes = jsonOf((await B.cli(['sync', '--json'])).stdout) || {};
    s.eq(jsonRes.truncated, true, 'sync --json reports truncated:true');

    B.forceWatermark('ntfy', { message_id: aged.id, unix_ts: Math.floor((Date.now() - 13 * 3600 * 1000) / 1000) });
    const human = await B.cli(['sync']);
    s.match(human.stdout, /read was truncated|READ WAS TRUNCATED/,
      'and the human-facing sync says so in words (PROTOCOL 10.2: never report a truncated read as an empty one)');
    s.has(human.stdout, 'durable layer', 'and points at the durable layer for what is gone');
    s.has(human.stdout, 'claims shown are advisory', 'advisory framing survives (PROTOCOL 5.5)');
  });

  // =========================================================== step 10 ====
  await h.step('L2.10', 'encryption honesty: the wire exposes ONLY {v,ws,ts,sender_seq,alg,enc,sig,ct}', async (s) => {
    const rows = mock.messages;
    s.assert(rows.length >= 12, 'there is real traffic to inspect', { expected: '>= 12', actual: String(rows.length) });

    let badShape = null;
    let notEncrypted = 0;
    for (const row of rows) {
      let wire;
      try { wire = JSON.parse(row.message); } catch (_) { badShape = badShape || { id: row.id, reason: 'not JSON' }; continue; }
      const keys = Object.keys(wire).sort();
      if (keys.join(',') !== NTFY_WIRE_KEYS.join(',')) {
        badShape = badShape || { id: row.id, keys: keys.join(',') };
      }
      if (wire.enc !== 'A256GCM' || typeof wire.ct !== 'string' || !wire.ct.length) notEncrypted++;
    }
    s.assert(!badShape, 'every stored body has exactly the eight cleartext keys',
      { expected: NTFY_WIRE_KEYS.join(','), actual: JSON.stringify(badShape) });
    s.eq(notEncrypted, 0, 'every body carries enc:A256GCM and a non-empty ct');

    // A passive subscriber holding the topic but not the secret learns nothing
    // (PLAN section 6 security assertion).
    const haystack = rows.map((r) => r.message).join('\n');
    const forbidden = [CLAIM_A, CLAIM_A_KEY, NEIGHBOUR, SHARED, 'src/api.js', 'src/other.js',
      A_NAME, B_NAME, 'task.claim', 'note.discovery', 'presence.update', 'feature X shipped'];
    const leaked = forbidden.filter((needle) => haystack.includes(needle));
    s.deepEq(leaked, [], 'no subject, file path, member name or event type appears in cleartext',
      { expected: '[]', actual: JSON.stringify(leaked) });

    // ...and the same content IS recoverable with the secret, so the assertion
    // above is about encryption and not about the strings simply being absent.
    const decoded = decodeStore(mock, ctx.ntfyWs, ctx.secret).filter((d) => d.envelope);
    s.assert(decoded.length >= 10, 'the harness could decrypt the traffic with the workspace secret',
      { expected: '>= 10', actual: String(decoded.length) });
    s.assert(decoded.some((d) => d.envelope.type === 'task.claim' && d.envelope.body.subject === CLAIM_A),
      'the plaintext subject really is in there, under the key');
    ctx.ntfyDecoded = decoded;
  });

  // =========================================================== step 9 =====
  await h.step('L2.11a', 'a note carrying a local .env secret is refused CLIENT-SIDE (SECURITY.md 4)', async (s) => {
    const before = mock.requestCount((r) => r.method === 'POST');
    const r = await B.cli(['note', 'info', 'psst: ' + B.tripwire],
      { envExtra: { HANDSHAKE_SESSION_ID: B.sessionId + '-tripwire' } });
    s.has(r.stderr, 'blocked by the secret filter', 'refused before the transport');
    s.has(r.stderr, 'local-secret-tripwire', 'the tripwire is the finding that fired');
    s.eq(mock.requestCount((r2) => r2.method === 'POST'), before, 'and no publish was attempted');
  });

  await h.step('L2.11b', 'SECRET-SCAN GATE: every stored mock-ntfy message', async (s) => {
    const decoded = decodeStore(mock, ctx.ntfyWs, ctx.secret);
    const records = decoded.map((d) => ({
      origin: 'ntfy ' + d.row.topic.slice(0, 8) + '/' + d.row.id,
      handle: d.row.id, envelope: d.envelope, raw: d.row.message,
    }));
    const result = scan.scan(records, {
      secretFiles: [path.join(A.repoDir, '.env'), path.join(B.repoDir, '.env')],
      planted: [A.tripwire, B.tripwire],
    });
    s.assert(result.ok, 'ZERO secret-scan findings across the zero-setup transport',
      { expected: '0 findings', actual: JSON.stringify(result.findings).slice(0, 500) });
    s.assert(result.authoredChecked > 0, 'authored fields were actually inspected',
      { expected: '> 0', actual: String(result.authoredChecked) });
    s.note(result.records + ' messages, ' + result.authoredChecked + ' authored fields scanned');
    ctx.ntfyScanned = result;
  });

  await h.step('L2.12', 'status honesty on the zero-setup tier (PROTOCOL 10.2)', async (s) => {
    const st = jsonOf((await A.cli(['status', '--json'])).stdout) || {};
    s.eq(st.transport.tier, 'zero-setup (ntfy)', 'tier is stated');
    s.has(st.transport.attribution, 'NOT server-verified', 'attribution is never overstated');
    s.has(st.transport.claims, 'unauthenticated-advisory', 'claims are never presented as authoritative');
    s.eq(st.transport.capabilities.authenticated_from, false, 'capabilities().authenticated_from is false');
    s.eq(st.transport.capabilities.server_claims, false, 'capabilities().server_claims is false');
    s.eq(st.transport.capabilities.encrypts_body, true, 'capabilities().encrypts_body is true');
    s.eq(st.transport.capabilities.cursor_kind, 'message_id+unix_ts', 'cursor kind per PROTOCOL 6.4');
    const human = await A.cli(['status']);
    s.has(human.stdout, 'zero-setup: claims are advisory; no durable layer', 'the verbatim advisory line');
  });

  ctx.ntfyA = A;
  ctx.ntfyB = B;
}

module.exports = { run };
