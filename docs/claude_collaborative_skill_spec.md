# Claude Collaborative Skill — Functional Specification

## 1. Purpose

Build a collaboration skill that allows two or more completely separate Claude instances, owned or operated by different users, to work on the same project as a coordinated team.

The user should not have to manually send messages, receive messages, join channels, claim tasks, or manage synchronization mechanics.

The collaboration layer should be mostly invisible.

The intended experience is:

> Give Claude normal project work. Claude automatically checks what the other collaborators are doing, avoids duplicated work, shares important discoveries, coordinates changes, and keeps the project state current.

GitHub is optional. The skill must work without GitHub.

When GitHub is available, it is used as a persistence, remembrance, audit, and verification layer—not as the primary communication mechanism.

---

## 2. Core Principle

The system has two distinct layers.

### Live Collaboration Layer

Used for immediate coordination between Claude instances.

It should communicate:

- what each Claude is currently doing;
- what it intends to do next;
- what files, components, features, or problem areas it is touching;
- discoveries that affect another collaborator;
- errors found;
- fixes in progress;
- fixes completed;
- blockers;
- requests for verification;
- warnings about overlapping work;
- changes in task ownership or priority.

This layer must work even when GitHub is unavailable.

### Optional Durable Project Layer

Used for long-term memory and verification.

GitHub may contain:

- project plans;
- task lists;
- decisions;
- milestones;
- implementation notes;
- handoffs;
- status summaries;
- code changes;
- commits;
- branches;
- pull requests;
- verified completion records.

GitHub improves reliability and memory but is not required for live collaboration.

---

## 3. User Experience

The user should interact with Claude normally.

Example:

> Work on the Wave Zero onboarding flow.

The skill should automatically perform the collaboration steps internally.

The user should NOT need to say:

- send this;
- receive messages;
- check the channel;
- claim this task;
- publish status;
- sync now;
- ask the other Claude;
- refresh collaboration state.

Those are implementation details.

The desired abstraction is:

> The user manages the project. The Claudes manage their coordination.

---

## 4. Automatic Collaboration Loop

Before meaningful project work begins, Claude should:

1. Identify the current project.
2. Identify itself within the collaboration group.
3. Check the latest live state of other Claude collaborators.
4. Determine what each collaborator is working on.
5. Determine whether the requested work overlaps with existing work.
6. Check relevant shared plans or task information.
7. If GitHub is enabled, inspect relevant durable project state.
8. Decide whether it can proceed safely.
9. Announce its intended work to the collaboration layer.
10. Begin work.

While working, Claude should:

1. Keep its current activity state fresh.
2. Broadcast meaningful discoveries.
3. Notify collaborators of relevant errors or risks.
4. Detect overlapping work as early as possible.
5. Avoid duplicating work already being handled by another Claude.
6. Coordinate automatically when dependencies appear.
7. Update collaborators when its task changes materially.
8. Request peer verification when useful.

When work finishes, Claude should:

1. Mark the work complete in live collaboration state.
2. Publish a concise result summary.
3. Identify anything another Claude needs to know.
4. Release any claimed work area.
5. Update shared task/plan state when appropriate.
6. If GitHub is available, persist important durable changes.
7. Verify that its work is represented correctly in the project state.

---

## 5. Collaboration State

Each active Claude should expose a small structured state containing at least:

- collaborator identity;
- project identity;
- current status;
- current task;
- task description;
- files or components being touched;
- branch or working area, when relevant;
- progress state;
- blockers;
- important discoveries;
- dependencies;
- last meaningful update;
- expected next action.

The state should remain lightweight.

The system should not attempt to copy entire Claude conversations or full context windows between instances.

---

## 6. Presence

The system should maintain awareness of whether a collaborator is:

- active;
- working;
- waiting;
- blocked;
- idle;
- finished;
- unavailable.

Presence should be automatic.

A Claude should not assume another Claude is inactive merely because no new message has appeared recently. Activity state should distinguish between long-running work and abandoned work.

---

## 7. Task Awareness

The collaboration system should understand:

- planned tasks;
- active tasks;
- unclaimed tasks;
- completed tasks;
- blocked tasks;
- dependencies;
- task ownership;
- overlapping tasks.

Task ownership does not need to be rigid.

