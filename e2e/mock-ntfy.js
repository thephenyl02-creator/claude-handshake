#!/usr/bin/env node
'use strict';
// claude-handshake M12(a): a faithful mock of the ntfy surface our adapter
// actually uses. It exists so LEG 2 tests OUR adapter honestly - the cursor
// ladder, the fair selection, the encrypted wire form and the
// beyond-the-cache-window truncation rule - without depending on ntfy.sh being
// reachable, without spending a public topic, and without a day-long budget
// measurement (that is M12(b)).
//
// Surface reproduced, exactly the three things lib/transport-ntfy.js calls:
//
//   POST /<topic>                      body = the message text (our JSON wire
//                                      form). Responds with the ntfy message
//                                      JSON: {id, time, event, topic, message}.
//   GET  /<topic>/json?poll=1&since=X  NDJSON, one JSON object per line, in
//                                      publish order. `since` accepts:
//                                        all          -> everything in cache
//                                        <message_id> -> strictly AFTER that id
//                                        <unix_ts>    -> time >= that second
//   (cache window)                     a configurable retention window; a
//                                      message older than it is simply not in
//                                      the poll result, which is what makes the
//                                      "stop pretending" rule of PROTOCOL 6.4
//                                      testable rather than theoretical.
//
// Everything else answers 404 with a JSON error, like ntfy does.
//
// Two harness-only endpoints, namespaced so they can never collide with a
// topic name (ntfy topics cannot contain `__` at the start of a path segment in
// our generator - they are 32 lowercase hex chars):
//
//   GET /__store     every stored message, with its topic
//   GET /__requests  the request log (method, path, at) - this is how LEG 2
//                    proves a child session performed ZERO transport I/O

const http = require('http');
const crypto = require('crypto');

const DEFAULT_CACHE_WINDOW_MS = 12 * 3600 * 1000;   // ntfy's ~12 h, PROTOCOL 6.4
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function newId() {
  let s = '';
  const bytes = crypto.randomBytes(12);
  for (let i = 0; i < 12; i++) s += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return s;
}

class MockNtfy {
  constructor(opts) {
    const o = opts || {};
    this.cacheWindowMs = Number.isInteger(o.cacheWindowMs) ? o.cacheWindowMs : DEFAULT_CACHE_WINDOW_MS;
    this.messages = [];              // [{topic, id, time, message, ordinal, at}]
    this.requests = [];              // [{method, path, at}]
    this.ordinal = 0;
    this.server = null;
    this.port = null;
    this.rateLimit = null;           // set to a number to answer 429 after N publishes
    this.publishes = 0;
  }

  // --------------------------------------------------------------- store ---

  store(topic, message, opts) {
    const o = opts || {};
    const at = Number.isInteger(o.at) ? o.at : Date.now();
    const row = {
      topic: String(topic),
      id: newId(),
      time: Math.floor(at / 1000),
      event: 'message',
      message: String(message),
      ordinal: ++this.ordinal,
      at,
    };
    this.messages.push(row);
    return row;
  }

  // Plant a message that is already older than the cache window, so a poll can
  // be shown to genuinely drop it.
  seed(topic, message, ageMs) {
    return this.store(topic, message, { at: Date.now() - Number(ageMs || 0) });
  }

  inCache(row, now) {
    return (now - row.at) <= this.cacheWindowMs;
  }

  poll(topic, since, now) {
    const t = Number.isInteger(now) ? now : Date.now();
    const all = this.messages.filter((m) => m.topic === topic && this.inCache(m, t));
    const raw = since === undefined || since === null ? 'all' : String(since);
    if (raw === 'all' || raw === '') return { rows: all, tier: 'all' };
    const byId = this.messages.find((m) => m.id === raw);
    if (byId) return { rows: all.filter((m) => m.ordinal > byId.ordinal), tier: 'message_id' };
    if (/^\d+$/.test(raw)) {
      const ts = Number(raw);
      return { rows: all.filter((m) => m.time >= ts), tier: 'unix_ts' };
    }
    // ntfy answers 400 for a malformed `since`; an id it no longer holds
    // (evicted from the cache) degrades to the whole cache, which is exactly
    // the case the client must report as truncated rather than as silence.
    return { rows: all, tier: 'unknown_since' };
  }

  storedFor(topic) { return this.messages.filter((m) => m.topic === topic); }

  requestCount(filter) {
    if (!filter) return this.requests.length;
    return this.requests.filter(filter).length;
  }

  // ---------------------------------------------------------------- http ---

  _handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const at = Date.now();
    this.requests.push({ method: req.method, path: url.pathname, query: url.search, at });

    const json = (status, value) => {
      const body = JSON.stringify(value);
      res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
    };

    if (url.pathname === '/__store') return json(200, { messages: this.messages, cache_window_ms: this.cacheWindowMs });
    if (url.pathname === '/__requests') return json(200, { requests: this.requests });
    if (url.pathname === '/__reset') { this.messages = []; this.requests = []; return json(200, { ok: true }); }

    const parts = url.pathname.split('/').filter(Boolean);

    // GET /<topic>/json?poll=1&since=X
    if (req.method === 'GET' && parts.length === 2 && parts[1] === 'json') {
      const topic = parts[0];
      const since = url.searchParams.get('since');
      const { rows } = this.poll(topic, since, at);
      const body = rows.map((m) => JSON.stringify({
        id: m.id, time: m.time, event: 'message', topic: m.topic, message: m.message,
      })).join('\n') + (rows.length ? '\n' : '');
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Content-Length': Buffer.byteLength(body) });
      return res.end(body);
    }

    // POST /<topic>
    if (req.method === 'POST' && parts.length === 1) {
      const topic = parts[0];
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        this.publishes++;
        if (this.rateLimit !== null && this.publishes > this.rateLimit) {
          return json(429, { code: 42901, http: 429, error: 'limit reached' });
        }
        if (Buffer.byteLength(raw, 'utf8') > 4096) {
          return json(413, { code: 41301, http: 413, error: 'message too large' });
        }
        const row = this.store(topic, raw);
        return json(200, {
          id: row.id, time: row.time, expires: row.time + Math.floor(this.cacheWindowMs / 1000),
          event: 'message', topic: row.topic, message: row.message,
        });
      });
      return undefined;
    }

    return json(404, { code: 40401, http: 404, error: 'page not found' });
  }

  start(port) {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        try { this._handle(req, res); }
        catch (e) {
          try { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(e && e.message) })); }
          catch (_) { /* socket gone */ }
        }
      });
      this.server.on('error', reject);
      this.server.listen(port || 0, '127.0.0.1', () => {
        this.port = this.server.address().port;
        resolve(this.port);
      });
    });
  }

  get baseUrl() { return 'http://127.0.0.1:' + this.port; }

  stop() {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server.closeAllConnections && this.server.closeAllConnections();
    });
  }
}

module.exports = { MockNtfy, DEFAULT_CACHE_WINDOW_MS };

if (require.main === module) {
  const argPort = Number(process.argv[2]) || 0;
  const mock = new MockNtfy();
  mock.start(argPort).then((port) => {
    process.stdout.write('mock-ntfy listening on http://127.0.0.1:' + port + '\n');
  });
}
