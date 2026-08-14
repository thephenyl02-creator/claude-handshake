// Sync selection: per-sender-fair round robin with reserved slots.
//
// PLAN section 2: fetch cap (20) is separate from the client's inject cap (5).
// One chatty peer must not be able to bury another peer's messages, and
// `warn.*` / `note.blocker` must reach the reader even when the queue is full
// of routine traffic — hence a reserved floor filled before the fair pass.

import { isPriorityType } from './envelope.js';

// One pass of round-robin over senders. Sender order is by each sender's
// oldest pending message, so the result is deterministic and does not depend
// on Map insertion order or on who happened to post first this second.
function roundRobin(items, budget, taken) {
  const groups = new Map();
  for (const item of items) {
    if (taken.has(item.seq)) continue;
    let group = groups.get(item.sender);
    if (!group) groups.set(item.sender, (group = []));
    group.push(item);
  }
  const order = [...groups.values()].sort((a, b) => a[0].seq - b[0].seq);
  const out = [];
  for (let round = 0; out.length < budget; round++) {
    let progressed = false;
    for (const group of order) {
      if (out.length >= budget) break;
      if (group.length > round) {
        out.push(group[round]);
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return out;
}

// candidates: [{seq, sender, type}] sorted by seq ascending.
export function selectFair(candidates, cap, reserved) {
  const taken = new Set();
  const chosen = [];
  const priority = candidates.filter((c) => isPriorityType(c.type));
  const floor = Math.min(reserved, cap);
  for (const item of roundRobin(priority, floor, taken)) {
    taken.add(item.seq);
    chosen.push(item);
  }
  for (const item of roundRobin(candidates, cap - chosen.length, taken)) {
    taken.add(item.seq);
    chosen.push(item);
  }
  chosen.sort((a, b) => a.seq - b.seq);
  return chosen;
}
