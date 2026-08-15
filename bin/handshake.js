#!/usr/bin/env node
'use strict';
// claude-handshake M5: the core CLI.
//
//   handshake init | invite | join | claim | release | done | post | sync
//            | cursor | status | rotate | leave | doctor
//
// Normative behaviour lives in docs/PROTOCOL.md; the sections are cited at each
// site. Three rules bind every path in this file:
//
//  1. Every outbound field goes through sendGate (lib/outbound.js) - which
//     happens because every envelope is built by lib/envelope.js build(), and
//     the two relay server-state endpoints gate their own bodies.
//  2. Credentials are read from stdin, NEVER from argv: argv lands in shell
//     history, `ps` output and CI logs (SECURITY.md section 3).
//  3. Paths are composed with path.join over os.homedir(); no literal "~"
//     string ever reaches the filesystem (Windows).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const envelope = require('../lib/envelope');
const subject = require('../lib/subject');
const stateLib = require('../lib/state');
const sessionLib = require('../lib/session');
const inviteLib = require('../lib/invite');
const relay = require('../lib/transport-relay');
const ntfy = require('../lib/transport-ntfy');
const T = require('../lib/transport');
const { FilterViolation } = require('../lib/outbound');

const CLIENT = 'claude-handshake/0.0.1';
const INJECT_CAP = 5;                 // PROTOCOL section 6.2

// ------------------------------------------------------------------ argv ----

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out._.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) { out.flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out.flags[key] = next; i++; }
      else out.flags[key] = true;
    } else out._.push(a);
  }
  return out;
}

function out(line) { process.stdout.write(String(line) + '\n'); }
function err(line) { process.stderr.write(String(line) + '\n'); }
function json(value) { process.stdout.write(JSON.stringify(value, null, 2) + '\n'); }

// ---------------------------------------------------------------- prompts --

// Credentials NEVER come from argv. Echo is suppressed on a TTY; on a pipe the
// value is read as one line so CI and tests can drive it.
function ask(promptText, opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      let buf = '';
      process.stdin.setEncoding('utf8');
      const onData = (chunk) => {
        buf += chunk;
        const nl = buf.indexOf('\n');
        if (nl >= 0) {
          process.stdin.off('data', onData);
          process.stdin.pause();
          resolve(buf.slice(0, nl).replace(/\r$/, ''));
        }
      };
      process.stderr.write(promptText);
      process.stdin.on('data', onData);
      process.stdin.on('end', () => resolve(buf.replace(/\r?\n$/, '')));
      process.stdin.resume();
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    if (o.silent) {
      rl._writeToOutput = function (s) {
        if (s.includes(promptText)) rl.output.write(promptText);
      };
    }
    rl.question(promptText, (answer) => { rl.close(); if (o.silent) process.stderr.write('\n'); resolve(answer); });
  });
}

// section 9.1: join MUST require explicit human confirmation. Default is NO.
async function confirm(promptText) {
  const answer = (await ask(promptText + ' [y/N] ')).trim().toLowerCase();
  return answer === 'y' || answer === 'yes';
}

// --------------------------------------------------------------- workspace --

function sessionId() {
  const e = process.env;
  const raw = e.HANDSHAKE_SESSION_ID || e.CLAUDE_SESSION_ID || e.CLAUDE_CODE_SESSION_ID || 'cli';
  return stateLib.State.sessionId(raw);
}

// Resolve which workspace this directory belongs to. Preference order:
//   1. --ws on the command line
//   2. .handshake/workspace.json walking up from cwd (the M8 repo layer, read
//      through lib/session.js so only the PUBLIC half is ever touched here)
//   3. the local project index written by `init`/`join`
function resolveWs(args) {
  if (typeof args.flags.ws === 'string') return { ws: args.flags.ws, source: 'flag' };
  const resolved = sessionLib.resolveWorkspace(process.cwd(), { noCache: true });
  if (resolved && resolved.public && resolved.public.ws) {
    return { ws: resolved.public.ws, source: 'repo', workspace: resolved };
  }
  const linked = stateLib.lookupProject(process.cwd());
  if (linked) return { ws: linked.ws, source: 'local_index', project: linked.dir };
  return null;
}

function requireWs(args) {
  const found = resolveWs(args);
  if (!found) {
    err('not in a handshake workspace. Run `handshake init` here, or `handshake join <hsi1_...>`.');
    process.exitCode = 2;
    return null;
  }
  return found;
}

// Everything the commands need: state, keys, identity, adapter.
function openWorkspace(wsId, args) {
  const state = stateLib.openState(wsId);
  const cfg = state.read();
  if (!cfg.secret) throw new Error('workspace ' + wsId + ' has no local secret; run init or join');
  const keys = envelope.deriveKeys(cfg.secret, wsId);
  const flags = state.session(sessionId());
  const dedupe = state.dedupe();
  const filterOpts = { projectDir: (args && args.projectDir) || process.cwd() };

  const identity = {
    member: cfg.member, machine: state.machineId(), session: sessionId(),
  };

  let adapter = null;
  if (cfg.transport === 'relay') {
    adapter = relay.createRelayTransport({
      origin: cfg.endpoint, ws: wsId, token: cfg.member_token, member: cfg.member,
      kSig: keys.kSig, dedupe, sessionFlags: flags, filterOpts,
      durableLayer: Boolean(cfg.durable_layer),
    });
  } else if (cfg.transport === 'ntfy') {
    adapter = ntfy.createNtfyTransport({
      baseUrl: cfg.endpoint, topic: cfg.topic, ws: wsId,
      kSig: keys.kSig, kEnc: keys.kEnc, member: cfg.member,
      dedupe, sessionFlags: flags, filterOpts,
      durableLayer: Boolean(cfg.durable_layer), ops: cfg.ops_today || 0,
    });
  }

  const queue = state.queue({
    transport: cfg.transport, endpoint: cfg.endpoint, topic: cfg.topic || '',
    token: cfg.member_token || '', keepalive_seconds: adapter ? adapter.capabilities().keepalive_seconds : 600,
  });

  return { ws: wsId, state, cfg, keys, flags, dedupe, adapter, queue, identity, filterOpts };
}

function buildEnvelope(wsCtx, type, body) {
  return envelope.build({
    ws: wsCtx.ws,
    from: { member: wsCtx.identity.member, machine: wsCtx.identity.machine, session: wsCtx.identity.session },
    type, body,
    ts: Date.now(),
    sender_seq: wsCtx.state.nextSenderSeq(),
    kSig: wsCtx.keys.kSig,
    filterOpts: wsCtx.filterOpts,
  });
}

// ------------------------------------------------------- failure surfacing --

// section 10.1: transport unreachable -> the client MUST NOT interrupt the
// user. section 10.2: a loud rejection is reported ONCE per session, in one
// line, and posting stops on that transport for the rest of the session.
function reportFailure(wsCtx, e, what) {
  if (e instanceof FilterViolation) {
    if (wsCtx.flags.shouldReport('filter_refusal')) {
      err('handshake: outbound blocked by the secret filter (' + e.findings.map((f) => f.id).join(', ') + '); posting stopped this session');
    }
    wsCtx.flags.stopPosting(wsCtx.cfg.transport, 'filter_refusal');
    wsCtx.flags.count('loud_filter_refusal');
    return 'loud';
  }
  const kind = e && e.kind === 'loud' ? 'loud' : (e && e.kind === 'silent' ? 'silent' : 'loud');
  if (kind === 'silent') {
    wsCtx.flags.count('silent_offline');
    return 'silent';                                   // stay quiet, by design
  }
  const code = (e && e.code) || 'error';
  if (!e || !e.already_reported) {
    if (wsCtx.flags.shouldReport(code)) {
      err('handshake: ' + (what ? what + ' ' : '') + 'refused (' + code + '); posting stopped on ' + wsCtx.cfg.transport + ' for this session');
    }
    wsCtx.flags.stopPosting(wsCtx.cfg.transport, code);
  }
  wsCtx.flags.count('loud_' + code);
  return 'loud';
}

