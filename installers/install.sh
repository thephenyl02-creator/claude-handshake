#!/usr/bin/env bash
# claude-handshake installer (macOS / Linux / WSL)
# https://github.com/thephenyl02-creator/claude-handshake
#
#   curl -fsSL https://raw.githubusercontent.com/thephenyl02-creator/claude-handshake/main/installers/install.sh | bash
#
# Ported from claude-tier's install.sh (4 adversarial review rounds, ~38
# findings) and adapted for a full hook+monitor+CLI plugin instead of a
# skill-only one. Handles: missing Node (required by the CLI and every hook),
# missing Claude Code CLI, PATH not set, unwritable shell profile, SSH-to-GitHub
# failures, and the fact that Claude Code plugins do not currently load hooks
# or monitors inside WSL. Ends with a three-valued self-check instead of a bare
# "restart and hope" - the plugin is proven active by a hook's own side effect,
# never merely by a file existing on disk.
#
#   install.sh              full install (Node check, plugin, fallback if needed)
#   install.sh --verify     re-run ONLY the self-check
#   install.sh --help       usage
#   anything else           usage + exit 2, and NOTHING is installed
#
# Self-check exit codes: 0 active-verified, 1 installed-but-not-active,
# 2 not-installed, 3 listed-but-failed-to-load (inert; a reload cannot fix it).

set -u

if [ -z "${HOME:-}" ]; then
  printf 'HOME is not set; re-run from a normal login shell.\n' >&2
  exit 1
fi

REPO="thephenyl02-creator/claude-handshake"
MARKETPLACE="claude-handshake"
# Raw-URL marketplace add needs no git at all (ported from claude-tier,
# verified there: the CLI downloads and caches the manifest over HTTPS, and
# `marketplace update` re-fetches it). This is deliberately NOT the
# `claude plugin marketplace add thephenyl02-creator/claude-handshake` shorthand
# a human would type interactively - that form may fall back to git/SSH, which
# is exactly what this installer must not depend on.
MARKETPLACE_URL="https://raw.githubusercontent.com/$REPO/main/.claude-plugin/marketplace.json"
PLUGIN="claude-handshake"
TARBALL_URL="https://github.com/$REPO/archive/refs/heads/main.tar.gz"
# Marks a fallback copy as written by this installer, so a later successful
# plugin install may safely replace it (and never a hand-authored directory).
MARKER=".installed-by-claude-handshake-installer"
# Claude Code reads and writes its whole configuration tree from
# $CLAUDE_CONFIG_DIR when that is set (commands/, skills/, plugins/data/,
# settings.json), and only falls back to ~/.claude when it is not. Every path
# below - the fallback copy, the shared command/skill locations, the backup
# directories and BOTH self-check state roots - must follow it, or a user who
# sets it can never reach active-verified (the roots would be scanned in a
# directory the host never writes to).
if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
  CLAUDE_DIR="${CLAUDE_CONFIG_DIR%/}"
else
  CLAUDE_DIR="$HOME/.claude"
fi
FALLBACK_ROOT="$CLAUDE_DIR/handshake-plugin"
# lib/state.js resolves ${CLAUDE_PLUGIN_DATA} when set, else ~/.claude/handshake
# - but CLAUDE_PLUGIN_DATA is set by the Claude Code HOST inside a hook's own
# process; this installer's own shell never sees it, even for a successful
# plugin-route install. A plugin-route install's real data dir was observed on
# a dev machine at ~/.claude/plugins/data/<plugin-name>[-inline]/ (the suffix
# varies by how the plugin was sourced), so the self-check scans BOTH that
# family AND the fallback-route's fixed ~/.claude/handshake - whichever one a
# hook actually wrote to is the one that lights up.
STATE_ROOT_FALLBACK="$CLAUDE_DIR/handshake"
STATE_ROOT_PLUGIN_GLOB="$CLAUDE_DIR/plugins/data/$PLUGIN"'*'
if [ -n "${CLAUDE_PLUGIN_DATA:-}" ]; then STATE_ROOT_OVERRIDE="$CLAUDE_PLUGIN_DATA"; else STATE_ROOT_OVERRIDE=""; fi
ACTIVE_WINDOW_SECS=1800   # 30 min: "fresh" means a hook fired recently, not ever
# A false "active" is worse than a false "not active", so evidence is split by
# WHO can possibly have written it:
#   hook-proof     - only a hook or monitor process ever creates these
#                    (post-tool-use.js writes posttool.tick / activity.mark /
#                    hooks.ticks.json; monitors/heartbeat.js writes
#                    monitor.alive). bin/handshake.js never touches them.
#   cli-ambiguous  - state.json. Hooks write it on every SessionStart, but so
#                    does the CLI (init / join / mute / rest / sync), so a
#                    fresh state.json in the FALLBACK root proves only that
#                    `handshake` ran in a terminal - NOT that a hook fired.
# Under a plugin-data root the ambiguity disappears: CLAUDE_PLUGIN_DATA is only
# ever set by the Claude Code host inside a plugin process, so anything fresh
# there is hook-proof by construction.
HOOK_PROOF_FILES='posttool.tick activity.mark hooks.ticks.json monitor.alive'
# Absolute path of the node binary, filled in by step zero below and baked into
# the printed settings.json snippet (see the comment there).
NODE_BIN=""

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  +\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  !\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m  x\033[0m %s\n' "$*" >&2; }

# ------------------------------------------------------------------- args ----

VERIFY_ONLY=0
# `for a in "$@"` is NOT safe here: under `set -u`, bash < 4.4 - which includes
# the /bin/bash macOS still ships (3.2) and therefore the `curl ... | bash`
# entry point on every stock Mac - aborts with "$@: unbound variable" when
# there are no positional parameters. Guard on $# instead.
if [ "$#" -gt 0 ]; then
  for a in "$@"; do
    case "$a" in
      --verify) VERIFY_ONLY=1 ;;
      -h|--help)
        printf 'usage: install.sh [--verify] [--help]\n'
        printf '  (no args)  full install: Node check, plugin route, WSL/no-git fallback\n'
        printf '  --verify   re-run only the self-check (0 active-verified /\n'
        printf '             1 installed-but-not-active / 2 not-installed /\n'
        printf '             3 listed-but-failed-to-load)\n'
        exit 0
        ;;
      *)
        # Never silently perform a full install because a flag was mistyped
        # (`--verfiy` must not reinstall).
        printf 'install.sh: unknown option: %s\n' "$a" >&2
        printf 'Nothing was installed. Run it with no arguments for a full install.\n' >&2
        printf 'usage: install.sh [--verify] [--help]\n' >&2
        exit 2
        ;;
    esac
  done
