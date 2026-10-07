import { feedKindForWiringType } from "../sources/feed-kind-registry.ts";
import type { OcdId } from "../sources/types.ts";
import type { AgendaSourceType } from "./types.ts";

/** The one division every clerksboards body sits on. */
const TUCSON_OCD_ID = "ocd-division/country:us/state:az/place:tucson" as OcdId;

/**
 * SOURCE_WIRING-owned clerksboards route membership. Curated body presentation derives its LIVE status
 * from these rows; it cannot add a production clock.
 */
const TUCSON_CLERKSBOARDS_ROUTES = [
  ["2018-parks-connections-bond-oversight-commission", "128"],
  ["armory-park-historic-zone-advisory-board", "9"],
  ["barrio-historico-historic-zone-advisory-board", "12"],
  ["board-of-adjustment", "8"],
  ["citizens-water-advisory-committee", "23"],
  ["city-of-tucson-deferred-compensation-plan-management-board", "25"],
  ["commission-on-disability-issues", "3"],
  ["commission-on-equitable-housing-and-development", "131"],
  ["community-police-advisory-review-board", "19"],
  ["complete-streets-coordinating-council", "130"],
  ["design-review-board", "26"],
  ["fort-lowell-historic-zone-advisory-board", "39"],
  ["human-relations-commission", "42"],
  ["industrial-development-authority", "43"],
  ["park-tucson-commission", "57"],
  ["pima-county-tucson-women-s-commission", "50"],
  ["planning-commission", "38"],
  ["public-art-and-community-design-committee", "49"],
  ["tucson-commission-on-lesbian-gay-bisexual-transgender-and-queer-issues", "40"],
  ["tucson-convention-center-commission", "15"],
  ["tucson-fire-public-safety-personnel-retirement-system-board", "58"],
  ["tucson-greens-committee", "41"],
  ["tucson-parks-and-recreation-commission", "63"],
  ["tucson-police-public-safety-personnel-retirement-system-board", "59"],
  ["tucson-transit-advisory-committee", "133"],
  ["tucson-pima-county-historical-commission", "61"],
  ["veterans-affairs-committee", "65"],
] as const;

/**
 * Which bodies the composite meeting source serves, and how. Adding a body is adding a row here: the
 * composite dispatches on `agendaSourceType`, and each adapter reads the rows declaring its type and
 * carries no hardcoded body list. `config` keys are documented by the adapter that reads them; URLs in
 * `config` were verified live on the date in `verifiedAt`.
 */
export interface BodySourceWiring {
  /** Matches `Body.id` in the registry exactly. */
  bodyId: string;
  /**
   * The division whose government meets; the join key on every Meeting. Null for a body with no Census
   * division, whose meetings are then local-tier by construction.
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
   * The body's own meeting-notice page, where one exists ahead of the vendor portal. Retrieved as a
   * document for this body's meetings that have no published agenda yet.
   */
  noticeUrl?: string;
  /**
   * Whether this row's route serves concluded meetings. Absent means yes. Set to `false` only when the
   * published route genuinely carries no past sitting. Not a coverage status. Read by `concludedGapNote()`
   * so the Concluded filter can say why a jurisdiction is empty.
   */
  publishesHistory?: false;
  /** Why, in the reader's own language. Required when the flag is set. */
  historyGapReason?: string;
  /** When the URLs in config were last confirmed working. */
  verifiedAt: string;
}

/**
 * The adapter routes a wiring row actually belongs to.  Most agenda-source
 * types have one implementation.  LEGISTAR is deliberately explicit because
 * WebAPI and InSite are independent publication routes and therefore require
 * independent candidates, clocks, and LKG pointers.
 *
 * This is the production membership boundary: adapter-owned client/tenant
 * arrays may be derived from these rows, but may not add another body.
 */
export function meetingSourceNamesForWiring(row: BodySourceWiring): readonly string[] {
  if (row.agendaSourceType === "LEGISTAR") {
    const routes = row.config.sourceRoutes?.split(",").map((route) => route.trim()).filter(Boolean) ?? [];
    if (routes.length === 0 || routes.some((route) => route !== "legistar" && route !== "legistar-insite")) {
      throw new Error(`MEETING_SOURCE_ROUTES_INVALID:${row.bodyId}`);
    }
    return [...new Set(routes)];
  }
  const routeByType: Partial<Record<AgendaSourceType, string>> = {
    CIVICPLUS: "civicplus",
    ONBASE: "onbase",
    APPTEGY: "apptegy",
    DILIGENT: "diligent",
    CIVICWEB: "diligent",
    CIVICCLERK: "civicclerk",
    CLERKSBOARDS: "clerksboards",
    BOARDBOOK: "boardbook",
    IQM2: "iqm2",
    REVIZE: "revize",
    SCHEDULEPAGE: "schedulepage",
    ICAL: "ical",
    PIMA_EDU: "pima-edu",
    OFFICIAL_PAGE_EVENTS: "official-page-events",
    DOCUMENT_LISTING: "document-listing",
    SUITEONE: "suiteone",
  };
  const route = routeByType[row.agendaSourceType];
  if (route) {
    const retired = retiredMeetingRoute(route, row.bodyId);
    if (retired) {
      throw new Error(
        `MEETING_ROUTE_RETIRED:${route}:${row.bodyId} — retired ${retired.retiredOn} (${retired.reason}); ` +
          `the route that replaced it is ${retired.replacedBy}.`,
      );
    }
  }
  if (route) return [route];
  // A door of an installed engineer-built feed kind is served by that kind's own source.
  const feed = feedKindForWiringType(row.agendaSourceType);
  return feed ? [feed.kind] : [];
}

/**
 * A retired meetings route. A proved source cutover disables its old writer. Naming the (route, body)
 * pair here makes `meetingSourceNamesForWiring` throw for a row that would re-open it and makes agenda
 * retrieval refuse its `hosts` unless `hostsReadable`; `tests/retired-meeting-routes.test.ts` holds that
 * every retired pair has a wired successor. robots.txt alone retires nothing and closes no host.
 *
 * What the retired route already holds stays: its promoted partition version is HELD in the successor's
 * place until the successor's first promotion (`HELD_MEETING_PARTITIONS`,
 * lib/civic-data/meeting-partitions.ts). A route whose host is gone retires the same way, and its host is
 * not readable.
 */
export interface RetiredMeetingRoute {
  /** The adapter route (partition `meetings:<meetingSource>:<bodyId>`) that no longer runs. */
  readonly meetingSource: string;
  readonly bodyId: string;
  /**
   * Hosts the retired route read. No clock or partition reads them for this
   * body. Agenda retrieval refuses them too, unless `hostsReadable` is set.
   */
  readonly hosts: readonly string[];
  /**
   * The retirement closes the route's clock only: its hosts stay readable, so
   * a link into them (the body's own agenda link) is read like any public
   * document. Set for a route superseded by a better one while its host still
   * serves the body's documents — never for a host that is gone.
   */
  readonly hostsReadable?: true;
  /** ISO date of the cutover (`pnpm stamp`). */
  readonly retiredOn: string;
  readonly reason: string;
  /** The wired meeting source that replaced it for the same body. */
  readonly replacedBy: string;
  /** What happens to the rows and documents the retired route already holds. */
  readonly held: string;
  /**
   * The successor was already a wired, promoting route for this body before
   * this one retired — two routes for one body, one of them retired — so the
   * successor has its own pointer from the start. Nothing is HELD in its place
   * (`HELD_MEETING_PARTITIONS` omits the pair), and the Reader proof drops the
   * retired identity's import disposition instead of handing it to a successor
   * that already carries its own.
   */
  readonly successorAlreadyWired?: true;
}

