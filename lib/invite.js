'use strict';
// claude-handshake M5: the invite blob.
//
// PROTOCOL section 9.1, frozen:  hsi1_<base64url(canonical JSON, section 2.2)>
//
// An invite blob is a CREDENTIAL whenever loc == "inline" (SECURITY.md
// section 3): it carries the workspace secret and, on the relay, the
// enrollment token. `join` MUST print transport, endpoint host and workspace
// name and require explicit human confirmation; it MUST NEVER auto-join and
// MUST NEVER be triggered by repo content.

const crypto = require('crypto');
const { canonicalJson } = require('./envelope');

const PREFIX = 'hsi1_';
const WS_RE = /^[0-9a-f]{32}$/;
const TOPIC_RE = /^[0-9a-f]{32}$/;
const MAX_NAME = 64;

class InviteError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'InviteError';
    this.code = code;
  }
}

// c = first 4 bytes of SHA-256 over the canonical JSON of every key except c.
function checksumOf(fields) {
  const withoutC = {};
  for (const [k, v] of Object.entries(fields)) if (k !== 'c' && v !== undefined) withoutC[k] = v;
  return crypto.createHash('sha256').update(canonicalJson(withoutC), 'utf8').digest('hex').slice(0, 8);
}

function validate(fields, { requireChecksum }) {
  const f = fields;
  if (f.p !== 1) throw new InviteError('invite_protocol', 'invite protocol version must be 1');
  if (f.t !== 'relay' && f.t !== 'ntfy') throw new InviteError('invite_transport', 'transport must be relay or ntfy');
  if (typeof f.e !== 'string' || !f.e.length) throw new InviteError('invite_endpoint', 'endpoint is required');
  if (typeof f.ws !== 'string' || !WS_RE.test(f.ws)) throw new InviteError('invite_ws', 'workspace id must be 32 lowercase hex');
  if (typeof f.n !== 'string' || f.n.length > MAX_NAME) throw new InviteError('invite_name', 'workspace name must be <= 64 chars');
  if (f.loc !== 'repo' && f.loc !== 'inline') throw new InviteError('invite_loc', 'loc must be repo or inline');

  const inline = f.loc === 'inline';
  if (inline && (typeof f.s !== 'string' || !f.s.length)) throw new InviteError('invite_secret', 's is required when loc is inline');
  if (!inline && f.s !== undefined) throw new InviteError('invite_secret', 's is present only when loc is inline');
  if (f.t === 'relay' && inline) {
    if (typeof f.tok !== 'string' || !f.tok.length) throw new InviteError('invite_token', 'tok is required for an inline relay invite');
  } else if (f.tok !== undefined) {
    throw new InviteError('invite_token', 'tok is present only for an inline relay invite');
  }
  if (f.t === 'ntfy' && inline) {
    if (typeof f.topic !== 'string' || !TOPIC_RE.test(f.topic)) throw new InviteError('invite_topic', 'topic must be 32 lowercase hex');
  } else if (f.topic !== undefined) {
    throw new InviteError('invite_topic', 'topic is present only for an inline ntfy invite');
  }
  if (requireChecksum) {
    if (typeof f.c !== 'string' || !/^[0-9a-f]{8}$/.test(f.c)) throw new InviteError('invite_checksum', 'c must be 8 lowercase hex');
    if (checksumOf(f) !== f.c) throw new InviteError('invite_checksum_mismatch', 'invite checksum does not match - the blob was altered or truncated');
  }
}

function encode(input) {
  const f = {};
  f.p = 1;
  f.t = input.t || input.transport;
  f.e = input.e || input.endpoint;
  f.ws = input.ws;
  f.n = input.n === undefined ? (input.name || '') : input.n;
  f.loc = input.loc || 'repo';
  if (input.s !== undefined) f.s = input.s;
  else if (input.secret !== undefined && f.loc === 'inline') f.s = input.secret;
  if (input.tok !== undefined) f.tok = input.tok;
  else if (input.enrollment_token !== undefined && f.loc === 'inline' && f.t === 'relay') f.tok = input.enrollment_token;
  if (input.topic !== undefined) f.topic = input.topic;

  validate(f, { requireChecksum: false });
  f.c = checksumOf(f);
  return PREFIX + Buffer.from(canonicalJson(f), 'utf8').toString('base64url');
}

function decode(blob) {
  if (typeof blob !== 'string') throw new InviteError('invite_missing', 'invite blob must be a string');
  const trimmed = blob.trim();
  if (!trimmed.startsWith(PREFIX)) throw new InviteError('invite_prefix', 'invite blob must start with ' + PREFIX);
  const b64 = trimmed.slice(PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(b64)) throw new InviteError('invite_encoding', 'invite blob is not base64url');
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
  } catch (err) {
    throw new InviteError('invite_json', 'invite blob does not contain valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new InviteError('invite_json', 'invite blob must decode to a JSON object');
  }
  validate(parsed, { requireChecksum: true });
  return parsed;
}

// What `join` MUST print before asking for confirmation (section 9.1).
function describe(fields) {
  let host = fields.e;
  try { host = new URL(fields.e).host || fields.e; } catch (_) { /* keep the raw string */ }
  return {
    transport: fields.t,
    endpoint: fields.e,
    endpoint_host: host,
    workspace_name: fields.n,
    ws: fields.ws,
    secret_location: fields.loc,
    carries_credentials: fields.loc === 'inline',
    authenticated_from: fields.t === 'relay',
  };
}

module.exports = { PREFIX, InviteError, encode, decode, describe, checksumOf, validate, MAX_NAME };
