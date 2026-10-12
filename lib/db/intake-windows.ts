import { intakeLimits } from "../signal/intake-limits.ts";
import { SlidingWindowLimiter } from "../signal/rate-limit.ts";

/**
 * Instance-local intake rate-limit windows, cached per space so each surface
 * keeps its own budget. A cheap first line only; lib/db/intake-limiter.ts holds
 * the authoritative cross-instance counters. Lives in lib/db, not lib/signal,
 * because nothing in lib/signal may reach the feedback store.
 */

export type IntakeSpace = "reactions" | "feedback" | "speak" | "demand-signal";

interface Windows {
  perKey: SlidingWindowLimiter;
  perIp: SlidingWindowLimiter;
}

const cache = new Map<IntakeSpace, Windows>();

export function intakeWindows(space: IntakeSpace): Windows {
  const held = cache.get(space);
  if (held) return held;

  const limits = intakeLimits();
  // `speak` and `demand-signal` share the reactions budget. demand-signal's
  // perKey window is never used (it has no continuity key) but keeps the shape.
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
