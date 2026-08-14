# M0.5 spike findings (2026-08-14/15, native Windows 11, Node v24)

Measured with the throwaway `spike/` plugin (user-scope install, JSONL log).
~1.7h across 21 headless/subagent sessions + targeted `claude -p` tests + one
6-minute interactive CLI session. These numbers gate the M1 freeze.

## Frozen facts

1. **Hook payload contract (parse these names):** `hookEventName`, `sessionId`,
   `toolName`, `toolInput.file_path`, `workingDirectory`, `source` ("startup"
   observed). JSON on stdin; 97.6% parse-ok; stdin arrived on every firing but
   one SessionStart stayed open past 600ms → **always read stdin with a
   bounded timeout** (the backstop still had a parseable 432 bytes).
2. **Hook cost (Node spawn dominates):** boot p50 ≈ 90–105ms, full hook p50 ≈
   100–140ms, p90 ≈ 200–580ms, max 818ms. A synchronous UserPromptSubmit hook
   is viable ONLY as a local-cache read with a short explicit timeout.
3. **PreToolUse overlap gate works:** `Edit|Write|NotebookEdit` matcher fires
   (incl. in `-p` sessions) with the full target `file_path`, ~90ms total.
4. **SessionEnd is reliable enough for the parting note:** 20/21 sessions
   (the miss = killed process; parting note stays best-effort).
5. **Monitors work on native Windows:** `when:"always"` started with the
   interactive session, ticked at 60.0s ± 20ms for 6 min, and was
   **hard-killed at session end — no signal, no exit event**. Consequences:
   monitor lifetime == session lifetime (correct heartbeat semantics);
   graceful shutdown work must ride SessionEnd, never the monitor;
   sentinel-file polling is the ONLY mid-session disarm (validated).
   Monitors did NOT start in any headless/subagent session (docs-consistent:
   interactive CLI only).
6. **DISCOVERY — plugin hooks fire in EVERY subagent/headless session.**
   21 sessions in 1.7h were mostly research subagents; each ran all hooks.
   Design consequences (feed into M1/M6):
   - Subagent sessions MUST be detected and excluded from
     presence/membership/claims — otherwise one 6-agent workflow presents as
     six teammates.
   - Hook spawn cost multiplies across concurrent agents (218 PostToolUse
     spawns in 1.7h observed) → narrow matchers + mtime-sentinel gate before
     the interpreter starts are required, not nice-to-have.
7. **PostToolUse cadence:** gap p50 0.4s, p90 3.1s in agent workloads (bursty);
   long-build silence not exercised but is definitional. Heartbeat rides the
   monitor clock; PostToolUse only carries touch-updates (async).

## Spike hygiene

The spike plugin is uninstalled after analysis; `spike/` stays in the repo for
the WSL leg and future re-measurement. Log analyzed with a local aggregator —
raw log never entered a model context.
