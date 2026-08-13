import type { OcdId } from "../sources/types.ts";
import type { AgendaSourceType } from "./types.ts";

/**
 * Which bodies the composite meeting source serves, and how — 4.6.4.
 *
 * **Adding a body is adding a row here.** The composite dispatches on
 * `agendaSourceType`; each adapter reads the rows declaring its type and never
 * carries its own hardcoded body list. Registering a new adapter is one entry
 * in `lib/sources/composite/wiring.ts`; wiring the next thousand bodies is
 * rows in this file — and, once persistence lands, rows in a table this file
 * is the committed forerunner of. That is the §0b requirement: at 90,000
 * governments nobody can edit code per body.
 *
 * Every row was written from a recorded source hunt — see
 * `lib/registry/coverage-audit.ts` for the rungs walked and
 * `docs/source-ladder.md` for the ladder itself. `config` keys are documented
 * by the adapter that reads them; URLs in `config` were all verified live on
 * the date in `verifiedAt`.
 */
export interface BodySourceWiring {
  /** Matches `Body.id` in the registry exactly. */
  bodyId: string;
  /** The division whose government meets. The join key on every Meeting. */
  ocdId: OcdId;
  agendaSourceType: AgendaSourceType;
  /** Display only — never joined on. */
  jurisdiction: string;
  /** Who published the records. The public body, never the vendor. */
  publishingOrg: string;
  /** IANA zone the body meets in. */
  timeZone: string;
  /** Per-adapter settings. Keys are documented by the adapter. */
  config: Record<string, string>;
  /** When the URLs in config were last confirmed working. */
  verifiedAt: string;
}

