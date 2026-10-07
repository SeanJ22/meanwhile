import { haversineKm } from "../../geo/distance.ts";
import { reviewedVenueEntries } from "../../meetings/venue-cache.ts";
import {
  wiringForMeetingSource,
  type BodySourceWiring,
} from "../../registry/source-wiring.ts";
import type { MeetingQuery, OcdId } from "../types.ts";

/**
 * Which Legistar clients this adapter knows. The API cannot tell us the OCD-ID, so the mapping from a
 * client slug to its division is stated explicitly per client and never inferred from the slug. Venue
 * resolutions are not here: the `venues` getter reads the promoted `venue-resolutions` projection at
 * acquisition time, and a client scope may hold none. Every event is still read and published; a room
 * with no reviewed row gets no pin, carries the publisher's own words as its named venue gap, and is
 * counted as `unknownVenue` rather than approximately geocoded.
 */

/**
 * A known meeting place.
 *
 * `match` is compared against `EventLocation` after both are reduced to
 * lowercase alphanumerics, because the same room is punctuated inconsistently
 * across rows ("Board of Supervisors' Hearing Room" against "Board of
 * Supervisors Hearing Room").
 */
export interface LegistarVenue {
  match: string;
  /** Rendered to the reader. */
  name: string;
  /** As published by the body. Never reconstructed or reformatted. */
  address: string | null;
  lat: number;
  lng: number;
  /** The body's own page the address was read from. */
  addressSourceUrl: string;
  /** Where the coordinates came from. Public domain, and citable. */
  coordinateSourceUrl: string;
  /** When a human last confirmed this row against the source above. */
  verifiedAt: string | null;
}

export interface LegistarClient {
  /** Exact vendor body identity for a runtime-added calendar. */
  eventBodyId?: number;
  /** The `{client}` path segment at webapi.legistar.com. */
  slug: string;
  /** The division whose government this is. WHERE, not WHO. */
  ocdId: OcdId;
  /**
   * The registry body whose sittings this client serves. `ocdId` answers where, and several bodies can share
   * one division, so the body id is stated here.
   */
  bodyId: string;
  /** Display only — never joined on. */
  jurisdiction: string;
  /** Who published the record: the public body, not Granicus. */
  publishingOrg: string;
  /** IANA zone the body meets in. Legistar sends wall-clock times with no zone. */
  timeZone: string;
  venues: LegistarVenue[];
  /**
   * The tenant's own InSite portal host. `webapi.legistar.com/v1/{slug}/events` returns only sittings whose
   * InSite detail page is publicly viewable; the portal's own `Calendar.aspx` grid returns all of them. Optional:
   * `lib/sources/legistar-insite/` reads only the clients that state one.
   */
  insiteHost?: string;
  /**
   * The calendar RSS pair observed on this tenant's portal, and the range it was observed for. `Feed.ashx` is
   * keyed per tenant and per date range, so the adapter reads the link off the page it just fetched and uses
   * this only as the record of what was seen, never to construct a URL. The feed's `pubDate` states when
   * InSite first published each sitting, which the grid does not.
   */
  insiteFeed?: {
    id: string;
    guid: string;
    /** The dropdown selection this pair was read under. */
    range: string;
    /** When it was read. `pnpm stamp`, never a plausible date. */
    observedAt: string;
  };
}

/**
 * Venue strings that name a real meeting with no physical place.
 *
 * These are kept as online sittings and counted separately from an unknown
 * venue, because they are a different fact: not "we could not place this", but
 * "there is nothing to place". A virtual meeting is still a real public meeting
 * and losing it from the map is a gap worth a surface of its own — tracker D18.
 */
export const PLACELESS_VENUES = ["virtual meeting", "virtual", "zoom", "webex"];

export function legistarClientsFromWiring(
  rows: readonly BodySourceWiring[] = wiringForMeetingSource("legistar"),
): LegistarClient[] {
  return rows.map((row) => {
    const slug = row.config.slug?.trim();
    if (!slug || row.ocdId === null) {
      throw new Error(`LEGISTAR_SOURCE_WIRING_INVALID:${row.bodyId}`);
    }
    const insiteFeed = row.config.insiteFeedId && row.config.insiteFeedGuid &&
        row.config.insiteFeedRange && row.config.insiteFeedObservedAt
      ? {
          id: row.config.insiteFeedId,
          guid: row.config.insiteFeedGuid,
          range: row.config.insiteFeedRange,
          observedAt: row.config.insiteFeedObservedAt,
        }
      : undefined;
    const ocdId = row.ocdId;
    return {
      slug,
      ...(row.config.eventBodyId ? { eventBodyId: Number(row.config.eventBodyId) } : {}),
      ocdId,
      bodyId: row.bodyId,
      jurisdiction: row.jurisdiction,
      publishingOrg: row.publishingOrg,
      timeZone: row.timeZone,
      ...(row.config.insiteHost ? { insiteHost: row.config.insiteHost } : {}),
      ...(insiteFeed ? { insiteFeed } : {}),
      // Possibly empty: a scope with no reviewed row is a real state, and the
      // adapter publishes its sittings with their venue gap named.
      get venues() {
        return reviewedVenueEntries("legistar", ocdId);
      },
    };
  });
}

/** Compatibility projection, derived exclusively from SOURCE_WIRING. */
export const LEGISTAR_CLIENTS: LegistarClient[] = legistarClientsFromWiring();

/** Reduce a venue string to something two spellings of one room agree on. */
export function venueKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function findClient(slug: string): LegistarClient | undefined {
  return LEGISTAR_CLIENTS.find((client) => client.slug === slug);
}

export function findVenue(
  client: LegistarClient,
  location: string,
): LegistarVenue | undefined {
  const key = venueKey(location);
  return client.venues.find((venue) => venueKey(venue.match) === key);
}

export function isPlaceless(location: string): boolean {
  const key = venueKey(location);
  return PLACELESS_VENUES.some((placeless) => venueKey(placeless) === key);
}

/**
 * Is any of these reviewed venues inside the query radius? A scope with no reviewed venue has no coordinate
 * to measure and is never skipped: reading it is the only way its sittings reach a reader.
 */
export function venuesWithinRadius(venues: readonly LegistarVenue[], query: MeetingQuery): boolean {
  if (venues.length === 0) return true;
  return venues.some(
    (venue) => haversineKm(query.lat, query.lng, venue.lat, venue.lng) <= query.radiusKm,
  );
}
