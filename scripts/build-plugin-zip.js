'use strict';
// M14 release: build the plugin distribution zip.
//
// Pure Node (zlib only) — writes forward-slash entry names directly, so it
// sidesteps the claude-tier trap where PowerShell Compress-Archive emits
// backslash entries that break extraction on Linux, and needs no WSL/python.
// Deterministic: fixed mtime, sorted entries — same input → same bytes → same
// sha256, so the marketplace hash is reproducible.
//
//   node scripts/build-plugin-zip.js <version>   ->  dist/claude-handshake-plugin-<version>.zip + prints sha256

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('usage: node scripts/build-plugin-zip.js <x.y.z>');
  process.exit(2);
}

// The plugin distribution. This list and package.json "files" name the SAME
// set — test/build-plugin-zip.test.js asserts it, so npm and the zip cannot
// drift apart. NOT test/, e2e/, spike/, node_modules, .git, .wrangler.
// NOTE: both spell out '.claude-plugin/plugin.json' rather than naming the
// '.claude-plugin' directory, because marketplace.json sits beside it and must
// stay out: it carries this zip's own sha256 in plugins[].source.sha256, so
// shipping it would make the hash depend on itself. (claude-tier's release
// format excludes it for the same reason.) Nothing is lost by omitting it —
// the catalog is fetched from the repo over raw.githubusercontent.com, never
// from the archive [C docs/INSTALL.md:131].
const INCLUDE = [
  '.claude-plugin/plugin.json',
  'LICENSE', 'README.md',
  'bin', 'lib', 'hooks', 'monitors', 'commands', 'skills', 'installers',
  'docs/PROTOCOL.md', 'docs/SECURITY.md', 'docs/INSTALL.md', 'PLAN.md',
  'relay/src', 'relay/wrangler.toml', 'relay/package.json', 'relay/README.md',
];

// ---- gather files (sorted, forward-slash relative paths) -------------------
function walk(rel, out) {
  const abs = path.join(ROOT, rel);
  const st = fs.statSync(abs);
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(abs).sort()) walk(rel + '/' + name, out);
  } else {
    out.push(rel.split(path.sep).join('/'));
  }
}
const files = [];
for (const item of INCLUDE) {
  if (!fs.existsSync(path.join(ROOT, item))) { console.error('missing: ' + item); process.exit(1); }
  walk(item, files);
}
files.sort();

// ---- minimal ZIP (deflate via zlib) ----------------------------------------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return (buf) => { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
})();
const DOS_TIME = 0, DOS_DATE = 0x21;    // 1980-01-01 00:00:00 — fixed for determinism
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n >>> 0); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

const locals = [];
const centrals = [];
let offset = 0;
for (const name of files) {
  const data = fs.readFileSync(path.join(ROOT, name));
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = CRC(data);
  const comp = zlib.deflateRawSync(data, { level: 9 });
  const local = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0x0800), u16(8), u16(DOS_TIME), u16(DOS_DATE),
    u32(crc), u32(comp.length), u32(data.length), u16(nameBuf.length), u16(0), nameBuf, comp,
  ]);
  locals.push(local);
  centrals.push(Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(8), u16(DOS_TIME), u16(DOS_DATE),
    u32(crc), u32(comp.length), u32(data.length), u16(nameBuf.length),
    u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuf,
  ]));
  offset += local.length;
}
const centralDir = Buffer.concat(centrals);
const eocd = Buffer.concat([
  u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
  u32(centralDir.length), u32(offset), u16(0),
]);
const zip = Buffer.concat([...locals, centralDir, eocd]);

const distDir = path.join(ROOT, 'dist');
fs.mkdirSync(distDir, { recursive: true });
const outPath = path.join(distDir, 'claude-handshake-plugin-' + version + '.zip');
fs.writeFileSync(outPath, zip);
const sha = crypto.createHash('sha256').update(zip).digest('hex');
console.log('built:  ' + outPath);
console.log('files:  ' + files.length);
console.log('bytes:  ' + zip.length);
console.log('sha256: ' + sha);
