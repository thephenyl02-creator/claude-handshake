'use strict';
// claude-handshake credential shapes — the SINGLE source of truth for the
// greppable formats SECURITY.md §3 froze. Imported by BOTH lib/filter.js (the
// outbound seatbelt) and lib/repo.js (the tracked-file guard) so the two can
// never drift — a gap in one is a gap in the other, and a recovery key or an
// inline invite is far more dangerous to leak than the enrollment token the
// filter used to be the only one that caught.
//
// hsi1_ is the whole workspace (PROTOCOL §9.1 embeds the workspace secret AND
// the enrollment token); hsr_ is rotate/purge/destroy/member-remove authority;
// hsm_ is a member's live credential. None may travel in a message body.

// Case-INSENSITIVE on the hex-bodied shapes: hex is case-agnostic, so an
// uppercased token stays fully recoverable with one .toLowerCase() — the red
// team evaded the original lowercase-only patterns exactly that way.
// hsi1_'s body is base64url (case-significant) but the prefix match is what
// carries it, and its entropy backstop held under every mangle.
const HANDSHAKE_CREDENTIAL_SHAPES = [
  { id: 'enrollment-token', re: /\bhsk_[0-9a-f]{16,}_[0-9a-f]{4,}\b/i },
  { id: 'recovery-key',     re: /\bhsr_[0-9a-f]{16,}_[0-9a-f]{4,}\b/i },
  { id: 'member-sub-token', re: /\bhsm_[0-9a-f]{8,}_[0-9a-f]{16,}\b/i },
  { id: 'inline-invite',    re: /\bhsi1_[A-Za-z0-9_-]{40,}\b/i },
  { id: 'workspace-secret', re: /"secret"\s*:\s*"[A-Za-z0-9_-]{32,}"/i },
  { id: 'ntfy-topic',       re: /"topic"\s*:\s*"[0-9a-f]{32}"/i },
];

module.exports = { HANDSHAKE_CREDENTIAL_SHAPES };