A Claude should be able to recognize:

> Another Claude is already solving this.

and then either:

- avoid the work;
- verify the work;
- take a related non-overlapping task;
- coordinate a split;
- explicitly assist when assistance is useful.

---

## 8. Automatic Peer Communication

Claude instances should exchange useful project information automatically.

Examples:

> I found an error in the ingestion pipeline. I am fixing it.

> The ingestion error is fixed. Please do not reimplement the workaround.

> My change affects the API response shape used by your component.

> I completed the backend portion. Your frontend task can continue.

> I found a missing edge case in your implementation. I have not changed your files.

> I need verification of this behavior before marking the task complete.

These should be generated only when materially useful.

The system should avoid excessive chatter.

---

## 9. Conflict Avoidance

Before modifying a shared area, Claude should determine whether another collaborator is already working there.

Potential overlap includes:

- same file;
- same component;
- same function;
- same API;
- same database schema;
- same feature;
- same bug;
- same architectural decision.

When a conflict is detected, Claude should not blindly continue.

It should decide whether to:

- defer;
- coordinate;
- divide the work;
- verify rather than edit;
- work on another task;
- inform the collaborator.

Conflict handling should be automatic unless a real human decision is necessary.

---

## 10. Peer Verification

One Claude should be able to verify another Claude's completed work.

Verification may include:

- checking changed code;
- running tests;
- checking implementation against requirements;
- confirming a bug is actually fixed;
- confirming shared state is current;
- verifying GitHub commits or pull requests when GitHub is enabled.

Verification should not automatically mean rewriting the other Claude's work.

The default should be:

> verify first, modify only when necessary.

---

## 11. Shared Project Documents

The skill should support persistent shared project documents.

Typical documents may include:

- project plan;
- current milestone;
- task list;
- decisions;
- implementation notes;
- architecture notes;
- known issues;
- handoff notes;
- current priorities.

The exact file names and structure should remain configurable.

The skill should be able to update these documents automatically when an important durable change occurs.

It should not write every transient conversation or small thought into durable project documents.

---

## 12. GitHub Integration — Optional

The collaboration system must function without GitHub.

When GitHub is connected, the skill may use it to:

- persist shared project documents;
- verify code state;
- verify branches;
- verify commits;
- verify pull requests;
- confirm that completed work actually exists;
- recover project state after collaboration services restart;
- preserve long-term project memory;
- create an auditable history of important decisions and task progress.

GitHub should not become a mandatory messaging bus.

Live communication should not depend on continuously committing small status updates.

---

## 13. GitHub as Verification Point

When GitHub is available, Claude should distinguish between:

### Claimed State

> Another Claude says this is fixed.

### Verified State

> The code/change exists and can be confirmed in the project repository.

The collaboration layer may report the first immediately.

GitHub can later establish the second.

This prevents the live coordination layer from being treated as unquestionable truth.

---

## 14. Ideas and Brainstorming

Not every idea discussed with one Claude should automatically become project truth.

The system should distinguish:

- private brainstorming;
- tentative idea;
- proposed change;
- accepted decision;
- active task;
- implemented change;
- verified completion.

A useful idea may be surfaced to another collaborator when relevant without automatically becoming an approved project decision.

---

## 15. Privacy and Secret Handling

The collaboration system must never intentionally share:

- passwords;
- API keys;
- access tokens;
- session cookies;
- private credentials;
- `.env` values;
- authentication secrets;
- private keys;
- secrets discovered in local configuration;
- unrelated personal information.

Secret filtering should be automatic.

The skill should share the minimum information necessary for collaboration.

Example:

Instead of sharing:

> API_KEY=abc123...

share:

> The API credential is configured locally and available.

---

## 16. Scope Isolation

Collaboration state must be project-specific.

Claude working on Project A should not expose Project B information unless explicitly permitted.

Each collaboration workspace should have a clear project identity.

---

## 17. Failure Behaviour

### If another Claude is unreachable

Continue working where safe.

Do not block all project work simply because a peer is offline.

Mark peer state as unavailable or stale.

### If the live collaboration layer is unavailable

Continue local work where safe.

If GitHub is available, use it as a fallback source of durable state.

### If GitHub is unavailable

Live collaboration continues normally.