fi

if ! command -v curl >/dev/null 2>&1; then
  err "curl is required but not found. Install curl and re-run."
  exit 1
fi

# --------------------------------------------------- WSL detection (shared) ---

is_wsl() {
  [ -n "${WSL_DISTRO_NAME:-}" ] && return 0
  [ -n "${WSL_INTEROP:-}" ] && return 0
  grep -qi microsoft /proc/version 2>/dev/null && return 0
  return 1
}

# find_claude is defined here (not just in the "install" section below) so
# --verify can call self_check without running the rest of the install first.
find_claude() {
  if command -v claude >/dev/null 2>&1; then
    command -v claude
    return 0
  fi
  for c in "$HOME/.local/bin/claude" "$HOME/.claude/local/claude" \
           /usr/local/bin/claude /opt/homebrew/bin/claude; do
    if [ -x "$c" ]; then
      printf '%s\n' "$c"
      return 0
    fi
  done
  return 1
}

# ------------------------------------------------ self-check (shared logic) ---

# Four outcomes, never a guess in between:
#   2 not-installed            - no plugin entry AND no fallback copy
#   3 load-failed              - listed, but the host could not LOAD it and
#                                nothing else is carrying the install. A reload
#                                cannot fix a manifest/load error, so this must
#                                never be reported as the benign
#                                "installed-but-not-active" case (that is exactly
#                                how a dead-on-arrival manifest once reached a
#                                "successful" install).
#   1 installed-but-not-active - present, but no hook has proven it live recently
#   0 active-verified          - a hook (SessionStart et al.) wrote fresh state
#
# "Fresh" is judged by mtime recency (ACTIVE_WINDOW_SECS), never by mere
# existence - a state file from a stale install a month ago must not read as
# "active" today.
# Accumulators filled by scan_state_roots: newest hook-proof mtime, and newest
# mtime that only proves the CLI ran. 0 means "no such evidence at all".
PROOF_MTIME=0
AMB_MTIME=0

note_mtime() {  # $1 = file, $2 = 1 when this file is hook-proof
  local m
  [ -f "$1" ] || return 0
  m=$(stat -c '%Y' "$1" 2>/dev/null || stat -f '%m' "$1" 2>/dev/null || echo 0)
  case "$m" in ''|*[!0-9]*) return 0 ;; esac
  if [ "$2" -eq 1 ]; then
    [ "$m" -gt "$PROOF_MTIME" ] && PROOF_MTIME="$m"
  else
    [ "$m" -gt "$AMB_MTIME" ] && AMB_MTIME="$m"
  fi
  return 0
}