// One send path: drain the queue first, then publish; enqueue on silent
// failure (section 10.1/10.3).
async function send(wsCtx, env, opts) {
  const o = opts || {};
  if (!wsCtx.adapter) { wsCtx.queue.enqueue(env, { filterOpts: wsCtx.filterOpts }); return { queued: true }; }
  const stopped = wsCtx.flags.postingStopped(wsCtx.cfg.transport);
  if (stopped) return { blocked: true, code: stopped.code };
  if (!o.skipDrain) await drainQueue(wsCtx);
  try {
    const res = await wsCtx.adapter.publish(env);
    return { sent: true, handle: res.handle, duplicate: res.duplicate };
  } catch (e) {
    const kind = reportFailure(wsCtx, e, env.type);
    if (kind === 'silent') {
      try { wsCtx.queue.enqueue(env, { filterOpts: wsCtx.filterOpts }); } catch (_) { /* filter refusal at enqueue */ }
      return { queued: true, offline: true };
    }
    return { blocked: true, code: e && e.code };
  }
}

async function drainQueue(wsCtx) {
  if (!wsCtx.adapter) return null;
  if (wsCtx.queue.size() === 0) { wsCtx.queue.reconcileBinding(); return null; }
  const result = await wsCtx.queue.drain((env) => wsCtx.adapter.publish(env), {
    kSig: wsCtx.keys.kSig, filterOpts: wsCtx.filterOpts,
    nextSenderSeq: () => wsCtx.state.nextSenderSeq(),
  });
  if (result.dropped_on_rebind) err('handshake: dropped ' + result.dropped_on_rebind + ' queued messages (transport binding changed)');
  if (result.stopped && result.stopped.kind === 'loud') reportFailure(wsCtx, result.stopped, 'queued message');
  return result;
}

// section 7.2 rule 1: a child MUST NOT post any envelope on any transport.
function refuseIfChild(command) {
  if (process.env[sessionLib.CHILD_ENV_VAR] === '1') {
    err('handshake: ' + command + ' refused - this is a child session (PROTOCOL 7.2 rule 1: children never post).');
    process.exitCode = 3;
    return true;
  }
  return false;
}

// ================================================================== init ====

async function cmdInit(args) {
  const name = typeof args.flags.name === 'string' ? args.flags.name : path.basename(process.cwd());
  const relayOrigin = typeof args.flags.relay === 'string' ? args.flags.relay : null;
  const secret = envelope.newSecret();

  let ws, endpoint, transport, topic = null, enrollmentToken = null, recoveryKey = null;

  if (relayOrigin) {
    transport = 'relay';
    endpoint = relayOrigin.replace(/\/+$/, '');
    // The create token is a deploy secret: stdin only, never argv.
    const createToken = (await ask('relay create token (input hidden): ', { silent: true })).trim();
    if (!createToken) { err('no create token given'); process.exitCode = 2; return; }
    let created;
    try {
      created = await relay.createWorkspace({ origin: endpoint, createToken, name });
    } catch (e) {
      err('handshake: relay refused workspace creation (' + (e && e.code) + ')');
      process.exitCode = 1; return;
    }
    ws = created.ws;
    enrollmentToken = created.enrollment_token;
    recoveryKey = created.recovery_key;
  } else {
    transport = 'ntfy';
    endpoint = typeof args.flags.ntfy === 'string' ? args.flags.ntfy : 'https://ntfy.sh';
    // On ntfy the workspace id is minted locally - there is no server.
    ws = crypto.randomBytes(16).toString('hex');
    topic = ntfy.newTopic();
  }

  const state = stateLib.openState(ws);
  state.ensure();
  state.update((s) => {
    s.ws = ws; s.name = name; s.transport = transport; s.endpoint = endpoint;
    s.protocol = envelope.PROTOCOL_VERSION; s.client = CLIENT;
    s.secret = secret.toString('base64url');
    if (topic) s.topic = topic;
    if (enrollmentToken) s.enrollment_token = enrollmentToken;
    if (recoveryKey) s.recovery_key = recoveryKey;
    s.created_at = Date.now();
    s.project_dir = process.cwd();
    return s;
  });
  stateLib.linkProject(process.cwd(), ws);

  out('workspace created');
  out('  name:      ' + name);
  out('  id:        ' + ws);
  out('  transport: ' + transport);
  out('  endpoint:  ' + endpoint);
  out('  state:     ' + state.dir);
  if (process.platform === 'win32') out('  note:      ' + stateLib.WINDOWS_ACL_NOTE);
  if (transport === 'ntfy') {
    out('');
    out('  ' + ntfy.ADVISORY_LINE);
    out('  attribution here is self-declared-but-HMAC-signed: any holder of the');
    out('  workspace secret can sign as any member (PROTOCOL 9.3).');
  }
  if (enrollmentToken || recoveryKey) {
    out('');
    out('  These are shown ONCE and are never retrievable again:');
    if (enrollmentToken) out('    enrollment token: ' + enrollmentToken);
    if (recoveryKey) out('    recovery key:     ' + recoveryKey + '   (founder only, out of band, never the repo)');
  }
  out('');
  out('Next: `handshake invite` to produce a join blob.');
}

// ================================================================ invite ====

async function cmdInvite(args) {
  const found = requireWs(args); if (!found) return;
  const state = stateLib.openState(found.ws);
  const cfg = state.read();
  const loc = args.flags.inline ? 'inline' : (args.flags.repo ? 'repo' : 'inline');

  const fields = {
    t: cfg.transport, e: cfg.endpoint, ws: found.ws, n: cfg.name || '', loc,
  };
  if (loc === 'inline') {
    fields.s = cfg.secret;
    if (cfg.transport === 'relay') fields.tok = cfg.enrollment_token;
    if (cfg.transport === 'ntfy') fields.topic = cfg.topic;
  }
  let blob;
  try { blob = inviteLib.encode(fields); } catch (e) { err('handshake: ' + e.message); process.exitCode = 1; return; }

  if (args.flags.json) { json({ invite: blob, describe: inviteLib.describe(inviteLib.decode(blob)) }); return; }
  out(blob);
  err('');
  err('This blob is a CREDENTIAL: it carries the workspace secret' +
    (cfg.transport === 'relay' ? ' and the relay enrollment token' : ' and the ntfy topic') + '.');
  err('Send it over a channel you would send a password over. Anyone holding it can');
  err('read and sign workspace traffic (SECURITY.md section 3).');
}

// ================================================================== join ====

