# claude-handshake — security model

**Status: FROZEN with the protocol (M1, 2026-08-15).** Companion to
[PROTOCOL.md](PROTOCOL.md); section references of the form "PROTOCOL §n" point
there. Same conformance language (RFC 2119/8174) and the same source tags:
`[D#]` decision in `docs/M1-decisions.md`, `[R#]` ratified relay decision,
`[S#]` spike finding, `[P§n]` `PLAN.md` section, `[C]` as implemented (file
named inline), `[F]` frozen here.

This document states what claude-handshake defends against and — with equal
weight — what it does not. Every guarantee below is one that the code can
actually keep. Docs, README copy, status output and marketing MUST NOT claim
more than this file claims.

---

## 1. Threat model

### 1.1 In scope

| # | Adversary / event | What we do about it |
|---|---|---|
| T1 | **Passive network observer** | TLS on both transports; every envelope is HMAC-signed (PROTOCOL §2.3) |
| T2 | **Passive ntfy subscriber holding the topic but not the workspace secret** | Body encryption (PROTOCOL §2.4, §9.3): they learn no file path, branch, task title, event type or human name `[P§2]` |
| T3 | **Stranger who finds the relay hostname** | `POST /ws` requires `RELAY_CREATE_TOKEN`; unset ⇒ `503`, fail closed `[R1]`. `GET /` and `/health` are built from frozen constants and read no workspace `[C relay/src/worker.js]` |
| T4 | **Workspace-id guessing** | 128-bit CSPRNG ids minted server-side; an unknown id returns `404` and writes no row, so probing cannot grow storage or bind a workspace `[C relay/src/do/workspace.js]` |
| T5 | **Credential brute force** | Digest-only storage, constant-time compare, per-IP failure limit 10/600 s applied to the *failure* not the request `[C config.js, workspace.js]` |
| T6 | **Leaked or compromised credential of a legitimate teammate** — laptop theft, a stale CI checkout, a repo clone kept after offboarding, a token in git history | §7 offboarding runbook; member-remove invalidates one sub-token and releases its claims; rotate with `grace_seconds: 0` closes the enrollment window immediately `[R5]`. Honest limits in §2 and §3 |
| T7 | **Revoked member still ticking** | `403 member_revoked`; the failure-scoped rate limit means their monitor cannot lock out the rest of the team `[C workspace.js]` |
| T8 | **Prompt injection through peer-authored data** — note bodies, claim subjects, member names, `.handshake/*` files, a non-member commit | §5 |
| T9 | **Prompt injection through the invite/install path** — repo content that tries to make a model join or install something | §5.4 |
| T10 | **Accidental secret disclosure by a well-meaning model** | §4 secret filter, with its contract stated honestly |
| T11 | **Committing secrets to a public repo** | §6 fail-closed private-repo guard |
| T12 | **Cross-workspace replay** | `ws` is inside the signature; a receiver rejects a foreign `ws`, and a foreign workspace's secret cannot produce a valid `sig` (PROTOCOL §2.5, Appendix B A5) |

### 1.2 Explicitly out of scope

State these plainly; do not let product copy erode them.

- **A malicious current member.** Out of scope, by design. A member can lie
  about presence, claim every subject, post misleading notes, read everything,
  and (on ntfy) sign as any peer. Neither transport carries a capability that
  could constrain a member, and v1 has **no automated peer verification**
  `[P Locked decisions 4]`. claude-handshake is a cooperation tool for a team
  that already trusts each other; it is not an access-control system.
- **The transport operator.** Cloudflare sees every relay body in cleartext in
  v1 `[C relay/README.md]`; the ntfy operator sees ciphertext plus full
  metadata (topic, timing, sizes, counts). E2EE on the relay is deferred
  (PROTOCOL §Deferred).
- **A compromised endpoint.** A machine running Claude Code holds the workspace
  secret, the sub-token, and the repo. Its compromise is total for that
  workspace.
- **The local user's own model.** A user who instructs their own Claude to
  exfiltrate is not an attacker we can stop; the secret filter is a seatbelt
  for accidents (§4), not a policy control.
- **Denial of service beyond the documented rate limits.** A topic holder can
  flood ntfy; a member can burn the Cloudflare free-tier daily request cliff
  for everyone on that account `[C relay/README.md]`.
- **Traffic analysis.** On ntfy, message counts, sizes and timing are visible
  to anyone holding the topic even without the workspace secret.