scan_one_root() {  # $1 = root dir, $2 = 1 when the whole root is hook-proof
  local root="$1" proof_root="$2" ws hp
  [ -d "$root" ] || return 0
  # One level deep by design: <root>/<workspace-id>/<file>.
  for ws in "$root"/*/; do
    [ -d "$ws" ] || continue
    for hp in $HOOK_PROOF_FILES; do
      note_mtime "$ws$hp" 1
    done
    note_mtime "${ws}state.json" "$proof_root"
  done
  return 0
}

# session.json is deliberately NOT scanned: no hook ever writes it (only the
# CLI does, and only on a "loud condition"), so it carries no activation
# signal - just false-positive risk.
scan_state_roots() {
  local d
  PROOF_MTIME=0
  AMB_MTIME=0
  if [ -n "$STATE_ROOT_OVERRIDE" ]; then
    # Only set inside a plugin process, so this root is hook-proof.
    scan_one_root "$STATE_ROOT_OVERRIDE" 1
    return 0
  fi
  scan_one_root "$STATE_ROOT_FALLBACK" 0
  for d in $STATE_ROOT_PLUGIN_GLOB; do
    scan_one_root "$d" 1
  done
  return 0
}

# Mirrors install.ps1's structural scan: find the id line, then read the entry
# that follows it up to the blank line that closes it. A bare `grep -i enabled`
# over nearby lines would read "Enabled: false" as enabled.
#
# The CLI renders one entry as:
#     <pointer> <plugin>@<marketplace>
#       Version: <v>
#       Scope:   <scope>
#       Status:  <glyph> enabled | <glyph> disabled | <glyph> failed to load
#       Error:   <message>            (zero or more, only when it failed)
#       Note:    <message>            (zero or more)
#     <blank line>
# Matching is ASCII-only on purpose: the bullet/tick glyph varies by locale and
# codepage, the Status: / Error: field names do not.
#
# Sets PLUGIN_LISTED / PLUGIN_ENABLED / PLUGIN_FAILED / PLUGIN_ERRORS rather
# than echoing, so the verbatim Error: lines survive intact (they contain
# spaces, quotes and paths). "failed to load" is tracked separately from "not
# enabled" because it is a hard, non-self-healing condition - see self_check.
PLUGIN_LISTED=0
PLUGIN_ENABLED=0
PLUGIN_FAILED=0
PLUGIN_ERRORS=""
read_plugin_state() {  # $1 = claude binary
  local out parsed
  PLUGIN_LISTED=0
  PLUGIN_ENABLED=0
  PLUGIN_FAILED=0
  PLUGIN_ERRORS=""
  [ -n "${1:-}" ] || return 0
  out="$("$1" plugin list </dev/null 2>/dev/null || true)"
  # First line: "<listed> <enabled> <failed>". Every later line: one verbatim
  # Error: line from the entry.
  parsed="$(printf '%s\n' "$out" | awk -v id="$PLUGIN@$MARKETPLACE" '
    index($0, id) > 0 { inentry = 1; listed = 1; next }
    inentry {
      if ($0 ~ /^[[:space:]]*$/) { inentry = 0; next }
      if ($0 ~ /Status:/) {
        line = tolower($0)
        if (line ~ /failed/) failed = 1
        else if (line ~ /disabled/) { }
        else if (line ~ /enabled/) enabled = 1
        next
      }
      if ($0 ~ /^[[:space:]]*Error:/) {
        sub(/^[[:space:]]+/, "", $0)
        errs[++n] = $0
      }
    }
    END {
      printf "%d %d %d\n", listed, enabled, failed
      for (i = 1; i <= n; i++) print errs[i]
    }
  ')"
  PLUGIN_LISTED="$(printf '%s\n' "$parsed" | head -n 1 | cut -d' ' -f1)"
  PLUGIN_ENABLED="$(printf '%s\n' "$parsed" | head -n 1 | cut -d' ' -f2)"
  PLUGIN_FAILED="$(printf '%s\n' "$parsed" | head -n 1 | cut -d' ' -f3)"
  PLUGIN_ERRORS="$(printf '%s\n' "$parsed" | tail -n +2)"
  case "$PLUGIN_LISTED" in ''|*[!0-9]*) PLUGIN_LISTED=0 ;; esac
  case "$PLUGIN_ENABLED" in ''|*[!0-9]*) PLUGIN_ENABLED=0 ;; esac
  case "$PLUGIN_FAILED" in ''|*[!0-9]*) PLUGIN_FAILED=0 ;; esac
  return 0
}

self_check() {
  local fallback_present=0 claude_probe d
  claude_probe="$(find_claude || true)"
  read_plugin_state "$claude_probe"
  for d in "$FALLBACK_ROOT"/*/; do [ -f "$d$MARKER" ] && fallback_present=1; done 2>/dev/null

  local now proof_age amb_age proof_fresh=0 load_failed=0 line
  scan_state_roots
  now=$(date +%s)
  proof_age=$((now - PROOF_MTIME))
  amb_age=$((now - AMB_MTIME))
  # Clock skew (or a file dated in the future) must not print nonsense ages.
  [ "$proof_age" -lt 0 ] && proof_age=0
  [ "$amb_age" -lt 0 ] && amb_age=0

  printf '\n'
  if [ -n "$STATE_ROOT_OVERRIDE" ]; then
    info "Self-check (state root: $STATE_ROOT_OVERRIDE)"
  else
    info "Self-check (state roots: $STATE_ROOT_FALLBACK , $STATE_ROOT_PLUGIN_GLOB)"
  fi

  if [ "$PLUGIN_LISTED" -eq 0 ] && [ "$fallback_present" -eq 0 ]; then
    err "not-installed - neither the plugin nor a fallback copy was found."
    err "Run this installer without --verify to install."
    return 2
  fi

  if [ "$PROOF_MTIME" -gt 0 ] && [ "$proof_age" -lt "$ACTIVE_WINDOW_SECS" ]; then
    proof_fresh=1
  fi
  # Listed, but the host reported it as failed to load. Distinct from "listed
  # but not enabled": a disabled plugin is one /reload-plugins or
  # `claude plugin enable` away, while a load failure means the manifest itself
  # is broken - nothing from the plugin is loaded, and re-reading the same
  # broken manifest cannot change that.
  if [ "$PLUGIN_LISTED" -eq 1 ] && [ "$PLUGIN_FAILED" -eq 1 ] && [ "$PLUGIN_ENABLED" -eq 0 ]; then
    load_failed=1
  fi

  if [ "$load_failed" -eq 1 ]; then
    if [ "$proof_fresh" -eq 1 ] || [ "$fallback_present" -eq 1 ]; then
      warn "$PLUGIN@$MARKETPLACE is listed but 'claude plugin list' reports it as FAILED TO LOAD:"
    else
      err "load-failed - $PLUGIN@$MARKETPLACE is listed by 'claude plugin list', but"
      err "Claude Code could not load it. Nothing from the plugin is running: no"
      err "hook, no command, no skill, no monitor. The install is INERT."
    fi
    if [ -n "$PLUGIN_ERRORS" ]; then
      printf '%s\n' "$PLUGIN_ERRORS" | while IFS= read -r line; do
        [ -n "$line" ] && err "  claude plugin list: $line"
      done
    else
      err "  ('claude plugin list' printed no Error: line here - run it yourself for the raw text)"
    fi
    err "/reload-plugins CANNOT fix a load failure: a reload re-reads the same"
    err "manifest and fails again identically. What to do instead:"
    err "  1. claude plugin list            (read the full, unabridged error)"
    err "  2. re-run this installer         (it always calls 'plugin update', so a"
    err "     fixed release is picked up)"
    err "  3. still failing? report that Error: line at https://github.com/$REPO/issues"
    err "  4. or remove the broken entry: claude plugin uninstall $PLUGIN@$MARKETPLACE"
    if [ "$proof_fresh" -eq 0 ] && [ "$fallback_present" -eq 0 ]; then
      printf '\n'
      return 3
    fi
    warn "Continuing the self-check against the fallback copy / hook evidence below,"
    warn "which is what is actually carrying this install."
    printf '\n'
  fi

  if [ "$proof_fresh" -eq 1 ]; then
    ok "active-verified - a handshake hook wrote hook-only state ${proof_age}s ago (within the ${ACTIVE_WINDOW_SECS}s freshness window)."
    ok "claude-handshake is running. Try: /handshake status"
    return 0
  fi

  warn "installed-but-not-active - present, but no recently-fired hook was observed."
  if [ "$AMB_MTIME" -gt 0 ] && [ "$amb_age" -lt "$ACTIVE_WINDOW_SECS" ]; then
    warn "Local state under $STATE_ROOT_FALLBACK changed ${amb_age}s ago, but the"
    warn "handshake CLI writes that file too - it does not prove a hook ran, so"
    warn "this deliberately does NOT report active-verified."
    warn "Use Claude Code for one edit or Bash call in a handshake workspace:"
    warn "that fires PostToolUse, which only a hook can do, and re-checking then"
    warn "reports active-verified."
  fi
  if [ "$PLUGIN_LISTED" -eq 1 ] && [ "$PLUGIN_ENABLED" -eq 0 ] && [ "$PLUGIN_FAILED" -eq 0 ]; then
    # Deliberately NOT reached for a failed-to-load entry: that case is
    # diagnosed above, and telling someone to run /reload-plugins for a broken
    # manifest sends them round a loop that can never terminate.
    warn "The plugin is installed but not reporting as enabled in 'claude plugin list'."
    warn "Inside a Claude Code session, run:  /reload-plugins"
    warn "Then start a NEW session (or /reload-plugins again) before re-checking."
  else
    # Reached for a failed-to-load entry only when a fallback copy is also
    # present (the load-failure return above already handled the case where the
    # plugin was the only route) - and then this is exactly the right advice,
    # because the fallback is what runs.
    warn "This is expected immediately after install: handshake's hooks are"
    warn "no-ops until you are inside a workspace. To verify activation:"
    warn "  1. cd into a project directory (a git repo is recommended)"
    warn "  2. start Claude Code there: claude"
    warn "  3. run:  /handshake init          (creates a workspace, if none exists)"
    warn "  4. start a NEW session (SessionStart only syncs on startup/resume/fork)"
    warn "  5. re-run:  install.sh --verify"
  fi
  return 1
}