async function cmdJoin(args) {
  const blob = args._[0];
  if (!blob) { err('usage: handshake join <hsi1_...>'); process.exitCode = 2; return; }
  let fields;
  try { fields = inviteLib.decode(blob); } catch (e) {
    err('handshake: invalid invite (' + e.code + '): ' + e.message);
    process.exitCode = 2; return;
  }
  const d = inviteLib.describe(fields);

  // section 9.1 MUST: print transport, endpoint host and workspace name, then
  // require explicit human confirmation. Never auto-join.
  out('Join request');
  out('  transport:     ' + d.transport);
  out('  endpoint host: ' + d.endpoint_host);
  out('  workspace:     ' + (d.workspace_name || '(unnamed)'));
  out('  workspace id:  ' + d.ws);
  out('  attribution:   ' + (d.authenticated_from
    ? 'relay-authenticated member id'
    : 'self-declared, HMAC-signed - NOT server-verified (PROTOCOL 9.3)'));
  if (!d.authenticated_from) out('  ' + ntfy.ADVISORY_LINE);
  out('');
  if (args.flags.yes) {
    err('handshake: --yes is not accepted for join; confirmation must be typed (PROTOCOL 9.1).');
  }
  if (!(await confirm('Join this workspace?'))) { out('not joined'); return; }

  const memberName = typeof args.flags.as === 'string'
    ? args.flags.as
    : (await ask('member name (printable ASCII, 1-64 chars): ')).trim();
  if (!/^[\x20-\x7e]{1,64}$/.test(memberName)) {
    err('handshake: member name must be 1-64 printable ASCII chars'); process.exitCode = 2; return;
  }

  const state = stateLib.openState(fields.ws);
  state.ensure();
  let member = memberName;
  let memberToken = null;

  if (fields.t === 'relay') {
    const enrollment = fields.tok || (await ask('enrollment token (input hidden): ', { silent: true })).trim();
    try {
      const joined = await relay.joinWorkspace({
        origin: fields.e, ws: fields.ws, enrollmentToken: enrollment, member: memberName,
      });
      member = joined.member_id || memberName;
      memberToken = joined.token;
    } catch (e) {
      err('handshake: join refused (' + (e && e.code) + ')');
      process.exitCode = 1; return;
    }
  }

  state.update((s) => {
    s.ws = fields.ws; s.name = fields.n; s.transport = fields.t; s.endpoint = fields.e;
    s.protocol = envelope.PROTOCOL_VERSION; s.client = CLIENT;
    if (fields.s) s.secret = fields.s;
    if (fields.topic) s.topic = fields.topic;
    s.member = member; s.member_name = memberName;
    if (memberToken) s.member_token = memberToken;
    s.joined_at = Date.now();
    s.project_dir = process.cwd();
    return s;
  });
  stateLib.linkProject(process.cwd(), fields.ws);

  if (fields.loc === 'repo' && !state.read().secret) {
    err('handshake: this invite says the workspace secret lives in the repo (loc=repo).');
    err('           Nothing was signed yet - the secret must be provisioned before posting.');
  }

  const ctx = openWorkspace(fields.ws, args);
  const joinEnv = buildEnvelope(ctx, 'ws.join', {
    member_name: memberName, protocol: envelope.PROTOCOL_VERSION,
    client: CLIENT, transport: fields.t,
  });
  const res = await send(ctx, joinEnv);

  // section 9.3: a new joiner posts state.request and waits at most one
  // keepalive interval before declaring the roster unknown-but-empty. On the
  // relay state.request MUST NOT be sent - sync already returns full state.
  if (fields.t === 'ntfy' && !res.blocked) {
    const reqEnv = buildEnvelope(ctx, 'state.request', { want: ['claims', 'presence'] });
    await send(ctx, reqEnv, { skipDrain: true });
  }

  out('joined ' + (fields.n || fields.ws) + ' as ' + memberName + (res.queued ? ' (announcement queued - transport offline)' : ''));
}

// ================================================== claim / release / done ==

async function cmdClaim(args) {
  if (refuseIfChild('claim')) return;
  const found = requireWs(args); if (!found) return;
  const raw = args._.join(' ').trim();
  if (!raw) { err('usage: handshake claim "<subject>" [--ttl 7200] [--files a,b]'); process.exitCode = 2; return; }
  let key;
  try { key = subject.subjectKey(raw); } catch (e) { err('handshake: ' + e.message); process.exitCode = 2; return; }
  const ttl = args.flags.ttl ? Number(args.flags.ttl) : 7200;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 86400) { err('handshake: ttl must be 1..86400 seconds'); process.exitCode = 2; return; }
  const files = typeof args.flags.files === 'string' ? args.flags.files.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 64) : undefined;

  const ctx = openWorkspace(found.ws, args);
  const acquiredAt = Date.now();

  if (ctx.cfg.transport === 'relay') {
    // section 3.1: claims are server state on the relay, NOT envelopes.
    try {
      const res = await ctx.adapter.claim({ subject: raw, ttl, files });
      if (res.ok === false && res.conflict) {
        const mine = { acquired_at: acquiredAt, member: ctx.identity.member };
        const theirs = { acquired_at: res.conflict.acquired_at, member: res.conflict.member_id || res.conflict.member };
        const lost = subject.losesTiebreak(mine, theirs);
        out('claim refused: "' + key + '" is held by ' + (res.conflict.name || theirs.member));
        out(lost ? '  you lose the tiebreak (PROTOCOL 5.4) - stop work on this subject'
          : '  you would win the tiebreak on acquired_at; reconcile with the holder');
        process.exitCode = 1;
        return;
      }
      const claim = res.claim || {};
      ctx.state.addOwnClaim({
        subject: raw, subject_key: key, ttl,
        acquired_at: Number(claim.acquired_at) || acquiredAt, files,
      });
      out('claimed "' + key + '"' + (res.renewed ? ' (renewed)' : '') + ' ttl=' + ttl + 's');
    } catch (e) { reportFailure(ctx, e, 'claim'); out('claim not sent (transport unavailable)'); }
    return;
  }

  const env = buildEnvelope(ctx, 'task.claim', {
    subject: raw, subject_key: key, ttl, acquired_at: acquiredAt,
    files: files && files.length ? files : undefined,
  });
  ctx.state.addOwnClaim({ subject: raw, subject_key: key, ttl, acquired_at: acquiredAt, files });
  const res = await send(ctx, env);
  out('claimed "' + key + '" ttl=' + ttl + 's' + (res.queued ? ' (queued - transport offline)' : '') +
    (ctx.adapter && !ctx.adapter.capabilities().server_claims ? ' [advisory]' : ''));
}

async function cmdRelease(args) {
  if (refuseIfChild('release')) return;
  const found = requireWs(args); if (!found) return;
  const raw = args._.join(' ').trim();
  if (!raw) { err('usage: handshake release "<subject>" [--reason done|superseded|tiebreak_loss|manual|expired]'); process.exitCode = 2; return; }
  const key = subject.subjectKey(raw);
  const reason = typeof args.flags.reason === 'string' ? args.flags.reason : 'manual';
  if (!['done', 'superseded', 'tiebreak_loss', 'manual', 'expired'].includes(reason)) {
    err('handshake: reason must be done|superseded|tiebreak_loss|manual|expired'); process.exitCode = 2; return;
  }
  const ctx = openWorkspace(found.ws, args);

  if (ctx.cfg.transport === 'relay') {
    try {
      await ctx.adapter.release({ subject: raw });
      ctx.state.removeOwnClaim(key);
      out('released "' + key + '"');
    } catch (e) { reportFailure(ctx, e, 'release'); out('release not sent (transport unavailable)'); }
    return;
  }
  const env = buildEnvelope(ctx, 'task.release', { subject: raw, subject_key: key, reason });
  ctx.state.removeOwnClaim(key);
  const res = await send(ctx, env);
  out('released "' + key + '"' + (res.queued ? ' (queued)' : ''));
}

async function cmdDone(args) {
  if (refuseIfChild('done')) return;
  const found = requireWs(args); if (!found) return;
  const raw = args._.join(' ').trim();
  if (!raw) { err('usage: handshake done "<subject>" [--summary "..."] [--files a,b]'); process.exitCode = 2; return; }
  const key = subject.subjectKey(raw);
  const summary = typeof args.flags.summary === 'string' ? args.flags.summary.slice(0, 280) : undefined;
  const files = typeof args.flags.files === 'string' ? args.flags.files.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 64) : undefined;
  const ctx = openWorkspace(found.ws, args);

  // section 3.1: on the relay task.done is an envelope PLUS the matching
  // release call that changes server state.
  const env = buildEnvelope(ctx, 'task.done', {
    subject: raw, subject_key: key,
    summary: summary, files: files && files.length ? files : undefined,
  });
  const res = await send(ctx, env);
  if (ctx.cfg.transport === 'relay') {
    try { await ctx.adapter.release({ subject: raw }); } catch (e) { reportFailure(ctx, e, 'release'); }
  } else {
    const rel = buildEnvelope(ctx, 'task.release', { subject: raw, subject_key: key, reason: 'done' });
    await send(ctx, rel, { skipDrain: true });
  }
  ctx.state.removeOwnClaim(key);
  out('done "' + key + '"' + (res.queued ? ' (queued)' : ''));
}

