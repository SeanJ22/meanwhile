/**
 * A sliding-window rate limiter for the reaction write path. It defends against accidents and casual
 * scripts, not a funded adversary.
 *
 * Instance-local state: each serverless instance keeps its own windows, so the effective global limit is
 * (limit × instances).
 *
 * Keys are never stored: an IP passed here lives only in this process's memory for the window's
 * duration and is used for limiting only.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** True if this event is allowed; false means reject (429). */
  allow(key: string, now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    // Unbounded growth guard: drop other keys' expired windows opportunistically.
    if (this.hits.size > 10_000) {
      for (const [k, times] of this.hits) {
        if (times.every((t) => t <= cutoff)) this.hits.delete(k);
      }
    }
    return true;
  }
}
