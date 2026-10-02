import { CURATED_PREFIX } from "../ocd/curated.ts";
import type { MeetingVenueGap, OcdId } from "../sources/types.ts";
import { currentCuratedReaderRecords } from "../civic-data/curated-reader-read-model.ts";
import { exactVenueMatchContentKey } from "./venue-record-identity.ts";

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
 * The contract stands regardless of who wrote the row, and it has two halves
 * (the venue-gap class, 2026-09-23):
 *
 * - **An unknown venue never places a meeting.** A pin in roughly the right
 *   place is a fabricated citation wearing a map marker, so a sitting whose
 *   place has no reviewed row here gets no coordinates and no pin.
 * - **An unknown venue never suppresses a meeting, and never fails a
 *   partition.** The sitting is published with `location: null` and its gap
 *   named (`unplacedVenueGap` below: the publisher's own words for the place,
 *   or the publisher's own silence), and the adapter still counts it as
 *   `unknownVenue` — kept, not dropped — so the ingest report and the venue
 *   hunt see every place still owed a reviewed row. The owner's rule, from the
 *   Tucson Unified regression: *"Missing agenda text or location must never
 *   suppress a meeting."*
 *
 * One source publishes no location string at all: Hyland OnBase's meeting list
 * has no location field anywhere (verified against both the list and the
 * ViewMeeting page). For that source the *meeting name* stands in as the raw
 * string, because it is the only observed text that distinguishes one venue
 * from another — the entry's `match` documents which published string it keys
 * on. That name is also the only thing that says a row is the wired body's
 * sitting at all (the tenant lists other bodies' meetings too), so a name that
 * matches nothing still drops as unknownVenue there: it is not an otherwise
 * verified sitting of this body, and publishing it would attribute another
 * body's meeting to this one.
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
 * Kept as an online sitting (D18) and counted separately from an unknown
 * venue — "there is nothing to place" and "we could not place it" are
 * different facts.
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
  // …and "Zoom (Virtual)" (the Public Art and Community Design Committee's
  // page, 2026-09-24): filed as a stated place with no pin until then.
  "zoom (virtual)",
  // CivicClerk's own value for an online sitting (CAWCD, 2026-08-27).
  "virtual event",
];

/** Reduce a location string to something two spellings of one room agree on. */
export function venueKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Durable identity for one exact reviewed venue spelling.
 *
 * Lookup deliberately uses `venueKey()` so punctuation/whitespace variants
 * resolve to the same place. Storage identity must be stricter: two exact
 * publisher spellings may coexist as evidence and must not collapse into one
 * manual-projection member merely because lookup normalizes them alike.
 */
export function venueResolutionRecordId(
  value: Pick<VenueEntry, "sourceId" | "bodyOcdId" | "tenant" | "match">,
): string {
  return `venue:${value.sourceId}:${venueScope(value.bodyOcdId, value.tenant ?? null)}:${venueKey(value.match)}:${exactVenueMatchContentKey(value.match)}`;
}

export function isPlacelessLocation(raw: string): boolean {
  const key = venueKey(raw);
  return PLACELESS_LOCATIONS.some((p) => venueKey(p) === key);
}

/**
 * **THE NAMED GAP FOR A SITTING KEPT WITHOUT A REVIEWED PLACE** — one
 * construction for every adapter (the venue-gap class, 2026-09-23;
 * `MeetingVenueGap` in `lib/sources/types.ts`, read by `lib/meetings/online.ts`).
 *
 * `stated` is the place exactly as the sitting's own record published it, in
 * the words the adapter read (its location field, or the parts of it the
 * publisher printed). Two readings, and only two:
 *
 * - words → `STATED_NOT_PLACED`: the publisher stated the place and the gap is
 *   ours — no reviewed coordinates — so the words render as text, never a pin.
 * - no words (null, empty, whitespace) → `NOT_STATED_BY_PUBLISHER`: the
 *   record's place field is blank, and the gap is the publisher's.
 *
 * `publisher` is whose record it is (the wiring row's `publishingOrg`), the
 * name the gap line cites. The caller sets it beside `location: null` and
 * never beside `online`; a placeless string ("Virtual Meeting") is online
 * (D18), not a venue gap, and is decided before this is reached. A route with
 * no place field for the sitting at all (a dated archive, a name-keyed list)
 * has nothing to quote and nothing blank to cite: it keeps our own
 * place-not-recorded gap and does not call this.
 */
export function unplacedVenueGap(
  stated: string | null | undefined,
  publisher: string,
): MeetingVenueGap {
  const words = (stated ?? "").trim();
  return words
    ? { kind: "STATED_NOT_PLACED", publishedText: words, publisher }
    : { kind: "NOT_STATED_BY_PUBLISHER", publishedText: null, publisher };
}

/** Initial adoption/node:test evidence; production reads `venue-resolutions`. */
export const VENUE_CACHE: VenueEntry[] = [
  // ── Legistar/InSite adoption seed ────────────────────────────────────────
  // These three rows preserve the historical adapter fixtures for node:test.
  // Production cannot reach them: currentVenueCache() serves this array only
  // in the explicit test seam and otherwise requires the promoted projection.
  {
    sourceId: "legistar",
    bodyOcdId: "ocd-division/country:us/state:az/county:pima",
    match: "Board of Supervisors Hearing Room",
    name: "Pima County Administration Building, Board of Supervisors Hearing Room",
    address: "130 W. Congress St. 1st Floor, Tucson, AZ 85701",
    lat: 32.221618,
    lng: -110.974036,
    addressSourceUrl: "https://www.pima.gov/government/board_of_supervisors/",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=130+W+Congress+St%2C+Tucson%2C+AZ+85701&benchmark=Public_AR_Current&format=json",
    verifiedAt: null,
  },
  {
    sourceId: "legistar",
    bodyOcdId: "ocd-division/country:us/state:az/county:pima",
    match: "1 E. Broadway, 4th Floor",
    name: "1 E. Broadway Blvd, 4th Floor",
    address: "1 E. Broadway Blvd, Tucson, AZ 85701",
    lat: 32.221075,
    lng: -110.971059,
    addressSourceUrl: "https://pima.legistar.com/Calendar.aspx",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=1+E+Broadway+Blvd%2C+Tucson%2C+AZ+85701&benchmark=Public_AR_Current&format=json",
    verifiedAt: null,
  },
  {
    sourceId: "legistar-insite",
    bodyOcdId: "ocd-division/country:us/state:az/place:mesa",
    match: "Council Chambers",
    name: "Mesa City Hall, Council Chambers",
    address: "20 E. Main Street, Mesa, AZ 85201",
    lat: 33.415155,
    lng: -111.830942,
    addressSourceUrl: "https://www.mesaaz.gov/Government/City-Council-Meetings",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=20+E+Main+St%2C+Mesa%2C+AZ+85201&benchmark=Public_AR_Current&format=json",
    verifiedAt: null,
  },

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

  // ── iCal: SPRINGFIELD, one of the six Kearsarge member towns that had no
  // bodies in this registry at all (NH Hunt 3, 2026-08-21).
  //
  // The town publishes `springfieldnh.org/events/list/?ical=1` — 50 events
  // naming EIGHT distinct governing bodies, measured 2026-08-21. Nothing had
  // ever asked it for one, which is the whole finding: the branch was one
  // request away and six of seven member towns were dark.
  //
  // **The venue comes from the feed's own LOCATION line**, not from a guess or
  // a neighbouring event: every one of the 50 events carries the full street
  // address, in two spellings of the same room —
  //
  //     LOCATION:Protectworth Room, 2750 Main Street, Springfield, NH, 03284
  //     LOCATION:Protectworth Room Springfield Town Office, 2750 Main Street, …
  //
  // so `match` is the shorter one both spellings contain. The coordinates are
  // the Census geocoder's for the address the town itself published, and the
  // URL that produced them is recorded beside them like every other row here.
  {
    sourceId: "ical",
    bodyOcdId:
      "ocd-division/country:us/state:nh/county:sullivan/place:springfield_town",
    match: "Protectworth Room",
    name: "Protectworth Room, Springfield Town Office",
    address: "2750 Main Street, Springfield, NH 03284",
    lat: 43.493209922548,
    lng: -72.048060472105,
    addressSourceUrl: "https://springfieldnh.org/events/list/?ical=1",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=2750+Main+Street%2C+Springfield%2C+NH+03284&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },

  // ── SchedulePage: Newbury's Zoning Board of Adjustment ──────────────────
  // The row that took a body from KNOWN_UNCOVERED to LIVE with no other
  // change, 2026-08-15 (the mobile round-two session), and the reason the
  // three prior rungs missed it: **the address is not in the page's text.**
  // The board's own page carries a "Contact Info" pane whose `street-address`
  // block reads `937 Route 103 / PO Box 296 / Newbury, NH 03255` beside a
  // `See map: Google Maps` link (`maps.google.com?q=937+Route+103%2C+Newbury%2C
  // +NH%2C+03255%2C+us`) — machine-readable markup, invisible to a reader
  // scanning prose for "the meeting is at". It was found in a browser via the
  // map link and taken as the meeting address for this board.
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

  /*
   * ── SUTTON, NH — THE PLANNING BOARD'S OWN STANDING STATEMENT ────────────
   * (NH Hunt 6, 2026-08-21, item 4.)
   *
   * Sutton has been dark since NH Hunt 4, and the retrieval was never the
   * problem. Its calendar answers rung 2 with 370,587 bytes and 1,312 events
   * naming sixteen governing bodies, and **not one of them carries a
   * `LOCATION` line** — 0 non-empty of 1,312, counted. What stopped the
   * wiring was a COORDINATE: the Census geocoder was asked four ways and
   * answered Bradford NH twice, Sutton MASSACHUSETTS once, and no match once.
   * A pin is a claim, so the row could not be written.
   *
   * Two things broke that open on 2026-08-21, and both are branches rather
   * than cleverness:
   *
   * 1. **The board's page was behind Cloudflare and RUNG 5 reached it.**
   *    `suttonnh.gov` refuses rungs 2, 3 and 4 on its HTML — "Just a
   *    moment...", HTTP 403 — while serving its `.ics` export at rung 2 with
   *    no challenge at all. A path-scoped wall on one host, and the document
   *    that states the venue was on the walled side.
   * 2. **A SECOND, independent geocoder settled the point.** OpenStreetMap
   *    returns `43.334070, -71.953113` labelled *Sutton Town Hall, 93 Main
   *    Street, Sutton, Merrimack County, New Hampshire* — 38 metres from the
   *    Census point. The Census COORDINATE was right the whole time; only its
   *    city LABEL was wrong, because TIGER attributes the 89–99 MAIN ST range
   *    to Bradford. A session reading the label and discarding the point threw
   *    away a correct answer. `pnpm geocode` now walks both and reports the
   *    pair, never one figure.
   *
   * **Only the Planning Board is wired**, and that is the discipline rather
   * than a shortfall. Its page states the venue in the town's own words: *"The
   * Sutton Planning Board meets at the Pillsbury Memorial Hall, 93 Main
   * Street, Sutton Mills, NH on the second Tuesday of the month at 7:00 pm."*
   * The other fifteen board pages carry "93 Main Street | Sutton Mills" in the
   * SITE FOOTER — the town's own postal address, not a statement about where
   * that board sits. Reading a footer as a venue would pin fifteen bodies at a
   * building on the strength of a template, which is the guess dressed as a
   * fact that NH Hunt 4 refused, and refusing it again is the same decision.
   *
   * ── SUPERSEDED IN PART BY RULING 65 (2026-08-21; applied 2026-08-22, NJ
   * Hunt item 2.1). The paragraph above is kept verbatim rather than rewritten,
   * because it is the reasoning that was revisited and a later session must be
   * able to read both halves. ──────────────────────────────────────────────
   *
   * The revised position: **one address hosting several bodies is normal in
   * small and large towns alike**, and the footer address is used and the
   * route recorded. Fifteen bodies dark because the town uses a site template
   * is a worse answer for a reader than fifteen bodies pinned at the address
   * the town itself publishes.
   *
   * What survives of the refusal above, and it is the load-bearing half: a
   * footer address is NOT the board's own statement about itself, so the row
   * below cites the FOOTER and says so, and `pnpm venue:hunt` reports it under
   * its own `FOOTER ADDRESS` status rather than as `STATES A VENUE`. The two
   * kinds of claim never render alike and never merge.
   *
   * **And the ruling has a boundary the hunt found immediately.** Three Sutton
   * bodies were deliberately NOT given this address, because the footer is
   * evidence about the TOWN and each of these has better evidence about
   * ITSELF:
   *
   *   - **Ad Hoc Speed Sign Committee** — its own feed titles read *"Ad Hoc
   *     Speed Sign Committee - Zoom Mtg"*. A body that says it meets on Zoom
   *     does not meet at 93 Main Street, and pinning it there would send a
   *     reader to a building nobody will be in.
   *   - **Warner River Local Advisory Committee** — its titles read *"WRLAC Mtg
   *     @ Pillsbury Library"*. It is a multi-town river committee and its own
   *     title names a venue this hunt could not resolve to a coordinate; the
   *     honest answer is to leave it unpinned and hunt the library's address,
   *     not to substitute Sutton's town hall for a venue the body itself named.
   *   - **Sutton Free Library Board of Trustees** — its page states its own
   *     meeting arrangement, so it is a `STATES A VENUE` case and not this one.
   *
   * That boundary is the rule working. RULING 65 fills a gap where the body
   * says nothing; it never overrides a body that says something.
   */
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:sutton_town",
    match: "Pillsbury Memorial Hall",
    name: "Pillsbury Memorial Hall",
    address: "93 Main Street, Sutton Mills, NH 03221",
    lat: 43.33407,
    lng: -71.953113,
    addressSourceUrl: "https://www.suttonnh.gov/planning-board",
    coordinateSourceUrl:
      "https://nominatim.openstreetmap.org/search?street=93%20Main%20Street&city=Sutton&state=NH&country=USA&format=jsonv2&limit=1&addressdetails=1",
    verifiedAt: "2026-08-21",
  },

  /*
   * ── SUTTON, NH — THE FOOTER ADDRESS (RULING 65, 2026-08-22, NJ Hunt item
   * 2.1) ───────────────────────────────────────────────────────────────────
   *
   * The town's own site footer, on every board page: *"93 Main Street | Sutton
   * Mills, NH 03221 | (603) 927-2408"*. Read at rung 2 on 2026-08-22 from nine
   * board pages, identical on all nine.
   *
   * **This is a SEPARATE ROW from the Planning Board's Pillsbury Memorial Hall
   * above even though the street address is the same string**, and that is
   * deliberate rather than duplication. The two rows rest on different
   * evidence: one is a board's published sentence about where that board sits,
   * the other is a municipality's published postal address. Merging them would
   * make the Planning Board's citation carry eight other bodies, and a reader
   * clicking through would land on a page that says nothing about theirs.
   *
   * The COORDINATE is the one already verified for this address on 2026-08-21
   * by two independent geocoders, 38 metres apart — reused rather than
   * re-derived, and reused because it is the same street address, which is a
   * statement about geography and not about which body meets there.
   */
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:sutton_town",
    match: "Sutton Town Offices",
    name: "Sutton Town Offices, 93 Main Street",
    address: "93 Main Street, Sutton Mills, NH 03221",
    lat: 43.33407,
    lng: -71.953113,
    addressSourceUrl: "https://www.suttonnh.gov/select-board",
    coordinateSourceUrl:
      "https://nominatim.openstreetmap.org/search?street=93%20Main%20Street&city=Sutton&state=NH&country=USA&format=jsonv2&limit=1&addressdetails=1",
    verifiedAt: "2026-08-22",
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

  // ── Bradford and Warner, NH — the rooms their own calendars name ────────
  //
  // (NH Hunt 4, 2026-08-21, item 3.) Both towns publish a public Google
  // Calendar and both write a real street address into most events. What they
  // do NOT do is write it consistently: Warner's Town Hall appears under
  // ELEVEN distinct spellings on one calendar — with and without the town
  // name, with the room, with two spaces before the zip, and once as "Town
  // Hall - Main Auditorium". Each spelling is its own row here rather than a
  // fuzzy match, because a fuzzy match that got it wrong would send a reader
  // to the wrong building and nothing would catch it.
  //
  // Every address is the town's own; every coordinate is the Census geocoder's
  // and its query URL is recorded beside it.
  //
  // **NOT keyed, deliberately:** Bradford writes a Zoom URL into LOCATION on
  // 24 of its events. A Zoom link is a real fact about a meeting and it is not
  // a building; pinning it at the town hall would be a fabricated location, so
  // those rows drop as unknownVenue and appear in the counts.
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town",
    match: "75 W Main St, Bradford, NH 03221, USA",
    name: "Bradford Town Hall",
    address: "75 West Main Street, Bradford, NH 03221",
    lat: 43.269503712555,
    lng: -71.960454157651,
    addressSourceUrl: "https://bradfordnh.gov/pages/boards-and-committees",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=75%20West%20Main%20Street%2C%20Bradford%2C%20NH%2003221&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town",
    match: "75 W Main St, Bradford, NH 03221",
    name: "Bradford Town Hall",
    address: "75 West Main Street, Bradford, NH 03221",
    lat: 43.269503712555,
    lng: -71.960454157651,
    addressSourceUrl: "https://bradfordnh.gov/pages/boards-and-committees",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=75%20West%20Main%20Street%2C%20Bradford%2C%20NH%2003221&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town",
    match: "134 E Main St, Bradford, NH 03221, USA",
    name: "Bradford Area Community Center",
    address: "134 East Main Street, Bradford, NH 03221",
    lat: 43.26864360687,
    lng: -71.955354154019,
    addressSourceUrl: "https://bradfordnh.gov/pages/boards-and-committees",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=134%20East%20Main%20Street%2C%20Bradford%2C%20NH%2003221&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town",
    match: "134 E Main St, Bradford, NH 03221",
    name: "Bradford Area Community Center",
    address: "134 East Main Street, Bradford, NH 03221",
    lat: 43.26864360687,
    lng: -71.955354154019,
    addressSourceUrl: "https://bradfordnh.gov/pages/boards-and-committees",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=134%20East%20Main%20Street%2C%20Bradford%2C%20NH%2003221&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town",
    match: "Brown Memorial Library, 78 W Main St, Bradford, NH 03221, USA",
    name: "Brown Memorial Library",
    address: "78 West Main Street, Bradford, NH 03221",
    lat: 43.269618481554,
    lng: -71.960695973068,
    addressSourceUrl: "https://bradfordnh.gov/pages/boards-and-committees",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=78%20West%20Main%20Street%2C%20Bradford%2C%20NH%2003221&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town",
    match: "78 W Main St, Bradford, NH 03221, USA",
    name: "Brown Memorial Library",
    address: "78 West Main Street, Bradford, NH 03221",
    lat: 43.269618481554,
    lng: -71.960695973068,
    addressSourceUrl: "https://bradfordnh.gov/pages/boards-and-committees",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=78%20West%20Main%20Street%2C%20Bradford%2C%20NH%2003221&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town",
    match: "Brown Memorial Library",
    name: "Brown Memorial Library",
    address: "78 West Main Street, Bradford, NH 03221",
    lat: 43.269618481554,
    lng: -71.960695973068,
    addressSourceUrl: "https://bradfordnh.gov/pages/boards-and-committees",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=78%20West%20Main%20Street%2C%20Bradford%2C%20NH%2003221&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town",
    match: "Warner Town Hall, 5 E Main St, Warner, NH 03278, USA",
    name: "Warner Town Hall",
    address: "5 East Main Street, Warner, NH 03278",
    lat: 43.280620022052,
    lng: -71.815803778788,
    addressSourceUrl: "https://warnernh.gov/departments/selectboard/",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=5%20East%20Main%20Street%2C%20Warner%2C%20NH%2003278&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town",
    match: "Town Hall, 5 East Main St. Warner, NH 03278",
    name: "Warner Town Hall",
    address: "5 East Main Street, Warner, NH 03278",
    lat: 43.280620022052,
    lng: -71.815803778788,
    addressSourceUrl: "https://warnernh.gov/departments/selectboard/",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=5%20East%20Main%20Street%2C%20Warner%2C%20NH%2003278&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town",
    match: "Town Hall, 5 East Main St. Warner, NH  03278",
    name: "Warner Town Hall",
    address: "5 East Main Street, Warner, NH 03278",
    lat: 43.280620022052,
    lng: -71.815803778788,
    addressSourceUrl: "https://warnernh.gov/departments/selectboard/",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=5%20East%20Main%20Street%2C%20Warner%2C%20NH%2003278&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town",
    match: "Town Hall, 5 E. Main St., Warner NH 03278",
    name: "Warner Town Hall",
    address: "5 East Main Street, Warner, NH 03278",
    lat: 43.280620022052,
    lng: -71.815803778788,
    addressSourceUrl: "https://warnernh.gov/departments/selectboard/",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=5%20East%20Main%20Street%2C%20Warner%2C%20NH%2003278&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town",
    match: "Town Hall, Lower-Level Meeting Room",
    name: "Warner Town Hall",
    address: "5 East Main Street, Warner, NH 03278",
    lat: 43.280620022052,
    lng: -71.815803778788,
    addressSourceUrl: "https://warnernh.gov/departments/selectboard/",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=5%20East%20Main%20Street%2C%20Warner%2C%20NH%2003278&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town",
    match: "Town Hall - Lower Level",
    name: "Warner Town Hall",
    address: "5 East Main Street, Warner, NH 03278",
    lat: 43.280620022052,
    lng: -71.815803778788,
    addressSourceUrl: "https://warnernh.gov/departments/selectboard/",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=5%20East%20Main%20Street%2C%20Warner%2C%20NH%2003278&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town",
    match: "Town Hall - Main Auditorium",
    name: "Warner Town Hall",
    address: "5 East Main Street, Warner, NH 03278",
    lat: 43.280620022052,
    lng: -71.815803778788,
    addressSourceUrl: "https://warnernh.gov/departments/selectboard/",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=5%20East%20Main%20Street%2C%20Warner%2C%20NH%2003278&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town",
    match: "Warner Town Hall",
    name: "Warner Town Hall",
    address: "5 East Main Street, Warner, NH 03278",
    lat: 43.280620022052,
    lng: -71.815803778788,
    addressSourceUrl: "https://warnernh.gov/departments/selectboard/",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=5%20East%20Main%20Street%2C%20Warner%2C%20NH%2003278&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town",
    match: "Warner Town Hall, Second Floor",
    name: "Warner Town Hall",
    address: "5 East Main Street, Warner, NH 03278",
    lat: 43.280620022052,
    lng: -71.815803778788,
    addressSourceUrl: "https://warnernh.gov/departments/selectboard/",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=5%20East%20Main%20Street%2C%20Warner%2C%20NH%2003278&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town",
    match: "Warner Town Hall, Main Floor, Stage",
    name: "Warner Town Hall",
    address: "5 East Main Street, Warner, NH 03278",
    lat: 43.280620022052,
    lng: -71.815803778788,
    addressSourceUrl: "https://warnernh.gov/departments/selectboard/",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=5%20East%20Main%20Street%2C%20Warner%2C%20NH%2003278&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town",
    match: "Lower Meeting Room, Warner Town Hall, 5 E Main St, Warner, NH 03278, USA",
    name: "Warner Town Hall",
    address: "5 East Main Street, Warner, NH 03278",
    lat: 43.280620022052,
    lng: -71.815803778788,
    addressSourceUrl: "https://warnernh.gov/departments/selectboard/",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=5%20East%20Main%20Street%2C%20Warner%2C%20NH%2003278&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town",
    match: "Pillsbury Free Library, 18 E Main St, Warner, NH 03278, USA",
    name: "Pillsbury Free Library",
    address: "18 East Main Street, Warner, NH 03278",
    lat: 43.280221446826,
    lng: -71.81523993338,
    addressSourceUrl: "https://warnernh.gov/calendar/",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=18%20East%20Main%20Street%2C%20Warner%2C%20NH%2003278&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town",
    match: "Pillsbury Library Meeting Room",
    name: "Pillsbury Free Library",
    address: "18 East Main Street, Warner, NH 03278",
    lat: 43.280221446826,
    lng: -71.81523993338,
    addressSourceUrl: "https://warnernh.gov/calendar/",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=18%20East%20Main%20Street%2C%20Warner%2C%20NH%2003278&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town",
    match: "Frank Maria Meeting Room at the Library,",
    name: "Pillsbury Free Library",
    address: "18 East Main Street, Warner, NH 03278",
    lat: 43.280221446826,
    lng: -71.81523993338,
    addressSourceUrl: "https://warnernh.gov/calendar/",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=18%20East%20Main%20Street%2C%20Warner%2C%20NH%2003278&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town",
    match: "Warner Highway Garage, 190 New Hampshire Rte 103, Warner, NH 03278, USA",
    name: "Warner Highway Garage",
    address: "190 NH Route 103, Warner, NH 03278",
    lat: 43.267454583198,
    lng: -71.782203179225,
    addressSourceUrl: "https://warnernh.gov/calendar/",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=190%20NH%20Route%20103%2C%20Warner%2C%20NH%2003278&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town",
    match: "190 New Hampshire Rte 103, Warner, NH 03278, USA",
    name: "Warner Highway Garage",
    address: "190 NH Route 103, Warner, NH 03278",
    lat: 43.267454583198,
    lng: -71.782203179225,
    addressSourceUrl: "https://warnernh.gov/calendar/",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=190%20NH%20Route%20103%2C%20Warner%2C%20NH%2003278&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },
  {
    sourceId: "ical",
    bodyOcdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town",
    match: "Warner Fire Department, 148 W Main St, Warner, NH 03278, USA",
    name: "Warner Fire Department",
    address: "148 West Main Street, Warner, NH 03278",
    lat: 43.286030243565,
    lng: -71.826973213785,
    addressSourceUrl: "https://warnernh.gov/calendar/",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=148%20West%20Main%20Street%2C%20Warner%2C%20NH%2003278&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-21",
  },

  // ── CivicClerk: Central Arizona Water Conservation District ─────────────
  // The district's sittings are in PHOENIX and its readers here are in Pima
  // County, 180 km away. That is not a mismatch to hide: it taxes every parcel
  // in Pima County and this is where it decides. `match` is the API's own
  // assembled address string verbatim, punctuation and doubled commas
  // included, because venueKey strips them and a tidied copy would stop
  // matching the day the tenant tidies theirs.
  {
    sourceId: "civicclerk",
    bodyOcdId: "ocd-division/country:us/state:az/county:pima",
    tenant: "capaz",
    match: "23636 N. 7th Street -, Board Room,, Phoenix, AZ, 85024",
    name: "CAP Headquarters, Board Room",
    address: "23636 N 7th Street, Phoenix, AZ 85024",
    lat: 33.701204,
    lng: -112.065793,
    addressSourceUrl: "https://capaz.portal.civicclerk.com",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=23636%20N%207th%20Street%2C%20Phoenix%2C%20AZ%2085024&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-27",
  },
  {
    sourceId: "civicclerk",
    bodyOcdId: "ocd-division/country:us/state:az/county:pima",
    tenant: "capaz",
    match:
      "23636 N 7th Street, - Lake Mead Conference Room - Building 2 -, Phoenix, AZ, 85024",
    name: "CAP Headquarters, Lake Mead Conference Room, Building 2",
    address: "23636 N 7th Street, Phoenix, AZ 85024",
    lat: 33.701204,
    lng: -112.065793,
    addressSourceUrl: "https://capaz.portal.civicclerk.com",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=23636%20N%207th%20Street%2C%20Phoenix%2C%20AZ%2085024&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-27",
  },
  {
    /*
     * The SAME room as the row above, spelt differently by the same tenant on
     * a different event — the room name and the building swap places. venueKey
     * strips punctuation and case but not word order, which is deliberate:
     * fuzzy matching a venue is how a reader ends up at the wrong address. A
     * new published spelling gets a new row, and until it does the meeting
     * drops and is counted as an unknown venue rather than pinned to a guess.
     */
    sourceId: "civicclerk",
    bodyOcdId: "ocd-division/country:us/state:az/county:pima",
    tenant: "capaz",
    match:
      "23636 N 7th Street, Building 2 - Lake Mead Conference Room, Phoenix, AZ, 85024",
    name: "CAP Headquarters, Lake Mead Conference Room, Building 2",
    address: "23636 N 7th Street, Phoenix, AZ 85024",
    lat: 33.701204,
    lng: -112.065793,
    addressSourceUrl: "https://capaz.portal.civicclerk.com",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=23636%20N%207th%20Street%2C%20Phoenix%2C%20AZ%2085024&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-27",
  },
  {
    sourceId: "civicclerk",
    bodyOcdId: "ocd-division/country:us/state:az/county:pima",
    tenant: "capaz",
    match: "Musical Instrument Museum, 4725 E Mayo Blvd, Phoenix, AZ, 85050",
    name: "Musical Instrument Museum",
    address: "4725 E Mayo Boulevard, Phoenix, AZ 85050",
    lat: 33.668572,
    lng: -111.979311,
    addressSourceUrl: "https://capaz.portal.civicclerk.com",
    coordinateSourceUrl:
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=4725%20E%20Mayo%20Blvd%2C%20Phoenix%2C%20AZ%2085050&benchmark=Public_AR_Current&format=json",
    verifiedAt: "2026-08-27",
  },
];

