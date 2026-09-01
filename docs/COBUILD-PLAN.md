# claude-handshake — v1.1 build plan: co-building, and where delegation goes

**Status: BUILD PLAN. Nothing here is built. Nothing here is ratified.**
**Protocol version integer stays `1`.**

Written against `docs/COBUILD.md` (the seam design), `docs/DELEGATION.md` (offers),
`docs/PROTOCOL.md` (FROZEN, M1), `docs/SECURITY.md`, `PLAN.md` and the tree as it
stands on 2026-09-01. Markers follow the house convention: `[P§n]` = PROTOCOL.md
section n, `[C file:line]` = value as implemented and re-read for this plan,
`[PLAN§n]` = PLAN.md section n. Every `[C]` marker below was opened during this
pass; three of the ones `docs/COBUILD.md` carries did not survive that reading,
and §3.S0 says which.

Two researchers re-checked the world between 2026-08-14 and 2026-09-01. §1 says
what they found, what I re-opened myself, and which of their claims I am willing
to build on. §8 carries their coverage forward.

---

## 1. What changed since August, and what it means for this plan

### 1.1 Spot-check first

Eleven load-bearing claims were re-opened at their source before anything below
was written. **All eleven held at the quote level.** The primary docs were read
in full rather than summarized; the two GitHub issues were read through `gh`.

| # | Claim | Source re-opened | Verdict |
|---|---|---|---|
| 1 | Cross-session messaging is scoped to *your* sessions, enforced at the OS-user level locally | `code.claude.com/docs/en/cross-session-messaging` | **held, verbatim** |
| 2 | Native Windows floor is v2.1.234; WSL 2 and native Windows can't reach each other | same page | **held, verbatim** |
| 3 | "In every approach the workers are Claude sessions" | `code.claude.com/docs/en/agents` | **held, verbatim** |
| 4 | Artifact editors on Team/Enterprise republish from their own session; a sent comment reaches a running session and Claude can edit without being asked; 60/hour; org-scope only | `code.claude.com/docs/en/artifacts` | **held, verbatim — with one sharpening, §1.3** |
| 5 | Agent teams: experimental, off by default, one team per session, lead is fixed, mailbox is a file under one user's `~/.claude` | `code.claude.com/docs/en/agent-teams` | **held, verbatim** |
| 6 | The plan matrix has no collaboration row | `code.claude.com/docs/en/feature-availability` | **held** — 15 rows, none of them collaboration |
| 7 | #28300 open, 45 comments, every one `authorAssociation: NONE` | `gh issue view 28300` | **held** — 45/45 NONE, `closedAt: null` |
| 8 | #60082 open, zero Anthropic replies, updated today | `gh issue view 60082` | **held** — 8/8 NONE, updated 2026-09-01 |
| 9 | claude-together: cross-account, cross-machine, E2EE P2P — and "Plain text only, 16 KB cap. No files, no commands, no code execution" | `github.com/wybe-labs/claude-together` | **held, verbatim**; no claiming/reservation/locking verb in its tool list |
| 10 | MCP Agent Mail: exclusive file reservations with TTL, pre-commit guard blocking conflicting commits | `github.com/Dicklesworthstone/mcp_agent_mail` | **held**; and it is documented for **one person's many agents**, not two accounts |
| 11 | pas-de-deux: "an orchestrator without authority… time is given by expiries rather than by an arbiter"; reservations stage 3, locks stage 4, both unshipped; `v0.1` does not block | `github.com/chiccorich/pas-de-deux` | **held, verbatim**; **no network of any kind** |

One item I did **not** resolve and am not building on: the researchers flagged a
discrepancy between the doc's native-Windows floor (v2.1.234) and the changelog's
announcement (v2.1.239). The doc states 2.1.234 in three places consistently; I
did not open the changelog myself, so the changelog side of that discrepancy
stays theirs. Nothing in this plan depends on it.

### 1.2 What changed, and whether any of it makes COBUILD redundant

**Nothing here is made redundant. The core gap is unchanged.** Stated as
findings rather than reassurance:

- **Cross-session messaging is still single-account, and the enforcement is
  structural, not incidental.** *"On macOS and Linux, Claude Code restricts the
  socket to your operating-system user. On native Windows, it instead requires
  each connection to authenticate first with a key that only your
  operating-system user can read. Either way, on a shared machine another user's
  sessions can't deliver to it."* [verified] The remote leg needs *"a claude.ai
  sign-in as this session's active authentication"* [verified] and finds *your*
  sessions. There is no share, invite, guest or grant concept in the page.
- **The one baseline item that changed is a platform gap, not the account
  boundary.** Native Windows got cross-session messaging (floor v2.1.234
  [verified]), and the third-party providers got the same-machine leg at v2.1.248
  [verified, on the feature-availability footnote]. Both are same-account. What
  this changes for us is narrower than it sounds and worth one line: a
  Windows-native handshake now sits beside a working first-party same-account
  transport, so README copy must not imply handshake is the only way two of
  *your own* sessions can talk. It never was the claim; it must not become one.
- **Agent teams are still a manager with staff.** *"One team per session"*,
  *"Lead is fixed"*, mailboxes at `~/.claude/teams/{team}/inboxes/` [verified].
  Not two peers, and not two accounts.
- **Anthropic's own comparison page settles it in one sentence**: *"In every
  approach the workers are Claude sessions"*, and cross-session messaging
  passes findings *"between sessions you run yourself"* [verified]. This is the
  page written to answer "what are my options", and no option in it involves
  another person.
- **Both GitHub issues remain open with zero maintainer engagement.** 45/45 and
  8/8 comments at `authorAssociation: NONE` [verified]. Six months on #28300.
  Read the silence as: not being worked on in public.

`[PLAN§7]`'s first risk — *"Anthropic ships native cross-account collab → ride
it"* — is not triggered. The mitigation stated there (plugin-shaped, the brain
survives a transport swap) is unchanged and untested, which is correct.

### 1.3 The one native primitive worth naming, and why the design should not ride it

The researchers' most important find, and the one their own headline slightly
overstates. Verbatim from the artifacts doc, all re-opened:

> *"On Team and Enterprise plans, you can also make someone an editor."* ·
> *"An editor publishes new versions the same way you update the artifact from
> another session… Everyone with the page open sees each update live."* ·
> *"After your session publishes an artifact, Claude Code watches that artifact
> for comments for as long as the session runs. When someone who can edit the
> artifact sends a comment to Claude, it reaches your session right away, and
> Claude can read the thread and reply without you asking."* ·
> *"Claude reads the thread and replies, and edits the artifact when the comment
> asks for a change."*

That is real: a second person's message starting a turn in a first person's
running session, with an edit at the end of it. It is the closest thing to an
agent-to-agent channel Anthropic ships.

**The sharpening the plan needs.** It is not cross-*account* in the sense this
product means. The share page reads *"grant access to specific people **in your
organization**… Viewers sign in to claude.ai as members of your organization"*,
and comments exist only because *"only an artifact you share within your
organization takes comments"* [all verified]. So it is cross-*user*,
**intra-organization**, Team/Enterprise, throttled at *"60 sent comments or
thread activations on that artifact within an hour"* [verified]. Two independent
Anthropic accounts — the case in `PLAN.md:3-5` — cannot use it at all.

**Should the design ride it instead of reimplementing? No, and the reason is
structural rather than competitive.** The seam's payload is a file in a working
tree, materialized at a client-computed path, governed by two ordinary claims
with their own TTLs and tiebreak positions, gated by the PreToolUse path check,
and filtered by `sendGate` before it leaves the machine. An artifact is *"one
self-contained page with no backend"* [verified] on claude.ai. Riding it would
mean giving up the repo, the claims, the permission model and the two-account
case, to gain an org-scoped page — which is not a transport swap, it is a
different product.

**What to take from it instead, as a design constraint on the roadmap:** the
artifact channel is the seam Anthropic is most likely to widen, because it
already has cross-account-within-org editors, org ACLs and a wake path. Do not
architect anything in v1.1 that a first-party org-scoped agent channel would
obsolete. Concretely: never build toward "a shared live object hosted by
Anthropic" as the seam's medium. §4.1's decision to carry the contract **text on
the wire** into **both trees** is the one that keeps us out of that path, and it
should be treated as load-bearing rather than incidental.