// ================================================================== post ====

async function cmdPost(args) {
  if (refuseIfChild('post')) return;
  const found = requireWs(args); if (!found) return;
  const type = args._[0];
  const allowed = ['note.discovery', 'note.error', 'note.fix', 'note.blocker', 'note.info', 'warn.overlap', 'task.change'];
  if (!allowed.includes(type)) {
    err('usage: handshake post <' + allowed.join('|') + '> --text "..."'); process.exitCode = 2; return;
  }
  const text = typeof args.flags.text === 'string' ? args.flags.text : args._.slice(1).join(' ');
  const ctx = openWorkspace(found.ws, args);
  let body;

  if (type === 'warn.overlap') {
    const peer = args.flags.peer, peerSubject = args.flags['peer-subject'], subj = args.flags.subject;
    if (typeof peer !== 'string' || typeof peerSubject !== 'string' || typeof subj !== 'string') {
      err('usage: handshake post warn.overlap --subject "..." --peer <member> --peer-subject "..."');
      process.exitCode = 2; return;
    }
    const key = subject.subjectKey(subj), peerKey = subject.subjectKey(peerSubject);
    // An explicit --jaccard is accepted (SKILL.md 8) but never trusted past
    // the floor: the computed value governs, because section 5.2 makes the
    // >= 50 check a MUST on the emitter.
    const computed = subject.jaccardPercent(key, peerKey);
    const claimed = args.flags.jaccard !== undefined ? Number(args.flags.jaccard) : computed;
    const pct = Number.isInteger(claimed) && claimed >= 50 && claimed <= 100 ? Math.min(claimed, 100) : computed;
    if (pct < 50) { err('handshake: jaccard is ' + pct + '% - below the 50% floor, no warning emitted (PROTOCOL 5.2)'); return; }
    body = { subject: subj, subject_key: key, peer_member: peer, peer_subject: peerSubject, peer_subject_key: peerKey, jaccard: pct };
  } else if (type === 'task.change') {
    const subj = typeof args.flags.subject === 'string' ? args.flags.subject : null;
    const change = typeof args.flags.change === 'string' ? args.flags.change : 'scope';
    if (!subj || !['files', 'ttl', 'tiebreak_loss', 'scope'].includes(change)) {
      err('usage: handshake post task.change --subject "..." --change files|ttl|tiebreak_loss|scope [--text "..."]');
      process.exitCode = 2; return;
    }
    body = { subject: subj, subject_key: subject.subjectKey(subj), change };
    if (text) body.note = text.slice(0, 280);
  } else {
    if (!text) { err('handshake: --text is required'); process.exitCode = 2; return; }
    body = { text: text.slice(0, 800) };
    if (typeof args.flags.paths === 'string') body.paths = args.flags.paths.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8);
    if (typeof args.flags.subject === 'string') {
      body.subject = args.flags.subject;
      body.subject_key = subject.subjectKey(args.flags.subject);
    }
  }

  let env;
  try { env = buildEnvelope(ctx, type, body); }
  catch (e) { reportFailure(ctx, e, type); process.exitCode = 1; return; }
  const res = await send(ctx, env);
  out(res.sent ? 'posted ' + type : (res.queued ? 'queued ' + type + ' (transport offline)' : 'not posted (' + res.code + ')'));
}

// ================================================================== sync ====

// Bounded, unread-only output. Advances NOTHING (section 6.3: the watermark
// moves at INJECTION time, which is what --inject-digest does).
async function cmdSync(args) {
  const found = requireWs(args); if (!found) return;
  const ctx = openWorkspace(found.ws, args);
  if (!ctx.adapter) { err('handshake: no transport configured'); process.exitCode = 1; return; }
  const transport = ctx.cfg.transport;
  const watermark = ctx.state.getWatermark(transport);
  const limit = args.flags.limit ? Number(args.flags.limit) : T.SYNC_FETCH_CAP;

  let result, presence = null;
  try {
    result = await ctx.adapter.fetch(watermark, limit);
    presence = await ctx.adapter.presence();
  } catch (e) {
    const kind = reportFailure(ctx, e, 'sync');
    if (kind === 'silent') {
      const cached = ctx.state.getPeers();
      if (args.flags.json) { json({ offline: true, cached }); return; }
      out('transport unreachable - showing the last cached view (' +
        (cached.at ? new Date(cached.at).toISOString() : 'never synced') + ')');
      return;
    }
    process.exitCode = 1; return;
  }
  ctx.state.setPeers({
    members: presence.members, presence: presence.presence, claims: presence.claims,
    at: Date.now(), truncated: Boolean(result.truncated || presence.truncated),
    advisory: Boolean(presence.advisory),
  });

  if (args.flags.json) { json({ unread: result.messages.length, more: result.more, truncated: result.truncated, messages: result.messages, presence }); return; }

  const items = result.messages.slice(0, INJECT_CAP);
  if (!items.length) {
    // section 10.2: never report a truncated read as an empty one.
    out(result.truncated ? 'no readable new items - THE READ WAS TRUNCATED: ' + (result.truncation_note || 'older items are gone')
      : 'no new items');
  } else {
    for (const m of items) {
      const e = m.envelope;
      const who = e.from.member + (m.from_name ? ' (' + m.from_name + ')' : '');
      out('- [' + e.type + '] ' + who + ': ' + summarize(e));
    }
    const overflow = result.messages.length - items.length + (Number(result.more) || 0);
    if (overflow > 0) out('+' + overflow + ' more - /handshake status');
  }
  if (result.truncated && items.length) out('note: the read was truncated - ' + (result.truncation_note || 'older items are gone'));
  if (!ctx.adapter.capabilities().server_claims) out('claims shown are advisory (PROTOCOL 5.5)');

  if (args.flags['inject-digest']) {
    // The ONLY place the watermark moves - and the only place the dedupe
    // memory is committed, for the same reason: a message counts as consumed
    // at INJECTION time, not at fetch time (section 6.3). Without this, a
    // second plain `sync` would show nothing and look like silence.
    ctx.dedupe.flush();
    ctx.state.setDigest({ items: items.map((m) => ({ type: m.envelope.type, from: m.envelope.from.member, at: m.envelope.ts })), at: Date.now(), more: result.more });
    const next = result.next_cursor === undefined ? null : result.next_cursor;
    const adv = ctx.state.advanceWatermark(transport, next);
    if (transport === 'relay' && adv.advanced) {
      try { await ctx.adapter.commitCursor(adv.cursor); } catch (e) { reportFailure(ctx, e, 'cursor'); }
    }
    out('digest cached; watermark ' + (adv.advanced ? 'advanced to ' : 'unchanged at ') + JSON.stringify(adv.cursor));
  }
}

function summarize(e) {
  const b = e.body || {};
  if (b.text) return String(b.text).slice(0, 160);
  if (b.summary) return String(b.summary).slice(0, 160);
  if (b.subject) return String(b.subject).slice(0, 160);
  if (b.member_name) return String(b.member_name);
  if (b.reason) return String(b.reason);
  return '(no text)';
}

// ================================================================ cursor ====

async function cmdCursor(args) {
  const found = requireWs(args); if (!found) return;
  const ctx = openWorkspace(found.ws, args);
  const transport = ctx.cfg.transport;
  if (args.flags.commit) {
    const wm = ctx.state.getWatermark(transport);
    if (transport === 'relay') {
      try { const r = await ctx.adapter.commitCursor(wm); out('committed cursor ' + r.cursor); }
      catch (e) { reportFailure(ctx, e, 'cursor'); }
    } else {
      const r = await ctx.adapter.commitCursor(wm);
      out('cursor stored locally ' + JSON.stringify(r.cursor));
    }
    return;
  }
  json({
    transport, cursor_kind: stateLib.cursorKind(transport),
    read_from: ctx.state.getCursor(transport),
    consumed_watermark: ctx.state.getWatermark(transport),
    note: 'reading never moves the watermark; it advances at injection time (PROTOCOL 6.3)',
  });
}