/** The exact currently promoted venue-resolution projection. */
export function currentVenueCache(): readonly VenueEntry[] {
  const seed = VENUE_CACHE.map((value) => ({
    id: venueResolutionRecordId(value),
    ...value,
  }));
  return currentCuratedReaderRecords("venue-resolutions", seed).map(({ id: _id, ...value }) => value as unknown as VenueEntry);
}

/**
 * The reviewed venues an adapter scope may place sittings with — possibly none.
 *
 * The default projection is deliberately evaluated at property-access time:
 * production boot first reads the promoted pointer, while node:test may use
 * the explicit adoption seed above.
 *
 * **An empty scope is a real state, never an error** (the venue-gap class,
 * 2026-09-23). This was `requiredVenueEntries`, and it threw
 * `VENUE_RESOLUTIONS_MISSING` for a scope with no row, on the reasoning that an
 * adapter handed zero venues would read them as zero meetings and silently
 * suppress every sitting. The danger was real and the remedy was the danger:
 * when the promoted table left out the three Legistar rows (`verifiedAt: null`),
 * the throw failed every routine read of Pima County's Board of Supervisors
 * (both Legistar routes) and Mesa's City Council from 2026-09-14 12:45Z, and
 * readers were served the 14 September listing throughout. Failing the whole
 * partition suppressed every sitting in it.
 *
 * The guarantee now lives where sittings are made, and it holds with an empty
 * scope: the Legistar and InSite adapters read every client and tenant (none
 * is skipped for want of a coordinate), a room with no reviewed row is
 * published with no place and the publisher's words as its named gap
 * (`unplacedVenueGap`), and each such sitting is counted as `unknownVenue` —
 * kept, not dropped — so the unreviewed scope stays visible to the ingest
 * report and the venue hunt. Nothing here can fail a partition for want of a
 * venue. A projection that cannot be READ at all is a different failure, and it
 * still fails closed in `currentCuratedReaderRecords`.
 */