Durable updates remain pending until persistence becomes available.

### If state conflicts

Prefer:

1. verified current code/project state;
2. latest explicit accepted decision;
3. latest live collaborator state;
4. older persistent notes.

Flag ambiguity when it materially affects implementation.

---

## 18. Human Control

The system should be automated but not autonomous beyond reasonable project collaboration.

Humans should be able to:

- override task ownership;
- tell Claude to ignore or redo peer work;
- change priorities;
- approve contested decisions;
- disconnect a collaborator;
- disable collaboration;
- disable GitHub persistence;
- inspect collaboration status.

Automation should remove coordination overhead, not remove human authority.

---

## 19. User-Facing Status

The user should be able to ask:

> What's happening?

and receive a compact project-level answer such as:

- Wave Zero: 72% complete
- Claude A: onboarding flow
- Claude B: fixing ingestion bug
- Blockers: none
- Overlap: none
- GitHub: synced
- Remaining: 3 active tasks

The user should not need to inspect internal message queues or communication mechanics.

---

## 20. Noise Control

The system should not broadcast every action.

Communicate only when information is likely to affect:

- another Claude's work;
- project correctness;
- task ownership;
- sequencing;
- dependencies;
- shared architecture;
- verification;
- project status.

Minor local implementation details should stay local.

---

## 21. Suggested Internal Event Categories

The collaboration layer should conceptually support events equivalent to:

- presence changed;
- task started;
- task changed;
- task completed;
- blocker found;
- blocker cleared;
- error found;
- fix started;
- fix completed;
- dependency created;
- dependency resolved;
- overlap detected;
- verification requested;
- verification completed;
- decision proposed;
- decision accepted;
- important discovery;
- handoff;
- project state updated.

These categories describe required behavior.

They do not prescribe a transport, protocol, framework, database, or implementation architecture.

---

## 22. What the Skill Must NOT Become

Do not turn the skill into:

- Jira;
- Slack;
- a manual chat client;
- a Kanban application users must maintain;
- a complex orchestration dashboard;
- a requirement to constantly commit state to GitHub;
- a system that copies full Claude conversations;
- a master-agent hierarchy;
- a system where one Claude permanently controls another.

The desired model is peer collaboration.

---

## 23. Core Product Principle

Two independent humans should be able to use two independent Claude instances on the same project and experience them as members of the same development team.

The Claudes should:

> know what each other is doing, avoid unnecessary duplication, communicate important discoveries automatically, verify relevant work, and keep durable project state current when persistence is available.

The communication mechanics should remain invisible to the user.

---

## 24. Minimum Viable Version

The first usable version is complete when it can reliably do all of the following:

1. Connect two independent Claude instances to one collaboration workspace.
2. Identify which Claude/user is which.
3. Automatically publish current work state.
4. Automatically see the other Claude's current work.
5. Detect obvious overlapping work.
6. Warn or coordinate before duplicate work begins.
7. Share relevant discoveries, errors, fixes, and blockers.
8. Mark work completed.
9. Allow one Claude to verify another Claude's work.
10. Maintain a lightweight shared task/project state.
11. Protect secrets automatically.
12. Continue functioning without GitHub.
13. Optionally persist and verify project state through GitHub.
14. Recover useful durable project context after restart.
15. Provide humans with a concise overall project-status view.

---

## 25. Acceptance Test

A successful end-to-end test should look like this:

### Starting State

Two users are working on the same project using completely separate Claude instances.

### User A

Asks Claude A:

> Implement Feature X.

Claude A automatically checks peer activity and begins work.

### User B

Asks Claude B:

> Fix the API issue.

Claude B checks Claude A's current work, determines the tasks do not conflict, and starts.

During the API fix, Claude B discovers that Feature X depends on the response shape being changed.

Claude B automatically informs Claude A.

Claude A adjusts its implementation plan without User A manually transferring the information.

Claude B finishes the API fix and reports completion.

Claude A verifies the relevant result before relying on it.

If GitHub is connected, durable project/task state and code evidence are updated or verified there.

Both users can ask:

> What's the status?

and receive a consistent view of who is doing what, what is complete, what remains, and whether anything conflicts.

No user manually sends collaboration messages, refreshes channels, claims tasks, or synchronizes status.

That is the target behavior.