// ================================================================ status ====

// PROTOCOL section 10.2 honesty rules, all four, mechanically derived from
// capabilities() rather than editorially written:
//   - never present an advisory claim as authoritative
//   - never present a self-declared `from` as verified
//   - never report a truncated read as an empty one
//   - state the transport tier and its guarantees, not the aspirational ones
async function cmdStatus(args) {
  const found = requireWs(args); if (!found) return;
  const ctx = openWorkspace(found.ws, args);
  const caps = ctx.adapter ? ctx.adapter.capabilities() : null;
  const peers = ctx.state.getPeers();
  const flags = ctx.flags.raw();
  const stopped = ctx.flags.postingStopped(ctx.cfg.transport);
  const child = sessionLib.detectChildMode({ monitorSentinel: path.join(ctx.state.dir, 'monitor.alive') });
  const monitors = sessionLib.monitorAlive(path.join(ctx.state.dir, 'monitor.alive'));

  const credentialState = ctx.cfg.transport === 'relay'
    ? (ctx.cfg.member_token ? (stopped ? 'rejected (' + stopped.code + ')' : 'present') : 'missing - not joined')
    : (ctx.cfg.topic ? (stopped ? 'rejected (' + stopped.code + ')' : 'present (topic is a bearer credential)') : 'missing');

  const report = {
    workspace: { ws: ctx.ws, name: ctx.cfg.name, member: ctx.cfg.member, member_name: ctx.cfg.member_name },
    transport: {
      tier: ctx.cfg.transport === 'relay' ? 'team relay' : 'zero-setup (ntfy)',
      endpoint: ctx.cfg.endpoint,
      capabilities: caps,
      attribution: caps && caps.authenticated_from
        ? 'relay-authenticated member id (the relay refuses a mismatched from)'
        : 'self-declared, HMAC-signed - NOT server-verified',
      claims: caps && caps.server_claims ? 'server-held, one winner at the source'
        : 'unauthenticated-advisory (PROTOCOL 5.5)',
      body_encryption: caps && caps.encrypts_body ? 'A256GCM over {body, from, nonce, type}' : 'none (relay sees plaintext bodies)',
      durable_layer: caps && caps.durable_layer ? 'present' : 'none',
    },
    credentials: { state: credentialState, posting_stopped: stopped || null },
    session: { id: sessionId(), reported_once: Object.keys(flags.reported || {}), counts: flags.counts || {} },
    peers: {
      cached_at: peers.at || null,
      members: (peers.members || []).length,
      live_claims: (peers.claims || []).length,
      read_truncated: Boolean(peers.truncated),
    },
    queue: { pending: ctx.queue.size() },
    local_switches: {
      muted: Boolean(ctx.cfg.muted),
      resting: Boolean(ctx.cfg.rest && ctx.cfg.rest.session === sessionId()),
    },
    own_claims: ctx.state.getOwnClaims().length,
    child_mode: child,
    monitors: monitors ? 'running' : 'unavailable',
  };

  if (args.flags.json) { json(report); return; }

  out('workspace: ' + (ctx.cfg.name || ctx.ws) + '  [' + ctx.ws + ']');
  out('member:    ' + (ctx.cfg.member_name || '(not joined)') + (ctx.cfg.member ? '  id=' + ctx.cfg.member : ''));
  out('transport: ' + report.transport.tier + '  ' + ctx.cfg.endpoint);
  out('  attribution:   ' + report.transport.attribution);
  out('  claims:        ' + report.transport.claims);
  out('  body encrypt:  ' + report.transport.body_encryption);
  out('  durable layer: ' + report.transport.durable_layer);
  if (caps && !caps.durable_layer && ctx.cfg.transport === 'ntfy') out('  ' + ntfy.ADVISORY_LINE);
  out('credentials: ' + credentialState);
  if (stopped) out('  posting STOPPED this session after ' + stopped.code + ' (PROTOCOL 10.2); reading continues if it works');
  out('peers: ' + report.peers.members + ' member(s), ' + report.peers.live_claims + ' live claim(s)' +
    (peers.at ? ', cached ' + new Date(peers.at).toISOString() : ', never synced'));
  if (peers.truncated) out('  the last read was TRUNCATED - older live chatter is gone; read the durable layer');
  if (!caps || !caps.server_claims) out('  claims above are advisory; they are not proof any peer is or is not editing anything');
  const counts = flags.counts || {};
  const suppressed = Object.entries(counts).filter(([k]) => k.startsWith('loud_') || k === 'silent_offline');
  if (suppressed.length) out('suppressed this session: ' + suppressed.map(([k, v]) => k + '=' + v).join(', '));
  out('queue: ' + ctx.queue.size() + ' pending envelope(s); own claims: ' + report.own_claims);
  if (report.local_switches.muted) out('MUTED (local): peer chatter is not injected. Outbound posting is unaffected.');
  if (report.local_switches.resting) out('RESTING: broadcasting stopped this session; listening continues; claims left to expire on TTL.');
  // section 8: a host without monitors MUST say so.
  if (!monitors) out('monitors unavailable, heartbeating on turn boundaries');
  // Honest framing: section 7.1's safe fallback classifies HOOK-driven
  // sessions. A typed CLI command is an explicit human action, so only a
  // proven child (CLAUDE_CODE_CHILD_SESSION=1) is refused - the fallback is
  // reported, not applied, here.
  out('child-mode detection (applies to hook sessions): ' +
    (child.child ? 'CHILD (' + child.reason + ')' : 'parent (' + child.reason + ')'));
  if (child.child && child.reason !== 'child_env_var') {
    out('  this typed command still ran: only ' + sessionLib.CHILD_ENV_VAR + '=1 blocks posting from the CLI');
  }
}

// ================================================================ rotate ====

async function cmdRotate(args) {
  const found = requireWs(args); if (!found) return;
  const ctx = openWorkspace(found.ws, args);
  if (ctx.cfg.transport !== 'relay') {
    err('handshake: rotate applies to the team relay only. On ntfy, offboarding means a NEW topic and a');
    err('           new workspace secret, then re-inviting everyone (SECURITY.md 7.2).');
    process.exitCode = 2; return;
  }
  const key = (await ask('recovery key (input hidden): ', { silent: true })).trim();
  if (!key) { err('no recovery key given'); process.exitCode = 2; return; }
  const grace = args.flags.grace !== undefined ? Number(args.flags.grace) : undefined;
  if (grace !== undefined && (!Number.isInteger(grace) || grace < 0 || grace > 86400)) {
    err('handshake: --grace must be 0..86400 seconds'); process.exitCode = 2; return;
  }
  try {
    const res = await relay.rotate({ origin: ctx.cfg.endpoint, ws: ctx.ws, recoveryKey: key, graceSeconds: grace });
    ctx.state.update((s) => { s.enrollment_token = res.enrollment_token; return s; });
    out('enrollment token rotated (shown once):');
    out('  ' + res.enrollment_token);
    out('  previous valid until: ' + (res.previous_valid_until ? new Date(res.previous_valid_until).toISOString() : 'immediately invalid'));
    out('  grace: ' + res.grace_seconds + 's');
    out('');
    out('Rotation replaces the ENROLLMENT TOKEN only. Existing member sub-tokens keep');
    out('working and the recovery key is immutable in v1 (PROTOCOL 9.2, [D11]).');
  } catch (e) {
    err('handshake: rotate refused (' + (e && e.code) + ')'); process.exitCode = 1;
  }
}

// ================================================================= leave ====

