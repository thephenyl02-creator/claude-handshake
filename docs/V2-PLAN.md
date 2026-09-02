# claude-handshake — v2 build plan: autonomous collaboration between two owned Claudes

**Status: BUILD PLAN. Nothing here is built. Nothing here is ratified.**
**Protocol version integer stays `1`. Every wire change below is a PROPOSED
Appendix B v1.1 delta awaiting Fenil's ratification; none is taken as given.**
**Date: 2026-09-02. Written against HEAD `b6b3dca`, tree clean.**
**Revised 2026-09-02 against the adversarial review at `9e810b0`; owner rulings
D1 and D2 of 2026-09-02 folded in as settled. §15 is the revision record, one
row per finding.**

Markers follow the house convention: `[P§n]` = PROTOCOL.md section n,
`[SEC§n]` = SECURITY.md section n, `[PLAN§n]` = PLAN.md section n,
`[COBUILD §n]`, `[COBUILD-PLAN §n]`, `[DELEGATION §n]`, `[KNOWLEDGE §n]` for
those documents, `[C file:line]` = value as implemented and opened at `b6b3dca`
during this pass. Every `[C]` marker was read at its line this session. Every
`[C]` marker **added or retargeted in the revision, in either fix round, or in
fix round 3** was re-opened at `9e810b0`, whose tree differs from `b6b3dca` in
this file and no other, so the two
baselines name the same lines in every file cited here. **Every git behaviour
stated as verified in fix round 3 was run at git 2.53 in a scratch repository,
and every byte figure was run through this tree's own `canonicalJson`
`[C lib/envelope.js:98]`** — §12.7's measured-exceptions bullet keeps the
list. Choices
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
decision, on the owner's instruction, and §6.5 says which and bounds it. It also
**requires content changes in `SECURITY.md`**, which the first draft left out of
the register: §13.6 names them and the rung that makes them.

**Two owner rulings of 2026-09-02 are folded in as settled, not as proposals**,
and both are additions to decision 3 (the floor) and decision 4 (the conflict
model), leaving the rest of the decisions brief unchanged:

- **D1 — lease-protected force-push on the Claude's own work branches is below
  the floor.** A stack rebase rewrites already-pushed commits, so the only way to
  keep the live view live is `push --force-with-lease`, restricted to
  `handshake/<self>/*`, never bare `--force` and never any other ref. §4.1 has
  the floor-table row, §4.1's three implementation rules ship with it, and §5.4's
  "it is below the floor" sentence now says *why* it is.
- **D2 — the automated push is private-repo-only by default; the scanner covers
  everything or refuses; the residual is stated.** §4.2 items 2 and 3 carry the
  default and the typed override, §4.2 item 1 carries the coverage rule, and
  §12.7 carries the residual.

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
capability screen, once, at configuration · a refusal — either the commit secret
scan blocking a push (§4.2 item 1) or the private-repo default refusing the
automated push path outright (§4.2 item 2, ruling D2), which are two causes of
one surface and not two surfaces. **Two of those four are met once or only at a
refusal**, which is
the cheapest place to meet a concept `[COBUILD-PLAN §6.1]`. The branch names are
the exception and they are met constantly, which is why §12.1 treats
autonomous-push noise as the first risk rather than the last.

**The revision added no seventh concept, and the two places it nearly did are
named here so the count is checkable rather than asserted.** The untrusted
peer-tree control (§4.2 item 5) is a *guardrail* on an existing concept — it
constrains the stack, it is not a thing the user meets or reasons about — and
the lease-protected force-push (ruling D1) is a *row in the floor table*, not a
mechanism: it changes which git verb the stack is allowed to run and nothing
about what the stack is.

**Fix round 3 added no concept and no user-met surface either, and the three
places it nearly did are named here for the same reason.** The PR-open push
suspension (§4.2 item 4), the git-version gate on stacking (§5.4 mechanism 2)
and the private-repo default (§4.2 item 2, ruling D2) are all **the same one of
the four surfaces above — a refusal** — reported on the same `status` line in
the same register. Three causes, one surface, and the count stays four.

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

**Two PROPOSED OPTIONAL body-field deltas on existing types** (the first draft
proposed three; the revision withdrew one — see the carriage finding below), each
a v1.1 Appendix B delta on `[P§3.2]` and neither touching an `[F]`-marked row.
V-D3 is one delta carrying two fields, as it was in the first draft:

| # | Delta | Where | Status |
|---|---|---|---|
| ~~**V-D1**~~ | ~~`presence.update.head`~~ — **WITHDRAWN at the revision.** `presence.update` is not an envelope on the relay: it is a fixed column set `(member_id, state, note, branch, machine, session, updated_at)` behind `POST /ws/:id/heartbeat` `[C docs/PROTOCOL.md:262-275]` `[C relay/src/do/workspace.js:96-98,428-435]`, and an envelope of that type is refused with `envelope_type_not_carried` `[C relay/src/lib/envelope.js:22-26]` `[C relay/src/do/workspace.js:595-597]`. The field could not travel on the tier §11 runs first. **The branch head is derived locally instead** (§5.4). | — | withdrawn |
| **V-D2** | `task.claim.symbols` / `task.change.symbols` — **≤ 8 entries × ≤ 100 chars** `[proposed, lowered at the revision]`, `path::Symbol.member` form, model-declared, never parsed (§7). **Carriage rule, stated because the relay decides it:** on ntfy `task.claim` is an envelope and carries the field; on the relay `task.claim` is the claim endpoint's fixed column set `(subject_key, subject, owner, acquired_at, renewed_at, ttl, files)` `[C relay/src/do/workspace.js:101-104,531-535]`, so there the authoritative carrier is **`task.change` with `change: "scope"`**, which *is* envelope-carried `[C docs/PROTOCOL.md:266]` and which the client already posts on the heartbeat path `[C monitors/heartbeat.js:217-227]`. | `[P§3.2]` task.claim, task.change | **[proposed]** |
| **V-D3** | `task.seam.contested` (boolean, `propose`) and `task.seam.rationale` (≤ 280 chars, `contract`) — the contradiction protocol's two additions to COBUILD's own schema `[COBUILD §7.1]`, which is itself unratified. `task.seam` is envelope-carried on both legs, so no carriage clause is needed. | `[COBUILD §11 E2]` | **[proposed]**, and dependent on E1–E3 being ratified first |

**Why V-D2's per-entry cap came down.** 16 × 120 is 1,920 characters of symbols
alone against a 2,048-byte body cap enforced identically on both sides —
**client-side `MAX_BODY_BYTES`, thrown by `build()` and refused by `validate()`**
`[C lib/envelope.js:18,316]`, and the relay's own copy of the same number
`[C relay/src/lib/envelope.js:10]` — which leaves no room for the `subject` and
`subject_key` the same body MUST carry `[P§3.2]`. **Run through the real
canonicalizer**, 8 × 100 is **825 bytes as a bare array and 835 as a
`"symbols":` member**, and the whole thing is checkable rather than estimated:
a maximal `task.claim` body — `subject` 200, `subject_key` 200, `ttl`,
`acquired_at` and eight 100-char symbols — canonicalizes to **1,319 of 2,048**.
The protocol's per-field caps are upper bounds rather than budgets — `files` at
≤ 64 × ≤ 300 busts the same cap far more acutely today `[C docs/PROTOCOL.md:312]`
— so this is a right-sizing, not a new rule, and the failure it avoids is loud,
caught and atomic rather than silent.

**Fix round 3: the pin was wrong and the byte figure was wrong.** The client
half of the cap was pinned at `[C lib/filter.js:22]`, which is `check()`'s
per-**string** input cap, consumed at `[C lib/filter.js:255]` to return a
`size-cap` finding — not the body cap at all, and the same constant §14 item 3
withdraws from the scan path for being irrelevant there. `COBUILD` already pins
this correctly `[COBUILD §4.2]` `[C lib/envelope.js:18,316]`. And *824* was an
estimate presented in the register of a measurement; the measured values are
above.

**And V-D3's arithmetic, which the revision performed for V-D2 and skipped
here.** `contract` is the one body `[COBUILD §4.2]` singles out as byte-cap-bound
and refuse-rather-than-truncate, so a new field on it is a capacity change and
must be priced. Measured on `[COBUILD §7.1]`'s own schema: a maximal ASCII
`contract` body — `seam_id` 18, `state`, `to` 64, `rev`, `hash` 64, `text` 1200 —
is **1,415 bytes**, and a maximal 280-char `rationale` takes it to **1,710 of
2,048**. The field costs **295 bytes**, which is **45% of the remaining slack**,
and the residual budget for `text` falls from **1,833 to 1,538 bytes** — roughly
**916 → 769** usable two-byte characters, or **611 → 512** three-byte, against
the unchanged 1,200-character field cap. On the ntfy leg the wire grows by a
measured **393 bytes**, taking `[COBUILD §4.2]`'s measured 2,244 to roughly
2,640 of the 4,096 cap `[C lib/transport-ntfy.js:33,118-121]`, so that leg still
does not bind.

**The consequence, and the instruction it changes.** Nothing breaks for ASCII —
1,710 of 2,048 leaves 338 spare. What changes is the non-ASCII band: a CJK or
accented contract of roughly 770–916 two-byte characters fits today and is
**refused** after V-D3, and `build()` refuses rather than truncates
`[C lib/envelope.js:316]`. `[COBUILD §4.2]`'s remedy — *catch it and tell the
human to shorten the contract* — is then the **wrong instruction**, because the
295 bytes may have been spent by a field the model wrote and the human never
saw. **So V6's CLI refusal MUST name which field pushed the body over**, and
offer to drop the `rationale` before it asks the human to cut their own contract
text **[proposed]**. This is what ratifying §14 item 10 ratifies.

#### The carriage finding, and the choice it forced **[proposed]**

**The relay is not a message bus for these two facts, and the first draft assumed
it was.** `[P§3.1]` is frozen: presence and claims are *server state* on the
relay, reached through their own endpoints, and an envelope of either type is
refused server-side `[C docs/PROTOCOL.md:262-275]`
`[C relay/src/lib/envelope.js:22-26]`. Both tables are fixed column sets and
unknown keys are dropped, never stored and never returned in `sync`
`[C relay/src/do/workspace.js:96-98,101-104]`. So `presence.update.head` and
`task.claim.symbols` were, as written, fields that could not reach a relay peer
at all — on the tier §11 runs first and §4.3 promotes to primary.

**The two ways out, with the real trade.**

- **(a) One new event type** — `task.branch`, carrying `branch` + `head` + an
  optional `symbols`. It costs the *relay* nothing: the relay accepts any type
  matching its type regex on purpose, stores the whole envelope verbatim, and
  returns it in `sync` — *"forward compatibility lives at the transport,
  semantics live at the client"* `[C docs/PROTOCOL.md:230-233]`
  `[C relay/src/lib/envelope.js:14,24-26]`. It costs one Appendix B row and one
  line in `TYPES` `[C lib/envelope.js:41-45]`. **What it really costs is the
  closed-catalog `[F]` line** `[C docs/PROTOCOL.md:228-229]`: it would be the
  third amendment to that one sentence in one wave, beside `[COBUILD §11 E1]`
  and `[DELEGATION Appendix C C1]`.
- **(b) Re-base on what the relay already carries** — put `symbols` on
  `task.change{scope}`, which is envelope-carried `[C docs/PROTOCOL.md:266]`, and
  derive branch-moved locally with `git ls-remote` against the `branch` the
  presence body *already* carries on both legs `[C docs/PROTOCOL.md:295]`
  `[C relay/src/do/workspace.js:97,435]`. Zero new types, zero relay work, one
  fewer proposed field.

**Picked: (b).** Three reasons, in order of weight. It leaves the closed-catalog
`[F]` line untouched, which is what decision 10's *"prefer state fields over new
types"* asks for and what keeps this wave at two amendments rather than three. It
costs the relay nothing at all, so `[P§9.2]` stays on the not-amended list below
rather than acquiring a schema migration, a `#heartbeat`/`#claim` change, a
version bump and a redeploy across self-hosted relays with no negotiation story.
And it makes the branch head **a fact read from the remote instead of a fact
asserted by the peer**, which is the rule §5.4 already applies to every other
deciding input — a peer cannot move a head it does not control, and with
`ls-remote` it cannot claim one either.

**What (b) costs, stated rather than reported as free.** One `git ls-remote` per
peer work branch per poll instead of a free field on a heartbeat that was going
out anyway: a network round trip, budgeted in §2.5, taken only for a peer that
declared a `branch` and only while a stack candidate exists. The branch-moved
signal therefore arrives on the poll's clock rather than at the instant of the
peer's push.

**And the symbols degrade on both legs, not one — the first revision stated the
relay half and left the ntfy half to be discovered.** On the **relay**, a
`task.change{scope}` envelope can be evicted by retention (7 days / 500 messages,
`[P§9.2]` `[C relay/src/lib/config.js:8-9]`) while the claim it describes is
still live, so a peer joining late sees a claim whose symbols are gone. On
**ntfy**, past the ~12 h message cache `[P§9.3]` a peer's claim set is not read
from envelopes at all: it is **resurrected** from `presence.update.claims[]`,
whose entry shape is `{subject, subject_key, acquired_at, ttl}` and is marked
`[F]` `[C docs/PROTOCOL.md:298]`, copied through verbatim
`[C lib/transport-ntfy.js:308-317]`. So the ntfy degrade is **permanent by
design rather than a retention window** — the field that would carry symbols
through a resurrection is on a frozen row, and widening it is the amendment
§2.3 spends its whole argument avoiding. `[C hooks/sync.js:89-92]` already
documents exactly this shape for `files`, which is why `mergeClaimFiles` exists
at all (§7.1). Both legs degrade to exactly the control run §11.1 already
specifies — the same gate verdict, a vaguer line — and both are stated here
rather than discovered. The asymmetry is the window and the permanence, not the
mechanism: the relay's claim projection is equally a fixed column set
`[C relay/src/do/workspace.js:101-104]`, so neither channel can be widened
without the schema work option (a) was rejected for.

**Why a field is genuinely cheaper than a type here, verified rather than
asserted.** `validate()` checks envelope structure, sizes, signature inputs and
freshness and **enumerates no body field at all**
`[C lib/envelope.js:365-414]`; type membership is checked separately and an
unknown type is a discard-and-count `[C lib/envelope.js:430-433]`. So a v1.0 peer
receiving V-D2 or V-D3 **accepts the message, uses the fields it knows and
ignores the one it does not** — it keeps working with reduced information, where
a new type would give it nothing at all. **The revision re-tested this argument
against the relay and it does not hold there**, which is the carriage finding
above: the degrade-gracefully property is real on the ntfy leg and on
envelope-carried types, and it is exactly zero on a type the relay projects
through fixed columns. Both surviving deltas ride envelope-carried types, so the
argument applies to both as stated. And the new fields are filtered by
construction: `structuralFields` walks every string in every body to **depth 4,
with arrays capped at 64 entries** `[C lib/envelope.js:270,273]` — which covers
both proposed fields, neither of which is deeper than 2 or longer than 8
entries — and hands the result to `sendGate`
`[C lib/envelope.js:284-288]` `[C lib/outbound.js:23]`, so a field nobody
remembered to enumerate is still gated `[SEC§4]`.

**Not amended by this plan**, stated where a future reader will look: §2.1–2.4
envelope, canonical serialization, signing, ntfy encryption · §3 the closed
catalog `[F]` · §3.1 carriage · §4.2 the presence enum · §5.1 normalization ·
§5.2 the overlap floor · **§5.4 the tiebreak** — this plan's §5.1 re-states what
it is for and changes nothing, so `[C docs/PROTOCOL.md:1033]`'s MUST-NOT is not
engaged · §5.3 TTLs · §6.1–6.4 fetch, injection, watermark, cursors · **§9.2
relay endpoints and schema — and this one is a *result*, not an assumption**: it
survives only because the carriage finding above chose option (b), and option (a)
or the first draft's V-D1 would each have taken it off this list · §10.3
offline-queue expiry ·
`isPriorityType` on client and relay `[C lib/envelope.js:53-55]` ·
`RELAY_NON_CARRIED_TYPES` `[C lib/envelope.js:49-51]` · the 206-char standing
framing `[C hooks/render.js:38,50-54]`.

**§8, the hook cadence contract, was on that list in the first draft and comes
off it as a caveat rather than an amendment.** V1 puts a git commit and a
network push on paths §8 budgets, and a plan that adds work to a budgeted hook
while listing that budget as untouched is asserting something it has not
checked. **The budgets themselves are not amended and no number in §8 moves.**
What the revision adds is the mechanism that makes that true: the push runs
inside the deadline `hooks/stop.js` already computes and already hands to the
beat, so it competes with the presence post for one 9,500 ms watchdog rather
than extending it `[C hooks/stop.js:57-61,163]` `[C monitors/heartbeat.js:203-213]`.
§2.5 states the ordering and the per-beat split; §10.1 makes SessionEnd, not
Stop, the last-batch flush.

### 2.4 Token cost per new surface

In the register of `[KNOWLEDGE §7]`: **designed budgets with the arithmetic
shown, not measurements.** Nothing here is built, and §10's V3 and V5 carry a
re-measurement gate the way `[COBUILD-PLAN §3.S0]` does.

| Surface | Vehicle | Per-turn chars | ~Tokens | Frequency |
|---|---|---|---|---|
| declared symbols on a claim — **the discriminating tail only** (§7.1) | a `details[]` entry, fed from the **cached claim row** and not from the envelope (§7.1) | ≤ 22 (`, ` + ≤ 20), **trimmable** | ~6 | every turn a symbol-scoped claim renders |
| the stack marker | a second `details[]` entry | ≤ 22, **trimmable** | ~6 | only while stacked |
| four new notice kinds — push refused · escalated · rebase needed · round open — into a channel that **already has three producers** | the existing notices channel, 2 × 96, **now sorted by rank** | ≤ 2 × 98, dropped at the last rung | ~50 | only while the condition holds |
| the notices `+N` overflow marker | the same channel | ≤ 4 (`+5 !`) | ~2 | only when more than two notices are live |
| **`skills/handshake-coordination/SKILL.md`** — the row the first draft's vehicle column could not see (M40 below) | the skill file, loaded whole when the skill engages | **0 per-turn**; **+35 to +60 lines per engaged session**, against a 410-line baseline | **+500 to +850 per engaged session** | every session in which the skill engages |
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
cost **wall time**, and **§2.5 below is where that is priced.** The first draft
pointed at §12.5 for it; §12.5 is CI cost and contains no hook or monitor
timing, so the pointer was dangling and the budget did not exist. It does now.

#### The SKILL.md row, and the ceiling that gates every rung

**The first draft's vehicle column could only see surfaces the render ladder
controls, and that made a real cost invisible.** `SKILL.md` is 410 lines and
~5,800 tokens, it loads **whole** whenever the skill engages, and **five rungs
edit it** — V3, V5, V6, V7 and V8 all list it in Touches. At the file's own
density (§3 spends 110 lines on three cases), the topics this stage adds —
symbol authoring, the stack-vs-sequence tree with its five-row fact table and its
instability counter, contradiction revision discipline, eight-row capability
semantics, outcome records, three CLI rows and the notice literals — would run to
200–260 new lines, i.e. **+2,800 to +3,600 tokens per engaged session**. That
delta alone is more than ten times the entire on-demand budget the table above
does price. It cannot be left out of the accounting because it does not ride a
`details[]` slot.

**So: a per-rung budget, and a hard ceiling that gates the rung** **[proposed]**:

| Rung | New lines in `SKILL.md` proper | Running total, from 410 |
|---|---|---|
| V3 declared symbols | ≤ 12 | ≤ 422 |
| V5 stack / sequence | ≤ 16 | ≤ 438 |
| V6 contradictions | ≤ 14 | ≤ 452 |
| V7 the trusted pair | ≤ 10 | ≤ 462 |
| V8 outcome records | ≤ 8 | ≤ 470 |
| **Ceiling** | — | **480 lines** |

**No rung ships if `SKILL.md` crosses 480 lines.** It is a gate in
`[COBUILD-PLAN §3.S0]`'s sense — a number checked before the rung is called done
— not a note, and it is the same discipline §2.4 applies to the 600-char block.

**The mechanism that makes those numbers reachable already exists in this
skill**: `references/`, which today holds `standing-block.md`
`[C skills/handshake-coordination/references/standing-block.md:103-109]`.
**The stack-vs-sequence tree, the contradiction revision discipline and the
capability semantics go into `references/` files**; `SKILL.md` proper keeps only
the **trigger conditions** — when to look, and which file to open — which is what
progressive disclosure is for and is why the reference directory was created.
The CLI rows go in the existing table `[C skills/handshake-coordination/SKILL.md:386-401]`,
which costs one line each.

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
  `[C hooks/render.js:138]`, and the whole array is dropped at ladder rung 3,
  `push({ dropDetails: true })` `[C hooks/render.js:253]`, **without adding a rung
  and without touching the frozen truncation order** — exactly the property
  `[COBUILD §7.3]` engineered for its rev detail.
  **What the 20-char cap does to a symbol, corrected at the revision.** It does
  not merely bound the slot: `escapeSlot` ellipsises at the cap
  `[C hooks/render.js:97-100]`, and a `path::Symbol.member` is long on the left,
  so `src/api/handler.ts::Handler.shape` renders as `src/api/handler.ts:…` — the
  symbol is always the part that is cut, and a claim that says nothing but the
  file path is what the card already says on the claims line. **So the card
  renders the discriminating tail: the last `::` segment, `Handler.shape`**, and
  the path is dropped because the claim's own `files[]` and the gate line already
  carry it. The full `path::Symbol.member` is printed by the **PreToolUse gate
  line**, which has no 600-char budget competing with it
  `[C hooks/pre-tool-use.js:24-27,89-106]` and which is where §5.3's second fact
  actually lands. **[proposed]**
- The notices ride the existing 2 × 96 notices channel
  `[C hooks/render.js:186-188]`, regenerated from state every turn and therefore
  never consumed by the watermark, unlike a digest item which appears exactly once
  `[P§6.3]`; they are dropped at the very last rung
  `[C hooks/render.js:262]`.
  **The channel already has three producers, and the first draft's four-into-two
  ordering did not know about them.** `hooks/common.js` pushes one unbounded
  conflict notice per colliding claim and **seeds the array with them first**
  `[C hooks/common.js:594-614,668]`, then appends the rotation demand or the
  private-repo guard line `[C hooks/common.js:669-673]`; the renderer then takes
  a bare `.slice(0, 2)` with no rank at all `[C hooks/render.js:187]`. So one
  tiebreak conflict plus a rotation demand fills the channel **today**, before
  this stage adds anything, and a four-kind order that ignores that would let a
  `round open` notice — the one this plan itself ranks last, because it is
  recoverable in full from `handshake contested` — evict a rotation demand, which
  is recoverable from nothing.
  **So the order is a total order over all seven kinds, safety pinned on top,
  and the bare slice is replaced by a sort on that rank** **[proposed]**:
  **(1) rotation demand** `[C hooks/common.js:670]` · **(2) private-repo guard**
  `[C hooks/common.js:672]` · **(3) push refused** (the secret scan blocked a
  commit; nothing else in the block says the work is invisible and only a human
  can clear it) · **(4) escalated** (the system asking, §6.4, and the one notice
  addressed to the human rather than to the model) · **(5) conflict** (the §5.4
  tiebreak verdict, which the model can execute from the block alone) ·
  **(6) rebase needed** (the model can act on it this turn) · **(7) round open**
  (recoverable in full from `handshake contested`, so it is the first to lose its
  slot). Ranks 1 and 2 are existing producers whose relative order does not
  change; the four new kinds slot in below them.
- **The channel gets a `+N` overflow marker, because two notices can vanish
  today with no trace.** `.slice(0, 2)` `[C hooks/render.js:187]` is the one
  truncation in the block that does not say it truncated. Both neighbouring
  slots got markers for exactly this reason — `+N peers`, `+N claims`, and
  `plans()`'s own comment that silently dropping them would be the *"reported a
  truncated read as an empty one"* failure `[C hooks/render.js:229-234]`
  `[P§10.2]`. The literal is `+N !` **[proposed]**, about 4 characters, inside
  the 11 chars of headroom computed below, and the recovery story of the whole
  notices design — *"recoverable in full from `handshake contested`"* — depends
  on the model knowing there is something to recover. It is priced in the V3
  re-measurement gate (§10.3) beside the details entries, and it exists because
  the rank order above creates the eviction.
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
number. Slack: 11 chars. **The `+N !` marker spends up to 4 of those 11**, and
only in a render that already carries two notices. It does not touch the
0-untrimmable-chars floor above: it lives inside the notices channel and is
dropped with it at `push({ dropNotices: true })`, the ladder's final entry
`[C hooks/render.js:262]`. Four characters bought against a silent truncation is
the trade `[P§10.2]` settles the same way everywhere else.

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

### 2.5 The wall-clock budget for the new plumbing

§2.4's *"0 tokens"* row is true and it is the wrong unit for the git work. This
section is the right one, and it exists because the first draft promised it and
pointed at §12.5, which prices CI minutes and contains no hook or monitor timing
at all. **Everything below is a designed budget, in this document's own
register: reasoned, not measured, and V2 is where that changes.**

**The one measured number that shapes it.** The commit scan as the first draft
specified it re-walked the project and re-read up to 40 secret files on *every
window*: `tripwireFindings` calls `defaultSecretFiles(opts.projectDir)` per call
`[C lib/filter.js:226-227]`, and that is a depth-3 `readdirSync` walk
`[C lib/filter.js:207-224]`. Over the 73 windows of `bin/handshake.js` that is
651 ms with the tripwire live against 73 ms without, of which 407 ms is one
uncached directory walk repeated. **The fix is one line and it is a
requirement, not an optimisation: harvest the corpus once per scan and pass it
through the existing `opts.secretFiles` override** `[C lib/filter.js:227]`,
which the API was already built to accept — worth roughly 8×.

**The per-beat split** **[proposed]**, ordered, because the order decides what
survives a truncation — followed by the bounded git calls that are **not on the
commit path**, listed here because a bound that lives in no table is a bound
nobody checks. (*Fix round 3:* the classifier used to read *"not on the beat"*,
which fix round 2's own edits falsified twice in the rows below — on the
no-monitor fallback the `ls-remote` **is** on the beat. Not-on-the-commit-path is
the property those rows actually share, and it is the one each of them already
states.)

| Step | Bound | Why here |
|---|---|---|
| **0. fetch** — §10.1 rule 1's *fetch first, always*, and the re-fetch each rebuild attempt of rule 4 takes | **1,500 ms**, the same bound as the SessionStart fetch of the same ref, and **each rebuild's re-fetch takes its own slice of what is left** rather than a fresh 1,500 | **Added in fix round 3: it was missing, and the paragraph below asserted a closed count that did not include it.** It is a network call on the commit path, it rides `beat()`, and on the no-monitor fallback it therefore runs inside the Stop hook's 9,000 ms window `[C hooks/stop.js:57-61,163]`. Rule 2 forbids proceeding on a fetch error, so a step with nothing left defers the whole batch rather than committing on a stale parent |
| 1. scan | **1,500 ms** for the whole commit, corpus hoisted once | It is the gate. A commit that is not scanned is not made (§4.2 item 1) |
| 2. commit | **500 ms** | Local plumbing only: `write-tree` / `commit-tree` / `update-ref` (§10.1), no network |
| 3. push | **whatever is left of the caller's deadline**, and its own ceiling of 5,000 ms | The only network step after the gate, and the only one it is safe to lose |
| `ls-remote` for a peer's head (§5.4) | **2,000 ms**, and it is not on the commit path at all | It runs on the poll, not on the commit — but the poll is the monitor's *or* the Stop hook's when there is no monitor `[C hooks/stop.js:113,163]`, so it is bounded for a hook's clock rather than the monitor's, and on that path it takes its slice of the same threaded deadline as the push |
| the **SessionStart state-ref fetch** (§10.1's read half) | **1,500 ms**, and the **whole shard scan** is bounded at **500 ms** on that path. The option is `authorBudgetMs` in *shape* `[C lib/shard-scan.js:127,160]`, but it must be **widened to wrap every git call the scan makes on the ref path** — the per-shard `git show` reads as well as the author `git log`s **[proposed]**. Today it wraps only the author calls, by wrapping the runner `authorVerdicts` hands to `checkShardAuthors` `[C lib/shard-scan.js:128-142]`; the shard bodies are read in a separate loop the option never touches `[C lib/shard-scan.js:189-192]`, and on the ref path those reads are the scan's dominant cost, not a rounding error | It is not on the commit path either, but it *is* the one new network step on a hook a turn waits on, so it is budgeted here rather than left to a constant. `C.armSafety(9500)` `[C hooks/session-start.js:24]` is a hard `process.exit(0)` `[C hooks/common.js:63-74]`, and the sync below it already takes 7,000 ms `[C hooks/session-start.js:83]`: 1,500 + 500 + 7,000 leaves the same 500 ms margin `hooks/stop.js` computes for the same reason `[C hooks/stop.js:57-61]`. A fetch that exceeds the bound is **abandoned, not waited on** (§10.1) |
| the **peer-branch refspec fetch and the throwaway worktree** (§4.2 item 5, §5.4 mechanism 3) | fetch **5,000 ms**; `git worktree add` **5,000 ms**; both **off-hook only**, on the monitor's clock, and **skipped entirely when there is no monitor** | **Added in fix round 3.** `git worktree add` is a *checkout* of the peer's tree, not a ref operation, and it had no row anywhere — §12 priced no disk for the duplicated tree either, which the sentence after this table now does. It is off-hook by construction: V5's Touches put the poll on `monitors/heartbeat.js` and the worktree lifecycle on `lib/repo.js` (§10.5), and neither the worktree nor the `merge-tree` probe is hook work. Only the peer-head `ls-remote` rides the beat, which is what keeps `GIT_NETWORK_TIMEOUT_MS` off every hook path |

**The disk the worktree costs, priced rather than omitted.** A throwaway
worktree is a full second copy of the peer's tree under the plugin's 0700 state
directory `[C lib/state.js:75-82]`, so the peak cost is **one working-tree's
worth of disk per concurrent evaluation** — one, since nested stacks are not
permitted (§5.4) and one work branch is active per member (§10.4). It is
released by the sweep of §5.4 mechanism 3, and §4.2 item 5 states the two rules
that keep it small and reachable on Windows.

**The deadline is threaded, not invented.** `beat()` already takes an absolute
wall-clock `opts.deadline` and gives each spawn the smaller of its own timeout
and what is left — *"a spawn with nothing left is skipped rather than started in
order to be killed"* `[C monitors/heartbeat.js:196-213]` — and `hooks/stop.js`
already computes one from its 9,500 ms watchdog minus a 500 ms margin
`[C hooks/stop.js:57-61,163]`. The state-branch work takes the same parameter
from the same caller. **The ordering rule that follows from it, stated because
the existing code learned it the hard way:** the presence post is taken first and
the git work second `[C monitors/heartbeat.js:180-188]`, so on a slow transport
the thing that gets truncated is the push — which the deferred-retry arm of §4.1
already handles honestly — and never the heartbeat, which nothing refills.

**The separate timeout that is not `GIT_TIMEOUT_MS`.** `lib/repo.js` bounds
every git call at 5,000 ms by default `[C lib/repo.js:27,82-85]`, which is right
for `rev-parse` and wrong for `fetch`. Network git gets its own constant
**[proposed: `GIT_NETWORK_TIMEOUT_MS = 15000`]**, in the shape
`HISTORY_TIMEOUT_MS` already takes for the other slow call
`[C lib/repo.js:28,323-324]`. **It is for off-hook paths only — the monitor's own
clock and the CLI — and the qualifier matters, because the first draft's
"never on a path a *synchronous* hook waits on" would have licensed it on
SessionStart, which is asynchronous and still dies at 9,500 ms.** No hook path
takes this constant, async or not — and **the count is four, not three, and not
one.** **Four network git calls can run inside a hook**: the state-ref fetch on
SessionStart, and the **commit-path fetch** of §10.1 rule 1, the state-branch
push and the peer-head `ls-remote` — the last three all riding `beat()` when the
Stop hook is the no-monitor fallback `[C hooks/stop.js:163]`. Each takes its own
row above — 1,500 ms, 1,500 ms, 5,000 ms and 2,000 ms respectively, every one of
them sized against a hook watchdog rather than against a constant built for the
monitor's clock. *(Fix round 2 corrected this count from one to three and fix
round 3 from three to four: rule 1's own **fetch first, always** was a network
git call on the beat that the enumeration never named. A closed count is worth
having and worth re-checking whenever a rung adds a git call — which is why the
rows now carry the property rather than the tally.)*

