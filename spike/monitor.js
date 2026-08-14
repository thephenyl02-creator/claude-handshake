#!/usr/bin/env node
// handshake-spike M0.5 monitor: proves whether plugin monitors start, tick on
// their own clock, and die with the session. CRITICAL: writes NOTHING to
// stdout — monitor stdout lines are delivered into the Claude session as
// notifications, and this spike must be invisible.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const LOG = path.join(os.homedir(), '.claude', 'handshake-spike.log');
const START = Date.now();

function write(evt) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, JSON.stringify({
      evt, ts: Date.now(), up_s: Math.round((Date.now() - START) / 1000),
      cwd: process.cwd(), pid: process.pid
    }) + os.EOL);
  } catch (_) { /* silent */ }
}

write('monitor.start');
setInterval(() => write('monitor.tick'), 60000);

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  try { process.on(sig, () => { write('monitor.stop.' + sig); process.exit(0); }); }
  catch (_) { /* some signals unsupported on Windows */ }
}
process.on('exit', () => write('monitor.exit'));
