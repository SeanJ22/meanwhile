import type { Meeting } from "@/lib/sources/types";

import type { RegistryProvenance } from "../registry/types.ts";
import { hasPhysicalLocation, isOnlineOnly } from "./online.ts";
import type { MeetingListingIdentityReadback } from "./listing-identity.ts";
import type { MeetingPinLocation, PinBasis } from "./pin-location.ts";

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
  pinBasis?: PinBasis;
  officeAddressSource?: RegistryProvenance;
}

/** ~11 meters. Two rooms in one building are one pin. */
const COORD_PRECISION = 4;

export function groupByVenue(meetings: Meeting[], listingIdentity?: MeetingListingIdentityReadback, locations: readonly MeetingPinLocation[] = []): Venue[] {
  const venues = new Map<string, Venue>();
  const byMeeting = new Map(locations.map(location => [location.meetingId,location]));

  for (const meeting of meetings) {
    const resolved = byMeeting.get(meeting.id);
    const kind = isOnlineOnly(meeting) ? "ONLINE_ONLY" : "PHYSICAL";
    const location = meeting.location ?? resolved;
    if (!location) continue;
    const { lat, lng, name, address } = location;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // An online pin at an office is separate from a physical meeting there.
    const coordinate = `${lat.toFixed(COORD_PRECISION)},${lng.toFixed(COORD_PRECISION)}`;
    const basis = meeting.location ? "MEETING" : resolved!.basis;
    const key = kind === "ONLINE_ONLY" ? `online:${meeting.bodyId}:${coordinate}`
      : basis === "MEETING" ? coordinate : `${basis}:${coordinate}`;

    const existing = venues.get(key);
    if (existing) {
      existing.meetings.push(meeting);
      continue;
    }

    venues.set(key, { key, name, address, lat, lng, meetings: [meeting], listingIdentity, kind, pinBasis:basis,
      ...(resolved ? { officeAddressSource: resolved.provenance } : {}) });
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
  locations: readonly MeetingPinLocation[] = [],
): Meeting[] {
  const bodies = new Set<string>();
  for (const meeting of venue.meetings) if (meeting.bodyId) bodies.add(meeting.bodyId);
  if (bodies.size === 0) return [];
  const alreadyShown = new Set(venue.meetings.map(meeting => meeting.id));
  const placed = new Set(locations.map(location => location.meetingId));
  return meetings.filter(
    (meeting) =>
      !alreadyShown.has(meeting.id) && !placed.has(meeting.id) && !hasPhysicalLocation(meeting) && meeting.bodyId !== undefined && bodies.has(meeting.bodyId),
  );
}
