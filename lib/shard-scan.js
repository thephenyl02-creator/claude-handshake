'use strict';
// claude-handshake K1: the generic SessionStart shard scan.
//
// The durable layer is written by seven call sites and read automatically by
// NONE (KNOWLEDGE.md 1). This is the missing half: walk every member's shard,
// parse it through the escaping-on-read path that already exists, and cache the
// typed records where a synchronous hook can read them without touching disk
// twice or the network once.
//
// GENERIC BY DESIGN. KNOWLEDGE.md 9.K1 calls this "the shared milestone" -
// DELEGATION 6.2 calls it "the single highest-value item" and COBUILD-PLAN 3.7
// parks the same thing in S7 as "built once and shared with delegation". So
// nothing in this module knows what a learning is: it takes a set of kinds, a
// watermark and caps, and returns typed records plus the per-shard
// checkShardAuthors verdict plus an explicit truncation report. The knowledge
// layer is its first consumer, not its owner.
//
// FOUR RULES THIS MODULE DOES NOT GET TO RE-DECIDE, each inherited rather than
// re-implemented, because every re-implementation is a second path that drifts
// (SECURITY.md 5.4):
//
//   1. Shards are read ONLY through parseShard [C lib/workspace-files.js:385],
//      which escapes every field value on READ - the git path bypasses
//      transport escaping otherwise (SECURITY.md 5.4). Nothing here re-escapes
//      by hand and nothing here reads a shard any other way.
//   2. The member of a record is the SHARD's member - its header, else its
//      filename [C lib/workspace-files.js:391,452] - never a field inside the
//      record, which the record's author controls.
//   3. Attribution verdicts come from checkShardAuthors
//      [C lib/workspace-files.js:442], the one control SECURITY.md 5.4
//      mandates for the repo path, with its honest limit intact (see
//      `authorVerdicts` below).
//   4. This module NEVER writes to a shard. It is a reader, and it runs on a
//      hook path, so it also never throws: every entry point returns a
//      well-formed empty result instead (the failure posture of
//      hooks/common.js).
//
// AND THE ONE RULE THAT CHANGED, V2-PLAN §10.1's read half. Rule 4 used to end
// "and NEVER touches the network", which was true of a scan that could only
// read the working tree. A peer who has been away for six days has the peer's
// shards nowhere on disk and only on `refs/remotes/origin/handshake/state`
// (§11.2), so the scan gained two things:
//
//   * a `ref` option - the shards are enumerated with `git ls-tree` and read
//     with `git show` instead of readdir and readFileSync, through
//     lib/workspace-files.js's ref-scoped readers, with the SAME parse, the
//     same escape-on-read and the same byte cap as the working-tree path;
//   * `sessionStartScan`, the one entry point in this module that can cause a
//     network call - and it does not make one itself: it delegates to
//     lib/state-branch.js's `fetchState` when that module is installed,
//     bounded at 1,500 ms and ABANDONED rather than waited on (§2.5). Every
//     other entry point here is still local-only, and the worktree scan runs
//     and caches BEFORE the fetch is attempted, so nothing the first prompt
//     must show ever waits on the network (KNOWLEDGE.md 3.2).

const fs = require('fs');
const path = require('path');

const wsFiles = require('./workspace-files');
const stateLib = require('./state');
const repo = require('./repo');

// KNOWLEDGE.md 3.3 / 11.4: "20 shards x newest 200 records", and the truncation
// is REPORTED, never silent (PROTOCOL 10.2). The bound exists because a shard
// corpus is attacker-writable in size as well as in content - 11.4 names the
// 125 KB committed shard that once cost 18.5 s to read [C lib/escape.js:80-84].
const MAX_SHARDS = 20;
const MAX_RECORDS_PER_SHARD = 200;

// The cache file, beside peers.json / queue.json / digest.json
// [C lib/state.js:183-190] rather than inside state.json, for the same reason
// those are separate: state.json is read-modify-written by hooks on hot paths
// (KNOWLEDGE.md 9.K1).
const CACHE_FILE = 'knowledge.json';
const CACHE_VERSION = 1;

// The kinds SessionStart caches today. The module is generic - pass any kinds,
// or none for every kind - but the day-one CALL filters, and that is load
// bearing rather than a convenience: the per-shard cap keeps the NEWEST 200
// records of what was asked for, so scanning every kind on an active member's
// shard would let a run of claim/release/done records crowd that member's
// learnings out of the cache entirely. Delegation appends 'offer' /
// 'offer_state' to this array when it lands (DELEGATION 6.2); co-build asks for
// nothing and is unaffected (COBUILD-PLAN 3.7 S7).
const SESSION_START_KINDS = Object.freeze(['learned']);

// The whole author check is bounded in wall-clock time. checkShardAuthors runs
// one `git log` per shard [C lib/workspace-files.js:453] and walks EVERY shard,
// not just the capped 20 - measured at ~65 ms per call on Windows, so 20 shards
// is ~1.3 s of subprocess in front of a 7 000 ms sync inside a 10 s hook budget
// with a 9 500 ms watchdog [C hooks/session-start.js:21]. An unbounded git (a
// hung credential helper, a network filesystem) would spend that budget and
// leave the sync marker uncleared. Past the budget the remaining shards answer
// `unknown` - which is the verdict a peer shard gets anyway (KNOWLEDGE.md 3.3)
// and is never a reason to exclude anything - and the result says so in
// `authors_truncated`.
const AUTHOR_BUDGET_MS = 2000;
const AUTHOR_CALL_MS = 1200;

