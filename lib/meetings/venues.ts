import type { Meeting } from "@/lib/sources/types";

import type { RegistryProvenance } from "../registry/types.ts";
import { hasPhysicalLocation, isOnlineOnly } from "./online.ts";
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
  kind?: "PHYSICAL" | "ONLINE_ONLY";
  officeAddressSource?: RegistryProvenance;
}

/** A coordinate resolved from the body's published office address. */
export interface BodyOfficeLocation {
  bodyId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  provenance: RegistryProvenance;
}

/** ~11 meters. Two rooms in one building are one pin. */
const COORD_PRECISION = 4;

export function groupByVenue(meetings: Meeting[], listingIdentity?: MeetingListingIdentityReadback, offices: readonly BodyOfficeLocation[] = []): Venue[] {
  const venues = new Map<string, Venue>();

  for (const meeting of meetings) {
    const office = isOnlineOnly(meeting) ? offices.find(value => value.bodyId === meeting.bodyId) : undefined;
    if (!hasPhysicalLocation(meeting) && !office) continue;
    const kind = office ? "ONLINE_ONLY" : "PHYSICAL";
    const location = office ?? meeting.location;
    if (!location) continue;
    const { lat, lng, name, address } = location;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // An online pin at an office is separate from a physical meeting there.
    const coordinate = `${lat.toFixed(COORD_PRECISION)},${lng.toFixed(COORD_PRECISION)}`;
    const key = office ? `online:${office.bodyId}:${coordinate}` : coordinate;

    const existing = venues.get(key);
    if (existing) {
      existing.meetings.push(meeting);
      continue;
    }

    venues.set(key, { key, name, address, lat, lng, meetings: [meeting], listingIdentity, kind, ...(office ? { officeAddressSource: office.provenance } : {}) });
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
  const alreadyShown = new Set(venue.meetings.map(meeting => meeting.id));
  return meetings.filter(
    (meeting) =>
      !alreadyShown.has(meeting.id) && !hasPhysicalLocation(meeting) && meeting.bodyId !== undefined && bodies.has(meeting.bodyId),
  );
}
