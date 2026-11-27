/** Fixed-window in-memory rate limiter (single process). Replace with a shared store for multi-instance deployments. */
export class RateLimiter {
  private hits = new Map<string, { count: number; reset: number }>();
  private disabled: boolean;
  private clock: () => number;
  constructor(clock: () => number = Date.now, disabled = false) { this.clock = clock; this.disabled = disabled; }
  hit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
    if (this.disabled) return { ok: true, retryAfterSec: 0 };
    const now = this.clock();
    if (this.hits.size > 20000) for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
    const cur = this.hits.get(key);
    if (!cur || cur.reset <= now) { this.hits.set(key, { count: 1, reset: now + windowMs }); return { ok: true, retryAfterSec: 0 }; }
    cur.count++;
    return cur.count > limit ? { ok: false, retryAfterSec: Math.ceil((cur.reset - now) / 1000) } : { ok: true, retryAfterSec: 0 };
  }
}
