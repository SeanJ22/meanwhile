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

/** How far ahead "upcoming" reaches. */
export const UPCOMING_HORIZON_DAYS = 60;

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
 * Which rung of the cascade produced the result.
 *
 * `exact`     — upcoming meetings inside the radius we first asked for.
 * `widened`   — nothing nearby, so the search stepped out. Say so.
 * `concluded` — no upcoming meetings at any radius; showing what was recently
 *               decided instead, styled distinctly.
 * `none`      — nothing either way. The last honest fallback.
 */
export type CoverageTier = "exact" | "widened" | "concluded" | "none";