// V2-PLAN §2.5's SessionStart row, and the widening it requires. On the ref
// path the author `git log`s are no longer the only subprocess the scan runs -
// the `ls-tree` enumeration and one `git show` per shard are on the same clock
// and the `git show`s are the DOMINANT cost, so the budget wraps EVERY git call
// the scan makes rather than the author check alone. `authorBudgetMs` keeps its
// meaning (the author check's own sub-budget, 2,000 ms, unchanged on the
// working-tree path); `scanBudgetMs` is the outer one, and whichever runs out
// first stops the call.
const SCAN_CALL_MS = 1200;
// The two bounds §2.5 sets for the SessionStart path: 1,500 ms for the fetch
// and 500 ms for the WHOLE scan, inside the 9,500 ms watchdog with the sync's
// 7,000 ms below it [C hooks/session-start.js:24,83].
const FETCH_BUDGET_MS = 1500;
const REF_SCAN_BUDGET_MS = 500;

// The ref the read half reads. It is a remote-tracking ref and never the local
// branch: a fetch moves the first and never the second (§10.1 rule 1), so
// reading the local one would answer with whatever a human last checked out.
// `sessionStartScan` takes it as an option so the integrator can pass
// lib/state-branch.js's own constant instead of a second copy of this string.
const STATE_REF = 'refs/remotes/origin/handshake/state';

