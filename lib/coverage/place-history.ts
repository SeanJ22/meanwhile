import type { PlaceMeasures } from "./place-measures.ts";
import { percentOf } from "./place-percent.ts";

/**
 * **A PLACE'S SCORES, KEPT AS DAILY POINTS SO TRENDS SHOW.** One point per day
 * per place holds the counts behind each figure, numerators and denominators by
 * family, never only a percentage. A fixed number of days is kept, newest last.
 * It is a record of counts and it never gates publishing.
 *
 * PURE.
 */
export const PLACE_HISTORY_DAYS = 30;

export interface Fraction { readonly n: number; readonly of: number }
export interface PlaceHistoryPoint {
  /** The calendar day (UTC) this point stands for. */
  readonly day: string;
  readonly at: string;
  readonly completeness: Fraction;
  readonly freshness: Fraction;
  readonly delivery: Fraction;
  /** Completeness counts by family. */
  readonly families: readonly ({ readonly group: string } & Fraction)[];
}

const dayOf = (at: string) => at.slice(0, 10);

export function pointOf(at: string, measures: PlaceMeasures, families: readonly { readonly group: string; readonly measures: PlaceMeasures }[]): PlaceHistoryPoint {
  const f = (m: { readonly n: number; readonly of: number }): Fraction => ({ n: m.n, of: m.of });
  return { day: dayOf(at), at, completeness: f(measures.completeness), freshness: f(measures.freshness), delivery: f(measures.delivery),
    families: families.map(family => ({ group: family.group, ...f(family.measures.completeness) })) };
}

/** Add a point: one per day (a later point on the same day replaces it), the newest PLACE_HISTORY_DAYS kept. */
export function appendPoint(history: readonly PlaceHistoryPoint[], point: PlaceHistoryPoint, keep = PLACE_HISTORY_DAYS): PlaceHistoryPoint[] {
  return [...history.filter(existing => existing.day !== point.day), point].sort((a, b) => a.day.localeCompare(b.day)).slice(-keep);
}

export interface PlaceTrend {
  readonly direction: "up" | "down" | "same";
  /** The completeness percent at the last point before today. */
  readonly previousPercent: number | null;
  readonly previousDay: string;
}

/** Compare the current completeness with the last point from an earlier day. Null with no earlier point or no figure to compare. */
export function trendOf(history: readonly PlaceHistoryPoint[], currentPercent: number | null, today: string): PlaceTrend | null {
  const earlier = [...history].filter(point => point.day < today).sort((a, b) => b.day.localeCompare(a.day))[0];
  if (!earlier) return null;
  const previousPercent = percentOf(earlier.completeness.n, earlier.completeness.of);
  if (previousPercent === null || currentPercent === null) return null;
  return { direction: currentPercent > previousPercent ? "up" : currentPercent < previousPercent ? "down" : "same", previousPercent, previousDay: earlier.day };
}

/** Whether a stored value is a well-formed history, so a damaged snapshot reads as no history. */
export function isPlaceHistory(value: unknown): value is PlaceHistoryPoint[] {
  const fraction = (v: unknown) => !!v && typeof (v as Fraction).n === "number" && typeof (v as Fraction).of === "number";
  return Array.isArray(value) && value.every(p => p && typeof p.day === "string" && typeof p.at === "string" && fraction(p.completeness) && fraction(p.freshness)
    && fraction(p.delivery) && Array.isArray(p.families));
}
