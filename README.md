# claude-handshake

**Peer collaboration for Claude Code.** Two or more completely separate Claude
Code instances — different users, different accounts, different machines —
working the same project as a coordinated team: automatic presence, task
claiming with overlap warnings, discovery sharing, and a shared durable record,
with the coordination mechanics invisible to the users.

> 🚧 **In active development.** The v1 design is frozen in [PLAN.md](PLAN.md).
> Nothing here is installable yet — watch/star for the first release.

## The idea

Every existing multi-agent tool either gives one person many hands (orchestrator
+ subagents, one account) or many people one keyboard (shared sessions). None
lets two people's own Claudes talk to each other while they work — know what
the other is doing, avoid colliding on the same code, pass discoveries across,
and leave a durable record. That's what this builds.

- **Zero-setup mode** to try it (no accounts, no servers)
- **Team relay mode** (your own free Cloudflare Worker) for real work
- **GitHub as the durable base** — tasks and decisions live in your repo;
  works without GitHub too
- **One paste to join** — an invite line your teammate pastes into Claude Code

## License

MIT © Fenil K Ventures LLC
