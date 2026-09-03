# claude-handshake — v2 build plan: autonomous collaboration between two owned Claudes

**Status: BUILD PLAN. Nothing here is built. Nothing here is ratified.**
**Protocol version integer stays `1`. Every wire change below is a PROPOSED
Appendix B v1.1 delta awaiting Fenil's ratification; none is taken as given.**
**Date: 2026-09-02. Written against HEAD `b6b3dca`, tree clean.**
**Revised 2026-09-02 against the adversarial review at `9e810b0`; owner rulings
D1 and D2 of 2026-09-02 folded in as settled. §15 is the revision record, one
row per finding.**
**Simplified 2026-09-02 on the owner's direction: three committed stages and the
run; stacking, contradictions, the capability table and outcome records gated on
the run (Appendix G); one work branch per member; `[skip ci]` replaces the CI
precondition.** §15's last table is the simplification record, one row per move,
removal and addition.
**Second-look round, 2026-09-02:** the re-root's detection, its replay mechanism
and its ref names; the write mechanism's missing `hash-object -w` and its add-mode
arm; a create arm on D1's lease push for a branch the forge deleted; a per-stage
`push:` vocabulary with a tenth word; the peer's branch line reduced to what the
committed slice can prove; and three Appendix G corrections. Folded into the rows
they correct in §15.

Markers follow the house convention: `[P§n]` = PROTOCOL.md section n,
`[SEC§n]` = SECURITY.md section n, `[PLAN§n]` = PLAN.md section n,
`[COBUILD §n]`, `[COBUILD-PLAN §n]`, `[DELEGATION §n]`, `[KNOWLEDGE §n]` for
those documents, `[C file:line]` = value as implemented and opened at `b6b3dca`
during this pass. Every `[C]` marker was read at its line this session. Every
`[C]` marker **added or retargeted in the revision, in either fix round, or in
fix round 3** was re-opened at `9e810b0`, and every `[C]` marker **added or
retargeted in the simplification pass** was re-opened at `f1c82f8`. All three
baselines differ from one another in **this file and no other**, so they name the
same lines in every file cited here; the **second-look round** added no new `[C]`
marker and re-opened the ones it relies on at `f1c82f8`. **Every git behaviour
stated as verified in fix round 3 or in the second-look round was run at
git 2.53 in a scratch repository,
and every byte figure was run through this tree's own `canonicalJson`
`[C lib/envelope.js:98]`** — §12.7's measured-exceptions bullet keeps the
list. **The `[skip ci]` behaviour of §4.2 item 4 was verified against GitHub's
and GitLab's own published documentation on 2026-09-02**, not against a
scratch repository, and is the one claim in this document that rests on a
vendor's text rather than on a run. Choices
this plan had to make that the design discussion did not make are marked
**[proposed]** inline and collected in §14 — **for the committed slice**; the
gated rungs' proposals are collected in Appendix G's own list, so the owner's
ratification pass covers Stages 1–3 and nothing else.

---

## 1. What this plan is

This is the plan for the stage after v1.1: **two independently owned Claude Code
instances, on two accounts and two machines, collaborating on one repository
without a human relaying anything between them after each human said yes once.**
It is not a design document — the design decisions were settled in the 2026-09-01
discussion and this plan's job is to turn them into a build order, a wire budget,
a set of acceptance scenarios and a risk list, in this project's register.

**What it commits to, after the simplification of 2026-09-02.** Three stages and
one run:

1. **Stage 1 — Durability.** The `handshake/state` branch: coordination state
   committed and pushed on the machine's own clock, and read back on the next
   session start. One opt-in, three preconditions, no CI configuration.
2. **Stage 2 — The live view.** One work branch per member, reused across every
   claim, pushed freely with a fail-closed secret scan in front of it, plus
   declared symbols on claims so the file-level gate stops warning about work
   that does not overlap.
3. **The run.** Two humans, two machines, one working day, over Stages 1 and 2.
4. **Stage 3 — Gate and release.** The security consolidation, the red team over
   what was actually built, and the documentation.

**And what it does not commit to.** Stacking on a peer's branch, the
contradiction protocol, the trusted-pair capability screen and coordination-outcome
records are **designed in full and gated** in **Appendix G**, each behind an entry
trigger the run either fires or does not. Nothing was cut; the burden of proof
moved. That is the owner's direction of 2026-09-02 — *"this became so complex, we
went from v2 to v7"* — recorded in §15 with the two that came with it: **one work
branch per member**, and **less friction**, which §4.4's three visibility rules
discharge.

**What it changes elsewhere.** It **supersedes one control outright**
(`DELEGATION`'s per-offer human gate, §13.4 — and that supersession now rides
gated G3)
and **amends or re-aims four other written decisions, each named in §13**:
`[PLAN§6]`'s "no coordination-only commits" acceptance criterion (§13.1),
`[PLAN§5 M12(b)]`'s aim (§13.1), `[COBUILD-PLAN §2.1]`'s project order (§13.2),
and `[KNOWLEDGE §10.2]`'s conclusion about the absent peer (§13.5). It
strengthens one locked decision without changing it (`[PLAN Locked decisions 4]`,
repo = lasting truth, §13.1), and reuses `COBUILD`'s seam machinery unchanged for
the one place prose is load-bearing (§6, gated). It re-opens exactly one closed
COBUILD decision, on the owner's instruction, and §6.5 says which and bounds it.
It also
**requires content changes in `SECURITY.md`**, which the first draft left out of
the register: §13.6 names them and the stage that makes them.

**Two owner rulings of 2026-09-02 are folded in as settled, not as proposals**,
and both are additions to decision 3 (the floor) and decision 4 (the conflict
model), leaving the rest of the decisions brief unchanged:

- **D1 — lease-protected force-push on the Claude's own work branch is below
  the floor.** A re-root — and, under G1, a stack rebase — rewrites already-pushed
  commits, so the only way to
  keep the live view live is `push --force-with-lease`, restricted to
  `refs/heads/handshake/<self>`, never bare `--force` and never any other ref.
  §4.1 has
  the floor-table row, §4.1's three implementation rules ship with it, and
  Appendix G1 mechanism 4's "it is below the floor" sentence says *why* it is.
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

**The committed count is three.** `[KNOWLEDGE §8]`'s count was two and
`[COBUILD §3]`'s was two, so this is one concept larger than the two slices
before it rather than three times either — which is what the simplification of
2026-09-02 bought, and the number the owner should hold this plan to.

1. **The state branch** — a dedicated branch carrying the coordination layer,
   written by the tool, never merged into anything.
2. **The work branch** — **one per member**, stable, reused across every claim,
   pushed freely as a live view of an unfinished half.
3. **The declared symbol** — a `file::Class.method` scope the model states on its
   own claim (§7).

**Three more are designed and gated, and are not counted here because nothing
built asks a user to hold them** — the stack (§5.4, G1), the contradiction round
(§6, G2) and the capability grant (§9, G3). They are in Appendix G in full, each
behind an entry trigger, and **each would take the count to four, five and six as
it is entered**. Stating them as *would-be* concepts rather than deleting them is
the point: the count is a commitment, not a claim about what exists on paper.

**The count a user actually meets is three:** the branch names appearing in
`git branch -r` — and there are now exactly **members + 1** of them, forever
(§4.1) — · the opt-in screen, once · a refusal, which is one surface with
several causes (the commit secret scan blocking a push, §4.2 item 1; the
private-repo default refusing the automated push path outright, §4.2 item 2 and
ruling D2; a forge rule rejecting a push, §10.1) and is **now the one place in
the design that always says what to do next**, §4.4 rule 2. **Two of those three
are met once or only at a refusal**, which is
the cheapest place to meet a concept `[COBUILD-PLAN §6.1]`. The branch names are
the exception and they are met constantly, which is why §12.1 treats
autonomous-push noise as the first risk rather than the last.

**Two things this pass added that are deliberately not concepts, named so the
count is checkable rather than asserted.** **`[skip ci]`** (§4.2 item 4) is a
string in a commit message: it removes a precondition, a workflow edit and a
push suspension, and adds nothing a user reasons about — the user-visible
consequence, *a PR from a work branch shows no checks until you push*, is one
sentence in the opt-in text and one line in `handshake branches`. **The re-root**
(§10.2) is a property of the work branch, not a second thing beside it: the
branch that was already yours goes back to the default branch's head once your PR
merges, and if a user never notices it, it worked.

**And the three visibility rules of §4.4 are not a concept either** — they are
one field (`push:`), one discipline on refusals, and a set of derived lines. They
cost output, which §2.4 prices, and they cost the reader nothing.

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

**The committed slice adds three:**

