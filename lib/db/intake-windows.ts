import { intakeLimits } from "../signal/intake-limits.ts";
import { SlidingWindowLimiter } from "../signal/rate-limit.ts";

/**
 * **THE INSTANCE-LOCAL INTAKE WINDOWS, in one place.** (RULING 103, applied to
 * a duplicate this session created — 2026-08-24.)
 *
 * `app/api/reactions/route.ts` and `app/api/feedback/route.ts` each held a
 * module-level `limiters` cell and a lazy `getLimiters()` to fill it. Adding
 * `app/api/speak/route.ts` for BC-11 made a third, and `pnpm dupes` reported it
 * as an EXACT match against the reactions one and a SHAPE match against all
 * three — which is the sweep doing precisely what RULING 103 built it for, on
 * code written the same day.
 *
 * The named-instance rule says the response is the shared code path rather than
 * a baseline entry, and it applies to a defect a session commits as much as to
 * one it inherits.
 *
 * ## Why the cache is per-SPACE and not one shared pair
 *
 * The three surfaces have different budgets — reactions and feedback carry
 * their own per-minute and per-IP numbers — so a single shared pair of windows
 * would silently apply one surface's limit to another. The cache is keyed, and
 * the caller names its space, so consolidating the CODE cannot consolidate the
 * LIMITS.
 *
 * ## IT LIVES IN lib/db, NOT lib/signal, AND THAT IS ON THE MERITS
 *
 * lib/signal is the LICENSED path — the aggregation and export machinery —
 * and tests/feedback.test.ts guards it: nothing there may name or reach the
 * feedback store, because the promise is that reader feedback never enters
 * anything aggregated or licensed. This module names three intake SPACES, one
 * of which is the feedback form, and it tripped that guard the moment it was
 * written.
 *
 * The guard was right and the file was in the wrong place. A rate-limit window
 * is INTAKE machinery, not signal: it decides whether a write is accepted and
 * has nothing to do with what is aggregated or sold. Its authoritative sibling
 * — lib/db/intake-limiter.ts, which holds the cross-instance counters — has
 * always lived here. So it moved rather than the guard being widened.
 *
 * ## And these are the cheap first line, not the authority
 *
 * They are instance-local and free: they catch a single-instance burst
 * immediately and know nothing about any other instance. The authoritative
 * cross-instance counters are `lib/db/intake-limiter.ts`, and a stale window
 * here only affects the pre-check.
 */

export type IntakeSpace = "reactions" | "feedback" | "speak" | "demand-signal";

interface Windows {
  perKey: SlidingWindowLimiter;
  perIp: SlidingWindowLimiter;
}

/** Per-space, so consolidating the code cannot consolidate the budgets. */
const cache = new Map<IntakeSpace, Windows>();

export function intakeWindows(space: IntakeSpace): Windows {
  const held = cache.get(space);
  if (held) return held;

  const limits = intakeLimits();
  /*
   * `speak` takes the REACTIONS budget deliberately, and it is a decision
   * rather than a default: Speak Your Mind is a reader writing a considered
   * sentence about a named body, which is the same act at the same rate as a
   * reaction with a verbatim, on the same surfaces. Giving it its own env vars
   * would be two numbers nobody tunes and one of them quietly wrong.
   */
  /*
   * `demand-signal` takes the REACTIONS budget, deliberately and for the same
   * reason `speak` does: it is a reader tapping a pill on a reader surface, at
   * the same rate and on the same pages. Its own env vars would be two numbers
   * nobody tunes and one of them quietly wrong. (OWN-Q6, 2026-08-31.)
   *
   * Its `perKey` window is CONSTRUCTED and never used — the route has no
   * continuity key to bucket by, because the owner's instruction on that
   * feature was no identity. Constructed anyway so the cache holds one shape
   * per space and a later caller with a key gets a real limiter rather than a
   * surprise.
   */
  const perMinute =
    space === "feedback" ? limits.feedbackPerMinuteHard : limits.reactionsPerMinuteHard;
  const perIp =
    space === "feedback" ? limits.feedbackPerIpPerMinute : limits.reactionsPerIpPerMinute;

  const windows: Windows = {
    perKey: new SlidingWindowLimiter(perMinute, 60_000),
    perIp: new SlidingWindowLimiter(perIp, 60_000),
  };
  cache.set(space, windows);
  return windows;
}
