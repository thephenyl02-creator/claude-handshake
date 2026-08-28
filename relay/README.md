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

### The one command (recommended)

```
/handshake deploy-relay
```

That is the whole thing. From a terminal it is `handshake deploy-relay`. It
runs every step below for you — you never type `wrangler`:

- fetches `wrangler` through `npx` (nothing is installed globally, and the
  version is pinned to the wrangler **major** this relay was tested against —
  see "Wrangler version" below);
- opens your browser once to authorize Cloudflare;
- deploys the Worker (from a writable copy — wrangler needs to write `.wrangler/`);
- checks `GET /health` returns `{ok:true, protocol:1}`;
- generates a strong `RELAY_CREATE_TOKEN` and sets it with `wrangler secret put`
  over stdin (never on a command line, never in `[vars]`);
- creates the workspace and prints the **invite** to hand to your team, plus the
  **recovery key** to store out of band.

`/handshake upgrade` does the same deploy but migrates an existing zero-setup
workspace onto the new relay, carrying its live claims across (PROTOCOL §9.4).

If the wrapped command ever cannot run (the bundled `relay/` source is not part
of your install), fall back to the manual steps below.

### The manual steps (fallback)

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
# {"ok":true,"service":"claude-handshake-relay","version":"0.1.3","protocol":1}
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

### Wrangler version

The README used to say wrangler is "pinned to the one this relay was tested
against." That overstated it. `lib/deploy.js` only extracts the **major**
version out of `relay/package.json`'s wrangler dependency and runs
`wrangler@<major>` [C lib/deploy.js:118-131] — so `deploy-relay` always fetches
whatever the latest `4.x.y` (or current major) happens to be that day, not a
single exact version. That is a deliberate tradeoff (an exact pin would mean
manually bumping it forever, and Cloudflare rotates the CLI often), not a bug
— just don't read "pinned" as "frozen to one version."

### Running it locally

`npm run dev` inside `relay/` starts `wrangler dev`, but `POST /ws` - workspace
creation - fails closed with `503 relay_not_configured` out of the box, which
stops you at step one: without a workspace there is nothing for the other
endpoints to act on. That is the same
guard that protects a real deployment: `POST /ws` checks `env.RELAY_CREATE_TOKEN`
before it will mint a workspace, and refuses with that 503 when it's unset
[C src/worker.js:49]. Locally, nothing sets it for you.

Two ways to set it, in order of convenience:

```sh
cd relay
npx wrangler dev --var RELAY_CREATE_TOKEN:dev-token
```

This is the exact recipe the e2e harness uses to run the real relay locally
[C e2e/lib/relay-dev.js:4-7] — SQLite-backed Durable Objects work fine under
`wrangler dev`, so this exercises `relay/src` verbatim rather than a stub.

Or, since `relay/.gitignore` already anticipates it [C relay/.gitignore:3],
create `relay/.dev.vars` (wrangler loads it automatically, and it is
git-ignored so the token never gets committed):

```
RELAY_CREATE_TOKEN=dev-token
```

then just `npm run dev`. Prefer `.dev.vars` if you want a value that persists
across `npm run dev` invocations without retyping it; use `--var` for a
one-off or scripted run. Either way, `dev-token` is only a local convenience —
never reuse it as a real deploy's secret.

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

### Knowing when it is down, without spending budget to find out

A `/health` poll competes with the same 100k/day account-wide limit described
above, so the check itself should stay a rounding error next to the
~1,500 calls/day/member figure already budgeted. **Every 5 minutes is a safe
cadence**: 288 requests/day
(`24 * 60 / 5 = 288`), 0.29% of the 100k daily limit and negligible
next to a single active member's own traffic. Remember that each poll is *two*
metered items, not one — `GET /health` runs the per-IP rate limiter before it
answers [C relay/src/worker.js:70-73] — so it is 288 Worker requests against
the 100k, plus 288 Durable Object requests metered separately. At a
10-second cadence the same sum is 8,640 a day, which is why the line above
says not to do that.

Polling is not the only possible option, but it is the only one this README
can vouch for. Look for a **Notifications** section in your Cloudflare dashboard; whether
it offers a Workers usage or quota alert on your plan, and at what threshold
such an alert would fire, is Cloudflare's to define and can change without
warning — this repo has no way to verify it, so check your own dashboard
rather than trusting a claim from here. If your account does offer one it
costs no requests and would warn you *approaching* the cliff, where a
`/health` poll only tells you *after* requests have already started failing.
Worth the ten seconds it takes to look; not something to rely on until you
have seen it there yourself.

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

## Multiple Cloudflare accounts

`wrangler.toml` has no `account_id`, and `deploy-relay` does not prompt for
one. If your login belongs to more than one Cloudflare account/org, the two
paths behave differently, and the automated one is the worse of them:

- **By hand** (`npx wrangler login` / `npx wrangler deploy` in your terminal):
  stdin and stdout are your terminal, so if wrangler wants the account
  disambiguated you can see the question and answer it.
- **Through `handshake deploy-relay`: you cannot.** The deploy step spawns
  wrangler with captured stdio and no TTY on stdin
  [C lib/deploy.js:72-92, :232-247] — only `wrangler login` inherits stdio, and
  only so the browser flow reaches you [C lib/deploy.js:194]. An interactive
  account picker has nowhere to appear and no way to be answered. What you
  actually see, after a silent wait, is one of two single lines: a
  generic `wrangler deploy failed (<first line of wrangler's output>)`, since
  the failure classifier has no branch for an ambiguous account
  [C lib/deploy.js:452-465], or `wrangler deploy timed out` once the 300-second
  deploy timeout expires [C lib/deploy.js:48].

Either way the fix is the same, and on the `deploy-relay` path it is the *only*
fix: set `CLOUDFLARE_ACCOUNT_ID` in your shell environment before you start. It
reaches wrangler untouched, on every step — whoami, login, deploy and
`secret put` all go through one runner that spawns with
`Object.assign({}, process.env, ...)` [C lib/deploy.js:81], i.e. a full copy of
your environment plus a couple of non-interactive flags, so anything you
already export is passed straight through with nothing to configure on the
relay's side. Find the id on the Cloudflare dashboard's Workers & Pages
overview page for the account you want to deploy to.

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
