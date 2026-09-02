# claude-handshake — v2 build plan: autonomous collaboration between two owned Claudes

**Status: BUILD PLAN. Nothing here is built. Nothing here is ratified.**
**Protocol version integer stays `1`. Every wire change below is a PROPOSED
Appendix B v1.1 delta awaiting Fenil's ratification; none is taken as given.**
**Date: 2026-09-02. Written against HEAD `b6b3dca`, tree clean.**

Markers follow the house convention: `[P§n]` = PROTOCOL.md section n,
`[SEC§n]` = SECURITY.md section n, `[PLAN§n]` = PLAN.md section n,
`[COBUILD §n]`, `[COBUILD-PLAN §n]`, `[DELEGATION §n]`, `[KNOWLEDGE §n]` for
those documents, `[C file:line]` = value as implemented and opened at `b6b3dca`
during this pass. Every `[C]` marker was read at its line this session. Choices
this plan had to make that the design discussion did not make are marked
**[proposed]** inline and collected in §14.

---

## 1. What this plan is

This is the plan for the stage after v1.1: **two independently owned Claude Code
instances, on two accounts and two machines, collaborating on one repository
without a human relaying anything between them after each human said yes once.**
It is not a design document — the design decisions were settled in the 2026-09-01
discussion and this plan's job is to turn them into a build order, a wire budget,
a set of acceptance scenarios and a risk list, in this project's register. It
**supersedes one control outright** (`DELEGATION`'s per-offer human gate, §13.4)
and **amends or re-aims four other written decisions, each named in §13**:
`[PLAN§6]`'s "no coordination-only commits" acceptance criterion (§13.1),
`[PLAN§5 M12(b)]`'s aim (§13.1), `[COBUILD-PLAN §2.1]`'s project order (§13.2),
and `[KNOWLEDGE §10.2]`'s conclusion about the absent peer (§13.5). It
strengthens one locked decision without changing it (`[PLAN Locked decisions 4]`,
repo = lasting truth, §13.1), and reuses `COBUILD`'s seam machinery unchanged for
the one place prose is load-bearing (§6). It re-opens exactly one closed COBUILD
decision, on the owner's instruction, and §6.5 says which and bounds it.

Nothing here is advertised anywhere until it is built — the rule
`PROTOCOL.md` states about itself and `[COBUILD-PLAN §3.S6]` restates:
*"features that do not exist in v1 appear only in Deferred beyond v1"*
`[C docs/PROTOCOL.md:7-8]`.

---

## 2. The counts and the cost, before the design

Stated first, in the format `[KNOWLEDGE §8]` uses, because the owner's recurring
pushback is complexity and the number should be argued down here rather than
discovered at the end of the build.

### 2.1 Concept count

**The design's own count is six.** This is the largest slice this project has
planned: `[KNOWLEDGE §8]`'s count was two and `[COBUILD §3]`'s was two.

1. **The state branch** — a dedicated branch carrying the coordination layer,
   written by the tool, never merged into anything.
2. **The work branch** — one per claim, pushed freely as a live view of an
   unfinished half.
3. **The declared symbol** — a `file::Class.method` scope the model states on its
   own claim (§7).
4. **The stack** — building on top of a peer's live branch, with its two exits,
   rebase and sequence (§5.4).
5. **The contradiction round** — a bounded exchange over one contested symbol, in
   which reasons are prose and proposals are structured (§6).
6. **The capability grant** — the trusted-pair configuration, expressed as which
   structured event types may cause action (§9).

**The count a user actually meets is four:** the two branch names appearing in
`git branch -r` · the escalation line when the two Claudes cannot converge · the
capability screen, once, at configuration · a refusal when the commit secret scan
blocks a push. **Two of those four are met once or only at a refusal**, which is
the cheapest place to meet a concept `[COBUILD-PLAN §6.1]`. The branch names are
the exception and they are met constantly, which is why §12.1 treats
autonomous-push noise as the first risk rather than the last.

**Everything else is a primitive that already works** and is not re-implemented:
ownership is two ordinary claims `[COBUILD §5.1]`; the file-level gate is the
existing PreToolUse path check `[C hooks/pre-tool-use.js:51-67]`; readiness and
abandonment are `task.done` / `task.release` and the reader-derived staleness
rule `[P§4.3]`; the durable per-member append-only file is the existing shard
with its owner-only throw `[C lib/workspace-files.js:337-343]` and its
`sendGate`-before-write `[C lib/workspace-files.js:365]`; the ordering of a race
is the frozen tiebreak `[P§5.4]`; the once-per-session read path is the shard
scan that shipped at `b6b3dca` `[C lib/shard-scan.js:161,264]`.

### 2.2 Verb count

**The CLI has 26 verbs today** `[C bin/handshake.js:2504-2512]` — `init invite
join claim release done change post note warn presence learn sync cursor status
tasks guard rotate leave doctor mute unmute rest deploy-relay upgrade scrub`.

**This stage adds three:**

| Verb | What it is | Who runs it |
|---|---|---|
| `handshake pair` **[proposed name]** | the trusted-pair capability grant and its read-only view (§9); `join`-shaped, refuses `--yes` | **human only** |
| `handshake branches` **[proposed name]** | read-only view of the state branch and peers' work branches, plus the one-shot fetch (§4, §5) | model and human |
| `handshake contested` **[proposed name]** | read-only view of open contradiction rounds — reasons quoted and attributed, revisions listed (§6) | model and human |

26 → 29 is **+12%**. Against the model-facing subset SKILL.md tabulates — ten
action rows `[C skills/handshake-coordination/SKILL.md:388-399]` — only two of the
three are model-facing, so that subset grows 10 → 12.

**The honest total, if everything currently planned lands.** Co-build adds six
and its own plan calls that *"the strongest single argument for cutting"*
`[COBUILD-PLAN §6.1]`; the knowledge layer's `learned` read verb is still owed
`[KNOWLEDGE §9.1 K3]`; delegation adds its own. 26 + 6 + 1 + 3 = **36 before
delegation**. That number, not this stage's three, is the one to put in front of
the owner.

### 2.3 Wire count

**Zero new event types.** The catalog stays at fifteen
`[C lib/envelope.js:41-45]`, and §3's closed-catalog `[F]` sentence — *"a v1
client MUST NOT originate a type outside this table"*
`[C docs/PROTOCOL.md:228-229]` — is **not amended by this plan**. That is a
deliberate choice, not a coincidence: `[COBUILD §11 E1]` and
`[DELEGATION Appendix C C1]` both amend that line, each priced at Opus xhigh and
*"ratified here or not at all"*, and a third amendment in the same wave would
triple what one reviewer holds in their head. Decision 10 settles the
*preference* — *"prefer state fields over new types"* — but that this stage can
be built with **no** new type at all is this plan's own finding, so it is
**[proposed]** and collected in §14.

**Three PROPOSED OPTIONAL body fields on existing types**, each a v1.1 Appendix B
delta on `[P§3.2]` and none of them touching an `[F]`-marked row:

| # | Delta | Where | Status |
|---|---|---|---|
| **V-D1** | `presence.update.head` — ≤ 64 hex, the head commit of the `branch` the same body already carries `[C docs/PROTOCOL.md:295]` `[C lib/envelope.js:213]`. This is the whole of decision 4's *"structured branch-moved event on each peer push"*: the branch moved iff `head` changed. | `[P§3.2]` presence.update | **[proposed]** |
| **V-D2** | `task.claim.symbols` / `task.change.symbols` — ≤ 16 entries × ≤ 120 chars, `path::Symbol.member` form, model-declared, never parsed (§7). | `[P§3.2]` task.claim, task.change | **[proposed]** |
| **V-D3** | `task.seam.contested` (boolean, `propose`) and `task.seam.rationale` (≤ 280 chars, `contract`) — the contradiction protocol's two additions to COBUILD's own schema `[COBUILD §7.1]`, which is itself unratified. | `[COBUILD §11 E2]` | **[proposed]**, and dependent on E1–E3 being ratified first |

**Why a field is genuinely cheaper than a type here, verified rather than
asserted.** `validate()` checks envelope structure, sizes, signature inputs and
freshness and **enumerates no body field at all**
`[C lib/envelope.js:365-414]`; type membership is checked separately and an
unknown type is a discard-and-count `[C lib/envelope.js:430-433]`. So a v1.0 peer
receiving V-D1 or V-D2 **accepts the message, uses the fields it knows and
ignores the one it does not** — it keeps working with reduced information, where
a new type would give it nothing at all. And the new fields are filtered by
construction: `structuralFields` walks every string in every body to **depth 4,
with arrays capped at 64 entries** `[C lib/envelope.js:270,273]` — which covers
all three proposed fields, none of which is deeper than 2 or longer than 16
entries — and hands the result to `sendGate`
`[C lib/envelope.js:284-288]` `[C lib/outbound.js:23]`, so a field nobody
remembered to enumerate is still gated `[SEC§4]`.

**Not amended by this plan**, stated where a future reader will look: §2.1–2.4
envelope, canonical serialization, signing, ntfy encryption · §3 the closed
catalog `[F]` · §3.1 carriage · §4.2 the presence enum · §5.1 normalization ·
§5.2 the overlap floor · **§5.4 the tiebreak** — this plan's §5.1 re-states what
it is for and changes nothing, so `[C docs/PROTOCOL.md:1033]`'s MUST-NOT is not
engaged · §5.3 TTLs · §6.1–6.4 fetch, injection, watermark, cursors · §8 the hook
cadence contract · §9.2 relay endpoints and schema · §10.3 offline-queue expiry ·
`isPriorityType` on client and relay `[C lib/envelope.js:53-55]` ·
`RELAY_NON_CARRIED_TYPES` `[C lib/envelope.js:49-51]` · the 206-char standing
framing `[C hooks/render.js:38,50-54]`.

### 2.4 Token cost per new surface

In the register of `[KNOWLEDGE §7]`: **designed budgets with the arithmetic
shown, not measurements.** Nothing here is built, and §10's V3 and V5 carry a
re-measurement gate the way `[COBUILD-PLAN §3.S0]` does.

| Surface | Vehicle | Per-turn chars | ~Tokens | Frequency |
|---|---|---|---|---|
| declared symbols on a claim | a `details[]` entry | ≤ 22 (`, ` + ≤ 20), **trimmable** | ~6 | every turn a symbol-scoped claim renders |
| the stack marker | a second `details[]` entry | ≤ 22, **trimmable** | ~6 | only while stacked |
| push refused · rebase needed · round open · escalated | the existing notices channel, 2 × 96 | ≤ 2 × 98, dropped at the last rung | ~50 | only while the condition holds |
| new `COND` literals | — | **0** | **0** | — |
| coordination-outcome records (§8) | the existing once-per-session knowledge block | **0 new chars**; they compete for its existing entry slots inside `LEARNED_BUDGET = 2000` `[C hooks/render.js:304]` | 0 | once per session |
| `handshake branches` | on demand | its own output, ~600 | ~150 | only when the model runs it |
| `handshake contested` | on demand | ~400 | ~100 | only when the model runs it |
| `handshake pair` | on demand, human | ~800 | **0 model tokens** | once, at configuration |
| state-branch commit + push · work-branch commit + push · the commit secret scan · the CI skip | monitor and Stop-hook processes | **0** | **0** | ≤ 1/min |
| **Per turn, steady state** | — | **0 untrimmable chars** | **0** | — |

**Why the plumbing is zero and not "small".** The monitor *"writes NOTHING to
stdout"* because a monitor's stdout lines are delivered into the session as
notifications `[C monitors/heartbeat.js:15-17]`; the Stop hook writes nothing to
stdout because a JSON object there is read as a decision that can block the stop
`[C hooks/stop.js:32-35]`; and `[P§8]` freezes *"stdout: nothing except designed
injections"*. `hooks/user-prompt-submit.js` remains the only script in the plugin
that writes to stdout `[C hooks/user-prompt-submit.js:10]`. A git commit and a
push that happen inside those processes therefore cost the model nothing — they
cost wall time inside budgets §8 already freezes, which §12.5 prices separately.

#### The card arithmetic, against the hard 600

`BUDGET = 600` is hard and charged to every turn of every session
`[C hooks/render.js:31]`. The three pinned measured examples are **562** (full),
**427** (zero-setup, stale peer, sync pending) and **284** (solo / first run)
`[C skills/handshake-coordination/references/standing-block.md:121,136,149]`.

**This stage's untrimmable floor is 0 chars, and here is why that is a real claim
and not a dodge.**

- The symbol scope and the stack marker ride the claim's existing `details[]`
  array — the same array that already carries `advisory` and `1h left`. Each
  entry is capped at 20 characters by `escapeSlot(d, 20, 'name')`
  `[C hooks/render.js:138]`, so neither can overflow its slot however long the
  declared symbol is; and the whole array is dropped at ladder rung 3,
  `push({ dropDetails: true })` `[C hooks/render.js:253]`, **without adding a rung
  and without touching the frozen truncation order** — exactly the property
  `[COBUILD §7.3]` engineered for its rev detail.
- The four notices ride the existing 2 × 96 notices channel
  `[C hooks/render.js:186-188]`, regenerated from state every turn and therefore
  never consumed by the watermark, unlike a digest item which appears exactly once
  `[P§6.3]`; they are dropped at the very last rung
  `[C hooks/render.js:262]`. **Four kinds into two slots means an order is
  required**, stated here the way `[COBUILD §7.3]` states its own, and on the
  same criterion — first the one that gates progress and that the model cannot
  infer from the rest of the block: **(1) push refused** (the secret scan
  blocked a commit; nothing else in the block says the work is invisible and
  only a human can clear it) · **(2) escalated** (the system asking, §6.4, and
  the one notice addressed to the human rather than to the model) · **(3) rebase
  needed** (the model can act on it this turn) · **(4) round open** (recoverable
  in full from `handshake contested`, so it is the first to lose its slot).
  **[proposed]**
- **Zero new `COND` literals** `[C hooks/render.js:66-71]`, zero change to
  `BUDGET`, zero change to the 206-char framing `[C hooks/render.js:38,50-54]`.
  **[proposed]** — this is §14 item 18, reversible in one literal if V3's or
  V5's measurement says the model is failing to run the on-demand views.

**Why no untrimmable marker, argued against COBUILD's precedent rather than
around it.** `[COBUILD §7.3]` spends 7 untrimmable chars on `· seam` because
*"without it the model does not know to look in `.handshake/seam/` at all"*. That
argument does not transfer. A stack and a contested symbol are both attached to a
claim **the claims line already renders**, and the standing framing already ends
with *"Check claims before new work"* `[C hooks/render.js:53]`. Under trimming
the model loses the detail, never the fact that a peer holds overlapping work;
the recovery is `handshake branches` or `handshake contested`, both on demand. If
V3's or V5's measurement shows the model failing to run them, the fix is one
`COND` literal and §14 records the choice as reversible.

**Headroom, if every proposed v1.1 feature lands.** 562 worst pinned + 7
(`· seam`, `[COBUILD §7.3]`) + 20 (`COND.offers_in`, `[DELEGATION §13.1]`) + **0
(this stage)** = **589 of 600** `[COBUILD-PLAN §4]`. This stage does not move that
number. Slack: 11 chars.

**Worst case with the new details present, and why it is not a violation.** The
562 example carries two claims, one with a `, 1h left` detail. Give both claims a
symbol detail and a stack detail: 2 × 2 × 22 = **88** → 650, over budget. Now add
the notices, which the summary row above prices at ≤ 2 × 98 and which this
paragraph must not omit, because they are the largest of the new surfaces and the
**last** thing the ladder is willing to lose: two present takes the same example
to 562 + 88 + ~196 ≈ **846**. That render never ships. `renderWithPlan` walks the
ladder and returns the **first** plan whose render is ≤ 600
`[C hooks/render.js:276-281]`, and `plans()` puts digest items at rung 1, roster
entries at rung 2 and every detail at rung 3, then the five text caps, the peer's
quoted claim, the claims list and the priority floor, with
`push({ dropNotices: true })` as the **final** entry
`[C hooks/render.js:235-263]`. So the block that reaches the model has already
paid for the additions out of the first things the ladder is willing to lose, and
the floor — framing, tier, `+N more` — is untouched
`[C skills/handshake-coordination/references/standing-block.md:103-109]`. **What
the exact trimmed shape is depends on content, which is why V3 and V5 carry a
re-measurement gate rather than a note**, measured the way M7/M11 measured the
block `[PLAN§5]`.

**What that costs, stated rather than reported as zero.** The summary row's
*"0 untrimmable chars"* and the 589 headroom line are both true and both narrow:
they say this stage adds nothing the ladder cannot take back, **not** that the
additions are free. In the full case they are paid for out of rung 1 — one digest
item the model no longer sees (dropping one line from the 562 example costs ~62
chars net once `+3 more` becomes `+4 more`, which lands ~588 with the details
present and no notices). That is the real price in a busy workspace, and it is
exactly what V3's and V5's re-measurement gates are for: they measure how often
it bites, not whether the render fits.

---

## 3. The vision, and the principle that makes it safe

**The vision (decision 1).** Two Claudes, owned by two different people on two
different accounts and machines, collaborate **autonomously** on one repository
after their humans configure each other **once** and share the repo. A human
intervenes when they choose to, or when the system asks. The work is joint work —
two halves of one thing, built at the same time — not surface messaging about
work. The layer **learns**: durable, bounded, attributed, ranked records that
shape later sessions. And the exchange is **machine language, not prose** — code,
contracts, symbols, diffs, structured events — because a paragraph costs tokens
twice, once to write and once to read, and buys less than a field.

**The principle (decision 2), and it is the safety mechanism, not a style note:**

> **Facts may cause work. Prose may cause thinking. Only an adopted fact changes
> code.**

Autonomy through structure is safe; autonomy through conversation is not. A
structured fact is validated by plumbing before the model ever sees it — the
signature `[P§2.3]`, the envelope shape `[C lib/envelope.js:365-414]`, the
receiver-side authorization `[COBUILD §7.2]`, the closed enums — so it can cause
work without waking a model's judgement. Prose can be validated by nothing, so it
may only inform: the enumerated never-list `[SEC§5.2]` holds unchanged, and every
injection carries its framing `[SEC§5.1]` `[C hooks/render.js:50-54]`.

The corollary that governs §6: **a peer's sentence may change what my Claude
proposes; it may never change what my Claude builds.** Prose is load-bearing at
exactly one place in this design — a requirements contradiction — and nowhere
else.

---

## 4. The floor

### 4.1 Below and above, decided (decision 3)

| **Below the floor — the Claudes act, no human asked** | **Above the floor — human only, always** |
|---|---|
| Coordination state committed and pushed to a dedicated `handshake/state` branch: author = the member, committer = the tool; per-member append-only files; batched ≤ 1/min; deferred and retried while offline; **no remote ⇒ today's behaviour** (below) | Merging into any shared branch, or into `main` |
| Code commits and pushes on the Claude's **own** branches, `handshake/<member>/<subject>`, one per claim — **pushed freely, as a live view**: broken is allowed, leaked is not | Opening, updating or merging a pull request |
| Reading, fetching and building against a peer's work branch (§5.4) | Tags, releases, publishes |
| Opening, revising, adopting and ending a contradiction round within the granted capabilities (§6, §9) | Deploys of any kind |
| Recording durable learnings and coordination outcomes (§8) | Anything touching secrets: rotation, re-keying, credential files |
| | Destructive or irreversible operations: force-push, history rewrite, branch deletion, `scrub` |

**No remote ⇒ today's behaviour, which decision 3 states inside the state-branch
spec and which nothing below may quietly drop.** A working tree with no
configured git remote gets **no branch, no automated commit and no push
attempt**: the shard is written and rides the next user-requested commit exactly
as it does today `[C bin/handshake.js:893-896]`, and `status` says so rather than
reporting a deferred queue that will never drain — a deferred write that does not
say it was deferred is a lie `[P§10.2]`. The condition is already computed:
`detectRepo` returns `reason: 'no_remote'` when the tree has no remote at all
`[C lib/repo.js:131]` and names it in its own reason table
`[C lib/repo.js:40]`. This is the same arm the tree already takes elsewhere —
co-build's `repoRoot() === null` branch *"writes the file and `status` reports
`durable layer: none`"* `[COBUILD-PLAN §3.S2]` `[C bin/handshake.js:221]` — one
posture, not two.

The consequence the discussion drew, and it is the reason this rung comes first:
**the durable layer now runs at machine speed.** The absent-peer gap mostly
dissolves; the relay stops being asked to carry durability; and co-build's hardest
problem — how does the other side build against something that only exists on my
disk — dissolves too, because it can fetch the branch.

### 4.2 The four required guardrails

Each is a gate on the automatic path, not a note.

1. **A fail-closed secret scan on every automated commit.** This is the new
   guardrail decision 3 names, and it is the price of "push freely". Every
   automated commit, on either branch, is scanned before it is created, and a
   finding **refuses the commit** — nothing partial, nothing queued, one line to
   the author. It is fail-closed on its own failure, the posture
   `lib/filter.js` already takes: any internal error returns `ok:false`
   `[C lib/filter.js:269-271]` `[SEC§4]`.
   **The one implementation fact that decides the design of this scan, found by
   opening the file:** `filter.check()` refuses any input over `MAX_BYTES = 2048`
   with a `size-cap` finding `[C lib/filter.js:22,255]`. A whole diff handed to it
   would therefore be refused **every time**, which is fail-closed and useless. So
   the scan runs `check()` over **overlapping windows of each added hunk**
   **[proposed: 2,048-byte windows with a 256-byte overlap, so no credential is
   split across a boundary]**, plus the local-secret tripwire — values ≥ 8 chars
   harvested from local secret files, compared raw with a 12-char sliding window
   `[C lib/filter.js:23-24,226-249]` `[SEC§4]` — over the same windows. Honest
   scope, in `[SEC§4]`'s own register: **a seatbelt against an accidental commit
   plus a closed tripwire for known local secrets, not a control against a
   motivated adversary**, and §12.2 prices the false positives.
2. **The public-repo guard, unchanged and re-used.** The guard is fail closed
   already: only an affirmative `isPrivate: true` from an authenticated call
   permits committing the guarded part, and errors, timeouts, a missing `gh`, an
   unauthenticated call, unparseable output and a non-GitHub remote **all come out
   as public** `[C lib/repo.js:11-18,36-48]` `[SEC§6]`, re-checked on a 600 s TTL
   `[C lib/repo.js:25]`. **An automated push on a public verdict is refused for
   the guarded part exactly as an automated commit of secrets is**, and a
   visibility flip stays a loud-rejected condition that demands rotation
   `[SEC§6]` `[P§10.2]`. `doctor`'s two history checks —
   public-repo-with-tracked-token and token-in-history
   `[C lib/repo.js:278,302]` — become part of the V1 opt-in preflight rather than
   only a diagnostic.
3. **Opt-in by both humans, at configuration.** Neither branch is created,
   committed to, or pushed until the local human has typed a confirmation, and
   the peer's side is symmetric and independent: one human opting in grants the
   other nothing. The gate is `join`-shaped, which is this codebase's existing
   precedent for "a thing arrives from outside and a human must sanction it" — it
   prints the whole grant and refuses from a proven child `[DELEGATION §0 C-3]`
   `[C bin/handshake.js:387]`, and — because it is `join`-shaped and not
   `offer accept`-shaped — it **refuses `--yes` and requires a typed
   confirmation** `[C bin/handshake.js:627]` `[P§9.1]`. The two pins are
   deliberately different: `[DELEGATION §0 C-3]` requires `--yes` for
   `offer accept`, so it is cited here only for print-the-whole-grant and
   refuse-from-a-proven-child, and `join`'s own behaviour — *"--yes is not
   accepted for join; confirmation must be typed"* `[C bin/handshake.js:627]` —
   is what this gate copies. What that confirmation is honestly worth is
   stated in §12 and is **not** upgraded later: the model drives the terminal, so
   it is a speed bump and an audit line, not proof of consent `[SEC§1.2]`.
4. **CI skips `handshake/*` by default.** Today the workflow triggers on every
   push with no branch filter at all `[C .github/workflows/ci.yml:13-15]`, so a
   Claude pushing a live view every minute would start a full three-job matrix run
   every minute. The change is a `branches-ignore` on the `push` trigger
   **[proposed: `handshake/**`]**, with `pull_request` untouched, so the moment a
   human opens a PR from a work branch the full suite runs — which is the correct
   place for it, because a PR is above the floor. **This guardrail costs decision
   4 one of its three named stacking facts** — there is no branch CI verdict to
   read — and §5.4 says what replaces it and what that replacement does not buy;
   §12.5 prices the residual.

### 4.3 What the floor changes about the existing design

Three things, each of which contradicts something currently written down, stated
here rather than discovered during the build.

- **The relay's 7-day retention stops carrying durability.** `[P§9.2]`'s window —
  7 days and last 500 messages, whichever bites first — was load-bearing in
  `[COBUILD-PLAN §2.1]`'s rung-4 comparison and in `[KNOWLEDGE §10.2]`'s
  week-long absence case. With coordination state committed and pushed every
  minute, the durable answer to *"what did I miss"* is a `git fetch`, not a
  replay. **The relay becomes authenticated live presence only.** Its retention
  is now a convenience for the fast path, and nothing in the design may depend on
  it again.
- **The absent-peer case moves to the state branch.** `[DELEGATION §9]`'s
  hour-by-hour absent-peer timelines and `[KNOWLEDGE §10.2]`'s two paths were
  written against a live layer with a cache window and a durable layer that
  nobody wrote automatically. The second half of that is no longer true: the
  durable layer is now written on the machine's own clock and read by the
  SessionStart scan that shipped at `b6b3dca`
  `[C hooks/session-start.js:80]` `[C lib/shard-scan.js:264]`. §11.5 is the
  acceptance scenario for the new shape.
- **Co-build can build against a fetched branch, not only against a contract.**
  `[COBUILD §4.4]` tells each Claude to generate its **own local** stub from the
  materialized contract because *"A contract gives A the shape, not something to
  call"*, and names the residual risk as the two generated artifacts drifting.
  With the peer's work branch fetchable, the contract stays the **agreement** and
  the branch becomes the **implementation** — the stub is a fallback for the
  window before the peer has pushed anything, not the permanent state of affairs.
  `[COBUILD §4.4]`'s discipline is kept; its residual risk shrinks.

**The one as-built invariant this reverses, named plainly.** The tool today never
commits: *"the shard is written and rides the next USER-REQUESTED commit —
`handshake` never commits anything itself, because a coordination-only commit is
noise in someone else's history"* `[C bin/handshake.js:893-896]`, restated to the
user by `scrub` `[C bin/handshake.js:2402-2404]` and asserted as an acceptance
criterion in `[PLAN§6]`. **That invariant is now bounded rather than absolute:
the tool never commits to a branch a human works on, and commits freely to
branches it owns.** The `handshake/state` branch is proposed as an **orphan branch
carrying only `.handshake/`** **[proposed]**, precisely so that this reversal
cannot leak into anyone's code history: an orphan branch shares no commit with
`main`, never appears in a `git log` of the user's work, and is read without a
checkout via `git show handshake/state:.handshake/tasks/<member>.md`. On the
user's own branches `[PLAN§6]`'s "no coordination-only commits" stays literally
true.

---

## 5. The conflict model (decision 4)

### 5.1 What the tiebreak is for, and what prevents duplicate work

Two mechanisms, doing two different jobs, and conflating them is the error
decision 4 corrects:

- **The intent check before starting** is what prevents two people doing the same
  task. It is already built: subject normalization and the Jaccard ≥ 0.5 overlap
  floor `[C lib/subject.js:86,95]` `[P§5.2]`, surfaced through the standing block
  and the model's decision tree `[C skills/handshake-coordination/SKILL.md:130-240]`.
- **The tiebreak only orders a race, and the scope of "a race" is the whole
  point.** The comparator is earliest `acquired_at`, ties by lexicographically
  smallest member id `[P§5.4]` `[C lib/subject.js:102-107]`. It fires **only
  inside a collision** — *"when two members believe they hold the same
  `subject_key`"* `[C docs/PROTOCOL.md:506]` — and there it does decide who
  works on that subject: the loser MUST post `task.change(tiebreak_loss)`, then
  `task.release(tiebreak_loss)`, then **stop work on that subject** and tell its
  own human in one line `[P§5.4]` `[C lib/subject.js:109-112]`
  `[C skills/handshake-coordination/SKILL.md:145-152]`. **Outside a collision —
  cases (b) and (c) below, where the `subject_key`s differ — it is not engaged
  and decides nothing at all**, and that is the conflation decision 4 corrects:
  two different tasks are not a race, so nothing about them is settled by asking
  who claimed first. It is frozen, this plan does not amend it, and
  `[C docs/PROTOCOL.md:1033]`'s MUST-NOT is not engaged.

Three cases follow, and only the third is new machinery.

### 5.2 Case (a) — same task → co-build, split by agreement

Two Claudes want the same work. This is the seam: a bounded, twice-consented
agreement splitting one interface into two halves, with a contract text both
trees converge on `[COBUILD §1]` `[COBUILD-PLAN §3]`. Nothing in this plan changes
it. Note that the seam's admission rule already refuses the degenerate case — a
seam is refused when the two subjects are equal or overlap at Jaccard ≥ 50,
because *"this is not a seam, it is the same work, and §5.4 should settle it"*
`[COBUILD §4.7]`.

### 5.3 Case (b) — different tasks, same file, different symbols → coexist

Today this warns and should not. The PreToolUse gate is a **path** comparison: it
walks peers' cached claims, matches the write path against each claim's
progressive `files[]`, and warns `[C hooks/pre-tool-use.js:51-67]`. Two people
editing two different methods of one 800-line file therefore get a warning on
every write, which is the disadvantage decision 4 names — a warning that is right
about the file and wrong about the work trains the model to ignore warnings.

**The fix is scope, not silence.** With symbols declared on the claim (§7), the
gate has a second, narrower fact to render: the path still matches, and the
declared symbols do not. **The gate's verdict is unchanged** — it still warns,
never blocks by default — but the rendered line says which symbols the peer
claimed, so the model can coexist on a fact rather than on a hunch. Nothing about
`overlapGate`'s warn/block policy `[C hooks/pre-tool-use.js:70-72]` moves.

### 5.4 Case (c) — different tasks, same symbol → stack, or sequence

Two different tasks that genuinely need the same method. Nobody leaves, nobody
idles, no human is asked.

**Stack.** My Claude fetches the peer's work branch and builds **on top of it**.
The judgement is made from facts, never from **self-reported availability or
intent to yield** — which is the whole reason decision 9 rejects the
negotiation-on-self-reported-inputs shape:

| Fact | Where it comes from |
|---|---|
| the peer's branch exists and has moved | `presence.update.branch` `[C docs/PROTOCOL.md:295]` plus **V-D1**'s `head` — the branch moved iff `head` changed |
| commits are landing | successive `head` values on successive heartbeats, on the monitor's own clock, 60 s relay / 600 s ntfy `[P§8]` |
| the diff overlaps mine | computed locally against the fetched branch, never reported by the peer |
| a clean rebase dry-run | attempted locally against the fetched head, discarded on failure (§10.5, §12.3) |
| the peer's own view of scope | the declared `symbols` on their claim (**V-D2**) |

**The last row is the peer's own words and is bounded accordingly.** Declared
symbols are model-authored self-reports by construction (decision 6, §7.1: *the
model writes it*), so they may **narrow the rendered verdict** — the gate's line
says which method the peer thinks it is on — and they may **raise a candidate**
for case (c). They may never **decide** whether to stack: that decision is made
from the locally computed diff and the rebase dry-run, both of which the peer
cannot author. A peer that declares no symbols, or declares them wrongly, changes
what is rendered and changes nothing about what is built.

**Decision 4's named fact `branch CI passing` is not available in this
plan, and this is where that is said rather than left to be discovered.** §4.2
item 4 skips CI on `handshake/*` **[proposed: `branches-ignore: handshake/**`]**
precisely so a commit-per-minute live view does not start a three-job matrix run
every minute (§12.5), so there is no green tick on a work branch to read —
`handshake branches` labels every work branch `untested` for exactly this reason
(§12.5). **What replaces it: the clean rebase dry-run and successive `head`
values** **[proposed]**, which together answer the question CI was being asked —
*is this branch stable enough to build on* — without a remote job, and which are
the two rows above. What they do **not** answer is *does the peer's half pass its
own tests*; nothing in this stage answers that, and a Claude that stacks is
stacking on code that is explicitly allowed to be broken (§4.1). An **opt-in
lightweight per-branch job** — one runner, one OS, the unit suite only — is
recorded as **§14 item 23** rather than built here, because it re-opens the
CI-cost risk V2 has not yet measured.

If the fetched branch is stable and my diff rebases cleanly, my Claude rebases and
keeps going. **The rebase is a local operation on my own branch**; it is below the
floor because it rewrites only history I own and have not asked anyone to merge.

**Sequence.** If the peer's branch is too unstable to build on — the honest
signal being a rebase that does not apply cleanly, or a `head` that has moved
more than **[proposed: 3]** times since my last successful rebase — my Claude
**does other work** and resumes automatically on the existing `task.release` or
`task.done` event `[C lib/envelope.js:41-45]`. This is decision 9's kept idea,
dependency-as-events, and it needs **no new type at all**: both events exist and
both are already rendered `[P§3]`.

**But "resume when this arrives" is new local behaviour, introduced here, and no
existing rule has its shape.** It is worth saying plainly because the nearest
neighbour looks like a precedent and is not: `[P§5.4]`'s tiebreak loser
change → release → **stop work** and tells its human one line `[P§5.4]`
`[C skills/handshake-coordination/SKILL.md:145-152]` — neither `[P§5.4]` nor
SKILL.md defines any rule that resumes it on a peer's later `task.release` or
`task.done`, so there is no shape being reused. What is genuinely reused is the
*ingredients*: the two events, the client's own records, and the fact that the
evaluation is local and needs no message. The rule itself is **[proposed]** and
collected in §14: a client that has sequenced a task re-evaluates it on the
peer's `task.release` / `task.done` for that `subject_key`, and on nothing else —
in particular never on a peer note saying the work is finished (§10.5).

### 5.5 The events that drive each case

| Case | Trigger | Carried by | New wire? |
|---|---|---|---|
| (a) same task | `task.claim` with a colliding `subject_key` | existing | no |
| (b) same file, different symbols | PreToolUse path match + `symbols` disjoint | **V-D2** on `task.claim` / `task.change` | one OPTIONAL field |
| (c) stack | `presence.update` whose `head` changed | **V-D1** on `presence.update` | one OPTIONAL field |
| (c) sequence → resume | `task.release` / `task.done` | existing `[C lib/envelope.js:41-45]` | **no** |
| contradiction (§6) | a local disagreement between two adopted revisions on one contested symbol | `task.seam` + **V-D3** | dependent on `[COBUILD §11 E1-E3]` |

---

## 6. The contradiction protocol (decision 5)

*His diff needs `X = true`; mine needs `X = false`.* Decision 5 names this as the
one place true collaboration and talking belong. Everything below reuses
`COBUILD`'s machinery; §6.2 says exactly what is new.

### 6.1 What is reused, section by section

- **The consent object and its criterion.** `[COBUILD §2.1]`: *"Consent-once is
  sound exactly when the grant is finite and displayable at grant time"*, and it
  is *"the test any future feature should have to pass"*. A contradiction round
  passes it: the counterparty is fixed and named, the contested symbol is fixed
  and named, the only thing that flows is a declarative text capped at 1200
  characters into one file at a client-computed path, and it stops at a stated
  time.
- **The closed permission list.** `[COBUILD §2.3]`'s four client acts and one
  model permission, and `[COBUILD §2.4]`'s never-list, both verbatim. In
  particular: *the model builds its **own** side against the current materialized
  revision, inside its own claim and its own files, without asking its human* —
  which is precisely the autonomy this stage is for, already written down and
  already bounded.
- **Revision-is-a-question-with-a-default-answer.** `[COBUILD §5.2]`, the design's
  largest simplification: *"A contract revision is already a question that carries
  its own default answer… The asker never blocks because there was never an
  ask."* Applied to a contradiction, the three proposals decision 5 lists — split
  the flag, make it contextual, one requirement is mistaken — are **three
  revisions**, not three message types.
- **Concurrent revisions.** `[COBUILD §4.5]`: both sides author rev N with
  different hashes → the rev-N contract from the lexicographically smallest member
  id wins, evaluated identically on both machines with no message required, and
  the loser re-states its requirement as rev N+1. This **borrows** the §5.4
  comparator for a new object and amends nothing `[C lib/subject.js:102-108]`.
- **The materializer and receiver-side authorization.** `[COBUILD §7.2]` entire,
  discard-and-count, and the client-computed path that closes traversal by
  construction `[COBUILD §2.3 item 2]` — the posture the tree already takes with
  `shardFileName`, which derives a filename from a member id rather than accepting
  one `[C lib/workspace-files.js:292-298]`.
- **The three local staleness signals.** `[COBUILD §4.6]`: rev behind · peer has
  not adopted my rev · file hand-edited. All derived from local state, no new
  message type.
- **Adoption is the fact.** Both sides build against the adopted revision. This is
  the principle of §3 in mechanism: the revision is structured and validated, so
  it may cause work.

### 6.2 What is new

Two OPTIONAL fields on COBUILD's own schema (**V-D3**), and nothing else:

- **`contested: true` on `propose`** — marks the seam as a contradiction round
  rather than an ordinary interface split. Its effect is entirely local: it
  changes which notice renders, it makes `handshake contested` list the round, and
  it arms the bounded-round counter of §6.3. **[proposed]**
- **`rationale`, ≤ 280 chars, on `contract`** — the short, attributed, escaped
  prose reason that travels **with** the revision it explains. Escaped on receive
  like every other peer field `[SEC§5.3]`, filtered on send by the structural
  sweep `[C lib/envelope.js:268-288]`, rendered quoted and attributed, never as an
  instruction. 280 is `[DELEGATION Appendix C C2]`'s cap for `why`, reused rather
  than invented. **[proposed]**

**Decision 5's trigger is *"a conflict event: symbol, value, both diffs"*, and
only part of that travels — said here rather than left to be noticed.** Two of
the four ride existing machinery and two never go on the wire at all:

| Part of the trigger | Where it lives |
|---|---|
| the contested **symbol** | `task.seam.name` — `[COBUILD §7.1]`'s existing ≤ 60-char field, present on `propose` and `accept` and *immutable for the seam*, so the symbol is named once, signed and echoed, and cannot drift mid-round. **No fourth field is proposed for it**, and this is what §6.4's notice and `handshake contested` print. |
| the **contested** marking | `task.seam.contested` (**V-D3**), above |
| the two **values** | derived locally, by reading the two materialized revisions `[COBUILD §7.2]` — each side already holds both |
| the two **diffs** | derived locally against the fetched work branch (§5.4), never reported by the peer |

**That is a reduction of decision 5's trigger** **[proposed]**, collected as §14
item 25: the discussion described a conflict event
carrying four things; this plan puts two on the wire and derives two, on the same
argument §5.4 makes for the overlap — a fact the receiver computes is more
truthful than a fact the sender asserts, and it costs no bytes. If V6's build
finds the two sides deriving *different* values from the same pair of revisions,
the derivation is wrong and the fix is `[COBUILD §7.2]`'s hash check, not a new
field.

**Why the reason is a field and not a `note.blocker`.** `note.blocker` exists,
carries ≤ 800 chars `[C docs/PROTOCOL.md:327]`, is a priority type
`[C lib/envelope.js:53-55]`, and `[COBUILD §5.3]` keeps it for facts no shape can
carry. It is the wrong vehicle for a contradiction reason for one decisive
mechanical reason: **a digest item is consumed by the watermark at injection and
appears exactly once** `[P§6.3]` `[C hooks/user-prompt-submit.js:84-98]`, and
decision 5 requires the reasons to be **attached** to the escalation, which may
happen several rounds later. A field on the revision is durable, paired with the
revision it explains, and re-renderable. `note.blocker` stays exactly where
`[COBUILD §5.3]` put it, for the facts a shape cannot carry.

### 6.3 Bounded rounds

**The bound is three revisions per contested seam** **[proposed]**, counted from
the `propose` that carried `contested: true`. On the fourth, the round escalates
(§6.4) rather than continuing.

Three is chosen against the only relevant number in the tree — `[COBUILD §7.1]`'s
rev cap of 8, which is itself *"reasoned, not measured"* `[COBUILD-PLAN §6.2]` —
on the argument that a contradiction is not an ordinary interface iteration: the
first revision states my requirement, the second states theirs, the third is the
synthesis, and a fourth is evidence the two requirements are incompatible rather
than merely unaligned, which is the humans' call. `[COBUILD-PLAN §3.S5]`'s manual
leg already measures how many revisions a real pair reaches; **this bound is the
first thing that measurement should re-decide.**

### 6.4 Escalation

Escalation is not a failure mode; it is the system asking, which is decision 1's
*"or when the system asks"* — the inversion of "unless asked by a human".
**Requirements are the humans' to own.**

On the fourth round, or immediately when a revision's own validation shows the
two requirements cannot both hold:

- **Both humans are told, and both reasons are attached.** Each side renders one
  notice in the existing 2 × 96 channel `[C hooks/render.js:186-188]` — the
  contested symbol (the seam's immutable `name`, §6.2, not a new field), the
  round count, and the pointer — and `handshake contested
  <id>` prints both `rationale` texts, **quoted and attributed**, with both
  revisions and their hashes. The peer's reason reaches the model only in a
  read-only view a human ran, which is `[DELEGATION §0 C-1]`'s control reused
  unchanged.
- **Neither Claude stops working.** Each keeps building its own half against the
  last revision it adopted, and says so in the notice, because a blocked pair is a
  worse outcome than a divergent one that both humans can see.
- **Neither Claude decides.** It does not end the seam, does not pick a winner and
  does not narrow scope on its own — the register of `[COBUILD-PLAN §5]` step 9,
  *"It does not decide, and does not end the seam."*

### 6.5 The one COBUILD decision this re-opens, and the bound on it

`[COBUILD §5]` **cut** *"a per-revision `note` explaining what changed"* with the
reason *"exactly where peer prose sneaks back in; the rev-to-rev diff is
computable locally and is more truthful than a self-description."* `rationale`
re-opens that cut. It is re-opened on decision 5, which states that the reasons
are load-bearing precisely here, and it is bounded so the original argument keeps
its force everywhere else:

1. `rationale` is accepted **only on a seam whose `propose` carried
   `contested: true`**. On an ordinary interface seam the field is discarded and
   counted, and COBUILD's cut stands unchanged.
2. It is ≤ 280 chars, escaped, attributed, and rendered **only** in a read-only
   view — never in the standing block, never in the digest.
3. It may change what my Claude **proposes**. It may never change what my Claude
   **builds**: only an adopted revision does that (§3). A `rationale` that asks
   for a never-list action is answered as data and the imperative ignored, in the
   shape of SKILL.md's existing worked example `[C skills/handshake-coordination/SKILL.md:278-326]`.
4. The rev-to-rev diff stays computable locally and stays the more truthful
   artifact. `rationale` is read **beside** it, never instead of it.

---

## 7. Symbol scope (decision 6)

### 7.1 Declared first

A claim gains an OPTIONAL `symbols` array (**V-D2**): ≤ 16 entries, each ≤ 120
chars, of the form `path::Symbol.member` **[proposed exact form]**. The model
writes it — it is the same speech act as the semantic subject it already authors
`[P§5]`. It is authored data, so it is filtered on send
`[C lib/envelope.js:268-288]` and escaped on receive `[SEC§5.3]`, and it renders
as one `details[]` entry inside the 20-char slot cap
`[C hooks/render.js:138]` (§2.4).

`task.change` carries the same field with `change: "scope"`, which is the existing
enum value for exactly this `[C docs/PROTOCOL.md:321-322]`, so a claim's symbol
set narrows and widens the way its `files[]` already does progressively
`[C hooks/post-tool-use.js:76-91]`.

### 7.2 The file-level gate is unchanged

**This is the part that must not drift.** The PreToolUse gate stays a path
comparison and stays a warning `[C hooks/pre-tool-use.js:51-72]`. Declared symbols
give the rendered line a second fact; they do not become a second gate, a lock, or
an exclusion mechanism. Claims are advisory leases, never locks `[P§5]`, and the
lesson `[COBUILD-PLAN §7 item 1]` draws from the field is *"keep resisting the
pressure to make it block."*

### 7.3 The named condition for parsing

Parser-verified symbols — Tree-sitter, native or WASM dependencies in a
zero-dependency plugin, parsing inside a ~90 ms synchronous hook `[P§8]` — are
**not** in this plan. They are built **only if** coordination records show
file-level warnings blocking real work, and that is now a measurable question
rather than a judgement call: the learning rung (§8) records every gate warning
and what the model did next, so the condition is *"the recorded rate of warnings
the model overrode as a false positive on a symbol-disjoint claim"* crossing a
threshold **[proposed: measured, then decided — no threshold is picked here]**.
Until then the cheap version is the whole feature.

---

## 8. Learning (decision 7)

The order is settled: **knowledge → coordination outcomes and hotspots → guidance
tightening**, and nothing skips a step because the later steps need data the
earlier ones produce. Decision 9 explicitly rejects hotspot learning before that
data exists.

- **Knowledge (K0–K2) shipped at `b6b3dca`**: the `learned` shard kind
  `[C lib/workspace-files.js:278]`, the write verb `[C bin/handshake.js:2507]`,
  the SessionStart shard scan `[C lib/shard-scan.js:161,264]`
  `[C hooks/session-start.js:80]`, and the once-per-session block at
  `LEARNED_BUDGET = 2000` `[C hooks/render.js:304]`. K3–K6 continue unchanged
  (§10.9).
- **Coordination outcomes** are the next record kind: one durable, dated,
  attributed row per resolved conflict — which case it was (§5), what the client
  did, whether it held. Written the same way, on the same shards, through the same
  owner-only throw `[C lib/workspace-files.js:337-343]` and the same
  `sendGate`-before-write `[C lib/workspace-files.js:365]`; read by the same scan,
  which already takes its kinds as a parameter `[C lib/shard-scan.js:67,161]`.
  **One new `SHARD_KINDS` entry [proposed: `outcome`], zero new wire types, zero
  new blocks** — it competes for the existing block's entry slots, so its per-turn
  cost is zero and its per-session cost is zero new characters (§2.4).
- **Guidance tightening** is last and is not designed here: it is the step that
  turns recorded outcomes into a narrower default, and it must not be built before
  §7.3's condition and §12.4's escalation rate have real numbers behind them.

**All of it is peer-authored data.** It informs, it never instructs; it is
bounded, dated, attributed and ranked — and on those four properties
`[KNOWLEDGE §1]`'s *"What it is not"* list and `[KNOWLEDGE §4.4]`'s *"What we do
not claim"* are the standing text. **The fifth property — that none of this is a
weight change, and that no document may imply otherwise — is decision 1's
wording (vision point 3) and decision 7's, not KNOWLEDGE's.** Neither
`[KNOWLEDGE §1]` (not the standing block, not chat, not CLAUDE.md instructions,
not co-build, not delegation) nor `[KNOWLEDGE §4.4]` (nothing verifies truth, a
malicious member is out of scope, ntfy attribution is not cryptographic)
mentions weights or training at all, so the sentence is stated here on the
owner's decision and **`KNOWLEDGE §1`'s list should gain it at K5**
`[KNOWLEDGE §9.K5]` — the SECURITY-and-red-team pass, which is where this
project audits what a document claims about itself — after which the citation
becomes true and this paragraph can point at it instead. And it stays on the shards: a `.handshake/knowledge/` directory shape is **rejected**, on
`[KNOWLEDGE §2.2]`'s five counts, four of which are security controls it would
have to re-implement.

---

## 9. The trusted pair (decision 8)

**Consent once, at join.** After that, capabilities are expressed as **which
structured event types may cause action** — never as broad booleans. An
`auto_edit_shared_repo`-style flag is rejected: it is not displayable at grant
time, which is exactly the criterion `[COBUILD §2.1]` sets, and it grants a
category rather than a mechanism.

**The table below is the V7 end state.** It is not a promise made at V1: each
rung V1–V6 ships with its own narrow, typed opt-in — one row's worth, gated by
§4.2 item 3 — and V7 is where those become one screen and one revocation
(§10.7). Autonomy never precedes consent at any point in the order; what V7 adds
is that the consent stops being scattered. **[proposed]** — the discussion set
consent-once at join and put the trusted-pair rung sixth; that those two are
reconciled by per-rung typed opt-ins is this plan's own resolution, §14 item 19.

**The capability table.** One row per structured event type this stage can act
on; the grant is per row, per peer, and revocable instantly.

**Decision 8 settles the *form* of the grant — which structured event types may
cause action, never broad booleans — and settles no initial value.** So the
Default column below is **[proposed]** in every *grantable* row, collected as §14 item 20,
and it is the owner's to ratify rather than to inherit: the suggestion is *all
granted except `task.offer`*, on the argument that every granted row is bounded
by its own last column and that `task.offer` is the only one that supersedes an
existing human control (§13.4). A reader who disagrees with one row changes one
row; nothing else in the design moves.

| Event type (structured) | What acting on it means | Default **[proposed]** | Bound that holds regardless |
|---|---|---|---|
| `task.claim` / `task.change` with `symbols` (**V-D2**) | narrow my gate's rendered verdict; coexist on a symbol-disjoint file | **granted** | render only; never suppresses the path warning |
| `presence.update` with a moved `head` (**V-D1**) | fetch the peer's work branch and evaluate a rebase | **granted** | fetch and local rebase only; never a push to their branch |
| `task.release` / `task.done` | resume a sequenced task automatically | **granted** | resumes only a task this member already holds |
| `task.seam{propose}` where `contested` | open a contradiction round; render the notice | **granted** | opening is not adopting |
| `task.seam{contract}` | materialize the revision and build my half against it | **granted on an authenticated transport; human-gated on ntfy** | `[COBUILD §2.6]` verbatim: automatic iff `capabilities().authenticated_from` |
| `task.seam{adopt}` | record that the peer adopted; clear my rev-not-adopted notice | **granted** | three values the client computed or verified itself |
| `task.offer` (`[DELEGATION Appendix C C1]`, unratified) | **accept an offer without asking my human** | **NOT granted by default** | see §13.4 — this is the row that supersedes DELEGATION's per-offer gate, and it is opt-in per peer |
| `note.*` of any kind | **nothing** | **never grantable** | prose may cause thinking, never work (§3). This row exists to be permanently empty. |

Two properties of the table, both load-bearing:

- **It is a closed list of types, so the grant is enumerable and displayable at
  grant time** — the criterion, satisfied by construction rather than by
  discipline.
- **The last row is the design.** No capability, at any setting, lets peer prose
  cause an action. That is what makes every other row safe to grant.

`handshake pair` prints the whole table with the current setting for that peer,
requires a typed confirmation and refuses `--yes` the way `join` does
`[C bin/handshake.js:627]` `[P§9.1]`, and refuses from a proven child
`[C bin/handshake.js:387]` `[P§7.2 rule 1]`. `handshake pair --revoke` flips local
state **before** any network call, so a capability dies the instant the command
runs and cannot be held open by a dropped message — the rule `[COBUILD-PLAN §3.S1]`
establishes for `seam end`.

---

## 10. The build

Decision 10's order, argued rung by rung in the register of
`[COBUILD-PLAN §2.1]`: the reasoning is stated per rung, because each rung is
justified by a different thing.

### 10.1 V1 — The state branch and the automatic push

**Why first.** It is the rung everything else needs and the only one that is
useful on its own. Machine-speed durability is what makes the absent-peer case
dissolve (§4.3), what lets §5.4 fetch anything at all, and what turns §8's
outcome records from a file nobody pulls into a fact the peer's next session
reads. It also has the shortest dependency list in this plan: **no wire change at
all.**

**Delivers.** An orphan `handshake/state` branch **[proposed]** carrying
`.handshake/` only; a commit per batch with author = the member and committer =
the tool; a push batched at ≤ 1/min on the monitor's own clock; a deferred retry
while offline; **the no-remote arm — no branch, no commit, no push, today's
behaviour, said plainly in `status`** (§4.1); the opt-in gate and the preflight;
`handshake branches` as the read-only view.

**Touches.** `lib/repo.js` (the commit and push helpers, beside the existing
bounded `git()` runner `[C lib/repo.js:82]` — never a shell, argv straight to the
process `[C lib/repo.js:52-54]`) · `monitors/heartbeat.js` (the batch clock,
beside the keepalive it already keeps) · `hooks/stop.js` (the no-monitor fallback
path, which already re-uses `beat()` rather than copying it) · `bin/handshake.js`
(`pair --state-branch`, `branches`) · `lib/state.js` (the deferred-push marker,
as a sentinel beside the existing ones `[C hooks/common.js:26]`, **not** in
`state.json`, which hooks read-modify-write on hot paths).

**Wire.** **None.** The state branch is git; nothing about it travels as an
envelope.

**Tests.** The commit is created with the member as author and the tool as
committer. Two batches inside one minute produce one commit. A push failure
leaves the local commit intact and retries on the next beat, and `status` reports
the deferred count — the offline queue's honesty rule, because a deferred write
that does not say it was deferred is a lie `[P§10.2]`. The branch is orphan: it
shares no commit with `main`, and a `git log main` after a hundred coordination
commits is byte-identical to before. No commit is created before the opt-in. **A tree with
no configured git remote creates no branch, makes no commit and attempts no
push; the shard is written and rides the next user-requested commit
`[C bin/handshake.js:893-896]`, `status` names the state as absent rather than
deferred, and the deferred count stays zero** — the `no_remote` reason
`[C lib/repo.js:131]` drives the branch and is not conflated with offline. A
public-repo verdict refuses the guarded part `[C lib/repo.js:36-48]`. A proven
child creates and pushes nothing `[C bin/handshake.js:387]` `[P§7.2 rule 1]`.

**Tier: Opus xhigh.** This is the first code in the product that writes to a
remote without a human in the way. It gets M2's tier for M2's reason.

### 10.2 V2 — The two-human run, re-aimed

**Why here, and not later.** Decision 10 puts the two-human run **after the first
autonomy slice** so that it tests the new model early. That is a change of aim
from `[COBUILD-PLAN §2.1]` rung 2, which put M12(b) after the knowledge layer to
measure zero-setup volume and relay-deployment friction. Both aims now ride one
calendar event: the run still measures the ntfy day-long volume that decides
whether zero-setup stays the default rung `[P§9.3]` `[PLAN§7]`, and it now also
answers the two questions only V1 can raise — **does a commit-per-minute branch
feel like noise to a human, and does the secret scan ever refuse a legitimate
commit.** Both are §12 risks, and neither is answerable from one machine.

**Delivers.** `[PLAN§5 M12(b)]`'s manual leg, run over V1: two accounts, two
machines, one repo, one working day. Plus the knowledge layer's own acceptance
`[KNOWLEDGE §10.1]`, which is now free to ride the same run.

**Touches.** No product code. A checklist, and the captured artifacts:
`knowledge.json`, the session-keyed sentinel, the state branch's reflog, the
scan's timings.

**Tier: human + Opus high**, to write the checklist and read the result.
`[PLAN§5 M12]`'s split.

### 10.3 V3 — Declared symbols on claims

**Why third.** It is the cheapest wire change in the plan — one OPTIONAL field on
two existing types, no catalog amendment (§2.3) — and it is a prerequisite for
both remaining conflict cases: (b) needs it to stop warning needlessly and (c)
needs it to know two tasks touch one method. It is also the rung that makes
§7.3's parser question measurable instead of theoretical.

**Delivers.** `symbols` on `task.claim` and `task.change{scope}`; the `details[]`
entry on the card; the second fact in the PreToolUse rendered line; SKILL.md
guidance on how to author a symbol list and when not to bother.

**Touches.** `lib/envelope.js` (the body validator and the named `authoredFields`
case `[C lib/envelope.js:220-222]`) · `hooks/render.js` (one `details[]` entry,
no new rung) · `hooks/pre-tool-use.js` (the rendered line only) ·
`bin/handshake.js` (`claim --symbols`, `change --symbols`) ·
`skills/handshake-coordination/SKILL.md` · `docs/PROTOCOL.md` §3.2.

**Wire.** **V-D2**, a proposed Appendix B v1.1 delta on `[P§3.2]`. Not a catalog
amendment; §3's `[F]` line is untouched.

**Tests.** A v1.0 client accepts an envelope carrying `symbols` and ignores the
field — pinned against `validate()` `[C lib/envelope.js:365-414]`, which is the
whole argument of §2.3 and must not be allowed to rot. The gate still warns on a
path match with disjoint symbols, and the rendered line names both symbol sets. A
peer-supplied symbol string never reaches a filesystem path. **The re-measurement
gate:** the standing block with two symbol-scoped claims stays under 600, and
`dropDetails` `[C hooks/render.js:253]` drops the symbol before anything
untrimmable — a gate, not a note, exactly as `[COBUILD-PLAN §3.S0]` makes it.

**Tier: Opus high.** Mechanical, against a hard budget and a frozen render ladder.

### 10.4 V4 — Own-branch code push, the commit secret scan, and the CI skip

**Why after V3 and not before.** The branch name derives from the claim, and a
work branch whose scope nobody declared is a live view of an unknown blast radius.
More practically: this is the rung that makes a Claude's unfinished code visible
to another person's machine, and it should ship after the run in V2 has said what
a commit-per-minute branch actually feels like.

**Delivers.** `handshake/<member>/<subject_key>` **[proposed]**, one per claim,
created on claim and pushed freely; the branch name sanitized by the same rule
that already turns a peer-authored member id into a filename
`[C lib/workspace-files.js:292-298]`, because a subject is free text and a branch
name is a path; the fail-closed commit secret scan of §4.2 item 1; the CI
`branches-ignore` of §4.2 item 4; `presence.update.branch` populated from the
work branch rather than left to the human `[C bin/handshake.js:1782]`.

**Touches.** `lib/repo.js` · `lib/filter.js` (the windowed entry point — **no
change to `check()`'s contract or to `MAX_BYTES`**; a new caller that windows,
so the 2,048-byte refusal `[C lib/filter.js:255]` stays exactly where it is) ·
`monitors/heartbeat.js` · `bin/handshake.js` · `.github/workflows/ci.yml`
`[C .github/workflows/ci.yml:13-15]` · `docs/SECURITY.md`.

**Wire.** **None.** `branch` already exists on the presence body
`[C docs/PROTOCOL.md:295]`.

**Tests.** A commit containing a value from a local `.env` is refused, and nothing
is committed, pushed or advanced — the shape `[COBUILD-PLAN §3.S2]` requires of a
`sendGate` refusal. A commit containing a 40-hex string with no credential word
within 24 chars is **allowed**, and the test is named for the false-positive class
it pins `[SEC§4]`. A secret split across two hunks 3 KB apart is caught by the
overlap window, or the test records honestly that it is not. `handshake/*` pushes
run no CI job; a pull request from the same branch runs all three. The branch name
of a subject containing `../`, a device name, or a `refs/` prefix is sanitized to
something git accepts and nothing traverses.

**Tier: Opus xhigh, with a 3× adversarial fan-out on the scan.** This is a
security control on an automatic path, and `[SEC§4]`'s own lesson is that *"a
denylist is only as good as its last adversarial review."*

### 10.5 V5 — Stacking and sequencing

**Why here.** It is the first rung that is pure autonomy — no new human-facing
surface, no new consent, no new file. It needs V1 (the branch is fetchable), V3
(the symbols say the tasks collide at a method) and V4 (there is something on the
branch to fetch).

**Delivers.** `presence.update.head`; the local branch-moved derivation; the
fetch-and-evaluate step; the rebase decision and its instability counter; the
sequence-and-resume rule on `task.release` / `task.done`; the stack `details[]`
entry and the rebase-needed notice; `handshake branches --fetch`.

**Touches.** `lib/envelope.js` · `lib/repo.js` (fetch, rebase dry-run) ·
`monitors/heartbeat.js` (emit `head`) · `hooks/common.js` (the derivation into the
view) · `hooks/render.js` (one `details[]` entry, one notice) ·
`skills/handshake-coordination/SKILL.md` (when to stack, when to sequence, and
that neither is announced).

**Wire.** **V-D1**, a proposed Appendix B v1.1 delta on `[P§3.2]`.

**Tests.** A `head` that did not change produces no fetch. A dirty rebase leaves
the local branch untouched and renders the notice. The instability counter trips
at the bound and switches to sequence. A sequenced task resumes on the peer's
`task.done` and on nothing else — in particular, **not** on a peer note saying the
work is finished, which is the never-list in test form. Two clients evaluate the
same `head` sequence and reach the same verdict with no message exchanged. **The
second re-measurement gate:** the block with a symbol detail and a stack detail on
each of two claims.

**Tier: Opus high**, and Opus xhigh for the SKILL.md text, which is M7's tier for
M7's reason.

### 10.6 V6 — The contradiction protocol

**Why sixth.** It is the only rung that needs a ratified wire type it does not
own: it rides `task.seam`, whose Appendix B rows E1–E3 are `[COBUILD §11]`'s and
are **unratified**. So V6 cannot start until `[COBUILD-PLAN §3.S0]` has been
ratified and S1–S2 built. That is a real dependency and it is stated as a
scheduling fact, not a preference (§10.9).

**Delivers.** `contested` and `rationale` (**V-D3**); the bounded-round counter;
the escalation path with both reasons attached; `handshake contested`; the two
notices; SKILL.md's revision discipline for a contradiction — *author the shape
your half requires; never reply to their prose.*

**Touches.** `lib/envelope.js` (two fields on the seam body validator) ·
`lib/seam.js` (the materializer S2 introduces) · `lib/state.js` (the round
counter on the seam ledger) · `hooks/render.js` (notices only) ·
`bin/handshake.js` · `skills/handshake-coordination/SKILL.md` ·
`docs/SECURITY.md` · `docs/COBUILD.md` (§5's cut list gains the bounded
re-opening of §6.5, so the two documents do not contradict each other).

**Wire.** **V-D3**, dependent on `[COBUILD §11 E1-E3]`.

**Tests.** A `rationale` on a non-contested seam is discarded and counted. A
`rationale` containing an imperative is rendered as quoted data and the imperative
ignored — the red-team item, run against the actual SKILL.md text. The fourth
round escalates and neither side stops working. Both sides' `handshake contested`
prints both reasons and both hashes. Concurrent rev-N is resolved identically on
two simulated clients with no message exchanged `[COBUILD §4.5]`. An escalated
round that is never answered expires on the seam TTL and announces nothing —
`[COBUILD §5.4]`'s derived-not-transmitted rule.

**Tier: Opus xhigh.** A consent boundary, a security-relevant field carrying peer
prose, and the brain text that decides what the model does with it.

### 10.7 V7 — The trusted-pair configuration

**Why after the capabilities exist.** A capability table listing event types that
are not built yet would be a promise, and this project does not advertise unbuilt
features `[C docs/PROTOCOL.md:7-8]`. V1 through V6 each ship with their own
narrow, typed opt-in — one row's worth — and V7 is the rung that **generalizes**
those into one table, one screen and one revocation. Nothing about the order lets
autonomy precede consent: every rung's own gate is the §4.2 item 3 gate.

**Delivers.** `handshake pair` and its three modes (show, grant, revoke); the
persisted per-peer grant, in its own state file beside `peers.json` / `queue.json`
/ `digest.json` `[C lib/state.js:183-190]` rather than in `state.json`; the
migration that reads each rung's narrow opt-in into the table; the
`task.offer` row, off by default (§13.4).

**Touches.** `lib/state.js` · `bin/handshake.js` · `commands/handshake.md` ·
`docs/SECURITY.md` · `skills/handshake-coordination/SKILL.md`.

**Wire.** **None.** The grant is local; it is not announced, and a peer never
learns what it was granted — it learns only that an action did or did not happen,
which is the correct direction: an announced capability list is a map of what to
try.

**Tests.** Revocation flips local state before any network call. A capability the
peer was never granted is never exercised, and the refusal is counted, not
narrated. `--yes` is refused. A proven child cannot grant. The `note.*` row cannot
be granted by any input, including a hand-edited state file — the permanently
empty row, pinned.

**Tier: Opus xhigh.** It is the consent boundary for everything above it.

### 10.8 V8 — Coordination-outcome records

**Why last.** Decision 9 rejects hotspot learning before the data exists, and the
data is produced by V5 and V6. Built earlier it would record nothing.

**Delivers.** One new `SHARD_KINDS` entry **[proposed: `outcome`]**; the write on
each resolved conflict; the scan's kind list extended
`[C lib/shard-scan.js:67]`; the entries competing for the existing once-per-session
block's slots; the two numbers §7.3 and §12.4 need.

**Touches.** `lib/workspace-files.js` `[C lib/workspace-files.js:278]` ·
`lib/shard-scan.js` · `hooks/render.js` (the learned block's entry builder only) ·
`skills/handshake-coordination/SKILL.md`.

**Wire.** **None.** `SHARD_KINDS` is a client constant with no wire type, no
interop surface and no freeze implication — argued, not assumed, at
`[C lib/workspace-files.js:272-277]` and `[KNOWLEDGE §2.4]`.

**Tests.** A v0.1.5 client pulling a repo full of `outcome` records renders them
as ordinary rows — the forward-compat pin the `learned` kind already carries. The
per-turn cost stays zero: the standing block is byte-identical with and without an
outcome corpus on disk, which is the pin `[KNOWLEDGE §7]` already established for
`learned`.

**Tier: Opus high.** One client constant, one parameter, one entry builder,
against machinery that already shipped.

### 10.9 The task table, and where the other slices sit

| # | Task | Model / effort |
|---|---|---|
| **V1** | The state branch: orphan `handshake/state`, author/committer split, ≤ 1/min batch on the monitor clock, deferred push, opt-in + preflight, `handshake branches` | Opus **xhigh** |
| **V2** | The two-human run — `[PLAN§5 M12(b)]` re-aimed at V1, carrying `[KNOWLEDGE §10.1]` on the same calendar event | human + Opus high |
| **V3** | Declared symbols: **V-D2**, the `details[]` entry, the gate's second fact, SKILL.md; **re-measure the block (gate)** | Opus high |
| **V4** | Work branches + the fail-closed commit secret scan (windowed) + the CI `branches-ignore` | Opus **xhigh**, 3× adversarial fan-out on the scan |
| **V5** | Stacking and sequencing: **V-D1**, fetch/rebase/instability, resume on `release`/`done`, the stack detail; **re-measure (gate)** | Opus high; Opus **xhigh** for SKILL.md |
| **V6** | The contradiction protocol: **V-D3**, bounded rounds, escalation with both reasons, `handshake contested` | Opus **xhigh** |
| **V7** | The trusted pair: the capability table, `handshake pair`, the migration, the permanently empty `note.*` row | Opus **xhigh** |
| **V8** | Coordination-outcome records: one `SHARD_KINDS` entry, the scan's kind list, the two measurements | Opus high |
| **V9** | SECURITY.md consolidation + the red team over the whole stage (injection through `rationale`; a branch-name traversal corpus; the exfil corpus against an automated commit; impersonation on ntfy) | Opus **xhigh**, 3× adversarial fan-out |
| **V10** | README / INSTALL / release: the floor stated in the same register as the features (§12.7) | Sonnet medium draft; Opus high polish |

**V9 and V10 have no rung section of their own** because they have no new design:
V9 is M13's shape and V10 is M14's `[PLAN§5]`, applied to everything V1–V8
shipped. They are in the table because a stage that ends at V8 has not been
red-teamed or documented, and the decision-10 order was a list of features, not of
gates. **Adding them is this plan's choice, not decision 10's** — decision 10's
order ends at the learning records — so **[proposed]**, collected in §14: two
rungs on the end, no new design, and a stage that ships without them is a stage
whose security pass and documentation never happened.

**Order: V1 → V2 gate → V3 → V4 → V5 → V6 → V7 → V8 → V9 gate → V10.** Tests,
builds and E2E runs are local, no model `[PLAN§5]`. V3 and V5 may not run in
parallel — V5's card arithmetic is measured on top of V3's. V6 must not start
before `[COBUILD-PLAN §3.S2]` exists, because it rides that materializer and that
ledger.

**Where the other slices now sit.**

- **`KNOWLEDGE` K3–K6 continue, unchanged and independent.** K0–K2 shipped at
  `b6b3dca`; K3 (`handshake learned`), K4 (SKILL.md), K5 (SECURITY + red team, a
  gate) and K6 (docs/release) are unaffected by anything here and may run in
  parallel with V1–V4 `[KNOWLEDGE §9.1]`. V8 extends K1's scan rather than
  replacing it — the scan already takes its kinds as a parameter
  `[C lib/shard-scan.js:67,161]`, which is the generic shape `[KNOWLEDGE §9.K1]`
  promised and delivered.
- **`COBUILD` S0–S6 move from third in the project order to a dependency of V6.**
  `[COBUILD-PLAN §2.1]` ordered the project knowledge → M12(b) → co-build →
  delegation. M12(b) is now V2 and is re-aimed; co-build's internal order
  (S0 → S1 → S2 → {S3a, S3b} → S4 → S5 → S6) is **unchanged in content and in
  sequence**, and S0's ratification of E1–E3 is now on V6's critical path rather
  than only on co-build's. Nothing inside `[COBUILD-PLAN §3]` changes.
- **`DELEGATION` is superseded in one respect and unchanged in the rest** — §13.4.

---

## 11. Acceptance

`[PLAN§6]` / `[KNOWLEDGE §10]` style. Two humans, two accounts, two machines, one
repo. Alex and Bob. Run the relay leg, then the ntfy leg with its documented
advisory semantics `[P§5.5]`. **No command is typed to cause coordination**; the
only typing is each human's one-time `handshake pair` and their ordinary work.

### 11.1 Coexist by symbol

**Setup.** One 900-line file, `src/api/handler.ts`. Alex's Claude holds
`response shaping` with `symbols: ["src/api/handler.ts::Handler.shape"]`; Bob's
holds `rate limiting` with `symbols: ["src/api/handler.ts::Handler.limit"]`.
Jaccard between the two subjects is 0, so no overlap candidate
`[C lib/subject.js:95]`.

**What each Claude does.** Both edit the file. The PreToolUse gate fires on both
machines — the path **does** match a peer claim
`[C hooks/pre-tool-use.js:51-67]` — and each rendered line now names both symbol
sets. Each Claude reads that the symbols are disjoint, states one line to its own
human, and continues. Neither posts a `warn.overlap`; the emitter is refused below
the 50 floor anyway `[P§5.2]`.

**What each human sees.** One line, once, per Claude: *"bob is in the same file on
`Handler.limit`; I'm on `Handler.shape`."* Nothing else.

**Asserted.** The gate still fired (it is a path check and must not be narrowed).
Neither Claude stopped. Neither Claude asked. The card carries each claim's symbol
as a `details[]` entry and the block is under 600. A control run with `symbols`
absent produces the same gate and a vaguer line — the difference is the rendered
fact, not the verdict.

### 11.2 Stack on the same symbol

**Setup.** Alex holds `retry policy`, Bob holds `timeout handling`; both need
`src/net/client.ts::Client.request`. Two different tasks, one symbol.

**What each Claude does.** `retry policy` and `timeout handling` are different
subjects, so their `subject_key`s differ and **`[P§5.4]` is not engaged at all**
— it governs only *"when two members believe they hold the same `subject_key`"*
`[C docs/PROTOCOL.md:506]`, which is `[COBUILD §4.7]`'s point about disjoint
halves restated (§5.1). Nothing about this scenario is settled by who claimed
first; the only ordering that exists is which work branch had commits on it
first, and that is a fact on disk, not a rule (§5.1). Bob's Claude sees
Alex's `symbols` overlap its own and Alex's `presence.update` carrying
`branch: handshake/alex/retry-policy` with a `head`. It fetches, evaluates the
diff, rebases its work on Alex's head, and keeps building. Alex pushes twice more;
each push moves `head`; each move triggers one fetch and one clean rebase on Bob's
side.

**What each human sees.** Alex: nothing at all — Alex's Claude is not doing
anything unusual. Bob: one line at a boundary, *"building on alex's branch for
`Client.request`."* Then nothing. No human types anything.

**Asserted.** Bob's tree contains Alex's unmerged commits and Bob's work on top.
Neither branch was merged, no PR was opened, `main` is untouched. The stack
`details[]` entry renders and disappears under trimming without taking anything
untrimmable with it. Alex's Claude was never asked for permission and never told
to stop. **If this exchange needs a human turn, the rung failed.**

### 11.3 A contradiction resolved by splitting the flag, with no human

**Setup.** Same symbol as 11.2. Alex's retry policy requires
`Client.request(..., idempotent = true)`; Bob's timeout handling requires
`idempotent = false` for the streaming path. Both are right about their own half.

**What each Claude does.** Bob's Claude's rebase now fails on the value, not on
the text — a genuine disagreement, not churn. It opens a `task.seam` with
`contested: true` naming `Client.request::idempotent`, and authors rev 1: the
contract text stating **what Bob's half needs**, with a ≤ 280-char `rationale`
(*"streaming responses cannot be replayed; retry on a partial stream duplicates
output"*). Alex's client materializes rev 1, Alex's Claude reads the rationale as
**data**, and — because a peer sentence may change what it proposes — authors
rev 2: the flag is split into `idempotent` and `replayable`, with its own
rationale. Bob's client materializes and adopts. **Two revisions, zero human
turns.** Both Claudes regenerate against the adopted revision and continue.

**What each human sees.** One notice each, in the existing notices channel, while
the round is open. One line each when it closes: *"alex and I split `idempotent`
into `idempotent`/`replayable`; both halves build against rev 2."*

**Asserted.** The round closed inside the bound. No human typed anything. The
adopted revision — not the rationale — is what changed the code on both sides:
pinned by a control run in which the rationale arrives and the revision does not,
where **neither Claude changes a line**. The two materialized files are
byte-identical and their hashes match `[COBUILD §7.2]`.

### 11.4 A contradiction that escalates, with both reasons attached

**Setup.** As 11.3, but the requirements are genuinely incompatible: Alex's
product requirement is at-least-once delivery, Bob's is exactly-once. No shape
splits that.

**What each Claude does.** Rev 1 states Bob's requirement, rev 2 states Alex's,
rev 3 attempts a contextual split and neither side can adopt it. On the fourth,
each client escalates. Neither Claude ends the seam, picks a winner, or narrows
its own scope. Both keep building against the last revision each adopted, and say
so.

**What each human sees.** One notice in the block: *"contested:
`Client.request::idempotent`, 3 rounds, unresolved — `handshake contested`."*
Running it prints **both** rationales, quoted and attributed, both revisions and
both hashes, and one sentence saying the requirement is theirs to settle. Both
humans see the same two reasons, on their own machines, from their own state.

**Asserted.** The escalation reached **both** humans, not one. Both reasons were
attached. Neither Claude stopped working. Neither ended the seam. The peer's prose
appeared only in a read-only view a human ran `[DELEGATION §0 C-1]`, never in the
standing block. An escalation nobody answers expires on the seam TTL and announces
nothing `[COBUILD §5.4]`.

### 11.5 The absent peer, served by the state branch

**Setup.** Bob shuts his laptop on Thursday and returns the following Wednesday —
six days, past ntfy's ~12 h cache `[P§9.3]` and at the edge of the relay's 7-day
window `[P§9.2]`. Alex works through it.

**What each Claude does.** Alex's Claude keeps committing to `handshake/state`
every minute and to `handshake/alex/<subject>` as it works. On Wednesday Bob's
first action is an ordinary `git fetch`. Bob's SessionStart scans the shards
before the network sync — local disk I/O inside the window the injector already
waits on `[C hooks/session-start.js:64-80]` `[C hooks/common.js:58]` — and Bob's
first prompt carries the once-per-session block with Alex's week of learnings and
outcomes, attributed and dated `[C hooks/render.js:304]`.

**What each human sees.** Bob sees one block on his first prompt, and a Claude
that opens the right file first. Alex sees nothing at all — the absent peer costs
Alex nothing, which is the point.

**Asserted.** **Nothing about Bob's recovery depended on the relay.** Run the
scenario with the relay unreachable for the whole six days and the result is
identical, which is the assertion that proves §4.3's first claim. On the ntfy leg,
`· older chatter gone` still renders `[C hooks/render.js:70]` and the client still
says plainly that older live chatter is gone `[P§6.4]` — the durable layer answers
and the live layer does not pretend. A run in which the block never appears at all
is a V1/V8 failure, not an acceptance result, and the distinction is recorded in
the run notes with `knowledge.json` captured alongside — the rule
`[KNOWLEDGE §10.1]` established.

### 11.6 Security assertions, run on both legs

A `rationale` carrying an imperative is answered as data and the imperative
ignored. A delimiter-breakout `rationale` survives escaping harmlessly
`[SEC§5.3]`. A commit containing a local secret is refused and nothing is pushed
`[C lib/filter.js:226-249]`. A subject engineered to produce a traversing branch
name is sanitized `[C lib/workspace-files.js:292-298]`. A public-repo verdict
refuses the guarded part and demands rotation `[SEC§6]`. A peer's `symbols` string
never becomes a filesystem path. A spoofed `from` on the relay is refused at the
source `[P§9.2]`. A passive ntfy subscriber holding the topic but not the secret
learns no branch name — `branch` is in the encrypted body
`[C lib/envelope.js:37]`.

---

## 12. Risks

### 12.1 Autonomous-push noise

A commit per minute per member on a state branch, plus a work-branch commit per
meaningful edit, is a lot of git traffic in someone else's repository. Left
unmanaged it produces a reflog nobody can read, a notification stream nobody
wants, and a `git branch -r` listing that grows without bound.

**What the plan builds:** the state branch is **orphan**, so it never appears in
`git log` of any branch a human works on (§4.3); the batch is ≤ 1/min on the
monitor's own clock, never on tool cadence `[P§8]`; CI is skipped on
`handshake/*` (§4.2 item 4) so the noise costs no minutes; and V2 measures what a
human actually feels before V4 doubles the traffic. **What it does not build:** an
automatic branch cleanup — deleting a branch is a destructive operation and is
above the floor (§4.1). Stale work branches accumulate until a human prunes them,
and `handshake branches` lists them oldest-first so the pruning is one glance.

### 12.2 Secret-scan false positives blocking pushes

A fail-closed scan on every automated commit means a false positive stops the
Claude's work from being visible. `[SEC§4]` already records that the entropy pass
skips bare 40- and 64-hex runs precisely because git SHAs saturate developer
chatter, and that the battery is a denylist.

**What the plan builds:** the scan reuses `lib/filter.js` unchanged, so every
false-positive class already pinned by a regression test named for its attack
`[SEC§4]` stays pinned; a refusal is **loud, once, to the author, naming the
finding id and the file** rather than a silent skip; and the commit is refused,
never partially made. **The honest residual:** the tripwire compares raw values
from local secret files `[C lib/filter.js:226-249]`, so a project whose `.env`
holds a short common word will refuse commits containing that word. The mitigation
is the ≥ 8-char floor `[C lib/filter.js:23]`, and V2's day-long run is where the
rate is measured. If the measured refusal rate on legitimate commits exceeds
**[proposed: 1 in 200]**, the scan is narrowed to the tripwire plus the branded
battery and the entropy pass is dropped from the commit path — a decision to make
on data, recorded here in advance so it is a rule and not a mood.

### 12.3 Rebase churn

A peer pushing every minute means a stacked Claude could rebase every minute and
never finish anything.

**What the plan builds:** the instability counter of §5.4 — after **[proposed: 3]**
`head` moves since the last successful rebase, the client stops rebasing and
sequences instead, resuming on `task.release` / `task.done`. Rebase is attempted
as a dry run first, so a dirty result costs nothing and leaves the local branch
untouched (§10.5). And the fetch is triggered by a **changed `head`**, not by a
timer, so a quiet peer costs zero fetches.

### 12.4 Escalation fatigue

If the contradiction protocol escalates often, two humans are being interrupted by
their own automation, and the feature is worse than nothing.

**What the plan builds:** the bound is deliberately low (§6.3), so an escalation
means "three revisions did not converge", which is a real signal rather than a
timeout; both Claudes keep working through it, so an escalation is never a stall;
the notice rides the regenerated notices channel rather than the digest, so it
persists without re-notifying `[P§6.3]`; and V8 records every escalation as an
outcome, so the rate is a number and not an impression. **If the measured rate
exceeds [proposed: one per pair per working day], the bound goes up before the
feature is cut** — a round is cheap and an interruption is not.

### 12.5 CI cost

Three jobs across two operating systems `[C .github/workflows/ci.yml:17-91]` on
every push is affordable at human cadence and not at machine cadence.

**What the plan builds:** `branches-ignore` on `handshake/*` (§4.2 item 4), with
`pull_request` untouched so the suite runs at exactly the moment a human proposes
a merge. **The residual, stated because it is real:** a Claude's work branch is
then never tested until a human opens a PR, which is a change in when breakage is
discovered. That is the intended trade — the branch is advertised as a **live
view**, broken is explicitly allowed, and the acceptance criterion is that nothing
downstream of the branch treats it as green. `handshake branches` labels every
work branch `untested` for exactly this reason. **The second residual, which §5.4
states in full:** decision 4 named *branch CI passing* as one of the three facts
a stacking judgement reads, and this guardrail removes it. §5.4 replaces it with
a clean rebase dry-run plus successive `head` values and says what that does and
does not buy; the opt-in lightweight per-branch job that would restore it is §14
item 23, deliberately not built before V2 has measured what CI at machine cadence
actually costs.

### 12.6 Complexity — the one the owner keeps flagging

Six concepts (§2.1) against `[KNOWLEDGE §8]`'s two and `[COBUILD §3]`'s two, three
new verbs against a CLI heading for thirty-six (§2.2), and three proposed wire
deltas on top of two unratified ones. **This is the largest slice this project has
planned, and the count should be argued down here.**

**What holds it down:** zero new event types (§2.3); zero untrimmable per-turn
characters (§2.4); zero new state files on the hot path; the conflict cases reuse
the tiebreak, the overlap floor, the claims and the gate exactly as they are; the
contradiction protocol adds two fields to a machine that already exists in design
`[COBUILD §7.1]`; and the learning rung adds one client constant
`[C lib/workspace-files.js:278]`.

**What would make me cut a rung**, written in advance so it is a rule:

- **Cut V6 entirely and route contradictions to `note.blocker` + a human** — if
  V2's or V5's run shows contradictions arising **[proposed: less than once per
  pair per week]**.
  A protocol for a thing that happens monthly has no customer, and `note.blocker`
  ships today at zero new surface `[C skills/handshake-coordination/SKILL.md:278-326]`.
- **Cut V8 and keep the knowledge layer as it is** — if the recorded outcome
  corpus after V2 is under **[proposed: 20 rows]**. Ranking twenty rows is not
  learning, and decision 9 already rejects hotspot learning before data exists.
- **Cut V3's symbol declaration to a single symbol, not a list** — if V2 shows the
  model authoring long, low-quality lists. One good symbol beats sixteen guesses,
  and the field's cap makes the narrowing a one-line change.
- **Never cut the four guardrails of §4.2.** The fail-closed commit scan, the
  public-repo guard, the two-sided opt-in and the CI skip ship with V1 and V4 or
  those rungs do not ship. A version that pushes before its boundary is the wrong
  feature.
- **Never cut the two-human run out of second place.** Every risk above is
  measured there and nowhere else.

### 12.7 What we do not claim

- **Not that the commit secret scan prevents leaks.** It is a seatbelt plus a
  closed tripwire for known local secrets `[SEC§4]`, run over a diff instead of a
  message. No document, command output or release note may say it *prevents*,
  *guarantees* or *ensures*. Chunking still defeats per-message scanning by
  construction; the overlap window narrows that hole and does not close it.
- **Not that a malicious peer is contained.** `[SEC§1.2]` places a malicious
  current member out of scope and this stage **widens what such a member can do**:
  they can now cause commits to appear on a branch in a repo you both share and
  can influence what your Claude builds on its own half, within the granted
  capabilities. That is stated in SECURITY.md at V9 rather than left inferable,
  the way `[COBUILD §12]` states its own.
- **Not that the typed confirmation is proof of consent.** The model drives the
  terminal, and `ask()` branches on `!process.stdin.isTTY` and answers from piped
  stdin `[C bin/handshake.js:84,87-113]` — re-opened this pass, and it holds:
  `[COBUILD-PLAN §6.2]`'s wording is correct and MUST NOT be upgraded later. What
  the gate mechanically removes is the *automatic* action; the human supplies the
  one input no local check can — whether they were expecting this at all.
- **Not that any number here is measured.** The batch interval, the round bound,
  the instability counter, the window sizes and every rate in §12 are **reasoned,
  not measured**. V2 is where that changes.
- **Not that the two Claudes will agree.** The design's success condition is that
  they converge or escalate cleanly, not that they always converge.
- **Not that this is an access-control system.** Claims stay advisory leases,
  never locks `[P§5]`; the branch model adds no exclusion mechanism; nothing here
  prevents two people editing one file `[SEC§1.2]`.

---

## 13. Relationship to the other documents

### 13.1 `PLAN.md`

**Keeps, and strengthens:** locked decision 4 — *"Repo files = lasting truth;
relay = live chatter"* `[PLAN Locked decisions 4]`. This plan does not change it;
it makes it **more** true by writing the repo layer automatically, and it makes
the second half of the sentence exhaustive rather than aspirational: after V1 the
relay carries **only** live chatter, because durability has stopped depending on
its retention (§4.3).

**Keeps:** the transport ladder and its swappable adapter (locked decision 2); the
form factor (locked decision 5); the hook and monitor architecture of `[PLAN§1]`
including *"no hook ever asserts idle"*; the acceptance register of `[PLAN§6]`,
which §11 follows; the release gate of `[PLAN§8]`, untouched.

**Amends one acceptance criterion** **[proposed]**: `[PLAN§6]`'s *"no
coordination-only commits"* becomes *"no coordination-only commits on a branch a
human works on"* (§4.3). That is a real change to a written criterion and it is
the one place this plan edits `PLAN.md`. Decision 3 settles that the tool now
commits and pushes below the floor; **that the criterion should be reworded
rather than retired is this plan's own suggestion**, so it is collected in §14
and ratified with the rest rather than assumed.

**Re-aims one milestone:** `[PLAN§5 M12(b)]` becomes V2 and runs after V1 instead
of after the knowledge layer (§10.2). Its content is unchanged; what it measures
grows.

### 13.2 `COBUILD-PLAN.md`

**Keeps:** §3 entire — S0 through S6, unchanged in content and in internal order
`[COBUILD-PLAN §3.7]`. §6.1's cut rules. §7's ideas-worth-stealing, in particular
*"an orchestrator without authority"* and *"enforce late, at a boundary the work
must pass through"* — the second of which this stage now has a second instance of:
the commit is that boundary for the secret scan (§4.2 item 1), and the lesson to
resist making the PreToolUse gate block stands `[COBUILD-PLAN §7 item 1]`.

**Supersedes:** §2.1's project order. Rung 1 (the knowledge layer) shipped at
`b6b3dca`; rung 2 (M12(b)) becomes V2 and is re-aimed; rung 3 (co-build) becomes a
dependency of V6 rather than the next project item. **Rung 4 is not touched by
this plan.**

**An observation about rung 4, not a decision about it.** The P2P transport
investigation's argument turned on retention windows and a two-person room with
nobody to replay from; after §4.3 the durable answer to *"what did I miss"* is a
`git fetch`, so that particular argument is weaker than when it was written.
Whether the rung survives, and what else it might now be worth, **is not decided
here** — decision 10 re-ordered the build (state branch → symbols → … → learning
records) and said nothing about `[COBUILD-PLAN §2.1]`'s rung 4, which is a
separate investigation item `[COBUILD-PLAN §2.1]`. Its two binding conditions
still apply if it is ever revisited, and nothing above depends on the answer.

**Keeps and re-uses:** §4's decision that co-build ships before delegation, and
the five arguments for it. This plan does not re-open that order; it adds that V6
depends on co-build's S0–S2, which strengthens argument 1 rather than weakening
it.

### 13.3 `COBUILD.md`

**Reuses, unchanged, as the seam machinery:** §2.1's consent-once criterion ·
§2.3's closed permission list · §2.4's never-authorizes list and the anti-creep
rule · §4.5's concurrent-revision comparator · §4.6's three local staleness
signals · §4.7's admission rule · §5.1's "ownership is already solved by claims" ·
§5.2's revision-is-a-question-with-a-default-answer, which is the single most
important thing this plan borrows · §5.3's `note.blocker` escape hatch ·
§5.4's derived-not-transmitted abandonment · §7.1's body schema · §7.2's
receiver-side authorization · §7.3's rendering discipline and budget arithmetic ·
§11's Appendix B rows E1–E3, which V6 depends on and does not modify.

**Changes exactly one thing:** §5's cut of *"a per-revision `note` explaining what
changed"* is re-opened, bounded to contested seams, at ≤ 280 chars, read-only,
proposal-affecting and never build-affecting (§6.5). `COBUILD.md` §5's cut list
gains that bounded exception at V6 so the two documents cannot contradict each
other.

**Extends, without amending:** §4.4's generate-your-own-stub discipline keeps its
force, and its residual drift risk shrinks because the peer's implementation is
now fetchable (§4.3).

### 13.4 `DELEGATION.md`

**Supersedes:** §0 — *"An offer is delivered by the machine. It is accepted only
by a human."* Consent-once replaces per-offer consent. An offer becomes a
structured `task.offer` that the peer's client **may** accept autonomously, and
the permission to do so is one row of the §9 capability table — **off by
default**, granted per peer, revocable instantly. Three of §0's four controls
**survive unchanged** and are what make the supersession safe:

- **C-1 survives entire.** The peer's prose never enters the standing block; the
  block gains a count and a pointer. Nothing in this stage injects peer prose into
  a per-turn surface.
- **C-2 survives entire.** Arrival still has no side effects; what changes is that
  an *accept* may now be automatic where it is granted.
- **C-3 moves.** The `join`-shaped gate moves from per-offer to per-peer, at
  `handshake pair` (§9), which is precisely the *"consent-once is sound exactly
  when the grant is finite and displayable at grant time"* test `[COBUILD §2.1]`
  applied where the grant is enumerable — a closed list of event types — rather
  than where it is not, which is what made the per-offer gate right in the first
  place.
- **C-4 survives, narrowed.** B's Claude's permitted responses are unchanged
  except that "run `offer accept` only after B's own human says so" becomes "only
  where the capability was granted, and never on the strength of the offer's own
  `why` text."

**Keeps:** §2's adjudications; §4.2's body schema; §6.2's shard scan — **already
built**, generically, in the knowledge layer `[C lib/shard-scan.js:161]`
`[KNOWLEDGE §9.K1]`, so delegation asks it for `offer` / `offer_state` records and
adds nothing to it; §7's ownership and handoff sequencing; §9's absent-peer
timelines, with §4.3's correction that the durable half is now automatic;
Appendix C's C1–C3, still unratified and still a catalog amendment.

### 13.5 `KNOWLEDGE.md`

**Continues, unchanged.** K0–K2 shipped; K3–K6 are unaffected and may run in
parallel (§10.9). §2.2's rejection of a knowledge directory stands and is extended
to every record kind this stage adds — outcomes go on the shards for the same five
reasons. §3.2's hook-timing law — SessionStart is async and cannot inject, so it
writes and UserPromptSubmit injects, and the scan runs **before** the network sync
— is the law V8 obeys `[C hooks/hooks.json:9]` `[C hooks/session-start.js:64-80]`.
§7's token-cost register is the register §2.4 uses. §8's count format is the format
§2.1 and §2.2 use. §10.2's absent case is superseded in its conclusion, not in its
method: the durable path now answers where it previously depended on someone
having typed `handshake tasks` (§4.3, §11.5).

---

## 14. Proposed, not yet decided

Every choice this plan made that the discussion did not, collected so they can be
ratified in one pass. Nothing below is a decision of the owner's; each is the
plan's suggestion, marked where it appears.

| # | Item | Where | Suggested value |
|---|---|---|---|
| 1 | `handshake/state` is an **orphan** branch carrying only `.handshake/` | §4.3, §10.1 | orphan |
| 2 | Work-branch name shape | §4.1, §10.4 | `handshake/<member>/<subject_key>`, sanitized by `shardFileName`'s rule `[C lib/workspace-files.js:292-298]` |
| 3 | Commit-scan windowing | §4.2 item 1 | 2,048-byte windows, 256-byte overlap |
| 4 | CI branch filter | §4.2 item 4 | `branches-ignore: handshake/**` on `push` only |
| 5 | Verb name — the capability grant | §2.2, §9 | `handshake pair` |
| 6 | Verb name — the branch view | §2.2, §10.1 | `handshake branches` |
| 7 | Verb name — the contradiction view | §2.2, §10.6 | `handshake contested` |
| 8 | **V-D1** field name and shape | §2.3, §5.4 | `presence.update.head`, ≤ 64 hex, OPTIONAL |
| 9 | **V-D2** field name and shape | §2.3, §7.1 | `task.claim.symbols` / `task.change.symbols`, ≤ 16 × ≤ 120 chars, `path::Symbol.member` |
| 10 | **V-D3** field names and caps | §2.3, §6.2 | `task.seam.contested` (bool, `propose`); `task.seam.rationale` (≤ 280, `contract`) |
| 11 | Bounded rounds before escalation | §6.3 | **3** |
| 12 | Rebase instability bound before sequencing | §5.4, §12.3 | **3** `head` moves since the last clean rebase |
| 13 | New `SHARD_KINDS` entry for coordination outcomes | §8, §10.8 | `outcome` |
| 14 | Cut trigger — secret-scan false positives | §12.2 | > 1 legitimate commit refused in 200 |
| 15 | Cut trigger — escalation rate | §12.4 | > 1 per pair per working day |
| 16 | Cut trigger — outcome corpus too small for ranking | §12.6 | < 20 rows after V2 |
| 17 | §7.3's parser condition has **no threshold picked** | §7.3 | measure at V8, then decide |
| 18 | No untrimmable `COND` literal is added; the stack and symbol markers are trimmable details | §2.4 | reversible in one literal if V3/V5 measurement says otherwise |
| 19 | Each rung ships its own narrow typed opt-in; V7 generalizes them into one table | §9, §10.7 | as written — this resolves the apparent tension between decision 3's "opt-in at configuration" and decision 10's ordering of the trusted-pair rung sixth |
| 20 | **The initial default grant, per capability row** — decision 8 settles the *form* of the grant and no value | §9 | all granted **except** `task.offer`; every grantable row is the owner's to flip individually — the `note.*` row's `never grantable` value is §3's principle, not a default, and V7's test pins it |
| 21 | **Zero new event types** — decision 10 settles the preference for fields over types; that this stage needs *no* new type is the plan's finding | §2.3 | as written: three OPTIONAL fields, `[P§3]`'s closed-catalog `[F]` line untouched |
| 22 | Notice priority — four kinds into the 2-slot channel | §2.4 | push refused → escalated → rebase needed → round open |
| 23 | **Decision 4's `branch CI passing` fact is unavailable** (§4.2 item 4 skips CI on `handshake/*`); replaced by the rebase dry-run + successive `head` values | §5.4, §12.5 | as written — **plus an optional item: an opt-in lightweight per-branch job** (one runner, one OS, unit suite only), *not built here*, decided after V2 measures CI cost |
| 24 | **Resume-on-event is new local behaviour**, not a reuse of any existing rule | §5.4 | a sequenced task re-evaluates on the peer's `task.release` / `task.done` for that `subject_key`, and on nothing else |
| 25 | **Decision 5's four-part trigger is reduced**: symbol and contested-marking travel; values and diffs are derived locally | §6.2 | symbol rides `[COBUILD §7.1]`'s existing immutable `name`; no fourth field |
| 26 | **Amending `[PLAN§6]`'s acceptance criterion** rather than retiring it | §4.3, §13.1 | *"no coordination-only commits **on a branch a human works on**"* |
| 27 | Cut trigger — contradiction frequency too low to justify V6 | §12.6 | < 1 per pair per week at V2/V5 |
| 28 | **V9 and V10 added to the order** — decision 10's list ended at the learning records | §10.9 | red team + docs/release as the last two rungs, V9 a gate |

**Three things this plan could not establish, marked rather than asserted:**

- **The four trigger rates of items 14–16 and 27, and item 17's threshold, are
  [unknown — needs verification].** There is no data on this project for any of
  them, and V2 is the first place there can be. Ratifying them means ratifying
  *"measure this, then decide"*, not the numbers.
- **Whether a work branch needs its own CI at all (item 23) is
  [unknown — needs verification].** The plan asserts that a clean rebase dry-run
  plus successive `head` values answer *"is this stable enough to build on"*;
  nothing here demonstrates that they do, and nothing here answers *"does the
  peer's half pass its own tests"* — by design, since a work branch is
  advertised as broken-allowed (§4.1). V2 and V5 are where a stacked Claude
  either does or does not get stuck on breakage the skipped suite would have
  caught.
- **Whether a 2,048-byte window with a 256-byte overlap (item 3) actually catches
  a credential split across a hunk boundary is [unknown — needs verification]**;
  it is reasoned from `MAX_BYTES` `[C lib/filter.js:22]` and the 12-char tripwire
  window `[C lib/filter.js:24]`, and V4's test either demonstrates it or records
  honestly that it does not.

Everything else pinned in this document was opened at `b6b3dca` during this pass.
