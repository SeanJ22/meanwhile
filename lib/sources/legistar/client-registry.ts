import { haversineKm } from "../../geo/distance.ts";
import { reviewedVenueEntries } from "../../meetings/venue-cache.ts";
import {
  wiringForMeetingSource,
  type BodySourceWiring,
} from "../../registry/source-wiring.ts";
import type { MeetingQuery, OcdId } from "../types.ts";

/**
 * Which Legistar clients this adapter knows.
 *
 * The API cannot tell us the OCD-ID, so that stable adapter configuration
 * lives here. Mutable venue resolutions do not: the `venues` getter reads the
 * canonical promoted `venue-resolutions` projection at acquisition time.
 *
 * **1. The OCD-ID.** Legistar knows it is "pima". It does not know that means
 * `ocd-division/country:us/state:az/county:pima`. That mapping is the join key
 * for everything downstream, so it is stated explicitly per client and never
 * inferred from the slug.
 *
 * The events endpoint returns a room name and no coordinates. The promoted
 * projection supplies exact, cited resolutions, and a client scope may hold
 * none (the venue-gap class, 2026-09-23): zero reviewed venues is never zero
 * meetings and never a failed read. Every event is still read and published;
 * a room with no reviewed row gets no coordinates and no pin, carries the
 * publisher's own words as its named venue gap, and is counted as
 * `unknownVenue` rather than approximately geocoded.
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
  /** The `{client}` path segment at webapi.legistar.com. */
  slug: string;
  /** The division whose government this is. WHERE, not WHO. */
  ocdId: OcdId;
  /**
   * The registry body whose sittings this client serves.
   *
   * Legistar predates `SOURCE_WIRING` and carries its own client registry, so
   * it states the body id here rather than reading it off a wiring row. Same
   * reason as every other adapter: `ocdId` answers WHERE, and six bodies share
   * `county:pima` — so a card filtering on it put the Board of Supervisors'
   * agenda on the Central Arizona Water Conservation District and back again.
   */
  bodyId: string;
  /** Display only — never joined on. */
  jurisdiction: string;
  /**
   * Who published the record. **The public body, not Granicus.** Pima County
   * authored the agenda; Legistar is the filing cabinet.
   */
  publishingOrg: string;
  /** IANA zone the body meets in. Legistar sends wall-clock times with no zone. */
  timeZone: string;
  venues: LegistarVenue[];
  /**
   * The tenant's own InSite portal host — `pima.legistar.com` (2026-08-28).
   *
   * **The WebAPI and the portal are two different records with two different
   * publication clocks, and this field is what lets a second route reach the
   * one the API cannot.** `webapi.legistar.com/v1/{slug}/events` returns only
   * the sittings whose InSite meeting-detail page is publicly viewable; the
   * portal's own `Calendar.aspx` grid returns all of them and marks the
   * difference with `class="meeting_NotViewable"`. Measured the same day on
   * three tenants: Pima 3 rows / 3 not viewable / 0 from the API, Phoenix 8 /
   * 8 / 0, Mesa 15 / 12 / exactly the 3 viewable.
   *
   * Optional because a client may be wired for the API alone; `lib/sources/
   * legistar-insite/` reads only the clients that state one, so the absence is
   * a configuration fact rather than an assumption about the tenant.
   */
  insiteHost?: string;
  /**
   * The calendar RSS pair observed on this tenant's portal, and the range it
   * was observed for.
   *
   * **`Feed.ashx` is keyed per tenant AND per date range.** Pima's "Next
   * Month" feed is `ID=43473383&GUID=88b7d677-…`; the pair recorded against a
   * different range is a different number, so a pair written here is only ever
   * true of the range it names. The adapter therefore reads the link off the
   * page it has just fetched and uses this as the RECORD of what was seen,
   * never as a URL to construct one from.
   *
   * It earns its place because of `pubDate`, which the grid does not carry:
   * the feed states when InSite first published each sitting. Pima's 2026-09-22
   * sitting carries `Mon, 15 Jun 2026 21:25:03 GMT` — **74 days of notice** —
   * against a WebAPI lead time over 32 Pima 2026 events of max 5 days, median
   * 0, min -2.
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
 * Is any of these reviewed venues inside the query radius? One answer for the
 * Legistar WebAPI client and the InSite tenant, whose reviewed venues are the
 * only geography either adapter holds.
 *
 * A scope with NO reviewed venue has no coordinate to measure, and that is
 * never a reason to skip it (the venue-gap class, 2026-09-23): reading it is
 * the only way its sittings reach a reader, each published with its place as a
 * named gap. Skipping it here would be the silent suppression the old
 * empty-scope throw guarded against, moved one step earlier.
 */
export function venuesWithinRadius(venues: readonly LegistarVenue[], query: MeetingQuery): boolean {
  if (venues.length === 0) return true;
  return venues.some(
    (venue) => haversineKm(query.lat, query.lng, venue.lat, venue.lng) <= query.radiusKm,
  );
}