# ---------------------------------------------------- download diagnostics ---
# `curl -f` correctly refuses to write an HTML/404 body into a file, but it
# exits with the same generic failure for "no network" and "this URL does not
# exist". Those need different advice - a 404 here means the repo, branch or
# path is not published (or is private), which no amount of retrying fixes.
download_failed() {  # $1 = url
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -L -m 30 "$1" 2>/dev/null || printf '000')"
  case "$code" in
    000|'')
      err "Could not reach $1"
      err "Check your network connection, DNS, or proxy settings."
      ;;
    404|410)
      err "$1 returned HTTP $code."
      err "That path does not exist on the server - the repository, branch, or"
      err "file layout may have changed, or the repo may be private."
      err "Check https://github.com/$REPO for the current release, then re-run."
      ;;
    401|403)
      err "$1 returned HTTP $code (access denied)."
      err "The repository may be private, or a proxy is blocking the request."
      ;;
    *)
      err "Could not download $1 (HTTP $code)."
      ;;
  esac
}

# =============================================================== install ====

if [ "$VERIFY_ONLY" -eq 1 ]; then
  self_check
  exit $?
fi

# ---- 0. Node step zero -------------------------------------------------------
# The CLI (bin/handshake.js) and every hook shell out to `node`. This is a
# check-and-point step on macOS/Linux, deliberately NOT an auto-install: we do
# not assume a package manager, and installing system packages without the
# user's own tool (brew/apt/dnf/pacman/asdf/nvm) is not this script's call to
# make.

if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node --version 2>/dev/null || echo unknown)"
  # Absolute path, captured here and used by the settings.json snippet below.
  # Claude Code runs a hook with the environment of whatever process started
  # Claude Code - which, for an nvm/asdf/fnm-managed node, is routinely a PATH
  # WITHOUT node on it (measured on Ubuntu 24.04/WSL2: `bash -c` and `bash -lc`
  # both fail to find an nvm node, only `bash -ic` finds it). A snippet that
  # said bare `node` would then make every hook die with "node: command not
  # found" - and hooks fail soft, so the install would look fine while doing
  # nothing at all.
  NODE_BIN="$(command -v node 2>/dev/null || true)"
  ok "Node found: $NODE_VERSION ($NODE_BIN)"
else
  err "Node.js was not found (required by claude-handshake's CLI and every hook)."
  err "Install it with your platform's package manager, or the official installer:"
  err "  https://nodejs.org/en/download"
  err "  (nvm users:  https://github.com/nvm-sh/nvm )"
  err "Re-run this installer after 'node --version' works in a NEW terminal."
  exit 1
fi

# ---- 1. Find the claude CLI, installing it if missing -----------------------
# (find_claude itself is defined above, alongside self_check, so --verify can
# use it without running the rest of the install.)

CLAUDE_BIN="$(find_claude || true)"
if [ -z "$CLAUDE_BIN" ]; then
  info "Claude Code CLI not found - installing it (official installer)..."
  CC_TMP="$(mktemp)" || {
    err "Could not create a temporary file (check TMPDIR and free disk space)."
    exit 1
  }
  # Download and run as separate steps so a curl failure is reported as a
  # download problem, not misdiagnosed later as a missing binary.
  if ! curl -fsSL https://claude.ai/install.sh -o "$CC_TMP"; then
    rm -f "$CC_TMP"
    err "Could not download the Claude Code installer."
    download_failed https://claude.ai/install.sh
    exit 1
  fi
  if ! bash "$CC_TMP" </dev/null; then
    rm -f "$CC_TMP"
    err "Claude Code install failed. Install it manually, then re-run this script:"
    err "  curl -fsSL https://claude.ai/install.sh | bash"
    exit 1
  fi
  rm -f "$CC_TMP"
  CLAUDE_BIN="$(find_claude || true)"
  if [ -z "$CLAUDE_BIN" ]; then
    err "Claude Code installed, but its binary was not found in the usual places."
    err "Open a NEW terminal and re-run this script."
    exit 1
  fi
fi
ok "Claude Code CLI: $CLAUDE_BIN"

# ---- 2. Make `claude` work by name in future terminals ----------------------
# The script itself always uses the absolute path, so nothing below can block
# the install - this step is a best-effort convenience.

if ! command -v claude >/dev/null 2>&1; then
  BIN_DIR="$(dirname "$CLAUDE_BIN")"
  PATH_LINE="export PATH=\"$BIN_DIR:\$PATH\""
  case "${SHELL:-}" in
    */zsh)  RC="$HOME/.zshrc" ;;
    */bash) RC="$HOME/.bashrc" ;;
    *)      RC="" ;;
  esac
  if [ -n "$RC" ] && { [ -w "$RC" ] || { [ ! -e "$RC" ] && [ -w "$HOME" ]; }; }; then
    if grep -qsF "$BIN_DIR" "$RC"; then
      ok "$BIN_DIR is already in $RC (open a new terminal to pick it up)"
    elif printf '\n%s\n' "$PATH_LINE" >> "$RC"; then
      ok "Added $BIN_DIR to PATH in $RC (takes effect in new terminals)"
    else
      warn "Could not write to $RC. To use 'claude' by name, add this line to it yourself:"
      warn "  $PATH_LINE"
    fi
  else
    warn "Could not update your shell profile automatically."
    warn "To use 'claude' by name, add this line to it yourself:"
    warn "  $PATH_LINE"
    if [ -n "$RC" ] && [ -e "$RC" ] && [ ! -w "$RC" ]; then
      warn "($RC is not writable - fix with: sudo chown \$(whoami) $RC)"
    fi
  fi
