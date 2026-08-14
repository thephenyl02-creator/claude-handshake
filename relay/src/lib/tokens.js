// Credential formats.
//
// Workspace enrollment token and recovery key:  <prefix>_<64 hex>_<8 hex sum>
// The shape is deliberately greppable (PLAN section 3) so GitHub push
// protection and secret scanners can catch a leak, and so `doctor` can tell a
// credential from a workspace id at a glance.
//
// Member sub-token: hsm_<member id>_<64 hex secret>. No checksum — the member
// id is the lookup key and the secret is compared against a stored digest.

import { randomHex, sha256Hex, timingSafeEqual } from './crypto.js';

export const ENROLL_PREFIX = 'hsk';
export const RECOVERY_PREFIX = 'hsr';
export const MEMBER_PREFIX = 'hsm';

const CRED_RE = /^([a-z]{3})_([0-9a-f]{64})_([0-9a-f]{8})$/;
const MEMBER_RE = /^hsm_([0-9a-f]{16})_([0-9a-f]{64})$/;

async function checksum(prefix, secret) {
  return (await sha256Hex(prefix + ':' + secret)).slice(0, 8);
}

export async function mintCredential(prefix) {
  const secret = randomHex(32);
  return prefix + '_' + secret + '_' + (await checksum(prefix, secret));
}

// Cheap structural + checksum gate before any storage lookup. Returns false
// for anything that is not a well-formed credential of this kind.
export async function credentialWellFormed(token, prefix) {
  if (typeof token !== 'string') return false;
  const m = CRED_RE.exec(token);
  if (!m || m[1] !== prefix) return false;
  return timingSafeEqual(await checksum(prefix, m[2]), m[3]);
}

export function mintMemberToken(memberId) {
  return MEMBER_PREFIX + '_' + memberId + '_' + randomHex(32);
}

export function parseMemberToken(token) {
  if (typeof token !== 'string') return null;
  const m = MEMBER_RE.exec(token);
  if (!m) return null;
  return { memberId: m[1], secret: m[2] };
}

export function newMemberId() {
  return randomHex(8);
}

// Workspace ids are 128-bit CSPRNG, minted server-side only (PLAN section 3:
// no first-caller binding, ids are never derived from a name).
export function newWorkspaceId() {
  return randomHex(16);
}

export const WS_ID_RE = /^[0-9a-f]{32}$/;