### 1.4 The nearest third-party work, and what it says about the gap

- **`wybe-labs/claude-together`** [verified, created 2026-08-28]. The strongest
  cross-account transport built: *"different Anthropic accounts, different
  machines, anywhere on the internet — exchange messages over a direct,
  end-to-end encrypted P2P connection."* And it stops exactly where co-building
  starts: *"Plain text only, 16 KB cap. No files, no commands, no code
  execution."* Its tool list is invite / join / send / interrupt / inbox /
  history / status — **no reservation verb, no claiming, no conflict layer**.
  This is the decisive negative finding: the best pipe in the field declares
  itself out of scope for the brain.
- **`Dicklesworthstone/mcp_agent_mail`** [verified, 2,120★]. The strongest
  claiming primitives: `file_reservation_paths(..., ttl_seconds, exclusive)`
  and a *"pre-commit guard… that blocks commits conflicting with other agents'
  active exclusive file reservations."* Wired for **one person's many agents**
  behind a server that person hosts — its own README frames it as *"multiple
  coding agents at once (backend, frontend, scripts, infra)"*, not two accounts.
- **`chiccorich/pas-de-deux`** [verified, created 2026-08-30, 0★]. Names the
  exact target — *"Two people, one machine, one working copy, one Claude Code
  session each — without stepping on each other's toes"* — and has shipped only
  the knowledge layer. Reservations are stage 3, locks stage 4, both unshipped;
  *"In v0.1 it does not block."* Same machine, same directory, **no network at
  all**. The nearest miss in intent, and it confirms the gap from the inside.

**Nobody has combined a cross-account consent transport with a claiming layer.**
The contract-revision idea — a versioned interface text that both trees converge
on — has no precedent anywhere I opened. §7 says what is worth stealing.

---

## 2. The target, in three sentences

**Smart collaboration is two people's Claudes building the two halves of one
interface at the same time, against a shape both sides have signed, with no
human relaying anything between them after the one time each said yes.**

**It is not Slack, JIRA, or one-boss orchestration**: nothing here carries prose
for a human to read and act on, nothing here holds a backlog, and neither side
is anyone's lead — the two Claudes are peers holding two ordinary claims, and a
peer message may always *narrow* the other side's permissions and never widen
them `[COBUILD §2.7]`.

**The one property that makes it more than messaging is that the exchange
changes what the other model builds without asking its human** — a revision
arriving at B's machine materializes as a file in B's tree and B's Claude builds
its half against it, which is a thing no note, no digest item and no amount of
chat can do, and is exactly the capability §12 charges for honestly.

---

## 3. The build

Derived from `docs/COBUILD.md §10` (v1.1a — *"All four tiers of §1.1 are in
v1.1a, and the split is not available"*) and `docs/DELEGATION.md`'s smallest
version. Sequenced so **every milestone leaves a working, testable product** —
S1 ships a consent object with no content flowing, S2 ships the exchange, S3
ships the brain that makes the model use it. The last thing to be cut is the
first thing to be built.

### S0 — Ratify the wire, and fix three defects the design carries

**Scope.** The Appendix B delta rows, verbatim from `COBUILD §11`, into the
frozen document — plus three corrections found while re-reading the tree for
this plan, each of which would otherwise have shipped as a live bug.

**Exact PROTOCOL.md sections touched:**

| Row | PROTOCOL.md section | Edit |
|---|---|---|
| **E1** | **§3 Event type catalog** `[C docs/PROTOCOL.md:226-254]` | Add the `task.seam` row. Amend the `[F]` sentence *"a v1 client MUST NOT originate a type outside this table"* `[C docs/PROTOCOL.md:228-229]` to name v1.1's table. This is a deliberate widening of a frozen line, ratified here or not at all — §11's *"a v2 MAY add new event types"* `[C docs/PROTOCOL.md:1022]` is scoped to **v2** and citing it as cover is a category error. |
| **E2** | **§3.2 Body schemas** `[C docs/PROTOCOL.md:281-357]` | Add the `task.seam` row: the `COBUILD §7.1` schema, `to`'s addressing-only MUST-NOTs verbatim from `DELEGATION.md:273-277` (one definition, not two), the accept-echo discard rule, and receiver-side authorization per `COBUILD §7.2`. |
| **E3** | **§3.1 Carriage per transport** `[C docs/PROTOCOL.md:256-275]`, and **§6.1** | `task.seam` travels as an **envelope** on both transports. **Not** added to `RELAY_NON_CARRIED_TYPES` `[C lib/envelope.js:49-51]`; **not** a priority type — `isPriorityType` is unchanged on client `[C lib/envelope.js:53-55]` and relay. Plus the two normative client rules, both about *adoption*: materialize-and-adopt automatically iff `capabilities().authenticated_from`, and write the contract file with or without a git working tree while never calling it durable. |
| — | **§11 Versioning** `[C docs/PROTOCOL.md:1011-1043]` | State that v1.1 widens the catalog for senders while the version integer stays `1`, and that §5.4, §4.2, §5.1, §5.2, §5.3, §6.1, §6.2, §6.3, §9.2 and §10.3 are untouched — the "Explicitly NOT amended" list of `COBUILD §11`, moved into the frozen document where a future reader will find it. |
| — | **Appendix A Conformance vectors** `[C docs/PROTOCOL.md:1044-1096]` | One `task.seam` vector, so two clients cannot disagree about canonical serialization of the new body. |

**The three defects.** Each was found by opening the file `COBUILD §10` cites.

1. **`escape.CAPS.text` is already `800`** `[C lib/escape.js:36]`, and
   `escapeField` picks the cap **by field name** — *"Cap chosen from the field
   name (PROTOCOL 3.2), so callers cannot silently widen a cap by forgetting
   it"* `[C lib/escape.js:150-155]`. `COBUILD §10` item 1's *"two `escape.CAPS`
   entries (`text: 1200`, `name: 60`)"* would therefore **widen every `note.*`
   body in the product from 800 to 1200**, quietly, across a `[F]` cap
   `[C docs/PROTOCOL.md:327]`. **Fix: the contract field is named `contract`,
   not `text`**, and gets `CAPS.contract = 1200`. Not an explicit `{max: 1200}`
   at the call site — that is precisely the hole the comment at
   `[C lib/escape.js:150-151]` exists to close.
2. **`escape.CAPS.name` is already `64`** `[C lib/escape.js:50]` and is used by
   `escapeRecord`'s key escaping `[C lib/escape.js:183]` and by the render
   slot `escapeSlot(d, 20, 'name')` `[C hooks/render.js:138]`. Adding
   `name: 60` **narrows** an existing cap. **Fix: `CAPS.seam_name = 60`**, or
   reuse 64 and add nothing. Either is fine; silently renumbering `name` is not.
3. **`test/seams.test.js` already exists and means something else** — the
   integration seams between `deploy-relay`, `init --relay` and `join`
   `[C test/seams.test.js:1-18]`. The co-build suite is
   **`test/seam-cobuild.test.js`**. Renaming the existing file to make room
   would be a gratuitous diff over a real test.

Two citation drifts, corrected here so the plan's markers are the accurate ones:
`queueExpiryAt`'s `task.*` branch is `[C lib/state.js:156-159]` (COBUILD says
:143-146) and it does give a `task.*` envelope `base + body.ttl × 1000`, which is
the whole reason `ttl` beats `expires_at` and §10.3 needs no amendment;
`projectTasks` still has exactly one caller in the tree, now
`[C bin/handshake.js:1081]` (COBUILD says :1066), so `COBUILD §6.3`'s argument
that shard records would be write-only stands unchanged.

**The budget gate, before a literal is written.** `BUDGET = 600` is hard and
charged to every turn of every session `[C hooks/render.js:31]`; the worst pinned
measured example is **562** `[C skills/handshake-coordination/references/standing-block.md:121]`.
`· seam` costs 7 untrimmable chars → 569. With `DELEGATION`'s `COND.offers_in`
at ~20 → 589. Re-measure the way M7/M11 measured the block `[PLAN§5]`. **This is
a gate, not a note**: if it fails, S3 is where the ranking decision lands.

