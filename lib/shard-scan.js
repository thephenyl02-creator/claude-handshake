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
//   4. This module NEVER writes to a shard and NEVER touches the network. It is
//      a reader, and it runs on a hook path, so it also never throws: every
//      entry point returns a well-formed empty result instead
//      (the failure posture of hooks/common.js).

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

function emptyResult(root, now, kinds) {
  return {
    root: root || null,
    scanned_at: now,
    scan_ms: 0,
    kinds: kinds || null,
    records: [],
    shards: [],
    truncated: { shards: 0, records: 0 },
    excluded: { non_member_commit: 0 },
    flag: null,
    authors_truncated: false,
  };
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
function authorVerdicts(root, opts) {
  const o = opts || {};
  const out = { byFile: new Map(), flag: null, truncated: false, checked: 0 };
  if (o.authors === false) return out;
  const base = typeof o.runner === 'function' ? o.runner : repo.defaultRunner;
  const deadline = Date.now() + intOr(o.authorBudgetMs, AUTHOR_BUDGET_MS);
  // The budget is enforced by wrapping the runner rather than by re-writing the
  // check: repo.js stays the ONE place that shells out [C lib/repo.js:55], with
  // its no-shell argv, its own timeout and its bounded output.
  const runner = (cmd, args, callOpts) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      out.truncated = true;
      return { ok: false, code: null, stdout: '', stderr: '', error: 'scan_author_budget', timedOut: true };
    }
    out.checked++;
    const co = callOpts || {};
    return base(cmd, args, Object.assign({}, co, {
      timeout: Math.max(1, Math.min(Number(co.timeout) || AUTHOR_CALL_MS, AUTHOR_CALL_MS, remaining)),
    }));
  };
  try {
    const check = wsFiles.checkShardAuthors(root, {
      knownEmails: o.knownEmails || {},
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
//         runner, authors, authorBudgetMs }
function scanShards(root, opts) {
  const o = opts || {};
  const now = Number.isInteger(o.now) ? o.now : Date.now();
  const started = Date.now();
  const kindSet = Array.isArray(o.kinds) && o.kinds.length ? new Set(o.kinds.map((k) => String(k))) : null;
  const kinds = kindSet ? Array.from(kindSet) : null;
  const out = emptyResult(root, now, kinds);
  if (!root) return out;

  const maxShards = intOr(o.maxShards, MAX_SHARDS);
  const maxRecords = intOr(o.maxRecordsPerShard, MAX_RECORDS_PER_SHARD);
  // The watermark of KNOWLEDGE.md 9.K1's signature. A record whose timestamp
  // did not parse is kept rather than filtered: `since` is an optimization for
  // an incremental consumer, and dropping undated records would silently make
  // it a correctness filter.
  const since = Number.isFinite(o.since) ? Number(o.since) : null;

  let files = [];
  try { files = wsFiles.listShards(root); } catch (_) { files = []; }
  if (files.length > maxShards) {
    out.truncated.shards = files.length - maxShards;
    files = files.slice(0, maxShards);
  }

  const verdicts = authorVerdicts(root, o);
  out.flag = verdicts.flag;
  out.authors_truncated = verdicts.truncated;

  for (const file of files) {
    const rel = relPosix(root, file);
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch (_) { text = ''; }
    let parsed = null;
    try { parsed = wsFiles.parseShard(text, file); } catch (_) { parsed = null; }
    // Rule 2: the member is the SHARD's, from its header or its filename - a
    // corrupt header is not a reason to drop the records
    // [C lib/workspace-files.js:393], it just falls back to the filename.
    const member = (parsed && parsed.member) || path.basename(file, '.md');
    const all = (parsed && Array.isArray(parsed.records)) ? parsed.records : [];

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
        });
      }
    }
    out.shards.push({
      member, file: rel, status, excluded,
      records: all.length,
      kept: excluded ? 0 : kept.length,
    });
  }

  out.records.sort((a, b) => sortKey(b) - sortKey(a));
  out.scan_ms = Date.now() - started;
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
function scanToCache(state, root, opts) {
  const o = opts || {};
  if (!state || !state.dir || !root) return null;
  try {
    const knownEmails = o.knownEmails || wsFiles.knownMemberEmails(state);
    const scan = scanShards(root, Object.assign({}, o, { knownEmails }));
    const cache = {
      v: CACHE_VERSION,
      scan_session: o.sessionId ? String(o.sessionId) : null,
      scanned_at: scan.scanned_at,
      scan_ms: scan.scan_ms,
      kinds: scan.kinds,
      records: scan.records,
      shards: scan.shards,
      truncated: scan.truncated,
      excluded: scan.excluded,
      flag: scan.flag,
      authors_truncated: scan.authors_truncated,
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

module.exports = {
  MAX_SHARDS, MAX_RECORDS_PER_SHARD, AUTHOR_BUDGET_MS,
  CACHE_FILE, CACHE_VERSION, SESSION_START_KINDS,
  scanShards, scanToCache, cachePath, readCache,
};