- **Availability of any coordination guarantee.** Claims are advisory leases,
  never locks (PROTOCOL §5). Nothing here prevents two people editing one file.

---

## 2. Trust boundaries per transport

### 2.1 ntfy zero-setup

- **The topic is a bearer credential.** Possession grants both publish and
  subscribe. It is `≥128-bit` CSPRNG and never derived from any name `[P§3]`,
  but it travels **in the URL path** — so it leaks into browser history, proxy
  and corporate-TLS logs, the ntfy server's own request logs, shell history,
  CI job logs, screen shares and error reports. Treat a topic that was ever
  pasted into a URL bar or a log as public.
- **There is no server-side identity.** `from` is
  **self-declared-but-HMAC-signed** `[P§2]`. A signature proves only *"someone
  holding the workspace secret wrote this"* — not which member, not which
  machine. Any member can sign as any peer.
- **Therefore claims on ntfy are `unauthenticated-advisory`** (PROTOCOL §5.5).
  Status output MUST say so.
- **Revocation does not exist.** There is no member-remove, no per-member
  credential, and nothing to revoke. Offboarding on ntfy means a **new topic
  and a new workspace secret and a re-invite of everyone who stays** (§7.2).
- **Deletion does not exist.** The operator's cache (~12 h, undocumented and
  operator-controlled `[P§2]` `[P§7]`) retains what was published regardless of
  anything the client does (§8.2).

### 2.2 Team relay

- **The sub-token is the identity.** `join` mints a per-member opaque
  sub-token, stored `0600` in local state; the enrollment token is demoted to
  an enrollment credential `[P§2]`. Ops are authorized to their owner: only a
  claim's owner can release it (`403 not_claim_owner`), only a member can write
  its own cursor `[C workspace.js]`.
- **What the server-stamped `from` DOES prove:** this message was posted to
  this workspace by whoever presented member X's sub-token, at the recorded
  `received_at`, and the relay refused to store it under any other member's id
  (`403 from_mismatch`, refuse-not-rewrite `[R3]` `[D3]`).
- **What it does NOT prove:**
  - not that a particular *human* or *machine* posted it — a stolen sub-token
    is indistinguishable from its owner;
  - not that the envelope's inner `from` matches, unless the client checks the
    wrapper against `envelope.from.member` — the relay refuses mismatches, but
    a client that never compares gains nothing from that refusal (PROTOCOL
    §9.2, MUST);
  - not that the body is authentic — **the relay never verifies `sig`**
    `[C relay/src/lib/envelope.js]`. Relay acceptance is not authentication.
    Clients MUST verify the HMAC themselves (PROTOCOL §2.3);
  - not confidentiality — the relay operator reads every body in v1.
- **The workspace secret never reaches the relay** (PROTOCOL §1). A relay that
  held it could forge and read every message. This is the reason the workspace
  secret and the enrollment token are distinct values.
- **Attribution is the pairing.** "This member said it" = valid HMAC under the
  workspace secret **and** wrapper `from` == `envelope.from.member`. Either
  alone is weaker than it looks: anyone with the workspace secret can forge the
  inner `from`, and the relay's stamp says nothing about the body.

---

## 3. Key material inventory

| Material | Format | Where it lives | Real holder set | Rotatable | Compromise response |
|---|---|---|---|---|---|
| **Workspace secret** (signing + body encryption) | 32 bytes CSPRNG, base64url `[F]` | guarded part of `.handshake/workspace.json`, or out-of-band | **everyone in §3.1** | Yes — but re-keying every member is manual and out of band | New secret + re-invite everyone; on ntfy also a new topic |
| **ntfy topic** | 32 hex ≥128-bit CSPRNG `[P§3]` `[F]` | same guard as the secret `[P§3]` | §3.1, **plus anyone who saw a URL or log** (§2.1) | Yes | New topic + re-invite; the old topic's cached messages stay readable to whoever holds it |
| **Relay enrollment token** | `hsk_<64 hex>_<8 hex>` `[C tokens.js]` | same guard | §3.1 | Yes — `POST /ws/:id/rotate`, grace 0–86400 s `[R5]` | Rotate with `grace_seconds: 0` |
| **Member sub-token** | `hsm_<16 hex id>_<64 hex>` `[C tokens.js]` | local state only, `0600`, one machine, never in the repo `[P§2]` | that one install | Reissued via rebind (PROTOCOL Appendix B A3) `[D7]` | `POST /ws/:id/members/:member/remove` — instant, and releases that member's claims `[C workspace.js]` |
| **Recovery key** | `hsr_<64 hex>_<8 hex>` `[C tokens.js]` | founder only, **out of band, never the repo** | the founder | **No — immutable in v1** `[D11]` | **Destroy the workspace and recreate it** `[D11]`. There is no other path |
| **`RELAY_CREATE_TOKEN`** | `hsc_<43 base64url>` when minted by `deploy-relay` / `upgrade` `[C lib/deploy.js]`; any opaque string for a hand-deployed relay. **Printed once** by those two commands and never persisted locally | `wrangler secret`, never `[vars]` `[C relay/README.md]` | whoever can deploy that Worker | Yes — `wrangler secret put` | Re-put the secret; existing workspaces are unaffected |

