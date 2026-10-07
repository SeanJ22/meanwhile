import { CURATED_PREFIX } from "../ocd/curated.ts";
import type { MeetingVenueGap, OcdId } from "../sources/types.ts";
import { currentCuratedReaderRecords } from "../civic-data/curated-reader-read-model.ts";
import { exactVenueMatchContentKey } from "./venue-record-identity.ts";

/**
 * Venue resolutions keyed on `(sourceId, bodyScope, rawLocationString)`. An unknown venue never places a meeting and
 * never suppresses one: the sitting is published with `location: null`, its gap named, and counted as `unknownVenue`.
 * For a source with no location field the meeting name stands in as the raw string.
 */
export interface VenueEntry {
  /** Adapter name, e.g. "onbase". First key segment. */
  sourceId: string;
  /** The body whose meetings this applies to; null for a body with no Census division (see `venueScope`). */
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

/** Location strings naming a real meeting with no physical place: kept as online, counted apart from an unknown venue. */
export const PLACELESS_LOCATIONS = [
  "virtual meeting",
  "virtual",
  "zoom",
  "via zoom",
  "webex",
  "via zoom webinar",
  "zoom webinar",
  "microsoft teams (virtual)",
  "microsoft teams virtual",
  "zoom (virtual)",
  "virtual event",
];

/** Reduce a location string to something two spellings of one room agree on. */
export function venueKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Exact identity for one reviewed spelling; stricter than `venueKey()` so two published spellings never collapse. */
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
 * The named gap for a sitting kept without a reviewed place. Words: `STATED_NOT_PLACED`, the gap is ours and the
 * words render as text. No words: `NOT_STATED_BY_PUBLISHER`, the gap is the publisher's.
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
  // Test seed only: currentVenueCache() serves this array only in the explicit test seam.
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

  {
    sourceId: "diligent",
    bodyOcdId: null,
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
    // A different spelling of the same room gets its own row: venueKey does not reorder words.
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

/** The reviewed venues an adapter scope may place sittings with. An empty scope is a real state, never an error. */
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

/** The second key segment, never a value two bodies can share: a division-less body is scoped by source and tenant. */
export function venueScope(bodyOcdId: OcdId | null, tenant: string | null): string {
  return bodyOcdId ?? `${CURATED_PREFIX}tenant/${tenant ?? "unnamed"}`;
}

export function resolveVenue(
  sourceId: string,
  bodyOcdId: OcdId | null,
  rawLocation: string,
  /** The source's own tenant for a body with no division; without one the body is scoped to "unnamed". */
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
 * The one venue curated for a body, or undefined when it has none or more than one: placing an archived sitting at one
 * of several venues would be a guess.
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
