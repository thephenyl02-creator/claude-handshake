# claude-handshake relay

The team-relay rung of the transport ladder: a Cloudflare Worker plus **one
SQLite-backed Durable Object per workspace**. It carries presence, task claims
and short notes between Claude Code peers who are working the same project from
different accounts and machines.

It is deliberately small. Lasting truth lives in the repo (`.handshake/`); this
is the live chatter layer, and everything in it is disposable.

---

## Deploying your own (one time, ~3 minutes)

You need a Cloudflare account (the free plan is enough) and Node 18+.

```sh
cd relay
npm install
npx wrangler login                      # opens a browser once
npx wrangler secret put RELAY_CREATE_TOKEN   # paste a long random string, keep it
npx wrangler deploy
```

`wrangler deploy` prints your relay host, e.g.
`https://claude-handshake-relay.<your-subdomain>.workers.dev`. Check it:

```sh
curl https://claude-handshake-relay.<your-subdomain>.workers.dev/health
# {"ok":true,"service":"claude-handshake-relay","version":"0.1.2","protocol":1}
```

Then create the workspace and hand the invite to your team:

```sh
curl -X POST https://<your-relay>/ws \
  -H "Authorization: Bearer $RELAY_CREATE_TOKEN" \
  -H "content-type: application/json" \
  -d '{"name":"our-project"}'
```

The response contains three things and is the **only** time the relay will show
them:

| Field | Who holds it | What it does |
|---|---|---|
| `ws` | everyone | workspace id (128-bit, minted server-side) |
| `enrollment_token` (`hsk_…`) | every member | joins the workspace, nothing more |
| `recovery_key` (`hsr_…`) | the founder, **out of band** | rotate, purge, destroy, remove a member |

Store the recovery key somewhere that is *not* the repo. The relay keeps only
SHA-256 digests, so a lost recovery key cannot be recovered — the workspace has
to be recreated.

`RELAY_CREATE_TOKEN` is a secret, never a `[vars]` entry. Without it the relay
fails closed: `POST /ws` returns `503 relay_not_configured`, so a stranger who
finds your hostname cannot create workspaces on your account's quota.

### Updating

Editing anything under `src/` then `npx wrangler deploy` again is safe: Durable
Object storage survives a redeploy. Do **not** change `new_sqlite_classes` in
`wrangler.toml` — see below.

---

## What the free tier actually means

**Workers Free is 100,000 requests per day, counted across your whole
Cloudflare account, resetting at UTC midnight.** Two consequences worth knowing
before you rely on this:

- **It is a shared cliff, not a per-Worker budget.** Any other Worker or Pages
  Function on the same account draws from the same 100k. If a different project
  of yours has a busy day, the relay stops with it.
- **Over the limit, requests fail — they do not queue or degrade.** The plugin
  treats an unreachable transport as "silently offline" by design, so a hit
  cliff looks exactly like everyone going quiet. If a workspace goes strangely
  silent for the rest of the UTC day, check your account's Workers usage before
  you debug anything else.

Durable Objects are metered separately (request count and compute duration);
SQLite-backed DOs are the free-plan-eligible kind, which is why the migration
must stay `new_sqlite_classes`. Current allowances are on Cloudflare's pricing
page — they change, so this README does not repeat numbers it cannot keep true.

### Budgeting your team's traffic

Every API call is one Worker request **and** one Durable Object request. Rough
per-member daily cost at the relay's 60-second monitor cadence:

| Activity | Calls/day/member |
|---|---|
| heartbeat, every 60s while a session is open (8h) | ~480 |
| sync at turn boundaries, ~2/min while working (8h) | ~960 |
| claims, releases, notes | tens |

So roughly **1,500 calls per active member per day**, or ~3,000 metered items.
A four-person team working full days lands near 12k/day — comfortably inside
100k, with room for the account's other Workers. A team that leaves 20 sessions
running around the clock does not.

`GET /` and `GET /health` also touch a Durable Object (the per-IP rate limiter),
so do not point an uptime monitor at `/health` every 10 seconds.

---

## Endpoints

All JSON, all bearer auth except `GET /` and `GET /health`.
`Authorization: Bearer <credential>` — credentials never travel in a body, so
they cannot land in a proxy's request-body log.

