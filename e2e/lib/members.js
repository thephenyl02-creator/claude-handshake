'use strict';
// claude-handshake M12(a): a simulated member.
//
// A member is driven ONLY through its production surfaces:
//   - bin/handshake.js subcommands, spawned exactly as a human/skill would
//     type them (credentials on stdin, never argv);
//   - hooks/*.js, fed the synthetic camelCase payload Claude Code sends on
//     stdin (docs/spike-findings.md [S1]: hookEventName, sessionId, toolName,
//     toolInput.file_path, workingDirectory, source).
//
// Two members are kept apart by two things and nothing else:
//   - CLAUDE_PLUGIN_DATA, the state root (lib/state.js stateRoot());
//   - a separate git working copy, which is what a second machine looks like.
//
// ENV HYGIENE IS LOAD-BEARING. This harness is itself normally run from inside
// a Claude Code session, whose environment may already carry
// CLAUDE_CODE_CHILD_SESSION=1 and CLAUDE_CODE_SESSION_ID. Inheriting either
// would make every simulated member a "proven child" (PROTOCOL 7.1) and every
// post would be refused. So the base environment is scrubbed of every variable
// the product reads, and each one is set back deliberately, per invocation.

const fs = require('fs');
const path = require('path');

const H = require('./harness');

// Every environment variable bin/handshake.js, lib/*, hooks/* or monitors/*
// reads. Scrubbed from the inherited environment; re-added only on purpose.
const PRODUCT_ENV = [
  'CLAUDE_PLUGIN_DATA',
  'CLAUDE_PLUGIN_ROOT',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_SESSION_ID',
  'HANDSHAKE_SESSION_ID',
];

function scrubbedEnv() {
  const env = Object.assign({}, process.env);
  for (const k of PRODUCT_ENV) delete env[k];
  // Keep the product's own subprocesses non-interactive and quiet.
  env.GIT_TERMINAL_PROMPT = '0';
  env.NO_COLOR = '1';
  return env;
}

class Member {
  constructor(opts) {
    const o = opts || {};
    this.label = o.label;                       // 'A' / 'B'
    this.name = o.name;                         // member name on the wire
    this.dataDir = path.join(o.root, o.label, 'data');
    this.repoDir = path.join(o.root, o.label, 'repo');
    this.sessionId = o.sessionId || ('e2e-' + o.label + '-session');
    this.ws = null;
    this.memberId = null;
  }

  // ------------------------------------------------------------- fixture --

  init(opts) {
    const o = opts || {};
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(path.join(this.repoDir, 'src'), { recursive: true });

    // A real second machine is a real git working copy: the durable layer only
    // helps peers because git carries it (bin/handshake.js repoRoot()).
    H.git(this.repoDir, ['init', '-q', '-b', 'main']);
    H.git(this.repoDir, ['config', 'user.email', this.label.toLowerCase() + '@e2e.invalid']);
    H.git(this.repoDir, ['config', 'user.name', 'e2e-' + this.label]);
    H.git(this.repoDir, ['config', 'commit.gpgsign', 'false']);

    fs.writeFileSync(path.join(this.repoDir, 'src', 'api.js'), '// api\nmodule.exports = {};\n');
    fs.writeFileSync(path.join(this.repoDir, 'src', 'other.js'), '// other\n');
    fs.writeFileSync(path.join(this.repoDir, 'README.md'), '# e2e fixture repo (' + this.label + ')\n');

    // The planted tripwire (SECURITY.md 4: "values >= 8 chars harvested from
    // local secret files ... any outbound containing one, or a 12-char window
    // of one, is refused"). Deliberately chosen so ONLY the tripwire can catch
    // it: it matches no pattern in the battery and its Shannon entropy is well
    // under the heuristic thresholds, so a hit proves the tripwire fired and
    // not something else.
    this.tripwire = o.tripwire || ('hunter2-e2e-tripwire-' + this.label.toLowerCase() + '-value');
    fs.writeFileSync(path.join(this.repoDir, '.env'),
      'NODE_ENV=test\nE2E_TRIPWIRE=' + this.tripwire + '\n');
    // .env must never be committed; that is the whole point of it being a
    // local secret file.
    fs.writeFileSync(path.join(this.repoDir, '.gitignore'), '.env\n');
    return this;
  }

  commitAll(message) {
    H.git(this.repoDir, ['add', '-A']);
    return H.git(this.repoDir, ['commit', '-q', '-m', message || 'e2e']);
  }

  trackedUnderHandshake() {
    const r = H.git(this.repoDir, ['ls-files', '--', '.handshake']);
    return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }

  // ----------------------------------------------------------------- env --

  env(extra) {
    const e = scrubbedEnv();
    // The state root: HANDSHAKE_STATE_DIR, the explicit override the CLI and
    // hooks BOTH honor (lib/state.js stateRoot). CLAUDE_PLUGIN_DATA is no
    // longer the state key - it is the asymmetric var that caused the
    // empty-standing-block bug.
    e.HANDSHAKE_STATE_DIR = this.dataDir;
    e.CLAUDE_PLUGIN_ROOT = H.REPO_ROOT;
    e.HANDSHAKE_SESSION_ID = this.sessionId;
    return Object.assign(e, extra || {});
  }