**And what does *not* reach a hook, said in one clause because fix round 2's
`ls-remote` row is what put the question there.** On the no-monitor Stop-hook
path **only** the peer-head `ls-remote` rides the beat, at its 2,000 ms row. The
refspec fetch of the peer's branch, the throwaway worktree and the `merge-tree`
probe (§5.4 mechanisms 2 and 3) run **on the monitor's own clock and are skipped
entirely when there is no monitor** — a headless session simply does not stack,
and says so the way §10.1 already makes it say the batch rides the keepalive.
That is what keeps `GIT_NETWORK_TIMEOUT_MS` off every hook path, and without it
a 15,000 ms fetch would sit inside a 9,500 ms watchdog on every keepalive turn
`[C hooks/stop.js:57-61]` `[C hooks/common.js:63-74]`.

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

**What those four validations do not reach, said here because the first draft
left it to be inferred.** The signature, the envelope shape, the receiver-side
authorization and the closed enums all validate the **trigger**. None of them
validates a **payload** — and from V4 on, this design has payloads: a peer's work
branch is fetchable and its contents are arbitrary. **Fetched peer code is
untrusted data that can also execute**, and it is untrusted in both of the ways
this project already names: it is prompt injection if it lands in `CLAUDE.md` or
`.claude/**`, and it is code execution if it lands in a `package.json` script, a
lockfile, a `Makefile` or a workflow. `[SEC§5.4]` already draws this line for the
repo path — *"`.handshake/*` files read from disk are untrusted data, escaped
exactly like transport content. Without this, the git path bypasses transport
escaping entirely"* `[C docs/SECURITY.md:295-297]` — and §4.2 item 5 extends it
to the one git path that is new here. The word the first draft never used is used
here on purpose.

**The turn-scoping law, in one clause.** *Every autonomous behaviour in this
plan happens at a model turn; the only things on the monitor's own clock are the
state-branch batch, the presence beat it already carries, and the poll that reads
a peer branch's head.* Nothing in this design makes a Claude act between a
human's turns: a fetch, a rebase, a proposal, an adoption and a commit of code
are all things the model does when it is running, and the monitor's job is
narrower than that by construction, because a monitor writes nothing to stdout
`[C monitors/heartbeat.js:15-17]` and therefore cannot reach a model at all.
§11's *"no command is typed to cause coordination"* is scoped by this clause and
not weakened by it.

**And one place where the law is deliberately relaxed, named rather than
smuggled** **[proposed — §14 item 42; decision 2 is the owner's and a relaxation
of it is the owner's to ratify or refuse, so it is marked here rather than
asserted]**. A contradiction round is opened by the model's reading of a fetched
diff (§5.5, §6). That is the single point in this design where model judgement,
rather than a validated structured fact, opens a protocol step — and it is
allowed there for the reason decision 5 gives: a requirements contradiction is
not detectable by any structure the two sides share, because both diffs are
individually valid. **What judgement may do is open the round; it may not adopt.**
Adoption stays a structured, hashed, materialized revision (§6.1), so the
principle's operative half — *only an adopted fact changes code* — is untouched.

---

## 4. The floor

### 4.1 Below and above, decided (decision 3)

| **Below the floor — the Claudes act, no human asked** | **Above the floor — human only, always** |
|---|---|
| Coordination state committed and pushed to a dedicated `handshake/state` branch: author = the member, committer = the tool; per-member append-only files; batched ≤ 1/min; **fetch-first, adopt-never-create, rebuild-never-retry** (§10.1); deferred and retried while offline; **no remote ⇒ today's behaviour** (below) | Merging into any shared branch, or into `main` |
| Code commits and pushes on the Claude's **own** branches, `handshake/<member>/<subject>`, one per claim, **at most one of them active at a time** (§10.4) — **pushed freely, as a live view**: broken is allowed, leaked is not. **The commit takes only the paths on that claim's own `files[]`, and never moves `HEAD`** (§10.4) | Opening, updating or merging a pull request |
| **`push --force-with-lease` on `handshake/<self>/*` only** — ruling D1, 2026-09-02: a stack rebase rewrites commits this tool already published, so without this the live view freezes at the second feature built on it. Never bare `--force`, never any other ref pattern, and the lease value is the tool's own recorded head (three rules below) | Tags, releases, publishes |
| Reading, fetching and building against a peer's work branch (§5.4), **in a throwaway worktree, never the live tree** (§4.2 item 5) | Deploys of any kind |
| Opening, revising, adopting and ending a contradiction round within the granted capabilities (§6, §9) | Anything touching secrets: rotation, re-keying, credential files |
| Recording durable learnings and coordination outcomes (§8) | Destructive or irreversible operations: history rewrite on any ref the tool does not own, deletion of **any** branch including its own, `scrub`, and **bare `--force` (or `-f`) on any ref whatsoever** — the one exception is row 3's lease-protected push, which is never bare `--force` and never leaves `handshake/<self>/*` |

**Ruling D1, and why it does not open the floor it appears to open.** The floor's
purpose is that the tool never destroys history a human built on or a branch
people share. A `handshake/<self>/*` work branch is neither: it is advertised
unstable (this table's second row), only the tool writes it, and the lease
guarantees that if a human ever *did* push to one, the tool **refuses rather than
clobbers**. Merge-instead-of-rebase was considered and rejected: it rewrites
nothing, but it weakens the clean-rebase stability signal that §5.4 uses as the
substitute for the CI verdict guardrail 4 removes, and it leaves merge commits in
the eventual PR. **Three implementation rules ship with the carve-out:**

1. **The lease value is the tool's own recorded head, never the remote-tracking
   ref.** The tool records the exact sha it last pushed for that ref and passes
   `--force-with-lease=<ref>:<expected-sha>`. `--force-with-lease` with no value
   compares against the remote-tracking ref, which a background fetch — including
   the one V1 adds on the SessionStart path (§10.1) — can silently update, at
   which point the lease protects nothing.
   **And the missing-record case is fail-closed, stated because the record is a
   plain sentinel file that can be absent.** The recorded head lives beside the
   existing sentinels in the per-workspace state directory
   `[C hooks/common.js:26-50]` `[C lib/state.js:75-82]`, and a cleared state
   directory, a `scrub`, a new machine or a `HANDSHAKE_STATE_DIR` that differs
   between contexts all leave it absent. **No recorded sha for that ref, or a
   record that does not parse, means the force-push is REFUSED and a notice
   renders** — never a valueless lease (rule 1 forbids it), never bare `--force`
   (the above-the-floor cell forbids it), and **never a lease value read back
   from the remote**, which is the third move nothing else here forbids and
   which V5's own `ls-remote` helper (§10.5) puts one line
   away: a lease whose expected value is *whatever the remote currently has* can
   never fail, and reintroduces exactly the hole this rule exists to close. The
   client falls back to a plain push, which is refused as non-fast-forward, and
   the live view freezes with a notice saying so rather than clobbering. This
   carries no `[proposed]` marker and no §14 row: it is the fail-closed reading
   of the owner's own rule 1 in the posture §4.2 takes everywhere, and marking a
   fail-closed default as proposed would imply the owner could ratify a
   fail-open.
2. **A rewritten base is stack invalidation, not a retry.** A peer whose stacked
   base is rewritten re-fetches and re-evaluates; if the new base no longer
   contains the old one, it drops the stack and falls back to sequence with a
   notice (§5.4). This is the same rule that covers a **human** rewriting or
   deleting a base, which is why §5.4 states it once and both cases point at it.
3. **A test that the pattern is the control.** Force-push on any ref outside
   `handshake/<self>/*` is refused **with no git process spawned**, and bare
   `--force` is never emitted on any path (§10.4, §10.5).

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

### 4.2 The five required guardrails

Each is a gate on the automatic path, not a note. **The fifth was added at the
revision**: the first four all point outward, at what leaves this machine, and
none of them looked at what a fetched peer branch brings in.

1. **A fail-closed secret scan on every automated commit — its own caller, with
   a code-shaped battery.** This is the new guardrail decision 3 names, and it is
   the price of "push freely". Every automated commit, on either branch, is
   scanned before it is created, and a finding **refuses the commit** — nothing
   partial, nothing queued, one line to the author. It is fail-closed on its own
   failure, the posture `lib/filter.js` already takes: any internal error returns
   `ok:false` `[C lib/filter.js:269-271]` `[SEC§4]`.

   **The first draft got this wrong, and the correction is the reason this rung
   was re-designed rather than re-worded.** It said the scan runs
   `filter.check()` over overlapping 2,048-byte windows of each added hunk and
   *"reuses `lib/filter.js` unchanged"*. Measured against this repository's own
   tracked tree at `9e810b0`: **`secret-assignment` alone
   `[C lib/filter.js:44]` refuses 23 of 131 tracked files**, among them
   `bin/handshake.js`, `hooks/render.js` and `relay/src/do/workspace.js`, because
   its pattern is `\b(…|token|secret|auth)s?\b\s*[:=]\s*[A-Za-z0-9+/_.-]{12,}` and
   a line like `const tokens = learnedPathTokens(e.paths);` satisfies it. And
   `high-entropy-token` `[C lib/filter.js:107]` fires on the whitespace-stripped
   variant `variantsOf` always builds `[C lib/filter.js:149-150]`, because 2 KB of
   code with its whitespace removed is a long alphanumeric run that clears the
   4.4-bit floor. A fail-closed gate that refuses roughly three commits in four is
   not a gate, it is a stop, and it would have taken the live view, the peer
   fetch, stacking and all of V5 with it.

   **So the commit scanner is its own caller. It does not call `check()`, and it
   therefore does not inherit `MAX_BYTES`** `[C lib/filter.js:22,255]` — the
   2,048-byte refusal that forced the windowing in the first place is a property
   of `check()`'s contract, and a caller that does not use `check()` does not
   need windows. `check()`'s contract, `MAX_BYTES` and every existing regression
   test stay **exactly** where they are; this is a second caller of the same
   tables, not an edit to the first.

   **What the battery is.** Every entry in `PATTERNS`
   `[C lib/filter.js:27-56]` **except `secret-assignment`** — which is to say the
   branded and structural credential shapes: `private-key-block`
   `[C lib/filter.js:37]`, `conn-string-creds` `[C lib/filter.js:43]`, the
   provider prefixes, `branded-token` `[C lib/filter.js:49]`, and
   `HANDSHAKE_CREDENTIAL_SHAPES` entire `[C lib/secret-shapes.js:43-54]`, which is
   already spread into that table `[C lib/filter.js:55]` and is the one class
   whose leak is the whole workspace. Plus **the local-secret tripwire** — values
   ≥ 8 chars harvested from local secret files, compared with a 12-char sliding
   window `[C lib/filter.js:23-24,226-249]` — which is the only genuinely
   fail-closed control in the set and is the reason the exclusions below are
   affordable.

   **And the tripwire needs a needle filter of its own on the commit path,
   because the 66/0 run below never exercised it and its false-positive profile
   is much wider than §12.2 claimed** **[proposed — collected with the
   exclusions as §14 item 40]**. `tripwireFindings` returns `[]` the moment no
   secret file is found `[C lib/filter.js:228]`, and **nothing tracked in this
   repository matches `SECRET_FILE_RE`** `[C lib/filter.js:202]` — verified with
   `git ls-files` against that pattern at the revision, no matches — so the
   66-files/zero-findings run measured the **pattern battery alone**, and in a
   CI checkout it always will. Measured at fix round 3 against a fixture holding
   an ordinary Spring `application.yml` and a two-line `.npmrc`, both of which
   `SECRET_FILE_RE` admits: `readSecretValues` `[C lib/filter.js:157-197]`
   harvests **nine needles, of which two are credentials** — the other seven are
   `jdbc:mysql://localhost:3306/orders?useSSL=false`, `orders_app`,
   `com.mysql.cj.jdbc.Driver`, `org.hibernate.dialect.MySQL8Dialect`,
   `validate`, `/api/orders`, `order-service` and `https://registry.npmjs.org/`
   — and against those needles **six of eight ordinary code and prose samples
   are refused**: an `import` of the JPA dialect class, a `driverClassName`
   literal, a `package-lock.json` `resolved` URL, a controller route annotation,
   a JDBC URL in a test, and the English sentence *"We validate the input before
   sending."* That last one matters twice over: `validate` is exactly eight
   characters, so it clears the ≥ 8-char floor §12.2 names as the mitigation,
   and at ≤ the 12-char window it matches by plain substring rather than by
   window. **On a Spring or Rails tree the fail-closed commit gate would refuse
   most diffs from commit one — B1's failure returning through the door B1's fix
   opened.**

   **So the commit scanner filters the needle corpus before it uses it**, in
   `lib/commit-scan.js` and never in `lib/filter.js`, so `check()`'s message-path
   behaviour is untouched: **skip needles that are not value-shaped — a URL, a
   dotted identifier, a filesystem or route path — and cap needles per file**
   **[proposed]**. What is deliberately *not* narrowed is `readSecretValues`'s
   JSON walk, which exists for the one-line `{"secret":"…"}` shape the red team
   actually leaked `[C lib/filter.js:170-181]`; narrowing it to
   credential-looking keys would blunt the tripwire against its own founding
   case, and it is the wrong branch anyway — a `.yml` file has no `.json`
   extension and does not start with `[` or `{`, so it falls to the line scan
   `[C lib/filter.js:183-195]`, which is where the seven junk needles came from.

   **Four exclusions, each named with the false-positive class it removes**
   **[proposed — the exclusion set and the test's exclusion list are both choices,
   collected as §14 item 40]**.

   | Excluded | The false-positive class it removes | Measured, or the control that covers it |
   |---|---|---|
   | the **entropy pass** `[C lib/filter.js:77-111]` | any identifier, base64 asset, minified line or long hash in ordinary source; on the stripped variant, *any* 2 KB of code at all | the review's simulation: with the entropy pass dropped but `secret-assignment` kept, **13 of 39 commits were still refused** — so removing it is necessary and, on its own, nowhere near sufficient |
   | **`secret-assignment`** `[C lib/filter.js:44]` | any assignment whose left side contains `token`, `secret`, `auth`, `key`, `password` — the ordinary vocabulary of this codebase and of every codebase that has a credential in it | 23 of 131 tracked files |
   | the **whitespace-stripped variant** for the pattern battery `[C lib/filter.js:149-150]` | shapes that only form once the newlines are gone: a URL literal glued to a later `:` and `@` (`conn-string-creds`), a `"secret"` key glued to a value on the next line | it is retained **inside the tripwire**, which builds its own variants `[C lib/filter.js:232-234]`, so the deliberate whitespace-split evasion is still covered where the fail-closed control is |
   | **`env-block`** `[C lib/filter.js:50]` | three consecutive `UPPER=value` lines is what a `.env` file looks like and also what a shell script, a Makefile, a Dockerfile and a CI workflow look like | `installers/install.sh:38-40` — `MARKETPLACE_URL=` / `PLUGIN=` / `TARBALL_URL=`. The compensating control is the tripwire, which catches a real project `.env` **by value** rather than by shape |

   **The V4 test that makes this checkable rather than argued: scan this
   repository's own tracked tree and assert zero findings**, with an explicit,
   enumerated exclusion for the files whose job is to *state* credential shapes —
   `test/**`, `relay/test/**`, `e2e/**`, `docs/**`, `lib/filter.js` and
   `lib/secret-shapes.js`. That exclusion is not a fudge and the precedent is in
   this tree: `tokenInHistory` narrowed its own needles for exactly this reason,
   recording *"observed on this project's own repo: 24 false-positive commits"*
   `[C lib/repo.js:305-313]`. **Run at the revision, that is 66 files and zero
   findings.** The **nine** findings the exclusion removes are all real fixtures
   or definitions: four `aws-access-key` shapes, one each in `test/cli.test.js`,
   `test/envelope.test.js`, `test/state.test.js` and `test/workspace-files.test.js`;
   `private-key-block`, `conn-string-creds` and `branded-token` in
   `test/filter.test.js`; `github-token` in `test/learned.test.js`; and
   `conn-string-creds` matching `lib/filter.js`'s own doc comment. (The first
   revision said *seven* and listed eight; the run says nine, and the missing one
   was `conn-string-creds` in `test/filter.test.js`.)

   **A second V4 test, because the first one cannot see the tripwire.** The
   zero-findings run above proves the *pattern battery* is quiet on ordinary
   source and proves nothing at all about the tripwire, which is inert in this
   tree. So V4 also scans a **fixture** carrying an ordinary `application.yml`
   and an `.npmrc` and asserts that the six samples named above are **allowed**
   while a real value from the fixture is still **refused** — the needle filter
   pinned by the false-positive class it removes and by the true positive it
   must not lose, in the same shape as the four exclusions' own tests. Without
   it the needle filter is a paragraph and the first Spring repo is the test.

   **Ruling D2's coverage rule: the scanner covers everything or the path
   refuses.** Two consequences, both new at the revision. **(a) Commit messages
   and branch names go through the same battery** — they are short text, they are
   model-authored, and a subject line is exactly where a pasted credential goes
   when the diff is clean. **(b) Binaries and files that are not valid UTF-8
   cannot be scanned, so the automated path never commits them.** They are left
   in the working tree for a human commit, and `status` says so; this is
   fail-closed in the same direction as everything else here. (This repository
   tracks none today — 131 of 131 tracked files round-trip through UTF-8 — so the
   rule costs nothing to adopt and exists for the repositories that do.)

   Honest scope, in `[SEC§4]`'s own register: **a seatbelt against an accidental
   commit plus a closed tripwire for known local secrets, not a control against a
   motivated adversary**, and §12.2 prices the false positives against a scanner
   that can actually run.
2. **The public-repo guard, re-used unchanged — and widened by ruling D2 from
   the guarded part to the whole automated push path.** The guard is fail closed
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

   **Ruling D2, and it changes the default rather than adding a warning:
   AUTOMATED PUSH IS PRIVATE-REPO-ONLY.** The existing hard rule for the
   credential — private repos only; public ⇒ refuse — extends to the automated
   push path itself. **On a public or unproven-private verdict the automated push
   path stays OFF**, entirely: no state branch, no work branch, no push attempt,
   and `status` says so in the same register as the no-remote arm rather than
   reporting a queue. The reason it is the *whole* path and not just the guarded
   file is that the guard's own hard-fail condition is *"public verdict **and**
   guarded material tracked"* `[C lib/repo.js:384]`, so on a public repo with no
   tracked credential nothing fires at all today — while task subjects, file
   paths, declared symbols, learnings, coordination outcomes and unreviewed
   in-progress code would be published every minute. **A human may override with
   a typed confirmation that names the consequence** (item 3), and the override is
   **recorded** — in the pair state and on the `status` line — so it is auditable
   rather than a setting nobody remembers making. **The cost, stated: nothing on a
   private repo, which is the normal case; on a public repo a human must
   explicitly say the Claude may publish.**
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

   **Ruling D2's half of this gate: the screen prints the visibility verdict.**
   The gate prints the current guard verdict and its reason
   `[C lib/repo.js:36-48,172-189]` before anything else, and on a public or
   unproven-private verdict it prints **one sentence naming what would become
   world-readable** — task subjects, file paths, declared symbols, learnings,
   coordination outcomes and in-progress code — and then **refuses**, rather than
   asking. Enabling it anyway is a *distinct* second confirmation, typed, that
   names the consequence; it is not the same `y` that enables the feature on a
   private repo. Both the verdict at grant time and the override, if taken, are
   recorded.
4. **CI must skip `handshake/*` — enforced as a preflight precondition, not as a
   workflow edit.** Today this repository's workflow triggers on every push with
   no branch filter at all `[C .github/workflows/ci.yml:13-15]`, so a Claude
   pushing a live view every minute would start **four job runs** every minute:
   `test` fans out across `windows-latest` and `ubuntu-latest`
   `[C .github/workflows/ci.yml:18-24]` beside `installer-lint` and
   `installer-lint-windows` `[C .github/workflows/ci.yml:57,73]`, and Windows
   minutes bill at 2×. The fix is a `branches-ignore` on the `push` trigger
   **[proposed: `handshake/**`]**, with `pull_request` untouched, so the moment a
   human opens a PR from a work branch the full suite runs — which is the correct
   place for it, because a PR is above the floor.

   **But `pull_request` untouched leaves the same bill behind a second door, and
   fix round 3 is where that is said rather than discovered.** A bare
   `pull_request:` trigger — which is what this repository has
   `[C .github/workflows/ci.yml:13-15]` and what the snippet below hands the
   pair — defaults to `opened, synchronize, reopened`, and **`synchronize` fires
   on every push to the PR head branch**. The work branch is *"created on claim
   and pushed freely, as a live view"* (§4.1, §10.4) at the cadence this very
   item prices, and the PR head ref and the pushed ref are the **same ref**. So
   the moment a human opens a PR on a live claim — a draft PR on a branch this
   design advertises as a watchable live view is ordinary practice, and nothing
   here forbids it — the four job runs restart **every minute for as long as the
   PR is open**, behind a precondition that reports the cap as enforced.
   `branches` / `branches-ignore` on `pull_request` cannot close it either:
   those filter the **base** branch, and there is no head-branch filter.

   **So the guardrail gets a second half: the automated push stops for a work
   branch once a PR exists for it** **[proposed — §14 item 44]**. The verdict is
   read where the visibility verdict already is — `gh pr list --head <branch>`
   beside the `gh` call `[C lib/repo.js:36-48]` already makes, on the same 600 s
   TTL `[C lib/repo.js:25]`; on a hit the branch's automated push goes quiet and
   `status` says so, and the human's own pushes carry the work from there. That
   is the right direction on its own terms: opening a PR is above the floor
   (§4.1), so a branch under review has left the tool's half of the world
   anyway. Where `gh` is absent or unauthenticated the verdict is unproven, and
   unproven takes the same fail-closed arm the visibility verdict takes — the
   automated push stops. §12.5 states the case in its own numbers.

   **The first draft specified that as an edit to `.github/workflows/ci.yml` and
   listed it in V4's Touches, and that cannot be the guardrail.** The product runs
   in the *pair's* repository, where the plugin cannot write workflows — and
   writing one by git would itself be a push to a human branch, which §4.1 puts
   above the floor. The failure that leaves is not degraded coordination: it is an
   uncapped Actions bill and a saturated queue in a repository whose owner
   installed nothing, starting at the first opt-in.

   **So the guardrail is a precondition the V1 preflight enforces, in the pair's
   own repo, fail-closed in the same posture guardrail 2 already takes.** The
   preflight reads the repository's workflow files and requires **either** no
   push-triggered workflow at all **or** a `branches-ignore` (or an equivalent
   `branches` allowlist) that covers `handshake/**`. Until that holds it
   **refuses to enable the automated push**, and the refusal carries a
   copy-pasteable snippet:

   ```yaml
   on:
     push:
       branches-ignore:
         - 'handshake/**'
     pull_request:
   ```

   The two-line edit to *this* repository's own workflow moves to **V1** (§10.1),
   not V4: it costs nothing, it has no V4 dependency, and V2 runs the
   machine-cadence push — so leaving it at V4 would have run the two-human day
   without the filter that is supposed to make it affordable, while §12.1 already
   claimed that mitigation as live.

   **This guardrail costs decision 4 one of its three named stacking facts** —
   there is no branch CI verdict to read — and §5.4 says what replaces it and what
   that replacement does not buy; §12.5 prices the residual.
5. **Fetched peer content is untrusted data that can also execute.** This is the
   inbound guardrail, added at the revision, and it is the only one of the five
   that faces the other way. From V5 a Claude fetches a peer's work branch and
   rebases onto it (§5.4) under a capability that is granted by default (§9) — and
   a rebase is a checkout. After it, the peer's version of every touched file is
   in my tree: `CLAUDE.md`, `.claude/settings.json`, hooks, `package.json`
   scripts, lockfiles, CI workflows. That is prompt injection plus plausible code
   execution in one automatic step with no human turn, and §3's four validations
   all reach the trigger and none reaches the payload (§3). Four gates, of which
   the third is itself three rules after fix round 3:

   - **Fetch into a namespaced local ref, never onto a local branch and never
     into the live tree.** `refs/handshake/peers/<member>/<branch>` **[proposed]**,
     by explicit refspec, with `--` and a fully-qualified `refs/heads/...` source
     (§5.4 states the validation the branch string passes first).
   - **Evaluate in a throwaway worktree under the plugin's state directory**, not
     in the human's checkout — the 0700 per-workspace directory `lib/state.js`
     already owns `[C lib/state.js:75-82,86-89]`. The plan already knows the
     no-checkout technique and uses it for the state branch (§4.3); this is the
     same instinct applied where a checkout genuinely is needed.
     **Three mechanics added at fix round 3, because *"not in the human's
     checkout"* invites three assumptions that are false.** (i) **It is created
     last, not first.** The path rule below and the `merge-tree` probe (§5.4
     mechanism 2) are both checkout-free — a path rule reads
     `git diff --raw <base>..<peer-head>` and the probe is *"non-mutating, no
     worktree, no `HEAD` movement"* (§5.4) — and either can refuse the whole
     operation, so the worktree is created **only for a real rebase**, after
     both have passed. §11.2's narrative orders it worktree-first and is
     corrected there. (ii) **`git worktree add --no-checkout` plus a sparse
     checkout of the touched paths**, where a full tree is not needed. (iii)
     **`-c core.longpaths=true` on Windows**, on the `add` *and* on the removal
     of §5.4 mechanism 3: the plugin state root is
     `%USERPROFILE%\.claude\handshake\<32 hex>` `[C lib/state.js:58-65]`, so a
     repo with a deep tracked path fails the checkout with `Filename too long`
     against the 260-character default — and, verified at fix round 3 on
     git 2.53, `git worktree remove --force` fails the same way, so the sweep
     cannot clean up what the add left behind. Without the flag V5's inbound
     stacking silently does not happen on the owner's own platform for any repo
     with a deep tree. And **`git worktree add` writes into the human's
     `.git/worktrees/`**, so plugin scratch trees do appear in the human's own
     `git worktree list` — the human's *working tree* is untouched, their
     *repository* is not, and this bullet used to let a reader assume both.
   - **The automatic rebase runs only on an allowlist of path shapes, and
     refuses on anything else** **[proposed — §14 item 36, rewritten at fix
     round 3]**. The first revision wrote this as a **denylist** — `CLAUDE.md`,
     `.claude/**`, `.github/**`, `.handshake/**`, `package.json` scripts, any
     lockfile, `Makefile` — on the one surface where §4.3 argues for the
     opposite, in the same words this bullet needs: *"Allowlist, not denylist,
     on the path the tool writes without a human."* The list is also the one
     denylist among this plan's allowlists — the state branch's path allowlist
     (§14 item 1) and the work-branch commit's `files[]` filter (§10.4) — and it
     ages badly: not on it are `.husky/**` or any tracked `core.hooksPath`
     target, `.mcp.json` (Claude Code's project-scope MCP server file, at the
     repo root and outside `.claude/**`), a **non-root** `CLAUDE.md` or an
     `AGENTS.md`, `.vscode/**`, `.devcontainer/**`, `.envrc`, `.npmrc` and
     `.yarnrc.yml`, every non-GitHub forge file (`.gitlab-ci.yml`,
     `.circleci/**`, `Jenkinsfile`, `azure-pipelines.yml`, `.drone.yml`,
     `bitbucket-pipelines.yml`), and every build file that is not literally
     `Makefile` (`makefile`, `GNUmakefile`, `justfile`, `Taskfile.yml`,
     `CMakeLists.txt`, `build.gradle*`, `pom.xml`, `Cargo.toml` with a
     `build.rs`, `pyproject.toml`, `Dockerfile`, `compose.yaml`). By this plan's
     own threat model the first three of those are exactly *"my instruction
     files, my config and my build"*, and §12.7 claimed the guardrails removed
     the automatic path to them.
     **So the rule is inverted.** The automatic rebase proceeds **only** when
     every path in the peer's diff sits under a prefix **this side derived
     locally** — the directory prefixes of **my own** claim's progressive
     `files[]`, the observed list `hooks/post-tool-use.js` maintains
     `[C hooks/post-tool-use.js:79-91]` — and refuses on anything else, with a
     notice (rank 6, §2.4) and the human deciding. Locally derived is the
     load-bearing half: **the peer's own `files[]` is not an input**, because a
     malicious peer authors it, which is the same rule §5.4's fact table applies
     to every other input. Case (c) is the premise that we are both in the same
     files, so the peer's diff landing under my own prefixes is the *normal*
     case; a peer who ranges wider gets a notice, which is a degradation and not
     a breakage. This is fail-closed against surfaces nobody has thought of yet,
     which a list of seven can never be.
     **A mode rule beside it, because a path rule cannot see a mode change.**
     Refuse any peer diff that **introduces or modifies a symlink, a gitlink or
     an executable bit**, and compute it from **`git diff --raw`** rather than
     `--name-only`: verified at fix round 3 on git 2.53, swapping a regular file
     for a symlink on an ordinary source path yields `src/foo.js` under
     `--name-only` and `:100644 120000 … T src/foo.js` under `--raw`, so a
     name-only rule allows it and only the mode columns show it at all.
     `.gitmodules` and gitlink entries are covered by the same rule rather than
     by name.
     Both halves are still **path and mode facts computed from the diff
     locally**, so this stays a fact and not a judgement — and matching is
     defined rather than left to the reader: prefixes match **at a path
     boundary, at any depth, case-insensitively on the two platforms §11 runs
     on**, which is what the first revision's bare `CLAUDE.md` and `Makefile`
     beside `**` globs left undefined in a security rule.
     **And the withdrawn denylist survives as a floor the allowlist cannot
     open**, because the allowlist is derived from *my own* `files[]` and a pair
     building a plugin, a CI pipeline or a dotfiles repo has instruction and
     build paths **on its own claims**: the seven names the first revision listed
     — plus `.mcp.json`, any `CLAUDE.md` or `AGENTS.md` at any depth, and
     `.husky/**` — refuse the automatic rebase **even when the allowlist admits
     them**. Allowlist first, floor underneath: the allowlist is the general
     rule that ages well, and the floor is the short list of surfaces whose cost
     of being wrong is a session's whole context. §12.7 states what remains.
   - **No build, install or test command runs in a tree carrying unmerged peer
     commits without a human turn.** Not `npm ci`, not `npm test`, not a
     `postinstall`. A peer's lockfile plus an install is arbitrary code execution
     on this machine, and the whole point of the stack is that the peer's half is
     allowed to be broken.

   It is asserted in §11.6, it is in V9's red-team scope (§10.9), and §13.6 names
   what `SECURITY.md` must say about it.

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
branches it owns.** The `handshake/state` branch is proposed as an **orphan
branch** **[proposed]**, precisely so that this reversal cannot leak into
anyone's code history: an orphan branch shares no commit with `main`, never
appears in a `git log` of the user's work, and is read without a checkout via
`git show handshake/state:.handshake/tasks/<member>.md`. On the user's own
branches `[PLAN§6]`'s "no coordination-only commits" stays literally true.