The relay stores **only SHA-256 digests** of credentials and compares them in
constant time `[C workspace.js]`. A lost recovery key is therefore
unrecoverable — that is a deliberate property, not a gap.

### 3.1 The true holder set of anything in the repo

Any secret committed to the private repo is held by **all of**:

- every person with read access, now — including read-only collaborators;
- every person who **ever** had read access and kept a clone;
- every **installed GitHub App** with `contents: read` on that repo, and every
  OAuth app a member authorized;
- every **CI checkout** — Actions runners, third-party CI, preview builders —
  and every log or artifact those jobs produced;
- every **container build** that copied the working tree, and every image layer
  it was baked into `[P§3]`;
- every fork, mirror, backup and local search index;
- **git history, forever**: rotating a credential does not un-leak the commit
  that contained it `[P§2]`. The only remedies are rotation plus, if the
  exposure warrants it, history rewriting and a new credential — and rewriting
  does not reach clones that already exist.

Consequences that MUST appear in user-facing docs: the workspace secret is a
**team-wide** credential, not a personal one; adding a repo reader adds a
holder of every workspace credential in that repo; and a repo that goes public
(§6) exposes all of them at once.

Credential formats are deliberately greppable — `hsk_` / `hsr_` / `hsm_`
prefixes with a checksum `[C tokens.js]`, plus `hsi1_` invites and `hsc_`
create tokens `[C lib/secret-shapes.js]` `[P§3]` — so GitHub push protection
and third-party secret scanners can catch a leak, and so `doctor` can tell a
credential from a workspace id at a glance. Teams that hit push protection MUST
be told to fix the leak, not to allowlist it; the allowlisting procedure is
documented only for the case of an intentional, already-rotated value.

---

## 4. The secret filter's honest contract

`filteredSend()` is the single outbound chokepoint: no code may hand data to a
transport except through it, and a test greps the tree for direct adapter calls
`[P§3]` `[C lib/outbound.js]`. **Every authored outbound field** is filter
input — presence notes, branch names, `files[]`, claim subjects, summaries,
member/display names, not just note bodies — and writes into `.handshake/*`
are filtered too `[P§3]`. Protocol machinery the client itself generates
(`ws`, `nonce`, `sig`, `ct`, machine/session pseudonyms) is exempt by design:
it carries no authored content, and a random 128-bit id would self-block every
message on the entropy heuristic `[C lib/envelope.js authoredFields]`.
Filtering happens at enqueue **and** again at send for the offline queue
(PROTOCOL §10.3).

What it actually does `[C lib/filter.js]`: a pattern battery for known
credential shapes (cloud keys, VCS/chat/package tokens, private-key blocks,
JWTs, connection strings with inline credentials, and claude-handshake's own
`hsk_` tokens), Shannon-entropy heuristics on long opaque tokens, and matching
against **normalized variants** — whitespace-stripped, base64-decoded,
hex-decoded, one transparent gunzip level — so the obvious evasions are covered
by the bypass corpus `[P§3]`. Any internal error returns "blocked", never
"allowed": the gate is fail-closed on its own failure `[C lib/filter.js]`.