export const SOURCE_WIRING: BodySourceWiring[] = [
  // ── Legistar ────────────────────────────────────────────────────────────
  // The adapter keeps its own client registry (lib/sources/legistar/clients.ts)
  // including the curated venue table; this row is what routes the body to it.
  {
    bodyId: "ocd-division/country:us/state:az/county:pima#governing",
    ocdId: "ocd-division/country:us/state:az/county:pima",
    agendaSourceType: "LEGISTAR",
    jurisdiction: "Pima County, AZ",
    publishingOrg: "Pima County Clerk of the Board",
    timeZone: "America/Phoenix",
    config: { slug: "pima" },
    verifiedAt: "2026-08-13",
  },

  // ── Hyland OnBase Agenda Online ─────────────────────────────────────────
  // D16 reversed 2026-08-13: the terms enumerate five hyland.com hosts and do
  // not reach hylandcloud.com where the tenant lives, and the records are the
  // City of Tucson's. See docs/vendor-review.md.
  {
    bodyId: "ocd-division/country:us/state:az/place:tucson#governing",
    ocdId: "ocd-division/country:us/state:az/place:tucson",
    agendaSourceType: "ONBASE",
    jurisdiction: "Tucson, AZ",
    publishingOrg: "City of Tucson Clerk",
    timeZone: "America/Phoenix",
    config: {
      // Landing page server-renders the meeting list; verified 2026-08-13,
      // 10 rows including Mayor & Council Regular and Study Session.
      baseUrl: "https://tucsonaz.hylandcloud.com/221agendaonline",
    },
    verifiedAt: "2026-08-13",
  },

  // ── Diligent Community / iCompass (one service, two brand skins) ────────
  // Both portals expose the same WCF JSON service the page itself calls:
  //   <base>/Services/MeetingsService.svc/meetings?from=&to=
  // TUSD found by browser network capture (rung 7); Newbury the same. iCompass
  // is a Diligent brand, which is why CIVICWEB and DILIGENT dispatch to the
  // same adapter even though they stay distinct AgendaSourceType values.
  {
    bodyId:
      "ocd-division/country:us/state:az/school_district:tucson_unified_district#board",
    ocdId:
      "ocd-division/country:us/state:az/school_district:tucson_unified_district",
    agendaSourceType: "DILIGENT",
    jurisdiction: "Tucson Unified School District, AZ",
    publishingOrg: "Tucson Unified School District Governing Board",
    timeZone: "America/Phoenix",
    config: {
      slug: "tusd1",
      serviceBase:
        "https://tusd1-schooldesk.community.diligentoneplatform.com",
      // Verified live: /Portal/MeetingInformation.aspx?Org=Cal&Id=492 resolves
      // to the Governing Board regular meeting of 2026-08-11.
      meetingPath: "/Portal/MeetingInformation.aspx?Org=Cal&Id=",
      extraQuery: "&loadall=true",
    },
    verifiedAt: "2026-08-13",
  },
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#governing",
    ocdId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    agendaSourceType: "CIVICWEB",
    jurisdiction: "Newbury, NH",
    publishingOrg: "Town of Newbury",
    timeZone: "America/New_York",
    config: {
      slug: "newburynh",
      serviceBase: "https://newburynh.civicweb.net",
      // Verified live: /Portal/MeetingInformation.aspx?Id=3370 resolves to the
      // Selectboard meeting of 2026-07-20 with its agenda PDF.
      meetingPath: "/Portal/MeetingInformation.aspx?Id=",
      // TypeId → body name, read off the portal's own MeetingTypeList.aspx
      // (the h2 for type 10 reads "Selectboard"). A published name, not a
      // minted one.
      "typeName:10": "Selectboard",
    },
    verifiedAt: "2026-08-13",
  },

  // ── CivicPlus / CivicEngage ─────────────────────────────────────────────
  // First-party feeds the municipality publishes through its own website.
  {
    bodyId:
      "ocd-division/country:us/state:nj/county:morris/place:rockaway_township#governing",
    ocdId:
      "ocd-division/country:us/state:nj/county:morris/place:rockaway_township",
    agendaSourceType: "CIVICPLUS",
    jurisdiction: "Rockaway Township, NJ",
    publishingOrg: "Rockaway Township",
    timeZone: "America/New_York",
    config: {
      slug: "rockaway_township",
      icalUrl:
        "https://www.rockawaytownship.org/common/modules/iCalendar/iCalendar.aspx?catID=25&feed=calendar",
      rssUrl:
        "https://www.rockawaytownship.org/RSSFeed.aspx?ModID=65&CID=All-agendacenter",
      // The iCal category feed mixes township events (a yard sale, an open
      // house) in with council sittings; only summaries matching this prefix
      // are this body's meetings. The string is the feed's own SUMMARY text.
      summaryMatch: "Township Council",
    },
    verifiedAt: "2026-08-13",
  },

  // ── Apptegy / Thrillshare ───────────────────────────────────────────────
  // The district website's own events API — the JSON the page itself renders
  // from, carrying start times with offsets, the venue string, and
  // district-published coordinates. Found for Vail by reading the embedded
  // page state; RTSD's org id the same way.
  {
    bodyId:
      "ocd-division/country:us/state:az/school_district:vail_unified_district#board",
    ocdId:
      "ocd-division/country:us/state:az/school_district:vail_unified_district",
    agendaSourceType: "APPTEGY",
    jurisdiction: "Vail Unified School District, AZ",
    publishingOrg: "Vail School District Governing Board",
    timeZone: "America/Phoenix",
    config: {
      slug: "vail",
      apiBase: "https://vailschooldistrictaz.thrillshare.com/api/v4/o/8164",
      titleMatch: "Governing Board Meeting",
    },
    verifiedAt: "2026-08-13",
  },
  {
    bodyId:
      "ocd-division/country:us/state:nj/school_district:rockaway_township_school_district#board",
    ocdId:
      "ocd-division/country:us/state:nj/school_district:rockaway_township_school_district",
    agendaSourceType: "APPTEGY",
    jurisdiction: "Rockaway Township School District, NJ",
    publishingOrg: "Rockaway Township Public Schools Board of Education",
    timeZone: "America/New_York",
    config: {
      slug: "rocktwp",
      apiBase: "https://api.thrillshare.com/api/v4/o/4707",
      titleMatch: "Board Meeting",
    },
    verifiedAt: "2026-08-13",
  },
];

/** Rows a given adapter capability should serve. */
export function wiringForTypes(
  types: AgendaSourceType[],
): BodySourceWiring[] {
  return SOURCE_WIRING.filter((row) => types.includes(row.agendaSourceType));
}