**Files.** `docs/PROTOCOL.md` · `lib/escape.js` (the two CAPS entries, S1) ·
`test/envelope.test.js` · `test/escape.test.js` · `skills/handshake-coordination/references/standing-block.md`.

**Reuses.** Appendix B's delta style; Appendix A's vector format; the M1 freeze
discipline `[PLAN§5 M1]`.

**Tests that prove it.** A conformance vector for `task.seam` round-trips
byte-identically. A test asserts `TYPES` `[C lib/envelope.js:41-45]` and the §3
catalog table agree, so the two can never drift. A **regression pin** asserts
`CAPS.text === 800` and `CAPS.name === 64` — the defect above, nailed shut.
`test/no-direct-send.test.js` unchanged and still green.

**Tier: Opus xhigh.** M1's tier, for M1's reason: it is a freeze, and it amends
an `[F]` line.

---

### S1 — The consent object: ledger, four verbs, no content

**Scope.** `COBUILD §10` items 1–6, minus the materializer. This is the milestone
that makes the feature real while **nothing peer-authored ever reaches a tree**.

- `'task.seam'` into `TYPES` `[C lib/envelope.js:41-45]`, enforced for senders at
  `build()`; a named `authoredFields` case; the `CAPS.contract` / `CAPS.seam_name`
  entries from S0; the §7.1 body validator.
- **`seams.json`**, beside `peers.json` / `queue.json` / `digest.json`
  `[C lib/state.js:185-189]` rather than inside `state.json`, for the reason
  those are separate — `state.json` is read-modify-written by hooks on hot
  paths. `0600`, capped 8, dropping ended-oldest, `dropped_total` reported in
  `status`: the offline queue's honesty rule, because a trimmed list that does
  not say it was trimmed is a lie `[P§10.2]`. **Consent lives here and only
  here** — a contract file with no ledger row is inert `[COBUILD §6.2]`, so
  losing local state *ends* every seam, which is the correct failure direction.
- **`handshake seam open "<name>" --with <m> --mine "<s>" --theirs "<s>" [--ttl]`**
  — refuses unless the caller holds a live claim on `mine`; refuses on the
  **inverted overlap rule**, Jaccard ≥ 50 `[P§5.2]`, because two subjects that
  overlap that much are the same work and §5.4 should settle it rather than a
  consent gate papering over it; prints where the contract file will appear,
  whether git will carry it, and on an unauthenticated transport the gate it
  implies.
- **`handshake seam accept <id>`** — shaped like `join`, and that precedent is
  code, not analogy: `join` prints transport, endpoint host and workspace,
  **refuses `--yes`**, and requires a typed confirmation
  `[C bin/handshake.js:588-604]`. `accept` prints both subjects, the TTL, the
  tier label, and the §2.3 closed permission list; takes the accepter's claim on
  `theirs`; **fails whole** if that claim loses, so nobody is a party to
  anything.
- **`handshake seam [--json]`** — read-only, both directions, quoted and
  attributed. Until S2 there is no contract, so this is the only surface at all.
- **`handshake seam end <id> [--all]`** — flips the local ledger **before** the
  network call, so the permission dies the instant the command runs and cannot
  be held open by a peer, a dropped message, or an unreachable transport.

**Files.** `lib/envelope.js` · `lib/escape.js` · `lib/state.js` ·
`bin/handshake.js` · `commands/handshake.md` · `lib/subject.js` (the inverted
admission test).

**Reuses — every one of these already works and is not re-implemented.**
Ordinary **claims** carry ownership, with their own progressive `files[]`
`[C hooks/post-tool-use.js:77-92]`, lease and tiebreak position, so the seam adds
**no exclusion mechanism at all** `[COBUILD §5.1]`. The **`filteredSend` /
`sendGate` chokepoint** `[C lib/outbound.js:23]` takes every field of every seam
post as filter input, and `test/no-direct-send.test.js` enforces that
structurally by grepping the tree for direct adapter calls — the new verbs
inherit the enforcement by construction. **`refuseIfChild`**
`[C bin/handshake.js:374]` on all four verbs: children never post
`[P§7.2 rule 1]`. The **`join` confirmation register**
`[C bin/handshake.js:588-604]`. The **§5.4 tiebreak comparator**, borrowed for a
new object without touching claims. The **overlap machinery** `[P§5.2]`,
inverted, at zero new code.

**`hooks/stop.js`'s session-scoped pattern is a genuine reuse, not a
decoration.** `COBUILD §2.7` says `rest` ends a seam. `rest` is **per-session**,
and `stop.js` documents exactly the bug that ignoring this causes: a sentinel
read without its session stamp turns *"one `rest` into a permanent disarm of
every future session — silently, with `status` still promising a beat"*
`[C hooks/stop.js:93-100]`, fixed by reading the session that wrote it
`[C bin/handshake.js:1842]`. A seam is workspace-scoped and outlives a session,
so **"`rest` ends the seam" must mean *this session's* `rest`**, read through the
same stamped-session rule — or one session's rest silently kills the workspace's
seam for every session after it. Same for the `posting_stopped` latch, which is
*"THIS session's"* `[C hooks/stop.js:113-120]`.

**What this milestone deliberately does not do.** No contract text, no
materializer, no file write, no `adopt`. §2.3's closed list exists except items
2, 3 and 5. **It still ships a working product**: two people on two accounts open,
inspect, accept and kill a bounded agreement, and each side's block will say a
seam exists once S3 lands.

**Tests — `test/seam-cobuild.test.js`.** The open → accept → end state machine on
both transports. The Jaccard admission refusal, with a pair that scores 50 and a
pair that scores 49. An `accept` whose echo differs from the proposer's ledger
row is **discarded** (otherwise an accept silently widens what the proposer's
human consented to). `--yes` refused on `accept`, the way `join` refuses it.
`refuseIfChild` on all four verbs. Ledger cap 8, ended-oldest dropped,
`dropped_total` surfaced. **`end` flips local state before the post**, proven by
running it against the discard port so the network call cannot succeed. A `rest`
stamped by another session does not end this session's seam.
`test/command-doc-verbs.test.js` gains the four rows.
`test/no-direct-send.test.js` still green.

**Tier: Opus high.** A consent boundary and a state machine over existing
primitives. Not a freeze; not the security-critical write path.

---

### S2 — The exchange: contract, materializer, both tier arms

**Scope.** `COBUILD §10` items 7 and 8. This is the milestone that creates the
one genuinely new capability the design charges for `[COBUILD §12]`, and it is
sequenced alone for that reason.

- **`handshake seam contract <id> --contract-file <path>`** — the text comes
  from a **file, never argv**: it is up to 1200 characters and argv is the wrong
  channel. Through `buildEnvelope` / `send`, therefore through `sendGate`. Rev
  cap 8. **A byte-cap check with an explicit refusal**, because a 1200-character
  cap is *not* automatically inside a 2048-byte body for multi-byte text
  `[P§2.5]` `[COBUILD §4.2]` — refuse, never silently trim.
- **The materializer**: verify → escape → hash-check → write
  `.handshake/seam/<seam_id>.md` at a **client-computed** path → post
  `adopt{seam_id, rev, hash}`. The path is derived from the ledger's `seam_id`,
  so **a peer can never name a write path**, which closes traversal by
  construction. That is the posture the tree already takes: `shardFileName`
  derives a filename from a member id rather than accepting one
  `[C lib/workspace-files.js:267]`.
- **Both tier arms, on day one.** Automatic where
  `capabilities().authenticated_from` is `true` `[C lib/transport-relay.js:99-102]`;
  behind **`handshake seam pull <id>`** and a typed confirmation where it is
  `false` `[C lib/transport-ntfy.js:70-73]`, printing the sender *as claimed* in
  the wording the CLI already uses for that transport, plus `ADVISORY_LINE`
  `[C lib/transport-ntfy.js:39]`. And both arms on `repoRoot()` being null
  `[C bin/handshake.js:221]` — **write the file anyway**, because its first
  reader is this side's own model, and **never call it durable** when it is not.
  `COBUILD §10` is right that this is two branches, not a second slice: shipping
  relay-only would not be a smaller build, it would be a different one whose
  advertised refusal a later slice has to walk back.