async function cmdLeave(args) {
  if (refuseIfChild('leave')) return;
  const found = requireWs(args); if (!found) return;
  const ctx = openWorkspace(found.ws, args);
  const reason = typeof args.flags.reason === 'string' ? args.flags.reason : 'signoff';
  if (!['session_end', 'signoff', 'error'].includes(reason)) {
    err('handshake: --reason must be session_end|signoff|error'); process.exitCode = 2; return;
  }
  const summary = typeof args.flags.summary === 'string' ? args.flags.summary.slice(0, 280) : undefined;
  const peers = ctx.state.getPeers();
  const mine = (peers.claims || []).filter((c) => c.member === ctx.cfg.member).map((c) => c.subject_key);

  const body = { reason };
  if (summary) body.summary = summary;
  if (mine.length) body.open_claims = mine;
  const env = buildEnvelope(ctx, 'ws.leave', body);
  const res = await send(ctx, env);
  // The parting note MUST also be written to the local task shard so the
  // record exists in both the live and durable layers (PROTOCOL 3.2). The repo
  // half of that shard is M8's; the local half is written here.
  ctx.state.update((s) => {
    s.last_leave = { reason, summary: summary || null, open_claims: mine, at: Date.now() };
    return s;
  });
  out('signed off (' + reason + ')' + (res.queued ? ' - parting note queued, kept up to 24 h' : ''));
}

// ================================================================ doctor ====

// Three-valued self-check: pass | warn | fail. Nothing here guesses; an
// unknown is reported as unknown.
async function cmdDoctor(args) {
  const checks = [];
  const add = (name, verdict, detail) => checks.push({ check: name, verdict, detail });

  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) add('node', 'pass', process.version + ' (global fetch, hkdfSync, node:test available)');
  else if (major >= 18) add('node', 'warn', process.version + ' - works, but node --test is thin before 20');
  else add('node', 'fail', process.version + ' - global fetch and node --test require Node 18+/20+');

  const found = resolveWs(args);
  if (!found) {
    add('workspace', 'warn', 'not inside a handshake workspace (cwd: ' + process.cwd() + ')');
  } else {
    add('workspace', 'pass', found.ws + ' via ' + found.source);
  }

  const ws = found ? found.ws : 'doctor-probe';
  const state = stateLib.openState(ws);
  const w = state.writable();
  add('state dir writable', w.ok ? 'pass' : 'fail', state.dir + (w.ok ? '' : ' - ' + w.error));
  if (process.platform === 'win32') add('state dir permissions', 'warn', stateLib.WINDOWS_ACL_NOTE);
  else add('state dir permissions', 'pass', 'files written 0600, directory 0700');

  if (found) {
    const cfg = state.read();
    if (cfg.transport === 'relay') {
      try {
        const h = await relay.health({ origin: cfg.endpoint });
        if (h.protocol === envelope.PROTOCOL_VERSION) {
          add('relay /health', 'pass', cfg.endpoint + ' -> ' + (h.service || 'relay') + ' ' + (h.version || '') + ', protocol ' + h.protocol);
        } else {
          add('relay /health', 'fail', 'relay speaks protocol ' + h.protocol + ', this client speaks ' + envelope.PROTOCOL_VERSION);
        }
      } catch (e) {
        add('relay /health', e && e.kind === 'silent' ? 'warn' : 'fail',
          cfg.endpoint + ' - ' + (e && e.code) + (e && e.kind === 'silent' ? ' (offline is a designed state, not an error)' : ''));
      }
    } else if (cfg.transport === 'ntfy') {
      add('transport tier', 'warn', 'zero-setup (ntfy): ' + ntfy.ADVISORY_LINE + '; from is self-declared');
    }
    add('credentials', cfg.transport === 'relay'
      ? (cfg.member_token ? 'pass' : 'warn')
      : (cfg.topic ? 'pass' : 'warn'),
      cfg.transport === 'relay' ? (cfg.member_token ? 'member sub-token present (local only, never the repo)' : 'no member sub-token - run join')
        : (cfg.topic ? 'topic present (bearer credential, same guard as the secret)' : 'no topic - run init'));
    add('offline queue', 'pass', state.queue({ transport: cfg.transport, endpoint: cfg.endpoint, topic: cfg.topic || '', token: cfg.member_token || '' }).size() + ' pending');
  }

  const child = sessionLib.detectChildMode({ monitorSentinel: found ? path.join(state.dir, 'monitor.alive') : null });
  add('child-mode detection', child.child ? 'warn' : 'pass',
    (child.child ? 'CHILD' : 'parent') + ' - ' + child.reason +
    ' (env ' + sessionLib.CHILD_ENV_VAR + '=' + (child.markers.child_env === null ? 'unset' : child.markers.child_env) +
    ', monitor=' + child.markers.monitor + ', source=' + (child.markers.source || 'none') + ')' +
    (child.parent_session ? ', parent session present' : ''));

  if (args.flags.json) { json({ checks, verdict: worst(checks) }); return; }
  for (const c of checks) out(pad(c.verdict.toUpperCase(), 5) + '  ' + pad(c.check, 24) + '  ' + c.detail);
  out('');
  out('overall: ' + worst(checks));
  if (worst(checks) === 'fail') process.exitCode = 1;
}

function pad(s, n) { return String(s) + ' '.repeat(Math.max(0, n - String(s).length)); }
function worst(checks) {
  if (checks.some((c) => c.verdict === 'fail')) return 'fail';
  if (checks.some((c) => c.verdict === 'warn')) return 'warn';
  return 'pass';
}

// ====================================================== sugar over `post` ===

// The forms SKILL.md section 8 teaches. Thin wrappers over the generic post
// path so there is exactly one place envelopes are built and gated.

// note discovery|error|fix|blocker|info "<text>" [--paths a,b] [--subject "..."]
async function cmdNote(args) {
  const kinds = ['discovery', 'error', 'fix', 'blocker', 'info'];
  const kind = args._[0];
  if (!kinds.includes(kind)) {
    err('usage: handshake note ' + kinds.join('|') + ' "<text>" [--paths a,b] [--subject "<claim>"]');
    process.exitCode = 2; return;
  }
  const text = args._.slice(1).join(' ').trim() || (typeof args.flags.text === 'string' ? args.flags.text : '');
  return cmdPost({ _: ['note.' + kind], flags: Object.assign({}, args.flags, { text }) });
}

// warn overlap --subject "..." --peer <member> --peer-subject "..." [--jaccard 50-100]
async function cmdWarn(args) {
  if (args._[0] !== 'overlap') {
    err('usage: handshake warn overlap --subject "..." --peer <member> --peer-subject "..." [--jaccard 50-100]');
    process.exitCode = 2; return;
  }
  return cmdPost({ _: ['warn.overlap'], flags: args.flags });
}

// change "<subject>" --change files|scope|ttl|tiebreak_loss [--files a,b] [--note "..."]
async function cmdChange(args) {
  const subj = args._.join(' ').trim() || (typeof args.flags.subject === 'string' ? args.flags.subject : '');
  const change = typeof args.flags.change === 'string' ? args.flags.change : null;
  if (!subj || !['files', 'ttl', 'tiebreak_loss', 'scope'].includes(change)) {
    err('usage: handshake change "<subject>" --change files|ttl|tiebreak_loss|scope [--files a,b] [--note "..."]');
    process.exitCode = 2; return;
  }
  if (refuseIfChild('change')) return;
  const found = requireWs(args); if (!found) return;
  const ctx = openWorkspace(found.ws, args);
  const key = subject.subjectKey(subj);
  const body = { subject: subj, subject_key: key, change };
  if (typeof args.flags.files === 'string') {
    body.files_added = args.flags.files.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 64);
  }
  if (args.flags.ttl !== undefined) body.ttl = Number(args.flags.ttl);
  if (typeof args.flags.note === 'string') body.note = args.flags.note.slice(0, 280);

  const env = buildEnvelope(ctx, 'task.change', body);
  const res = await send(ctx, env);
  // section 5.3 [D12]: files[] on renewal is a CAPPED UNION, never a replace.
  if (body.files_added && ctx.cfg.transport === 'relay') {
    try { await ctx.adapter.claim({ subject: subj, files: body.files_added }); }
    catch (e) { reportFailure(ctx, e, 'claim'); }
  }
  out('task.change (' + change + ') on "' + key + '"' + (res.queued ? ' (queued)' : ''));
}