| Method | Path | Credential | Notes |
|---|---|---|---|
| GET | `/` | none | HTML page from `src/landing.js` — swap that one file to restyle it |
| GET | `/health` | none | `{ok, service, version, protocol}` — stable shape for `doctor` |
| POST | `/ws` | `RELAY_CREATE_TOKEN` | mints workspace id + enrollment token + recovery key |
| POST | `/ws/:id/join` | enrollment token | mints `{member_id, secret}`; duplicate names rejected; optional `display_name` |
| POST | `/ws/:id/heartbeat` | member | presence + renews that member's claims; optional `display_name` |
| POST | `/ws/:id/claim` | member | one winner per normalized subject; 409 carries the live claim |
| POST | `/ws/:id/release` | member (owner) | 403 for anyone else |
| POST | `/ws/:id/post` | member | append an envelope |
| GET | `/ws/:id/sync?cursor=N` | member | presence + claims + up to 20 messages |
| POST | `/ws/:id/cursor` | member (own) | advances the read watermark, forward only |
| POST | `/ws/:id/rotate` | recovery key | new enrollment token, 24h grace on the old one |
| POST | `/ws/:id/purge` | recovery key | clears messages (`{"all":true}` also clears claims/presence) |
| DELETE | `/ws/:id` | recovery key | destroys the workspace; the id cannot be re-bound |
| POST | `/ws/:id/members/:member/remove` | recovery key | invalidates that sub-token, releases its claims |
| POST | `/ws/:id/members/:member/rebind` | recovery key | reissues a sub-token for a member that still exists |

Joining a workspace id that was never created returns **404 and writes
nothing** — the relay never binds a workspace on first contact.

### Members

`name` is the authoritative handle: printable ASCII, unique per workspace, and
permanently retired on removal. `display_name` is an OPTIONAL label beside it —
UTF-8, sanitized (C0/C1 controls, bidi overrides and isolates, and the
zero-width class are stripped), then capped at 40 characters *after*
sanitizing, so padding a name with invisibles buys nothing. It may be sent at
`join` or on any `heartbeat`, is returned in `members[]` and `presence[]`, and
is never used for identity, uniqueness or authorization. A `display_name` that
sanitizes away to nothing stores as absent and never fails the call.

`rebind` is the recovery path for a member that lost its local credential:
names are retired for good, so re-joining under the same name is refused
(`409 member_name_taken`), and only the recovery key can reissue a sub-token.
It keeps the member id — and with it that member's claims, cursor and place in
every peer's roster — and invalidates the previous secret immediately. It
accepts the member id or the member name in the path. It never un-retires a
removed member: that is `409 member_revoked`, and an unknown member is
`404 member_not_found`. After a rebind the client must restart its `sender_seq`
from the current Unix ms, because `(member, sender_seq)` is still the dedupe
key.

### Claims

Advisory leases: `{subject, owner, acquired_at, renewed_at, ttl, files[]}`.
Default TTL 2h, renewed by the heartbeat tick, auto-released on expiry. The
Durable Object serializes requests, so exactly one caller wins a subject; the
loser gets `409 claim_conflict` with the live claim in the body so it can tell
its user who holds it. Subject matching is on a normalized key (case,
punctuation, stopwords — see `src/lib/subject.js`); the owner re-claiming the
same subject renews it and merges `files[]`.

An OPTIONAL `acquired_at` (Unix ms; non-integer is `400 claim_acquired_at_invalid`, a future value is clamped to now) is honored **only** where the caller's own claim row is created or re-adopted — a renewal keeps the stored value and a peer's live claim is never touched — so `/handshake upgrade` can re-broadcast a claim after a transport migration without resetting the tiebreak input.

### Messages

Append-only with a Durable-Object-assigned monotonic `seq`. That `seq` is the
relay's own; the sender's per-sender dedupe counter is the separate envelope
field **`sender_seq`** — two different numbers, which is why they no longer
share a name. Envelopes are stored **verbatim** — every field the client sent,
including `sig` and fields this version does not know about. The relay does not
verify `sig` (the HMAC is end-to-end between clients) and must never strip it.

`from` is REQUIRED and complete (`{member, machine, session}`, all strings): it
sits inside the signed serialization, so an envelope missing any part of it
cannot be verified by the peer that has to check the HMAC (`400 envelope_from`).
It is server-authoritative but is *not* rewritten: a mismatch with the
authenticated member is refused with `403 from_mismatch` rather than silently
overwritten — overwriting would invalidate a signature the relay cannot
recompute. `ws` is checked against the workspace in the path
(`400 envelope_ws`), which is cheap defence in depth against a cross-workspace
replay. Each message is returned wrapped as `{seq, from, from_name,
received_at, envelope}`, where the outer `from` is the authenticated member id.

`presence.update`, `task.claim`, `task.release` and `state.request` are
**refused** here with `400 envelope_type_not_carried`. On this transport they
are the server's own state, reached through `/heartbeat`, `/claim`, `/release`
and `/sync`; accepting them as envelopes would build unauthenticated shadow
state beside the server's and spend the fetch budget re-sending what `sync`
already returns. Every other type matching the type regex is carried, including
ones this version does not know — forward compatibility lives at the transport.

