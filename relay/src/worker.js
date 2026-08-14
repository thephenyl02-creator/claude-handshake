import { fail, json, readJson } from './lib/http.js';
import { logRedactedError } from './lib/log.js';
import { sha256Hex, timingSafeEqual } from './lib/crypto.js';
import { WS_ID_RE, newWorkspaceId } from './lib/tokens.js';
import { cfg } from './lib/config.js';
import { PROTOCOL_VERSION, RELAY_VERSION, SERVICE_NAME } from './version.js';
import { LANDING_HTML } from './landing.js';

export { WorkspaceDO } from './do/workspace.js';
export { RateLimiterDO } from './do/limiter.js';

// No module-scope mutable state anywhere in this Worker: an isolate is shared
// across requests and can be reused for a different eyeball, so anything
// mutable up here is a cross-request leak (PLAN section 3). Everything below
// is either a frozen constant or a pure function.

const MAX_REQUEST_BYTES = 16384;

function bearer(request) {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

function clientIp(request) {
  // Set by the edge; a client-supplied value is never read.
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

function limiterFor(env, ip) {
  return env.LIMITER.get(env.LIMITER.idFromName(ip));
}

function toResponse(result) {
  return json(result.status, result.body, result.headers);
}

async function handleCreate(request, env, ip) {
  const gate = await limiterFor(env, ip).guard([
    { key: 'authfail', limit: cfg(env, 'AUTH_FAIL_MAX'), window: cfg(env, 'AUTH_FAIL_WINDOW_SECONDS'), count: false },
    { key: 'create', limit: cfg(env, 'CREATE_RATE_MAX'), window: cfg(env, 'CREATE_RATE_WINDOW_SECONDS'), count: true }
  ]);
  if (!gate.allowed) {
    return json(429, { error: 'rate_limited', retry_after: gate.retry_after }, { 'retry-after': String(gate.retry_after) });
  }
  // Fail closed: an unconfigured relay refuses to mint workspaces rather than
  // letting anyone who finds the hostname create them.
  if (!env.RELAY_CREATE_TOKEN) return fail(503, 'relay_not_configured');

  const presented = bearer(request);
  const matches = timingSafeEqual(await sha256Hex(presented || ''), await sha256Hex(env.RELAY_CREATE_TOKEN));
  if (!presented || !matches) {
    await limiterFor(env, ip).penalize('authfail', cfg(env, 'AUTH_FAIL_WINDOW_SECONDS'));
    return fail(401, 'invalid_token');
  }

  const body = await readJson(request, MAX_REQUEST_BYTES);
  if (!body.ok) return fail(400, body.code);

  const ws = newWorkspaceId();
  const stub = env.WORKSPACE.get(env.WORKSPACE.idFromName(ws));
  return toResponse(await stub.dispatch('init', { ws, ip, body: body.value }));
}

async function route(request, env) {
  const url = new URL(request.url);
  const ip = clientIp(request);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/' || path === '/health') {
    const gate = await limiterFor(env, ip).guard([
      { key: 'public', limit: cfg(env, 'PUBLIC_RATE_MAX'), window: cfg(env, 'PUBLIC_RATE_WINDOW_SECONDS'), count: true }
    ]);
    if (!gate.allowed) {
      return json(429, { error: 'rate_limited', retry_after: gate.retry_after }, { 'retry-after': String(gate.retry_after) });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405, 'method_not_allowed');
    // Both responses are built from frozen constants only. No workspace is
    // ever read here, so neither can leak workspace ids, names, counts or
    // activity to an unauthenticated caller.
    if (path === '/health') {
      return json(200, { ok: true, service: SERVICE_NAME, version: RELAY_VERSION, protocol: PROTOCOL_VERSION });
    }
    return new Response(LANDING_HTML, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }
    });
  }

  const segments = path.split('/').filter(Boolean);
  if (segments[0] !== 'ws') return fail(404, 'not_found');

  if (segments.length === 1) {
    if (request.method !== 'POST') return fail(405, 'method_not_allowed');
    return handleCreate(request, env, ip);
  }

  const ws = segments[1];
  if (!WS_ID_RE.test(ws)) return fail(404, 'workspace_not_found');
  const stub = env.WORKSPACE.get(env.WORKSPACE.idFromName(ws));

  const call = async (op, params) => {
    const input = { ws, ip, auth: bearer(request), params: params || {}, query: {}, body: {} };
    if (op === 'sync') {
      input.query = { cursor: url.searchParams.get('cursor') };
    } else {
      const body = await readJson(request, MAX_REQUEST_BYTES);
      if (!body.ok) return fail(400, body.code);
      input.body = body.value;
    }
    return toResponse(await stub.dispatch(op, input));
  };

  if (segments.length === 2) {
    if (request.method !== 'DELETE') return fail(405, 'method_not_allowed');
    return call('destroy');
  }

  const action = segments[2];
  if (segments.length === 5 && action === 'members' && segments[4] === 'remove') {
    if (request.method !== 'POST') return fail(405, 'method_not_allowed');
    return call('member_remove', { member: segments[3] });
  }
  if (segments.length !== 3) return fail(404, 'not_found');

  if (action === 'sync') {
    if (request.method !== 'GET') return fail(405, 'method_not_allowed');
    return call('sync');
  }
  const posts = new Set(['join', 'heartbeat', 'claim', 'release', 'post', 'cursor', 'rotate', 'purge']);
  if (!posts.has(action)) return fail(404, 'not_found');
  if (request.method !== 'POST') return fail(405, 'method_not_allowed');
  return call(action);
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      // Nothing from the request reaches the log — see src/lib/log.js.
      logRedactedError('unhandled', error);
      return fail(500, 'internal_error');
    }
  }
};
