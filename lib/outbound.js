'use strict';
// claude-handshake M2: the single outbound chokepoint.
//
// RULE (enforced by test/no-direct-send.test.js once transports exist): no
// code in this repo may hand data to a transport except through sendGate().
// Every field that leaves the machine — note bodies, presence notes, branch
// names, file lists, claim subjects — goes through the filter, not just
// "messages".

const filter = require('./filter');

class FilterViolation extends Error {
  constructor(findings) {
    super('outbound blocked by secret filter: ' + findings.map((f) => f.id).join(', '));
    this.name = 'FilterViolation';
    this.findings = findings;
  }
}

// fields: flat object of every user/model-authored string leaving the machine.
// Returns the fields untouched when clean; throws FilterViolation otherwise.
// Fail-closed: a filter-error finding blocks exactly like a real hit.
function sendGate(fields, opts) {
  const pieces = [];
  for (const [k, v] of Object.entries(fields || {})) {
    if (v == null) continue;
    if (Array.isArray(v)) pieces.push(...v.map((x) => String(x)));
    else pieces.push(String(v));
    void k;
  }
  const findings = [];
  for (const piece of pieces) {
    const res = filter.check(piece, opts);
    if (!res.ok) findings.push(...res.findings);
  }
  if (findings.length) throw new FilterViolation(findings);
  return fields;
}

module.exports = { sendGate, FilterViolation };
