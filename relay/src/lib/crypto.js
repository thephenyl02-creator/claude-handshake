// Crypto helpers for the relay. Web Crypto only — no Node builtins, so this
// runs unchanged in workerd.

const HEX = '0123456789abcdef';

function toHex(bytes) {
  let out = '';
  for (const b of bytes) out += HEX[b >> 4] + HEX[b & 15];
  return out;
}

export function randomHex(nBytes) {
  const bytes = new Uint8Array(nBytes);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}

// Compares two strings with no early exit: a wrong first character costs the
// same as a near-miss. Every token and digest comparison in the relay goes
// through this. Length is not secret here (all inputs are fixed-width hex).
export function timingSafeEqual(a, b) {
  // Fail closed on anything that is not a string: coercing to '' would make
  // two absent values compare equal, one careless call site away from an
  // authentication bypass.
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const A = a;
  const B = b;
  let diff = A.length ^ B.length;
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const ca = i < A.length ? A.charCodeAt(i) : 0;
    const cb = i < B.length ? B.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}
