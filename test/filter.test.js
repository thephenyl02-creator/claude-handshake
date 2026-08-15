'use strict';
// M2 test corpus. Every "secret" here is FAKE and constructed at runtime by
// concatenation so that neither GitHub push protection nor this repo's own
// filter ever sees a token-shaped literal in source.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const filter = require('../lib/filter');
const { sendGate, FilterViolation } = require('../lib/outbound');

const blocked = (text, opts) => {
  const r = filter.check(text, opts);
  assert.strictEqual(r.ok, false, `expected BLOCKED but passed: ${text.slice(0, 60)}`);
  return r;
};
const clean = (text, opts) => {
  const r = filter.check(text, opts);
  assert.strictEqual(r.ok, true,
    `expected CLEAN but blocked (${r.findings.map(f => f.id).join(',')}): ${text.slice(0, 60)}`);
};

// Runtime-built fakes
const AWS = 'AKIA' + 'IOSFODNN7EXAMPLE';                       // official AWS docs example
const GH = 'ghp_' + 'a1B2c3D4'.repeat(5);                      // 40 chars after prefix
const SLACK = 'xoxb-' + '123456789012-AbCdEfGhIjKl';
const GOOGLE = 'AIza' + 'Sy' + 'D9x'.repeat(11);               // 35 chars after AIza
const ANT = 'sk-ant-' + 'api03-' + 'Xy7'.repeat(8);
const OPENAI = 'sk-' + 'Abc123XY'.repeat(4);
const STRIPE = 'sk_live_' + 'a1B2c3D4e5F6g7H8';
const JWT = 'eyJ' + 'hbGciOiJIUzI1NiJ9' + '.eyJ' + 'zdWIiOiIxMjM0NTYifQ' + '.' + 'abcDEF123-_ghiJKL456';
const TG = '123456789:AA' + 'F'.repeat(33);
const HSK = 'hsk_' + 'a1b2c3d4e5f6g7h8i9j0';
const hx = (n) => [...Array(n)].map((_, i) => 'abcdef0123456789'[i % 16]).join('');
const HSR = 'hsr_' + hx(64) + '_' + hx(8);          // recovery key
const HSM = 'hsm_' + hx(16) + '_' + hx(64);          // member sub-token
const HSI = 'hsi1_' + 'AbCd_-'.repeat(10);           // inline invite = whole workspace

// ------------------------------------------------------------ true positives
test('aws access key', () => blocked(`deploy uses ${AWS} for s3`));
test('github token', () => blocked(`push with ${GH}`));
test('slack token', () => blocked(`bot: ${SLACK}`));
test('google api key', () => blocked(`maps: ${GOOGLE}`));
test('anthropic key', () => blocked(`use ${ANT}`));
test('openai-style key', () => blocked(`use ${OPENAI}`));
test('stripe live key', () => blocked(`charge via ${STRIPE}`));
test('private key block', () => blocked('-----BEGIN RSA PRIVATE KEY-----\nMIIabc'));
test('jwt', () => blocked(`session: ${JWT}`));
test('telegram bot token', () => blocked(`bot ${TG}`));
test('connection string with creds', () =>
  blocked('db is postgres://admin:hunter2secret@db.example.com/prod'));
test('https url with embedded creds', () =>
  blocked('remote: https://fenil:sometoken12345@github.com/x/y.git'));
test('secret assignment', () => blocked("api_key = 'abcd1234efgh5678'"));
test('env block', () =>
  blocked('DB_HOST=prod.example.com\nDB_USER=rootuser\nDB_PASS=supersecret1'));
test('own workspace token', () => blocked(`token is ${HSK}`));
// Regression: these three used to fall through the entropy heuristic ~1-in-3
// times (audit 2026-08-15). They are the MOST dangerous handshake credentials.
test('recovery key (explicit pattern, not entropy)', () => blocked(`joined as ${HSR} looks good`));
test('member sub-token', () => blocked(`my token ${HSM} fyi`));
test('inline invite = whole workspace', () => blocked(`come join ${HSI} see you there`));
test('high-entropy token', () =>
  blocked('blob 9fK2mQ7xLpZ4vB8nR3tY6wE1uI5oPqSd here'));