One genuinely fail-closed control: values ≥ 8 chars harvested from local secret
files are held at sync; any outbound containing one, or a 12-char window of
one, is refused `[P§3]` `[C lib/filter.js]`. The scanned set is **bounded but
not narrow** (hardened at M13 after a red team leaked `secret.json` and
`config/*.yml` at 100%): `.env*`, `*.pem|key|p12|pfx`, `id_*`, `credentials*`,
`secret(s).json|yaml|toml|ini`, `.npmrc`, `.netrc`, `.pgpass`,
`service-account*.json`, `*_secret(s).*` — walked **recursively** to depth 3
(skipping `node_modules`, `.git`, build output), capped at 40 files, parsing
both `KEY=value` and `key: value` shapes. The tripwire matches over the same
normalized variants as the battery (whitespace-stripped, base64/hex-decoded,
one gunzip level), **case-folded and reversed** `[C lib/filter.js]`.

**The claim we make, and the only one:**

> A seatbelt against accidental disclosure, plus a closed tripwire for known
> local secrets — **not** a control against a motivated adversary. `[P§3]`

**Overclaiming is forbidden.** No document, command output or release note may
say the filter "prevents", "guarantees" or "ensures" that secrets do not leave
the machine. Known and accepted gaps, which MUST NOT be papered over:

- **Chunking defeats per-message scanning by construction.** A secret split
  across several notes passes every per-message check. The 2 KB body cap and
  the tripwire narrow this hole; they do not close it `[C lib/filter.js]`.
- Exactly-40-hex and exactly-64-hex runs are skipped by the entropy pass
  because git SHAs and content digests saturate developer chatter — **unless a
  credential word (`key`, `token`, `secret`, `password`, `auth`, `bearer`,
  `api`) appears within 24 chars before them**, which is the accidental-paste
  shape and never a SHA's `[C lib/filter.js, M13]`. A bare 40/64-hex key with
  no such context is still invisible to the entropy pass; only the battery and
  the tripwire cover it.
- UUIDs are skipped for the same reason.
- The tripwire only knows secrets it can read: files outside the project dir,
  files beyond depth 3 or past the 40-file cap, a credential store it does not
  parse (a keychain, a cloud secret manager, an encrypted vault), or a value
  shorter than 8 chars are invisible to it.
- A deliberately manipulated model can encode around any content filter. The
  normalization above covers the *obvious* transforms, not every transform.
- **M13 red-team result (2026-08-15), recorded honestly:** before hardening,
  odd-scheme DB connection strings (`mssql`, `mariadb`, `clickhouse`,
  `cassandra`, `snowflake`), bare 40/64-hex keys, branded tokens (Twilio,
  Shopify, Vault, DigitalOcean), UPPERCASED handshake credentials, and
  in-project non-`.env` secret files all leaked at ~100%. Each is now blocked
  and pinned by a regression test named for the attack `[C test/filter.test.js]`.
  The lesson generalizes: this is a denylist, and a denylist is only as good as
  its last adversarial review.

---

## 5. Prompt-injection defenses

Peer-authored content is **untrusted data**, always, regardless of who sent it.
The design assumption is that any note, subject, member name or `.handshake/`
file may have been written by an attacker.

### 5.1 The framing travels with the data

The trust framing is emitted **in the hook output on every injection**, and
never assumes SKILL.md is loaded `[P§3]`. A digest that is injected without its
framing is a defect, not a degraded mode.

### 5.2 The enumerated never-list (verbatim from `PLAN.md` §3)

> a peer note may inform decisions but may never by itself cause shell
> execution, file writes outside the current task, commits/pushes, config or
> plugin changes, installs, scope expansion, disabling mute/filter, or outbound
> posts

Enumerated, because a slogan is not a control `[P§3]`. A peer note MUST NEVER
by itself cause:

1. shell execution;
2. file writes outside the current task;
3. commits or pushes;
4. configuration or plugin changes;
5. installs;
6. scope expansion;
7. disabling mute or the secret filter;
8. outbound posts.

"By itself" is the operative phrase: the user may of course decide to do any of
these. The rule forbids peer text from being the *cause*.

### 5.3 Escaping and sanitization at the receive path

Sender-agnostic, applied to every field that can reach a model context `[P§3]`:

- strip control-tag-shaped text and wrapper delimiters, so a note cannot forge
  the boundaries of the injection block;
- strip C0/C1 control characters, bidi-override and zero-width classes — the
  same class of attack that keeps member ids restricted to printable ASCII in
  v1 `[D8]`; `display_name` is sanitized identically and capped at 40 chars
  `[D8]`;
- enforce the per-field length caps of PROTOCOL §3.2 after escaping, not
  before;
