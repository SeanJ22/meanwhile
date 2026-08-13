import type { OcdId } from "../sources/types.ts";

/**
 * Venue resolutions for sources that publish a location string (or nothing)
 * instead of coordinates — §0c.
 *
 * This is a **cache keyed on `(sourceId, bodyOcdId, rawLocationString)`**, not
 * a table someone types forever. The entries below are hand-curated because
 * hand-curation is how four zips get finished on time, but the shape is the
 * one a batch geocoder writes into later: every row already carries the
 * citation for the address and the geocoder call that produced the
 * coordinates, which is exactly what an automated writer would record.
 *
 * The contract stands regardless of who wrote the row: **an unknown venue
 * drops the meeting and counts the drop.** A pin in roughly the right place is
 * a fabricated citation wearing a map marker.
 *
 * One source publishes no location string at all: Hyland OnBase's meeting list
 * has no location field anywhere (verified against both the list and the
 * ViewMeeting page). For that source the *meeting name* stands in as the raw
 * string, because it is the only observed text that distinguishes one venue
 * from another — the entry's `match` documents which published string it keys
 * on. Meetings whose name matches nothing drop as unknownVenue.
 */
export interface VenueEntry {
  /** Adapter name, e.g. "onbase". First key segment. */
  sourceId: string;
  /** The body whose meetings this resolution applies to. Second key segment. */
  bodyOcdId: OcdId;
  /** The raw location string as observed in the feed. Third key segment. */
  match: string;
  /** Rendered to the reader. */
  name: string;
  /** As published by the body. Never reconstructed. */
  address: string | null;
  lat: number;
  lng: number;
  /** The body's own page the address was read from. */
  addressSourceUrl: string;
  /** Where the coordinates came from. Citable. */
  coordinateSourceUrl: string;
  verifiedAt: string | null;
}

/**
 * Location strings naming a real meeting with no physical place.
 *
 * Dropped like an unknown venue but counted separately — "there is nothing to
 * place" and "we could not place it" are different facts (D18).
 */
export const PLACELESS_LOCATIONS = [
  "virtual meeting",
  "virtual",
  "zoom",
  "via zoom",
  "webex",
  "via zoom webinar",
  "zoom webinar",
];

/** Reduce a location string to something two spellings of one room agree on. */
export function venueKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isPlacelessLocation(raw: string): boolean {
  const key = venueKey(raw);
  return PLACELESS_LOCATIONS.some((p) => venueKey(p) === key);
}