// ------------------------------------------------- M13 red-team regressions
// Every case below was a DEMONSTRATED leak through the real sendGate before
// the M13 fixes (2026-08-15). Each names the attack it closes.
test('rt: odd-scheme connection strings (mssql/mariadb/snowflake) - leaked 100%', () => {
  blocked('mssql://sa:P4ssw0rdLongEnough@sqlbox/master');
  blocked('mariadb://root:hunter2hunter2@10.0.0.5/app');
  blocked('snowflake://usr:SuperSecret99@acct/db');
  blocked('clickhouse://default:ClickSecret99@ch.internal:9000/db');
  blocked('cassandra://svc:CassSecret4242@node1:9042/ks');
});
test('rt: 40/64-hex key next to a credential word - leaked 100%', () => {
  blocked('rotated key: ' + 'a1b2c3d4e5'.repeat(4));
  blocked('api token ' + '9f8e7d6c5b'.repeat(6) + 'abcd');
});
test('rt: 32-hex key assignment - leaked ~75%', () => blocked('DD_API_KEY=' + '0123456789abcdef'.repeat(2)));
test('rt: branded tokens (twilio/shopify/vault/digitalocean)', () => {
  blocked('SK' + '0123456789abcdef'.repeat(2));
  blocked('shpat_' + '0123456789abcdef'.repeat(2));
  blocked('hvs.CAESIJ_abcdefghijklmnop');
  blocked('dop_v1_' + '0123456789abcdef'.repeat(4));
});
test('rt: UPPERCASED handshake credentials stayed recoverable and leaked', () => {
  blocked('HSR_' + 'A1B2C3D4E5F6A7B8'.repeat(4) + '_1A2B3C4D');
  blocked('HSK_' + 'A1B2C3D4E5F6A7B8'.repeat(4) + '_1A2B3C4D');
});
test('rt: tripwire covers non-.env in-project secret files, encoded and case-folded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-rt-'));
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  const SEC = 'moderate-secret-value-abc123xyz';
  // MINIFIED and NESTED on purpose: a real secret.json is one line, which no
  // line-oriented regex can read. The pretty-printed form this test used
  // before passed while the minified form leaked (M13 follow-up).
  fs.writeFileSync(path.join(dir, 'secret.json'), JSON.stringify({ db: { apiKey: SEC } }));
  fs.writeFileSync(path.join(dir, 'config', 'database.yml'), 'password: ' + SEC + '\n');
  const o = { projectDir: dir };
  blocked('debug: ' + SEC, o);                                        // subdir/json file
  blocked('blob ' + Buffer.from(SEC).toString('base64'), o);          // base64 of it
  blocked('val ' + SEC.toUpperCase(), o);                             // case-folded
  clean('working on the api layer', o);
});

// ------------------------------------------------------------------ bypasses
test('base64-encoded secret', () =>
  blocked('config blob: ' + Buffer.from(`key=${AWS} region=us-east-1`).toString('base64')));
test('whitespace-split secret', () =>
  blocked('key: AKIA IOSF ODNN 7EXA MPLE ok'));
test('hex-encoded secret', () =>
  blocked('data: ' + Buffer.from(`password=topsecretvalue99`).toString('hex')));
test('gzip+base64 secret', () =>
  blocked('z: ' + zlib.gzipSync(Buffer.from(`api_key = 'abcd1234efgh5678'`)).toString('base64')));
test('size cap', () => {
  const r = blocked('x'.repeat(3000));
  assert.ok(r.findings.some(f => f.id === 'size-cap'));
});

// ------------------------------------------------------------------ tripwire
test('local-secret tripwire: exact and windowed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsk-test-'));
  fs.writeFileSync(path.join(dir, '.env'), 'API_SECRET=trippy-value-abc123xyz\nPORT=3000\n');
  const opts = { projectDir: dir };
  blocked('the value is trippy-value-abc123xyz', opts);           // exact
  blocked('starts with trippy-value- I think', opts);             // 12-char window
  clean('a normal note about the api layer', opts);               // unrelated
  clean('PORT is 3000 locally', opts);                            // short/benign value not tracked
});

// ------------------------------------------------------- false positives ---
test('plain prose', () => clean('refactored the onboarding flow, tests green'));
test('short git sha', () => clean('fixed in commit a1b2c3d'));
test('full git sha (documented tradeoff)', () =>
  clean('see 5f2a9c1de8b47a03f6e19c2d8a4b7e0c3d5f6a1b for details'));
test('uuid', () => clean('id 550e8400-e29b-41d4-a716-446655440000 created'));
test('code without literal secret', () => clean('const token = getToken();'));
test('masked password', () => clean('password: ********'));
test('url without creds', () => clean('see https://github.com/foo/bar for the repo'));
test('base64 of prose', () =>
  clean('note ' + Buffer.from('hello world this is a perfectly ordinary sentence').toString('base64')));
test('file list', () => clean('touching src/index.ts, lib/filter.js, test/a.test.js'));
test('package commands', () => clean('run npm install then npm test'));

// ------------------------------------------------------------- fail closed --
test('non-string input fails closed', () => {
  assert.strictEqual(filter.check(null).ok, false);
  assert.strictEqual(filter.check(12345).ok, false);
});

// ------------------------------------------------------------- sendGate ----
test('sendGate passes clean fields', () => {
  const fields = { note: 'working on auth', files: ['src/a.ts', 'src/b.ts'], subject: 'auth flow' };
  assert.deepStrictEqual(sendGate(fields), fields);
});
test('sendGate blocks a secret in ANY field (presence note, branch, files)', () => {
  assert.throws(() => sendGate({ note: `debugging with ${AWS}` }), FilterViolation);
  assert.throws(() => sendGate({ branch: `feat/${GH}` }), FilterViolation);
  assert.throws(() => sendGate({ files: ['ok.ts', `${STRIPE}.ts`] }), FilterViolation);
});
