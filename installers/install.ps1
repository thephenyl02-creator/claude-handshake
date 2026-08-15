# claude-handshake installer (Windows PowerShell 5.1+ / pwsh)
# https://github.com/thephenyl02-creator/claude-handshake
#
#   irm https://raw.githubusercontent.com/thephenyl02-creator/claude-handshake/main/installers/install.ps1 | iex
#
# Ported from claude-tier's install.ps1 (4 adversarial review rounds, ~38
# findings) and adapted for a full hook+monitor+CLI plugin instead of a
# skill-only one. Adds a Node.js step zero (native-Windows Claude Code does not
# guarantee Node, and every hook plus the CLI shell out to it) and a
# three-valued self-check that proves the plugin is actually firing hooks,
# never just that files exist on disk.
#
# NOTE: `irm | iex` runs this in the CALLER'S session. The whole body runs
# inside `& { }` so variables/functions stay in a private scope, and every
# process-wide change (preferences, env vars, PATH) is restored in the finally.
# When run as a file (-File / .\install.ps1) a failure exits nonzero; under
# `irm | iex` it never calls exit, so the caller's session survives.
#
#   .\install.ps1              full install (Node check, plugin, fallback if needed)
#   .\install.ps1 -VerifyActive   re-run ONLY the self-check
#   .\install.ps1 -Help        usage
#   anything else              usage + exit 2, and NOTHING is installed
#
# Self-check exit codes: 0 active-verified, 1 installed-but-not-active,
# 2 not-installed, 3 listed-but-failed-to-load (inert; a reload cannot fix it).

param(
    [switch]$VerifyActive,
    [switch]$Help
)

# ---- Unknown-argument guard ------------------------------------------------
# MUST stay out here, OUTSIDE the `& { }` body below: inside a script block
# `$args` is the SCRIPT BLOCK's own argument list (always empty here), not the
# script's, so the same check placed inside would silently never fire.
#
# Without [CmdletBinding()] PowerShell does not reject an unbound argument, it
# drops it into $args - so `.\install.ps1 -Bogus` used to run a complete,
# unattended install (Node package-manager attempt included) and exit 0. A
# mistyped flag must never install anything.
#
# `-Help`, `-h`, `--help` and `-VerifyActive` (and any unambiguous prefix such
# as `-Verify`) are bound by the param() block above and never reach $args.
# Under `irm | iex` no arguments can be passed at all and $args is empty even
# when the surrounding scope has its own (verified by execution), so this is a
# no-op there - and it must never call `exit` when $PSCommandPath is empty, or
# it would kill the caller's session.
$HandshakeUsage = @(
    'usage: install.ps1 [-VerifyActive] [-Help]'
    '  (no args)      full install: Node check, plugin route, no-plugin fallback'
    '  -VerifyActive  re-run only the self-check (0 active-verified /'
    '                 1 installed-but-not-active / 2 not-installed /'
    '                 3 listed-but-failed-to-load)'
)
$HandshakeExtraArgs = @($args | Where-Object { $null -ne $_ -and "$_" -ne '' })
if ($HandshakeExtraArgs.Count -gt 0) {
    $HandshakeHelpTokens = @('-?', '/?', '/h', '/help', '--h', '-help', '--help')
    $HandshakeUnknown = @($HandshakeExtraArgs | Where-Object { $HandshakeHelpTokens -notcontains ("$_").ToLower() })
    if ($HandshakeUnknown.Count -eq 0) {
        $HandshakeUsage | ForEach-Object { Write-Host $_ }
        if ($PSCommandPath) { exit 0 }
        return
    }
    Write-Host ('install.ps1: unknown argument: ' + ($HandshakeUnknown -join ' ')) -ForegroundColor Red
    Write-Host 'Nothing was installed. Run it with no arguments for a full install.' -ForegroundColor Red
    $HandshakeUsage | ForEach-Object { Write-Host $_ }
    if ($PSCommandPath) { exit 2 }
    return
}

