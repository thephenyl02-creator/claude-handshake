import { env, exports as workerExports } from 'cloudflare:workers';

export const BASE = 'https://relay.test';
export const CREATE_TOKEN = 'test-create-token-not-a-real-secret';

let ipCounter = 0;

// Every call gets its own client IP unless one is passed. The per-IP limiters
// are real in these tests, so sharing an IP across unrelated tests would make
// them interfere; the rate-limit tests pin an IP on purpose.
export function newIp() {
  ipCounter += 1;
  return '203.0.113.' + (ipCounter % 250) + '.' + ipCounter;
}

export async function call(method, path, options = {}) {
  const headers = {};
  if (options.token) headers.authorization = 'Bearer ' + options.token;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  headers['cf-connecting-ip'] = options.ip || newIp();
  const request = new Request(BASE + path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const response = await workerExports.default.fetch(request);
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: response.status, body, text, headers: response.headers };
}

export async function createWorkspace(name) {
  const res = await call('POST', '/ws', { token: CREATE_TOKEN, body: { name: name || 'test-ws' } });
  if (res.status !== 201) throw new Error('create failed: ' + res.status + ' ' + res.text);
  return res.body;
}

export async function join(ws, member, extra) {
  const res = await call('POST', '/ws/' + ws.ws + '/join', {
    token: ws.enrollment_token,
    body: { member, ...(extra || {}) }
  });
  if (res.status !== 201) throw new Error('join failed: ' + res.status + ' ' + res.text);
  return res.body;
}

export async function setup(members) {
  const ws = await createWorkspace();
  const joined = {};
  for (const name of members) joined[name] = await join(ws, name);
  return { ws, members: joined };
}

function wsId(ws) {
  return typeof ws === 'string' ? ws : ws.ws;
}

// A protocol-valid envelope for `member` in `ws`. `ws` and the full `from`
// triple are filled in from the authenticated identity because both are
// REQUIRED and both are matched by the relay (PROTOCOL section 2.1, Appendix B
// A2/A5); overrides win, so a test can still send a broken one on purpose.
export function envelope(ws, member, type, overrides = {}) {
  const memberId = typeof member === 'string' ? member : member.member_id;
  return {
    v: 1,
    ws: wsId(ws),
    from: {
      member: memberId,
      machine: 'm-' + memberId.slice(0, 8),
      session: 's-' + memberId
    },
    type,
    body: { text: 'hello' },
    ts: Date.now(),
    nonce: 'nonce' + Math.random().toString(36).slice(2, 12),
    sender_seq: 1,
    sig: 'deadbeef',
    ...overrides
  };
}

export function post(ws, member, env_) {
  return call('POST', '/ws/' + wsId(ws) + '/post', {
    token: typeof member === 'string' ? member : member.token,
    body: { envelope: env_ }
  });
}

// The common case: build a valid envelope and post it as that member.
export function send(ws, member, type, overrides) {
  return post(ws, member, envelope(ws, member, type, overrides));
}

export function workspaceStub(wsIdValue) {
  return env.WORKSPACE.get(env.WORKSPACE.idFromName(wsIdValue));
}