**What it carries is an explicit path allowlist, not a directory.** The first
draft said *"carrying only `.handshake/`"*, and a directory is the wrong unit for
a rule whose whole job is that one file in that directory must never be
committed: `.handshake/secret.json` is the guarded part, and the guard's own
hard-fail condition is exactly *"public verdict and guarded material tracked"*
`[C lib/repo.js:384]`. So the write path takes an **enumerated allowlist of path
shapes** **[proposed]** — `.handshake/tasks/<shardFileName(member)>` for this
member only, computed with `shardFileName` rather than accepted
`[C lib/workspace-files.js:292-298]` — and everything else in the tree, including
anything a future version drops into `.handshake/`, is **not** committed because
it was never named. Allowlist, not denylist, on the path the tool writes without
a human: the same direction §4.2 item 1 takes on content.

**The read half is a V1 deliverable, and the first draft only built the write
half.** `git show <ref>:<path>` is the right primitive and nothing in the product
can reach it today: every shard reader walks the **working tree** — `scanShards`
lists shards off disk and `fs.readFileSync`s them `[C lib/shard-scan.js:178-192]`,
reached from `hooks/session-start.js:80` with a repo root and not a ref — the
branch is never checked out **by design**, and nothing fetches it automatically.
A branch nobody reads is a branch nobody benefits from, so §10.1 delivers the
read path with the write path: an automatic fetch on the SessionStart async path,
a `ref` option threaded through `scanShards` / `checkShardAuthors`, and a
`readShardFromRef` that **derives** its path with `shardFileName` and never
accepts one.

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

**And this line, not the card, is where the whole symbol prints.** The gate is
the one injection path with no character budget competing with it — it carries
`escape.FRAMING` verbatim for exactly that reason `[C hooks/pre-tool-use.js:24-27]`
— so `describe()` prints the peer's full `path::Symbol.member` through a 120-char
`path` slot beside the claimed path it already renders
`[C hooks/pre-tool-use.js:89-106]`. The card's 20-char `details[]` entry carries
only the discriminating tail (§2.4, §7.1). Two surfaces, two budgets, one fact:
the card says *which method*, the gate line says *which method in which file*.

### 5.4 Case (c) — different tasks, same symbol → stack, or sequence

Two different tasks that genuinely need the same method. Nobody leaves, nobody
idles, no human is asked.

**Stack.** My Claude fetches the peer's work branch and builds **on top of it**.
The judgement is made from facts, never from **self-reported availability or
intent to yield** — which is the whole reason decision 9 rejects the
negotiation-on-self-reported-inputs shape:

| Fact | Where it comes from |
|---|---|
| the peer's branch exists and has moved | the `branch` the presence body already carries on both legs `[C docs/PROTOCOL.md:295]` `[C relay/src/do/workspace.js:97,435]`, plus `git ls-remote --heads origin <that branch>` read locally — **the branch moved iff the sha `ls-remote` returns changed** |
| commits are landing | successive `ls-remote` reads on the monitor's own clock, at the transport keepalive `[P§8]` `[C monitors/heartbeat.js:47]` |
| the diff overlaps mine | computed locally against the fetched branch, never reported by the peer |
| a clean **merge-tree** probe | `git merge-tree --write-tree` run locally against the fetched head — non-mutating, no worktree, no `HEAD` movement (below) |
| the peer's own view of scope | the declared `symbols` on their claim (**V-D2**) |

**Why the head is read and not received, and what that changed.** The first
draft carried this as `presence.update.head`, an OPTIONAL field on the presence
body. It cannot travel: on the relay `presence.update` is a fixed column set
behind its own endpoint and an envelope of that type is refused
`[C docs/PROTOCOL.md:262-275]` `[C relay/src/lib/envelope.js:22-26]`
`[C relay/src/do/workspace.js:96-98,595-597]` — §2.3's carriage finding has the
full argument and the choice. Reading it with `ls-remote` costs one bounded
network round trip per peer branch per poll and buys two things beyond mere
carriage: **the head becomes a fact the peer cannot author**, which is the rule
every other row in this table already obeys, and the derivation is identical on
both transports, so §11's two legs differ in nothing here.

**And this is a named departure from decision 4, said here in the same register
as the other one.** Decision 4's case (c) names *"a structured branch-moved event
on each peer push"*. That event cannot travel (§2.3), so the fact is **derived
locally instead and arrives on the poll's clock** — 60 s on the relay, up to
600 s on ntfy `[C monitors/heartbeat.js:47]` — rather than at the instant of the
push. The fact is **stronger** (the peer cannot author it) and the **latency is
worse**, and that is the whole trade. It matters in one place only: a peer's
push is invisible for up to one poll, so the instability counter (item 12) and
the stack decision both run on a head that may be one poll stale, which changes
when a decision is made and never what it is made from.

**The negative rule, in one clause, because a reader will look for it.** *A
changed head never causes an off-cadence post.* The read rides the poll the
monitor already runs at the transport keepalive — 60 s relay, 600 s ntfy
`[C monitors/heartbeat.js:47]` `[C hooks/stop.js:113]` — and it emits nothing:
it is a local read whose only consumer is this client's own stack decision. No
transport operation is added by V5 in either direction, which is what keeps the
ntfy operations budget of `[P§9.3]` untouched.

**The last row is the peer's own words and is bounded accordingly.** Declared
symbols are model-authored self-reports by construction (decision 6, §7.1: *the
model writes it*), so they may **narrow the rendered verdict** — the gate's line
says which method the peer thinks it is on — and they may **raise a candidate**
for case (c). They may never **decide** whether to stack: that decision is made
from the locally computed diff and the `merge-tree` probe, both of which the peer
cannot author. A peer that declares no symbols, or declares them wrongly, changes
what is rendered and changes nothing about what is built.

**Decision 4's named fact `branch CI passing` is not available in this
plan, and this is where that is said rather than left to be discovered.** §4.2
item 4 skips CI on `handshake/*` **[proposed: `branches-ignore: handshake/**`]**
precisely so a commit-per-minute live view does not start four job runs
every minute (§12.5), so there is no green tick on a work branch to read —
`handshake branches` labels every work branch `untested` for exactly this reason
(§12.5). **What replaces it: the clean merge-tree probe and successive
`ls-remote` reads** **[proposed]**, which together answer the question CI was
being asked —
*is this branch stable enough to build on* — without a remote job, and which are
the two rows above. What they do **not** answer is *does the peer's half pass its
own tests*; nothing in this stage answers that, and a Claude that stacks is
stacking on code that is explicitly allowed to be broken (§4.1). An **opt-in
lightweight per-branch job** — one runner, one OS, the unit suite only — is
recorded as **§14 item 23** rather than built here, because it re-opens the
CI-cost risk V2 has not yet measured.

#### How the fetch and the probe actually run — four mechanisms the first draft named as one

**1. The peer's branch string is validated at the receive boundary, before it is
ever a git argument.** `branch` is free text, *"string | MAY | ≤ 200 chars"*
`[C docs/PROTOCOL.md:295]`, and V5 feeds it to `fetch`. `lib/repo.js` passes argv
straight to `spawnSync` with `shell: false` `[C lib/repo.js:52-54,60-67]`, which
closes shell injection and **not option injection** — a `branch` of
`--upload-pack=...` is a flag, not a ref. This tree already fixed this class once:
`shardFileName` derives a filename from a member id rather than accepting one
`[C lib/workspace-files.js:287-298]`, and this plan cites that discipline four
times. So: a peer branch is accepted only if it matches
`^handshake/<the authenticated sender's member id>/[A-Za-z0-9._-]{1,120}$`
**[proposed]**, and anything else is **discarded and counted** — the posture
`[COBUILD §7.2]` sets for every receiver-side check.

**Which member id that is, and where the check runs, are per leg — because
`presence.update` is not one thing on the two transports (§2.3), and the first
revision specified this against `from.member` in `lib/envelope.js`, which is the
carriage error of B5 repeated inside its own sibling fix.** Stated the way §2.3
and §7.1 already state V-D2's carriage:

| Leg | The id the member segment MUST equal | Where the check runs |
|---|---|---|
| **ntfy** | the **signed** envelope's `from.member` — the key the presence map is already built on `[C lib/transport-ntfy.js:284]`, after `_decode` has run shape, signature and dedupe `[C lib/transport-ntfy.js:282]` | `lib/transport-ntfy.js`'s presence assembly, on the row that copies `branch: b.branch` out of the envelope body `[C lib/transport-ntfy.js:300-301]` |
| **relay** | the presence row's **server-authoritative** `member_id` — the relay keys the row on the *authenticated* member `[C relay/src/do/workspace.js:428-437]` and returns it in `sync` `[C relay/src/do/workspace.js:709-712]`, which is why a spoofed `from` is refused at the source there `[C relay/src/do/workspace.js:599-605]` | `lib/transport-relay.js`'s `presence()`, on the map that passes `j.presence` rows straight through today with no shape check at all `[C lib/transport-relay.js:259-268]` |

**Not in `lib/envelope.js`, and the reason is the plan's own argument.**
`validate()` deliberately enumerates **no** body field `[C lib/envelope.js:365-414]`
— that is precisely why §2.3 can say an OPTIONAL field degrades better on a v1.0
peer than a new type would, and adding a `presence.update.branch` enumeration
there would spend that property to cover one leg while leaving the other, the
tier §11 runs first and §4.3 promotes to primary, entirely unguarded. The check
belongs where each leg **normalizes its presence row into the peer cache**, which
is the one place both legs have. `lib/repo.js` re-derives the ref from the member
id and the validated tail before spawning anything, so the git boundary is closed
by construction even if a future third transport forgets.

The fetch then uses an explicit refspec, a `--` separator
and a fully-qualified `refs/heads/<branch>` source into the namespaced local ref
of §4.2 item 5. A V5 test: a peer branch named `--upload-pack=…` is refused
**with no git process spawned** — run on **both** legs, because one leg's
mechanism is not the other's.

**2. There is no `git rebase --dry-run`, and the first draft depended on one.**
It made *"a clean rebase dry-run"* one of five facts, the replacement for the CI
verdict, the basis of §12.3's *"a dirty result costs nothing and leaves the local
branch untouched"*, a §14 item and a test. The primitive does not exist. The only
implementation of the phrase is attempt-then-`--abort`, which needs a clean tree,
churns the working tree, and on a hard kill leaves `.git/rebase-merge/`, conflict
markers and a detached `HEAD` in a checkout the human is using. **So the probe is
a named non-mutating primitive: `git merge-tree --write-tree <peer-head>
<my-head>`** (git 2.38+), which writes objects and a tree and touches no ref, no
index and no working tree. The
probe answers *does this apply cleanly*; it is not a rebase and it is not
described as one.

**What the probe is a proxy for, and where the proxy breaks — added at fix round
3, because §5.4 sells the clean probe as the replacement for decision 4's
`branch CI passing` fact and the design then runs a real rebase behind it.**
`merge-tree --write-tree A B` composes two **endpoints** against a merge base; a
rebase **replays each of my commits** onto their head. An intermediate commit can
conflict where the endpoint composition does not, so **a clean probe does not
imply a clean rebase**. Verified at fix round 3 on git 2.53: with a base file, a
peer edit on line 4, and my branch inserting a line at 4 and then deleting it
again — a net-empty endpoint diff — `merge-tree --write-tree` exits **0** and
`git rebase` exits **1** with a content conflict. **So the missing arm, stated:
a real rebase that conflicts after a clean probe aborts in the worktree, drops
the stack, routes to sequence with the same notice a dirty probe renders, and
counts against the instability bound** (item 12) **[proposed]** — without it the
instability counter counts head moves only, nothing increments on a failed
rebase, and the client is stacked-but-not-rebased with no route out until the
head moves again. §10.5 carries the test, and §14 item 32's row carries the
caveat, because that row is what the owner ratifies.

**The git-version floor is real, and the stated fallback answers a different
question — both new at fix round 3.** `merge-tree --write-tree` landed in
git 2.38 (October 2022); Ubuntu 22.04 LTS, in standard support until 2027, ships
git 2.34.1. The plan stated the version and stated no detection, no preflight
and no test, and CI runs `windows-latest` and `ubuntu-latest`
`[C .github/workflows/ci.yml:18-24]`, both above the floor — so the older branch
is the one nobody would ever run. Worse, the first revision's fallback —
`git format-patch | git apply --check --3way` against a temp index — **inverts
the verdict on exactly the case the probe exists to catch**: measured at fix
round 3 on the conflict above, `merge-tree --write-tree` exits 1 while
`git apply --check --3way` prints *"Applied patch to 'f.txt' with conflicts."*
and **exits 0**, with or without `--cached`. A fallback that reports a real
conflict as clean would let the client stack and rebase on a base that does not
compose, void §12.3's *"a dirty result costs nothing"*, and do it underneath
ruling D1's force-push. **So the fallback is withdrawn as a probe and the
capability is refused instead** **[proposed — §14 item 32]**: the V1 preflight
gains a **fifth precondition**, `git --version` probed and recorded, and **below
2.38 the stacking capability is off** — `status` and `handshake branches` say
which, in the register the no-remote arm already uses, and the pair sequences
rather than stacking. Everything else in the plan works unchanged on git 2.34.
Recording the failure here is the point: a future reader reaching for
`apply --check --3way` needs to know it was tried and why exit 0 disqualifies
it.

**3. Any real rebase happens in a dedicated worktree under the plugin's state
directory** `[C lib/state.js:75-82]`, never in the human's checkout — the same
throwaway-worktree rule §4.2 item 5 sets for evaluating peer content, for the
same reason and with one extra: a hard kill mid-rebase then leaves its wreckage
somewhere nobody works. **A startup sweep removes abandoned worktrees**, and
fetch gets the network timeout of §2.5 rather than `GIT_TIMEOUT_MS`
`[C lib/repo.js:27]`.

**The sweep is a git operation, not an unlink — corrected at fix round 3.** The
first revision specified it *"in the shape `hooks/session-end.js` already uses
for stale sentinels"* `[C hooks/session-end.js:27-31,49-51]`, and that shape is
filesystem deletion. Verified on git 2.53: after `git worktree add --detach <p>`
and `rm -rf <p>`, `git worktree list` still lists the path, now marked
`prunable`, the administrative directory `.git/worktrees/<name>` survives, and
re-adding at the same path fails with *"is a missing but already registered
worktree"*. The path is deterministic — it is under the per-workspace state
directory `[C lib/state.js:75-82]` — so under that specification **the first
hard kill disables peer evaluation permanently**, until a human runs
`git worktree prune` by hand. **So the sweep is `git worktree remove --force
<path>` per plugin-owned worktree followed by `git worktree prune`**, with
`-c core.longpaths=true` on Windows for the reason §4.2 item 5 gives, and it is
one of the three things the sentinel unlink at session end is *not*. §10.5's
existing tests do not discriminate the two implementations — a `rm -rf` passes
both *"a worktree abandoned by a kill is swept"* and the `git status
--porcelain` invariant, since the administrative directory lives inside `.git`
— so §10.5 gains the test that does: **the next probe at the same path
succeeds.**

**Which process runs all of this, in one clause, because §2.5's `ls-remote` row
put the question there.** The refspec fetch, the worktree, the probe, the rebase
and the sweep are **off-hook work on the monitor's own clock**, and are
**skipped entirely when there is no monitor** — V5's Touches put the poll on
`monitors/heartbeat.js` (§10.5) and none of this is hook work. On the no-monitor
Stop-hook fallback only the peer-head `ls-remote` rides the beat, at §2.5's
2,000 ms row. That is what keeps `GIT_NETWORK_TIMEOUT_MS` off every hook path,
and it is the sentence fix round 2 removed when it corrected the `ls-remote`
row.

**4. Pushing the rebased branch is ruling D1's carve-out and nothing wider.**
Rebasing rewrites commits this tool already pushed, so the local branch and the
remote diverge and a plain push is refused; the only way to keep the live view
live is `push --force-with-lease=<ref>:<the sha this tool last pushed>`, on
`handshake/<self>/*` and no other pattern. §4.1 has the ruling, the rationale and
the three implementation rules. **The first draft's sentence — *"it is below the
floor because it rewrites only history I own and have not asked anyone to
merge"* — was not the test git applies**, because the test git applies is whether
the ref was published, and by this design's own choice it was. It is below the
floor now for a different and stated reason: the ref is tool-owned, advertised
unstable, and the lease makes the tool refuse rather than clobber if a human ever
wrote to it.

**Mutual stacking, and the rule that breaks it.** The stack decision is symmetric
and computed locally, so two clients reading the same five facts both conclude
*stack*, fetch each other and rebase onto each other — which is not a deadlock but
is churn with no exit. **The lexicographically smaller member id never stacks; it
proceeds and the other side stacks on it** **[proposed]**, reusing the byte-wise
UTF-8 comparator that `[P§5.4]` already froze for the tiebreak
`[C lib/subject.js:102-107]`. This **borrows** the comparator for a new object
and amends nothing — the same move `[COBUILD §4.5]` makes for concurrent
revisions, and §5.1's point stands: the tiebreak itself is not engaged here,
because these are two different `subject_key`s.

**Nested stacks are not permitted** **[proposed]**. A client that is already
stacked on a peer's branch does not stack a second base on top of it: it
sequences instead. One base, one rebase target, one invalidation rule — a stack
of stacks multiplies the invalidation cases (§below) by its depth and buys a case
no acceptance scenario describes.

**Stack invalidation, one rule covering three causes.** *If the base head the
stack was built on is no longer an ancestor of the remote branch, or the remote
branch is gone, the stack is dropped and the client falls back to sequence with a
notice.* That covers the peer's own lease-protected rewrite (ruling D1 rule 2), a
**human** force-pushing or rewriting the base, and a human deleting it — three
causes, one locally computed test (`git merge-base --is-ancestor`), no wire
change. It is stated once here and §4.1 and §10.5 point at it rather than
restating it.

**Sequence.** If the peer's branch is too unstable to build on — the honest
signal being a merge-tree probe that does not apply cleanly, or a head that has
moved more than **[proposed: 3]** times since my last successful rebase — my
Claude **does other work** and resumes automatically. This is decision 9's kept
idea, dependency-as-events, and it needs **no new type at all**: the events exist
and are already rendered `[P§3]` `[C lib/envelope.js:41-45]`.

**What resumes it: three triggers, not one.** The first draft said `task.release`
or `task.done` *"and on nothing else"*, hardened by §14 item 24. That is a
deadlock in the commonest abandonment there is: a closed laptop emits neither
event, the claim merely expires by TTL, and a sequenced Claude waits forever with
nothing told to anyone — which defeats §5.4's own criterion, *nobody leaves,
nobody idles, no human is asked*. **So the third trigger is the base claim going
stale**: the reader-derived staleness rule `[P§4.3]` and claim expiry `[P§5.3]`,
both of which every client already computes from data it already holds
`[C hooks/common.js:566-568]`. No wire change, no new state, and it closes the
deadlock. The rule is therefore: *a sequenced task re-evaluates on the peer's
`task.release` or `task.done` for that `subject_key`, **or** on the base claim
expiring or going stale, and on nothing else* — in particular never on a peer
note saying the work is finished (§10.5).

**But "resume when this arrives" is new local behaviour, introduced here, and no
existing rule has its shape.** It is worth saying plainly because the nearest
neighbour looks like a precedent and is not: `[P§5.4]`'s tiebreak loser
change → release → **stop work** and tells its human one line `[P§5.4]`
`[C skills/handshake-coordination/SKILL.md:145-152]` — neither `[P§5.4]` nor
SKILL.md defines any rule that resumes it on a peer's later `task.release` or
`task.done`, so there is no shape being reused. What is genuinely reused is the
*ingredients*: the events, the client's own records, the staleness rule `[P§4.3]`
already computes, and the fact that the evaluation is local and needs no message.
The rule itself is **[proposed]** and collected in §14, in the three-trigger form
above.

#### The discriminator: what an unclean probe means, and what it does not

**One observable, two rules, and the first draft did not separate them.** A
merge-tree probe that does not apply cleanly routes to **sequence** (above), and
§11.3 described a contradiction as *"the rebase now fails on the value, not on
the text"*. Git has no such distinction: it reports textual conflicts and nothing
else. So the discriminator is stated here, once, and §6 and §12.3 point at it:

- **An unclean probe is *always* a sequence signal and never, by itself, a
  contradiction.** It says the two diffs cannot be composed mechanically. That is
  a scheduling fact and it is settled by the instability counter.
- **A contradiction is opened by the model's reading of the fetched diff** —
  §3's one sanctioned use of judgement — and it is opened **only** by posting the
  structured contested event into an already-open seam (§5.5, §6.2). The round
  therefore has a *structured* opening act even though the *detection* is a
  reading, which is exactly decision 5's shape: the trigger is a conflict event,
  the reasons are prose, the adoption is the fact.
- **The two are not mutually exclusive and neither implies the other.** A clean
  probe with a contradiction under it is the common case, not the rare one: Alex
  sets `idempotent = true` in one function, Bob reads it in another, the diffs
  compose perfectly and both halves are wrong. Nothing mechanical sees that,
  which is precisely why the round is opened by judgement and why §6 exists at
  all. An unclean probe with no contradiction under it is ordinary churn.
- **So a Claude that has sequenced may still open a round, and a Claude that
  rebased cleanly may too.** The stack/sequence decision and the
  contradiction/no-contradiction decision are independent, and reading them as
  one thing was the first draft's error.

### 5.5 The events that drive each case

