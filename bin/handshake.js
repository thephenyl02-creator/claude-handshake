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
const repoLib = require('../lib/repo');
const wsFiles = require('../lib/workspace-files');
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

// ------------------------------------------------------ the repo layer (M8) --

// Where the durable layer lives: the git working tree root, or nothing. A
// project that is not a git repo has no durable layer at all - claude-handshake
// does not invent one in a directory git will never carry, because the whole
// value of `.handshake/` is that peers get it by pulling.
function repoRoot(cwd) {
  const detected = repoLib.detectRepo(cwd || process.cwd());
  return detected && detected.ok ? detected : null;
}

// True once `.handshake/` exists in the working tree. Every guard and shard
// path is a no-op before that, so a plain local workspace never pays for a
// `git`/`gh` subprocess it has no use for.
function repoLayerPresent(root) {
  return Boolean(root) && wsFiles.exists(wsFiles.paths(root).dir);
}

// SECURITY.md section 6: the guard is re-checked on a cached TTL at every sync,
// and a repo found public while workspace key material is tracked in it
// HARD-FAILS posting, loudly, and demands rotation. That is a loud-rejected
// condition (PROTOCOL 10.2), so it goes through exactly the same session flags
// as a 403: reported once, posting stopped on that transport for the session,
// reading untouched.
function enforceRepoGuard(ctx, opts) {
  const o = opts || {};
  const detected = o.detected === undefined ? repoRoot(o.cwd) : o.detected;
  if (!detected) return null;
  if (!repoLayerPresent(detected.root)) return null;

  const verdict = repoLib.guard({ cwd: detected.root, repo: detected, state: ctx.state, force: Boolean(o.force) });
  const tracked = repoLib.trackedSecrets(detected.root);
  const applied = repoLib.applyGuard({
    state: ctx.state, flags: ctx.flags, transport: ctx.cfg.transport, verdict, tracked,
  });
  if (applied.hard_fail && applied.report) err(applied.message);
  return { root: detected.root, detected, verdict, tracked, applied };
}

// A member writes its OWN shard and no other (PLAN.md section 2). Best effort
// by design: a missing repo layer, an unjoined workspace or a filter refusal
// must never turn a successful claim into a failed command - the live layer
// already carried it.
function writeShard(ctx, kind, fields) {
  const detected = repoRoot();
  if (!detected || !repoLayerPresent(detected.root)) return null;
  const self = ctx.cfg.member;
  if (!self) return null;
  try {
    return wsFiles.appendShardRecord(detected.root, { self, member: self, kind, fields }, {
      filterOpts: ctx.filterOpts, email: ctx.cfg.git_email || null,
    });
  } catch (e) {
    if (e instanceof FilterViolation) { reportFailure(ctx, e, 'task shard write'); return null; }
    err('handshake: task shard not written (' + (e && e.message) + ')');
    return null;
  }
}

// Write the split workspace record. Public part always; guarded part only on
// an affirmative isPrivate:true, else gitignored with the out-of-band
// instruction printed (SECURITY.md 6).
function writeRepoLayer(wsId, cfg, opts) {
  const o = opts || {};
  const detected = o.detected === undefined ? repoRoot() : o.detected;
  if (!detected) return null;
  const root = detected.root;
  const state = o.state || stateLib.openState(wsId);

  const verdict = repoLib.guard({ cwd: root, repo: detected, state, force: true });
  const guarded = { ws: wsId, secret: cfg.secret, topic: cfg.topic, enrollment_token: cfg.enrollment_token };
  const written = wsFiles.writeGuardedPart(root, guarded, verdict, { filterOpts: o.filterOpts });
  const pub = wsFiles.writeWorkspacePublic(root, Object.assign({}, cfg, { ws: wsId }), {
    filterOpts: o.filterOpts, secretLocation: written.secret_location,
  });
  return { root, detected, verdict, written, public: pub };
}

