'use strict';
// CLI smoke tests. No live network: the transport endpoint points at a closed
// loopback port, which is exactly the section 10.1 "silent offline" path, so
// every posting command exercises the offline queue instead of the wire.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const invite = require('../lib/invite');
const stateLib = require('../lib/state');

const CLI = path.join(__dirname, '..', 'bin', 'handshake.js');
const DEAD_ENDPOINT = 'http://127.0.0.1:9';     // discard port: always refused

let n = 0;
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-cli-' + (n++) + '-'));
  const project = path.join(root, 'project');
  fs.mkdirSync(project, { recursive: true });
  return { root, project, data: path.join(root, 'data') };
}

function run(box, args, opts) {
  const o = opts || {};
  const r = spawnSync(process.execPath, [CLI].concat(args), {
    cwd: o.cwd || box.project,
    input: o.stdin === undefined ? '' : o.stdin,
    encoding: 'utf8',
    timeout: 30000,
    env: Object.assign({}, process.env, {
      CLAUDE_PLUGIN_DATA: box.data,
      HANDSHAKE_SESSION_ID: o.session || 'test-session',
      CLAUDE_CODE_CHILD_SESSION: o.child || '',
    }),
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function initNtfy(box, name) {
  return run(box, ['init', '--ntfy', DEAD_ENDPOINT, '--name', name || 'demo']);
}

function inviteBlob(box) {
  const r = run(box, ['invite', '--inline']);
  const blob = r.out.trim().split('\n').pop().trim();
  assert.match(blob, /^hsi1_/, 'invite must print a blob, got: ' + r.out + r.err);
  return blob;
}

// ------------------------------------------------------------------ basics --

test('help lists every implemented subcommand', () => {
  const box = sandbox();
  const r = run(box, ['--help']);
  assert.equal(r.code, 0);
  for (const cmd of ['init', 'invite', 'join', 'claim', 'change', 'release', 'done', 'note',
    'warn', 'presence', 'post', 'sync', 'cursor', 'status', 'rotate', 'leave',
    'mute', 'unmute', 'rest', 'upgrade', 'doctor']) {
    assert.ok(new RegExp('^\\s+' + cmd + '\\b', 'm').test(r.out), 'usage must document `' + cmd + '`');
  }
  assert.match(r.out, /Credentials are read from stdin, never from argv/);
});

test('an unknown subcommand exits 2 with the usage block', () => {
  const box = sandbox();
  const r = run(box, ['frobnicate']);
  assert.equal(r.code, 2);
  assert.match(r.err, /unknown command/);
});

test('doctor outside a workspace is a three-valued self-check, not an error', () => {
  const box = sandbox();
  const r = run(box, ['doctor', '--json']);
  assert.equal(r.code, 0);
  const report = JSON.parse(r.out);
  assert.ok(Array.isArray(report.checks));
  assert.ok(['pass', 'warn', 'fail'].includes(report.verdict));
  for (const c of report.checks) assert.ok(['pass', 'warn', 'fail'].includes(c.verdict), c.check);
  const names = report.checks.map((c) => c.check);
  assert.ok(names.includes('node'));
  assert.ok(names.includes('state dir writable'));
  assert.ok(names.includes('child-mode detection'));
  assert.ok(names.includes('workspace'));
});

test('doctor reports child-mode detection honestly', () => {
  const box = sandbox();
  const asChild = JSON.parse(run(box, ['doctor', '--json'], { child: '1' }).out);
  const detection = asChild.checks.find((c) => c.check === 'child-mode detection');
  assert.match(detection.detail, /^CHILD - child_env_var/);
});

// ------------------------------------------------------------ init/invite ---

test('init mints an ntfy workspace locally and never prints the secret', () => {
  const box = sandbox();
  const r = initNtfy(box, 'acme');
  assert.equal(r.code, 0, r.err);
  const id = /id:\s+([0-9a-f]{32})/.exec(r.out);
  assert.ok(id, 'init must print a 32-hex workspace id: ' + r.out);
  assert.match(r.out, /zero-setup: claims are advisory; no durable layer/);
  assert.match(r.out, /self-declared-but-HMAC-signed/);

  const cfg = JSON.parse(fs.readFileSync(path.join(box.data, id[1], 'state.json'), 'utf8'));
  assert.equal(cfg.transport, 'ntfy');
  assert.match(cfg.topic, /^[0-9a-f]{32}$/);
  assert.ok(cfg.secret && cfg.secret.length >= 43);
  assert.equal(r.out.includes(cfg.secret), false, 'the workspace secret must not be printed by init');
  assert.equal(r.out.includes(cfg.topic), false, 'the topic is secret material and must not be printed by init');
});

test('invite emits a decodable hsi1_ blob and warns that it is a credential', () => {
  const box = sandbox();
  initNtfy(box);
  const r = run(box, ['invite', '--inline']);
  assert.equal(r.code, 0, r.err);
  const blob = r.out.trim();
  const fields = invite.decode(blob);
  assert.equal(fields.t, 'ntfy');
  assert.equal(fields.loc, 'inline');
  assert.match(fields.topic, /^[0-9a-f]{32}$/);
  // The warning goes to stderr so `handshake invite > file` still yields a
  // clean blob, but the human still sees it.
  assert.match(r.err, /CREDENTIAL/);
});

test('invite --repo omits the secret, the topic and the token', () => {
  const box = sandbox();
  initNtfy(box);
  const fields = invite.decode(run(box, ['invite', '--repo']).out.trim());
  assert.equal(fields.loc, 'repo');
  assert.equal(fields.s, undefined);
  assert.equal(fields.topic, undefined);
  assert.equal(fields.tok, undefined);
});

// -------------------------------------------------------------------- join --

test('9.1: join prints transport, endpoint host and name, and refuses without a typed yes', () => {
  const box = sandbox();
  initNtfy(box, 'acme app');
  const blob = inviteBlob(box);
  const other = sandbox();

  const declined = run(other, ['join', blob, '--as', 'tester'], { stdin: 'n\n' });
  assert.equal(declined.code, 0);
  assert.match(declined.out, /transport:\s+ntfy/);
  assert.match(declined.out, /endpoint host:\s+127\.0\.0\.1:9/);
  assert.match(declined.out, /workspace:\s+acme app/);
  assert.match(declined.out, /self-declared, HMAC-signed - NOT server-verified/);
  assert.match(declined.out, /not joined/);

  // Empty input (a pipe with nothing in it) is also a refusal - the default is No.
  const silent = run(other, ['join', blob, '--as', 'tester'], { stdin: '' });
  assert.match(silent.out, /not joined/);

  // --yes must not be a substitute for typing it.
  const forced = run(other, ['join', blob, '--as', 'tester', '--yes'], { stdin: 'n\n' });
  assert.match(forced.err, /--yes is not accepted for join/);
  assert.match(forced.out, /not joined/);
});

test('join with an explicit yes stores membership and queues ws.join while offline', () => {
  const box = sandbox();
  initNtfy(box, 'acme app');
  const blob = inviteBlob(box);
  const peer = sandbox();

  const joined = run(peer, ['join', blob, '--as', 'tester'], { stdin: 'y\n' });
  assert.equal(joined.code, 0, joined.err);
  assert.match(joined.out, /joined acme app as tester/);
  assert.match(joined.out, /announcement queued - transport offline/);

  const status = JSON.parse(run(peer, ['status', '--json']).out);
  assert.equal(status.workspace.member_name, 'tester');
  assert.equal(status.transport.tier, 'zero-setup (ntfy)');
  assert.equal(status.transport.capabilities.authenticated_from, false);
  assert.equal(status.transport.capabilities.server_claims, false);
  assert.equal(status.transport.capabilities.encrypts_body, true);
  assert.ok(status.queue.pending >= 1, 'ws.join and state.request should be queued');
});

test('join refuses a tampered invite before printing anything about the workspace', () => {
  const box = sandbox();
  initNtfy(box);
  const blob = inviteBlob(box);
  const broken = blob.slice(0, blob.length - 4) + 'AAAA';
  const peer = sandbox();
  const r = run(peer, ['join', broken, '--as', 'tester'], { stdin: 'y\n' });
  assert.equal(r.code, 2);
  assert.match(r.err, /invalid invite/);
  assert.equal(r.out.includes('Join request'), false);
});

// -------------------------------------------------------- claims and notes --

function joinedSandbox(name) {
  const box = sandbox();
  initNtfy(box, name || 'acme app');
  const blob = inviteBlob(box);
  run(box, ['join', blob, '--as', 'tester'], { stdin: 'y\n' });
  return box;
}

test('claim normalizes the subject, records it locally, and labels it advisory', () => {
  const box = joinedSandbox();
  const r = run(box, ['claim', 'Fix the API issue', '--ttl', '300', '--files', 'src/a.js,src/b.js']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /claimed "fix api issue" ttl=300s/);
  assert.match(r.out, /\[advisory\]/);

  const status = JSON.parse(run(box, ['status', '--json']).out);
  assert.equal(status.own_claims, 1);

  // release drops it again
  run(box, ['release', 'fix API issue', '--reason', 'done']);
  assert.equal(JSON.parse(run(box, ['status', '--json']).out).own_claims, 0);
});

test('claim refuses an out-of-range ttl and an empty subject key', () => {
  const box = joinedSandbox();
  assert.equal(run(box, ['claim', 'x', '--ttl', '99999']).code, 2);
  assert.equal(run(box, ['claim', '!!!']).code, 2);
});

test('note/warn/presence sugar reaches the same gated post path', () => {
  const box = joinedSandbox();
  assert.match(run(box, ['note', 'discovery', 'the API returns 202 not 200']).out, /queued note\.discovery|posted note\.discovery/);
  assert.equal(run(box, ['note', 'nonsense', 'text']).code, 2);

  // 5.2: below the 50% floor nothing is emitted.
  const low = run(box, ['warn', 'overlap', '--subject', 'fix api issue', '--peer', 'bob', '--peer-subject', 'fix api response shape']);
  assert.match(low.err, /below the 50% floor/);

  const high = run(box, ['warn', 'overlap', '--subject', 'onboarding flow', '--peer', 'bob', '--peer-subject', 'onboarding flow copy']);
  assert.match(high.out, /queued warn\.overlap|posted warn\.overlap/);

  assert.match(run(box, ['presence', 'working', '--note', 'on the onboarding flow']).out, /presence: working/);
  assert.equal(run(box, ['presence', 'idle']).code, 2, 'there is no idle state (PROTOCOL 4.2)');
});

test('the secret filter blocks an outbound note and the CLI says so once', () => {
  const box = joinedSandbox();
  const r = run(box, ['note', 'info', 'the key is AKIAIOSFODNN7EXAMPLE']);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /blocked by the secret filter/);
});

// ------------------------------------------------------------- child mode ---

test('7.2 rule 1: a child session refuses every posting subcommand', () => {
  const box = joinedSandbox();
  for (const args of [['claim', 'x'], ['release', 'x'], ['done', 'x'], ['post', 'note.info', '--text', 'hi'],
    ['presence', 'working'], ['change', 'x', '--change', 'scope'], ['leave'], ['rest'], ['upgrade']]) {
    const r = run(box, args, { child: '1' });
    assert.equal(r.code, 3, args[0] + ' must refuse in a child session');
    assert.match(r.err, /child session/);
  }
  // Reading is still allowed.
  assert.equal(run(box, ['status', '--json'], { child: '1' }).code, 0);
});

// -------------------------------------------------- sync / cursor / status --

test('6.3: sync advances nothing; --inject-digest is what moves the watermark', () => {
  const box = joinedSandbox();
  const before = JSON.parse(run(box, ['cursor']).out);
  assert.equal(before.consumed_watermark, null);
  assert.equal(before.cursor_kind, 'message_id+unix_ts');
  assert.match(before.note, /reading never moves the watermark/);

  // The transport is unreachable, so sync shows the cached view rather than
  // claiming nothing happened.
  const s = run(box, ['sync']);
  assert.equal(s.code, 0);
  assert.match(s.out, /transport unreachable - showing the last cached view/);

  const after = JSON.parse(run(box, ['cursor']).out);
  assert.deepEqual(after.consumed_watermark, before.consumed_watermark);
});

test('10.2: status states the tier and its guarantees, never the aspirational ones', () => {
  const box = joinedSandbox();
  const r = run(box, ['status']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /attribution:\s+self-declared, HMAC-signed - NOT server-verified/);
  assert.match(r.out, /claims:\s+unauthenticated-advisory/);
  assert.match(r.out, /zero-setup: claims are advisory; no durable layer/);
  assert.match(r.out, /claims above are advisory/);
  assert.match(r.out, /monitors unavailable, heartbeating on turn boundaries/);
  assert.match(r.out, /credentials: present/);
});

// ------------------------------------------------------ mute / rest / etc ---

test('mute is local only and says so; unmute is its inverse', () => {
  const box = joinedSandbox();
  const on = run(box, ['mute']);
  assert.match(on.out, /MUTED \(local only - outbound posting is unaffected/);
  assert.equal(JSON.parse(run(box, ['status', '--json']).out).local_switches.muted, true);
  run(box, ['unmute']);
  assert.equal(JSON.parse(run(box, ['status', '--json']).out).local_switches.muted, false);
  assert.equal(run(box, ['mute', 'sideways']).code, 2);
});

test('rest stops broadcasting, writes the disarm sentinel, and keeps claims on TTL', () => {
  const box = joinedSandbox();
  run(box, ['claim', 'onboarding flow']);
  const r = run(box, ['rest', '--summary', 'stopping for the day']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /resting: broadcasting stopped for this session/);
  assert.match(r.out, /1 claim\(s\) left to expire on TTL rather than released/);
  assert.match(r.out, /listening and injection are unaffected/);

  const wsId = JSON.parse(run(box, ['status', '--json']).out).workspace.ws;
  assert.equal(fs.existsSync(path.join(box.data, wsId, 'monitor.disarm')), true);
  const status = JSON.parse(run(box, ['status', '--json']).out);
  assert.equal(status.own_claims, 1, 'rest must not release claims');
  assert.equal(status.credentials.posting_stopped.code, 'rest');
});

test('upgrade without --relay prints the manual deploy pointer instead of guessing', () => {
  const box = joinedSandbox();
  const r = run(box, ['upgrade']);
  assert.equal(r.code, 0);
  assert.match(r.out, /wrangler deploy/);
  assert.match(r.out, /handshake upgrade --relay/);
});

test('rotate refuses on the zero-setup tier and explains the ntfy offboarding path', () => {
  const box = joinedSandbox();
  const r = run(box, ['rotate']);
  assert.equal(r.code, 2);
  assert.match(r.err, /applies to the team relay only/);
  assert.match(r.err, /NEW topic/);
});

test('leave writes the parting note into local state as well as the transport', () => {
  const box = joinedSandbox();
  const r = run(box, ['leave', '--reason', 'signoff', '--summary', 'wrapped up the onboarding flow']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /signed off \(signoff\)/);
  const wsId = JSON.parse(run(box, ['status', '--json']).out).workspace.ws;
  const cfg = JSON.parse(fs.readFileSync(path.join(box.data, wsId, 'state.json'), 'utf8'));
  assert.equal(cfg.last_leave.reason, 'signoff');
  assert.equal(cfg.last_leave.summary, 'wrapped up the onboarding flow');
  assert.equal(run(box, ['leave', '--reason', 'nope']).code, 2);
});

test('every command outside a workspace exits 2 with a pointer, never a stack trace', () => {
  const box = sandbox();
  for (const args of [['status'], ['sync'], ['claim', 'x'], ['invite'], ['cursor'], ['leave']]) {
    const r = run(box, args);
    assert.equal(r.code, 2, args[0]);
    assert.match(r.err, /not in a handshake workspace/);
    assert.equal(/\bat Object\./.test(r.err), false, 'no stack traces');
  }
});

test('the state directory is the one CLAUDE_PLUGIN_DATA points at', () => {
  const box = sandbox();
  initNtfy(box);
  assert.equal(stateLib.stateRoot({ CLAUDE_PLUGIN_DATA: box.data }), path.resolve(box.data));
  assert.equal(fs.existsSync(path.join(box.data, 'workspaces.json')), true);
});
