#!/usr/bin/env node
// handshake-spike M0.5: append one JSONL line per hook firing.
// Hard rules: never block longer than ~600ms total, never print to stdout,
// always exit 0 — a measurement tool must not disturb what it measures.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const T0 = Date.now();
const BOOT_MS = Math.round(process.uptime() * 1000); // node interpreter boot cost
const LOG = path.join(os.homedir(), '.claude', 'handshake-spike.log');
const EVENT_ARG = process.argv[2] || 'unknown';

let raw = '';
let done = false;

function complete(why) {
  if (done) return;
  done = true;

  let ctx = {};
  let parse = 'ok';
  const clean = raw.replace(/^\uFEFF/, '').trim();
  try { ctx = JSON.parse(clean || '{}'); }
  catch (_) { parse = 'failed'; ctx = {}; }

  const ti = ctx.toolInput || ctx.tool_input || {};
  const payload = {
    evt: ctx.hookEventName || ctx.event || EVENT_ARG,
    ts: T0,
    boot_ms: BOOT_MS,
    dur_ms: Date.now() - T0,
    why: why,
    parse: parse,
    stdin_len: raw.length,
    sid: ctx.sessionId || ctx.session_id || null,
    src: ctx.source || null,
    tool: ctx.toolName || ctx.tool_name || null,
    file: ti.file_path || ti.path || ti.notebook_path || null,
    cwd: ctx.workingDirectory || ctx.cwd || process.cwd(),
    pid: process.pid
  };

  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, JSON.stringify(payload) + os.EOL);
  } catch (_) { /* never fail the hook */ }
  process.exit(0);
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => complete('end'));
process.stdin.on('error', () => complete('error'));
setTimeout(() => complete('timeout'), 600); // absolute backstop, keeps process alive at most 600ms
