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
   * Null for a body with no Census division (D28) — the key then degrades to
   * `(sourceId, rawLocationString)`, which holds until two division-less
   * bodies share a source and a location string; D31 owns the real fix.
   */
  bodyOcdId: OcdId | null;
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
];

export function resolveVenue(
  sourceId: string,
  bodyOcdId: OcdId | null,
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
