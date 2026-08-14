import { DurableObject } from 'cloudflare:workers';

// Per-IP rate limiting for the routes that have no workspace to hold state:
// the public landing/health pages and workspace creation. Requests inside a
// workspace are limited by that workspace's own Durable Object, which is
// already on the request path and so costs no extra hop.
//
// One instance per IP (idFromName), so a busy IP never contends with others.
export class RateLimiterDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS buckets (k TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL)'
    );
  }

  #read(key, windowMs, now) {
    const row = this.sql.exec('SELECT count, window_start FROM buckets WHERE k = ?', key).toArray()[0];
    if (!row || now - row.window_start >= windowMs) return { count: 0, window_start: now, fresh: true };
    return { count: row.count, window_start: row.window_start, fresh: false };
  }

  #write(key, count, windowStart) {
    this.sql.exec(
      'INSERT INTO buckets (k, count, window_start) VALUES (?, ?, ?) ' +
        'ON CONFLICT(k) DO UPDATE SET count = excluded.count, window_start = excluded.window_start',
      key,
      count,
      windowStart
    );
  }

  // entries: [{key, limit, window (seconds), count: boolean}]
  // Every bucket is evaluated in one round trip. `count: false` checks a
  // counter (e.g. the auth-failure bucket) without adding to it.
  guard(entries) {
    const now = Date.now();
    let retryAfter = 0;
    let rolled = false;
    for (const entry of entries) {
      const windowMs = entry.window * 1000;
      const state = this.#read(entry.key, windowMs, now);
      if (state.fresh) rolled = true;
      const next = entry.count ? state.count + 1 : state.count;
      if (entry.count) this.#write(entry.key, next, state.window_start);
      if (next > entry.limit) {
        retryAfter = Math.max(retryAfter, Math.ceil((state.window_start + windowMs - now) / 1000) || 1);
      }
    }
    // Only when a window rolled over, so the common path is a read and a
    // single upsert rather than a delete on every request.
    if (rolled) this.#sweep(now);
    return retryAfter ? { allowed: false, retry_after: retryAfter } : { allowed: true, retry_after: 0 };
  }

  penalize(key, windowSeconds) {
    const now = Date.now();
    const state = this.#read(key, windowSeconds * 1000, now);
    this.#write(key, state.count + 1, state.window_start);
    return { count: state.count + 1 };
  }

  // Buckets are per-IP and tiny, but an object that is never swept keeps rows
  // for windows that closed days ago.
  #sweep(now) {
    this.sql.exec('DELETE FROM buckets WHERE window_start < ?', now - 24 * 60 * 60 * 1000);
  }
}