| Case | Trigger | Carried by | New wire? |
|---|---|---|---|
| (a) same task | `task.claim` with a colliding `subject_key` | existing | no |
| (b) same file, different symbols | PreToolUse path match + `symbols` disjoint | **V-D2**, on `task.change{scope}` where the relay decides carriage (§2.3) | one OPTIONAL field |
| (c) stack | the sha `git ls-remote` returns for the peer's declared `branch` changed since the last read | the existing `presence.update.branch` `[C docs/PROTOCOL.md:295]`, plus a **local** read | **no** — V-D1 withdrawn (§2.3) |
| (c) sequence → resume | `task.release` / `task.done`, **or the base claim expiring / going stale** `[P§4.3]` `[P§5.3]` | existing `[C lib/envelope.js:41-45]`; staleness is reader-derived and travels not at all | **no** |
| contradiction (§6) | **the model, reading the fetched diff, judges that two requirements cannot both hold — and then posts `task.seam{propose, contested: true}` into a seam.** Detection is a reading; the round opens on the structured act and on nothing else (§5.4's discriminator, §6.2). **[proposed — §14 item 42]**, since detection-by-reading relaxes decision 2 | `task.seam` + **V-D3** | dependent on `[COBUILD §11 E1-E3]` |

---

## 6. The contradiction protocol (decision 5)

*His diff needs `X = true`; mine needs `X = false`.* Decision 5 names this as the
one place true collaboration and talking belong. Everything below reuses
`COBUILD`'s machinery; §6.2 says exactly what is new.

### 6.0 What opens a round — one definition, used by §5.4, §5.5, §11.3 and §12.3

The first draft gave this three different answers in three places and none of
them worked: §5.5's *"a disagreement between two adopted revisions"* is circular,
because at round-open there are no revisions — rev 1 is authored by the `propose`
that opens the round (§6.2); §11.3's *"the rebase now fails on the value, not on
the text"* asks git for a distinction git does not make; and §5.4 had already
routed every unclean rebase to *sequence*. One definition, in three parts
**[proposed — §14 item 42]**, because part 1 relaxes decision 2's *only a
validated structured fact may cause work* and a relaxation of a FINAL DECISION is
not the plan's to settle:

1. **Detection is a reading.** The model reads the fetched diff (§4.2 item 5's
   worktree, never the live tree) and judges that its half and the peer's half
   require incompatible values of one named thing. Nothing structural can detect
   this, because both diffs are individually valid and, in the common case, they
   compose cleanly.
2. **Opening is a structured act, and it is the only one.** The round begins when
   `task.seam{propose}` carrying `contested: true` and naming the contested
   symbol in the seam's immutable `name` is posted — into a seam, which means
   into a bounded, twice-consented object with a fixed counterparty, a fixed
   subject and a stated expiry `[COBUILD §2.1]`. A judgement that is never posted
   opens nothing, changes nothing and is visible to nobody.
3. **Adoption is the fact, and it is unchanged.** Only a materialized, hashed
   revision that both sides adopt changes code (§3, §6.1). Judgement got the
   round opened; it never gets a line written.

**This is the one place in this design where model judgement opens a protocol
step, it is named as such in §3, and it is bounded on all four sides**: it can
only happen inside a seam, only against a named symbol, only for a bounded number
of rounds (§6.3), and only where the capability was granted (§9). Everywhere else
in this plan, a structured fact opens the step and a reading may at most inform
what the model proposes.

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
- **And the escalation is bounded, which the first draft left implicit.** An
  escalation nobody answers does not hang: it expires with the seam, at
  `opened_at + ttl` computed independently on both sides and announced by nobody
  `[COBUILD §5.4]` — **default 2 hours, maximum 24, minimum 15 minutes**, the
  bounds `[COBUILD §7.1]`'s schema already sets and which are themselves the claim
  TTL's `[C relay/src/lib/config.js:6-7]`. On expiry the client deactivates, one
  notice renders once, and the settled requirement re-enters later as an ordinary
  revision on a new seam. So *"escalation gives the humans no mechanism and no
  bound"* has an answer, and the answer is a clock both machines already run.

**Per-leg reality, stated because §11 asserts zero human turns on both legs.**
The contradiction protocol is **autonomous on an authenticated transport and
human-paced on ntfy**, and that is not a defect of this design but the
`[COBUILD §2.6]` gate it reuses unchanged: `task.seam{contract}` materializes
automatically **iff** `capabilities().authenticated_from`, and on ntfy each
inbound revision waits on `handshake seam pull <id>` and a typed confirmation
`[COBUILD §2.6]` §9. So on the relay a round runs with no human turn; on ntfy it
runs at one confirmation per inbound revision per receiving side. §11.3 and §11.4
carry per-leg expected results, and §12.7 states the consequence plainly.

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

A claim gains an OPTIONAL `symbols` array (**V-D2**): **≤ 8 entries, each ≤ 100
chars** **[proposed, lowered at the revision to fit the 2,048-byte body cap —
§2.3]**, of the form `path::Symbol.member` **[proposed exact form]**. The model
writes it — it is the same speech act as the semantic subject it already authors
`[P§5]`. It is authored data, so it is filtered on send
`[C lib/envelope.js:268-288]` and escaped on receive `[SEC§5.3]`.

**How it renders, corrected at the revision.** The card carries **the
discriminating tail only** — the last `::` segment, `Handler.shape` — as one
`details[]` entry, because `escapeSlot(d, 20, 'name')` ellipsises at its cap
`[C hooks/render.js:97-100,138]` and a `path::Symbol.member` is long on the left,
so rendering the whole string would print the path and cut the symbol, which is
the one part the claims line does not already say (§2.4). The **full**
`path::Symbol.member` prints on the PreToolUse gate line, which has no 600-char
budget competing with it (§5.3) `[C hooks/pre-tool-use.js:24-27,89-106]`.

`task.change` carries the same field with `change: "scope"`, the existing enum
value for exactly this `[C docs/PROTOCOL.md:321-322]`, so a claim's symbol set
narrows and widens progressively — **and on the relay `task.change{scope}` is the
authoritative carrier, because `task.claim` is not an envelope there** (§2.3).

**And the carrier must be harvested into the peer-claim cache, which §2.3's
choice of option (b) made necessary and the first revision did not name.** Both
surfaces this plan promises read **only** the cached claim rows and never an
envelope: the PreToolUse gate iterates `state.getPeers().claims` and matches on
`c.files` `[C hooks/pre-tool-use.js:51-58]`, and the card's `details[]` entries
are built inside the same `for (const c of peers.claims)` loop
`[C hooks/common.js:564-580]`. A `task.change{scope}` envelope, meanwhile,
reaches the client as a **digest item and is consumed by the watermark at
injection, appearing exactly once** `[P§6.3]`
`[C hooks/user-prompt-submit.js:84-98]` — the same mechanic §6.2 cites to reject
`note.blocker` as the vehicle for a durable reason. Left there, the symbols
would render on the arrival turn and vanish from the card and the gate line on
every turn after it, and §2.4's *"every turn a symbol-scoped claim renders"*
frequency would be wrong about its own vehicle.

**The mechanism exists and has this exact job already.** `mergeClaimFiles`
harvests `files[]` out of `task.*` envelopes into the peer cache, and its own
comment states the reason verbatim: *"the resurrected claim set carries no
files[] — only task.\* envelopes do. Harvesting them into the peer cache is what
gives the PreToolUse gate anything to match on"* `[C hooks/sync.js:89-92,93-126]`.
V3 extends it to harvest `symbols` from `task.claim` / `task.change{scope}`
bodies into **`peers.claims[].symbols`** — **a separate array, never merged into
`files[]`**, because `files[]` is what the gate path-matches against a write
path `[C hooks/pre-tool-use.js:57-58]` and §11.6 asserts a peer symbol string
never becomes a filesystem path. Each element is escaped the way `files` is at
`[C hooks/sync.js:108]` but **with an explicit `{ max: 100 }`** rather than the
`path` class's 300 `[C lib/escape.js:45,152-156]`, and the array is capped at 8.
**And the CLI `sync` path must merge rather than overwrite:**
`bin/handshake.js` sets the claim rows wholesale from `presence.claims`
`[C bin/handshake.js:1006-1010]`, which discards any harvested extra — true for
`files` today and it would silently drop symbols on the next `handshake sync`.
`hooks/sync.js` and `lib/state.js` are in V3's Touches for this (§10.3).

**The analogy to `files[]` goes exactly this far and no further, which the first
draft over-claimed.** `files[]` is **hook-observed**: `hooks/post-tool-use.js`
appends the real path of every real write, as a capped union, without the model
being asked `[C hooks/post-tool-use.js:79-91]`. `symbols` is
**model-remembered**: nothing observes it, nothing verifies it, and it is exactly
as accurate as the model's recollection of its own intent. What the two share is
the *shape* — an OPTIONAL, progressively-updated, capped list on a claim, revised
through `task.change`. What they do not share is evidentiary weight, which is
precisely why §5.4's table puts declared symbols in the row marked *the peer's own
words* and never lets them decide anything, and why §7.2 keeps the gate a path
comparison.

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
and what the model did next.

**The ratio, with its denominator named, because "the rate of warnings" is not a
number.** Numerator: gate warnings the model **overrode** — continued the write —
on a claim whose declared `symbols` were **disjoint** from the peer's.
Denominator: **all gate warnings fired on claims where both sides declared
symbols**, which is the only population in which the question is even askable —
a warning on a claim with no declared symbols is not evidence about symbol scope
in either direction, and counting it would make the ratio move when the model
simply stops declaring. Threshold: **[proposed: measured, then decided — no
threshold is picked here]** (§14 item 17). Until then the cheap version is the
whole feature.

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

**What "per peer" is worth on each leg, qualified at the revision rather than
left as a flat claim.** On the relay `from` is server-authoritative — a mismatch
between the envelope's `from.member` and the authenticated member is refused with
`from_mismatch` rather than rewritten `[C relay/src/do/workspace.js:599-605]` —
so a per-peer grant is enforceable there. **On ntfy `from` is self-declared**,
HMAC-signed with a workspace secret every member holds `[P§9.3]`, so any member
of the workspace can present as any other and a per-peer grant degrades to a
per-**workspace** grant against a malicious insider. That is not a new exposure —
`[SEC§1.2]` already places a malicious current member out of scope, and §12.7
restates it for this stage — but the table's "per peer" column means *enforced*
on the relay and *advisory* on ntfy, and saying otherwise would be the kind of
overclaim `[SEC§4]` forbids.

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
| `task.claim` / `task.change{scope}` with `symbols` (**V-D2**) | narrow my gate's rendered verdict; coexist on a symbol-disjoint file | **granted** | render only; never suppresses the path warning |
| `presence.update` with a `branch`, plus the head this client reads with `ls-remote` (§5.4) | fetch the peer's work branch into a namespaced ref and evaluate a merge-tree probe | **granted** | fetch and **local** evaluation only, in a throwaway worktree (§4.2 item 5); never a push to their branch, never a build/install/test in a tree carrying their commits, and **refused outright unless every path in their diff sits under a locally derived allowlist with no mode change, and never on the instruction/build floor** (§4.2 item 5) |
| `task.release` / `task.done`, **and base-claim staleness** `[P§4.3]` | resume a sequenced task automatically | **granted** | resumes only a task this member already holds; staleness is reader-derived and carries no payload at all |
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

**Delivers.** An orphan `handshake/state` branch **[proposed]** carrying an
explicit path allowlist (§4.3); a commit per batch with author = the member and
committer = the tool; a push batched at ≤ 1/min on the monitor's own clock; a
deferred retry while offline; **the no-remote arm — no branch, no commit, no
push, today's behaviour, said plainly in `status`** (§4.1); the opt-in gate with
ruling D2's visibility verdict, the preflight with its **five** preconditions
(the fifth is the recorded `git --version`, §5.4 mechanism 2), and
the recorded override; **the read half** (below); the SessionEnd last-batch
flush; `handshake branches` as the read-only view; and the two lines of YAML
that put `branches-ignore: handshake/**` on **this** repository's own workflow
`[C .github/workflows/ci.yml:13-15]`, which moved here from V4 because V2 runs
the machine-cadence push and §12.1 already claims the mitigation as live.

#### The write mechanism, named — temp-index plumbing, never `HEAD`

The first draft named the *read* mechanism and stopped, and that is the gap most
likely to destroy a human's work. `lib/repo.js` exports read verbs only; there is
no commit, index or `update-ref` code anywhere in this product today; and the
Claude and the human share **one** working tree and **one** `.git`. The obvious
implementation — `checkout --orphan`, `add`, `commit` — moves the human's `HEAD`,
resets their index and stages whatever happens to be lying around, and it would
still pass the only test the first draft wrote for it (*"`git log main` is
byte-identical"*). Silent loss of uncommitted human work is the failure mode.

**So the path is written out, and it is plumbing all the way down**
**[proposed — collected as §14 item 41, because a write mechanism nobody ratified
is the one most likely to destroy a human's work]**:

```
GIT_INDEX_FILE=<tmp>  git read-tree        <the base tree: per branch, below>
GIT_INDEX_FILE=<tmp>  git update-index --add --cacheinfo <mode>,<sha>,<path>   # paths present on disk
GIT_INDEX_FILE=<tmp>  git update-index --force-remove -- <path>                # paths no longer on disk
GIT_INDEX_FILE=<tmp>  git write-tree
                      git commit-tree <tree> -p <the parent: per branch, below>
                      git update-ref <the ref> <commit>
```

**`.git/index` is never read and never written, `HEAD` never moves, and no
checkout ever happens.** The author is the member and the committer is the tool,
set through `GIT_AUTHOR_*` / `GIT_COMMITTER_*` on the `commit-tree` call. The
same plumbing is what V4's work-branch commit uses (§10.4), which is why it is
specified once, here — **but the three operands differ per branch and are named
per branch**: for `handshake/state` the base tree and the parent are both *the
fetched state head, or empty on the very first commit*, and the ref is
`refs/heads/handshake/state`; §10.4 names the work branch's, which the first
revision left blank.

**The removal arm and the mode, added at fix round 3, because the sequence as
first written could only ever add.** Verified on git 2.53 against a temp index
seeded by `read-tree`: `git update-index --add -- <path>` on a path that no
longer exists on disk exits **128** with *"does not exist and --remove not
passed"*, and the plan's `--cacheinfo` form cannot even be constructed for it,
since there is no blob to hash — so a builder walking the path list **skips**
it, and `write-tree` then re-emits the parent's blob into the new tree.
**A deletion silently resurrects, and a rename — a delete plus an add —
publishes both copies.** That is not an exotic case on the work branch: `files[]`
is a monotonic union that `hooks/post-tool-use.js` pushes to on write and never
removes from `[C hooks/post-tool-use.js:79-91]`, so a path written and later
deleted inside one claim is still on the list §10.4 filters by, and the peer
stacking on that branch then holds two copies of one module with no human
deciding which is canonical. It bites the state branch too: `handshake scrub`
removes the whole handshake directory including the task shards
`[C lib/workspace-files.js:773-776]`, and an add-only mechanism leaves a
detached project's shards published on `handshake/state` forever. **So: for each
path on the list that is absent from disk, `git update-index --force-remove --
<path>`** (verified: exit 0, and the path leaves the written tree).
**And the mode is read from the parent tree with `git ls-tree`, never
hardcoded and never taken from a disk stat.** Verified on the same run:
`--cacheinfo 100644,<sha>,<path>` against a parent entry of `100755` demotes it
to `100644` in the written tree, and on Windows `core.fileMode` is `false`, so
a stat-derived mode does the same. §10.4 carries the tests.

#### The concurrency protocol — one branch, two writers

Decision 3 says **one** `handshake/state` branch, and the plan keeps it. But one
branch with two writers pushing at up to 1/min needs a protocol, and the first
draft specified none — while the floor forbids both of the usual escapes
(force-push on a shared ref, and merging). Per-member files prevent *content*
conflicts; they do nothing about *ref* conflicts. Worse, opt-in is explicitly
independent, so without an adopt rule both sides can create two unrelated orphan
roots. **The protocol, five rules** **[proposed]**:

1. **Fetch first, always**, into `refs/remotes/origin/handshake/state`.
2. **Adopt, never re-create.** If the remote branch exists, its head is the
   parent. A local orphan root is created **only** when the remote ref is
   **proved** absent — never on a fetch error, which is indistinguishable from a
   ref that is there.
   **And the proof is a named primitive, because the fetch of rule 1 cannot
   give it** — corrected at fix round 3, where the rule asserted a git behaviour
   the mechanism it names does not have. Verified on git 2.53: the exact-refspec
   fetch rule 1 specifies exits **128** both when the ref is absent
   (*"couldn't find remote ref"*) and when the remote is unreachable
   (*"does not appear to be a git repository"*), so the two cases are one exit
   class and rule 2 cannot be implemented from it. **`git ls-remote --exit-code
   --heads origin refs/heads/handshake/state` gives the three-way answer the
   rule needs: 0 = present, 2 = absent, anything else = unknown ⇒ do not
   create** (measured 0 / 2 / 128 respectively). V1's Touches already carry an
   `ls-remote` helper in `lib/repo.js`; this is its first use, and §5.4's
   peer-head derivation is its second. The consequence of leaving it unnamed
   was not unsafe — an implementer who cannot prove absence and follows the
   letter creates no root, so V1 loudly fails to bootstrap, and the unsafe
   reading self-heals through rule 4's rebuild — but a rule whose stated
   mechanism cannot produce its stated verdict is a rule nobody can build.
3. **Build with `commit-tree -p <the fetched head>`**, carrying only this
   member's allowlisted paths (above). Both members' files coexist in one tree
   because neither writes the other's.
4. **On a non-fast-forward rejection, re-fetch and REBUILD — never retry.** A
   rejected push is not a network error and retrying it succeeds never: the
   parent is stale, so the commit must be rebuilt on the new head. Bounded at
   **[proposed: 3]** rebuild attempts per beat, after which the batch defers to
   the next beat. **3 is an attempt ceiling, not a time commitment, and the
   clock it runs against is the threaded deadline of §2.5 and not a wall-clock
   budget of its own**: each attempt's re-fetch and re-push take their slice of
   what is left, *"a spawn with nothing left is skipped rather than started in
   order to be killed"* `[C monitors/heartbeat.js:196-213]`, so on the
   9,000 ms Stop-hook window `[C hooks/stop.js:57-61,163]` the loop truncates
   after however many attempts fit and defers the rest — which is the deferred
   arm of §4.1 and not a stage failure. Fix round 3 added the fetch row §2.5 was
   missing for it.
5. **`status` distinguishes `rejected` from `offline`.** A deferred count that
   grows forever because every push is refused is exactly the lie §4.1 spends a
   paragraph forbidding, and "the remote said no" is a different thing to tell a
   human than "the network is down". The push budget sits outside the 8 s CLI
   slice, in the deadline of §2.5.

**Per-member state branches (`handshake/state/<member>`) would make single-writer
and always-fast-forward structural**, and they are recorded as §14 item 29 — the
fallback if the protocol above proves flaky at V2 — rather than adopted here,
because decision 3 settled on one branch and a plan should not quietly re-decide
a settled thing on a hazard it has not yet measured. **Note the cost of the
fallback, so the trade is visible:** `handshake/state/<member>` and
`handshake/state` cannot both exist (git refuses a ref that is a directory prefix
of another), so the fallback is a one-way migration, not a per-repo choice.

#### The read half, which the first draft did not build

§4.3 says the branch is read *"without a checkout via `git show`"*, and nothing
in the product can do that: `scanShards` walks the **working tree**
`[C lib/shard-scan.js:178-192]`, reached from `hooks/session-start.js:80` with a
repo root and not a ref, and nothing fetches the branch. V1 delivers:

- **An automatic fetch of the state ref on the SessionStart async path**, where
  the network already lives `[C hooks/session-start.js:5-6,82-88]` — ordered
  before the scan, which now reads through a ref, and before the sync.
  **It is a network call on a hook a turn waits on, and it is budgeted as one
  (§2.5's SessionStart row), not placed by analogy.** The comment that sites the shard
  scan there argues *"it is local disk I/O, it makes no network call"*
  `[C hooks/session-start.js:64-79]`, which is the opposite of what a fetch is,
  and the window the injector waits on is `PENDING_WAIT_MS = 500`
  `[C hooks/common.js:58]` — a window no fetch fits inside. The real constraint
  is the watchdog: `C.armSafety(9500)` `[C hooks/session-start.js:24]` is a hard
  `process.exit(0)` `[C hooks/common.js:63-74]` and `S.refresh` below it already
  takes 7,000 ms `[C hooks/session-start.js:83]`, so the fetch gets **1,500 ms**
  and the **whole scan** 500 ms on this path — every git call it makes, not just
  the author check `[C lib/shard-scan.js:127,160]`, per the bullet below.
  **A fetch that exceeds its bound is abandoned,
  not waited on**: the scan falls back to the last fetched ref, reports the
  records as stale with the truncation verdict below `[P§10.2]`, and the pending
  marker is still cleared `[C hooks/session-start.js:89]` — the hook must never
  die with the marker uncleared, which is the failure the sync's own catch arm
  already exists to prevent `[C hooks/session-start.js:85-88]`.
- **A `ref` option threaded through `scanShards` and `checkShardAuthors`**, both
  of which already take an options bag, and `scanShards` its kinds as a
  parameter `[C lib/shard-scan.js:157-167]` (`checkShardAuthors` takes no
  `kinds`; the first revision's sentence attributed one to both).
  **Two ref-scoped git operations the option cannot supply, named at fix round 3
  because presenting the whole change as a parameter hid them.**
  `checkShardAuthors` reaches the working tree **twice**: it enumerates with
  `listShards(root)`, a `readdirSync` of the tasks directory
  `[C lib/workspace-files.js:425-430,449]`, and it asks
  `repo.lastCommitEmail(root, rel, o)`, which runs `git log -1 … -- <path>` with
  **no rev**, i.e. over `HEAD`'s history `[C lib/repo.js:339-356]`. Neither is
  reachable by setting an option, and on the ref path both are wrong: §11.5's
  whole scenario is a peer shard that exists **only** on the fetched ref and not
  on disk, so the disk walk enumerates zero peer shards and the `HEAD`-scoped
  `git log` answers `uncommitted` for every one of them. Verified at fix round 3
  against an orphan `handshake/state` ref: `git log -1 -- <shard>` printed
  nothing while `git log <ref> -1 -- <shard>` printed the member's email, and
  `git ls-tree -r --name-only <ref> -- .handshake/tasks` listed the shard the
  disk walk could not see. **So V1 adds `git ls-tree <ref> -- .handshake/tasks`
  as the enumeration and a rev argument to `lastCommitEmail`'s `git log`**, both
  new primitives in `lib/repo.js`. The enumeration is `ls-tree` and not the
  local member roster `[C lib/shard-scan.js:268]` because the roster cannot name
  a member this client has never recorded, and the ref can.
  **And the ref path is where the author check acquires meaning**, which is the
  half worth claiming rather than hiding: on the state branch the last commit
  touching a shard carries **author = the member, committer = the tool** — the
  split V1's own test pins below — so `[SEC§5.4]`'s non-member-commit warning
  becomes a real verdict there, where on the working-tree path it is inert for
  peer shards today.
- **`readShardFromRef(root, ref, member)`**, which **derives** the path with
  `shardFileName` and never accepts one `[C lib/workspace-files.js:292-298]` —
  the traversal-closed-by-construction posture this plan cites four times.
- **A bounded budget with a truncation verdict for the *scan*** — a separate
  bound from the fetch's, since the fetch is one network call and the scan is one
  `git show` per shard — in the exact shape the author check already has: a
  wall-clock budget, a per-call bound, and a `*_truncated` flag on the result
  rather than a silent short read `[C lib/shard-scan.js:69-80,185-187]`
  `[P§10.2]`. On this path that budget is the 500 ms of §2.5's SessionStart row, and it
  bounds **every git call the scan makes** — the per-shard `git show` reads
  included, which means widening `authorBudgetMs` past the author `git log`s it
  wraps today `[C lib/shard-scan.js:127-142,189-192]` rather than reusing it as
  it stands, and not the 2,000 ms default `[C lib/shard-scan.js:79]`. That
  widening is what keeps fetch + scan + sync inside the watchdog; the option
  reused unwidened would leave the dominant call unbounded.

**Touches.** `lib/repo.js` (the fetch, commit, push and `ls-remote` helpers,
beside the existing bounded `git()` runner `[C lib/repo.js:82]` — never a shell,
argv straight to the process `[C lib/repo.js:52-54]` — plus the network timeout
of §2.5, the `--force-remove` and `ls-tree` primitives the read and write halves
need, and a **rev argument on `lastCommitEmail`'s `git log`**, which has none
today `[C lib/repo.js:339-356]`) · `lib/shard-scan.js` (the `ref` option, the
budget — **widened past the author check to every git call the scan makes** —
and the truncation verdict) · `lib/workspace-files.js` (`readShardFromRef`, and
`checkShardAuthors` enumerating through the ref rather than
`listShards` `[C lib/workspace-files.js:425-430,449]`) · `hooks/session-start.js`
(the automatic fetch on the async path) · `hooks/session-end.js` (the best-effort
last-batch flush) · `monitors/heartbeat.js` (the batch clock, beside the
keepalive it already keeps) · `hooks/stop.js` (the no-monitor fallback path,
which already re-uses `beat()` rather than copying it, and whose existing
deadline the push takes a slice of) · `bin/handshake.js` (`pair --state-branch`,
`branches`, the preflight, the `rejected` arm of `status`) · `lib/state.js` (the
deferred-push marker and the last-pushed-head record, as a sentinel beside the
existing ones `[C hooks/common.js:26-50]`, **not** in `state.json`, which hooks
read-modify-write on hot paths) · `.github/workflows/ci.yml`
`[C .github/workflows/ci.yml:13-15]`.

**Wire.** **None.** The state branch is git; nothing about it travels as an
envelope.

#### Credentials, signing, rejection, and the sessions that have no monitor

Four operational facts the first draft did not carry, each of which turns an
automated push into a hang or a permanent failure on a real developer's machine.

- **The push reuses the human's existing git credentials and is never given its
  own.** `defaultRunner` already sets `GIT_TERMINAL_PROMPT=0` on every call
  `[C lib/repo.js:67]`, so a credential helper that would prompt **fails instead
  of hanging** — which is the correct direction and is now a stated property
  rather than an accident. The **V1 preflight** proves it up front with a
  `git push --dry-run` against the intended ref.
- **`commit.gpgsign` is checked at preflight.** A developer with signing on gets
  a `pinentry` prompt with no controlling TTY, or a hard failure of every
  automated commit past its bound. This project's own e2e fixture already sets
  `commit.gpgsign false`, so the lesson was learned once and not carried forward.
  Automated commits pass `-c commit.gpgsign=false` explicitly, **or** the
  preflight refuses to enable the path until the human resolves it — and it says
  which.
- **A forge rejection gets its own `status` arm.** An org ruleset that requires
  signed commits, or restricts branch creation, rejects **every** push
  permanently; the only response the first draft had was a deferred count that
  never drains. `rejected` is a distinct state from `offline` (rule 5 above), and
  the `push refused` notice literal is already spoken for by the secret-scan
  refusal (§2.4 rank 3), so a rejection reports on the `status` line and in the
  rotation-style demand register, not by overloading a notice that means
  something else.
- **SessionEnd, headless and subagent sessions.** The monitor is hard-killed at
  session end with no signal and no exit event `[C monitors/heartbeat.js:11-13]`,
  so the last batch — including the session's closing `task.done` — is committed
  nowhere. `[P§8]` designates SessionEnd for exactly this and
  `hooks/session-end.js` exists, is wired and is best-effort by contract, 20 of
  21 `[C hooks/session-end.js:5-9]`, so it carries the **last-batch flush** inside
  its 3 s budget `[C hooks/session-end.js:17]`. **A headless session has no
  monitor**, so the state-branch batch rides the Stop-hook fallback at the
  transport keepalive rather than at 1/min — and `status` says so, in the same
  sentence it already uses for the heartbeat
  `[C bin/handshake.js:1305-1306]`. **A subagent does neither**: rule 7.2 already
  makes a child never post and never do network I/O, and every path here is
  behind the same `isChild` / `provenChild` verdict
  `[C hooks/session-end.js:33-34]` `[C monitors/heartbeat.js:43]`.

**Tests.** The commit is created with the member as author and the tool as
committer. Two batches inside one minute produce one commit. A push failure
leaves the local commit intact and retries on the next beat, and `status` reports
the deferred count — the offline queue's honesty rule, because a deferred write
that does not say it was deferred is a lie `[P§10.2]`. **A push rejected
non-fast-forward re-fetches and rebuilds rather than retrying, and `status`
reports `rejected`, not `offline`.** **A push rejected by a forge rule reports
`rejected` and the deferred count does not grow.** **Two clones committing in the
same second both land: the loser rebuilds on the winner's head and both members'
files are present in the resulting tree.** **Absence is proved with
`ls-remote --exit-code` and never inferred from a fetch:** exit 2 creates the
orphan root, exit 128 creates nothing and defers, and a test with an unreachable
remote asserts that **no root is created** — the rule-2 pin, because the fetch's
own exit code cannot tell the two apart. **A path deleted during a claim leaves
the resulting tree, and a renamed path appears once and not twice** — the
`--force-remove` arm, and the test the first revision's add-only sequence would
have failed silently. **An executable file keeps its `100755` mode across an
automated commit**, on a checkout with `core.fileMode` false. **A client offline for seven days
replays its queued batches into one commit chain with no data loss and no
duplicate records.** The branch is orphan: it
shares no commit with `main`, and a `git log main` after a hundred coordination
commits is byte-identical to before. **After a hundred state commits the human's
`git status --porcelain`, `git rev-parse HEAD` and `git symbolic-ref HEAD` are
byte-identical to before** — the `HEAD`-invariant test, and the one that would
have caught the `checkout --orphan` implementation. **Nothing outside the path
allowlist is ever committed, including a file dropped into `.handshake/` by a
future version.** No commit is created before the opt-in. **A tree with
no configured git remote creates no branch, makes no commit and attempts no
push; the shard is written and rides the next user-requested commit
`[C bin/handshake.js:893-896]`, `status` names the state as absent rather than
deferred, and the deferred count stays zero** — the `no_remote` reason
`[C lib/repo.js:131]` drives the branch and is not conflated with offline. A
public-repo verdict refuses the guarded part `[C lib/repo.js:36-48]`, **and under
ruling D2 refuses the whole automated push path unless the recorded override is
present.** **The preflight refuses to enable the path when the repo has a
push-triggered workflow with no `branches-ignore` covering `handshake/**`, and
the refusal contains the snippet.** **The preflight refuses when
`git push --dry-run` cannot run non-interactively, and when `commit.gpgsign` is
on and unresolved.** **The preflight records `git --version`, and on a git older
than 2.38 the state branch still ships while the stacking capability of V5 is
reported off** — the fifth precondition, and the test that would otherwise never
run, since both CI legs are above the floor
`[C .github/workflows/ci.yml:18-24]`. **A six-day-absent client that only runs `git fetch` gets
the peer's records in its SessionStart block** — the read half, pinned, and the
test §11.5 asserts. **SessionStart against an unreachable remote still clears the
pending marker and still runs the sync**: the fetch is abandoned at its 1,500 ms
bound, the scan answers from the last fetched ref and marks the result stale, and
the hook exits inside the 9,500 ms watchdog — the one test that would catch a
fetch budgeted at `GIT_NETWORK_TIMEOUT_MS` instead of §2.5's row. **A SessionStart
whose per-shard reads hang does the same**: the scan returns inside its 500 ms
with `truncated` set, the pending marker is cleared and the hook exits inside the
watchdog — the test that fails if the budget is reused at the width
`authorBudgetMs` has today, which wraps the author `git log`s and leaves the
`git show` reads unbounded `[C lib/shard-scan.js:128-142,189-192]`. A proven
child creates and pushes nothing `[C bin/handshake.js:387]` `[P§7.2 rule 1]`.
**SessionEnd flushes the last batch; a killed session loses at most that batch
and says so.**

**Tier: Opus xhigh.** This is the first code in the product that writes to a
remote without a human in the way. It gets M2's tier for M2's reason.

### 10.2 V2 — The two-human run, re-aimed

**Why here, and not later.** Decision 10 puts the two-human run **after the first
autonomy slice** so that it tests the new model early. That is a change of aim
from `[COBUILD-PLAN §2.1]` rung 2, which put M12(b) after the knowledge layer to
measure zero-setup volume and relay-deployment friction. Both aims now ride one
calendar event: the run still measures the ntfy day-long volume that decides
whether zero-setup stays the default rung `[P§9.3]` `[PLAN§7]`, and it now also
answers the questions only V1 can raise.

**What V2 can measure, corrected at the revision.** The first draft made V2 the
place the **secret-scan false-positive rate** is measured. It cannot be: the scan
is a **V4** deliverable, and V1's automated commits carry already-filtered shard
text `[C lib/workspace-files.js:365]`, not code diffs — the population the rate
is about does not exist yet. So the scan's rate is re-anchored to V4 (§12.2,
§14 item 14) and V2 measures the three things V1 genuinely raises, all of them
§12 risks and none of them answerable from one machine:

1. **Does a commit-per-minute branch feel like noise to a human** (§12.1)?
2. **Does the one-branch concurrency protocol hold** — how often does a push get
   rejected non-fast-forward, and does the rebuild loop converge (§10.1)? This is
   the number that decides §14 item 29.
3. **Does the read half deliver** — does an absent peer's SessionStart actually
   carry the other side's week (§11.5)?

**Delivers.** `[PLAN§5 M12(b)]`'s manual leg, run over V1: two accounts, two
machines, one repo, one working day. Plus the knowledge layer's own acceptance
`[KNOWLEDGE §10.1]`, which is now free to ride the same run.

**Touches.** No product code. A checklist, and the captured artifacts:
`knowledge.json`, the session-keyed sentinel, the state branch's reflog, the
count of rejected-and-rebuilt pushes, the per-beat timings of §2.5, and — added
at fix round 3 — **`git count-objects -vH` before and after the working day**,
which is what turns §12.1's state-branch growth residual from arithmetic into a
number.

**Tier: human + Opus high**, to write the checklist and read the result.
`[PLAN§5 M12]`'s split.

### 10.3 V3 — Declared symbols on claims

**Why third.** It is the cheapest wire change in the plan — one OPTIONAL field on
two existing types, no catalog amendment (§2.3) — and it is a prerequisite for
both remaining conflict cases: (b) needs it to stop warning needlessly and (c)
needs it to know two tasks touch one method. It is also the rung that makes
§7.3's parser question measurable instead of theoretical.

**Delivers.** `symbols` on `task.claim` and `task.change{scope}`, **with §2.3's
carriage rule: on the relay `task.change{scope}` is the authoritative carrier**;
the **discriminating-tail** `details[]` entry on the card (§7.1); the full
`path::Symbol.member` on the PreToolUse rendered line (§5.3); **the notices
rank order of §2.4 and its `+N !` overflow marker**, which land here because
this is the first rung that adds a notice-producing condition and the sort must
exist before it does; SKILL.md guidance on how to author a symbol list and when
not to bother, **inside the ceiling of §2.4's SKILL.md row**.

**Touches.** `lib/envelope.js` (the body validator and the named `authoredFields`
case `[C lib/envelope.js:220-222]`, plus the `task.change` case at
`[C lib/envelope.js:230-233]`) · `hooks/render.js` (one `details[]` entry, no new
rung; **the notices sort replacing the bare `.slice(0, 2)`
`[C hooks/render.js:187]`, and the `+N !` literal**) · `hooks/common.js` (the
notices are assembled there and must carry a rank
`[C hooks/common.js:594-614,668-673]`) · `hooks/pre-tool-use.js` (the rendered
line only) · **`hooks/sync.js`** (`mergeClaimFiles` extended to harvest
`symbols` out of `task.claim` / `task.change{scope}` bodies into
`peers.claims[].symbols` — §7.1, and the reason V3 needs a harvest at all
`[C hooks/sync.js:89-126]`) · **`lib/state.js`** (the `symbols` array on the
cached claim row) · `bin/handshake.js` (`claim --symbols`, `change --symbols`,
**and the CLI `sync` path merging rather than overwriting the claim rows**
`[C bin/handshake.js:1006-1010]`) ·
`skills/handshake-coordination/SKILL.md` **and `references/`** (§2.4) ·
`docs/PROTOCOL.md` §3.2.

**Wire.** **V-D2**, a proposed Appendix B v1.1 delta on `[P§3.2]`. Not a catalog
amendment; §3's `[F]` line is untouched. **No relay change** — §2.3's carriage
finding is why.

**Tests.** A v1.0 client accepts an envelope carrying `symbols` and ignores the
field — pinned against `validate()` `[C lib/envelope.js:365-414]`, which is the
whole argument of §2.3 and must not be allowed to rot. **A relay round trip
carries `symbols` on `task.change{scope}` verbatim and the claim endpoint drops
it** — the carriage rule, pinned, because it is the thing the first
draft got wrong. **And the carriage test is the durable one, not the
arrival one, corrected at fix round 3:** symbols arrive on **one**
`task.change{scope}`, that envelope is consumed by the watermark
`[C hooks/user-prompt-submit.js:84-98]`, and on a **later** turn the card still
renders the tail and the PreToolUse gate line still prints the full
`path::Symbol.member` — which is what the harvest of §7.1 exists for and what
*"the client reads the symbols from the envelope, not from `sync.claims[]`"*
would have passed on the arrival turn while both surfaces went empty
afterwards. **A `handshake sync` run after the harvest does not lose them**
`[C bin/handshake.js:1006-1010]`. **A harvested `symbols` entry never lands in
`peers.claims[].files`**, so it can never become a gate path match. The gate
still warns on a
path match with disjoint symbols, and the rendered line names both symbol sets **in
full**. **The card's `details[]` entry contains the symbol's tail and not the
path** — the assertion §11.1 makes in substance, so it must be true mechanically
`[C hooks/render.js:97-100,138]`. A
peer-supplied symbol string never reaches a filesystem path. **A rotation demand
plus two coordination notices renders the rotation demand** — the rank order,
pinned against the condition that already exists today
`[C hooks/common.js:668-673]`. **Three notices render two plus `+1 !`, and none
vanishes silently** `[P§10.2]`. **The re-measurement
gate:** the standing block with two symbol-scoped claims **and two notices with
the overflow marker** stays under 600, and
`dropDetails` `[C hooks/render.js:253]` drops the symbol before anything
untrimmable — a gate, not a note, exactly as `[COBUILD-PLAN §3.S0]` makes it.
**The SKILL.md gate:** the file's line count after this rung is under the
ceiling §2.4 states, or the rung does not ship.

**Tier: Opus high.** Mechanical, against a hard budget and a frozen render ladder.

### 10.4 V4 — Own-branch code push and the commit secret scan

*(The CI skip was in this rung's title in the first draft. It is not in this rung
at all any more: §4.2 item 4 makes it a **V1** preflight precondition, and this
repository's own two lines of YAML went to V1 with it, because V2 runs the
machine-cadence push and §12.1 already claimed the mitigation as live.)*

**Why after V3 and not before.** The branch name derives from the claim, and a
work branch whose scope nobody declared is a live view of an unknown blast radius.
More practically: this is the rung that makes a Claude's unfinished code visible
to another person's machine, and it should ship after the run in V2 has said what
a commit-per-minute branch actually feels like.

**Delivers.** `handshake/<member>/<subject_key>` **[proposed]**, one per claim,
created on claim and pushed freely, **with a ref-name sanitizer of its own** (§14
item 2, below) **and its base commit recorded at acquisition** (§14 item 43,
below); the fail-closed commit secret scan of §4.2 item 1, **as its own
caller with the code-shaped battery, and the tripwire needle filter of §4.2
item 1**; ruling D2's coverage rule — commit
messages and branch names scanned, binaries and non-UTF-8 files never
auto-committed; ruling D1's `--force-with-lease` helper, pattern-restricted and
lease-valued from the tool's own recorded head; `presence.update.branch` populated
from the work branch rather than left to the human `[C bin/handshake.js:1782]`;
**and the three counters §12.2's cut trigger needs — scan attempts, refusals, and
one human-adjudication line per refusal** — because the trigger is anchored here
and a trigger with no instrument is a mood.

#### What the work-branch commit takes, and what it never touches

**The first draft pinned the state branch's mechanism precisely and left the
harder case blank**, and the blank is the dangerous one: the tool and the human
share one checkout, so a commit with no stated path filter is `add -A` shaped and
publishes the human's half-edited config, scratch files and debugging patches to
a shared remote by a process they did not invoke. The secret scan does not catch
that — it checks for secrets, not for *"the human did not want this
published"* — and none of the first draft's five tests would have failed.

- **The commit takes only the paths on that claim's own progressive `files[]`**,
  which `hooks/post-tool-use.js` already maintains as a capped union of real
  writes `[C hooks/post-tool-use.js:79-91]`. It is the one list in the system
  that is *observed* rather than declared, which is exactly why it and not
  `symbols` is the filter (§7.1).
- **Files outside the claim are never committed** — not staged, not stashed, not
  touched. A dirty unrelated file stays dirty.
- **`HEAD` never moves**, and the mechanism is the same temp-index plumbing V1
  specifies for the state branch (§10.1): `GIT_INDEX_FILE` → `read-tree` →
  `update-index` (with the `--force-remove` arm and the parent-tree mode of
  §10.1) → `write-tree` → `commit-tree -p` → `update-ref`. No checkout,
  no `git add`, no `.git/index`.
- **The base tree and the parent are the work branch's own, and they are stated
  here because §10.1's operands are the state branch's — added at fix round 3.**
  §10.1's block names *"the fetched state head, or empty"* for both `read-tree`
  and `-p`, which is meaningless for `handshake/<self>/<subject>`, and read
  literally its *"or empty"* arm would produce a **parentless** commit whose
  tree is only the claim's `files[]` — contradicting §11.2's *"Bob's tree
  contains Alex's unmerged commits"*, §12.3's restack-before-the-PR, and every
  PR this design expects a human to open. The claim's `files[]` filter bounds
  what is **staged**; it does nothing about what the base tree **contains**, so
  seeding from live `HEAD` on each beat makes a beat after the human commits or
  switches branch publish unrelated additions and **deletions** — verified at
  fix round 3: with only `a.txt` staged, a beat seeded from a moved `HEAD`
  produced `M a.txt / A other.txt / D shared.txt` against the previous beat.
  **So [proposed — §14 item 43]:**
  1. **The base commit is recorded when the claim is acquired** — the sha the
     human's `HEAD` had at that moment — into the same per-workspace state the
     lease's last-pushed head uses `[C hooks/common.js:26-50]`.
  2. **The first commit of a claim** seeds `read-tree <recorded base>` and
     commits `-p <recorded base>`.
  3. **Every later beat** seeds `read-tree <the work branch's own previous
     commit>` and commits `-p <that commit>`, so the branch is a linear chain
     from the recorded base. **Never live `HEAD`**, which moves between beats and
     is the human's.
  4. **When the human's `HEAD` moves off the recorded base the branch keeps its
     base and diverges**, and `handshake branches` says how far behind it is
     beside the stack parentage §12.3 already asks it to show. Restacking it
     onto the new head is *permitted* — it is `handshake/<self>/*` and ruling D1
     puts a lease-protected rewrite of that pattern below the floor — but it is
     **not automatic**, because a rewrite fires the stack-invalidation rule
     (§5.4) on any peer stacked on this branch, for a reason that peer cannot
     see. Restacking stays the human operation §12.3 already names, before the
     PR.
- **One active work branch per member** **[proposed]**, because a member holding
  two claims owns two branches but **one** content state, so without this each
  claim's edits land on both. The branch follows the member's most recently
  acquired live claim — the same `getOwnClaims` ordering `post-tool-use` already
  uses to pick which claim to append to `[C hooks/post-tool-use.js:82-84]`. The
  alternative, one shared branch for concurrent claims, is §14 item 30.

#### A filename sanitizer is not a ref-name sanitizer

The first draft reused `shardFileName`'s rule for the branch name (§14 item 2).
It is the right *instinct* — derive, never accept — and the wrong *rule*, and it
leaves two permanent, silent, un-retryable failures, both verified against
git 2.53:

- **`shardFileName` preserves interior dots** `[C lib/workspace-files.js:294]`,
  so a member id of `alex.lock` yields the path component `alex.lock`, and git
  refuses any ref component ending in `.lock` outright. That member can never
  create a work branch, on any subject, forever.
- **A member whose id sanitizes to `state` collides with `refs/heads/handshake/state`**
  by git's directory/file rule: with the state branch present,
  `handshake/state/<subject>` cannot be created, and without it the state branch
  cannot be. Member ids are peer-authored free text `[C lib/workspace-files.js:287-289]`.

So V4 ships a **ref-name sanitizer** **[proposed]**, separate from
`shardFileName` and beside it: strip a trailing `.lock` from **every** slash
component, reject any component beginning with `.`, apply the existing
character-class and length rules per component, **reserve `state` as a
member-component name** (a member sanitizing to it gets `state-member`, the shape
`RESERVED_BASENAMES` already uses `[C lib/workspace-files.js:290,296]`), and
**validate the result with `git check-ref-format --branch`** rather than trusting
the regex — the same posture as asking `gh` rather than guessing visibility. Both
cases join V9's corpus.

**The PR-open push suspension** (§4.2 item 4, §14 item 44). Once a PR exists for a
work branch — read with `gh pr list --head <branch>` beside the visibility call
`[C lib/repo.js:150]`, on the same 600 s TTL `[C lib/repo.js:25]` — that
branch's automated push stops and `status` says so; the human's own pushes carry
it from there, which is the right direction anyway, since opening a PR is above
the floor. Unproven (`gh` absent or unauthenticated) takes the same fail-closed
arm as an unproven visibility verdict: the push stops. Without this, `branches-ignore`
on `push` closes one door and `pull_request`'s `synchronize` event reopens the
other (§12.5).

**Touches.** `lib/repo.js` (the work-branch commit, the lease-protected push, the
PR-open probe beside the visibility probe) ·
`lib/workspace-files.js` (the ref-name sanitizer, beside `shardFileName` and
sharing nothing with it but the derive-never-accept rule) ·
**a new `lib/commit-scan.js`** — the scanner is **its own caller**, importing
`PATTERNS`-equivalent shapes and the tripwire; **`check()`'s contract and
`MAX_BYTES` are not touched** `[C lib/filter.js:22,251-272]`, and no window
mechanism is needed because the new caller does not go through `check()` ·
`lib/filter.js` (**export-only**: the tables and the tripwire become reachable to
a second caller; no behaviour change, and every existing regression test stays
green by construction) · **`lib/state.js`** (the recorded base commit per claim
and the last-pushed head for the lease, as sentinels beside the existing ones
`[C hooks/common.js:26-50]`) · `monitors/heartbeat.js` · `bin/handshake.js` ·
`docs/SECURITY.md` (§13.6).

**Wire.** **None.** `branch` already exists on the presence body
`[C docs/PROTOCOL.md:295]`.

**Tests.** A work branch with an open PR — a mocked `gh pr list --head` hit —
receives no automated push and `status` reports the suspension; an unproven `gh`
verdict suspends too; a PR closed while the claim is still live resumes the push
on the next TTL expiry. A commit containing a value from a local `.env` is refused, and nothing
is committed, pushed or advanced — the shape `[COBUILD-PLAN §3.S2]` requires of a
`sendGate` refusal. **The battery scans this repository's own tracked tree and
returns zero findings**, with the enumerated fixture-and-definition exclusion of
§4.2 item 1; the test fails if a new tracked file trips it, which is what makes
the exclusion a list rather than a loophole. **Each of the four exclusions has a
test named for the false-positive class it removes**: `const tokens =
learnedPathTokens(e.paths);` is allowed (`secret-assignment`); 2 KB of ordinary
source is allowed (entropy pass and the stripped variant); three consecutive
`UPPER=value` shell lines are allowed (`env-block`); and a 40-hex string with no
credential word within 24 chars is allowed `[SEC§4]`. **And the fifth narrowing
has its own test, on a fixture the tripwire can actually read**: with an
ordinary `application.yml` and `.npmrc` present, the six samples §4.2 item 1
names are allowed and a real value from the fixture is still refused — the test
that would have caught a control the 66-file run cannot exercise at all. **A commit message
containing a `hsk_` token is refused, and so is a branch name containing one** —
ruling D2's coverage rule. **A binary or non-UTF-8 file on the claim's `files[]`
is never auto-committed, and `status` says which file is waiting for a human.**
**A dirty unrelated file is never pushed, and `git rev-parse HEAD` /
`git symbolic-ref HEAD` are unchanged after a work-branch commit.** **A
force-push on any ref outside `handshake/<self>/*` is refused with no git process
spawned, and bare `--force` is never emitted on any path** — ruling D1 rule 3.
**The lease value is the tool's own recorded sha**, not the remote-tracking ref:
a test in which a background fetch has advanced the tracking ref still refuses.
**With no recorded sha at all — a cleared state directory — the force-push is
refused with no git process spawned**, and the notice renders; the test asserts
that neither a valueless `--force-with-lease` nor a lease value read from
`ls-remote` is ever emitted (D1 rule 1, fail-closed arm). **A claim that deletes
a file, and a claim that renames one, each produce a work-branch tree with the
old path gone** — the `--force-remove` arm of §10.1, against a `files[]` that is
a monotonic union and still lists the deleted path
`[C hooks/post-tool-use.js:79-91]`. **A beat taken after the human has committed
on their own branch and switched away publishes neither the human's additions
nor a deletion of anything** — the base-and-parent rule above, and the test that
discriminates its three plausible readings where `git rev-parse HEAD` and
`git symbolic-ref HEAD` pass under all of them.
The branch name of a subject containing `../`, a device name, or a `refs/` prefix
is refused or sanitized to something **`git check-ref-format --branch`** accepts,
and nothing traverses.

**Tier: Opus xhigh, with a 3× adversarial fan-out on the scan.** This is a
security control on an automatic path, and `[SEC§4]`'s own lesson is that *"a
denylist is only as good as its last adversarial review."*

### 10.5 V5 — Stacking and sequencing

**Why here.** It is the first rung that is pure autonomy — no new human-facing
surface, no new consent, no new file. It needs V1 (the branch is fetchable), V3
(the symbols say the tasks collide at a method) and V4 (there is something on the
branch to fetch).

**Delivers.** The `ls-remote` branch-moved derivation (§5.4) — **no wire delta**;
the peer-branch string validation at the receive boundary, **on both legs and
against a different id on each** (§5.4); the namespaced-ref
fetch and the throwaway-worktree evaluation of §4.2 item 5, with its
**locally derived path allowlist, its `git diff --raw` mode rule and the
instruction/build floor underneath both**, the worktree created only after
those and the probe have passed; the **`merge-tree --write-tree` probe**
(not a rebase dry-run, which does not exist) **behind the recorded
`git --version` gate of §5.4 mechanism 2 — below 2.38 the whole capability is
off, and no fallback probe is shipped**; the rebase decision, its
instability counter — **which a real rebase that conflicts after a clean probe
also increments** (§5.4 mechanism 2) — and its lease-protected push (ruling D1);
the lexicographically-smaller-never-stacks ordering rule; stack invalidation; the
three-trigger sequence-and-resume rule; the abandoned-worktree startup sweep
**as `git worktree remove --force` plus `git worktree prune`, not an unlink**
(§5.4 mechanism 3); the
stack `details[]` entry and the rebase-needed notice; `handshake branches
--fetch`, **showing stack parentage and not only age** (§12.3).

**Touches.** `lib/repo.js` (`ls-remote`, the refspec fetch, `merge-tree`, the
worktree lifecycle, the sweep, the network timeout of §2.5, and the ref
re-derived from the member id rather than accepted) ·
`lib/transport-ntfy.js` (**receive-side validation of a peer's `branch` against
the signed `from.member`**, on the presence assembly
`[C lib/transport-ntfy.js:284,300-301]`) · `lib/transport-relay.js` (**the same
rule against the server-authoritative `member_id`**, on the `sync.presence[]` map
that has no shape check today `[C lib/transport-relay.js:259-268]`) — both are
client transports, not `relay/**`, so B5's *"no relay file enters any rung's
Touches"* is untouched, and **not** `lib/envelope.js`, for the reason §5.4 gives ·
`monitors/heartbeat.js`
(the `ls-remote` poll, on the clock it already runs) · `hooks/common.js` (the
derivation into the view, and the notice rank) · `hooks/render.js` (one
`details[]` entry, one notice) · `lib/state.js` (the last-seen peer head, the
last-pushed own head for the lease, the instability counter) ·
`skills/handshake-coordination/SKILL.md` **and a `references/` file for the
stack tree** (§2.4's ceiling).

**Wire.** **None.** V-D1 was withdrawn at the revision (§2.3); the branch fact is
read, not received.

**Tests.** A head that did not change produces no fetch. **A peer `branch` of
`--upload-pack=…`, or one whose member segment is not the authenticated sender,
is refused with no git process spawned — run on both legs**: against the signed
`from.member` on the ntfy presence assembly, and against the server-authoritative
`member_id` on the relay's `sync.presence[]` parse, which is where the primary
tier's branch string actually arrives. The option-injection corpus goes to V9. **A peer diff whose paths all sit under
the locally derived allowlist rebases automatically; a diff with any path
outside it refuses and renders a notice** — asserted on the surfaces the first
revision's denylist named (`CLAUDE.md`, `.claude/**`, `.github/**`,
`.handshake/**`, a `package.json` script, a lockfile, `Makefile`) **and on the
ones it did not** (`.mcp.json`, a non-root `CLAUDE.md`, `.husky/**`,
`.gitlab-ci.yml`, `GNUmakefile`, `Dockerfile`), each individually — which is the
point of an allowlist: the second group needs no new list entry to be refused.
**And the mode rule, which no path rule can see: a peer diff that turns a file
on an allowed path into a symlink, adds a gitlink, or flips an executable bit
refuses**, computed from `git diff --raw` and asserted against a `--name-only`
implementation, which passes the path rule on that same diff. **No build,
install or test command runs in a tree carrying
unmerged peer commits.** **The evaluation leaves the human's working tree
byte-identical: `git status --porcelain` before and after a probe, clean and
dirty, match** — and a probe that is hard-killed mid-run leaves no
`.git/rebase-merge`, no conflict markers and no detached `HEAD` in the human's
checkout, because it never ran there. **A worktree abandoned by a kill is swept
at the next startup, and — the test that discriminates a `git worktree remove
--force` + `prune` sweep from an `rm -rf` — the next probe at the same path
succeeds** (§5.4 mechanism 3; an `rm -rf` passes every other test in this list
and fails this one). A dirty probe
leaves the local branch untouched and renders the notice. **A real rebase that
conflicts after a *clean* probe aborts in the worktree, drops the stack, routes
to sequence and increments the instability counter** — the arm §5.4 mechanism 2
adds, pinned against the reproduction it names (a net-empty endpoint diff whose
intermediate commit conflicts), because the probe is a proxy for the rebase and
not the rebase. **On a git older than 2.38 the stacking capability reports off
and no probe runs at all**, and the test asserts that no `apply --check --3way`
fallback is emitted — it exits 0 on a real conflict and would report a dirty
base as clean. The instability counter
trips at the bound and switches to sequence. **A sequenced task resumes on the
peer's `task.done`, and on the base claim expiring, and on nothing else** — in
particular, **not** on a peer note saying the work is finished, which is the
never-list in test form. **Two clients that both read *stack* both apply the
ordering rule and exactly one stacks.** **A base rewritten by the peer's own
lease-protected push, a base rewritten by a human, and a deleted base all produce
the same verdict: stack dropped, sequence, one notice.** **A client already
stacked does not stack a second base.** Two clients evaluate the
same head sequence and reach the same verdict with no message exchanged. **The
second re-measurement gate:** the block with a symbol detail and a stack detail on
each of two claims.

**Tier: Opus high**, and Opus xhigh for the SKILL.md text, which is M7's tier for
M7's reason, **and Opus xhigh for the inbound untrusted-peer-tree guardrail
(§4.2 item 5) with the per-leg branch validation above** — a security control on
an automatic path, which is V4's tier for V4's reason. §10.9's table says the
same; the omission was here, not there.

### 10.6 V6 — The contradiction protocol

**Why sixth.** It is the only rung that needs a ratified wire type it does not
own: it rides `task.seam`, whose Appendix B rows E1–E3 are `[COBUILD §11]`'s and
are **unratified**. So V6 cannot start until `[COBUILD-PLAN §3.S0]` has been
ratified and S1–S2 built. That is a real dependency and it is stated as a
scheduling fact, not a preference (§10.9).

**Delivers.** `contested` and `rationale` (**V-D3**); **§6.0's round-open rule as
code** — a round exists iff a `task.seam{propose, contested: true}` exists, and
nothing else in the client may create one; the bounded-round counter;
the escalation path with both reasons attached, bounded by the seam TTL (§6.4);
`handshake contested`; the two notices at their ranks (§2.4); SKILL.md's revision
discipline for a contradiction — *author the shape your half requires; never
reply to their prose* — **in `references/`, with only the trigger condition left
in SKILL.md proper** (§2.4's ceiling).

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
`[COBUILD §5.4]`'s derived-not-transmitted rule. **An unclean `merge-tree` probe
opens no round by itself** — it routes to sequence, §5.4's discriminator, pinned
so the two rules cannot be conflated again. **A clean probe with a contradiction
under it can still open one**, which is the case §6.0 exists for. **The two legs
are asserted separately: on the relay a round of two revisions completes with
zero human turns; on ntfy the same round requires exactly one `handshake seam
pull` confirmation per inbound revision per receiving side, and the test asserts
that count rather than asserting zero** `[COBUILD §2.6]`.

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
| **V1** | The state branch: orphan `handshake/state`, **temp-index write path**, **the one-branch concurrency protocol**, author/committer split, ≤ 1/min batch on the monitor clock, deferred push with a `rejected` arm, **the read half — fetch + `ref`-threaded scan + `readShardFromRef`**, the SessionEnd flush, opt-in with D2's verdict + **the five preflight preconditions (visibility, CI filter, non-interactive push, `commit.gpgsign`, and the recorded `git --version`)**, `branches-ignore` on this repo's own workflow, `handshake branches` | Opus **xhigh** |
| **V2** | The two-human run — `[PLAN§5 M12(b)]` re-aimed at V1, carrying `[KNOWLEDGE §10.1]` on the same calendar event | human + Opus high |
| **V3** | Declared symbols: **V-D2** with its carriage rule, the tail-only `details[]` entry, the gate line's full symbol, **the seven-kind notice rank + the `+N !` marker**, SKILL.md within its ceiling; **re-measure the block (gate)** | Opus high |
| **V4** | Work branches (**claim-`files[]` only, `HEAD` never moves, ref-name sanitizer**) + the fail-closed commit secret scan (**its own caller, code-shaped battery, four named exclusions, the tripwire needle filter, D2's coverage rule**) + ruling D1's lease-protected push, **fail-closed with no recorded head** + **the PR-open push suspension** (§4.2 item 4, §14 item 44) | Opus **xhigh**, 3× adversarial fan-out on the scan |
| **V5** | Stacking and sequencing: **no wire delta**, `ls-remote` derivation, **peer branch validated on both legs** (signed `from.member` on ntfy, server-authoritative `member_id` on the relay), namespaced fetch + the **locally derived path allowlist, the `git diff --raw` mode rule and the instruction/build floor**, then the throwaway worktree, `merge-tree` probe **behind the git-2.38 gate with no fallback**, instability **including a rebase that conflicts after a clean probe**, ordering rule, stack invalidation, three-trigger resume, the **`worktree remove --force` + `prune`** sweep, the stack detail; **re-measure (gate)** | Opus high; Opus **xhigh** for SKILL.md **and for the inbound guardrail** |
| **V6** | The contradiction protocol: **V-D3**, bounded rounds, escalation with both reasons, `handshake contested` | Opus **xhigh** |
| **V7** | The trusted pair: the capability table, `handshake pair`, the migration, the permanently empty `note.*` row | Opus **xhigh** |
| **V8** | Coordination-outcome records: one `SHARD_KINDS` entry, the scan's kind list, the two measurements | Opus high |
| **V9** | SECURITY.md consolidation (§13.6) + the red team over the whole stage: injection through `rationale`; **a hostile fetched work branch — instructions in any `CLAUDE.md` at any depth, `.claude/**`, `.mcp.json`, `AGENTS.md`, `.husky/**`, a `postinstall` in `package.json`, a poisoned lockfile, a workflow on any forge, and a symlink / gitlink / exec-bit change on an otherwise-allowed path**; **a peer `branch` string as an option-injection corpus**; a branch-name corpus including `alex.lock` and a member sanitizing to `state`; the exfil corpus against an automated commit **and against a commit message and a branch name**; impersonation on ntfy | Opus **xhigh**, 3× adversarial fan-out |
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

**One gate crosses every rung, added at the revision: the `SKILL.md` ceiling of
§2.4.** V3, V5, V6, V7 and V8 all edit that file, and no rung ships if it crosses
480 lines. It is checked at the end of each of those five rungs, not once at the
end, because a ceiling checked once is a ceiling the fourth rung discovers.

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

**Two scoping clauses, both added at the revision, because the first draft's
pass criteria were unachievable as written on one of the two legs.**

1. **"No command is typed to cause coordination" is scoped by §3's turn-scoping
   law.** It means no coordination *command*; it does not mean a Claude acts
   while nobody is at the keyboard. Every autonomous step below happens at a
   model turn in a session that is running.
2. **Expected results are stated per leg wherever the two differ.** Two of those
   differences change a **pass criterion**: the contradiction protocol (below)
   and the security assertions of §11.6, where `from` is server-authoritative on
   the relay and self-declared on ntfy — which is why the peer-branch check keys
   on a different id on each leg (§5.4) and why a per-peer grant is enforceable
   on one and advisory on the other (§9). **One changes only what is rendered,
   not what either leg must achieve**: §11.5's `· older chatter gone`
   `[C hooks/render.js:70]`, asserted on the ntfy leg and absent on the relay.
   *(Fix round 3: that clause read "and no criterion", which the line's own home
   falsifies — it sits inside §11.5's **Asserted** paragraph, where this
   document's pass criteria live, so it is a per-leg criterion. What it is not
   is a criterion about what either leg must **achieve**, which is the
   distinction the other two carry and the one the scope was reaching for.)*
   On the first: `task.seam{contract}`
   materializes automatically **iff** the transport is authenticated, and on ntfy
   each inbound revision waits on `handshake seam pull <id>` and a typed
   confirmation `[COBUILD §2.6]` — a control this plan reuses **unchanged** and
   deliberately does not weaken. So §11.3 and §11.4 assert *zero human turns* on
   the relay and *one confirmation per inbound revision per receiving side* on
   ntfy. Asserting zero on both would have produced either a false failure verdict
   at V6 or, worse, an implementer removing the gate to make the test pass. §12.7
   states the consequence: **autonomous contradiction resolution is a relay-tier
   capability.**

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
Neither Claude stopped. Neither Claude asked. **The card's `details[]` entry
reads `Handler.limit` — the discriminating tail, not `src/api/handler.ts:…`** —
and the gate line carries the full `src/api/handler.ts::Handler.limit` (§7.1,
§5.3); the block is under 600. **A mechanical assertion that "a `details[]` entry
is present" does not pass this scenario**: the entry's *content* is the claim
being made, which is what §10.3's "must not be allowed to rot" language exists to
prevent. A control run with `symbols`
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
`branch: handshake/alex/retry-policy`; it validates that string against Alex's
signed member id (§5.4), reads the branch's head with `ls-remote`, and — because
`alex` sorts before `bob` and the smaller id never stacks (§5.4) — **Bob is the
one who stacks**. It fetches into a namespaced ref, **confirms from
`git diff --raw` that every path in Alex's diff sits under the locally derived
allowlist and that no mode changed**, probes with `merge-tree` — both of those
checkout-free — **and only then creates the throwaway worktree**, in that order,
because either of the first two can refuse the whole operation and a worktree is
a checkout (§4.2 item 5). It rebases its work on Alex's head and
force-pushes its own branch with a lease (ruling D1), then keeps building. Alex
pushes twice more; each push moves the head `ls-remote` returns; each move
triggers one fetch and one clean rebase on Bob's side.

**What each human sees.** Alex: nothing at all — Alex's Claude is not doing
anything unusual. Bob: one line at a boundary, *"building on alex's branch for
`Client.request`."* Then nothing. No human types anything.

**Asserted.** Bob's tree contains Alex's unmerged commits and Bob's work on top.
Neither branch was merged, no PR was opened, `main` is untouched. **Bob's
force-push carried `--force-with-lease` with the sha Bob's own tool last pushed,
and no other ref was force-pushed** (ruling D1). **Exactly one side stacked.**
**Neither machine ran a build, an install or a test in a tree carrying the
other's commits.** The stack
`details[]` entry renders and disappears under trimming without taking anything
untrimmable with it. Alex's Claude was never asked for permission and never told
to stop. **If this exchange needs a human turn, the rung failed** — on **both**
legs, because nothing in this scenario touches the one control that differs
between them (§11 preamble).

### 11.3 A contradiction resolved by splitting the flag, with no human

**Setup.** Same symbol as 11.2. Alex's retry policy requires
`Client.request(..., idempotent = true)`; Bob's timeout handling requires
`idempotent = false` for the streaming path. Both are right about their own half.

**What each Claude does.** **Bob's Claude's `merge-tree` probe applies cleanly —
and that is the point.** `idempotent = true` set in one function and read in
another composes perfectly at the text level; git sees nothing wrong, and nothing
mechanical ever will. What sees it is Bob's Claude **reading** the fetched diff
in the evaluation worktree and judging that the two halves require incompatible
values of one named thing — §3's one sanctioned use of judgement, §6.0's part 1.
It then does the only thing that opens a round: it posts a `task.seam` with
`contested: true` naming `Client.request::idempotent`, and authors rev 1: the
contract text stating **what Bob's half needs**, with a ≤ 280-char `rationale`
(*"streaming responses cannot be replayed; retry on a partial stream duplicates
output"*). Alex's client materializes rev 1, Alex's Claude reads the rationale as
**data**, and — because a peer sentence may change what it proposes — authors
rev 2: the flag is split into `idempotent` and `replayable`, with its own
rationale. Bob's client materializes and adopts. Both Claudes regenerate against
the adopted revision and continue.

**Expected result, per leg.** **Relay: two revisions, zero human turns** —
`capabilities().authenticated_from` holds, so each `contract` materializes
automatically `[COBUILD §2.6]`. **ntfy: two revisions, two human turns** — one
`handshake seam pull` confirmation per inbound revision per receiving side, so
the round runs at human cadence and the pass criterion is *the round converged
inside the bound with no human deciding the requirement*, not *nobody typed*.
The first draft asserted zero on both and that was not achievable on the default
tier.

**What each human sees.** One notice each, in the existing notices channel, while
the round is open. One line each when it closes: *"alex and I split `idempotent`
into `idempotent`/`replayable`; both halves build against rev 2."*

**Asserted.** The round closed inside the bound. **No human decided the
requirement, and on the relay no human typed at all** (per-leg, above). The
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
standing block. An escalation nobody answers expires on the seam TTL — default
2 h, maximum 24 h `[COBUILD §7.1]` `[C relay/src/lib/config.js:6-7]` — and
announces nothing `[COBUILD §5.4]`. **Per leg: the relay reaches three revisions
and the escalation with zero human turns; ntfy reaches the same state with one
`seam pull` per inbound revision per side (three revisions ⇒ three
confirmations), and the escalation itself is identical because it is rendered
from local state on each machine.**

### 11.5 The absent peer, served by the state branch

**Setup.** Bob shuts his laptop on Thursday and returns the following Wednesday —
six days, past ntfy's ~12 h cache `[P§9.3]` and at the edge of the relay's 7-day
window `[P§9.2]`. Alex works through it.

**What each Claude does.** Alex's Claude keeps committing to `handshake/state`
every minute and to `handshake/alex/<subject>` as it works. On Wednesday Bob
starts a session and **Bob's SessionStart fetches the state ref itself** — the
async path is the one hook allowed to touch the network
`[C hooks/session-start.js:5-6]`, and the read half of §10.1 is what puts the
fetch there; **no human types `git fetch`**. The scan then runs **against the
fetched ref, not the working tree** — `scanShards` with a `ref`, reading through
`git show` rather than `fs.readFileSync` `[C lib/shard-scan.js:178-192]` — still
before the network sync, and inside the **9,500 ms watchdog**
`[C hooks/session-start.js:24]` on §2.5's split of 1,500 fetch + 500 scan +
7,000 sync, where the 500 is the **whole** scan and not just its author check
(§2.5's SessionStart row, and the widening it requires). It is *not* inside the injector's `PENDING_WAIT_MS = 500`
`[C hooks/common.js:58]`, and the first draft's claim that it was is corrected in
§10.1: a first prompt arriving mid-fetch is told `sync pending`
`[C hooks/render.js:67]`, which is what that marker is for. Bob's
first prompt carries the once-per-session block with Alex's week of learnings and
outcomes, attributed and dated `[C hooks/render.js:304]`.

**The first draft said this was *"local disk I/O"* after a plain `git fetch`, and
both halves were wrong**: a fetch writes objects that no working-tree read can
see, and nothing in the product fetched. Reading a ref is a bounded subprocess,
not disk I/O — so it carries the budget and the truncation verdict of §10.1, and
a scan that runs out of budget reports `truncated` rather than reporting less
`[P§10.2]`.

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
`[C lib/filter.js:226-249]`. **A commit *message* and a *branch name* carrying a
credential are refused the same way** (ruling D2). **A binary or non-UTF-8 file
is never auto-committed.** A subject engineered to produce a traversing branch
name is refused or sanitized to something `git check-ref-format --branch`
accepts, **and so are the two cases a filename sanitizer misses: a member id of
`alex.lock` and one that sanitizes to `state`** (§10.4). A public-repo verdict
refuses the guarded part and demands rotation `[SEC§6]`, **and under ruling D2
refuses the whole automated push path absent a recorded override**. A peer's
`symbols` string never becomes a filesystem path.

**The inbound corpus, which the first draft had no assertions for at all
(§4.2 item 5).** A peer's `branch` string of `--upload-pack=…`, of
`refs/heads/../../x`, or whose member segment is not the authenticated sender, is
refused **with no git process spawned** — and **on each leg through that leg's own
mechanism**: on ntfy the segment is checked against the signed `from.member` in
the presence assembly, on the relay against the server-authoritative `member_id`
on the `sync.presence[]` parse path, **discarded and counted** there (§5.4).
Asserting this only against `from.member` would leave the primary tier unguarded,
which is what the fix-round-1 pass corrected. **A fetched peer branch whose diff
puts any path outside the locally derived allowlist refuses the automatic
rebase** and renders a notice — asserted on the seven surfaces the first
revision's denylist named *and* on `.mcp.json`, a non-root `CLAUDE.md`,
`.husky/**`, `.gitlab-ci.yml`, `GNUmakefile` and `Dockerfile`, which that list
did not (§4.2 item 5). **A diff that introduces a symlink, a gitlink or an
executable bit on an otherwise-allowed path refuses too**, read from
`git diff --raw`. A fetched peer branch carrying instruction text in **any**
`CLAUDE.md`, at any depth, never
reaches the live tree, so it never reaches a later session's context — the
`[SEC§5.4]` rule extended to the one git path this stage adds. **No build,
install or test command runs in a tree carrying unmerged peer commits.** The
human's working tree is byte-identical before and after every evaluation.

A spoofed `from` on the relay is refused at the
source `[C relay/src/do/workspace.js:599-605]` `[P§9.2]`; **on ntfy `from` is
self-declared and a per-peer grant is advisory there, which §9 states and this
run records rather than disproves.** A passive ntfy subscriber holding the topic
but not the secret learns no branch name — `branch` is in the encrypted body
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
monitor's own clock, never on tool cadence `[P§8]`; **CI is skipped on
`handshake/*` wherever the V1 preflight has proved it is — and where it has not,
the automated push is not enabled at all** (§4.2 item 4), which is the corrected
form of a claim the first draft made unconditionally; and V2 measures what a
human actually feels before V4 doubles the traffic. **What it does not build:** an
automatic branch cleanup — deleting a branch is a destructive operation and is
above the floor (§4.1), and ruling D1's carve-out is a **rewrite** of the tool's
own ref, not a deletion of anything. Stale work branches accumulate until a human
prunes them, and `handshake branches` lists them oldest-first **and shows stack
parentage** (§12.3) so the pruning is one glance.

**The residual this section priced as a listing entry and is actually a
permanent one, named at fix round 3.** The three costs above — a reflog nobody
reads, a notification stream nobody wants, a `git branch -r` listing that grows
— are all things a human *looks at*. The one nobody looks at is the state
branch's **history**, which grows forever at §12.5's own rate and lands in every
clone. Measured at fix round 3 on a synthetic corpus of exactly the shape §10.1
specifies — one append-only shard, 300 temp-index commits — the branch costs
**5 objects per commit** (commit, three trees, blob) and **~445 packed bytes per
commit** after `git repack -adf`, and the growth is **linear, not quadratic**,
because git deltas each version of an append-only shard against the previous
one. At §12.5's 480 state pushes per member per working day, two members, 250
working days, that is roughly **1.2 million objects and ~100 MB of pack per
year**. A full `git clone` pays it; `actions/checkout` does not, because it
defaults to a depth-1 single-ref fetch.

**And the tool may never compact it, which is a stated position rather than an
oversight.** `handshake/state` is a **shared two-writer ref**, so squashing it,
re-rooting it or deleting it are all above the floor (§4.1), and ruling D1's
carve-out is scoped to `handshake/<self>/*` and does not reach it. **A carve-out
for re-rooting the state branch is deliberately not proposed**: D1's reasoning
turned on the ref being tool-owned, unshared and advertised unstable, and this
one is none of those, so buying ~100 MB a year with a rewrite carve-out on a
shared ref is not a trade D1 supports. **The remedy is the human's, and the
protocol already supports it**: delete the remote ref, and §10.1 rule 2's
adopt-never-create restarts both sides cleanly on a fresh orphan root the next
time each proves it absent. This is the same posture the paragraph above takes
for stale work branches — accumulation with a human remedy — and it is stated
here so a reader does not have to infer it. **V2 is where the number becomes
real rather than synthetic:** §10.2 captures `git count-objects -vH` across the
working day beside the rejected-push count.

**The corrected claim matters because the failure it prevents is not degraded
coordination.** The first draft said *"CI is skipped on `handshake/*` so the noise
costs no minutes"* while specifying the skip as an edit to **this** repository's
workflow file. In a pair's repository where nobody installed it, roughly 480 state
pushes per member per working day meet a workflow with no branch filter — an
uncapped Actions bill and a saturated queue, starting at the first opt-in. Making
it a precondition (§4.2 item 4) means the bad state is *"the push is not enabled
yet, and here is the two-line fix"*, which is a message, not a bill.

### 12.2 Secret-scan false positives blocking pushes

A fail-closed scan on every automated commit means a false positive stops the
Claude's work from being visible. `[SEC§4]` already records that the entropy pass
skips bare 40- and 64-hex runs precisely because git SHAs saturate developer
chatter, and that the battery is a denylist.

**What the first draft built, and why it had to be redesigned.** It reused
`lib/filter.js`'s `check()` unchanged. Measured against this repository at
`9e810b0`, that refuses roughly three commits in four — `secret-assignment` alone
refuses 23 of 131 tracked files, `bin/handshake.js` and `hooks/render.js` among
them (§4.2 item 1). A fail-closed gate with that rate is not a gate, it is a
stop, and **the cut trigger the first draft wrote in advance to catch exactly
this — 1 legitimate refusal in 200 — was about 150× below the real rate**, so it
would have read as an emergency instead of a measurement. That is the failure mode
a pre-committed trigger exists to prevent, and it only shows up when you run the
code.

**What the plan builds now:** a scanner that is **its own caller** with a
code-shaped battery and four exclusions, each named with the false-positive class
it removes (§4.2 item 1); **`check()`'s contract, `MAX_BYTES` and every existing
regression test named for its attack `[SEC§4]` untouched**, because this is a
second caller of the same tables rather than an edit to the first; a refusal that
is **loud, once, to the author, naming the finding id and the file** rather than a
silent skip; and a commit refused whole, never partially made. **Verified, not
asserted: 66 non-fixture tracked files, zero findings** (§4.2 item 1), and V4's
test keeps it that way as the tree grows.

**The honest residual, restated at fix round 3 against a measurement instead of
an example.** The first revision said the tripwire *"compares raw values from
local secret files, so a project whose `.env` holds a short common word will
refuse commits containing that word"*, offered the ≥ 8-char floor
`[C lib/filter.js:23]` as the mitigation, and concluded *"this is now the whole
of the false-positive surface"* — an affirmative claim of completeness, made
about a control the 66/0 run **never exercised**, since nothing tracked in this
repository matches `SECRET_FILE_RE` `[C lib/filter.js:202]` and
`tripwireFindings` returns `[]` with an empty corpus `[C lib/filter.js:228]`.
The real profile is much wider, and §4.2 item 1 has the numbers: on a fixture
with an ordinary Spring `application.yml` and a two-line `.npmrc` — both of
which that pattern admits — the corpus is **nine needles of which two are
credentials**, and **six of eight ordinary code and prose samples are refused**.
The ≥ 8-char floor is not the mitigation it was offered as: `validate` is
exactly eight characters, clears it, and refuses the sentence *"We validate the
input before sending."* **On a Spring or Rails tree the gate would refuse most
diffs from commit one**, which is B1's failure returning through the door B1's
fix opened, and the 1-in-200 trigger below would blow immediately and read as an
emergency rather than a measurement — the exact pathology the paragraph above
diagnoses in the first draft.

**What bounds it now:** the **needle filter** of §4.2 item 1 — value-shaped
needles only, capped per file, in `lib/commit-scan.js` and never in
`lib/filter.js` — plus the second V4 test that pins it by the false-positive
class it removes and the true positive it must not lose. **This repository is
not the case that matters**: it has no tracked or untracked config-shaped secret
file, so V4's gate ships clean here as measured, and the first *other* project
is where the profile bites. The error direction is fail-closed throughout —
over-refusal, never a missed secret — so nothing unsafe ships either way, and
that is the whole of what the 66/0 number was ever evidence for.

**The cut trigger, restated against a scanner that can run** **[proposed]**:
**more than 1 refusal in 200 automated commits where a human, shown the finding,
says it was not a secret.** Three corrections to the first draft's version.
**It is anchored at V4, not V2** — V1's automated commits carry already-filtered
shard text `[C lib/workspace-files.js:365]`, not code diffs, so V2 has no
population to measure. **V4's Delivers carries the counters that make it
measurable**: attempts, refusals, and one human-adjudication line per refusal, so
the denominator is real and the numerator is a human's verdict rather than a
guess. **And the remedy is no longer "drop the entropy pass"**, because the
entropy pass is already excluded by design: if the tripwire's own rate crosses the
line, the narrowing is a project-level allowlist of tripwire values a human has
adjudicated as non-secret, recorded per workspace — never an `--ack` override on
the gate itself, which would put a model-reachable bypass on the only fail-closed
control in the design.

### 12.3 Rebase churn

A peer pushing every minute means a stacked Claude could rebase every minute and
never finish anything.

**What the plan builds:** the instability counter of §5.4 — after **[proposed: 3]**
head moves since the last successful rebase, the client stops rebasing and
sequences instead, resuming on `task.release` / `task.done` **or on the base
claim going stale** (§5.4). **The probe is `merge-tree --write-tree`, which is
non-mutating by construction, so a dirty result costs nothing and leaves the
local branch, the index and the working tree untouched — and the first draft's
`rebase --dry-run` does not exist**, so the safety claim rested on
attempt-then-`--abort`, which needs a clean tree, churns the working tree, and on
a hard kill leaves `.git/rebase-merge/`, conflict markers and a detached `HEAD`
behind. Any real rebase happens in a dedicated worktree under the plugin's state
directory (§5.4), **swept with `git worktree remove --force` plus
`git worktree prune` and not an unlink**, which is what actually releases the
path. And the fetch is triggered by a **changed
head**, not by a timer, so a quiet peer costs zero fetches — which is also why
the repeated probing this section worries about does not accumulate unreachable
objects: there is no cadence to accumulate against, and the instability bound
caps the rebases.

**One thing the safety claim above does not cover, added at fix round 3.** *"A
dirty result costs nothing"* is true of the **probe**, and the probe is a proxy:
`merge-tree` composes endpoints where a rebase replays commits, so a clean probe
can be followed by a **conflicting real rebase** (§5.4 mechanism 2 has the
measurement). That rebase is not free in the same way — it is a real operation —
but it is confined: it happens in the throwaway worktree, aborts there, drops
the stack, routes to sequence and counts against the instability bound. The
human's tree is still untouched; what is spent is one evaluation.

**The landing hazard, stated here because it is the stack's and nowhere else's.**
§11.2 ends *"neither branch was merged, no PR was opened, `main` is untouched"*,
which is correct as a floor test and leaves the cost of landing joint work
unpriced. Once Bob's branch contains Alex's commits, **merge order becomes
load-bearing**: if Alex's side lands by **squash merge — GitHub's default** —
every one of Alex's commits inside Bob's branch becomes a duplicate that `main`
no longer contains under the same sha, and Bob's PR conflicts against `main` in a
way neither Claude created and neither can explain. **The stance
[proposed]: a stacked branch lands by merge commit or rebase-merge, never by
squash — or Bob restacks onto `main` before opening the PR.** Both are human
operations above the floor (§4.1), so this plan does not automate either; what it
does is **make the parentage visible**, because a human cannot pick a merge order
they cannot see. `handshake branches` sorts by age today, which is the wrong key
for this question, so it **shows which branch is stacked on which** alongside it.
**No sixth acceptance scenario is added for the landing itself**: everything
after the PR is above the floor, so it would test git rather than this layer.

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
feature is cut** — a round is cheap and an interruption is not. **The denominator
is a *pair*, and it is per pair by construction, not by convenience:** a seam
names exactly two members `[COBUILD §2.1]`, grants are per-peer (§9) and branches
are per-member (§4.1), so every rate in this section and in §12.6 is scoped to two
people and would need re-basing before it could be read as a workspace-wide
number. The protocol admits 200 members; this stage is two, which is also this
document's first sentence.

### 12.5 CI cost

**Four job runs, not three, and two of them bill at 2×.** The workflow defines
three *jobs* — `test`, `installer-lint`, `installer-lint-windows`
`[C .github/workflows/ci.yml:17-91]` — but `test` fans out across a two-OS matrix
`[C .github/workflows/ci.yml:18-24]`, so **every push starts four job runs**, of
which `test (windows-latest)` and `installer-lint-windows` run on Windows and
Windows minutes bill at **2×** the Linux rate. §4.2 item 4's "three-job matrix
run" was wrong and is corrected there too. **The scale:** roughly 480 state
pushes per member per working day against 2,000 free minutes a month. Affordable
at human cadence, not at machine cadence, and not close.

**What the plan builds:** `branches-ignore` on `handshake/**` (§4.2 item 4), with
`pull_request` untouched so the suite runs at exactly the moment a human proposes
a merge — **enforced as a V1 preflight precondition in the pair's own repo, and
applied to this repository's own workflow at V1 rather than V4**, because V2 runs
the machine-cadence push. **The residual, stated because it is real:** a Claude's
work branch is
then never tested until a human opens a PR, which is a change in when breakage is
discovered. That is the intended trade — the branch is advertised as a **live
view**, broken is explicitly allowed, and the acceptance criterion is that nothing
downstream of the branch treats it as green. `handshake branches` labels every
work branch `untested` for exactly this reason. **The second residual, which §5.4
states in full:** decision 4 named *branch CI passing* as one of the three facts
a stacking judgement reads, and this guardrail removes it. §5.4 replaces it with
a clean `merge-tree` probe plus successive `ls-remote` reads and says what that
does and does not buy; the opt-in lightweight per-branch job that would restore it
is §14 item 23, deliberately not built before V2 has measured what CI at machine
cadence actually costs.

**The third residual, and it is the largest bill in this section — added at fix
round 3, because this paragraph used to state it in the singular and call it
correct.** *"A pull request from a work branch still runs all four job runs,
which is where the cost belongs"* is true only of the **opening**. A bare
`pull_request:` trigger fires on `synchronize` as well as `opened`, and
`synchronize` fires on every push to the PR head branch — which, while the claim
is live, is the same ref the tool is pushing every minute. So a PR opened on a
live claim runs **four job runs per minute, two of them on Windows at 2×, for as
long as it is open**, and `branches-ignore` on `push` does nothing about it
because `pull_request` is an independent event whose branch filters name the
**base**. That is B6's uncapped bill through the second door, behind a
precondition that reports the cap enforced. §4.2 item 4 closes it: **the
automated push for a work branch stops once a PR exists for it**, read with
`gh pr list --head <branch>` on the same TTL as the visibility verdict, and
unproven takes the fail-closed arm. After that the honest sentence is: **a pull
request from a work branch runs all four job runs at the moment it is opened and
once per human push thereafter**, which is where the cost belongs.

### 12.6 Complexity — the one the owner keeps flagging

Six concepts (§2.1) against `[KNOWLEDGE §8]`'s two and `[COBUILD §3]`'s two, three
new verbs against a CLI heading for thirty-six (§2.2), and **two** proposed wire
deltas on top of two unratified ones — **the revision withdrew one** (§2.3).
**This is the largest slice this project has planned, and the count should be
argued down here.**

**What holds it down:** zero new event types (§2.3); zero untrimmable per-turn
characters (§2.4); zero new state files on the hot path; the conflict cases reuse
the tiebreak, the overlap floor, the claims and the gate exactly as they are; the
contradiction protocol adds two fields to a machine that already exists in design
`[COBUILD §7.1]`; and the learning rung adds one client constant
`[C lib/workspace-files.js:278]`.

**What would make me cut a rung**, written in advance so it is a rule — and
every rate below is **per pair**, for the reason §12.4 states:

- **Cut V6 entirely and route contradictions to `note.blocker` + a human** — if
  V2's or V5's run shows contradictions arising **[proposed: less than once per
  pair per week]**.
  A protocol for a thing that happens monthly has no customer, and `note.blocker`
  ships today at zero new surface `[C skills/handshake-coordination/SKILL.md:278-326]`.
- **Cut the *ranking* half of V8 and keep the records** — if the recorded outcome
  corpus is under **[proposed: 20 rows]** **after one month of two-pair use
  following V8's own ship**. Ranking twenty rows is not learning, and decision 9
  already rejects hotspot learning before data exists. **The first draft anchored
  this at V2, where it could only ever fire**: the `outcome` kind is *created* by
  V8, so before V8 the corpus is necessarily zero and the rule was a certainty
  dressed as a measurement. Re-anchored, it cuts the part that needs data and
  keeps the part that produces it.
- **Cut V3's symbol declaration to a single symbol, not a list** — if V2 shows the
  model authoring long, low-quality lists. One good symbol beats sixteen guesses,
  and the field's cap makes the narrowing a one-line change.
- **Never cut the five guardrails of §4.2.** The fail-closed commit scan, the
  public-repo guard **with ruling D2's private-only default**, the two-sided
  opt-in, the CI-skip precondition and **the untrusted-peer-tree rules** ship with
  V1, V4 and V5 or those rungs do not ship. A version that pushes before its
  boundary is the wrong feature, and a version that fetches without one is a
  worse one.
- **Never cut the two-human run out of second place.** Every risk above is
  measured there and nowhere else.

### 12.7 What we do not claim

- **Not that the commit secret scan prevents leaks.** It is a seatbelt plus a
  closed tripwire for known local secrets `[SEC§4]`, run over a diff instead of a
  message. No document, command output or release note may say it *prevents*,
  *guarantees* or *ensures*. Chunking still defeats per-commit scanning by
  construction. **And the four exclusions of §4.2 item 1 are real holes, priced
  rather than hidden**: a credential assigned to a variable named `token` with no
  branded prefix, a high-entropy blob with no recognised shape, a secret split
  across two lines so that only the whitespace-stripped variant would see it, and
  a three-line `KEY=value` block are each things the commit battery does not
  catch. The tripwire catches all four **when the value is in a local secret
  file** — which is the accidental-commit case this control is for — and catches
  none of them otherwise.
- **Not that every surface is scanned. Here is the list, per ruling D2** —
  because *"the scanner covers everything or refuses"* is only honest if what it
  does not cover is written down. **Scanned:** added hunk text on every automated
  commit, **commit messages**, and **branch names**. **Never auto-committed
  because they cannot be scanned:** binary files and any file that is not valid
  UTF-8; they wait for a human commit and `status` names them. **Not scanned, and
  not reachable by the automated path either:** file *paths* themselves, which
  are committed as tree entries and are the one thing a path-name credential
  could ride — a `files[]` entry is a real path the human's own editor created,
  and the branch-name rule above covers the only path component this tool
  invents. **Not scanned, by design and stated in the first draft:** anything in
  a commit a **human** makes; this guardrail is on the automated path only.
- **Not that a miss is recoverable. Ruling D2's residual, out loud.** A miss by
  the code-shaped scanner lands in the **private remote's history, permanently**.
  Rotation does not un-leak a commit — `[SEC§3.1]`'s own words, and it enumerates
  the holder set: every current reader, every past reader with a clone, every
  installed GitHub App with `contents: read`, every CI checkout, every fork,
  mirror and backup `[C docs/SECURITY.md:138-152]`. This stage changes the
  *character* of a filter miss, not just its odds: until now a miss put a secret
  in a chat message behind ~12 h of ntfy cache or 7 days of relay retention; now
  the same miss puts it in a git object with no deletion path. **The mitigations,
  and they bound it rather than solve it:** the scanner gets an adversarial
  review at V4 (3× fan-out) and again at V9; the rotation runbook is in
  `SECURITY.md` `[SEC§7]`; the automated path runs on private repos only unless a
  human typed the override (§4.2 item 2); and **the private remote is the same
  trust boundary as workspace membership** — everyone who can read the leaked
  commit could already read the workspace. Bounded, not solved, and no document
  may say otherwise.
- **Not that fetched peer code is contained.** §4.2 item 5 admits the automatic
  rebase only on a locally derived path allowlist, refuses on any mode change,
  keeps a floor of instruction and build surfaces the allowlist cannot open, and
  evaluates in a throwaway worktree. It does not
  make a peer's source safe to read, and reading it is the point of the stack. A
  peer who wants to influence what my Claude builds can do so **inside** an
  ordinary source file, in the ordinary way, and no guardrail here changes that —
  what the guardrails remove is the *automatic, un-turned* path from their push
  to my instruction files, my config and my build.
  **What that sentence was worth before fix round 3, and what it is worth now.**
  It was written over a **denylist of seven names**, which did not cover
  `.mcp.json`, a non-root `CLAUDE.md`, `.husky/**`, any non-GitHub forge file,
  or any build file that is not literally `Makefile` — so the claim exceeded the
  control, in a bullet whose whole job is not to overclaim. Inverting the rule
  makes it true by construction rather than by enumeration. **The residual that
  remains, stated:** the allowlist is derived from my own claim's `files[]`, so
  a pair whose own work *is* the instruction or build surface — this plugin's
  own repository is the obvious case — would admit the peer there but for the
  floor, and the floor is a list, so it is a list that must be reviewed at V9
  like any other denylist `[SEC§4]`.
- **Not that autonomous contradiction resolution is available on both tiers.**
  It is a **relay-tier capability**. On ntfy, `task.seam{contract}` is
  human-gated by `[COBUILD §2.6]`, a control this plan reuses unchanged, so a
  round runs at one confirmation per inbound revision per side (§6.4, §11
  preamble). Zero-setup remains the default tier, so for a pair that never
  deploys a relay, **§6 is a bounded, structured, human-paced exchange rather
  than an autonomous one** — which is a real limit on decision 1's promise and is
  stated here rather than discovered at V6.
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
  the instability counter, the rebuild bound, the SKILL.md ceiling, every timing
  in §2.5 and every rate in §12 are **reasoned, not measured**. V2 is where that
  changes. **The exceptions, and they are the only ones — three at fix round 3,
  where the list said two.** (1) The commit
  battery's zero findings over 66 tracked files, and the false-positive counts
  that forced its four exclusions, were **run** at the revision against this
  repository at `9e810b0` (§4.2 item 1). (2) The **tripwire's** own
  false-positive profile — nine harvested needles of which two are credentials,
  six of eight ordinary samples refused — was run at fix round 3 against a
  **fixture**, not against this repository, because this repository has no
  config-shaped secret file for the tripwire to read (§4.2 item 1, §12.2).
  (3) The state branch's **5 objects and ~445 packed bytes per commit** were run
  at fix round 3 against a **synthetic** 300-commit corpus of §10.1's own shape
  (§12.1). Also measured rather than reasoned, and stated where each is used
  rather than listed here: the wire byte figures of §2.3, and the git
  behaviours §5.4, §10.1 and §10.4 turn into rules — `merge-tree` clean where
  `rebase` conflicts, `apply --check --3way` exiting 0 on a real conflict,
  `update-index --add` refusing a deleted path, `--cacheinfo` demoting a mode,
  `ls-remote --exit-code` splitting absent from unreachable, and a `rm -rf`
  worktree staying registered. **Every one of those is a measurement of this
  repository, a fixture, or git — not of the world**, and none of them is a
  measurement of a pair at work, which is still V2's job alone.
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

### 13.6 `SECURITY.md`

**Missing from the first draft's register, and it is the one document this stage
gives new content to rather than new citations of.** §12.7 already stated that
this stage widens what a malicious member can do and assigned the write-up to V9;
what was absent is *what must change*, so a reader could not tell the omission
from a decision. Five items, with the rung that makes each:

| What must change in `SECURITY.md` | Rung |
|---|---|
| **§5 gains the inbound rule**: a fetched peer work branch is untrusted data that can also execute — the §4.2 item 5 guardrails written normatively, as the extension of §5.4's *"`.handshake/*` files read from disk are untrusted data"* `[C docs/SECURITY.md:293-297]` to the one git path this stage adds | **V5** ships the control; **V9** writes the section |
| **§4 gains the commit scanner's own honest contract** — a *second* caller with a *different* battery and four named exclusions, so a reader does not assume §4's message-path contract covers it. §4's *"a denylist is only as good as its last adversarial review"* applies to both | **V4** |
| **§6 gains ruling D2**: automated push is private-repo-only by default; the opt-in prints the verdict; the override is typed and recorded | **V1** ships it; **V9** writes it |
| **§3.1 gains one sentence**: the automated push means *the tool* can put content in the repo, so the holder-set list `[C docs/SECURITY.md:138-152]` now applies to material no human reviewed before it landed | **V9** |
| **§1.2 is re-stated, not amended**: a malicious current member stays out of scope, and this stage widens what such a member can do — commits on a shared branch, and influence over what the peer's Claude builds within the granted capabilities (§12.7) | **V9** |

`SECURITY.md` is also in V4's, V6's and V7's Touches for the narrower edits each
of those makes; **V9 is where the five above become one coherent section rather
than five accreted paragraphs**, which is M13's shape (§10.9).

---

## 14. Proposed, not yet decided

Every choice this plan made that the discussion did not, collected so they can be
ratified in one pass. Nothing below is a decision of the owner's; each is the
plan's suggestion, marked where it appears.

**Rulings D1 and D2 are deliberately absent from this table.** They are the
owner's, settled 2026-09-02, and they enter the plan as decisions (§1, §4.1,
§4.2). Ratifying §14 does not ratify them and cannot un-ratify them.

**Rows rewritten or withdrawn at the revision are marked so**, because §14 is only
an instrument if a reader can tell a row that changed value from one that did not.
**Rows 41 and 42 were added in fix round 1**, both for the same reason: a choice
was marked `[proposed]` inline, or made silently, without a row here — and a
`[proposed]` marker with nothing to ratify is a marker that does nothing.
**Rows 43 and 44 were added at fix round 3**, for the same reason again, and
**rows 9, 10, 32, 36, 39, 40 and 41 were rewritten there** — each marked inside
its own row with what changed and why. Item 36 is the one whose *kind* changed:
it was a list and is now a posture, because a list of seven names is a thing
that ages and a reader ratifying it could not see that §4.3 argues the opposite
way three sections earlier.

| # | Item | Where | Suggested value |
|---|---|---|---|
| 1 | What `handshake/state` carries — **rewritten at the revision**: "the directory" became an explicit allowlist, because `.handshake/secret.json` is the one file in that directory that must never be committed | §4.3, §10.1 | orphan branch, and an **enumerated path allowlist** — `.handshake/tasks/<shardFileName(self)>` only, derived and never accepted `[C lib/workspace-files.js:292-298]`; anything unnamed is not committed |
| 2 | Work-branch name shape — **rewritten at the revision**: a filename sanitizer is not a ref-name sanitizer | §4.1, §10.4 | `handshake/<member>/<subject_key>`, sanitized by a **ref-name** rule of its own (strip trailing `.lock` per component, reject a leading `.`, reserve `state` as a member component) and validated with `git check-ref-format --branch` |
| 3 | ~~Commit-scan windowing~~ — **WITHDRAWN at the revision.** Windows existed only to get past `check()`'s `MAX_BYTES` `[C lib/filter.js:22,255]`; the scanner is now its own caller and does not go through `check()` | §4.2 item 1 | no windowing; **the four named exclusions and the code-shaped battery replace it** |
| 4 | CI branch filter — **rewritten at the revision**: a workflow edit in someone else's repo is not something this tool can do, and doing it by git would be above the floor | §4.2 item 4, §10.1 | `branches-ignore: handshake/**` on `push` only, **enforced as a V1 preflight precondition in the pair's repo** (refuse to enable the push until it holds, with the snippet in the refusal); applied to this repository's own workflow at **V1** |
| 5 | Verb name — the capability grant | §2.2, §9 | `handshake pair` |
| 6 | Verb name — the branch view | §2.2, §10.1 | `handshake branches` |
| 7 | Verb name — the contradiction view | §2.2, §10.6 | `handshake contested` |
| 8 | ~~**V-D1** field name and shape~~ — **WITHDRAWN at the revision.** `presence.update` is not an envelope on the relay `[C docs/PROTOCOL.md:262-275]` `[C relay/src/lib/envelope.js:22-26]`, so the field could not travel on the tier §11 runs first. **The row asserted the opposite of what the code does.** | §2.3, §5.4 | **no wire delta**: the peer's branch head is read locally with `git ls-remote` against the `branch` the presence body already carries — which also makes it a fact the peer cannot author. **Named as a departure from decision 4** (added in fix round 1): decision 4's case (c) specifies *"a structured branch-moved event on each peer push"*, and withdrawing V-D1 withdraws that event too, so the fact arrives on the poll's clock — 60 s relay, up to 600 s ntfy `[C monitors/heartbeat.js:47]` — instead of at the push. Stronger fact, worse latency; ratifying this row ratifies that trade |
| 9 | **V-D2** field name, shape, **carriage** and **harvest** — **rewritten at the revision** on the first three, **and at fix round 3 on the fourth, plus a repin** | §2.3, §7.1, §10.3 | `task.claim.symbols` / `task.change.symbols`, **≤ 8 × ≤ 100 chars** (lowered so the body fits the 2,048-byte cap — repinned at fix round 3 to `[C lib/envelope.js:18,316]`, the client's actual `MAX_BODY_BYTES` and its `build()` throw, from `[C lib/filter.js:22]`, which is `check()`'s per-**string** input cap and is the very constant item 3 withdraws from the scan path for being irrelevant there; the relay half `[C relay/src/lib/envelope.js:10]` was already right), `path::Symbol.member`; **on the relay the authoritative carrier is `task.change{scope}`**, because `task.claim` is a fixed column set there `[C relay/src/do/workspace.js:101-104]`. **And carriage is not delivery: the field MUST be harvested out of the envelope into `peers.claims[].symbols` by `mergeClaimFiles` `[C hooks/sync.js:89-126]`** — a separate array, never merged into `files[]`, escaped at `{ max: 100 }` — or it renders once and vanishes, since both promised surfaces read only the cached claim rows and a digest item is watermark-consumed `[P§6.3]`. The CLI `sync` path must merge rather than overwrite `[C bin/handshake.js:1006-1010]`. Rendered as the **discriminating tail** on the card, in full on the gate line. **Degrades on both legs**, relay by retention and ntfy permanently through the `[F]` resurrection shape `[C docs/PROTOCOL.md:298]` |
| 10 | **V-D3** field names and caps — **the arithmetic added at fix round 3, because ratifying a cap without it ratifies an unpriced capacity change** | §2.3, §6.2 | `task.seam.contested` (bool, `propose`); `task.seam.rationale` (≤ 280, `contract`). **What 280 costs, measured:** a maximal ASCII `contract` body goes **1,415 → 1,710 of 2,048**, i.e. **295 bytes, 45% of the remaining slack**; the residual budget for `text` falls **1,833 → 1,538 bytes**, roughly **916 → 769** two-byte characters against an unchanged 1,200-char field cap, so a non-ASCII contract in that band fits today and is **refused** after V-D3. The ntfy wire goes from `[COBUILD §4.2]`'s measured 2,244 to roughly **2,640 of 4,096**, which still does not bind. **And the refusal message must name `rationale` when `rationale` is what busted the cap**, and offer to drop it before asking the human to cut their own contract text — `[COBUILD §4.2]`'s *"tell the human to shorten the contract"* is the wrong instruction for bytes a model spent |
| 11 | Bounded rounds before escalation | §6.3 | **3** |
| 12 | Rebase instability bound before sequencing | §5.4, §12.3 | **3** — counting head moves since the last clean rebase (the head being what `ls-remote` returns, item 8) **and** any real rebase that conflicts after a clean probe (§5.4 mechanism 2, item 32) |
| 13 | New `SHARD_KINDS` entry for coordination outcomes | §8, §10.8 | `outcome` |
| 14 | Cut trigger — secret-scan false positives — **rewritten at the revision**: re-anchored from V2 (which has no code diffs to scan) to **V4**, instrumented with counters in V4's Delivers, and the remedy changed because the entropy pass is now excluded by design | §12.2, §10.4 | > 1 in 200 automated commits refused where a human, shown the finding, says it was not a secret; remedy is a per-workspace allowlist of adjudicated tripwire values, **never** an `--ack` bypass on the gate |
| 15 | Cut trigger — escalation rate | §12.4 | > 1 per pair per working day |
| 16 | Cut trigger — outcome corpus too small for **ranking** — **rewritten at the revision**: the `outcome` kind is created by V8, so "after V2" made the corpus necessarily zero and the rule a certainty rather than a measurement | §12.6 | < 20 rows after **one month of two-pair use following V8's own ship**; it cuts the ranking, never the records |
| 17 | §7.3's parser condition has **no threshold picked** — **rewritten at the revision** to name the denominator | §7.3 | numerator: warnings overridden on a symbol-disjoint claim; denominator: all warnings on claims where **both** sides declared symbols; threshold measured at V8, then decided |
| 18 | No untrimmable `COND` literal is added; the stack and symbol markers are trimmable details | §2.4 | reversible in one literal if V3/V5 measurement says otherwise |
| 19 | Each rung ships its own narrow typed opt-in; V7 generalizes them into one table | §9, §10.7 | as written — this resolves the apparent tension between decision 3's "opt-in at configuration" and decision 10's ordering of the trusted-pair rung sixth |
| 20 | **The initial default grant, per capability row** — decision 8 settles the *form* of the grant and no value | §9 | all granted **except** `task.offer`; every grantable row is the owner's to flip individually — the `note.*` row's `never grantable` value is §3's principle, not a default, and V7's test pins it |
| 21 | **Zero new event types** — **re-argued at the revision**, because the first draft's supporting argument (an OPTIONAL field degrades better on a v1.0 peer) is sound on ntfy and worth nothing on a type the relay projects through fixed columns. Re-tested, the conclusion survives and the route to it changed | §2.3 | as written, now **two** OPTIONAL fields on envelope-carried types, `[P§3]`'s closed-catalog `[F]` line untouched — and the alternative (one new `task.branch` type, which the relay would carry for free `[C docs/PROTOCOL.md:230-233]`) rejected because it would be the **third** amendment to that line in one wave |
| 22 | Notice priority — **rewritten at the revision**: the channel already has three producers the first draft's four-kind order did not know about `[C hooks/common.js:594-614,668-673]` | §2.4, §10.3 | a **total order over seven kinds**, safety first — rotation demand → private-repo guard → push refused → escalated → conflict → rebase needed → round open — implemented as a **sort by rank** replacing the bare `.slice(0, 2)` `[C hooks/render.js:187]` |
| 23 | **Decision 4's `branch CI passing` fact is unavailable** (§4.2 item 4 skips CI on `handshake/*`); replaced by the **`merge-tree` probe + successive `ls-remote` reads** | §5.4, §12.5 | as written — **plus an optional item: an opt-in lightweight per-branch job** (one runner, one OS, unit suite only), *not built here*, decided after V2 measures CI cost |
| 24 | **Resume-on-event is new local behaviour**, not a reuse of any existing rule — **rewritten at the revision**: "and on nothing else" deadlocked the commonest abandonment there is, a closed laptop, which emits neither event | §5.4 | a sequenced task re-evaluates on the peer's `task.release` / `task.done` for that `subject_key`, **or on the base claim expiring or going stale** `[P§4.3]` `[P§5.3]`, and on nothing else — in particular never on a peer note |
| 25 | **Decision 5's four-part trigger is reduced**: symbol and contested-marking travel; values and diffs are derived locally | §6.2 | symbol rides `[COBUILD §7.1]`'s existing immutable `name`; no fourth field |
| 26 | **Amending `[PLAN§6]`'s acceptance criterion** rather than retiring it | §4.3, §13.1 | *"no coordination-only commits **on a branch a human works on**"* |
| 27 | Cut trigger — contradiction frequency too low to justify V6 | §12.6 | < 1 per pair per week at V2/V5 |
| 28 | **V9 and V10 added to the order** — decision 10's list ended at the learning records | §10.9 | red team + docs/release as the last two rungs, V9 a gate |
| **29** | **State-branch concurrency: one branch with a protocol, or per-member branches** *(new at the revision)* | §4.1, §10.1 | keep decision 3's **one** `handshake/state`, with fetch-first / adopt-never-create / `commit-tree -p` / rebuild-on-rejection, a **3**-rebuild bound per beat, a push budget outside the CLI slice, and a `rejected` state distinct from `offline`. **Fallback if V2 shows it flaky:** `handshake/state/<member>`, which is structurally single-writer — a **one-way** migration, since the two ref shapes cannot coexist |
| **30** | **How many work branches a member may hold at once** *(new at the revision)* | §10.4 | **one active work branch per member**, following the most recently acquired live claim `[C hooks/post-tool-use.js:82-84]`. Alternative not taken: one shared branch for concurrent claims |
| **31** | **The notices overflow literal** *(new at the revision, created by item 22's eviction)* | §2.4, §10.3 | `+N !`, ~4 chars, inside the 11 of headroom, priced in the V3 gate, dropped with the channel at `dropNotices` `[C hooks/render.js:262]` |
| **32** | **The non-mutating rebase primitive** *(new at the revision; `git rebase --dry-run` does not exist. **Rewritten at fix round 3 on four counts**: the probe is a proxy and the plan had no arm for the case its own design creates; the fallback inverts the verdict; the version floor had no detection; and the worktree sweep was specified as an unlink)* | §4.2 item 5, §5.4, §10.5, §12.3 | `git merge-tree --write-tree` (git 2.38+). **It is a proxy for the rebase, not the rebase** — it composes two endpoints against a merge base where a rebase replays each commit, so a clean probe does **not** imply a clean rebase (measured: a net-empty endpoint diff whose intermediate commit conflicts gives `merge-tree` exit 0 and `rebase` exit 1). **The missing arm:** a real rebase that conflicts after a clean probe aborts in the worktree, drops the stack, routes to sequence and counts against the instability bound (item 12). **The fallback is WITHDRAWN, not kept:** `format-patch \| apply --check --3way` prints *"Applied patch … with conflicts."* and **exits 0** on a real conflict, with or without `--cached`, so it would report a dirty base as clean underneath ruling D1's force-push. **Instead the V1 preflight records `git --version` as a fifth precondition and the stacking capability is OFF below 2.38**, said in `status` — which matters because Ubuntu 22.04 LTS ships git 2.34.1 and both CI legs are above the floor, so the older branch is the one nobody would ever run. Any real rebase in a dedicated worktree under the plugin state dir, created **after** the path rule and the probe (both checkout-free) rather than before, with `--no-checkout` plus a sparse checkout where a full tree is not needed and `-c core.longpaths=true` on Windows; **swept with `git worktree remove --force` followed by `git worktree prune`, never `rm -rf`** — verified, a deleted worktree stays registered as `prunable` and permanently blocks re-use of its path |
| **33** | **Stack ordering, so two clients do not both stack** *(new at the revision)* | §5.4 | the **lexicographically smaller member id never stacks**, reusing the frozen byte-wise comparator `[C lib/subject.js:102-107]` — borrowed for a new object, amending nothing |
| **34** | **Nested stacks** *(new at the revision; absent from the first draft entirely)* | §5.4 | **not permitted** — a client already stacked sequences instead of stacking a second base |
| **35** | **The peer-branch validation rule and the fetch shape** *(new at the revision; the per-leg half added in fix round 1)* | §4.2 item 5, §5.4, §10.5, §11.6 | accept only `^handshake/<the authenticated sender's member id>/[A-Za-z0-9._-]{1,120}$`, else discard-and-count. **The id is per leg, because `presence.update` is not an envelope on the relay (§2.3):** on **ntfy** the segment MUST equal the signed envelope's `from.member`, checked in `lib/transport-ntfy.js`'s presence assembly `[C lib/transport-ntfy.js:284,300-301]`; on the **relay** it MUST equal the server-authoritative `member_id` of the `sync.presence[]` row `[C relay/src/do/workspace.js:428-437,709-712]`, checked in `lib/transport-relay.js`'s `presence()` `[C lib/transport-relay.js:259-268]`. **Not** in `lib/envelope.js`, which enumerates no body field by design. Fetch by explicit refspec with `--` and a fully-qualified source into `refs/handshake/peers/<member>/<branch>` |
| **36** | **The gate on an automatic rebase — a POSTURE, not a list** *(new at the revision as a seven-name refuse-list; **inverted at fix round 3**, because a denylist was the one thing §4.3 argues against in the same words — "Allowlist, not denylist, on the path the tool writes without a human" — and it omitted most of the surface it claimed: `.mcp.json`, a non-root `CLAUDE.md`, `AGENTS.md`, `.husky/**`, every non-GitHub forge file, every build file that is not literally `Makefile`)* | §4.2 item 5, §10.5, §11.2, §11.6, §12.7 | **Three rules, in this order.** (1) **Allowlist:** the automatic rebase proceeds only when every path in the peer's diff sits under a prefix **this side derived locally** — the directory prefixes of **my own** claim's observed `files[]` `[C hooks/post-tool-use.js:79-91]`, never the peer's, which a malicious peer authors — matching at a path boundary, at any depth, case-insensitively. (2) **Mode rule:** refuse any diff that introduces or modifies a **symlink, a gitlink or an executable bit**, computed from `git diff --raw` and not `--name-only`, which cannot see a mode transition at all. (3) **Floor:** the withdrawn seven names, plus `.mcp.json`, any `CLAUDE.md`/`AGENTS.md` at any depth and `.husky/**`, refuse **even when the allowlist admits them** — because a pair whose own work is the instruction or build surface has those paths on its own claims. Anything refused renders a notice (rank 6) and the human decides. **Ratifying this row ratifies the posture**; the floor in rule 3 is the only list, and it is reviewed at V9 like any other denylist `[SEC§4]` |
| **37** | **The `SKILL.md` ceiling and its per-rung deltas** *(new at the revision; the file was in five rungs' Touches and in no budget)* | §2.4, §10.3–§10.8 | **480 lines hard**, from a 410-line baseline; V3 ≤ 12, V5 ≤ 16, V6 ≤ 14, V7 ≤ 10, V8 ≤ 8; the stack tree, the contradiction discipline and the capability semantics go to `references/` |
| **38** | **The landing stance for a stacked pair** *(new at the revision)* | §12.3 | merge-commit or rebase-merge for stacked branches, **never squash** — or restack onto `main` before the PR; both human operations, so the plan's obligation is to **show stack parentage** on `handshake branches` |
| **39** | **The wall-clock budget for the new plumbing** *(new at the revision; §2.4 promised it and pointed at a section that does not contain it. **Two rows added at fix round 3**: the commit-path fetch, which rule 1 requires on every beat and no row named — so the paragraph's "the count is three" was a closed count that excluded a call on the beat, now four — and `git worktree add`, which is a full checkout of the peer's tree and had no bound and no disk price anywhere)* | §2.5, §5.4, §10.1 | **fetch 1,500 ms (rule 1's fetch-first, on the commit path, and each rebuild's re-fetch takes its own slice of what is left rather than a fresh 1,500)** / scan 1,500 ms / commit 500 ms / push the rest of the caller's deadline capped at 5,000 ms / `ls-remote` 2,000 ms off the commit path / **the peer-branch refspec fetch 5,000 ms and `git worktree add` 5,000 ms, both off-hook on the monitor's clock and skipped entirely when there is no monitor — which is what keeps `GIT_NETWORK_TIMEOUT_MS` off every hook path — at a peak disk cost of one working tree per evaluation** / **the SessionStart state-ref fetch 1,500 ms and the WHOLE shard scan 500 ms on that path** — the budget in `authorBudgetMs`'s shape `[C lib/shard-scan.js:127,160]` but **widened to wrap the per-shard `git show` reads too**, which today sit outside it `[C lib/shard-scan.js:189-192]` — so 1,500 + 500 + 7,000 fits `armSafety(9500)`; a `GIT_NETWORK_TIMEOUT_MS` of 15,000 distinct from `GIT_TIMEOUT_MS` `[C lib/repo.js:27]` and used on **off-hook paths only**, never on a hook, async or synchronous; and the tripwire corpus hoisted once per scan through `opts.secretFiles` `[C lib/filter.js:227]` |
| **40** | **The commit battery's four exclusions, the V4 test's exclusion list, and — added at fix round 3 — the tripwire's needle filter** *(new at the revision; this is B1's substance and it is a choice, not a given. The fifth narrowing is new because the 66/0 run that made the four "affordable" **never exercised the tripwire**: nothing tracked here matches `SECRET_FILE_RE` `[C lib/filter.js:202]` and `tripwireFindings` returns `[]` on an empty corpus `[C lib/filter.js:228]`)* | §4.2 item 1, §10.4, §12.2 | exclude the entropy pass, `secret-assignment`, the whitespace-stripped variant (for the pattern battery only — the tripwire keeps its own) and `env-block`; the zero-findings test excludes `test/**`, `relay/test/**`, `e2e/**`, `docs/**`, `lib/filter.js`, `lib/secret-shapes.js`. **Plus: the commit scanner filters the needle corpus before using it — value-shaped needles only (no URLs, no dotted identifiers, no filesystem or route paths), capped per file — in `lib/commit-scan.js` and never in `lib/filter.js`.** Measured on a fixture with an ordinary `application.yml` and `.npmrc`: nine needles of which two are credentials, and **six of eight ordinary code and prose samples refused**, including the English sentence *"We validate the input before sending."* — `validate` is exactly 8 chars and clears the floor §12.2 offered as the mitigation. `readSecretValues`'s JSON walk is deliberately **not** narrowed: it exists for the one-line `{"secret":"…"}` shape the red team leaked `[C lib/filter.js:170-181]`, and it is not the branch a `.yml` takes anyway. A second V4 test pins the filter by the false-positive class it removes **and** the true positive it must not lose |
| **41** | **The state-branch and work-branch write mechanism** *(added in fix round 1; it was marked `[proposed]` inline with no row, so ratifying §14 would not have ratified the mechanism M7 exists to name. **Two arms added at fix round 3**, both of which the sequence as written could not express)* | §10.1, §10.4 | temp-index plumbing — `GIT_INDEX_FILE` → `read-tree` → `update-index` → `write-tree` → `commit-tree -p` → `update-ref`; **`.git/index` never read or written, `HEAD` never moved, no checkout ever**; author/committer split through `GIT_AUTHOR_*` / `GIT_COMMITTER_*` on `commit-tree`; the same verb chain serves both branches, **with the three operands named per branch** (§10.1 for the state branch, §10.4 item 43 for the work branch). **The removal arm:** for each path on the list that is absent from disk, `git update-index --force-remove -- <path>` — verified, `--add` on a deleted path exits 128 and the `--cacheinfo` form cannot be built for it at all, so an add-only builder **skips** it and `write-tree` silently re-emits the parent's blob; a delete resurrects and a rename publishes both copies, and `files[]` is a monotonic union that still lists the deleted path `[C hooks/post-tool-use.js:79-91]`. It also bites the state branch, where `scrub` `[C lib/workspace-files.js:773-776]` could otherwise never un-publish a detached project's shards. **The mode arm:** read the mode from the parent tree with `git ls-tree`, never hardcoded and never from a disk stat — verified, `--cacheinfo 100644` demotes a `100755` parent entry, and `core.fileMode` is false on Windows. Alternative rejected: `checkout --orphan` + `add` + `commit`, which resets the human's index and stages whatever is lying around, and which the first draft's only test would have passed |
| **42** | **What opens a contradiction round** *(added in fix round 1; §6.0 is new at the revision and asserted this as settled, but it is a stated relaxation of decision 2's structure-only law and therefore exactly the class §14 exists to surface)* | §3, §5.5, §6.0, §11.3, §12.3 | **detection is the model's reading of the fetched diff** — the one sanctioned relaxation of *facts may cause work* — bounded to a seam, a named symbol, a round count (item 11) and a granted capability; **opening** is the structured `task.seam{propose, contested: true}` and **adoption** stays the fact, so decision 2's operative half is untouched. Alternative rejected: a purely structural trigger (declared symbol sets intersect **and** two materialized revisions disagree on a named field), which cannot fire in the common case where both diffs compose cleanly and both halves are wrong |
| **43** | **The work branch's base tree and parent** *(new at fix round 3; §10.4 specified the work-branch commit only as "the same plumbing as §10.1", whose operands are literally "the fetched state head", and the three plausible readings produce visibly different branches for the peer that stacks on them)* | §10.4, §11.2, §12.3 | **the base commit is recorded when the claim is acquired** (the human's `HEAD` at that moment, in the same per-workspace state as the lease's last-pushed head); the **first** commit of a claim seeds `read-tree <recorded base>` and commits `-p <recorded base>`; **every later beat** seeds from the work branch's **own previous commit** and parents on it, so the branch is a linear chain from the recorded base; **never live `HEAD`**, which moves between beats and is the human's — measured, a beat seeded from a moved `HEAD` published `M a.txt / A other.txt / D shared.txt` with only `a.txt` staged, because `files[]` bounds what is staged and not what the base tree contains. When the human's `HEAD` moves off the recorded base the branch **keeps its base and diverges**, and `handshake branches` says how far behind. **Alternative available but not taken:** restacking onto the new head, which ruling D1 does put below the floor for `handshake/<self>/*` — refused as an automatic behaviour because a rewrite fires the stack-invalidation rule on any peer stacked on this branch for a reason that peer cannot see; it stays the human operation §12.3 names, before the PR |
| **44** | **The automated push stops for a work branch once a PR exists for it** *(new at fix round 3; `branches-ignore` on `push` closes one door and `pull_request` fires on `synchronize`, so a PR opened on a live claim restarts the full four-job matrix every minute — B6's uncapped bill through the second door, behind a precondition reporting the cap as enforced)* | §4.2 item 4, §10.4, §12.5 | read the verdict with `gh pr list --head <branch>` beside the visibility call `[C lib/repo.js:150]` and on the same 600 s TTL `[C lib/repo.js:25]`; on a hit the branch's automated push goes quiet and `status` says so, and the human's pushes carry it from there — which is the right direction anyway, since opening a PR is above the floor. Unproven (`gh` absent or unauthenticated) takes the same fail-closed arm as an unproven visibility verdict: the push stops. **Not taken:** filtering `pull_request` in the workflow, which cannot work — its `branches` filters name the **base** branch and there is no head-branch filter |

**Three things this plan could not establish, marked rather than asserted:**

- **The four trigger rates of items 14–16 and 27, and item 17's threshold, are
  [unknown — needs verification].** There is no data on this project for any of
  them. **V2 is the first place there can be for item 27's and for the
  state-branch numbers of item 29; item 14's is V4 and item 16's is a month after
  V8** — the revision moved two of these because they had been anchored at rungs
  that cannot produce their data. Ratifying them means ratifying *"measure this,
  then decide"*, not the numbers.
- **Whether a work branch needs its own CI at all (item 23) is
  [unknown — needs verification].** The plan asserts that a clean `merge-tree`
  probe plus successive `ls-remote` reads answer *"is this stable enough to build
  on"*;
  nothing here demonstrates that they do, and nothing here answers *"does the
  peer's half pass its own tests"* — by design, since a work branch is
  advertised as broken-allowed (§4.1). V2 and V5 are where a stacked Claude
  either does or does not get stuck on breakage the skipped suite would have
  caught.
- **Whether the commit battery's four exclusions (item 40) leave a hole a real
  accident falls through is [unknown — needs verification].** What *is*
  established is the other half: the battery returns **zero findings** over this
  repository's 66 non-fixture tracked files, run at the revision (§4.2 item 1).
  What is not established is the false-**negative** rate, because there is no
  corpus of real accidental commits to measure it against; §12.7 names the four
  classes each exclusion gives up, V4's 3× adversarial fan-out attacks them, and
  the tripwire is the compensating control in each case.

Everything else pinned in this document was opened at `b6b3dca` during the first
pass, and everything added or retargeted in the revision at `9e810b0`.

---

## 15. Revision record (2026-09-02)

One row per finding in the adversarial review at `9e810b0`, plus the owner's two
rulings and the residuals the review's refuted table noted in passing. It exists
so the owner can trace each fix to the place it landed rather than re-reading the
document against the report.

**Fix round 1 is folded into the rows it corrects rather than given a table of
its own**, and every such correction is marked *"Fix round 1"* inside its row, so
a reader can see which of this document's own claims were wrong at the first
revision and what replaced them. Ten of them: D1's over-broad *"`--force` in any
form"*, B1's fixture count, B2's missing tier scope, B3's unqualified floor row
and unratified write path, B4's unmarked relaxation of decision 2, B5's unnamed
departure from decision 4, M6's unbounded SessionStart fetch, M20's single-leg
branch validation, M26's *"exactly one place"*, and the review's tenth residual
(R10).

**Fix round 2 is folded the same way and marked *"Fix round 2"***, and all three
of its corrections are to claims fix round 1 itself introduced: M6's 500 ms scan
budget, which was routed through an option that bounds only the author check and
left the ref path's `git show` reads unbounded; M19's new qualifier on
`GIT_NETWORK_TIMEOUT_MS`, which enumerated *one* hook-reachable network git call
where the no-monitor fallback makes three; and M26's replacement count, which
became a tally of two and missed §11.5's third per-leg result. One of the three
(M6) was load-bearing — the arithmetic it asserts is what keeps SessionStart
inside its watchdog — and the other two were true in their operative half and
wrong in their count.

**Fix round 3 is folded the same way and marked *"Fix round 3"***. It is the
largest of the three, and its shape says something about the two before it:
where round 1 corrected claims about *this document* and round 2 corrected
claims round 1 had introduced, round 3 mostly corrected claims about **git and
the code** that had been reasoned rather than run. Twenty-two findings, grouped
by severity below — and the count is stated because it is checkable against the ids below,
which is the property M26 was corrected three times for lacking.

**Three residuals from the final recheck, fixed by hand after the workflow
closed:** the round-3 group tally above, which named a count the groups below did
not match; §14 item 12, restated so the instability counter the owner ratifies
counts a conflicting real rebase as well as a head move, as §5.4 mechanism 2
builds it; and the PR-open push suspension (item 44), moved from V1 — which ships
no work branch — to V4, with its Delivers line, its Touches entry and its test.
**Three blockers.** The peer-diff refuse-list was a **denylist** on the one
surface §4.3 argues for an allowlist, and omitted most of the surface it claimed
(S2-2 → §4.2 item 5, item 36). The work-branch commit had **no stated base tree
and no stated parent**, and the one cross-reference it gave named the state
branch's (F2-3 → §10.4, item 43). And `symbols` had a carrier but **no hop into
the cache the two promised surfaces actually read**, so they would have rendered
once and gone empty (W2-1 → §7.1, §10.3).
**Eight majors.** The lease's missing-record case (S2-6); the tripwire's
unmeasured false-positive profile, which the 66/0 run never exercised (S2-8);
the write mechanism's missing removal arm and mode (F2-2); the worktree sweep
specified as an unlink (F2-7); the probe used as a rebase predictor with no arm
for a clean-probe-then-conflicting-rebase (F2-10); the git 2.38 floor with no
detection and a fallback that **exits 0 on a real conflict** (F2-11); the
`pull_request` `synchronize` door left open (F2-12); and V-D3's missing body-cap
arithmetic (W2-2).
**Eleven minors,** each a one-clause correction: the missing commit-path fetch row
and the count that excluded it (F2-4); the two ref-scoped primitives a `ref`
option cannot supply (F2-6); the absence proof a `fetch` exit code cannot give
(F2-9); the state branch's unpriced history growth (F2-13); the worktree's
unbudgeted creation, disk and Windows path length (F2-17); the ntfy half of the
symbols degrade (W2-3); the wrong client-side pin for the body cap and a byte
figure that was an estimate in a measurement's clothing (W2-6); and the four
`§2.5`/`§11` text defects fix round 2's own edits left behind (R2-1 to R2-4).
**Where it disagreed with a finding it says so in the row** — F2-4's headline
(the rebuild bound cannot fit any budget) is refuted by the threaded deadline,
F2-3's parenthetical that restacking is above the floor is refuted by ruling D1,
and F2-10's object-accumulation and unrelated-histories halves are refuted by
§12.3's changed-head trigger and by both branches sharing `main`.

### Owner rulings — settled, not proposed

| Id | What changed | Where |
|---|---|---|
| **D1** | Lease-protected force-push on `handshake/<self>/*` added to the floor table as a below-the-floor row, with the rationale (tool-owned, advertised unstable, lease refuses rather than clobbers), the rejection of merge-instead-of-rebase, and the three implementation rules: **recorded-head lease value** (never the remote-tracking ref, which V1's own background fetch can move), **stack invalidation on a rewritten base** (one rule covering the peer's rewrite, a human's rewrite and a deletion — which closes part of M28), and **the refusal test** (any other ref, no git process spawned; bare `--force` never emitted). §5.4's *"it is below the floor because it rewrites only history I own"* replaced, because that is not the test git applies — the test is whether the ref was published, and it was. **Fix round 1:** the above-the-floor cell said *"`--force` in any form"*, which contradicted the carve-out three rows above it and, read literally, forbade the helper V4 ships; it now reads **bare `--force` (or `-f`) on any ref**, naming row 3 as the one exception — the narrow reading the rest of the plan already used (§4.1 rule 3, §10.4's test). **Fix round 3 (S2-6):** rule 1 said what the lease value *is* and never what happens when there is none. The record is a plain sentinel file in the per-workspace state directory `[C hooks/common.js:26-50]`, and a cleared state dir, a `scrub`, a new machine or a differing `HANDSHAKE_STATE_DIR` all leave it absent — on which reading an implementer has three moves, two of which D1 forbids and a third it does not: passing the sha `ls-remote` returns, a lease that can never fail, one line away in V5's own helper. Rule 1 now states the absent-or-unparseable case **fail-closed** — refuse, notice, never a valueless lease, never bare `--force`, never a lease value read back from the remote — with no `[proposed]` marker and no §14 row, because marking a fail-closed default as proposed would imply the owner could ratify a fail-open. §10.4's tests gained the no-record case | §4.1 (row + three rules + the above-the-floor cell), §5.4 (mechanism 4), §10.4 and §10.5 (tests), §11.2 (asserted), §12.1 |
| **D2** | Automated push is **private-repo-only by default**: on a public or unproven verdict the whole path stays off, not just the guarded file (the guard's own hard-fail needs *tracked* material, so a public repo with no credential fires nothing today). The opt-in gate prints the verdict and one sentence naming what would become world-readable, then refuses; a human may override with a distinct typed confirmation naming the consequence, and the override is recorded in state and on the `status` line. **Coverage rule:** commit messages and branch names are scanned; binaries and non-UTF-8 files are never auto-committed and wait for a human. **Residual stated:** a scanner miss lands in the private remote's history permanently, rotation does not un-leak it, and the mitigations bound it rather than solve it | §4.2 items 1–3, §10.1 (tests, preflight), §10.4 (Delivers, tests), §11.6, §12.7 (three new bullets), §13.6 |

### Blockers

| Id | What changed | Where |
|---|---|---|
| **B1** | The commit scanner became **its own caller** with a code-shaped battery — every `PATTERNS` entry except `secret-assignment`, plus `HANDSHAKE_CREDENTIAL_SHAPES` and the local-secret tripwire — and does **not** call `check()`, so `MAX_BYTES`, its contract and every existing regression test are untouched and the windowing of old item 3 is withdrawn. **Four exclusions, each named with the false-positive class it removes**, with a fourth (`env-block`) the report did not name and the revision measured. **Verified rather than argued:** the battery was run over this repository's tracked tree at `9e810b0` — `secret-assignment` alone refuses 23 of 131 files including `bin/handshake.js`, `env-block` refuses `installers/install.sh:38-40`, and with the four exclusions and the fixture/definition list the result is **66 files, zero findings**. §12.2's trigger restated against a scanner that can run, re-anchored to V4 and instrumented with counters there. **Fix round 1:** the fixture-exclusion count was wrong twice — the text said *seven* and the list held eight; re-run, it is **nine**, the missing one being `conn-string-creds` in `test/filter.test.js`, and the four `aws-access-key` files are now named individually. The load-bearing half (66 files, zero findings) and the 23-of-131 figure both reproduce at `9e810b0`. **Fix round 3 (S2-8): the run that made the four exclusions "affordable" never exercised the control that makes them affordable.** `tripwireFindings` returns `[]` with an empty corpus `[C lib/filter.js:228]` and **nothing tracked in this repository matches `SECRET_FILE_RE`** `[C lib/filter.js:202]`, so 66/0 measured the pattern battery alone — and in a CI checkout it always will. Measured against a fixture with an ordinary Spring `application.yml` and a two-line `.npmrc`, both of which that pattern admits: **nine needles of which two are credentials, and six of eight ordinary code and prose samples refused**, including the sentence *"We validate the input before sending."* — `validate` is exactly 8 chars and clears the ≥ 8-char floor §12.2 offered as the mitigation. On a Spring or Rails tree the fail-closed gate would refuse most diffs from commit one, which is this row's own failure returning through the door this row opened. Fixed with a **needle filter on the commit path** (value-shaped needles only, capped per file, in `lib/commit-scan.js` — never in `lib/filter.js`, and never narrowing `readSecretValues`'s JSON walk, which exists for the shape the red team leaked), a second V4 test on a fixture, and §12.2's *"this is now the whole of the false-positive surface"* — an affirmative completeness claim about an unexercised control — replaced by the measurement | §4.2 item 1, §10.4, §12.2, §12.7, §14 items 3 and 40 |
| **B2** | A **fifth required guardrail** for the inbound direction: fetched peer content is untrusted data that can also execute. Fetch into a namespaced ref; evaluate in a throwaway worktree under the plugin state dir, never the live tree; refuse the automatic rebase when the peer's diff touches `CLAUDE.md`, `.claude/**`, `.github/**`, `.handshake/**`, `package.json` scripts, lockfiles or `Makefile`, rendering a notice instead; no build, install or test in a tree carrying unmerged peer commits without a human turn. §3 says what the four existing validations do not reach. Added to §11.6, to V9's red-team scope and to §13.6's `SECURITY.md` list. **Fix round 1:** §10.5's Tier line now carries the Opus **xhigh** scope for the inbound guardrail that §10.9's table already gave it — the omission was in the rung, not the table. **Fix round 3 (S2-2): the rebase gate was a denylist, and it is now a posture.** A list of seven names was the one denylist among this plan's three allowlists, on the exact surface §4.3 argues the other way about — *"Allowlist, not denylist, on the path the tool writes without a human"* — and it omitted `.mcp.json` (Claude Code's project-scope MCP server file, at the repo root and outside `.claude/**`), a non-root `CLAUDE.md`, `AGENTS.md`, `.husky/**`, every non-GitHub forge file and every build file that is not literally `Makefile`, while §12.7 claimed the guardrails removed the automatic path to *"my instruction files, my config and my build"*. It was also **name-only**, so a mode change on an allowed path was invisible: verified, a regular-file→symlink swap shows as `src/foo.js` under `--name-only` and only `:100644 120000 … T` under `--raw`. Now three rules — a **locally derived** allowlist (my own `files[]` prefixes, never the peer's, which a malicious peer authors), a **mode rule** read from `git diff --raw`, and a **floor** the allowlist cannot open for the instruction and build surfaces a pair may legitimately have on its own claims. §14 item 36 now ratifies the posture rather than a list; §12.7 states what remains. **Also (F2-7, F2-17):** the worktree is created **after** the two checkout-free checks rather than before, with `--no-checkout`, a sparse checkout and `-c core.longpaths=true` on Windows, and the bullet now says that `git worktree add` writes into the human's `.git/worktrees/` — which *"not in the human's checkout"* invited a reader to assume it does not | §3, §4.2 item 5, §5.4, §9 (capability bound), §10.5 (Delivers, Touches, Tier), §11.2, §11.6, §12.7, §13.6, §14 items 35 and 36 |
| **B3** | The work-branch commit takes **only the claim's own progressive `files[]`** `[C hooks/post-tool-use.js:79-91]`, through the same temp-index plumbing as the state branch, and **never moves `HEAD`**. Files outside the claim are never committed. **One active work branch per member** picked and marked `[proposed]`, with shared-branch-for-concurrent-claims as the recorded alternative. Tests: a dirty unrelated file is never pushed; `git rev-parse HEAD` and `git symbolic-ref HEAD` unchanged. **Fix round 1, two:** the floor table's own row 2 still said *one per claim* unqualified, and now carries **at most one active at a time (§10.4)**, since the floor table is the normative artifact; and the temp-index write mechanism, marked `[proposed]` inline with no §14 row, became **§14 item 41** — the two-way property restored on the mechanism M7 called the one most likely to destroy a human's work. **Fix round 3 (F2-3): the commit had a path filter and no base.** §10.4 specified the work-branch commit only as *"the same temp-index plumbing V1 specifies"*, and §10.1's operands read literally *"the fetched state head, or empty"* — meaningless for a work branch, and on the *"or empty"* arm a parentless commit whose tree is only `files[]`, which contradicts §11.2, §12.3 and every PR this design expects. The `files[]` filter bounds what is **staged** and nothing about what the base tree **contains**: verified, a beat seeded from a moved `HEAD` published `M a.txt / A other.txt / D shared.txt` with only `a.txt` staged, and none of §10.4's existing tests can tell the three readings apart, since `git rev-parse HEAD` and `git symbolic-ref HEAD` pass under all of them. Fixed as **§14 item 43**: a base commit recorded at claim acquisition, the first commit parented on it, every later beat on the branch's own previous commit, never live `HEAD`, and a divergence the human restacks before the PR. One correction to the finding: it called restacking *"above the floor"*, and ruling D1 puts a lease-protected rewrite of `handshake/<self>/*` **below** it — so the option exists and is declined for a stated reason (it fires a stacked peer's invalidation rule for a cause the peer cannot see), rather than being unavailable | §4.1 (row 2), §10.1, §10.4, §11.2, §14 items 30, 41 and 43 |
| **B4** | **§6.0 is new and defines what opens a round, once**, and §5.4, §5.5, §6, §11.3 and §12.3 all now point at it: **detection is the model's reading** of the fetched diff, **opening is the structured act** of posting `task.seam{propose, contested: true}` into an already-open seam, **adoption stays the fact**. §3 says plainly that this is the one place model judgement opens a protocol step, and bounds it. §5.4 gained a **discriminator** so an unclean probe means one thing (sequence) and never two; §11.3's *"the rebase fails on the value, not the text"* was replaced, because the probe applies **cleanly** in that scenario and that is the point. **Fix round 1: detection-by-reading is marked `[proposed]` and collected as §14 item 42.** It is a stated relaxation of decision 2, a FINAL DECISION of the owner's, and the first revision asserted it as settled with no marker and no row — so the owner could not have ratified or refused it in the pass §14 exists for. The alternative (a purely structural trigger) is recorded in the row with the reason it was not taken | §3, §5.4 (discriminator), §5.5 (table), §6.0, §11.3, §14 item 42 |
| **B5** | `presence.update.head` and `task.claim.symbols` cannot travel on the relay; §2.3 states the trade in full and **picks option (b)**: withdraw V-D1 and read the branch head with `git ls-remote`; keep V-D2 and state its **carriage rule** (on the relay the authoritative carrier is `task.change{scope}`, which is envelope-carried). Reasons given: the closed-catalog `[F]` line stays untouched (option (a) would be the third amendment in one wave), the relay needs no migration, and the head becomes a fact the peer cannot author. §14 items 8, 9 and 21 rewritten. **§9.2 stays on the not-amended list — as a stated result of the choice, not an assumption** — and no relay file enters any rung's Touches. The cost of (b) is stated: one `ls-remote` per peer branch per poll, a poll-clock rather than push-instant signal, and a `task.change` envelope that relay retention can evict while its claim is live. **Fix round 1:** withdrawing V-D1 also withdraws **decision 4's named *"structured branch-moved event on each peer push"***, and §5.4 and item 8 now say so in the same register as the already-named loss of `branch CI passing` — stronger fact, worse latency (60 s relay, up to 600 s ntfy), the decision named rather than left to be discovered. **Fix round 3 (W2-1): option (b) picked a carrier and never named the hop off it.** Both surfaces this plan promises read **only** the cached claim rows — the gate iterates `state.getPeers().claims` and matches `c.files` `[C hooks/pre-tool-use.js:51-58]`, and the card's `details[]` are built inside the same loop `[C hooks/common.js:564-580]` — while a `task.change{scope}` envelope is a digest item **consumed by the watermark at injection** `[P§6.3]`, the same mechanic §6.2 cites to reject `note.blocker`. So as written the symbols rendered on the arrival turn and both surfaces went empty afterwards, §11.1 could not be satisfied, and §2.4's *"every turn"* row mispriced a vehicle that fires once. `hooks/sync.js` and `lib/state.js` were also absent from V3's Touches, and `bin/handshake.js` sets the claim rows wholesale on every CLI `sync` `[C bin/handshake.js:1006-1010]`. Fixed: `mergeClaimFiles` `[C hooks/sync.js:89-126]` — whose own comment states this exact job for `files` — harvests `symbols` into `peers.claims[].symbols`, a **separate** array never merged into `files[]` (§11.6 asserts a peer symbol never becomes a filesystem path) escaped at `{ max: 100 }` rather than through the `path` class; both files enter V3's Touches; the CLI `sync` merges; and §10.3's test became the durable one — arrive on one envelope, consume it, and assert the card and the gate line on a **later** turn. **Also (W2-3):** §2.3's degrade paragraph stated the relay half only; the ntfy half is worse and is now stated — past the ~12 h cache a claim set is resurrected from `presence.update.claims[]`, a four-field `[F]` row `[C docs/PROTOCOL.md:298]` `[C lib/transport-ntfy.js:308-317]`, so that degrade is **permanent by design** rather than a retention window. **And (W2-6, W2-2):** the client-side pin for the 2,048-byte body cap was `[C lib/filter.js:22]`, which is `check()`'s per-**string** input cap and the very constant §14 item 3 withdraws as irrelevant to the scan path — repinned to `[C lib/envelope.js:18,316]` in §2.3 and item 9; *824 bytes* was an estimate written in a measurement's register and is now the measured 825/835 plus a checkable 1,319-byte maximal claim body; and **V-D3 got the arithmetic V-D2 got and it had not** — 1,415 → 1,710 of 2,048, 295 bytes, 45% of the slack, `text`'s non-ASCII budget 916 → 769 two-byte characters, with the consequence that `[COBUILD §4.2]`'s *"tell the human to shorten the contract"* is the wrong instruction when a model's `rationale` spent the bytes | §2.3 (whole subsection), §5.4, §5.5, §7.1, §9, §10.3, §10.5, §10.9, §14 items 8, 9, 10, 21 |
| **B6** | The CI-skip guardrail became a **precondition the V1 preflight enforces in the pair's repo** — no push-triggered workflow, or a `branches-ignore` covering `handshake/**` — refusing to enable the automated push until it holds, with a copy-pasteable snippet in the refusal. This repository's own two lines of YAML **moved from V4 to V1**. §12.1's unconditional claim corrected. §4.2 item 4's *"three-job matrix run"* and §12.5 corrected to **four job runs**, with the Windows 2× multiplier and the 480-pushes-per-member-day scale. **Fix round 3 (F2-12): the same bill was still open behind the other door.** *"With `pull_request` untouched"* was written as the correct place for the cost, and a bare `pull_request:` trigger — which is what this repository has `[C .github/workflows/ci.yml:13-15]` and what the refusal's own snippet hands the pair — defaults to `opened, synchronize, reopened`, with `synchronize` firing on **every push to the PR head branch**. The work branch is pushed freely as a live view at exactly the cadence this item prices, and the PR head ref is that same ref, so a PR opened on a live claim restarts four job runs every minute for as long as it is open — behind a precondition that reports the cap as enforced. Filtering `pull_request` in the workflow cannot close it: its branch filters name the **base**. So the guardrail gained a second half, **§14 item 44** — the automated push stops for a work branch once `gh pr list --head` says a PR exists, unproven takes the fail-closed arm — and §12.5's *"a pull request from a work branch still runs all four job runs"* now says *at the moment it is opened and once per human push thereafter* | §4.2 item 4, §10.1, §10.9, §12.1, §12.5, §14 items 4 and 44 |

### Majors and minors

| Id | What changed | Where |
|---|---|---|
| **M5** | One `handshake/state` branch kept, as decision 3 states, and given a protocol: fetch first, adopt the remote branch and never re-create it, build with `commit-tree -p <fetched head>` carrying only this member's paths, and on a non-fast-forward rejection **re-fetch and rebuild — never retry** — in a loop bounded at 3 per beat. A `rejected` status state distinct from `offline`. A push budget outside the 8 s CLI slice (§2.5). Tests for a two-clone same-second collision and a seven-day-offline replay. Per-member branches recorded as the fallback, with the cost of the migration named. **Fix round 3, two.** **(F2-9)** Rule 2's *"only when the fetch proves the remote ref absent"* asserted a git behaviour the mechanism rule 1 names does not have: the exact-refspec fetch exits **128** both for a missing ref and for an unreachable remote, so the rule could not be implemented from it. `git ls-remote --exit-code --heads` is now named as the proof, with its exit codes pinned (0 present / 2 absent / anything else unknown ⇒ do not create — measured 0/2/128), and V1's tests assert that an unreachable remote creates **no** root. The consequence of leaving it unnamed was not unsafe — the letter of the rule fails closed and the unsafe reading self-heals through rule 4 — but a rule whose stated mechanism cannot produce its stated verdict is a rule nobody can build. **(F2-13)** §12.1 priced the state branch as a reflog, a notification stream and a `git branch -r` listing, and never priced the thing nobody looks at: its **history**, which grows forever at §12.5's own rate and lands in every clone. Measured on a synthetic 300-commit corpus of §10.1's shape: **5 objects and ~445 packed bytes per commit**, linear (git deltas each append against the previous), so roughly **1.2M objects and ~100 MB of pack a year** at 480 pushes × 2 members × 250 days — paid by a full `git clone`, not by `actions/checkout`. Stated as a residual with the human remedy the protocol already supports (delete the ref; rule 2 restarts both sides on a fresh root), and **the finding's other option refused**: a lease-protected re-rooting carve-out for `handshake/state` is not proposed, because D1's reasoning turned on the ref being tool-owned and unshared and this one is a shared two-writer ref. V2 captures `git count-objects -vH` so the number stops being synthetic | §4.1 (row), §10.1, §10.2, §12.1, §14 item 29 |
| **M6** | The **read half is a V1 deliverable**: automatic fetch of the state ref on the SessionStart async path; a `ref` option through `scanShards` / `checkShardAuthors`; `readShardFromRef` deriving its path with `shardFileName`; a bounded budget with a truncation verdict in the shape the author check already uses. §11.5's *"local disk I/O"* sentence replaced — a fetch writes objects no working-tree read can see, and nothing fetched. **Fix round 1: the fetch has its own wall-clock bound.** The first revision sited it by borrowing the argument of the comment at `[C hooks/session-start.js:64-79]`, which says the thing placed there makes *no network call*, and pinned the injector's 500 ms wait as its window. Corrected: it is budgeted at **1,500 ms** as §2.5's SessionStart row against `armSafety(9500)` minus the 7,000 ms sync, with the scan bounded at 500 on that path; over budget it is abandoned, the scan falls back to the last fetched ref and reports stale/`truncated`, and the pending marker is still cleared. Test added: SessionStart against an unreachable remote clears the marker and still runs the sync. V1's Touches gained `lib/shard-scan.js`, `lib/workspace-files.js` and `hooks/session-start.js`; a six-day-absent test added. **Fix round 2:** that 500 ms was routed through `authorBudgetMs` *as it stands*, which bounds only the author `git log`s — it wraps the runner handed to `checkShardAuthors` `[C lib/shard-scan.js:128-142]` and never the shard-body loop below it `[C lib/shard-scan.js:189-192]`, which on the ref path is the `git show` per shard and the scan's dominant cost. So M6's own arithmetic did not close: up to 20 unbounded `git show` calls at `GIT_TIMEOUT_MS` each `[C lib/repo.js:27]` could still burn the watchdog with the marker uncleared, which is the failure M6 exists to prevent. The budget is now stated as the **whole scan's**, in `authorBudgetMs`'s shape but **widened** to wrap every git call the scan makes, and a test pins it: per-shard reads that hang return `truncated` inside the watchdog with the marker cleared. **Fix round 3 (F2-6): "a `ref` option threaded through" hid two new primitives and a change of meaning.** `checkShardAuthors` reaches the working tree twice and neither reach is an option: it enumerates with `listShards(root)`, a `readdirSync` `[C lib/workspace-files.js:425-430,449]`, and it asks `lastCommitEmail`, whose `git log` carries **no rev** `[C lib/repo.js:339-356]`. On the ref path both are wrong, and §11.5 is precisely the case where the peer's shard exists only on the ref: verified, `git log -1 -- <shard>` printed nothing where `git log <ref> -1 -- <shard>` printed the member's email, and `git ls-tree -r --name-only <ref>` listed a shard the disk walk could not see. So V1 now names `git ls-tree <ref> -- .handshake/tasks` for enumeration (chosen over the local member roster, which cannot name a member this client never recorded) and a rev argument on `lastCommitEmail`'s `git log`, both in V1's Touches — **and claims the semantic upgrade instead of hiding it**: on the state branch the last commit touching a shard has **author = member, committer = tool**, so `[SEC§5.4]`'s non-member warning becomes a real verdict there. One unrelated slip in the same sentence corrected: `checkShardAuthors` takes no `kinds`; only `scanShards` does | §2.5, §4.3, §10.1, §10.9, §11.5, §14 item 39 |
| **M7** | The write mechanism is named: `GIT_INDEX_FILE` → `read-tree` → `update-index` → `write-tree` → `commit-tree -p` → `update-ref`, never touching `.git/index`, never moving `HEAD`, never checking out. The failure it prevents (`checkout --orphan` resetting the human's index) is stated, together with the fact that the first draft's only test would not have caught it. The `HEAD`-and-`git status` invariant test added across a hundred commits. **Fix round 3 (F2-2): the sequence could add and could never remove, and it did not say what mode it wrote.** Verified on git 2.53 against a `read-tree`-seeded temp index: `update-index --add` on a path absent from disk exits **128**, and the `--cacheinfo` form cannot be constructed for it at all (no blob to hash), so a builder walking the path list **skips** it and `write-tree` silently re-emits the parent's blob — **a delete resurrects and a rename publishes both copies**, on a branch a peer stacks on. It is not an exotic case: `files[]` is a monotonic union `[C hooks/post-tool-use.js:79-91]`, so a path written then deleted inside one claim is still on the list. The state branch has the same hole from the other end — `scrub` `[C lib/workspace-files.js:773-776]` could never un-publish a detached project's shards. Fixed with a `--force-remove` arm keyed on absence from disk (verified: exit 0, path leaves the tree) and a **mode read from the parent tree with `git ls-tree`** — verified, `--cacheinfo 100644` demotes a `100755` entry, and a disk stat does the same where `core.fileMode` is false. V1 and V4 gained the delete, rename and exec-bit tests, and §10.1's block now names its three operands per branch instead of leaving the work branch's blank | §10.1, §10.4 (same plumbing), §14 items 41 and 43 |
| **M10** | The **squash hazard** stated: Alex's commits inside Bob's rebased branch become duplicates when Alex's side squash-merges, and Bob's PR then conflicts in a way neither Claude created. Stance picked — merge-commit or rebase-merge for stacked branches, never squash, or restack before the PR — both human operations, so the plan's own obligation is to **show stack parentage** on `handshake branches` rather than only age. No sixth acceptance scenario, with the reason given | §10.5 (Delivers), §12.1, §12.3, §14 item 38 |
| **M19** | **§2.5 is new**: the wall-clock budget §2.4 promised and pointed at a section that did not contain it. A per-beat split (scan / commit / push / `ls-remote`) with an ordering, the deadline threaded the way `beat()` already threads one, a network-git timeout distinct from `GIT_TIMEOUT_MS`, and the tripwire corpus hoisted once per scan through the existing `opts.secretFiles` override — the 651 ms → 73 ms measurement stated. §2.4's dangling pointer fixed. **Fix round 2:** the qualifier keeping `GIT_NETWORK_TIMEOUT_MS` off hook paths was written as an enumeration — *"the one network git call a hook makes is the state-ref fetch"* — and the plan's own no-monitor fallback makes two more, since `hooks/stop.js` runs the whole `beat()` `[C hooks/stop.js:163]` and §5.4 pins the peer-head poll to that same fallback `[C hooks/stop.js:113]`. The operative half was right and the count was wrong: the paragraph now names **three** hook-reachable network git calls — fetch, push, `ls-remote` — each taking its own row (1,500 / 5,000 / 2,000 ms), and the `ls-remote` row no longer says *"never inside a hook that a turn waits on"*. **Fix round 3, four corrections, three of them to fix round 2's own edits.** **(F2-4)** The count was still wrong: §10.1 rule 1 is *"fetch first, always"* on the commit path, so a **fourth** network git call rides `beat()` and the table had no row for it — a closed inventory that excluded a call on the beat. A fetch row is added at 1,500 ms, the count reads **four**, and rule 4 now says the 3-rebuild bound is an attempt ceiling against the threaded deadline rather than a wall-clock commitment. *The finding's headline — that the bound cannot fit any budget — is refuted*: §2.5's own threaded `opts.deadline` `[C monitors/heartbeat.js:196-213]` truncates the loop and rule 4 defers the rest, and its 90 s figure ignores this table's own 5,000 ms push ceiling. **(R2-2)** The table preamble still classified those rows as *"not on the beat"*, which fix round 2's edits falsified twice; the classifier is now **not on the commit path**, which is the property they actually share. **(R2-3)** Both new `[P§5.4]` pins were wrong under this document's own header convention — PROTOCOL §5.4 is the deterministic tiebreak and says nothing about polls — and are dropped; the plan's own §5.4 was already named in plain form in the same cell. **(R2-1)** Removing *"it runs on the monitor's poll, never inside a hook"* left the V5 peer-branch fetch unplaced, and §5.4 hands it `GIT_NETWORK_TIMEOUT_MS`; §2.5 and §5.4 mechanism 3 now both say in one clause that only the peer-head `ls-remote` rides the beat, and the refspec fetch, the worktree and the probe are off-hook and skipped with no monitor. **(F2-17)** `git worktree add` is a full checkout and had no row, no disk price and no Windows path-length rule; it gets a row, a sentence of disk cost, and the `--no-checkout` / sparse / `core.longpaths` mechanics in §4.2 item 5 | §2.4, §2.5, §5.4, §10.1, §12, §14 item 39 |
| **M20** | A peer's `branch` is validated **at the receive boundary**, before it is ever a git argument: `^handshake/<the authenticated sender's member id>/[A-Za-z0-9._-]{1,120}$`, discard-and-count otherwise. Option injection named as the gap `shell: false` does not close. Fetch by explicit refspec with `--` and a fully-qualified source. **Fix round 1: the rule is stated per leg.** The first revision keyed it on `from.member` and located it in `lib/envelope.js` — B5's own carriage finding repeated, since `presence.update` is no envelope on the relay and the row's `branch` reaches the client through `lib/transport-relay.js`'s `sync.presence[]` map, unchecked. Now: ntfy checks the signed `from.member` in `lib/transport-ntfy.js`'s presence assembly, the relay checks the server-authoritative `member_id` in `lib/transport-relay.js`'s `presence()`, `lib/envelope.js` is left enumerating no body field, both transports enter V5's Touches, and §11.6 asserts both legs | §4.2 item 5, §5.4, §10.5, §11.6, §14 item 35 |
| **M23** | `git rebase --dry-run` does not exist; the probe is **`git merge-tree --write-tree`** (git 2.38+). Real rebases happen in a dedicated worktree under the plugin state dir, with a startup sweep for abandoned worktrees, and fetch gets its own timeout. §12.3's safety claim re-grounded on a primitive that has the property it claims. **Fix round 3, three corrections to this row's own substitutes.** **(F2-10)** The probe was made the deciding fact and the replacement for `branch CI passing`, and it is a **proxy**: `merge-tree` composes two endpoints against a merge base where a rebase replays each commit, so a clean probe does not imply a clean rebase — measured, a net-empty endpoint diff whose intermediate commit conflicts gives `merge-tree` exit 0 and `rebase` exit 1. The plan had **no arm** for that case, and the instability counter counts head moves, so nothing would increment and the client would sit stacked-but-not-rebased. The arm is added — abort in the worktree, drop the stack, sequence, count against the bound — with the §10.5 test. *Two halves of the finding refused*: object accumulation, because §12.3 already triggers on a **changed head** and not a timer, so there is no cadence to accumulate against; and unrelated histories, unreachable when both branches are cut from the same `main`. **(F2-11)** The fallback is **withdrawn, not kept**: measured, on a real conflict `merge-tree --write-tree` exits 1 while `git apply --check --3way` prints *"Applied patch … with conflicts."* and **exits 0**, with or without `--cached` — a fallback that would report a dirty base as clean, under ruling D1's force-push, on the one branch nobody tests, since Ubuntu 22.04 LTS ships git 2.34.1 and both CI legs are above 2.38. Instead the V1 preflight gains a **fifth precondition** — `git --version`, recorded — and **below 2.38 the stacking capability is off** and says so. **(F2-7)** The sweep was specified *"in the shape `hooks/session-end.js` already uses for stale sentinels"*, i.e. an unlink — and verified, `rm -rf` on a worktree leaves it registered as `prunable`, keeps `.git/worktrees/<name>`, and **permanently blocks re-use of the path**, so on a deterministic path the first hard kill would disable peer evaluation for good. It is now `git worktree remove --force` followed by `git worktree prune`, and §10.5 gained the only test that discriminates the two: **the next probe at the same path succeeds** | §4.2 item 5, §5.4, §10.1 (preflight), §10.5, §12.3, §14 item 32 |
| **M24** | `hooks/session-end.js` added to V1's Touches as the best-effort last-batch flush, inside its 3 s budget, with the monitor's hard-kill as the reason. **Headless sessions** say what they do — the batch rides the Stop-hook fallback at the transport keepalive — and say it in `status` the way the no-monitor arm already does. Subagents restated as already-correct. §2.3's *"§8 not amended"* qualified: the budgets stand, and the push takes a slice of Stop's existing deadline rather than extending it | §2.3, §10.1 |
| **M25** | Credentials, signing and forge rejection addressed: the push reuses the human's git credentials, is never given its own, and **fails rather than prompts** (`GIT_TERMINAL_PROMPT=0` is already set); the V1 preflight proves it with `git push --dry-run`; `commit.gpgsign` is checked and either overridden per-commit or the opt-in refuses; a **`rejected`** arm distinct from offline, because the `push refused` notice literal already means the secret-scan refusal | §10.1 |
| **M26** | §11's preamble states per-leg expected results and §11.3/§11.4 carry them: relay is zero human turns, ntfy is one `handshake seam pull` confirmation per inbound revision per receiving side. §6.4 states the same in prose. §12.7 gains the bullet: **autonomous contradiction resolution is a relay-tier capability**. **Fix round 1:** the preamble's *"they differ in exactly one place"* was falsified by §11.6's own per-leg security result, so it now names **two** — the contradiction protocol, and `from` being server-authoritative on the relay and self-declared on ntfy (which is also why M20's branch check keys on a different id per leg). **Fix round 2:** a tally invites the next miscount, and §11.5 held a third per-leg result the count had missed — `· older chatter gone` `[C hooks/render.js:70]`, which renders on ntfy and nowhere else. The clause became a **scope** rather than a tally: two differences change a *pass criterion*, one changes only what renders. **Fix round 3 (R2-4):** that replacement went one phrase too far — it said the third changes *"only what renders **and no criterion**"*, and the line sits inside §11.5's **Asserted** paragraph, which is where this document's pass criteria live, so it **is** a per-leg criterion. The clause now says what is true of it: it changes only what is **rendered**, not what either leg must **achieve**. Three passes on one sentence is itself the lesson — the first two were corrected for over-claiming a count, and the third for over-claiming a kind | §6.4, §10.6 (tests), §11 preamble, §11.3, §11.4, §11.5, §11.6, §12.7 |
| **M27** | Three re-anchorings. `branches-ignore` moved into **V1**. The secret-scan false-positive trigger moved to **V4** with counters in V4's Delivers, since V1's commits carry filtered shard text and not code diffs. The outcome-corpus cut trigger moved to a window **after V8**, since V8 creates the kind and the rule could otherwise only ever fire. §10.2 and §12.2 corrected to claim only what each rung can raise | §10.1, §10.2, §10.4, §12.2, §12.6, §14 items 4, 14, 16 |
| **M28** | Four gaps closed. **Mutual stacking**: the lexicographically smaller member id never stacks, reusing the frozen comparator `[proposed]`. **Vanished peer**: base-claim expiry/staleness becomes a third resume trigger, so item 24 is release, done, **or** the base claim going stale. **Rewritten or deleted base**: one stack-invalidation rule covering the peer's own lease-protected rewrite, a human's rewrite and a deletion. **Nested stacks**: not permitted, stated | §4.1 (D1 rule 2), §5.4, §9, §10.5, §14 items 24, 33, 34 |
| **M36** | The card renders the symbol's **discriminating tail** (`Handler.shape`) through the existing 20-char slot, because `escapeSlot` ellipsises and the path is what survives otherwise; the **full `path::Symbol.member` prints on the PreToolUse gate line**, which has no 600-char budget. §11.1's assertion rewritten so it cannot pass vacuously, and a V3 test pins the entry's content | §2.4, §5.3, §7.1, §10.3, §11.1, §14 item 9 |
| **M37** | A **total order over seven kinds** with safety first — rotation demand, private-repo guard, push refused, escalated, conflict, rebase needed, round open — replacing a four-kind order that did not know the channel already has three producers seeded ahead of it. The bare `.slice(0, 2)` becomes a **sort by rank**. §2.4's "four kinds into two slots" corrected to seven. Test: a rotation demand plus two coordination notices still renders the rotation demand | §2.4, §10.3, §14 item 22 |
| **M40** | A **`SKILL.md` row in §2.4** with the per-rung line-count delta, the per-engagement token total against the 410-line baseline, and a **480-line ceiling that gates every rung**. Progressive disclosure through the existing `references/` for the stack tree, the contradiction discipline and the capability semantics, leaving trigger conditions in `SKILL.md` proper. V3, V5 and V6 carry the split; V3's tests carry the gate | §2.4, §10.3, §10.5, §10.6, §14 item 37 |
| **M44** | A **ref-name sanitizer** separate from `shardFileName`: strip a trailing `.lock` from every slash component, reject a component beginning with `.`, reserve `state` as a member-component name, and validate with **`git check-ref-format --branch`**. The two verified failures — `alex.lock`, and a member sanitizing to `state` colliding with `refs/heads/handshake/state` — stated. V4's test asserts against `check-ref-format`; both cases join V9's corpus | §10.4, §11.6, §14 item 2 |
| **M46** | A `+N !` overflow literal on the notices channel, ~4 chars inside the computed headroom, priced in the V3 gate, recorded beside item 22 which is what creates the need. Grounded in `plans()`'s own comment that silently dropping them is the *"reported a truncated read as an empty one"* failure | §2.4, §10.3, §14 item 31 |

### Residuals from the review's refuted table

Each was checked, did not stand as a finding, and left one line worth writing.

| # | What changed | Where |
|---|---|---|
| **R1** | §14 item 1 became an **explicit path allowlist** rather than "the directory", because `.handshake/secret.json` is exactly the file in that directory that must never be committed | §4.3, §14 item 1 |
| **R2** | *"Per peer"* qualified: enforceable on the relay, where `from` is server-authoritative and a mismatch is refused; **advisory on ntfy**, where `from` is self-declared under a shared workspace secret | §9 |
| **R3** | The **turn-scoping law** stated in one clause: every autonomous behaviour happens at a model turn, and only the state-branch batch, the presence beat and the peer-head poll ride the monitor's clock | §3, §11 preamble |
| **R4** | **§13.6 is new**: what must change in `SECURITY.md` and which rung does it, in five rows | §13.6 |
| **R5** | The **seam TTL bound** stated in §6.4's prose — default 2 h, maximum 24, derived on both sides, announced by nobody — so "escalation has no bound" has an answer in the text | §6.4, §11.4 |
| **R6** | §7.1's `files[]` analogy corrected: `files[]` is **hook-observed**, `symbols` are **model-remembered**; they share a shape and not evidentiary weight, which is why §5.4 never lets symbols decide | §7.1 |
| **R7** | **V-D2's per-entry cap lowered** to ≤ 8 × ≤ 100 so the body fits the 2,048-byte cap beside a maximal subject, with the arithmetic shown and `files[]`'s more acute overrun noted as the convention. **Fix round 3 (W2-6, W2-2):** the arithmetic was shown against the **wrong constant** — `[C lib/filter.js:22]` is `check()`'s per-string input cap, not the body cap, and it is the constant §14 item 3 withdraws from the scan path as irrelevant; repinned to `[C lib/envelope.js:18,316]`. *824 bytes* was an estimate in a measurement's register; measured it is **825** as a bare array, **835** as a `"symbols":` member, and a maximal claim body is **1,319 of 2,048**. And the same arithmetic was then **done for V-D3, which had none at all** — 1,415 → 1,710, 295 bytes, 45% of the slack, `text`'s non-ASCII budget 916 → 769 two-byte characters — in the one body `[COBUILD §4.2]` singles out as byte-cap-bound and refuse-rather-than-truncate | §2.3, §7.1, §14 items 9 and 10 |
| **R8** | The negative rule written: **a changed head never causes an off-cadence post.** V5 adds zero transport operations in either direction | §5.4 |
| **R9** | §7.3's **denominator named**: warnings overridden on a symbol-disjoint claim, over all warnings on claims where **both** sides declared symbols | §7.3, §14 item 17 |
| **R10** | The **cut-trigger rates of §12.4 and §12.6 are *per pair* by construction** — a seam names exactly two members, grants are per-peer, branches are per-member — so *one per pair per working day*, *less than once per pair per week* and *one month of two-pair use* are scoped to two members and would need re-basing if the stage ever grew past two. Stated so the denominator is not read as workspace-wide (the review's refuted table left this line unwritten) | §12.4, §12.6, §14 items 15, 16, 27 |
