import type { OcdId } from "../sources/types.ts";
import type { AgendaSourceType } from "./types.ts";

/** The one Tucson division every clerksboards body sits on. */
const TUCSON_OCD_ID = "ocd-division/country:us/state:az/place:tucson" as OcdId;

/**
 * SOURCE_WIRING-owned Tucson route membership. Curated body presentation
 * derives its LIVE status from these rows; it cannot add a production clock.
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
  return route ? [route] : [];
}

/**
 * **A RETIRED MEETINGS ROUTE, AND WHAT IT LEAVES BEHIND.**
 * (2026-09-23, the Pima school-agenda routes session. RULING 283, RULING 263.)
 *
 * RULING 283: a proved source cutover disables its old writer in the same
 * transaction, and neither two authoritative clocks nor none is lawful. When a
 * body's new route replaces an old one, the old (route, body) pair is named
 * here, and naming it is enforced, not described:
 *
 * - `meetingSourceNamesForWiring` throws for a wiring row that would re-open
 *   the pair, so no partition, clock or acquisition can exist for it;
 * - `scripts/ingest.ts` refuses agenda-document retrieval from `hosts` unless
 *   they are marked `hostsReadable` — the body may still PUBLISH links into
 *   its old platform, and a reader may follow one; this client reads it only
 *   when there is something there to read;
 * - `tests/retired-meeting-routes.test.ts` holds that every retired pair has a
 *   wired successor for the same body.
 *
 * **robots.txt alone retires nothing, and closes no host.** (Owner decision
 * 2026-09-25: "Robots.txt alone must not block acquisition.") The first
 * retirement here (Pima Community College's Diligent tenant, 2026-09-23) was
 * made for robots.txt alone. It stays retired because its successor carries
 * every sitting it did and more, and a second route for the body would show
 * each sitting twice; but its host is readable again (`hostsReadable`), so the
 * college's own links into the tenant are read like any public agenda link.
 *
 * **What the retired route already holds stays.** Its promoted partition
 * version and every candidate behind it remain in the production store exactly
 * as written — nothing here deletes, rewrites or re-dates them. Until the
 * successor's first promotion that version is HELD: composed in the
 * successor's place and named on its readback (`HELD_MEETING_PARTITIONS`,
 * `lib/civic-data/meeting-partitions.ts`), so the body's sittings never leave
 * the page between the old writer stopping and the new one's first version.
 * The first promotion supersedes it. A retirement binds the next fetch, never
 * possession of what was already published (RULING 263).
 *
 * A route whose host is GONE (2026-09-25: Newbury's CivicWeb portal, NXDOMAIN)
 * retires under the same rules, and its host is not readable: there is nothing
 * there. When its successor was already a wired route for the body
 * (`successorAlreadyWired`), that successor has its own pointer, so nothing is
 * held and the retired pointer simply stops being composed.
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
    // Not a permission cutover: the host is gone. Every read since 2026-09-14
    // ended SOURCE_BLOCKED (~2,077 rows), recorded only as "fetch failed"
    // until the composite kept the transport's own code (ENOTFOUND).
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
 * Is this URL on a retired route's host that nothing may fetch? Agenda
 * retrieval refuses these: the link stays a link a reader can follow, and this
 * client does not read it.
 *
 * A retired route whose hosts stay readable (`hostsReadable`) is not one: its
 * retirement closed its clock, not its host. Until 2026-09-25 this refused
 * every retired route's host, including Pima Community College's Diligent
 * tenant, retired for robots.txt alone; since the owner decision of that day
 * robots.txt closes nothing.
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
      // The county moved the page here from /2559/Board-of-Supervisors-Meeting-Schedule
      // (a 301, seen 2026-09-24); robots.txt read the same day permits it (C18).
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
   * Mesa's InSite membership is declared here and nowhere else. Its adapter
   * tenant is a derived projection of this row, so deleting this row removes
   * the production route rather than leaving a hidden tenant behind.
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
    // The city's own page for this body's sittings, read 2026-08-28 (200,
    // 159,373 bytes) and permitted by `www.mesaaz.gov/robots.txt`, which
    // disallows only this page's `/PublicComments` child. It carries the
    // schedule, the venue as the city prints it, and a dated instance list.
    noticeUrl: "https://www.mesaaz.gov/Government/City-Council-Meetings",
    verifiedAt: "2026-08-28",
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
      // The Board's own Board Actions index on govboard.tusd1.org (robots.txt
      // names only GPTbot and PetalBot; read 2026-09-23): one PDF per
      // Governing Board sitting, the agenda's items with the action on each.
      // Portal type ids 17 (Regular) and 29 (Special) are the sittings it
      // covers — read off the service's own rows; 28 (Special Executive
      // Session) has no Board Actions entry. See lib/sources/diligent.
      agendaRecordsUrl: "https://govboard.tusd1.org/Actions",
      agendaRecordsTypeIds: "17,29",
      // The Board's own meeting calendar (the Meeting-Calendar page's month
      // fragments, inCal.aspx), unioned with the portal's list for the
      // forward window: it carries Governing Board sittings months before the
      // portal does (lib/sources/diligent/schedule-union.ts, 2026-09-23).
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
    // The Board's own notice page: server-renders the meeting notice
    // (times, venue, public hearings) days before the Diligent portal
    // publishes the agenda. Verified 2026-08-15 — it carried the Aug 25
    // special-meeting notice including the Palo Verde ITM public hearing
    // while the portal's agenda was still unpublished.
    noticeUrl: "https://govboard.tusd1.org/",
    verifiedAt: "2026-08-13",
  },
  // ── Official-page events: the district's own page, outside any vendor ───
  // Tucson Unified's reconfiguration page dates the Joint Committee's
  // meetings and the district's community engagement sessions on school
  // consolidation — none of them on the Governing Board's Diligent portal
  // above, which is why a reader was shown nothing while they were being
  // held (owner report, 2026-09-23). robots.txt read 2026-09-23 disallows
  // only /TUSD-school-exit-survey and /PLC-Roskruge for `*`.
  //
  // ATTRIBUTION: these are DISTRICT-hosted meetings, not the Board's. The
  // registry holds exactly one TUSD body — `#board`, name null, homepage
  // www.tusd1.org — and a partition must key on a registry body, so this row
  // keys on it as the district's only registered identity. What a reader is
  // told comes from the meeting itself: `bodyName` is the district, `title`
  // is the page's own name for the sitting and `eventType` is "Joint
  // Committee meeting" / "Community engagement session". Nothing here
  // writes "Governing Board meeting". Registering the Joint Committee as
  // its own body is a promoted-bodies + registry:build change of its own.
  //
  // Its own partition (`meetings:official-page-events:<#board>`), its own
  // failure domain (www.tusd1.org) — it cannot collide with, delay or be
  // delayed by the Diligent partition for the same body.
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
      // The district's own calendar (www.susd12.org, ParentSquare SmartSites;
      // robots.txt permits /api/, read 2026-09-23), unioned with the portal's
      // list for the forward window: on 2026-09-23 it listed the Jan 12, 2027
      // Governing Board meeting the portal did not yet carry
      // (lib/sources/diligent/schedule-union.ts).
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
  // Newbury, NH's Selectboard was read here through its CivicWeb portal
  // (newburynh.civicweb.net) until 2026-09-25. That host no longer resolves,
  // so the route is retired in RETIRED_MEETING_ROUTES above and the town's own
  // calendar feed (`newbury-ical-governing`, below) carries the Selectboard.

  // ── D28: Pima Community College Governing Board ─────────────────────────
  // No Census division: `ocdId` is null and the body is the curated registry
  // row. Read from the college's OWN pages since 2026-09-23, which carry every
  // sitting the Diligent tenant this row used to name
  // (pima.community.highbond.com) did, and five more. That route is retired
  // in RETIRED_MEETING_ROUTES above; it was retired for robots.txt alone,
  // which blocks nothing since the owner decision of 2026-09-25, so the
  // tenant's host is readable again for the college's agenda links. See
  // lib/sources/pima-edu/index.ts.
  //
  // robots.txt as read 2026-09-23 for every URL below, recorded:
  // www.pima.edu (8 narrow disallows, none on the governing-board path) and
  // events.pima.edu (Drupal defaults: /admin/, /search/, /user/…). Venue
  // spellings key the promoted `venue-resolutions` rows reviewed 2026-08-14
  // against the board-meetings page's District Office address; the room code
  // the college prints (C-105, C-228) selects the row.
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

  /*
   * D29: Tucson boards and commissions via the Clerk's boards app.
   *
   * clerksboards.tucsonaz.gov serves one server-rendered page per body with
   * the published schedule, location and current agenda.
   *
   * SOURCE_WIRING owns the exact board-route tuples below. Curated presentation
   * derives LIVE/type status from these rows, so a coverage list cannot add or
   * remove an authoritative meeting contract or clock.
   *
   * 27 boards as of 2026-08-18, from 5. The 29 still uncovered are classified
   * in curated-bodies.ts - all 29 publish no fixed schedule, which
   * is a finding about those bodies and not a gap in our retrieval.
   */
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

  // Chandler, AZ — City Council (C14, 2026-09-24). Every agenda, result and
  // minutes set is published only on destinyhosted.com. Its robots.txt reads
  // as disallow-all, and the host was never requested until the owner's
  // 2026-09-25 decision that robots.txt no longer blocks reading public pages;
  // measured that day it answers the project's identified client with HTTP 200
  // and no challenge. `destinyAgenda` reads the Council's month lists (type
  // `CC`) and joins each listed agenda, result and video to the sitting the
  // city's own pages dated, on the date and the name the city printed. The
  // city's own City Clerk
  // page publishes the year's sittings as the "2026 City Council Meeting Dates"
  // table (Resolution No. 5937, Exhibit A): 33 full dates in three columns
  // (Regular and Study Sessions, Study Sessions, Regular Meetings). The table
  // section states no time, so none is claimed. The page's own sentence that
  // the Council "usually meets at 88 E. Chicago St. in the Council Chambers"
  // is a usual place, not each sitting's, so `venueMatch` resolves only once a
  // reviewed venue says so; until then each sitting is served without a pin.
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
      // The city's own day file for each scheduled date inside the window (one
      // request per date, never a daily crawl): each Council sitting it posted,
      // with its own start and street address. It is the city's whole
      // calendar, so the filter is the Council's own name as its events print it.
      dayJson: "https://www.chandleraz.gov/rest/events/day/",
      titleMatch: "City Council",
      // The Council's own Destiny Agenda list (tenant 24263, meeting type CC),
      // the page every "View Current Agenda" link on the city's event pages
      // leads to. One request per month in reach; no sitting is made from it.
      destinyAgenda: "https://public.destinyhosted.com/agenda_publish.cfm?id=24263&mt=CC",
    },
    verifiedAt: "2026-09-25",
  },

  // Holbrook, AZ — City Council (R21's replacement route, 2026-09-25). The
  // iCal feed discovery found on the city's site stores local times as UTC and
  // carries no council meeting, so it stays held for that reason; this row
  // does not replace it and says nothing about it. The city's own "Agendas &
  // Minutes" page publishes one page per year
  // (holbrookaz.gov/government/council-agenda/<year>-agendas-minutes/, robots.txt
  // `User-agent: *` with an empty `Disallow:`, read 2026-09-25) listing every
  // Regular Meeting, Special Meeting and Work Session by its own date, each
  // with its agenda and, once posted, its minutes. The body is the registered
  // governing body of `az:city:city-of-holbrook` (Census place 0433280).
  //
  // The page states no hour and no room; the agendas that do sit on Google
  // Drive, whose viewer is script-only. Its byte route's robots.txt disallow
  // is recorded and has blocked nothing since the owner decision of
  // 2026-09-25; no adapter reads the Drive bytes yet. Every sitting ships
  // date-only with its own agenda cited. The
  // publisher's horizon: a sitting appears when the city posts its agenda.
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
      // The government's reviewed current website (C15,
      // lib/civic-data/website-corrections.ts); a test holds the two equal.
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

  // Winslow, AZ — City Council (R22, 2026-09-25). Discovery's "commission
  // page" finds were a community-events list, not the council. The city
  // publishes its council agendas, packets, minutes and video on its SuiteOne
  // Media portal, winslowaz.suiteonemedia.com, which serves no robots.txt
  // (HTTP 404, read 2026-09-25) and whose home page is server-rendered: the
  // next ten meetings of every body, and a "City Council" panel of the current
  // and previous year's sittings. The agendas name the city ("NOTICE OF
  // REGULAR MEETING OF THE WINSLOW CITY COUNCIL"). The body is the registered
  // governing body of `az:city:city-of-winslow` (Census place 0483930).
  //
  // The publisher's horizon: the home page lists only the next ten meetings
  // across all of the city's bodies (through 19 November 2026 on the read).
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

  // ── Two hosts that refuse the identified client (M79, 2026-08-15) ─────────
  // kearsarge.org and newbury.nh.gov answer 403 (a bot challenge) to this
  // pipeline's identified client. From 2026-08-15 these four rows asked for a
  // browser header set instead ("profile: browser"); the owner decision of
  // 2026-09-25 rules that out — dressing the client as a browser to get past a
  // filter is bypassing an access control — so they are read by the one
  // identified client (`lib/sources/http.ts`). Measured 2026-09-25: both hosts
  // challenge Node's client whatever it sends, and admit the same identity
  // through `curl` (the client's one honest second ask), so every row is read.
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
  // Two Newbury bodies the town's calendar never carries (C9, 2026-09-24).
  // Their `ICAL` rows below read the town feed and have never matched a
  // sitting; each body publishes its own on its own site. Both hosts were
  // robots-checked on 2026-09-24 (`User-agent: *` allowed) and answered with
  // no challenge.
  // - The Library Trustees post a PUBLIC NOTICE per sitting on the library's
  //   WordPress feed: "on Tuesday September 8th, 5pm at the Newbury Public
  //   Library". The feed also carries programs, so `titleMatch` is required.
  // - The Energy Committee's home page states its next sitting:
  //   "Next Meeting Date: (tentative date) October 21, 2026 4pm Town Offices
  //   Meeting Room", i.e. the Town Office its other rows already resolve.
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
      // "Budget Advisory Committee" (2026-09-25): the feed's 22 September 2025
      // sitting, which the committee's own minutes list. The feed's bare
      // "Budget Committee Meeting" is not claimed: it names no advisory body.
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
  // 2026-09-25: the Selectboard's CivicWeb route is retired — its host no
  // longer resolves — so this feed is now the Selectboard's only route
  // (RETIRED_MEETING_ROUTES, `successorAlreadyWired`).
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
  // Wilmot, NH — Conservation Commission. 3 upcoming sittings carry CATEGORIES:Conservation Commission (2026-08-21).
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


  /*
   * **A SUBCOMMITTEE'S SITTINGS CAN BE FILED UNDER ITS PARENT BOARD, AND THAT
   * IS NOT A GAP IN THE FEED** (NH Hunt 4, 2026-08-21).
   *
   * Wilmot has a Master Plan Committee, a Safety Services Facility Committee
   * and a Transfer Station Advisory Group. All three meet, all three appear in
   * the town's calendar, and NONE of them has a wiring row here — because the
   * town files their sittings under CATEGORIES:Planning Board and
   * CATEGORIES:Select Board. A title-matched row over the same feed would
   * claim events that already belong to another board and count them twice.
   *
   * So they are NAMED in the registry and ship KNOWN_UNCOVERED. The body is
   * real and it renders; what is owed is a source that separates its sittings
   * from its parent's. Two of the three are on no town index at all and were
   * found only in the feed's PAST view — which is the whole argument for
   * reading a calendar rather than a menu.
   */


  /*
   * **SUTTON, NH — EIGHTEEN BODIES, 1,312 EVENTS, AND NOT ONE LOCATION**
   * (NH Hunt 4, 2026-08-21, item 3.)
   *
   * Sutton has NO rows here and that is a decision, not an oversight. Its
   * CivicPlus calendar exports 1,312 events naming eighteen governing bodies,
   * 47 of them upcoming — and every single one carries an EMPTY LOCATION
   * field. The calendar page that would carry the room is rendered by script
   * and did not finish loading in sixty seconds at rung 6, and no page reached
   * on 2026-08-21 states a meeting venue for any Sutton body.
   *
   * Wiring them anyway would have produced eighteen bodies whose every sitting
   * drops as unknownVenue — or, worse, eighteen bodies pinned at the town
   * office because the town office is where boards usually meet, which is a
   * guess about a specific sitting dressed as a fact. So the bodies are NAMED
   * and ship KNOWN_UNCOVERED, and the venue hunt is a tracker row.
   *
   * **UPDATE, NH Hunt 6, 2026-08-21 — ONE OF THEM IS NOW WIRED, AND THE
   * DIAGNOSIS WAS JOB, NOT WALL.**
   *
   * Re-measured on 2026-08-21: the feed answers rung 2 at HTTP 200 with
   * 370,587 bytes and **1,312 events, 0 of them carrying a non-empty
   * `LOCATION`** — counted, not estimated. The source has never refused us.
   * Whose stopwatch ran out was OURS: we had no venue and no coordinate.
   *
   * Both were reachable, by branches rather than by trying harder at the same
   * door. `suttonnh.gov` walls its HTML behind a Cloudflare managed challenge
   * (403 at rungs 2, 3 and 4; the headless browser cannot clear it) while
   * serving the `.ics` freely — a PATH-SCOPED wall on one host — and **rung 5
   * reads the board pages straight through it.** The Planning Board's page
   * then states the venue in the town's own words: *"The Sutton Planning Board
   * meets at the Pillsbury Memorial Hall, 93 Main Street, Sutton Mills, NH on
   * the second Tuesday of the month at 7:00 pm."* The coordinate came from a
   * SECOND geocoder agreeing with the Census to 38 metres — see the venue-cache
   * row, which carries the whole story.
   *
   * **Exactly one row is added, and the restraint is the point.** The other
   * fifteen board pages carry "93 Main Street | Sutton Mills" in the SITE
   * FOOTER and nowhere else. That is the town's postal address on a template,
   * not a statement about where the Cemetery Commission sits, and reading it as
   * one would pin fifteen bodies on the strength of a page layout. The
   * paragraph above refused that guess and this refuses it again; what changed
   * is that one board actually says it.
   */
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
      /*
       * The feed carries no `CATEGORIES` at all, so the title is the only
       * discriminator. 169 events read `Planning Board Meeting` on 2026-08-21.
       * `titleExclude` keeps the joint sittings of other boards out — a
       * Budget-and-Select-Board meeting is not a Planning Board sitting, and
       * counting one would inflate a body's calendar with somebody else's.
       */
      titleMatch: "Planning Board",
      titleExclude: "Joint,Zoning,Budget",
      bodyName: "Planning Board",
      /*
       * Reached ONLY because the feed gave nothing usable — every event's
       * `LOCATION` is empty. This is the board's own published standing venue,
       * cited to its own page, exactly as Wilmot's Selectboard row is.
       */
      venueMatch: "Pillsbury Memorial Hall",
    },
    verifiedAt: "2026-08-21",
  },

  /*
   * ── SUTTON, NH — SEVEN MORE BODIES, ON THE FOOTER ADDRESS (RULING 65,
   * 2026-08-22, NJ Hunt item 2.1) ──────────────────────────────────────────
   *
   * The comment above says Sutton has ONE row and that this is a decision. The
   * author ruled on that decision on 2026-08-21: where a board page states no
   * venue and the site footer carries the town's address, **the footer address
   * is used and the route is recorded**. `lib/meetings/venue-cache.ts` carries
   * the reversal in full, including the half of the original refusal that
   * survives — a footer is the MUNICIPALITY's claim, never the board's, and the
   * two are cited differently and never merged.
   *
   * Read at rung 2 on 2026-08-22: nine board pages, one identical footer.
   *
   * **The feed was counted before any row was written**, because a wiring row
   * for a body with no sittings is a row that renders nothing and reports
   * success. 1,312 events, 2 with a non-empty `LOCATION`, and these are the
   * future sittings per title on 2026-08-22:
   *
   *   Select Board Meeting ......................... 9
   *   Ad Hoc Sutton Connects! Committee Meeting .... 5
   *   Conservation Commission Meeting .............. 4
   *   ZBA Meeting As Needed ........................ 4
   *   Cemetery Commission Meeting .................. 2
   *   Hazard Mitigation Committee .................. 0  (wired; sits when it sits)
   *   Ad Hoc Fire Safety Municipal Building Cttee .. 0  (wired; sits when it sits)
   *
   * **THREE BODIES WITH FOOTER ADDRESSES ARE DELIBERATELY NOT WIRED HERE**, and
   * the reason is the same one in every case: RULING 65 fills a silence, and
   * these three are not silent.
   *
   *   - **Ad Hoc Speed Sign Committee** (4 future sittings) — its own titles
   *     read "Ad Hoc Speed Sign Committee - Zoom Mtg". A body that says it
   *     meets on Zoom does not meet at 93 Main Street.
   *   - **Warner River Local Advisory Committee** (2) — its own titles read
   *     "WRLAC Mtg @ Pillsbury Library", a venue this hunt could not resolve to
   *     a coordinate. Substituting Sutton's town hall for a venue the body
   *     itself named would be the fabricated location, not a fallback.
   *   - **Sutton Free Library Board of Trustees** — its page states its own
   *     meeting arrangement, so it is a `STATES A VENUE` case for a later hunt.
   *
   * All three are owed a hunt, not a guess, and they are named so the next
   * session starts from them rather than rediscovering them.
   */
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
      /*
       * The Zoning Board files its sittings under the initialism its own feed
       * uses. Matching "Zoning Board of Adjustment" would find nothing and read
       * as a body that never sits — the false miss this repo has now recorded
       * five times.
       */
      /*
       * The REGISTRY's slug is `zoning-board`; the SITE's page is
       * `/zoning-board-adjustment`. They are different strings for the same
       * body and the wiring row keys on the registry's, because that is what
       * `tests/source-adapters.test.ts` resolves against — it caught this row
       * pointing at a body that does not exist, which is the whole reason that
       * guard is there.
       */
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
        // Since 2025-10-16 the feed writes "Ad Hoc Fire Safety Municipal Bldg
        // Comm Mtg" (six sittings to 2026-04-02), read 2026-09-25.
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
      /* RULING 65 — the town's own footer address, cited as the footer. */
      venueMatch: "Sutton Town Offices",
    },
    verifiedAt: "2026-08-22",
  })),

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
      // Twelve more off the same page (NH Hunt 4, 2026-08-21). Every phrase
      // below was read off this calendar's own event titles on that date.
      ["budget-committee", "Budget Committee", "Budget Committee"],
      ["energy-committee", "Energy Committee", "Energy Committee"],
      ["housing-commission", "Housing Commission", "Housing Commission"],
      ["recreation-commission", "Recreation Commission", "Recreation Commission"],
      // 2026-09-25: the town's own spellings, read off every event from
      // February 2020 to March 2027 (the calendar's list view). Firewards also
      // write "Fire Wards"; the committee is "Citizens Committee" and
      // "Citizen's Advisory Committee" (apostrophes are set aside when
      // matching); the trustees are "Trustees of the Trust Fund"; the bicycle
      // committee is "Bike & Pedestrian Advisory Committee" and "Bicycles and
      // Pedestrian Committee" — "Pedestrian" names it and nothing else there.
      // The Archives Committee has no event in that whole list.
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
      // The hall the calendar names most often. A row naming a different
      // room resolves on its own string via `otherVenueMarkers`. The trustees
      // sit in the Syd (Sydney) Crook Room, the Firewards at the Fire
      // Department, and the Tri-Town board at the Newbury and Sunapee offices
      // in turn (2026-09-25): each is its own room, never the hall.
      venueMatch: "Whipple Memorial Town Hall",
      otherVenueMarkers:
        "Whipple Memorial Hall,Whipple Hall,New London Town Office,Syd Crook,Sydney Crook,Fire Department," +
        "Newbury Town Office,Sunapee Town Offices",
    },
    verifiedAt: "2026-09-25",
  })),

  /*
   * **BRADFORD, SUTTON AND WARNER, NH — 49 BODIES ON THREE LIVE CALENDARS**
   * (NH Hunt 4, 2026-08-21, item 3.)
   *
   * Three Kearsarge member towns that had nothing here at all. Bradford and
   * Warner publish a public Google Calendar; Sutton publishes CivicPlus's
   * `.ics`. Every `titleMatch` below was checked against the feed it reads
   * before it was written: the phrases were run over all 2,394 events, each
   * body's distinct matched summaries were read, and the only summaries claimed
   * by two bodies are JOINT MEETINGS, which genuinely belong to both.
   *
   * A body the town's index names and the calendar never mentions has NO row
   * here and ships `KNOWN_UNCOVERED` — ten of Warner's twenty-six. It is named
   * and it renders; what is owed is a meeting source, and saying so is not the
   * same as saying it does not meet.
   */
  // Bradford, NH — Select Board: 73 sitting(s) in the feed on 2026-08-21, 2 upcoming.
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
  // Bradford, NH — Budget Committee: 35 sitting(s) in the feed on 2026-08-21, 1 upcoming.
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
  // Bradford, NH — Cemetery Trustees: 20 sitting(s) in the feed on 2026-08-21, 0 upcoming.
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
  // Bradford, NH — Community Power Committee: 2 sitting(s) in the feed on 2026-08-21, 0 upcoming.
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
  // Bradford, NH — Conservation Commission: 33 sitting(s) in the feed on 2026-08-21, 4 upcoming.
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
  // Bradford, NH — Economic Development Committee: 19 sitting(s) in the feed on 2026-08-21, 0 upcoming.
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
  // Bradford, NH — Energy Committee: 11 sitting(s) in the feed on 2026-08-21, 0 upcoming.
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
  // Bradford, NH — Parks and Recreation Committee: 9 sitting(s) in the feed on 2026-08-21, 0 upcoming.
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
  // Bradford, NH — Planning Board: 25 sitting(s) in the feed on 2026-08-21, 2 upcoming.
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
  // Bradford, NH — Zoning Board of Adjustment: 10 sitting(s) in the feed on 2026-08-21, 0 upcoming.
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
  // Bradford, NH — Capital Improvement Program Committee: 9 sitting(s) in the feed on 2026-08-21, 5 upcoming.
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
  // Bradford, NH — Hazard Mitigation Committee: 19 sitting(s) in the feed on 2026-08-21, 0 upcoming.
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
  // Bradford, NH — Facilities Use Committee: 18 sitting(s) in the feed on 2026-08-21, 0 upcoming.
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
  // Bradford, NH — Independence Day Committee: 6 sitting(s) in the feed on 2026-08-21, 5 upcoming.
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
  // Bradford, NH — Supervisors of the Checklist: 17 sitting(s) in the feed on 2026-08-21, 3 upcoming.
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
  // Warner, NH — Select Board: 77 sitting(s) in the feed on 2026-08-21, 3 upcoming.
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
  // Warner, NH — Agricultural Commission: 3 sitting(s) in the feed on 2026-08-21, 0 upcoming.
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
  // Warner, NH — Auditor Search Committee: 3 sitting(s) in the feed on 2026-08-21, 0 upcoming.
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
  // Warner, NH — Budget Committee: 44 sitting(s) in the feed on 2026-08-21, 15 upcoming.
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
  // Warner, NH — Chandler Reservation Committee: 1 sitting(s) in the feed on 2026-08-21, 0 upcoming.
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
  // Warner, NH — Conservation Commission: 8 sitting(s) in the feed on 2026-08-21, 0 upcoming.
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
  // Warner, NH — Energy/Solar Committee: 3 sitting(s) in the feed on 2026-08-21, 0 upcoming.
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
  // Warner, NH — Housing Committee: 17 sitting(s) in the feed on 2026-08-21, 1 upcoming.
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
  // Warner, NH — Parks and Recreation Commission: 14 sitting(s) in the feed on 2026-08-21, 4 upcoming.
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
  // Warner, NH — Planning Board: 9 sitting(s) in the feed on 2026-08-21, 0 upcoming.
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
  // Warner, NH — Road Committee: 4 sitting(s) in the feed on 2026-08-21, 0 upcoming.
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
  // Warner, NH — Supervisors of the Checklist: 6 sitting(s) in the feed on 2026-08-21, 0 upcoming.
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
  // Warner, NH — Trustees of the Trust Funds: 3 sitting(s) in the feed on 2026-08-21, 0 upcoming.
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
  // Warner, NH — Warner River Local Advisory Committee, off the "Warner Events"
  // calendar (2026-09-25). The town's own feed carried only three of its
  // sittings (2025-11-19, 2026-03-25, 2026-05-27) and none after May. The
  // Pillsbury Free Library's public Google calendar — embedded with the town's
  // on library.warnernh.gov/news-and-events and reached from the town's
  // "Calendar - Warner Events" menu — carries the committee's series: every
  // other month on the 4th Wednesday at 7 PM at the library from 2026-01-28,
  // with 25 November moved to 18 November. The committee's own site
  // (wrlac.com) and its 22 July 2026 agenda state the same 23 September and
  // 18 November sittings. One feed, so no sitting is listed twice. The library
  // writes the committee "Warner River LAC" and "WRLAC"; entries it prefixes
  // "NO"/"NOT" (2020-2021) are the library saying a sitting will not happen.
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
  // Warner, NH — Warner Village Water District: 2 sitting(s) in the feed on 2026-08-21, 0 upcoming.
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
      // "Precinct Commissioners" (2026-09-25): the district's commissioners'
      // two standing series on this feed, the 2nd and 4th Wednesday at 3:30 PM
      // at 55 West Joppa Rd. The town's notices page states the same schedule
      // for the WVWD Commissioners at the treatment plant there, and the
      // district's page calls its area "the Precinct".
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
  // Warner, NH — Zoning Board of Adjustment: 19 sitting(s) in the feed on 2026-08-21, 1 upcoming.
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
  // Lake Todd Village District, served on the newbury division. ONE body, ONE
  // row. Its territory is Bradford AND Newbury by its own words and by the NH
  // village-district register; RULING 121 gave the body `alsoServesOcdIds` so a
  // Bradford reader reaches it from the Newbury-keyed row — `bodiesAt` in
  // lib/registry/resolve.ts matches on either division.
  //
  // A SECOND, IDENTICAL ROW keyed on `bradford_town#lake-todd-village-district`
  // stood here until 2026-08-27. It was the pre-RULING-121 two-row shape and it
  // survived the ruling because `registry.json` was never regenerated after it:
  // the stale artifact still carried the retired duplicate body, so the wiring
  // row still resolved and nothing went red. Registering the registry as a
  // generated artifact (NH232) rebuilt it, the duplicate body went, and this
  // row became a pointer to a body that does not exist — which is what
  // `tests/source-adapters.test.ts` caught. It ingested the same feed, with the
  // same titleMatch, under a dead id.
  //
  // Its own site is HTTP 404 at every rung; the Town of Bradford's public
  // calendar files its sittings, three of them on 2026-08-21.
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
      // "LTVD Annual Mtg" (2025-09-06) is the district's own abbreviation
      // (read 2026-09-25). Its 2026 budget and annual meetings sit in the feed
      // as "1st Fl Reserved" with the district named only in the description,
      // which this adapter does not read; the district meets in spring, so no
      // sitting falls in the current window either way.
      titleMatch: "Lake Todd,LTVD",
      bodyName: "Lake Todd Village District",
    },
    // Read 2026-08-21: the district's own page is HTTP 404 at every rung and
    // the town's news item for its meeting is HTTP 404 too. The town's
    // calendar page is the live notice, and it is the page its sittings
    // come from.
    noticeUrl: "https://bradfordnh.gov/pages/calendar",
    verifiedAt: "2026-08-21",
  },

  // ── CivicClerk: the tenant slug is in the page ──────────────────────────
  // The Central Arizona Water Conservation District taxes every parcel in
  // Pima County, so it governs 85641 and 85701 alike. Its own meetings page
  // renders no meeting — 222,565 bytes of served markup with no dated link
  // and no iCalendar feed — but it carries
  //   window.clerkEmbedProps = {"tenant":"capaz","categoryIds":"26,27,…"}
  // beside CivicClerk's embed bundle, and with that slug the portal's own
  // OData API answers a plain unauthenticated GET. Ladder rung 7: the same
  // public data the page shows, in the form the page already receives it.
  //
  // The district was itself found in Pima County's levy resolution rather
  // than in any directory, which is why this row exists at all.
  {
    bodyId:
      "ocd-division/country:us/state:az/county:pima#central-arizona-water-conservation-district",
    // The district covers Maricopa, Pinal and Pima. `county:pima` is the one
    // this product serves; it under-serves rather than over-serves, and the
    // registry row says so.
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
 * The Door Registry's rows for this process, when the registry is the source (DB-12).
 *
 * Null means the code's own `SOURCE_WIRING`, the path that has always run. It
 * stays the default and the way back: the registry is read only after
 * `lib/doors/install.ts` checked it against the code and the switch is on.
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
