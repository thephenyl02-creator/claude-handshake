// The public landing page at GET /.
//
// This file exists to be replaced. To ship a different page, replace the
// LANDING_HTML export below and change nothing else — the Worker imports only
// this one name.
//
// Two constraints apply to whatever page ends up here, not just this
// placeholder:
//
//   1. Fully self-contained. Inline CSS only, no external requests of any
//      kind — no stylesheet or font links, no <script src>, no remote images,
//      no fetch/XHR. Embed anything you need as a data: URI. A test enforces
//      this.
//   2. Zero workspace information. This page is unauthenticated, so it must
//      never render workspace ids, names, counts, member names, activity or
//      statistics. It is built from constants; keep it that way.

import { PROTOCOL_VERSION, RELAY_VERSION } from './version.js';

export const LANDING_HTML = `<!doctype html>
<meta charset="utf-8">
<title>claude-handshake relay</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;margin:3rem auto;max-width:34rem;padding:0 1rem;line-height:1.5}</style>
<h1>claude-handshake relay</h1>
<p>A private coordination relay for
<a href="https://github.com/thephenyl02-creator/claude-handshake">claude-handshake</a>.
Nothing to see here — every endpoint needs a credential.</p>
<p>Version ${RELAY_VERSION} &middot; protocol ${PROTOCOL_VERSION}</p>
`;
