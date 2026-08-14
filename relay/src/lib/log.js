// The ONE logging call site in the relay.
//
// PLAN section 3: "never log bodies, redact Authorization (tested)". This file
// is the single exception permitted by test/node/source-guard.test.js, and it
// is deliberately incapable of printing user data: only a fixed code and the
// error's constructor name ever reach the log. Error messages are NOT logged —
// a thrown SQL or JSON error can quote the row or body that caused it.

export function logRedactedError(code, err) {
  const name = err && typeof err === 'object' && typeof err.name === 'string' ? err.name : 'Error';
  console.error('handshake-relay error code=' + String(code) + ' type=' + name);
}