// ============================================================== presence ====

// Trim to fit the 2048-byte body cap, oldest-renewed_at first (section 3.2).
function presenceBodyFor(ctx, base, ownClaims) {
  const claims = ownClaims.map((c) => ({
    subject: String(c.subject).slice(0, 120), subject_key: c.subject_key,
    acquired_at: Number(c.acquired_at), ttl: Number(c.ttl),
  })).sort((a, b) => a.acquired_at - b.acquired_at);

  let list = claims.slice();
  let truncated = false;
  for (;;) {
    const body = Object.assign({}, base);
    if (list.length) body.claims = list;
    else if (claims.length) body.claims = [];
    if (truncated) body.claims_truncated = true;
    if (Buffer.byteLength(envelope.canonicalJson(body), 'utf8') <= envelope.MAX_BODY_BYTES || !list.length) return body;
    // Oldest renewed_at first: the entries least likely to still be active.
    list = list.slice(1);
    truncated = true;
  }
}

async function cmdPresence(args) {
  if (refuseIfChild('presence')) return;
  const found = requireWs(args); if (!found) return;
  const stateName = args._[0];
  if (!['working', 'waiting', 'blocked', 'tooling_broken'].includes(stateName)) {
    err('usage: handshake presence working|waiting|blocked|tooling_broken [--note "..."] [--branch <b>] [--agents <n>]');
    process.exitCode = 2; return;
  }
  const ctx = openWorkspace(found.ws, args);
  const base = { state: stateName };
  if (typeof args.flags.note === 'string') base.note = args.flags.note.slice(0, 280);
  if (typeof args.flags.branch === 'string') base.branch = args.flags.branch.slice(0, 200);
  if (args.flags.agents !== undefined) base.agents = Math.max(0, Number(args.flags.agents) || 0);
  if (stateName === 'tooling_broken') {
    const reason = typeof args.flags.reason === 'string' ? args.flags.reason.slice(0, 120) : 'unspecified';
    base.tooling = { reason };
  }

  if (ctx.cfg.transport === 'relay') {
    // section 3.1: presence is server state here - the heartbeat endpoint,
    // NOT an envelope. `claims` MUST be absent on the relay.
    try {
      const res = await ctx.adapter.heartbeat(Object.assign({}, base, {
        machine: ctx.identity.machine, session: ctx.identity.session,
      }));
      out('presence: ' + stateName + (res.claims ? ' (' + res.claims.length + ' claim(s) renewed)' : ''));
    } catch (e) {
      reportFailure(ctx, e, 'heartbeat');
      out('presence not sent (transport unavailable)');
    }
    return;
  }

  // section 9.3: on ntfy every heartbeat carries the FULL active claim set.
  const body = presenceBodyFor(ctx, base, ctx.state.getOwnClaims());
  const env = buildEnvelope(ctx, 'presence.update', body);
  const res = await send(ctx, env);
  out('presence: ' + stateName + ' with ' + ((body.claims || []).length) + ' claim(s)' +
    (body.claims_truncated ? ' (claim list truncated to fit the body cap)' : '') +
    (res.queued ? ' (queued)' : ''));
}

// ======================================================= mute / unmute ======

// PURELY LOCAL (SECURITY.md 5.4): /handshake mute is local state. It stops
// injection and listening; it changes nothing about what this member sends,
// and peers cannot observe it.
async function cmdMute(args) {
  const found = requireWs(args); if (!found) return;
  const state = stateLib.openState(found.ws);
  const arg = String(args._[0] || 'on').toLowerCase();
  if (!['on', 'off'].includes(arg)) { err('usage: handshake mute [on|off]'); process.exitCode = 2; return; }
  const muted = arg === 'on';
  state.update((s) => { s.muted = muted; s.muted_at = Date.now(); return s; });
  out('injection ' + (muted ? 'MUTED' : 'unmuted') + ' (local only - outbound posting is unaffected, and peers cannot see this)');
}

async function cmdUnmute(args) {
  return cmdMute({ _: ['off'], flags: args.flags });
}

// ================================================================== rest ====

// Distinct from mute: rest stops BROADCASTING for this session. Listening and
// injection are untouched. The parting note goes out, the heartbeat is
// disarmed through the sentinel file - the only mid-session disarm the monitor
// contract allows (PROTOCOL section 8, [S5]) - and claims are deliberately
// left to expire on their TTL rather than released, because a silent release
// is a lie about ownership.
async function cmdRest(args) {
  if (refuseIfChild('rest')) return;
  const found = requireWs(args); if (!found) return;
  const ctx = openWorkspace(found.ws, args);
  const summary = typeof args.flags.summary === 'string' ? args.flags.summary.slice(0, 280) : undefined;
  const mine = ctx.state.getOwnClaims().map((c) => c.subject_key);

  const body = { reason: 'signoff' };
  if (summary) body.summary = summary;
  if (mine.length) body.open_claims = mine;
  let res = { queued: false };
  try {
    const env = buildEnvelope(ctx, 'ws.leave', body);
    res = await send(ctx, env);
  } catch (e) { reportFailure(ctx, e, 'ws.leave'); }

  // Sentinel-file disarm: the monitor polls for this and stops heartbeating.
  const sentinel = path.join(ctx.state.dir, 'monitor.disarm');
  try { fs.writeFileSync(sentinel, JSON.stringify({ session: sessionId(), at: Date.now() }) + '\n', { mode: 0o600 }); }
  catch (e) { err('handshake: could not write the disarm sentinel (' + e.message + ')'); }

  ctx.flags.stopPosting(ctx.cfg.transport, 'rest');
  ctx.state.update((s) => { s.rest = { session: sessionId(), at: Date.now(), open_claims: mine }; return s; });

  out('resting: broadcasting stopped for this session' + (res.queued ? ' (parting note queued)' : ''));
  out('  listening and injection are unaffected; use `mute` for those');
  out('  ' + mine.length + ' claim(s) left to expire on TTL rather than released');
  out('  heartbeat disarmed via ' + sentinel);
}

// =============================================================== upgrade ====