function intOr(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function relPosix(root, file) {
  try { return path.relative(root, file).split(path.sep).join('/'); } catch (_) { return String(file); }
}

// Records sort newest first. `at` is null when the header's timestamp did not
// parse [C lib/workspace-files.js:399]; those sort last rather than being
// dropped, because a record with an unreadable date is still a record.
function sortKey(rec) {
  return Number.isFinite(rec && rec.at) ? Number(rec.at) : -1;
}

function emptyResult(root, now, kinds, ref) {
  return {
    root: root || null,
    scanned_at: now,
    scan_ms: 0,
    kinds: kinds || null,
    // Which half of §10.1's read produced this: the fetched ref, or the
    // working tree it falls back to. A consumer that cannot tell them apart
    // cannot tell a stale answer from a fresh one (§4.4 rule 1).
    source: ref ? 'ref' : 'worktree',
    // How many shards in this result came from the working tree because the
    // ref does not carry them (the UNION of §11.2, below). Always present, and
    // 0 on a worktree-only scan, so a consumer never has to guess.
    worktree_only: 0,
    // And how many RECORDS came from the working tree for a member the ref
    // DOES carry - the other half of the union, counted separately because it
    // is a different fact: not "a peer the branch has never seen" but "a peer
    // whose branch copy is behind their committed one". Silent record loss is
    // what this number exists to make impossible (§4.4 rule 1).
    worktree_extra_records: 0,
    ref: ref || null,
    ref_ok: ref ? false : null,
    ref_reason: null,
    records: [],
    shards: [],
    // The truncation report, and every field of it is always present: a
    // consumer that has to guess whether a zero means "none" or "not measured"
    // will guess wrong (PROTOCOL 10.2). `bytes` counts shards whose text hit
    // the per-shard cap, `unread` shards the ref could not hand back,
    // `too_large` shards that blew the RUNNER's own output buffer - a distinct
    // cause from `unread` with a distinct next move - and `budget` is the scan
    // clock of §2.5 running out mid-scan.
    truncated: { shards: 0, records: 0, bytes: 0, unread: 0, too_large: 0, budget: false },
    excluded: { non_member_commit: 0 },
    // A shard whose header CLAIMS a different member than the filename it was
    // enumerated under. Counted, never obeyed: the filename wins (SECURITY.md
    // 5.4, and see pass 2 below).
    declared_mismatch: 0,
    flag: null,
    authors_truncated: false,
  };
}

// Did anything at all come back short? One boolean, because `status` prints one
// word (§10.1: "status also prints ... whether the scan came back truncated").
function anyTruncation(t) {
  const x = t || {};
  return Boolean(x.shards || x.records || x.bytes || x.unread || x.too_large || x.budget);
}

// ONE clock for every git call the scan makes (§2.5's SessionStart row). The
// budget is enforced by wrapping the runner rather than by re-writing the
// callees: repo.js stays the ONE place that shells out [C lib/repo.js:55],
// with its no-shell argv, its own timeout and its bounded output.
//
// Two deadlines, not one: the scan's own (`scanBudgetMs`, the outer bound, 500
// ms on the SessionStart ref path) and an optional per-caller sub-budget (the
// author check's 2,000 ms). A call runs only if BOTH have time left, and it is
// given the smaller of what they leave and the per-call ceiling.
function scanClock(opts) {
  const o = opts || {};
  const base = typeof o.runner === 'function' ? o.runner : repo.defaultRunner;
  const perCall = intOr(o.scanCallMs, SCAN_CALL_MS);
  const budget = Number.isFinite(o.scanBudgetMs) ? Math.max(0, Number(o.scanBudgetMs)) : null;
  const deadline = budget === null ? null : Date.now() + budget;
  const clock = {
    truncated: false,
    calls: 0,
    remaining() { return deadline === null ? Infinity : deadline - Date.now(); },
    // `onSkip` reports the sub-budget's own exhaustion to its owner, so
    // `authors_truncated` keeps meaning "the AUTHOR check ran short" and the
    // scan-level flag keeps meaning "the scan ran short".
    runner(subDeadline, onSkip) {
      return (cmd, args, callOpts) => {
        const remScan = clock.remaining();
        const remSub = subDeadline === null || subDeadline === undefined ? Infinity : subDeadline - Date.now();
        if (remScan <= 0) clock.truncated = true;
        if (remSub <= 0 && typeof onSkip === 'function') onSkip();
        if (remScan <= 0 || remSub <= 0) {
          return { ok: false, code: null, stdout: '', stderr: '', error: 'scan_budget', timedOut: true };
        }
        clock.calls++;
        const co = callOpts || {};
        const rem = Math.min(remScan, remSub);
        return base(cmd, args, Object.assign({}, co, {
          timeout: Math.max(1, Math.min(Number(co.timeout) || perCall, perCall, rem)),
        }));
      };
    },
  };
  return clock;
}

// The per-shard attribution verdict, with its reach stated where it is used.
//
// checkShardAuthors raises `mismatch` only when an email is RECORDED for that
// member [C lib/workspace-files.js:458], and emails are recorded at join time
// in local state, which on any one machine means the local member's own. So a
// PEER's shard comes back `unknown` - "a note, never an alarm" - and can never
// be `non_member_commit` on the reader's machine. The exclusion below is
// therefore a backstop against a locally tampered OWN shard, not a control on
// peer content; the line for peer entries is held by the framing, the escaping
// and the caps (KNOWLEDGE.md 3.3, 4.2).
// AND THE REF PATH DOES NOT CHANGE THAT, which an earlier revision of this
// comment claimed it did. `mismatch` needs `knownEmails[member]`, and
// `recordMemberEmail` records the LOCAL member's address only (SECURITY.md
// 5.4), so a peer's shard on `handshake/state` comes back `unknown` there too -
// measured against an orphan state ref carrying a peer shard: `status=unknown,
// excluded=false`, exactly as on disk. Saying otherwise is the overclaim
// SECURITY.md 4 forbids, so it is said the other way round here.
// WHAT THE REF PATH DOES ADD is two things this module DOES use: the shard's
// owner is the ENUMERATED FILENAME rather than its self-declared header (pass 2
// below), and the committer of the last commit touching it is reported, which
// is the only locally derivable evidence that this tool wrote it at all.
function authorVerdicts(root, opts, clock, entries) {
  const o = opts || {};
  const out = { byFile: new Map(), flag: null, truncated: false, checked: 0 };
  if (o.authors === false) return out;
  const subDeadline = Date.now() + intOr(o.authorBudgetMs, AUTHOR_BUDGET_MS);
  const bounded = clock.runner(subDeadline, () => { out.truncated = true; });
  // `checked` stays what it has always been: the number of author calls that
  // actually ran, not the number the scan made for every purpose.
  const runner = (cmd, args, callOpts) => {
    const before = clock.calls;
    const r = bounded(cmd, args, callOpts);
    if (clock.calls > before) out.checked++;
    return r;
  };
  try {
    const check = wsFiles.checkShardAuthors(root, {
      knownEmails: o.knownEmails || {},
      ref: o.ref || null,
      // The scan has already read and parsed these shards; on the ref path a
      // second read is a second subprocess, and the budget is 500 ms.
      entries: o.ref ? (entries || []) : undefined,
      runner,
    });
    for (const r of check.results || []) out.byFile.set(r.file, r.status);
    out.flag = check.flag || null;
  } catch (_) {
    // A broken git, a missing repo, a permission error: the verdict degrades to
    // "we do not know", which excludes nothing and alarms nobody.
  }
  return out;
}

// One bounded walk over every member's shard. Never throws.
//
// opts: { kinds, since, maxShards, maxRecordsPerShard, knownEmails, now,
//         runner, authors, authorBudgetMs, ref, scanBudgetMs, scanCallMs,
//         maxShardBytes }
//
// With `ref` the walk is the same walk against a fetched ref instead of the
// working tree (§10.1's read half): `git ls-tree` enumerates, `git show` reads,
// `git log <ref>` attributes, and nothing else about it changes - same parse,
// same escape-on-read, same caps, same record shape. A ref the scan cannot read
// comes back `ref_ok: false` with a reason and NO records, so the caller falls
// back to the working-tree scan rather than caching an empty answer as if it
// were the peer's silence.
function scanShards(root, opts) {
  const o = opts || {};
  const now = Number.isInteger(o.now) ? o.now : Date.now();
  const started = Date.now();
  const kindSet = Array.isArray(o.kinds) && o.kinds.length ? new Set(o.kinds.map((k) => String(k))) : null;
  const kinds = kindSet ? Array.from(kindSet) : null;
  const ref = o.ref ? String(o.ref) : null;
  const out = emptyResult(root, now, kinds, ref);
  if (!root) { out.ref_reason = ref ? 'not_a_repo' : null; return out; }

  const maxShards = intOr(o.maxShards, MAX_SHARDS);
  const maxRecords = intOr(o.maxRecordsPerShard, MAX_RECORDS_PER_SHARD);
  const maxBytes = intOr(o.maxShardBytes, wsFiles.MAX_SHARD_BYTES);
  // The watermark of KNOWLEDGE.md 9.K1's signature. A record whose timestamp
  // did not parse is kept rather than filtered: `since` is an optimization for
  // an incremental consumer, and dropping undated records would silently make
  // it a correctness filter.
  const since = Number.isFinite(o.since) ? Number(o.since) : null;
  const clock = scanClock(o);
  const gitOpts = { runner: clock.runner(null), timeout: intOr(o.scanCallMs, SCAN_CALL_MS), maxBytes };

  // ---- pass 1: enumerate ----------------------------------------------------
  let files = [];                                  // [{ member|null, file, rel }]
  if (ref) {
    const listed = wsFiles.listShardsFromRef(root, ref, gitOpts);
    if (!listed.ok) {
      out.ref_reason = listed.reason || 'ref_unreadable';
      out.truncated.budget = clock.truncated;
      out.scan_ms = Date.now() - started;
      return out;
    }
    out.ref_ok = true;
    files = listed.files.map((f) => ({ member: f.member, file: null, rel: f.file }));
  } else {
    let disk = [];
    try { disk = wsFiles.listShards(root); } catch (_) { disk = []; }
    files = disk.map((file) => ({ member: null, file, rel: relPosix(root, file) }));
  }
  if (files.length > maxShards) {
    out.truncated.shards = files.length - maxShards;
    files = files.slice(0, maxShards);
  }

  // ---- pass 2: read and parse ----------------------------------------------
  // Reads first, verdicts second: the records are the payload and the verdict
  // degrades to `unknown` safely, so when the clock runs out it is the check
  // that goes short rather than the content (KNOWLEDGE.md 3.3).
  const read = [];
  for (const entry of files) {
    let member = entry.member;
    let declaredMember = null;
    let all = [];
    if (ref) {
      // The path is DERIVED from the member id here, exactly as on the write
      // side: readShardFromRef takes a member and never a path.
      const r = wsFiles.readShardFromRef(root, ref, member, gitOpts);
      if (!r.exists) {
        if (r.reason === 'too_large') out.truncated.too_large++;
        else out.truncated.unread++;
      }
      if (r.capped) out.truncated.bytes++;
      // THE FILENAME IS THE OWNER ON THIS PATH, and rule 2 above says why the
      // working-tree path may still prefer the header while this one may not:
      // `handshake/state` is a SHARED branch that every opted-in member pushes
      // to, so the header is peer-authored text about somebody else. The
      // enumeration already derived the trustworthy owner - `listShardsFromRef`
      // accepts a listed name only when `shardFileName(member)` reproduces it -
      // and an earlier build threw that away one line later, which let a
      // `mallory.md` declaring `"member":"alex"` inject its records into every
      // peer's context attributed to alex. The header's claim is kept as a
      // claim and counted when it disagrees.
      if (r.declared_mismatch) { out.declared_mismatch++; declaredMember = r.declared_member; }
      all = Array.isArray(r.records) ? r.records : [];
    } else {
      let text = '';
      try { text = fs.readFileSync(entry.file, 'utf8'); } catch (_) { text = ''; }
      const capped = wsFiles.capShardText(text, maxBytes);
      if (capped.capped) out.truncated.bytes++;
      let parsed = null;
      try { parsed = wsFiles.parseShard(capped.text, entry.file); } catch (_) { parsed = null; }
      // Rule 2: the member is the SHARD's, from its header or its filename - a
      // corrupt header is not a reason to drop the records
      // [C lib/workspace-files.js:393], it just falls back to the filename.
      member = (parsed && parsed.member) || path.basename(entry.file, '.md');
      all = (parsed && Array.isArray(parsed.records)) ? parsed.records : [];
    }
    read.push({ member, rel: entry.rel, all, declared_member: declaredMember });
  }

  // ---- pass 3: attribute, filter, assemble ---------------------------------
  const verdicts = authorVerdicts(root, o, clock, read.map((r) => ({ member: r.member, file: r.rel })));
  out.flag = verdicts.flag;
  out.authors_truncated = verdicts.truncated;
  out.truncated.budget = clock.truncated;

  for (const shard of read) {
    const rel = shard.rel;
    const member = shard.member;
    const all = shard.all;

    let kept = all.filter((r) => {
      if (kindSet && !kindSet.has(r.kind)) return false;
      if (since !== null && Number.isFinite(r.at) && Number(r.at) < since) return false;
      return true;
    });
    kept.sort((a, b) => sortKey(b) - sortKey(a));
    if (kept.length > maxRecords) {
      out.truncated.records += kept.length - maxRecords;
      kept = kept.slice(0, maxRecords);
    }

    const status = verdicts.byFile.get(rel) || 'unknown';
    const excluded = status === 'mismatch';
    if (excluded) {
      // SECURITY.md 5.4 / KNOWLEDGE.md 3.3: a shard whose last commit is not
      // the recorded member's is never injected. It is COUNTED, not silently
      // dropped - a `handshake learned` read verb (K3) shows these with the
      // warning attached, which is DELEGATION 6.2's "recorded but never counted
      // in the standing block".
      out.excluded.non_member_commit += kept.length;
    } else {
      for (const r of kept) {
        out.records.push({
          member,
          shard: rel,
          kind: r.kind,
          at: Number.isFinite(r.at) ? r.at : null,
          at_iso: r.at_iso,
          fields: r.fields,
          author_status: status,
          // Present only when the shard's header claimed a different owner.
          // The record is still attributed to `member` - the filename - and a
          // reader that wants to show the disagreement can.
          declared_member: shard.declared_member || null,
        });
      }
    }
    out.shards.push({
      member, file: rel, status, excluded,
      declared_member: shard.declared_member || null,
      records: all.length,
      kept: excluded ? 0 : kept.length,
    });
  }

  out.records.sort((a, b) => sortKey(b) - sortKey(a));
  out.scan_ms = Date.now() - started;
  return out;
}

// THE TWO HALVES ARE A UNION, NEVER A REPLACEMENT, and this is the function
// that says so.
//
// The ref half and the working-tree half answer DIFFERENT questions and
// neither contains the other. §4.2 item 3 makes the opt-in explicitly
// independent - "one human opting in grants the other nothing" - so a peer who
// has not opted in has no shard on `handshake/state` and their records live
// only in the working tree, arriving by the carrier §4.1's no-remote arm keeps
// alive: "the shard is written and rides the next user-requested commit". A
// peer who HAS opted in and has been away for six days is the mirror case
// (§11.2): their shard is on the ref and nowhere on disk.
//
// Replacing the worktree cache with the ref scan - which is what the first
// build did - therefore made opting in DELETE every non-opted-in peer from the
// first-prompt block. Measured before this fix: a `carol.md` on disk and not on
// the ref vanished from a machine that had just opted in, and an `ok` ls-tree
// over a ref with no `.handshake/tasks` at all would have written a
// zero-record cache over a good one.
//
// AND THE UNION IS PER RECORD, NOT PER MEMBER. Choosing one shard per member -
// which the first fix did - loses records whenever BOTH carriers hold a copy
// and they disagree, and disagreeing is the ORDINARY shape of this stage rather
// than a corner: `.handshake/tasks/*.md` is a tracked file that keeps riding
// human commits (§4.1's no-remote arm, kept alive as a live carrier), while the
// ref copy is only as fresh as the peer's last SUCCESSFUL beat - and a beat that
// deferred is a normal end of day [C hooks/session-end.js the 3,000 ms window].
// So the peer's own machine writes the closing `task.done`, the flush defers,
// the human commits and pushes their branch, and the reader who takes the ref's
// copy whole ends up OLDER than the disk it already had. Measured on the shipped
// export before this fix: worktree bob [r3, r2, r1] merged with ref bob [r1]
// returned one record and said nothing about the two it dropped.
//
// The rule: for each MEMBER present on both sides, the RECORDS are unioned and
// de-duplicated on the record's own id when it has one and on
// kind + timestamp + fields otherwise; a member on one side only keeps that
// side's. The block is therefore never shorter than either carrier alone, and
// `worktree_extra_records` counts what the working tree contributed to a shard
// the ref also carries, so the recovery has a line of its own (§4.4 rule 1)
// rather than hiding inside `worktree_only`, which still counts MEMBERS the ref
// does not carry at all.
function recordKey(r) {
  const id = r && r.fields && r.fields.id;
  if (id !== undefined && id !== null && String(id) !== '') return 'id\u0000' + String(id);
  // No id: the record's own content is the key. Both halves parse with the SAME
  // parser [C lib/workspace-files.js parseShard], so the same record text
  // produces the same field order on both sides. A key that misses duplicates
  // shows a record twice; one that collides drops a record - so the shape is
  // chosen to fail in the visible direction.
  let f = '';
  try { f = JSON.stringify(r && r.fields); } catch (_) { f = String(r && r.fields); }
  return 'w\u0000' + String(r && r.kind) + '\u0000' + String(r && r.at) + '\u0000' + f;
}

function mergeScans(worktree, refScan, maxRecords) {
  if (!worktree || !Array.isArray(worktree.shards)) return refScan;
  if (!refScan) return worktree;
  // THE PER-SHARD CAP IS THE UNION'S TOO. Each half already keeps its newest
  // `maxRecords` for a member, so an unbounded union of two halves that overlap
  // in nothing would carry twice the bound for one member - and that bound is a
  // safety property rather than tidiness: the shard corpus is attacker-writable
  // in SIZE as well as in content (KNOWLEDGE.md 11.4). What the cap drops here
  // is counted into `truncated.records` like every other drop, never silently
  // discarded (PROTOCOL 10.2).
  const cap = intOr(maxRecords, MAX_RECORDS_PER_SHARD);
  const onRef = new Set((refScan.shards || []).map((s) => String(s.member)));
  const extraShards = (worktree.shards || []).filter((s) => !onRef.has(String(s.member)));
  const extraMembers = new Set(extraShards.map((s) => String(s.member)));

  // The per-member record union, for the members BOTH halves carry.
  const wtByMember = new Map();
  for (const r of (worktree.records || [])) {
    const m = String(r.member);
    if (extraMembers.has(m) || !onRef.has(m)) continue;
    if (!wtByMember.has(m)) wtByMember.set(m, []);
    wtByMember.get(m).push(r);
  }
  const recovered = [];
  let recoveredCount = 0;
  let capped = 0;
  if (wtByMember.size) {
    const seen = new Set();
    const refKept = new Map();
    for (const r of (refScan.records || [])) {
      const m = String(r.member);
      seen.add(m + '\u0000' + recordKey(r));
      refKept.set(m, (refKept.get(m) || 0) + 1);
    }
    for (const [m, list] of wtByMember) {
      let fresh = list.filter((r) => {
        const k = m + '\u0000' + recordKey(r);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      // Newest first, so what the cap drops is the OLDEST of what this carrier
      // adds - the same rule `scanShards` applies inside each half.
      fresh.sort((a, b) => sortKey(b) - sortKey(a));
      const room = Math.max(0, cap - (refKept.get(m) || 0));
      if (fresh.length > room) { capped += fresh.length - room; fresh = fresh.slice(0, room); }
      for (const r of fresh) recovered.push(r);
      recoveredCount += fresh.length;
    }
  }
  if (!extraShards.length && !recovered.length && !capped) return refScan;

  const out = Object.assign({}, refScan);
  // A shard entry the working tree contributed records to reports the LARGER
  // of the two counts: the entry has to describe the records that are actually
  // in `out.records`, or `status`'s per-shard line contradicts the block above
  // it.
  const byMember = new Map();
  for (const r of recovered) byMember.set(String(r.member), (byMember.get(String(r.member)) || 0) + 1);
  out.shards = (refScan.shards || []).map((s) => {
    const extra = byMember.get(String(s.member)) || 0;
    if (!extra) return s;
    const wt = (worktree.shards || []).find((w) => String(w.member) === String(s.member)) || {};
    return Object.assign({}, s, {
      records: Math.max(Number(s.records) || 0, Number(wt.records) || 0),
      kept: (Number(s.kept) || 0) + extra,
      worktree_extra: extra,
      // A ref copy the author check EXCLUDED contributes no records, so records
      // present for this member came from a working-tree copy the check
      // cleared - and an entry that still said `excluded` while its records are
      // in the block would be a per-shard line contradicting the block.
      excluded: Boolean(s.excluded) && Boolean(wt.excluded),
      status: s.excluded && !wt.excluded ? (wt.status || s.status) : s.status,
    });
  }).concat(extraShards);
  out.records = (refScan.records || [])
    .concat((worktree.records || []).filter((r) => extraMembers.has(String(r.member))))
    .concat(recovered);
  out.records.sort((a, b) => sortKey(b) - sortKey(a));
  out.worktree_only = extraShards.length;
  out.worktree_extra_records = recoveredCount;
  const wt = worktree.truncated || {};
  const rt = refScan.truncated || {};
  out.truncated = {
    // `shards` is the count each half dropped past MAX_SHARDS; the union can
    // drop no more than the worse of the two, so the larger is the honest one.
    shards: Math.max(Number(wt.shards) || 0, Number(rt.shards) || 0),
    records: (Number(wt.records) || 0) + (Number(rt.records) || 0) + capped,
    bytes: (Number(wt.bytes) || 0) + (Number(rt.bytes) || 0),
    unread: Number(rt.unread) || 0,
    too_large: (Number(wt.too_large) || 0) + (Number(rt.too_large) || 0),
    budget: Boolean(wt.budget || rt.budget),
  };
  out.excluded = {
    non_member_commit: (Number((wt && worktree.excluded && worktree.excluded.non_member_commit)) || 0) +
      (Number((refScan.excluded && refScan.excluded.non_member_commit)) || 0),
  };
  out.declared_mismatch = (Number(worktree.declared_mismatch) || 0) + (Number(refScan.declared_mismatch) || 0);
  out.flag = refScan.flag || worktree.flag || null;
  out.authors_truncated = Boolean(refScan.authors_truncated || worktree.authors_truncated);
  return out;
}

function cachePath(dir) {
  return path.join(String(dir), CACHE_FILE);
}

function readCache(dir) {
  try {
    const v = stateLib.readJsonFile(cachePath(dir), null);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch (_) { return null; }
}

// Scan, then cache. `scan_session` is the SessionStart payload's sessionId and
// `scanned_at` the scan time: together they are what lets the injector tell
// "this session's scan" from "last week's cache" (KNOWLEDGE.md 3.2), which is
// the difference between a knowledge block and a week-old one.
//
// Never throws - this is called from a hook, where a thrown scan would cost the
// sync that follows it.
// A REF SCAN THAT COULD NOT READ ITS REF WRITES NOTHING and returns null: the
// working-tree cache written moments earlier is a real answer and an empty ref
// scan is not one, so clobbering the first with the second would turn "we could
// not reach the branch" into "your peer has said nothing" (§4.4 rule 3). A ref
// scan that DID read its ref is unioned with the working-tree scan through
// `opts.mergeWith` rather than replacing it, for the reason `mergeScans` gives
// at length: a shard on disk and not on the ref is a peer who has not opted in.
//
// The cache shape is unchanged for every field the injector reads - `v`,
// `scan_session`, `records` [C hooks/user-prompt-submit.js:191-215] - so
// CACHE_VERSION stays 1 and the injector needs no edit. The new fields are
// additive: `source`, `ref`, `scan_truncated`, `fetch_ms`, `fetch_reason`,
// `ref_reason`.
function scanToCache(state, root, opts) {
  const o = opts || {};
  if (!state || !state.dir || !root) return null;
  try {
    const knownEmails = o.knownEmails || wsFiles.knownMemberEmails(state);
    const raw = scanShards(root, Object.assign({}, o, { knownEmails }));
    // The caller gets the verdict even when nothing is written, so a ref that
    // could not be read reports WHY rather than as a silent null.
    if (typeof o.onScan === 'function') { try { o.onScan(raw); } catch (_) { /* a report, never a failure */ } }
    if (o.ref && !raw.ref_ok) return null;
    // `mergeWith` is the working-tree scan this call is UNIONED with, never
    // replaced by (see `mergeScans`). It is passed only on the ref pass.
    const scan = o.mergeWith ? mergeScans(o.mergeWith, raw, o.maxRecordsPerShard) : raw;
    const cache = {
      v: CACHE_VERSION,
      scan_session: o.sessionId ? String(o.sessionId) : null,
      scanned_at: scan.scanned_at,
      scan_ms: scan.scan_ms,
      kinds: scan.kinds,
      records: scan.records,
      shards: scan.shards,
      truncated: scan.truncated,
      // §10.1: "`status` also prints the last SessionStart fetch duration and
      // whether the scan came back `truncated`" - one boolean, so `status` does
      // not have to reduce a counter bag to a word of its own.
      scan_truncated: anyTruncation(scan.truncated),
      excluded: scan.excluded,
      declared_mismatch: scan.declared_mismatch || 0,
      flag: scan.flag,
      authors_truncated: scan.authors_truncated,
      source: scan.source,
      worktree_only: scan.worktree_only || 0,
      worktree_extra_records: scan.worktree_extra_records || 0,
      ref: scan.ref,
      ref_reason: scan.ref_reason,
      fetch_ms: Number.isFinite(o.fetchMs) ? Number(o.fetchMs) : null,
      fetch_reason: o.fetchReason === undefined ? null : (o.fetchReason || null),
    };
    // The 0600 atomic write every other cache in the state dir already uses
    // [C lib/state.js:103-116]. `root` is deliberately not carried into the
    // cache: the injector reads records, not paths to open.
    stateLib.writeJsonFile(cachePath(state.dir), cache);
    return cache;
  } catch (_) {
    return null;
  }
}

// Record WHY the ref half did not answer, on the cache the working-tree half
// already wrote. §4.4 rule 3: a capability that is off says so with its cause,
// and "the fetch timed out" and "there is no state branch" are different
// causes with different next moves. It merges rather than rewrites, so the
// records and the session id the injector keys on are untouched, and it does
// nothing at all when there is no cache to annotate.
function noteFetch(state, note) {
  if (!state || !state.dir) return null;
  try {
    const cache = readCache(state.dir);
    if (!cache) return null;
    const n = note || {};
    const merged = Object.assign({}, cache, {
      fetch_ms: Number.isFinite(n.fetchMs) ? Number(n.fetchMs) : (cache.fetch_ms === undefined ? null : cache.fetch_ms),
      fetch_reason: n.fetchReason === undefined ? (cache.fetch_reason || null) : (n.fetchReason || null),
      ref_reason: n.refReason === undefined ? (cache.ref_reason || null) : (n.refReason || null),
    });
    stateLib.writeJsonFile(cachePath(state.dir), merged);
    return merged;
  } catch (_) { return null; }
}

// The fetch primitive is §10.1's WRITE half - lib/state-branch.js - and this
// module must load, scan and cache without it, so it is required lazily, inside
// a try, and its absence is a reason string rather than an error. The
// integrator wires the real one; a test injects its own with `opts.fetch`.
function resolveFetch(o) {
  // The gate is checked FIRST and beats an injected fetcher: "opted out" has to
  // mean no network call by any route, including a test's own.
  //
  // AND IT IS FAIL-CLOSED ON AN OMITTED OPTION, which it was not. `enabled ===
  // false` meant a caller who forgot the flag entirely fetched - and an omitted
  // option is the commonest way a route goes wrong, not an exotic one. The test
  // is now `!== true`: a caller that wants the network says so.
  if (o.fetch === false || o.enabled !== true) return null;
  if (typeof o.fetch === 'function') return o.fetch;
  const sb = stateBranchModule();
  // ONE name, wired directly. The write half exports `fetchState(root, opts)`
  // and reads `opts.timeout`; an earlier revision accepted a second spelling
  // and three spellings of the bound, which is a defensive lookup for a name
  // that was never true - and a lookup nobody can delete later, because
  // nothing tells you which arm production takes.
  if (sb && typeof sb.fetchState === 'function') return sb.fetchState;
  return null;
}

function stateBranchModule() {
  try {
    return require('./state-branch');
  } catch (_) { return null; }   // not installed: the ref scan still reads the last fetch
}

// The ref both halves must agree on. It is defined here so this module runs
// alone, and taken from the write half when that is installed, so the two
// definitions cannot drift into two branches.
function resolveStateRef(o) {
  if (o.ref === null) return null;
  if (o.ref) return String(o.ref);
  const sb = stateBranchModule();
  if (sb && typeof sb.REMOTE_STATE_REF === 'string' && sb.REMOTE_STATE_REF) return sb.REMOTE_STATE_REF;
  return STATE_REF;
}

// THE SESSIONSTART READ HALF, in the order §10.1 and KNOWLEDGE.md 3.2 require
// between them, which is the whole of the design here:
//
//   1. the WORKING-TREE scan, first and unconditionally, cached before any
//      network call is attempted. The injector waits at most 500 ms
//      [C hooks/common.js:58] and a fetch does not fit inside that window, so
//      the cache the first prompt reads must already exist when the fetch
//      starts. This is the fallback AND the floor.
//   2. the fetch, bounded at 1,500 ms and ABANDONED rather than waited on
//      (§2.5). It is gated: no opt-in, or no state-branch module, means no
//      network call this hook did not already make. WHAT it fetches is the
//      helper's business, not this module's - §10.1 rule 1 puts two refspecs on
//      that one round trip, the state ref and the default branch's tip - and
//      this module only bounds it and records what came back.
//   3. the REF scan, bounded at 500 ms for the whole scan, UNIONED with the
//      cache from step 1 when the ref answers - never replacing it, because
//      opting in is independent per human (§4.2 item 3) and a peer who has not
//      opted in exists only on disk (`mergeScans`). It runs whenever the ref
//      RESOLVES LOCALLY - a fetch that failed inside its bound still leaves the
//      last fetched ref, which is the "stale, and says so" arm of §11.2 rather
//      than nothing.
//
// Never throws. Returns the verdict for the caller's log line (§4.4 rule 1).
async function sessionStartScan(state, root, opts) {
  const o = opts || {};
  const out = {
    source: 'worktree', fetch_ms: null, fetch_reason: null, ref_reason: null, cache: null,
    worktree_only: 0, worktree_extra_records: 0,
  };
  if (!state || !state.dir || !root) return out;

  // The working-tree scan is kept whole, not just its cache: the ref pass below
  // is UNIONED with it (`mergeScans`), so the object has to survive the call.
  let worktreeScan = null;
  out.cache = scanToCache(state, root, Object.assign({}, o, {
    ref: null,
    onScan: (s) => { worktreeScan = s; },
  }));

  const fetchBudget = intOr(o.fetchBudgetMs, FETCH_BUDGET_MS);
  const scanBudget = intOr(o.refScanBudgetMs, REF_SCAN_BUDGET_MS);
  // One deadline for both, threaded rather than invented (§2.5): whatever the
  // fetch overspends comes out of the scan's slice, never out of the sync's.
  const deadline = Number.isFinite(o.deadline) ? Number(o.deadline) : Date.now() + fetchBudget + scanBudget;

  const fetcher = resolveFetch(o);
  if (!fetcher) {
    out.fetch_reason = o.enabled === false ? 'not_enabled' : 'no_fetcher';
  } else {
    const started = Date.now();
    const bound = Math.max(1, Math.min(fetchBudget, deadline - scanBudget - started));
    try {
      // One spelling of the bound: `timeout`, which is what
      // lib/state-branch.js's `fetchState` reads [C lib/state-branch.js
      // fetchState]. A test injects its own fetcher and is held to the same
      // contract, so the argv this hook emits is the argv the test asserts.
      const r = fetcher(root, { timeout: bound, runner: o.runner });
      const res = r && typeof r.then === 'function' ? await raceBound(r, bound) : r;
      out.fetch_ms = Date.now() - started;
      if (res && res.ok) out.fetch_reason = null;
      else out.fetch_reason = (res && res.reason) || (out.fetch_ms >= bound ? 'timeout' : 'fetch_failed');
    } catch (_) {
      out.fetch_ms = Date.now() - started;
      out.fetch_reason = 'fetch_failed';
    }
  }

  const ref = resolveStateRef(o);
  if (ref) {
    const left = deadline - Date.now();
    if (left <= 0) {
      out.ref_reason = 'no_time_in_the_hook';
    } else {
      let why = null;
      const refCache = scanToCache(state, root, Object.assign({}, o, {
        ref,
        scanBudgetMs: Math.min(scanBudget, left),
        fetchMs: out.fetch_ms,
        fetchReason: out.fetch_reason,
        // The union, not the replacement. A member on disk and not on the ref
        // survives; a member on the ref wins for their own shard.
        mergeWith: worktreeScan,
        onScan: (s) => { why = s.ref_reason || null; },
      }));
      if (refCache) {
        out.cache = refCache;
        out.source = 'ref';
        out.worktree_only = refCache.worktree_only || 0;
        out.worktree_extra_records = refCache.worktree_extra_records || 0;
        out.ref_reason = refCache.ref_reason || null;
        return out;
      }
      out.ref_reason = why || 'ref_unreadable';
    }
  } else {
    out.ref_reason = 'no_ref';
  }
  // The worktree cache stands, and it says why the ref half did not answer.
  noteFetch(state, { fetchMs: out.fetch_ms, fetchReason: out.fetch_reason, refReason: out.ref_reason });
  if (out.cache) {
    out.cache.fetch_ms = out.fetch_ms;
    out.cache.fetch_reason = out.fetch_reason;
    out.cache.ref_reason = out.ref_reason;
  }
  return out;
}

// "Abandoned, not waited on": a fetch helper that returns a promise gets the
// same bound a spawnSync one gets from its own timeout. The timer is unref'd so
// an abandoned fetch never holds the hook open past its work.
function raceBound(promise, ms) {
  return new Promise((resolve) => {
    let settled = false;
    const t = setTimeout(() => { if (!settled) { settled = true; resolve({ ok: false, reason: 'timeout' }); } }, Math.max(1, ms));
    if (t.unref) t.unref();
    Promise.resolve(promise).then(
      (v) => { if (!settled) { settled = true; clearTimeout(t); resolve(v); } },
      () => { if (!settled) { settled = true; clearTimeout(t); resolve({ ok: false, reason: 'fetch_failed' }); } },
    );
  });
}

module.exports = {
  MAX_SHARDS, MAX_RECORDS_PER_SHARD, AUTHOR_BUDGET_MS,
  SCAN_CALL_MS, FETCH_BUDGET_MS, REF_SCAN_BUDGET_MS, STATE_REF,
  CACHE_FILE, CACHE_VERSION, SESSION_START_KINDS,
  scanShards, scanToCache, sessionStartScan, noteFetch, cachePath, readCache,
  mergeScans,
};
