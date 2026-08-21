import type { OcdId } from "../sources/types.ts";
import type { AgendaSourceType } from "./types.ts";
import { TUCSON_CLERKSBOARDS } from "./curated-bodies.ts";

/** The one Tucson division every clerksboards body sits on. */
const TUCSON_OCD_ID = "ocd-division/country:us/state:az/place:tucson" as OcdId;

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

  /*
   * D29: Tucson boards and commissions via the Clerk's boards app.
   *
   * clerksboards.tucsonaz.gov serves one server-rendered page per body with
   * the published schedule, location and current agenda.
   *
   * DERIVED, NOT LISTED (g18). These were five hand-written entries sitting
   * beside a five-entry LIVE_BOARD_IDS in curated-bodies.ts, and BOTH had to
   * be edited for a board to actually be read. Widening one alone marked
   * bodies LIVE with nothing fetching them - a coverage status claiming a
   * calendar nobody had asked for. Now there is one list: LIVE_BOARD_IDS
   * decides, and the wiring follows it.
   *
   * 24 boards as of 2026-08-18, from 5. The 32 still uncovered are classified
   * in curated-bodies.ts - 30 of them publish no fixed schedule at all, which
   * is a finding about those bodies and not a gap in our retrieval.
   */
  ...TUCSON_CLERKSBOARDS.map(
    ({ bodyId, boardId }): BodySourceWiring => ({
      bodyId,
      ocdId: TUCSON_OCD_ID,
      agendaSourceType: "CLERKSBOARDS",
      jurisdiction: "Tucson, AZ",
      publishingOrg: "City of Tucson Clerk",
      timeZone: "America/Phoenix",
      config: { boardId },
      verifiedAt: "2026-08-18",
    }),
  ),

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

  // The township's OTHER two live boards — the depth session, 2026-08-15.
  //
  // **The boards are in a different calendar category from the council.**
  // The wired council feed is `catID=25`; probing the ids found `catID=30`,
  // a second calendar carrying the Planning Board and the Board of
  // Adjustment with real start times. Most other ids return a 477-byte empty
  // calendar. That one probe is the whole density story for this township:
  // 07866 had one municipal body and now has three.
  //
  // The archive halves are AgendaCenter categories 4 and 3, each id read off
  // its own `<div id="cat<N>">` block's heading in the DOM — never by
  // document order, which would have filed one board's meetings under
  // another's.
  //
  // Two more bodies exist on that page and are NOT wired, deliberately:
  // the Environmental Commission (category 5, nothing since 2019) and the
  // Board of Assessment Commissioners (category 7, one sitting in 2022).
  // Both are registry rows carrying the finding; neither publishes anything
  // the served 90-day window could render, and inventing a source for them
  // would be the opposite of coverage.
  {
    bodyId:
      "ocd-division/country:us/state:nj/county:morris/place:rockaway_township#planning-board",
    ocdId:
      "ocd-division/country:us/state:nj/county:morris/place:rockaway_township",
    agendaSourceType: "CIVICPLUS",
    jurisdiction: "Rockaway Township, NJ",
    publishingOrg: "Rockaway Township Planning Board",
    timeZone: "America/New_York",
    config: {
      slug: "rockaway_township_planning_board",
      icalUrl:
        "https://www.rockawaytownship.org/common/modules/iCalendar/iCalendar.aspx?catID=30&feed=calendar",
      // The feed's own SUMMARY text, verbatim. The same feed carries the
      // Board of Adjustment and two civic events, so the match is required.
      summaryMatch: "Planning Board Meeting",
      // The body's published name, from the township's own page heading at
      // /212/Planning-Board — the feed's SUMMARY labels the sitting, not the body.
      bodyName: "Planning Board",
      agendaCenterUrl: "https://www.rockawaytownship.org/AgendaCenter",
      agendaCenterCategoryId: "4",
    },
    verifiedAt: "2026-08-15",
  },
  {
    bodyId:
      "ocd-division/country:us/state:nj/county:morris/place:rockaway_township#board-of-adjustment",
    ocdId:
      "ocd-division/country:us/state:nj/county:morris/place:rockaway_township",
    agendaSourceType: "CIVICPLUS",
    jurisdiction: "Rockaway Township, NJ",
    publishingOrg: "Rockaway Township Board of Adjustment",
    timeZone: "America/New_York",
    config: {
      slug: "rockaway_township_board_of_adjustment",
      icalUrl:
        "https://www.rockawaytownship.org/common/modules/iCalendar/iCalendar.aspx?catID=30&feed=calendar",
      summaryMatch: "Board of Adjustment Meeting",
      // Same, from /211/Board-of-Adjustment.
      bodyName: "Board of Adjustment",
      agendaCenterUrl: "https://www.rockawaytownship.org/AgendaCenter",
      agendaCenterCategoryId: "3",
    },
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
  // ── The published annual schedule (M78, 2026-08-15) ─────────────────────
  // Morris Hills Regional is 07866's HIGH SCHOOL district — a zip sits in two
  // school districts at once and both are its government. It was
  // NOT_ATTEMPTED until this session: the census named it, the hunt found it
  // runs no agenda vendor at all, and its own BOE Meetings page publishes the
  // whole 2026 schedule as a dated list with "All meetings begin at 6:30 P.M.
  // and are held in the Board of Education - Board Conference Room" under it.
  // Ladder rung 2, no portal in the path.
  {
    bodyId:
      "ocd-division/country:us/state:nj/school_district:morris_hills_regional_school_district#board",
    ocdId:
      "ocd-division/country:us/state:nj/school_district:morris_hills_regional_school_district",
    agendaSourceType: "SCHEDULEPAGE",
    jurisdiction: "Morris Hills Regional School District, NJ",
    publishingOrg: "Morris Hills Regional District Board of Education",
    timeZone: "America/New_York",
    config: {
      slug: "mhrd",
      schedulePage:
        "https://www.mhrd.org/administration/board-of-education/boe-meetings",
      documentsPage:
        "https://www.mhrd.org/administration/board-of-education/board-agendas",
      // The district's own name for the body, from its page heading.
      bodyName: "Board of Education",
      // The room, verbatim from the schedule page's own sentence — the key
      // the venue cache resolves. There is no per-sitting location string.
      venueMatch: "Board of Education - Board Conference Room",
    },
    verifiedAt: "2026-08-15",
  },

  // ── The browser rung (M79, 2026-08-15) ──────────────────────────────────
  // Two New Hampshire hosts answer 403 to this pipeline's civic-index client
  // and 200 to a browser, which is why these four bodies sat unwired with
  // their schedules in plain view. `profile: "browser"` is the rung — the
  // same public page, one step up the ladder, contact address intact. See
  // `lib/sources/http.ts`.
  //
  // Kearsarge Regional School District is 03255's school district. Its board
  // publishes the whole 2026-2027 year as a two-column month table with the
  // board's own words beside each date ("Staff Nominations", "Budget
  // Presentations", "Warrant Discussion"), one bullet naming the time and one
  // naming the place. The agendas archive carries the date in each link's own
  // text, so documents join on a published date rather than a filename.
  {
    bodyId:
      "ocd-division/country:us/state:nh/school_district:kearsarge_regional_school_district#board",
    ocdId:
      "ocd-division/country:us/state:nh/school_district:kearsarge_regional_school_district",
    agendaSourceType: "SCHEDULEPAGE",
    jurisdiction: "Kearsarge Regional School District, NH",
    publishingOrg: "Kearsarge Regional School District School Board",
    timeZone: "America/New_York",
    config: {
      slug: "kearsarge",
      profile: "browser",
      shapes: "month-table",
      schedulePage:
        "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-meeting-schedule",
      documentsPage:
        "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-agendas-minutes",
      // The page's own free-content block. Scoped because the page also
      // carries an attachments table and a sticky-header table.
      sectionMatch: "field-name-body",
      // The district's own name for the body, from its page heading.
      bodyName: "School Board",
      // Verbatim from the page's own bullet: "Meeting Location: 114 Main
      // Street, New London (enter by the cupola on Main Street)".
      venueMatch: "114 Main Street, New London",
      // The one row on the schedule that names a different building — the
      // January deliberative session at KRMS. It resolves on its own string,
      // finds nothing, and drops COUNTED rather than inheriting 114 Main
      // Street. Curating KRMS's address is the work that makes it render.
      otherVenueMarkers: "KRMS",
    },
    verifiedAt: "2026-08-15",
  },

  // Newbury's land-use boards — the other half of M79. The CivicWeb portal
  // carries only the Selectboard (proven: a whole-year query returned 20
  // sittings, every one TypeId 10), and these boards live on the town's own
  // Drupal site, which publishes a `dc:date` per sitting with the offset in
  // it. No time is inferred anywhere in this shape.
  //
  // `pathPrefix` is load-bearing: the town's page template puts every board's
  // blocks in identical markup, and a prefix-free parse would file one
  // board's Thursday under another's.
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#planning-board",
    ocdId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    agendaSourceType: "SCHEDULEPAGE",
    jurisdiction: "Newbury, NH",
    publishingOrg: "Newbury Planning Board",
    timeZone: "America/New_York",
    config: {
      slug: "newbury-planning-board",
      profile: "browser",
      shapes: "agenda-list",
      schedulePage: "https://www.newbury.nh.gov/planning-board",
      pathPrefix: "/planning-board/",
      bodyName: "Planning Board",
      venueMatch: "Newbury Town Office",
    },
    verifiedAt: "2026-08-15",
  },
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#conservation-commission",
    ocdId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    agendaSourceType: "SCHEDULEPAGE",
    jurisdiction: "Newbury, NH",
    publishingOrg: "Newbury Conservation Commission",
    timeZone: "America/New_York",
    config: {
      slug: "newbury-conservation-commission",
      profile: "browser",
      // Two shapes on one page: the commission writes its whole year with
      // times in its own free-content block, and the agenda block links the
      // sittings that have documents. Unioned by date.
      shapes: "dated-list,agenda-list",
      schedulePage: "https://www.newbury.nh.gov/conservation-commission",
      // Scopes the dated list to the commission's own block, so a news
      // teaser's date cannot become a meeting.
      sectionMatch: "field-name-field-description",
      pathPrefix: "/conservation-commission/",
      bodyName: "Conservation Commission",
      venueMatch: "Newbury Town Office",
    },
    verifiedAt: "2026-08-15",
  },
  // The Zoning Board of Adjustment, wired 2026-08-15 (the mobile round-two
  // session). Same shape and same adapter as its Planning Board sibling; the
  // only thing that had ever been missing was the venue, and it turned up in
  // the map link under the town's "Newbury Offices" label rather than in any
  // agenda's prose. `venueMatch` keys the curated row, so this board resolves
  // on the town's OWN label rather than borrowing the Planning Board's.
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#zoning-board-of-adjustment",
    ocdId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    agendaSourceType: "SCHEDULEPAGE",
    jurisdiction: "Newbury, NH",
    publishingOrg: "Newbury Zoning Board of Adjustment",
    timeZone: "America/New_York",
    config: {
      slug: "newbury-zoning-board-of-adjustment",
      profile: "browser",
      shapes: "agenda-list",
      schedulePage: "https://www.newbury.nh.gov/zoning-board-adjustment",
      pathPrefix: "/zoning-board-adjustment/",
      bodyName: "Zoning Board of Adjustment",
      venueMatch: "Newbury Offices",
    },
    verifiedAt: "2026-08-15",
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



  // ── Newbury, NH — TEN boards off the town's OWN iCalendar (NH Hunt, 2026-08-20)
  //
  // ## What was found
  //
  // `https://www.newbury.nh.gov/calendar/ical/export.ics` — advertised as a
  // `webcal://` link on the town's own calendar page and never wired.
  // Retrieved 2026-08-20: HTTP 200, 466,540 bytes, **1,157 `VEVENT`s, 94 of
  // them upcoming.** 272 Selectboard sittings, 116 Conservation Commission,
  // 108 Zoning Board, 84 Planning Board, and every committee below.
  //
  // The town was already wired through `newburynh.civicweb.net` for its
  // Selectboard and through three `schedulepage` rows for its land-use
  // boards. Ten of its fourteen boards were wired to nothing at all, while
  // their meetings sat in one document the town publishes for exactly this
  // purpose.
  //
  // ## Why `titleMatch` and not `categoryMatch`
  //
  // **The feed carries no `CATEGORIES` field on any of its 1,157 events.** A
  // category-only adapter reads it as a calendar belonging to nobody, which is
  // how a town publishing everything renders as a town publishing nothing. So
  // `titleMatch` was added to the adapter for this feed; see
  // `lib/sources/ical/index.ts`.
  //
  // Each list below is read off the feed's own summaries. The variants are not
  // decoration: Newbury writes "Energy Committee Meeting" and "Newbury Energy
  // Committee Meeting" for the same body, and "Trustees of the Trust Funds"
  // and "Trust Funds" likewise.
  //
  // ## What is NOT here, and why
  //
  // The Selectboard, Planning Board, Conservation Commission and Zoning Board
  // of Adjustment keep the routes they already have. Adding a second route for
  // a body already served would double every one of its sittings on the
  // reader's page, and this feed's ids are namespaced per body — there is no
  // cross-source de-duplication that would catch it. Their coverage from this
  // feed is a REPLACEMENT decision and a measurement, not an addition, and it
  // is a tracker row rather than a change made in passing.
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#advisory-budget-committee",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    agendaSourceType: "ICAL",
    jurisdiction: "Newbury, NH",
    publishingOrg: "Town of Newbury",
    timeZone: "America/New_York",
    config: {
      slug: "newbury-advisory-budget-committee",
      feedUrl: "https://www.newbury.nh.gov/calendar/ical/export.ics",
      titleMatch: "Advisory Budget Committee",
      bodyName: "2026 Advisory Budget Committee",
      // Every event on this feed publishes an EMPTY `LOCATION`, so every row
      // reaches the standing venue. See `lib/meetings/venue-cache.ts`.
      venueMatch: "Newbury Town Office",
    },
    verifiedAt: "2026-08-20",
  },
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#blodgett-sewer-user-advisory-committee",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    agendaSourceType: "ICAL",
    jurisdiction: "Newbury, NH",
    publishingOrg: "Town of Newbury",
    timeZone: "America/New_York",
    config: {
      slug: "newbury-blodgett-sewer-user-advisory-committee",
      feedUrl: "https://www.newbury.nh.gov/calendar/ical/export.ics",
      titleMatch: "Blodgett Sewer",
      bodyName: "Blodgett Sewer User Advisory Committee",
      // Every event on this feed publishes an EMPTY `LOCATION`, so every row
      // reaches the standing venue. See `lib/meetings/venue-cache.ts`.
      venueMatch: "Newbury Town Office",
    },
    verifiedAt: "2026-08-20",
  },
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#cemetery-trustees",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    agendaSourceType: "ICAL",
    jurisdiction: "Newbury, NH",
    publishingOrg: "Town of Newbury",
    timeZone: "America/New_York",
    config: {
      slug: "newbury-cemetery-trustees",
      feedUrl: "https://www.newbury.nh.gov/calendar/ical/export.ics",
      titleMatch: "Cemetery Trustee",
      bodyName: "Cemetery Trustees",
      // Every event on this feed publishes an EMPTY `LOCATION`, so every row
      // reaches the standing venue. See `lib/meetings/venue-cache.ts`.
      venueMatch: "Newbury Town Office",
    },
    verifiedAt: "2026-08-20",
  },
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#joint-loss-management-committee",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    agendaSourceType: "ICAL",
    jurisdiction: "Newbury, NH",
    publishingOrg: "Town of Newbury",
    timeZone: "America/New_York",
    config: {
      slug: "newbury-joint-loss-management-committee",
      feedUrl: "https://www.newbury.nh.gov/calendar/ical/export.ics",
      titleMatch: "Joint Loss",
      bodyName: "Joint Loss Management Committee",
      // Every event on this feed publishes an EMPTY `LOCATION`, so every row
      // reaches the standing venue. See `lib/meetings/venue-cache.ts`.
      venueMatch: "Newbury Town Office",
    },
    verifiedAt: "2026-08-20",
  },
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#septic-committee",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    agendaSourceType: "ICAL",
    jurisdiction: "Newbury, NH",
    publishingOrg: "Town of Newbury",
    timeZone: "America/New_York",
    config: {
      slug: "newbury-septic-committee",
      feedUrl: "https://www.newbury.nh.gov/calendar/ical/export.ics",
      titleMatch: "Septic Committee",
      bodyName: "Newbury Septic Committee",
      // Every event on this feed publishes an EMPTY `LOCATION`, so every row
      // reaches the standing venue. See `lib/meetings/venue-cache.ts`.
      venueMatch: "Newbury Town Office",
    },
    verifiedAt: "2026-08-20",
  },
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#trustees-of-the-trust-funds",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    agendaSourceType: "ICAL",
    jurisdiction: "Newbury, NH",
    publishingOrg: "Town of Newbury",
    timeZone: "America/New_York",
    config: {
      slug: "newbury-trustees-of-the-trust-funds",
      feedUrl: "https://www.newbury.nh.gov/calendar/ical/export.ics",
      titleMatch: "Trustees of the Trust Funds,Trust Funds",
      bodyName: "Trustees of the Trust Funds",
      // Every event on this feed publishes an EMPTY `LOCATION`, so every row
      // reaches the standing venue. See `lib/meetings/venue-cache.ts`.
      venueMatch: "Newbury Town Office",
    },
    verifiedAt: "2026-08-20",
  },
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#energy-committee",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    agendaSourceType: "ICAL",
    jurisdiction: "Newbury, NH",
    publishingOrg: "Town of Newbury",
    timeZone: "America/New_York",
    config: {
      slug: "newbury-energy-committee",
      feedUrl: "https://www.newbury.nh.gov/calendar/ical/export.ics",
      titleMatch: "Energy Committee",
      bodyName: "Newbury Energy Committee",
      // Every event on this feed publishes an EMPTY `LOCATION`, so every row
      // reaches the standing venue. See `lib/meetings/venue-cache.ts`.
      venueMatch: "Newbury Town Office",
    },
    verifiedAt: "2026-08-20",
  },
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#beautification-committee",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    agendaSourceType: "ICAL",
    jurisdiction: "Newbury, NH",
    publishingOrg: "Town of Newbury",
    timeZone: "America/New_York",
    config: {
      slug: "newbury-beautification-committee",
      feedUrl: "https://www.newbury.nh.gov/calendar/ical/export.ics",
      titleMatch: "Beautification",
      bodyName: "Newbury Beautification Committee",
      // Every event on this feed publishes an EMPTY `LOCATION`, so every row
      // reaches the standing venue. See `lib/meetings/venue-cache.ts`.
      venueMatch: "Newbury Town Office",
    },
    verifiedAt: "2026-08-20",
  },
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#joint-assessing-board",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    agendaSourceType: "ICAL",
    jurisdiction: "Newbury, NH",
    publishingOrg: "Town of Newbury",
    timeZone: "America/New_York",
    config: {
      slug: "newbury-joint-assessing-board",
      feedUrl: "https://www.newbury.nh.gov/calendar/ical/export.ics",
      titleMatch: "Joint Assessing",
      bodyName: "Joint Assessing Board (Newbury, Sunapee & New London)",
      // Every event on this feed publishes an EMPTY `LOCATION`, so every row
      // reaches the standing venue. See `lib/meetings/venue-cache.ts`.
      venueMatch: "Newbury Town Office",
    },
    verifiedAt: "2026-08-20",
  },
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#library-trustees",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    agendaSourceType: "ICAL",
    jurisdiction: "Newbury, NH",
    publishingOrg: "Town of Newbury",
    timeZone: "America/New_York",
    config: {
      slug: "newbury-library-trustees",
      feedUrl: "https://www.newbury.nh.gov/calendar/ical/export.ics",
      titleMatch: "Library Trustee",
      bodyName: "Newbury Public Library Trustees",
      // Every event on this feed publishes an EMPTY `LOCATION`, so every row
      // reaches the standing venue. See `lib/meetings/venue-cache.ts`.
      venueMatch: "Newbury Town Office",
    },
    verifiedAt: "2026-08-20",
  },


  // ── Newbury, NH — the SAME feed for the four boards already wired ──────────
  //
  // A SECOND route, not a replacement, and the measurement that decided it
  // (NH Hunt, 2026-08-20). Inside the serving window the town's own feed holds
  // **24 sittings of these four boards against the 16 their existing routes
  // produce** — Selectboard 10 against 7, Planning 5 against 3, Zoning 4
  // against 1, Conservation 5 against 5.
  //
  // The existing routes are NOT retired, because they carry what this feed
  // does not: real agendas. `newburynh.civicweb.net/Portal/MeetingInformation`
  // for the Selectboard, `/planning-board/agenda/agenda-15` for the land-use
  // boards. Trading a reader's agenda for a reader's date is not a trade this
  // product should make, so both ship and the merge decides — see
  // `collapseDuplicateSittings` in `lib/sources/composite/index.ts`, which
  // keeps the row carrying the agenda and states how many it collapsed.
  //
  // **This wiring is only safe because that merge exists.** Before it, a second
  // route meant every shared sitting rendering twice.
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#governing",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    agendaSourceType: "ICAL",
    jurisdiction: "Newbury, NH",
    publishingOrg: "Town of Newbury",
    timeZone: "America/New_York",
    config: {
      slug: "newbury-ical-governing",
      feedUrl: "https://www.newbury.nh.gov/calendar/ical/export.ics",
      titleMatch: "Selectboard",
      bodyName: "Selectboard",
      venueMatch: "Newbury Town Office",
    },
    verifiedAt: "2026-08-20",
  },
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#planning-board",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    agendaSourceType: "ICAL",
    jurisdiction: "Newbury, NH",
    publishingOrg: "Town of Newbury",
    timeZone: "America/New_York",
    config: {
      slug: "newbury-ical-planning-board",
      feedUrl: "https://www.newbury.nh.gov/calendar/ical/export.ics",
      titleMatch: "Planning Board",
      bodyName: "Planning Board",
      venueMatch: "Newbury Town Office",
    },
    verifiedAt: "2026-08-20",
  },
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#conservation-commission",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    agendaSourceType: "ICAL",
    jurisdiction: "Newbury, NH",
    publishingOrg: "Town of Newbury",
    timeZone: "America/New_York",
    config: {
      slug: "newbury-ical-conservation-commission",
      feedUrl: "https://www.newbury.nh.gov/calendar/ical/export.ics",
      titleMatch: "Conservation Commission",
      bodyName: "Conservation Commission",
      venueMatch: "Newbury Town Office",
    },
    verifiedAt: "2026-08-20",
  },
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#zoning-board-of-adjustment",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    agendaSourceType: "ICAL",
    jurisdiction: "Newbury, NH",
    publishingOrg: "Town of Newbury",
    timeZone: "America/New_York",
    config: {
      slug: "newbury-ical-zoning-board-of-adjustment",
      feedUrl: "https://www.newbury.nh.gov/calendar/ical/export.ics",
      titleMatch: "Zoning Board",
      bodyName: "Zoning Board of Adjustment",
      venueMatch: "Newbury Town Office",
    },
    verifiedAt: "2026-08-20",
  },
  {
    /*
     * **A body the town's boards MENU does not list and its CALENDAR does.**
     *
     * The Supervisors of the Checklist are an elected New Hampshire town body
     * (RSA 654:22 and RSA 669:17), three per town, and they hold statutory
     * public sessions to correct the voter checklist before every election.
     * Newbury's own calendar carries twenty-three of their sittings; the
     * town's `/boards` menu carries none of them, and neither did this
     * registry. A reader who wanted to know when they could get on the
     * checklist before the September primary could not find out here.
     *
     * They have no page on the town's site, so the body's `homepageUrl` is
     * the town's own calendar — which is where the town actually publishes
     * them — rather than a constructed path that would 404.
     *
     * Both spellings are matched because the town uses both: "Supervisors of
     * the Checklist" and "Supervisions of the Checklist", the latter on eight
     * sittings across several years. Dropping the typo would drop the meetings.
     */
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#supervisors-of-the-checklist",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    agendaSourceType: "ICAL",
    jurisdiction: "Newbury, NH",
    publishingOrg: "Town of Newbury",
    timeZone: "America/New_York",
    config: {
      slug: "newbury-supervisors-of-the-checklist",
      feedUrl: "https://www.newbury.nh.gov/calendar/ical/export.ics",
      titleMatch: "Supervisors of the Checklist,Supervisions of the Checklist",
      bodyName: "Supervisors of the Checklist",
      venueMatch: "Newbury Town Office",
    },
    verifiedAt: "2026-08-20",
  },

  // ── Wilmot, NH — three boards from one iCalendar feed (M123, 2026-08-19) ──
  //
  // The first rows on the `ICAL` type, which had been in the enum with no
  // adapter behind it. Wilmot runs WordPress with The Events Calendar, and
  // the plugin hands over the whole calendar as `.ics`: start, end, title,
  // the street address in `LOCATION`, and the BOARD'S OWN NAME in
  // `CATEGORIES`. That last field is what makes one feed serve three bodies
  // without guessing from a title.
  //
  // **`feedUrl` names the LIST view on purpose.** `/events/?ical=1` returns
  // the current VIEW — four events, HTTP 200, well-formed, and missing
  // nineteen public meetings. `/events/list/?ical=1` returns all
  // twenty-three, which is the same total the plugin's own REST API reports.
  // The row names the full feed rather than letting the adapter construct
  // one, so that trap cannot be re-entered by an adapter change.
  //
  // Retrieved 2026-08-19: 23 events, categories `Select Board` (10),
  // `Planning Board` (8), `Cemetery Trustees` (4), one uncategorised.
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:wilmot_town#selectboard",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:wilmot_town",
    agendaSourceType: "ICAL",
    jurisdiction: "Wilmot, NH",
    publishingOrg: "Wilmot Selectboard",
    timeZone: "America/New_York",
    config: {
      slug: "wilmot-selectboard",
      feedUrl: "https://www.wilmotnh.org/events/list/?ical=1",
      // The archive, at the same feed. Without it the Concluded filter would
      // be empty by construction rather than by fact (M58).
      pastFeedUrl:
        "https://www.wilmotnh.org/events/list/?tribe_event_display=past&ical=1",
      categoryMatch: "Select Board",
      bodyName: "Selectboard",
      // Every Selectboard sitting in this feed writes `LOCATION:NH` — a
      // state, not a building. The board's OWN page states where it meets,
      // and the curated venue cites that page. Reached only when the feed
      // itself gives nothing usable.
      venueMatch: "Wilmot Town Office Building",
    },
    verifiedAt: "2026-08-19",
  },
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:wilmot_town#planning-board",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:wilmot_town",
    agendaSourceType: "ICAL",
    jurisdiction: "Wilmot, NH",
    publishingOrg: "Wilmot Planning Board",
    timeZone: "America/New_York",
    config: {
      slug: "wilmot-planning-board",
      feedUrl: "https://www.wilmotnh.org/events/list/?ical=1",
      // The archive, at the same feed. Without it the Concluded filter would
      // be empty by construction rather than by fact (M58).
      pastFeedUrl:
        "https://www.wilmotnh.org/events/list/?tribe_event_display=past&ical=1",
      categoryMatch: "Planning Board",
      bodyName: "Planning Board",
    },
    verifiedAt: "2026-08-19",
  },
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:wilmot_town#cemetery-trustees",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:wilmot_town",
    agendaSourceType: "ICAL",
    jurisdiction: "Wilmot, NH",
    publishingOrg: "Wilmot Cemetery Trustees",
    timeZone: "America/New_York",
    config: {
      slug: "wilmot-cemetery-trustees",
      feedUrl: "https://www.wilmotnh.org/events/list/?ical=1",
      // The archive, at the same feed. Without it the Concluded filter would
      // be empty by construction rather than by fact (M58).
      pastFeedUrl:
        "https://www.wilmotnh.org/events/list/?tribe_event_display=past&ical=1",
      categoryMatch: "Cemetery Trustees",
      bodyName: "Cemetery Trustees",
    },
    verifiedAt: "2026-08-19",
  },

  // ── New London, NH — four boards off one town calendar (M123, 2026-08-19) ──
  //
  // The first rows on the `event-tip` shape. New London runs GovOffice, whose
  // calendar is a month grid — but every event inside it carries its own full
  // date and time in a tooltip block, so the grid never has to be understood.
  //
  // `titleMatch` is what makes one town-wide calendar serve four bodies, and
  // it is the safety of the whole shape: band concerts, transfer-station
  // hours and eleven boards share this page.
  //
  // `monthsAhead` walks the page's OWN `&month=&year=` navigation. Without
  // it, the default view is ONE MONTH and the Board of Selectmen — which
  // sits twice a month all year — would report two sittings as its whole
  // calendar. That is a clip that reads exactly like a body with nothing
  // scheduled.
  //
  // The venue is written into each event's own title in three spellings of
  // one building, plus the Town Office; all four are keyed in the venue
  // cache, and an unkeyed room drops and counts rather than inheriting an
  // address that would send a reader to the wrong door.
  ...(
    [
      ["board-of-selectmen", "Board of Selectmen", "Board of Selectmen"],
      ["planning-board", "Planning Board", "Planning Board"],
      ["zoning-board", "Zoning Board", "Zoning Board"],
      ["conservation-commission", "Conservation Commission", "Conservation Commission"],
    ] as const
  ).map(([slug, titleMatch, bodyName]) => ({
    bodyId: `ocd-division/country:us/state:nh/county:merrimack/place:new_london_town#${slug}`,
    ocdId:
      "ocd-division/country:us/state:nh/county:merrimack/place:new_london_town" as OcdId,
    agendaSourceType: "SCHEDULEPAGE" as const,
    jurisdiction: "New London, NH",
    publishingOrg: `New London ${bodyName}`,
    timeZone: "America/New_York",
    config: {
      slug: `new-london-${slug}`,
      shapes: "event-tip",
      schedulePage: "https://newlondon.nh.gov/calendar",
      monthPagePath: "/index.asp",
      monthPageQuery: "Type=B_EV&SEC=D43F63EA-A7A8-4400-AFB3-BCF489A6B5E5",
      monthsAhead: "2",
      titleMatch,
      bodyName,
      // The hall the calendar names most often. A row naming a different
      // room resolves on its own string via `otherVenueMarkers`.
      venueMatch: "Whipple Memorial Town Hall",
      otherVenueMarkers:
        "Whipple Memorial Hall,Whipple Hall,New London Town Office",
    },
    verifiedAt: "2026-08-19",
  })),
];

/** Rows a given adapter capability should serve. */
export function wiringForTypes(
  types: AgendaSourceType[],
): BodySourceWiring[] {
  return SOURCE_WIRING.filter((row) => types.includes(row.agendaSourceType));
}
