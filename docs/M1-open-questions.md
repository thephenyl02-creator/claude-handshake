# Open questions for the M1 protocol freeze

Collected from the M3 relay build (2026-08-14). Each must be settled — and
frozen in PROTOCOL.md — before M4/M5 build the client side. The relay's
current behavior is noted so the freeze either ratifies or changes it.

## Relay decisions to ratify (made during M3, look right, need blessing)

1. **Workspace creation is gated** by a deploy-time `RELAY_CREATE_TOKEN`
   secret (unset → 503). An open create endpoint would spend the deployer's
   account quota for strangers.
2. **Admin ladder**: rotate / purge / destroy / member-remove all require the
   recovery key; the enrollment token only joins. (Member-remove on the
   enrollment token would let any member kick any other.)
3. **`from` is refused, not rewritten**: a client `from` that mismatches the
   authenticated member → `403 from_mismatch`; the server-authoritative id
   rides the wrapper `{seq, from, from_name, received_at, envelope}`.
   Rewriting would invalidate an end-to-end HMAC the relay cannot recompute.
4. **`POST /ws/:id/cursor`** exists as its own owner-authorized endpoint
   (sync must not auto-advance the watermark — PLAN §2 advances it at
   injection time).
5. **`rotate` accepts `grace_seconds` (0–86400)** so a leaked token's window
   can be closed immediately.
6. **Observability off by default** (`[observability] enabled = false`) —
   platform invocation logs would record URLs, and URLs contain workspace ids.

## To decide at M1

1. **`ts` units** — seconds vs milliseconds (relay currently accepts both;
   values < 1e11 read as seconds). Pick one.
2. **`seq` naming collision** — envelope per-sender dedupe `seq` vs
   relay-assigned monotonic message seq (cursor space). Two names needed.
3. **Is `from` inside the HMAC's canonical serialization?** (M3 assumes yes —
   which forces refuse-over-rewrite, decision 3 above.)
4. **POST body shape** — relay requires `{envelope: {...}}`, not a bare
   envelope, leaving room for sibling fields. Ratify.
5. **Cursor shape per transport** — relay uses a single integer; the plan's
   `{message_id, unix_ts}` is the ntfy form. State both explicitly.
6. **Subject normalization frozen byte-identically** for client and relay:
   currently case + punctuation + stopwords, order-preserving, no stemming
   (`relay/src/lib/subject.js`). The fuzzy-match threshold for warn.overlap
   is still open.
7. **Member-name lifecycle** — names are permanently retired on removal, so a
   member who loses its sub-token has no re-join path except a new name.
   Restart recovery may need an explicit rebind flow.
8. **Member-name charset** — printable ASCII only (names are injected into
   peers' model context; blocks bidi/zero-width/newline tricks) but rejects
   "José". Widen with a targeted sanitizer, or keep?
9. **Presence enum spelling** — relay allows
   `working|waiting|blocked|tooling_broken`; freeze the fourth state's name.
10. **Reserved-slot count** — of the fetch cap (20), how many are reserved
    for `warn.*`/`note.blocker`? Relay uses 5.
11. **Does rotation rotate the recovery key too?** Currently no.
12. **Claim `files[]` on renewal** is a capped union (not replace). Confirm.

## Settled ahead of the freeze (Fenil, 2026-08-15): subagent CHILD MODE

The spike's subagent-hooks discovery is absorbed as a feature, not filtered
out. Subagent/headless child sessions run in child mode:
- NEVER members: no join, no presence record, no claims, no outbound posts.
- DO honor the PreToolUse overlap gate against peers' claims, read from the
  parent's local cache (no network from children).
- DO append their touched files to the parent's claim state locally; the
  parent's next heartbeat carries the union — claims reflect the whole agent
  tree's footprint.
- Presence may aggregate child activity into the parent's record
  ("working: onboarding flow (+3 agents)") — never as separate members.
M1 must specify the child-detection mechanism and freeze it.
