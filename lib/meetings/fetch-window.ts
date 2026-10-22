import { meetingFetchedWindowAt, meetingHeldWindowAt } from "./constants.ts";

/** Source work is already restricted to its registered bodies; distance must not exclude Alaska, Hawaii or territories. */
export const STANDING_MEETING_GEOGRAPHY = { lat: 0, lng: 0, radiusKm: 20_100 } as const;

/**
 * Adapters whose reads fetch the whole held window, so a prior row they leave out is a disappearance. Adapters that
 * read whatever their feed lists are absent: a row such a feed stops listing is the feed's horizon.
 */
export const HELD_WINDOW_FETCH_SOURCES: ReadonlySet<string> = new Set([
  "legistar",
  "legistar-insite",
  "ical",
  "diligent",
  "boardbook",
  "civicclerk",
  "iqm2",
  "schedulepage",
  "pima-edu",
  "official-page-events",
  "document-listing",
  "suiteone",
  "apptegy",
  "swagit",
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
