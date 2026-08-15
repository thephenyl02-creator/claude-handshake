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
  // Scheme-agnostic: ANY `scheme://user:password@host`, not a fixed allowlist —
  // mssql/mariadb/clickhouse/cassandra/snowflake/jdbc etc. are just as common a
  // paste as postgres. The inline user:pass@host is the whole signal.
  { id: 'conn-string-creds', re: /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:@/]+:[^\s@/]{2,}@/i },
  { id: 'secret-assignment', re: /\b(api[_-]?key|apikey|secret|token|passwd|password|pwd|credential|auth)s?\b\s*[:=]\s*["']?[A-Za-z0-9+/_.-]{12,}/i },
  // Branded credential prefixes red-teamed as 100%-leak (Twilio/Shopify/Vault/
  // DigitalOcean/Stripe-restricted/GitHub-fine-grained/OpenAI project keys).
  { id: 'branded-token',     re: /\b(SK[0-9a-f]{32}|shpat_[a-f0-9]{32}|hvs\.[A-Za-z0-9_-]{20,}|dop_v1_[a-f0-9]{64}|rk_(live|test)_[A-Za-z0-9]{16,}|sk-proj-[A-Za-z0-9_-]{20,})\b/ },
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

// A 40/64-hex run is usually a git SHA or a content digest — but next to a
// credential word it is a key. Red team measured bare 40/64-hex leaking 100%;
// this is the proximity rescue for the accidental-paste case.
const CRED_WORD_NEAR_RE = /(?:key|token|secret|password|passwd|pwd|credential|auth|bearer|api)[^\n]{0,24}$/i;

function entropyFindings(text) {
  const out = [];
  const re = /[A-Za-z0-9+/=_-]{24,}/g;
  const tokens = [];
  let m;
  while ((m = re.exec(text)) !== null) tokens.push({ t: m[0], before: text.slice(Math.max(0, m.index - 40), m.index) });
  for (const { t, before } of tokens) {
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
      // saturate dev chatter, so they are skipped BY DEFAULT — unless a
      // credential word sits right before them, which a SHA never has.
      if (t.length === 40 || t.length === 64) {
        if (CRED_WORD_NEAR_RE.test(before)) out.push({ id: 'hex-key-in-credential-context', detail: t.slice(0, 8) + '…' });
        continue;
      }
      // 32-hex keys measured a mean Shannon of ~3.61 - just under the old 3.7
      // floor, so most real ones leaked. 3.4 keeps digests out and keys in.
      if (t.length >= 32 && (shannon(t) >= 3.4 || CRED_WORD_NEAR_RE.test(before))) out.push({ id: 'high-entropy-hex', detail: t.slice(0, 8) + '…' });
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
  for (const f of files.slice(0, MAX_SECRET_FILES)) {
    let body;
    try { body = fs.readFileSync(f, 'utf8').slice(0, 64 * 1024); } catch (_) { continue; }
    if (/\.(pem|key)$/i.test(f) || /PRIVATE KEY-----/.test(body)) {
      const b64 = body.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
      if (b64.length >= TRIPWIRE_MIN_LEN) values.push(b64);
      continue;
    }
    // Structured JSON first: a real secret.json is usually ONE line
    // ({"secret":"..."}), which no line-oriented regex can read. Walk every
    // string value instead - the red team leaked exactly this shape.
    if (/\.json$/i.test(f) || /^\s*[[{]/.test(body)) {
      try {
        const seen = [];
        (function walkJson(node, depth) {
          if (depth > 6 || seen.length > 200) return;
          if (typeof node === 'string') { if (node.length >= TRIPWIRE_MIN_LEN) seen.push(node); return; }
          if (Array.isArray(node)) { for (const v of node) walkJson(v, depth + 1); return; }
          if (node && typeof node === 'object') { for (const k of Object.keys(node)) walkJson(node[k], depth + 1); }
        })(JSON.parse(body), 0);
        for (const v of seen) values.push(v);
        continue;
      } catch (_) { /* not valid JSON - fall through to the line scan */ }
    }
    for (const line of body.split(/\r?\n/)) {
      // KEY=value (.env, .npmrc, ini) AND "key": "value" / key: value
      // (JSON, YAML) - secret.json and config/*.yml are ordinary carriers.
      const m = /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*=\s*(.+?)\s*$/.exec(line) ||
                /^\s*["']?[A-Za-z_][A-Za-z0-9_.-]*["']?\s*:\s*(.+?)\s*,?\s*$/.exec(line);
      if (!m) continue;
      let val = m[1].replace(/^["']|["']$/g, '').replace(/,$/, '');
      if (val.length < TRIPWIRE_MIN_LEN) continue;
      if (/^(true|false|null|undefined|localhost|127\.0\.0\.1|development|production|test|\{|\[)$/i.test(val)) continue;
      values.push(val);
    }
  }
  return values;
}

// Secret-bearing filenames. Red team showed the old set (top-level .env/.pem/
// .key only) missed secret.json, config/*.yml, id_rsa and everything in a
// subdirectory — all INSIDE the project and all ordinary accidental-paste
// sources.
const SECRET_FILE_RE = /^(?:\.env(?:\..+)?|.*\.(?:pem|key|p12|pfx)|id_[a-z0-9]+|credentials(?:\.[a-z]+)?|secrets?\.(?:json|ya?ml|toml|ini)|\.npmrc|\.netrc|\.pgpass|service-account.*\.json|.*[_-]secrets?\.(?:json|ya?ml|toml|ini))$/i;
const SKIP_DIR_RE = /^(?:node_modules|\.git|dist|build|out|coverage|\.next|\.cache|vendor|target|\.wrangler)$/i;
const MAX_SECRET_FILES = 40;
const MAX_SCAN_DEPTH = 3;

function defaultSecretFiles(projectDir) {
  const files = [];
  const walk = (dir, depth) => {
    if (depth > MAX_SCAN_DEPTH || files.length >= MAX_SECRET_FILES) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      if (files.length >= MAX_SECRET_FILES) return;
      if (e.isDirectory()) {
        if (!SKIP_DIR_RE.test(e.name)) walk(path.join(dir, e.name), depth + 1);
      } else if (SECRET_FILE_RE.test(e.name)) {
        files.push(path.join(dir, e.name));
      }
    }
  };
  walk(projectDir, 0);
  return files;
}

function tripwireFindings(text, opts) {
  const files = opts.secretFiles || (opts.projectDir ? defaultSecretFiles(opts.projectDir) : []);
  if (!files.length) return [];
  // The tripwire gets the SAME normalization the pattern battery gets - the
  // docs promised it and the red team proved base64(secret) sailed through.
  // Case-folded too: a hex credential is fully recoverable after .toUpperCase().
  const haystacks = [];
  for (const v of variantsOf(text)) haystacks.push(v, v.toLowerCase());
  haystacks.push(text.split('').reverse().join(''));      // reverse() is the other trivial transform
  const out = [];
  for (const raw of readSecretValues(files)) {
    const secret = raw.toLowerCase();
    let hit = haystacks.some((h) => h.includes(raw) || h.toLowerCase().includes(secret));
    if (!hit && secret.length > TRIPWIRE_WINDOW) {
      for (let i = 0; i + TRIPWIRE_WINDOW <= secret.length && !hit; i += 4) {
        const w = secret.slice(i, i + TRIPWIRE_WINDOW);
        hit = haystacks.some((h) => h.toLowerCase().includes(w));
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
