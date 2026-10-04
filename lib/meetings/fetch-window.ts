import { meetingFetchedWindowAt, meetingHeldWindowAt } from "./constants.ts";

/**
 * The adapters whose reads fetch the whole held window, 120 days each way (DB-03 to DB-05). A prior row between 90 and
 * 120 days out that such a read's answer leaves out was asked about, so it is a disappearance like any other; for an
 * adapter outside this set it was never asked about and is carried as `OUTSIDE_FETCH_WINDOW`.
 *
 * `onbase`, `civicplus` and `revize` are deliberately absent: they read whatever their feed lists
 * (`publishedLookbackDays: null`), so a row a feed has stopped listing is the feed's own horizon, not a disappearance.
 */
export const HELD_WINDOW_FETCH_SOURCES: ReadonlySet<string> = new Set([
  "legistar",
  "legistar-insite",
  "ical",
  "diligent",
  "boardbook",
  "civicclerk",
  "iqm2",
  "clerksboards",
  "schedulepage",
  "pima-edu",
  "official-page-events",
  "document-listing",
  "suiteone",
  "apptegy",
]);

/** The dates a read of `sourceName` fetched, around `anchor`. Null for an unparseable anchor. */
export function meetingFetchedWindowFor(
  sourceName: string,
  anchor: string,
): { readonly lowerBound: string; readonly upperBound: string } | null {
  if (!HELD_WINDOW_FETCH_SOURCES.has(sourceName)) return meetingFetchedWindowAt(anchor);
  const held = meetingHeldWindowAt(anchor);
  return held === null ? null : { lowerBound: held.lowerBound, upperBound: held.upperBound };
}
