# claude-handshake

**Peer collaboration for Claude Code.** Two or more completely separate Claude
Code instances — different users, different accounts, different machines —
working the same project as a coordinated team: automatic presence, task
claiming with overlap warnings, discovery sharing, and a shared durable record,
with the coordination mechanics invisible to the users.

> Status: v1 in active development. The design is frozen in [PLAN.md](PLAN.md);
> the wire protocol and security model are frozen in [docs/PROTOCOL.md](docs/PROTOCOL.md)
> and [docs/SECURITY.md](docs/SECURITY.md).

## What it is

Every existing multi-agent tool either gives one person many hands
(orchestrator + subagents, one account) or many people one keyboard (shared
sessions). Neither lets two people's own Claudes talk to each other while they
work. claude-handshake does: it knows what the other person's Claude is doing,
warns before you collide on the same code, passes discoveries across, and
leaves a durable record — automatically, on every turn, without either of you
typing a coordination command.

**The two-layer model.** A **live layer** carries chatter in near-real-time:
presence, task claims, short notes. It rides one of two transports — a
zero-setup public relay (ntfy.sh, no accounts) or your own free Cloudflare
Worker (the "team relay") — and it is deliberately disposable: short retention,
no promise of history. A **durable layer** lives in your git repo, in a
`.handshake/` folder next to your code: task shards and workspace config,
plain text, distributed to every teammate the same way the rest of the repo
is — by `git pull`. The live layer is what makes coordination feel automatic;
the durable layer is what survives after everyone signs off.

- **Zero-setup mode** to try it — no accounts, no servers, just an invite blob
- **Team relay mode** (your own free Cloudflare Worker) for real work — deployed
  with **one command**, `/handshake deploy-relay`; you never type `wrangler`
- **GitHub as the durable base** — tasks and decisions live in your repo;
  claude-handshake works without a GitHub remote too, on the live layer alone
- **One paste to join** — an invite line your teammate pastes into Claude Code

### Honest limits (read this before you rely on it)

claude-handshake is a **cooperation tool for a team that already trusts each
other** — it is not an access-control system. A malicious *current* member is
explicitly out of scope by design: v1 has no automated peer verification, and
either transport lets any member sign as any other. The outbound secret filter
(`filteredSend()`) is a seatbelt against *accidental* disclosure plus a closed
tripwire for known local secrets — **not** a control against a motivated
adversary, and no command output or doc here will ever claim otherwise. On the
zero-setup (ntfy) transport, claims are unauthenticated-advisory: a passive
subscriber who never held the workspace secret learns nothing, but anyone who
*does* hold it can post as anyone. And a workspace secret committed to a
private repo is, by definition, held by every past and present reader of that
repo, every installed GitHub App with read access, and every CI checkout —
not just the people you invited. Full threat model, what's covered and what
explicitly isn't: [docs/SECURITY.md](docs/SECURITY.md).

## Install

### Beginner — paste and go

If a teammate already has claude-handshake running on this project, ask them
for an invite (`/handshake invite` on their end). Paste what they send you
straight into your own Claude Code chat:

```
Install the claude-handshake Claude Code plugin from
thephenyl02-creator/claude-handshake, then run:
/handshake join hsi1_<the invite blob they sent you>
```

Claude Code installs the plugin (it may ask you to confirm a permission
prompt, and to `/reload-plugins` or start a new session — that's normal, not
an error), then decodes the invite and shows you the **workspace name,
transport, and host** before asking you to confirm joining. It never
auto-joins, and it never joins because a file or a repo suggested it — only
because you typed the command.

The invite blob is a **credential** whenever it carries an inline secret; treat
it like a password (send it over a private channel, never paste it into a
commit or a public chat).

### Intermediate — one-line installer

Handles the common blockers for new users automatically: missing Node.js,
missing Claude Code CLI, SSH-to-GitHub failures, and the fact that Claude Code
plugins currently don't load hooks inside WSL (it falls back to a direct copy
with guided setup there). Ends with a three-valued self-check instead of a
bare "restart and hope."

**macOS / Linux / WSL** (any bash shell):