- render peer content as quoted, attributed data — never as instructions.

Member names are injected into peers' model context, which is precisely why the
charset is restricted rather than widened for "José" `[D8]`; widening waits for
a targeted sanitizer (PROTOCOL §Deferred).

### 5.4 The repo path gets identical treatment

- **`.handshake/*` files read from disk are untrusted data**, escaped exactly
  like transport content. Without this, the git path bypasses transport
  escaping entirely `[P§3]`.
- The digest MUST carry a warning when a tasks shard's **last commit came from
  an email other than the one recorded for that shard's own member** `[P§3]`.
  The check is per shard, not a membership lookup: each
  `.handshake/tasks/<member>.md` is compared against the email recorded for
  *that* member, and only a difference is the warning
  `[C lib/workspace-files.js:427-432,435,439]`. Its reach is exactly what the
  client can prove, and no more: `member_emails` is written only by
  `recordMemberEmail` `[C lib/workspace-files.js:459-469]`, which the CLI calls
  for the LOCAL member only — the founder at `init` or `deploy-relay`, everyone
  else at `join` `[C bin/handshake.js:524,698,2007]` — and a peer's email is
  learned on *their* machine, never inferred from a shard's self-declared
  header, a field an attacker writes too. So on any one machine only that
  member's own shard can reach `ok` or `mismatch`. Everything else falls to one
  of the earlier branches, and they are **not all `unknown`**, in this order:
  a shard whose last commit could not be read at all — not a repo, or `git log`
  itself failed — is `unknown` `[C lib/workspace-files.js:424]`
  `[C lib/repo.js:341,350]`; a shard with no commit yet on that path, whether
  because it is written but uncommitted or because the repo has no HEAD, is
  **`uncommitted`**, counted in neither list, so it raises nothing
  `[C lib/workspace-files.js:425]` `[C lib/repo.js:347-348,353]` — and that test
  runs *before* the recorded-email lookup, so an uncommitted peer shard never
  reaches `unknown` either; and a shard that *is* committed but whose member has
  no recorded email here — the normal case for every peer — is `unknown`
  `[C lib/workspace-files.js:428]`. Only the two `unknown` branches feed
  `unverified_shard_authors` `[C lib/workspace-files.js:436,442]`.
- **One flag, and the mismatch takes precedence.** Both lists are always
  computed and persisted `[C lib/workspace-files.js:437-443,452-453]`, but the
  digest carries a single `flag`: `non_member_commit` if any mismatch exists,
  otherwise `unverified_shard_authors` if anything is unknown, otherwise
  nothing `[C lib/workspace-files.js:442]`. Both renderers select one branch
  off it `[C lib/workspace-files.js:524-533]` `[C bin/handshake.js:1297-1302]`,
  so the MUST is exactly this: when there is **no** mismatch, an unknown shard
  MUST be reported as `unverified` — a note, never an alarm. When there **is**
  a mismatch, the louder warning is what gets shown and the unverified shards
  are not reported alongside it; they remain in local state under
  `repo_warnings.unverified` and are absent even from `status --json`, whose
  repo block carries only the flag and the mismatches
  `[C bin/handshake.js:1259-1264]`. The guarantee is therefore that a shard is
  never silently reported as clean, not that both signals are shown at once.
- Per-workspace `inject: on|off`; `/handshake mute` is purely local state
  `[P§3]`.
