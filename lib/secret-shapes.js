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

const HANDSHAKE_CREDENTIAL_SHAPES = [
  { id: 'enrollment-token', re: /\bhsk_[0-9a-f]{16,}_[0-9a-f]{4,}\b/ },
  { id: 'recovery-key',     re: /\bhsr_[0-9a-f]{16,}_[0-9a-f]{4,}\b/ },
  { id: 'member-sub-token', re: /\bhsm_[0-9a-f]{8,}_[0-9a-f]{16,}\b/ },
  { id: 'inline-invite',    re: /\bhsi1_[A-Za-z0-9_-]{40,}\b/ },
  { id: 'workspace-secret', re: /"secret"\s*:\s*"[A-Za-z0-9_-]{32,}"/ },
  { id: 'ntfy-topic',       re: /"topic"\s*:\s*"[0-9a-f]{32}"/ },
];

module.exports = { HANDSHAKE_CREDENTIAL_SHAPES };
