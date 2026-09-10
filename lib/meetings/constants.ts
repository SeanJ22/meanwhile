/**
 * The cascade's shared constants and result vocabulary — client-safe.
 *
 * Split out of query.ts because client code (the reducer, the radius
 * control) imports these *values*, and query.ts imports the meeting-source
 * registry, whose graph reaches node:fs through the snapshot source. In a
 * production build tree-shaking hides that; the dev server does not shake
 * and Turbopack refuses node:fs in a browser chunk — so the boundary has to
 * be structural, not an artifact of optimization.
 */

/** Miles: 15, 40, 95. Roughly a city, a metro, a region. */
export const RADIUS_LADDER_KM = [25, 60, 150] as const;

/**
 * How far ahead "upcoming" reaches.
 *
 * **Raised from 60 to 120 on 2026-08-28, and the reason is a measurement.**
 * Pima County publishes fourteen future Board of Supervisors sittings, out to
 * 2026-12-15, on three independent first-party routes that agree on body, date
 * and wall clock — the vendor's calendar grid, its RSS export, and the Clerk of
 * the Board's own schedule table. At 60 days the product collected all
 * fourteen and served SIX. The other eight were trimmed by this number and by
 * nothing else.
 *
 * That is our limit rather than a fact about the county, and a reader looking
 * for the December meeting could not tell the difference. This value is both
 * the reader's serving horizon (`query.ts`) and each adapter's fetch window, so
 * it had to move on both sides at once.
 *
 * It is still a BUDGET and never a completion condition: a body publishing
 * further ahead than this is trimmed here, and that trim is ours to name.
 */
export const UPCOMING_HORIZON_DAYS = 120;

/**
 * How far back the served window reaches (3g, 2026-08-16: 30 → 90). This
 * bounds both the concluded fallback tier and the recent-past meetings that
 * ride along with upcoming results for the date slider's backward range.
 * What actually renders from the past is whatever the snapshot holds —
 * sources differ in how far back they publish, and the coverage is honest
 * about that rather than padded.
 */
export const CONCLUDED_LOOKBACK_DAYS = 90;

/**
 * Versioned authority for the only incomplete-horizon meeting removal rule.
 * Evidence must name this exact contract and its bounds must be recomputed
 * from the candidate retrieval instant; caller-supplied dates are never an
 * independent removal authority.
 */
export const MEETING_READER_SERVING_WINDOW_CONTRACT =
  "MEETING_READER_SERVING_WINDOW_V1" as const;

export interface MeetingReaderServingWindow {
  readonly contract: typeof MEETING_READER_SERVING_WINDOW_CONTRACT;
  readonly lowerBound: string;
  readonly upperBound: string;
}

export function meetingReaderServingWindowAt(anchor: string): MeetingReaderServingWindow | null {
  const instant = Date.parse(anchor);
  if (!Number.isFinite(instant)) return null;
  return {
    contract: MEETING_READER_SERVING_WINDOW_CONTRACT,
    lowerBound: new Date(instant - CONCLUDED_LOOKBACK_DAYS * 86_400_000).toISOString(),
    upperBound: new Date(instant + UPCOMING_HORIZON_DAYS * 86_400_000).toISOString(),
  };
}

/**
 * Which rung of the cascade produced the result.
 *
 * `exact`     — upcoming meetings inside the radius we first asked for.
 * `widened`   — nothing nearby, so the search stepped out. Say so.
 * `concluded` — no upcoming meetings at any radius; showing what was recently
 *               decided instead, styled distinctly.
 * `none`      — nothing either way. The last honest fallback.
 */
export type CoverageTier = "exact" | "widened" | "concluded" | "none";
