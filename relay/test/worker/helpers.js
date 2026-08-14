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

export async function join(ws, member) {
  const res = await call('POST', '/ws/' + ws.ws + '/join', {
    token: ws.enrollment_token,
    body: { member }
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

export function envelope(type, overrides = {}) {
  return {
    v: 1,
    type,
    body: { text: 'hello' },
    ts: Date.now(),
    nonce: 'nonce' + Math.random().toString(36).slice(2, 12),
    seq: 1,
    sig: 'deadbeef',
    ...overrides
  };
}

export function workspaceStub(wsId) {
  return env.WORKSPACE.get(env.WORKSPACE.idFromName(wsId));
}