function printRepoLayer(layer) {
  out('');
  out('repo layer (' + layer.root + ')');
  out('  public part:  ' + layer.public.file + '  (committed always)');
  out('  guard:        ' + layer.verdict.verdict + ' - ' + layer.verdict.explanation +
    (layer.verdict.slug ? '  [' + layer.verdict.slug + ']' : ''));
  out('  guarded part: ' + layer.written.file +
    (layer.written.committable ? '  COMMITTABLE (affirmative isPrivate:true)' : '  gitignored, NOT committed'));
  if (layer.written.instruction) {
    out('');
    for (const line of layer.written.instruction.split('\n')) out('  ' + line);
  }
  if (layer.public.refused.length) {
    out('  refused in the public part: ' + layer.public.refused.join(', ') + ' (guarded fields never go there)');
  }
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

  // ------------------------------------------------------ the repo layer --
  const detected = args.flags['no-repo'] ? null : repoRoot();
  let layer = null;
  if (detected) {
    layer = writeRepoLayer(ws, state.read(), { detected, state, filterOpts: { projectDir: process.cwd() } });
    printRepoLayer(layer);
    const email = repoLib.localGitEmail(detected.root);
    if (email) state.update((s) => { s.git_email = email; return s; });
  } else if (!args.flags['no-repo']) {
    out('');
    out('  no git working tree here - no durable layer was written. `.handshake/` only');
    out('  helps peers when git carries it to them; run `handshake init` inside the repo');
    out('  (or `git init` first) to get the durable half.');
  }

  if (detected && args.flags['claude-md']) {
    const r = wsFiles.writeClaudeMdBlock(detected.root, { consent: true });
    out('  CLAUDE.md block: ' + r.action + ' (' + r.file + ')');
  } else if (detected) {
    out('');
    out('  Optional: `handshake init --claude-md` (or re-run with it) appends a short');
    out('  HUMAN-addressed block to CLAUDE.md telling teammates this project uses');
    out('  claude-handshake. It is not written without that flag.');
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

  // PROTOCOL 9.1: loc:"repo" says "the secret lives in the repo". That is only
  // TRUE when the guard affirmed private AND the guarded part is actually
  // committed - otherwise the blob points the joiner at a file they will never
  // receive, and they will be stuck with no secret and no error to read.
  let repoNote = null;
  if (loc === 'repo') {
    const detected = repoRoot();
    const guarded = detected ? wsFiles.readGuardedPart(detected.root) : null;
    if (!detected) repoNote = 'there is no git working tree here, so nothing can distribute the secret through the repo';
    else if (!guarded) repoNote = 'no ' + wsFiles.DIR + '/' + wsFiles.SECRET_FILE + ' exists yet - run `handshake init` in this repo first';
    else if (!guarded.committed) repoNote = 'the guarded part is gitignored (the private-repo guard did not affirm isPrivate:true), so the repo will NOT carry the secret to the joiner';
  }

  if (args.flags.json) { json({ invite: blob, describe: inviteLib.describe(inviteLib.decode(blob)), repo_note: repoNote }); return; }
  out(blob);
  err('');
  if (loc === 'inline') {
    err('This blob is a CREDENTIAL: it carries the workspace secret' +
      (cfg.transport === 'relay' ? ' and the relay enrollment token' : ' and the ntfy topic') + '.');
    err('Send it over a channel you would send a password over. Anyone holding it can');
    err('read and sign workspace traffic (SECURITY.md section 3).');
  } else {
    err('This blob carries NO secret (loc=repo): the joiner reads the guarded part out of');
    err('the private repo. Everyone with read access to that repo therefore holds the');
    err('workspace secret - that is the documented holder set (SECURITY.md 3.1).');
    if (repoNote) {
      err('');
      err('WARNING: ' + repoNote + '.');
      err('         Use `handshake invite --inline` and hand the blob over out of band instead.');
    }
  }
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

  // PROTOCOL 9.1, loc:"repo": the guarded part is distributed BY the private
  // repo. Read it from the working tree rather than making the human paste a
  // credential that is already on their disk - and refuse a guarded part
  // belonging to a different workspace rather than silently keying against it.
  const detectedJoin = repoRoot();
  let fromRepo = null;
  if (fields.loc === 'repo' && detectedJoin) {
    fromRepo = wsFiles.readGuardedPart(detectedJoin.root);
    if (fromRepo && fromRepo.ws && fromRepo.ws !== fields.ws) {
      err('handshake: ' + fromRepo.file + ' belongs to workspace ' + fromRepo.ws + ', not ' + fields.ws + ' - ignoring it');
      fromRepo = null;
    }
    if (fromRepo) out('  reading the guarded part from ' + fromRepo.file);
  }

  if (fields.t === 'relay') {
    const enrollment = fields.tok || (fromRepo && fromRepo.enrollment_token) ||
      (await ask('enrollment token (input hidden): ', { silent: true })).trim();
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
    else if (fromRepo && fromRepo.secret) s.secret = fromRepo.secret;
    if (fields.topic) s.topic = fields.topic;
    else if (fromRepo && fromRepo.topic) s.topic = fromRepo.topic;
    if (fromRepo && fromRepo.enrollment_token) s.enrollment_token = fromRepo.enrollment_token;
    s.member = member; s.member_name = memberName;
    if (memberToken) s.member_token = memberToken;
    s.joined_at = Date.now();
    s.project_dir = process.cwd();
    return s;
  });
  stateLib.linkProject(process.cwd(), fields.ws);

  // SECURITY.md 5.4: the non-member-commit warning compares a shard's last
  // committer against the member emails RECORDED AT JOIN. This is that record,
  // for this member. Peers' emails are learned the same way on their machines
  // and never inferred from a shard's own self-declared header - a field an
  // attacker writes is not evidence about the attacker.
  if (detectedJoin) {
    const email = repoLib.localGitEmail(detectedJoin.root);
    if (email) {
      state.update((s) => { s.git_email = email; return s; });
      wsFiles.recordMemberEmail(state, member, email);
    }
    if (repoLayerPresent(detectedJoin.root)) {
      const verdict = repoLib.guard({ cwd: detectedJoin.root, repo: detectedJoin, state, force: true });
      const tracked = repoLib.trackedSecrets(detectedJoin.root);
      out('  repo guard: ' + verdict.verdict + ' - ' + verdict.explanation);
      if (!verdict.private && tracked.any) {
        err('handshake: this repo is NOT verified private and it tracks workspace key material (' +
          tracked.secrets.map((s) => s.file).join(', ') + '). Treat the workspace secret as');
        err('           disclosed and rotate it before relying on this workspace (SECURITY.md 6).');
      }
    }
  }

  if (fields.loc === 'repo' && !state.read().secret) {
    err('handshake: this invite says the workspace secret lives in the repo (loc=repo),');
    err('           but no readable ' + wsFiles.DIR + '/' + wsFiles.SECRET_FILE + ' was found here.');
    err('           Nothing was signed yet - the secret must be provisioned before posting.');
    err('           Ask the workspace founder for `handshake invite --inline`, out of band.');
    process.exitCode = 1; return;
  }

  if (detectedJoin && args.flags['claude-md']) {
    const r = wsFiles.writeClaudeMdBlock(detectedJoin.root, { consent: true });
    out('  CLAUDE.md block: ' + r.action + ' (' + r.file + ')');
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

  // PROTOCOL 3.2: `acquired_at` is "when this member FIRST acquired the
  // subject", and 5.4 makes it the tiebreak key. A renewal that stamps
  // Date.now() therefore does not merely refresh a lease - it rewrites this
  // member's position in the tiebreak, and on ntfy (where the value travels on
  // the wire and no server arbitrates) a member who renews often would keep
  // losing to a peer who claimed later. So: reuse the stored acquired_at
  // whenever a LIVE own-claim already exists for this subject key -
  // lib/state.js addOwnClaim() preserves the original across re-adoption for
  // exactly this reason - and mint a fresh one only for a genuinely new claim.
  // An EXPIRED claim is not reused: past its TTL the claim is gone (5.3), and
  // re-taking it is a new acquisition, not a renewal.
  const held = ctx.state.getOwnClaims().find((c) => c.subject_key === key);
  const heldAt = held && Number.isFinite(Number(held.acquired_at)) ? Number(held.acquired_at) : null;
  const isRenewal = heldAt !== null;
  const acquiredAt = isRenewal ? heldAt : Date.now();

  if (ctx.cfg.transport === 'relay') {
    // section 3.1: claims are server state on the relay, NOT envelopes.
    try {
      // Appendix B A7 (relay v0.1.2): the relay accepts an optional
      // `acquired_at`, clamps it to <= now, and honors it only on a fresh
      // insert or an adoption - never on a renewal. Sending the preserved
      // value is what keeps ordering across a rebind, a restart or a migration;
      // the relay derives its own value when we do not send one.
      const res = await ctx.adapter.claim({ subject: raw, ttl, files, acquired_at: acquiredAt });
      if (res.ok === false && res.conflict) {
        const mine = { acquired_at: acquiredAt, member: ctx.identity.member };
        // The relay's 409 body is a claim ROW: owner / owner_name (#claimRows).
        const theirs = { acquired_at: res.conflict.acquired_at, member: res.conflict.owner || res.conflict.member_id || res.conflict.member };
        const lost = subject.losesTiebreak(mine, theirs);
        out('claim refused: "' + key + '" is held by ' + (res.conflict.owner_name || res.conflict.name || theirs.member));
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
      writeShard(ctx, 'claim', { subject: raw, subject_key: key, ttl, files });
      out('claimed "' + key + '"' + (res.renewed ? ' (renewed)' : '') + ' ttl=' + ttl + 's');
    } catch (e) { reportFailure(ctx, e, 'claim'); out('claim not sent (transport unavailable)'); }
    return;
  }

  // Section 5.5: advisory conflicts are surfaced, never silently deferred, and
  // the section 5.4 tiebreak governs every conflict on ntfy (no serializing
  // server exists to 409). Mirrors the relay branch's refusal above.
  if (!isRenewal) {
    const peerClaims = (ctx.state.getPeers().claims || []);
    const live = peerClaims.find((c) => c.subject_key === key &&
      c.member !== ctx.identity.member &&
      (Number(c.renewed_at) || 0) + (Number(c.ttl) || 0) * 1000 > Date.now());
    if (live) {
      const mine = { acquired_at: acquiredAt, member: ctx.identity.member };
      const theirs = { acquired_at: live.acquired_at, member: live.member };
      const lost = subject.losesTiebreak(mine, theirs);
      out('claim refused: "' + key + '" is held by ' + live.member + ' [advisory]');
      out(lost ? '  you lose the tiebreak (PROTOCOL 5.4) - stop work on this subject'
        : '  you would win the tiebreak on acquired_at; reconcile with the holder');
      process.exitCode = 1;
      return;
    }
  }

  const env = buildEnvelope(ctx, 'task.claim', {
    subject: raw, subject_key: key, ttl, acquired_at: acquiredAt,
    files: files && files.length ? files : undefined,
    renew: isRenewal ? true : undefined,
  });
  ctx.state.addOwnClaim({ subject: raw, subject_key: key, ttl, acquired_at: acquiredAt, files });
  const res = await send(ctx, env);
  writeShard(ctx, 'claim', { subject: raw, subject_key: key, ttl, files });
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
      writeShard(ctx, 'release', { subject: raw, subject_key: key, reason });
      out('released "' + key + '"');
    } catch (e) { reportFailure(ctx, e, 'release'); out('release not sent (transport unavailable)'); }
    return;
  }
  const env = buildEnvelope(ctx, 'task.release', { subject: raw, subject_key: key, reason });
  ctx.state.removeOwnClaim(key);
  const res = await send(ctx, env);
  writeShard(ctx, 'release', { subject: raw, subject_key: key, reason });
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
  // The durable half. PLAN.md section 6: the shard is written and rides the
  // next USER-REQUESTED commit - `handshake` never commits anything itself,
  // because a coordination-only commit is noise in someone else's history.
  const shard = writeShard(ctx, 'done', { subject: raw, subject_key: key, summary, files });
  out('done "' + key + '"' + (res.queued ? ' (queued)' : '') +
    (shard ? '; recorded in ' + path.relative(process.cwd(), shard.file).split(path.sep).join('/') : ''));
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
  // SECURITY.md 6: the private-repo guard is re-checked on its cached TTL at
  // EVERY sync. Reading continues either way (PROTOCOL 10.2); what a failed
  // guard stops is posting.
  enforceRepoGuard(ctx, { force: Boolean(args.flags['guard-refresh']) });
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

// ================================================================= tasks ====

// The human projection over `.handshake/tasks/*.md`. Assembled on every read
// and never written back: the shards are the record, this view is a rendering
// of them (PLAN.md section 2 - "a projection of claims, never a hand-edited
// master"). Everything shown here has been escaped by lib/escape.js, because a
// shard is peer-authored data that arrived through git instead of through a
// transport (SECURITY.md 5.4).
async function cmdTasks(args) {
  const detected = repoRoot();
  if (!detected) {
    err('handshake: not inside a git working tree - there is no durable layer to project.');
    process.exitCode = 2; return;
  }
  const root = detected.root;
  if (!repoLayerPresent(root)) {
    err('handshake: no ' + wsFiles.DIR + '/ in ' + root + ' - run `handshake init` here first.');
    process.exitCode = 2; return;
  }

  // The non-member-commit warning (SECURITY.md 5.4). Recorded into local state
  // as well as printed, so the digest can surface the flag without re-running
  // git on every injection.
  let warnings = null;
  const found = resolveWs(args);
  let state = null;
  if (found) {
    state = stateLib.openState(found.ws);
    warnings = wsFiles.checkShardAuthors(root, { knownEmails: wsFiles.knownMemberEmails(state) });
    wsFiles.recordShardWarnings(state, warnings);
  }

  const limit = args.flags.limit !== undefined ? Number(args.flags.limit) : undefined;
  const view = wsFiles.projectTasks(root, { warnings, limit: Number.isInteger(limit) ? limit : undefined });
  if (args.flags.json) { json(view); return; }
  out(wsFiles.renderTasks(view));
}

// ================================================================= guard ====

// Run, refresh and report the fail-closed private-repo guard (SECURITY.md 6).
async function cmdGuard(args) {
  const detected = repoRoot();
  const found = resolveWs(args);
  const state = found ? stateLib.openState(found.ws) : null;

  if (args.flags['ack-rotated']) {
    if (!state) { err('handshake: not in a workspace, nothing to acknowledge'); process.exitCode = 2; return; }
    repoLib.acknowledgeRotation(state);
    out('rotation acknowledged. Nothing about git history changed: a credential that was');
    out('committed stays in every clone, fork and archive of that commit (SECURITY.md 6).');
    return;
  }

  if (!detected) {
    const report = { repo: false, verdict: 'public', reason: 'not_a_repo', explanation: repoLib.REASONS.not_a_repo };
    if (args.flags.json) { json(report); return; }
    out('guard: public (fail-closed) - ' + report.explanation);
    out('  nothing is committed anywhere, so nothing is at risk; the guard simply has no');
    out('  affirmative answer, and no answer is treated as public by design.');
    return;
  }

  const verdict = repoLib.guard({
    cwd: detected.root, repo: detected, state,
    force: args.flags.refresh !== undefined ? Boolean(args.flags.refresh) : true,
  });
  const tracked = repoLib.trackedSecrets(detected.root);
  const applied = state
    ? repoLib.applyGuard({ state, flags: state.session(sessionId()), transport: (state.read().transport || 'unknown'), verdict, tracked })
    : { hard_fail: !verdict.private && tracked.any, report: false, message: null, files: tracked.secrets.map((s) => s.file) };

  const report = {
    repo: true, root: detected.root, slug: verdict.slug, remote: detected.remote,
    verdict: verdict.verdict, private: verdict.private, reason: verdict.reason,
    explanation: verdict.explanation, checked_at: verdict.checked_at, source: verdict.source,
    ttl_ms: repoLib.GUARD_TTL_MS, flip: verdict.flip, previous: verdict.previous,
    tracked_files: tracked.tracked, tracked_secrets: tracked.secrets,
    hard_fail: applied.hard_fail,
    rotation_demanded: state ? repoLib.rotationDemanded(state) : applied.hard_fail,
    may_commit_secrets: verdict.private === true,
  };
  if (args.flags.json) { json(report); return; }

  out('guard: ' + verdict.verdict.toUpperCase() + '  (' + verdict.explanation + ')');
  out('  repo:            ' + (verdict.slug || detected.remote || detected.root));
  out('  checked:         ' + new Date(verdict.checked_at).toISOString() + '  [' + verdict.source + ', TTL ' + (repoLib.GUARD_TTL_MS / 1000) + 's]');
  out('  may commit the guarded part: ' + (verdict.private ? 'YES' : 'NO'));
  if (verdict.flip) out('  VISIBILITY FLIP: this repo was previously verified private and is not now.');
  out('  tracked under .handshake/: ' + (tracked.tracked.length ? tracked.tracked.join(', ') : 'nothing'));
  if (tracked.any) {
    out('  KEY MATERIAL TRACKED: ' + tracked.secrets.map((s) => s.file + ' (' + s.id + ')').join(', '));
  }
  if (report.hard_fail) {
    out('');
    out('  HARD FAIL: key material is tracked in a repo the guard cannot prove is private.');
    out('  Posting is stopped for this session. Rotate the workspace secret, then run');
    out('  `handshake guard --ack-rotated`. Rotation stops FUTURE use; it does not un-leak');
    out('  the commit, which lives on in every clone, fork and archive (SECURITY.md 6).');
    process.exitCode = 1;
  } else if (!verdict.private) {
    out('  the guarded part stays gitignored and is distributed out of band.');
  }
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

  // The guard state comes from the CACHE here, never from a fresh probe:
  // `status` must stay fast and must not burn a GitHub API call per keystroke.
  // A cached affirmative older than the 600 s TTL is reported as a stale
  // affirmative, which is NOT an affirmative (SECURITY.md 6).
  const repoState = ctx.state.repoStatus();
  const cachedGuard = repoLib.cachedVerdict(ctx.state);

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
    repo: {
      guard: cachedGuard ? {
        verdict: cachedGuard.verdict, reason: cachedGuard.reason, explanation: cachedGuard.explanation,
        checked_at: cachedGuard.checked_at, age_ms: cachedGuard.age_ms, stale: cachedGuard.stale,
        slug: cachedGuard.slug, may_commit_secrets: cachedGuard.private === true,
        ttl_ms: repoLib.GUARD_TTL_MS, source: 'cache',
      } : null,
      rotation_demanded: repoState.rotation_demanded,
      last_hard_fail: (repoState.guard && repoState.guard.last_hard_fail) || null,
      shard_warning: (repoState.warnings && repoState.warnings.flag) || null,
      non_member_commits: (repoState.warnings && repoState.warnings.non_member_commits) || [],
    },
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
  // SECURITY.md 6 / PROTOCOL 10.2: the guard's state is part of an honest
  // status. "not checked" is printed as not checked, never as safe.
  if (cachedGuard) {
    out('repo guard: ' + cachedGuard.verdict + ' - ' + cachedGuard.explanation +
      '  [cached ' + Math.round(cachedGuard.age_ms / 1000) + 's ago' + (cachedGuard.stale ? ', STALE' : '') + ']');
    out('  secrets may be committed: ' + (cachedGuard.private ? 'yes' : 'NO - the guarded part stays out of the repo'));
  } else {
    out('repo guard: not checked yet - run `handshake guard` (until then, treat this repo as public)');
  }
  if (report.repo.rotation_demanded) {
    out('  ROTATION DEMANDED: key material was tracked in a repo the guard could not prove');
    out('  private. Rotate, then `handshake guard --ack-rotated`. History is not un-leaked.');
  }
  if (report.repo.shard_warning === 'non_member_commit') {
    out('  WARNING: a task shard was last modified by a non-member commit (' +
      report.repo.non_member_commits.map((c) => c.file).join(', ') + ') - treat it as unattributed');
  } else if (report.repo.shard_warning === 'unverified_shard_authors') {
    out('  note: shard authorship is unverified for some members - unknown, not clean');
  }
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
  // The parting note MUST also be written to the task shard so the record
  // exists in both the live and durable layers (PROTOCOL 3.2): a closed Claude
  // always leaves its record in both, so a peer who was offline for the whole
  // session still finds out what happened by pulling.
  ctx.state.update((s) => {
    s.last_leave = { reason, summary: summary || null, open_claims: mine, at: Date.now() };
    return s;
  });
  const shard = writeShard(ctx, 'parting', { reason, summary, open_claims: mine });
  out('signed off (' + reason + ')' + (res.queued ? ' - parting note queued, kept up to 24 h' : '') +
    (shard ? '; parting record in ' + path.relative(process.cwd(), shard.file).split(path.sep).join('/') : ''));
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

  // ------------------------------------------------ SECURITY.md 6 checks --
  const detected = repoRoot();
  if (!detected) {
    add('git working tree', 'warn', 'not inside a git working tree - no durable layer, and the guard is moot');
  } else {
    add('git working tree', 'pass', detected.root + (detected.slug ? '  [' + detected.slug + ']' : '  (no github remote)'));

    const verdict = repoLib.guard({
      cwd: detected.root, repo: detected, state: found ? state : null,
      force: Boolean(args.flags['guard-refresh']),
    });
    add('private-repo guard', verdict.private ? 'pass' : 'warn',
      verdict.verdict + ' - ' + verdict.explanation +
      ' [' + verdict.source + ', TTL ' + (repoLib.GUARD_TTL_MS / 1000) + 's]' +
      (verdict.private ? '; the guarded part may be committed' : '; the guarded part must stay out of the repo') +
      (verdict.flip ? '; VISIBILITY FLIP since the last affirmative' : ''));

    const tracked = repoLib.trackedSecrets(detected.root);
    if (!tracked.ok) {
      add('public repo + tracked secret', 'warn', 'could not ask git what is tracked (' + tracked.reason + ') - unknown, not clean');
    } else if (!tracked.any) {
      add('public repo + tracked secret', 'pass', 'no workspace key material is tracked under ' + wsFiles.DIR + '/');
    } else if (verdict.private) {
      add('public repo + tracked secret', 'warn',
        'key material IS tracked (' + tracked.secrets.map((s) => s.file).join(', ') +
        ') in a repo verified private - permitted, and it means every reader of this repo holds it (SECURITY.md 3.1)');
    } else {
      add('public repo + tracked secret', 'fail',
        'key material is tracked (' + tracked.secrets.map((s) => s.file + ':' + s.id).join(', ') +
        ') in a repo the guard could NOT prove private - rotate the workspace secret now');
    }

    const hist = repoLib.tokenInHistory(detected.root, { runner: undefined });
    if (!hist.ok) {
      add('token in git history', 'warn', 'the history scan did not complete (' + hist.reason + ') - unknown, which is not the same as clean');
    } else if (!hist.hits.length) {
      add('token in git history', 'pass', 'no hsk_/hsr_/hsi1_ value appears in any reachable commit (bounded scan: ' +
        repoLib.HISTORY_MAX_COUNT + ' commits per pattern)');
    } else {
      add('token in git history', 'fail',
        hist.hits.length + ' commit(s) touch a credential-shaped value: ' +
        hist.hits.slice(0, 3).map((h) => h.sha + ' (' + h.needle + ')').join(', ') +
        ' - rotate; rewriting history does not reach clones that already exist (SECURITY.md 6)');
    }

    if (repoLayerPresent(detected.root)) {
      const guardedFile = wsFiles.readGuardedPart(detected.root);
      const ign = wsFiles.paths(detected.root).gitignore;
      let ignText = '';
      try { ignText = fs.readFileSync(ign, 'utf8'); } catch (_) { ignText = ''; }
      const ignoresSecret = ignText.split('\n').some((l) => l.trim() === wsFiles.SECRET_FILE);
      if (!guardedFile) add('guarded part', 'warn', 'no ' + wsFiles.DIR + '/' + wsFiles.SECRET_FILE + ' here');
      else if (verdict.private) add('guarded part', 'pass', 'present; guard affirms private' + (ignoresSecret ? ' but it is still gitignored - peers will not receive it' : ''));
      else add('guarded part', ignoresSecret ? 'pass' : 'fail',
        ignoresSecret ? 'present and gitignored, distributed out of band (fail-closed as designed)'
          : 'present and NOT gitignored in a repo the guard could not prove private');

      const shardCheck = found
        ? wsFiles.checkShardAuthors(detected.root, { knownEmails: wsFiles.knownMemberEmails(state) })
        : null;
      if (shardCheck) {
        const verified = shardCheck.results.filter((r) => r.status === 'ok').length;
        const uncommitted = shardCheck.results.filter((r) => r.status === 'uncommitted').length;
        const tally = shardCheck.results.length + ' shard(s): ' + verified + ' verified, ' +
          uncommitted + ' not committed yet, ' + shardCheck.unknown.length + ' unverifiable';
        if (shardCheck.mismatches.length) {
          add('task shard authors', 'fail', shardCheck.mismatches.map((m) => m.file + ' last committed by ' + m.email).join('; ') +
            ' - non-member commit (SECURITY.md 5.4). ' + tally);
        } else if (shardCheck.unknown.length) {
          add('task shard authors', 'warn', tally + ' - an unverifiable author is UNKNOWN, not verified-clean');
        } else if (!shardCheck.results.length) {
          add('task shard authors', 'pass', 'no shards yet');
        } else {
          add('task shard authors', 'pass', tally);
        }
      }
    }

    const block = wsFiles.readClaudeMdBlock(detected.root);
    add('CLAUDE.md block', 'pass', block.present
      ? (block.current ? 'present and current' : 'present but out of date - re-run with --claude-md to refresh it')
      : 'absent (never written without --claude-md; that is the default, not a defect)');
  }

  if (found && repoLib.rotationDemanded(state)) {
    add('rotation demanded', 'fail', 'the guard hard-failed earlier and the rotation has not been acknowledged - rotate, then `handshake guard --ack-rotated`');
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

  writeShard(ctx, 'parting', { reason: 'rest', summary, open_claims: mine });
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
  sync: cmdSync, cursor: cmdCursor, status: cmdStatus, tasks: cmdTasks, guard: cmdGuard,
  rotate: cmdRotate, leave: cmdLeave, doctor: cmdDoctor,
  mute: cmdMute, unmute: cmdUnmute, rest: cmdRest, upgrade: cmdUpgrade,
};

const USAGE = [
  'handshake <command> [options]',
  '',
  '  init      [--relay <origin> | --ntfy <base-url>] [--name <name>] [--no-repo] [--claude-md]',
  '  invite    [--inline | --repo] [--json]',
  '  join      <hsi1_...> [--as <member name>] [--claude-md]',
  '  claim     "<subject>" [--ttl <seconds>] [--files a,b]',
  '  change    "<subject>" --change files|ttl|tiebreak_loss|scope [--files a,b] [--note "..."]',
  '  release   "<subject>" [--reason done|superseded|tiebreak_loss|manual|expired]',
  '  done      "<subject>" [--summary "..."] [--files a,b]',
  '  note      discovery|error|fix|blocker|info "<text>" [--paths a,b] [--subject "..."]',
  '  warn      overlap --subject "..." --peer <member> --peer-subject "..." [--jaccard 50-100]',
  '  presence  working|waiting|blocked|tooling_broken [--note "..."] [--branch <b>] [--agents <n>]',
  '  post      <note.*|warn.overlap|task.change> --text "..." [--paths a,b]',
  '  sync      [--limit <n>] [--json] [--inject-digest] [--guard-refresh]',
  '  cursor    [--commit]',
  '  status    [--json]',
  '  tasks     [--json] [--limit <n>]   projection over .handshake/tasks/ (never a master file)',
  '  guard     [--refresh] [--json] [--ack-rotated]   the fail-closed private-repo guard',
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