fi

# ---- 3. Force HTTPS for GitHub during this install --------------------------
# Sidesteps every SSH failure mode (missing ~/.ssh, unknown host key, no key
# registered with GitHub). Env-only: affects processes started by this script,
# never the user's git config. Requires git >= 2.31 to take effect; older git
# simply ignores these and the fallback below still covers a failure.

export GIT_TERMINAL_PROMPT=0
export GIT_CONFIG_COUNT=2
export GIT_CONFIG_KEY_0="url.https://github.com/.insteadOf"
export GIT_CONFIG_VALUE_0="git@github.com:"
export GIT_CONFIG_KEY_1="url.https://github.com/.insteadOf"
export GIT_CONFIG_VALUE_1="ssh://git@github.com/"

# ---- 4. WSL detection --------------------------------------------------------
# Claude Code plugins are known not to load hooks/monitors inside WSL. The
# plugin route is still attempted below (it may work, or may start working in
# a future release), but the fallback copy is ALSO installed unconditionally on
# WSL regardless of what the plugin route reports, because a reported success
# there is not a working install.

IS_WSL=0
if is_wsl; then
  IS_WSL=1
  warn "WSL detected - Claude Code plugins are known not to load hooks/monitors here."
  warn "The plugin route will still be attempted, but a direct fallback copy will"
  warn "ALSO be installed so claude-handshake actually runs."
fi

# ---- 5. Primary route: marketplace + plugin install -------------------------
# </dev/null on every claude call: under `curl | bash` this script's stdin IS
# the script itself - a child that reads stdin would silently eat the rest of
# the script.

plugin_route() {
  "$CLAUDE_BIN" plugin marketplace add "$MARKETPLACE_URL" >/dev/null 2>&1 </dev/null || true
  # Refresh + update run UNCONDITIONALLY: "already added" / "already
  # installed" both exit 0 without fetching anything, so update is the only
  # call that actually pulls a newer version on a re-run.
  "$CLAUDE_BIN" plugin marketplace update "$MARKETPLACE" >/dev/null 2>&1 </dev/null || true
  INSTALL_OK=0
  "$CLAUDE_BIN" plugin install "$PLUGIN@$MARKETPLACE" >/dev/null 2>&1 </dev/null && INSTALL_OK=1
  UPDATE_OK=0
  "$CLAUDE_BIN" plugin update "$PLUGIN@$MARKETPLACE" >/dev/null 2>&1 </dev/null && UPDATE_OK=1
  # update exits 1 when the plugin isn't installed, so it can't mask a
  # genuine install failure.
  [ "$INSTALL_OK" -eq 1 ] || [ "$UPDATE_OK" -eq 1 ]
}

info "Installing the claude-handshake plugin..."
PLUGIN_ROUTE_OK=0
ROUTE_REPORTED_OK=0
plugin_route && ROUTE_REPORTED_OK=1
# Read the resulting state once, on BOTH paths: it decides whether a failed
# route can be ignored (a working install already exists - do not shadow it
# with a frozen fallback copy) and whether the plugin the route just installed
# is actually loadable. Uses the same structural Status:-line scan as the
# self-check (a bare `grep enabled` over the next few lines would accept
# "Enabled: false"), because this decides whether the fallback runs at all.
read_plugin_state "$CLAUDE_BIN"
if [ "$ROUTE_REPORTED_OK" -eq 1 ]; then
  PLUGIN_ROUTE_OK=1
  ok "Plugin installed: $PLUGIN@$MARKETPLACE"
elif [ "$PLUGIN_ENABLED" -eq 1 ]; then
  PLUGIN_ROUTE_OK=1
  warn "Plugin route failed, but $PLUGIN@$MARKETPLACE is already installed and enabled - keeping it."
else
  warn "Plugin route failed."
fi
# `plugin install` can exit 0 for a plugin the host then refuses to load (a
# broken manifest installs perfectly well). That must never be allowed to
# trigger the supersede-cleanup below: deleting a working fallback copy in
# favour of an inert plugin would take a working install away from the user.
# The self-check reports it in full.
PLUGIN_LOAD_FAILED=0
if [ "$PLUGIN_LISTED" -eq 1 ] && [ "$PLUGIN_FAILED" -eq 1 ] && [ "$PLUGIN_ENABLED" -eq 0 ]; then
  PLUGIN_LOAD_FAILED=1
fi

NEED_FALLBACK=0
[ "$PLUGIN_ROUTE_OK" -eq 0 ] && NEED_FALLBACK=1
[ "$IS_WSL" -eq 1 ] && NEED_FALLBACK=1

if [ "$NEED_FALLBACK" -eq 0 ] && [ "$PLUGIN_LOAD_FAILED" -eq 1 ]; then
  warn "$PLUGIN@$MARKETPLACE is listed but reports 'failed to load' - keeping any"
  warn "existing fallback copy (removing it would leave nothing running). The"
  warn "self-check below reports the load error in full."
