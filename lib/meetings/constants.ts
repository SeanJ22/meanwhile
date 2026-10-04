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

/** Rolling upcoming window required by rulings §4. */
export const UPCOMING_HORIZON_DAYS = 90;

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
 * How far the HELD window reaches each way (DB-01). Meetings are held 120
 * days back and 120 ahead and shown 90 each way (`UPCOMING_HORIZON_DAYS`,
 * `CONCLUDED_LOOKBACK_DAYS`): a promoted partition keeps what the reader may
 * later need, and the reader's edge applies the shown window once.
 */
export const MEETING_HELD_LOOKBACK_DAYS = 120;
export const MEETING_HELD_HORIZON_DAYS = 120;

/**
 * Versioned authority for the only incomplete-horizon meeting removal rule.
 * Evidence must name one of these exact contracts and its bounds must be
 * recomputed from the candidate retrieval instant; caller-supplied dates are
 * never an independent removal authority.
 *
 * `V2` is the held window. `V1` was the shown (90/90) window; the validator
 * accepts a `V1` row for one pass after the change so each partition's first
 * candidate is not refused (`meetingLegacyServingWindowAt`).
 */
export const MEETING_READER_SERVING_WINDOW_CONTRACT =
  "MEETING_READER_SERVING_WINDOW_V2" as const;
export const MEETING_READER_SERVING_WINDOW_CONTRACT_V1 =
  "MEETING_READER_SERVING_WINDOW_V1" as const;

export interface MeetingReaderServingWindow {
  readonly contract: typeof MEETING_READER_SERVING_WINDOW_CONTRACT;
  readonly lowerBound: string;
  readonly upperBound: string;
}

export interface MeetingLegacyServingWindow {
  readonly contract: typeof MEETING_READER_SERVING_WINDOW_CONTRACT_V1;
  readonly lowerBound: string;
  readonly upperBound: string;
}

/** The held window around `anchor`: 120 days back, 120 ahead. Null for an unparseable anchor. */
export function meetingHeldWindowAt(anchor: string): MeetingReaderServingWindow | null {
  const instant = Date.parse(anchor);
  if (!Number.isFinite(instant)) return null;
  return {
    contract: MEETING_READER_SERVING_WINDOW_CONTRACT,
    lowerBound: new Date(instant - MEETING_HELD_LOOKBACK_DAYS * 86_400_000).toISOString(),
    upperBound: new Date(instant + MEETING_HELD_HORIZON_DAYS * 86_400_000).toISOString(),
  };
}

/** The registered window a removal may name today: the held window. */
export const meetingReaderServingWindowAt = meetingHeldWindowAt;

/** The old shown (90/90) window, accepted on a `V1` removal row for one pass. */
export function meetingLegacyServingWindowAt(anchor: string): MeetingLegacyServingWindow | null {
  const instant = Date.parse(anchor);
  if (!Number.isFinite(instant)) return null;
  return {
    contract: MEETING_READER_SERVING_WINDOW_CONTRACT_V1,
    lowerBound: new Date(instant - CONCLUDED_LOOKBACK_DAYS * 86_400_000).toISOString(),
    upperBound: new Date(instant + UPCOMING_HORIZON_DAYS * 86_400_000).toISOString(),
  };
}

/**
 * The window a read actually fetched. Adapters still fetch 90 days each way
 * until DB-03 to DB-05 widen them, so a prior row between 90 and 120 days out
 * was never asked about by this read.
 */
export function meetingFetchedWindowAt(anchor: string): { readonly lowerBound: string; readonly upperBound: string } | null {
  const legacy = meetingLegacyServingWindowAt(anchor);
  return legacy === null ? null : { lowerBound: legacy.lowerBound, upperBound: legacy.upperBound };
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
