import { CURATED_PREFIX } from "../ocd/curated.ts";
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
  /**
   * The body whose meetings this resolution applies to. Second key segment.
   *
   * Null for a body with no Census division (D28). **The key no longer
   * degrades when it is null** (D31, g10): `venueScope()` below substitutes
   * a distinct value per source, so two division-less bodies sharing a source
   * and a location string cannot resolve to each other's building. That was
   * not hypothetical — Diligent already serves three tenants and one of them,
   * Pima Community College, has no division.
   */
  bodyOcdId: OcdId | null;
  /**
   * The source's own tenant id, for a row whose body has no division (D31).
   * Absent on every row with an `ocdId`, where the division already keys it.
   */
  tenant?: string;
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
  // Tucson Clerk's boards pages publish these for virtual-only bodies.
  "microsoft teams (virtual)",
  "microsoft teams virtual",
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
  // ── OnBase: Tucson Public Housing Authority ─────────────────────────────
  // The PHA's own published agenda (2026-08-18) states the Mayor and Council
  // sit as the PHA Board of Commissioners in the Mayor and Council Chambers.
  // Same building and coordinates as the M&C rows below.
  {
    sourceId: "onbase",
    bodyOcdId: "ocd-division/country:us/state:az/place:tucson",
    match: "Public Housing Authority Board of Commissioners",
    name: "Tucson City Hall, Mayor and Council Chambers",
    address: "255 W. Alameda St, Tucson, AZ 85701",
    lat: 32.223037,
    lng: -110.975001,
    addressSourceUrl:
      "https://tucsonaz.hylandcloud.com/221agendaonline/Documents/ViewDocument/agenda.pdf?meetingId=1981&documentType=1",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=255+W+Alameda+St%2C+Tucson%2C+AZ+85701&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-14",
  },

  // ── Diligent: Pima Community College Governing Board (D28) ──────────────
  // The board-meetings page publishes the District Office address; the
  // service's own location strings name rooms in that building. "District
  // Office TBD" is the same building with the room not yet assigned — the
  // building is the published venue either way.
  {
    sourceId: "diligent",
    bodyOcdId: null,
    // D31: the tenant keys these rows now that the division cannot.
    tenant: "pcc",
    match: "District Office, Community/Board Room C-105",
    name: "PCC District Office, Community/Board Room C-105",
    address: "4905 E. Broadway Blvd., Tucson, AZ 85709",
    lat: 32.221683,
    lng: -110.887102,
    addressSourceUrl:
      "https://www.pima.edu/about-pima/leadership-policies/governing-board/board-meetings/index.html",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=4905+E+Broadway+Blvd%2C+Tucson%2C+AZ+85709&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-14",
  },
  {
    sourceId: "diligent",
    bodyOcdId: null,
    // D31: the tenant keys these rows now that the division cannot.
    tenant: "pcc",
    match: "District Office, Board Conference Room C-228",
    name: "PCC District Office, Board Conference Room C-228",
    address: "4905 E. Broadway Blvd., Tucson, AZ 85709",
    lat: 32.221683,
    lng: -110.887102,
    addressSourceUrl:
      "https://www.pima.edu/about-pima/leadership-policies/governing-board/board-meetings/index.html",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=4905+E+Broadway+Blvd%2C+Tucson%2C+AZ+85709&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-14",
  },
  {
    sourceId: "diligent",
    bodyOcdId: null,
    // D31: the tenant keys these rows now that the division cannot.
    tenant: "pcc",
    match: "District Office TBD",
    name: "PCC District Office",
    address: "4905 E. Broadway Blvd., Tucson, AZ 85709",
    lat: 32.221683,
    lng: -110.887102,
    addressSourceUrl:
      "https://www.pima.edu/about-pima/leadership-policies/governing-board/board-meetings/index.html",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=4905+E+Broadway+Blvd%2C+Tucson%2C+AZ+85709&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-14",
  },

  // ── Clerksboards: Tucson boards with published physical venues (D29) ────
  // Each `match` is the board page's own "4) Meeting Location" text verbatim;
  // the page is both the address citation and the schedule source.
  {
    sourceId: "clerksboards",
    bodyOcdId: "ocd-division/country:us/state:az/place:tucson",
    match: "Microsoft Teams (Hybrid Format) / Mayor and Council Chambers; 255 W Alameda",
    name: "Tucson City Hall, Mayor and Council Chambers",
    address: "255 W. Alameda St, Tucson, AZ 85701",
    lat: 32.223037,
    lng: -110.975001,
    addressSourceUrl: "https://clerksboards.tucsonaz.gov/boards/?board=38",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=255+W+Alameda+St%2C+Tucson%2C+AZ+85701&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-14",
  },
  {
    sourceId: "clerksboards",
    bodyOcdId: "ocd-division/country:us/state:az/place:tucson",
    match: "Zoom Hybrid Format / City Hall - 1st Floor",
    name: "Tucson City Hall, 1st Floor",
    address: "255 W. Alameda St, Tucson, AZ 85701",
    lat: 32.223037,
    lng: -110.975001,
    addressSourceUrl: "https://clerksboards.tucsonaz.gov/boards/?board=8",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=255+W+Alameda+St%2C+Tucson%2C+AZ+85701&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-14",
  },
  {
    sourceId: "clerksboards",
    bodyOcdId: "ocd-division/country:us/state:az/place:tucson",
    match:
      "Microsoft Teams (Hybrid Format) / Tucson Water 3rd Floor Conference Room; 310 W. Alameda St.",
    name: "Tucson Water, 3rd Floor Conference Room",
    address: "310 W. Alameda St, Tucson, AZ 85701",
    lat: 32.222932,
    lng: -110.975639,
    addressSourceUrl: "https://clerksboards.tucsonaz.gov/boards/?board=23",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=310+W+Alameda+St%2C+Tucson%2C+AZ&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-14",
  },
  {
    sourceId: "clerksboards",
    bodyOcdId: "ocd-division/country:us/state:az/place:tucson",
    match:
      "Microsoft Teams (Hybrid Format) / Parks Administration Building; 900 S Randolph way",
    name: "Tucson Parks Administration Building",
    address: "900 S. Randolph Way, Tucson, AZ 85716",
    lat: 32.21063,
    lng: -110.918028,
    addressSourceUrl: "https://clerksboards.tucsonaz.gov/boards/?board=63",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=900+S+Randolph+Way%2C+Tucson%2C+AZ&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-14",
  },
  {
    sourceId: "clerksboards",
    bodyOcdId: "ocd-division/country:us/state:az/place:tucson",
    match:
      "Microsoft Teams (Hybrid Format) / Ward 6 Council Office; 3202 E. 1st Street, 85716",
    name: "Ward 6 Council Office",
    address: "3202 E. 1st Street, Tucson, AZ 85716",
    lat: 32.235068,
    lng: -110.925106,
    addressSourceUrl: "https://clerksboards.tucsonaz.gov/boards/?board=19",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=3202+E+1st+St%2C+Tucson%2C+AZ+85716&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-14",
  },

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

  // ── SchedulePage: Morris Hills Regional Board of Education ──────────────
  // The schedule page names the room in one sentence — "held in the Board of
  // Education - Board Conference Room" — and the district's own footer gives
  // the street address. There is no per-sitting location string to key on,
  // so the `match` is the room name the wiring row carries.
  {
    sourceId: "schedulepage",
    bodyOcdId:
      "ocd-division/country:us/state:nj/school_district:morris_hills_regional_school_district",
    match: "Board of Education - Board Conference Room",
    name: "Morris Hills Regional District Board Conference Room",
    address: "48 Knoll Drive, Rockaway, NJ 07866",
    lat: 40.885647,
    lng: -74.509769,
    addressSourceUrl:
      "https://www.mhrd.org/administration/board-of-education/boe-meetings",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=48+Knoll+Drive%2C+Rockaway%2C+NJ+07866&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-15",
  },

  // ── SchedulePage: Kearsarge Regional School Board (M79) ─────────────────
  // The schedule page states the place in its own bullet, verbatim: "Meeting
  // Location: 114 Main Street, New London (enter by the cupola on Main
  // Street)". The 2026-08-13 coverage audit recorded 165 Main St from a search
  // snippet; the page itself says 114, and the page wins.
  {
    sourceId: "schedulepage",
    bodyOcdId:
      "ocd-division/country:us/state:nh/school_district:kearsarge_regional_school_district",
    match: "114 Main Street, New London",
    name: "Kearsarge Regional School District, 114 Main Street (enter by the cupola)",
    address: "114 Main Street, New London, NH 03257",
    lat: 43.418077,
    lng: -71.990172,
    addressSourceUrl:
      "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-meeting-schedule",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=114+Main+Street%2C+New+London%2C+NH+03257&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-15",
  },

  // ── SchedulePage: Newbury's land-use boards (M79) ───────────────────────
  // Two separate published statements, one per body, and neither is inferred
  // from the other:
  //   • Planning Board — its own agendas carry "Location – Newbury Town
  //     Office" in the body of the notice (verified on the 2026-08-18 agenda).
  //   • Conservation Commission — its own page says "Meetings are the second
  //     Tuesday of the month at the Town Offices."
  // The Zoning Board of Adjustment states neither, in any prose on any rung
  // walked — and it turned out not to need to; see its own row below.
  // Same building and coordinates as the Selectboard row above, which the town
  // administration page addresses at 937 Route 103.
  {
    sourceId: "schedulepage",
    bodyOcdId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    match: "Newbury Town Office",
    name: "Newbury Town Office",
    address: "937 Route 103, Newbury, NH 03255",
    lat: 43.321682,
    lng: -72.03705,
    addressSourceUrl: "https://www.newbury.nh.gov/administration",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=937+Route+103%2C+Newbury%2C+NH+03255&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-15",
  },

  // ── iCal: every Newbury body on the town's OWN calendar (NH Hunt, 2026-08-20)
  //
  // The town publishes `/calendar/ical/export.ics` — 1,157 events, ninety-four
  // of them upcoming — and **writes no `LOCATION` on any of them.** Not "NH"
  // like Wilmot; nothing at all. So every row on this feed reaches the
  // `venueMatch` fallback, and this is the row it reaches.
  //
  // The address is not new and is not inferred here: it is the same building,
  // the same two published statements and the same geocoder call as the
  // `schedulepage` row above, which the town's own administration page
  // addresses at 937 Route 103. What is new is only the `sourceId` scope —
  // the cache is scoped per source on purpose, so a venue proved for one
  // adapter cannot silently become a fact for another.
  //
  // Re-verified against the town's own administration page on 2026-08-20, and
  // against the footer every page on newbury.nh.gov carries: "Newbury Offices,
  // PO Box 296, US Rte 103".
  {
    sourceId: "ical",
    bodyOcdId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    match: "Newbury Town Office",
    name: "Newbury Town Office",
    address: "937 Route 103, Newbury, NH 03255",
    lat: 43.321682,
    lng: -72.03705,
    addressSourceUrl: "https://www.newbury.nh.gov/administration",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=937+Route+103%2C+Newbury%2C+NH+03255&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-20",
  },

  // ── SchedulePage: Newbury's Zoning Board of Adjustment ──────────────────
  // The row that took a body from KNOWN_UNCOVERED to LIVE with no other
  // change, 2026-08-15 (the mobile round-two session), and the reason the
  // three prior rungs missed it: **the address is not in the page's text.**
  // The board's own page carries a "Contact Info" pane whose `street-address`
  // block reads `937 Route 103 / PO Box 296 / Newbury, NH 03255` beside a
  // `See map: Google Maps` link (`maps.google.com?q=937+Route+103%2C+Newbury%2C
  // +NH%2C+03255%2C+us`) — machine-readable markup, invisible to a reader
  // scanning prose for "the meeting is at". The author found it in his own
  // browser via the map link and ruled it the meeting address for this board.
  // The name is the town's OWN label for the building, from the site footer
  // that every page carries: "Newbury Offices, PO Box 296, US Rte 103". Both
  // strings verified against a live retrieval of the ZBA page on 2026-08-15.
  //
  // Same coordinates as the row above because it is the same building; the
  // geocoder call is re-run and cited rather than copied on faith.
  {
    sourceId: "schedulepage",
    bodyOcdId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    match: "Newbury Offices",
    name: "Newbury Offices",
    address: "937 Route 103, Newbury, NH 03255",
    lat: 43.321682,
    lng: -72.03705,
    addressSourceUrl: "https://www.newbury.nh.gov/zoning-board-adjustment",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=937+Route+103%2C+Newbury%2C+NH+03255&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-15",
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

  // ── IQM2: Morris County Board of County Commissioners ───────────────────
  // The Calendar.aspx tooltip publishes the room and the full street address
  // for every sitting — work sessions in Knox Room 525, regular meetings in
  // the Public Meeting Room 555, both in the Administration and Records
  // Building. The tooltip is the county's own publication, which resolved the
  // venue-citation errand its Akamai-fronted main site had blocked.
  {
    sourceId: "iqm2",
    bodyOcdId: "ocd-division/country:us/state:nj/county:morris",
    match:
      "Knox Room 525, Administration and Records Building, 10 Court Street, Morristown, NJ  07960",
    name: "Administration and Records Building, Knox Room 525",
    address: "10 Court Street, Morristown, NJ 07960",
    lat: 40.796821,
    lng: -74.484698,
    addressSourceUrl:
      "https://morriscountynj.iqm2.com/Citizens/Calendar.aspx?From=8/1/2026&To=12/31/2026",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=10+Court+Street%2C+Morristown%2C+NJ+07960&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-13",
  },
  {
    sourceId: "iqm2",
    bodyOcdId: "ocd-division/country:us/state:nj/county:morris",
    match:
      "County Commissioners Public Meeting Room 555, Administration and Records Building, 10 Court Street, Morristown, NJ  07960",
    name: "Administration and Records Building, Public Meeting Room 555",
    address: "10 Court Street, Morristown, NJ 07960",
    lat: 40.796821,
    lng: -74.484698,
    addressSourceUrl:
      "https://morriscountynj.iqm2.com/Citizens/Calendar.aspx?From=8/1/2026&To=12/31/2026",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=10+Court+Street%2C+Morristown%2C+NJ+07960&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-13",
  },

  // ── Revize: Merrimack County Board of Commissioners ─────────────────────
  // The homepage block says only "OCH - Concord". The expansion is the
  // county's own 7/27/2026 public notice: "Location: OCH, 163 N. Main St.,
  // Concord, NH 03301". Board meetings alternate venues (the 8/10 notice
  // placed that one in Boscawen), so only the observed string is keyed; a
  // Boscawen meeting will drop as unknownVenue until its string is observed
  // and a row added — a counted drop, never a guessed pin.
  {
    sourceId: "revize",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack",
    match: "OCH - Concord",
    name: "OCH, 163 N. Main St., Concord",
    address: "163 N. Main St., Concord, NH 03301",
    lat: 43.210534,
    lng: -71.538023,
    addressSourceUrl:
      "https://www.merrimackcounty.net/Board%20of%20Commissioners/Public%20Notices%2C%20Agenda%2C%20Minutes/Public%20Notice%207.27.26.pdf",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=163+N+Main+St%2C+Concord%2C+NH+03301&benchmark=Public_AR_Current&format=json",
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

  // ── Diligent: Sunnyside USD Governing Board ─────────────────────────────
  // The feed's location string names the Fred T. Bull Administration
  // Building; the board's own page places the Governing Board Room at the
  // District Administration Building, 2238 East Ginter Road — the same
  // building, renamed for the retired superintendent in 1992.
  {
    sourceId: "diligent",
    bodyOcdId:
      "ocd-division/country:us/state:az/school_district:sunnyside_unified_district",
    match: "Fred T. Bull Administration Building - Governing Board Room",
    name: "Sunnyside District Administration Building, Governing Board Room",
    address: "2238 E. Ginter Road, Tucson, AZ 85706",
    lat: 32.137642,
    lng: -110.938584,
    addressSourceUrl: "https://www.susd12.org/governing-board-home",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=2238+E+Ginter+Rd%2C+Tucson%2C+AZ+85706&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-14",
  },

  // ── BoardBook: Amphitheater USD Governing Board ─────────────────────────
  // BoardBook rows publish the address beside the venue name; these two are
  // the only venues in the 2026 rows. The addressSourceUrl is the portal's
  // own org page — the district's published meeting notices.
  {
    sourceId: "boardbook",
    bodyOcdId:
      "ocd-division/country:us/state:az/school_district:amphitheater_unified_district",
    match: "Leadership and Professional Development Center",
    name: "Amphitheater Leadership and Professional Development Center",
    address: "701 W. Wetmore Road, Tucson, AZ 85705",
    lat: 32.286421,
    lng: -110.980988,
    addressSourceUrl: "https://meetings.boardbook.org/Public/Organization/2065",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=701+W+Wetmore+Rd%2C+Tucson%2C+AZ+85705&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-14",
  },
  {
    sourceId: "boardbook",
    bodyOcdId:
      "ocd-division/country:us/state:az/school_district:amphitheater_unified_district",
    match: "Canyon del Oro High School Auditorium",
    name: "Canyon del Oro High School Auditorium",
    address: "25 W. Calle Concordia, Oro Valley, AZ 85704",
    lat: 32.373548,
    lng: -110.970219,
    addressSourceUrl: "https://meetings.boardbook.org/Public/Organization/2065",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=25+W+Calle+Concordia%2C+Oro+Valley%2C+AZ+85704&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-14",
  },

  // ── iCalendar: Wilmot NH's Town Office (M123, 2026-08-19) ───────────────
  // The town's own feed writes the full street address into `LOCATION`, so
  // unlike most rows here nothing had to be hunted for the ADDRESS — it is
  // the feed's own words. Two spellings occur in the same feed, one naming
  // the Town Clerk's office inside the same building, and both are keyed
  // because a spelling variant must never read as an unknown venue.
  //
  // Nine of the twenty-three events write `LOCATION:NH`. That is a state,
  // not a building, and it is deliberately NOT keyed: those rows drop as
  // `unknownVenue` and show in the counts, because a pin in the middle of
  // New Hampshire would be a fabricated location.
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:wilmot_town",
    match: "Town Office, 9 Kearsarge Valley Road, Wilmot, NH, 03287, United States",
    name: "Wilmot Town Office",
    address: "9 Kearsarge Valley Road, Wilmot, NH 03287",
    lat: 43.414131,
    lng: -71.901487,
    addressSourceUrl: "https://www.wilmotnh.org/events/list/?ical=1",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=9+Kearsarge+Valley+Road%2C+Wilmot%2C+NH+03287&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-19",
  },
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:wilmot_town",
    match:
      "Town Office – Town Clerk’s Office, 9 Kearsarge Valley Road, Wilmot, NH, 03287, United States",
    name: "Wilmot Town Office",
    address: "9 Kearsarge Valley Road, Wilmot, NH 03287",
    lat: 43.414131,
    lng: -71.901487,
    addressSourceUrl: "https://www.wilmotnh.org/events/list/?ical=1",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=9+Kearsarge+Valley+Road%2C+Wilmot%2C+NH+03287&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-19",
  },
  // The Selectboard's own standing statement, for the nine sittings its feed
  // writes as `LOCATION:NH`. The board's page says it in its own words —
  // "The Selectboard meets every other Wednesday at 6:00 p.m. in the Town
  // Office Building at 9 Kearsarge Valley Road in Wilmot" — so this is a
  // sourced claim with a citation, not an inference from a sibling event.
  // Reached only when the feed itself gave nothing usable.
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:wilmot_town",
    match: "Wilmot Town Office Building",
    name: "Wilmot Town Office",
    address: "9 Kearsarge Valley Road, Wilmot, NH 03287",
    lat: 43.414131,
    lng: -71.901487,
    addressSourceUrl: "https://www.wilmotnh.org/board/board-of-selectmen/",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=9+Kearsarge+Valley+Road%2C+Wilmot%2C+NH+03287&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-19",
  },

  // ── SchedulePage: New London NH (M123, 2026-08-19) ──────────────────────
  // The town's calendar writes the venue INTO the event title — "Board of
  // Selectmen - 5:30 PM - Whipple Memorial Town Hall" — in three spellings
  // for the same building. All three are keyed, because a spelling variant
  // must never read as an unknown venue and send a real sitting to the drop
  // count.
  //
  // The address is New London's own: `newlondon.nh.gov`'s ELECTIONS & VOTING
  // page names "Whipple Memorial Town Hall, 25 Seamans Rd" as where the town
  // votes, which is the same hall its boards sit in. Read 2026-08-19 for
  // B19, cited here rather than re-hunted.
  {
    sourceId: "schedulepage",
    bodyOcdId:
      "ocd-division/country:us/state:nh/county:merrimack/place:new_london_town",
    match: "Whipple Memorial Town Hall",
    name: "Whipple Memorial Town Hall",
    address: "25 Seamans Road, New London, NH 03257",
    lat: 43.413148,
    lng: -71.980242,
    addressSourceUrl:
      "https://newlondon.nh.gov/?SEC=78EB571E-6FA5-46AB-B16D-CFF45739DF7E&Type=B_BASIC",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=25+Seamans+Road%2C+New+London%2C+NH+03257&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-19",
  },
  {
    sourceId: "schedulepage",
    bodyOcdId:
      "ocd-division/country:us/state:nh/county:merrimack/place:new_london_town",
    match: "Whipple Memorial Hall",
    name: "Whipple Memorial Town Hall",
    address: "25 Seamans Road, New London, NH 03257",
    lat: 43.413148,
    lng: -71.980242,
    addressSourceUrl:
      "https://newlondon.nh.gov/?SEC=78EB571E-6FA5-46AB-B16D-CFF45739DF7E&Type=B_BASIC",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=25+Seamans+Road%2C+New+London%2C+NH+03257&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-19",
  },
  {
    sourceId: "schedulepage",
    bodyOcdId:
      "ocd-division/country:us/state:nh/county:merrimack/place:new_london_town",
    match: "Whipple Hall",
    name: "Whipple Memorial Town Hall",
    address: "25 Seamans Road, New London, NH 03257",
    lat: 43.413148,
    lng: -71.980242,
    addressSourceUrl:
      "https://newlondon.nh.gov/?SEC=78EB571E-6FA5-46AB-B16D-CFF45739DF7E&Type=B_BASIC",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=25+Seamans+Road%2C+New+London%2C+NH+03257&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-19",
  },
  // ── SchedulePage: Kearsarge's KRMS deliberative session (HUNT03, 2026-08-19) ──
  // The gap g3 named and left open on 2026-08-16: "the January deliberative
  // session is held at KRMS rather than 114 Main Street and drops counted
  // until that address is curated". The wiring row has carried
  // `otherVenueMarkers: "KRMS"` since then, waiting on exactly this row.
  //
  // Recovered at RUNG 4, which is worth recording because rungs 2, 3 and a
  // second egress all take a 403 from this host: curl sending browser headers
  // is served, and `www.kearsarge.org/middle-school` states the address in
  // the district's own words — "Kearsarge Regional Middle School (KRMS) / 32
  // Gile Pond Road • North Sutton, NH 03260".
  {
    sourceId: "schedulepage",
    bodyOcdId:
      "ocd-division/country:us/state:nh/school_district:kearsarge_regional_school_district",
    match: "KRMS",
    name: "Kearsarge Regional Middle School",
    address: "32 Gile Pond Road, North Sutton, NH 03260",
    lat: 43.347731,
    lng: -71.933622,
    addressSourceUrl: "https://www.kearsarge.org/middle-school",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=32+Gile+Pond+Road%2C+North+Sutton%2C+NH+03260&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-19",
  },

  // The town's other named room, keyed on its own string. A board meeting at
  // the Town Office is at a different building from one at Whipple Hall, and
  // pinning both at the hall would send a reader to the wrong door.
  {
    sourceId: "schedulepage",
    bodyOcdId:
      "ocd-division/country:us/state:nh/county:merrimack/place:new_london_town",
    match: "New London Town Office",
    name: "New London Town Office",
    address: "375 Main Street, New London, NH 03257",
    lat: 43.413674,
    lng: -71.983147,
    addressSourceUrl: "https://newlondon.nh.gov/calendar",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=375+Main+Street%2C+New+London%2C+NH+03257&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-19",
  },
];

