import type { Meeting } from "@/lib/sources/types";

import { hasPhysicalLocation } from "./online.ts";
import type { MeetingListingIdentityReadback } from "./listing-identity.ts";

/**
 * A place that hosts meetings.
 *
 * Pins are venues, not meetings. A city hall chamber can host four sittings in
 * a fortnight, and four markers stacked on the same coordinate means three of
 * them are unclickable.
 */
export interface Venue {
  key: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  /** Chronological, in whatever direction the caller's list arrived. */
  meetings: Meeting[];
  listingIdentity?: MeetingListingIdentityReadback;
}

/** ~11 meters. Two rooms in one building are one pin. */
const COORD_PRECISION = 4;

export function groupByVenue(meetings: Meeting[], listingIdentity?: MeetingListingIdentityReadback): Venue[] {
  const venues = new Map<string, Venue>();

  for (const meeting of meetings) {
    /*
     * A meeting held online has no place, so it is not a venue and never a
     * pin (D18). This is the ONE gate that decides that: everything upstream
     * keeps such a meeting so the reader can see it, and giving it a
     * coordinate here — the body's home, the map centre, anything — would put
     * a marker on a building nobody is going to.
     *
     * MTG-14 (2026-08-28) routes it through the one predicate and changes
     * nothing about it. **The gate is CORRECT and stays** — a helper that made
     * it easy to give an online sitting a coordinate would be a worse module
     * than none.
     */
    if (!hasPhysicalLocation(meeting)) continue;

    const { lat, lng, name, address } = meeting.location;
    const key = `${lat.toFixed(COORD_PRECISION)},${lng.toFixed(COORD_PRECISION)}`;

    const existing = venues.get(key);
    if (existing) {
      existing.meetings.push(meeting);
      continue;
    }

    venues.set(key, { key, name, address, lat, lng, meetings: [meeting], listingIdentity });
  }

  return [...venues.values()];
}

/**
 * **THE SITTINGS OF THIS BUILDING'S BODIES THAT HAVE NO BUILDING.**
 * (2026-09-23, the owner's Tucson Unified report.)
 *
 * The gate above is right: a sitting with no building gets no pin. But the
 * panel behind a pin is headed with the BODY's name when one body meets there
 * — "Tucson Unified School District · 8 public meetings" — and it listed only
 * the eight sittings held in that room, all of them concluded. The district's
 * three upcoming committee meetings, published as "Via Zoom Webinar" with no
 * agenda yet, were on no pin and so on no panel. A reader looking at Tucson
 * Unified's card was shown a body with nothing scheduled.
 *
 * So the panel also lists the same bodies' sittings that have no building —
 * online ones and ones whose place we have not recorded — each marked as such.
 * The join is the exact `bodyId`, never a name or a division: a division holds
 * many bodies, and a sitting with no `bodyId` belongs to no building's docket
 * (it stays in the meeting list, which is division-scoped). Nothing here gives
 * such a sitting a coordinate or a pin.
 */
export function placelessSittingsOfVenueBodies(
  venue: Pick<Venue, "meetings">,
  meetings: readonly Meeting[],
): Meeting[] {
  const bodies = new Set<string>();
  for (const meeting of venue.meetings) if (meeting.bodyId) bodies.add(meeting.bodyId);
  if (bodies.size === 0) return [];
  return meetings.filter(
    (meeting) =>
      !hasPhysicalLocation(meeting) && meeting.bodyId !== undefined && bodies.has(meeting.bodyId),
  );
}
