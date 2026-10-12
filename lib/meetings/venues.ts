import type { Meeting } from "@/lib/sources/types";

import type { RegistryProvenance } from "../registry/types.ts";
import { hasPhysicalLocation, isOnlineOnly } from "./online.ts";
import type { MeetingListingIdentityReadback } from "./listing-identity.ts";

/** A place that hosts meetings. Pins are venues, not meetings, so co-located sittings share one marker. */
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
 * The same bodies' sittings that have no building, listed on the pin's panel and marked as such. Joined on exact
 * `bodyId`; nothing here gives such a sitting a coordinate.
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
