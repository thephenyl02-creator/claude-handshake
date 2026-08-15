'use strict';
// claude-handshake M2: outbound secret filter.
//
// Honest contract (see SECURITY.md when it lands): this is a seatbelt against
// ACCIDENTAL disclosure plus one genuinely fail-closed control (the local-
// secret tripwire). It is not a defense against a motivated adversary or a
// deliberately manipulated model. Chunking a secret across many messages
// defeats per-message scanning by construction; the 2 KB cap and the tripwire
// narrow that hole, they do not close it.
//
// API:
//   check(text, opts) -> { ok, findings: [{id, detail?}] }
//     opts.projectDir  — enables the local-secret tripwire (.env*, *.pem)
//     opts.secretFiles — explicit file list for the tripwire (overrides glob)
//   Any internal error returns ok:false (fail closed), never throws.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { HANDSHAKE_CREDENTIAL_SHAPES } = require('./secret-shapes');

const MAX_BYTES = 2048;          // spec: envelope body cap
const TRIPWIRE_MIN_LEN = 8;      // shortest local-secret value we track
const TRIPWIRE_WINDOW = 12;      // substring window that still counts as a leak

// ---------------------------------------------------------------- patterns --
const PATTERNS = [
  // no \b anchors: must also hit inside whitespace-stripped variants
  { id: 'aws-access-key',    re: /(A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}/ },
  { id: 'github-token',      re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|github_pat_[A-Za-z0-9_]{22,}/ },
  { id: 'slack-token',       re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'google-api-key',    re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'anthropic-key',     re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { id: 'openai-style-key',  re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { id: 'stripe-key',        re: /\b[rs]k_(live|test)_[A-Za-z0-9]{16,}\b/ },
  { id: 'npm-token',         re: /\bnpm_[A-Za-z0-9]{30,}\b/ },
  { id: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'jwt',               re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { id: 'telegram-bot-token',re: /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}\b/ },
  { id: 'conn-string-creds', re: /\b(https?|postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqps?|ftp|sftp):\/\/[^\s:@/]+:[^\s@/]+@/i },
  { id: 'secret-assignment', re: /\b(api[_-]?key|apikey|secret|token|passwd|password|pwd|credential)s?\b\s*[:=]\s*["']?[A-Za-z0-9+/_.-]{12,}/i },
  { id: 'env-block',         re: /(^|\n)\s*[A-Z][A-Z0-9_]{2,}=\S{4,}(\n\s*[A-Z][A-Z0-9_]{2,}=\S{4,}){2,}/ },
  // claude-handshake's own credentials — ALL of them, from the shared shape
  // list, so the entropy heuristic is never the only thing standing between a
  // recovery key or an inline invite (== the whole workspace) and a note body.
  // The old code caught only hsk_; hsr_/hsm_/hsi1_ fell through ~1-in-3 times.
  ...HANDSHAKE_CREDENTIAL_SHAPES,
];

// ----------------------------------------------------------------- entropy --
function shannon(s) {
  const freq = Object.create(null);
  for (const ch of s) freq[ch] = (freq[ch] || 0) + 1;
  let h = 0;
  for (const k in freq) {
    const p = freq[k] / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function entropyFindings(text) {
  const out = [];
  const tokens = text.match(/[A-Za-z0-9+/=_-]{24,}/g) || [];
  for (const t of tokens) {
    if (UUID_RE.test(t)) continue;                       // UUIDs are everywhere
    // A blob that base64-decodes to readable text is judged by its DECODED
    // content (scanned as a separate variant) — only opaque randomness flags.
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(t)) {
      try {
        const s = Buffer.from(t, 'base64').toString('utf8');
        const printable = s.replace(/[^\x20-\x7e\n\t]/g, '');
        if (s.length >= 12 && printable.length / s.length > 0.8) continue;
      } catch (_) {}
    }
    const hexish = /^[0-9a-fA-F]{24,}$/.test(t);
    if (hexish) {
      // 40-hex = git SHA-1, 64-hex = content digests: public identifiers that
      // saturate dev chatter. Documented tradeoff: hex secrets of exactly
      // these lengths slip the entropy net (pattern battery still applies).
      if (t.length === 40 || t.length === 64) continue;
      if (t.length >= 32 && shannon(t) >= 3.7) out.push({ id: 'high-entropy-hex', detail: t.slice(0, 8) + '…' });
    } else {
      if (t.length >= 28 && shannon(t) >= 4.4) out.push({ id: 'high-entropy-token', detail: t.slice(0, 8) + '…' });
    }
  }
  return out;
}

// ---------------------------------------------------------- normalization --
function base64Decodes(text) {
  const out = [];
  const cands = text.match(/[A-Za-z0-9+/]{24,}={0,2}/g) || [];
  for (const c of cands.slice(0, 32)) {
    try {
      const buf = Buffer.from(c, 'base64');
      if (buf.length < 12) continue;
      // gzip bomb-let: one transparent gunzip level
      if (buf[0] === 0x1f && buf[1] === 0x8b) {
        try { out.push(zlib.gunzipSync(buf).toString('utf8').slice(0, MAX_BYTES)); } catch (_) {}
        continue;
      }
      const s = buf.toString('utf8');
      const printable = s.replace(/[^\x20-\x7e\n\t]/g, '');
      if (printable.length / Math.max(s.length, 1) > 0.8) out.push(printable);
    } catch (_) {}
  }
  return out;
}

function hexDecodes(text) {
  const out = [];
  const cands = text.match(/(?:[0-9a-fA-F]{2}){16,}/g) || [];
  for (const c of cands.slice(0, 32)) {
    try {
      const s = Buffer.from(c, 'hex').toString('utf8');
      const printable = s.replace(/[^\x20-\x7e\n\t]/g, '');
      if (printable.length / Math.max(s.length, 1) > 0.8) out.push(printable);
    } catch (_) {}
  }
  return out;
}

function variantsOf(text) {
  const v = [text];
  const stripped = text.replace(/\s+/g, '');
  if (stripped !== text) v.push(stripped);           // whitespace-split bypass
  for (const d of base64Decodes(text)) v.push(d, d.replace(/\s+/g, ''));
  for (const d of hexDecodes(text)) v.push(d);
  return v;
}

// -------------------------------------------------------------- tripwire ---
function readSecretValues(files) {
  const values = [];
  for (const f of files.slice(0, 20)) {
    let body;
    try { body = fs.readFileSync(f, 'utf8').slice(0, 64 * 1024); } catch (_) { continue; }
    if (/\.(pem|key)$/i.test(f) || /PRIVATE KEY-----/.test(body)) {
      const b64 = body.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
      if (b64.length >= TRIPWIRE_MIN_LEN) values.push(b64);
      continue;
    }
    for (const line of body.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.+?)\s*$/.exec(line);
      if (!m) continue;
      let val = m[1].replace(/^["']|["']$/g, '');
      if (val.length < TRIPWIRE_MIN_LEN) continue;
      if (/^(true|false|null|undefined|localhost|127\.0\.0\.1|development|production|test)$/i.test(val)) continue;
      values.push(val);
    }
  }
  return values;
}

function defaultSecretFiles(projectDir) {
  const files = [];
  let entries = [];
  try { entries = fs.readdirSync(projectDir); } catch (_) { return files; }
  for (const e of entries) {
    if (/^\.env(\..+)?$/.test(e) || /\.(pem|key)$/i.test(e)) files.push(path.join(projectDir, e));
  }
  return files;
}

function tripwireFindings(text, opts) {
  const files = opts.secretFiles || (opts.projectDir ? defaultSecretFiles(opts.projectDir) : []);
  if (!files.length) return [];
  const haystacks = [text, text.replace(/\s+/g, '')];
  const out = [];
  for (const secret of readSecretValues(files)) {
    let hit = haystacks.some((h) => h.includes(secret));
    if (!hit && secret.length > TRIPWIRE_WINDOW) {
      for (let i = 0; i + TRIPWIRE_WINDOW <= secret.length && !hit; i += 4) {
        const w = secret.slice(i, i + TRIPWIRE_WINDOW);
        hit = haystacks.some((h) => h.includes(w));
      }
    }
    if (hit) out.push({ id: 'local-secret-tripwire' });
  }
  return out;
}

// ------------------------------------------------------------------ check --
function check(text, opts) {
  try {
    opts = opts || {};
    if (typeof text !== 'string') return { ok: false, findings: [{ id: 'not-a-string' }] };
    if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return { ok: false, findings: [{ id: 'size-cap' }] };

    const findings = [];
    for (const variant of variantsOf(text)) {
      for (const p of PATTERNS) {
        if (p.re.test(variant)) findings.push({ id: p.id });
      }
      findings.push(...entropyFindings(variant));
    }
    findings.push(...tripwireFindings(text, opts));

    const seen = new Set();
    const unique = findings.filter((f) => !seen.has(f.id) && seen.add(f.id));
    return { ok: unique.length === 0, findings: unique };
  } catch (err) {
    return { ok: false, findings: [{ id: 'filter-error', detail: String(err && err.message) }] };
  }
}

module.exports = { check, MAX_BYTES, _internals: { shannon, variantsOf, readSecretValues } };