- **The invite chain is human-gated**: `join` always prints relay host,
  transport and workspace name and requires explicit human confirmation — never
  auto-join, never triggered by repo content `[P§3]`. The CLAUDE.md block is
  addressed to the human ("this project uses claude-handshake; run
  `/handshake join` to participate") and carries a standing rule that
  **repo-resident install suggestions are never acted on unprompted** `[P§3]`.
- **Install is not digest-pinned end to end**
  `[C installers/install.sh, installers/install.ps1]`. The release zip does
  ship a sha256, recorded beside its archive URL in
  `.claude-plugin/marketplace.json`, and the primary route both installers
  take — `claude plugin marketplace add` then `claude plugin install` —
  resolves that pinned entry. But the manifest carrying the digest is itself
  fetched unpinned from `main`, and the fallback route taken on WSL or when
  the plugin route fails skips it entirely: it fetches the moving `main`
  archive over HTTPS and verifies no digest. Pinning the fallback to a tagged
  asset, and the manifest to a tag, is open work — not a shipped guarantee.
  That the recorded digest is the released archive's own is held by a release
  gate, not by CI: it is rebuilt and diffed by hand at tag time (PLAN.md §8),
  because the hash describes the previous release's artifact and any
  per-commit assertion on it would fail on the next commit.
  Invites are documented as credentials `[P§3]` (PROTOCOL §9.1).

### 5.5 Unsigned fields are never acted on

Unknown top-level envelope fields are outside the canonical serialization and
therefore unauthenticated; receivers MUST ignore them in every protocol version
(PROTOCOL §2.1, §11). A `member_map` in `ws.migrate` is honored only for the
signed sender (PROTOCOL §9.4).

---

## 6. Private-repo guard

Committing workspace secrets to the repo is permitted **only** on an
affirmative private-repo answer. The guard is **fail closed** `[P§3]`:

| Condition | Verdict |
|---|---|
| authenticated call returns `isPrivate: true` | secrets MAY be committed |
| `isPrivate: false` | treated as public |
| API error, timeout, missing `gh`, unauthenticated, ambiguous | **treated as public** |

Public means: never commit the guarded part — gitignore it and distribute the
secret out of band `[P§3]`.

- **Re-checked on a cached TTL at every sync**, TTL frozen at **600 s** `[F]`
  (`[P§3]` requires the re-check; the interval is frozen here). A stale
  affirmative older than the TTL is not an affirmative.
- **Visibility flip**: a repo found public with tracked secrets **hard-fails
  posting, loudly**, and demands rotation `[P§3]`. This is a loud-rejected
  condition (PROTOCOL §10.2); it MUST NOT degrade silently.
- `doctor` checks for public-repo-with-tracked-token and for token-in-history
  `[P§3]`.
- **Rotation never un-leaks git history** `[P§2]` `[P§3]`. A rotated token
  remains in every clone, fork and archive of the commit that carried it (§3.1).
  Rotation is what stops *future* use; it does nothing about the past.
- A leaked ntfy topic requires **a new topic plus a re-invite** `[P§2]` — there
  is nothing to rotate in place.

---

## 7. Offboarding and recovery runbooks

### 7.1 Offboarding on the team relay

1. **Revoke the person's repo access first.** That is where the enrollment
   token and workspace secret live `[C relay/README.md]`. Doing this after
   step 3 leaves them able to re-read the new credentials.
2. `POST /ws/:id/members/:member/remove` with the recovery key. Their sub-token
   stops working immediately and every claim they held is released
   `[C workspace.js]`.
3. `POST /ws/:id/rotate` with the recovery key. Default grace 86400 s keeps
   peers mid-join working; **pass `{"grace_seconds": 0}` when the departure is
   hostile or a leak is suspected** `[R5]` `[C relay/README.md]`.
4. **Re-key the workspace secret** and re-invite the remaining members — a
   departing member who kept a clone still holds the old signing key, and on
   the relay that lets them forge an envelope's inner `from` (§2.2). Rotation
   of the enrollment token alone does **not** cover this.
5. **Verify**: the removed member's id no longer appears in `sync.members[]`;
   their presence row is gone; `claims_released` matched expectations; a probe
   with their old sub-token returns `403 member_revoked`.

Rotation does not invalidate other members' existing sub-tokens
`[C relay/README.md]`, and it does not rotate the recovery key `[D11]`.

### 7.2 Offboarding on ntfy

There is no revocation (§2.1). The runbook is:

1. Revoke repo access.
2. Create a **new topic and a new workspace secret**.
3. Re-invite everyone who stays; post `ws.migrate` on the old topic only if the
   departure is amicable — a hostile departure means the old topic is simply
   abandoned without a forwarding pointer.
4. Accept that the old topic's cached traffic (~12 h) stays readable to anyone
   who kept it (§8.2).

### 7.3 Lost local credentials (rebind)

A member that loses local state loses its sub-token, and names are permanently
retired on removal — so re-joining under the same name is refused
(`409 member_name_taken`, including for revoked names) `[C workspace.js]`. The
recovery path is the recovery-key-authorized rebind endpoint
`POST /ws/:id/members/:member/rebind` `[D7]`, which reissues a sub-token for an
existing non-revoked member and invalidates the previous secret. It is
**implemented in relay v0.1.1** (PROTOCOL Appendix B A3; `[C workspace.js]`
`#memberRebind`) and accepts the member id or the member name in the path. It
keeps the member id — and with it that member's claims, cursor and place in
every peer's roster. It never un-retires a removed member (`409
member_revoked`), and an unknown member is `404 member_not_found`. There is
**no `handshake rebind` CLI verb** `[C bin/handshake.js]` (it is in neither
COMMANDS nor USAGE): the workspace owner calls the endpoint directly with the
recovery key, then hands the reissued sub-token to that member out of band.
The operator steps are relay/README.md "Lost-credential runbook". After a rebind the client must
restart its `sender_seq` from the current Unix ms, because
`(member, sender_seq)` is still the dedupe key.

Rebind is deliberately on the recovery key, not on the enrollment token: on the
enrollment token, any member could seize any other member's identity.

### 7.4 Compromised recovery key

The recovery key is immutable in v1 `[D11]`. A compromised recovery key means
**destroy the workspace and recreate it**: `DELETE /ws/:id`, create a new
workspace, re-invite. A destroyed id can never be re-bound, because the tables
are dropped and every later request — including `join` — sees an uninitialized
object `[C workspace.js]`.

---

## 8. Retention and deletion

### 8.1 Team relay

| Data | Retention | Deletion |
|---|---|---|
| messages | TTL 7 days **and** last 500, whichever bites first `[C config.js]` `[P§3]` | `POST /ws/:id/purge`; reads already filter by TTL so an expired message is never returned even before the sweep `[C workspace.js]` |
| claims | until release, expiry (default TTL 2 h) or member removal | `purge` with `{"all": true}` |
| presence | until overwritten, member removal, or `purge {"all":true}` | as above |
| members, cursors, credential digests | until member-remove or workspace destroy | `DELETE /ws/:id` drops every table |
| `next_seq` | never reset by `purge` — reused sequence numbers would rewind every cursor and replay old traffic `[C workspace.js]` | destroyed with the workspace |

`DELETE /ws/:id` **drops** the tables rather than emptying them, which actually
returns the storage `[C workspace.js]`.

### 8.2 ntfy — what is retained regardless of anything we do

- The ntfy server caches published messages for roughly **12 h**; the exact
  window is operator-controlled and undocumented `[P§2]` `[P§7]`. The client's
  cursor rules (PROTOCOL §6.4) use an 11 h margin precisely because that number
  is not ours to trust.
- **There is no delete.** A published message cannot be recalled, redacted or
  expired early by any client action. Rotating the topic does not remove the
  old topic's cache.
- The bodies are ciphertext (PROTOCOL §9.3), so what is retained is unreadable
  without the workspace secret — but it is retained, and it becomes readable to
  anyone who later obtains that secret. Encryption converts a retention problem
  into a key-management problem; it does not remove it.
- Metadata — topic, timing, sizes, counts — is retained in the clear.

### 8.3 Local

Local state (`${CLAUDE_PLUGIN_DATA}`) holds the sub-token, cursors, the offline
queue and the peer cache. The sub-token file and the offline queue MUST be
`0600` `[P§2]`. The offline queue is hard-discarded on any transport, topic,
endpoint or token change, reporting the dropped count (PROTOCOL §10.3).

---

## 9. Operational privacy

- **Machine pseudonyms, never hostnames.** `machine` is a random per-install
  value `[P§2]`, format `m-<8 hex>` (PROTOCOL §1). `session` is a hash of the
  host session id, not a path `[F]`. Nothing in the protocol carries a
  hostname, absolute path, IP address or working directory.
- **The member name is the one field that can carry your local username.**
  `init` and `deploy-relay` have to work unattended, so when `--as` is absent
  they DERIVE it from `os.userInfo().username`, with no prompt
  `[C bin/handshake.js:402-407]` `[C bin/handshake.js:445-446]`
  `[C bin/handshake.js:1948-1949]`. That derivation is lossier than
  "sanitizing" suggests: the filter is
  `.replace(/[^\x20-\x7e]/g, '')`, so **every character outside printable ASCII
  is deleted, not merely the non-printable ones** — then whitespace is folded to
  `-` and the result truncated to 48 chars `[C bin/handshake.js:405]`. `Ann Lee`
  becomes `Ann-Lee`; `José` becomes `Jos`; and a username written entirely in
  Devanagari, Cyrillic, Han or any other non-Latin script leaves the empty
  string, so the fallback takes over and **that user is enrolled as `founder`**
  `[C bin/handshake.js:406]` — their own name erased rather than transliterated,
  with nothing in the derived id to distinguish them. `--as <name>` is what
  spares them — but the same charset rule follows almost everywhere: the relay
  rejects any member name outside printable ASCII 1-64 with
  `member_name_invalid` `[C relay/src/do/workspace.js:25,373]` and `join`
  enforces that rule client-side before it posts anything
  `[C bin/handshake.js:634-636]`, so the one route that takes an arbitrary `--as`
  string unchecked is `init` on the ntfy tier, where nothing enrols.
- **Where that derived name travels depends on the tier.** On ntfy nobody
  enrols, so the name *is* the member id: `founderMember` stays `founderName`
  `[C bin/handshake.js:453,479]` and it goes out as `from.member` in every
  envelope `[C bin/handshake.js:175-177,206]`, inside the signed canonical form
  `[C lib/envelope.js:305-306]`. On the relay it is not the id: enrolment mints
  an opaque `member_id` — 8 random hex `[C relay/src/lib/tokens.js:49-51]` —
  and *that* is what is stored as the primary key, what `from.member` carries,
  and what the relay enforces on every post
  `[C bin/handshake.js:460,479,1958]` `[C relay/src/do/workspace.js:603-604]`.
  The derived name is still stored beside it as the unique `members.name`
  `[C relay/src/do/workspace.js:389-397]` and handed to every peer in the
  roster, in presence, and as a claim's `owner_name`
  `[C relay/src/do/workspace.js:244,704-714]`. So on both tiers peers read it
  and it is injected into their model context (§5.3) — which is why both
  commands print the derived name before enrolling anything
  `[C bin/handshake.js:445-446]` `[C bin/handshake.js:1948-1949]`. `--as <name>` on either command replaces it
  outright, and `join` never derives at all: it takes `--as`, or asks the human
  for a member name `[C bin/handshake.js:631-633]`. Pick the name you want peers
  to read — a derived one is a default, not a guarantee of anonymity.
- **Observability off by default** `[R6]`: `[observability] enabled = false` in
  `wrangler.toml`, because platform invocation logs record request URLs and a
  URL here contains the workspace id `[C relay/README.md]`.
- **Never log bodies.** The relay logs only a redacted error code and an
  error's constructor name; no bodies, no headers, no messages; a test fails
  the build if a `console.*` call appears anywhere else `[C relay/src/lib/log.js]`
  `[P§3]`. `Authorization` redaction is tested `[P§3]`. `wrangler tail` shows
  the redacted errors live without persisting them.
- **Credentials never travel in a request body** — only in `Authorization` — so
  they cannot land in a proxy's body log `[C workspace.js]`.
- `GET /` and `GET /health` read no workspace and return frozen constants only:
  an unauthenticated caller cannot learn workspace ids, names, member counts or
  activity `[C relay/src/worker.js]`.
- **No telemetry.** The plugin reports nothing to the project's authors. The
  only network destinations are the workspace's own transport and, where
  configured, GitHub.
- **No module-scope mutable state in the Worker**, enforced by a test: an
  isolate is reused across requests and eyeballs, so anything mutable there is
  a cross-request leak `[P§3]` `[C relay/src/worker.js]`.
- The M0.5 spike's raw hook log was analyzed with a local aggregator and **never
  entered a model context** `[S: spike hygiene]`; the same discipline applies to
  any future measurement of real workspace traffic.

---

## 10. Reporting a vulnerability

Report privately through **GitHub private vulnerability reporting** on
`thephenyl02-creator/claude-handshake`
(Security → Report a vulnerability). Do **not** open a public issue, and do not
disclose in a pull request title or a public discussion.

Useful reports include: the transport and rung involved (zero-setup or team
relay), the protocol version, whether the finding needs credentials and which
ones, a minimal reproduction, and the impact you believe it has.

- Acknowledgement target: **72 hours**. This is a small project; that is a
  target, not a contractual SLA.
- Findings that reduce to something in §1.2 (out of scope) will be answered
  with a pointer to that section rather than a fix — but a report showing that
  an out-of-scope item is **worse than this document admits**, or that a stated
  guarantee does not hold, is exactly the report we want.
- No bounty is offered.
- Please do not test against workspaces you were not invited to, and do not
  test against other people's relays. Deploy your own — it takes about three
  minutes `[C relay/README.md]`.