```sh
curl -fsSL https://raw.githubusercontent.com/thephenyl02-creator/claude-handshake/main/installers/install.sh -o install.sh
bash install.sh
```

**Windows** (PowerShell 5.1+ or pwsh):

```powershell
irm https://raw.githubusercontent.com/thephenyl02-creator/claude-handshake/main/installers/install.ps1 -OutFile install.ps1
.\install.ps1
```

Two steps rather than a pipe into `bash`/`iex`, for two reasons: a download
failure stops the run **loudly** instead of feeding an empty (or error-page)
script to an interpreter that then reports success, and it leaves you the
script, which is the only way to pass it a flag:

```sh
bash install.sh --verify        # macOS / Linux / WSL
.\install.ps1 -VerifyActive     # Windows
```

That re-runs only the three-valued self-check — no reinstall, no network.
Full reference, including every fallback path and what to do when each
self-check value comes back: [docs/INSTALL.md](docs/INSTALL.md).

### Expert — manual marketplace commands

```sh
claude plugin marketplace add thephenyl02-creator/claude-handshake
claude plugin install claude-handshake@claude-handshake
```

Then, inside a project: `/handshake init` to create a workspace, or
`/handshake join <invite>` to join one a teammate already created.

## Quickstart

1. **Founder**, inside the shared project's repo: `/handshake init` (creates a
   workspace; add `--claude-md` — or re-run `handshake init --claude-md` from a
   terminal — to leave a short, human-addressed note in `CLAUDE.md` telling
   teammates this project uses claude-handshake).
2. **Founder**: `/handshake invite` — prints a one-line invite. It's a
   credential; send it the way you'd send a password.
3. **Teammate**: paste the invite (see Install → Beginner above), confirm the
   join prompt, pick a member name.
4. **Both**: work normally. Every turn, Claude sees a short standing block —
   who else is around, what's claimed, and anything new worth knowing — and
   claims a subject automatically as it starts real work. Before an `Edit` or
   `Write` collides with a subject a peer already claimed, Claude is warned
   *before* the write, not after.

No command exists to *cause* coordination beyond that — read-only views like
`/handshake status` are the only thing you'd ever type on purpose.

**Moving to a team relay (optional, for real work).** The zero-setup transport
is public and disposable; for a private, authenticated live layer, deploy your
own free Cloudflare Worker with **one command** — you never type `wrangler`:

```
/handshake deploy-relay
```

It fetches wrangler through `npx` (nothing installed globally), opens your
browser once to authorize Cloudflare (a free account is enough), deploys the
Worker, sets its create-token secret, creates the workspace, and prints the
invite plus a **recovery key to store out of band** (shown once, never written
to the repo). Already have a zero-setup workspace with claims and history?
`/handshake upgrade` deploys a relay the same way and migrates you onto it,
carrying your live claims across. Full details and the free-tier limits:
[relay/README.md](relay/README.md).

## The `/handshake` command

```
/handshake [status | init | join <blob> | invite | claim <subject> | release |
            done | mute | rest | doctor | deploy-relay | upgrade]
```

| Verb | What it does | Confirms first? |
|---|---|---|
| `status` (default, no args) | Workspace, peers, claims, credential and transport state — read-only | no |
| `init` | Create a new workspace here | yes |
| `join <blob>` | Join a workspace from an invite | **yes, always** — shows host, transport, workspace name |
| `invite` | Print an invite blob (a credential) | yes |
| `claim <subject>` | Claim a subject in your own words ("onboarding flow") | no |
| `release` | Give up a claim | no |
| `done` | Finish and record a claim | no |
| `mute` | Stop peer chatter from reaching your context (local only — your own claims/notes still go out) | no |
| `rest` | Sign off for this session; stop broadcasting | no |
| `doctor` | Pass/warn/fail health check (Node, workspace, credentials, transport, private-repo guard, git history, more) | no |
| `deploy-relay` | Deploy your own Cloudflare relay in **one command** (no `wrangler` typing) and print the invite | yes |
| `upgrade` | Migrate an existing zero-setup workspace → team relay (deploys one for you if you have none) | yes |