export const RETIRED_MEETING_ROUTES: readonly RetiredMeetingRoute[] = [
  {
    meetingSource: "diligent",
    bodyId: "curated:az/pima-community-college#governing",
    hosts: ["pima.community.highbond.com"],
    hostsReadable: true,
    retiredOn: "2026-09-23",
    reason:
      "retired 2026-09-23 for robots.txt alone: the tenant's robots.txt is an allowlist — six named search " +
      "crawlers may read /Portal/, /document/ and /Services/, and User-agent: * carries Disallow: / (read " +
      "2026-09-23T20:02Z and again 2026-09-25, 23,479 bytes, sha256 b5cbf0b4b2cbcf18…). robots.txt no longer " +
      "blocks since the owner decision of 2026-09-25. The route stays retired because pima-edu carries every " +
      "sitting it did (cutover dry run: 7 the same, 5 added, none removed), and a second route for the body " +
      "would show each sitting twice; its host is readable again for the college's agenda links",
    replacedBy: "pima-edu",
    held:
      "the promoted meetings:diligent partition for this body (7 sittings, 486 stored portal-page reads as of " +
      "2026-09-23T19:48Z) stays in the production store unchanged, composed as held rows until the pima-edu " +
      "partition's first promotion supersedes it; the college's own links into the tenant are carried by " +
      "pima-edu as links, and agenda retrieval reads them",
  },
  {
    // Not a permission cutover: the host is gone (ENOTFOUND).
    meetingSource: "diligent",
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#governing",
    hosts: ["newburynh.civicweb.net"],
    retiredOn: "2026-09-25",
    reason:
      "newburynh.civicweb.net no longer resolves: DNS answers NXDOMAIN and fetch fails with ENOTFOUND " +
      "(read 2026-09-25T17:37Z); every partition read since 2026-09-14 ended SOURCE_BLOCKED",
    replacedBy: "ical",
    held:
      "the promoted meetings:diligent partition for this body stays in the production store unchanged and is no " +
      "longer composed: the town's own calendar feed (newbury-ical-governing, wired 2026-08-20) already carries " +
      "the Selectboard under its own pointer, and the portal links the retired rows carried lead to a host that " +
      "no longer exists",
    successorAlreadyWired: true,
  },
];

export function retiredMeetingRoute(meetingSource: string, bodyId: string): RetiredMeetingRoute | null {
  return (
    RETIRED_MEETING_ROUTES.find((r) => r.meetingSource === meetingSource && r.bodyId === bodyId) ?? null
  );
}

/**
 * Is this URL on a retired route's host that nothing may fetch? Agenda retrieval refuses these; the
 * link stays a link a reader can follow. A retired route whose hosts stay readable (`hostsReadable`) is
 * not one.
 */
export function isUnreadableRetiredMeetingHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return RETIRED_MEETING_ROUTES.some((r) => !r.hostsReadable && r.hosts.includes(host));
}

export function wiringForMeetingSource(sourceName: string): BodySourceWiring[] {
  return activeWiring().filter((row) => meetingSourceNamesForWiring(row).includes(sourceName));
}

