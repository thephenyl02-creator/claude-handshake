# M1 freeze decisions (2026-08-15)

Authoritative answers to docs/M1-open-questions.md, made on the session's top
model with full project context. PROTOCOL.md and SECURITY.md must encode
these; where they conflict with older prose in PLAN.md, these win.

## Relay decisions: ALL SIX RATIFIED
Create-token gate · recovery-key admin ladder · `from` refused-not-rewritten ·
separate owner-authorized cursor endpoint · `rotate` grace_seconds (0–86400) ·
observability off by default.

## The twelve

1. **ts = milliseconds** everywhere in the envelope (JS-native). The relay's
   dual-accept stays as robustness, spec says ms.
2. **Names**: envelope per-sender dedupe field renames to `sender_seq`;
   the relay-assigned monotonic message number is `seq` (cursor space).
3. **`from` IS inside the HMAC.** Canonical serialization for signing:
   UTF-8 JSON with lexicographically sorted keys, no whitespace, over
   {v, ws, from, type, body, ts, nonce, sender_seq}. No relay may rewrite.
4. **POST body shape `{envelope: {...}}`** ratified (room for siblings).
5. **Cursors are transport-specific**: relay = integer `seq`; ntfy =
   `{message_id, unix_ts}` with the >11h age fallback already specified.
6. **Subject normalization frozen as implemented** in relay/src/lib/subject.js
   (case + punctuation + stopwords, order-preserving, no stemming) —
   byte-identical client and relay. **Fuzzy overlap rule: token-set Jaccard
   ≥ 0.5 → warn.overlap candidate**; the model judges semantics above that,
   the transport never does.
7. **Rebind flow added**: `POST /ws/:id/members/:member/rebind`, recovery-key
   authorized, reissues a sub-token for an existing name (lost-local-state
   recovery). Relay gains this endpoint in an M4-era patch; spec it now.
8. **Member id charset stays printable ASCII in v1** (ids are injected into
   peers' model context; bidi/zero-width/newline attacks outrank "José").
   An optional `display_name` (UTF-8, sanitized: strip C0/C1, bidi and
   zero-width classes, length ≤ 40) may accompany; the id remains the
   authoritative handle. Documented as a v1 tradeoff.
9. **Presence enum frozen**: `working | waiting | blocked | tooling_broken`.
10. **Reserved priority slots: 5 of the 20-fetch cap.** Ratified.
11. **Rotation does NOT rotate the recovery key.** The recovery key is
    immutable in v1; a compromised recovery key means destroy + recreate the
    workspace. Stated plainly in SECURITY.md.
12. **Claim files[] on renewal = capped union.** Ratified.

## Child mode (settled 2026-08-15) — detection now empirical

Detection: **`CLAUDE_CODE_CHILD_SESSION=1`** in the child's environment
(verified live on claude-code 2.1.227 via claude-desktop; children also see
the parent id in `CLAUDE_CODE_SESSION_ID`, distinct from the hook payload's
own `sessionId`). M6 re-verifies once under terminal-CLI subagents; a missing
variable falls back to full silence (safe default: a child that can't prove
it's a child behaves as one anyway UNLESS interactive markers are present).
Child-mode rules as recorded in M1-open-questions.md: never members/present/
claiming/posting; DO honor the PreToolUse gate from the parent's cache; DO
append touched files to the parent's local claim state (keyed by parent
session id); parent's heartbeat carries the union; presence may aggregate
("+N agents").

## Spike-derived budgets (freeze as normative)

- All hooks: bounded stdin read (600ms backstop proven necessary), exit 0
  always, never print to stdout except designed injections.
- UserPromptSubmit: synchronous, LOCAL-CACHE-ONLY, explicit timeout 3s,
  zero network. Measured cost basis: p50 ≈ 100–140ms, p90 ≈ 200–580ms.
- Heartbeat: monitor clock — 60s on team relay, state-change + 10-min
  keepalive on ntfy. Monitor is hard-killed at session end (no signal):
  graceful work rides SessionEnd (measured 20/21); mid-session disarm =
  sentinel file only.
- PostToolUse: async, matcher `Edit|Write|NotebookEdit|Bash`, mtime-sentinel
  check before interpreter spawn.
- Payload contract: camelCase (`hookEventName`, `sessionId`, `toolName`,
  `toolInput.file_path`, `workingDirectory`, `source`).
