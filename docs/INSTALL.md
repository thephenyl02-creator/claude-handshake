# Install / upgrade / uninstall reference

This is the detailed reference. For the three-tier quick version (paste /
one-liner / manual), see the [README](../README.md#install). Everything below
is normative for what the installers in [`installers/`](../installers/)
actually do, including the fallback paths and the exact things a maintainer
should check before trusting a run.

## Contents

- [Requirements](#requirements)
- [The installers](#the-installers)
- [The primary route: marketplace + plugin](#the-primary-route-marketplace--plugin)
- [The fallback route: direct copy + hook registration](#the-fallback-route-direct-copy--hook-registration)
- [Invoking the CLI outside Claude Code](#invoking-the-cli-outside-claude-code)
- [The self-check](#the-three-valued-self-check)
- [Upgrading](#upgrading)
- [Uninstalling](#uninstalling)
- [Security: credentials and push protection](#security-credentials-and-push-protection)
- [Troubleshooting](#troubleshooting)

## Requirements

| | |
|---|---|
| **Node.js** | 18+ required, **20+ recommended**. `/handshake doctor` grades this itself: 20+ is `pass` (global `fetch`, `hkdfSync`, `node:test` all available), 18–19 is `warn` (works, but `node --test` is thin before 20), below 18 is `fail`. The CLI (`bin/handshake.js`) and every hook shell out to `node` — there is no code path that works without it. |
| **Claude Code CLI** | Any version that supports plugins. The installers fetch and install it via the official installer (`https://claude.ai/install.sh` / `https://claude.ai/install.ps1`) if it's missing. |
| **macOS / Linux** | Supported natively via `installers/install.sh`. |
| **Windows** | Supported natively via `installers/install.ps1` (PowerShell 5.1+ or pwsh). |
| **WSL** | Works, with a caveat: Claude Code plugins are currently known **not to load hooks or monitors inside WSL**. `install.sh` detects WSL (`$WSL_DISTRO_NAME`, `$WSL_INTEROP`, or `microsoft` in `/proc/version`) and installs the fallback copy unconditionally there, regardless of what the plugin route itself reports. |
| **Team relay** (optional) | A free Cloudflare account and one browser login, needed only by whoever deploys the relay. `/handshake deploy-relay` deploys it in **one command once you're signed in to Cloudflare** — it fetches `wrangler` through `npx`, so nothing is installed globally and you never type `wrangler` yourself. The first run needs that sign-in done in a real terminal first: `deploy-relay` checks stdin and refuses before it ever opens a browser or waits on a login, telling you to run `npx --yes wrangler@4 login` there — see [`relay/README.md`](../relay/README.md). Members joining an already-deployed relay need nothing extra. |

## The installers

```
installers/install.sh     macOS / Linux / WSL (bash)
installers/install.ps1    Windows (PowerShell 5.1+ / pwsh)
```

Both are self-contained, idempotent, and safe to re-run. Both accept:

| Flag | Effect |
|---|---|
| (none) | Full install: Node check → Claude CLI check → primary route → fallback route if needed → self-check |
| `--verify` (bash) / `-VerifyActive` (PowerShell) | Re-run **only** the self-check — no install work, no network calls beyond what the self-check itself needs (a local `claude plugin list`) |
| `--help` / `-Help` (also `-h`, `-?`) | Usage |
| anything else | Usage on stderr and **exit 2** — nothing is installed. A mistyped flag (`--verfiy`, `-VerifyActiv`) must never silently perform a full unattended install |

> The PowerShell script's `param()` block deliberately has **no**
> `[CmdletBinding()]`, so unbound arguments land in `$args` instead of being
> rejected by the binder. The unknown-argument guard therefore lives *outside*
> the `& { … }` body — inside it, `$args` would be the script block's own
> (always empty) argument list. Under `irm | iex` no arguments can be passed at
> all and `$args` is empty even when the surrounding scope has its own, so the
> guard is inert there and never calls `exit`.

**Flags need the script on disk.** The one-liners in the README pipe the
script straight into an interpreter, and neither `curl … | bash` nor
`irm … | iex` can pass arguments to it. Save it first when you want to re-run
the self-check later:

```sh
# macOS / Linux / WSL
curl -fsSL https://raw.githubusercontent.com/thephenyl02-creator/claude-handshake/main/installers/install.sh -o install.sh
bash install.sh            # install
bash install.sh --verify   # re-check activation, any time
```

```powershell
# Windows
irm https://raw.githubusercontent.com/thephenyl02-creator/claude-handshake/main/installers/install.ps1 -OutFile install.ps1
.\install.ps1                 # install
.\install.ps1 -VerifyActive   # re-check activation, any time
```

**Exit codes.** The install path exits `0` when the install itself succeeded
and `1` when nothing could be installed **or** when the plugin was installed
but the host refuses to load it — `installed-but-not-active` is the *expected*
outcome of a fresh install and is not reported as a failure, so
`curl … | bash && …` behaves. The `--verify` / `-VerifyActive` path is the one
that returns the full status: `0` active-verified, `1`
installed-but-not-active, `2` not-installed, `3` listed-but-failed-to-load.
An unknown flag exits `2` from either path without installing anything.

**Config directory.** Every path both installers read or write —
`commands/`, `skills/`, `plugins/data/`, the fallback copy, the backup
directories, and both self-check state roots — is derived from
`$CLAUDE_CONFIG_DIR` when that variable is set, and from `~/.claude` only when
it is not. Setting `CLAUDE_CONFIG_DIR` moves the whole Claude Code
configuration tree, so an installer that hardcoded `~/.claude` would install
into a directory the host never reads and could never reach `active-verified`.

Both scripts port the hardening built for [claude-tier's installers](https://github.com/thephenyl02-creator/claude-tier)
across four adversarial review rounds, adapted for a full hook+monitor+CLI
plugin instead of a skill-only one:

- **Claude CLI auto-install** if `claude` isn't found, using the official
  installer, with the download and run split into separate steps so a
  network failure is never misdiagnosed as "binary not found."
- **PATH fix** (bash only) — appends the CLI's bin dir to `~/.zshrc` /
  `~/.bashrc` if it isn't already there, without ever touching the user's
  actual PATH for commands this script itself runs (it always uses the
  absolute binary path).
- **SSH→HTTPS fallback** — `GIT_CONFIG_KEY_*`/`GIT_CONFIG_VALUE_*` env vars
  rewrite `git@github.com:`/`ssh://git@github.com/` to `https://github.com/`
  for the duration of the script only, sidestepping every SSH failure mode
  (missing `~/.ssh`, unknown host key, no key registered with GitHub).
- **No-git fallback with a marker file** — see below.
- **PS 5.1 `irm | iex` caller-scope wrapping** — the entire PowerShell script
  body runs inside `& { ... } finally { ... }` so variables, functions, and
  every process-wide change (`$ErrorActionPreference`, `$env:PATH`, the git
  env overrides) are restored when the script ends, and under `irm | iex`
  (where `$PSCommandPath` is empty) the script never calls `exit`, so a
  failure can't kill the caller's whole terminal session.
- **Backups kept outside the managed directory** — see below.

New in this port (not in claude-tier, which is skill-only and needs none of
this):

- **Node.js step zero.** See [Requirements](#requirements) above — Windows
  attempts an automatic install via `winget` (falling back to `choco`) and
  refreshes `$env:Path` from the registry afterward so the same process can
  pick up the new install without a fresh terminal; macOS/Linux deliberately
  does **not** auto-install (no assumption about which package manager you
  use), it points at the official installer and refuses to continue.
- **WSL detection** and an unconditional fallback copy there.
- **The self-check** (four outcomes), described below.

## The primary route: marketplace + plugin

```sh
claude plugin marketplace add https://raw.githubusercontent.com/thephenyl02-creator/claude-handshake/main/.claude-plugin/marketplace.json
claude plugin marketplace update claude-handshake
claude plugin install claude-handshake@claude-handshake
claude plugin update claude-handshake@claude-handshake
```

This is what the installers actually run — note the **raw URL**, not the
`owner/repo` shorthand. `marketplace add` on a raw URL needs no git at all:
the CLI downloads and caches the manifest over plain HTTPS, and
`marketplace update` re-fetches it. The `owner/repo` shorthand (what a human
types interactively — see the README's "Expert" tier) is a real, supported
form (`claude plugin marketplace add --help` documents "a URL, path, or
GitHub repo"), but it may fall back to git/SSH under the hood, which is
exactly the failure mode an unattended installer script cannot depend on.

Both `marketplace add` and `plugin install` **short-circuit to exit 0 without
fetching anything** when the target already exists — "already added" and
"already installed" are both silent no-ops. Only `marketplace update` and
`plugin update` actually pull a newer version. This is why every run of the
installer performs all four calls unconditionally: `add` (ignore failure —
it's a no-op on a re-run anyway) → `marketplace update` (unconditional
refresh) → `install` (works on a clean machine) → `update` (works when
already installed; exits 1 when not, so it can never mask a genuine `install`
failure). The route is considered successful if **either** `install` or
`update` reported success.

## The fallback route: direct copy + hook registration

Triggered when the primary route fails outright, **or** unconditionally when
WSL is detected (a reported plugin-route success is not a working install
there). It needs no git — a `.tar.gz` (bash) / `.zip` (PowerShell) of `main`
is downloaded directly from GitHub.

1. The archive is extracted and copied to a **versioned directory**:
   `~/.claude/handshake-plugin/<version>/` (the version comes from the
   downloaded copy's own `package.json`, read via `node`, not hardcoded in
   the installer — so it stays correct across releases without an installer
   edit). The copy is then **pruned to the runtime payload**: the archive is
   the whole repository, and `test/`, `e2e/`, `spike/`, `scripts/`, `docs/`,
   `installers/`, `PLAN.md` and the relay's dev files are never loaded at
   runtime, so they are removed rather than parked in the user's config
   directory forever (measured: 105 files → 51). What is kept is exactly what
   a hook, the CLI, the skill/command files and `deploy-relay` read: `bin/`,
   `lib/`, `hooks/`, `monitors/`, `skills/`, `commands/`, `.claude-plugin/`,
   `relay/{src,wrangler.toml,package.json}`, `package.json`, `LICENSE`,
   `README.md`. The prune is followed by a completeness check — the installer
   aborts unless `bin/handshake.js`, `hooks/` and `lib/` all survived it
   ([`install.sh:818-821`](../installers/install.sh),
   [`install.ps1:808-812`](../installers/install.ps1)). That check is
   presence, not execution: neither installer runs the CLI against the pruned
   copy, so a file that is present but broken is still caught only later, by
   `/handshake doctor`.
2. A **marker file** (`.installed-by-claude-handshake-installer`) is written
   at the root of that versioned copy. On every future run, only a directory
   carrying this marker is ever replaced or cleaned up automatically — a
   hand-authored directory that happens to occupy the same path is moved
   aside to `~/.claude/handshake-plugin-backup.<timestamp>` (bash) /
   `~/.claude/handshake-plugin-backup.<timestamp>` (PowerShell), **outside**
   `~/.claude/handshake-plugin/` so a later scan never mistakes it for a
   managed copy.
3. Every `${CLAUDE_PLUGIN_ROOT}` / `$CLAUDE_PLUGIN_ROOT` reference inside the
   copied `.md` and `.json` files is rewritten to the copy's own absolute
   path — those placeholders are only ever set by the Claude Code plugin
   host, which this copy is deliberately running outside of.
4. **`commands/handshake.md` and `skills/handshake-coordination/`** are
   additionally copied to `~/.claude/commands/handshake.md` and
   `~/.claude/skills/handshake-coordination/`.
   Claude Code auto-loads both locations without any settings edit (the same
   mechanism claude-tier's skills-dir fallback relies on) — so `/handshake`
   and the on-demand skill work as soon as Claude Code picks them up.
   These two are **shared user directories**, not directories the installer
   owns, so the same ownership rule applies there as everywhere else: an
   existing file or directory that the installer did not write (or that
   differs from what is being installed) is moved to
   `~/.claude/handshake-backup.<timestamp>/` first — outside `~/.claude/skills`,
   so it can never load as a second, stale `handshake-coordination` skill. The
   replacement is staged alongside and renamed into place, so nothing is deleted
   before its replacement exists.

   The skill directory was named `skills/handshake/` up to and including v0.1.2.
   It had to be renamed because Claude Code registers commands and skills into
   **one** namespace keyed by the file/directory name, not by the SKILL.md
   frontmatter `name:` — so `commands/handshake.md` and `skills/handshake/`
   both registered as `handshake` and the plugin inventory listed the name
   twice. On a machine that installed the older layout through this route, the
   installer removes the leftover `~/.claude/skills/handshake/` **only** when it
   carries the installer's marker file; an unmarked directory at that path is
   hand-authored and is left alone, with a warning that it may shadow
   `/handshake`.
5. **Hooks have no such auto-load directory**, so the installer prints — but
   deliberately does **not** write — the exact `"hooks"` object to merge into
   `~/.claude/settings.json` by hand (paths already resolved to the copy's
   absolute location). Review it (or have your own Claude Code session apply
   it and show you the diff) before saving; this installer will never edit
   `settings.json` silently.

   The printed commands **pin the absolute path of the `node` binary** the
   installer found, rather than the bare word `node` that `hooks/hooks.json`
   ships (correct for the plugin route, where the host resolves it). Claude
   Code runs a hook with the environment of whatever process started Claude
   Code, and an nvm/asdf/fnm-managed node is routinely absent from that PATH —
   measured on Ubuntu 24.04/WSL2, `bash -c` and `bash -lc` both fail to find
   an nvm node, only `bash -ic` finds it. Since hooks fail soft, a bare `node`
   there produces five silent `node: command not found` failures per session
   and an install that looks perfectly healthy while doing nothing. The
   substitution goes through the same node-based JSON renderer that emits the
   snippet, so quoting and escaping stay correct for a path with spaces. If you
   later switch node versions, update that path by hand — the installer prints
   a note saying so.
6. **Monitors are not available in fallback mode** — there is no
   settings.json equivalent for `experimental.monitors`. This is a documented,
   handled condition, not a defect: claude-handshake already falls back to
   "heartbeating on turn boundaries" whenever monitors are unavailable
   ([PROTOCOL.md §8](PROTOCOL.md)), so coordination still works — just at
   reduced liveness precision. The same 60s/10min cadence still applies; the
   Stop hook simply samples it at your turn boundaries, so a beat lands on the
   first turn that ends after a window elapses rather than on the tick itself.
   A burst of quick turns does not produce a burst of messages.

When the primary route *does* succeed on a later run, the installer removes the
superseded fallback install automatically. That means **all three** things the
fallback route wrote, not just the versioned directory:

| Left over from the fallback route | How ownership is proven | What the upgrade does |
|---|---|---|
| `~/.claude/handshake-plugin/<version>/` | carries the marker file | contents removed first, marker deleted last, so a locked file (Claude Code still running) leaves the marker intact and a later run can finish the cleanup |
| `~/.claude/skills/handshake-coordination/` | carries the marker file | removed; **without** the marker it is left completely untouched (with a warning that it may shadow the plugin's own skill) |
| `~/.claude/skills/handshake/` (the pre-rename name, ≤ v0.1.2) | carries the marker file | removed; **without** the marker it is left completely untouched (with the same warning) |
| `~/.claude/commands/handshake.md` | a single file, so no marker is possible — proven by comparing it byte-for-byte against the `commands/handshake.md` of a marked fallback copy, *before* those copies are deleted | identical → removed; differing (hand-edited, or from an older release whose fallback directory is already gone) → moved to `~/.claude/handshake-backup.<timestamp>/commands-handshake.md` first, so nothing is destroyed but it can no longer shadow the plugin's `/handshake` |

None of that runs at all unless there is evidence *this installer's* fallback
route ran on the machine (a marked fallback copy, or a marked
`skills/handshake-coordination/` or `skills/handshake/`). On a machine that only
ever used the plugin route, a hand-written `~/.claude/commands/handshake.md` is
never touched.

Skipping the cleanup is also correct in one case and the installer does it: if
`claude plugin list` reports the plugin as **failed to load**, the fallback copy
is kept, because deleting it would leave nothing running at all.

Leaving the orphans behind was a real defect (fixed): the upgrade deleted the
directory while the user-level `skills/…/SKILL.md` still contained absolute
paths into it, and `/handshake` plus the skill then loaded twice — once from
the orphans, once from the plugin.

## Invoking the CLI outside Claude Code

Everything the product does is reached through `/handshake` inside a session.
Neither install route above puts a `handshake` executable on your `PATH`:
their `PATH` work targets the `claude` binary and says so
([`install.sh:500-524`](../installers/install.sh)), and the plugin system
executes files by absolute path, never by name
([`hooks/hooks.json`](../hooks/hooks.json)).

A few things do work from a terminal today:

1. **Direct, literal path** — the form to use outside a Claude Code session,
   in a plain terminal. `$CLAUDE_PLUGIN_ROOT` is a variable Claude Code's
   plugin host sets for hooks and commands it runs; a plain terminal has no
   reason to carry it. For the fallback copy the installers rewrite the
   shipped `/handshake` command file's placeholder to an absolute directory,
   so that copy has a fixed, known path to call directly:

   ```sh
   node ~/.claude/handshake-plugin/<version>/bin/handshake.js doctor
   ```

   For the marketplace/plugin route, find that absolute path under Claude
   Code's plugin install directory for this plugin and version, then call it
   the same way.

2. **`$CLAUDE_PLUGIN_ROOT`** — the form the shipped `/handshake` command file
   itself uses, valid only inside a Claude Code session where the plugin host
   has set it:

   ```sh
   node "$CLAUDE_PLUGIN_ROOT/bin/handshake.js" doctor
   ```

   If the variable is empty (i.e. you're not in a session that set it), it
   expands to nothing and the `node` call fails — use form 1 instead.

3. **A `PATH` shim**, only if you install the npm package rather than the
   plugin. `bin/handshake.js` carries a `#!/usr/bin/env node` shebang and
   `package.json` maps it as `handshake`, so npm creates the shim; nothing
   else does:

   ```sh
   git clone https://github.com/thephenyl02-creator/claude-handshake
   npm install -g ./claude-handshake
   handshake doctor
   ```

   This installs the CLI, **not** the plugin: no hooks, no monitor, no
   `/handshake`. Coordination still needs one of the two routes above.

<a id="the-three-valued-self-check"></a>

## The self-check

Four outcomes, never a guess in between (the legacy anchor
`#the-three-valued-self-check` still resolves here):

| Value | Exit | Meaning |
|---|---|---|
| **not-installed** | 2 | Neither the plugin (`claude plugin list`) nor a marked fallback copy was found. |
| **load-failed** | 3 | The plugin is listed, but `Status:` reports `failed to load` — and nothing else (no fallback copy, no fresh hook evidence) is carrying the install. |
| **installed-but-not-active** | 1 | The plugin or fallback copy is present, but no hook has proven itself live recently. |
| **active-verified** | 0 | A hook (SessionStart, and everything downstream of it) wrote fresh local state — proof it actually ran, not just that files exist on disk. |

**`load-failed` is deliberately not folded into `installed-but-not-active`.**
A disabled plugin is one `/reload-plugins` away; a plugin the host *cannot
load* is inert, and a reload just re-reads the same broken manifest and fails
in exactly the same way. Reporting it as the benign case with the generic
"run `/reload-plugins`" advice — and exiting `0` — is precisely how the v0.1.0
dead-on-arrival manifest reached a "successful" install and left users in a
loop with no diagnosis. The self-check now prints the verbatim `Error:` line
from `claude plugin list`, says plainly that a reload cannot fix a load failure,
and exits nonzero (`3` from `--verify`, `1` from the install path).

One exception, on purpose: when a marked fallback copy is present or a hook has
recently proven itself live, the same load failure is reported as a **warning**
and the self-check continues — that is the normal WSL shape (plugin entry
broken, fallback copy doing the work), and failing the install there would be a
false alarm.

"Fresh" means an mtime less than 30 minutes old — mere existence is never
enough; a state file from a stale install months ago must not read as active
today.

But recency alone is not proof either, because **a false `active-verified` is
worse than a false `installed-but-not-active`**. `state.json` is written by
every `SessionStart` hook — and also by `bin/handshake.js` itself on `init`,
`join`, `mute`, `rest` and `sync`. So a fresh `state.json` in
`~/.claude/handshake/` proves only that *the CLI ran in a terminal*; running
`/handshake init` with the hooks never registered would otherwise light up as
"active". The self-check therefore sorts evidence by who could possibly have
written it:

| Evidence | Who can write it | Counts as proof? |
|---|---|---|
| `posttool.tick`, `activity.mark`, `hooks.ticks.json` | `hooks/post-tool-use.js` only | **yes** |
| `monitor.alive` | `monitors/heartbeat.js` only | **yes** |
| anything under `~/.claude/plugins/data/claude-handshake*/` | only a plugin process — `CLAUDE_PLUGIN_DATA` is set by the host, never by a terminal | **yes** |
| `state.json` under `~/.claude/handshake/` | a hook *or* a plain CLI run | no — reported honestly as "the CLI ran, not a hook" |
| `session.json` | the CLI only, and only on a "loud condition" | not scanned at all |

When only the ambiguous evidence is fresh, the self-check says so explicitly
and tells you how to produce real proof: make **one edit or Bash call** inside
a handshake workspace in Claude Code. That fires `PostToolUse`, which nothing
but a hook can do, and the next `--verify` reports `active-verified`.

The tricky part: **the installer's own process never sees
`${CLAUDE_PLUGIN_DATA}`** — that variable is set by the Claude Code host
inside a hook's process, not inherited by an unrelated script you run in your
terminal. So the self-check scans **both** plausible roots rather than
guessing one:

- `~/.claude/handshake/<workspace-id>/` — where the CLI and the fallback
  route's hooks write when no `CLAUDE_PLUGIN_DATA` is set (matches
  `lib/state.js`'s own fallback rule exactly).
- `~/.claude/plugins/data/claude-handshake*/<workspace-id>/` — where an
  installed-plugin route's hooks write (the exact suffix after
  `claude-handshake` is host-assigned and was observed to vary, e.g.
  `-inline` for a locally-sourced dev install — the scan globs for the whole
  family rather than hardcoding one).

Both hooks are workspace-scoped no-ops (PROTOCOL §8: "every hook is a
sub-10ms no-op outside a handshake workspace") — so immediately after a fresh
install, **installed-but-not-active is the expected, honest result**, not a
failure. To move to active-verified:

1. `cd` into a project directory (ideally a git repo).
2. Start Claude Code there: `claude`.
3. Run `/handshake init` if the project has no workspace yet.
4. Start a **new** session (`SessionStart` only runs its network-visible path
   on `startup`/`resume`/`fork` — a `clear`/`compact` inside the same session
   won't trigger it).
5. Re-run the self-check: `install.sh --verify` / `install.ps1 -VerifyActive`.

If the plugin is listed but not reporting `enabled` *and not reporting a load
failure*, the self-check tells you to run `/reload-plugins` inside Claude Code
and start a new session instead — a freshly-installed plugin needs one reload
to register before any hook can fire at all. That advice is never given for a
`failed to load` entry, where it cannot possibly help.

Both state roots follow `$CLAUDE_CONFIG_DIR` when it is set (see
[Exit codes / Config directory](#the-installers) above) — the scan looks
where the host actually writes, not at a hardcoded `~/.claude`.

## Upgrading

**Primary route:**

```sh
claude plugin update claude-handshake@claude-handshake
```

or simply re-run the installer — it's idempotent and calls `update`
unconditionally on every run (see [above](#the-primary-route-marketplace--plugin)).
A restart of Claude Code (or a new session) is required to pick up the
update, same as any plugin update.

**Fallback route:** re-run the installer. It downloads the current `main`,
reads the new version from `package.json`, and installs it to a **new**
versioned directory (`~/.claude/handshake-plugin/<new-version>/`) rather than
overwriting the one you may currently have loaded — a running Claude Code
session with hooks pointed at the old path keeps working uninterrupted. Two
things are **not** automatic and need your own follow-up:

- If the hook set itself changed between versions (a new hook file, a changed
  matcher), you'll need to re-merge the printed `"hooks"` snippet into
  `~/.claude/settings.json` — diff it against what's there before overwriting.
- Old versioned directories under `~/.claude/handshake-plugin/` are not
  deleted automatically. Once you've confirmed the new version is active
  (`--verify` / `-VerifyActive` reports `active-verified`) and updated
  `settings.json`, remove the old one(s) yourself.

## Uninstalling

**Primary route:**

```sh
claude plugin uninstall claude-handshake@claude-handshake
```

By default this also removes the plugin's persistent data directory
(`~/.claude/plugins/data/<id>/` — where your workspace's local state,
sub-token, and offline queue live). Pass `--keep-data` to preserve it instead
(useful if you're about to reinstall and want to keep an existing workspace
identity). To also drop the marketplace registration itself:
`claude plugin marketplace remove claude-handshake`.

**Fallback route** has no CLI command for this — remove by hand, and **in this
order**. (Every `~/.claude/…` path below means `$CLAUDE_CONFIG_DIR/…` if you
have that set.) The settings entries go first: while `settings.json` still
points at a directory you have already deleted, every hook event fails with a
"cannot find module" error until you finish.

0. **Close Claude Code.** A running session holds the copy open on Windows and
   will re-read `settings.json` mid-cleanup elsewhere.
1. Remove the `"hooks"` entries you merged into `~/.claude/settings.json`
   (find them by the absolute paths pointing into `handshake-plugin/` — the
   installer resolved `${CLAUDE_PLUGIN_ROOT}` before printing them). Keep the
   rest of the file intact; other tools share it.
2. `~/.claude/commands/handshake.md`
3. `~/.claude/skills/handshake-coordination/` (and `~/.claude/skills/handshake/`
   if a release at or before v0.1.2 installed the pre-rename name there)
4. `~/.claude/handshake-plugin/` (every versioned copy)
5. `~/.claude/handshake/` — the local state described below. Delete this last,
   and only if you also want the workspace identity gone.

Anything the installer moved aside on your behalf is left for you to deal with
deliberately — it is never auto-deleted:

- `~/.claude/handshake-plugin-backup.<timestamp>/` — a pre-existing
  `handshake-plugin/<version>/` directory the installer did not write.
- `~/.claude/handshake-backup.<timestamp>/` — your previous
  `commands/handshake.md` or `skills/handshake-coordination/`, if either
  differed from the version being installed.

Both live **outside** the directories the installer manages, so they are never
re-discovered as a live command, skill, or plugin copy. Restore from them or
delete them at your leisure.

> `~/.claude/handshake-spike.log` (from the throwaway M0.5 spike plugin, if it
> was ever installed) is a *different* file that also starts with `handshake`.
> Remove the paths above by name — never with a `rm -rf ~/.claude/handshake*`
> glob, which would sweep up unrelated files.

**Either route**, your workspace's local state — `~/.claude/handshake/<ws>/`
or the plugin data directory — holds the sub-token and, on ntfy, the topic
(both bearer credentials, SECURITY.md §3). Neither uninstall path removes a
**joined workspace's membership on the transport itself** — if you're leaving
a team's workspace for good, run `/handshake rest` (or ask the founder to
remove your member) before uninstalling, not after.

## Security: credentials and push protection

claude-handshake's credential formats (`hsk_`, `hsr_`, `hsm_` prefixes, each
with a checksum) are **deliberately greppable**, so GitHub push protection and
third-party secret scanners can catch a leak before it's pushed
(SECURITY.md §3.1). If push protection blocks a commit because it found one
of these:

- **The default, correct response is to fix the leak**: stop committing the
  secret (check `.handshake/*` is where the private-repo guard actually
  expects it, per [SECURITY.md §6](SECURITY.md)), and rotate the credential.
  Allowlisting the finding does **not** undo an already-pushed commit, and
  rotation itself does not un-leak git history (SECURITY.md §3.1, §6) — the
  commit that carried it stays in every clone, fork, and archive that already
  pulled it.
- **Allowlisting is documented only for one case**: an intentional,
  **already-rotated** value kept for documentation or test fixtures (a dead
  credential that can never be used again). Never allowlist a live credential
  to make a push go through faster.

Full key-material inventory, holder sets, and offboarding runbooks:
[SECURITY.md §3, §7](SECURITY.md).

## Troubleshooting

| Symptom | Check |
|---|---|
| `node --version` fails after the Windows installer says it installed Node | Open a **new** terminal — PATH changes from `winget`/`choco` don't always propagate to a script's own already-running process even after the refresh attempt. |
| Plugin route fails every time | Check `claude plugin marketplace list` for a stale `claude-handshake` entry pointing somewhere wrong; `claude plugin marketplace remove claude-handshake` and re-run the installer. |
| `/handshake` command not recognized | You likely need `/reload-plugins` or a new session — see the self-check section above. |
| The self-check says `load-failed` | The plugin's manifest is broken for this Claude Code version — read the printed `Error:` line, re-run the installer (it always calls `plugin update`), and report it if a fixed release does not clear it. `/reload-plugins` cannot help. |
| Everything installed, hooks still never fire (fallback route) | Check the `"command"` strings you merged into `settings.json`: they must point at an **absolute** node binary. Hooks fail soft, so a `node: command not found` is invisible. Re-run the installer and copy the snippet again — it pins the interpreter for you. |
| `/handshake` or the skill appears twice after upgrading to the plugin route | An older installer left the user-level command/skill behind. Re-run the installer once: it now removes its own superseded copies (and backs up anything it did not write). |
| Hooks not firing on WSL | Expected until you've merged the printed `settings.json` snippet by hand — the fallback route never edits it for you. |
| `/handshake doctor` reports `fail` on `node` | You're on Node < 18; upgrade — `node --test` and the CLI's use of global `fetch`/`hkdfSync` need 18+, and doctor recommends 20+. |
| Unsure if you're on the plugin route or the fallback route | `claude plugin list` shows the plugin if the primary route is active; `Test-Path ~/.claude/handshake-plugin` (or `ls ~/.claude/handshake-plugin`) shows a fallback copy. Both can coexist briefly during a transition — the installer cleans up a superseded fallback copy automatically once the plugin route is confirmed working. |

For anything not covered here: `/handshake doctor` and this file's
[self-check section](#the-three-valued-self-check) cover activation and
health; [SECURITY.md](SECURITY.md) covers anything credential- or
trust-related; [PROTOCOL.md](PROTOCOL.md) is the normative wire behavior if
something looks like a protocol mismatch.
