#!/usr/bin/env node
'use strict';
// claude-handshake M12(a): the deterministic acceptance harness.
//
//   npm run test:e2e            both legs
//   npm run test:e2e -- --leg relay
//   npm run test:e2e -- --leg ntfy
//
// What this is: the whole product proved end to end WITHOUT a real Claude
// session - zero model tokens, CI-runnable, deterministic. Both simulated
// members are driven only through production surfaces: bin/handshake.js
// subcommands and hooks/*.js fed synthetic camelCase payloads on stdin, exactly
// as Claude Code sends them (docs/spike-findings.md [S1]).
//
// What this is NOT: M12(b). Real Claude sessions, the day-long ntfy publish
// budget and the WSL leg are manual and stay manual. Nothing here claims a
// measurement it did not take.
//
// It is deliberately OUTSIDE `npm test`: it needs two free ports and a
// `wrangler dev` process.

const path = require('path');

const H = require('./lib/harness');
const { Harness } = H;
const { MockNtfy } = require('./mock-ntfy');
const R = require('./lib/relay-dev');
const legRelay = require('./leg-relay');
const legNtfy = require('./leg-ntfy');

function parseArgs(argv) {
  const out = { leg: 'all' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--leg') out.leg = String(argv[++i] || 'all');
    else if (argv[i].startsWith('--leg=')) out.leg = argv[i].slice(6);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const h = new Harness();
  let mock = null;
  let relay = null;
  let exitCode = 1;

  const bail = async () => { try { await h.cleanup(); } catch (_) { /* best effort */ } };
  process.on('SIGINT', async () => { await bail(); process.exit(130); });
  process.on('SIGTERM', async () => { await bail(); process.exit(143); });

  H.line('');
  H.line(H.C.head + 'claude-handshake M12(a) — deterministic acceptance harness' + H.C.off);
  H.line(H.C.dim + '  node ' + process.version + ' · ' + process.platform + ' · repo ' + H.REPO_ROOT + H.C.off);
  H.line(H.C.dim + '  zero model tokens; real relay under wrangler dev; real adapter against a mock ntfy' + H.C.off);

  h.deviation('PLAN section 5 (task table, M12 row) says the CI leg isolates the two simulated Claude ' +
    'sessions with "separate `CLAUDE_CONFIG_DIR`". The harness isolates them with HANDSHAKE_STATE_DIR per ' +
    'member instead (e2e/lib/members.js env()). Both are real: lib/state.js stateRoot() honors ' +
    'HANDSHAKE_STATE_DIR first and CLAUDE_CONFIG_DIR/handshake second, so this is the higher-precedence, ' +
    'narrower override of the same state root - it isolates exactly what the config dir would have ' +
    'isolated here, and nothing else. CLAUDE_CONFIG_DIR is left unset/inherited for both members.');

  try {
    const root = h.tempDir('handshake-e2e-');
    H.line(H.C.dim + '  temp root ' + root + H.C.off);

    // ---------------------------------------------------------- LEG 1 -----
    if (args.leg === 'all' || args.leg === 'relay') {
      const t = Date.now();
      relay = await R.startRelay(h, {
        createToken: 'e2e-relay-create-token',
        persistDir: path.join(root, '.wrangler-persist'),
      });
      H.line(H.C.dim + '  wrangler dev on ' + relay.origin + ' (' + ((Date.now() - t) / 1000).toFixed(1) + 's to /health)' + H.C.off);
      if (!relay.health.ok) {
        H.line(H.C.fail + '  relay never became healthy; wrangler log follows' + H.C.off);
        H.line(relay.log().slice(-4000));
      }
      const ctx = { root: path.join(root, 'relay'), relay };
      await legRelay.run(h, ctx);
      relay.stop();
      relay = null;
    }

    // ---------------------------------------------------------- LEG 2 -----
    if (args.leg === 'all' || args.leg === 'ntfy') {
      mock = new MockNtfy();
      const port = await mock.start(0);
      H.line(H.C.dim + '  mock-ntfy on http://127.0.0.1:' + port + H.C.off);
      const ctx = { root: path.join(root, 'ntfy'), mock };
      await legNtfy.run(h, ctx);
      await mock.stop();
      mock = null;
    }

    // Findings and deviations are recorded BY THE LEG THAT OBSERVED THEM (see
    // the leg modules), so a single-leg run never reports something it did not
    // actually see.
    exitCode = h.summary() ? 0 : 1;
  } catch (e) {
    H.line(H.C.fail + 'harness aborted: ' + String((e && e.stack) || e) + H.C.off);
    exitCode = 1;
  } finally {
    if (relay) relay.stop();
    if (mock) { try { await mock.stop(); } catch (_) { /* ignore */ } }
    await h.cleanup();
  }

  process.exit(exitCode);
}

main();
