/**
 * Intake protection policy: thresholds, the submission classifier, and same-origin enforcement, shared
 * by /api/reactions and /api/log. Each threshold reads its environment variable at call time, and the
 * family sits behind `ripcord.rateLimits` (lib/ripcords.ts). Validity checks are not in this family and
 * are never behind any flag.
 *
 * The standard for every number: a person reacting as fast as they can tap never hits a limit; a script
 * hits one in its first second.
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface IntakeLimits {
  /** Hard per-device ceiling per minute — past it, refuse (429). */
  reactionsPerMinuteHard: number;
  /**
   * Soft per-device threshold per minute — past it the row still lands but
   * is quarantined (suspect VELOCITY), excluded from the clean pool. The
   * gap between soft and hard exists so an implausibly fast burst that the
   * refusal did not catch is still never sold as a clean signal.
   */
  reactionsPerMinuteSoft: number;
  /** Per-device daily ceiling — the covered universe is a few hundred targets. */
  reactionsPerDay: number;
  /** Per-IP burst ceiling for reactions — NAT households share one. */
  reactionsPerIpPerMinute: number;
  /** Per-IP ceiling for search-log events — several fire per interaction. */
  logEventsPerIpPerMinute: number;
  /** Server-enforced cap on any string in a log event's detail bag. */
  logDetailValueMaxChars: number;
  /**
   * The feedback form's own budget, counted in the limiter's separate `feedback-limiter:` digest space so
   * it neither spends nor is spent by the reaction budget. Past the soft threshold a message still lands,
   * quarantined.
   */
  feedbackPerMinuteHard: number;
  feedbackPerMinuteSoft: number;
  feedbackPerDay: number;
  feedbackPerIpPerMinute: number;
}

export function intakeLimits(): IntakeLimits {
  return {
    reactionsPerMinuteHard: envInt("WTP_LIMIT_REACTIONS_PER_MINUTE", 40),
    reactionsPerMinuteSoft: envInt("WTP_LIMIT_REACTIONS_SOFT_PER_MINUTE", 20),
    reactionsPerDay: envInt("WTP_LIMIT_REACTIONS_PER_DAY", 400),
    reactionsPerIpPerMinute: envInt("WTP_LIMIT_REACTIONS_IP_PER_MINUTE", 120),
    logEventsPerIpPerMinute: envInt("WTP_LIMIT_LOG_IP_PER_MINUTE", 240),
    logDetailValueMaxChars: envInt("WTP_LIMIT_LOG_DETAIL_MAX_CHARS", 500),
    feedbackPerMinuteHard: envInt("WTP_LIMIT_FEEDBACK_PER_MINUTE", 6),
    feedbackPerMinuteSoft: envInt("WTP_LIMIT_FEEDBACK_SOFT_PER_MINUTE", 3),
    feedbackPerDay: envInt("WTP_LIMIT_FEEDBACK_PER_DAY", 30),
    feedbackPerIpPerMinute: envInt("WTP_LIMIT_FEEDBACK_IP_PER_MINUTE", 20),
  };
}

/** What the store should do with a submission, given its device's counters. */
export type SubmissionDisposition =
  | { kind: "ALLOW" }
  | { kind: "QUARANTINE"; reason: "VELOCITY" }
  | { kind: "REFUSE_RATE" }
  | { kind: "REFUSE_DAILY" };

/**
 * Classify one submission against the authoritative per-device counters (lib/db/intake-limiter.ts,
 * counted across every serverless instance). Pure.
 */
export function classifySubmission(
  counters: { minuteCount: number; dayCount: number },
  limits: IntakeLimits = intakeLimits(),
): SubmissionDisposition {
  if (counters.dayCount > limits.reactionsPerDay) return { kind: "REFUSE_DAILY" };
  if (counters.minuteCount > limits.reactionsPerMinuteHard) {
    return { kind: "REFUSE_RATE" };
  }
  if (counters.minuteCount > limits.reactionsPerMinuteSoft) {
    return { kind: "QUARANTINE", reason: "VELOCITY" };
  }
  return { kind: "ALLOW" };
}

/**
 * The same classifier against the feedback thresholds. A separate function because the two paths take
 * their counters from different digest spaces. Pure.
 */
export function classifyFeedbackSubmission(
  counters: { minuteCount: number; dayCount: number },
  limits: IntakeLimits = intakeLimits(),
): SubmissionDisposition {
  if (counters.dayCount > limits.feedbackPerDay) return { kind: "REFUSE_DAILY" };
  if (counters.minuteCount > limits.feedbackPerMinuteHard) {
    return { kind: "REFUSE_RATE" };
  }
  if (counters.minuteCount > limits.feedbackPerMinuteSoft) {
    return { kind: "QUARANTINE", reason: "VELOCITY" };
  }
  return { kind: "ALLOW" };
}

/**
 * Same-origin enforcement: the write must come from a page this site
 * served. Browsers attach the Origin header to every POSTed fetch and
 * sendBeacon; a script that never loaded the site either omits it or names
 * a foreign origin. This raises the cost of pumping text or taps in from
 * outside — it is a browser constraint, not authentication (a script CAN
 * forge the header), which is exactly the expensive-to-fake standard T08
 * records. Compared host-to-host so it holds on localhost, deploy
 * previews, and production without a configured origin list.
 */
export function isSameOriginSubmission(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host") ||
    new URL(request.url).host;
  return originHost === host;
}