- **Receiver-side authorization** `[COBUILD §7.2]`, all discard-and-count:
  unknown `seam_id` except `propose`; `from.member` ≠ the recorded counterparty;
  `accept` from anyone but the addressee or with a mismatched echo; `contract` /
  `adopt` on a seam not live here or past TTL; `hash` ≠ SHA-256 of the escaped
  text; `rev` ≤ the highest materialized, unless it is a concurrent rev-N.
- **Refuses to overwrite a hand-edited file** `[COBUILD §8.4]`, raising a notice
  and offering `pull` or `end`. No silent destruction, no silent divergence.

**Files.** `bin/handshake.js` (two verbs) · `lib/state.js` (the ledger's rev
bookkeeping) · a new `lib/seam.js` for the materializer · `lib/escape.js` ·
`hooks/sync.js` and `hooks/common.js` (the receive path).

**Reuses.** `sendGate` `[C lib/outbound.js:23]` before the write *and* before the
send. The escape pipeline, applied by field name `[C lib/escape.js:152]`. The
three existing dedupe layers — `(from.member, sender_seq)` at the envelope
`[P§2.6]`, idempotent relay replay, and `(seam_id, rev, hash)` at the ledger.
`checkShardAuthors` `[C lib/workspace-files.js:412]`, inherited free over the
seam directory, so a contract file last touched by a non-member commit is
flagged and never treated as current. **`SHARD_KINDS` is not extended**
`[C lib/workspace-files.js:261]` and `ShardOwnerError`
`[C lib/workspace-files.js:54]` is untouched: the durable layer is write-only on
every automatic path, its sole reader being `[C bin/handshake.js:1081]`, so shard
records would be bookkeeping rather than a feature `[COBUILD §6.3]`.

**Tests.** Hash mismatch → discarded and counted (this catches an *escaping
divergence between two clients*, which is the realistic bug, not an attacker).
`rev` ≤ materialized → discarded. Concurrent rev-N resolved **identically on two
simulated clients** by the borrowed comparator, with no message exchanged. A
peer-supplied path in any field never reaches the writer. The
`authenticated_from` branch: relay materializes automatically, ntfy does not and
raises the notice instead. The `repoRoot() === null` branch writes the file and
`status` reports `durable layer: none`. A `sendGate` refusal leaves **nothing
written, nothing posted, rev not advanced**, author told once `[COBUILD §8.3]`.
Multi-byte text at 1200 chars over 2048 bytes → refused with a clear line, not
trimmed. Hand-edited file → refused, notice raised. A v1.0 peer returns
`unknown_type` / `ignore` and **the proposal expires without an accept** — the
CLI must say "an older peer client is one honest reading", never "they declined"
`[COBUILD §8.5]`.

**Tier: Opus xhigh.** This is the code that lets a peer cause a file to appear in
another person's working tree. It gets the security tier for the same reason M2
did.

---

### S3a — Rendering: 7 untrimmable chars, 16 trimmable, four notices

**Scope.** `COBUILD §10` items 9 and 10. Gated on S0's re-measurement.

- **`COND.seam`** — 7 chars, untrimmable, appended to the claims line, a new
  literal in the frozen `COND` family `[C hooks/render.js:66-71]`. Untrimmable
  like `· sync pending`, because without it the model does not know to look in
  `.handshake/seam/` at all.
- **The rev detail** — 16 chars (`seam r6 (bob r5)`), riding the claim's existing
  `details[]` array, the same array that already carries `advisory` and
  `1h left`. This costs nothing structurally: `details[]` is **already** dropped
  at ladder step 3 `[C hooks/render.js:253]`, so the detail degrades gracefully
  **without adding a rung and without touching the frozen truncation order**.
  The per-detail cap is 20 `[C hooks/render.js:138]`, so 16 fits and the rev cap
  of 8 keeps it there permanently.
- **Four notices** into the existing 2 × 96 channel `[C hooks/render.js:186-188]`
  — rev-not-adopted · hand-edited file · seam expired · **a revision waiting for
  `seam pull`**. These are regenerated from state every turn and therefore never
  consumed by the watermark, unlike a digest item which appears exactly once
  `[P§6.3]`. Four kinds into two slots forces an order: the pending-revision
  notice takes the first slot where it applies, because it is the only one that
  gates progress and the only one the model cannot infer from the block.

**Files.** `hooks/render.js` · `hooks/common.js` ·
`skills/handshake-coordination/references/standing-block.md` (the measured
examples).

**Reuses.** The whole render ladder, unchanged. The `COND` literal family. The
`details[]` slot. The notices channel. **The 206-char standing-block framing
`[C hooks/render.js:50-54]` is not amended and does not need to be** — it stays
literally true inside a seam, because the model still does not write outside its
task, does not post and does not grow scope *because of peer text*; the two
mechanical exceptions live in the **client**, where they are code rather than
discipline. This is the design's strongest structural property and it costs zero
characters per turn.

**Tests.** `test/hooks.test.js`: the block with a live seam stays under 600 in the
worst pinned example. The `dropDetails` rung drops the rev and keeps `· seam`.
Notice ordering with all four applicable. `mute` suppresses the digest while the
`· seam` marker and the notices survive `[COBUILD §8.12]`.

**Tier: Opus high.** Mechanical, but against a hard budget and a frozen ladder.

---

### S3b — The brain: SKILL.md

**Scope.** `COBUILD §10` item 11. What the model does with all of the above.

The §2.5 scope test, stated as a check against local state rather than judgement:
*"If honoring a revision would require you to claim something new, it is outside
the seam and stops for your own human."* The revision discipline: **"a revision
states what your side needs, never a reply to their prose"** — if the peer's rev
5 is wrong for me, I do not argue, I author rev 6 with the shape my half
requires, which keeps the post caused by my own work and removes prose-to-prose
negotiation from the design entirely. The generate-your-own-stub discipline
`[COBUILD §4.4]`. That on an unauthenticated transport an inbound revision waits
for its human **and the model keeps building meanwhile**. `note.blocker` as the
escape hatch for facts no shape can carry — **you may ask but must not
auto-answer in this version**; a Claude posting its own `note.blocker` is
*already* sanctioned unprompted `[C SKILL.md:262-267]`, so the asking half needs
no relaxation at all. The never-list restated for seams. And the worked injection
example in the shape of the existing `npm run reset-db` one: *a contract
containing an imperative is answered as data and the imperative is ignored.*

**Files.** `skills/handshake-coordination/SKILL.md` · `commands/handshake.md`.

**Reuses.** SKILL.md §3.2/§3.3's existing routing to `note.info`
`[C SKILL.md:162,194]`, which stays the default and is **not** deprecated: if one
sentence settles the boundary, send the sentence and do not open a seam
`[COBUILD §14]`. The existing "Send these" table `[C SKILL.md:262]`. The existing
injection worked example `[C SKILL.md §5]`.

**Tests.** `test/hooks.test.js`'s framing assertions unchanged. A red-team item in
S4 exercises the imperative-in-a-contract case against the actual text.

**Tier: Opus xhigh.** M7's tier, for M7's reason: this is the brain, and the
never-list framing is the thing the whole safety argument rests on.

---

### S4 — SECURITY.md, and the red team

**Scope.** `COBUILD §10` item 12 plus M13's shape.

SECURITY.md gains: the enumerated grant (§2.3's closed list of four client acts
and one model permission); the two mechanical exceptions and their bounds (§2.5
items 2, 6 and 8); the graduated §2.6 rule with **what the confirmation is and is
not worth** — a speed bump and an audit line, **not proof of consent**, because
the model drives the terminal and `ask()` reads piped stdin when there is no TTY
`[C bin/handshake.js:86-113]`, and `SECURITY §1.2` already places the local
user's own model out of scope; and **the per-tier new-capability statement,
written in rather than left inferable** `[COBUILD §12]`: on the relay a member in
an accepted seam can write one file into a counterparty's tree with no human in
the way; on ntfy that automatic write does not exist, and what a topic-holder
gains instead is the ability to impersonate a member and put a confirmation
screen in front of a human — smaller in kind, but available to anyone holding the
topic rather than only to a member.