export function reviewedVenueEntries(
  sourceId: string,
  bodyOcdId: OcdId | null,
  tenant: string | null = null,
  projection: readonly VenueEntry[] = currentVenueCache(),
): VenueEntry[] {
  const scope = venueScope(bodyOcdId, tenant);
  return projection.filter(
    (venue) =>
      venue.sourceId === sourceId &&
      venueScope(venue.bodyOcdId, venue.tenant ?? null) === scope,
  );
}

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
  projection?: readonly VenueEntry[],
): VenueEntry | undefined {
  const key = venueKey(rawLocation);
  const scope = venueScope(bodyOcdId, tenant);
  return (projection ?? currentVenueCache()).find(
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
 * it. Ambiguity (or no row at all) leaves the archived sitting unplaced: it is
 * still published, with our own place-not-recorded gap, and counted as
 * `unknownVenue` so it shows in the counts (the venue-gap class, 2026-09-23).
 */
export function soleVenueForBody(
  sourceId: string,
  bodyOcdId: OcdId | null,
  projection?: readonly VenueEntry[],
): VenueEntry | undefined {
  const matches = (projection ?? currentVenueCache()).filter(
    (v) => v.sourceId === sourceId && v.bodyOcdId === bodyOcdId,
  );
  return matches.length === 1 ? matches[0] : undefined;
}