  // Env for a session that is a PROVEN child (PROTOCOL 7.1 rule 1): the
  // variable is present, and CLAUDE_CODE_SESSION_ID carries the PARENT's id -
  // the key a child appends its touched files under (7.2 rule 3).
  childEnv(parentSessionId, extra) {
    return this.env(Object.assign({
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_SESSION_ID: parentSessionId || this.sessionId,
    }, extra || {}));
  }

  // -------------------------------------------------------------- drives --

  // bin/handshake.js, spawned as a human would type it.
  cli(args, opts) {
    const o = opts || {};
    return H.runNode(H.CLI, args, {
      cwd: o.cwd || this.repoDir,
      env: o.env || this.env(o.envExtra),
      stdin: o.stdin,
      timeoutMs: o.timeoutMs || 30000,
    });
  }

  // hooks/<script>.js, fed the synthetic camelCase payload on stdin exactly as
  // hooks/hooks.json wires it (`node <script> <EventName>`).
  hook(script, payload, opts) {
    const o = opts || {};
    const body = Object.assign({ workingDirectory: this.repoDir, sessionId: this.sessionId }, payload || {});
    return H.runNode(path.join(H.HOOKS, script), [String(body.hookEventName || '')], {
      cwd: o.cwd || this.repoDir,
      env: o.env || this.env(o.envExtra),
      stdin: JSON.stringify(body),
      timeoutMs: o.timeoutMs || 30000,
    });
  }

  sessionStart(opts) {
    const o = opts || {};
    return this.hook('session-start.js', {
      hookEventName: 'SessionStart', source: o.source || 'startup',
    }, o);
  }

  userPromptSubmit(opts) {
    return this.hook('user-prompt-submit.js', { hookEventName: 'UserPromptSubmit' }, opts || {});
  }

  preToolUse(filePath, opts) {
    return this.hook('pre-tool-use.js', {
      hookEventName: 'PreToolUse', toolName: 'Edit', toolInput: { file_path: filePath },
    }, opts || {});
  }

  async postToolUse(filePath, opts) {
    // The mtime-sentinel gate collapses a burst inside 1000 ms ([S6]); wait it
    // out rather than deleting the sentinel, so the hook's own gate stays under
    // test instead of being bypassed.
    await this.waitPostToolGate();
    return this.hook('post-tool-use.js', {
      hookEventName: 'PostToolUse', toolName: 'Edit', toolInput: { file_path: filePath },
    }, opts || {});
  }

  sessionEnd(opts) {
    const o = opts || {};
    return this.hook('session-end.js', { hookEventName: 'SessionEnd', reason: o.reason || 'exit' }, o);
  }

  // Turn boundaries until nothing is pending, using only production surfaces:
  // SessionStart fetches, UserPromptSubmit injects and advances. A test that
  // wants to observe ONE item arriving has to start from a drained member,
  // because the inject cap is 5 and the backlog of ws.join / state.request
  // traffic from setup would otherwise decide which turn the item lands on.
  async drain(maxRounds) {
    const rounds = maxRounds || 6;
    for (let i = 0; i < rounds; i++) {
      await this.sessionStart({ source: 'startup' });
      let guard = 0;
      while ((this.digest().items || []).length && guard++ < 12) await this.userPromptSubmit();
      await this.sessionStart({ source: 'startup' });
      if (!(this.digest().items || []).length) return true;
    }
    return false;
  }

  async waitPostToolGate() {
    const tick = path.join(this.stateDir(), 'posttool.tick');
    for (let i = 0; i < 20; i++) {
      let age = Infinity;
      try { age = Date.now() - fs.statSync(tick).mtimeMs; } catch (_) { return; }
      if (age >= 1100) return;
      await H.sleep(1100 - age);
    }
  }

  // ------------------------------------------------------------ state I/O --

  stateDir() { return path.join(this.dataDir, String(this.ws)); }
  stateFile(name) { return path.join(this.stateDir(), name); }
  state() { return H.readJson(this.stateFile('state.json'), {}); }
  peers() { return H.readJson(this.stateFile('peers.json'), { members: [], presence: [], claims: [] }); }
  digest() { return H.readJson(this.stateFile('digest.json'), { items: [], more: 0 }); }
  session() { return H.readJson(this.stateFile('session.json'), {}); }

  watermark(transport) {
    const s = this.state();
    return (s.watermarks || {})[transport];
  }

  // FIXTURE ONLY, and used exactly once: PROTOCOL 6.4's beyond-the-cache-window
  // tier can only be reached by a cursor that is genuinely 12 h old, which no
  // 3-minute test can produce by waiting. Writing the watermark is writing the
  // state a member would legitimately hold after being offline for half a day;
  // nothing about the adapter under test is stubbed.
  forceWatermark(transport, value) {
    const file = this.stateFile('state.json');
    const s = H.readJson(file, {});
    s.watermarks = s.watermarks || {};
    s.watermarks[transport] = value;
    fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
    return value;
  }

  repoFile(rel) { return path.join(this.repoDir, rel.split('/').join(path.sep)); }

  handshakeDir() { return path.join(this.repoDir, '.handshake'); }

  shardText() {
    const dir = path.join(this.handshakeDir(), 'tasks');
    let files = [];
    try { files = fs.readdirSync(dir); } catch (_) { return ''; }
    return files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  }
}

module.exports = { Member, scrubbedEnv, PRODUCT_ENV };