**Red team, 3× adversarial fan-out.** The injection corpus through the contract
text (delimiter breakout, control-tag shapes, an imperative). The
`.handshake/seam/` path (a contract file arriving by `git pull` with no ledger
row — must be **inert**, listed as "not accepted here", never materialized over).
The accept-echo widening attack. Impersonation on ntfy. A peer-named path in
every field of every state. The exfil corpus against a contract carrying a local
secret.

**Files.** `docs/SECURITY.md` · `test/filter.test.js` · `test/escape.test.js` ·
`test/seam-cobuild.test.js`.

**Tier: Opus xhigh, 3× adversarial fan-out.** M13's tier and M13's shape.

---

### S5 — E2E, both legs

**Scope.** M12's shape, over the §9 scenario.

**(a) CI leg** — 2 × `claude -p` with separate `CLAUDE_CONFIG_DIR`, miniflare and
the mock ntfy the repo already carries `[C e2e/mock-ntfy.js]`; the §9 script
driven end to end with the human confirmations scripted; a **scripted secret-scan
of the relay transcript** for the contract text, since the relay sees plaintext
bodies `[C lib/transport-relay.js:104]` while ntfy encrypts them
`[C lib/transport-ntfy.js:75]` — the ladder is not a straight line and the test
should say so. Extend `e2e/leg-relay.js` and `e2e/leg-ntfy.js`.

**(b) Manual leg** — the true two-account / two-machine run of §5's scenario
below, including the mid-build absence, with a checklist. This leg also
**measures the two unmeasured numbers that matter**: how many revisions a real
pair reaches (the rev cap of 8 and the cut rule in §6 both depend on it) and how
many transport operations a seam costs against the ~150/day/member ntfy budget
`[C lib/transport-ntfy.js:28]`.

**Tier: local, no model, to run; Opus high to write and read the legs; human +
Opus high for (b).**

---

### S6 — Docs and release

`COBUILD §10.1`: when v1.1a lands, the §1.1 capability matrix goes into
**README** beside the transport ladder and into **`docs/INSTALL.md`** beside the
git and relay steps, each layer stating the capability it adds rather than
implying the feature needs it. One source of truth, three renderings.

**Until it is built it is advertised nowhere** — not README, not INSTALL, not the
skill, not release notes, not a "coming soon" line. PROTOCOL is explicit that
nothing aspirational reaches the shipped docs: *"features that do not exist in v1
appear only in Deferred beyond v1"* `[C docs/PROTOCOL.md:7-8]`. A capability
matrix for an unbuilt feature is the most expensive kind of copy to retract.

**Tier: Sonnet medium draft; Opus high polish.** M14's tier.

---

### 3.7 The task table