/**
 * The second key segment, which must never be a value two different bodies
 * can share (D31, g10).
 *
 * A division-less body used to key on `null`, and `null === null` — so the
 * cache silently treated every division-less body on a source as one body.
 * With one such body per source that is invisible; with two it hands a
 * reader the wrong building, which is the failure the whole venue cache
 * exists to prevent.
 *
 * The substitute is derived from the venue row's own `sourceId` plus the
 * caller's tenant, both of which the caller already has, so nothing new has
 * to be curated for the fix to hold. It is stated as a function rather than
 * inlined at the two call sites because a key computed in two places is a key
 * that gets computed two ways.
 */
export function venueScope(bodyOcdId: OcdId | null, tenant: string | null): string {
  return bodyOcdId ?? `${CURATED_PREFIX}tenant/${tenant ?? "unnamed"}`;
}

export function resolveVenue(
  sourceId: string,
  bodyOcdId: OcdId | null,
  rawLocation: string,
  /**
   * The source's own tenant for this body, when the body has no division —
   * `pcc`, `tusd1`. Optional so every existing caller keeps working; a
   * division-less body with no tenant given is scoped to "unnamed", which is
   * exactly the old behaviour and is the one case that can still collide. The
   * adapters that serve a division-less body pass it.
   */
  tenant: string | null = null,
): VenueEntry | undefined {
  const key = venueKey(rawLocation);
  const scope = venueScope(bodyOcdId, tenant);
  return VENUE_CACHE.find(
    (v) =>
      v.sourceId === sourceId &&
      venueScope(v.bodyOcdId, v.tenant ?? null) === scope &&
      venueKey(v.match) === key,
  );
}

/**
 * The one venue curated for a body, or nothing (M59, 2026-08-15).
 *
 * An archived meeting is a filename with a date on it: no venue string comes
 * with it, and a meeting with no coordinates cannot go on a map. This is the
 * honest way to place one — the body's OWN curated venue, the same row its
 * upcoming meetings resolve to — and it deliberately returns `undefined` when
 * a body has more than one, because "they usually meet at the complex" is a
 * guess about where a specific sitting was held and the reader would act on
 * it. Ambiguity drops the row as `unknownVenue` and it shows in the counts.
 */
export function soleVenueForBody(
  sourceId: string,
  bodyOcdId: OcdId | null,
): VenueEntry | undefined {
  const matches = VENUE_CACHE.filter(
    (v) => v.sourceId === sourceId && v.bodyOcdId === bodyOcdId,
  );
  return matches.length === 1 ? matches[0] : undefined;
}
