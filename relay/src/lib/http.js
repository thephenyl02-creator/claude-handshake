// Response helpers. Everything the relay returns is JSON and never cached.

const BASE_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff'
});

export function json(status, body, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, ...(extraHeaders || {}) }
  });
}

export function fail(status, code, extra) {
  return json(status, { error: code, ...(extra || {}) });
}

// Reads a JSON body with a hard size cap. Returns {ok,value} — never throws,
// and never surfaces the parse error text (it can quote the body).
export async function readJson(request, maxBytes) {
  const text = await request.text();
  if (text.length > maxBytes) return { ok: false, code: 'body_too_large' };
  if (text.trim() === '') return { ok: true, value: {} };
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, code: 'body_must_be_object' };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, code: 'body_not_json' };
  }
}
