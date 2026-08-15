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
  /**
   * The division whose government meets. The join key on every Meeting.
   * Null for a body with no Census division (D28) — the meeting then joins
   * on nothing geographic and is local-tier by construction.
   */
  ocdId: OcdId | null;
  agendaSourceType: AgendaSourceType;
  /** Display only — never joined on. */
  jurisdiction: string;
  /** Who published the records. The public body, never the vendor. */
  publishingOrg: string;
  /** IANA zone the body meets in. */
  timeZone: string;
  /** Per-adapter settings. Keys are documented by the adapter. */
  config: Record<string, string>;
  /**
   * The body's own meeting-notice page (4c), where one exists ahead of the
   * vendor portal. Retrieved as a document for this body's meetings that
   * have no published agenda yet — the notice a board posts on its own
   * site is public content about the meeting, and rendering "no agenda
   * posted yet" beside it was a source gap for a wired body.
   */
  noticeUrl?: string;
  /**
   * Whether this row's route serves CONCLUDED meetings (M58, 2026-08-15).
   *
   * Absent means yes — the normal case, and the one every other row is in.
   * A row sets this to `false` only when the *published route* genuinely
   * carries no past sitting, and the reason states which rungs were walked
   * to earn that. It is never a shrug: `docs/source-ladder.md` records the
   * attempts, and where a further rung exists but is not built yet, the
   * reason says so and a tracker row owns it. This is a fact about a
   * vendor's route, not a coverage status — there is deliberately no
   * "blocked", and none of these rows stops being hunted.
   *
   * Read by `concludedGapNote()` so the Concluded filter can tell a reader
   * *why* a jurisdiction is empty rather than rendering nothing and letting
   * that read as "this body never meets".
   */
  publishesHistory?: false;
  /** Why, in the reader's own language. Required when the flag is set. */
  historyGapReason?: string;
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
    // The Board's own notice page: server-renders the meeting notice
    // (times, venue, public hearings) days before the Diligent portal
    // publishes the agenda. Verified 2026-08-15 — it carried the Aug 25
    // special-meeting notice including the Palo Verde ITM public hearing
    // while the portal's agenda was still unpublished.
    noticeUrl: "https://govboard.tusd1.org/",
    verifiedAt: "2026-08-13",
  },
  {
    // Sunnyside USD runs the same Diligent/Highbond tenant shape as Pima
    // Community College. Found from the district's own agenda-and-minutes
    // page (susd12.org names the portal); the MeetingsService answered
    // plain GET with 9 rows and the permalink pattern verified resolving
    // (Id=168 → the Sep 22 regular meeting page) before being relied on.
    bodyId:
      "ocd-division/country:us/state:az/school_district:sunnyside_unified_district#board",
    ocdId:
      "ocd-division/country:us/state:az/school_district:sunnyside_unified_district",
    agendaSourceType: "DILIGENT",
    jurisdiction: "Sunnyside Unified School District, AZ",
    publishingOrg: "Sunnyside Unified School District Governing Board",
    timeZone: "America/Phoenix",
    config: {
      slug: "susd12",
      serviceBase: "https://susd-12.community.highbond.com",
      meetingPath: "/Portal/MeetingInformation.aspx?Org=Cal&Id=",
      // The tenant's MeetingTypeName carries the SITTING name ("Regular
      // Governing Board Meeting"), not the body. "Governing Board" is the
      // district's own name for it (susd12.org/governing-board-home).
      "typeName:27": "Governing Board",
      "typeName:21": "Governing Board",
    },
    verifiedAt: "2026-08-14",
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

  // ── D28: Pima Community College Governing Board ─────────────────────────
  // A live Diligent tenant with no Census division: `ocdId` is null and the
  // body is the curated registry row. Venue strings resolve through the
  // venue cache against the District Office address PCC's own board page
  // publishes; "VIRTUAL MEETING" rows drop placeless, counted.
  {
    bodyId: "curated:az/pima-community-college#governing",
    ocdId: null,
    agendaSourceType: "DILIGENT",
    jurisdiction: "Pima Community College District, AZ",
    publishingOrg: "Pima Community College Governing Board",
    timeZone: "America/Phoenix",
    config: {
      slug: "pcc",
      serviceBase: "https://pima.community.highbond.com",
      // Verified live 2026-08-14: the service answers plain GET with venue
      // strings (District Office rooms C-105 / C-228).
      meetingPath: "/Portal/MeetingInformation.aspx?Org=Cal&Id=",
    },
    verifiedAt: "2026-08-14",
  },

  // ── D29: Tucson boards and commissions via the Clerk's boards app ───────
  // clerksboards.tucsonaz.gov serves one server-rendered page per body with
  // the published schedule, location and current agenda. These five carry a
  // parseable schedule and a physical venue the page itself publishes; the
  // other 51 bodies in the directory are curated registry rows awaiting
  // either a schedule this parser reads or a venue citation.
  {
    bodyId: "ocd-division/country:us/state:az/place:tucson#planning-commission",
    ocdId: "ocd-division/country:us/state:az/place:tucson",
    agendaSourceType: "CLERKSBOARDS",
    jurisdiction: "Tucson, AZ",
    publishingOrg: "City of Tucson Clerk",
    timeZone: "America/Phoenix",
    config: { boardId: "38" },
    verifiedAt: "2026-08-14",
  },
  {
    bodyId: "ocd-division/country:us/state:az/place:tucson#board-of-adjustment",
    ocdId: "ocd-division/country:us/state:az/place:tucson",
    agendaSourceType: "CLERKSBOARDS",
    jurisdiction: "Tucson, AZ",
    publishingOrg: "City of Tucson Clerk",
    timeZone: "America/Phoenix",
    config: { boardId: "8" },
    verifiedAt: "2026-08-14",
  },
  {
    bodyId:
      "ocd-division/country:us/state:az/place:tucson#citizens-water-advisory-committee",
    ocdId: "ocd-division/country:us/state:az/place:tucson",
    agendaSourceType: "CLERKSBOARDS",
    jurisdiction: "Tucson, AZ",
    publishingOrg: "City of Tucson Clerk",
    timeZone: "America/Phoenix",
    config: { boardId: "23" },
    verifiedAt: "2026-08-14",
  },
  {
    bodyId:
      "ocd-division/country:us/state:az/place:tucson#tucson-parks-and-recreation-commission",
    ocdId: "ocd-division/country:us/state:az/place:tucson",
    agendaSourceType: "CLERKSBOARDS",
    jurisdiction: "Tucson, AZ",
    publishingOrg: "City of Tucson Clerk",
    timeZone: "America/Phoenix",
    config: { boardId: "63" },
    verifiedAt: "2026-08-14",
  },
  {
    bodyId:
      "ocd-division/country:us/state:az/place:tucson#community-police-advisory-review-board",
    ocdId: "ocd-division/country:us/state:az/place:tucson",
    agendaSourceType: "CLERKSBOARDS",
    jurisdiction: "Tucson, AZ",
    publishingOrg: "City of Tucson Clerk",
    timeZone: "America/Phoenix",
    config: { boardId: "19" },
    verifiedAt: "2026-08-14",
  },

  // ── BoardBook Premier (Sparq Data Solutions) ────────────────────────────
  // Amphitheater USD's agenda portal, named on the district's own
  // agenda-information page. The org page server-renders the whole archive
  // with per-row venue name and street address; agendas and notices are
  // public links. Meetings post days ahead (Aug 11 released Aug 10), so an
  // empty upcoming window between postings is the portal's honest state —
  // the cadence field below is the district's own published schedule.
  {
    bodyId:
      "ocd-division/country:us/state:az/school_district:amphitheater_unified_district#board",
    ocdId:
      "ocd-division/country:us/state:az/school_district:amphitheater_unified_district",
    agendaSourceType: "BOARDBOOK",
    jurisdiction: "Amphitheater Unified School District, AZ",
    publishingOrg: "Amphitheater Unified School District Governing Board",
    timeZone: "America/Phoenix",
    config: {
      orgId: "2065",
      bodyName: "Amphitheater Unified School District Governing Board",
    },
    verifiedAt: "2026-08-14",
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
      // M59 (2026-08-15): the archive rung. The AgendaCenter files each
      // sitting's agenda and minutes under a category; `2` is the value of
      // the Township Council checkbox in the page's own category filter, and
      // it is recorded rather than guessed because the same page carries the
      // Planning Board, the Board of Adjustment and two more.
      agendaCenterUrl: "https://www.rockawaytownship.org/AgendaCenter",
      agendaCenterCategoryId: "2",
    },
    // M58: the iCal feed is upcoming-only. Rungs walked 2026-08-15 — the
    // wired feed and the same feed with startDate/endDate and from/to
    // parameters all returned the identical 5,484 bytes and the identical
    // eleven future sittings; the only two past DTSTARTs in it are the
    // VTIMEZONE boilerplate, in every category id.
    //
    // **M59 closed the gap on 2026-08-15**, which is why `publishesHistory`
    // is gone from this row: the AgendaCenter archive is now ingested, and
    // its sittings carry `startPrecision: "DAY"` because the township
    // publishes their date and not their hour.
    verifiedAt: "2026-08-15",
  },

  // ── Granicus IQM2 ───────────────────────────────────────────────────────
  // Calendar.aspx?From=&To= is server-rendered with future meetings, and each
  // row's tooltip publishes board, type, status, and the venue with street
  // address. Verified live 2026-08-13; the RSS.aspx?Feed=Calendar pseudo-feed
  // recorded earlier lists only published documents and is not used.
  {
    bodyId: "ocd-division/country:us/state:nj/county:morris#governing",
    ocdId: "ocd-division/country:us/state:nj/county:morris",
    agendaSourceType: "IQM2",
    jurisdiction: "Morris County, NJ",
    publishingOrg: "Morris County Board of County Commissioners",
    timeZone: "America/New_York",
    config: {
      slug: "morriscountynj",
      base: "https://morriscountynj.iqm2.com",
      // The tenant could host other boards; only this one is wired.
      boardMatch: "Board of County Commissioners",
    },
    verifiedAt: "2026-08-13",
  },

  // ── Revize ──────────────────────────────────────────────────────────────
  // calendar.php is JS-only; the homepage "Upcoming Meetings" block and the
  // BOC notices/agendas page are both server-rendered. Meetings come from the
  // block, agenda PDFs matched by filename date from the page. Verified live
  // 2026-08-13.
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack#governing",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack",
    agendaSourceType: "REVIZE",
    jurisdiction: "Merrimack County, NH",
    publishingOrg: "Merrimack County Board of Commissioners",
    timeZone: "America/New_York",
    config: {
      slug: "merrimack",
      base: "https://www.merrimackcounty.net",
      agendaPage: "board_of_commissioners_/public_notices,_agendas,_minutes,_.php",
      documentsFolder: "Board of Commissioners/Public Notices, Agenda, Minutes/",
      // The block also lists the county delegation's Executive Committee — a
      // different government, not this body.
      titleMatch: "Board of Commissioners",
      // The block's own title text is "Board of Commissioners Mtg."; the
      // body's published name, from its page heading.
      bodyName: "Merrimack County Board of Commissioners",
    },
    // M58: the meeting rows come from a block whose heading is literally
    // "Upcoming Meetings" — past sittings are not in it, by construction.
    //
    // **M59 closed it on 2026-08-15**, which is why `publishesHistory` is
    // gone from this row. The notices/agendas page on the same site carries
    // the history as dated documents — a public notice, a board packet and
    // minutes per sitting — and the adapter now emits a meeting for each date
    // the upcoming block does not already cover. A filename dates a meeting
    // without timing it, so those rows carry `startPrecision: "DAY"` and the
    // card says the time was not posted instead of inventing 10am.
    verifiedAt: "2026-08-15",
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
