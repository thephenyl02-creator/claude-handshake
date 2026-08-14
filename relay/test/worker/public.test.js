import { describe, expect, it } from 'vitest';
import { call, createWorkspace, join } from './helpers.js';
import { PROTOCOL_VERSION, RELAY_VERSION, SERVICE_NAME } from '../../src/version.js';

describe('public endpoints', () => {
  // These assertions are deliberately generic: src/landing.js is meant to be
  // replaced with a designed page, and swapping that one file must not break
  // any test here.
  it('serves the landing page without auth', async () => {
    const res = await call('GET', '/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.text.length).toBeGreaterThan(50);
    expect(res.text.toLowerCase()).toContain('<title');
  });

  it('keeps the landing page fully self-contained', async () => {
    const html = (await call('GET', '/')).text;
    const forbidden = [
      [/<script[^>]+\bsrc\s*=/i, 'external script'],
      [/<link[^>]+\bhref\s*=\s*["']?(?!data:)[^"'>]+/i, 'linked stylesheet or font'],
      [/<(img|iframe|video|audio|source)[^>]+\bsrc\s*=\s*["']?(?!data:)[a-z]+:/i, 'remote media'],
      [/@import/i, 'css @import'],
      [/\bfetch\s*\(|XMLHttpRequest|EventSource|WebSocket/i, 'runtime network call']
    ];
    for (const [pattern, what] of forbidden) {
      expect(pattern.test(html), 'landing page must not use ' + what).toBe(false);
    }
  });

  it('serves /health with the exact documented shape and no auth', async () => {
    const res = await call('GET', '/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      service: SERVICE_NAME,
      version: RELAY_VERSION,
      protocol: PROTOCOL_VERSION
    });
    expect(Object.keys(res.body).sort()).toEqual(['ok', 'protocol', 'service', 'version']);
  });

  it('reveals nothing about existing workspaces', async () => {
    const ws = await createWorkspace('secret-project');
    const member = await join(ws, 'alice');
    await call('POST', '/ws/' + ws.ws + '/heartbeat', { token: member.token, body: { state: 'working' } });

    for (const path of ['/', '/health']) {
      const res = await call('GET', path);
      const haystack = res.text;
      for (const secret of [ws.ws, ws.enrollment_token, ws.recovery_key, member.token, member.member_id, 'secret-project', 'alice']) {
        expect(haystack).not.toContain(secret);
      }
      // No counts or activity of any kind: the body is built from constants.
      expect(haystack).not.toMatch(/workspaces?["'\s:=]+\d/i);
    }
  });

  it('rejects non-GET on the public endpoints', async () => {
    const res = await call('POST', '/health', { body: {} });
    expect(res.status).toBe(405);
  });

  it('404s unknown paths', async () => {
    const res = await call('GET', '/admin');
    expect(res.status).toBe(404);
  });
});