| # | Task | Model / effort |
|---|------|----------------|
| **S0** | Ratify E1–E3 into PROTOCOL.md §3 / §3.1 / §3.2 / §11 / Appendix A; fix the `CAPS.text` widening, the `CAPS.name` narrowing and the `test/seams.test.js` collision; **re-measure the standing block (gate)** | Opus **xhigh** |
| **S1** | The consent object: `TYPES` + body validator, `seams.json` ledger, `open` / `accept` / `seam` / `end`, inverted Jaccard admission, session-scoped `rest` | Opus high |
| **S2** | The exchange: `contract --contract-file`, `pull`, the materializer, both `authenticated_from` arms, both `repoRoot()` arms, §7.2 receiver authorization | Opus **xhigh** |
| **S3a** | Rendering: `COND.seam` (7, untrimmable) + `details[]` rev suffix (16, trimmable) + four notices in 2 × 96 | Opus high |
| **S3b** | SKILL.md: scope test, revision discipline, stub discipline, `note.blocker` ask-not-answer, never-list, worked injection example | Opus **xhigh** |
| **S4** | SECURITY.md (enumerated grant, two exceptions, §2.6's honest worth, per-tier new capability) + red team | Opus **xhigh**, 3× adversarial fan-out |
| **S5** | E2E: (a) CI leg, 2 × `claude -p` + miniflare + mock ntfy + transcript secret-scan; (b) manual two-account leg incl. absence, and the two measurements | local + Opus high (a); human + Opus high (b) |
| **S6** | The §1.1 matrix into README + INSTALL; release | Sonnet medium draft; Opus high polish |
| **S7** | **v1.1b, after ship**: `note.blocker` auto-answer relaxation (the first outbound post caused by peer data — its own review); rev-to-rev diff in the read view; the SessionStart shard scan, **built once and shared with delegation** | Opus xhigh (relaxation); Opus high (rest) |

Order: **S0 → S1 → S2 → {S3a, S3b} → S4 gate → S5 gate → S6**. Then delegation
(§4), then S7. Tests, builds and E2E runs are local, no model `[PLAN§5]`.

S3a and S3b are the only pair that may run in parallel, and only because S3a is
render code against a measured budget while S3b is text. S2 must not start before
S1's ledger exists, because the materializer's path derives from it.

---

## 4. Delegation's place: after, and separately ratified

**Verdict: co-build ships first; delegation ships after it, as its own
ratification; and the SessionStart shard scan is built once, in delegation's
slice, and shared back.** Not before, and explicitly not *inside*.

`COBUILD §14` states the tension and does not resolve it: *"they are independent
and neither requires the other, but two new types in one v1.1 is a larger
widening of a frozen `[F]` line than either argues for alone, and someone should
decide whether both are wanted before either is ratified."* This plan decides.

**Why after, in five arguments:**

1. **The freeze argument cuts one way only.** Both designs amend the same `[F]`
   line — `COBUILD §11 E1` and `DELEGATION Appendix C C1` are the same edit to
   `[C docs/PROTOCOL.md:228-229]`. Ratifying two catalog rows at once doubles
   what a v1.0 peer must degrade past and doubles what a reviewer must hold in
   their head for one ratification. Ratify one, ship it, read the manual E2E
   leg, then ratify the second.
2. **The consent argument is settled in the right order.** `COBUILD §2.1` states
   the criterion — *"consent-once is sound exactly when the grant is finite and
   displayable at grant time"* — and names it as *"the test any future feature
   should have to pass before asking for the same treatment."* An offer **fails
   that test**, because *"what an offer will turn out to be is not displayable
   at grant time"*, which is why `DELEGATION.md:22-28` demands a human every
   time. Shipping the seam first means that criterion exists as ratified text
   before the offer is designed against it, rather than being argued during the
   offer's review.
3. **The shared surface points this way.** Everything the two share, co-build
   **adopts from** delegation's draft and implements first: the `to`
   addressing-only MUST-NOT list, taken *verbatim* so there is one definition
   and not two `[COBUILD §7.1]`; the `join`-shaped consent gate; `ttl` rather
   than `expires_at`, which both pick because `queueExpiryAt` already gives a
   `task.*` envelope `base + body.ttl × 1000` `[C lib/state.js:156-159]` and so
   §10.3 needs no amendment either way; `refuseIfChild`; the sendGate
   chokepoint; the "peer prose reaches a model only in a read-only view a human
   ran" rule. Building the seam first means the offer inherits **working code**
   for all six rather than a second draft of the same paragraphs.
4. **It is what was asked for.** *"Two Claudes genuinely building one thing
   together"* is the seam. *"Delegating work to whichever Claude already has the
   context"* is the offer, and it is the second sentence.
5. **The one argument the other way is an argument about the scan, not the
   order.** `DELEGATION`'s smallest version calls the SessionStart shard scan
   *"the single highest-value item"* and notes it closes a gap that already
   exists — the durable layer is written by five paths and read automatically by
   none, so today's mandated parting note `[P§3.2]` is never read either.
   `COBUILD §6.3` deliberately needs **none** of it and says so, listing it as
   out of scope *"rather than smuggled in"*, and `§6.4` says it *"should be
   built once"*. So: it is orthogonal to both, delegation is the design that
   needs it, and building it in delegation's slice is how it gets built once
   instead of twice.

**Why not inside.** `COBUILD §14` is right that the three routes — `note.info`,
the seam, the offer — *"are not variants of each other and they should never be
presented as a ladder to climb."* A seam moves **shape** between two people who
are both already working on claims they both already hold; an offer moves
**work** and creates an obligation on someone who is not. *"If you find yourself
wanting a seam to hand someone a task, you want an offer; if you find yourself
wanting an offer to keep an interface in sync, you want a seam."* Folding either
into the other produces a thing that does both badly and dissolves the consent
argument that earns the seam its consent-once.

**The budget is not what forces this.** 562 + 7 + 20 = 589 under the hard 600
`[C hooks/render.js:31]`, and the seam's floor was deliberately put in
`details[]` rather than `COND` so it **co-exists with the offers suffix without
arbitration** `[COBUILD §7.3]`. The freeze forces it, not the characters.

---

## 5. Acceptance criteria

`[PLAN§6]` style. Two humans, two accounts, two machines, one repo. Run the relay
leg, then the ntfy leg. **No command is typed to *cause* coordination**; read-only
views and the two consent commands are the only typing.

**The scenario.** A takes the frontend, B the backend.

1. A: *"build the login form; it needs a session endpoint."* A's Claude claims
   `login form` and the block shows bob live. At a natural boundary A's Claude
   proposes the seam in **one line** — the register of the tiebreak-loss line,
   *"the one moment surfacing to the human is correct"* `[P§5.4]`. A types
   `handshake seam open "auth session" --with bob --mine "login form" --theirs "session endpoint"`.
   Admission: the two subjects share no token, Jaccard 0 → admissible.
   Confirmation printed and typed.
2. B's block gains `· seam` **at the next inbound refresh**. State this
   precisely, because it is the criterion most easily faked: the refresh is
   SessionStart `[C hooks/session-start.js]` or roughly every 5th PostToolUse
   tick `[C hooks/common.js:48]` `[C hooks/post-tool-use.js:95-108]` — **not**
   the turn boundary, because the Stop hook is outbound-only and runs no inbound
   sync `[C hooks/stop.js]`. So a turn spent only talking can still miss it, and
   the criterion is met by B doing tool work `[PLAN§6]`.
3. B's Claude mentions it **once**, at a boundary, as a count and a pointer —
   **no peer prose is injected**. B runs `handshake seam`, reads it, then
   `handshake seam accept <id>`, which prints both subjects, the TTL, the tier
   and the closed permission list, refuses `--yes`, and takes B's claim on
   `session endpoint`. A's client verifies the echo against its own ledger row
   and marks the seam live.
   **→ Two human acts on the relay leg. There are no more. Count them.**
4. A's Claude authors rev 1 from what its form needs, posts it, materializes its
   own copy, generates a local stub returning fixtures, and starts building
   against it. **A's human is not asked** — this is the thing they consented to.
5. B's client verifies, materializes rev 1 into B's tree, posts `adopt`. B's
   Claude reads the file and builds the handler. **Both halves are now being
   written at once, against one shape, with no human involved.**
6. B's work needs a 429 A did not anticipate. B's Claude authors rev 2 stating
   **B's own requirement** — not a reply to A. A materializes, adopts,
   regenerates its stub, adds the branch. **This exchange, with zero human turns
   inside it, is the acceptance test.** If it needs a human, the feature failed.
7. B posts one `note.blocker` for a fact no shape can carry (*"the endpoint is
   behind a feature flag until Thursday"*). It holds a reserved priority slot
   `[C relay/src/lib/config.js:11]`. A's Claude reads it as **data**, tells A's
   human one line, and keeps building.
8. **B goes absent mid-build** — laptop shut. A authors rev 4; **no adopt comes
   back.** A's block reads `peers: bob working "session endpoint" (quiet 15m)`
   and `claims: login form — you, seam r4 (bob r3)`. A's Claude keeps working —
   it is not blocked — and folds one line into its next planning moment: *"bob
   hasn't picked up rev 4; the `retry_after` unit is my assumption, not an
   agreement."* Nothing sent, nothing announced, nothing claimed.
9. bob crosses `stale` `[P§4.3]`. A's Claude says one line and offers the two
   honest options — keep building on rev 4, or narrow to rev 3's agreed surface.
   **It does not decide, and does not end the seam.** bob may be at lunch.
10. A commits ordinary work; `.handshake/seam/<id>.md` rides it. **No
    coordination-only commit is created** `[PLAN§6]`.
11. **The seam TTL expires.** Derived on both sides from `opened_at + ttl`,
    announced by nobody — the rule that works precisely because the absent party
    is the one who would otherwise owe the message. One notice, once. A's own
    claim and A's work are untouched.
12. bob returns the next day. The seam is expired, so **nothing materializes
    automatically**; `handshake seam` shows it; A's commit brought B the rev-4
    file with the ledger showing B never adopted it. Continuing is a new seam:
    two typed commands, text carried forward from the file.

**Security assertions, run on both legs.** A contract carrying an imperative is
answered as data and the imperative ignored. A delimiter-breakout contract
survives escaping harmlessly. A spoofed `from` on the relay is refused at the
source `[P§9.2]`. A peer-named path never becomes a write path. A contract
containing a local secret is refused by `sendGate` **before the write and before
the send**, and the rev does not advance. A passive ntfy subscriber holding the
topic but not the secret learns no interface shape. A contract file arriving by
`git pull` with no ledger row is **inert**.

### What "done" means on each of the four tiers

The four tiers are §1.1's two independent axes. **All four are in the first
version; the split is not available** `[COBUILD §10]`.

| Tier | Done means |
|---|---|
| **relay + git** | The scenario above, unmodified, with **exactly two human acts**. Inbound revisions materialize and adopt with nobody asked. The contract rides ordinary commits. A peer absent past retention still gets the revision by pulling — two independent paths to the same rev. |
| **relay, no git** | The same scenario minus steps 10 and 12's pull path. `status` reports `durable layer: none` and `handshake seam` says the contract is local-only. **Nothing in the exchange changes** — the file is still written, both sides still converge, every live signal still fires. |
| **ntfy + git** | The same scenario with **one typed `seam pull` per inbound revision**, the accept printing `ntfy · self-declared identity` plus `ADVISORY_LINE` `[C lib/transport-ntfy.js:39]`, and B's claim marked `unauthenticated-advisory` `[P§5.5]`. Both models keep working between a revision's arrival and its pull — the gate delays a materialization, it never blocks either side's own half. Step 12's recovery comes from the **committed file**, because bob is far past the ~12 h cache and the cursor ladder reports a truncated read rather than silence `[C lib/transport-ntfy.js:160-163]`. |
| **ntfy, no git** | The same scenario **including the honest loss**: bob, absent past ~12 h, learns nothing about rev 4 at all; `status` says so rather than papering over it; recovery is a new seam carrying the surviving side's file text forward as rev 1. **A build that hides this is not done.** This is the only point where a tier genuinely cannot do the thing, and it takes *both* layers missing — which is the honest reason to run either one. |

---

## 6. Risks

### 6.1 Complexity — the one the owner keeps flagging

**The design's own count is two** `[COBUILD §3]`: the **seam** (the bounded,
twice-consented collaboration — simultaneously the consent boundary, the scope
container and the thing that expires) and the **contract revision**
`{rev, hash, contract}`. Carried by one wire type with five states, one local
file, one generated artifact, and **zero** new `SHARD_KINDS`. Everything else the
two agents need is carried by primitives that already work: ownership is two
ordinary claims, the file boundary is the existing PreToolUse gate
`[C hooks/pre-tool-use.js:51-63]`, readiness is `task.done`, abandonment is the
existing presence derivation, and the questions a contract cannot express ride
`note.blocker`.

**The count a user actually meets is six, and that is the number to defend
against.** The seam · the revision · `seam pull` on an unauthenticated transport ·
the rev cap · the TTL · the admission rule. **Four of those six are only ever met
at a refusal** — `pull`, the cap, the TTL and the admission rule each appear as a
one-line explanation at the moment they bite. That is the cheapest possible place
to meet a concept, and it is why the design survives its own count.

**The count that leaks is the verb count: six.** `open`, `accept`, `pull`,
`contract`, `end`, and bare `seam`, against the eleven verbs the CLI has today.
A ~50% growth of the command surface for one feature is the strongest single
argument for cutting, and it should be stated to the owner in those terms rather
than as "two concepts".

**What would make me cut a milestone** — written in advance so it is a rule and
not a mood:

- **Cut S3a's rev detail, keep `· seam`** — if S0's re-measurement puts the
  untrimmable floor over 600, or over 580 with delegation's suffix still wanted.
  The floor is 7 chars and the detail is 16; the detail is the cuttable half **by
  construction**, since it already sits on the `dropDetails` rung
  `[C hooks/render.js:253]`. Losing it costs the model the rev number, not the
  fact that a seam exists.
- **Cut the ntfy `pull` arm and ship relay-only — refused, once, here.** It looks
  like the cheapest cut and is not: `pull` is a verb S2 needs anyway for the
  hand-edited-file case `[COBUILD §8.4]`, the tier handling is one branch on
  `capabilities().authenticated_from`, and the refusal a relay-only build
  advertises is exactly what a later slice has to walk back. It also breaks the
  zero-setup rung, which exists so a team can try the product in one paste
  `[P§9.3]`. Same answer, same reasoning, for the `repoRoot() === null` arm.
- **Cut the whole feature back to `note.info`** — if S5(b)'s measurement shows
  real pairs reaching **rev 2 or fewer**. The seam's distinguishing test is not
  importance, it is **iteration** `[COBUILD §14]`: a boundary stated once and
  holding is a note, and a note ships today at zero new surface
  `[C SKILL.md:162,194]`. If the measurement says one sentence settles it, the
  feature has no customer and the honest move is to delete it rather than
  advertise it.
- **Never cut the consent object.** `COBUILD §10`'s one non-negotiable: the
  join-shaped accept, the closed permission list, the local-only consent record,
  the instant kill and the TTL ship with the first slice. A version that lands
  before its boundary is the wrong feature.

### 6.2 The rest

- **The budget is a real gate, not a note.** 562 measured
  `[C skills/handshake-coordination/references/standing-block.md:121]` against a
  hard 600 `[C hooks/render.js:31]`, charged to **every turn of every session**.
  562 is the worst *pinned* example, which is a measurement, not a bound.
  Mitigation: re-measure at S0 before a literal is written; the detail already
  sits on a trimmable rung.
- **Three unmeasured numbers.** Rev cap 8, contract cap 1200, seams cap 8 are
  reasoned, not measured `[COBUILD §12]`. Only the TTL bounds are borrowed from
  something real — 7200 and 86400 are `CLAIM_TTL_DEFAULT_SECONDS` and
  `CLAIM_TTL_MAX_SECONDS` `[C relay/src/lib/config.js:6-7]`, so a seam and its
  two claims share one clock. Mitigation: S5(b) measures rev counts; every cap
  is a refusal with a clear line, never a silent trim.
- **The one genuinely new capability.** On the relay, a member in an accepted
  seam can write a file into a counterparty's tree at one client-computed path
  with no human in the way, and can influence what that Claude builds on its own
  half. `SECURITY §1.2` places a malicious current member out of scope and the
  human accepted this seam **with that member by name** — but "out of scope" is
  not a licence to widen what that adversary can do and say nothing. Mitigation:
  S4 writes both tier statements into SECURITY.md rather than leaving them
  inferable, and S2 takes the security tier. Bounds that hold regardless: one
  path, never source; no shell, install, commit or config; the TTL; either
  human's instant kill; escaped on write and on read.
- **The confirmation is worth what a typed confirmation is worth.** The model
  drives the terminal and `ask()` reads piped stdin with no TTY
  `[C bin/handshake.js:86-113]`. §2.6's gate is **not a security control**; what
  it mechanically removes is the *automatic* write, and the human supplies the
  one input no local check can — whether they were expecting a revision from bob
  at all. This wording must not be upgraded later.
- **A v1.0 peer.** Degrades to *"no feature"*, never to *"a standing permission
  with one side deaf"* `[COBUILD §8.5]` — the right failure shape for something
  that grants a standing permission. The residual risk is **wording**: an
  unanswered proposal may mean an older client, and printing "they declined"
  would be a lie. Pinned in S1's tests.
- **Two new types in one v1.1.** Mitigated by §4's decision: ratify and ship one.
- **Anthropic widens the artifact channel.** The likeliest first-party move
  (§1.3). `[PLAN§7]`'s mitigation stands — plugin-shaped, the brain survives a
  transport swap — with the architectural addition that the contract must keep
  travelling as text into two working trees, never as a hosted shared object.
- **The bridge market got crowded.** Five third parties pitched into #60082, and
  every one concedes the same limits: one shared PTY under one account, bearer
  tokens, no per-user identity. That is the differentiation and it is already
  built here — per-member sub-tokens minted at join, `from` refused-not-rewritten
  on the relay `[P§9.2]`, member removal on the recovery key. The risk is not
  being out-built; it is failing to *say* this, which is a README problem for S6.

---

## 7. Ideas worth stealing

Only entries that survived the §1.1 spot-check. Two of the four are recorded as
**convergent evidence** rather than borrowings, which is itself worth knowing.

1. **Enforce late, at a boundary the work must pass through.** MCP Agent Mail's
   pre-commit guard *"blocks commits conflicting with other agents' active
   exclusive file reservations"* [verified]. **Do not steal the mechanism** —
   claims are advisory leases, never locks `[P§5]`, and `COBUILD §5.1` is right
   that the seam adds no exclusion mechanism at all. Steal the **placement
   insight**: intercepting a commit is more robust than intercepting every write.
   This project already has that shape in the PreToolUse gate
   `[C hooks/pre-tool-use.js:51-63]`, which *warns* rather than blocks, and the
   lesson is to keep resisting the pressure to make it block.
   Source: `github.com/Dicklesworthstone/mcp_agent_mail` [verified].
2. **"An orchestrator without authority."** pas-de-deux: *"Shared state on disk
   that both sessions read and update, where time is given by expiries rather
   than by an arbiter"* [verified]. This is the sharpest sentence in the whole
   landscape and it states the seam's own posture better than COBUILD states it.
   **Steal it as wording** for SECURITY.md (S4) and SKILL.md (S3b): it names
   exactly why consent-once is safe here — two peers on two accounts have no
   natural arbiter, so an expiry-driven, authority-light model is the only one
   that fits the topology, and it degrades gracefully when a peer vanishes.
   Source: `github.com/chiccorich/pas-de-deux` [verified].
3. **TTL on every reservation so a vanished peer self-heals with no arbiter** —
   Agent Mail and pas-de-deux independently [verified]. Already the design:
   expiry is `opened_at + ttl`, computed on both sides, transmitted by nobody
   `[COBUILD §5.4]`, reusing the presence-staleness rule verbatim `[P§4.3]`.
   Recorded as **convergent evidence**: three projects reached the same answer
   for the same reason, which is the best available signal that it is right.
4. **"Messages are data, not instructions", carried inline with every peer
   message** — claude-together: *"Inbound messages are explicitly framed as
   untrusted when handed to Claude"*, and it says plainly that *"Prompt-injection
   risk is real"* [verified]. This project already does it and does it harder:
   the framing travels **in the hook output** at a fixed 206 chars
   `[C hooks/render.js:50-54]`, never assuming SKILL.md is loaded, and it is an
   **enumerated never-list** rather than a slogan `[C docs/SECURITY.md:261-270]`.
   Recorded as confirmation that the strongest entrant in the field reached the
   same design independently — and as the reason `COBUILD §2.5`'s conclusion
   (that the framing needs no amendment inside a seam) is the design's best
   property.
5. **Publish the limits in the same register as the features.** claude-together
   publishes that *"A room key is permanent and unrevocable"* and *"You cannot
   kick a member"* [verified]. Steal the **register**, which `COBUILD §12`
   already uses — and note the contrast S6's README should make: handshake **has**
   member removal, instant, on the recovery key, releasing that member's claims
   `[P§9.2]`, which is precisely the control the best cross-account transport in
   the field does not have.
6. **The invite code as a pairing secret, not a key** — claude-together's
   argon2id-stretched, single-use, 5-minute, 60-bit code, from which the real
   256-bit room key is handed over and the code retired [verified].
   **Not for the seam**, which runs inside a workspace whose enrollment already
   happened. But it is the honest answer to a gap this product actually has:
   a leaked ntfy topic requires a new topic and a full re-invite
   `[C docs/SECURITY.md:82-84]`, and the invite blob is a long-lived credential
   `[PLAN§3]`. A magic-wormhole-shaped enrollment would make the zero-setup
   rung's re-invite cheap. **Out of scope for v1.1a**; worth one line in
   PROTOCOL's Deferred list, not a milestone.
7. **The finding with nothing to steal, which is the finding.** No project
   opened in this pass combines a cross-account consent transport with a
   claiming layer. The best pipe declares itself out: *"Plain text only, 16 KB
   cap. No files, no commands, no code execution"* [verified]. The best claiming
   layer is one person's many agents behind a server that person hosts
   [verified]. The project that names the exact target has no network at all and
   has shipped neither reservations nor locks [verified]. **The
   contract-revision idea — a versioned interface text both trees converge on,
   authored by each side's own work rather than as a reply to the other's prose
   — has no precedent in anything I opened.** That is worth knowing before
   spending S0 through S6 on it, and it is the strongest reason to spend them.

---

## 8. Coverage

### 8.1 What this pass opened

Eleven load-bearing claims re-opened at source, eleven held (§1.1). Read in full:
the live cross-session-messaging doc, the artifacts doc, the agents comparison
page, the agent-teams doc, the feature-availability matrix. `gh issue view` on
#28300 and #60082 for state, `closedAt`, and the `authorAssociation` of every
comment. Full READMEs of `wybe-labs/claude-together`,
`Dicklesworthstone/mcp_agent_mail` and `chiccorich/pas-de-deux`. In the tree:
`PLAN.md`, `docs/COBUILD.md`, `docs/PROTOCOL.md` §3 and §11, `docs/DELEGATION.md`
§0, §12–13, Appendix C and Smallest-first-version, and every `[C]` marker this
document carries — `lib/envelope.js`, `lib/escape.js`, `lib/state.js`,
`lib/outbound.js`, `lib/filter.js`, `lib/workspace-files.js`,
`lib/transport-ntfy.js`, `lib/transport-relay.js`, `hooks/render.js`,
`hooks/pre-tool-use.js`, `hooks/post-tool-use.js`, `hooks/stop.js`,
`hooks/common.js`, `bin/handshake.js`, `relay/src/lib/config.js`,
`skills/handshake-coordination/SKILL.md` and its `standing-block.md`, and the
`test/` layout.

**Not opened by this pass**: the Anthropic changelog (so the v2.1.234-vs-v2.1.239
discrepancy is unresolved and nothing here rests on it); `anthropic.com/news` and
`/engineering`; Cowork, Desktop and Claude Tag docs; `claude.ai/admin-settings`;
the Chinese-language sources; the source code of any third-party project (all
capability claims are README-level, and none was installed or run). E2E and
relay code was listed but not read line by line.

### 8.2 Carried forward — Anthropic-native researcher

**Searched**: cross-session-messaging (complete, ~10k words); agent-teams; agents;
claude-code-on-the-web; channels; artifacts; feature-availability; remote-control
(grepped a persisted 58 KB fetch for account-scope language); claude.com/pricing;
anthropic.com/news index. The complete docs index (`llms.txt`, 355 lines) grepped
for collab/multiplayer/shared/team/remote/cross/peer/channel/session/agent/cowork/
guest/share — no page by any such name exists. The full `CHANGELOG.md` (6,174
lines) grepped for cross-account/multi-user/multiplayer/collaboration/guest/
shared-session/different-account/invite, and separately for SendMessage/
ListAgents/cross-session/peer/channel/Remote Control/agent team/teammate/account/
share/multi. The review window pinned to versions via npm registry release dates
(v2.1.233 on 2026-08-14 → v2.1.257 on 2026-09-01), with v2.1.239 read line by
line. Via `gh`: full body, all comments and every `authorAssociation` for #28300
and #60082; a repo-wide issue search (state=all) for cross-account/multi-user/
different-accounts/collaboration in titles, 30 results reviewed; full reads of
#66528 and #90188. A Chinese-language probe run twice with different phrasings.

**Not searched**: `anthropic.com/engineering`; Claude Code Desktop, Cowork and
Claude Tag docs — #60082 carries the `area:cowork` label, so **Cowork is the
single most likely place for an undocumented adjacent feature and is the first
gap to close**; the Team/Enterprise support articles (9266767, 9797531);
`claude.ai/admin-settings` (requires sign-in, so an admin-only toggle with no
public doc would not appear); the Chinese row rests on search-result synthesis
rather than pages opened directly; closed/merged PRs, Discord/Reddit, and any
feature-flag manifest, so an unreleased or flag-gated capability would not
surface; the doc-vs-changelog Windows version discrepancy.

### 8.3 Carried forward — third-party researcher

**Searched**: ~12 GitHub repo searches (claude-together; multiplayer claude code;
agent mail mcp; cross-account agent collaboration; agent file lock/claim/
reservation; agent handshake peer consent; `claude code collaboration
created:>2026-08-14`; agents build together one codebase; "two Claude" sessions;
plus two Chinese-language queries). GitHub API commit and release history since
2026-08-14 for `wybe-labs/claude-together`, `Dicklesworthstone/mcp_agent_mail`,
`a2aproject/A2A`, `modelcontextprotocol/modelcontextprotocol`. Repo metadata for
`pouriamrt/claude-mesh`, `SkuratovichA/claude-coop`, `hemangjoshi37a/AgentSync`,
`chadbyte/clay`, `motif-Labs/motif`, `wybe-labs/session-multiplayer`,
`Oryxa-Vault/oryxa`, `roypadina/claude-jam`, `chiccorich/pas-de-deux`,
`onecli/onecli`, `Dicklesworthstone/mcp_agent_mail_rust`. Full READMEs for
claude-together, pas-de-deux, clay, mcp_agent_mail (140 KB), motif, onecli. HN
Algolia `search_by_date` across five query sets. The a2a-protocol.org spec page.
One Chinese-language web search.

**Decay check carried forward**: the three baseline projects that mattered are
effectively dead — AgentSync last pushed 2026-06-13, `pouriamrt/claude-mesh`
2026-07-25, `SkuratovichA/claude-coop` 2026-07-12. **Standards carried forward**:
neither A2A nor MCP moved toward this; A2A had docs-only churn since 08-14 and
its spec has no concurrent-artifact, conflict or locking concept; MCP's activity
is docs, dependency bumps and working-group charters. Neither will hand us this
primitive soon.

**Not searched**: Product Hunt (a gap against that brief); awesome-claude-code
list repos not opened directly; the MCP roadmap blog post (URL 404'd), so MCP's
forward intent is **[unknown — needs verification]** beyond the commit log;
forklane.ai (SSL error, unreachable); Chinese developer platforms natively
(掘金, 少数派, V2EX, Zhihu, Bilibili) — the Chinese probe covered GitHub plus one
web search, so that coverage is a shallow probe, not exhaustive; Discord and
Slack communities; the npm registry; no candidate was installed or run, so every
capability claim is read from project documentation rather than observed
behaviour; no third-party source code was read, so shipped-vs-unshipped status
rests on each project's own roadmap statements. **Star counts are low on the
newest entrants** (claude-together 16★, pas-de-deux 0★), so this is an early,
fast-moving field: a two-week-old repo with no stars is easy to miss.
