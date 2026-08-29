# claude-handshake — v1 Build Plan (v2, post-adversarial-review)

Product: a Claude Code plugin letting two or more completely separate Claude Code
instances — different users, different Anthropic accounts, different machines —
collaborate as peers on one project. Everyone else built the pipe; the brain
(automatic presence, task claiming, overlap warnings, invisible coordination) is
the product.

This is v2. Draft v1 was attacked by three adversarial Opus reviewers (security
xhigh / platform-feasibility high / product-spec high); all three returned "not
buildable as written". Every blocker and major finding is integrated below.

## Locked decisions (from the design discussion — unchanged in substance)

1. **Liveness**: check-when-awake baseline; GitHub verified at sync points;
   wake mode (a faster monitor cadence armed by explicit request) is
   **deferred to v1.1** — cut from v1 entirely, not shipped dormant (see M9
   below and PROTOCOL.md §Deferred beyond v1).
2. **Transport ladder**: zero-setup mode (ntfy.sh) → team relay (own Cloudflare
   Worker + Durable Object) → GitHub fallback/durable layer. Swappable adapter.
   No WebSockets in v1. Future: paid hosted tier.
3. **Auth**: GitHub-anchored (secret material in the private repo distributes
   membership); shared secret otherwise; v2 per-member keys — v1 now mints
   per-member *sub-tokens* at join (see Protocol) as the honest minimum.
4. **V1 scope**: presence + claiming/overlap + discovery chatter + status view
   + secret filtering + restart recovery. No automated peer verification.
   Repo files = lasting truth; relay = live chatter.
5. **Form factor**: scripts under the hood, shipped as plugin; beginner =
   invite paste; intermediate = one-line installer; expert = manual.
6. **Name**: `claude-handshake`, `/handshake`.

**Two review-driven wording amendments (need Fenil's nod):**
- "instant mode" → **"zero-setup mode"** — delivery latency is the peer's next
  turn boundary; "instant" promises what check-when-awake can't.
  **Correction (Fenil, 2026-08-28):** as built, the delivery point is not the
  turn boundary — the Stop hook is outbound/push-only and runs no inbound
  sync `[C hooks/stop.js]`. Inbound refresh actually happens at SessionStart
  and on roughly every 5th PostToolUse tick `[C hooks/session-start.js:19]
  [C hooks/post-tool-use.js:95-116]`, i.e. the next prompt after one of those
  has landed, not the turn boundary itself. See §6 Acceptance criteria for
  the as-built statement of this same point.
- "one-command install" → **"one paste, guided"** — the marketplace flow has an
  interactive scope prompt and sometimes `/reload-plugins`; the beginner invite
  is still a single paste, but the self-check must be three-valued
  (not-installed / installed-not-active / active-verified).

---

## 1. Architecture (v2)

Components: plugin (SKILL.md + hooks + commands + monitor + `bin/handshake.js`)
· transports (ntfy | cloudflare behind one adapter interface) · relay
(`relay/` CF Worker + one SQLite-backed DO per workspace) · GitHub base
(`.handshake/` files) · local state in `${CLAUDE_PLUGIN_DATA}`.

### Hooks (all exec-form with `${CLAUDE_PLUGIN_ROOT}` — never shell-form; every
hook is a sub-10ms no-op outside a handshake workspace, resolved by walking up
from cwd to `.handshake/workspace.json`, cached)

| Hook | Mode | Job |
|---|---|---|
| SessionStart | async | full sync; writes `pending` marker then digest cache; branches on source (startup/resume/clear); runs restart-recovery reconcile |
| UserPromptSubmit | **sync, local-cache-only, timeout 3s, zero network** | ALWAYS injects the standing block (~600 chars: peer roster + live claims + standing rules) + new-items digest when present; waits ≤500ms on the pending marker, else injects one honest "peer sync in progress" line |
| PreToolUse (Edit\|Write\|NotebookEdit) | sync, fast | overlap gate: target path vs peers' cached claim globs → warn/block BEFORE the write (the only moment an overlap warning is useful) |
| PostToolUse (Edit\|Write\|Bash matcher) | async | "what am I touching" updates (progressive files[] on my claim); opportunistic sync every ~5th tick; mtime-sentinel checked before Node spawns |
| Stop | async | **outbound only, as built**: the presence heartbeat's fallback when no monitor is running — folds the turn's touched files, pushes the delta, renews presence, at most once per transport keepalive (60s relay / 600s ntfy) and skipped entirely for a child session, after `rest`, or once posting has stopped `[C hooks/stop.js]`. It runs **no** inbound sync and writes **no** digest — the digest cache is written by SessionStart and by PostToolUse's every-5th-tick refresh `[C hooks/session-start.js:19]` `[C hooks/post-tool-use.js:95-116]`. *Design intent, not yet built:* make the turn boundary itself a sync point, so LD1's "check-when-awake" is true within a session on the turn clock rather than on the tool clock |
| SessionEnd | async, best-effort | **parting note** (Fenil, 2026-08-14): post "signing off — what was done" to the relay (ws.leave + final task state) AND write it to the local task shard so it lands in the next commit — a closed Claude always leaves its record in both the live and durable layers |

