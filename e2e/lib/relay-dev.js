'use strict';
// claude-handshake M12(a): the real relay, run locally.
//
// `npx wrangler dev` is the supported local mode and SQLite-backed Durable
// Objects work there, so LEG 1 exercises relay/src verbatim rather than a
// stub. RELAY_CREATE_TOKEN is supplied with `--var` instead of writing a
// relay/.dev.vars file, because this milestone owns e2e/ and package.json only.
//
// Teardown is by process TREE: wrangler forks workerd, and killing the node
// parent alone leaves workerd holding the port (verified on this machine).

const path = require('path');
const { spawn } = require('child_process');

const H = require('./harness');

const RELAY_DIR = path.join(H.REPO_ROOT, 'relay');
const WRANGLER = path.join(RELAY_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

async function startRelay(h, opts) {
  const o = opts || {};
  const port = await H.freePort();
  const createToken = o.createToken || 'e2e-relay-create-token';
  const persistDir = o.persistDir;

  const env = Object.assign({}, process.env, {
    WRANGLER_SEND_METRICS: 'false',
    CI: '1',
    NO_COLOR: '1',
  });
  // The harness may run inside a Claude Code session; nothing about that
  // session's identity should reach the relay process.
  delete env.CLAUDE_CODE_CHILD_SESSION;
  delete env.CLAUDE_PLUGIN_DATA;

  const args = [
    WRANGLER, 'dev',
    '--port', String(port),
    '--ip', '127.0.0.1',
    '--var', 'RELAY_CREATE_TOKEN:' + createToken,
    '--log-level', 'warn',
  ];
  if (persistDir) args.push('--persist-to', persistDir);

  const child = spawn(process.execPath, args, {
    cwd: RELAY_DIR, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  h.track(child);

  let log = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (c) => { log += c; });
  child.stderr.on('data', (c) => { log += c; });

  const origin = 'http://127.0.0.1:' + port;
  const health = await H.waitForHttp(origin + '/health', { timeoutMs: 120000 });

  return {
    origin, port, createToken, child, health,
    log: () => log,
    stop: () => { H.killTree(child.pid); },
  };
}

// ------------------------------------------------------- relay HTTP helpers -

async function relayJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* keep null */ }
  return { status: res.status, ok: res.ok, json, text };
}

function bearer(token) {
  return { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
}

async function joinAuditor(origin, ws, enrollmentToken, name) {
  return relayJson(origin + '/ws/' + ws + '/join', {
    method: 'POST', headers: bearer(enrollmentToken), body: JSON.stringify({ member: name }),
  });
}

// Every message on the relay, read from a FRESH member cursor 0.
//
// The relay's per-sender-fair selection (relay/src/lib/fairness.js) can return
// a non-contiguous set of seqs, so paging by `next_cursor` alone could skip
// one. Two facts make the walk below exhaustive:
//   - `more === 0` means everything above the cursor came back, so we stop;
//   - otherwise the round-robin always includes the globally smallest pending
//     seq (round 0 of the sender whose oldest pending item is oldest), so
//     advancing the cursor to min(returned seq) skips nothing and strictly
//     progresses.
async function allRelayMessages(origin, ws, token) {
  const out = [];
  const seen = new Set();
  let cursor = 0;
  for (let guard = 0; guard < 500; guard++) {
    const res = await relayJson(origin + '/ws/' + ws + '/sync?cursor=' + cursor, {
      method: 'GET', headers: bearer(token),
    });
    if (!res.ok || !res.json) return { ok: false, status: res.status, text: res.text, messages: out };
    const msgs = res.json.messages || [];
    for (const m of msgs) {
      if (seen.has(m.seq)) continue;
      seen.add(m.seq);
      out.push(m);
    }
    if (!msgs.length) break;
    if (!Number(res.json.more)) break;
    cursor = Math.min.apply(null, msgs.map((m) => m.seq));
  }
  out.sort((a, b) => a.seq - b.seq);
  return { ok: true, messages: out };
}

module.exports = { startRelay, relayJson, bearer, joinAuditor, allRelayMessages, RELAY_DIR, WRANGLER };
