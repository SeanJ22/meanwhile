import type { OcdId } from "../types.ts";

/**
 * Which Legistar clients this adapter knows, and where their meetings happen.
 *
 * Two things live here that the API cannot tell us, and both need a real
 * source rather than a plausible guess.
 *
 * **1. The OCD-ID.** Legistar knows it is "pima". It does not know that means
 * `ocd-division/country:us/state:az/county:pima`. That mapping is the join key
 * for everything downstream, so it is stated explicitly per client and never
 * inferred from the slug.
 *
 * **2. Coordinates.** The events endpoint returns a room name and nothing else
 * — no address, no latitude, no longitude. A pin needs coordinates, and
 * `lib/sources/types.ts` is explicit that a meeting which cannot be placed is
 * dropped rather than guessed at. So every venue below carries an address read
 * from the body's own website and coordinates from the Census geocoder, each
 * with the URL it came from. A venue string the table does not know produces a
 * dropped meeting and a warning, never an approximate pin.
 *
 * Adding a client is adding an entry here. It is deliberately a small amount of
 * hand work per jurisdiction, because the alternative — geocoding a room name
 * at runtime — invents locations.
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
}

/**
 * Venue strings that name a real meeting with no physical place.
 *
 * These are dropped like an unknown venue but counted separately, because they
 * are a different fact: not "we could not place this", but "there is nothing to
 * place". A virtual meeting is still a real public meeting and losing it from
 * the map is a gap worth a surface of its own — tracker D18.
 */
export const PLACELESS_VENUES = ["virtual meeting", "virtual", "zoom", "webex"];

export const LEGISTAR_CLIENTS: LegistarClient[] = [
  {
    slug: "pima",
    ocdId: "ocd-division/country:us/state:az/county:pima",
    bodyId: "ocd-division/country:us/state:az/county:pima#governing",
    jurisdiction: "Pima County, AZ",
    publishingOrg: "Pima County Clerk of the Board",
    timeZone: "America/Phoenix",
    venues: [
      {
        match: "Board of Supervisors Hearing Room",
        name: "Pima County Administration Building, Board of Supervisors Hearing Room",
        // Published as "130 W. Congress St. 1st Floor, Board of Supervisors
        // Hearing Room Tucson, AZ 85701". Kept as the body prints it.
        address: "130 W. Congress St. 1st Floor, Tucson, AZ 85701",
        lat: 32.221618,
        lng: -110.974036,
        addressSourceUrl: "https://www.pima.gov/government/board_of_supervisors/",
        coordinateSourceUrl:
          "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=130+W+Congress+St%2C+Tucson%2C+AZ+85701&benchmark=Public_AR_Current&format=json",
        verifiedAt: null,
      },
      {
        match: "1 E. Broadway, 4th Floor",
        name: "1 E. Broadway Blvd, 4th Floor",
        address: "1 E. Broadway Blvd, Tucson, AZ 85701",
        // The event row is itself the only place this address appears, so the
        // address source is the meeting record rather than a roster page.
        lat: 32.221075,
        lng: -110.971059,
        addressSourceUrl: "https://pima.legistar.com/Calendar.aspx",
        coordinateSourceUrl:
          "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=1+E+Broadway+Blvd%2C+Tucson%2C+AZ+85701&benchmark=Public_AR_Current&format=json",
        verifiedAt: null,
      },
    ],
  },
];

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