elif [ "$NEED_FALLBACK" -eq 0 ]; then
  # A previous run may have used the fallback; the plugin copy supersedes it.
  # The fallback route writes THREE things, so all three have to be superseded
  # together:
  #   1. $FALLBACK_ROOT/<version>/           (carries $MARKER)
  #   2. $CLAUDE_DIR/skills/handshake/       (carries $MARKER)
  #   3. $CLAUDE_DIR/commands/handshake.md   (a single file - no marker is
  #      possible, so identity is proven by content)
  # Removing only (1) left (2) and (3) behind pointing at the very directory
  # this run had just deleted, and made /handshake and the skill load twice -
  # once from the orphans, once from the plugin.
  #
  # Ownership rules are unchanged: only something this installer wrote is
  # deleted outright, anything ambiguous is backed up first, and anything with
  # no trace of the fallback route is left alone.
  MARKED_FALLBACKS=""
  for FB in "$FALLBACK_ROOT"/*/; do
    FB="${FB%/}"
    [ -f "$FB/$MARKER" ] || continue
    MARKED_FALLBACKS="$MARKED_FALLBACKS$FB
"
  done
  USER_SKILL="$CLAUDE_DIR/skills/handshake"
  USER_CMD="$CLAUDE_DIR/commands/handshake.md"
  USER_SKILL_IS_OURS=0
  [ -f "$USER_SKILL/$MARKER" ] && USER_SKILL_IS_OURS=1
  # The gate for touching the SHARED user-level locations at all: is there any
  # evidence THIS installer's fallback route ever ran here? Without it, a
  # machine that only ever used the plugin route would have a hand-written
  # ~/.claude/commands/handshake.md moved aside for no reason.
  FALLBACK_TRACES=0
  [ -n "$MARKED_FALLBACKS" ] && FALLBACK_TRACES=1
  [ "$USER_SKILL_IS_OURS" -eq 1 ] && FALLBACK_TRACES=1
  SUPERSEDE_BAK="$CLAUDE_DIR/handshake-backup.$(date +%s)"

  # (3) command file - compared against the fallback copies BEFORE they are
  # removed below, since they are the only proof of what this installer wrote
  # there.
  if [ "$FALLBACK_TRACES" -eq 1 ] && [ -f "$USER_CMD" ]; then
    CMD_IS_OURS=0
    while IFS= read -r FBDIR; do
      [ -n "$FBDIR" ] || continue
      [ -f "$FBDIR/commands/handshake.md" ] || continue
      if cmp -s "$FBDIR/commands/handshake.md" "$USER_CMD"; then
        CMD_IS_OURS=1
        break
      fi
    done <<MARKED_FALLBACK_LIST
$MARKED_FALLBACKS
MARKED_FALLBACK_LIST
    if [ "$CMD_IS_OURS" -eq 1 ]; then
      if rm -f "$USER_CMD" && [ ! -e "$USER_CMD" ]; then
        ok "Removed the superseded user-level command $USER_CMD (the plugin provides /handshake now)"
      else
        warn "Could not remove the superseded $USER_CMD - /handshake may load twice."
      fi
    else
      # It differs from every copy we wrote (hand-edited, or from an older
      # release whose fallback directory is gone). Never delete that outright -
      # back it up, then take it out of the load path so it cannot shadow the
      # plugin's own command.
      if mkdir -p "$SUPERSEDE_BAK" && mv "$USER_CMD" "$SUPERSEDE_BAK/commands-handshake.md"; then
        warn "$USER_CMD differed from every copy this installer wrote - moved it to $SUPERSEDE_BAK/commands-handshake.md so it cannot shadow the plugin's /handshake."
      else
        warn "Could not back up $USER_CMD - leaving it in place. /handshake may load twice until you remove it."
      fi
    fi
  fi

  # (2) skill directory - marker or nothing.
  if [ -e "$USER_SKILL" ]; then
    if [ "$USER_SKILL_IS_OURS" -eq 1 ]; then
      if rm -rf "$USER_SKILL" && [ ! -e "$USER_SKILL" ]; then
        ok "Removed the superseded user-level skill $USER_SKILL (the plugin provides it now)"
      else
        warn "Could not remove the superseded $USER_SKILL (a file may be in use)."
        warn "Close Claude Code and re-run this installer, or the skill may load twice."
      fi
    elif [ "$FALLBACK_TRACES" -eq 1 ]; then
      warn "$USER_SKILL was not written by this installer - leaving it untouched."
      warn "It may shadow the plugin's own handshake skill; remove it yourself if that is not what you want."
    fi
  fi

  # (1) fallback copies. Contents first, marker last: if a locked file blocks
  # full removal, the marker survives and a later run can still recognize and
  # finish this.
  for FB in "$FALLBACK_ROOT"/*/; do
    FB="${FB%/}"
    [ -f "$FB/$MARKER" ] || continue
    find "$FB" -mindepth 1 ! -name "$MARKER" -exec rm -rf {} + 2>/dev/null
    if [ -n "$(find "$FB" -mindepth 1 ! -name "$MARKER" 2>/dev/null | head -n 1)" ]; then
      warn "Could not fully remove the fallback copy at $FB (a file may be in use)."
      warn "Close Claude Code and re-run this installer, or it may load twice."
    elif rm -rf "$FB" && [ ! -e "$FB" ]; then
      ok "Removed the superseded fallback copy at $FB (the plugin supersedes it)"
    else
      : > "$FB/$MARKER" 2>/dev/null || true
      warn "Could not fully remove the fallback copy at $FB - close Claude Code and re-run."
    fi
  done
