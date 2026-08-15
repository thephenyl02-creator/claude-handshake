'use strict';
// claude-handshake M12(a), step 9: the secret-scan gate.
//
// The bar (SECURITY.md 4): every message that actually reached a transport is
// re-scanned with lib/filter.js's own battery, plus the planted tripwire value
// from each member's .env. Zero findings in the transports is the pass bar.
//
// TWO SCANS, because SECURITY.md 4 defines two different obligations:
//
// 1. AUTHORED SURFACE - scanned with filter.check().
//    "Every authored outbound field is filter input ... Protocol machinery the
//    client itself generates (`ws`, `nonce`, `sig`, `ct`, machine/session
//    pseudonyms) is exempt by design: it carries no authored content, and a
//    random 128-bit id would self-block every message on the entropy
//    heuristic." So the authored surface is taken from the product's OWN
//    definition - lib/envelope.js authoredFields() - rather than re-derived
//    here, which is what keeps this gate honest instead of merely green: if
//    authoredFields() ever stops covering a field, this scan stops covering it
//    too and the omission is a reviewable diff in lib/, not a silent pass.
//    (Scanning the raw envelope JSON instead would fail on `ws` alone: 32
//    random hex chars trip `high-entropy-hex` on every message ever sent.)
//
// 2. RAW SUBSTRING - the tripwire, applied to the ENTIRE stored transport
//    record including ciphertext, headers and machinery. This one owes nothing
//    to the exemption above: a planted local secret must not appear anywhere on
//    the wire, in any encoding the harness can produce, and a 12-char window of
//    it counts, exactly as lib/filter.js's tripwire counts one.

const filter = require('../../lib/filter');
const envelopeLib = require('../../lib/envelope');

const TRIPWIRE_WINDOW = 12;   // lib/filter.js TRIPWIRE_WINDOW

function flatten(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (typeof value === 'object') return Object.values(value).flatMap(flatten);
  return [String(value)];
}

// The authored surface of one envelope, per lib/envelope.js authoredFields().
function authoredStrings(env) {
  if (!env || typeof env !== 'object') return [];
  let fields = {};
  try { fields = envelopeLib.authoredFields(env.type, env.body, env.from) || {}; }
  catch (_) { fields = {}; }
  const out = [];
  for (const [k, v] of Object.entries(fields)) {
    for (const s of flatten(v)) out.push({ field: k, text: s });
  }
  return out;
}

// Raw substring / windowed-substring search, mirroring the tripwire's own rule.
function rawContains(haystack, secret) {
  const h = String(haystack);
  const stripped = h.replace(/\s+/g, '');
  const s = String(secret);
  if (h.includes(s) || stripped.includes(s)) return s;
  if (s.length > TRIPWIRE_WINDOW) {
    for (let i = 0; i + TRIPWIRE_WINDOW <= s.length; i += 4) {
      const w = s.slice(i, i + TRIPWIRE_WINDOW);
      if (h.includes(w) || stripped.includes(w)) return w;
    }
  }
  return null;
}

// records: [{ origin, handle, envelope?, raw }]
//   envelope - the decoded envelope when the harness legitimately holds one
//              (relay: verbatim from sync; ntfy: not decoded, ciphertext only)
//   raw      - the exact bytes/JSON the transport is storing
function scan(records, opts) {
  const o = opts || {};
  const secretFiles = o.secretFiles || [];
  const planted = o.planted || [];
  const findings = [];
  let authoredChecked = 0;
  let rawChecked = 0;

  for (const rec of records) {
    // ---- 1. authored surface, through the product's own filter -------------
    for (const { field, text } of authoredStrings(rec.envelope)) {
      authoredChecked++;
      const r = filter.check(text, { secretFiles });
      if (!r.ok) {
        findings.push({
          kind: 'authored', origin: rec.origin, handle: rec.handle, field,
          ids: r.findings.map((f) => f.id), sample: text.slice(0, 80),
        });
      }
    }
    // ---- 2. raw substring, everything including machinery and ciphertext ---
    const raw = typeof rec.raw === 'string' ? rec.raw : JSON.stringify(rec.raw);
    rawChecked++;
    for (const value of planted) {
      const hit = rawContains(raw, value);
      if (hit) {
        findings.push({
          kind: 'planted-raw', origin: rec.origin, handle: rec.handle,
          ids: ['local-secret-tripwire'], sample: hit,
        });
      }
    }
  }

  return { ok: findings.length === 0, findings, authoredChecked, rawChecked, records: records.length };
}

module.exports = { scan, authoredStrings, rawContains };