export const VENUE_CACHE: VenueEntry[] = [
  // ── OnBase: Tucson Mayor & Council ──────────────────────────────────────
  // OnBase publishes no location field, so the meeting name is the key. Only
  // the two regular Mayor & Council sittings are mapped: the City's own
  // public-participation notice states they meet in the Mayor and Council
  // Chambers at City Hall. Joint meetings and other boards in the same tenant
  // are NOT mapped — their venue is genuinely unknown and they drop, counted.
  {
    sourceId: "onbase",
    bodyOcdId: "ocd-division/country:us/state:az/place:tucson",
    match: "Mayor & Council - Regular",
    name: "Tucson City Hall, Mayor and Council Chambers",
    address: "255 W. Alameda St, Tucson, AZ 85701",
    lat: 32.223037,
    lng: -110.975001,
    addressSourceUrl:
      "https://www.tucsonaz.gov/files/sharedassets/public/v/1/clerks/documents/agenda-committee/mc-meeting-public-participation_may-2024_final.pdf",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=255+W+Alameda+St%2C+Tucson%2C+AZ+85701&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-13",
  },
  {
    sourceId: "onbase",
    bodyOcdId: "ocd-division/country:us/state:az/place:tucson",
    match: "Mayor & Council - Study Session",
    name: "Tucson City Hall, Mayor and Council Chambers",
    address: "255 W. Alameda St, Tucson, AZ 85701",
    lat: 32.223037,
    lng: -110.975001,
    addressSourceUrl:
      "https://www.tucsonaz.gov/files/sharedassets/public/v/1/clerks/documents/agenda-committee/mc-meeting-public-participation_may-2024_final.pdf",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=255+W+Alameda+St%2C+Tucson%2C+AZ+85701&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-13",
  },

  // ── CivicPlus: Rockaway Township Council ────────────────────────────────
  // The iCal feed's LOCATION on council sittings is effectively empty
  // (" -   Rockaway NJ 07866"); the council's own page states meetings are at
  // the Municipal Building, 65 Mount Hope Road. The Census geocoder returned
  // no match for this address in three spellings, so the coordinates come
  // from OpenStreetMap Nominatim, cited below.
  {
    sourceId: "civicplus",
    bodyOcdId:
      "ocd-division/country:us/state:nj/county:morris/place:rockaway_township",
    match: " -   Rockaway NJ 07866",
    name: "Rockaway Township Municipal Building",
    address: "65 Mount Hope Road, Rockaway Township, NJ 07866",
    lat: 40.912595,
    lng: -74.530052,
    addressSourceUrl: "https://www.rockawaytownship.org/157/Township-Council",
    coordinateSourceUrl:
      "https://nominatim.openstreetmap.org/search?q=65+Mount+Hope+Road%2C+Rockaway+Township%2C+NJ&format=json&limit=2",
    verifiedAt: "2026-08-13",
  },

  // ── Diligent: TUSD Governing Board / committees at the Duffy Center ─────
  // The MeetingLocation string carries the full address; two spellings occur
  // in live data ("Fifth Street" and "5th Street"), so both are keyed.
  {
    sourceId: "diligent",
    bodyOcdId:
      "ocd-division/country:us/state:az/school_district:tucson_unified_district",
    match:
      "Duffy Community Center Multipurpose Room 5145 E. Fifth Street Tucson, AZ 85711",
    name: "Duffy Community Center, Multipurpose Room",
    address: "5145 E. 5th Street, Tucson, AZ 85711",
    lat: 32.228998,
    lng: -110.883029,
    addressSourceUrl:
      "https://tusd1-schooldesk.community.diligentoneplatform.com/Services/MeetingsService.svc/meetings?from=2026-07-01&to=2026-12-31&loadall=true",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=5145+E+5th+St%2C+Tucson%2C+AZ+85711&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-13",
  },
  {
    sourceId: "diligent",
    bodyOcdId:
      "ocd-division/country:us/state:az/school_district:tucson_unified_district",
    match:
      "Duffy Community Center Multipurpose Room 5145 E. 5th Street Tucson, AZ 85711",
    name: "Duffy Community Center, Multipurpose Room",
    address: "5145 E. 5th Street, Tucson, AZ 85711",
    lat: 32.228998,
    lng: -110.883029,
    addressSourceUrl:
      "https://tusd1-schooldesk.community.diligentoneplatform.com/Services/MeetingsService.svc/meetings?from=2026-07-01&to=2026-12-31&loadall=true",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=5145+E+5th+St%2C+Tucson%2C+AZ+85711&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-13",
  },

  {
    sourceId: "diligent",
    bodyOcdId:
      "ocd-division/country:us/state:az/school_district:tucson_unified_district",
    match:
      "Board Conference Room Morrow Education Center 1010 E. Tenth Street Tucson, Arizona 85719",
    name: "Morrow Education Center, Board Conference Room",
    address: "1010 E. Tenth Street, Tucson, AZ 85719",
    lat: 32.222464,
    lng: -110.956126,
    addressSourceUrl:
      "https://tusd1-schooldesk.community.diligentoneplatform.com/Services/MeetingsService.svc/meetings?from=2026-07-01&to=2026-12-31&loadall=true",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=1010+E+10th+St%2C+Tucson%2C+AZ+85719&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-13",
  },

  // ── CivicWeb: Newbury Selectboard ───────────────────────────────────────
  // "Town Office Meeting Room" — the town office is at 937 Route 103, stated
  // on the town's own administration page (which answers 200 to an identified
  // client even though the site root does not).
  {
    sourceId: "diligent",
    bodyOcdId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    match: "Town Office Meeting Room",
    name: "Newbury Town Office, Meeting Room",
    address: "937 Route 103, Newbury, NH 03255",
    lat: 43.321682,
    lng: -72.03705,
    addressSourceUrl: "https://www.newbury.nh.gov/administration",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=937+Route+103%2C+Newbury%2C+NH+03255&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-13",
  },
];

export function resolveVenue(
  sourceId: string,
  bodyOcdId: OcdId,
  rawLocation: string,
): VenueEntry | undefined {
  const key = venueKey(rawLocation);
  return VENUE_CACHE.find(
    (v) =>
      v.sourceId === sourceId &&
      v.bodyOcdId === bodyOcdId &&
      venueKey(v.match) === key,
  );
}