Retention is TTL **and** count: 7 days, last 500. Reads filter by TTL, so an
expired message is never returned even before the sweep deletes it. Replaying a
`(member, sender_seq)` pair is idempotent — useful for the offline queue.

Sync returns at most 20 messages, chosen per-sender round-robin with 5 slots
reserved for `warn.*` and `note.blocker`, so one chatty peer cannot bury a
quiet peer's overlap warning. The cursor is **not** advanced by reading:
`POST /ws/:id/cursor` is a separate call, because the consumed watermark
belongs at injection time on the client.

---

## Security model

- Tokens are stored as SHA-256 digests and compared in constant time.
- Per-IP rate limit on authentication failures (10 per 10 minutes) inside the
  workspace object itself, so it costs no extra request. The limit applies to
  the *failure*, never to the request: a valid credential is always served,
  even from an IP whose bucket is hot. That matters because NAT, VPNs and
  corporate proxies put a whole team behind one address — gating requests on
  the IP's failure count would let ten bad guesses (or one removed member's
  monitor still ticking) lock out everyone behind it.
- Guessing a *workspace id* is not rate-limited on purpose: ids are 128-bit
  CSPRNG, and a workspace object creates its schema only on `init`, so a guess
  returns 404 without writing a single row. A prober cannot grow your storage,
  only spend requests.
- Nothing is ever logged except a redacted error code and an error's
  constructor name (`src/lib/log.js`). No bodies, no headers, no messages. A
  test fails the build if a `console.*` call appears anywhere else. Workers
  Logs (`[observability]`) is off by default too — platform invocation logs
  record request URLs, and a URL here contains the workspace id. `wrangler
  tail` shows the redacted errors live without persisting them.
- No module-scope mutable state in the Worker — an isolate is reused across
  requests and eyeballs. A test enforces this too.
- The relay is a coordination surface, not a vault: Cloudflare can see every
  message body. Encrypt end-to-end at the client if that matters. This is the
  same honest claim SECURITY.md makes about the zero-setup transport.

### Offboarding runbook

1. Revoke the person's repo access (that is where the enrollment token lives).
2. `POST /ws/:id/members/:member/remove` with the recovery key — their
   sub-token stops working immediately and their claims are released.
3. `POST /ws/:id/rotate` with the recovery key. The old enrollment token keeps
   working for 24h so peers mid-join are not broken; pass
   `{"grace_seconds": 0}` to close that window immediately after a leak.
4. Re-invite the remaining members with the new enrollment token.

Rotation does not invalidate existing member sub-tokens, and it never un-leaks
git history.

### Lost-credential runbook

A member that loses local state loses its sub-token, and cannot re-join under
its own name. Use `POST /ws/:id/members/:member/rebind` with the recovery key
and hand the new `token` back over the same channel the invite went out on. The
old secret dies the moment the new one is minted, so a rebind is also the right
answer to a sub-token that leaked from one machine.

---

## Configuration

`wrangler.toml` `[vars]` (all optional; defaults in `src/lib/config.js` match
the frozen protocol): `CLAIM_TTL_DEFAULT_SECONDS`, `CLAIM_TTL_MAX_SECONDS`,
`MESSAGE_TTL_SECONDS`, `MESSAGE_MAX`, `SYNC_FETCH_CAP`, `SYNC_RESERVED_SLOTS`,
`ROTATE_GRACE_SECONDS`, `MAX_MEMBERS`, `MAX_CLAIMS`, `MAX_FILES_PER_CLAIM`,
`AUTH_FAIL_MAX`, `AUTH_FAIL_WINDOW_SECONDS`, `PUBLIC_RATE_MAX`,
`CREATE_RATE_MAX`.

Storage is bounded on every table: messages by TTL and count, claims by
`MAX_CLAIMS` and their own TTL, members by `MAX_MEMBERS`, files per claim by
`MAX_FILES_PER_CLAIM`. Nothing an authenticated member can send grows the
object without a ceiling.

**`new_sqlite_classes` is load-bearing.** The key-value Durable Object backend
is a paid-plan feature; SQLite-backed objects are what free accounts can
deploy. A test asserts every bound class appears in `new_sqlite_classes` and
that `new_classes` appears nowhere.

## Tests

```sh
npm test          # source guards + unit tests (node), then the Worker suite
npm run test:worker
npm run test:source
```

The Worker suite runs inside workerd via `@cloudflare/vitest-pool-workers`, so
the Durable Objects under test are the real thing. Nothing is deployed and no
Cloudflare account is needed.