// PROTOCOL section 9.4, zero-setup -> relay. SCOPED: the wrangler deploy is a
// later milestone, so this assumes the relay is already deployed and reachable
// and performs the protocol steps only.
async function cmdUpgrade(args) {
  if (refuseIfChild('upgrade')) return;
  const found = requireWs(args); if (!found) return;
  const ctx = openWorkspace(found.ws, args);

  if (ctx.cfg.transport !== 'ntfy') {
    err('handshake: upgrade migrates zero-setup (ntfy) -> team relay. This workspace is already on ' + ctx.cfg.transport + '.');
    process.exitCode = 2; return;
  }
  const origin = typeof args.flags.relay === 'string' ? args.flags.relay.replace(/\/+$/, '') : null;
  if (!origin) {
    out('handshake upgrade needs a deployed relay.');
    out('');
    out('  1. Deploy the Worker from relay/ (wrangler deploy) and set RELAY_CREATE_TOKEN');
    out('     with `wrangler secret put` - never in [vars].');
    out('  2. Re-run:  handshake upgrade --relay https://<your-worker-origin>');
    out('');
    out('Scripting the deploy is a later milestone; this command does the protocol');
    out('steps only (PROTOCOL 9.4).');
    return;
  }

  const createToken = (await ask('relay create token (input hidden): ', { silent: true })).trim();
  if (!createToken) { err('no create token given'); process.exitCode = 2; return; }

  let created, joined;
  try {
    created = await relay.createWorkspace({ origin, createToken, name: ctx.cfg.name });
    joined = await relay.joinWorkspace({
      origin, ws: created.ws, enrollmentToken: created.enrollment_token,
      member: ctx.cfg.member_name || ctx.cfg.member,
    });
  } catch (e) {
    err('handshake: relay refused the migration (' + (e && e.code) + ')');
    process.exitCode = 1; return;
  }

  // Step 1: write the new config. The workspace SECRET is carried across -
  // it is client-side key material and the relay never sees it (section 1).
  const newState = stateLib.openState(created.ws);
  newState.ensure();
  newState.update((s) => {
    s.ws = created.ws; s.name = ctx.cfg.name; s.transport = 'relay'; s.endpoint = origin;
    s.protocol = envelope.PROTOCOL_VERSION; s.client = CLIENT;
    s.secret = ctx.cfg.secret;
    s.enrollment_token = created.enrollment_token;
    s.recovery_key = created.recovery_key;
    s.member = joined.member_id; s.member_name = ctx.cfg.member_name || ctx.cfg.member;
    s.member_token = joined.token;
    s.created_at = Date.now();
    s.project_dir = ctx.cfg.project_dir || process.cwd();
    // Cursors do NOT migrate (section 6.4): the new transport starts at 0 and
    // pre-migration history is never replayed into the model.
    s.cursors = {}; s.watermarks = {};
    s.migrated_from = { ws: ctx.ws, transport: 'ntfy', endpoint: ctx.cfg.endpoint };
    return s;
  });

  const dualReadUntil = Date.now() + 86400 * 1000;   // frozen at 86400 s

  // Step 2: post ws.migrate ON THE OLD TOPIC.
  //
  // member_map is carried as {from, to} rather than {<old id>: <new id>}: the
  // canonical key charset of section 2.1 is ^[a-z][a-z0-9_]*$, and an ntfy
  // member id is a self-assigned printable-ASCII NAME that routinely violates
  // it. A client may only accept the signed sender's own entry anyway, so the
  // two-key form carries exactly the information the rule permits.
  try {
    const migrateEnv = buildEnvelope(ctx, 'ws.migrate', {
      from_transport: 'ntfy', to_transport: 'relay', endpoint: origin,
      ws_new: created.ws, name: ctx.cfg.name || '',
      dual_read_until: dualReadUntil,
      member_map: { from: String(ctx.cfg.member), to: String(joined.member_id) },
    });
    const res = await send(ctx, migrateEnv);
    out('ws.migrate posted on the old topic' + (res.queued ? ' (queued)' : ''));
  } catch (e) { reportFailure(ctx, e, 'ws.migrate'); }

  // Step 3: re-broadcast every live claim on the new transport.
  const newCtx = openWorkspace(created.ws, args);
  const live = ctx.state.getOwnClaims();
  let rebroadcast = 0;
  for (const c of live) {
    try {
      await newCtx.adapter.claim({ subject: c.subject, ttl: c.ttl, files: c.files });
      newState.addOwnClaim(c);      // preserves the ORIGINAL acquired_at locally
      rebroadcast++;
    } catch (e) { reportFailure(newCtx, e, 'claim'); }
  }

  // Step 4: dual-read both transports until dual_read_until; publish to the
  // new transport only.
  ctx.state.update((s) => {
    s.migrated_to = { ws: created.ws, transport: 'relay', endpoint: origin };
    s.dual_read_until = dualReadUntil;
    s.publish_disabled = true;
    return s;
  });
  stateLib.linkProject(ctx.cfg.project_dir || process.cwd(), created.ws);

  out('');
  out('migrated to the team relay');
  out('  new workspace id: ' + created.ws);
  out('  member id:        ' + joined.member_id + '  (was "' + ctx.cfg.member + '")');
  out('  claims re-broadcast: ' + rebroadcast + ' of ' + live.length);
  out('  dual-read until:  ' + new Date(dualReadUntil).toISOString() + ' (publishing to the relay only)');
  out('  cursors reset - pre-migration history is NOT replayed (PROTOCOL 6.4)');
  out('');
  if (rebroadcast) {
    out('  HONESTY NOTE: the relay derives acquired_at server-side on POST /ws/:id/claim,');
    out('  so re-broadcast claims carry a FRESH acquired_at there. The original values are');
    out('  preserved in local state only, and pre-migration tiebreak ordering does not');
    out('  survive the move until the relay accepts an explicit acquired_at.');
  }
  out('  These are shown ONCE:');
  out('    enrollment token: ' + created.enrollment_token);
  out('    recovery key:     ' + created.recovery_key);
  out('');
  out('  Re-invite peers with `handshake invite`. Members never seen on the new');
  out('  transport before the dual-read window closes must be re-invited out of band.');
}

// ================================================================== main ====

const COMMANDS = {
  init: cmdInit, invite: cmdInvite, join: cmdJoin,
  claim: cmdClaim, release: cmdRelease, done: cmdDone, change: cmdChange,
  post: cmdPost, note: cmdNote, warn: cmdWarn, presence: cmdPresence,
  sync: cmdSync, cursor: cmdCursor, status: cmdStatus,
  rotate: cmdRotate, leave: cmdLeave, doctor: cmdDoctor,
  mute: cmdMute, unmute: cmdUnmute, rest: cmdRest, upgrade: cmdUpgrade,
};

const USAGE = [
  'handshake <command> [options]',
  '',
  '  init      [--relay <origin> | --ntfy <base-url>] [--name <name>]',
  '  invite    [--inline | --repo] [--json]',
  '  join      <hsi1_...> [--as <member name>]',
  '  claim     "<subject>" [--ttl <seconds>] [--files a,b]',
  '  change    "<subject>" --change files|ttl|tiebreak_loss|scope [--files a,b] [--note "..."]',
  '  release   "<subject>" [--reason done|superseded|tiebreak_loss|manual|expired]',
  '  done      "<subject>" [--summary "..."] [--files a,b]',
  '  note      discovery|error|fix|blocker|info "<text>" [--paths a,b] [--subject "..."]',
  '  warn      overlap --subject "..." --peer <member> --peer-subject "..." [--jaccard 50-100]',
  '  presence  working|waiting|blocked|tooling_broken [--note "..."] [--branch <b>] [--agents <n>]',
  '  post      <note.*|warn.overlap|task.change> --text "..." [--paths a,b]',
  '  sync      [--limit <n>] [--json] [--inject-digest]',
  '  cursor    [--commit]',
  '  status    [--json]',
  '  rotate    [--grace <seconds>]',
  '  leave     [--reason signoff|session_end|error] [--summary "..."]',
  '  mute      [on|off]        stop injecting peer chatter (LOCAL only)',
  '  unmute                    alias for `mute off`',
  '  rest      [--summary "..."]  stop broadcasting this session; keep listening',
  '  upgrade   [--relay <origin>]  migrate zero-setup -> team relay (PROTOCOL 9.4)',
  '  doctor    [--json]',
  '',
  'Credentials are read from stdin, never from argv.',
].join('\n');

async function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._.shift();
  if (!cmd || cmd === 'help' || args.flags.help) { out(USAGE); return; }
  if (cmd === 'version' || args.flags.version) { out(CLIENT); return; }
  const fn = COMMANDS[cmd];
  if (!fn) { err('unknown command: ' + cmd); out(USAGE); process.exitCode = 2; return; }
  try {
    await fn(args);
  } catch (e) {
    if (e instanceof FilterViolation) {
      err('handshake: outbound blocked by the secret filter (' + e.findings.map((f) => f.id).join(', ') + ')');
      process.exitCode = 1; return;
    }
    err('handshake: ' + (e && e.message ? e.message : String(e)));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(() => { if (process.stdin.isTTY === false) process.stdin.pause(); });
}

module.exports = { main, parseArgs, USAGE, COMMANDS };
