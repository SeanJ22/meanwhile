/**
 * A sliding-window rate limiter for the reaction write path — demo-grade by
 * decision (docs/state.md §13): the site sits behind the platform password
 * with a handful of testers, so this defends against accidents and casual
 * scripts, not a funded adversary. The full T03 hardening pass is a recorded
 * precondition of removing the password (tracker T08).
 *
 * Instance-local state: each serverless instance keeps its own windows, so
 * the effective global limit is (limit × instances). Acceptable at this
 * scale; the launch-grade version moves the counter to shared storage.
 *
 * Keys are never stored anywhere — an IP passed here lives only in this
 * process's memory for the window's duration and is used for limiting only.
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