`rotate` is also routed (`/handshake rotate`) but is an offboarding action that
needs the recovery key — never run it on your own initiative. Full verb
reference and confirmation rules: [commands/handshake.md](commands/handshake.md);
decision tree and worked examples: [skills/handshake/SKILL.md](skills/handshake/SKILL.md).

## Requirements

- **Node.js 18+ (20+ recommended)** — the CLI and every hook shell out to
  `node`. `handshake doctor` checks this and reports honestly instead of
  guessing; the installers refuse to finish without a working `node --version`.
- **macOS, Linux, or Windows**, with Claude Code installed (the installer
  fetches it for you if it's missing).
- **WSL**: works, with a caveat — Claude Code plugins currently don't load
  hooks or monitors inside WSL. The installer detects this and falls back to a
  direct copy plus a printed hook-registration snippet. Monitors (the
  heartbeat/claim-renewal clock) stay unavailable there; coordination still
  works, falling back to heartbeating on turn boundaries
  ([PROTOCOL.md §8](docs/PROTOCOL.md)).
- **Team relay** (optional, for real work beyond trying it out): a free
  Cloudflare account and one browser login, needed only by whoever deploys the
  relay. `/handshake deploy-relay` does the whole deploy in one command (no
  `wrangler` typing) — see [relay/README.md](relay/README.md) (about three
  minutes). Members joining an already-deployed relay need nothing extra.

## Context cost

The standing block that Claude sees on **every turn** inside a workspace is a
hard-capped, measured budget, not an estimate: **≤ 600 characters, roughly
~150 tokens per turn**. That's a fixed ~258-character frame (the trust framing
and the literal never-list, present even on a first run with an empty roster)
plus up to ~342 characters for peer roster, live claims, and a short digest of
what's new. A solo/first-run block measures 284 characters; a full block with
two peers, two claims, and an overflowing digest measures 562 characters.
Nothing here is injected silently beyond that block — the fetch cap (20
messages/sync) and the inject cap (5 items) are deliberately different
numbers so a busy sync never balloons what lands in context. Full template,
truncation order, and rendered examples:
[skills/handshake/references/standing-block.md](skills/handshake/references/standing-block.md).

## Troubleshooting

- **Is it actually running?** `/handshake doctor` (or `handshake doctor` from a
  terminal) runs a pass/warn/fail check: Node version, workspace resolution,
  state-dir permissions, relay reachability, credentials, git working tree,
  the private-repo guard, tracked-secret and git-history scans, and
  child-mode detection. Nothing in it guesses — an unknown reads as unknown,
  never as pass.
- **Is the plugin itself active?** That's a different question from `doctor`
  (which needs a workspace to check most things) and is what the installer's
  own three-valued self-check answers: **not-installed** / **installed-but-
  not-active** / **active-verified**, proven by a hook's own side effect
  (fresh state under `${CLAUDE_PLUGIN_DATA}` or `~/.claude/handshake`) —
  never by a file merely existing. Re-run it anytime: `install.sh --verify` /
  `install.ps1 -VerifyActive`. Details on what each value means and how to
  move from one to the next: [docs/INSTALL.md](docs/INSTALL.md).
- **Plugin listed but not doing anything?** Run `/reload-plugins` inside
  Claude Code, then start a new session — `UserPromptSubmit` only reads
  local cache and a freshly-installed plugin needs one reload to register.
- **On WSL**, hooks not firing is expected until you've followed the printed
  settings.json snippet from the fallback install — see
  [docs/INSTALL.md](docs/INSTALL.md).

## Learn more

- [PLAN.md](PLAN.md) — the frozen v1 design and build plan
- [docs/PROTOCOL.md](docs/PROTOCOL.md) — the wire protocol: envelopes, claims,
  transports, failure taxonomy (normative)
- [docs/SECURITY.md](docs/SECURITY.md) — threat model, trust boundaries, key
  material, offboarding runbooks (what's covered, and what explicitly isn't)
- [docs/INSTALL.md](docs/INSTALL.md) — the detailed install / upgrade /
  uninstall reference
- [relay/README.md](relay/README.md) — deploying your own team relay

## License

MIT © Fenil K Ventures LLC