else
  # ---- 6. Fallback: direct copy + hook-registration guidance, no git needed -
  info "Installing the direct fallback copy (no git needed)..."
  TMP="$(mktemp -d)" || {
    err "Could not create a temporary directory (check TMPDIR and free disk space)."
    exit 1
  }
  trap 'rm -rf "$TMP"' EXIT
  if ! curl -fsSL "$TARBALL_URL" -o "$TMP/src.tar.gz"; then
    download_failed "$TARBALL_URL"
    exit 1
  fi
  if ! tar -xzf "$TMP/src.tar.gz" -C "$TMP"; then
    err "Could not extract the downloaded archive."
    exit 1
  fi
  SRC="$TMP/claude-handshake-main"
  if [ ! -f "$SRC/bin/handshake.js" ]; then
    err "The downloaded archive did not contain bin/handshake.js - the repo layout may have changed."
    err "Please report this: https://github.com/$REPO/issues"
    exit 1
  fi

  VERSION="$(node -e "try{console.log(require(process.argv[1]).version||'0.0.0')}catch(e){console.log('0.0.0')}" "$SRC/package.json" 2>/dev/null || echo 0.0.0)"
  DEST="$FALLBACK_ROOT/$VERSION"

  if ! mkdir -p "$FALLBACK_ROOT"; then
    err "Could not create $FALLBACK_ROOT."
    exit 1
  fi
  if [ -e "$DEST" ] && [ ! -f "$DEST/$MARKER" ]; then
    # Not ours - never destroy a hand-authored directory; move it aside.
    # The backup must live OUTSIDE $FALLBACK_ROOT, or a later scan of
    # $FALLBACK_ROOT/*/ would still find and try to manage it.
    BAK="$CLAUDE_DIR/handshake-plugin-backup.$(date +%s)"
    if mv "$DEST" "$BAK"; then
      warn "Existing $DEST was not created by this installer - moved it to $BAK"
    else
      err "Could not move the existing $DEST aside. Move it manually and re-run."
      exit 1
    fi
  elif [ -e "$DEST" ] && ! rm -rf "$DEST"; then
    err "Could not remove the existing $DEST (a file may be in use). Close Claude Code and re-run."
    exit 1
  fi

  if ! cp -R "$SRC" "$DEST" || [ ! -f "$DEST/bin/handshake.js" ]; then
    err "Could not copy claude-handshake into $FALLBACK_ROOT (verification failed)."
    exit 1
  fi
  if ! : > "$DEST/$MARKER"; then
    warn "Could not write the installer marker at $DEST/$MARKER - a future run will treat this copy as hand-authored and move it aside instead of replacing it."
  fi
  ok "Copied claude-handshake $VERSION to $DEST"

  # ---- prune to the runtime payload ------------------------------------------
  # The downloaded archive is the WHOLE repository - test/, e2e/, spike/, docs/,
  # scripts/, installers/, PLAN.md - none of which is ever loaded at runtime,
  # and all of which would sit in the user's own config directory forever. Keep
  # only what a hook, the CLI, the skill/command files and `deploy-relay`
  # actually read. The keep-list is maintained beside the repo layout, which is
  # safe because the installer and the payload always ship from the same branch
  # of the same repo - they cannot drift apart.
  prune_to_runtime() {  # $1 = installed copy root
    local root="$1" entry base
    for entry in "$root"/* "$root"/.[!.]*; do
      [ -e "$entry" ] || continue
      base="${entry##*/}"
      case "$base" in
        bin|lib|hooks|monitors|skills|commands|relay|.claude-plugin) ;;
        package.json|LICENSE|README.md) ;;
        "$MARKER") ;;
        *) rm -rf "$entry" 2>/dev/null || true ;;
      esac
    done
    # relay/: lib/deploy.js copies exactly src/, wrangler.toml and package.json
    # to the work dir, and locateRelayDir only probes for wrangler.toml plus
    # src/worker.js. Everything else there is development-only.
    if [ -d "$root/relay" ]; then
      for entry in "$root"/relay/* "$root"/relay/.[!.]*; do
        [ -e "$entry" ] || continue
        base="${entry##*/}"
        case "$base" in
          src|wrangler.toml|package.json) ;;
          *) rm -rf "$entry" 2>/dev/null || true ;;
        esac
      done
    fi
    return 0
  }
  prune_to_runtime "$DEST"
  if [ ! -f "$DEST/bin/handshake.js" ] || [ ! -d "$DEST/hooks" ] || [ ! -d "$DEST/lib" ]; then
    err "Pruning removed something it should not have - $DEST is incomplete."
    exit 1
  fi

  # Rewrite the plugin-relative references so the standalone copy is directly
  # runnable: ${CLAUDE_PLUGIN_ROOT} / $CLAUDE_PLUGIN_ROOT only exist when the
  # host's plugin system sets them, which does not happen here. (Confirmed
  # necessary: the host does NOT expand those placeholders in a user-level
  # ~/.claude/settings.json - only in plugin manifests and project settings.)
  # Done with node, not sed. node is a hard requirement of this installer
  # (step zero above refuses to continue without it), and sed is the wrong
  # tool here on three counts: `&` in the REPLACEMENT expands to the whole
  # match (a $HOME containing `&` silently corrupts every rewritten file),
  # every delimiter choice can collide with a path character, and `-i.bak`
  # differs between GNU and BSD sed. node also lets the .json files get a
  # properly JSON-escaped path, so a backslash or quote in $HOME cannot
  # produce an unparseable hooks.json.
  if ! node -e '
    const fs = require("fs");
    const path = require("path");
    const dest = process.argv[1];
    const jsonDest = JSON.stringify(dest).slice(1, -1);
    (function walk(dir) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const entry of entries) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(p); continue; }
        if (!entry.isFile() || !/\.(md|json)$/i.test(entry.name)) continue;
        let text;
        try { text = fs.readFileSync(p, "utf8"); } catch (e) { continue; }
        const rep = /\.json$/i.test(entry.name) ? jsonDest : dest;
        const out = text.split("${CLAUDE_PLUGIN_ROOT}").join(rep)
                        .split("$CLAUDE_PLUGIN_ROOT").join(rep);
        if (out !== text) fs.writeFileSync(p, out);
      }
    })(dest);
  ' "$DEST" 2>/dev/null; then
    warn "Could not rewrite the \${CLAUDE_PLUGIN_ROOT} placeholders under $DEST."
    warn "The hook snippet printed below may still contain unresolved placeholders;"
    warn "replace them with $DEST by hand before saving settings.json."
  fi

  # commands/ and skills/ auto-load from these fixed locations without any
  # settings.json edit (the same mechanism claude-tier's skills-dir fallback
  # relies on). hooks/ and monitors/ have no such directory convention, so
  # those need the explicit settings.json snippet printed below.
  #
  # These two are SHARED user directories, not directories this installer
  # owns, so the same rule as the fallback copy applies: never delete before
  # the replacement exists, never destroy something we did not write, and keep
  # any backup OUTSIDE the managed directory (a backup left inside
  # ~/.claude/skills would load as a second, stale `handshake` skill).
  USER_BAK="$CLAUDE_DIR/handshake-backup.$(date +%s)"
  mkdir -p "$CLAUDE_DIR/commands" "$CLAUDE_DIR/skills"

  if [ -f "$DEST/commands/handshake.md" ]; then
    USER_CMD_PATH="$CLAUDE_DIR/commands/handshake.md"
    CMD_DEST="$USER_CMD_PATH"
    if [ -e "$CMD_DEST" ] && ! cmp -s "$DEST/commands/handshake.md" "$CMD_DEST"; then
      if mkdir -p "$USER_BAK" && cp -p "$CMD_DEST" "$USER_BAK/commands-handshake.md" 2>/dev/null; then
        warn "Your existing $USER_CMD_PATH differed - backed it up to $USER_BAK/commands-handshake.md"
      else
        err "Could not back up the existing $USER_CMD_PATH - leaving it untouched."
        CMD_DEST=""
      fi
    fi
    # Write beside it, then rename over: the replacement exists before the
    # old file stops existing, and a failed copy leaves the original intact.
    if [ -n "$CMD_DEST" ] && cp "$DEST/commands/handshake.md" "$CMD_DEST.new" && mv "$CMD_DEST.new" "$CMD_DEST"; then
      ok "Command copied: $USER_CMD_PATH (/handshake will work once claude reloads)"
    elif [ -n "$CMD_DEST" ]; then
      rm -f "$CMD_DEST.new"
      warn "Could not install $USER_CMD_PATH - /handshake will not be available."
    fi
  fi

  if [ -d "$DEST/skills/handshake" ]; then
    USER_SKILL_PATH="$CLAUDE_DIR/skills/handshake"
    SKILL_DEST="$USER_SKILL_PATH"
    SKILL_STAGE="$CLAUDE_DIR/skills/.handshake-installing.$$"
    rm -rf "$SKILL_STAGE"
    if cp -R "$DEST/skills/handshake" "$SKILL_STAGE" && [ -f "$SKILL_STAGE/SKILL.md" ]; then
      : > "$SKILL_STAGE/$MARKER" 2>/dev/null || true
      if [ -e "$SKILL_DEST" ] && [ ! -f "$SKILL_DEST/$MARKER" ]; then
        # Not ours (or written by a pre-marker version of this installer):
        # move it aside rather than delete it.
        if mkdir -p "$USER_BAK" && mv "$SKILL_DEST" "$USER_BAK/skills-handshake"; then
          warn "Existing $USER_SKILL_PATH was not written by this installer - moved it to $USER_BAK/skills-handshake"
        else
          err "Could not move $USER_SKILL_PATH aside - leaving it untouched."
          SKILL_DEST=""
        fi
      elif [ -e "$SKILL_DEST" ] && ! rm -rf "$SKILL_DEST"; then
        warn "Could not replace $USER_SKILL_PATH (a file may be in use)."
        SKILL_DEST=""
      fi
      if [ -n "$SKILL_DEST" ] && mv "$SKILL_STAGE" "$SKILL_DEST"; then
        ok "Skill copied: $USER_SKILL_PATH"
      else
        rm -rf "$SKILL_STAGE"
        warn "Could not install $USER_SKILL_PATH - the on-demand skill will not load."
      fi
    else
      rm -rf "$SKILL_STAGE"
      warn "Could not stage the skill copy - $USER_SKILL_PATH left unchanged."
    fi
  fi

  printf '\n'
  info "Hook registration (required - not automated on purpose)"
  printf 'This installer will NOT edit %s/settings.json for you. Merge the\n' "$CLAUDE_DIR"
  printf '"hooks" object below into it by hand (or ask your own Claude Code session\n'
  printf 'to do it, and review the diff before saving):\n\n'
  if [ -f "$DEST/hooks/hooks.json" ]; then
    # The rewrite pass above already resolved ${CLAUDE_PLUGIN_ROOT} to $DEST
    # inside this copy's own hooks.json, so this re-wraps it for settings.json -
    # and pins the interpreter while doing so. hooks.json ships the bare word
    # `node`, which is correct for the plugin route (the host resolves it) but
    # wrong here: these commands are about to be pasted into settings.json and
    # will be executed with whatever environment started Claude Code. An
    # nvm/asdf/fnm node is not on that PATH, every hook then dies with
    # "node: command not found", and because hooks fail soft the install looks
    # perfectly healthy while doing nothing. Same node-based renderer as before,
    # so quoting/escaping stays correct for a path with spaces.
    node -e '
      const fs = require("fs");
      const hooks = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).hooks || {};
      const nodeBin = process.argv[2] || "";
      if (nodeBin) {
        for (const event of Object.keys(hooks)) {
          for (const group of hooks[event] || []) {
            for (const h of (group && group.hooks) || []) {
              if (h && typeof h.command === "string" && /^node\s/.test(h.command)) {
                h.command = JSON.stringify(nodeBin) + h.command.slice("node".length);
              }
            }
          }
        }
      }
      console.log(JSON.stringify({ hooks }, null, 2));
    ' "$DEST/hooks/hooks.json" "$NODE_BIN"
  else
    warn "(could not render the hooks snippet - inspect $DEST/hooks/hooks.json by hand)"
  fi
  printf '\n'
  if [ -n "$NODE_BIN" ]; then
    printf 'The hook commands above deliberately pin the absolute node binary this\n'
    printf 'installer found (%s) instead of the bare word "node":\n' "$NODE_BIN"
    printf 'Claude Code runs hooks with the environment of whatever process started it,\n'
    printf 'and an nvm/asdf/fnm node is usually NOT on that PATH - the hooks would then\n'
    printf 'fail silently with "node: command not found". Update that path by hand if\n'
    printf 'you later switch node versions.\n\n'
  fi
  printf 'Monitors (the presence/claim-renewal clock) have no settings.json\n'
  printf 'equivalent and are NOT available in this fallback mode. This is a\n'
  printf 'documented, handled condition, not a defect: claude-handshake falls back\n'
  printf 'to "heartbeating on turn boundaries" when monitors are unavailable\n'
  printf '(PROTOCOL.md section 8) - coordination still works, just at reduced\n'
  printf 'liveness precision.\n'
fi

# ---- 7. Three-valued self-check ---------------------------------------------

self_check
SELF_CHECK_STATUS=$?

printf '\n'
ok "Install step finished. Re-check activation anytime with:"
ok "  curl -fsSL https://raw.githubusercontent.com/$REPO/main/installers/install.sh -o install.sh"
ok "  bash install.sh --verify"

# The exit status of the INSTALL path reports the INSTALL, not activation.
# "installed-but-not-active" (1) is the expected, documented outcome of a fresh
# install - every hook is a no-op until you are inside a workspace - so it must
# not report failure to `curl ... | bash && ...` or to CI. Only "not-installed"
# (2) means the install did not happen. `--verify` above still returns the full
# three-valued status.
if [ "$SELF_CHECK_STATUS" -ge 2 ]; then
  exit 1
fi
exit 0