& {
    # Every path below is built from $env:CLAUDE_CONFIG_DIR when that is set,
    # and from $env:USERPROFILE otherwise. When USERPROFILE is missing or
    # blank (some service, scheduled-task and remoting contexts), `Join-Path`
    # throws a parameter-binding error before a single friendly line is
    # printed. install.sh guards $HOME the same way, first thing.
    if (-not $env:USERPROFILE -or -not $env:USERPROFILE.Trim()) {
        Write-Host 'USERPROFILE is not set; re-run from a normal interactive PowerShell session.' -ForegroundColor Red
        return
    }
    if (-not (Test-Path -LiteralPath $env:USERPROFILE)) {
        Write-Host "USERPROFILE points at a path that does not exist ($env:USERPROFILE); re-run from a normal interactive PowerShell session." -ForegroundColor Red
        return
    }

    $Repo = 'thephenyl02-creator/claude-handshake'
    $Marketplace = 'claude-handshake'
    # Raw-URL marketplace add needs no git at all (ported from claude-tier,
    # verified there: the CLI downloads and caches the manifest over HTTPS;
    # update re-fetches it). Deliberately NOT the
    # `claude plugin marketplace add thephenyl02-creator/claude-handshake`
    # shorthand a human would type interactively - that form may fall back to
    # git/SSH, which is exactly what this installer must not depend on.
    $MarketplaceUrl = "https://raw.githubusercontent.com/$Repo/main/.claude-plugin/marketplace.json"
    $Plugin = 'claude-handshake'
    $ZipUrl = "https://github.com/$Repo/archive/refs/heads/main.zip"
    # Marks a fallback copy as written by this installer, so a later
    # successful plugin install may safely replace it (and never a
    # hand-authored directory).
    $Marker = '.installed-by-claude-handshake-installer'
    # Claude Code reads and writes its whole configuration tree from
    # $CLAUDE_CONFIG_DIR when that is set (commands/, skills/, plugins/data/,
    # settings.json), and only falls back to ~\.claude when it is not. Every
    # path below - the fallback copy, the shared command/skill locations, the
    # backup directories and BOTH self-check state roots - must follow it, or a
    # user who sets it can never reach active-verified (the roots would be
    # scanned in a directory the host never writes to).
    $ClaudeDir = if ($env:CLAUDE_CONFIG_DIR -and $env:CLAUDE_CONFIG_DIR.Trim()) {
        $env:CLAUDE_CONFIG_DIR.Trim().TrimEnd('\', '/')
    } else {
        Join-Path $env:USERPROFILE '.claude'
    }
    $FallbackRoot = Join-Path $ClaudeDir 'handshake-plugin'
    # lib/state.js resolves ${CLAUDE_PLUGIN_DATA} when set, else ~\.claude\handshake
    # - but CLAUDE_PLUGIN_DATA is set by the Claude Code HOST inside a hook's
    # own process; this installer's own shell never sees it, even after a
    # successful plugin-route install. A plugin-route install's real data dir
    # was observed on a dev machine at ~\.claude\plugins\data\<plugin-name>[-inline]\
    # (the suffix varies by how the plugin was sourced), so the self-check
    # scans BOTH that family AND the fallback-route's fixed ~\.claude\handshake
    # - whichever one a hook actually wrote to is the one that lights up.
    $StateRootFallback = Join-Path $ClaudeDir 'handshake'
    $StateRootPluginGlob = Join-Path $ClaudeDir "plugins\data\$Plugin*"
    $StateRootOverride = if ($env:CLAUDE_PLUGIN_DATA -and $env:CLAUDE_PLUGIN_DATA.Trim()) { $env:CLAUDE_PLUGIN_DATA } else { $null }
    $ActiveWindowSecs = 1800   # 30 min: "fresh" means a hook fired recently, not ever
    # A false "active" is worse than a false "not active", so evidence is split
    # by WHO can possibly have written it:
    #   hook-proof    - only a hook or monitor process ever creates these
    #                   (post-tool-use.js writes posttool.tick / activity.mark /
    #                   hooks.ticks.json; monitors/heartbeat.js writes
    #                   monitor.alive). bin/handshake.js never touches them.
    #   cli-ambiguous - state.json. Hooks write it on every SessionStart, but so
    #                   does the CLI (init / join / mute / rest / sync), so a
    #                   fresh state.json in the FALLBACK root proves only that
    #                   `handshake` ran in a terminal - NOT that a hook fired.
    # Under a plugin-data root the ambiguity disappears: CLAUDE_PLUGIN_DATA is
    # only ever set by the host inside a plugin process, so anything fresh
    # there is hook-proof by construction.
    # session.json is deliberately NOT scanned: no hook ever writes it (only the
    # CLI, and only on a "loud condition"), so it is pure false-positive risk.
    $HookProofFiles = @('posttool.tick', 'activity.mark', 'hooks.ticks.json', 'monitor.alive')
    $Failed = $false
    $NodeNeedsNewTerminal = $false
    # Absolute path of the node binary, filled in by step zero and baked into
    # the printed settings.json snippet (see the comment there).
    $NodeBin = ''

    function Write-Info($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
    function Write-Ok($msg)   { Write-Host "  + $msg" -ForegroundColor Green }
    function Write-Warn2($msg){ Write-Host "  ! $msg" -ForegroundColor Yellow }
    function Write-Err($msg)  { Write-Host "  x $msg" -ForegroundColor Red }

    if ($Help) {
        # Single-sourced with the unknown-argument guard above (a child scope
        # reads its parent's variables).
        $HandshakeUsage | ForEach-Object { Write-Host $_ }
        return
    }

    function Find-Claude {
        # -CommandType Application: only .exe/.cmd/.bat - never a profile
        # alias, function, or .ps1 shim (a .ps1 would drag execution policy
        # into play).
        $cmd = Get-Command claude -CommandType Application -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($cmd -and $cmd.Source -and (Test-Path $cmd.Source)) { return $cmd.Source }
        $candidates = @(
            (Join-Path $env:USERPROFILE '.local\bin\claude.exe'),
            (Join-Path $env:USERPROFILE '.claude\local\claude.exe'),
            (Join-Path $env:APPDATA 'npm\claude.cmd')
        )
        foreach ($c in $candidates) {
            if (Test-Path $c) { return $c }
        }
        return $null
    }

    function Invoke-Claude([string]$Bin, [string[]]$CliArgs) {
        # $LASTEXITCODE survives from earlier commands when a launch fails,
        # so reset it first: a failed launch then leaves $null, which is not 0.
        $global:LASTEXITCODE = $null
        try {
            & $Bin @CliArgs *> $null
        } catch {
            return $false
        }
        return ($LASTEXITCODE -eq 0)
    }

    function Invoke-PluginRoute([string]$Bin) {
        [void](Invoke-Claude $Bin @('plugin', 'marketplace', 'add', $MarketplaceUrl))
        # Refresh + update run UNCONDITIONALLY: "already added" / "already
        # installed" both exit 0 without fetching anything, so update is the
        # only call that actually pulls a newer version on a re-run.
        [void](Invoke-Claude $Bin @('plugin', 'marketplace', 'update', $Marketplace))
        $installOk = Invoke-Claude $Bin @('plugin', 'install', "$Plugin@$Marketplace")
        # plugin update exits 1 when the plugin isn't installed, so it can't
        # mask a genuine install failure.
        $updateOk = Invoke-Claude $Bin @('plugin', 'update', "$Plugin@$Marketplace")
        return ($installOk -or $updateOk)
    }

    # Is $Plugin@$Marketplace listed at all, and does it look enabled? A
    # plugin can be listed yet broken ("failed to load") or disabled - only a
    # healthy entry counts as "listed and enabled", and "failed to load" is
    # reported separately because it is a hard, non-self-healing condition
    # (see Invoke-SelfCheck). ASCII-only matching: the CLI's bullet glyph
    # varies by codepage, the Status: / Error: field names do not.
    #
    # The CLI renders one entry as:
    #     <pointer> <plugin>@<marketplace>
    #       Version: <v>
    #       Scope:   <scope>
    #       Status:  <glyph> enabled | <glyph> disabled | <glyph> failed to load
    #       Error:   <message>            (zero or more, only when it failed)
    #       Note:    <message>            (zero or more)
    #     <blank line>
    # so the scan runs from the id line to the blank line that closes the
    # entry (bounded, so a missing blank line cannot make it swallow the next
    # plugin's Error: lines).
    function Get-PluginListState([string]$Bin) {
        $result = @{ Listed = $false; Enabled = $false; Failed = $false; ErrorLines = @() }
        try {
            $lines = @(& $Bin plugin list 2>$null)
        } catch { return $result }
        $id = [regex]::Escape("$Plugin@$Marketplace")
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ("$($lines[$i])" -notmatch $id) { continue }
            $result.Listed = $true
            $entryEnabled = $false
            $entryFailed = $false
            $entryErrors = @()
            $stop = [Math]::Min($i + 20, $lines.Count)
            for ($j = $i + 1; $j -lt $stop; $j++) {
                $line = "$($lines[$j])"
                if ($line -match $id) { break }                 # next entry
                if (-not $line.Trim()) { break }                # entry closed
                if ($line -match 'Status:') {
                    if ($line -match '(?i)failed') { $entryFailed = $true }
                    elseif ($line -match '(?i)disabled') { }
                    elseif ($line -match '(?i)enabled') { $entryEnabled = $true }
                } elseif ($line -match '^\s*Error:') {
                    $entryErrors += $line.Trim()
                }
            }
            if ($entryEnabled) { $result.Enabled = $true }
            if ($entryFailed) {
                $result.Failed = $true
                $result.ErrorLines = @($result.ErrorLines + $entryErrors)
            }
            if ($result.Enabled) { break }
        }
        return $result
    }

    # One level deep by design: <root>\<workspace-id>\<file>.
    # "Fresh" is judged by mtime recency (ActiveWindowSecs), never by mere
    # existence - a state file from a stale install a month ago must not read
    # as "active" today. Scans every candidate root (see $StateRoot* above)
    # since this script cannot know in advance which one a live hook is using.
    # Returns @{ ProofAge = <secs|null>; AmbiguousAge = <secs|null> } - see the
    # evidence-class note at the top of this script.
    function Get-StateEvidenceAge {
        $roots = @()
        if ($StateRootOverride) {
            # Only ever set inside a plugin process, so this root is hook-proof.
            $roots += ,@($StateRootOverride, $true)
        } else {
            $roots += ,@($StateRootFallback, $false)
            Get-Item -Path $StateRootPluginGlob -ErrorAction SilentlyContinue |
                ForEach-Object { $roots += ,@($_.FullName, $true) }
        }
        $newestProof = $null
        $newestAmb = $null
        foreach ($entry in $roots) {
            $root = $entry[0]
            $rootIsProof = $entry[1]
            if (-not $root -or -not (Test-Path -LiteralPath $root)) { continue }
            Get-ChildItem -Path $root -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
                $ws = $_.FullName
                foreach ($name in $HookProofFiles) {
                    $f = Get-Item -LiteralPath (Join-Path $ws $name) -Force -ErrorAction SilentlyContinue
                    if ($f -and (-not $newestProof -or $f.LastWriteTimeUtc -gt $newestProof)) {
                        $newestProof = $f.LastWriteTimeUtc
                    }
                }
                $s = Get-Item -LiteralPath (Join-Path $ws 'state.json') -Force -ErrorAction SilentlyContinue
                if ($s) {
                    if ($rootIsProof) {
                        if (-not $newestProof -or $s.LastWriteTimeUtc -gt $newestProof) { $newestProof = $s.LastWriteTimeUtc }
                    } else {
                        if (-not $newestAmb -or $s.LastWriteTimeUtc -gt $newestAmb) { $newestAmb = $s.LastWriteTimeUtc }
                    }
                }
            }
        }
        $now = (Get-Date).ToUniversalTime()
        $result = @{ ProofAge = $null; AmbiguousAge = $null }
        # Clock skew (or a file dated in the future) must not print a negative age.
        if ($newestProof) { $result.ProofAge = [Math]::Max(0, [int]($now - $newestProof).TotalSeconds) }
        if ($newestAmb) { $result.AmbiguousAge = [Math]::Max(0, [int]($now - $newestAmb).TotalSeconds) }
        return $result
    }

    # Four outcomes, never a guess in between:
    #   2 not-installed             - no plugin entry AND no fallback copy
    #   3 load-failed               - listed, but the host could not LOAD it and
    #                                 nothing else is carrying the install. A
    #                                 reload cannot fix a manifest/load error, so
    #                                 this must never be reported as the benign
    #                                 "installed-but-not-active" case (that is
    #                                 exactly how a dead-on-arrival manifest once
    #                                 reached a "successful" install).
    #   1 installed-but-not-active  - present, but no hook has proven it live recently
    #   0 active-verified           - a hook (SessionStart et al.) wrote fresh state
    function Invoke-SelfCheck {
        $claudeBin = Find-Claude
        $listState = @{ Listed = $false; Enabled = $false; Failed = $false; ErrorLines = @() }
        if ($claudeBin) { $listState = Get-PluginListState $claudeBin }

        $fallbackPresent = $false
        if (Test-Path -LiteralPath $FallbackRoot) {
            # -Force: the marker is a dotfile, and Get-ChildItem hides items
            # carrying the Hidden attribute without it - a hidden marker would
            # otherwise read as "not installed".
            $fallbackPresent = [bool](Get-ChildItem -Path $FallbackRoot -Filter $Marker -Recurse -Depth 1 -Force -ErrorAction SilentlyContinue)
        }

        Write-Host ''
        if ($StateRootOverride) {
            Write-Info "Self-check (state root: $StateRootOverride)"
        } else {
            Write-Info "Self-check (state roots: $StateRootFallback , $StateRootPluginGlob)"
        }

        if (-not $listState.Listed -and -not $fallbackPresent) {
            Write-Err 'not-installed - neither the plugin nor a fallback copy was found.'
            Write-Err 'Run this installer without -VerifyActive to install.'
            return 2
        }

        $evidence = Get-StateEvidenceAge
        $proofAge = $evidence.ProofAge
        $proofFresh = ($null -ne $proofAge -and $proofAge -lt $ActiveWindowSecs)
        # Listed, but the host reported it as failed to load. Distinct from
        # "listed but not enabled": a disabled plugin is one /reload-plugins or
        # `claude plugin enable` away, while a load failure means the manifest
        # itself is broken - nothing from the plugin is loaded, and re-reading
        # the same broken manifest cannot change that.
        $loadFailed = $listState.Listed -and $listState.Failed -and -not $listState.Enabled

        if ($loadFailed) {
            if ($proofFresh -or $fallbackPresent) {
                Write-Warn2 "$Plugin@$Marketplace is listed but 'claude plugin list' reports it as FAILED TO LOAD:"
            } else {
                Write-Err "load-failed - $Plugin@$Marketplace is listed by 'claude plugin list', but"
                Write-Err 'Claude Code could not load it. Nothing from the plugin is running: no'
                Write-Err 'hook, no command, no skill, no monitor. The install is INERT.'
            }
            if ($listState.ErrorLines.Count -gt 0) {
                foreach ($e in $listState.ErrorLines) { Write-Err "  claude plugin list: $e" }
            } else {
                Write-Err "  ('claude plugin list' printed no Error: line here - run it yourself for the raw text)"
            }
            Write-Err '/reload-plugins CANNOT fix a load failure: a reload re-reads the same'
            Write-Err 'manifest and fails again identically. What to do instead:'
            Write-Err '  1. claude plugin list            (read the full, unabridged error)'
            Write-Err '  2. re-run this installer         (it always calls ''plugin update'', so a'
            Write-Err '     fixed release is picked up)'
            Write-Err "  3. still failing? report that Error: line at https://github.com/$Repo/issues"
            Write-Err "  4. or remove the broken entry: claude plugin uninstall $Plugin@$Marketplace"
            if (-not ($proofFresh -or $fallbackPresent)) {
                Write-Host ''
                return 3
            }
            Write-Warn2 'Continuing the self-check against the fallback copy / hook evidence below,'
            Write-Warn2 'which is what is actually carrying this install.'
            Write-Host ''
        }

        if ($proofFresh) {
            Write-Ok "active-verified - a handshake hook wrote hook-only state ${proofAge}s ago (within the ${ActiveWindowSecs}s freshness window)."
            Write-Ok 'claude-handshake is running. Try: /handshake status'
            return 0
        }

        Write-Warn2 'installed-but-not-active - present, but no recently-fired hook was observed.'
        $ambAge = $evidence.AmbiguousAge
        if ($null -ne $ambAge -and $ambAge -lt $ActiveWindowSecs) {
            Write-Warn2 "Local state under $StateRootFallback changed ${ambAge}s ago, but the"
            Write-Warn2 'handshake CLI writes that file too - it does not prove a hook ran, so'
            Write-Warn2 'this deliberately does NOT report active-verified.'
            Write-Warn2 'Use Claude Code for one edit or Bash call in a handshake workspace:'
            Write-Warn2 'that fires PostToolUse, which only a hook can do, and re-checking then'
            Write-Warn2 'reports active-verified.'
        }
        if ($listState.Listed -and -not $listState.Enabled -and -not $listState.Failed) {
            # Deliberately NOT reached for a failed-to-load entry: that case is
            # diagnosed above, and telling someone to run /reload-plugins for a
            # broken manifest sends them round a loop that can never terminate.
            Write-Warn2 'The plugin is installed but not reporting as enabled in ''claude plugin list''.'
            Write-Warn2 'Inside a Claude Code session, run:  /reload-plugins'
            Write-Warn2 'Then start a NEW session (or /reload-plugins again) before re-checking.'
        } else {
            # Reached for a failed-to-load entry only when a fallback copy is
            # also present (the load-failure return above already handled the
            # case where the plugin was the only route) - and then this is
            # exactly the right advice, because the fallback is what runs.
            Write-Warn2 'This is expected immediately after install: handshake''s hooks are'
            Write-Warn2 'no-ops until you are inside a workspace. To verify activation:'
            Write-Warn2 '  1. cd into a project directory (a git repo is recommended)'
            Write-Warn2 '  2. start Claude Code there: claude'
            Write-Warn2 '  3. run:  /handshake init          (creates a workspace, if none exists)'
            Write-Warn2 '  4. start a NEW session (SessionStart only syncs on startup/resume/fork)'
            Write-Warn2 '  5. re-run:  .\install.ps1 -VerifyActive'
        }
        return 1
    }

    if ($VerifyActive) {
        $code = Invoke-SelfCheck
        if ($PSCommandPath) { exit $code }
        return
    }

    # Snapshot every process-wide piece of state we touch; restored in finally.
    $PrevEAP = $ErrorActionPreference
    $PrevPath = $env:Path
    $GitEnvNames = @('GIT_TERMINAL_PROMPT', 'GIT_CONFIG_COUNT',
        'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_KEY_1', 'GIT_CONFIG_VALUE_1')
    $PrevGitEnv = @{}
    foreach ($n in $GitEnvNames) {
        $PrevGitEnv[$n] = [Environment]::GetEnvironmentVariable($n)
    }

    try {
        $ErrorActionPreference = 'Continue'

        # ---- 0. Node step zero -----------------------------------------------
        # The CLI (bin/handshake.js) and every hook shell out to `node`. Native-
        # Windows Claude Code does not guarantee Node is present, so this
        # refuses to finish without a working `node --version` rather than
        # letting the plugin install "succeed" into something that cannot run.

        function Test-NodeWorks {
            $cmd = Get-Command node -CommandType Application -ErrorAction SilentlyContinue |
                Select-Object -First 1
            if (-not $cmd) { return $null }
            try {
                $v = & $cmd.Source --version 2>$null
                if ($LASTEXITCODE -eq 0 -and $v) { return $v.Trim() }
            } catch {}
            return $null
        }

        # Absolute path of the interpreter, resolved the same way. The printed
        # settings.json snippet uses it instead of the bare word `node`: hooks
        # run with the environment of whatever process started Claude Code,
        # which after a winget/choco install in THIS window (or with an
        # nvm-windows shim that a service context never sees) may not have node
        # on PATH at all. Hooks fail soft, so a bare `node` there produces an
        # install that looks healthy and does nothing.
        function Get-NodeBinPath {
            $cmd = Get-Command node -CommandType Application -ErrorAction SilentlyContinue |
                Select-Object -First 1
            if ($cmd -and $cmd.Source) { return $cmd.Source }
            return ''
        }

        $nodeVersion = Test-NodeWorks
        if ($nodeVersion) {
            Write-Ok "Node found: $nodeVersion ($(Get-NodeBinPath))"
        } else {
            Write-Info 'Node.js not found - attempting to install it (required by claude-handshake''s CLI and every hook)...'
            $installed = $false
            $winget = Get-Command winget -CommandType Application -ErrorAction SilentlyContinue
            if ($winget) {
                Write-Info 'Using winget (OpenJS.NodeJS.LTS)...'
                try {
                    & $winget.Source install --id OpenJS.NodeJS.LTS -e --source winget `
                        --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
                    if ($LASTEXITCODE -eq 0) { $installed = $true }
                } catch {}
            }
            if (-not $installed) {
                $choco = Get-Command choco -CommandType Application -ErrorAction SilentlyContinue
                if ($choco) {
                    Write-Info 'winget unavailable or failed - trying Chocolatey (nodejs-lts)...'
                    try {
                        & $choco.Source install nodejs-lts -y 2>&1 | Out-Null
                        if ($LASTEXITCODE -eq 0) { $installed = $true }
                    } catch {}
                }
            }
            if ($installed) {
                # winget/choco update the registry PATH, not this already-running
                # process's environment - refresh from both scopes before retrying,
                # same trick installers commonly use to avoid demanding a new shell.
                # APPEND rather than replace: a process PATH routinely holds
                # entries that exist in neither registry scope (nvm, a VS dev
                # shell, conda), and dropping them here could hide a `claude`
                # that Find-Claude would otherwise have located below.
                $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
                $user = [Environment]::GetEnvironmentVariable('Path', 'User')
                $env:Path = (@($env:Path, $machine, $user) | Where-Object { $_ }) -join ';'
                $nodeVersion = Test-NodeWorks
            }
            if ($nodeVersion) {
                Write-Ok "Node installed: $nodeVersion"
                # $env:Path is restored in the finally below, so this session
                # will not see `node` by name afterwards - and a `claude`
                # started from THIS window would hand that same PATH to every
                # hook it spawns.
                $NodeNeedsNewTerminal = $true
                Write-Warn2 'Open a NEW terminal before starting Claude Code, so that node is on PATH for the hooks it spawns.'
            } else {
                Write-Err 'Node.js could not be installed automatically (no winget/choco, or the install failed).'
                Write-Err 'Install it yourself, then re-run this installer in a NEW terminal:'
                Write-Err '  https://nodejs.org/en/download'
                Write-Err '  winget install OpenJS.NodeJS.LTS'
                Write-Err '  (nvm-windows users:  https://github.com/coreybutler/nvm-windows )'
                $Failed = $true
                return
            }
        }
        $NodeBin = Get-NodeBinPath

        # ---- 1. Find the claude CLI, installing it if missing -----------------

        $ClaudeBin = Find-Claude
        if (-not $ClaudeBin) {
            Write-Info 'Claude Code CLI not found - installing it (official installer)...'
            # Child process, not in-scope iex: the official installer sets
            # StrictMode + ErrorActionPreference=Stop and may call `exit`;
            # in a child, none of that can leak into or kill this script.
            & powershell -NoProfile -ExecutionPolicy Bypass -Command 'irm https://claude.ai/install.ps1 | iex'
            if ($LASTEXITCODE -ne 0) {
                Write-Err 'Claude Code install failed. Install it manually, then re-run this script:'
                Write-Err '  irm https://claude.ai/install.ps1 | iex'
                $Failed = $true
                return
            }
            $ClaudeBin = Find-Claude
            if (-not $ClaudeBin) {
                Write-Err 'Claude Code installed, but its binary was not found in the usual places.'
                Write-Err 'Open a NEW terminal and re-run this script.'
                $Failed = $true
                return
            }
        }
        Write-Ok "Claude Code CLI: $ClaudeBin"

        # ---- 2. Force HTTPS for GitHub during this install ---------------------
        # Sidesteps every SSH failure mode (missing ~/.ssh, unknown host key,
        # no key registered with GitHub). Env-only and restored in the
        # finally below, so neither the user's git config nor their session
        # is left changed. Requires git >= 2.31 to take effect.

        $env:GIT_TERMINAL_PROMPT = '0'
        $env:GIT_CONFIG_COUNT = '2'
        $env:GIT_CONFIG_KEY_0 = 'url.https://github.com/.insteadOf'
        $env:GIT_CONFIG_VALUE_0 = 'git@github.com:'
        $env:GIT_CONFIG_KEY_1 = 'url.https://github.com/.insteadOf'
        $env:GIT_CONFIG_VALUE_1 = 'ssh://git@github.com/'

        # ---- 3. WSL detection ---------------------------------------------------
        # This script targets native Windows; WSL users run install.sh inside
        # their distro instead. The only WSL case reachable here is running this
        # .ps1 FROM inside WSL via powershell.exe interop - rare, but the same
        # fallback applies if it happens, for the same reason: Claude Code
        # plugins are known not to load hooks/monitors inside WSL.
        $IsWslHost = [bool]$env:WSL_DISTRO_NAME -or [bool]$env:WSL_INTEROP
        if ($IsWslHost) {
            Write-Warn2 'WSL environment detected - Claude Code plugins are known not to load'
            Write-Warn2 'hooks/monitors here. The plugin route will still be attempted, but a'
            Write-Warn2 'direct fallback copy will ALSO be installed so claude-handshake actually runs.'
        }

        # ---- 4. Primary route: marketplace + plugin install --------------------

        Write-Info 'Installing the claude-handshake plugin...'
        $pluginRouteOk = $false
        $routeReportedOk = Invoke-PluginRoute $ClaudeBin
        # Read the resulting state once, on BOTH paths: it decides whether a
        # failed route can be ignored (an existing healthy install), and
        # whether the plugin the route just installed is actually loadable.
        $listAfterRoute = Get-PluginListState $ClaudeBin
        if ($routeReportedOk) {
            $pluginRouteOk = $true
            Write-Ok "Plugin installed: $Plugin@$Marketplace"
        } elseif ($listAfterRoute.Enabled) {
            # The route failed transiently, but a working plugin install
            # already exists - do not shadow it with a frozen fallback copy.
            $pluginRouteOk = $true
            Write-Warn2 "Plugin route failed, but $Plugin@$Marketplace is already installed - keeping it."
        } else {
            Write-Warn2 'Plugin route failed.'
        }
        # `plugin install` can exit 0 for a plugin the host then refuses to
        # load (a broken manifest installs perfectly well). That must never be
        # allowed to trigger the supersede-cleanup below: deleting a working
        # fallback copy in favour of an inert plugin would take a working
        # install away from the user. The self-check reports it in full.
        $pluginLoadFailed = $listAfterRoute.Listed -and $listAfterRoute.Failed -and -not $listAfterRoute.Enabled

        $needFallback = (-not $pluginRouteOk) -or $IsWslHost

        if (-not $needFallback -and $pluginLoadFailed) {
            Write-Warn2 "$Plugin@$Marketplace is listed but reports 'failed to load' - keeping any"
            Write-Warn2 'existing fallback copy (removing it would leave nothing running). The'
            Write-Warn2 'self-check below reports the load error in full.'
        } elseif (-not $needFallback) {
            # A previous run may have used the fallback; the plugin copy
            # supersedes it. The fallback route writes THREE things, so all
            # three have to be superseded together:
            #   1. $FallbackRoot\<version>\            (carries $Marker)
            #   2. $ClaudeDir\skills\handshake\        (carries $Marker)
            #   3. $ClaudeDir\commands\handshake.md    (a single file - no
            #      marker is possible, so identity is proven by content)
            # Removing only (1) left (2) and (3) behind pointing at the very
            # directory this run had just deleted, and made /handshake and the
            # skill load twice - once from the orphans, once from the plugin.
            #
            # Ownership rules are unchanged: only something this installer
            # wrote is deleted outright, anything ambiguous is backed up first,
            # and anything with no trace of the fallback route is left alone.
            $markedFallbacks = @()
            if (Test-Path -LiteralPath $FallbackRoot) {
                $markedFallbacks = @(Get-ChildItem -Path $FallbackRoot -Directory -ErrorAction SilentlyContinue |
                    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName $Marker) })
            }
            $userSkill = Join-Path $ClaudeDir 'skills\handshake'
            $userCmd = Join-Path $ClaudeDir 'commands\handshake.md'
            $userSkillIsOurs = Test-Path -LiteralPath (Join-Path $userSkill $Marker)
            # The gate for touching the SHARED user-level locations at all: is
            # there any evidence THIS installer's fallback route ever ran here?
            # Without it, a machine that only ever used the plugin route would
            # have a hand-written ~\.claude\commands\handshake.md moved aside
            # for no reason.
            $fallbackTraces = ($markedFallbacks.Count -gt 0) -or $userSkillIsOurs
            $userBakSupersede = Join-Path $ClaudeDir "handshake-backup.$((Get-Date).ToString('yyyyMMddHHmmss'))"

            # (3) command file - compared against the fallback copies BEFORE
            # they are removed below, since they are the only proof of what
            # this installer wrote there.
            if ($fallbackTraces -and (Test-Path -LiteralPath $userCmd)) {
                $cmdIsOurs = $false
                foreach ($fb in $markedFallbacks) {
                    $fbCmd = Join-Path $fb.FullName 'commands\handshake.md'
                    if (-not (Test-Path -LiteralPath $fbCmd)) { continue }
                    try {
                        if ((Get-Content -LiteralPath $fbCmd -Raw -ErrorAction Stop) -eq
                            (Get-Content -LiteralPath $userCmd -Raw -ErrorAction Stop)) {
                            $cmdIsOurs = $true
                            break
                        }
                    } catch {}
                }
                if ($cmdIsOurs) {
                    Remove-Item -LiteralPath $userCmd -Force -ErrorAction SilentlyContinue
                    if (Test-Path -LiteralPath $userCmd) {
                        Write-Warn2 "Could not remove the superseded $userCmd - /handshake may load twice."
                    } else {
                        Write-Ok "Removed the superseded user-level command $userCmd (the plugin provides /handshake now)"
                    }
                } else {
                    # It differs from every copy we wrote (hand-edited, or from
                    # an older release whose fallback dir is gone). Never
                    # delete that outright - back it up, then take it out of
                    # the load path so it cannot shadow the plugin's command.
                    try {
                        New-Item -ItemType Directory -Path $userBakSupersede -Force -ErrorAction Stop | Out-Null
                        Move-Item -LiteralPath $userCmd -Destination (Join-Path $userBakSupersede 'commands-handshake.md') -ErrorAction Stop
                        Write-Warn2 "$userCmd differed from every copy this installer wrote - moved it to $userBakSupersede\commands-handshake.md so it cannot shadow the plugin's /handshake."
                    } catch {
                        Write-Warn2 "Could not back up $userCmd - leaving it in place. /handshake may load twice until you remove it."
                    }
                }
            }

            # (2) skill directory - marker or nothing.
            if (Test-Path -LiteralPath $userSkill) {
                if ($userSkillIsOurs) {
                    Remove-Item -Recurse -Force -LiteralPath $userSkill -ErrorAction SilentlyContinue
                    if (Test-Path -LiteralPath $userSkill) {
                        Write-Warn2 "Could not remove the superseded $userSkill (a file may be in use by a running Claude Code session)."
                        Write-Warn2 'Close Claude Code and re-run this installer, or the skill may load twice.'
                    } else {
                        Write-Ok "Removed the superseded user-level skill $userSkill (the plugin provides it now)"
                    }
                } elseif ($fallbackTraces) {
                    Write-Warn2 "$userSkill was not written by this installer - leaving it untouched."
                    Write-Warn2 'It may shadow the plugin''s own handshake skill; remove it yourself if that is not what you want.'
                }
            }

            # (1) fallback copies. Delete the marker LAST: if a locked file
            # blocks full removal, the marker survives and a later run can
            # still recognize and finish this cleanup.
            foreach ($fbItem in $markedFallbacks) {
                $fb = $fbItem.FullName
                Get-ChildItem -Path $fb -Force |
                    Where-Object { $_.Name -ne $Marker } |
                    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
                $leftover = @(Get-ChildItem -Path $fb -Force | Where-Object { $_.Name -ne $Marker })
                if ($leftover.Count -gt 0) {
                    Write-Warn2 "Could not fully remove the fallback copy at $fb (a file may be in use by a running Claude Code session)."
                    Write-Warn2 'Close Claude Code and re-run this installer, or it may load twice.'
                } else {
                    Remove-Item -Recurse -Force $fb -ErrorAction SilentlyContinue
                    if (Test-Path $fb) {
                        Write-Warn2 "Could not fully remove $fb - close Claude Code and re-run this installer."
                    } else {
                        Write-Ok "Removed the superseded fallback copy at $fb (the plugin supersedes it)"
                    }
                }
            }
        } else {
            # ---- 5. Fallback: direct copy + hook-registration guidance, no git --
            Write-Warn2 'Installing the direct fallback copy (no git needed)...'
            $tmp = Join-Path $env:TEMP ('claude-handshake-' + [System.IO.Path]::GetRandomFileName())
            $stage = 'download'
            try {
                New-Item -ItemType Directory -Path $tmp -Force -ErrorAction Stop | Out-Null
                $zip = Join-Path $tmp 'claude-handshake.zip'
                Invoke-WebRequest -Uri $ZipUrl -OutFile $zip -UseBasicParsing -ErrorAction Stop
                $stage = 'extract'
                Expand-Archive -Path $zip -DestinationPath $tmp -Force -ErrorAction Stop
                $src = Join-Path $tmp 'claude-handshake-main'
                if (-not (Test-Path (Join-Path $src 'bin\handshake.js'))) {
                    throw "the downloaded archive did not contain bin\handshake.js - the repo layout may have changed. Please report this: https://github.com/$Repo/issues"
                }

                $stage = 'copy'
                $pkgVersion = '0.0.0'
                try {
                    $pkg = Get-Content (Join-Path $src 'package.json') -Raw | ConvertFrom-Json
                    if ($pkg.version) { $pkgVersion = $pkg.version }
                } catch {}
                $dest = Join-Path $FallbackRoot $pkgVersion

                New-Item -ItemType Directory -Path $FallbackRoot -Force -ErrorAction Stop | Out-Null
                if (Test-Path $dest) {
                    if (-not (Test-Path (Join-Path $dest $Marker))) {
                        # Not ours - never destroy a hand-authored directory. The
                        # backup must live OUTSIDE $FallbackRoot, or a later scan
                        # of its children would still find and try to manage it.
                        $bak = Join-Path $ClaudeDir "handshake-plugin-backup.$((Get-Date).ToString('yyyyMMddHHmmss'))"
                        Move-Item -Path $dest -Destination $bak -ErrorAction Stop
                        Write-Warn2 "Existing $dest was not created by this installer - moved it to $bak"
                    } else {
                        Remove-Item -Recurse -Force $dest -ErrorAction Stop
                    }
                }
                Copy-Item -Recurse -Path $src -Destination $dest -ErrorAction Stop
                if (-not (Test-Path (Join-Path $dest 'bin\handshake.js'))) {
                    throw 'copy verification failed - bin\handshake.js missing at the destination'
                }
                try {
                    New-Item -ItemType File -Path (Join-Path $dest $Marker) -Force -ErrorAction Stop | Out-Null
                } catch {
                    Write-Warn2 "Could not write the installer marker at $dest\$Marker - a future run will treat this copy as hand-authored and move it aside instead of replacing it."
                }
                Write-Ok "Copied claude-handshake $pkgVersion to $dest"

                # ---- prune to the runtime payload ------------------------
                # The downloaded archive is the WHOLE repository - test\, e2e\,
                # spike\, docs\, scripts\, installers\, PLAN.md - none of which
                # is ever loaded at runtime, and all of which would sit in the
                # user's own config directory forever. Keep only what a hook,
                # the CLI, the skill/command files and `deploy-relay` actually
                # read. The keep-list is maintained beside the repo layout,
                # which is safe because the installer and the payload always
                # ship from the same branch of the same repo.
                $stage = 'prune'
                $keepTop = @('bin', 'lib', 'hooks', 'monitors', 'skills', 'commands',
                    'relay', '.claude-plugin', 'package.json', 'LICENSE', 'README.md', $Marker)
                Get-ChildItem -LiteralPath $dest -Force -ErrorAction SilentlyContinue | ForEach-Object {
                    if ($keepTop -notcontains $_.Name) {
                        Remove-Item -Recurse -Force -LiteralPath $_.FullName -ErrorAction SilentlyContinue
                    }
                }
                # relay\: lib\deploy.js copies exactly src\, wrangler.toml and
                # package.json to the work dir, and locateRelayDir only probes
                # for wrangler.toml plus src\worker.js. The rest is dev-only.
                $relayDir = Join-Path $dest 'relay'
                if (Test-Path -LiteralPath $relayDir) {
                    $keepRelay = @('src', 'wrangler.toml', 'package.json')
                    Get-ChildItem -LiteralPath $relayDir -Force -ErrorAction SilentlyContinue | ForEach-Object {
                        if ($keepRelay -notcontains $_.Name) {
                            Remove-Item -Recurse -Force -LiteralPath $_.FullName -ErrorAction SilentlyContinue
                        }
                    }
                }
                if (-not (Test-Path -LiteralPath (Join-Path $dest 'bin\handshake.js')) -or
                    -not (Test-Path -LiteralPath (Join-Path $dest 'hooks')) -or
                    -not (Test-Path -LiteralPath (Join-Path $dest 'lib'))) {
                    throw "pruning removed something it should not have - $dest is incomplete"
                }

                # Rewrite the plugin-relative references so the standalone copy
                # is directly runnable: ${CLAUDE_PLUGIN_ROOT} / $CLAUDE_PLUGIN_ROOT
                # only exist when the host's plugin system sets them, which does
                # not happen here. (Confirmed necessary: the host does NOT expand
                # those placeholders in a user-level ~\.claude\settings.json -
                # only in plugin manifests and project settings.)
                #
                # Two Windows-only traps, both verified the hard way:
                #  1. $dest is a backslash path, and these placeholders sit
                #     INSIDE JSON string literals. Substituting it raw produces
                #     "C:\Users\..." - `\U` is not a legal JSON escape and `\t`
                #     silently becomes a TAB, so hooks.json / monitors.json /
                #     plugin.json all stop parsing, and the settings.json
                #     snippet below can no longer be rendered at all. JSON files
                #     therefore get a JSON-escaped path; .md files get the plain
                #     one.
                #  2. Set-Content -Encoding utf8 writes a UTF-8 BOM on Windows
                #     PowerShell 5.1, and Node's JSON.parse rejects a leading
                #     BOM. Write bytes explicitly with a BOM-less encoder, and
                #     preserve the file's original trailing newline instead of
                #     stripping it with -NoNewline.
                $destJson = $dest.Replace('\', '\\')
                $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
                Get-ChildItem -Path $dest -Recurse -Include '*.md', '*.json' -Force -ErrorAction SilentlyContinue | ForEach-Object {
                    $text = Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue
                    if ($null -eq $text) { return }
                    $replacement = if ($_.Extension -eq '.json') { $destJson } else { $dest }
                    $newText = $text.Replace('${CLAUDE_PLUGIN_ROOT}', $replacement).Replace('$CLAUDE_PLUGIN_ROOT', $replacement)
                    if ($newText -ne $text) {
                        [System.IO.File]::WriteAllText($_.FullName, $newText, $utf8NoBom)
                    }
                }

                # commands/ and skills/ auto-load from these fixed locations
                # without any settings.json edit (the same mechanism claude-tier's
                # skills-dir fallback relies on). hooks/ and monitors/ have no
                # such directory convention, so those need the settings.json
                # snippet printed below.
                #
                # These two are SHARED user directories, not directories this
                # installer owns, so the same rule as the fallback copy
                # applies: never delete before the replacement exists, never
                # destroy something we did not write, and keep any backup
                # OUTSIDE the managed directory (a backup left inside
                # ~\.claude\skills would load as a second, stale `handshake`
                # skill).
                $cmdDir = Join-Path $ClaudeDir 'commands'
                $skillDir = Join-Path $ClaudeDir 'skills'
                $userBak = Join-Path $ClaudeDir "handshake-backup.$((Get-Date).ToString('yyyyMMddHHmmss'))"
                New-Item -ItemType Directory -Path $cmdDir -Force -ErrorAction SilentlyContinue | Out-Null
                New-Item -ItemType Directory -Path $skillDir -Force -ErrorAction SilentlyContinue | Out-Null

                $srcCmd = Join-Path $dest 'commands\handshake.md'
                if (Test-Path -LiteralPath $srcCmd) {
                    $destCmd = Join-Path $cmdDir 'handshake.md'
                    $cmdOk = $true
                    if (Test-Path -LiteralPath $destCmd) {
                        $same = $false
                        try {
                            $same = ((Get-Content -LiteralPath $srcCmd -Raw) -eq (Get-Content -LiteralPath $destCmd -Raw))
                        } catch { $same = $false }
                        if (-not $same) {
                            try {
                                New-Item -ItemType Directory -Path $userBak -Force -ErrorAction Stop | Out-Null
                                Copy-Item -LiteralPath $destCmd -Destination (Join-Path $userBak 'commands-handshake.md') -ErrorAction Stop
                                Write-Warn2 "Your existing $destCmd differed - backed it up to $userBak\commands-handshake.md"
                            } catch {
                                Write-Err "Could not back up the existing $destCmd - leaving it untouched."
                                $cmdOk = $false
                            }
                        }
                    }
                    if ($cmdOk) {
                        try {
                            # Write beside it, then move over: the replacement
                            # exists before the old file stops existing.
                            Copy-Item -LiteralPath $srcCmd -Destination "$destCmd.new" -Force -ErrorAction Stop
                            Move-Item -LiteralPath "$destCmd.new" -Destination $destCmd -Force -ErrorAction Stop
                            Write-Ok "Command copied: $destCmd (/handshake will work once claude reloads)"
                        } catch {
                            Remove-Item -LiteralPath "$destCmd.new" -Force -ErrorAction SilentlyContinue
                            Write-Warn2 "Could not install $destCmd - /handshake will not be available."
                        }
                    }
                }

                $srcSkill = Join-Path $dest 'skills\handshake'
                if (Test-Path -LiteralPath $srcSkill) {
                    $destSkill = Join-Path $skillDir 'handshake'
                    $stageSkill = Join-Path $skillDir ('.handshake-installing.' + $PID)
                    Remove-Item -Recurse -Force -LiteralPath $stageSkill -ErrorAction SilentlyContinue
                    $staged = $false
                    try {
                        Copy-Item -Recurse -LiteralPath $srcSkill -Destination $stageSkill -Force -ErrorAction Stop
                        $staged = Test-Path -LiteralPath (Join-Path $stageSkill 'SKILL.md')
                    } catch { $staged = $false }
                    if (-not $staged) {
                        Remove-Item -Recurse -Force -LiteralPath $stageSkill -ErrorAction SilentlyContinue
                        Write-Warn2 "Could not stage the skill copy - $destSkill left unchanged."
                    } else {
                        New-Item -ItemType File -Path (Join-Path $stageSkill $Marker) -Force -ErrorAction SilentlyContinue | Out-Null
                        $slotFree = $true
                        if (Test-Path -LiteralPath $destSkill) {
                            if (-not (Test-Path -LiteralPath (Join-Path $destSkill $Marker))) {
                                # Not ours (or written by a pre-marker version
                                # of this installer): move it aside, never
                                # delete it.
                                try {
                                    New-Item -ItemType Directory -Path $userBak -Force -ErrorAction Stop | Out-Null
                                    Move-Item -LiteralPath $destSkill -Destination (Join-Path $userBak 'skills-handshake') -ErrorAction Stop
                                    Write-Warn2 "Existing $destSkill was not written by this installer - moved it to $userBak\skills-handshake"
                                } catch {
                                    Write-Err "Could not move $destSkill aside - leaving it untouched."
                                    $slotFree = $false
                                }
                            } else {
                                Remove-Item -Recurse -Force -LiteralPath $destSkill -ErrorAction SilentlyContinue
                                if (Test-Path -LiteralPath $destSkill) {
                                    Write-Warn2 "Could not replace $destSkill (a file may be in use)."
                                    $slotFree = $false
                                }
                            }
                        }
                        $moved = $false
                        if ($slotFree) {
                            try {
                                Move-Item -LiteralPath $stageSkill -Destination $destSkill -ErrorAction Stop
                                $moved = $true
                            } catch { $moved = $false }
                        }
                        if ($moved) {
                            Write-Ok "Skill copied: $destSkill"
                        } else {
                            Remove-Item -Recurse -Force -LiteralPath $stageSkill -ErrorAction SilentlyContinue
                            Write-Warn2 "Could not install $destSkill - the on-demand skill will not load."
                        }
                    }
                }

                Write-Host ''
                Write-Info 'Hook registration (required - not automated on purpose)'
                Write-Host "This installer will NOT edit $ClaudeDir\settings.json for you. Merge the"
                Write-Host '"hooks" object below into it by hand (or ask your own Claude Code session'
                Write-Host 'to do it, and review the diff before saving):'
                Write-Host ''
                $hooksFile = Join-Path $dest 'hooks\hooks.json'
                if (Test-Path $hooksFile) {
                    try {
                        # The rewrite above already resolved ${CLAUDE_PLUGIN_ROOT}
                        # to $dest inside this copy's own hooks.json, so this
                        # re-wraps it for settings.json - and pins the
                        # interpreter while doing so. hooks.json ships the bare
                        # word `node`, which is correct for the plugin route
                        # (the host resolves it), but these commands are about
                        # to be pasted into settings.json and run with whatever
                        # environment started Claude Code - which may not have
                        # node on PATH at all. Hooks fail soft, so a bare `node`
                        # there would leave an install that looks healthy and
                        # does nothing.
                        #
                        # The quotes below are added as PLAIN characters: this
                        # object is JSON-encoded once, by ConvertTo-Json, and
                        # pre-escaping here would double-escape them.
                        $hooksObj = Get-Content $hooksFile -Raw | ConvertFrom-Json
                        if ($NodeBin) {
                            $nodeQuoted = '"' + $NodeBin + '"'
                            foreach ($evt in @($hooksObj.hooks.PSObject.Properties)) {
                                foreach ($group in @($evt.Value)) {
                                    foreach ($h in @($group.hooks)) {
                                        if ($h -and ($h.command -is [string]) -and $h.command -match '^node\s') {
                                            $h.command = $nodeQuoted + $h.command.Substring(4)
                                        }
                                    }
                                }
                            }
                        }
                        @{ hooks = $hooksObj.hooks } | ConvertTo-Json -Depth 10 | Write-Host
                    } catch {
                        Write-Warn2 "(could not render the hooks snippet - inspect $hooksFile by hand)"
                    }
                }
                Write-Host ''
                if ($NodeBin) {
                    Write-Host 'The hook commands above deliberately pin the absolute node binary this'
                    Write-Host "installer found ($NodeBin) instead of the bare word ""node"":"
                    Write-Host 'Claude Code runs hooks with the environment of whatever process started'
                    Write-Host 'it, which may not have node on PATH - the hooks would then fail silently'
                    Write-Host 'with "node: command not found". Update that path by hand if you later'
                    Write-Host 'switch node versions.'
                    Write-Host ''
                }
                Write-Host 'Monitors (the presence/claim-renewal clock) have no settings.json'
                Write-Host 'equivalent and are NOT available in this fallback mode. This is a'
                Write-Host 'documented, handled condition, not a defect: claude-handshake falls back'
                Write-Host 'to "heartbeating on turn boundaries" when monitors are unavailable'
                Write-Host '(PROTOCOL.md section 8) - coordination still works, just at reduced'
                Write-Host 'liveness precision.'
            } catch {
                Write-Err "Fallback failed during $stage : $($_.Exception.Message)"
                if ($stage -eq 'download') {
                    # "Could not download" has two very different causes and
                    # only one of them is worth retrying. A 404 here means the
                    # repo, branch or path is not published (or is private).
                    $status = $null
                    try { $status = [int]$_.Exception.Response.StatusCode } catch { $status = $null }
                    if ($status -eq 404 -or $status -eq 410) {
                        Write-Err "$ZipUrl returned HTTP $status."
                        Write-Err 'That path does not exist on the server - the repository, branch, or'
                        Write-Err 'file layout may have changed, or the repo may be private.'
                        Write-Err "Check https://github.com/$Repo for the current release, then re-run."
                    } elseif ($status -eq 401 -or $status -eq 403) {
                        Write-Err "$ZipUrl returned HTTP $status (access denied) - the repo may be private, or a proxy is blocking the request."
                    } else {
                        Write-Err 'Check your network connection, DNS, or proxy settings.'
                    }
                }
                $Failed = $true
                return
            } finally {
                Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
            }
        }

        # ---- 6. Three-valued self-check ----------------------------------------
        $selfCheckCode = Invoke-SelfCheck
        Write-Host ''
        if ($NodeNeedsNewTerminal) {
            Write-Warn2 'Node was installed during this run: open a NEW terminal before starting'
            Write-Warn2 'Claude Code, or the hooks it spawns will not find node on PATH.'
        }
        Write-Ok 'Install step finished. Re-check activation anytime with:'
        Write-Ok "  irm https://raw.githubusercontent.com/$Repo/main/installers/install.ps1 -OutFile install.ps1"
        Write-Ok '  .\install.ps1 -VerifyActive'
        # "installed-but-not-active" (1) is the expected, documented outcome of
        # a fresh install - every hook is a no-op until you are inside a
        # workspace - so it must not be reported as a failed install. Only
        # "not-installed" (2) means the install did not happen.
        if ($selfCheckCode -ge 2) { $Failed = $true }
    } finally {
        # Leave the caller's session exactly as we found it.
        $ErrorActionPreference = $PrevEAP
        $env:Path = $PrevPath
        foreach ($n in $GitEnvNames) {
            if ($null -eq $PrevGitEnv[$n]) {
                Remove-Item "Env:$n" -ErrorAction SilentlyContinue
            } else {
                [Environment]::SetEnvironmentVariable($n, $PrevGitEnv[$n])
            }
        }
        # As a file (-File / .\install.ps1) report failure via exit code;
        # under `irm | iex` $PSCommandPath is empty and we must never exit
        # the caller's session.
        if ($Failed -and $PSCommandPath) { exit 1 }
    }
}