**No hook ever asserts `idle`** — readers derive idle/quiet/stale from
`updated_at` (Yjs/SWIM rule). Presence states written: `working|waiting|blocked`.

### Monitor = the liveness clock (plugin `monitors/monitors.json`)
Heartbeat + claim renewal tick on the monitor's own clock — NOT on tool cadence
(PostToolUse goes silent during a 15-min build, exactly when presence matters).
Cadence: on zero-setup transport, publish presence on state change + 10-min
keepalive (ntfy budget); on team relay, 60s. In v1 the monitor ships ONLY at
this baseline cadence: wake mode — the same monitor running faster, armed by
`/handshake watch [duration]` and disarmed by a sentinel file the monitor
polls — is **deferred to v1.1** (see M9); `/handshake watch` does not exist
in v1 (monitors aren't stopped by plugin-disable, independent of wake mode).
Caveats designed-in: monitors run only in interactive sessions (M12's `-p` leg
can't exercise them; manual leg does); documented fallback where unavailable.

### Runtime gate
`handshake.js` needs Node, and native-Windows Claude Code does not guarantee
Node. `doctor` and the invite self-check REFUSE with specific remediation when
`node` is missing (fail-open is for network errors, never for a missing
interpreter); the Windows installer installs/verifies Node as step zero; a
distinct presence state ("tooling broken") separates this from "offline".

## 2. Protocol (frozen at M1 — scope deliberately wide)

**Envelope**: `{v, ws, from:{member, machine, session}, type, body, ts, nonce,
sender_seq, sig}` — `sig` = HMAC-SHA256 over canonical serialization, keyed by
the workspace secret; receivers reject unsigned/invalid on every transport;
`ts` freshness window ±5 min; `sender_seq` strictly per-sender (dedupe only —
cross-sender order comes from the transport's own handle, which assigns its
own separate `seq` to each stored message [Appendix B A1]
[C relay/src/lib/envelope.js:67-71]); `enc`/`alg` fields reserved.
`machine` = random per-install pseudonym, never hostname. Body ≤ 2 KB.
**On zero-setup transport the body is encrypted** (AES-256-GCM, key via HKDF
from the workspace secret): a passive subscriber holding the topic learns no
file path, branch, task title, or human name.

**Events**: presence.update, task.claim/release/done/change, note.discovery/
error/fix/blocker/info, warn.overlap, ws.join/leave/migrate, state.request.

**Claims**: subject is **semantic-first** — model-authored free text captured
at prompt time ("onboarding flow"), normalized (case/stopwords) with a frozen
fuzzy-match rule; `files[]` appended progressively as work touches them. Tasks
are created implicitly by first claim; `.handshake/tasks/` is a projection of
claims, never a hand-edited master. Advisory lease TTL 2h, renewed on the
monitor clock. **Deterministic tiebreak**: earliest `acquired_at` wins, ties by
lexicographic member id; the loser releases, posts task.change, and tells its
own user in one line (the one moment surfacing to the human is correct).
On zero-setup transport claims are marked **unauthenticated-advisory**: each
heartbeat carries the sender's full active claim set (resurrection past ntfy's
~12h cache), a new joiner posts `state.request`, and the overlap tree surfaces
advisory conflicts to the human instead of silently deferring.

**Sync**: fetch cap (20) and inject cap (5 items / ~600 chars) are separate
numbers; per-sender-fair round-robin with reserved slots for `warn.*` and
`note.blocker`; consumed-watermark advances at *injection* time, suppressing
re-injection and duplicate reactions; "+N more — /handshake status" overflow.
Cursor = `{message_id, unix_ts}`; ntfy `since=` uses the id under ~11h, the
timestamp beyond, and past the cache window stops pretending: reads the durable
layer and says plainly that older live chatter is gone.

**Identity & auth**: `join` mints a per-member opaque **sub-token** (stored
0600 in local state); the workspace secret is demoted to an enrollment
credential. The DO stamps `from` against the sub-token (the stamping claim is
only made where the mechanism exists — on ntfy, `from` is explicitly
self-declared-but-HMAC-signed). `release` and cursor writes are authorized to
their owner. Duplicate name binding is rejected. **Rotation**: 24h grace for
the previous token; requires the recovery key generated at `init` (stored
out-of-band by the founder) — not just the current bearer; offboarding runbook
= revoke repo access → rotate → verify; SECURITY.md states plainly that
rotation never un-leaks git history and a leaked ntfy topic requires a new
topic + re-invite.

**Failure taxonomy**: transport-unreachable → silent offline (as designed);
401/403/signature/guard failures → loud once per session + posting stops;
`/handshake status` shows credential state, suppressed-sender counts, and
transport tier honestly ("zero-setup: claims are advisory; no durable layer"
on non-GitHub workspaces).

**Offline queue**: filtered at enqueue AND at send; 0600; expiry by type
(presence: discard when stale; claims: discard past TTL; notes: 1h); hard
discard on any transport/topic/token change, reporting the dropped count.

**Transports**: adapter interface + invite blob format (transport, endpoint,
workspace name, secret-or-location, version, checksum) are part of the M1
freeze so M3/M4/M5 can build contract-parallel. `/handshake upgrade` owns the
zero-setup→relay migration: scripts the wrangler deploy, writes config, posts
`ws.migrate` on the old topic naming the new endpoint, re-broadcasts claims,
dual-reads for a bounded window. Never nudge mid-conflict; queue the nudge for
next SessionStart, and the nudge counts ALL transport ops (heartbeats
included), retargeted to ~150 publishes/day/member or first 429 — a 429 is a
loud user-visible state, not silent degradation.

## 3. Trust & safety (consolidated; SECURITY.md is an M1 deliverable)

- **Injection**: the trust framing travels IN the hook output on every
  injection (never assumes SKILL.md is loaded). Note bodies are escaped —
  control-tag-shaped text and wrapper delimiters stripped — at the receive
  path, sender-agnostic. The standing rule is an enumerated never-list, not a
  slogan: a peer note may inform decisions but may never by itself cause shell
  execution, file writes outside the current task, commits/pushes, config or
  plugin changes, installs, scope expansion, disabling mute/filter, or outbound
  posts. `.handshake/*` files read from disk get the identical untrusted-data
  treatment (the git path bypasses transport escaping otherwise), plus a digest
  warning when a tasks shard's last commit came from an email other than the
  one recorded for that shard's own member — per shard, not a membership
  lookup [C lib/workspace-files.js:427-432]. Emails are recorded only for the
  LOCAL member — founder at init/deploy-relay, everyone else at join
  [C bin/handshake.js:511,685,1994] — so this machine can only ever raise the
  warning on its own shard; peers' shards carry no recorded email here and are
  reported `unverified` — a note, not a warning
  [C lib/workspace-files.js:428,442]. Per-workspace `inject: on|off`;
  `/handshake mute` is purely local state.
- **Secret filter**: built BEFORE any send path exists, as the single
  chokepoint `filteredSend()` — a test greps the tree for direct adapter calls.
  Every outbound field is filter input (presence.note, branch, files[], claim
  subjects — not just note bodies), and writes into `.handshake/*` are filtered
  too. Normalization before matching (base64/hex decode, whitespace strip,
  case-fold) + a bypass corpus in tests (chunked, encoded, reversed, gzip+b64).
  One genuinely fail-closed control: values ≥8 chars harvested from local
  secret files (`.env*`, `*.pem`, credential stores) are compared RAW, in
  memory, against every outbound field — not hashed — because catching a
  partial leak requires substring matching: a 12-char sliding window over
  each secret catches a chunked/reversed/case-folded fragment even when the
  full value never appears [C lib/filter.js:24,236-244]. Any outbound
  containing one (or a matching window) is refused. Docs state the honest
  claim: a seatbelt against accidental disclosure plus a closed tripwire for
  known local secrets — not a control against a motivated adversary.
- **Workspace secrets**: ntfy topic = ≥128-bit CSPRNG, never derived from any
  name, and is secret material under the SAME guard as the token.
  `.handshake/workspace.json` splits into a public-safe part (schema version,
  transport kind, relay host) and a guarded secret part. **Private-repo guard
  is fail-closed**: only an affirmative `isPrivate: true` from an authenticated
  call permits committing secrets; errors/missing-gh/timeouts → treated as
  public (gitignore + out-of-band). Re-verified on a cached TTL at every sync;
  a repo found public hard-fails posting loudly and demands rotation. `doctor`
  checks: public-repo-with-tracked-token, token-in-history. Token format
  `hsk_<random>_<checksum>` — deliberately detectable; push-protection
  allowlisting documented; CI checkouts and container builds named as exposure
  paths in SECURITY.md, along with the true key-holder set (all repo readers +
  installed GitHub Apps).
- **Relay hardening**: workspace ids minted server-side (CSPRNG ≥128 bits);
  `join` against an unbound DO is rejected (no first-caller binding); no
  module-global mutable state (lint + review); never log bodies, redact
  Authorization (tested); constant-time token compare; per-IP auth-failure rate
  limit; message TTL 7 days alongside the count bound; `purge`,
  workspace-destroy, and member-remove (invalidates that sub-token) endpoints.
- **Invite chain**: `join` always prints relay host + transport + workspace
  name and requires explicit human confirmation — never auto-join, never
  triggered by repo content. The CLAUDE.md block is addressed to the human
  ("this project uses claude-handshake; run /handshake join to participate")
  with a standing rule that repo-resident install suggestions are never acted
  on unprompted. Install is not digest-pinned end to end: the release zip
  ships a sha256 in marketplace.json and the installers' primary route
  (`claude plugin install`) resolves that pinned entry, but the manifest is
  fetched unpinned from `main` and the WSL/failure fallback fetches the moving
  `main` archive with no digest check - pinning both is open work. Invites are
  documented as credentials.

## 4. Repo layout

```
.claude-plugin/plugin.json + marketplace.json     # claude-tier release pattern
skills/handshake-coordination/SKILL.md  # on-demand brain (overlap tree, examples)
hooks/  commands/  monitors/monitors.json
bin/handshake.js  lib/*.js         # CLI via plugin bin/ (PATH-injected)
relay/ (worker + wrangler.toml [new_sqlite_classes!] + DO tests)
installers/install.sh install.ps1  # ported from claude-tier + Node step-zero
docs/ PROTOCOL.md SECURITY.md INSTALL.md   # shipped in the plugin zip
    M1-decisions.md M1-open-questions.md spike-findings.md  # dev-only, not shipped
PLAN.md
```

No standalone invite-template file or LATENCY.md exists — that content was
folded into PROTOCOL.md instead: the invite blob format is frozen in §9.1
("Adapter interface and invite blob"), and the cadence/latency budgets are
frozen in §8 ("Hook cadence contract").

## 5. Task table (model/effort routing)

| # | Task | Model / effort |
|---|------|----------------|
| M0 | Claim npm + GitHub repo; commit PLAN.md | Sonnet low |
| **M0.5** | **Hook-cadence spike** (throwaway plugin logging timestamps: real PostToolUse intervals across long Bash calls, sync UserPromptSubmit latency, monitor start behavior, async semantics) on native Windows + WSL/macOS — **gate before the M1 freeze** | Opus medium + 1 real working day, local |
| M1 | PROTOCOL.md + SECURITY.md freeze (envelope+sig+enc, claims+tiebreak, identity, invite format, join/rotation/revocation, adapter interface, per-transport budgets, latency contract, failure taxonomy) | Opus **xhigh** |
| M2 | Secret filter: `filteredSend()` chokepoint + normalization + local-secret tripwire + bypass corpus — **before any send path exists** | Opus **xhigh** |
| M3 | Relay: Worker + SQLite DO (sub-tokens, owner-authorized ops, TTL/purge/destroy/member-remove, isolation + logging tests, free-plan deploy test) | Opus high |
| M4 | Transport adapters (zero-setup + relay) + offline queue policy + `/handshake upgrade` migration | Opus high |
| M5 | Core CLI: init/join/invite/claim/release/status/rotate/doctor (three-valued self-check) + restart-recovery reconcile (adopt own claims on SessionStart) | Opus high |
| M6 | Hooks (5) + monitor + workspace/cwd resolution + {member,machine,session} identity + failure surfacing | Opus high |
| M7 | The brain: standing block (~600-char budget, measured) + SKILL.md decision tree + subject-normalization worked examples + never-list framing | Opus **xhigh** |
| M8 | GitHub base: split workspace.json, fail-closed guard + TTL re-check, per-member task shards + human projection, human-addressed CLAUDE.md block | Opus high |
| ~~M9~~ | **DEFERRED to v1.1 (Fenil, 2026-08-14): wake mode cut from v1 entirely.** The monitor ships only as the heartbeat/claim-renewal clock; `/handshake watch`, cadence switching, and any auto-arm heuristic are designed later. | — |
| M10 | Installers port (claude-tier lessons) + Node step-zero + checksums | Sonnet medium; Opus high review |
| M11 | Plugin packaging + marketplace + measured context-cost in README | Sonnet medium |
| M12 | E2E split: (a) CI leg — 2× `claude -p`, separate `CLAUDE_CONFIG_DIR`, miniflare + local ntfy container; scripted secret-scan of relay transcript; (b) manual leg — true two-account/two-machine smoke with checklist + one-day volume measurement (gates zero-setup as default rung) | local + Opus high (a); human + Opus high (b) |
| M13 | Security verification of the FROZEN guarantees + red team (injection corpus incl. delimiter breakout + tasks.md path + CLAUDE.md path + invite path; exfil corpus) | Opus xhigh, 3× adversarial fan-out |
| M14 | README/docs/release v0.1.0 (claude-tier release process) | Sonnet medium draft; Opus high polish |

Order: M0 → M0.5 → M1 → M2 → {M3, M4, M5 contract-parallel} → {M6, M7, M8} →
{M9, M10, M11} → M12 gate → M13 gate → M14. Tests/builds/deploys = local, no
model.

## 6. Acceptance criteria (v2)

Scenario (relay leg, then zero-setup leg with documented advisory semantics):
A: "implement feature X"; B: "fix the API issue", separate accounts/machines.
- A's first turn: standing block present (empty roster OK), A claims "feature X"
  semantically; claim visible to B before B edits (PreToolUse gate live).
- B discovers the response-shape dependency → note; A's Claude surfaces it
  WITHIN the same session and adjusts. As built the delivery point is the
  first prompt after an inbound refresh has landed — SessionStart, or a
  PostToolUse tick `[C hooks/post-tool-use.js:95-116]` — not the turn boundary
  itself; the Stop hook does not sync (see the hook table above). So the
  criterion is met by A doing tool work, and a turn spent only talking can
  still miss it.
- Claims released on done; task shard written and included in the next
  user-requested commit; no coordination-only commits.
- No command typed to *cause* coordination; read-only views permitted.
  Consistency = both status views agree on live members + active claim set.
- Security assertions: spoofed `from` rejected (bad sig); public repo refuses
  to commit secrets; a delimiter-breakout note survives escaping harmlessly; a
  passive ntfy subscriber without the secret learns nothing; the bypass corpus
  is blocked; late joiner on zero-setup sees resurrected claims.

## 7. Risks (updated)

- Anthropic ships native cross-account collab → ride it: plugin-shaped, brain
  survives a transport swap. Speed is the defense.
- Monitors/channels are preview-era surface → M0.5 spike validates before
  freeze; fallback paths for hosts without monitors.
- ntfy public caps are undocumented → measured in M12(b); zero-setup demoted
  from default rung if the day-long measurement fails.
- Per-turn context cost of the standing block → measured in M7/M11, published
  in README (the plugin panel shows it anyway).
- Two-model tiebreak politeness → not relied on: deterministic rule in code.

## 8. Release gate (M14 — run at tag time, not in CI)

One rule, because it is the one thing no per-commit test can hold:

- **Rebuild the archive at tag time and diff its sha256 against
  `.claude-plugin/marketplace.json` before publishing.** Run
  `node scripts/build-plugin-zip.js <x.y.z>` on the exact tagged tree, take the
  `sha256:` line it prints [C scripts/build-plugin-zip.js:101-105], and confirm
  it equals `plugins[0].source.sha256` in `.claude-plugin/marketplace.json`.
  Differ → update the manifest and re-tag; never upload the zip first. The
  build is byte-reproducible, so the same tree always yields the same hash
  [C test/build-plugin-zip.test.js:242-256].

Why this is a runbook line and NOT a test: the recorded hash describes the
RELEASED artifact of the previous tag, so a per-commit assertion would go red
on the first commit after every release. CI can only check the parts that do
not depend on the artifact — that the URL carries the entry's version and that
a 64-hex sha is present at all [C test/version.test.js:56-67]. Whether that hex
is the *right* hash is decided here, by hand, once per tag.
