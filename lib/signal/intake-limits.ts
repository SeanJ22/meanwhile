/**
 * Intake protection policy (T08) — thresholds, the submission classifier,
 * and same-origin enforcement, shared by /api/reactions and /api/log.
 *
 * Everything here is tunable without a code change: each threshold reads
 * its environment variable at call time, and the whole family sits behind
 * `ripcord.rateLimits` (lib/ripcords.ts) so a misfiring protection can be
 * switched off with a config flip. VALIDITY checks — registry membership,
 * enums, length caps — are deliberately NOT in this family and are never
 * behind any flag: they cannot misfire on a legitimate reader, because the
 * real app only offers real targets.
 *
 * The author's standard for every number: the tester reacting as fast as
 * her thumb moves must never hit a limit; a script hits one in its first
 * second. The defaults encode that — a human burst tops out well under
 * 40 taps a minute, a script sends hundreds — and the env vars exist so
 * production traffic can retune them without a deploy cycle through git.
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
}

export function intakeLimits(): IntakeLimits {
  return {
    reactionsPerMinuteHard: envInt("WTP_LIMIT_REACTIONS_PER_MINUTE", 40),
    reactionsPerMinuteSoft: envInt("WTP_LIMIT_REACTIONS_SOFT_PER_MINUTE", 20),
    reactionsPerDay: envInt("WTP_LIMIT_REACTIONS_PER_DAY", 400),
    reactionsPerIpPerMinute: envInt("WTP_LIMIT_REACTIONS_IP_PER_MINUTE", 120),
    logEventsPerIpPerMinute: envInt("WTP_LIMIT_LOG_IP_PER_MINUTE", 240),
    logDetailValueMaxChars: envInt("WTP_LIMIT_LOG_DETAIL_MAX_CHARS", 500),
  };
}

/** What the store should do with a submission, given its device's counters. */
export type SubmissionDisposition =
  | { kind: "ALLOW" }
  | { kind: "QUARANTINE"; reason: "VELOCITY" }
  | { kind: "REFUSE_RATE" }
  | { kind: "REFUSE_DAILY" };

/**
 * Classify one submission against the authoritative per-device counters
 * (lib/db/intake-limiter.ts — counts across every serverless instance,
 * unlike the in-memory windows). Pure, so the mechanism is testable
 * without a database: counts in, disposition out.
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