| Verb | What it is | Who runs it |
|---|---|---|
| `handshake pair --state-branch` **[proposed name]** | the one opt-in gate the committed slice has (§4.2 item 3); `join`-shaped, refuses `--yes`, refuses from a proven child. **It is a flag on a new verb**, and the verb has exactly this one mode until G3 generalizes it | **human only** |
| `handshake branches` **[proposed name]** | read-only view of the state branch and every member's work branch — the `push:` line, the derived asymmetry lines, `N commits not in main, X days old` **for this member's own branch** (the peer's needs its objects, which is gated: §10.2), the state branch's size, and the delete command for each (§4.4, §10.2) | model and human |
| `handshake scan-allow <finding-id>` **[proposed name]** | adjudicate one scanner finding as not-a-secret, per workspace, recorded; typed confirmation, refuses `--yes`, refuses from a proven child (§4.2 item 1) | **human only** |

26 → 29 is **+12%**. Against the model-facing subset SKILL.md tabulates — ten
action rows `[C skills/handshake-coordination/SKILL.md:388-399]` — only
`branches` is model-facing, so that subset grows 10 → 11.

**One gated verb, not counted here:** `handshake contested`, the read-only view
of open contradiction rounds, arrives with G2 and only with it. `handshake pair`
grows its other two modes (show, revoke) with G3. **So the committed count is
three verbs and one flag**, and the two the first draft argued hardest for —
the capability screen and the contradiction view — are both behind triggers.

**The honest total, if everything currently planned lands.** Co-build adds six
and its own plan calls that *"the strongest single argument for cutting"*
`[COBUILD-PLAN §6.1]`; the knowledge layer's `learned` read verb is still owed
`[KNOWLEDGE §9.1 K3]`; delegation adds its own; and Appendix G would add one.
26 + 6 + 1 + 3 + 1 = **37 before delegation**, of which this plan commits
**29**. That first number, not this stage's three, is the one to put in front of
the owner — and the gap between the two is the whole argument for gating.

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

**ONE PROPOSED OPTIONAL body-field delta in the committed slice** — a v1.1
Appendix B delta on `[P§3.2]`, on an existing envelope-carried type, touching no
`[F]`-marked row. The first draft proposed three; the revision withdrew one (the
carriage finding below), and **the simplification of 2026-09-02 gated the third**:
V-D3 rides G2 and travels only if G2 is entered. So the wire budget the owner is
being asked to ratify **now** is a single OPTIONAL field:

| # | Delta | Where | Status |
|---|---|---|---|
| ~~**V-D1**~~ | ~~`presence.update.head`~~ — **WITHDRAWN at the revision.** `presence.update` is not an envelope on the relay: it is a fixed column set `(member_id, state, note, branch, machine, session, updated_at)` behind `POST /ws/:id/heartbeat` `[C docs/PROTOCOL.md:262-275]` `[C relay/src/do/workspace.js:96-98,428-435]`, and an envelope of that type is refused with `envelope_type_not_carried` `[C relay/src/lib/envelope.js:22-26]` `[C relay/src/do/workspace.js:595-597]`. The field could not travel on the tier §11 runs first. **The branch head is derived locally instead** (§5.4). | — | withdrawn |
| **V-D2** | `task.claim.symbols` / `task.change.symbols` — **≤ 8 entries × ≤ 100 chars** `[proposed, lowered at the revision]`, `path::Symbol.member` form, model-declared, never parsed (§7). **Carriage rule, stated because the relay decides it:** on ntfy `task.claim` is an envelope and carries the field; on the relay `task.claim` is the claim endpoint's fixed column set `(subject_key, subject, owner, acquired_at, renewed_at, ttl, files)` `[C relay/src/do/workspace.js:101-104,531-535]`, so there the authoritative carrier is **`task.change` with `change: "scope"`**, which *is* envelope-carried `[C docs/PROTOCOL.md:266]` and which the client already posts on the heartbeat path `[C monitors/heartbeat.js:217-227]`. | `[P§3.2]` task.claim, task.change | **[proposed] — COMMITTED, Stage 2(a)** |
| **V-D3** | `task.seam.contested` (boolean, `propose`) and `task.seam.rationale` (≤ 280 chars, `contract`) — the contradiction protocol's two additions to COBUILD's own schema `[COBUILD §7.1]`, which is itself unratified. `task.seam` is envelope-carried on both legs, so no carriage clause is needed. | `[COBUILD §11 E2]` | **[proposed] — GATED, Appendix G2**, and dependent on E1–E3 being ratified first |

**What gating V-D3 does to the ratification burden, since that is the point of
counting wire at all.** The first draft asked the owner to ratify two deltas on
top of two unratified amendments elsewhere; this one asks for **one field on one
existing type**, and defers the delta that touches a schema
(`[COBUILD §7.1]`) which is itself unratified. The arithmetic V-D3 carries below
— 1,415 → 1,710 of 2,048, 295 bytes, 45% of the remaining slack — stays in this
section rather than moving to the appendix, because it is the reason V-D3 is
worth a decision rather than a nod, and because a reader who never opens
Appendix G should still be able to see what was deferred.

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
saw. **So G2's CLI refusal MUST name which field pushed the body over**, and
offer to drop the `rationale` before it asks the human to cut their own contract
text **[proposed]**. This is what ratifying gated item 10 ratifies, if G2 is ever entered.

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
off it as a caveat rather than an amendment.** Stage 1 puts a git commit and a
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
shown, not measurements.** Nothing here is built, and §10's Stage 2 carries a
re-measurement gate the way `[COBUILD-PLAN §3.S0]` does. **The `Slice` column is
new at the simplification**: a gated surface costs nothing until its trigger
fires, and the committed total is the sum of the committed rows alone.

| Surface | Vehicle | Per-turn chars | ~Tokens | Frequency | Slice |
|---|---|---|---|---|---|
| declared symbols on a claim — **the discriminating tail only** (§7.1) | a `details[]` entry, fed from the **cached claim row** and not from the envelope (§7.1) | ≤ 22 (`, ` + ≤ 20), **trimmable** | ~6 | every turn a symbol-scoped claim renders | committed |
| **two** new notice kinds — push refused · own-claim expired — into a channel that **already has three producers** | the existing notices channel, 2 × 96, **now sorted by rank** | ≤ 2 × 98, dropped at the last rung | ~50 | only while the condition holds | committed |
| the notices `+N ! <highest hidden kind>` overflow marker | the same channel | ≤ 22 (`+1 ! own claim expired`), of which 4 is the marker itself | ~5 | only when more than two notices are live | committed |
| the overlap warning's **short form** (§10.2) | the PreToolUse gate line, which has no 600-char budget | **negative** — it replaces a ~4-line framed block with one line on every write after the first | **saves ~60/write** | every write into a peer-claimed file after the first | committed |
| **`skills/handshake-coordination/SKILL.md`** — the row the first draft's vehicle column could not see (M40 below) | the skill file, loaded whole when the skill engages | **0 per-turn**; **+18 to +28 lines per engaged session** for the committed slice, against a 410-line baseline | **+250 to +400 per engaged session** | every session in which the skill engages | committed |
| new `COND` literals | — | **0** | **0** | — | committed |
| `handshake branches` | on demand | its own output, ~600 | ~150 | only when the model runs it | committed |
| `handshake pair --state-branch` · `handshake scan-allow` | on demand, human | ~800 / ~200 | **0 model tokens** | once, and at a refusal | committed |
| state-branch commit + push · work-branch commit + push · the re-root · the commit secret scan · `[skip ci]` | monitor and Stop-hook processes | **0** | **0** | ≤ 1/min | committed |
| the stack marker | a second `details[]` entry | ≤ 22, **trimmable** | ~6 | only while stacked | **gated — G1** |
| the `sequenced:` card detail (§5.4) | a third `details[]` entry | ≤ 22, **trimmable** | ~6 | only while sequenced | **gated — G1** |
| **three more** notice kinds — escalated · rebase needed · round open | the same channel, at their ranks | inside the 2 × 98 above | 0 additional | only while the condition holds | **gated — G1/G2** |
| coordination-outcome records (§8) | the existing once-per-session knowledge block | **0 new chars**; they compete for its existing entry slots inside `LEARNED_BUDGET = 2000` `[C hooks/render.js:304]` | 0 | once per session | **gated — G4** |
| `handshake contested` | on demand | ~400 | ~100 | only when the model runs it | **gated — G2** |
| `handshake pair`'s show/revoke modes | on demand, human | ~800 | **0 model tokens** | once, at configuration | **gated — G3** |
| **Per turn, steady state — committed slice** | — | **0 untrimmable chars** | **0** | — | — |

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
edited it** — the first draft's V3, V5, V6, V7 and V8 all listed it in Touches. At
the file's own
density (§3 spends 110 lines on three cases), the topics that plan added —
symbol authoring, the stack-vs-sequence tree with its five-row fact table and its
instability counter, contradiction revision discipline, eight-row capability
semantics, outcome records, three CLI rows and the notice literals — would run to
200–260 new lines, i.e. **+2,800 to +3,600 tokens per engaged session**. That
delta alone is more than ten times the entire on-demand budget the table above
does price. It cannot be left out of the accounting because it does not ride a
`details[]` slot.

**So: a per-stage budget, and a hard ceiling that gates the stage** **[proposed]**:

| Stage / rung | New lines in `SKILL.md` proper | Running total, from 410 | Slice |
|---|---|---|---|
| Stage 1 — the branch model row, and line 275's row flipped | ≤ 6 | ≤ 416 | committed |
| Stage 2 — declared symbols, `branches`, `scan-allow` | ≤ 14 | ≤ 430 | committed |
| G1 — stack / sequence, **including the human-override sentence and the five-row fact table** | ≤ 18 | ≤ 448 | gated |
| G2 — contradictions | ≤ 14 | ≤ 462 | gated |
| G3 — the trusted pair | ≤ 10 | ≤ 472 | gated |
| G4 — outcome records | ≤ 8 | ≤ 480 | gated |
| **Ceiling** | — | **480 lines** | — |

**The committed slice lands at ≤ 430 of 480**, which is 50 lines of headroom that
did not exist before this pass — the same simplification read as a budget. G1's
allowance went **up** by two lines rather than down, because two of the friction
smoothings are `SKILL.md` sentences (the human override on a sequencing decision,
and *"run `handshake branches --fetch` when a stack decision is actually due"*)
and a budget that does not carry them is a budget the rung breaks.

**Nothing ships if `SKILL.md` crosses 480 lines.** It is a gate in
`[COBUILD-PLAN §3.S0]`'s sense — a number checked before the stage is called done
— not a note, and it is the same discipline §2.4 applies to the 600-char block.

**The mechanism that makes those numbers reachable already exists in this
skill**: `references/`, which today holds `standing-block.md`
`[C skills/handshake-coordination/references/standing-block.md:103-109]`.
**The stack-vs-sequence *prose*, the contradiction revision discipline and the
capability semantics go into `references/` files**; `SKILL.md` proper keeps only
the **trigger conditions** — when to look, and which file to open — which is what
progressive disclosure is for and is why the reference directory was created.
**One exception, and it is the reason G1's allowance grew:** the five-row
**stack-versus-sequence fact table stays in `SKILL.md` proper**. It is what the
model consults *at* the decision, and a decision that requires opening a
`references/` file mid-turn is a decision made without the table. The prose
around it goes to `references/`; the table does not.
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
  **So the order is a total order over all eight kinds, safety pinned on top,
  and the bare slice is replaced by a sort on that rank** **[proposed]**:
  **(1) rotation demand** `[C hooks/common.js:670]` · **(2) private-repo guard**
  `[C hooks/common.js:672]` · **(3) push refused** (the secret scan blocked a
  commit; nothing else in the block says the work is invisible and only a human
  can clear it) · **(4) escalated** *(gated, G2)* (the system asking, §6.4, and the
  one notice addressed to the human rather than to the model) · **(5) conflict**
  (the §5.4
  tiebreak verdict, which the model can execute from the block alone) ·
  **(6) own claim expired** (your branch stopped being pushed and only you can
  restart it, §10.2) ·
  **(7) rebase needed** *(gated, G1)* (the model can act on it this turn) ·
  **(8) round open** *(gated, G2)*
  (recoverable in full from `handshake contested`, so it is the first to lose its
  slot). Ranks 1 and 2 are existing producers whose relative order does not
  change; the new kinds slot in below them, and **the committed slice populates
  ranks 3, 5 and 6 only** — the sort ships whole because a rank order with holes
  in it is a rank order that gets re-derived wrongly when a hole is filled.
  **The marker names the highest hidden kind, not just the count** **[proposed]**:
  `+2 ! escalated` rather than `+2 !`, because the one notice addressed to a human
  can otherwise be pushed out of two slots by three machine-recoverable ones with
  nothing saying which was lost. **It ships committed, with the sort**, even
  though the kind in that example is G2's: the committed slice populates three
  ranks below the two existing producers, so two of five live notices are already
  hidden with no name — `+1 ! own claim expired` is the committed case, and the
  literal is the same one either way (§15 S15).
- **The channel gets a `+N` overflow marker, because two notices can vanish
  today with no trace.** `.slice(0, 2)` `[C hooks/render.js:187]` is the one
  truncation in the block that does not say it truncated. Both neighbouring
  slots got markers for exactly this reason — `+N peers`, `+N claims`, and
  `plans()`'s own comment that silently dropping them would be the *"reported a
  truncated read as an empty one"* failure `[C hooks/render.js:229-234]`
  `[P§10.2]`. The literal is `+N ! <highest hidden kind>` **[proposed]**: four
  characters of marker plus the kind name, **up to 22 for the longest committed
  kind** (`+1 ! own claim expired`), spent only when something is actually
  hidden. Twenty-two is past the 11 chars of headroom computed below, so the
  render that carries it spends the slack and then pays a digest item out of
  rung 1 exactly as the details entries do — which is what Stage 2's
  re-measurement gate (§10.2) prices and measures. It is also the **last** thing
  the ladder drops, going only with the whole channel at
  `push({ dropNotices: true })` `[C hooks/render.js:262]`. And the recovery story
  of the whole notices design — *"recoverable in full from `handshake
  contested`"* — depends on the model knowing there is something to recover; it
  exists because the rank order above creates the eviction.
- **Zero new `COND` literals** `[C hooks/render.js:66-71]`, zero change to
  `BUDGET`, zero change to the 206-char framing `[C hooks/render.js:38,50-54]`.
  **[proposed]** — this is §14 item 18, reversible in one literal if Stage 2's
  measurement says the model is failing to run the on-demand views.

**Why no untrimmable marker, argued against COBUILD's precedent rather than
around it.** `[COBUILD §7.3]` spends 7 untrimmable chars on `· seam` because
*"without it the model does not know to look in `.handshake/seam/` at all"*. That
argument does not transfer. A stack and a contested symbol are both attached to a
claim **the claims line already renders**, and the standing framing already ends
with *"Check claims before new work"* `[C hooks/render.js:53]`. Under trimming
the model loses the detail, never the fact that a peer holds overlapping work;
the recovery is `handshake branches` or `handshake contested`, both on demand. If
Stage 2's measurement shows the model failing to run them, the fix is one
`COND` literal and §14 records the choice as reversible.

**Headroom, if every proposed v1.1 feature lands.** 562 worst pinned + 7
(`· seam`, `[COBUILD §7.3]`) + 20 (`COND.offers_in`, `[DELEGATION §13.1]`) + **0
(this stage)** = **589 of 600** `[COBUILD-PLAN §4]`. This stage does not move that
number. Slack: 11 chars. **The `+N ! <kind>` marker spends all 11 and more** —
4 for the marker and up to 18 for the kind name, **22 in the committed worst
case** (`+1 ! own claim expired`) — and only in a render that already carries
two notices with a third hidden. It does not touch the
0-untrimmable-chars floor above: it lives inside the notices channel and is
dropped with it at `push({ dropNotices: true })`, the ladder's final entry
`[C hooks/render.js:262]`; what it actually costs in the render that carries it
is a digest item out of rung 1, the price the two paragraphs below state and the
number Stage 2's gate records. Naming the kind, against a silent truncation, is
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
the exact trimmed shape is depends on content, which is why Stage 2 carries a
re-measurement gate rather than a note**, measured the way M7/M11 measured the
block `[PLAN§5]`.

**What that costs, stated rather than reported as zero.** The summary row's
*"0 untrimmable chars"* and the 589 headroom line are both true and both narrow:
they say this stage adds nothing the ladder cannot take back, **not** that the
additions are free. In the full case they are paid for out of rung 1 — one digest
item the model no longer sees (dropping one line from the 562 example costs ~62
chars net once `+3 more` becomes `+4 more`, which lands ~588 with the details
present and no notices). That is the real price in a busy workspace, and it is
exactly what Stage 2's re-measurement gate is for: it measures how often
it bites, not whether the render fits. **And the gate records the number rather
than only checking the bound** **[proposed]**: how often a digest item is evicted
per day, so *"a digest item was dropped to pay for a symbol"* is a measurement in
the run's artifacts and not a paragraph in this one.

**The committed slice is cheaper here than the first draft, for one structural
reason worth stating.** The stack detail and the `sequenced:` detail are gated, so
in the committed case a claim carries **one** new `details[]` entry rather than
two or three: the worst case is 2 claims × 1 × 22 = **44** rather than 88, which
lands the full example at ~606 before notices instead of ~650 and buys back most
of the digest item the paragraph above spends.

### 2.5 The wall-clock budget for the new plumbing

§2.4's *"0 tokens"* row is true and it is the wrong unit for the git work. This
section is the right one, and it exists because the first draft promised it and
pointed at §12.5, which prices CI minutes and contains no hook or monitor timing
at all. **Everything below is a designed budget, in this document's own
register: reasoned, not measured, and the run is where that changes.**

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
| **0. fetch** — §10.1 rule 1's *fetch first, always* (**two refspecs on one round trip: the state ref and the default branch's tip**, added at the second-look round for G2-9), and the re-fetch each rebuild attempt of rule 4 takes | **1,500 ms**, the same bound as the SessionStart fetch of the same refs, and **each rebuild's re-fetch takes its own slice of what is left** rather than a fresh 1,500. The second refspec is a second ref on the same connection, not a second row | **Added in fix round 3: it was missing, and the paragraph below asserted a closed count that did not include it.** It is a network call on the commit path, it rides `beat()`, and on the no-monitor fallback it therefore runs inside the Stop hook's 9,000 ms window `[C hooks/stop.js:57-61,163]`. Rule 2 forbids proceeding on a fetch error, so a step with nothing left defers the whole batch rather than committing on a stale parent |
| 1. scan | **1,500 ms** for the whole commit, corpus hoisted once | It is the gate. A commit that is not scanned is not made (§4.2 item 1) |
| 2. commit | **500 ms** | Local plumbing only: `write-tree` / `commit-tree` / `update-ref` (§10.1), no network |
| 3. push | **whatever is left of the caller's deadline**, and its own ceiling of 5,000 ms | The only network step after the gate, and the only one it is safe to lose |
| `ls-remote` for a peer's head (§5.4) — **gated, G1** | **2,000 ms**, and it is not on the commit path at all | It runs on the poll, not on the commit — but the poll is the monitor's *or* the Stop hook's when there is no monitor `[C hooks/stop.js:113,163]`, so it is bounded for a hook's clock rather than the monitor's, and on that path it takes its slice of the same threaded deadline as the push |
| the **SessionStart state-ref fetch** (§10.1's read half) | **1,500 ms**, and the **whole shard scan** is bounded at **500 ms** on that path. The option is `authorBudgetMs` in *shape* `[C lib/shard-scan.js:127,160]`, but it must be **widened to wrap every git call the scan makes on the ref path** — the per-shard `git show` reads as well as the author `git log`s **[proposed]**. Today it wraps only the author calls, by wrapping the runner `authorVerdicts` hands to `checkShardAuthors` `[C lib/shard-scan.js:128-142]`; the shard bodies are read in a separate loop the option never touches `[C lib/shard-scan.js:189-192]`, and on the ref path those reads are the scan's dominant cost, not a rounding error | It is not on the commit path either, but it *is* the one new network step on a hook a turn waits on, so it is budgeted here rather than left to a constant. `C.armSafety(9500)` `[C hooks/session-start.js:24]` is a hard `process.exit(0)` `[C hooks/common.js:63-74]`, and the sync below it already takes 7,000 ms `[C hooks/session-start.js:83]`: 1,500 + 500 + 7,000 leaves the same 500 ms margin `hooks/stop.js` computes for the same reason `[C hooks/stop.js:57-61]`. A fetch that exceeds the bound is **abandoned, not waited on** (§10.1) |
| the **peer-branch refspec fetch and the throwaway worktree** (§4.2 item 5, Appendix G1 mechanism 3) — **gated, G1** | fetch **5,000 ms**; `git worktree add` **5,000 ms**; both **off-hook only**, on the monitor's clock, and **skipped entirely when there is no monitor** | **Added in fix round 3.** `git worktree add` is a *checkout* of the peer's tree, not a ref operation, and it had no row anywhere — §12 priced no disk for the duplicated tree either, which the sentence after this table now does. It is off-hook by construction: G1's Touches put the poll on `monitors/heartbeat.js` and the worktree lifecycle on `lib/repo.js` (Appendix G1), and neither the worktree nor the `merge-tree` probe is hook work. Only the peer-head `ls-remote` rides the beat, which is what keeps `GIT_NETWORK_TIMEOUT_MS` off every hook path |

**The disk the worktree costs, priced rather than omitted.** A throwaway
worktree is a full second copy of the peer's tree under the plugin's 0700 state
directory `[C lib/state.js:75-82]`, so the peak cost is **one working-tree's
worth of disk per concurrent evaluation** — one, since nested stacks are not
permitted (Appendix G1) and there is one work branch per member (§10.2). It is
released by the sweep of Appendix G1 mechanism 3, and that appendix's guardrail block
(§4.2 item 5) states the two rules that keep it small and reachable on Windows.

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
takes this constant, async or not — and **the count is four in the committed
slice and five if G1 ships.** **The four committed network git calls that can
run inside a hook**: the state-ref fetch on
SessionStart, the **commit-path fetch** of §10.1 rule 1, the state-branch
push, and the **`ls-remote --exit-code` absent-ref probe** that D1 rule 1 runs
before every lease push (§4.1) — the last three riding `beat()` when the
Stop hook is the no-monitor fallback `[C hooks/stop.js:163]`. The first three
take their own rows above — 1,500 ms, 1,500 ms and 5,000 ms respectively — and
the probe takes its slice of the push's own ceiling; every one of
them is sized against a hook watchdog rather than against a constant built for the
monitor's clock. **The fifth, the peer-head `ls-remote` at 2,000 ms, arrives
with G1 and only with it.** *(Fix round 2 corrected this count from one to three
and fix round 3 from three to four; the simplification took it back to three by
gating the call, and the hand pass after the second look makes it four, for the
absent-ref probe. A closed count is worth
having and worth re-checking whenever a rung adds a git call — which is why the
rows now carry the property rather than the tally.)*

**And the re-root's three probes take no new row, which is worth saying because a
new mechanism with no budget is how this section got written in the first
place.** `git merge-base --is-ancestor`, `git diff --quiet` and the
`rev-list --count` gate are all **local** and bounded by the existing
`GIT_TIMEOUT_MS` `[C lib/repo.js:27]`; the merged-PR read shares the visibility
verdict's own `gh` call and its 600 s TTL `[C lib/repo.js:25]`, so it costs one
probe per ten minutes and rides a path that already exists. **A re-root's case-2
replay is local git too** — `merge-tree --write-tree` and `commit-tree` per
commit, no network and no checkout (§10.2) — in the tool's own branch, off the
commit path, and deferred like any other step with nothing left. The lease push's
`ls-remote` present/absent arm (D1 rule 1) is the one network addition, and it
rides the push's own row rather than taking one: it runs only when a lease push
is about to run, inside the same 5,000 ms ceiling.

**And what does *not* reach a hook, said in one clause because fix round 2's
`ls-remote` row is what put the question there.** *(All of this paragraph is
gated with G1; in the committed slice nothing below exists.)* On the no-monitor
Stop-hook
path **only** the peer-head `ls-remote` rides the beat, at its 2,000 ms row. The
refspec fetch of the peer's branch, the throwaway worktree and the `merge-tree`
probe (Appendix G1 mechanisms 2 and 3) run **on the monitor's own clock and are skipped
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
validates a **payload** — and under G1, this design has payloads: a peer's work
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
smuggled** **[proposed — gated item 42; decision 2 is the owner's and a relaxation
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
| Coordination state committed and pushed to a dedicated `handshake/state` branch: author = the member, committer = the tool; per-member append-only files; batched ≤ 1/min; **fetch-first, adopt-never-create, rebuild-never-retry** (§10.1); deferred and retried while offline; **every commit carries `[skip ci]`** (§4.2 item 4); **no remote ⇒ today's behaviour** (below) | Merging into any shared branch, or into `main` |
| Code commits and pushes on the Claude's **one own branch**, `handshake/<member>` — **one per member, stable, reused across every claim** (§10.2) — **pushed freely, as a live view**: broken is allowed, leaked is not, and **every commit carries `[skip ci]`**. **The commit takes only the paths on the live claim's own `files[]`, and never moves `HEAD`** (§10.2) | Opening, updating or merging a pull request |
| **Re-rooting `handshake/<member>` onto `refs/remotes/origin/<default>` once the human's PR from it has merged** (§10.2) — the tool's own ref, rewritten under the same lease as the row below, so the next claim's live view starts clean instead of replaying work that already landed. **Checkout-free in both cases**: `update-ref` when the branch head is the merged head, and a `merge-tree`/`commit-tree` replay when it is ahead — never `git rebase`, which is a checkout of the human's shared tree (§10.2) | Tags, releases, publishes |
| **`push --force-with-lease` on `refs/heads/handshake/<self>` only** — ruling D1, 2026-09-02: a re-root (and, where G1 ships, a stack rebase) rewrites commits this tool already published, so without this the live view freezes. Never bare `--force`, never any other ref, and the lease value is the tool's own recorded head (three rules below) | Deploys of any kind |
| Reading, fetching and building against a peer's work branch — **gated on the run, G1** (§5.4, Appendix G1) — **in a throwaway worktree, never the live tree** (§4.2 item 5). **Counting one is inside this row too**: `git rev-list --count` and a commit date need the peer's *objects*, which only a fetch brings, so in the committed slice `handshake branches` reports its own branch's numbers and says plainly what it cannot compute for the peer's (§10.2, §4.4 rule 3) | Anything touching secrets: rotation, re-keying, credential files |
| Opening, revising, adopting and ending a contradiction round within the granted capabilities — **gated on the run, G2** (§6, §9, Appendix G2) | Rewriting, re-rooting or squashing any ref the tool does not own — `handshake/state` included, because it is a shared two-writer ref (§12.1) |
| Recording durable learnings (§8). Coordination-outcome records are **gated on the run, G4** | Destructive or irreversible operations: history rewrite on any ref the tool does not own, deletion of **any** branch including its own, `scrub`, and **bare `--force` (or `-f`) on any ref whatsoever** — the one exception is the lease-protected push above, which is never bare `--force` and never leaves `refs/heads/handshake/<self>` |

**One value in row 2 is not decision 3's, and the table says so here rather than
leaving a reader to find it.** Decision 3 states the Claude's own branch as
`handshake/<member>/<subject>`, **one ref per claim**; the owner's direction of
2026-09-02 — *"I hope there's not too much branching; we realise that at the end
of the day there are 10 different branches just sitting there"* — **supersedes
that shape** with one stable branch per member, and row 2 above states the
replacement (§15 S7). Decision 3's other terms are untouched and are what the
rest of this section restates: author = the member, committer = the tool; pushed
freely as a live view, broken allowed and leaked never; the fail-closed secret
scan on every code commit; merges, PRs, tags, deploys and secrets above the
floor. This is the only value in §4.1 that the simplification changed.

**Exactly members + 1 refs, ever, and that is the whole branch model.** *Two
people means two work branches plus one orphan `handshake/state`: three refs,
forever.* A claim is **state** — a subject, a file list, a symbol set — and never
a ref, so concurrent claims of one member share the one branch the member
already has, and a finished claim leaves no branch behind to prune. This
sentence is repeated verbatim in the opt-in text (§4.2 item 3) and in
`handshake branches`, because the thing a reader fears here is a directory of
abandoned refs and the answer is arithmetic rather than reassurance. **The tool
still never deletes a branch** (the cell above), so unmerged abandoned work
stays on the member's own branch and `handshake branches` says how much of it
there is (§10.2, §12.1).

**Three on the remote, and the count a reader will actually run is `git branch
-r`** (added at the second-look round, G2-14). The tool writes with
`update-ref` into the human's shared `.git` (§10.1), so a member's own clone
also carries the **local** copies of the two refs that member owns —
`handshake/state` and `handshake/<self>` — which show up in `git branch`, in
checkout autocomplete and in an IDE's branch picker. Measured: after one state
commit and one work-branch commit, `git branch -r` is exactly
`origin/handshake/alex`, `origin/handshake/state`, `origin/main` (plus
`origin/HEAD`) — the promised shape — while `git branch` is `handshake/alex`,
`handshake/state`, `* main`. **The bound holds locally too** — two handshake
refs in your own clone, forever, and never the peer's — but a human counting
refs after being promised three should not have to discover two more, so the
clause is said in the opt-in text, in the cloner README and in what `scrub`
lists (§4.2 item 3, §4.3, §14 item 47).

**Ruling D1, and why it does not open the floor it appears to open.** The floor's
purpose is that the tool never destroys history a human built on or a branch
people share. The `handshake/<self>` work branch is neither: it is advertised
unstable (this table's second row), only the tool writes it, and the lease
guarantees that if a human ever *did* push to it, the tool **refuses rather than
clobbers**. Merge-instead-of-rebase was considered and rejected: it rewrites
nothing, but it weakens the clean-rebase stability signal G1 uses as the
substitute for a branch CI verdict, and it leaves merge commits in the eventual
PR. **The pattern narrowed with the branch model** **[proposed]**: D1 was written
for `handshake/<self>/*`, one ref per claim; with one stable branch per member
the permitted pattern is the single ref `refs/heads/handshake/<self>`, which is
strictly narrower than what the owner ruled and needs no widening to serve either
of its two users — the re-root of §10.2 and, where G1 ships, the stack rebase.
**Three implementation rules ship with the carve-out:**

1. **The lease value is the tool's own recorded head, never the remote-tracking
   ref.** The tool records the exact sha it last pushed for that ref and passes
   `--force-with-lease=<ref>:<expected-sha>`. `--force-with-lease` with no value
   compares against the remote-tracking ref, which a background fetch — including
   the one Stage 1 adds on the SessionStart path (§10.1) — can silently update, at
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
   which G1's own `ls-remote` helper puts one line
   away: a lease whose expected value is *whatever the remote currently has* can
   never fail, and reintroduces exactly the hole this rule exists to close. The
   client falls back to a plain push, which is refused as non-fast-forward, and
   the live view freezes with a notice saying so rather than clobbering. This
   carries no `[proposed]` marker and no §14 row: it is the fail-closed reading
   of the owner's own rule 1 in the posture §4.2 takes everywhere, and marking a
   fail-closed default as proposed would imply the owner could ratify a
   fail-open.
   **And one arm the rule needs in the other direction, added at the second-look
   round (G2-9's sibling, G2-1): a ref that is not there cannot be clobbered, so
   the push that re-creates it carries no lease at all.** Both GitHub
   (*"Automatically delete head branches"*) and GitLab (*"Delete source branch
   when merge request is accepted"*) delete the merged head branch by default,
   and that fires on exactly the event §10.2's re-root reacts to. Measured on
   git 2.53: after `git push origin --delete handshake/alex`, a
   `--force-with-lease=refs/heads/handshake/alex:<the recorded sha>` push is
   rejected with *"stale info"*, exit 1 — and the recorded sha never changes, so
   the rejection repeats on every later beat. **So before a lease push the tool
   asks the primitive §10.1 rule 2 already names:
   `git ls-remote --exit-code --heads origin refs/heads/handshake/<self>` —
   exit 0 = present ⇒ lease as above; exit 2 = proved absent ⇒ this is a
   *create*, pushed with no lease and no force at all (measured: `* [new
   branch]`, exit 0), because there is nothing on the remote to protect; anything
   else = unknown ⇒ do not push, exactly as rule 2 does not create a root.**
   The recorded head is updated in the same critical section as the push that
   moved it, so a create is followed by a lease that works rather than by ten
   more minutes of *"stale info"*. Re-creation only happens while a claim is
   live — with no live claim nothing is pushed at all — so the tool cannot
   resurrect a branch a human deleted and walked away from.
2. **A rewritten base is stack invalidation, not a retry.** *(Gated with G1 —
   nothing stacks in the committed slice, so this rule ships when Appendix G1
   does.)* A peer whose stacked base is rewritten re-fetches and re-evaluates; if
   the new base no longer contains the old one, it drops the stack and falls back
   to sequence with a notice (Appendix G1). This is the same rule that covers a **human**
   rewriting or deleting a base — and, after the branch model, a **re-root**,
   which is a rewrite of exactly this shape (§10.2).
3. **A test that the pattern is the control.** Force-push on any ref other than
   `refs/heads/handshake/<self>` is refused **with no git process spawned**, and
   bare `--force` is never emitted on any path (§10.2).

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
none of them looked at what a fetched peer branch brings in. **It is also the one
of the five that is gated** — it is required *of G1*, which the run may or may
not earn — so item 5 keeps the floor rule and Appendix G1 carries the mechanism.

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
   fetch, stacking and all of G1 with it.

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

   **The Stage 2 test that makes this checkable rather than argued: scan this
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

   **A second Stage 2 test, because the first one cannot see the tripwire.** The
   zero-findings run above proves the *pattern battery* is quiet on ordinary
   source and proves nothing at all about the tripwire, which is inert in this
   tree. So Stage 2 also scans a **fixture** carrying an ordinary `application.yml`
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

   **And the human gets a route out, shipped WITH the scanner rather than after
   a trigger fires** **[proposed — §14 item 45]**. A fail-closed gate whose
   refusal a human can only disagree with is a stop, and the first draft made the
   adjudication verb a contingency behind §12.2's measured rate — which is the
   wrong order, because the rate is measured on a population of humans who had
   nothing to type. So `handshake scan-allow <finding-id>` ships in the same
   stage as the scanner: **human-only** (it refuses `--yes` and refuses from a
   proven child, the shape `join` already sets `[C bin/handshake.js:627,387]`),
   **typed confirmation**, **per workspace**, **recorded**, and it allows *one
   adjudicated value*, never a pattern and never the gate. **The refusal prints
   the exact command**, names the finding id and the file, and — because the
   commonest false positive is a tripwire needle rather than a pattern hit —
   **names which local secret file the matched value was harvested from**
   (*"matched a value from `.env`"*), which `readSecretValues` already knows per
   needle `[C lib/filter.js:157-197,226-249]`. This is not the `--ack` override
   §12.2 rules out by name: `--ack` would be a **model-reachable bypass on the
   gate**, and this is a human-adjudicated allowlist of *values*, which is the
   remedy §12.2 already names — brought forward, not invented.

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
   `[C lib/repo.js:278,302]` — become part of the Stage 1 opt-in preflight rather than
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

   **The refusal branches on the reason, because three of them are not the same
   problem and one of them no install ever clears** **[proposed — §14 item 46]**.
   The verdict already carries a reason string and its explanation
   `[C lib/repo.js:36-48]`, and a fail-closed guard with one message spends that
   for nothing. Three arms:
   - `gh_missing` / `gh_unauthenticated` — *"install the GitHub CLI and run
     `gh auth login`; this repository's visibility cannot be read until then"*.
     Installable, and the human's next step is one command.
   - `no_github_remote` / `no_remote` — *"visibility cannot be proved for a
     non-github.com remote; confirm yourself that `<origin>` is private"*, and
     the confirmation is **recorded as `unprovable`, not as an override of a
     public verdict**. This matters because it is the permanent case for every
     GitLab, Gitea, Bitbucket or self-hosted pair: no install clears it, and
     asking such a human to type *"yes, publish my in-progress code to the
     world"* about a repository that is in fact private is asking them to
     certify something false.
   - `affirmative_public` — and **only** here does the screen print the
     world-readable sentence, because only here is it true.

   The `status` line and the recorded override carry which arm was taken, so
   `unprovable` and `public, overridden` are never the same word.
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

   **What the gate must say about the commits themselves, in the plainest words
   available** **[proposed — §14 item 47]**. The first draft printed a permission
   screen and left the *experience* to be discovered on day two, when
   `git log --all --author=<you>` shows hundreds of commits nobody typed. So the
   gate prints, and `docs/INSTALL.md` repeats:

   > These commits are **authored as you**, about **one a minute**, on a branch
   > that **never merges into anything you work on**, and they **will appear in
   > your GitHub activity**. Two people means two work branches plus one
   > `handshake/state`: **three refs, forever** — three on the remote, and on
   > your own machine you also carry the local copies the tool writes,
   > `handshake/state` and `handshake/<you>`. The tool's commits never run CI;
   > yours do.

   Three shipped-doc consequences, each a task in the stage that ships the thing
   it describes rather than a later documentation rung. **(a)** The opt-in verb
   is `handshake pair --state-branch`, and it goes into `docs/INSTALL.md` and
   into `USAGE` — the 26-verb help text `[C bin/handshake.js:2514-2546]`, which
   is what `/handshake help` prints — **in Stage 1**, because a gate nobody can
   find is a gate nobody passes. **(b)** The cloner-facing README body, which
   already does exactly this job for `.handshake/`
   `[C lib/workspace-files.js:673-730]`, gains the two branch-name shapes
   (`handshake/state`, `handshake/<member>`), the sentence *"generated,
   unreviewed, never merged into your branches"*, the sentence *"deleting them
   is safe"* and — added at the second-look round — the clause that says where
   they are: *"three on the remote; a member's own clone also carries the local
   copies the tool writes, `handshake/state` and `handshake/<them>`"* — the
   third teammate who installed nothing is the reader that section exists for. **(c)** `docs/INSTALL.md` and the README gain the one line
   a human can act on wrongly: **never pull `handshake/<you>` into a checkout you
   care about** — it is rewritten under a lease (D1, §10.2), and a clone that
   followed it gets a mess the tool cannot see.
4. **Every commit the tool makes carries `[skip ci]`, and there is no CI
   precondition at all.** This is the simplification of 2026-09-02, and it
   replaces a guardrail that cost a pair a pull request in a repository neither
   of them may merge into. The problem it solves is unchanged: this repository's
   workflow triggers on every push with no branch filter
   `[C .github/workflows/ci.yml:13-15]`, so a Claude pushing a live view every
   minute would start **four job runs** every minute — `test` fans out across
   `windows-latest` and `ubuntu-latest` `[C .github/workflows/ci.yml:18-24]`
   beside `installer-lint` and `installer-lint-windows`
   `[C .github/workflows/ci.yml:57,73]` — and Windows minutes bill at 2×.

   **The marker is a forge feature, verified against the vendor's own
   documentation on 2026-09-02 rather than remembered.** On GitHub, a workflow
   triggered by `on: push` or `on: pull_request` **is not triggered** when the
   commit message of a push, or the HEAD commit of a pull request, contains
   `[skip ci]` — the accepted literals being `[skip ci]`, `[ci skip]`,
   `[no ci]`, `[skip actions]`, `[actions skip]`, and a `skip-checks: true`
   trailer. The one documented exception is `on: pull_request_target`. GitLab
   honours `[ci skip]` / `[skip ci]` in the same position unless a pipeline
   execution policy forbids skipping. **The literal this tool writes is
   `[skip ci]`** **[proposed]**, because it is the one both forges accept.

   **What that buys, stated as the difference it makes to a human.** No workflow
   file is read, no workflow file is edited, no snippet is pasted, no pull
   request is opened in the pair's repository, and no third reviewer is
   required. The pair's own CI configuration is not this tool's business, which
   is the correct answer for a tool that cannot write workflows without going
   above the floor (§4.1). Opting in becomes one command again.

   **What it costs, and it is a real cost.** A pull request opened from a work
   branch **shows no checks** until a human pushes a commit of their own — the
   PR's HEAD commit is a tool commit carrying the marker, and GitHub evaluates
   the marker on the HEAD commit, not on the branch. So: `handshake branches`
   says so on a branch with an open PR (*"PR #123 open · no checks: the head is a
   tool commit; push one of your own, or an empty commit"*), the opt-in text says
   *"the tool's commits never run CI; yours do"*, and **required checks on a
   protected base branch stay entirely in the human's hands** — which is where
   they belong, because merging is above the floor.

   **The preflight WARNS rather than blocks, on two conditions it can read**
   **[proposed]**. If any workflow in the repository uses
   `on: pull_request_target`, or if the forge is GitLab and the tool cannot read
   whether a pipeline execution policy overrides the marker, the opt-in prints
   one warning naming the cost — *"a run per tool push, roughly one a minute"* —
   and the remedy, and then **continues**. It does not refuse: a warning is
   proportionate to a condition the tool can neither verify nor fix, and the
   whole point of this change is that a CI question stops being a gate.

   **What the marker closes that a `branches-ignore` filter could not, and it is
   why this is a simplification and not only a convenience.** A `push` filter
   closes one door; `pull_request` fires on `synchronize`, `synchronize` fires on
   every push to the PR **head** branch, and `branches` / `branches-ignore` on
   `pull_request` filter the **base**, so there is no head-branch filter and a PR
   opened on a live claim would have restarted four job runs a minute for as long
   as it stayed open — behind a precondition reporting the cap as enforced. The
   old answer to that was to suspend the tool's pushes while a PR was open, which
   froze the live view at the moment two people were most likely to be watching
   it. `[skip ci]` closes both doors at once, because the marker is evaluated on
   the pushed commit and on the PR's HEAD commit alike — **so there is no
   PR-open push suspension in this plan, and the live view keeps moving under an
   open PR.**

   **The residual is stated in §12.7 rather than claimed away:** a workflow using
   `pull_request_target`, and a forge that ignores the marker, are both outside
   what this control reaches. Neither is silent — the preflight warns on the
   first and on the unreadable GitLab case — and §12.5 carries the arithmetic. A
   third, small and stated: the push after a re-root (§10.2 case 1) carries the
   default branch's tip — a human commit with no marker — so it starts one run on
   `handshake/<self>` per merged claim, at merge cadence and never at push cadence.

   **This guardrail costs decision 4 one of its three named stacking facts** —
   there is no branch CI verdict to read — and Appendix G1 says what replaces it
   and what that replacement does not buy; §12.5 prices the residual.
5. **Fetched peer content is untrusted data that can also execute.**
   **Gated: the mechanism ships with Appendix G1, and only if G1's entry trigger
   fires** — nothing in the committed slice fetches a peer branch, so this
   guardrail has nothing to guard until stacking exists. What stays here is the
   floor rule itself, because the floor rule is what makes this a *required*
   guardrail rather than a part of a rung's design. Under G1 a Claude fetches a
   peer's work branch and rebases onto it (§5.4) under a capability granted by
   default (§9) — **and a rebase is a checkout**. After it, the peer's version of
   every touched file is in my tree: `CLAUDE.md`, `.claude/settings.json`, hooks,
   `package.json` scripts, lockfiles, CI workflows. That is prompt injection plus
   plausible code execution in one automatic step with no human turn, and §3's
   four validations all reach the trigger and none reaches the payload (§3).
   **So G1 ships with four gates or G1 does not ship:** a namespaced fetch ref
   that is never a local branch and never the live tree; evaluation in a
   throwaway worktree under the plugin's own state directory; an automatic rebase
   admitted **only** by a locally derived path allowlist, with a `git diff --raw`
   mode rule beside it and an instruction/build floor underneath both (gated
   item 36);
   and **no build, install or test command in a tree carrying unmerged peer
   commits without a human turn**. **Appendix G1 states all four in full** —
   their mechanics, the three worktree corrections of fix round 3 and the
   allowlist posture — because a gated rung's design lives with the rung after
   this pass, and this rule is a precondition of that rung rather than a part of
   it. It is asserted in G1's own security run, it enters Stage 3's red-team
   scope **only when G1 ships** (§10.3), and §13.6 names what `SECURITY.md` must
   say about it and when.

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
  `[C hooks/session-start.js:80]` `[C lib/shard-scan.js:264]`. §11.2 is the
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

**And the sentence the tool says to the user has to change with it, in the stage
that makes it false.** `scrub` prints *"claude-handshake never commits for you
and never makes a coordination-only commit"* `[C bin/handshake.js:2402-2404]`,
which Stage 1 falsifies. It is rewritten to **"claude-handshake never commits to
a branch you work on"** — the bounded invariant above, in the user's own register
— and `scrub` additionally **lists the refs it is leaving behind**
(`handshake/state`, `handshake/<each member>`), each with its one-line delete
command, plus `git worktree prune` for anything a killed session left registered.
**Both copies of each, added at the second-look round (G2-14):** the tool writes
local refs with `update-ref` as well as pushing them, so a listing that names
only `git push origin --delete handshake/state` leaves the reader still carrying
`handshake/state` and `handshake/<self>` in their own `git branch`. Each ref gets
both lines — the remote delete and `git branch -D <ref>` — because a detach that
leaves refs behind under either name is the same lie.
Deleting a branch is above the floor (§4.1); *saying* which branches exist and
how to delete them is not, and a detach that silently leaves refs on a shared
remote is the same lie `[P§10.2]` forbids everywhere else. This is a Stage 1
task, listed there rather than deferred to the release rung.

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

**The read half is a Stage 1 deliverable, and the first draft only built the write
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

### 4.4 The three visibility rules

Standing guardrails on everything below the floor, added on the owner's
direction of 2026-09-02 (*"I want less friction"*). They are not documentation
tasks and not a style note: **each stage's Tests assert all three**, and a stage
whose new surfaces do not satisfy them is not done. The failure they close is
the one a walk through this plan kept finding — the tool does a great deal the
human cannot see, and when it does *less* than promised it usually does not say
why, so the reasonable conclusion is that it is broken.

1. **Every automated action that changes what the human will see leaves one
   line.** A commit, a push, a re-root, a refusal, a resume, a rebuild — each is
   reachable in `handshake status` (and in `handshake branches` once that
   exists), and lands in the card's notices where it matters *this turn*. The
   sharp end of this rule is one field: **`handshake status` and
   `handshake branches` carry an always-populated `push:` line naming the actual
   cause when a branch is not moving.** One field, one place, always filled in,
   from a closed set — `pushing`, `refused — secret scan, <file>`,
   `off — gh unauthenticated`, `off — visibility unproven`,
   `rejected — forge ruleset: <the forge's own line>`,
   `deferred (no time in the beat)`, `offline`, `no recorded lease`,
   `paused — remote head is not the one this tool pushed`, `off — no remote`.
   Without it, *"my branch stopped moving"* has **nine** causes, each announcing
   itself somewhere different and two notice slots between them.

   **The vocabulary is closed but it is not flat: it is owned per stage, and the
   test clause binds against the owning stage's subset** (added at the
   second-look round, U2-3). **Stage 1 owns seven** — `pushing`,
   `off — gh unauthenticated`, `off — visibility unproven`,
   `rejected — forge ruleset: <line>`, `deferred (no time in the beat)`,
   `offline`, `off — no remote`. **Stage 2 adds three**, each needing something
   Stage 1 does not build: `refused — secret scan, <file>` (the scanner ships in
   Stage 2), `no recorded lease` (D1's force-push helper is Stage 2's, and Stage 1
   force-pushes nothing) and `paused — remote head is not the one this tool
   pushed` (there is no work branch until Stage 2). Read flat, *"a state
   reachable by no test is a state that may not ship"* would have forbidden
   Stage 1 from shipping two words it cannot reach, which is why the clause reads
   **per stage** here and in every stage's Tests.

   **The tenth value is new at the second-look round, and the pass that removed
   the CI precondition is what created the state it names.** With `[skip ci]` on
   every tool commit, §4.2 item 4's own advice to a human whose PR shows no
   checks is *push one of your own, or an empty commit* — onto
   `handshake/<member>`. After that the remote head is not the head this tool
   recorded, so **both** of the tool's moves fail: measured on git 2.53, a plain
   push is rejected *non-fast-forward* and `--force-with-lease=<ref>:<the tool's
   recorded sha>` is rejected with *"stale info"*. That is the lease doing its
   job — refusing rather than clobbering (§4.1) — and it is neither
   `no recorded lease` (the record exists and parses) nor
   `rejected — forge ruleset` (there is no ruleset, and that arm prints the
   forge's own line). So it gets its own word, and rule 2 gives it its own next
   move: *"the branch is paused because a commit that is not this tool's is on
   it; open the PR from it as it stands, or reset it to the tool's head with
   `git push --force-with-lease origin <sha>:handshake/<you>`, and the tool
   resumes on the next beat"*. The re-root does not run on a paused branch
   either (§10.2). **It costs the card nothing**: it is a `status` /
   `branches` field value, not a notice kind — item 22's eight-kind rank order is
   unchanged and no untrimmable per-turn character is added (§2.4).
2. **Every refusal names its cause and the next move** — the command to run, the
   file to look at, the setting to change — never a bare verdict. The secret
   scan prints `handshake scan-allow <finding-id>` and the file the needle came
   from (§4.2 item 1); the visibility refusal prints the arm it took and what
   clears it, or says plainly that nothing does (§4.2 item 2); the gpgsign and
   forge-ruleset refusals print the forge's own rejection line and name the
   remedy (§10.1). A refusal the human cannot act on is a stop wearing a gate's
   clothes.
3. **Every capability that is off — on this machine or on the peer's — says so,
   with its cause, derived locally.** Derived is the load-bearing word: §4.2
   item 3's no-announce rule is a security property and is **not** weakened, so
   these lines are computed from what this side can already see, exactly the way
   `[C hooks/common.js:566-568]` derives staleness from data it already holds. A
   peer who has opted in has a `handshake/state` branch on the shared remote and
   a peer who has not, does not; a peer whose claims carry no `symbols` is on the
   older plugin; no monitor means no peer-branch work; git below the floor means
   stacking is off. So: `bob: no state branch on the remote — not enabled yet` ·
   `peer alex: no symbols (older plugin)` · `stacking: off — no monitor` ·
   `stacking: off — git 2.34 (needs 2.38)` ·
   `headless: state pushes ride the Stop hook, peer-branch evaluation is off`.
   **Three more from the second-look round, all in `handshake branches`:**
   `alex: work branch present at 4f2a1c8 — commit count and age need the peer's
   objects (fetch gated, G1)` (G2-8) ·
   `re-root: partial — no GitHub remote; a squash merge is detected only while
   the default branch has not moved past it` (G2-4) ·
   `re-root: case 2 off — git 2.34 (needs 2.38)` (G2-2).
   The alternative to a derived line is not privacy, it is a human concluding the
   feature does not work.

**Marked [proposed] as a set**, §14 item 48: the owner's direction is that the
tool stop being silent; the three rules, the closed `push:` vocabulary and the
derived-asymmetry lines are this plan's way of discharging it.

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

**And the line carries its own hedge, because a declared symbol is a
recollection and reads like a verified fact** **[proposed]**. `symbols` is
model-authored and nothing checks it (§7.1); rendered bare beside a real claimed
path it looks like something this side measured. So the gate line attributes it —
**`alex says: Handler.shape`** — in the same register the block already uses for
peer-authored text `[C hooks/pre-tool-use.js:24-27]`. Three words, on the surface
with no character budget, and they are the difference between a fact and a
report of a fact. §5.4's table already puts declared symbols in the row marked
*the peer's own words*; this is that row's rendering.

### 5.4 Case (c) — different tasks, same symbol → stack, or sequence

> **Gated: see Appendix G1.** Nothing in the committed slice stacks or sequences.
> The design below is kept in full and unchanged — the case (c) argument, the
> five facts it is made from, and the discriminator — but it is built only if the
> run shows same-symbol collisions blocking real work (§10.4's entry trigger).
> **The four mechanisms that used to sit here moved to Appendix G1 at fix
> round 2** (§15 S20), so §4.1, §4.2 item 5 and §9 now point there for them.
> **What the committed slice does in case (c) instead:** the gate warns on the
> path match, the declared symbols say the two tasks meet at one method, and the
> two humans see each other's live branches — which is the same information,
> arriving at a person instead of at a protocol.

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
| a clean **merge-tree** probe | `git merge-tree --write-tree` run locally against the fetched head — non-mutating, no worktree, no `HEAD` movement (Appendix G1 mechanism 2) |
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
transport operation is added by G1 in either direction, which is what keeps the
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
item 4 puts **`[skip ci]`** in every commit the tool writes, precisely so a
commit-per-minute live view does not start four job runs
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
recorded as **gated item 23** rather than built here, because it re-opens the
CI-cost risk the run has not yet measured.

#### How the fetch and the probe actually run — moved to Appendix G1

**Four mechanisms, and they are now stated once, in the appendix.** The peer's
branch string validated at the receive boundary before it is ever a git
argument; the `merge-tree --write-tree` probe, its proxy gap and its git 2.38
floor; the throwaway worktree and the sweep that is a git operation rather than
an unlink; and the lease-protected push of ruling D1 — with the ordering rule,
the nested-stack refusal, stack invalidation, sequence and its three resume
triggers underneath it. Every word of them is in **Appendix G1**, unchanged.
They moved at the simplification pass's second fix round (§15 S20) for the
reason S19 moved §4.2 item 5's mechanism: they are how a gated rung *runs*, they
cost the committed slice about 225 lines of reading for something nobody has
been told to build, and a mechanism sitting in a committed section reads as
committed work. What stays here is the case (c) design — the five facts, why the
head is read and not received, the departure from decision 4, the negative rule,
the bound on the peer's own words and the missing `branch CI passing` fact —
and the discriminator below, which §6.0 and §10.4's G2 trigger both point at.

#### The discriminator: what an unclean probe means, and what it does not

**One observable, two rules, and the first draft did not separate them.** A
merge-tree probe that does not apply cleanly routes to **sequence**
(Appendix G1), and
Appendix G2's first scenario described a contradiction as *"the rebase now fails on the value, not on
the text"*. Git has no such distinction: it reports textual conflicts and nothing
else. So the discriminator is stated here, once, and §6 and Appendix G1's risk point at it:

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

| Case | Trigger | Carried by | New wire? | Built? |
|---|---|---|---|---|
| (a) same task | `task.claim` with a colliding `subject_key` | existing | no | **committed** — unchanged, already shipped |
| (b) same file, different symbols | PreToolUse path match + `symbols` disjoint | **V-D2**, on `task.change{scope}` where the relay decides carriage (§2.3) | one OPTIONAL field | **committed** — Stage 2(a) |
| (c) stack | the sha `git ls-remote` returns for the peer's declared `branch` changed since the last read | the existing `presence.update.branch` `[C docs/PROTOCOL.md:295]`, plus a **local** read | **no** — V-D1 withdrawn (§2.3) | **gated — G1** |
| (c) sequence → resume | `task.release` / `task.done`, **or the base claim expiring (presence `gone`, never `stale`)** `[P§5.3]` `[P§4.3]` | existing `[C lib/envelope.js:41-45]`; staleness is reader-derived and travels not at all | **no** | **gated — G1** |
| contradiction (§6) | **the model, reading the fetched diff, judges that two requirements cannot both hold — and then posts `task.seam{propose, contested: true}` into a seam.** Detection is a reading; the round opens on the structured act and on nothing else (§5.4's discriminator, §6.2). **[proposed]**, since detection-by-reading relaxes decision 2 | `task.seam` + **V-D3** | dependent on `[COBUILD §11 E1-E3]` | **gated — G2** |

**Two of the five rows are built and three are not**, which is the shape of the
whole simplification in one table: the committed slice handles the two cases that
happen constantly and hands the third to the two humans, who can see each other's
branches and each other's symbols and are the ones the third case was always
going to interrupt anyway.

---

## 6. The contradiction protocol (decision 5)

> **Gated: see Appendix G2.** The whole of §6 is design for a rung that is built
> only if the run shows a **true requirements conflict** actually occurred
> (§10.4's entry trigger) — and it is additionally blocked on
> `[COBUILD-PLAN §3.S0-S2]`, which are themselves unratified. It is kept here in
> full because it is decision 5, because §3's one relaxation of decision 2 is
> defined here, and because a design that is not written down cannot be entered
> from a trigger. **What the committed slice does instead:** `note.blocker`
> ships today, at zero new surface, and reaches both humans
> `[C skills/handshake-coordination/SKILL.md:278-326]`.

*His diff needs `X = true`; mine needs `X = false`.* Decision 5 names this as the
one place true collaboration and talking belong. Everything below reuses
`COBUILD`'s machinery; §6.2 says exactly what is new.

### 6.0 What opens a round — one definition, used by §5.4, §5.5 and Appendix G

The first draft gave this three different answers in three places and none of
them worked: §5.5's *"a disagreement between two adopted revisions"* is circular,
because at round-open there are no revisions — rev 1 is authored by the `propose`
that opens the round (§6.2); the contradiction scenario's *"the rebase now fails on the value, not on
the text"* asks git for a distinction git does not make; and §5.4 had already
routed every unclean rebase to *sequence*. One definition, in three parts
**[proposed — gated item 42]**, because part 1 relaxes decision 2's *only a
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
truthful than a fact the sender asserts, and it costs no bytes. If G2's build
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
runs at one confirmation per inbound revision per receiving side. Appendix G2's two scenarios
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
Stage 2(a) extends it to harvest `symbols` from `task.claim` / `task.change{scope}`
bodies into **`peers.claims[].symbols`** — **a separate array, never merged into
`files[]`**, because `files[]` is what the gate path-matches against a write
path `[C hooks/pre-tool-use.js:57-58]` and §11.3 asserts a peer symbol string
never becomes a filesystem path. Each element is escaped the way `files` is at
`[C hooks/sync.js:108]` but **with an explicit `{ max: 100 }`** rather than the
`path` class's 300 `[C lib/escape.js:45,152-156]`, and the array is capped at 8.
**And the CLI `sync` path must merge rather than overwrite:**
`bin/handshake.js` sets the claim rows wholesale from `presence.claims`
`[C bin/handshake.js:1006-1010]`, which discards any harvested extra — true for
`files` today and it would silently drop symbols on the next `handshake sync`.
`hooks/sync.js` and `lib/state.js` are in Stage 2(a)'s Touches for this (§10.2).

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
**not** in this plan, and were not in the first draft either. They are built
**only if** coordination records show file-level warnings blocking real work.

**Where that measurement now comes from, since the rung that was going to make it
is gated.** The first draft put the instrument in the learning rung (§8, now G4):
every gate warning and what the model did next. G4 is behind its own entry
trigger, so the ratio below has **two** possible sources and the plan says which
is which. **The run (§10.4) answers the qualitative half** — did a file-level
warning ever actually block work, or did the pair coexist without noticing? — and
that is the same question G1's entry trigger asks, from the same day.
**Only G4 gives the ratio a denominator**, so until G4 ships, §7.3's condition is
answered by the run's verdict and not by a number. Stated plainly rather than
left as a dangling dependency: **the cheap version is the whole feature, and it
stays the whole feature until something measured says otherwise.**

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
  (§10.5).
- **Coordination outcomes** are the next record kind — **gated: see Appendix G4**,
  and the reason is decision 9's own: it rejects hotspot learning before the data
  exists, and the data is produced by G1 and G2, which are themselves gated. A
  record kind with nothing to record is the clearest case in this plan for the
  owner's direction. It is one durable, dated,
  attributed row per resolved conflict — which case it was (§5), what the client
  did, whether it held. Written the same way, on the same shards, through the same
  owner-only throw `[C lib/workspace-files.js:337-343]` and the same
  `sendGate`-before-write `[C lib/workspace-files.js:365]`; read by the same scan,
  which already takes its kinds as a parameter `[C lib/shard-scan.js:67,161]`.
  **One new `SHARD_KINDS` entry [proposed: `outcome`], zero new wire types, zero
  new blocks** — it competes for the existing block's entry slots, so its per-turn
  cost is zero and its per-session cost is zero new characters (§2.4).
- **Guidance tightening** is last, is not designed here, and is **not in this
  plan at all** — committed or gated. It is the step that
  turns recorded outcomes into a narrower default, and it must not be built before
  §7.3's condition and G2's escalation rate have real numbers behind them, which
  after this pass means: not before G4 has run long enough to have a corpus, which
  is not before G1 or G2 fired, which is not before the run said they should.
  Three gates deep is the honest description, and it is why nothing about it is
  scheduled.

**So §8's committed content is exactly what already shipped.** Knowledge K0–K2 is
built and continues; outcomes are G4; tightening is unscheduled. That leaves §8
as a statement of the order, which is what decision 7 settled and all it settled.

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

**What is committed here, and what is gated, because they are two different
things and the first draft ran them together.** **Committed: the per-rung narrow,
typed opt-in.** Every stage that acts autonomously ships its own gate — one row's
worth, in the shape §4.2 item 3 sets — and in the committed slice there is
exactly **one** such gate, `handshake pair --state-branch`, which enables the
state branch and, with it, the work branch and the live view. Autonomy never
precedes consent at any point in the order, and that property is a property of
the per-rung gates, not of the table.

> **Gated: the table itself, and the generalization, are Appendix G3.**
> `handshake pair` as a screen, the persisted per-peer grant, the three modes and
> the migration are built **only if** the run shows **more than one narrow opt-in
> exists** (§10.4's entry trigger). Today there is one, and a capability screen
> that generalizes a single row is a screen — the owner's *"this became so
> complex"* applied to the clearest instance of it in the plan. **[proposed]** —
> the discussion set consent-once at join and put the trusted-pair rung sixth;
> that those two are reconciled by per-rung typed opt-ins, and that the screen
> waits for a second row to generalize, is this plan's own resolution
> (§14 item 19).

**The capability table below is therefore G3's end state**, and it is kept in
full because it is decision 8's *form* — which structured event types may cause
action — and because each committed row's bound is a live constraint on the
committed slice whether or not the screen exists. One row per structured event
type this stage can act on; the grant is per row, per peer, and revocable
instantly. **The `Built?` column says which rows are reachable today.**

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
Default column below is **[proposed]** in every *grantable* row, collected as gated item 20,
and it is the owner's to ratify rather than to inherit: the suggestion is *all
granted except `task.offer`*, on the argument that every granted row is bounded
by its own last column and that `task.offer` is the only one that supersedes an
existing human control (§13.4). A reader who disagrees with one row changes one
row; nothing else in the design moves.

| Event type (structured) | What acting on it means | Default **[proposed]** | Bound that holds regardless | Built? |
|---|---|---|---|---|
| `task.claim` / `task.change{scope}` with `symbols` (**V-D2**) | narrow my gate's rendered verdict; coexist on a symbol-disjoint file | **granted** | render only; never suppresses the path warning | **committed** — Stage 2(a) |
| `presence.update` with a `branch`, plus the head this client reads with `ls-remote` (§5.4) | fetch the peer's work branch into a namespaced ref and evaluate a merge-tree probe | **granted** | fetch and **local** evaluation only, in a throwaway worktree (§4.2 item 5); never a push to their branch, never a build/install/test in a tree carrying their commits, and **refused outright unless every path in their diff sits under a locally derived allowlist with no mode change, and never on the instruction/build floor** (§4.2 item 5) | **gated — G1** |
| `task.release` / `task.done`, **and base-claim expiry** `[P§4.3]` | resume a sequenced task automatically | **granted** | resumes only a task this member already holds; expiry is reader-derived and carries no payload at all | **gated — G1** |
| `task.seam{propose}` where `contested` | open a contradiction round; render the notice | **granted** | opening is not adopting | **gated — G2** |
| `task.seam{contract}` | materialize the revision and build my half against it | **granted on an authenticated transport; human-gated on ntfy** | `[COBUILD §2.6]` verbatim: automatic iff `capabilities().authenticated_from` | **gated — G2** |
| `task.seam{adopt}` | record that the peer adopted; clear my rev-not-adopted notice | **granted** | three values the client computed or verified itself | **gated — G2** |
| `task.offer` (`[DELEGATION Appendix C C1]`, unratified) | **accept an offer without asking my human** | **NOT granted by default** | see §13.4 — this is the row that supersedes DELEGATION's per-offer gate, and it is opt-in per peer | **gated — G3** |
| `note.*` of any kind | **nothing** | **never grantable** | prose may cause thinking, never work (§3). This row exists to be permanently empty. | **committed as a rule**, and permanently empty |

Two properties of the table, both load-bearing:

- **It is a closed list of types, so the grant is enumerable and displayable at
  grant time** — the criterion, satisfied by construction rather than by
  discipline.
- **The last row is the design.** No capability, at any setting, lets peer prose
  cause an action. That is what makes every other row safe to grant.

**Under G3**, `handshake pair` prints the whole table with the current setting for
that peer,
requires a typed confirmation and refuses `--yes` the way `join` does
`[C bin/handshake.js:627]` `[P§9.1]`, and refuses from a proven child
`[C bin/handshake.js:387]` `[P§7.2 rule 1]`. `handshake pair --revoke` flips local
state **before** any network call, so a capability dies the instant the command
runs and cannot be held open by a dropped message — the rule `[COBUILD-PLAN §3.S1]`
establishes for `seam end`. **Until G3**, the same three properties belong to
`handshake pair --state-branch`, which is the one gate that exists: it prints the
grant, refuses `--yes`, refuses from a proven child, and its revocation flips
local state before any network call. The properties are the committed thing; the
screen that collects them is what is gated.

---

## 10. The build

**Three committed stages and the run. Everything else is in Appendix G, behind
an entry trigger the run either fires or does not.** That shape is the owner's
direction of 2026-09-02 — *"this became so complex, we went from v2 to v7"* —
and it is a change of commitment, not a change of design: nothing was deleted,
four rungs moved, and each moved rung now has to earn its build out of something
the run observed rather than out of a plan written before anyone used it.

The committed slice is what decision 10 put first and what the two-human run can
actually judge: **durability** (the state branch, which everything else needs and
which is useful on its own), **the live view** (one work branch per member,
declared symbols, the commit secret scan), and **the gate and the release**. The
reasoning is still stated per stage, because each stage is justified by a
different thing.

**Order: Stage 1 → Stage 2 → the run (gate) → Stage 3**, with Appendix G entered
only from what the run found. The stages are numbered here in the order a reader
meets them; the run sits between Stage 2 and Stage 3 because it measures Stage 2
and its findings decide both what Stage 3 must red-team and whether any of
G1–G4 is built at all.

**No V-numbers in the committed slice.** They were the visible face of the
complexity the owner flagged, and a plan whose build order needs eight ordinals
to state is a plan arguing for itself. `G1`–`G4` keep their identity because
they are optional and must be nameable in a trigger.

### 10.1 Stage 1 — Durability

**Why first.** It is the stage everything else needs and the only one that is
useful on its own. Machine-speed durability is what makes the absent-peer case
dissolve (§4.3), what lets Appendix G1 fetch anything at all, and what turns G4's
outcome records from a file nobody pulls into a fact the peer's next session
reads. It also has the shortest dependency list in this plan: **no wire change at
all.**

**Delivers.** An orphan `handshake/state` branch **[proposed]** carrying an
explicit path allowlist (§4.3); a commit per batch with author = the member and
committer = the tool, **every commit message carrying `[skip ci]`** (§4.2
item 4); a push batched at ≤ 1/min on the monitor's own clock; a
deferred retry while offline; **the no-remote arm — no branch, no commit, no
push, today's behaviour, said plainly in `status`** (§4.1); **the opt-in gate,
which is `handshake pair --state-branch`** — named here in Delivers and not only
in Touches, because the first draft named the verb in a place no user reads —
carrying ruling D2's visibility verdict with its three-way refusal (§4.2 item 2),
the branch-model and commit-cadence sentences of §4.2 item 3, and the recorded
override; **the preflight with its THREE preconditions** — the visibility verdict
per D2, a `git push --dry-run` that runs non-interactively, and `commit.gpgsign`
off or resolved — plus the two `[skip ci]` **warnings** of §4.2 item 4, which do
not block; **the read half** (below); the SessionEnd last-batch flush and the
late-not-lost recovery beside it; **the `push:` line of §4.4 rule 1 in
`handshake status`**; and the user-facing text this stage makes true or false —
`handshake pair --state-branch` added to `docs/INSTALL.md` and to `USAGE`
`[C bin/handshake.js:2514-2546]`, the branch model added to the cloner-facing
README body `[C lib/workspace-files.js:673-730]`, the `scrub` message rewritten
with the refs it leaves (§4.3), and `SKILL.md`'s *"Tests are green on my branch
— status of no consequence"* row `[C skills/handshake-coordination/SKILL.md:275]`
flipped, because from this stage the branch **is** the live view.

**Three preconditions, not five, and the two that left.** The **CI filter** is
gone entirely — `[skip ci]` replaces it (§4.2 item 4), no workflow is read, no
workflow is edited, and this repository's own `ci.yml` is **not** touched by this
plan. The **recorded `git --version`** is gone from here because the only thing
it gated was stacking; it moves to G1's own entry work (Appendix G1). What is
left is three questions about *this* machine, all answerable in a second, none of
them needing another person.

**Five smaller things, each of which is one line of output and each of which the
walk found by being bitten by it** **[proposed, collected as §14 item 49]:**
`status` distinguishing `deferred (no time in the beat)` from `offline` and
`rejected`, so a climbing deferred count says which of the three it is; the
gpgsign / forge-ruleset refusal **stating both arms**, printing the forge's own
rejection line verbatim, naming the remedy, and **re-probing once per session**
rather than staying refused for the life of the workspace; the Windows preflight
check for a known sync root (OneDrive) above the plugin state directory, which
`lib/state.js` already lets the human move with `HANDSHAKE_STATE_DIR`
`[C lib/state.js:58-65]` and which otherwise produces file-lock errors nobody can
attribute; and `handshake doctor` comparing the **registered** hook set against
the **installed** one and naming the missing entry by name — the WSL case, where
`hooks.json` is hand-merged into `~/.claude/settings.json` and re-merged on every
upgrade whose hook set changed `[C docs/INSTALL.md:584]`, which this stage makes
more likely rather than less; and the installer carrying its own
*"this is expected immediately after install"* sentence into **both** arms of the
self-check rather than only the one that has it today
`[C installers/install.sh:389-391]` — `installed-but-not-active` with exit code 1
is the documented, expected result of a fresh install `[C docs/INSTALL.md:401]`
and it should not read as a failed one in the arm where the plugin is listed but
disabled `[C installers/install.sh:382-384]`.

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
                      git hash-object -w -- <path>                             # paths present on disk: WRITE the blob
GIT_INDEX_FILE=<tmp>  git update-index --add --cacheinfo <mode>,<sha>,<path>   # <sha> is what hash-object -w returned
GIT_INDEX_FILE=<tmp>  git update-index --force-remove -- <path>                # paths no longer on disk
GIT_INDEX_FILE=<tmp>  git write-tree
                      git commit-tree <tree> -p <the parent: per branch, below>
                      git update-ref <the ref> <commit>
```

**The `hash-object -w` line is not a formality, and it was missing from the first
three revisions of this block.** `--cacheinfo` names a blob; it does not create
one, and it does not validate that one exists. Verified on git 2.53 against a
temp index seeded by `read-tree`: with a sha from a plain `git hash-object` (no
`-w`), `update-index --add --cacheinfo` exits **0** — silently — and the failure
surfaces two steps later as *"error: invalid object … / fatal: git-write-tree:
error building trees"*, exit **128**. With `git hash-object -w -- <path>` first,
the identical sequence writes the tree and the path is in it. **It also applies
the path's own eol and attribute filters**, which is why it is the right verb
rather than a raw write: measured on this machine with `core.autocrlf=true`, the
blob it stores is byte-identical to the one `git add` would have stored for the
same CRLF file. The failure this closes is loud rather than silent, which is why
it is a build cost and not a hazard — but a mechanism the owner is asked to
ratify (§14 item 41) has to be buildable as literally as it is written.

**`.git/index` is never read and never written, `HEAD` never moves, and no
checkout ever happens.** The author is the member and the committer is the tool,
set through `GIT_AUTHOR_*` / `GIT_COMMITTER_*` on the `commit-tree` call. The
same plumbing is what Stage 2(b)'s work-branch commit uses (§10.2), which is why it is
specified once, here — **but the three operands differ per branch and are named
per branch**: for `handshake/state` the base tree and the parent are both *the
fetched state head, or empty on the very first commit*, and the ref is
`refs/heads/handshake/state`; §10.2 names the work branch's, which the first
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
deleted inside one claim is still on the list §10.2 filters by, and the peer
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
a stat-derived mode does the same. §10.2 carries the tests.
**The rule needs a second arm, and it is the commonest case: a path that is not
in the parent tree at all** — every new file, every path in the first commit of
either branch. Verified: `git ls-tree <parent> -- <new path>` prints **nothing**
and exits **0**, so there is no mode to read and no error to key an arm off,
while `core.fileMode` is `false` on this machine and the stat this rule forbids
would be wrong anyway. **So: the mode is the parent entry's when the path is in
the parent tree; otherwise `100644`, unless the file is executable on disk
**and** `core.fileMode` is true, in which case `100755`.** Stated because the
absolute form of the rule leaves an implementer with exactly the two sources it
forbids, and a new executable file's `100755` is recoverable from neither.

#### The concurrency protocol — one branch, two writers

Decision 3 says **one** `handshake/state` branch, and the plan keeps it. But one
branch with two writers pushing at up to 1/min needs a protocol, and the first
draft specified none — while the floor forbids both of the usual escapes
(force-push on a shared ref, and merging). Per-member files prevent *content*
conflicts; they do nothing about *ref* conflicts. Worse, opt-in is explicitly
independent, so without an adopt rule both sides can create two unrelated orphan
roots. **The protocol, five rules** **[proposed]**:

1. **Fetch first, always**, into `refs/remotes/origin/handshake/state` — **and
   the same fetch carries a second refspec, the default branch's tip into
   `refs/remotes/origin/<default>`** (added at the second-look round, G2-9). It
   is one round trip and one budget row, and without it the three numbers §10.2
   computes against the default branch — the re-root's ancestry arm and both
   human-facing distance counters — are only as fresh as the last time a human
   typed `git pull`. Measured: after a merge landed on the remote, the working
   clone's `origin/<default>` and its local `<default>` both still held the
   pre-merge sha, and only a fetch moved `origin/<default>`; **a fetch never
   moves the local branch at all**, which is why §10.2 names the
   remote-tracking ref everywhere and never the bare `<default>`.
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
   create** (measured 0 / 2 / 128 respectively). Stage 1's Touches already carry an
   `ls-remote` helper in `lib/repo.js`; this is its first use, and §5.4's
   peer-head derivation is its second. The consequence of leaving it unnamed
   was not unsafe — an implementer who cannot prove absence and follows the
   letter creates no root, so Stage 1 loudly fails to bootstrap, and the unsafe
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
fallback if the protocol above proves flaky in the run — rather than adopted here,
because decision 3 settled on one branch and a plan should not quietly re-decide
a settled thing on a hazard it has not yet measured. **Note the cost of the
fallback, so the trade is visible:** `handshake/state/<member>` and
`handshake/state` cannot both exist (git refuses a ref that is a directory prefix
of another), so the fallback is a one-way migration, not a per-repo choice.

#### The read half, which the first draft did not build

§4.3 says the branch is read *"without a checkout via `git show`"*, and nothing
in the product can do that: `scanShards` walks the **working tree**
`[C lib/shard-scan.js:178-192]`, reached from `hooks/session-start.js:80` with a
repo root and not a ref, and nothing fetches the branch. Stage 1 delivers:

- **An automatic fetch of the state ref on the SessionStart async path**, where
  the network already lives `[C hooks/session-start.js:5-6,82-88]` — ordered
  before the scan, which now reads through a ref, and before the sync. **It
  carries rule 1's second refspec too**, the default branch's tip into
  `refs/remotes/origin/<default>`, so the first `handshake branches` of the day
  has a fresh ref to measure against rather than the *"not fetched this session"*
  arm (§10.2).
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
  reachable by setting an option, and on the ref path both are wrong: §11.2's
  whole scenario is a peer shard that exists **only** on the fetched ref and not
  on disk, so the disk walk enumerates zero peer shards and the `HEAD`-scoped
  `git log` answers `uncommitted` for every one of them. Verified at fix round 3
  against an orphan `handshake/state` ref: `git log -1 -- <shard>` printed
  nothing while `git log <ref> -1 -- <shard>` printed the member's email, and
  `git ls-tree -r --name-only <ref> -- .handshake/tasks` listed the shard the
  disk walk could not see. **So Stage 1 adds `git ls-tree <ref> -- .handshake/tasks`
  as the enumeration and a rev argument to `lastCommitEmail`'s `git log`**, both
  new primitives in `lib/repo.js`. The enumeration is `ls-tree` and not the
  local member roster `[C lib/shard-scan.js:268]` because the roster cannot name
  a member this client has never recorded, and the ref can.
  **And the ref path is where the author check acquires meaning**, which is the
  half worth claiming rather than hiding: on the state branch the last commit
  touching a shard carries **author = the member, committer = the tool** — the
  split Stage 1's own test pins below — so `[SEC§5.4]`'s non-member-commit warning
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
(the automatic fetch on the async path, and the late-not-lost flush of a batch
the previous session left) · `hooks/session-end.js` (the best-effort
last-batch flush) · `monitors/heartbeat.js` (the batch clock, beside the
keepalive it already keeps) · `hooks/stop.js` (the no-monitor fallback path,
which already re-uses `beat()` rather than copying it, and whose existing
deadline the push takes a slice of) · `bin/handshake.js` (`pair --state-branch`
and its `USAGE` row `[C bin/handshake.js:2514-2546]`, the three-precondition
preflight, the `rejected` / `deferred` / `offline` arms and the `push:` line of
§4.4 rule 1 in `status`, the rewritten `scrub` text
`[C bin/handshake.js:2402-2404]`, and `doctor`'s registered-versus-installed hook
comparison `[C bin/handshake.js:1489]`) · `lib/state.js` (the
deferred-push marker and the last-pushed-head record, as a sentinel beside the
existing ones `[C hooks/common.js:26-50]`, **not** in `state.json`, which hooks
read-modify-write on hot paths) ·
`lib/workspace-files.js` again, for the cloner-facing `README_BODY`
`[C lib/workspace-files.js:673-730]` · `docs/INSTALL.md` ·
`skills/handshake-coordination/SKILL.md` (line 275's row flipped and the
branch-model row added, inside §2.4's ceiling).
**Not `.github/workflows/ci.yml`, and that is the point of §4.2 item 4:** no
workflow file in this repository or in anyone else's is read or written by this
plan.

**Wire.** **None.** The state branch is git; nothing about it travels as an
envelope.

#### Credentials, signing, rejection, and the sessions that have no monitor

Four operational facts the first draft did not carry, each of which turns an
automated push into a hang or a permanent failure on a real developer's machine.

- **The push reuses the human's existing git credentials and is never given its
  own.** `defaultRunner` already sets `GIT_TERMINAL_PROMPT=0` on every call
  `[C lib/repo.js:67]`, so a credential helper that would prompt **fails instead
  of hanging** — which is the correct direction and is now a stated property
  rather than an accident. The **Stage 1 preflight** proves it up front with a
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
  `[C bin/handshake.js:1305-1306]`, **with the second half of the clause the
  first draft left out: `headless: state pushes ride the Stop hook, peer-branch
  evaluation is off`** (§4.4 rule 3), because a headless run does no peer-branch
  work at all and nothing distinguished that from *nothing to do*.
  **A subagent does neither**: rule 7.2 already
  makes a child never post and never do network I/O, and every path here is
  behind the same `isChild` / `provenChild` verdict
  `[C hooks/session-end.js:33-34]` `[C monitors/heartbeat.js:43]`.
  **And the one session in twenty-one that loses its flush loses it late rather
  than for good** **[proposed]**: SessionEnd is best-effort by contract, so an
  unflushed batch is left on disk and **committed at the next session start**,
  with one line saying so (*"committed a batch left over from your last
  session"*). A sequenced peer waiting on the closing `task.done` then waits
  until the next session instead of forever, which is a different failure and a
  much smaller one.

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
automated commit**, on a checkout with `core.fileMode` false, **and a file that
is NOT in the parent tree is committed at `100644` on that same checkout** — the
add arm of the mode rule, which has no `ls-tree` answer to read. **And the blob
is written before it is named:** a test that runs the block with `hash-object`
and no `-w` asserts `write-tree` exits 128, so the line cannot be lost and
rediscovered in production. **A client offline for seven days
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
present.** **Every commit message this stage writes contains `[skip ci]`** —
asserted on the message the plumbing hands `commit-tree`, on a rebuilt commit
after a non-fast-forward rejection, and on the late-not-lost flush, because a
marker present on three paths out of four is a marker that bills on the fourth.
**The preflight refuses when
`git push --dry-run` cannot run non-interactively, and when `commit.gpgsign` is
on and unresolved** — and **passes, with a warning and not a refusal, on a
repository whose workflows use `pull_request_target`** and on a GitLab remote
whose policy it cannot read (§4.2 item 4). **No workflow file is opened by any
path in this stage**, asserted by fixture: a repository with four push-triggered
workflows and no branch filter enables the automated push with no refusal and no
read. **A six-day-absent client that only runs `git fetch` gets
the peer's records in its SessionStart block** — the read half, pinned, and the
test §11.2 asserts. **SessionStart against an unreachable remote still clears the
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
and says so** — **and the batch it lost is committed at the next session start
with one line**, which is the test the late-not-lost arm exists for.

**The three visibility rules of §4.4, asserted here and in every stage.**
**Rule 1:** for each of **this stage's seven** `push:` states — pushing, `gh`
unauthenticated, visibility unproven, forge rejection, deferred, offline, no
remote — `handshake status` prints that state and no other, and **a state
reachable by no test at the stage that owns it is a state that may not ship.**
The vocabulary is per stage (§4.4 rule 1): the other three — `refused — secret
scan, <file>`, `no recorded lease` and `paused — remote head is not the one this
tool pushed` — need the scanner, the lease helper and the work branch, all of
which are Stage 2's, so Stage 1 neither prints nor tests them. **Rule 2:** every
refusal this stage can emit is asserted to contain a next move: the gpgsign
refusal names the setting and the two arms, the forge rejection prints the
forge's own line, the visibility refusal prints the arm of §4.2 item 2 it took —
and the `no_github_remote` arm is asserted **not** to print the world-readable
sentence and to record `unprovable` rather than an override. **Rule 3:** a peer
with no `handshake/state` branch on the remote produces
`bob: no state branch on the remote — not enabled yet` in `status`, derived from
`ls-remote` and from nothing the peer sent; a headless session prints its own
clause; and a run with the peer fully opted in prints neither, so the line cannot
rot into decoration. **`status` also prints the last SessionStart fetch duration
and whether the scan came back `truncated`** — the first prompt of the day is
slower and says `sync pending` `[C hooks/render.js:67]`, and a human who can see
the number stops guessing.

**Tier: Opus xhigh.** This is the first code in the product that writes to a
remote without a human in the way. It gets M2's tier for M2's reason.

### 10.2 Stage 2 — The live view

**Why second, and why it is one stage rather than two.** This is the stage that
makes a Claude's unfinished code visible on another person's machine, and the
two halves of it are not separable in practice: a work branch whose scope nobody
declared is a live view of an unknown blast radius, and a declared symbol with
no branch behind it narrows a warning and nothing else. They also share one
budget (the card, §2.4), one gate (the secret scan) and one re-measurement.
Shipping them as one stage is the simplification the owner asked for applied
inside the build order rather than only across it.

**What the human gets at the end of it.** Two branches on the remote per pair
plus `handshake/state` — three refs, forever (§4.1) — each moving as its owner
works, each labelled with why it is or is not moving (§4.4 rule 1), each
re-rooted onto the default branch once its PR merges, and neither of them ever
running CI (§4.2 item 4).

**Delivers, across both halves.** Declared symbols on claims with their carriage
and harvest rules and their card and gate-line rendering (Stage 2(a)); **one
stable work branch per member, `handshake/<member>`, reused across every claim**,
with the re-root after merge, the ref-name sanitizer, the base-and-parent rule,
ruling D1's lease-protected push and the `[skip ci]` marker (Stage 2(b)); the
fail-closed commit secret scan **with `handshake scan-allow` shipped beside it**
(§4.2 item 1); `handshake branches` as the read-only view, carrying the `push:`
line, the derived asymmetry lines, **`N commits not in main, X days old` for this
member's own branch and a locally derived line for the peer's** (below), and the
state branch's own commit count, size and both delete commands — remote and
local, since the tool writes local refs too (§4.3) — with the clause that the
same three refs sit in your own `git branch`; and the
overlap-warning short form. **The block re-measurement gate of §2.4 stays**, and
is checked at the end of this stage rather than at the end of each half.

#### Stage 2(a) — Declared symbols on claims

**Why it comes with the branch and not after it.** It is the cheapest wire change
in the plan — one OPTIONAL field on
two existing types, no catalog amendment (§2.3) — and it is a prerequisite for
both remaining conflict cases: (b) needs it to stop warning needlessly and (c),
if G1 is ever entered, needs it to know two tasks touch one method. It is also
what makes §7.3's parser question measurable instead of theoretical.

**Delivers.** `symbols` on `task.claim` and `task.change{scope}`, **with §2.3's
carriage rule: on the relay `task.change{scope}` is the authoritative carrier**;
the **discriminating-tail** `details[]` entry on the card (§7.1); the full
`path::Symbol.member` on the PreToolUse rendered line, **attributed —
`alex says: Handler.shape` — because a declared symbol is a recollection and
renders like a measurement** (§5.3); **the notices
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
`peers.claims[].symbols` — §7.1, and the reason Stage 2(a) needs a harvest at all
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
`[C hooks/common.js:668-673]`. **Three notices render two plus
`+1 ! own claim expired`** — the count *and* the kind — **and none vanishes
silently** `[P§10.2]`. **The re-measurement
gate:** the standing block with two symbol-scoped claims **and two notices with
the overflow marker** stays under 600, and
`dropDetails` `[C hooks/render.js:253]` drops the symbol before anything
untrimmable — a gate, not a note, exactly as `[COBUILD-PLAN §3.S0]` makes it.
**The SKILL.md gate:** the file's line count after this rung is under the
ceiling §2.4 states, or the rung does not ship.

**Tier: Opus high.** Mechanical, against a hard budget and a frozen render ladder.

#### Stage 2(b) — The work branch, the re-root and the commit secret scan

*(The CI skip was a rung of its own in the first draft, then a preflight
precondition. It is neither now: §4.2 item 4 puts `[skip ci]` on every commit the
tool writes, no workflow file is read or edited anywhere, and this repository's
own `ci.yml` is untouched.)*

**Why it needs 2(a) beside it.** The scope of what is being published is a fact
about the claim, and a work branch whose scope nobody declared is a live view of
an unknown blast radius. And this is the half that makes a Claude's unfinished
code visible to another person's machine, which is exactly what the run in §10.4
exists to judge — so it ships **before** the run, and the run's verdict on it is
what gates everything in Appendix G.

**Delivers.** **`handshake/<member>`** **[proposed]** — **one branch per member,
stable, created at the first claim and reused for every claim after it**, pushed
freely, **with a ref-name sanitizer of its own** (§14 item 2, below) **and its
base commit recorded at acquisition** (§14 item 43, below); **the re-root after
merge** (below); the fail-closed commit secret scan of §4.2 item 1, **as its own
caller with the code-shaped battery, the tripwire needle filter, and
`handshake scan-allow <finding-id>` shipped in the same stage**; ruling D2's
coverage rule — commit
messages and branch names scanned, binaries and non-UTF-8 files never
auto-committed; **`[skip ci]` on every work-branch commit**; ruling D1's
`--force-with-lease` helper, restricted to `refs/heads/handshake/<self>` and
lease-valued from the tool's own recorded head; `presence.update.branch` populated
from the work branch rather than left to the human `[C bin/handshake.js:1782]`;
**`handshake branches`**, which is where most of §4.4 lands;
**and the three counters §12.2's cut trigger needs — scan attempts, refusals, and
one human-adjudication line per refusal** — because the trigger is anchored here
and a trigger with no instrument is a mood.

#### One branch per member, and what that removes

**The owner's ask, verbatim: *"I hope there's not too much branching — we realise
that at the end of the day there are 10 different branches just sitting there;
that would be a hassle rather than solve a simple problem."*** The first draft
created one branch per claim, never deleted any of them (deletion is above the
floor, §4.1), and priced the accumulation as a `git branch -r` listing that
"grows without bound" while declining to do anything about it. Twelve claims in a
week is twelve refs nobody will ever look at again.

**The design, and it is smaller than what it replaces.** A claim is **state** —
its subject, its `files[]`, its `symbols` — and **never a ref**. There is one
branch per member, named `handshake/<member>`, created at the first claim and
reused for every claim afterwards. Concurrent claims of one member share it,
which the first draft already required for a different reason: a member holding
two claims owns one content state, so two branches would put each claim's edits
on both. **Two people means two work branches plus one orphan `handshake/state`:
three refs, forever.**

**What this deletes from the plan rather than adds to it.** The
per-claim branch-name shape (old §14 item 2's `<subject_key>` component) is gone,
so the ref-name sanitizer now only has to sanitize the **member** segment — it
keeps the trailing-`.lock` strip, the leading-dot rejection, the `state`
reservation and the `git check-ref-format --branch` validation, and loses the
subject component entirely, which is where the traversal corpus lived. **Old §14
item 30 — how many work branches a member may hold at once — is structurally
answered and its row is removed**, not re-decided. And §12.1's *"stale work
branches accumulate until a human prunes them"* stops being true: what
accumulates is **unmerged work on one branch**, which is a different problem with
a different report (below).

#### The re-root after merge

**The problem it closes.** The human opens a PR from `handshake/<member>` to the
default branch and it merges — both above the floor, unchanged (§4.1). Without a
re-root the branch still carries every merged commit, so the next claim's live
view opens with a diff a peer has already seen and a `handshake branches` line
that says nothing useful. **So once the PR has merged, the tool re-roots its own
branch onto the merged base** — the same ref D1 already lets it rewrite, under
the same lease.

**Detection, three arms and a gate, rewritten at the second-look round**
**[proposed — §14 item 50].** The first two of the three were the whole of it;
the review found that arm (a) fired when it should not, that the old `gh`-based
squash arm could not fire in the case this subsection is mostly about, and that
neither arm existed at all on a forge without `gh`. **Every `<default>` below is
`refs/remotes/origin/<default>` and never the bare local branch** — §10.1 rule 1
now fetches that tip on the same round trip as the state ref, and a fetch moves
the remote-tracking ref and never the local one (G2-9).

**The gate, first, because a level condition where the design needs an edge is
what made arm (a) misfire.** No arm counts unless the branch has something of its
own to re-root: `git rev-list --count <the recorded base>..refs/heads/handshake/<self>`
must be **> 0**. Without it, arm (a) is trivially true for a branch sitting at an
older default-branch commit with no commits of its own — measured, `merge-base
--is-ancestor` exits 0 — so somebody else's PR merging would fire a lease
force-push, a recovery-pointer write and a rule-1 line for a merge that never
touched this branch, which is precisely the automatic mid-claim restack this
subsection declines to perform (below). It also stops the arm re-firing forever
after a legitimate re-root: `is-ancestor` is reflexive (measured: `main` is an
ancestor of `main`, exit 0), so a branch reset onto the default head would
re-root again on every beat that the default branch advanced. **The re-root
updates the recorded base to the new base in the same step**, which is what
returns the count to zero after case 1 and keeps it honest after case 2.

- **(a) Merge commit or rebase-merge.** `git merge-base --is-ancestor
  refs/heads/handshake/<self> refs/remotes/origin/<default>` is true: every commit
  on the branch is now on the default branch. Local, free, forge-agnostic, and it
  is the same primitive the stack-invalidation rule already uses (Appendix G1).
- **(b) Squash merge, detected locally by tree equality — the arm that makes this
  work on a forge that is not GitHub.** A squash leaves the branch's commits
  non-ancestors of anything, so arm (a) is blind to it; but the moment it lands,
  the branch's **content** is the default branch's content.
  `git diff --quiet refs/remotes/origin/<default> refs/heads/handshake/<self>`
  exiting 0 means everything on this branch has landed ⇒ reset. Measured against
  a squash-merged branch: exit 0 at that instant, with no `gh`, no API and no PR
  concept anywhere in it. **Its bound is stated rather than implied: it goes
  blind the moment the default branch advances past the squash** — measured, one
  unrelated hotfix on the default branch and the same comparison exits 1 — so it
  covers the branch-head-equals-merged-head case within one beat of the merge and
  nothing after that. At a beat of roughly one a minute that window is usually
  enough, and arm (c) is what covers the rest where it exists.
- **(c) The merged-PR probe, GitHub only, for the case the branch is ahead.**
  Read `gh pr list --head handshake/<self> --state merged --json mergeCommit,headRefOid`
  on the visibility verdict's own 600 s TTL `[C lib/repo.js:25]`, beside the `gh`
  call the guard already makes `[C lib/repo.js:36-48]`. **The test is a local
  ancestry proof, not an equality:**
  `git merge-base --is-ancestor <headRefOid> refs/heads/handshake/<self>` exits 0
  — the merged head is a commit on this branch — **and** `headRefOid` is not the
  branch's own recorded base. *The equality this replaces could not fire in the
  case §10.2 calls routine*: the tool records exactly one head per ref (D1 rule 1,
  singular, and both Touches lists carry one value), and that record is by
  definition the branch's current head, so it equals the merged `headRefOid` only
  when nothing was pushed between the merge and the probe — i.e. only in case 1,
  never in case 2, which is the case this subsection is mostly about. Ancestry
  needs no extra state, is strictly stronger, and fails closed: measured, exit 0
  for the merged head, exit 1 for an unrelated commit, exit **128** for a sha
  this clone does not have. The `--head handshake/<self>` scoping stays as the
  second half of the check.

**When arm (c) is unavailable, the human is told, because rule 3 requires it.**
On a `no_github_remote` or `gh_unauthenticated` verdict `[C lib/repo.js:36-48]`
— the permanent case for every GitLab, Gitea, Bitbucket or self-hosted pair, which
§4.2 item 2 exists to admit — `handshake branches` prints
`re-root: partial — no GitHub remote; a squash merge is detected only while the
default branch has not moved past it` (§4.4 rule 3). Arms (a) and (b) are local
and run everywhere, so merge-commit and rebase-merge re-root correctly on any
forge and a squash re-roots on any forge within the window arm (b) states; what
is off is the ahead-of-merged-head squash case, and it says so rather than
silently doing nothing forever.

**And the re-root does not run on a paused branch.** If the remote head is not
the head this tool pushed — a human took §4.2 item 4's advice and pushed a commit
of their own to get checks to run — then `push:` is
`paused — remote head is not the one this tool pushed` (§4.4 rule 1), no push of
any kind is attempted, and a rewrite of a ref carrying somebody else's commit is
exactly what D1's lease exists to refuse. The branch resumes, and the re-root
with it, when the human resolves it the way rule 2 says.

**What happens to commits pushed after the merged head, which is the case that
makes this non-trivial.** There is no PR-open push suspension any more (§4.2
item 4), so the tool keeps pushing while the PR is open and the branch head is
routinely **ahead** of the head that merged. Those commits are **not discarded**:

1. **Branch head equals the merged head** → the re-root is a plain
   `update-ref` of `refs/heads/handshake/<self>` to
   `refs/remotes/origin/<default>`. Nothing is rewritten that was not already
   merged, and no working tree is touched. **One thing this push does that no
   other tool push does:** its head commit is the default branch's tip — a human
   commit with no `[skip ci]` — so a forge that runs `on: push` starts **one run on
   `handshake/<self>` per merged claim**, at the human's merge cadence and never
   the tool's push cadence (§4.2 item 4, §12.5). An empty marker commit on top
   would silence it, and is not taken: it would put a commit not in main on a
   branch that has nothing of its own, which is the line `handshake branches`
   exists to keep true.
2. **Branch head is ahead of the merged head** → the commits after it are
   **replayed onto the new base** and the branch continues from there, pushed
   with `--force-with-lease` on its own ref (D1). A replay that conflicts leaves
   the branch exactly where it was and renders one notice; it never resolves a
   conflict on its own.

**Neither case writes the ref while it is checked out, and neither does the
work-branch commit of 2(b).** Before any `update-ref` of
`refs/heads/handshake/<self>` the tool reads `git symbolic-ref -q HEAD` and
`git worktree list --porcelain`; if any worktree has that ref checked out,
nothing is written this beat and `push:` reads
`paused — handshake/<self> is checked out` (§4.4 rule 1). Measured on git 2.53:
`update-ref` on a checked-out branch exits 0 and moves the human's `HEAD` while
leaving their index and working tree on the old commit — §10.1's invariant,
broken silently — where `git branch -f` refuses the same write with exit 128. The
tool copies git's own rule, not the primitive's permissiveness. The docs line
*never pull `handshake/<you>` into a checkout you care about* is the human-facing
half of this; the guard is the machine-facing half. Test: with `handshake/<self>`
checked out in the tool's clone, a hundred beats write nothing, `git rev-parse
HEAD` and `git status --porcelain` are byte-identical, and `status` carries the
paused line.

**And the replay is plumbing, not `git rebase` — corrected at the second-look
round, because the word "rebase" was quietly cancelling §10.1's central
invariant.** §10.1 spends a subsection establishing that the tool and the human
share one working tree, that `HEAD` never moves and that **no checkout ever
happens**, and this plan says in §5.4 in so many words that *a rebase is a
checkout*. Verified on git 2.53, `git rebase --onto <new base> <merged head>
handshake/<self>` in the tool's own clone: on a clean tree it exits 0 and leaves
`git symbolic-ref HEAD` reading `refs/heads/handshake/<self>` — the human has been
moved onto the tool's branch without asking; on a content conflict it exits 1
with `HEAD` **detached**, `<<<<<<<` markers written into the shared working tree
and `.git/rebase-merge/` left in place, so *"leaves the branch exactly where it
was"* would be true of the ref and false of everything the human can see; on an
untracked collision it aborts with *"the following untracked working tree files
would be overwritten"* and leaves `HEAD` detached mid-rebase; and on a merely
dirty tree it refuses outright (*"cannot rebase: You have unstaged changes"*), so
the arm would silently never fire for a human mid-edit. That is the exact failure
§10.1's temp-index plumbing exists to prevent, on a path that runs unattended on
a monitor beat.

**So the replay is checkout-free, in the same register as the rest of §10.1**
**[proposed — §14 item 50]**: for each commit `c` in
`git rev-list --reverse <merged head>..refs/heads/handshake/<self>`, compose
`git merge-tree --write-tree --merge-base <c^> <cur> <c>` — where `<cur>` starts
at the new base — and, on exit 0, `git commit-tree <that tree> -p <cur> -m <c's
own message>` with `c`'s author identity and date preserved; then **one**
`update-ref` at the end. Measured end to end in a lab of exactly this shape:
`git rev-parse HEAD`, `git symbolic-ref HEAD` and `git status --porcelain` are
byte-identical before and after, and the `[skip ci]` marker rides through on
every replayed message. **A non-zero `merge-tree` is the conflict arm**: stop,
leave the branch's ref exactly as it was, write nothing, render one notice.

**Its version floor, and where that leaves Stage 1's three preconditions.**
`merge-tree --write-tree` is **git ≥ 2.38** — the same primitive and the same
floor Appendix G1's probe has, and Stage 1 dropped its recorded `git --version`
precondition on the stated ground that *"the only thing it gated was stacking"*
(§15 S13), which case 2 now falsifies. **Stage 1's three preconditions are not
re-opened; case 2 carries its own arm instead** **[proposed]**: Stage 2(b) reads
`git --version` where it needs it, and below 2.38 **case 2 refuses** — the branch
is left where it is, one notice renders, and `handshake branches` says
`re-root: case 2 off — git 2.34 (needs 2.38)` (§4.4 rule 3). Case 1 is an
`update-ref` and keeps working at any version, so the common shape degrades to
"the live view re-roots only when the branch has nothing newer than the merge",
which is a stated partial rather than a silent failure. Ubuntu 22.04 LTS ships
git 2.34.1, so this is not a theoretical branch — it is the same one G1 states.

**Before any re-root, the previous head sha is written to this member's own shard
on the state branch as a recovery pointer** **[proposed]** — one line, dated,
attributed, in the append-only file the state branch already carries — so
`git branch <name> <sha>` restores the pre-re-root branch for as long as the
objects survive gc. The tool does not create that branch itself; recovering
history is a human decision and creating a ref is one more ref, which is the
thing this whole subsection is for. **And the recorded base moves with it**: the
per-claim base of §14 item 43 becomes the new base in the same step, which is
what returns the detection gate's count to zero and stops the re-root firing
again on every later beat.

**Four properties, stated because a rewrite on a shared remote deserves them.**
The re-root touches **only** `refs/heads/handshake/<self>` — never `<default>`,
never the peer's branch, never a tag. **It moves no `HEAD` and checks nothing
out**, in either case: case 1 is an `update-ref` and case 2 is the `merge-tree` /
`commit-tree` replay above, so §10.1's invariant covers the re-root as well as
the commit. It runs **after** a merge the human performed, so it cannot race a
review. And it is the second of the two users of D1's carve-out, which is why
§4.1 lists it in the floor table rather than leaving it to be inferred from this
section.

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
- **`HEAD` never moves**, and the mechanism is the same temp-index plumbing Stage 1
  specifies for the state branch (§10.1): `GIT_INDEX_FILE` → `read-tree` →
  `update-index` (with the `--force-remove` arm and the parent-tree mode of
  §10.1) → `write-tree` → `commit-tree -p` → `update-ref`. No checkout,
  no `git add`, no `.git/index`.
- **The base tree and the parent are the work branch's own, and they are stated
  here because §10.1's operands are the state branch's — added at fix round 3.**
  §10.1's block names *"the fetched state head, or empty"* for both `read-tree`
  and `-p`, which is meaningless for `handshake/<self>`, and read
  literally its *"or empty"* arm would produce a **parentless** commit whose
  tree is only the claim's `files[]` — contradicting Appendix G1's *"Bob's tree
  contains Alex's unmerged commits"*, its restack-before-the-PR, and every
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
     base and diverges**, and `handshake branches` says how far behind it is —
     with **one notice at a threshold** rather than a number only a command
     shows: `work branch is 12 commits behind its base — restack before the PR`
     (§4.4 rule 1). **The distance is measured against
     `refs/remotes/origin/<default>`, never the bare local branch, and it is
     computed after §10.1 rule 1's fetch or not at all** — a local `<default>`
     moves only when a human types `git pull`, so a number taken from it is a
     stale number presented as a fact, which is worse than the silence rule 1
     closes. With no fetch this session the line reads `unknown — <default> not
     fetched this session`, and the same rule and the same fallback govern
     `N commits not in main` above (G2-9). Restacking it
     mid-claim is *permitted* — it is `refs/heads/handshake/<self>` and ruling D1
     puts a lease-protected rewrite of that ref below the floor — but it is
     **not automatic**, because a rewrite fires the stack-invalidation rule
     (Appendix G1) on any peer stacked on this branch, for a reason that peer cannot
     see. Restacking mid-claim stays a human operation; **the automatic rewrite
     this plan does take is the re-root above, and only after a merge the human
     performed.**
- **One branch per member, so "which branch does this claim write to" is not a
  question.** The first draft asked it and answered *one active work branch per
  member, following the most recently acquired live claim*, because a member
  holding two claims owns two branches but **one** content state. With one stable
  branch the question dissolves: every live claim of this member commits to
  `handshake/<member>`, and the only thing the most-recently-acquired ordering
  still picks is **which claim's `files[]` filters this beat** — the same
  `getOwnClaims` ordering `post-tool-use` already uses to choose which claim to
  append a written path to `[C hooks/post-tool-use.js:82-84]`. Old §14 item 30 is
  removed rather than re-decided, and the friction it created is removed with it:
  there is no *"the first claim's live view silently froze when the second claim
  was acquired"*, because nothing froze — the branch kept moving and the notice
  the first draft owed the human is a notice it no longer has to write.
- **Your own claim expiring is still a real event, and it gets its own line**
  **[proposed]**. When a member's claim expires mid-session the branch stops being
  pushed for it, and to the peer that reads as a handover. One notice on your own
  side: `your claim on <subject> expired — branch no longer pushed; re-claim to
  resume`. §4.4 rule 1: the human sees the cause on the machine where the cause
  is.

#### A filename sanitizer is not a ref-name sanitizer

**Narrowed by the branch model, and kept.** With one branch per member the only
segment this rule has to derive is the **member** one — the `<subject_key>`
component is gone with the per-claim branch — so the traversal corpus the first
draft worried about (a subject engineered into `../`, a device name, a `refs/`
prefix) has no component to ride on any more. What survives is the member
segment, which is peer-authored free text and therefore still needs every rule
below.

The first draft reused `shardFileName`'s rule for the branch name (§14 item 2).
It is the right *instinct* — derive, never accept — and the wrong *rule*, and it
leaves two permanent, silent, un-retryable failures, both verified against
git 2.53:

- **`shardFileName` preserves interior dots** `[C lib/workspace-files.js:294]`,
  so a member id of `alex.lock` yields the path component `alex.lock`, and git
  refuses any ref component ending in `.lock` outright. That member can never
  create a work branch, on any subject, forever.
- **A member whose id sanitizes to `state` collides with `refs/heads/handshake/state`**
  by git's directory/file rule — and under the one-branch-per-member model the
  collision is **direct**, not by prefix: `handshake/state` is literally the
  state branch's name. Member ids are peer-authored free text
  `[C lib/workspace-files.js:287-289]`, so the reservation below is not optional.

So Stage 2 ships a **ref-name sanitizer** **[proposed]**, separate from
`shardFileName` and beside it: strip a trailing `.lock` from **every** slash
component, reject any component beginning with `.`, apply the existing
character-class and length rules per component, **reserve `state` as a
member-component name** (a member sanitizing to it gets `state-member`, the shape
`RESERVED_BASENAMES` already uses `[C lib/workspace-files.js:290,296]`), and
**validate the result with `git check-ref-format --branch`** rather than trusting
the regex — the same posture as asking `gh` rather than guessing visibility. Both
cases join Stage 3's corpus.

**No PR-open push suspension exists in this plan.** The first draft stopped a
work branch's automated push once `gh pr list --head` reported a PR on it, to
keep `pull_request`'s `synchronize` event from restarting the four-job matrix
every minute. `[skip ci]` closes that door on the commit rather than on the push
(§4.2 item 4), so the suspension is **removed**: the live view keeps moving under
an open PR, which is the moment two people are most likely to be watching it,
and `gh pr list` is read for exactly one purpose now — arm (c) of the re-root
above, and only where a GitHub remote exists at all.

**Touches.** `lib/repo.js` (the work-branch commit, the lease-protected push
**with its `ls-remote` present/absent arm** (D1 rule 1), the re-root's three
detection arms — `merge-base --is-ancestor` and `diff --quiet` locally, the
merged-PR probe beside the visibility probe `[C lib/repo.js:36-48,25]` — **and
the `merge-tree --write-tree` / `commit-tree` replay of case 2, with the
`git --version` arm that turns case 2 off below 2.38**) ·
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
`[C hooks/common.js:26-50]`, plus the recovery pointer written to this member's
shard before a re-root) · `monitors/heartbeat.js` · `bin/handshake.js`
(`branches`, `scan-allow`, and the overlap short form) ·
`hooks/pre-tool-use.js` (the per-session overlap dedupe) ·
`docs/SECURITY.md` (§13.6).

**Wire.** **V-D2** for 2(a) — a proposed Appendix B v1.1 delta on `[P§3.2]`, not
a catalog amendment (§2.3). **None** for 2(b): `branch` already exists on the
presence body `[C docs/PROTOCOL.md:295]`.

**Tests.** **The re-root, all three arms and the gate:** a merge-commit merge
makes the branch's commits ancestors of `refs/remotes/origin/<default>` and the
next beat resets the branch to that head with nothing lost; a **squash** merge
leaves them non-ancestors and **arm (b)'s `diff --quiet` recognises it with no
`gh` on `PATH` and a non-github.com remote** — the test that pins the
forge-agnostic half, and a second fixture in which the default branch has
advanced past the squash asserts arm (b) is **blind** and says so rather than
re-rooting wrongly; **arm (c) recognises a merged PR by ancestry** —
`merge-base --is-ancestor <headRefOid> refs/heads/handshake/<self>` — **in a
fixture where the branch has been pushed twice since the merge**, which is the
case the equality this replaces could never match; **a merged PR whose
`headRefOid` is not an ancestor of this branch re-roots nothing**, and one whose
sha this clone does not have (exit 128) re-roots nothing either. **The gate:** a
branch with no commits of its own re-roots nothing when somebody else's PR merges
— no push, no recovery pointer, no line — and a branch that has just been
re-rooted does not re-root again on the next beat when the default branch
advances. **Commits pushed after the merged head survive** — they are replayed
onto the new base and the branch continues, asserted by content and not only by
sha count. **The recovery pointer is written before the rewrite, not after**, and
`git branch <name> <sha>` from it restores the pre-re-root branch; **the recorded
base is updated in the same step**. **A re-root whose replay conflicts leaves the
branch untouched and renders one notice — and the assertion is over the working
tree as well as the ref**: `git rev-parse HEAD`, `git symbolic-ref HEAD`,
`git status --porcelain` and the absence of `.git/rebase-merge` are all checked,
because the ref-only form of this test passes while `git rebase` leaves conflict
markers in the human's checkout. **The same three checks are asserted on a
SUCCESSFUL case-2 replay**, on a clean tree, on a dirty tree and with an
untracked file colliding with a replayed path — the three states in which
`git rebase` was measured to move `HEAD`, detach it or refuse outright. **Below
git 2.38 case 2 refuses with its notice and case 1 still works.**
**A branch whose remote head is not the tool's recorded head is `paused`, pushes
nothing and re-roots nothing** — asserted on both rejections git produces there,
non-fast-forward for a plain push and *stale info* for the lease.
**A lease push against a ref the forge has deleted is a create, not a
rejection**: `ls-remote --exit-code` answers 2, the push carries no lease and no
force, and the recorded head is updated so the next beat's lease push succeeds —
the arm D1 rule 1 gained at the second-look round, and the one that otherwise
makes *"stale info"* permanent on the default GitHub and GitLab setting. **A member's second concurrent claim commits to the same
branch as the first, and neither claim's live view stops** — the row the old
one-active-branch rule needed a notice for. A commit containing a value from a local `.env` is refused, and nothing
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
force-push on any ref other than `refs/heads/handshake/<self>` is refused with no
git process spawned, and bare `--force` is never emitted on any path** — ruling
D1 rule 3, asserted on `handshake/state` and on the default branch by name.
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
A **member id** containing `../`, a device name, a `refs/` prefix, a trailing
`.lock` or the literal `state`
is refused or sanitized to something **`git check-ref-format --branch`** accepts,
and nothing traverses.

**`[skip ci]` on every work-branch commit**, asserted on the first commit of a
claim, on a later beat, and on the replayed commits a re-root produces —
`commit-tree` writes the message on all three paths and a marker missing from one
of them is a bill on one of them.

**The three visibility rules of §4.4, at this stage's own surfaces.**
**Rule 1:** `handshake branches` carries the same always-populated `push:` line
as `status` — **this stage's ten-word vocabulary, three of which it adds**
(§4.4 rule 1: `refused — secret scan, <file>`, `no recorded lease`,
`paused — remote head is not the one this tool pushed`), each reachable by a test
here — plus `N commits not in main, X days old` **for this member's own branch**,
plus one line for the state branch — `handshake/state — 41k commits, ~9 MB. Safe
to delete: git push origin --delete handshake/state` — because months in, a slow
clone is a real cost (§12.1) and nobody can point at why.

**And the peer's branch gets the line the committed slice can actually compute,
which is not the same line — corrected at the second-look round (G2-8).** The own
line is derived locally against `refs/remotes/origin/<default>`:
`git rev-list --count` and `git log -1 --format=%ci` over commits this clone
already has. **The peer's are not in this clone.** Verified: after the exact
refspec fetch §10.1 rule 1 specifies, `git ls-remote --heads origin
refs/heads/handshake/<peer>` returns a **sha and nothing else** — `git cat-file
-e` on it reports the object absent, `rev-list --count` exits 128 and
`git log -1` fails on a bad object — so neither the count nor the age is
derivable, and getting them means fetching the peer's objects, which §4.1 puts
inside the G1 row. So the committed slice prints what it can prove:
`alex: work branch present at 4f2a1c8 — commit count and age need the peer's
objects (fetch gated, G1)`, or `alex: no work branch yet`, both from the same
`ls-remote` the state-branch check already makes and therefore free. This is
rule 3 doing its job rather than rule 1 failing at it: the number a human acts on
is the number for **their own** unmerged work, on their own machine, which is
also what §12.1's answer to the branch-sprawl ask actually needs. The alternative
— a counting-only peer-branch fetch, carved out of §4.1's G1 row on the ground
that counting is not building — is recorded in §14 item 6 rather than taken,
because it imports a peer-branch fetch, the receive-boundary branch validation it
needs (Appendix G1 mechanism 1) and a §2.5 row into a slice the owner asked to
make smaller. **A branch with an open
PR says so and says that the head is a tool commit, so no checks will run until
the human pushes one of their own** (§4.2 item 4). **A work branch N commits
behind its recorded base renders one notice at a threshold**
(`work branch is 12 commits behind its base — restack before the PR`), because
§10.2's distance calculation living only inside a command nobody runs is the same
silence as not computing it. **Rule 2:** the scan refusal contains
`handshake scan-allow <finding-id>`, the file, and — for a tripwire hit — the
local secret file the value came from; `scan-allow` itself refuses `--yes`,
refuses from a proven child, requires a typed confirmation, and records the
adjudication per workspace. **Rule 3:** `handshake branches` prints
`bob: no state branch on the remote — not enabled yet`,
`peer alex: no symbols (older plugin)`, the peer's work-branch line above, and —
on a remote where arm (c) cannot run — `re-root: partial — no GitHub remote; a
squash merge is detected only while the default branch has not moved past it`
and, below git 2.38, `re-root: case 2 off — git 2.34 (needs 2.38)`. All derived
locally, none announced by the peer, and each asserted to be **absent** when the
asymmetry is not there.

**And the overlap warning stops repeating itself** **[proposed]**. The gate fires
per write with no per-session dedupe `[C hooks/pre-tool-use.js:51-72]`, so a full
day inside one peer-claimed file is the same three-line warning on every Edit,
and symbols make the line longer rather than rarer. **After the first warning for
a given file and peer claim in a session, the gate drops to a one-line short
form** — `handshake: still inside alex's claim on <file>` — with the verdict, the
policy and the escaping unchanged: it still warns, it never blocks, and the full
framed form still renders the first time. A warning the model has learned to skip
is worse than no warning, which is §5.3's own argument turned on the frequency
rather than on the accuracy.

**Tier: Opus xhigh, with a 3× adversarial fan-out on the scan.** This is a
security control on an automatic path, and `[SEC§4]`'s own lesson is that *"a
denylist is only as good as its last adversarial review."* Stage 2(a) keeps its
own **Opus high** above, and **the SKILL.md text is Opus xhigh** wherever in this
stage it is written, which is M7's tier for M7's reason.

### 10.3 Stage 3 — Gate and release

**Why it is a stage and not a footnote.** The first draft's V9 and V10 were two
rows on the end of a task table with no section of their own, on the argument
that they carry no new design. That is true and it is the wrong conclusion: a
stage that ships without a security pass and without documentation is a stage
that shipped neither, and the two rungs the owner most reliably loses to a
deadline are the two that have no feature in them. **Adding them remains this
plan's choice rather than decision 10's** — decision 10's order ends at the
learning records — so it stays **[proposed]** (§14 item 28), now scoped to the
committed slice.

**Delivers.**

- **`SECURITY.md` consolidation** — §13.6's table, restricted to what the
  committed slice actually built: **§4** gains the commit scanner's own honest
  contract (a second caller, a different battery, four named exclusions, and
  `scan-allow` as a human-adjudicated value allowlist that is not an override on
  the gate); **§6** gains ruling D2 (private-repo-only by default, the printed
  verdict, the three-way refusal, the typed and recorded override); **§3.1** gains
  the sentence that the automated push means *the tool* can put content in the
  repo, so the holder-set list `[C docs/SECURITY.md:138-152]` now covers material
  no human reviewed before it landed; **§1.2** is re-stated — a malicious current
  member stays out of scope, and this stage widens what such a member can do.
  **§5's inbound rule is written only if G1 ships**, because a normative
  paragraph about fetching a peer's work branch, in a release where nothing
  fetches one, is exactly the advertising of unbuilt features
  `[C docs/PROTOCOL.md:7-8]` forbids.
- **The red team, over what exists.** The scan's 3× adversarial fan-out, run
  against the battery, the four exclusions, the tripwire needle filter **and
  `scan-allow`'s own surface** — an allowlist entry is a hole a human punched, so
  the corpus must include one being reached by something other than that human.
  The exfil corpus against an automated commit, **against a commit message and
  against a branch name** (D2's coverage rule). A **member-id** corpus:
  `alex.lock`, an id sanitizing to `state`, `../`, a device name, a `refs/`
  prefix. Impersonation on ntfy. **The fetched-content corpus — a hostile peer
  work branch, instruction files at any depth, `.mcp.json`, `AGENTS.md`,
  `.husky/**`, a poisoned lockfile, a workflow on any forge, a symlink / gitlink /
  exec-bit change on an allowed path — is in scope ONLY when G1 has shipped**, and
  is listed in Appendix G1 rather than here for exactly the reason above.
- **README / INSTALL / release.** The floor stated in the same register as the
  features (§12.7), and the shipped-doc changes Stage 1 and Stage 2 each already
  own re-read as one voice rather than three accretions: the branch model, the
  commit cadence, `[skip ci]`, *"never pull `handshake/<you>` into a checkout
  you care about"*, the local-refs clause of §4.1 — **and the `push:` field of
  §4.4 rule 1 with its ten values**, so a human who sees a branch not moving can
  map it to a line the docs explain (§14 item 47). Ten and not nine: the
  vocabulary is per stage, and the committed slice reaches all ten by the end of
  Stage 2 (§4.4 rule 1), so the shipped docs describe the whole set rather than
  Stage 1's seven.

**Touches.** `docs/SECURITY.md` · `README.md` · `docs/INSTALL.md` ·
`skills/handshake-coordination/SKILL.md` (the final ceiling check) · the release
gate of `[PLAN§8]`, untouched in content.

**Tests.** The red-team corpora above, each as a fixture. **The `SKILL.md`
ceiling is checked once more at the end**, because a ceiling checked only inside
the stages is a ceiling the release discovers. **No document, command output or
release note says the scan *prevents*, *guarantees* or *ensures*** — §12.7's
first bullet, as a grep over the shipped text, which is the cheapest way to keep
an overclaim from surviving a rewrite.

**The three visibility rules of §4.4, at this stage's own surfaces.** This stage
ships text rather than commands, so its assertions are over the text.
**Rule 1:** `README.md`, `docs/INSTALL.md` and the release note name the `push:`
field and its closed ten-word vocabulary, and a grep over the shipped text
asserts that no sentence describes an automated action — a commit, a push, a
re-root, a refusal — without naming the line it leaves. A documented action with
no stated surface is exactly the silence §4.4 closes, and the release is the
last place it can be caught before a reader believes it. **Rule 2:** every
refusal string the committed slice can print, collected from Stage 1's and
Stage 2's own tests into one fixture, is asserted to contain a command, a file
or a setting — so a refusal reworded during the documentation pass cannot quietly
lose its next move. **Rule 3:** the shipped docs state the derived-asymmetry
lines *as derived* — a peer with no state branch on the remote, a peer whose
claims carry no `symbols` — and a grep asserts that no shipped sentence promises
a line the peer announces, which is §4.2 item 3's no-announce rule held in the
documentation as well as in the code.

**Tier: Opus xhigh with a 3× adversarial fan-out** for the security pass — M13's
shape — and **Sonnet medium draft, Opus high polish** for the documentation and
release, which is M14's `[PLAN§5]`.

### 10.4 The run — two humans, two machines, one working day

**Where it sits, and why that moved.** Decision 10 puts the two-human run **after
the first autonomy slice** so that it tests the new model early. That is a change
of aim from `[COBUILD-PLAN §2.1]` rung 2, which put M12(b) after the knowledge
layer to measure zero-setup volume and relay-deployment friction. Both aims ride
one calendar event: the run still measures the ntfy day-long volume that decides
whether zero-setup stays the default rung `[P§9.3]` `[PLAN§7]`, and it now also
answers the questions only Stages 1 and 2 can raise. **It runs after Stage 2
rather than after Stage 1**, because the simplification made the live view part of
the committed slice — running before it would leave the loudest thing the pair
experiences unmeasured, and it is the thing Appendix G's triggers are read from.

**What the run can measure.** The first draft anchored the **secret-scan
false-positive rate** here and it could not be measured: the scan was a later
rung, and the state branch's automated commits carry already-filtered shard text
`[C lib/workspace-files.js:365]`, not code diffs. Under the new order the scan
ships in Stage 2, **so the run does measure it** — which is one of the things
the simplification bought, and §12.2's trigger is re-anchored to the run
accordingly (§14 item 14).

**The nine questions, and every one of them is a §12 risk or an Appendix G
trigger:**

1. **Does a commit-per-minute branch feel like noise to a human** (§12.1)?
2. **Does the one-branch state-branch concurrency protocol hold** — how often is
   a push rejected non-fast-forward, and does the rebuild loop converge (§10.1)?
   This is the number that decides §14 item 29.
3. **Does the read half deliver** — does an absent peer's SessionStart actually
   carry the other side's week (§11.2)?
4. **What is the commit scanner's real false-positive rate on a working tree**,
   and how often does a human reach for `scan-allow` (§12.2, §14 item 14)?
5. **Does the branch model hold at three refs**, and does the re-root fire on
   both merge shapes without losing a commit (§10.2)? **And on the pair's own
   forge**: if it is not github.com, arm (c) never runs, so the run records
   whether arms (a) and (b) alone re-rooted every merge the pair made — and if
   the pair squash-merges and the default branch moves on within the same beat,
   whether the branch was left replaying merged work.
6. **Does `[skip ci]` actually suppress the runs on the pair's own forge**, and
   does a PR from a work branch showing no checks read as broken or as expected
   (§12.5)?
7. **G1's trigger: how often did a same-symbol collision actually block work?**
8. **G2's trigger: did a true requirements contradiction occur at all?**
9. **G3's and G4's triggers: how many narrow opt-ins are there by the end of the
   day, and is there a corpus of coordination outcomes worth ranking?**

**The entry triggers for Appendix G, recorded here because this is where they are
read.** Each is written as *build only if the run shows …*: the first draft
assumed the rung and asked what would remove it, and the owner's direction of
2026-09-02 reverses the burden. **G2's, G3's and G4's conditions invert material
the first draft already carried; G1's is this plan's own**, because the first
draft wrote no cut trigger for stacking at all (Appendix G's preamble, §14
item 52). The thresholds are **[proposed]** and the
appendix carries each one beside the rung it gates:

| Rung | Entry trigger — build only if the run shows … |
|---|---|
| **G1** stacking and sequencing | same-symbol collisions **blocked real work more than [proposed: 3] times** across the working day — a collision that the pair worked around without noticing is not evidence for a protocol |
| **G2** the contradiction protocol | **at least one true requirements conflict occurred** — two halves needing incompatible values of one named thing, not a textual conflict, which §5.4's discriminator already routes elsewhere |
| **G3** the trusted-pair capability table | **more than one narrow opt-in exists** by the end of the committed slice. Today there is exactly one (`pair --state-branch`), and a capability screen generalizing a single row is a screen |
| **G4** coordination-outcome records | **there is a corpus to rank** — the conflicts of question 7 and 8 actually happened and were resolved, so there is something to record and something a later session could be told |

**Delivers.** `[PLAN§5 M12(b)]`'s manual leg, run over Stages 1 and 2: two
accounts, two machines, one repo, one working day. Plus the knowledge layer's own
acceptance `[KNOWLEDGE §10.1]`, which is free to ride the same run. **Plus one
written verdict per Appendix G trigger** — fired or not fired, with the number
that decided it — because a gate whose reading is nobody's deliverable is a gate
that gets waved through.

**Touches.** No product code. A checklist, and the captured artifacts:
`knowledge.json`, the session-keyed sentinel, the state branch's reflog, the
count of rejected-and-rebuilt pushes, the scan's attempt / refusal /
adjudication counters, the re-root events, the per-beat timings of §2.5, and
**`git count-objects -vH` before and after the working day**,
which is what turns §12.1's state-branch growth residual from arithmetic into a
number.

**Tier: human + Opus high**, to write the checklist and read the result.
`[PLAN§5 M12]`'s split.

### 10.5 The task table, and where the other slices sit

**Committed — four rows, and the whole of what this plan asks the owner to
ratify a build for.**

| # | Task | Model / effort |
|---|---|---|
| **Stage 1** | **Durability.** Orphan `handshake/state`, **temp-index write path**, **the one-branch concurrency protocol**, author/committer split, **`[skip ci]` on every commit**, ≤ 1/min batch on the monitor clock, deferred push with `rejected` / `offline` / `deferred` arms, **the read half — fetch + `ref`-threaded scan + `readShardFromRef`**, the SessionEnd flush and its late-not-lost recovery, the opt-in gate as **`handshake pair --state-branch`** with D2's verdict and its three-way refusal, **the three preflight preconditions (visibility, non-interactive push, `commit.gpgsign`) plus the two `[skip ci]` warnings**, the `push:` line in `status` **at this stage's seven values**, and the shipped text this stage makes true — INSTALL, `USAGE`, the cloner README **with the remote-versus-local refs clause**, the `scrub` message **and the refs it lists, both copies of each**, SKILL.md line 275. **Both fetches carry two refspecs** — the state ref and the default branch's tip — so §10.2's ancestry arm and its counters read `refs/remotes/origin/<default>` rather than a ref only a human's `git pull` moves | Opus **xhigh** |
| **Stage 2** | **The live view.** (a) Declared symbols: **V-D2** with its carriage and harvest rules, the tail-only `details[]` entry, the gate line's full symbol, **the eight-kind notice rank + the `+N ! <kind>` marker**, SKILL.md within its ceiling. (b) **One work branch per member, `handshake/<member>`, reused across claims**, claim-`files[]` only, `HEAD` never moves, the member-segment ref-name sanitizer, the recorded base, **the re-root after merge — its gate, its three detection arms, its checkout-free `merge-tree`/`commit-tree` replay with the git 2.38 arm on case 2, and the recovery pointer**, ruling D1's lease-protected push **fail-closed with no recorded head and with the create arm for a ref the forge deleted**, **`[skip ci]`**, the fail-closed commit secret scan (**its own caller, code-shaped battery, four named exclusions, the tripwire needle filter, D2's coverage rule**) **with `handshake scan-allow`**, `handshake branches`, the overlap short form; **re-measure the block (gate)** | Opus **xhigh**, 3× adversarial fan-out on the scan; Opus high for (a) |
| **The run** | Two humans, two accounts, two machines, one repo, one working day, over Stages 1 and 2 — `[PLAN§5 M12(b)]` re-aimed, carrying `[KNOWLEDGE §10.1]` on the same calendar event, and producing **one written verdict per Appendix G entry trigger** | human + Opus high |
| **Stage 3** | **Gate and release.** SECURITY.md consolidation for the committed slice (§13.6); the red team — the scan's 3× fan-out including `scan-allow`'s own surface, the exfil corpus against a commit, a commit message and a branch name, the member-id corpus (`alex.lock`, an id sanitizing to `state`), impersonation on ntfy; **the fetched-content corpus only if G1 shipped**; README / INSTALL / release with the floor stated in the same register as the features (§12.7) | Opus **xhigh**, 3× fan-out for the security pass; Sonnet medium draft + Opus high polish for the docs |

**Order: Stage 1 → Stage 2 → the run (gate) → Stage 3**, and then Appendix G only
where the run's verdict says so. Tests, builds and E2E runs are local, no model
`[PLAN§5]`. Stage 2's two halves may not be measured separately — (b)'s card
arithmetic sits on top of (a)'s, so the re-measurement gate is checked once, at
the end of the stage.

**Gated — in Appendix G, each behind the entry trigger §10.4 records.** These are
**not** in the build order. They are designed, costed and tested in full in the
appendix, and none of them is started unless the run produced the finding its
trigger names.

| # | Task | Trigger read at | Model / effort |
|---|---|---|---|
| **G1** | Stacking and sequencing — `ls-remote` derivation, per-leg peer-branch validation, namespaced fetch, the locally derived path allowlist + `git diff --raw` mode rule + instruction/build floor, the throwaway worktree, the `merge-tree` probe behind a **git 2.38 precondition that becomes G1's own**, the instability counter, the ordering rule, stack invalidation, the three-trigger resume, the `worktree remove --force` + `prune` sweep, the stack detail | the run | Opus high; Opus **xhigh** for SKILL.md and for the inbound guardrail |
| **G2** | The contradiction protocol — **V-D3**, bounded rounds, escalation with both reasons, `handshake contested`; **also blocked on `[COBUILD-PLAN §3.S2]`** | the run | Opus **xhigh** |
| **G3** | The trusted-pair capability table — `handshake pair`'s three modes, the persisted per-peer grant, the migration, the permanently empty `note.*` row | the run | Opus **xhigh** |
| **G4** | Coordination-outcome records — one `SHARD_KINDS` entry, the scan's kind list, the two measurements | the run | Opus high |

**One gate crosses every stage and every gated rung: the `SKILL.md` ceiling of
§2.4.** Stage 2, G1, G2, G3 and G4 all edit that file, and nothing ships if it
crosses 480 lines. It is checked at the end of each of them, not once at the end,
because a ceiling checked once is a ceiling the fourth rung discovers.

**Where the other slices now sit.**

- **`KNOWLEDGE` K3–K6 continue, unchanged and independent.** K0–K2 shipped at
  `b6b3dca`; K3 (`handshake learned`), K4 (SKILL.md), K5 (SECURITY + red team, a
  gate) and K6 (docs/release) are unaffected by anything here and may run in
  parallel with Stages 1 and 2 `[KNOWLEDGE §9.1]`. G4, if it is ever entered,
  extends K1's scan rather than replacing it — the scan already takes its kinds
  as a parameter `[C lib/shard-scan.js:67,161]`, which is the generic shape
  `[KNOWLEDGE §9.K1]` promised and delivered.
- **`COBUILD` S0–S6 are no longer on this plan's critical path at all.**
  `[COBUILD-PLAN §2.1]` ordered the project knowledge → M12(b) → co-build →
  delegation. M12(b) is now the run and is re-aimed; co-build's internal order
  (S0 → S1 → S2 → {S3a, S3b} → S4 → S5 → S6) is **unchanged in content and in
  sequence**, and S0's ratification of E1–E3 is a dependency of **G2**, which is
  gated — so where the first draft made co-build blocking for a committed rung,
  it is now blocking only for an optional one. Nothing inside
  `[COBUILD-PLAN §3]` changes.
- **`DELEGATION` is superseded in one respect and unchanged in the rest** — §13.4,
  and the supersession itself now rides G3's gated table rather than a committed
  rung.

---

## 11. Acceptance

`[PLAN§6]` / `[KNOWLEDGE §10]` style. Two humans, two accounts, two machines, one
repo. Alex and Bob. Run the relay leg, then the ntfy leg with its documented
advisory semantics `[P§5.5]`. **No command is typed to cause coordination**; the
only typing is each human's one-time `handshake pair --state-branch` and their
ordinary work.

**Three scenarios are committed and three are gated.** §11.1 (coexist by symbol),
§11.2 (the absent peer) and §11.3 (the security assertions) are the acceptance
criteria for Stages 1–3 and are asserted here. The stack scenario and the two
contradiction scenarios **moved to Appendix G, each beside the rung it accepts**
— an acceptance scenario for a rung nobody has been told to build is a test that
cannot fail, and keeping it in §11 would have made the committed slice look
larger than it is. Nothing was cut: both contradiction narratives and the stack
narrative are in the appendix in full, with their per-leg expected results.

**Two scoping clauses, both added at the revision, because the first draft's
pass criteria were unachievable as written on one of the two legs.**

1. **"No command is typed to cause coordination" is scoped by §3's turn-scoping
   law.** It means no coordination *command*; it does not mean a Claude acts
   while nobody is at the keyboard. Every autonomous step below happens at a
   model turn in a session that is running.
2. **Expected results are stated per leg wherever the two differ.** Two of those
   differences change a **pass criterion**: the contradiction protocol (now in
   Appendix G2)
   and the security assertions of §11.3, where `from` is server-authoritative on
   the relay and self-declared on ntfy — which is why the peer-branch check keys
   on a different id on each leg (Appendix G1 mechanism 1) and why a per-peer grant is enforceable
   on one and advisory on the other (§9). **One changes only what is rendered,
   not what either leg must achieve**: §11.2's `· older chatter gone`
   `[C hooks/render.js:70]`, asserted on the ntfy leg and absent on the relay.
   *(Fix round 3: that clause read "and no criterion", which the line's own home
   falsifies — it sits inside §11.2's **Asserted** paragraph, where this
   document's pass criteria live, so it is a per-leg criterion. What it is not
   is a criterion about what either leg must **achieve**, which is the
   distinction the other two carry and the one the scope was reaching for.)*
   On the first: `task.seam{contract}`
   materializes automatically **iff** the transport is authenticated, and on ntfy
   each inbound revision waits on `handshake seam pull <id>` and a typed
   confirmation `[COBUILD §2.6]` — a control this plan reuses **unchanged** and
   deliberately does not weaken. So Appendix G2's two scenarios assert *zero human
   turns* on
   the relay and *one confirmation per inbound revision per receiving side* on
   ntfy. Asserting zero on both would have produced either a false failure verdict
   at G2 or, worse, an implementer removing the gate to make the test pass. §12.7
   states the consequence: **autonomous contradiction resolution is a relay-tier
   capability.**

3. **A third clause, added by the simplification: the three visibility rules of
   §4.4 are pass criteria on every scenario below, not only on the stage that
   introduces them.** A scenario in which the right thing happens and nothing says
   so does not pass. §11.1, §11.2 and §11.3 each carry their own line for it.

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
being made, which is what §10.2's "must not be allowed to rot" language exists to
prevent. A control run with `symbols`
absent produces the same gate and a vaguer line — the difference is the rendered
fact, not the verdict.

**And §4.4 in this scenario.** **Rule 1:** both branches are moving and both
`push:` lines say `pushing`; the re-root has not fired and nothing claims it has.
**Rule 2:** nothing was refused, so nothing is asserted about a refusal here —
which is the point of asserting the rule per scenario rather than once.
**Rule 3:** because both sides opted in and both declared symbols, `status` and
`handshake branches` print **no** asymmetry line — the negative assertion, and
the one that stops rule 3's lines from rotting into decoration that is always
there. **The second and later writes into the same file render the short form**
(`handshake: still inside bob's claim on src/api/handler.ts`), and the first
renders the full framed line: the day-long version of this scenario is where
that matters, and a scenario that only ever writes once would never have caught
it.

### 11.2 The absent peer, served by the state branch

**Setup.** Bob shuts his laptop on Thursday and returns the following Wednesday —
six days, past ntfy's ~12 h cache `[P§9.3]` and at the edge of the relay's 7-day
window `[P§9.2]`. Alex works through it.

**What each Claude does.** Alex's Claude keeps committing to `handshake/state`
every minute and to `handshake/alex` — the one branch, across however many claims
Alex worked through in six days — as it works. On Wednesday Bob
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
is a Stage 1 failure, not an acceptance result, and the distinction is recorded in
the run notes with `knowledge.json` captured alongside — the rule
`[KNOWLEDGE §10.1]` established.

**And §4.4 in this scenario, which is where rule 3 earns its keep.** Bob has been
away for six days; **`handshake branches` tells him whether Alex has a work
branch at all and says plainly what it cannot tell him about it** —
`alex: work branch present at 4f2a1c8 — commit count and age need the peer's
objects (fetch gated, G1)`, or `alex: no work branch yet`. **Corrected at the
second-look round (G2-8): the earlier form of this assertion was
`alex: 41 commits not in main, 6 days old`, and nothing in the committed slice
can produce it.** Bob's clone holds Alex's *sha* — `ls-remote` returns one — and
not Alex's *objects*: verified, `rev-list --count` over that sha exits 128 and
`git log -1` fails on a bad object, so a count and an age need a fetch of the
peer's branch, which §4.1 puts inside the G1 row. Bob's **own** branch keeps the
derived line, `you: 0 commits not in main`, because those objects are his.
**`status` prints the SessionStart fetch duration and
whether the scan came back `truncated`**, so Bob's slower first prompt has a
number beside it rather than a shrug. **If Alex never opted in, Bob's first
prompt says so** — `alex: no state branch on the remote — not enabled yet` —
which is the difference between *"the feature is broken"* and *"the other person
has not switched it on"*, and it is the whole reason rule 3 exists.

### 11.3 Security assertions, run on both legs

**The committed slice's assertions.** A commit containing a local secret is
refused and nothing is pushed
`[C lib/filter.js:226-249]`. **A commit *message* and a *branch name* carrying a
credential are refused the same way** (ruling D2). **A binary or non-UTF-8 file
is never auto-committed.** **`handshake scan-allow` refuses `--yes`, refuses from
a proven child, and an adjudicated value allows exactly that value and nothing
pattern-shaped** — the human-only property, pinned, because an allowlist a model
can reach is the bypass §12.2 rules out. A member id engineered to produce a
traversing branch
name is refused or sanitized to something `git check-ref-format --branch`
accepts, **and so are the two cases a filename sanitizer misses: a member id of
`alex.lock` and one that sanitizes to `state`** (§10.2). A public-repo verdict
refuses the guarded part and demands rotation `[SEC§6]`, **and under ruling D2
refuses the whole automated push path absent a recorded override** — **and the
`no_github_remote` arm records `unprovable` rather than an override, and does not
print the world-readable sentence** (§4.2 item 2). A peer's
`symbols` string never becomes a filesystem path.
**The force-push pattern is the control**: a force-push on any ref other than
`refs/heads/handshake/<self>` is refused with no git process spawned, asserted on
`handshake/state` and on the default branch by name, and **the re-root cannot
reach either of them**.

A spoofed `from` on the relay is refused at the
source `[C relay/src/do/workspace.js:599-605]` `[P§9.2]`; **on ntfy `from` is
self-declared and a per-peer grant is advisory there, which §9 states and this
run records rather than disproves.** A passive ntfy subscriber holding the topic
but not the secret learns no branch name — `branch` is in the encrypted body
`[C lib/envelope.js:37]`.

**And §4.4 in this scenario, which is the one place the rules are load-bearing
for safety rather than for comfort.** **Rule 1:** every refusal above is an
automated action that changed what the human will see, so each leaves its line
rather than silence — the scan refusal renders `push: refused — secret scan,
<file>` and the unproven arm renders `push: off — visibility unproven`, in
`status` and in `handshake branches`, asserted **in the same test that asserts
the refusal**. A control that stops a push and says nothing is indistinguishable
from a control that crashed, and the second is what a human will assume.
**Rule 2** is already the substance of two assertions above and is named here so
it is checked rather than assumed: the scan refusal carries
`handshake scan-allow <finding-id>`, the file, and the local secret file the
matched value came from; the `no_github_remote` arm carries *"visibility cannot
be proved for a non-github.com remote; confirm yourself that `<origin>` is
private"* — a next move — and never a bare `unprovable`. **Rule 3:** a leg whose
capability is off says so with its cause, derived locally — `push: off — gh
unauthenticated` on a machine with no authenticated `gh` — and a fully
configured leg prints none of these lines, the negative assertion again.

**The inbound corpus, and the `rationale` corpus, are in Appendix G with the
rungs that create their surfaces.** A peer branch is not fetched in the committed
slice, so the option-injection, path-allowlist, mode-rule and instruction-file
assertions belong to G1 and are stated there in full; a `rationale` does not
exist without G2, so the imperative-as-data and delimiter-breakout assertions
belong to G2. **Nothing was dropped, and Stage 3's red team is scoped to match**
(§10.3): asserting a control over a surface the release does not have would be
the same overclaim `[SEC§4]` forbids in prose.

---

## 12. Risks

**Five risks here, two in Appendix G.** §12.3 (rebase churn) moved to G1 and
§12.4 (escalation fatigue) to G2, each beside the rung whose mechanism it prices
— a risk section for a thing that does not exist prices nothing. **Their numbers
are left as gaps rather than closed up**, for the same reason §14's numbers are:
this document and its own revision record cite them, and a gap resolves where a
renumbering does not. What remains here is the risk list for the committed slice,
and §12.6 is the one the owner keeps flagging.

### 12.1 Autonomous-push noise

A commit per minute per member on a state branch, plus a work-branch commit per
meaningful edit, is a lot of git traffic in someone else's repository. Left
unmanaged it produces a reflog nobody can read, a notification stream nobody
wants, and a `git branch -r` listing that grows without bound.

**What the plan builds:** the state branch is **orphan**, so it never appears in
`git log` of any branch a human works on (§4.3); the batch is ≤ 1/min on the
monitor's own clock, never on tool cadence `[P§8]`; **no commit the tool makes
runs CI on either forge, unconditionally and with no precondition to satisfy**
(§4.2 item 4) — the corrected form of a claim the first draft made
unconditionally and then had to qualify twice; **the ref count is bounded by
construction at members + 1** (§4.1, §10.2); **the re-root keeps the live view
from replaying merged work**; and the run measures what a human actually feels,
now over the live view as well as the state branch.

**What it does not build:** an
automatic branch cleanup — deleting a branch is a destructive operation and is
above the floor (§4.1), and ruling D1's carve-out is a **rewrite** of the tool's
own ref, not a deletion of anything.

**But the thing that used to accumulate no longer does, and the thing that does
accumulate is a different report.** The first draft created one branch per claim
and priced the result as *"stale work branches accumulate until a human prunes
them"* — twelve claims in a week, twelve refs, a `git branch -r` listing growing
without bound, and a plan that measured the growth and declined to stop it.
**With one branch per member there are members + 1 refs and there is nothing to
prune.** What accumulates instead is **unmerged work on a member's own branch**,
which is a fact about that person's week rather than about the tool, and it gets
the report it deserves: `handshake branches` prints
`you: 6 commits not in main, 9 days old` **for the branch whose objects this
clone has — the member's own — and the human decides.** The peer's branch gets
the line rule 3 allows (§10.2): present or absent, at which sha, and the plain
statement that counting it needs a fetch that is gated on G1. That is enough for
the ask this section answers — each person prunes, PRs or abandons their **own**
accumulation, on the machine where the objects are — and it is corrected here
from a per-member count the committed slice cannot compute (G2-8). The
tool still never deletes a branch; it no longer creates one it would want to.

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
re-rooting it or deleting it are all above the floor (§4.1) — the row this pass
added to the above-the-floor column so that a reader meeting the *work* branch's
re-root does not generalize it. Ruling D1's
carve-out is scoped to `refs/heads/handshake/<self>` and does not reach the state
branch. **A carve-out
for re-rooting the state branch is deliberately not proposed**: D1's reasoning
turned on the ref being tool-owned, unshared and advertised unstable, and this
one is none of those, so buying ~100 MB a year with a rewrite carve-out on a
shared ref is not a trade D1 supports. **The remedy is the human's, and the
protocol already supports it**: delete the remote ref, and §10.1 rule 2's
adopt-never-create restarts both sides cleanly on a fresh orphan root the next
time each proves it absent.

**So the human is told, rather than left to infer it from this document.**
`handshake branches` prints the state branch's own line —
`handshake/state — 41k commits, ~9 MB. Safe to delete:
git push origin --delete handshake/state` — beside the per-member lines, because
"months in, a clone is slow and nobody can point at why" is a failure of
reporting rather than of design. **The run is where the number becomes
real rather than synthetic:** §10.4 captures `git count-objects -vH` across the
working day beside the rejected-push count.

**The corrected claim matters because the failure it prevents is not degraded
coordination.** The first draft said *"CI is skipped on `handshake/*` so the noise
costs no minutes"* while specifying the skip as an edit to **this** repository's
workflow file. In a pair's repository where nobody installed it, roughly 480 state
pushes per member per working day meet a workflow with no branch filter — an
uncapped Actions bill and a saturated queue, starting at the first opt-in. The
second draft made it a precondition, which fixed the bill and cost the pair a
pull request in a repo they may not merge into. **`[skip ci]` fixes it at the
commit** (§4.2 item 4): nothing to configure, nothing to merge, and the bad state
no longer exists rather than being reported politely.

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
asserted: 66 non-fixture tracked files, zero findings** (§4.2 item 1), and Stage 2's
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
`lib/filter.js` — plus the second Stage 2 test that pins it by the false-positive
class it removes and the true positive it must not lose. **This repository is
not the case that matters**: it has no tracked or untracked config-shaped secret
file, so Stage 2's gate ships clean here as measured, and the first *other*
project is where the profile bites. The error direction is fail-closed throughout
— over-refusal, never a missed secret — so nothing unsafe ships either way, and
that is the whole of what the 66/0 number was ever evidence for.

**And the human's route out ships with the gate rather than behind the trigger.**
This section's own remedy — *a per-workspace allowlist of tripwire values a human
has adjudicated as non-secret* — was written as a contingency that fires when the
measured rate crosses a line. That is backwards, and the friction walk found it
from the chair: the rate is measured on a population of humans who, when the gate
said no, had **nothing to type**. So `handshake scan-allow <finding-id>` is in
Stage 2's Delivers (§4.2 item 1), the refusal prints it, and the trigger below
measures a rate that a human can already do something about.

**The cut trigger, restated against a scanner that can run** **[proposed]**:
**more than 1 refusal in 200 automated commits where a human, shown the finding,
says it was not a secret.** **It is anchored at the run**, which the
simplification made possible: the scan now ships in Stage 2, the run happens
after Stage 2, and the run's day of real diffs is the first population this rate
has ever had. (The first draft anchored it at the two-human run when the scan was
four rungs later — the automated commits available then carried already-filtered
shard text `[C lib/workspace-files.js:365]`, not code diffs — and the second
draft moved it to the scan's own rung, where there were no two humans. It now
sits where both halves exist at once.) **Stage 2's Delivers carries the counters
that make it measurable**: attempts, refusals, and one human-adjudication line
per refusal — and `scan-allow` is what produces that third number rather than a
tester's guess. **And the remedy is no longer "drop the entropy pass"**, because
the entropy pass is already excluded by design: if the tripwire's own rate
crosses the line, the narrowing is a **broader** allowlist policy on top of the
per-value one — never an `--ack` override on
the gate itself, which would put a model-reachable bypass on the only fail-closed
control in the design.

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

**What the plan builds, and it is now one thing instead of three:** **`[skip ci]`
in the message of every commit the tool writes** — §4.2 item 4 carries the
mechanism, the vendor verification, the literal and what it buys. Both doors
close at once, the `push` trigger and `pull_request`'s `synchronize`. The two
mechanisms it replaces are named here so the trade is visible: a
`branches-ignore` filter, which required an edit in a repository the tool may not
write to and which left `synchronize` open; and the PR-open push suspension,
which closed `synchronize` by **freezing the live view** at the moment two people
were most likely to be watching it. Both are removed. **One run per merged claim
remains:** the push after a re-root carries the default branch's tip, a human
commit without the marker (§10.2 case 1), so a forge that runs `on: push` starts
one run on `handshake/<self>` per merge — at merge cadence, not push cadence —
and that is the whole of what the tool's pushes can start.

**The first residual, unchanged and intended:** a Claude's work branch is
never tested until a human pushes to it, which is a change in when breakage is
discovered. That is the intended trade — the branch is advertised as a **live
view**, broken is explicitly allowed, and the acceptance criterion is that nothing
downstream of the branch treats it as green. `handshake branches` labels every
work branch `untested` for exactly this reason. **The second residual, which
Appendix G1 states in full:** decision 4 named *branch CI passing* as one of the
three facts a stacking judgement reads, and this guardrail removes it. G1
replaces it with
a clean `merge-tree` probe plus successive `ls-remote` reads and says what that
does and does not buy; the opt-in lightweight per-branch job that would restore it
is gated item 23, deliberately not built before the run has measured what CI at
machine cadence actually costs.

**The third residual is new, and it is the price of the simpler mechanism.** **A
pull request opened from a work branch shows no checks at all** until a human
pushes a commit of their own, because its HEAD commit is a tool commit carrying
the marker. Under the old design the PR ran the full suite on opening and the
tool went quiet; under this one the tool keeps pushing and **nothing runs**. §4.2
item 4 carries the three things that make it livable — the `handshake branches`
line on a branch with an open PR, the opt-in sentence, and required checks on a
protected base branch left untouched. Merging is above the floor, so the last
gate before `main` stays exactly where it was.

**The fourth residual, stated rather than claimed away:** `[skip ci]` does not
reach a workflow triggered by **`pull_request_target`** (GitHub documents that
exception), and a forge that ignores the marker — or a GitLab project whose
pipeline execution policy overrides it — bills as before. The preflight **warns**
on both conditions it can read and does not refuse (§4.2 item 4). §12.7 carries
it as a residual and no document may report the cap as absolute.

### 12.6 Complexity — the one the owner keeps flagging

**This is the risk the owner named on 2026-09-02, and it is the one this pass
answers rather than mitigates.** *"This became so complex. We went from v2 to
v7."* Eight rungs, six concepts, three new verbs, five preconditions and twelve
branches at the end of a week is not a plan for a simple problem, however well
each piece is argued. The answer is not a better argument: it is **committing to
less**.

**What the committed slice costs, and every number is §2's recount.** **Three
concepts** (the state branch, the work branch, the declared symbol) against
`[KNOWLEDGE §8]`'s two and `[COBUILD §3]`'s two; **three user-met surfaces, two of
them met once or only at a refusal**; **three new verbs** (`pair
--state-branch`'s flag, `branches`, `scan-allow`) against a CLI at 26; **one**
proposed wire delta, `V-D2`, on an existing envelope-carried type; **zero** new
event types; **three refs**, forever; **three preconditions**, all local; **no**
CI configuration on either side.

**What holds it down beyond the count:** zero untrimmable per-turn
characters (§2.4); zero new state files on the hot path; the conflict cases reuse
the tiebreak, the overlap floor, the claims and the gate exactly as they are; and
**the four largest mechanisms in the design are not built** — they are specified,
costed, tested and gated in Appendix G, each behind an entry trigger the run
either fires or does not.

**Why gating is a stronger answer than cutting.** A cut design has to be
re-derived when the need turns up, usually by someone who was not in the room. A
gated one is written down, priced, and has a stated condition for being wanted —
so the owner is choosing between *build this now* and *build this if the day
shows it*, rather than between *build this* and *lose it*. Every one of G1–G4 was
argued for by a real case, and every one of them can wait for the case to appear.

**What would still make me cut**, written in advance so it is a rule — and
every rate below is **per pair**, for the reason Appendix G2's risk section
states:

- **G1–G4 are not cut; they are gated.** Where the first draft wrote a cut
  trigger, it is **inverted into an entry trigger** (§10.4), which is the same
  arithmetic read from the other end: the first draft asked *what would remove
  this rung*, and this one asks *what would earn it*. G2's, G3's and G4's
  conditions are the first draft's own material read that way; **G1 had no cut
  trigger** — nothing in the first draft would ever have removed stacking — so
  its threshold is this pass's own and carries **[proposed]** for that reason
  (Appendix G's preamble, §14 item 52).
- **Cut the symbol declaration to a single symbol, not a list** — if the run shows
  the model authoring long, low-quality lists. One good symbol beats sixteen
  guesses, and the field's cap makes the narrowing a one-line change.
- **Cut the re-root and let the human restack** — if the run shows the three
  detection arms disagreeing, or a squash-merge case none of them catches. The
  branch model survives without it; the live view is merely noisier at the start
  of the next claim. **This trigger is a hedge against a detector that
  misbehaves, and it is not where the two known holes live**: the second-look
  round closed both by construction rather than leaving them for the run — the
  ahead-of-merged-head case, which the old `headRefOid` equality could never
  match (§14 item 50, G2-3), and the forge without `gh`, which now has a local
  tree-equality arm and, past its window, a rule-3 line saying what is off
  (G2-4). A condition the text guarantees is a defect, not a run finding.
- **Never cut the guardrails of §4.2.** The fail-closed commit scan, the
  public-repo guard **with ruling D2's private-only default**, the two-sided
  opt-in and `[skip ci]` ship with Stages 1 and 2 or those stages do not ship —
  and the fifth, the untrusted-peer-tree rules, ships with G1 or G1 does not
  ship. A version that pushes before its boundary is the wrong feature, and a
  version that fetches without one is a worse one.
- **Never cut the three visibility rules of §4.4.** They are the owner's other
  ask, they cost one line of output each, and the failure they close is the one a
  walk through this plan kept finding.
- **Never cut the run.** Every risk above is measured there and nowhere else, and
  after this pass it is also the only thing that can open Appendix G.

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
  **And one surface a human deliberately un-scans:** a value a human adjudicated
  with `handshake scan-allow` stops being a needle for that workspace. That is
  the point of it, it is recorded, it is per value rather than per pattern, and
  it is reachable only by a typed confirmation from a non-child session — but it
  is a hole a human punched, it is listed here rather than in a footnote, and
  Stage 3's red team attacks it as a surface rather than treating it as a
  control.
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
  review in Stage 2 (3× fan-out) and again in Stage 3; the rotation runbook is in
  `SECURITY.md` `[SEC§7]`; the automated path runs on private repos only unless a
  human typed the override (§4.2 item 2); and **the private remote is the same
  trust boundary as workspace membership** — everyone who can read the leaked
  commit could already read the workspace. Bounded, not solved, and no document
  may say otherwise.
- **Not that CI cost is capped absolutely.** `[skip ci]` in every tool commit
  message suppresses `push`- and `pull_request`-triggered workflows on GitHub and
  GitLab (§4.2 item 4), and **two things escape it**: a workflow triggered by
  **`pull_request_target`**, which GitHub documents as the exception, and a forge
  — or a GitLab pipeline execution policy — that does not honour the marker at
  all. The preflight warns on both conditions it can read and does not refuse.
  There is no third mechanism behind this one: if the marker is ignored, the pair
  pays a run per tool push, and the remedy is theirs (a branch filter of their
  own, or not enabling the automated push). **And the flip side is a residual
  too:** a pull request opened from a work branch runs **no** checks until a human
  pushes to it, which §12.5 states in full and which no release note may describe
  as "CI runs on the PR".
- **Not that the re-root catches every merge on every forge** *(added at the
  second-look round)*. Arms (a) and (b) are local and run anywhere; arm (c) needs
  `gh` and a github.com remote. **What is left uncovered is one shape**: a
  **squash** merge on a non-GitHub forge where the tool pushed again, or the
  default branch advanced, before the next beat — arm (a) is blind to a squash by
  construction and arm (b) goes blind the moment the default branch moves past it
  (both measured, §10.2). The branch then keeps replaying merged work into the
  next claim's live view until a human restacks or opens the next PR from it.
  `handshake branches` says the capability is partial and why (§4.4 rule 3), the
  run records whether it actually happened (§10.4 question 5), and no document
  may say the re-root is unconditional. **And case 2 is off below git 2.38**,
  where the checkout-free replay's primitive does not exist — case 1 still
  re-roots, and the line says so.
- **Not that fetched peer code is contained** — **and this bullet is about G1, so
  it describes nothing the committed slice ships.** §4.2 item 5 admits the automatic
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
  floor, and the floor is a list, so it is a list that must be reviewed with G1
  like any other denylist `[SEC§4]`.
- **Not that autonomous contradiction resolution is available on both tiers** —
  **and, after this pass, not that it is available at all unless G2 is entered.**
  It is a **relay-tier capability**. On ntfy, `task.seam{contract}` is
  human-gated by `[COBUILD §2.6]`, a control this plan reuses unchanged, so a
  round runs at one confirmation per inbound revision per side (§6.4, §11
  preamble). Zero-setup remains the default tier, so for a pair that never
  deploys a relay, **§6 is a bounded, structured, human-paced exchange rather
  than an autonomous one** — which is a real limit on decision 1's promise. In the
  committed slice a requirements contradiction is carried by `note.blocker` and
  by two people talking, which is what it is carried by today.
- **Not that the committed slice delivers decision 1's whole promise.** *Two
  Claudes collaborating autonomously* is, in the committed slice, **durability
  plus a live view plus a narrower gate**: each side sees what the other holds,
  which symbols it holds, and its actual code, continuously and without a human
  relaying anything. What it does **not** do is build on the other's branch
  (G1), converge on a contested requirement (G2) or learn from either (G4). That
  is a smaller claim than §3's vision and it is stated here so no release note
  makes the larger one. The gap is not a design gap — it is four designs behind
  four triggers — but a user does not experience an appendix.
- **Not that a malicious peer is contained.** `[SEC§1.2]` places a malicious
  current member out of scope and this stage **widens what such a member can do**:
  they can now cause commits to appear on a branch in a repo you both share and
  can influence what your Claude builds on its own half, within the granted
  capabilities. That is stated in SECURITY.md at Stage 3 rather than left inferable,
  the way `[COBUILD §12]` states its own.
- **Not that the typed confirmation is proof of consent.** The model drives the
  terminal, and `ask()` branches on `!process.stdin.isTTY` and answers from piped
  stdin `[C bin/handshake.js:84,87-113]` — re-opened this pass, and it holds:
  `[COBUILD-PLAN §6.2]`'s wording is correct and MUST NOT be upgraded later. What
  the gate mechanically removes is the *automatic* action; the human supplies the
  one input no local check can — whether they were expecting this at all.
- **Not that any number here is measured.** The batch interval, the round bound,
  the instability counter, the rebuild bound, the SKILL.md ceiling, every timing
  in §2.5 and every rate in §12 are **reasoned, not measured**. The run is where that
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
  behaviours Appendix G1, §10.1 and §10.2 turn into rules — `merge-tree` clean where
  `rebase` conflicts, `apply --check --3way` exiting 0 on a real conflict,
  `update-index --add` refusing a deleted path, `--cacheinfo` demoting a mode,
  `ls-remote --exit-code` splitting absent from unreachable, and a `rm -rf`
  worktree staying registered. **Every one of those is a measurement of this
  repository, a fixture, or git — not of the world**, and none of them is a
  measurement of a pair at work, which is still the run's job alone.
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
the second half of the sentence exhaustive rather than aspirational: after Stage 1 the
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

**Re-aims one milestone:** `[PLAN§5 M12(b)]` becomes **the run** and happens after
Stage 2 instead of after the knowledge layer (§10.4). Its content is unchanged;
what it measures grows — and after the simplification pass it grows again, because
the scan and the live view now ship before it and **the four entry triggers of
Appendix G are read from its findings**. It is no longer only a measurement; it is
a gate on four rungs.

### 13.2 `COBUILD-PLAN.md`

**Keeps:** §3 entire — S0 through S6, unchanged in content and in internal order
`[COBUILD-PLAN §3.7]`. §6.1's cut rules. §7's ideas-worth-stealing, in particular
*"an orchestrator without authority"* and *"enforce late, at a boundary the work
must pass through"* — the second of which this stage now has a second instance of:
the commit is that boundary for the secret scan (§4.2 item 1), and the lesson to
resist making the PreToolUse gate block stands `[COBUILD-PLAN §7 item 1]`.

**Supersedes:** §2.1's project order. Rung 1 (the knowledge layer) shipped at
`b6b3dca`; rung 2 (M12(b)) becomes **the run** and is re-aimed; rung 3 (co-build)
becomes a dependency of **gated G2** rather than the next project item — so where
the first draft made co-build blocking for a committed rung, it is now blocking
only for an optional one, which is a weaker claim on `[COBUILD-PLAN]`'s order than
the first draft made. **Rung 4 is not touched by
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
the five arguments for it. This plan does not re-open that order; it adds that G2
depends on co-build's S0–S2 — and, after the simplification pass, G2 is itself
gated, so that dependency binds an optional rung rather than a committed one.

### 13.3 `COBUILD.md`

**Reuses, unchanged, as the seam machinery:** §2.1's consent-once criterion ·
§2.3's closed permission list · §2.4's never-authorizes list and the anti-creep
rule · §4.5's concurrent-revision comparator · §4.6's three local staleness
signals · §4.7's admission rule · §5.1's "ownership is already solved by claims" ·
§5.2's revision-is-a-question-with-a-default-answer, which is the single most
important thing this plan borrows · §5.3's `note.blocker` escape hatch ·
§5.4's derived-not-transmitted abandonment · §7.1's body schema · §7.2's
receiver-side authorization · §7.3's rendering discipline and budget arithmetic ·
§11's Appendix B rows E1–E3, which G2 depends on and does not modify.

**Changes exactly one thing:** §5's cut of *"a per-revision `note` explaining what
changed"* is re-opened, bounded to contested seams, at ≤ 280 chars, read-only,
proposal-affecting and never build-affecting (§6.5). `COBUILD.md` §5's cut list
gains that bounded exception with G2 so the two documents cannot contradict each
other.

**Extends, without amending:** §4.4's generate-your-own-stub discipline keeps its
force, and its residual drift risk shrinks because the peer's implementation is
now fetchable (§4.3).

### 13.4 `DELEGATION.md`

**Supersedes — but not yet, and that is new at the simplification pass.** §0 —
*"An offer is delivered by the machine. It is accepted only
by a human."* Consent-once replaces per-offer consent. An offer becomes a
structured `task.offer` that the peer's client **may** accept autonomously, and
the permission to do so is one row of the §9 capability table — **off by
default**, granted per peer, revocable instantly. **That row lives in gated G3,
so in the committed slice DELEGATION's §0 stands untouched**: nothing here accepts
an offer without a human, and the supersession takes effect only if G3 is
entered. Three of §0's four controls
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
parallel (§10.5). §2.2's rejection of a knowledge directory stands and is extended
to every record kind this stage adds — outcomes go on the shards for the same five
reasons. §3.2's hook-timing law — SessionStart is async and cannot inject, so it
writes and UserPromptSubmit injects, and the scan runs **before** the network sync
— is the law G4 obeys `[C hooks/hooks.json:9]` `[C hooks/session-start.js:64-80]`.
§7's token-cost register is the register §2.4 uses. §8's count format is the format
§2.1 and §2.2 use. §10.2's absent case is superseded in its conclusion, not in its
method: the durable path now answers where it previously depended on someone
having typed `handshake tasks` (§4.3, §11.2).

### 13.6 `SECURITY.md`

**Missing from the first draft's register, and it is the one document this stage
gives new content to rather than new citations of.** §12.7 already stated that
this stage widens what a malicious member can do and assigned the write-up to the
release rung;
what was absent is *what must change*, so a reader could not tell the omission
from a decision. Five items, with the stage that makes each — and **one of the
five is gated, which matters, because writing a normative paragraph about a
control the release does not ship would be the advertising of unbuilt features
`[C docs/PROTOCOL.md:7-8]` forbids**:

| What must change in `SECURITY.md` | Stage |
|---|---|
| **§4 gains the commit scanner's own honest contract** — a *second* caller with a *different* battery and four named exclusions, so a reader does not assume §4's message-path contract covers it. §4's *"a denylist is only as good as its last adversarial review"* applies to both. **Plus `handshake scan-allow`**: a human-adjudicated value allowlist, what it is not (an `--ack` on the gate), and that it is a surface a human deliberately un-scans | **Stage 2** ships it; **Stage 3** writes it |
| **§6 gains ruling D2**: automated push is private-repo-only by default; the opt-in prints the verdict; **the refusal branches in three arms and `unprovable` is not an override**; the override is typed and recorded | **Stage 1** ships it; **Stage 3** writes it |
| **§3.1 gains one sentence**: the automated push means *the tool* can put content in the repo, so the holder-set list `[C docs/SECURITY.md:138-152]` now applies to material no human reviewed before it landed | **Stage 3** |
| **§1.2 is re-stated, not amended**: a malicious current member stays out of scope, and this stage widens what such a member can do — commits on a shared branch, and influence over what the peer's Claude builds within the granted capabilities (§12.7) | **Stage 3** |
| **§5 gains the inbound rule**: a fetched peer work branch is untrusted data that can also execute — the §4.2 item 5 guardrails written normatively, as the extension of §5.4's *"`.handshake/*` files read from disk are untrusted data"* `[C docs/SECURITY.md:293-297]` to the one git path that rung adds | **GATED — G1** ships the control and a **later** documentation pass writes the section. Nothing in the committed release fetches a peer branch, so this paragraph does not exist in it |

`SECURITY.md` is also in Stage 2's Touches (and in G2's and G3's) for the
narrower edits each of those makes; **Stage 3 is where the four committed items
above become one coherent section rather than four accreted paragraphs**, which
is M13's shape (§10.3).

---

## 14. Proposed, not yet decided

Every choice this plan made that the discussion did not, collected so they can be
ratified in one pass. Nothing below is a decision of the owner's; each is the
plan's suggestion, marked where it appears.

**This table is now the COMMITTED SLICE ONLY, and that is the point of the
simplification pass.** Twenty-one rows moved into Appendix G's own *Proposed,
gated* list, where each is ratified — or refused — at the moment its rung is
entered rather than now; three rows were **deleted** because the simplification
made them moot (the CI branch filter, the one-active-work-branch rule, and the
PR-open push suspension); and eight rows are new. **The owner's ratification pass
therefore covers Stages 1–3 and nothing else**, which is a shorter pass over a
smaller commitment.

**Numbers are kept, not renumbered.** §15's revision record and a good deal of
this document cite these rows by number, so the gaps left by the moved and
deleted rows are deliberate: a gap resolves, a renumbering does not.

**Rulings D1 and D2 are deliberately absent from this table.** They are the
owner's, settled 2026-09-02, and they enter the plan as decisions (§1, §4.1,
§4.2). Ratifying §14 does not ratify them and cannot un-ratify them. **The three
asks of 2026-09-02 are absent for the same reason** — less complexity, one work
branch per member, less friction are owner direction, recorded in §15; what is
`[proposed]` is how this plan discharges each of them, and those are rows 45–52.

**Rows rewritten or withdrawn at the revision are marked so**, because §14 is only
an instrument if a reader can tell a row that changed value from one that did not.
**Rows 41 and 42 were added in fix round 1**, both for the same reason: a choice
was marked `[proposed]` inline, or made silently, without a row here — and a
`[proposed]` marker with nothing to ratify is a marker that does nothing.
**Row 43 was added at fix round 3**, for the same reason again, and
**rows 9, 39, 40 and 41 were rewritten there** — each marked inside
its own row with what changed and why. **Rows 45–52 are new at the simplification
pass**, and rows 1, 2, 14, 17, 28 and 43 were rewritten there.
**Rows 6, 41, 43, 47, 48 and 50 were rewritten at the second-look round**, each
marked inside its own row with what changed — no row was added there, because
every one of that round's findings landed inside a choice this table already
asks the owner to ratify.

| # | Item | Where | Suggested value |
|---|---|---|---|
| 1 | What `handshake/state` carries — **rewritten at the revision**: "the directory" became an explicit allowlist, because `.handshake/secret.json` is the one file in that directory that must never be committed | §4.3, §10.1 | orphan branch, and an **enumerated path allowlist** — `.handshake/tasks/<shardFileName(self)>` only, derived and never accepted `[C lib/workspace-files.js:292-298]`; anything unnamed is not committed |
| 2 | Work-branch name shape — **rewritten twice**: at the revision because a filename sanitizer is not a ref-name sanitizer, and at the simplification pass because the per-claim shape is gone. **The old value — `handshake/<member>/<subject_key>`, one ref per claim — is moot and is not what this row now asks the owner to ratify.** The branch model itself (one branch per member) is owner direction, §15, not a proposal | §4.1, §10.2 | `handshake/<member>`, **one stable ref per member, reused across every claim**, sanitized by a **ref-name** rule of its own applied to the **member segment only** — strip a trailing `.lock`, reject a leading `.`, keep the character-class and length rules, **reserve `state`** (now a *direct* collision with `refs/heads/handshake/state`, not a prefix one) — and validated with `git check-ref-format --branch`. The subject component, and with it the traversal corpus it carried, is deleted |
| 3 | ~~Commit-scan windowing~~ — **WITHDRAWN at the revision.** Windows existed only to get past `check()`'s `MAX_BYTES` `[C lib/filter.js:22,255]`; the scanner is now its own caller and does not go through `check()` | §4.2 item 1 | no windowing; **the four named exclusions and the code-shaped battery replace it** |
| 5 | Verb name — the opt-in gate — **rewritten at the simplification pass**: the verb exists in the committed slice with exactly one mode, and the capability screen that would have justified the bare noun is gated (G3) | §2.2, §4.2 item 3, §9, §10.1 | `handshake pair --state-branch`, human-only, `join`-shaped; the bare `handshake pair` with its show/grant/revoke modes arrives with G3 or not at all |
| 6 | Verb name — the branch view. **Rewritten at the second-look round (G2-8)**: the per-member count was a line the committed slice cannot compute, and the row now carries the choice that replaces it *and* the alternative it declines | §2.2, §10.2, §11.2, §12.1 | `handshake branches` — and it is where most of §4.4 lands: the `push:` line (**ten values, owned per stage**), the derived asymmetry lines, the state branch's commit count and size with its delete command, and the open-PR/no-checks line. **The distance numbers split by whose objects this clone has:** `N commits not in main, X days old` is printed for **this member's own** branch, measured against `refs/remotes/origin/<default>` after §10.1 rule 1's fetch and otherwise `unknown — <default> not fetched this session`; for a **peer** the line is `alex: work branch present at <sha> — commit count and age need the peer's objects (fetch gated, G1)` or `alex: no work branch yet`, from the `ls-remote` the state-branch check already makes. Verified: after the exact-refspec state fetch, `ls-remote` gives a sha whose object is absent — `rev-list --count` exits 128, `git log -1` fails on a bad object — so the count is not derivable without fetching the peer's branch, which §4.1 puts inside the G1 row. **Alternative available and not taken:** carve a *counting-only* peer-branch fetch out of that row on the ground that counting is not building. It is a defensible reading — no content is read and nothing is checked out — and it is declined here because it imports a peer-branch fetch, the receive-boundary validation that fetch needs (Appendix G1 mechanism 1) and a §2.5 row into the slice the owner asked to make smaller. Ratifying this row picks the honest line over the fuller number |
| 9 | **V-D2** field name, shape, **carriage** and **harvest** — **rewritten at the revision** on the first three, **and at fix round 3 on the fourth, plus a repin**. It is now **the only wire delta in the committed slice**, V-D3 having moved to Appendix G2 | §2.3, §7.1, §10.2 | `task.claim.symbols` / `task.change.symbols`, **≤ 8 × ≤ 100 chars** (lowered so the body fits the 2,048-byte cap — repinned at fix round 3 to `[C lib/envelope.js:18,316]`, the client's actual `MAX_BODY_BYTES` and its `build()` throw, from `[C lib/filter.js:22]`, which is `check()`'s per-**string** input cap and is the very constant item 3 withdraws from the scan path for being irrelevant there; the relay half `[C relay/src/lib/envelope.js:10]` was already right), `path::Symbol.member`; **on the relay the authoritative carrier is `task.change{scope}`**, because `task.claim` is a fixed column set there `[C relay/src/do/workspace.js:101-104]`. **And carriage is not delivery: the field MUST be harvested out of the envelope into `peers.claims[].symbols` by `mergeClaimFiles` `[C hooks/sync.js:89-126]`** — a separate array, never merged into `files[]`, escaped at `{ max: 100 }` — or it renders once and vanishes, since both promised surfaces read only the cached claim rows and a digest item is watermark-consumed `[P§6.3]`. The CLI `sync` path must merge rather than overwrite `[C bin/handshake.js:1006-1010]`. Rendered as the **discriminating tail** on the card, in full on the gate line. **Degrades on both legs**, relay by retention and ntfy permanently through the `[F]` resurrection shape `[C docs/PROTOCOL.md:298]` |
| 14 | Cut trigger — secret-scan false positives — **rewritten twice**: at the revision, re-anchored from the two-human run (which then had no code diffs to scan) to the scan's own rung; at the simplification pass, re-anchored **to the run**, which now happens after the scan ships and is the first population of real diffs and real humans this rate has ever had | §12.2, §10.2, §10.4 | > 1 in 200 automated commits refused where a human, shown the finding, says it was not a secret. **The numerator is produced by `handshake scan-allow` (item 45) rather than by a tester's guess**, and the remedy if the rate holds is a broader allowlist policy on top of the per-value one — **never** an `--ack` bypass on the gate |
| 17 | §7.3's parser condition has **no threshold picked** — **rewritten at the revision** to name the denominator, and **at the simplification pass** because the rung that was to produce the denominator is gated | §7.3 | numerator: warnings overridden on a symbol-disjoint claim; denominator: all warnings on claims where **both** sides declared symbols. **The denominator needs G4, which is gated**, so until then §7.3's condition is answered by the run's qualitative verdict — *did a file-level warning ever block work* — and not by a ratio. The cheap version stays the whole feature |
| 18 | No untrimmable `COND` literal is added; the symbol marker — and, under G1, the stack and `sequenced:` markers — are trimmable details | §2.4 | reversible in one literal if Stage 2's measurement says otherwise |
| 21 | **Zero new event types** — **re-argued at the revision**, because the first draft's supporting argument (an OPTIONAL field degrades better on a v1.0 peer) is sound on ntfy and worth nothing on a type the relay projects through fixed columns. Re-tested, the conclusion survives and the route to it changed | §2.3 | as written, now **one** OPTIONAL field on an existing envelope-carried type in the committed slice (V-D2), with V-D3 gated to G2 — both on envelope-carried types, `[P§3]`'s closed-catalog `[F]` line untouched — and the alternative (one new `task.branch` type, which the relay would carry for free `[C docs/PROTOCOL.md:230-233]`) rejected because it would be the **third** amendment to that line in one wave |
| 22 | Notice priority — **rewritten at the revision and again at the simplification pass**: the channel already has three producers the first draft's four-kind order did not know about `[C hooks/common.js:594-614,668-673]` | §2.4, §10.2 | a **total order over eight kinds**, safety first — rotation demand → private-repo guard → push refused → escalated *(G2)* → conflict → own claim expired → rebase needed *(G1)* → round open *(G2)* — implemented as a **sort by rank** replacing the bare `.slice(0, 2)` `[C hooks/render.js:187]`. **Rewritten at the simplification pass:** the order ships whole in Stage 2 while the committed slice populates ranks 3, 5 and 6 only, because a rank order with holes gets re-derived wrongly when a hole is filled |
| 26 | **Amending `[PLAN§6]`'s acceptance criterion** rather than retiring it | §4.3, §13.1 | *"no coordination-only commits **on a branch a human works on**"* |
| 28 | **A gate-and-release stage added to the order** — decision 10's list ended at the learning records — **rewritten at the simplification pass**: the two rows on the end of a task table became **Stage 3**, a stage with its own section, because a rung with no section is the rung a deadline eats | §10.3, §10.5 | SECURITY.md consolidation + the red team + README/INSTALL/release, as the last committed stage, and a gate: **scoped to what the committed slice built**, with the fetched-content corpus entering only if G1 ships |
| **29** | **State-branch concurrency: one branch with a protocol, or per-member branches** *(new at the revision)* | §4.1, §10.1 | keep decision 3's **one** `handshake/state`, with fetch-first / adopt-never-create / `commit-tree -p` / rebuild-on-rejection, a **3**-rebuild bound per beat, a push budget outside the CLI slice, and a `rejected` state distinct from `offline`. **Fallback if the run shows it flaky:** `handshake/state/<member>`, which is structurally single-writer — a **one-way** migration, since the two ref shapes cannot coexist |
| **31** | **The notices overflow literal** *(new at the revision, created by item 22's eviction; **rewritten at the simplification pass** to name the hidden kind)* | §2.4, §10.2 | `+N ! <highest hidden kind>` — e.g. `+2 ! escalated` — **4 chars of marker plus up to 18 for the kind name, 22 in the committed worst case (`+1 ! own claim expired`)**, spent only when something is actually hidden; that is past the 11 of headroom, so the render carrying it pays a digest item out of rung 1 the way the details entries do, priced in Stage 2's gate, dropped with the channel at `dropNotices` `[C hooks/render.js:262]`. Naming the kind is what stops the one notice addressed to a human being evicted silently by three machine-recoverable ones |
| **37** | **The `SKILL.md` ceiling and its per-stage deltas** *(new at the revision; the file was in five rungs' Touches and in no budget. **Rewritten at the simplification pass** onto the stage structure, and G1's allowance raised by two lines to carry two of the friction smoothings that are `SKILL.md` sentences)* | §2.4, §10.1–§10.3, Appendix G | **480 lines hard**, from a 410-line baseline; Stage 1 ≤ 6, Stage 2 ≤ 14, G1 ≤ 18, G2 ≤ 14, G3 ≤ 10, G4 ≤ 8 — **the committed slice lands at ≤ 430, with 50 lines of headroom that did not exist before this pass**. The stack-versus-sequence *prose*, the contradiction discipline and the capability semantics go to `references/`; **the five-row stack-versus-sequence fact table stays in `SKILL.md` proper**, because a decision that needs a file opened mid-turn is a decision made without the table |
| **39** | **The wall-clock budget for the new plumbing** *(new at the revision; §2.4 promised it and pointed at a section that does not contain it. **Two rows added at fix round 3**: the commit-path fetch, which rule 1 requires on every beat and no row named — so the paragraph's "the count is three" was a closed count that excluded a call on the beat, now four — and `git worktree add`, which is a full checkout of the peer's tree and had no bound and no disk price anywhere)* | §2.5, §5.4, §10.1, Appendix G1 | **fetch 1,500 ms (rule 1's fetch-first, on the commit path, and each rebuild's re-fetch takes its own slice of what is left rather than a fresh 1,500)** / scan 1,500 ms / commit 500 ms / push the rest of the caller's deadline capped at 5,000 ms / **gated with G1:** `ls-remote` 2,000 ms off the commit path, **the peer-branch refspec fetch 5,000 ms and `git worktree add` 5,000 ms, both off-hook on the monitor's clock and skipped entirely when there is no monitor — which is what keeps `GIT_NETWORK_TIMEOUT_MS` off every hook path — at a peak disk cost of one working tree per evaluation — so the committed slice has THREE hook-reachable network git calls and not four** / **the SessionStart state-ref fetch 1,500 ms and the WHOLE shard scan 500 ms on that path** — the budget in `authorBudgetMs`'s shape `[C lib/shard-scan.js:127,160]` but **widened to wrap the per-shard `git show` reads too**, which today sit outside it `[C lib/shard-scan.js:189-192]` — so 1,500 + 500 + 7,000 fits `armSafety(9500)`; a `GIT_NETWORK_TIMEOUT_MS` of 15,000 distinct from `GIT_TIMEOUT_MS` `[C lib/repo.js:27]` and used on **off-hook paths only**, never on a hook, async or synchronous; and the tripwire corpus hoisted once per scan through `opts.secretFiles` `[C lib/filter.js:227]` |
| **40** | **The commit battery's four exclusions, the zero-findings test's exclusion list, and — added at fix round 3 — the tripwire's needle filter** *(new at the revision; this is B1's substance and it is a choice, not a given. The fifth narrowing is new because the 66/0 run that made the four "affordable" **never exercised the tripwire**: nothing tracked here matches `SECRET_FILE_RE` `[C lib/filter.js:202]` and `tripwireFindings` returns `[]` on an empty corpus `[C lib/filter.js:228]`)* | §4.2 item 1, §10.2, §12.2 | exclude the entropy pass, `secret-assignment`, the whitespace-stripped variant (for the pattern battery only — the tripwire keeps its own) and `env-block`; the zero-findings test excludes `test/**`, `relay/test/**`, `e2e/**`, `docs/**`, `lib/filter.js`, `lib/secret-shapes.js`. **Plus: the commit scanner filters the needle corpus before using it — value-shaped needles only (no URLs, no dotted identifiers, no filesystem or route paths), capped per file — in `lib/commit-scan.js` and never in `lib/filter.js`.** Measured on a fixture with an ordinary `application.yml` and `.npmrc`: nine needles of which two are credentials, and **six of eight ordinary code and prose samples refused**, including the English sentence *"We validate the input before sending."* — `validate` is exactly 8 chars and clears the floor §12.2 offered as the mitigation. `readSecretValues`'s JSON walk is deliberately **not** narrowed: it exists for the one-line `{"secret":"…"}` shape the red team leaked `[C lib/filter.js:170-181]`, and it is not the branch a `.yml` takes anyway. A second Stage 2 test pins the filter by the false-positive class it removes **and** the true positive it must not lose. **`handshake scan-allow` (item 45) ships in the same stage**, so the human whose adjudication this row's rate depends on has a command to type |
| **41** | **The state-branch and work-branch write mechanism** *(added in fix round 1; it was marked `[proposed]` inline with no row, so ratifying §14 would not have ratified the mechanism M7 exists to name. **Two arms added at fix round 3**, both of which the sequence as written could not express)* | §10.1, §10.2 | temp-index plumbing — `GIT_INDEX_FILE` → `read-tree` → `update-index` → `write-tree` → `commit-tree -p` → `update-ref`; **`.git/index` never read or written, `HEAD` never moved, no checkout ever**; author/committer split through `GIT_AUTHOR_*` / `GIT_COMMITTER_*` on `commit-tree`; the same verb chain serves both branches, **with the three operands named per branch** (§10.1 for the state branch, §10.2 and item 43 for the work branch). **The removal arm:** for each path on the list that is absent from disk, `git update-index --force-remove -- <path>` — verified, `--add` on a deleted path exits 128 and the `--cacheinfo` form cannot be built for it at all, so an add-only builder **skips** it and `write-tree` silently re-emits the parent's blob; a delete resurrects and a rename publishes both copies, and `files[]` is a monotonic union that still lists the deleted path `[C hooks/post-tool-use.js:79-91]`. It also bites the state branch, where `scrub` `[C lib/workspace-files.js:773-776]` could otherwise never un-publish a detached project's shards. **The mode arm:** read the mode from the parent tree with `git ls-tree`, never hardcoded and never from a disk stat — verified, `--cacheinfo 100644` demotes a `100755` parent entry, and `core.fileMode` is false on Windows. Alternative rejected: `checkout --orphan` + `add` + `commit`, which resets the human's index and stages whatever is lying around, and which the first draft's only test would have passed. **Two arms added at the second-look round (G2-10), because the block could not be built as literally as it was written.** **(i) The blob-writing step:** `git hash-object -w -- <path>` per present path, *before* `--cacheinfo`, which names a blob and neither creates nor validates one — verified, `--cacheinfo` with a sha from a plain `hash-object` exits **0** and `write-tree` then exits **128** with *"invalid object"*; `hash-object -w` also applies the path's own eol filters, so with `core.autocrlf=true` the blob is byte-identical to `git add`'s. **(ii) The add arm of the mode rule:** the parent entry when the path is in the parent tree, else `100644` unless the file is executable **and** `core.fileMode` is true. Verified: `ls-tree <parent> -- <new path>` prints nothing and exits 0, so the absolute form of the rule leaves an implementer with only the two sources it forbids — and every path in a first commit, and every new module on the work branch, takes that arm |
| **43** | **The work branch's base tree and parent** *(new at fix round 3; the work-branch commit was specified only as "the same plumbing as §10.1", whose operands are literally "the fetched state head", and the three plausible readings produce visibly different branches for the peer that stacks on them)* | §10.2, Appendix G1 | **the base commit is recorded when the claim is acquired** (the human's `HEAD` at that moment, in the same per-workspace state as the lease's last-pushed head); the **first** commit of a claim seeds `read-tree <recorded base>` and commits `-p <recorded base>`; **every later beat** seeds from the work branch's **own previous commit** and parents on it, so the branch is a linear chain from the recorded base; **never live `HEAD`**, which moves between beats and is the human's — measured, a beat seeded from a moved `HEAD` published `M a.txt / A other.txt / D shared.txt` with only `a.txt` staged, because `files[]` bounds what is staged and not what the base tree contains. When the human's `HEAD` moves off the recorded base the branch **keeps its base and diverges**, and `handshake branches` says how far behind. **Alternative available but not taken:** restacking onto the new head *mid-claim*, which ruling D1 does put below the floor for `refs/heads/handshake/<self>` — refused as an automatic behaviour because a rewrite fires the stack-invalidation rule on any peer stacked on this branch for a reason that peer cannot see. **Rewritten at the simplification pass:** the branch is now per member and long-lived, so *drifting behind the base* is the normal end state rather than an edge case — item 48's threshold notice (`work branch is N commits behind its base — restack before the PR`) is how the human is told, and **item 50's re-root is the one automatic rewrite, taken only after a merge the human performed**. **Two clauses added at the second-look round:** the distance is measured against `refs/remotes/origin/<default>` and only after §10.1 rule 1's fetch — a bare local `<default>` moves only when a human types `git pull`, so a number taken from it is stale presented as fact — with `unknown — <default> not fetched this session` as the honest fallback (G2-9); and **the re-root updates the recorded base in the same step it rewrites the branch**, which is what returns item 50's detection gate to zero and stops the re-root re-firing on every beat the default branch advances (G2-12) |
| **45** | **`handshake scan-allow <finding-id>` ships WITH the scanner** *(new at the simplification pass; the first draft made the adjudication verb a contingency behind §12.2's measured rate, which is the wrong order — the rate is measured on humans who had nothing to type)* | §4.2 item 1, §10.2, §12.2 | human-only (refuses `--yes`, refuses from a proven child `[C bin/handshake.js:627,387]`), typed confirmation, **per workspace, per adjudicated VALUE and never per pattern**, recorded. The refusal **prints the exact command**, names the finding id and the file, and for a tripwire hit **names which local secret file the value was harvested from** `[C lib/filter.js:157-197]`. It is not the `--ack` §12.2 rules out: that would be a model-reachable bypass on the gate, this is a human-adjudicated value allowlist — the remedy §12.2 already names, brought forward. §12.7 lists it as a surface a human deliberately un-scans, and Stage 3's red team attacks it |
| **46** | **The visibility refusal branches on the reason, in three arms** *(new at the simplification pass; the guard already carries a reason string and a fail-closed guard with one message spends it for nothing)* | §4.2 item 2, §10.1, §11.3 | `gh_missing` / `gh_unauthenticated` ⇒ *"install the GitHub CLI and run `gh auth login`"*; `no_github_remote` / `no_remote` ⇒ *"visibility cannot be proved for a non-github.com remote; confirm yourself that `<origin>` is private"*, **recorded as `unprovable` and NOT as an override of a public verdict**, because no install ever clears it and asking a GitLab pair to certify that their private repo is public is asking them to certify something false; `affirmative_public` ⇒ and **only here** the world-readable sentence. Pinned to `[C lib/repo.js:36-48]`'s own reason table |
| **47** | **What the opt-in gate and the shipped docs must SAY about the commits** *(new at the simplification pass; the first draft printed a permission screen and left the experience to day two, when `git log --all --author=<you>` shows hundreds of commits nobody typed. **Clause (d) added at fix round 2**, because §10.3's Rule 1 test asserted a `push:` vocabulary in the shipped docs that no Delivers and no row promised)* | §4.2 item 3, §10.1, §10.3 | the gate and `docs/INSTALL.md` print: authored as you · about one a minute · on a branch that never merges into anything you work on · they will appear in your GitHub activity · **three refs, forever — three on the remote, plus the local copies the tool writes in your own clone, `handshake/state` and `handshake/<you>`** · the tool's commits never run CI, yours do. Plus **(a)** `handshake pair --state-branch` named in `USAGE` `[C bin/handshake.js:2514-2546]` and INSTALL **in Stage 1**; **(b)** the cloner-facing README body `[C lib/workspace-files.js:673-730]` gains the two branch shapes, *"generated, unreviewed, never merged into your branches"*, *"deleting them is safe"* and the same remote-versus-local clause; **(c)** *"never pull `handshake/<you>` into a checkout you care about"*, which is rewritten under a lease; **(d)** the `push:` field of §4.4 rule 1 and its **ten values** named in `README.md`, `docs/INSTALL.md` and the release note **in Stage 3**, so a human who sees a branch not moving can map it to a documented line — the clause §10.3's Rule 1 test asserts. **(e) Added at the second-look round (G2-14):** the local-refs clause above, said in the gate, in the README body **and** in what `scrub` lists — the tool writes its refs with `update-ref` as well as pushing them, so a listing that offers only `git push origin --delete <ref>` leaves the reader still carrying both refs in their own `git branch`; each ref gets the remote delete **and** `git branch -D`. Measured: after one commit on each branch, `git branch -r` is the promised three (plus `origin/HEAD`) while `git branch` is `handshake/alex`, `handshake/state`, `* main` |
| **48** | **The three visibility rules of §4.4, and their test shapes** *(new at the simplification pass; owner direction is "I want less friction", and this is how this plan discharges it — the direction is decided, the discharge is proposed)* | §4.4, and every stage's Tests | **Rule 1** — one always-populated `push:` field in `status` and `branches`, from a **closed** vocabulary of **ten, owned per stage** (**rewritten at the second-look round, U2-3**): **Stage 1's seven** — `pushing` · `off — gh unauthenticated` · `off — visibility unproven` · `rejected — forge ruleset: <line>` · `deferred (no time in the beat)` · `offline` · `off — no remote`; **Stage 2's three** — `refused — secret scan, <file>` (the scanner is Stage 2's), `no recorded lease` (so is D1's force-push helper) and **`paused — remote head is not the one this tool pushed`**, which is new: with `[skip ci]` on every tool commit, §4.2 item 4's own remedy tells a human to push a commit of their own onto the work branch, after which — measured — a plain push is rejected non-fast-forward and the lease push is rejected *stale info*, and neither existing word is true of that state. **Test shape:** each state is reachable by a test **at the stage that owns it**, and prints itself and no other; read flat, the *"a state reachable by no test may not ship"* clause would have forbidden Stage 1 from shipping two words it has no machinery for. **Rule 2** — every refusal names cause and next move. **Test shape:** every refusal a stage can emit contains a command, a file or a setting. **Rule 3** — every off capability says so with its cause, **derived locally**, never announced by the peer: `bob: no state branch on the remote — not enabled yet` · `peer alex: no symbols (older plugin)` · `stacking: off — no monitor` · `stacking: off — git 2.34 (needs 2.38)` · `headless: state pushes ride the Stop hook, peer-branch evaluation is off` · **added at the second-look round:** `alex: work branch present at <sha> — commit count and age need the peer's objects (fetch gated, G1)` (G2-8) · `re-root: partial — no GitHub remote; a squash merge is detected only while the default branch has not moved past it` (G2-4) · `re-root: case 2 off — git 2.34 (needs 2.38)` (G2-2). **Test shape:** the line appears when the asymmetry exists **and does not appear when it does not** — the negative assertion is what stops it becoming decoration. Plus: the drift notice at a threshold, the own-claim-expired notice, and `status` printing the last SessionStart fetch duration and whether the scan came back `truncated` |
| **49** | **Five smaller Stage 1 / Stage 2 smoothings, each one line of output** *(new at the simplification pass; each was found by walking the plan as the human rather than as the builder)* | §10.1, §10.2, §12.1 | `deferred (no time in the beat)` as a third word beside `rejected` and `offline` · the gpgsign / forge-ruleset refusal stating **both** arms, printing the forge's own rejection line and **re-probing once per session** · the Windows preflight detecting a known sync root (OneDrive) above the plugin state dir and pointing at `HANDSHAKE_STATE_DIR` `[C lib/state.js:58-65]` · `handshake doctor` comparing **registered** hooks against the **installed** copy and naming the missing one, the WSL case `[C docs/INSTALL.md:584]` `[C bin/handshake.js:1489]` · the installer carrying its *"this is expected immediately after install"* sentence into **both** arms of the self-check, not only the one that has it `[C installers/install.sh:389-391]` `[C docs/INSTALL.md:401]`. Plus the **late-not-lost** flush (§10.1) and the **overlap short form** (§10.2) |
| **50** | **The re-root's detection, its replay mechanism, and the recovery pointer under it** *(new at the simplification pass; **rewritten at the second-look round on five counts** — the gate, the third arm, arm (c)'s test, the replay, and the ref names. The re-root itself follows from the owner's branch-model direction; **how it is detected, how the commits after the merged head are replayed, and what it does when it cannot detect are this plan's choices**)* | §4.1, §10.2, §2.5, §11.2, §12.1 | **A gate and three arms, every `<default>` being `refs/remotes/origin/<default>`** — a bare local `<default>` moves only on a human's `git pull`, and §10.1 rule 1 now fetches the tip on the same round trip (G2-9). **Gate:** `git rev-list --count <recorded base>..refs/heads/handshake/<self>` > 0, so a branch with nothing of its own never re-roots — measured, `is-ancestor` is trivially true for such a branch **and** reflexive (`main` is an ancestor of `main`), so without the gate somebody else's merge fires a lease force-push, a recovery-pointer write and a rule-1 line, and a re-rooted branch re-roots again on every beat the default branch advances (G2-12). **(a)** `git merge-base --is-ancestor refs/heads/handshake/<self> refs/remotes/origin/<default>` — merge-commit and rebase-merge, local, free, every forge. **(b) Squash, detected locally by tree equality:** `git diff --quiet refs/remotes/origin/<default> refs/heads/handshake/<self>` exits 0 ⇒ everything has landed ⇒ reset. Measured 0 the instant a squash lands, with no `gh` and no PR concept — **this is what makes the re-root work on GitLab, Gitea and self-hosted, the population §4.2 item 2 exists to admit** — and measured 1 once the default branch moves past it, which is the bound and is stated rather than implied (G2-4). **(c) The merged-PR probe, GitHub only:** `gh pr list --head handshake/<self> --state merged --json mergeCommit,headRefOid` on the 600 s TTL `[C lib/repo.js:25,36-48]`, and the test is **a local ancestry proof, not an equality** — `git merge-base --is-ancestor <headRefOid> refs/heads/handshake/<self>`, plus `headRefOid` not being the recorded base. The equality it replaces could not fire in the ahead-of-merged-head case at all: the tool records **one** head per ref (D1 rule 1), which is always the current head, so it equals the merged `headRefOid` only when nothing was pushed after the merge (G2-3). Ancestry needs no new state and fails closed — measured 0 / 1 / 128 for the merged head, an unrelated commit and a sha this clone lacks. **When (c) is unavailable, rule 3 says so:** `re-root: partial — no GitHub remote; a squash merge is detected only while the default branch has not moved past it`. **Commits pushed after the merged head are replayed onto the new base, never discarded** — and **the replay is `merge-tree --write-tree` + `commit-tree` + one `update-ref`, never `git rebase`** (G2-2): measured, `git rebase --onto` in the tool's clone moves the human's `HEAD` onto the tool's branch on a clean tree, detaches it and writes conflict markers into the shared working tree on a conflict, aborts mid-rebase on an untracked collision, and refuses outright on a merely dirty tree — the failure §10.1's plumbing exists to prevent; the plumbing replay leaves `HEAD`, `symbolic-ref` and `status --porcelain` byte-identical and carries `[skip ci]` through. `merge-tree --write-tree` is git ≥ 2.38, so **Stage 2(b) reads `git --version` and turns case 2 off below it** (`re-root: case 2 off — git 2.34 (needs 2.38)`) rather than re-opening Stage 1's three preconditions; case 1 is an `update-ref` and works at any version. **The re-root does not run on a paused branch** (§4.4 rule 1's tenth word). **Before any re-root the previous head sha is written to this member's own shard on the state branch as a recovery pointer** — one dated, attributed line; `git branch <name> <sha>` restores it while the objects survive gc, and the tool does not create that ref itself, because creating one is one more ref — **and the recorded base is updated in the same step**, which is what returns the gate to zero |
| **51** | **The `[skip ci]` literal, and the warn-not-block preflight beside it** *(new at the simplification pass. That the CI precondition is replaced is owner direction; **which literal, and what the preflight does about what it cannot read, are this plan's choices**)* | §4.2 item 4, §10.1, §12.5, §12.7 | **`[skip ci]`**, chosen because GitHub and GitLab both honour it (GitHub also accepts `[ci skip]`, `[no ci]`, `[skip actions]`, `[actions skip]` and a `skip-checks` trailer; GitLab accepts `[ci skip]` / `[skip ci]`), in the message of **every** commit the tool writes on either branch — verified against the vendor documentation on 2026-09-02. The **preflight WARNS and does not block** when a workflow uses `pull_request_target`, or when the forge is GitLab with a policy the tool cannot read: the warning names the cost (a run per tool push) and the remedy. §12.7 carries the residual |
| **52** | **The four entry triggers of Appendix G, and their thresholds** *(new at the simplification pass. That the gated rungs are gated is owner direction; **the trigger wording and the numbers are this plan's**. G2's, G3's and G4's conditions are the first draft's own material re-read from the other end; **G1's threshold is new**, because the first draft carried no cut trigger for stacking at all — Appendix G's preamble states which is which)* | §10.4, Appendix G | **G1** — build only if same-symbol collisions **blocked real work more than [proposed: 3] times** in the run's working day. **G2** — build only if **at least one TRUE requirements conflict** occurred (one, not a rate: a protocol for a thing that never happened has no customer). **G3** — build only if **more than one narrow opt-in exists**; today there is one. **G4** — build only if **there is a corpus to rank**, which requires G1 or G2 first. The run (§10.4) produces **one written verdict per trigger**, fired or not, with the number that decided it — because a gate whose reading is nobody's deliverable is a gate that gets waved through |

**Three things this plan could not establish, marked rather than asserted:**

- **Every rate in this document, committed or gated, is [unknown — needs
  verification], and the run is where that stops being true.** Item 14's
  false-positive rate, item 17's threshold, item 29's state-branch numbers, item
  52's four entry-trigger counts, and the gated items 15, 16 and 27 have no data
  on this project. **The run (§10.4) is the first place there can be for all of
  them except item 16's**, which needs a month of use after G4 — and G4 is behind
  two other triggers, so that number is three gates away and is not scheduled.
  Ratifying any of them means ratifying *"measure this, then decide"*, not the
  numbers.
- **Whether a work branch needs its own CI at all (gated item 23) is
  [unknown — needs verification].** Appendix G1 asserts that a clean `merge-tree`
  probe plus successive `ls-remote` reads answer *"is this stable enough to build
  on"*;
  nothing here demonstrates that they do, and nothing here answers *"does the
  peer's half pass its own tests"* — by design, since a work branch is
  advertised as broken-allowed (§4.1). **And after `[skip ci]` there is one more
  unknown of the same shape:** whether a pull request that shows **no checks
  until the human pushes** reads as expected or as broken (§12.5). Both are
  questions for the run.
- **Whether the commit battery's four exclusions (item 40) leave a hole a real
  accident falls through is [unknown — needs verification].** What *is*
  established is the other half: the battery returns **zero findings** over this
  repository's 66 non-fixture tracked files, run at the revision (§4.2 item 1).
  What is not established is the false-**negative** rate, because there is no
  corpus of real accidental commits to measure it against; §12.7 names the four
  classes each exclusion gives up, Stage 2's 3× adversarial fan-out and Stage 3's
  red team attack them, and the tripwire is the compensating control in each
  case. **`handshake scan-allow` (item 45) is a fourth unknown here**: it is the
  right answer to a fail-closed gate a human disagrees with, and how often it is
  reached for — and for what — is a number only the run can produce.

Everything else pinned in this document was opened at `b6b3dca` during the first
pass, and everything added or retargeted in the revision at `9e810b0`.

---

## 15. Revision record (2026-09-02)

One row per finding in the adversarial review at `9e810b0`, plus the owner's two
rulings and the residuals the review's refuted table noted in passing. It exists
so the owner can trace each fix to the place it landed rather than re-reading the
document against the report. **The last table — *Simplification pass* — is the
record of the owner's direction of 2026-09-02 and does the same job for it: one
row per move, removal and addition, and where each landed.** **That pass has two
fix rounds of its own, folded into the rows they correct** the way the three
below are. **Round 1:** §10.3's and §11.3's missing §4.4 blocks, which S14 claimed
and two sections did not carry; Appendix G's *"thresholds unchanged in value"*,
false for G1 and G4 and contradicted by G2's own paragraph (S3); the branch-name
change recorded as owner direction without saying it **superseded decision 3's
own value** (S7); the `+N ! <kind>` marker filed gated in S15 and committed in
three places of the body; and §4.2 item 5's mechanism, left in the committed
slice when its rung went to the appendix (S19). **Round 2**, which is where the
first four of those needed a second pass: round 1 corrected the *"thresholds
unchanged in value"* claim in the preamble, in S3 and in item 52 and left it
standing verbatim in §12.6, in §10.4's own introduction to the trigger table and
in G1's own *"inverted cut trigger"* paragraph — all three now say which
thresholds are inherited and which one is not; the `+N ! <kind>` marker was
priced and tested as the bare `+N !` it replaced, so §2.4's table, its two
arithmetic paragraphs, item 31 and Stage 2's own test now carry the 22-character
committed worst case; §10.3's Rule 1 test asserted a `push:` vocabulary in the
shipped docs that neither its own Delivers nor item 47 promised, and both now do;
two *"Proposed, gated"* rows still pointed at §11.3 under the numbering S4
replaced; and S20 finished the job S19 started.
**A second-look round after those**, folded into the rows it corrects and marked
*"Second-look round"* inside each. Its shape is fix round 3's again: **almost
every finding is about git or about what the committed slice can actually
compute**, not about this document's internal consistency. **Thirteen findings.**
**One blocker:** §10.2 specified the re-root's case 2 as *"rebased onto the new
base"*, and `git rebase` is a checkout — measured, it moves the human's `HEAD`
onto the tool's branch on a clean tree and writes conflict markers into the
shared working tree on a conflict, which is exactly the failure §10.1's
temp-index plumbing exists to prevent, on a path that runs unattended (G2-2).
**Eight majors:** the lease push had no arm for a ref the forge deleted, which is
the default GitHub and GitLab setting on the very event the re-root reacts to
(G2-1); the merged-PR arm's `headRefOid` **equality** could not fire in the case §10.2
calls routine, because the tool records one head and that head is always the
current one (G2-3); there was no forge-agnostic squash detection at all, so every
GitLab, Gitea and self-hosted pair — the population §4.2 item 2 exists to admit —
never re-rooted (G2-4); `handshake branches` promised a per-peer commit count and
age that nothing in the committed slice can compute, as a §11 pass criterion
(G2-8); nothing fetched the default branch, so the re-root's ancestry arm and
both distance counters read a ref only a human's `git pull` moves (G2-9); the
write mechanism named no step that creates the blob `--cacheinfo` points at, and
its mode rule had no arm for a path absent from the parent tree — every new file
(G2-10); §4.4 rule 1's nine-word vocabulary was asserted whole in Stage 1 while
two of the nine need Stage 2 machinery, and it had no word for the state
`[skip ci]`'s own remedy produces (U2-3); and R2-1, where Appendix G1's inbound
peer-branch pattern still required the `/<tail>` the branch model deleted, so the
receive boundary would have rejected every legitimate peer branch. **Four
minors:** arm (a) fired for a branch with nothing of its own and re-fired forever
after a legitimate re-root (G2-12); the three-refs sentence was true of the
remote and not of `git branch` (G2-14); item 32 still told the owner that Stage 1
records `git --version` as a fifth precondition (R2-2); and an unescaped pipe
inside inline code split item 32's row into six cells against five columns
(R2-3). U2-2 is folded into G2-3 and G2-4, whose fixes close it. **Where it
disagreed:** G2-1's *"rejected forever, the live view freezes"* is refuted — a
plain push to a deleted ref succeeds as a create (measured), so the state
self-heals on the next commit-bearing beat and the fix is to take that route
deliberately rather than to wait for it; U2-2's proposed `git cherry` detector
does not work for a multi-commit squash (measured: `+` for all three commits,
because patch-ids of the individual commits do not match the squashed patch), so
tree equality is what arm (b) uses instead.

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
counts a conflicting real rebase as well as a head move, as Appendix G1 mechanism 2
builds it; and the PR-open push suspension (item 44), moved from V1 — which ships
no work branch — to V4, with its Delivers line, its Touches entry and its test.

**One more, from the friction walk that followed:** the third resume trigger
said *expiring or going stale*, and `stale` is 360 s of silence on the relay
`[P§4.3]` — a coffee break would have handed a live task to the peer's Claude.
It now reads *expiring (presence `gone`, never `stale`)* in §5.4, §5.5, §12.3,
§14 item 24 and the M28 row.

**And after the simplification pass, by hand:** the closed count of hook-reachable
network git calls in §2.5 (four, for D1 rule 1's absent-ref probe); `handshake
branches` carrying the local-branch clause and both delete commands, as §4.3
already did; the one re-root residual the second look raised but could not
adjudicate (its refuter died on an API error) — the push after a plain reset
carries a human commit without the marker and starts one run per merged claim,
now stated in §10.2, §4.2 item 4 and §12.5; and the rule that no `update-ref` of
`handshake/<self>` happens while any worktree has it checked out, measured on
git 2.53: `update-ref` moves a checked-out `HEAD` silently where `branch -f`
refuses.
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

**One reading note for the four tables below.** They are the record of the
revision and of its three fix rounds, and they are written in the vocabulary that
existed then: **V1–V10**, the old `§10.x` rung numbers, and `§11.2`–`§11.4`. Those
names are kept rather than rewritten, because a record that is edited to match a
later document stops being a record. **The mapping is the *Simplification pass*
table at the end**: V1 → Stage 1, V3 + V4 → Stage 2, V2 → the run, V9 + V10 →
Stage 3, V5–V8 → G1–G4, §11.2 → G1's scenario, §11.3/§11.4 → G2's, §12.3 → G1's
risk, §12.4 → G2's. **One live pointer in those tables was retargeted rather
than frozen, at fix round 2:** `§5.4 mechanism N` is not old vocabulary — §5.4 is
still §5.4 — so, S20 having moved the mechanisms, the D1, M19, M20, M23 and M28
rows now name Appendix G1 where they named §5.4's mechanisms, and nothing else in
them is touched.

### Owner rulings — settled, not proposed

| Id | What changed | Where |
|---|---|---|
| **D1** | Lease-protected force-push on `handshake/<self>/*` added to the floor table as a below-the-floor row, with the rationale (tool-owned, advertised unstable, lease refuses rather than clobbers), the rejection of merge-instead-of-rebase, and the three implementation rules: **recorded-head lease value** (never the remote-tracking ref, which V1's own background fetch can move), **stack invalidation on a rewritten base** (one rule covering the peer's rewrite, a human's rewrite and a deletion — which closes part of M28), and **the refusal test** (any other ref, no git process spawned; bare `--force` never emitted). §5.4's *"it is below the floor because it rewrites only history I own"* replaced, because that is not the test git applies — the test is whether the ref was published, and it was. **Fix round 1:** the above-the-floor cell said *"`--force` in any form"*, which contradicted the carve-out three rows above it and, read literally, forbade the helper V4 ships; it now reads **bare `--force` (or `-f`) on any ref**, naming row 3 as the one exception — the narrow reading the rest of the plan already used (§4.1 rule 3, §10.4's test). **Fix round 3 (S2-6):** rule 1 said what the lease value *is* and never what happens when there is none. The record is a plain sentinel file in the per-workspace state directory `[C hooks/common.js:26-50]`, and a cleared state dir, a `scrub`, a new machine or a differing `HANDSHAKE_STATE_DIR` all leave it absent — on which reading an implementer has three moves, two of which D1 forbids and a third it does not: passing the sha `ls-remote` returns, a lease that can never fail, one line away in V5's own helper. Rule 1 now states the absent-or-unparseable case **fail-closed** — refuse, notice, never a valueless lease, never bare `--force`, never a lease value read back from the remote — with no `[proposed]` marker and no §14 row, because marking a fail-closed default as proposed would imply the owner could ratify a fail-open. §10.4's tests gained the no-record case. **Second-look round (G2-1): rule 1 had no arm for the ref not being there at all.** Both GitHub (*"Automatically delete head branches"*) and GitLab (*"Delete source branch when merge request is accepted"*) delete the merged head branch **by default**, on exactly the event §10.2's re-root reacts to; measured on git 2.53, the lease push then fails *"stale info"*, exit 1, and since rule 1 forbids ever re-deriving the lease from the remote and the recorded sha never changes, the rejection repeats on every later beat with no `push:` word that is true of it. The finding's *"rejected forever, the live view freezes"* is **refuted** — measured, a plain push to the deleted ref succeeds as a create, so the state self-heals on the next commit-bearing beat — but taking that route by accident is not a design. Rule 1 now asks `ls-remote --exit-code --heads` first (0 present ⇒ lease; **2 proved absent ⇒ a create, with no lease and no force, because there is nothing to clobber**; anything else ⇒ do not push), updates the recorded head in the same critical section as the push, and re-creates only while a claim is live. §10.2's tests gained it | §4.1 (row + three rules + the above-the-floor cell), Appendix G1 (mechanism 4), §10.2 (tests), §10.4 and §10.5 (tests), §11.2 (asserted), §12.1 |
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
| **M7** | The write mechanism is named: `GIT_INDEX_FILE` → `read-tree` → `update-index` → `write-tree` → `commit-tree -p` → `update-ref`, never touching `.git/index`, never moving `HEAD`, never checking out. The failure it prevents (`checkout --orphan` resetting the human's index) is stated, together with the fact that the first draft's only test would not have caught it. The `HEAD`-and-`git status` invariant test added across a hundred commits. **Fix round 3 (F2-2): the sequence could add and could never remove, and it did not say what mode it wrote.** Verified on git 2.53 against a `read-tree`-seeded temp index: `update-index --add` on a path absent from disk exits **128**, and the `--cacheinfo` form cannot be constructed for it at all (no blob to hash), so a builder walking the path list **skips** it and `write-tree` silently re-emits the parent's blob — **a delete resurrects and a rename publishes both copies**, on a branch a peer stacks on. It is not an exotic case: `files[]` is a monotonic union `[C hooks/post-tool-use.js:79-91]`, so a path written then deleted inside one claim is still on the list. The state branch has the same hole from the other end — `scrub` `[C lib/workspace-files.js:773-776]` could never un-publish a detached project's shards. Fixed with a `--force-remove` arm keyed on absence from disk (verified: exit 0, path leaves the tree) and a **mode read from the parent tree with `git ls-tree`** — verified, `--cacheinfo 100644` demotes a `100755` entry, and a disk stat does the same where `core.fileMode` is false. V1 and V4 gained the delete, rename and exec-bit tests, and §10.1's block now names its three operands per branch instead of leaving the work branch's blank. **Second-look round (G2-10): the block still could not be built as literally as it is written, on two counts.** **(i)** No step created the blob `--cacheinfo` names — verified, `update-index --add --cacheinfo` with a sha from a plain `git hash-object` exits **0** (it does not validate) and the failure surfaces two steps later as `write-tree` exit **128**, *"invalid object"*; the block now carries `git hash-object -w -- <path>` before `--cacheinfo`, and the reassurance worth stating is that `hash-object -w` applies the path's own eol filters, so with `core.autocrlf=true` the blob is byte-identical to `git add`'s (verified, same sha). **(ii)** The mode rule was absolute — *"read from the parent tree, never hardcoded, never from a disk stat"* — with no arm for a path **absent** from the parent tree, which is every new file, every path in a first commit: verified, `ls-tree <parent> -- <new path>` prints nothing and exits 0, and `core.fileMode` is false here, so the rule left an implementer only the two sources it forbids. The add arm is now stated (parent entry when present, else `100644` unless executable **and** `core.fileMode` true), with two tests. Neither defect is unsafe — both fail loudly — but this is the mechanism §14 item 41 asks the owner to ratify as the one most likely to destroy a human's work, and it has to be literal | §10.1, §10.2 (same plumbing), §10.4, §14 items 41 and 43 |
| **M10** | The **squash hazard** stated: Alex's commits inside Bob's rebased branch become duplicates when Alex's side squash-merges, and Bob's PR then conflicts in a way neither Claude created. Stance picked — merge-commit or rebase-merge for stacked branches, never squash, or restack before the PR — both human operations, so the plan's own obligation is to **show stack parentage** on `handshake branches` rather than only age. No sixth acceptance scenario, with the reason given | §10.5 (Delivers), §12.1, §12.3, §14 item 38 |
| **M19** | **§2.5 is new**: the wall-clock budget §2.4 promised and pointed at a section that did not contain it. A per-beat split (scan / commit / push / `ls-remote`) with an ordering, the deadline threaded the way `beat()` already threads one, a network-git timeout distinct from `GIT_TIMEOUT_MS`, and the tripwire corpus hoisted once per scan through the existing `opts.secretFiles` override — the 651 ms → 73 ms measurement stated. §2.4's dangling pointer fixed. **Fix round 2:** the qualifier keeping `GIT_NETWORK_TIMEOUT_MS` off hook paths was written as an enumeration — *"the one network git call a hook makes is the state-ref fetch"* — and the plan's own no-monitor fallback makes two more, since `hooks/stop.js` runs the whole `beat()` `[C hooks/stop.js:163]` and §5.4 pins the peer-head poll to that same fallback `[C hooks/stop.js:113]`. The operative half was right and the count was wrong: the paragraph now names **three** hook-reachable network git calls — fetch, push, `ls-remote` — each taking its own row (1,500 / 5,000 / 2,000 ms), and the `ls-remote` row no longer says *"never inside a hook that a turn waits on"*. **Fix round 3, four corrections, three of them to fix round 2's own edits.** **(F2-4)** The count was still wrong: §10.1 rule 1 is *"fetch first, always"* on the commit path, so a **fourth** network git call rides `beat()` and the table had no row for it — a closed inventory that excluded a call on the beat. A fetch row is added at 1,500 ms, the count reads **four**, and rule 4 now says the 3-rebuild bound is an attempt ceiling against the threaded deadline rather than a wall-clock commitment. *The finding's headline — that the bound cannot fit any budget — is refuted*: §2.5's own threaded `opts.deadline` `[C monitors/heartbeat.js:196-213]` truncates the loop and rule 4 defers the rest, and its 90 s figure ignores this table's own 5,000 ms push ceiling. **(R2-2)** The table preamble still classified those rows as *"not on the beat"*, which fix round 2's edits falsified twice; the classifier is now **not on the commit path**, which is the property they actually share. **(R2-3)** Both new `[P§5.4]` pins were wrong under this document's own header convention — PROTOCOL §5.4 is the deterministic tiebreak and says nothing about polls — and are dropped; the plan's own §5.4 was already named in plain form in the same cell. **(R2-1)** Removing *"it runs on the monitor's poll, never inside a hook"* left the V5 peer-branch fetch unplaced, and §5.4 hands it `GIT_NETWORK_TIMEOUT_MS`; §2.5 and Appendix G1 mechanism 3 now both say in one clause that only the peer-head `ls-remote` rides the beat, and the refspec fetch, the worktree and the probe are off-hook and skipped with no monitor. **(F2-17)** `git worktree add` is a full checkout and had no row, no disk price and no Windows path-length rule; it gets a row, a sentence of disk cost, and the `--no-checkout` / sparse / `core.longpaths` mechanics in §4.2 item 5 | §2.4, §2.5, §5.4, §10.1, §12, §14 item 39 |
| **M20** | A peer's `branch` is validated **at the receive boundary**, before it is ever a git argument: `^handshake/<the authenticated sender's member id>/[A-Za-z0-9._-]{1,120}$`, discard-and-count otherwise. Option injection named as the gap `shell: false` does not close. Fetch by explicit refspec with `--` and a fully-qualified source. **Fix round 1: the rule is stated per leg.** The first revision keyed it on `from.member` and located it in `lib/envelope.js` — B5's own carriage finding repeated, since `presence.update` is no envelope on the relay and the row's `branch` reaches the client through `lib/transport-relay.js`'s `sync.presence[]` map, unchecked. Now: ntfy checks the signed `from.member` in `lib/transport-ntfy.js`'s presence assembly, the relay checks the server-authoritative `member_id` in `lib/transport-relay.js`'s `presence()`, `lib/envelope.js` is left enumerating no body field, both transports enter V5's Touches, and §11.6 asserts both legs. **Second-look round (R2-1): the inbound pattern never narrowed with the branch model, and the outbound one did.** The rule was `^handshake/<id>/[A-Za-z0-9._-]{1,120}$`, written for one ref per claim; `{1,120}` makes the tail **mandatory**, and the branch model's `presence.update.branch` is the literal `handshake/alex`, so the receive boundary would have discarded **every legitimate peer branch** and G1 could have fetched nothing. §4.1 narrowed D1's outbound pattern to the single ref `refs/heads/handshake/<self>` at the simplification pass (*"the pattern narrowed with the branch model"*) and this half was left behind, inside text fix round 2 had edited. Both halves now name one exact ref, the member segment still matched against `[A-Za-z0-9._-]{1,120}` and no tail permitted, and the fetch target loses its `<branch>` component: `refs/handshake/peers/<member>` | §4.2 item 5, Appendix G1 (mechanism 1 + the guardrail's fetch ref), §10.5, §11.6, §14 item 35 |
| **M23** | `git rebase --dry-run` does not exist; the probe is **`git merge-tree --write-tree`** (git 2.38+). Real rebases happen in a dedicated worktree under the plugin state dir, with a startup sweep for abandoned worktrees, and fetch gets its own timeout. §12.3's safety claim re-grounded on a primitive that has the property it claims. **Fix round 3, three corrections to this row's own substitutes.** **(F2-10)** The probe was made the deciding fact and the replacement for `branch CI passing`, and it is a **proxy**: `merge-tree` composes two endpoints against a merge base where a rebase replays each commit, so a clean probe does not imply a clean rebase — measured, a net-empty endpoint diff whose intermediate commit conflicts gives `merge-tree` exit 0 and `rebase` exit 1. The plan had **no arm** for that case, and the instability counter counts head moves, so nothing would increment and the client would sit stacked-but-not-rebased. The arm is added — abort in the worktree, drop the stack, sequence, count against the bound — with the §10.5 test. *Two halves of the finding refused*: object accumulation, because §12.3 already triggers on a **changed head** and not a timer, so there is no cadence to accumulate against; and unrelated histories, unreachable when both branches are cut from the same `main`. **(F2-11)** The fallback is **withdrawn, not kept**: measured, on a real conflict `merge-tree --write-tree` exits 1 while `git apply --check --3way` prints *"Applied patch … with conflicts."* and **exits 0**, with or without `--cached` — a fallback that would report a dirty base as clean, under ruling D1's force-push, on the one branch nobody tests, since Ubuntu 22.04 LTS ships git 2.34.1 and both CI legs are above 2.38. Instead the V1 preflight gains a **fifth precondition** — `git --version`, recorded — and **below 2.38 the stacking capability is off** and says so. **(F2-7)** The sweep was specified *"in the shape `hooks/session-end.js` already uses for stale sentinels"*, i.e. an unlink — and verified, `rm -rf` on a worktree leaves it registered as `prunable`, keeps `.git/worktrees/<name>`, and **permanently blocks re-use of the path**, so on a deterministic path the first hard kill would disable peer evaluation for good. It is now `git worktree remove --force` followed by `git worktree prune`, and §10.5 gained the only test that discriminates the two: **the next probe at the same path succeeds**. **Second-look round, two corrections to item 32's own row.** **(R2-2)** Its value cell still said *"the V1 preflight records `git --version` as a fifth precondition"*, which this pass's S13 had already moved to G1's own first task and which §10.1, §12.6 and Appendix G's preamble all contradict; it now names G1's first task and says where it came from. **(R2-3)** A literal pipe inside inline code (`format-patch` piped into `apply --check --3way`) split the row into **six** cells against a five-column header — the only column mismatch in the document, pre-existing but sitting in the one row an owner reads to ratify a gated item; reworded rather than escaped. **And one thing that moved in the other direction:** §10.2's case-2 replay now needs `merge-tree --write-tree` too (G2-2), so the 2.38 floor is no longer stacking's alone — Stage 2(b) carries its own arm and turns case 2 off below it, without re-opening Stage 1's three preconditions | §4.2 item 5, Appendix G1 (mechanisms 2 and 3), §10.1 (preflight), §10.2, §10.5, §12.3, §14 items 32 and 50 |
| **M24** | `hooks/session-end.js` added to V1's Touches as the best-effort last-batch flush, inside its 3 s budget, with the monitor's hard-kill as the reason. **Headless sessions** say what they do — the batch rides the Stop-hook fallback at the transport keepalive — and say it in `status` the way the no-monitor arm already does. Subagents restated as already-correct. §2.3's *"§8 not amended"* qualified: the budgets stand, and the push takes a slice of Stop's existing deadline rather than extending it | §2.3, §10.1 |
| **M25** | Credentials, signing and forge rejection addressed: the push reuses the human's git credentials, is never given its own, and **fails rather than prompts** (`GIT_TERMINAL_PROMPT=0` is already set); the V1 preflight proves it with `git push --dry-run`; `commit.gpgsign` is checked and either overridden per-commit or the opt-in refuses; a **`rejected`** arm distinct from offline, because the `push refused` notice literal already means the secret-scan refusal | §10.1 |
| **M26** | §11's preamble states per-leg expected results and §11.3/§11.4 carry them: relay is zero human turns, ntfy is one `handshake seam pull` confirmation per inbound revision per receiving side. §6.4 states the same in prose. §12.7 gains the bullet: **autonomous contradiction resolution is a relay-tier capability**. **Fix round 1:** the preamble's *"they differ in exactly one place"* was falsified by §11.6's own per-leg security result, so it now names **two** — the contradiction protocol, and `from` being server-authoritative on the relay and self-declared on ntfy (which is also why M20's branch check keys on a different id per leg). **Fix round 2:** a tally invites the next miscount, and §11.5 held a third per-leg result the count had missed — `· older chatter gone` `[C hooks/render.js:70]`, which renders on ntfy and nowhere else. The clause became a **scope** rather than a tally: two differences change a *pass criterion*, one changes only what renders. **Fix round 3 (R2-4):** that replacement went one phrase too far — it said the third changes *"only what renders **and no criterion**"*, and the line sits inside §11.5's **Asserted** paragraph, which is where this document's pass criteria live, so it **is** a per-leg criterion. The clause now says what is true of it: it changes only what is **rendered**, not what either leg must **achieve**. Three passes on one sentence is itself the lesson — the first two were corrected for over-claiming a count, and the third for over-claiming a kind | §6.4, §10.6 (tests), §11 preamble, §11.3, §11.4, §11.5, §11.6, §12.7 |
| **M27** | Three re-anchorings. `branches-ignore` moved into **V1**. The secret-scan false-positive trigger moved to **V4** with counters in V4's Delivers, since V1's commits carry filtered shard text and not code diffs. The outcome-corpus cut trigger moved to a window **after V8**, since V8 creates the kind and the rule could otherwise only ever fire. §10.2 and §12.2 corrected to claim only what each rung can raise | §10.1, §10.2, §10.4, §12.2, §12.6, §14 items 4, 14, 16 |
| **M28** | Four gaps closed. **Mutual stacking**: the lexicographically smaller member id never stacks, reusing the frozen comparator `[proposed]`. **Vanished peer**: base-claim expiry (presence `gone`, never `stale`) becomes a third resume trigger, so item 24 is release, done, **or** the base claim expiring. **Rewritten or deleted base**: one stack-invalidation rule covering the peer's own lease-protected rewrite, a human's rewrite and a deletion. **Nested stacks**: not permitted, stated | §4.1 (D1 rule 2), Appendix G1, §9, §10.5, §14 items 24, 33, 34 |
| **M36** | The card renders the symbol's **discriminating tail** (`Handler.shape`) through the existing 20-char slot, because `escapeSlot` ellipsises and the path is what survives otherwise; the **full `path::Symbol.member` prints on the PreToolUse gate line**, which has no 600-char budget. §11.1's assertion rewritten so it cannot pass vacuously, and a V3 test pins the entry's content | §2.4, §5.3, §7.1, §10.3, §11.1, §14 item 9 |
| **M37** | A **total order over seven kinds** with safety first — rotation demand, private-repo guard, push refused, escalated, conflict, rebase needed, round open — replacing a four-kind order that did not know the channel already has three producers seeded ahead of it. *(The simplification pass took it to eight, adding **own claim expired** at rank 6, and marked which ranks the committed slice populates.)* The bare `.slice(0, 2)` becomes a **sort by rank**. §2.4's "four kinds into two slots" corrected to seven. Test: a rotation demand plus two coordination notices still renders the rotation demand | §2.4, §10.3, §14 item 22 |
| **M40** | A **`SKILL.md` row in §2.4** with the per-stage line-count delta, the per-engagement token total against the 410-line baseline, and a **480-line ceiling that gates every rung**. Progressive disclosure through the existing `references/` for the stack tree, the contradiction discipline and the capability semantics, leaving trigger conditions in `SKILL.md` proper. V3, V5 and V6 carry the split; V3's tests carry the gate | §2.4, §10.3, §10.5, §10.6, §14 item 37 |
| **M44** | A **ref-name sanitizer** separate from `shardFileName`: strip a trailing `.lock` from every slash component, reject a component beginning with `.`, reserve `state` as a member-component name, and validate with **`git check-ref-format --branch`**. The two verified failures — `alex.lock`, and a member sanitizing to `state` colliding with `refs/heads/handshake/state` — stated. V4's test asserts against `check-ref-format`; both cases join V9's corpus | §10.4, §11.6, §14 item 2 |
| **M46** | A `+N !` overflow literal on the notices channel, ~4 chars inside the computed headroom, priced in Stage 2's gate, recorded beside item 22 which is what creates the need. Grounded in `plans()`'s own comment that silently dropping them is the *"reported a truncated read as an empty one"* failure | §2.4, §10.3, §14 item 31 |

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
| **R10** | The **cut-trigger rates of §12.4 and §12.6 are *per pair* by construction** — a seam names exactly two members, grants are per-peer, branches are per-member — so *one per pair per working day*, *less than once per pair per week* and *one month of two-pair use* are scoped to two members and would need re-basing if the stage ever grew past two. Stated so the denominator is not read as workspace-wide (the review's refuted table left this line unwritten) | §12.4 *(now Appendix G2's risk)*, §12.6, gated items 15, 16, 27 |

### Simplification pass (2026-09-02, owner direction)

**The owner said, verbatim:** *"this became so complex. we went from v2 to v7.
anyways, i want less friction. adopt the smoothening and lastly i hope there not
too much of branching, we realise that at the end of day there are 10 different
branches just sitting there. that would be a hassle then solve a simple
problem"*. **Three asks, all decided, none of them `[proposed]`:** less
complexity, less friction, less branching. Rulings D1 and D2 and the decisions
brief are unchanged and unweakened by any of them. What is `[proposed]` is how
this plan discharges each — §14 items 45–52, and the design choices marked inline
in §4.1, §4.2 item 4, §10.2 and §10.4.

**Nothing was deleted from the design.** Four rungs, three acceptance scenarios,
two risks and twenty-one `[proposed]` rows **moved** into Appendix G, in full,
with their tiers, tests, notices and smoothings. Three rows were deleted, and
each of the three was deleted because the mechanism it described no longer
exists.

| # | Move, removal or addition | Why | Where it landed |
|---|---|---|---|
| **S1** | **The eight V-rungs became three stages and a run.** Stage 1 = the state branch (old V1). Stage 2 = the live view, merging old V3 (declared symbols) and old V4 (the work branch and the scan) into one stage with two halves. Stage 3 = gate and release (old V9 + V10, now a section rather than two table rows). The run = old V2, moved to after Stage 2 | Owner ask 1. Eight ordinals were the visible face of the complexity; three stages and a run is the smallest true description of what is being committed to | §10 entire, §10.5's task table |
| **S2** | **V5, V6, V7 and V8 moved to Appendix G as G1–G4**, verbatim, each with its Why / Delivers / Touches / Wire / Tests / Tier intact | Owner ask 1, discharged by gating rather than cutting: a cut design is re-derived by someone who was not in the room; a gated one is written down and has a stated condition for being wanted | Appendix G1–G4, *"the rung"* subsections |
| **S3** | **Their cut triggers were re-read as ENTRY triggers**, and where the first draft had no cut trigger the entry threshold is this plan's own: G1 ⇒ same-symbol collisions blocked work > 3 times in the run — **a new number, because nothing in the first draft would ever have cut stacking**, so it is **[proposed]**; G2 ⇒ ≥ 1 true requirements conflict (§14 items 27 and 15, and a more permissive bar than either rate); G3 ⇒ > 1 narrow opt-in exists (item 19's structure, never a rate); G4 ⇒ there is a corpus to rank (item 16's rejection as a gate — item 16's 20-row number stays put, cutting the ranking inside G4) | The first draft asked *what would remove this rung*; the owner's direction reverses the burden to *what would earn it* | §10.4's trigger table, each G's **Entry trigger**, §14 item 52 |
| **S4** | **§11.2 (stack), §11.3 and §11.4 (contradictions) moved to Appendix G** beside the rungs they accept; §11's committed scenarios renumbered 11.1 (coexist), 11.2 (absent peer), 11.3 (security) | An acceptance scenario for a rung nobody was told to build is a test that cannot fail | Appendix G1, G2; §11 |
| **S5** | **§12.3 (rebase churn) and §12.4 (escalation fatigue) moved** with G1 and G2 | A risk section for a mechanism that does not exist prices nothing | Appendix G1, G2, *"the risk"* subsections |
| **S6** | **Twenty-one §14 rows moved** to Appendix G's own *Proposed, gated* list (7, 8, 10, 11, 12, 13, 15, 16, 19, 20, 23, 24, 25, 27, 32, 33, 34, 35, 36, 38, 42), keeping their numbers | So the owner's ratification pass covers Stages 1–3 and nothing else. Numbers kept rather than renumbered so §15's own cross-references still resolve | Appendix G, *Proposed, gated* |
| **S7** | **One work branch per member, `handshake/<member>`, reused across every claim.** A claim is state, never a ref. **Two people means two work branches plus one `handshake/state`: three refs, forever** | **Owner ask 3**, verbatim: no pile of branches at the end of the day. **It supersedes a settled value:** decision 3 fixed this branch as `handshake/<member>/<subject>`, one ref per claim — the owner's direction of 2026-09-02 replaces that shape and nothing else in decision 3, which §4.1 now states beside the floor table so an audit against the decisions brief does not read the change as a drafting slip. **Second-look round (G2-14): *three refs, forever* is true of `git branch -r` and not of `git branch`.** The tool writes with `update-ref` as well as pushing, so a member's own clone also carries the local `handshake/state` and `handshake/<self>` — measured, `git branch -r` is the promised three plus `origin/HEAD` while `git branch` is `handshake/alex`, `handshake/state`, `* main`. The **bound** survives (two handshake refs in your own clone, forever, never the peer's), so the owner's ask is not falsified; what was missing is the clause, and it is now in the opt-in text, the cloner README, `scrub`'s listing — where the only delete command spelled out was the remote one — and §14 item 47(e) | §4.1 (floor table + the supersession note + the sentence + the local-refs paragraph), §4.2 item 3's opt-in text, §4.3 (`scrub`), §10.2, §14 item 47 |
| **S8** | **The re-root after merge**, with **a gate and three detection arms**, commits after the merged head **replayed and not discarded**, and the previous head written to the member's shard as a **recovery pointer** first. **Rewritten at the second-look round on five counts, and it is the largest correction of that round** | Follows from S7: a long-lived branch that never re-roots replays merged work into every later claim's live view. The detection, the replay and the recovery pointer are `[proposed]`. **What the second look found, all five in a committed stage.** **(G2-2, blocker)** Case 2 said *"rebased onto the new base"*, and a rebase is a checkout — the thing §10.1 spends a subsection preventing, and the thing §5.4 says in so many words. Measured: `git rebase --onto` moves the human's `HEAD` onto the tool's branch on a clean tree, detaches it and writes `<<<<<<<` markers into the shared working tree on a conflict (so *"leaves the branch exactly where it was"* was true of the ref and false of the checkout), aborts mid-rebase on an untracked collision, and refuses outright on a merely dirty tree. Replaced with a checkout-free replay — `merge-tree --write-tree` + `commit-tree` per commit, one `update-ref` — measured to leave `HEAD`, `symbolic-ref` and `status --porcelain` byte-identical and to carry `[skip ci]` through. **(G2-3)** The merged-PR arm's `headRefOid` **equality** could not fire in the ahead-of-merged-head case at all: the tool records one head per ref (D1 rule 1) and it is always the current head, so the equality holds only in case 1 — the case-2 specification was dead as written. Replaced by a local ancestry proof, which needs no new state (measured 0 / 1 / 128). **(G2-4)** There was no forge-agnostic squash arm, so every GitLab, Gitea and self-hosted pair — the population §4.2 item 2 branches its refusal to admit — never re-rooted a squash, and the human's next PR re-proposed the merged hunk (measured, with a conflict against an unrelated hotfix). Added a local tree-equality arm, with its bound stated: it goes blind once the default branch moves past the squash. The finding's `git cherry` suggestion is **refuted** — measured, `+` for all three commits of a multi-commit squash. **(G2-9)** `<default>` was written bare everywhere, and nothing fetched it: measured, a fetch moves `origin/<default>` and never the local branch, so arm (a) and both counters read a ref only a human's `git pull` moves — and the dangerous half is that arm (c) is *fresh* while the base it rewrites onto is stale, which produced a replay that dropped the merged commit. Every site now names `refs/remotes/origin/<default>`, rule 1's fetch carries its tip as a second refspec on the same round trip, and the counters have an *"unknown — not fetched this session"* arm. **(G2-12)** Arm (a) is a level condition where the design needs an edge: measured trivially true for a branch with no commits of its own, and reflexive, so an unrelated merge fired a re-root and a re-rooted branch re-fired forever. Gated on `rev-list --count <recorded base>..<branch> > 0`, with the recorded base updated by the re-root itself. **U2-2 is closed by G2-3 and G2-4 together** | §4.1 (a below-the-floor row), §2.5, §10.1 (rule 1's second refspec), §10.2, §10.4 (question 5), §11.2, §12.1, §12.6, §12.7, §14 items 43 and 50 |
| **S9** | **Old §14 item 30 — "one active work branch per member" — DELETED** | Structurally answered by S7: there is one branch, so there is nothing to choose between. The friction it created (a claim's live view silently freezing when a second claim is acquired) is deleted with it | §10.2 |
| **S10** | **Old §14 item 2's per-claim name shape DELETED; the row rewritten** to `handshake/<member>` with a **member-segment-only** ref-name sanitizer | The `<subject_key>` component is gone, and with it the traversal corpus it carried. The `state` reservation gets *stronger*: it is now a direct collision, not a prefix one | §10.2, §14 item 2 |
| **S11** | **`[skip ci]` in every commit the tool writes, replacing the CI precondition entirely.** The `branches-ignore` edit, the copy-pasteable `on:` snippet, the "PR someone else must merge" step, this repository's own `ci.yml` change, and **old §14 items 4 and 44 are all DELETED** | **Owner ask 2.** The precondition cost a pair a pull request in a repository they may not merge into, and it left `pull_request`'s `synchronize` open, which the PR-open suspension then closed by freezing the live view. One string in a commit message closes both doors and asks nobody for anything. Verified against GitHub's and GitLab's own documentation on 2026-09-02 | §4.2 item 4, §10.1, §10.2, §12.1, §12.5, §12.7, §14 item 51 |
| **S12** | **The PR-open push suspension DELETED everywhere** — §4.2 item 4, §10.4's Delivers/Touches/test, §12.5's third residual, §14 item 44 | It exists only to close a door `[skip ci]` closes better, and it froze the live view at the moment two people were most likely to be watching it | §4.2 item 4, §10.2, §12.5 |
| **S13** | **Stage 1's preflight went from FIVE preconditions to THREE**: the visibility verdict, a non-interactive `git push --dry-run`, and `commit.gpgsign` resolved | The CI filter is gone (S11); the recorded `git --version` gated only stacking and moved to G1's own first task. What is left is three questions about this machine, none needing another person. **Qualified at the second-look round:** *"gated only stacking"* stopped being true when S8's re-root gained a `merge-tree --write-tree` replay (G2-2), which has the same 2.38 floor. **The three preconditions are not re-opened** — Stage 2(b) reads `git --version` where it needs it and turns **case 2** off below 2.38 with a rule-3 line, while case 1 is an `update-ref` and works at any version — so the preflight still asks three questions and the version question is answered by the two rungs that actually depend on it | §10.1, §10.2, Appendix G1, §14 items 32 and 50 |
| **S14** | **§4.4 is new: the three visibility rules**, asserted in **every** stage's Tests — (1) every automated action that changes what the human will see leaves one line, sharpened into an always-populated `push:` field with a closed nine-word vocabulary; (2) every refusal names its cause and its next move; (3) every capability that is off says so with its cause, **derived locally** | **Owner ask 2.** The failure a walk through this plan kept finding: the tool does a great deal the human cannot see, and when it does less than promised it does not say why. **Two of the landing sites were named here before they existed** — §10.3's and §11.3's blocks were written in this pass's first fix round, after the review found the claim *"every stage's Tests"* asserted in three places and discharged in two. **Second-look round (U2-3), two corrections to rule 1's own vocabulary.** **(i)** The nine words were asserted **whole in Stage 1**, and two of the nine — `refused — secret scan, <file>` and `no recorded lease` — need the scanner and D1's force-push helper, both Stage 2's, so rule 1's own *"a state reachable by no test is a state that may not ship"* forbade Stage 1 from shipping them. The vocabulary is now **owned per stage** (Stage 1 seven, Stage 2 three more) and the test clause binds against the owning stage's subset. **(ii)** A **tenth word** was missing for the state this pass's own change creates: with `[skip ci]` on every tool commit, §4.2 item 4's remedy tells a human to push a commit of their own onto the work branch, after which — measured — a plain push is rejected non-fast-forward and the lease push *"stale info"*, and neither `no recorded lease` (the record parses) nor `rejected — forge ruleset` (there is no ruleset) is true of it. `paused — remote head is not the one this tool pushed`, with its own next move under rule 2, and the re-root does not run on a paused branch. §10.3's doc assertion and item 47(d) now say ten | §4.4, §10.1, §10.2, §10.3, §11.1, §11.2, §11.3, Appendix G1, §14 items 47 and 48 |
| **S15** | **Every smoothing from the friction walk folded in**, each in the stage or gated rung it belongs to. Committed: `scan-allow` shipped with the scanner · the three-arm visibility refusal · the opt-in/INSTALL/README/`USAGE`/`scrub`/SKILL-275 text · the overlap short form · `deferred (no time in the beat)` · the gpgsign/forge two-arm refusal with a re-probe · own-claim-expired · the drift notice · never-pull-this-branch · `branches`' size and age lines · OneDrive detection · `doctor`'s hook comparison · the headless clause · the fetch-duration and `truncated` line · `alex says:` on the gate line · late-not-lost · the installer's expected-result sentence · the digest-eviction measurement · the 480-line ceiling · **the `+N ! <highest hidden kind>` overflow marker**. Gated: the `sequenced:` detail and its override sentence · `branches --fetch` at a stack decision · the ntfy tier limit in the prompt · the escalation deadline · the expiry outcome record written from G2 · `base abandoned 6d` · learnings ranked above outcomes · named worktrees · the stack-vs-sequence table staying in SKILL.md proper | **Owner ask 2**, *"adopt the smoothening"*. Nearly every one is a line of text rather than a redesign, which is why they all fit. **One lands committed although the friction walk filed it against a gated rung** — the `+N ! <kind>` marker: the eight-kind rank order ships whole in Stage 2 (§2.4) and the committed slice populates three of its ranks, so the marker can already hide a kind there, and naming it is one literal on a surface Stage 2 builds anyway. A stated departure from the walk's own filing, not from the ask. **One was walked back at the second-look round (G2-8):** *"`branches`' size and age lines"* promised `alex: 41 commits not in main, 6 days old` **per member**, asserted as a §11.2 pass criterion — and nothing in the committed slice can compute it for a peer. Verified: after the exact-refspec state fetch, `ls-remote` gives the peer's **sha** and this clone does not have the **objects** (`cat-file -e` absent, `rev-list --count` exit 128, `git log -1` bad object), and fetching them is inside §4.1's G1 row. The own-branch line stays, derived locally against `refs/remotes/origin/<default>`; the peer's becomes a rule-3 line that says what it can prove and what it cannot — `alex: work branch present at <sha> — commit count and age need the peer's objects (fetch gated, G1)`. The alternative (a counting-only carve-out of the G1 row, on the ground that counting is not building) is recorded in §14 item 6 rather than taken, because it would import a peer-branch fetch, its receive-boundary validation and a §2.5 row into the slice this pass was asked to shrink | §4.1 (row 5), §4.2, §4.4, §10.1, §10.2, §11.2, §12.1, §12.2, §14 item 6, Appendix G1 and G2's *"plus the smoothings"* blocks |
| **S16** | **§2 recounted for the committed slice**: three concepts (was six), three user-met surfaces (was four), three verbs + one flag, **one** wire delta (was two), three refs, three preconditions, `SKILL.md` at ≤ 430 of 480. Gated numbers kept beside them | Owner ask 1: the count is the argument, and a count that includes what is not being built is not an argument | §2.1, §2.2, §2.3, §2.4, §2.5, §12.6 |
| **S17** | **§§5–9 kept in place with a gate note at the head of each gated subsection** — §5.4, §6, §8's outcomes bullet, §9's table — and a `Built?` column added to §5.5's and §9's tables | The design belongs where it was argued; what changed is the commitment, and a reader must be able to see which is which without leaving the section. **Amended at fix round 2 by S20**, which draws the line one notch finer: the *argument* for a gated rung belongs where it was made, its *plumbing* belongs with the rung — the distinction S19 had already applied inside §4.2 and this row did not carry, which is why 225 lines of G1 mechanism sat in §5.4 with no stated reason for being different | §5.4, §5.5, §6, §7.3, §8, §9 |
| **S18** | **Eight new `[proposed]` rows (45–52)** for the choices this pass made inside the owner's three asks | A choice marked inline with no row is a marker that does nothing — the rule §14 already states about itself | §14 |
| **S19** | **§4.2 item 5's mechanism moved to Appendix G1 with the rung; the floor rule stays in §4.2.** The four gates — the namespaced fetch ref, the throwaway worktree and its three fix-round-3 mechanics, the locally derived allowlist with its mode rule and instruction/build floor, and the no-build rule — are now stated once, in G1, verbatim. Item 5 keeps the threat and the requirement (*"G1 ships with four gates or G1 does not ship"*) and points at them | The same rule as S2, applied to the one gated thing that was left behind: a mechanism for a rung nobody was told to build reads as committed work when it sits in a committed section, and 116 lines of it inside §4 is a third of the committed growth this pass otherwise apologises for. Nothing is lost — G1 cannot ship without it, and §4.2 still states why it is *required* rather than optional | §4.2 item 5 (short form), Appendix G1's *"Its own guardrail, in full"* |
| **S20** | **§5.4's four mechanisms moved to Appendix G1** *(fix round 2)* — the receive-boundary branch validation with its per-leg table, the `merge-tree --write-tree` probe with its proxy gap and its git 2.38 floor, the throwaway worktree with the sweep that is a git operation rather than an unlink, and ruling D1's lease-protected push, with the ordering rule, the nested-stack refusal, stack invalidation, sequence and its three resume triggers underneath it. **Nothing rewritten**: the block is verbatim apart from its heading and six internal pointers that now read *above* / *below* instead of naming the appendix from outside it. §5.4 keeps the case (c) argument, the five facts, the departure from decision 4, the negative rule, the bound on the peer's own words, the missing `branch CI passing` fact and the discriminator — plus a pointer saying what left and why | **S19's rule, applied once more to the largest gated mechanism still standing in a committed section.** 225 lines of G1 plumbing that a reader of the committed slice had to get through for a rung nobody has been told to build, and §12.6's *what would make me cut* list gave no reason why a gated mechanism in §5 is different from the one S19 moved out of §4.2. It is also the only instrument this pass has for owner ask 1 that deletes nothing: the committed body drops from 4,600 lines to 4,432 | §5.4 (short form + pointer), Appendix G1's *"G1's four mechanisms"*, §14 items 12, 24, 32, 33, 34, 35 (Where cells), §15's D1, M19, M20, M23 and M28 rows, and the reading note above |

**One thing this pass could not do, and it is worth naming.** The owner's ask was
partly about *feel* — ten branches sitting there, friction, complexity — and the
only instrument this document has for feel is the run (§10.4). S7 and S11 remove
two of the three complaints by construction and can be checked on paper; S14's
three rules cannot. Whether the tool now says enough is the question the run
answers, and it is the reason §10.4's Delivers carries a written verdict per
trigger rather than a checklist tick.

**And one thing this pass did not achieve, stated with the numbers rather than
left for a reader to measure.** Every *commitment* count went down — eight rungs
to three stages, six concepts to three, two wire deltas to one, five
preconditions to three, twelve refs to three — but **the committed slice a
reader must get through is still longer than the pre-simplification document's
equivalent**: **4,855 lines against about 3,580**, roughly a third more, and well
above that document's 4,012 lines *in total*. The additions are the ones
this table records as required — §4.4 and its per-stage assertions, the branch
model and the re-root, `[skip ci]` replacing the precondition, the smoothings,
this record itself. Three moves gave length back without giving up a
commitment — S19 (~116 lines), **S20 (~210)** and a pass over the `[skip ci]`
argument, stated once in §4.2 item 4 and cross-referenced from §12.5 (~100) —
which is how the committed body came down from **4,620** at the end of the
simplification pass to **4,432** before the second-look round. **That round then
put ~415 lines back**, and the number is restated rather than left standing
because a stale count is the failure this paragraph exists to avoid: the
re-root's rewritten detection and its replay mechanism, the `hash-object -w` and
add-mode arms, D1's create arm, the per-stage `push:` vocabulary and its tenth
word, the peer-branch line, and this round's own §15 rows. Every one of them
corrects something that was wrong rather than adding a commitment — no rung, no
verb, no wire delta and no ref was added — but the length is real. The honest
position is still that **the plan commits to less and explains it at greater
length**, and the second half of that is a debt against the next pass rather than
a thing this one closed.

---

## Appendix G — Gated on the run

**What this appendix is, and what it is not.** It is the four rungs the first
draft committed to and this pass does not: stacking and sequencing, the
contradiction protocol, the trusted-pair capability table, and coordination-outcome
records. **Nothing here was cut.** Every mechanism, every test, every tier, every
notice, every `[proposed]` choice and every smoothing that belonged to these rungs
is present, moved rather than rewritten, and the design sections they depend on
(§5.4, §6, §9, §8) stayed where they were with a gate note at the head — with
**one exception, taken at fix round 2**: §5.4's four mechanisms are *here*, in
G1, because they are the rung's plumbing rather than its argument (§15 S20).

**What changed is the burden of proof.** The first draft's instrument was the
*cut trigger*: build it, and remove it later if a measured rate is too low —
which it wrote for some of these rungs and not for others. This appendix carries
an **entry trigger** instead: do not build it, and build it if the run shows the
thing it exists for. That reversal is the one the
owner asked for on 2026-09-02. **The direction is inverted; the thresholds are
not all inherited, and pretending otherwise would hide the one number this pass
invented.** G2's condition is the first draft's own — §14 item 27's
contradiction rate and item 15's escalation rate, read from the other end — and
G2's own paragraph says the entry bar is, if anything, the more permissive of
the two. G3's is item 19's *structure* read as a gate; there was never a rate
there to invert. G4's is item 16's rejection restated as a gate, **not** item
16's number: the 20-row threshold stays exactly where it was, cutting the
*ranking* inside G4 rather than admitting the rung. **G1 had no cut trigger in
the first draft at all** — nothing in it would ever have removed stacking — so
its *more than three times* is this pass's own number and carries **[proposed]**
for that reason (§14 item 52).

**How to enter one.** The run (§10.4) produces one written verdict per trigger —
fired or not fired, with the number that decided it. A rung whose trigger fired
is built next, at the tier its section states, under the same gates as the
committed stages: the `SKILL.md` ceiling of §2.4, the block re-measurement of
§2.4, the three visibility rules of §4.4, and — for G1 — the fifth guardrail of
§4.2, which is a precondition of the rung and not a part of it.

**Two dependencies that live here rather than in §10.** **G1 needs a git 2.38
precondition** that Stage 1's preflight no longer carries: `merge-tree
--write-tree` is the probe, there is no working fallback (G1 mechanism 2), and
below 2.38 the capability is off and says so. Recording `git --version` becomes
G1's own first task. **G2 is blocked on `[COBUILD-PLAN §3.S0-S2]`**, which are
unratified — so G2 has two gates, its entry trigger and a ratification that is
not this plan's to give.

### G1 — Stacking and sequencing

**Entry trigger.** **Build only if the run shows same-symbol collisions actually
blocking work more than [proposed: 3] times across the working day.** Not
same-file overlaps — Stage 2(a)'s declared symbols handle those, and §11.1 is the
scenario for it. Not a collision the pair noticed and worked around in a minute:
*blocked* means one side stopped, waited, or duplicated work because the other
held the method. Three is the number below which two people talking is cheaper
than a protocol with a worktree, a probe, an instability counter, an ordering
rule, an invalidation rule and a fifth guardrail.

**Its own precondition, moved here from Stage 1's preflight.** `git --version`
recorded, and **below git 2.38 the whole capability is off** and says so in
`status` and `handshake branches` (§4.4 rule 3) — because `merge-tree
--write-tree` is the probe and the only fallback anyone reaches for exits 0 on a
real conflict (mechanism 2 below). Ubuntu 22.04 LTS ships git 2.34.1, so this is
not a theoretical branch.

**Its own guardrail, in full — the four gates of §4.2 item 5.** Fetched peer
content is untrusted data that can also execute. §4.2 item 5 states the floor
rule and why it is required; these are the gates it requires, and they ship with
this rung or this rung does not ship, at Opus xhigh. Stage 3's red team gains the
fetched-content corpus the moment they do, and §13.6 names what `SECURITY.md`
then has to say. Four gates, of which the third is itself three rules after fix
round 3:

- **Fetch into a namespaced local ref, never onto a local branch and never
  into the live tree.** `refs/handshake/peers/<member>` **[proposed]** — one ref
  per peer, since the branch model leaves no `<branch>` component to nest
  (narrowed at the second-look round with mechanism 1's pattern, R2-1) —
  by explicit refspec, with `--` and a fully-qualified `refs/heads/...` source
  (mechanism 1 below states the validation the branch string passes first).
- **Evaluate in a throwaway worktree under the plugin's state directory**, not
  in the human's checkout — the 0700 per-workspace directory `lib/state.js`
  already owns `[C lib/state.js:75-82,86-89]`. The plan already knows the
  no-checkout technique and uses it for the state branch (§4.3); this is the
  same instinct applied where a checkout genuinely is needed.
  **Three mechanics added at fix round 3, because *"not in the human's
  checkout"* invites three assumptions that are false.** (i) **It is created
  last, not first.** The path rule below and the `merge-tree` probe (mechanism 2
  below) are both checkout-free — a path rule reads
  `git diff --raw <base>..<peer-head>` and the probe is *"non-mutating, no
  worktree, no `HEAD` movement"* (§5.4) — and either can refuse the whole
  operation, so the worktree is created **only for a real rebase**, after
  both have passed. This rung's own acceptance scenario below orders it
  worktree-first and is corrected there. (ii) **`git worktree add --no-checkout` plus a sparse
  checkout of the touched paths**, where a full tree is not needed. (iii)
  **`-c core.longpaths=true` on Windows**, on the `add` *and* on the removal
  of mechanism 3 below: the plugin state root is
  `%USERPROFILE%\.claude\handshake\<32 hex>` `[C lib/state.js:58-65]`, so a
  repo with a deep tracked path fails the checkout with `Filename too long`
  against the 260-character default — and, verified at fix round 3 on
  git 2.53, `git worktree remove --force` fails the same way, so the sweep
  cannot clean up what the add left behind. Without the flag G1's inbound
  stacking silently does not happen on the owner's own platform for any repo
  with a deep tree. And **`git worktree add` writes into the human's
  `.git/worktrees/`**, so plugin scratch trees do appear in the human's own
  `git worktree list` — the human's *working tree* is untouched, their
  *repository* is not, and this bullet used to let a reader assume both.
- **The automatic rebase runs only on an allowlist of path shapes, and
  refuses on anything else** **[proposed — gated item 36, rewritten at fix
  round 3]**. The first revision wrote this as a **denylist** — `CLAUDE.md`,
  `.claude/**`, `.github/**`, `.handshake/**`, `package.json` scripts, any
  lockfile, `Makefile` — on the one surface where §4.3 argues for the
  opposite, in the same words this bullet needs: *"Allowlist, not denylist,
  on the path the tool writes without a human."* The list is also the one
  denylist among this plan's allowlists — the state branch's path allowlist
  (§14 item 1) and the work-branch commit's `files[]` filter (§10.2) — and it
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
  notice (rank 7, §2.4) and the human deciding. Locally derived is the
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

**No cut trigger to invert, for the record.** The first draft would never have
removed stacking — it carried no cut trigger for this rung — so the entry
trigger above is this pass's own number and carries **[proposed]** for that
reason (§14 item 52).

#### G1's four mechanisms — how the fetch and the probe actually run

**1. The peer's branch string is validated at the receive boundary, before it is
ever a git argument.** `branch` is free text, *"string | MAY | ≤ 200 chars"*
`[C docs/PROTOCOL.md:295]`, and G1 feeds it to `fetch`. `lib/repo.js` passes argv
straight to `spawnSync` with `shell: false` `[C lib/repo.js:52-54,60-67]`, which
closes shell injection and **not option injection** — a `branch` of
`--upload-pack=...` is a flag, not a ref. This tree already fixed this class once:
`shardFileName` derives a filename from a member id rather than accepting one
`[C lib/workspace-files.js:287-298]`, and this plan cites that discipline four
times. So: a peer branch is accepted only if it is **exactly**
`handshake/<the authenticated sender's member id>` **[proposed]** — the single
stable ref per member the branch model produces (§10.2, §14 item 2) — with the
member segment matched against `[A-Za-z0-9._-]{1,120}` and **no tail permitted**;
anything else is **discarded and counted**, the posture `[COBUILD §7.2]` sets for
every receiver-side check.
**The pattern narrowed with the branch model, in the same words §4.1 uses for the
outbound half, and it did not until the second-look round (R2-1).** This rule was
written as `^handshake/<id>/[A-Za-z0-9._-]{1,120}$` for `handshake/<self>/*`, one
ref per claim; `{1,120}` requires at least one character after the slash, so
against the branch model's actual `presence.update.branch` — the literal
`handshake/alex` — the receive boundary rejected **every legitimate peer branch**
and this rung could have fetched nothing at all. §4.1 narrowed D1's outbound
pattern to the single ref `refs/heads/handshake/<self>` at the simplification
pass and the inbound half was left behind; both halves now name one ref.

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
of §4.2 item 5. A G1 test: a peer branch named `--upload-pack=…` is refused
**with no git process spawned** — run on **both** legs, because one leg's
mechanism is not the other's.

**2. There is no `git rebase --dry-run`, and the first draft depended on one.**
It made *"a clean rebase dry-run"* one of five facts, the replacement for the CI
verdict, the basis of G1's risk section's *"a dirty result costs nothing and leaves the local
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
head moves again. The rung below carries the test, and gated item 32's row carries the
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
compose, void G1's *"a dirty result costs nothing"*, and do it underneath
ruling D1's force-push. **So the fallback is withdrawn as a probe and the
capability is refused instead** **[proposed — gated item 32]**: **G1's own first
task** is `git --version` probed and recorded — it was Stage 1's fifth preflight
precondition until the simplification pass moved it here, because stacking is the
only thing it gates — and **below
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
`-c core.longpaths=true` on Windows for the reason the guardrail block above
gives, and it is
one of the three things the sentinel unlink at session end is *not*. G1's
existing tests do not discriminate the two implementations — a `rm -rf` passes
both *"a worktree abandoned by a kill is swept"* and the `git status
--porcelain` invariant, since the administrative directory lives inside `.git`
— so G1 gains the test that does: **the next probe at the same path
succeeds.**

**Which process runs all of this, in one clause, because §2.5's `ls-remote` row
put the question there.** The refspec fetch, the worktree, the probe, the rebase
and the sweep are **off-hook work on the monitor's own clock**, and are
**skipped entirely when there is no monitor** — G1's Touches put the poll on
`monitors/heartbeat.js` (the rung below) and none of this is hook work. On the no-monitor
Stop-hook fallback only the peer-head `ls-remote` rides the beat, at §2.5's
2,000 ms row. That is what keeps `GIT_NETWORK_TIMEOUT_MS` off every hook path,
and it is the sentence fix round 2 removed when it corrected the `ls-remote`
row.

**4. Pushing the rebased branch is ruling D1's carve-out and nothing wider.**
Rebasing rewrites commits this tool already pushed, so the local branch and the
remote diverge and a plain push is refused; the only way to keep the live view
live is `push --force-with-lease=<ref>:<the sha this tool last pushed>`, on
`refs/heads/handshake/<self>` and no other ref. §4.1 has the ruling, the rationale and
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
change. It is stated once here and §4.1, §5.4 and §10.2 point at it rather than
restating it.

**Sequence.** If the peer's branch is too unstable to build on — the honest
signal being a merge-tree probe that does not apply cleanly, or a head that has
moved more than **[proposed: 3]** times since my last successful rebase — my
Claude **does other work** and resumes automatically. This is decision 9's kept
idea, dependency-as-events, and it needs **no new type at all**: the events exist
and are already rendered `[P§3]` `[C lib/envelope.js:41-45]`.

**What resumes it: three triggers, not one.** The first draft said `task.release`
or `task.done` *"and on nothing else"*, hardened by gated item 24. That is a
deadlock in the commonest abandonment there is: a closed laptop emits neither
event, the claim merely expires by TTL, and a sequenced Claude waits forever with
nothing told to anyone — which defeats §5.4's own criterion, *nobody leaves,
nobody idles, no human is asked*. **So the third trigger is the base claim expiring** — the claim's own TTL
`[P§5.3]`, which every client already computes from data it already holds
`[C hooks/common.js:566-568]`, or equivalently the peer's presence reaching
`gone`, whose threshold **is** the default claim TTL `[P§4.3]`. **Never
`stale`**: on the relay a peer is `stale` after 360 s of silence `[P§4.3]`, and a
trigger at that age would let a coffee break hand a live task to the other
Claude. No wire change, no new state, and it closes the deadlock. The rule is
therefore: *a sequenced task re-evaluates on the peer's `task.release` or
`task.done` for that `subject_key`, **or** on the base claim expiring (presence
`gone`), and on nothing else* — in particular never on a peer note saying the
work is finished (the rung's Tests below), and never on `quiet` or `stale`.

**But "resume when this arrives" is new local behaviour, introduced here, and no
existing rule has its shape.** It is worth saying plainly because the nearest
neighbour looks like a precedent and is not: `[P§5.4]`'s tiebreak loser
change → release → **stop work** and tells its human one line `[P§5.4]`
`[C skills/handshake-coordination/SKILL.md:145-152]` — neither `[P§5.4]` nor
SKILL.md defines any rule that resumes it on a peer's later `task.release` or
`task.done`, so there is no shape being reused. What is genuinely reused is the
*ingredients*: the events, the client's own records, the staleness rule `[P§4.3]`
already computes, and the fact that the evaluation is local and needs no message.
The rule itself is **[proposed]** and collected in this appendix's gated list
(item 24), in the three-trigger form above.

**And where the model has quietly changed subject, the human is told**
**[proposed — gated with G1].** Sequencing means the Claude put the task the human
asked for aside and started another one, and the first draft had no notice kind
for it, no card line and no stated override — which reads, from the chair, as
disobedience rather than as scheduling. So: one trimmable card detail,
`sequenced: <subject> waits on alex; working <other>`, and one line in `SKILL.md`
saying that the sequencing decision is the model's **default** and that a human
instruction overrides it immediately. Nothing technical stops the work — claims
are advisory and the gate never blocks (§7.2) — so what was missing was never a
mechanism, only the knowledge that there was a decision to overrule.

#### G1, the rung

**Why it is pure autonomy, and why that cuts both ways.** No new human-facing
surface, no new consent, no new file — which is what made it attractive to build
early and is exactly why it is the hardest rung to justify before anyone has
watched the pair work. It needs Stage 1 (the branch is fetchable), Stage 2(a)
(the symbols say the tasks collide at a method) and Stage 2(b) (there is
something on the branch to fetch), all of which the committed slice provides —
so entering G1 costs nothing but G1.

**Delivers.** The `ls-remote` branch-moved derivation (§5.4) — **no wire delta**;
the peer-branch string validation at the receive boundary, **on both legs and
against a different id on each** (mechanism 1); the namespaced-ref
fetch and the throwaway-worktree evaluation of §4.2 item 5, with its
**locally derived path allowlist, its `git diff --raw` mode rule and the
instruction/build floor underneath both**, the worktree created only after
those and the probe have passed; the **`merge-tree --write-tree` probe**
(not a rebase dry-run, which does not exist) **behind the recorded
`git --version` gate of mechanism 2 — below 2.38 the whole capability is
off, and no fallback probe is shipped**; the rebase decision, its
instability counter — **which a real rebase that conflicts after a clean probe
also increments** (mechanism 2) — and its lease-protected push (ruling D1);
the lexicographically-smaller-never-stacks ordering rule; stack invalidation; the
three-trigger sequence-and-resume rule; the abandoned-worktree startup sweep
**as `git worktree remove --force` plus `git worktree prune`, not an unlink**
(mechanism 3); the
stack `details[]` entry and the rebase-needed notice; `handshake branches
--fetch`, **showing stack parentage and not only age** (G1's risk section below).

**Plus the six smoothings that belong to this rung**, folded in here rather than
left in a friction report **[proposed, collected in this appendix's own list]:**

- **The `sequenced:` card detail and the human override.** One trimmable
  `details[]` entry — `sequenced: <subject> waits on alex; working <other>` — and
  one `SKILL.md` sentence saying the sequencing decision is the model's default
  and that a human instruction overrides it immediately (mechanism 4). Without them, a
  Claude that quietly starts a different task reads as disobedient.
- **The stack-versus-sequence fact table stays in `SKILL.md` proper**; only the
  prose goes to `references/` (§2.4). A decision made without the table is a
  decision made by opening a file mid-turn, which is the thing progressive
  disclosure is supposed to avoid, not cause.
- **One `SKILL.md` line telling the model to run `handshake branches --fetch`
  when a stack decision is actually due.** The poll is 60 s on the relay and up to
  600 s on ntfy `[C monitors/heartbeat.js:47]`, and the one-shot fetch already
  exists; what was missing was the instruction to reach for it at the moment the
  latency costs something.
- **`handshake branches` prints `base abandoned 6d — restack onto main before you
  open a PR`.** G1's invalidation rule (mechanism 4) covers a base that is *rewritten* or
  *deleted* and says nothing about one that is intact and dead, which is the
  commonest shape: the peer shut the laptop, the base still applies, and the PR
  carries their half-done work.
- **The throwaway worktrees are named `handshake-peer-<member>-<short sha>`, with
  one `status` line.** They appear in the human's own `git worktree list`
  (§4.2 item 5), and a 32-hex path nobody created is worse than a named one.
- **The rebase-needed and stack notices take ranks 7 and 8 of §2.4's order**, and
  the `+N !` marker names the highest hidden kind — which matters here because
  this rung is what starts filling the channel.

**Touches.** `lib/repo.js` (`ls-remote`, the refspec fetch, `merge-tree`, the
worktree lifecycle, the sweep, the network timeout of §2.5, and the ref
re-derived from the member id rather than accepted) ·
`lib/transport-ntfy.js` (**receive-side validation of a peer's `branch` against
the signed `from.member`**, on the presence assembly
`[C lib/transport-ntfy.js:284,300-301]`) · `lib/transport-relay.js` (**the same
rule against the server-authoritative `member_id`**, on the `sync.presence[]` map
that has no shape check today `[C lib/transport-relay.js:259-268]`) — both are
client transports, not `relay/**`, so B5's *"no relay file enters any rung's
Touches"* is untouched, and **not** `lib/envelope.js`, for the reason mechanism 1 gives ·
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
tier's branch string actually arrives. The option-injection corpus goes to Stage 3's red team, which gains the fetched-content scope the moment this rung ships (§10.3). **A peer diff whose paths all sit under
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
succeeds** (mechanism 3; an `rm -rf` passes every other test in this list
and fails this one). A dirty probe
leaves the local branch untouched and renders the notice. **A real rebase that
conflicts after a *clean* probe aborts in the worktree, drops the stack, routes
to sequence and increments the instability counter** — the arm mechanism 2
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
an automatic path, which is Stage 2's tier for Stage 2's reason. §10.5's gated
table says the same; the omission was here, not there.

#### G1, the acceptance scenario — stack on the same symbol

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
`branch: handshake/alex` — the one branch Alex has, under the branch model of
§4.1, which is why the member segment is the only thing the validation has to
check; it validates that string against Alex's
signed member id (mechanism 1), reads the branch's head with `ls-remote`, and — because
`alex` sorts before `bob` and the smaller id never stacks (G1's ordering rule) — **Bob is the
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

**And §4.4 in this scenario.** **Rule 1:** the stack is an automated action that
changes what Bob will see, so it leaves a line — the `sequenced:` or stack
`details[]` entry, and `handshake branches` showing which branch is stacked on
which. **Rule 2:** a refused rebase (path outside the allowlist, a mode change, a
conflict after a clean probe) names its cause and its next move, and the human
decides. **Rule 3:** if Alex's git is below 2.38, or Bob has no monitor, `status`
says the capability is off **and why**, on the machine where it is off — because
a Bob who stacks and an Alex who never does is the asymmetry this rule was
written for.

#### G1, the risk — rebase churn

A peer pushing every minute means a stacked Claude could rebase every minute and
never finish anything.

**What the plan builds:** the instability counter of mechanism 2 — after **[proposed: 3]**
head moves since the last successful rebase, the client stops rebasing and
sequences instead, resuming on `task.release` / `task.done` **or on the base
claim expiring** (G1's sequence rule; presence `gone`, never `stale`). **The probe is `merge-tree --write-tree`, which is
non-mutating by construction, so a dirty result costs nothing and leaves the
local branch, the index and the working tree untouched — and the first draft's
`rebase --dry-run` does not exist**, so the safety claim rested on
attempt-then-`--abort`, which needs a clean tree, churns the working tree, and on
a hard kill leaves `.git/rebase-merge/`, conflict markers and a detached `HEAD`
behind. Any real rebase happens in a dedicated worktree under the plugin's state
directory (mechanism 3), **swept with `git worktree remove --force` plus
`git worktree prune` and not an unlink**, which is what actually releases the
path. And the fetch is triggered by a **changed
head**, not by a timer, so a quiet peer costs zero fetches — which is also why
the repeated probing this section worries about does not accumulate unreachable
objects: there is no cadence to accumulate against, and the instability bound
caps the rebases.

**One thing the safety claim above does not cover, added at fix round 3.** *"A
dirty result costs nothing"* is true of the **probe**, and the probe is a proxy:
`merge-tree` composes endpoints where a rebase replays commits, so a clean probe
can be followed by a **conflicting real rebase** (mechanism 2 has the
measurement). That rebase is not free in the same way — it is a real operation —
but it is confined: it happens in the throwaway worktree, aborts there, drops
the stack, routes to sequence and counts against the instability bound. The
human's tree is still untouched; what is spent is one evaluation.

**The landing hazard, stated here because it is the stack's and nowhere else's.**
This rung's own acceptance scenario ends *"neither branch was merged, no PR was opened, `main` is untouched"*,
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
**No further acceptance scenario is added for the landing itself**: everything
after the PR is above the floor, so it would test git rather than this layer.

**One thing the branch model changes here, and it is a simplification.** The
committed slice **re-roots** `handshake/<member>` onto the default branch once
its PR merges (§10.2), so the squash hazard above has a second answer it did not
have: after a merge, Bob's branch is reset to the merged base and Alex's commits
are inside `main` rather than duplicated inside Bob. The stance above still
applies **while the PR is open**, which is when it matters; the re-root cleans up
after it, which is when nobody was going to.

### G2 — The contradiction protocol

**Entry trigger.** **Build only if the run shows at least one TRUE requirements
conflict** — two halves that need incompatible values of one named thing, both
individually right, with no shape that satisfies both. Not a textual conflict:
§5.4's discriminator exists precisely because git reports those and nothing else,
and an unclean merge is a scheduling fact rather than a contradiction. Not a
disagreement two people settled in a message. **One is the threshold, not three**,
because unlike G1 this is not a frequency question: a protocol for a thing that
has never once happened has no customer, and a protocol for a thing that happened
once has one.

**Its second gate, which is not this plan's to give.** G2 rides `task.seam`,
whose Appendix B rows E1–E3 are `[COBUILD §11]`'s and are **unratified**, and it
needs `[COBUILD-PLAN §3.S0-S2]` built. Even a fired trigger does not start this
rung; it starts the conversation about ratifying those.

**What the committed slice does instead, so the trigger is read honestly.**
`note.blocker` ships today at zero new surface
`[C skills/handshake-coordination/SKILL.md:278-326]`, reaches both humans, and is
the vehicle `[COBUILD §5.3]` keeps for facts no shape can carry. A run in which
`note.blocker` carried a requirements conflict to two humans who settled it in a
minute is a run in which this trigger did **not** fire.

**The inverted cut trigger, for the record.** The first draft would have cut this
if contradictions arose less than once per pair per week. Read from the other
end: one occurrence in the run's working day is roughly five times that rate, so
the entry threshold is, if anything, more permissive than the cut threshold it
replaces.

#### G2, the rung

**Why it was sixth.** It is the only rung that needs a ratified wire type it does
not
own: it rides `task.seam`, whose Appendix B rows E1–E3 are `[COBUILD §11]`'s and
are **unratified**. So G2 cannot start until `[COBUILD-PLAN §3.S0]` has been
ratified and S1–S2 built. That is a real dependency and it is stated as a
scheduling fact, not a preference (§10.5).

**Delivers.** `contested` and `rationale` (**V-D3**); **§6.0's round-open rule as
code** — a round exists iff a `task.seam{propose, contested: true}` exists, and
nothing else in the client may create one; the bounded-round counter;
the escalation path with both reasons attached, bounded by the seam TTL (§6.4);
`handshake contested`; the two notices at their ranks (§2.4); SKILL.md's revision
discipline for a contradiction — *author the shape your half requires; never
reply to their prose* — **in `references/`, with only the trigger condition left
in SKILL.md proper** (§2.4's ceiling).

**Plus the four smoothings that belong to this rung** **[proposed, collected in
this appendix's own list]:**

- **The ntfy tier limit is printed inside the confirmation prompt itself**, read
  from `state.transport`: *"(ntfy tier — every revision needs this;
  `handshake deploy-relay` removes it)"*. On the tier the README tells people to
  try first, a three-revision round is three typed confirmations per side, and
  nothing at opt-in warned them (§12.7).
- **The escalation notice carries its deadline**: *"contested:
  `Client.request::idempotent`, 3 rounds, unresolved, expires 14:20"*. The seam
  TTL is already computed on both sides `[COBUILD §5.4]`; what was missing was
  printing it, and a deadline nobody can see is a deadline nobody meets.
- **An unanswered escalation writes a durable outcome record on expiry —
  from G2, not from G4.** The notices channel is regenerated every turn (§2.4),
  so a notice that renders once into a session nobody is in is a notice nobody
  gets: at 18:40 both Claudes escalate, at 20:40 the seam expires, and next
  morning both sides have kept building opposite answers with no record of the
  argument. So G2 writes one shard row on expiry — *"a contradiction on
  `Order.validate` expired unanswered Tue 20:40"* — using the existing shard
  machinery, so the next session's once-per-session block opens with it.
  **This is the one piece of G4 that G2 takes**, and it is taken because the
  alternative is losing the only artifact of the argument.
- **Outcome records never evict peer learnings.** When G4 does arrive, learnings
  rank **above** outcomes in the once-per-session block's entry slots
  `[C hooks/render.js:304]`, and the trimmed-list line stays so the human is told
  something was cut. Stated here because G2's expiry record is the first outcome
  row that can exist, and the ranking rule has to exist before it does.

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

#### G2, the acceptance scenario — a contradiction resolved by splitting the flag, with no human

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

#### G2, the acceptance scenario — a contradiction that escalates, with both reasons attached

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

#### G2, the risk — escalation fatigue

If the contradiction protocol escalates often, two humans are being interrupted by
their own automation, and the feature is worse than nothing.

**What the plan builds:** the bound is deliberately low (§6.3), so an escalation
means "three revisions did not converge", which is a real signal rather than a
timeout; both Claudes keep working through it, so an escalation is never a stall;
the notice rides the regenerated notices channel rather than the digest, so it
persists without re-notifying `[P§6.3]`; and G4 records every escalation as an
outcome, so the rate is a number and not an impression. **If the measured rate
exceeds [proposed: one per pair per working day], the bound goes up before the
feature is cut** — a round is cheap and an interruption is not. **The denominator
is a *pair*, and it is per pair by construction, not by convenience:** a seam
names exactly two members `[COBUILD §2.1]`, grants are per-peer (§9) and branches
are per-member (§4.1), so every rate in this section and in §12.6 is scoped to two
people and would need re-basing before it could be read as a workspace-wide
number. The protocol admits 200 members; this stage is two, which is also this
document's first sentence.

### G3 — The trusted-pair capability table

**Entry trigger.** **Build only if MORE THAN ONE narrow opt-in exists.** Today
there is exactly one — `handshake pair --state-branch`, which enables the state
branch and the live view together — and a screen that generalizes a single row is
a screen. The trigger fires the moment a second one exists, which in practice
means the moment G1 or G2 ships with its own gate, or the moment `task.offer`
becomes real (§13.4). **It is the only entry trigger in this appendix that is not
read from the run's observations but from the plan's own state**, and that is
deliberate: the question *"is there anything to generalize"* has a countable
answer and does not need a working day to produce it.

**What this defers, said plainly, because it is a consent surface.** Until G3,
consent is per-rung and there is no single screen and no single revocation. That
is not a weakening — the one gate that exists prints its whole grant, refuses
`--yes`, refuses from a proven child and revokes before any network call (§9) —
but it does mean a pair with two gates would have two places to look, which is
the condition this trigger fires on.

#### G3, the rung

**Why it came after the capabilities.** A capability table listing event types that
are not built yet would be a promise, and this project does not advertise unbuilt
features `[C docs/PROTOCOL.md:7-8]`. Each autonomous rung ships with its own
narrow, typed opt-in — one row's worth — and G3 is the rung that **generalizes**
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

### G4 — Coordination-outcome records

**Entry trigger.** **Build only if there is a corpus to rank** — that is, if G1
or G2 shipped and produced resolved conflicts, or if the run itself recorded
enough same-symbol collisions and requirements conflicts that a record of *what
we did and whether it held* would be read by a later session. Decision 9 rejects
hotspot learning before the data exists; this trigger is that rejection written
as a gate rather than as a preference. **A record kind with nothing to record is
the clearest instance in this plan of what the owner flagged**, and it is the one
rung whose entry condition is entirely downstream of two other entry conditions.

**One piece of this rung ships early, if G2 does.** The durable record written
when an escalation **expires unanswered** is in G2's Delivers, not here — because
the artifact it preserves is the only trace of an argument nobody was awake for,
and losing it to a gate two levels deep is worse than paying for one shard row
(Appendix G2). **And its ranking rule ships with it:** learnings rank above
outcomes in the once-per-session block, and the trimmed-list line stays.

#### G4, the rung

**Why it was last.** Decision 9 rejects hotspot learning before the data exists,
and the data is produced by G1 and G2. Built earlier it would record nothing.

**Delivers.** One new `SHARD_KINDS` entry **[proposed: `outcome`]**; the write on
each resolved conflict; the scan's kind list extended
`[C lib/shard-scan.js:67]`; the entries competing for the existing once-per-session
block's slots **below the learnings, never above them**; the two numbers §7.3 and
G2's risk section need.

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

### Proposed, gated

The rows below were in §14 and moved here with their rungs. They are **not**
part of the ratification pass §14 asks for: the owner ratifies the committed
slice, and each row here is ratified — or refused — at the moment its rung is
entered. Their numbers are the ones §15 and the rest of this document already
cite, kept rather than renumbered so every cross-reference still resolves.

| # | Item | Where | Suggested value |
|---|---|---|---|
| 7 | Verb name — the contradiction view | §2.2, Appendix G2 | `handshake contested` |
| 8 | ~~**V-D1** field name and shape~~ — **WITHDRAWN at the revision.** `presence.update` is not an envelope on the relay `[C docs/PROTOCOL.md:262-275]` `[C relay/src/lib/envelope.js:22-26]`, so the field could not travel on the tier §11 runs first. **The row asserted the opposite of what the code does.** | §2.3, §5.4 | **no wire delta**: the peer's branch head is read locally with `git ls-remote` against the `branch` the presence body already carries — which also makes it a fact the peer cannot author. **Named as a departure from decision 4** (added in fix round 1): decision 4's case (c) specifies *"a structured branch-moved event on each peer push"*, and withdrawing V-D1 withdraws that event too, so the fact arrives on the poll's clock — 60 s relay, up to 600 s ntfy `[C monitors/heartbeat.js:47]` — instead of at the push. Stronger fact, worse latency; ratifying this row ratifies that trade |
| 10 | **V-D3** field names and caps — **the arithmetic added at fix round 3, because ratifying a cap without it ratifies an unpriced capacity change** | §2.3, §6.2 | `task.seam.contested` (bool, `propose`); `task.seam.rationale` (≤ 280, `contract`). **What 280 costs, measured:** a maximal ASCII `contract` body goes **1,415 → 1,710 of 2,048**, i.e. **295 bytes, 45% of the remaining slack**; the residual budget for `text` falls **1,833 → 1,538 bytes**, roughly **916 → 769** two-byte characters against an unchanged 1,200-char field cap, so a non-ASCII contract in that band fits today and is **refused** after V-D3. The ntfy wire goes from `[COBUILD §4.2]`'s measured 2,244 to roughly **2,640 of 4,096**, which still does not bind. **And the refusal message must name `rationale` when `rationale` is what busted the cap**, and offer to drop it before asking the human to cut their own contract text — `[COBUILD §4.2]`'s *"tell the human to shorten the contract"* is the wrong instruction for bytes a model spent |
| 11 | Bounded rounds before escalation | §6.3 | **3** |
| 12 | Rebase instability bound before sequencing | Appendix G1 | **3** — counting head moves since the last clean rebase (the head being what `ls-remote` returns, item 8) **and** any real rebase that conflicts after a clean probe (Appendix G1 mechanism 2, item 32) |
| 13 | New `SHARD_KINDS` entry for coordination outcomes | §8, Appendix G4 | `outcome` |
| 15 | Cut trigger — escalation rate | Appendix G2's risk | > 1 per pair per working day. **Read as an entry trigger now** (§14 item 52): G2 is not built until at least one true requirements conflict has happened at all |
| 16 | Cut trigger — outcome corpus too small for **ranking** — **rewritten at the revision**: the `outcome` kind is created by V8, so an anchor before it made the corpus necessarily zero and the rule a certainty rather than a measurement | §12.6 | < 20 rows after **one month of two-pair use following G4's own ship**; it cuts the ranking, never the records. G4 is itself behind two other triggers, so this number is three gates away and is not scheduled |
| 19 | Each rung ships its own narrow typed opt-in; **G3** generalizes them into one table — **the per-rung half is COMMITTED and only the generalization is gated** | §9, Appendix G3 | as written — this resolves the apparent tension between decision 3's "opt-in at configuration" and decision 10's ordering of the trusted-pair rung sixth. In the committed slice there is exactly one narrow opt-in, which is also G3's entry trigger |
| 20 | **The initial default grant, per capability row** — decision 8 settles the *form* of the grant and no value | §9 | all granted **except** `task.offer`; every grantable row is the owner's to flip individually — the `note.*` row's `never grantable` value is §3's principle, not a default, and G3's test pins it |
| 23 | **Decision 4's `branch CI passing` fact is unavailable** (§4.2 item 4 puts `[skip ci]` on every tool commit); replaced by the **`merge-tree` probe + successive `ls-remote` reads** | §5.4, §12.5 | as written — **plus an optional item: an opt-in lightweight per-branch job** (one runner, one OS, unit suite only), *not built here*, decided after the run measures CI cost |
| 24 | **Resume-on-event is new local behaviour**, not a reuse of any existing rule — **rewritten at the revision**: "and on nothing else" deadlocked the commonest abandonment there is, a closed laptop, which emits neither event | Appendix G1 | a sequenced task re-evaluates on the peer's `task.release` / `task.done` for that `subject_key`, **or on the base claim expiring — presence `gone`, never `stale`** `[P§5.3]` `[P§4.3]`, and on nothing else — in particular never on a peer note |
| 25 | **Decision 5's four-part trigger is reduced**: symbol and contested-marking travel; values and diffs are derived locally | §6.2 | symbol rides `[COBUILD §7.1]`'s existing immutable `name`; no fourth field |
| 27 | Cut trigger — contradiction frequency too low to justify G2 | §12.6 | < 1 per pair per week, measured in the run. **Inverted into G2's entry trigger** (§14 item 52): at least one true requirements conflict, which over one working day is a more permissive bar than this rate |
| **32** | **The non-mutating rebase primitive** *(new at the revision; `git rebase --dry-run` does not exist. **Rewritten at fix round 3 on four counts**: the probe is a proxy and the plan had no arm for the case its own design creates; the fallback inverts the verdict; the version floor had no detection; and the worktree sweep was specified as an unlink. **At the simplification pass the `git --version` precondition moved from Stage 1's preflight to G1's own first task**, since stacking was then the only thing it gated; **corrected twice at the second-look round — R2-2, because the value cell below still said the opposite, and again because §10.2's re-root replay now needs the same 2.38 primitive and carries its own arm for it)* | §4.2 item 5, §10.2, Appendix G1 | `git merge-tree --write-tree` (git 2.38+). **It is a proxy for the rebase, not the rebase** — it composes two endpoints against a merge base where a rebase replays each commit, so a clean probe does **not** imply a clean rebase (measured: a net-empty endpoint diff whose intermediate commit conflicts gives `merge-tree` exit 0 and `rebase` exit 1). **The missing arm:** a real rebase that conflicts after a clean probe aborts in the worktree, drops the stack, routes to sequence and counts against the instability bound (item 12). **The fallback is WITHDRAWN, not kept:** `git format-patch` piped into `git apply --check --3way` prints *"Applied patch … with conflicts."* and **exits 0** on a real conflict, with or without `--cached`, so it would report a dirty base as clean underneath ruling D1's force-push. *(The pipe was written as a literal pipe character inside inline code at fix round 3, which split this row into six cells against a five-column header — the only column mismatch in the document; reworded at the second-look round, R2-3.)* **Instead G1's own first task records `git --version` and the stacking capability is OFF below 2.38** — it was Stage 1's fifth preflight precondition until S13 moved it here, because it gates stacking and nothing else *(R2-2; Stage 2(b)'s re-root carries its own, separate `git --version` arm for the case-2 replay, §14 item 50)* — said in `status` — which matters because Ubuntu 22.04 LTS ships git 2.34.1 and both CI legs are above the floor, so the older branch is the one nobody would ever run. Any real rebase in a dedicated worktree under the plugin state dir, created **after** the path rule and the probe (both checkout-free) rather than before, with `--no-checkout` plus a sparse checkout where a full tree is not needed and `-c core.longpaths=true` on Windows; **swept with `git worktree remove --force` followed by `git worktree prune`, never `rm -rf`** — verified, a deleted worktree stays registered as `prunable` and permanently blocks re-use of its path |
| **33** | **Stack ordering, so two clients do not both stack** *(new at the revision)* | Appendix G1 | the **lexicographically smaller member id never stacks**, reusing the frozen byte-wise comparator `[C lib/subject.js:102-107]` — borrowed for a new object, amending nothing |
| **34** | **Nested stacks** *(new at the revision; absent from the first draft entirely)* | Appendix G1 | **not permitted** — a client already stacked sequences instead of stacking a second base |
| **35** | **The peer-branch validation rule and the fetch shape** *(new at the revision; the per-leg half added in fix round 1; **Where corrected at fix round 2** — the simplification renumbered §11, and new §11.3 says these assertions belong to G1 and are stated there; **the pattern narrowed with the branch model at the second-look round, R2-1**, in the wording §4.1 already uses for D1's outbound half — the old `/[A-Za-z0-9._-]{1,120}$` tail was mandatory and the branch model produces no tail, so the receive boundary would have rejected every legitimate peer branch and this rung could have fetched nothing)* | §4.2 item 5, Appendix G1 (mechanism 1, its guardrail and its security run) | accept only the exact ref `handshake/<the authenticated sender's member id>` — the member segment matched against `[A-Za-z0-9._-]{1,120}`, **no tail permitted** — else discard-and-count. **The id is per leg, because `presence.update` is not an envelope on the relay (§2.3):** on **ntfy** the segment MUST equal the signed envelope's `from.member`, checked in `lib/transport-ntfy.js`'s presence assembly `[C lib/transport-ntfy.js:284,300-301]`; on the **relay** it MUST equal the server-authoritative `member_id` of the `sync.presence[]` row `[C relay/src/do/workspace.js:428-437,709-712]`, checked in `lib/transport-relay.js`'s `presence()` `[C lib/transport-relay.js:259-268]`. **Not** in `lib/envelope.js`, which enumerates no body field by design. Fetch by explicit refspec with `--` and a fully-qualified source into `refs/handshake/peers/<member>` — one ref per peer, since there is no longer a `<branch>` component to nest |
| **36** | **The gate on an automatic rebase — a POSTURE, not a list** *(new at the revision as a seven-name refuse-list; **inverted at fix round 3**, because a denylist was the one thing §4.3 argues against in the same words — "Allowlist, not denylist, on the path the tool writes without a human" — and it omitted most of the surface it claimed: `.mcp.json`, a non-root `CLAUDE.md`, `AGENTS.md`, `.husky/**`, every non-GitHub forge file, every build file that is not literally `Makefile`)* | §4.2 item 5, Appendix G1, §12.7 | **Three rules, in this order.** (1) **Allowlist:** the automatic rebase proceeds only when every path in the peer's diff sits under a prefix **this side derived locally** — the directory prefixes of **my own** claim's observed `files[]` `[C hooks/post-tool-use.js:79-91]`, never the peer's, which a malicious peer authors — matching at a path boundary, at any depth, case-insensitively. (2) **Mode rule:** refuse any diff that introduces or modifies a **symlink, a gitlink or an executable bit**, computed from `git diff --raw` and not `--name-only`, which cannot see a mode transition at all. (3) **Floor:** the withdrawn seven names, plus `.mcp.json`, any `CLAUDE.md`/`AGENTS.md` at any depth and `.husky/**`, refuse **even when the allowlist admits them** — because a pair whose own work is the instruction or build surface has those paths on its own claims. Anything refused renders a notice (rank 7) and the human decides. **Ratifying this row ratifies the posture**; the floor in rule 3 is the only list, and it is reviewed in Stage 3's red team — which gains the fetched-content corpus the moment G1 ships — like any other denylist `[SEC§4]` |
| **38** | **The landing stance for a stacked pair** *(new at the revision)* | Appendix G1's risk | merge-commit or rebase-merge for stacked branches, **never squash** — or restack onto `main` before the PR; both human operations, so the plan's obligation is to **show stack parentage** on `handshake branches` |
| **42** | **What opens a contradiction round** *(added in fix round 1; §6.0 is new at the revision and asserted this as settled, but it is a stated relaxation of decision 2's structure-only law and therefore exactly the class §14 exists to surface)* | §3, §5.5, §6.0, Appendix G2's scenarios, Appendix G1's risk | **detection is the model's reading of the fetched diff** — the one sanctioned relaxation of *facts may cause work* — bounded to a seam, a named symbol, a round count (item 11) and a granted capability; **opening** is the structured `task.seam{propose, contested: true}` and **adoption** stays the fact, so decision 2's operative half is untouched. Alternative rejected: a purely structural trigger (declared symbol sets intersect **and** two materialized revisions disagree on a named field), which cannot fire in the common case where both diffs compose cleanly and both halves are wrong |