export const SOURCE_WIRING: BodySourceWiring[] = [
  // ── Legistar ────────────────────────────────────────────────────────────
  // Both Legistar adapters derive their clients/tenants from these rows. The
  // promoted venue projection supplies mutable venue facts separately.
  {
    bodyId: "ocd-division/country:us/state:az/county:pima#governing",
    ocdId: "ocd-division/country:us/state:az/county:pima",
    agendaSourceType: "LEGISTAR",
    jurisdiction: "Pima County, AZ",
    publishingOrg: "Pima County Clerk of the Board",
    timeZone: "America/Phoenix",
    config: {
      slug: "pima",
      sourceRoutes: "legistar,legistar-insite",
      insiteHost: "pima.legistar.com",
      insiteBodyNames: "Board of Supervisors",
      insiteBodyName: "Board of Supervisors",
      insiteClerkScheduleUrl: "https://www.pima.gov/board-of-supervisors-meeting-schedule",
      insiteFeedId: "43473383",
      insiteFeedGuid: "88b7d677-6602-4f79-b987-4677f7f035e6",
      insiteFeedRange: "Next Month",
      insiteFeedObservedAt: "2026-08-28",
      venueSourceId: "legistar",
    },
    verifiedAt: "2026-08-13",
  },
  /**
   * This InSite membership is declared here and nowhere else: the adapter tenant is a derived projection
   * of this row.
   */
  {
    bodyId: "ocd-division/country:us/state:az/place:mesa#governing",
    ocdId: "ocd-division/country:us/state:az/place:mesa" as OcdId,
    agendaSourceType: "LEGISTAR",
    jurisdiction: "Mesa, AZ",
    publishingOrg: "City of Mesa City Clerk",
    timeZone: "America/Phoenix",
    config: {
      slug: "mesa",
      sourceRoutes: "legistar-insite",
      insiteHost: "mesa.legistar.com",
      insiteBodyNames: "City Council|City Council Study Session|City Council Strategic Planning Session",
      insiteBodyName: "City Council",
      venueSourceId: "legistar-insite",
    },
    // The city's own page for this body's sittings: the schedule, the venue as printed, and a dated
    // instance list.
    noticeUrl: "https://www.mesaaz.gov/Government/City-Council-Meetings",
    verifiedAt: "2026-08-28",
  },

  // ── Hyland OnBase Agenda Online ─────────────────────────────────────────
  {
    bodyId: "ocd-division/country:us/state:az/place:tucson#governing",
    ocdId: "ocd-division/country:us/state:az/place:tucson",
    agendaSourceType: "ONBASE",
    jurisdiction: "Tucson, AZ",
    publishingOrg: "City of Tucson Clerk",
    timeZone: "America/Phoenix",
    config: {
      // The landing page server-renders the meeting list.
      baseUrl: "https://tucsonaz.hylandcloud.com/221agendaonline",
    },
    verifiedAt: "2026-08-13",
  },

  // ── Diligent Community / iCompass (one service, two brand skins) ────────
  // Both portals expose the same WCF JSON service the page itself calls:
  //   <base>/Services/MeetingsService.svc/meetings?from=&to=
  // so CIVICWEB and DILIGENT dispatch to the same adapter while staying distinct AgendaSourceType values.
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
      meetingPath: "/Portal/MeetingInformation.aspx?Org=Cal&Id=",
      extraQuery: "&loadall=true",
      // The board's own Board Actions index: one PDF per sitting, with the action on each item. Portal type
      // ids 17 (Regular) and 29 (Special) are the sittings it covers. See lib/sources/diligent.
      agendaRecordsUrl: "https://govboard.tusd1.org/Actions",
      agendaRecordsTypeIds: "17,29",
      // The board's own meeting calendar (month fragments, inCal.aspx), unioned with the portal's list for
      // the forward window (lib/sources/diligent/schedule-union.ts).
      scheduleCalendarBase: "https://govboard.tusd1.org",
      scheduleCalendarPid: "36871",
      // Portal ids readers already held when the union began; sittings new
      // to the partition are identified by body + local date and time.
      legacyIdsThrough: "505",
      // The upcoming sittings already published under portal ids, so a
      // calendar row inherits the id if the portal stops returning one.
      "legacySitting:503": "2026-09-28T1815-alternative-education-advisory",
      "legacySitting:505": "2026-09-30T1600-budget-advisory",
      "legacySitting:504": "2026-10-05T1730-employee-benefit-trust",
      // The district's own place sentences → the reviewed spellings the
      // portal's rows already resolve through (promoted venue-resolutions).
      "venueMatch:Duffy Community Center":
        "Duffy Community Center Multipurpose Room 5145 E. 5th Street Tucson, AZ 85711",
      "venueMatch:Morrow Education Center":
        "Board Conference Room Morrow Education Center 1010 E. Tenth Street Tucson, Arizona 85719",
    },
    // The board's own notice page: server-renders the meeting notice days before the portal publishes the
    // agenda.
    noticeUrl: "https://govboard.tusd1.org/",
    verifiedAt: "2026-08-13",
  },
  // ── Official-page events: the district's own page, outside any vendor ───
  // These are district-hosted meetings, not the board's. The row keys on the district's only registry
  // body; what a reader is told comes from the meeting itself (`bodyName`, `title`, `eventType`). Its own
  // partition and failure domain, separate from the portal partition for the same body.
  {
    bodyId:
      "ocd-division/country:us/state:az/school_district:tucson_unified_district#board",
    ocdId:
      "ocd-division/country:us/state:az/school_district:tucson_unified_district",
    agendaSourceType: "OFFICIAL_PAGE_EVENTS",
    jurisdiction: "Tucson Unified School District, AZ",
    publishingOrg: "Tucson Unified School District",
    timeZone: "America/Phoenix",
    config: {
      slug: "tusd1-reconfiguration",
      pageUrl: "https://www.tusd1.org/Reconfiguration",
      // The registry body's homepageUrl host — its ownWebAddress. A test
      // holds the two equal, so the registry stays the authority.
      officialHost: "www.tusd1.org",
      bodyName: "Tucson Unified School District",
      // An event must name the district or its committee to publish.
      nameTerms: "Tucson Unified|TUSD|Joint Committee",
    },
    verifiedAt: "2026-09-23",
  },
  {
    // Same Diligent tenant shape; the permalink pattern was verified before being relied on.
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
      // The tenant's MeetingTypeName carries the sitting name, not the body; this is the district's own name
      // for the body.
      "typeName:27": "Governing Board",
      "typeName:21": "Governing Board",
      // The district's own calendar (ParentSquare SmartSites), unioned with the portal's list for the forward
      // window (lib/sources/diligent/schedule-union.ts).
      scheduleCalendarKind: "smartsites",
      siteBase: "https://www.susd12.org",
      calendarApiId: "150042",
      scheduleCalendarTitlePattern: "\\bgoverning board\\b",
      // Portal ids readers already held when the union began.
      legacyIdsThrough: "174",
      "legacySitting:168": "2026-09-29T1830-governing-board",
      "legacySitting:169": "2026-10-13T1830-governing-board",
      "legacySitting:170": "2026-10-27T1830-governing-board",
      "legacySitting:171": "2026-11-10T1830-governing-board",
      "legacySitting:172": "2026-11-24T1830-governing-board",
      "legacySitting:173": "2026-12-08T1830-governing-board",
    },
    verifiedAt: "2026-08-14",
  },

  // No Census division: `ocdId` is null and the body is the curated registry row. Read from the college's
  // own pages (see lib/sources/pima-edu/index.ts); the room code the college prints selects the venue row.
  {
    bodyId: "curated:az/pima-community-college#governing",
    ocdId: null,
    agendaSourceType: "PIMA_EDU",
    jurisdiction: "Pima Community College District, AZ",
    publishingOrg: "Pima Community College Governing Board",
    timeZone: "America/Phoenix",
    config: {
      slug: "pcc",
      documentsUrl:
        "https://www.pima.edu/about-pima/leadership-policies/governing-board/board-meetings/documents.html",
      eventsUrl: "https://events.pima.edu/?calendar[]=3&calId=10",
      committeeName: "Finance and Audit Committee",
      committeeScheduleUrl:
        "https://www.pima.edu/about-pima/leadership-policies/governing-board/finance-advisory-committee/index.html",
      committeeDocumentsUrl:
        "https://www.pima.edu/about-pima/leadership-policies/governing-board/finance-advisory-committee/agendas-minutes.html",
      venueSourceId: "diligent",
      venueTenant: "pcc",
      "venueRoom:C-105": "District Office, Community/Board Room C-105",
      "venueRoom:C-228": "District Office, Board Conference Room C-228",
      venueBuilding: "District Office TBD",
    },
    verifiedAt: "2026-09-23",
  },

  // Boards and commissions via the city clerk's boards app: one server-rendered page per body with the
  // published schedule, location and current agenda. SOURCE_WIRING owns the exact board-route tuples;
  // curated presentation derives LIVE/type status from them.
  ...TUCSON_CLERKSBOARDS_ROUTES.map(
    ([bodySlot, boardId]): BodySourceWiring => ({
      bodyId: `${TUCSON_OCD_ID}#${bodySlot}`,
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
  // The org page server-renders the whole archive with per-row venue name and street address. Meetings
  // post days ahead, so an empty upcoming window between postings is the portal's own state.
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
      // The archive rung: `2` is the Township Council checkbox value in the AgendaCenter's own category
      // filter (the page carries other boards too).
      agendaCenterUrl: "https://www.rockawaytownship.org/AgendaCenter",
      agendaCenterCategoryId: "2",
    },
    // The iCal feed is upcoming-only; the AgendaCenter archive carries past sittings, which are date-only
    // (`startPrecision: "DAY"`).
    verifiedAt: "2026-08-15",
  },

  // The township's other live boards are in a different calendar category from the council. Archive
  // categories are read off each `<div id="cat<N>">` block's heading, never by document order.
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
  // Calendar.aspx?From=&To= is server-rendered with future meetings; each row's tooltip publishes board,
  // type, status and venue with street address. The RSS pseudo-feed lists only published documents and is
  // not used.
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
  // calendar.php is JS-only; the homepage "Upcoming Meetings" block and the notices/agendas page are
  // server-rendered. Meetings come from the block, agenda PDFs matched by filename date from the page.
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
    // The upcoming block carries no past sittings; the notices/agendas page carries the history as dated
    // documents, emitted date-only (`startPrecision: "DAY"`), never with an invented time.
    verifiedAt: "2026-08-15",
  },

  // ── Apptegy / Thrillshare ───────────────────────────────────────────────
  // The district website's own events API, carrying start times with offsets, the venue string and
  // district-published coordinates. The org id is read from the embedded page state.
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
  // ── The published annual schedule ───────────────────────────────────────
  // The board's own meetings page lists the year's dates with one sentence naming the time and room.
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

  // Agendas, results and minutes are published only on destinyhosted.com. `destinyAgenda` joins each
  // listed agenda, result and video to the sitting the city's own pages dated. The city's schedule table
  // states no time, so none is claimed; its "usually meets at" sentence is a usual place, so `venueMatch`
  // resolves only once a reviewed venue says so.
  {
    bodyId: "ocd-division/country:us/state:az/place:chandler#governing",
    ocdId: "ocd-division/country:us/state:az/place:chandler",
    agendaSourceType: "SCHEDULEPAGE",
    jurisdiction: "Chandler, AZ",
    publishingOrg: "City of Chandler City Clerk's Office",
    timeZone: "America/Phoenix",
    config: {
      slug: "chandler-city-council",
      schedulePage:
        "https://www.chandleraz.gov/government/departments/city-clerks-office/city-council-meetings",
      bodyName: "City Council",
      shapes: "dated-list",
      // The accordion section that holds the schedule table and nothing else
      // dated: the rest of the page carries news and archive dates.
      sectionMatch: "paragraph--id--18399",
      venueMatch: "Council Chambers, 88 E. Chicago St.",
      // The city's own day file for each scheduled date in the window (one request per date): the whole city
      // calendar, filtered by the council's own name.
      dayJson: "https://www.chandleraz.gov/rest/events/day/",
      titleMatch: "City Council",
      // The Council's own Destiny Agenda list (tenant 24263, meeting type CC),
      // the page every "View Current Agenda" link on the city's event pages
      // leads to. One request per month in reach; no sitting is made from it.
      destinyAgenda: "https://public.destinyhosted.com/agenda_publish.cfm?id=24263&mt=CC",
    },
    verifiedAt: "2026-09-25",
  },

  // The city's own agendas-and-minutes page, one page per year, listing each sitting by date with its
  // agenda and minutes. It states no hour and no room, so every sitting ships date-only with its agenda
  // cited. A sitting appears when the city posts its agenda.
  {
    bodyId: "ocd-division/country:us/state:az/place:holbrook#governing",
    ocdId: "ocd-division/country:us/state:az/place:holbrook",
    agendaSourceType: "DOCUMENT_LISTING",
    jurisdiction: "Holbrook, AZ",
    publishingOrg: "City of Holbrook",
    timeZone: "America/Phoenix",
    config: {
      slug: "holbrook-city-council",
      pageTemplate: "https://holbrookaz.gov/government/council-agenda/{year}-agendas-minutes/",
      // The government's reviewed current website (lib/civic-data/website-corrections.ts); a test holds the
      // two equal.
      officialHost: "holbrookaz.gov",
      bodyName: "City Council",
      // The kinds the page's own labels give the council's sittings. Any
      // other dated label ("Statement of Legal Action") is a document of a
      // sitting, never a sitting.
      sittingKinds: "Regular Meeting|Special Meeting|Work Session",
      agendaHeading: "Agendas",
      minutesHeading: "Minutes",
    },
    verifiedAt: "2026-09-25",
  },

  // Council agendas, packets, minutes and video on the city's SuiteOne Media portal, whose server-rendered
  // home page lists the next ten meetings of every body and a council panel of current and previous
  // sittings.
  {
    bodyId: "ocd-division/country:us/state:az/place:winslow#governing",
    ocdId: "ocd-division/country:us/state:az/place:winslow",
    agendaSourceType: "SUITEONE",
    jurisdiction: "Winslow, AZ",
    publishingOrg: "City of Winslow",
    timeZone: "America/Phoenix",
    config: {
      slug: "winslow-city-council",
      // The portal's home page as its own `/web/` link lands on it.
      portalUrl: "https://winslowaz.suiteonemedia.com/?embed=1",
      // The past-meetings panel's own heading, exactly.
      groupName: "City Council",
      // Upcoming rows name no category; the city titles every council sitting
      // "City Council …".
      titleMatch: "City Council",
      bodyName: "City Council",
    },
    verifiedAt: "2026-09-25",
  },

  // These hosts challenge Node's client and admit the same identified client through curl
  // (`lib/sources/http.ts`); the client is never dressed as a browser. The board publishes its year as a
  // month table with the time and place in bullets; the agendas archive dates each link in its own text,
  // so documents join on a published date.
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
      // A schedule row naming a different building resolves on its own string and drops (counted) rather
      // than inheriting the standard venue.
      otherVenueMarkers: "KRMS",
    },
    verifiedAt: "2026-08-15",
  },

  // Land-use boards on the town's own Drupal site, which publishes a `dc:date` per sitting with the
  // offset. `pathPrefix` is load-bearing: every board's blocks share identical markup, and a prefix-free
  // parse would file one board's sitting under another's.
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
  // Bodies the town calendar never carries, each read from its own site. The library feed also carries
  // programs, so `titleMatch` is required.
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#library-trustees",
    ocdId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    agendaSourceType: "SCHEDULEPAGE",
    jurisdiction: "Newbury, NH",
    publishingOrg: "Newbury Public Library Board of Trustees",
    timeZone: "America/New_York",
    config: {
      slug: "newbury-library-trustees-notices",
      shapes: "notice-feed",
      schedulePage: "https://newburynhlibrary.net/feed/",
      titleMatch: "Trustee",
      bodyName: "Newbury Public Library Trustees",
      venueMatch: "Newbury Public Library",
      otherVenueMarkers: "Newbury Public Library",
    },
    verifiedAt: "2026-09-24",
  },
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#energy-committee",
    ocdId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    agendaSourceType: "SCHEDULEPAGE",
    jurisdiction: "Newbury, NH",
    publishingOrg: "Newbury Energy Committee",
    timeZone: "America/New_York",
    config: {
      slug: "newbury-energy-committee-page",
      shapes: "next-meeting-line",
      schedulePage: "https://www.newburyenergynh.org/",
      bodyName: "Newbury Energy Committee",
      venueMatch: "Newbury Town Office",
    },
    verifiedAt: "2026-09-24",
  },
  // `venueMatch` keys the board's own venue label.
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

  // The town's own iCalendar. The feed carries no `CATEGORIES`, so `titleMatch` discriminates; the
  // variants listed are the town's own spellings. Bodies already served by another route keep it.
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
      // The feed's bare "Budget Committee Meeting" is not claimed: it names no advisory body.
      titleMatch: "Advisory Budget Committee,Budget Advisory Committee",
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

  // A second route for boards already wired, not a replacement: the existing routes carry agendas this
  // feed does not. Safe only because `collapseDuplicateSittings` (lib/sources/composite/index.ts) keeps
  // the row carrying the agenda.
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
    // A body the town's boards menu does not list and its calendar does. It has no page on the town's
    // site, so `homepageUrl` is the town's calendar. Both spellings are matched because the town uses both.
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

  // The Events Calendar (WordPress) `.ics`: the board's own name is in `CATEGORIES`, so one feed serves
  // several bodies without guessing from a title. `feedUrl` names the list view on purpose:
  // `/events/?ical=1` returns only the current view.
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
      // The archive, at the same feed.
      pastFeedUrl:
        "https://www.wilmotnh.org/events/list/?tribe_event_display=past&ical=1",
      categoryMatch: "Select Board",
      bodyName: "Selectboard",
      // The feed writes only the state in `LOCATION`; the board's own page states where it meets, and the
      // curated venue cites that page.
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
      // The archive, at the same feed.
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
      // The archive, at the same feed.
      pastFeedUrl:
        "https://www.wilmotnh.org/events/list/?tribe_event_display=past&ical=1",
      categoryMatch: "Cemetery Trustees",
      bodyName: "Cemetery Trustees",
    },
    verifiedAt: "2026-08-19",
  },
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:wilmot_town#conservation-commission",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:wilmot_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Wilmot, NH",
    publishingOrg: "Town of Wilmot",
    timeZone: "America/New_York",
    config: {
      slug: "wilmot-conservation-commission",
      feedUrl: "https://www.wilmotnh.org/events/list/?ical=1",
      pastFeedUrl:
        "https://www.wilmotnh.org/events/list/?tribe_event_display=past&ical=1",
      categoryMatch: "Conservation Commission",
      bodyName: "Conservation Commission",
      venueMatch: "Wilmot Town Office Building",
    },
    verifiedAt: "2026-08-21",
  },

  // Subcommittees whose sittings the town files under a parent board's CATEGORIES have no row here: a
  // title-matched row over the same feed would count them twice. They ship KNOWN_UNCOVERED.

  // Every event on this feed has an empty `LOCATION`; the venue comes from the board's own page.
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:sutton_town#planning-board",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:sutton_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Sutton, NH",
    publishingOrg: "Town of Sutton",
    timeZone: "America/New_York",
    config: {
      slug: "sutton-planning-board",
      feedUrl: "https://www.suttonnh.gov/calendar/ical/calendar.ics",
      // The feed carries no `CATEGORIES`, so the title is the only discriminator. `titleExclude` keeps other
      // boards' joint sittings out.
      titleMatch: "Planning Board",
      titleExclude: "Joint,Zoning,Budget",
      bodyName: "Planning Board",
      // Reached only because every event's `LOCATION` is empty: the board's own published standing venue,
      // cited to its page.
      venueMatch: "Pillsbury Memorial Hall",
    },
    verifiedAt: "2026-08-21",
  },

  // Where a board page states no venue and the site footer carries the town's address, the footer
  // address is used and cited as the municipality's, never as the board's. Bodies whose own titles name
  // another venue or Zoom are not wired on the footer address.
  ...(
    [
      ["select-board", "Select Board", "Select Board", "Joint,Planning,Zoning,Budget"],
      [
        "conservation-commission",
        "Conservation Commission",
        "Conservation Commission",
        "Joint",
      ],
      ["cemetery-commission", "Cemetery Commission", "Cemetery Commission", "Joint"],
      // The Zoning Board files its sittings under the feed's own initialism.
      // The registry's slug, which differs from the site's page path for the same body.
      ["zoning-board", "Zoning Board of Adjustment", "ZBA", "Joint,Planning"],
      [
        "hazard-mitigation-committee",
        "Hazard Mitigation Committee",
        "Hazard Mitigation",
        "Joint",
      ],
      [
        "ad-hoc-fire-safety-municipal-building-committee",
        "Ad Hoc Fire Safety Municipal Building Committee",
        // The feed's abbreviated spelling of the same committee.
        "Fire Safety Municipal Building,Fire Safety Municipal Bldg",
        "Joint",
      ],
      [
        "ad-hoc-sutton-connects-committee",
        "Ad Hoc Sutton Connects! Committee",
        "Sutton Connects",
        "Joint",
      ],
    ] as const
  ).map(([slug, bodyName, titleMatch, titleExclude]) => ({
    bodyId: `ocd-division/country:us/state:nh/county:merrimack/place:sutton_town#${slug}`,
    ocdId:
      "ocd-division/country:us/state:nh/county:merrimack/place:sutton_town" as OcdId,
    agendaSourceType: "ICAL" as const,
    jurisdiction: "Sutton, NH",
    publishingOrg: "Town of Sutton",
    timeZone: "America/New_York",
    config: {
      slug: `sutton-${slug}`,
      feedUrl: "https://www.suttonnh.gov/calendar/ical/calendar.ics",
      titleMatch,
      titleExclude,
      bodyName,
      // The town's own footer address, cited as the footer.
      venueMatch: "Sutton Town Offices",
    },
    verifiedAt: "2026-08-22",
  })),

  // One town calendar (GovOffice event-tip shape): each event carries its own date and time in a tooltip
  // block. `titleMatch` separates the bodies on the shared page; `monthsAhead` walks the page's own month
  // navigation, since the default view is one month. An unkeyed room drops and is counted rather than
  // inheriting an address.
  ...(
    [
      ["board-of-selectmen", "Board of Selectmen", "Board of Selectmen"],
      ["planning-board", "Planning Board", "Planning Board"],
      ["zoning-board", "Zoning Board", "Zoning Board"],
      ["conservation-commission", "Conservation Commission", "Conservation Commission"],
      // Each phrase below is read off this calendar's own event titles.
      ["budget-committee", "Budget Committee", "Budget Committee"],
      ["energy-committee", "Energy Committee", "Energy Committee"],
      ["housing-commission", "Housing Commission", "Housing Commission"],
      ["recreation-commission", "Recreation Commission", "Recreation Commission"],
      // The town's own spellings, read off the calendar's list view; apostrophes are set aside when matching.
      ["board-of-firewards", "Firewards,Fire Wards", "Board of Firewards"],
      ["archives-committee", "Archives Committee", "Archives Committee"],
      [
        "bicycle-pedestrian-advisory-committee",
        "Pedestrian",
        "Bicycle & Pedestrian Advisory Committee",
      ],
      ["citizens-committee", "Citizens Committee,Citizens Advisory Committee", "Citizens' Committee"],
      ["trustees-of-the-trust-funds", "Trust Fund", "Trustees of the Trust Funds"],
      [
        "tri-town-assessing-board",
        "Tri-Town Assessing",
        "Tri-Town Assessing Board (New London, Sunapee & Newbury)",
      ],
      [
        "supervisors-of-the-checklist",
        "Supervisors of the Checklist",
        "Supervisors of the Checklist",
      ],
      [
        "capital-improvement-program",
        "Capital Improvement Program",
        "Capital Improvement Program Committee",
      ],
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
      // The hall the calendar names most often. A row naming a different room resolves on its own string via
      // `otherVenueMarkers`.
      venueMatch: "Whipple Memorial Town Hall",
      otherVenueMarkers:
        "Whipple Memorial Hall,Whipple Hall,New London Town Office,Syd Crook,Sydney Crook,Fire Department," +
        "Newbury Town Office,Sunapee Town Offices",
    },
    verifiedAt: "2026-09-25",
  })),

  // Bodies on live town calendars. Every `titleMatch` was checked against the feed it reads; the only
  // summaries two bodies share are joint meetings, which belong to both. A body the town names and the
  // calendar never mentions has no row and ships `KNOWN_UNCOVERED`.
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town#select-board",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Bradford, NH",
    publishingOrg: "Town of Bradford",
    timeZone: "America/New_York",
    config: {
      slug: "bradford-select-board",
      feedUrl: "https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics",
      titleMatch: "Select Board,Board of Selectmen",
      bodyName: "Select Board",
    },
    noticeUrl: "https://bradfordnh.gov/pages/calendar",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town#budget-committee",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Bradford, NH",
    publishingOrg: "Town of Bradford",
    timeZone: "America/New_York",
    config: {
      slug: "bradford-budget-committee",
      feedUrl: "https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics",
      titleMatch: "Budget Committee",
      bodyName: "Budget Committee",
    },
    noticeUrl: "https://bradfordnh.gov/pages/calendar",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town#cemetery-trustees",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Bradford, NH",
    publishingOrg: "Town of Bradford",
    timeZone: "America/New_York",
    config: {
      slug: "bradford-cemetery-trustees",
      feedUrl: "https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics",
      titleMatch: "Cemetery Commission,Cemetery Trustees",
      bodyName: "Cemetery Trustees",
    },
    noticeUrl: "https://bradfordnh.gov/pages/calendar",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town#community-power-committee",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Bradford, NH",
    publishingOrg: "Town of Bradford",
    timeZone: "America/New_York",
    config: {
      slug: "bradford-community-power-committee",
      feedUrl: "https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics",
      titleMatch: "Community Power",
      bodyName: "Community Power Committee",
    },
    noticeUrl: "https://bradfordnh.gov/pages/calendar",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town#conservation-commission",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Bradford, NH",
    publishingOrg: "Town of Bradford",
    timeZone: "America/New_York",
    config: {
      slug: "bradford-conservation-commission",
      feedUrl: "https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics",
      titleMatch: "Conservation Commission",
      bodyName: "Conservation Commission",
    },
    noticeUrl: "https://bradfordnh.gov/pages/calendar",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town#economic-development-committee",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Bradford, NH",
    publishingOrg: "Town of Bradford",
    timeZone: "America/New_York",
    config: {
      slug: "bradford-economic-development-committee",
      feedUrl: "https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics",
      titleMatch: "Economic Development",
      bodyName: "Economic Development Committee",
    },
    noticeUrl: "https://bradfordnh.gov/pages/calendar",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town#energy-committee",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Bradford, NH",
    publishingOrg: "Town of Bradford",
    timeZone: "America/New_York",
    config: {
      slug: "bradford-energy-committee",
      feedUrl: "https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics",
      titleMatch: "Energy Committee",
      bodyName: "Energy Committee",
    },
    noticeUrl: "https://bradfordnh.gov/pages/calendar",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town#parks-and-recreation",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Bradford, NH",
    publishingOrg: "Town of Bradford",
    timeZone: "America/New_York",
    config: {
      slug: "bradford-parks-and-recreation",
      feedUrl: "https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics",
      titleMatch: "Parks and Recreation,Parks & Recreation,Parks and Rec,Parks & Rec",
      bodyName: "Parks and Recreation Committee",
    },
    noticeUrl: "https://bradfordnh.gov/pages/calendar",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town#planning-board",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Bradford, NH",
    publishingOrg: "Town of Bradford",
    timeZone: "America/New_York",
    config: {
      slug: "bradford-planning-board",
      feedUrl: "https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics",
      titleMatch: "Planning Board",
      bodyName: "Planning Board",
    },
    noticeUrl: "https://bradfordnh.gov/pages/calendar",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town#zoning-board",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Bradford, NH",
    publishingOrg: "Town of Bradford",
    timeZone: "America/New_York",
    config: {
      slug: "bradford-zoning-board",
      feedUrl: "https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics",
      titleMatch: "Zoning Board,ZBA",
      bodyName: "Zoning Board of Adjustment",
    },
    noticeUrl: "https://bradfordnh.gov/pages/calendar",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town#cip-committee",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Bradford, NH",
    publishingOrg: "Town of Bradford",
    timeZone: "America/New_York",
    config: {
      slug: "bradford-cip-committee",
      feedUrl: "https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics",
      titleMatch: "CIP Committee,CIP Meeting",
      bodyName: "Capital Improvement Program Committee",
    },
    noticeUrl: "https://bradfordnh.gov/pages/calendar",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town#hazard-mitigation-committee",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Bradford, NH",
    publishingOrg: "Town of Bradford",
    timeZone: "America/New_York",
    config: {
      slug: "bradford-hazard-mitigation-committee",
      feedUrl: "https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics",
      titleMatch: "Hazard Mitigation",
      bodyName: "Hazard Mitigation Committee",
    },
    noticeUrl: "https://bradfordnh.gov/pages/calendar",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town#facilities-use-committee",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Bradford, NH",
    publishingOrg: "Town of Bradford",
    timeZone: "America/New_York",
    config: {
      slug: "bradford-facilities-use-committee",
      feedUrl: "https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics",
      titleMatch: "Facilities Use",
      bodyName: "Facilities Use Committee",
    },
    noticeUrl: "https://bradfordnh.gov/pages/calendar",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town#independence-day-committee",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Bradford, NH",
    publishingOrg: "Town of Bradford",
    timeZone: "America/New_York",
    config: {
      slug: "bradford-independence-day-committee",
      feedUrl: "https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics",
      titleMatch: "Independence Day Committee",
      bodyName: "Independence Day Committee",
    },
    noticeUrl: "https://bradfordnh.gov/pages/calendar",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town#supervisors-of-the-checklist",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Bradford, NH",
    publishingOrg: "Town of Bradford",
    timeZone: "America/New_York",
    config: {
      slug: "bradford-supervisors-of-the-checklist",
      feedUrl: "https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics",
      titleMatch: "Supervisors of Checklist,Supervisors of the Checklist,Checklist Session",
      bodyName: "Supervisors of the Checklist",
    },
    noticeUrl: "https://bradfordnh.gov/pages/calendar",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town#select-board",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Warner, NH",
    publishingOrg: "Town of Warner",
    timeZone: "America/New_York",
    config: {
      slug: "warner-select-board",
      feedUrl: "https://calendar.google.com/calendar/ical/4550fa96f9a1e211bad70b5ea77be1c4e926eeeb164d25bd76571e7de8251fcd%40group.calendar.google.com/public/basic.ics",
      titleMatch: "Select Board,SB Wk Sess,SB Work Session",
      bodyName: "Select Board",
      // The hall the Select Board's own page gives as its address, and the
      // building this calendar names on 47 of its board sittings. Reached only
      // when the event itself carried no location at all.
      venueMatch: "Warner Town Hall",
    },
    noticeUrl: "https://warnernh.gov/calendar/",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town#agricultural-commission",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Warner, NH",
    publishingOrg: "Town of Warner",
    timeZone: "America/New_York",
    config: {
      slug: "warner-agricultural-commission",
      feedUrl: "https://calendar.google.com/calendar/ical/4550fa96f9a1e211bad70b5ea77be1c4e926eeeb164d25bd76571e7de8251fcd%40group.calendar.google.com/public/basic.ics",
      titleMatch: "Agricultural Commission,Ag Commission",
      bodyName: "Agricultural Commission",
      // The hall the Select Board's own page gives as its address, and the
      // building this calendar names on 47 of its board sittings. Reached only
      // when the event itself carried no location at all.
      venueMatch: "Warner Town Hall",
    },
    noticeUrl: "https://warnernh.gov/calendar/",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town#auditor-search-committee",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Warner, NH",
    publishingOrg: "Town of Warner",
    timeZone: "America/New_York",
    config: {
      slug: "warner-auditor-search-committee",
      feedUrl: "https://calendar.google.com/calendar/ical/4550fa96f9a1e211bad70b5ea77be1c4e926eeeb164d25bd76571e7de8251fcd%40group.calendar.google.com/public/basic.ics",
      titleMatch: "Auditor Search",
      bodyName: "Auditor Search Committee",
      // The hall the Select Board's own page gives as its address, and the
      // building this calendar names on 47 of its board sittings. Reached only
      // when the event itself carried no location at all.
      venueMatch: "Warner Town Hall",
    },
    noticeUrl: "https://warnernh.gov/calendar/",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town#budget-committee",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Warner, NH",
    publishingOrg: "Town of Warner",
    timeZone: "America/New_York",
    config: {
      slug: "warner-budget-committee",
      feedUrl: "https://calendar.google.com/calendar/ical/4550fa96f9a1e211bad70b5ea77be1c4e926eeeb164d25bd76571e7de8251fcd%40group.calendar.google.com/public/basic.ics",
      titleMatch: "Budget Comm",
      bodyName: "Budget Committee",
      // The hall the Select Board's own page gives as its address, and the
      // building this calendar names on 47 of its board sittings. Reached only
      // when the event itself carried no location at all.
      venueMatch: "Warner Town Hall",
    },
    noticeUrl: "https://warnernh.gov/calendar/",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town#chandler-reservation-committee",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Warner, NH",
    publishingOrg: "Town of Warner",
    timeZone: "America/New_York",
    config: {
      slug: "warner-chandler-reservation-committee",
      feedUrl: "https://calendar.google.com/calendar/ical/4550fa96f9a1e211bad70b5ea77be1c4e926eeeb164d25bd76571e7de8251fcd%40group.calendar.google.com/public/basic.ics",
      titleMatch: "Chandler Reservation,Chandler Comm",
      bodyName: "Chandler Reservation Committee",
      // The hall the Select Board's own page gives as its address, and the
      // building this calendar names on 47 of its board sittings. Reached only
      // when the event itself carried no location at all.
      venueMatch: "Warner Town Hall",
    },
    noticeUrl: "https://warnernh.gov/calendar/",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town#conservation-commission",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Warner, NH",
    publishingOrg: "Town of Warner",
    timeZone: "America/New_York",
    config: {
      slug: "warner-conservation-commission",
      feedUrl: "https://calendar.google.com/calendar/ical/4550fa96f9a1e211bad70b5ea77be1c4e926eeeb164d25bd76571e7de8251fcd%40group.calendar.google.com/public/basic.ics",
      titleMatch: "Conservation Commission,Con Com",
      bodyName: "Conservation Commission",
      // The hall the Select Board's own page gives as its address, and the
      // building this calendar names on 47 of its board sittings. Reached only
      // when the event itself carried no location at all.
      venueMatch: "Warner Town Hall",
    },
    noticeUrl: "https://warnernh.gov/calendar/",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town#energy-solar-committee",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Warner, NH",
    publishingOrg: "Town of Warner",
    timeZone: "America/New_York",
    config: {
      slug: "warner-energy-solar-committee",
      feedUrl: "https://calendar.google.com/calendar/ical/4550fa96f9a1e211bad70b5ea77be1c4e926eeeb164d25bd76571e7de8251fcd%40group.calendar.google.com/public/basic.ics",
      titleMatch: "Energy Committee,Solar Committee,Energy/Solar",
      bodyName: "Energy/Solar Committee",
      // The hall the Select Board's own page gives as its address, and the
      // building this calendar names on 47 of its board sittings. Reached only
      // when the event itself carried no location at all.
      venueMatch: "Warner Town Hall",
    },
    noticeUrl: "https://warnernh.gov/calendar/",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town#housing-committee",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Warner, NH",
    publishingOrg: "Town of Warner",
    timeZone: "America/New_York",
    config: {
      slug: "warner-housing-committee",
      feedUrl: "https://calendar.google.com/calendar/ical/4550fa96f9a1e211bad70b5ea77be1c4e926eeeb164d25bd76571e7de8251fcd%40group.calendar.google.com/public/basic.ics",
      titleMatch: "Housing Committee",
      titleExclude: "Advisory",
      bodyName: "Housing Committee",
      // The hall the Select Board's own page gives as its address, and the
      // building this calendar names on 47 of its board sittings. Reached only
      // when the event itself carried no location at all.
      venueMatch: "Warner Town Hall",
    },
    noticeUrl: "https://warnernh.gov/calendar/",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town#parks-and-recreation",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Warner, NH",
    publishingOrg: "Town of Warner",
    timeZone: "America/New_York",
    config: {
      slug: "warner-parks-and-recreation",
      feedUrl: "https://calendar.google.com/calendar/ical/4550fa96f9a1e211bad70b5ea77be1c4e926eeeb164d25bd76571e7de8251fcd%40group.calendar.google.com/public/basic.ics",
      titleMatch: "Parks & Rec,Parks and Rec,P&R",
      bodyName: "Parks and Recreation Commission",
      // The hall the Select Board's own page gives as its address, and the
      // building this calendar names on 47 of its board sittings. Reached only
      // when the event itself carried no location at all.
      venueMatch: "Warner Town Hall",
    },
    noticeUrl: "https://warnernh.gov/calendar/",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town#planning-board",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Warner, NH",
    publishingOrg: "Town of Warner",
    timeZone: "America/New_York",
    config: {
      slug: "warner-planning-board",
      feedUrl: "https://calendar.google.com/calendar/ical/4550fa96f9a1e211bad70b5ea77be1c4e926eeeb164d25bd76571e7de8251fcd%40group.calendar.google.com/public/basic.ics",
      titleMatch: "Planning Board",
      bodyName: "Planning Board",
      // The hall the Select Board's own page gives as its address, and the
      // building this calendar names on 47 of its board sittings. Reached only
      // when the event itself carried no location at all.
      venueMatch: "Warner Town Hall",
    },
    noticeUrl: "https://warnernh.gov/calendar/",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town#road-committee",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Warner, NH",
    publishingOrg: "Town of Warner",
    timeZone: "America/New_York",
    config: {
      slug: "warner-road-committee",
      feedUrl: "https://calendar.google.com/calendar/ical/4550fa96f9a1e211bad70b5ea77be1c4e926eeeb164d25bd76571e7de8251fcd%40group.calendar.google.com/public/basic.ics",
      titleMatch: "Road Committee",
      bodyName: "Road Committee",
      // The hall the Select Board's own page gives as its address, and the
      // building this calendar names on 47 of its board sittings. Reached only
      // when the event itself carried no location at all.
      venueMatch: "Warner Town Hall",
    },
    noticeUrl: "https://warnernh.gov/calendar/",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town#supervisors-of-the-checklist",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Warner, NH",
    publishingOrg: "Town of Warner",
    timeZone: "America/New_York",
    config: {
      slug: "warner-supervisors-of-the-checklist",
      feedUrl: "https://calendar.google.com/calendar/ical/4550fa96f9a1e211bad70b5ea77be1c4e926eeeb164d25bd76571e7de8251fcd%40group.calendar.google.com/public/basic.ics",
      titleMatch: "Supervisors of the Checklist,Supervisors of Checklist",
      bodyName: "Supervisors of the Checklist",
      // The hall the Select Board's own page gives as its address, and the
      // building this calendar names on 47 of its board sittings. Reached only
      // when the event itself carried no location at all.
      venueMatch: "Warner Town Hall",
    },
    noticeUrl: "https://warnernh.gov/calendar/",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town#trustees-of-the-trust-funds",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Warner, NH",
    publishingOrg: "Town of Warner",
    timeZone: "America/New_York",
    config: {
      slug: "warner-trustees-of-the-trust-funds",
      feedUrl: "https://calendar.google.com/calendar/ical/4550fa96f9a1e211bad70b5ea77be1c4e926eeeb164d25bd76571e7de8251fcd%40group.calendar.google.com/public/basic.ics",
      titleMatch: "Trustees of Trust Funds,Trustees of the Trust Funds,Trust Funds",
      bodyName: "Trustees of the Trust Funds",
      // The hall the Select Board's own page gives as its address, and the
      // building this calendar names on 47 of its board sittings. Reached only
      // when the event itself carried no location at all.
      venueMatch: "Warner Town Hall",
    },
    noticeUrl: "https://warnernh.gov/calendar/",
    verifiedAt: "2026-08-21",
  },
  // This committee's series comes from the library's public calendar, embedded with the town's; entries
  // prefixed "NO"/"NOT" are the library saying a sitting will not happen.
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town#warner-river-local-advisory-committee",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Warner, NH",
    publishingOrg: "Pillsbury Free Library (Warner, NH)",
    timeZone: "America/New_York",
    config: {
      slug: "warner-warner-river-local-advisory-committee",
      feedUrl: "https://calendar.google.com/calendar/ical/mq5sbbdfvg3le9ddpc76qpo5d8%40group.calendar.google.com/public/basic.ics",
      titleMatch: "WRLAC,Warner River LAC,Warner River Local Advisory,Warner Local River Advisory",
      titleExclude: "NO Warner River,NOT Warner River",
      bodyName: "Warner River Local Advisory Committee",
      // Reached only when the event itself carried no location at all; the
      // library's events name the library.
      venueMatch: "Warner Town Hall",
    },
    noticeUrl: "https://warnernh.gov/calendar/",
    verifiedAt: "2026-09-25",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town#warner-village-water-district",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Warner, NH",
    publishingOrg: "Town of Warner",
    timeZone: "America/New_York",
    config: {
      slug: "warner-warner-village-water-district",
      feedUrl: "https://calendar.google.com/calendar/ical/4550fa96f9a1e211bad70b5ea77be1c4e926eeeb164d25bd76571e7de8251fcd%40group.calendar.google.com/public/basic.ics",
      // The district commissioners' standing series on this feed; the district's page calls its area "the
      // Precinct".
      titleMatch: "Warner Village Water,WVWD,Precinct Commissioners",
      titleExclude: "Budget Comm",
      bodyName: "Warner Village Water District",
      // The hall the Select Board's own page gives as its address, and the
      // building this calendar names on 47 of its board sittings. Reached only
      // when the event itself carried no location at all.
      venueMatch: "Warner Town Hall",
    },
    noticeUrl: "https://warnernh.gov/calendar/",
    verifiedAt: "2026-08-21",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town#zoning-board",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:warner_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Warner, NH",
    publishingOrg: "Town of Warner",
    timeZone: "America/New_York",
    config: {
      slug: "warner-zoning-board",
      feedUrl: "https://calendar.google.com/calendar/ical/4550fa96f9a1e211bad70b5ea77be1c4e926eeeb164d25bd76571e7de8251fcd%40group.calendar.google.com/public/basic.ics",
      titleMatch: "Zoning Board,ZBA",
      bodyName: "Zoning Board of Adjustment",
      // The hall the Select Board's own page gives as its address, and the
      // building this calendar names on 47 of its board sittings. Reached only
      // when the event itself carried no location at all.
      venueMatch: "Warner Town Hall",
    },
    noticeUrl: "https://warnernh.gov/calendar/",
    verifiedAt: "2026-08-21",
  },
  // One body, one row; `alsoServesOcdIds` lets readers in its other town reach it. Its own site is
  // unreachable, so its sittings come from the town calendar.
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#lake-todd-village-district",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town" as OcdId,
    agendaSourceType: "ICAL",
    jurisdiction: "Lake Todd Village District, NH",
    publishingOrg: "Town of Bradford",
    timeZone: "America/New_York",
    config: {
      slug: "lake-todd-village-district-newbury",
      feedUrl: "https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics",
      // The district's own abbreviation. Sittings named only in the description are not read by this adapter.
      titleMatch: "Lake Todd,LTVD",
      bodyName: "Lake Todd Village District",
    },
    // The town's calendar page is the live notice and the page its sittings come from.
    noticeUrl: "https://bradfordnh.gov/pages/calendar",
    verifiedAt: "2026-08-21",
  },

  // ── CivicClerk: the tenant slug is in the page ──────────────────────────
  // The page carries `window.clerkEmbedProps`, and with that tenant slug the portal's own OData API answers
  // a plain unauthenticated GET.
  {
    bodyId:
      "ocd-division/country:us/state:az/county:pima#central-arizona-water-conservation-district",
    // The district covers several counties; it is keyed on the one this product serves, under-serving
    // rather than over-serving.
    ocdId: "ocd-division/country:us/state:az/county:pima" as OcdId,
    agendaSourceType: "CIVICCLERK",
    jurisdiction: "Central Arizona Water Conservation District, AZ",
    publishingOrg: "Central Arizona Water Conservation District",
    timeZone: "America/Phoenix",
    config: {
      slug: "capaz",
      apiBase: "https://capaz.api.civicclerk.com",
      portalBase: "https://capaz.portal.civicclerk.com",
    },
    // The district's own meetings page — the page the tenant slug was read
    // from, and the one a reader would look at.
    noticeUrl: "https://www.cap-az.com/board/board-committee-meetings/",
    verifiedAt: "2026-08-27",
  },
];

/**
 * The Door Registry's rows for this process, when the registry is the source. Null means the code's own
 * `SOURCE_WIRING`, the default: the registry is read only after `lib/doors/install.ts` checked it
 * against the code and the switch is on.
 */
let registryWiring: readonly BodySourceWiring[] | null = null;

export function installRegistryWiring(rows: readonly BodySourceWiring[] | null): void {
  registryWiring = rows;
}

/** The hand-wired rows adapters read right now: the registry's when installed, otherwise the code's. */
export function activeWiring(): readonly BodySourceWiring[] {
  return registryWiring ?? SOURCE_WIRING;
}

/** Rows a given adapter capability should serve. */
export function wiringForTypes(
  types: AgendaSourceType[],
): BodySourceWiring[] {
  return activeWiring().filter((row) => types.includes(row.agendaSourceType));
}
