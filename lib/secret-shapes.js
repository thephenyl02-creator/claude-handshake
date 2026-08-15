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
// NO \b ANCHORS — this is the rule lib/filter.js states at its own PATTERNS
// table, and these shapes originally violated it. The filter scans normalized
// VARIANTS, including a whitespace-stripped one, which glues carrier prose to
// the credential ("FYIhsk_5d74…_55f9ok") and kills every word boundary. A
// re-verification measured the cost: whitespace-split leaked 31-40% and a
// credential merely typed next to a word leaked 100%. Without \b, all forms
// are caught; the tradeoff is only that a hex run embedded in a longer token
// can also match, which errs toward blocking — the correct direction.
const HANDSHAKE_CREDENTIAL_SHAPES = [
  { id: 'enrollment-token', re: /hsk_[0-9a-f]{16,}_[0-9a-f]{4,}/i },
  { id: 'recovery-key',     re: /hsr_[0-9a-f]{16,}_[0-9a-f]{4,}/i },
  { id: 'member-sub-token', re: /hsm_[0-9a-f]{8,}_[0-9a-f]{16,}/i },
  { id: 'inline-invite',    re: /hsi1_[A-Za-z0-9_-]{40,}/i },
  { id: 'workspace-secret', re: /"secret"\s*:\s*"[A-Za-z0-9_-]{32,}"/i },
  { id: 'ntfy-topic',       re: /"topic"\s*:\s*"[0-9a-f]{32}"/i },
];

module.exports = { HANDSHAKE_CREDENTIAL_SHAPES };
