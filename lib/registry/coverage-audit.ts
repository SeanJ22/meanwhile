import type { BodyCoverageAudit, CoverageAuditFile } from "./audit.ts";

/**
 * Every source hunt anyone has actually run, and what each rung returned.
 *
 * Hand-maintained and cited, the same way `lib/sources/legistar/clients.ts` is
 * and for the same reason: this records work a person did — pages opened and
 * read — so it cannot be generated, and a row without the URL it was read from
 * is worthless. `scripts/build-registry.ts` overlays it onto the derived bodies.
 *
 * Ten rows out of 265 bodies. The other 255 are `NOT_ATTEMPTED` and say so.
 *
 * Two 2026-08-13 corrections are recorded in place rather than tidied away,
 * because checking overturned something already written down — the pattern
 * this file exists to preserve:
 *
 * - **Vail is not NovusAgenda either.** The 2026-08-12 hunt recorded the
 *   NovusAgenda portal as a HIT on a 200 response. Querying it found **zero
 *   meetings in any window** — the tenant is the archive for minutes prior to
 *   March 2017, which the district's own board page says in so many words.
 *   The 200 was the "feed that exists and carries nothing" failure shape,
 *   fourth sighting. The real source is the district website's own events
 *   API (Apptegy), which carries the board meetings with district-published
 *   coordinates.
 * - **Tucson's Hyland conclusion reversed** — see the row and
 *   `docs/vendor-review.md` (D16).
 */

const BY_13 = "session 2026-08-13, the composite build";

export const COVERAGE_AUDITS: BodyCoverageAudit[] = [
  {
    bodyId: "ocd-division/country:us/state:az/county:pima#governing",
    attemptedAt: "2026-08-13",
    attemptedBy: "D12, the Legistar adapter; wired live by the composite",
    outcome: "COVERED",
    rungs: [
      {
        rung: "VENDOR_API",
        outcome: "HIT",
        url: "https://webapi.legistar.com/v1/pima/events",
        note: "200, open client, no token. 9 events fetched live, 7 normalized.",
      },
      {
        rung: "BODY_HOMEPAGE",
        outcome: "HIT",
        url: "https://www.pima.gov/government/board_of_supervisors/",
        note: "200; redirects to https://www.pima.gov/2317/. Also the address source in clients.ts.",
      },
    ],
    homepageUrl: "https://www.pima.gov/government/board_of_supervisors/",
    agendaSourceType: "LEGISTAR",
    agendaSourceRef: "https://pima.legistar.com/Calendar.aspx",
    coverageStatus: "LIVE",
    notes:
      "LIVE as of 2026-08-13: the composite is the app's active source and Legistar is wired into it (lib/registry/source-wiring.ts). Pima exposes only 4 bodies, all Board of Supervisors variants — the Library District sits inside this feed rather than beside it (D19).",
  },

  {
    bodyId: "ocd-division/country:us/state:az/place:tucson#governing",
    attemptedAt: "2026-08-13",
    attemptedBy: "D16 (2026-08-12), reversed and wired 2026-08-13",
    outcome: "COVERED",
    rungs: [
      {
        rung: "VENDOR_API",
        outcome: "MISS",
        url: "https://webapi.legistar.com/v1/tucson/events",
        note: "500. tucson, tucsonaz and cityoftucson all 500 — Tucson is not a Legistar client.",
      },
      {
        rung: "BODY_HOMEPAGE",
        outcome: "HIT",
        url: "https://www.tucsonaz.gov/",
        note: "200, redirects to /Home. Granicus OpenCities — the website CMS, not the agenda vendor.",
      },
      {
        rung: "VENDOR_API",
        outcome: "HIT",
        url: "https://tucsonaz.hylandcloud.com/221agendaonline",
        note: "Hyland OnBase Agenda Online. Server-rendered meeting list, 10 rows on 2026-08-13, direct agenda-PDF downloads. ORIGINALLY RECORDED AS BLOCKED_TERMS on hyland.com's ToU; reversed 2026-08-13 — the terms enumerate five hyland.com hosts and do not reach hylandcloud.com, and the records are the City's (A.R.S. § 38-431.02). See docs/vendor-review.md.",
      },
      {
        rung: "BODY_SUBSCRIBE",
        outcome: "HIT",
        url: "https://public.govdelivery.com/accounts/AZTUCSON/subscriber/topics",
        note: "A syndication channel the City itself operates. Kept as a fallback route; the OnBase list is richer.",
      },
    ],
    homepageUrl: "https://www.tucsonaz.gov/",
    agendaSourceType: "ONBASE",
    agendaSourceRef: "https://tucsonaz.hylandcloud.com/221agendaonline",
    coverageStatus: "LIVE",
    notes:
      "D16 REVERSED under the public-records constraint (CLAUDE.md): the original 'do not build' rested on terms that do not name the tenant host. The OnBase adapter reads the landing page; venue is curated per meeting-name pattern because the system publishes no location field anywhere (verified on list and detail pages). Joint meetings and the Public Housing Authority Board drop as unknownVenue until someone cites where they meet.",
  },

  {
    bodyId:
      "ocd-division/country:us/state:az/school_district:tucson_unified_district#board",
    attemptedAt: "2026-08-13",
    attemptedBy: BY_13,
    outcome: "COVERED",
    rungs: [
      {
        rung: "BODY_HOMEPAGE",
        outcome: "HIT",
        url: "https://www.tusd1.org/calendars",
        note: "200. Lists upcoming Governing Board meetings in HTML; links the Diligent portal (highbond hostname). No feed.",
      },
      {
        rung: "BODY_SUBSCRIBE",
        outcome: "MISS",
        url: "https://tusd1-schooldesk.community.diligentoneplatform.com/Portal/Subscribe.aspx",
        note: "Email-only, per-committee checkboxes, CAPTCHA. No RSS, no iCal — not a machine channel. Tried per D14 before the portal, as required.",
      },
      {
        rung: "VENDOR_API",
        outcome: "HIT",
        url: "https://tusd1-schooldesk.community.diligentoneplatform.com/Services/MeetingsService.svc/meetings?from=2026-07-01&to=2026-12-31&loadall=true",
        note: "The JSON service the portal page itself calls, found by browser network capture (rung 7). Plain GET, no auth, 11 rows with dates, times, locations and the Published flag. Also answers identically on the legacy highbond.com hostname.",
      },
      {
        rung: "BODY_AGENDA_PAGE",
        outcome: "HIT",
        url: "https://govboard.tusd1.org/Meetings",
        note: "Board sub-site (DNN) with the board-approved 2026 meeting-schedule PDF — an annual cross-check, not the feed.",
      },
    ],
    homepageUrl: "https://www.tusd1.org/",
    agendaSourceType: "DILIGENT",
    agendaSourceRef:
      "https://tusd1-schooldesk.community.diligentoneplatform.com/Portal/",
    coverageStatus: "LIVE",
    notes:
      "D13. Wired via the MeetingsService JSON endpoint — the same public data the portal shows, in the form the page already receives it. The website ToU carve-out question (B09) stands recorded but does not gate the route per the public-records constraint; docs/vendor-review.md has the paragraph. Zoom-only sittings drop as placeless and are counted.",
  },

  {
    bodyId:
      "ocd-division/country:us/state:az/school_district:vail_unified_district#board",
    attemptedAt: "2026-08-13",
    attemptedBy: BY_13,
    outcome: "COVERED",
    rungs: [
      {
        rung: "VENDOR_PORTAL_BLOCKED",
        outcome: "MISS",
        url: "https://go.boarddocs.com/az/vail/Board.nsf/Public",
        note: "Search results assert this is Vail's BoardDocs. It is not: 403 to a bot and a real browser renders BoardDocs' own 'page isn't here' error. Never recorded as a link.",
      },
      {
        rung: "VENDOR_API",
        outcome: "MISS",
        url: "https://vailschools.novusagenda.com/agendapublic/meetingsresponsive.aspx",
        note: "CORRECTION 2026-08-13: recorded as a HIT on 2026-08-12 because the portal answers 200. Searched via its own form POST: ZERO meetings in the 6-month and 12-month windows. The district's board page labels it 'Board Agenda and Minutes prior to March 14, 2017' — an archive tenant, not a calendar. The 200-with-zero-items failure shape, fourth sighting.",
      },
      {
        rung: "BODY_HOMEPAGE",
        outcome: "HIT",
        url: "https://www.vailschooldistrict.org/page/governing-board",
        note: "200. Apptegy site. States meetings are 2nd and 4th Tuesday, 7:00 pm, Calvin Baker Leadership Center, 13801 E. Benson Highway; current agendas at vailschooldistrict.community.highbond.com/Portal/ (Diligent).",
      },
      {
        rung: "BODY_FEED",
        outcome: "HIT",
        url: "https://vailschooldistrictaz.thrillshare.com/api/v4/o/8164/cms/events?locale=en&page_no=1",
        note: "The district website's own events API (Apptegy/Thrillshare), read from the page's embedded state. JSON with Governing Board Meeting events: start_at with offset, venue string, and district-published coordinates. This is the wired source.",
      },
    ],
    homepageUrl: "https://www.vailschooldistrict.org/page/governing-board",
    agendaSourceType: "APPTEGY",
    agendaSourceRef:
      "https://vailschooldistrictaz.thrillshare.com/api/v4/o/8164/cms/events?locale=en&page_no=1",
    coverageStatus: "LIVE",
    notes:
      "VAIL IS APPTEGY (its own site), NOT NOVUSAGENDA — the second vendor correction for this body in two days, and both point the same lesson: verify the content, not the status code. The event descriptions carry the district's own link to its Diligent (highbond) portal for the agenda documents themselves; that link ships as agendaUrl because the district published it on the event record.",
  },

  {
    bodyId:
      "ocd-division/country:us/state:nj/county:morris/place:rockaway_township#governing",
    attemptedAt: "2026-08-13",
    attemptedBy: BY_13,
    outcome: "COVERED",
    rungs: [
      {
        rung: "BODY_HOMEPAGE",
        outcome: "HIT",
        url: "https://www.rockawaytownship.org/157/Township-Council",
        note: "200. CivicPlus CivicEngage. States meetings 7:00 p.m. at the Municipal Building, 65 Mount Hope Road — the venue citation for the iCal's empty LOCATION field.",
      },
      {
        rung: "BODY_FEED",
        outcome: "HIT",
        url: "https://www.rockawaytownship.org/RSSFeed.aspx?ModID=65&CID=All-agendacenter",
        note: "200 application/rss+xml, POPULATED — agenda items with permalinks to /AgendaCenter/PreviousVersions/<id>. Currently carries BOA and Planning Board agendas; no council-prefixed items observed.",
      },
      {
        rung: "BODY_FEED",
        outcome: "HIT",
        url: "https://www.rockawaytownship.org/common/modules/iCalendar/iCalendar.aspx?catID=25&feed=calendar",
        note: "200 text/calendar. Township Council Regular Meetings through Dec 2026 at 19:00 America/New_York. The wired source.",
      },
    ],
    homepageUrl: "https://www.rockawaytownship.org/157/Township-Council",
    agendaSourceType: "CIVICPLUS",
    agendaSourceRef:
      "https://www.rockawaytownship.org/common/modules/iCalendar/iCalendar.aspx?catID=25&feed=calendar",
    coverageStatus: "LIVE",
    notes:
      "First-party machine-readable feeds, no vendor portal in the path — rung 2 of the ladder and the cheapest real source in the project (D21). The category feed mixes township events in with council sittings; only SUMMARY matches count as meetings and the rest are counted notConfigured. Council agendas are not in the RSS channel as observed, so agendaUrl is honestly null until they appear.",
  },

  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#governing",
    attemptedAt: "2026-08-13",
    attemptedBy: BY_13,
    outcome: "COVERED",
    rungs: [
      {
        rung: "VENDOR_API",
        outcome: "HIT",
        url: "https://newburynh.civicweb.net/Portal/MeetingTypeList.aspx",
        note: "200. CivicWeb, footer '© iCompass - A Diligent Brand'. Lists Selectboard only, with its standing schedule ('every other Monday, starting at 6:00 pm').",
      },
      {
        rung: "VENDOR_API",
        outcome: "HIT",
        url: "https://newburynh.civicweb.net/Services/MeetingsService.svc/meetings?from=2026-07-01&to=2026-12-31",
        note: "The JSON service behind MeetingSchedule.aspx's 'Loading…', captured in a browser (rung 7) and verified with plain GET: Id, MeetingDateTime, MeetingLocation 'Town Office Meeting Room', TypeId, Published — including the UPCOMING Selectboard sitting of 2026-08-17 18:00. The wired source; same wire format as TUSD's Diligent portal.",
      },
      {
        rung: "BODY_FEED",
        outcome: "MISS",
        url: "https://www.newbury.nh.gov/rss.xml",
        note: "200 application/rss+xml and EMPTY — a valid feed with zero items.",
      },
      {
        rung: "BODY_SUBSCRIBE",
        outcome: "HIT",
        url: "https://www.newbury.nh.gov/subscribe",
        note: "Town e-alerts. The CivicWeb portal separately offers /Portal/Subscribe.aspx.",
      },
      {
        rung: "BODY_AGENDA_PAGE",
        outcome: "HIT",
        url: "https://www.newbury.nh.gov/administration/links/selectboard-meeting-minutes-agendas",
        note: "200. Drupal. The town's own site also lists Zoning, Planning and Conservation Commission meetings the CivicWeb portal does not.",
      },
      {
        rung: "BODY_HOMEPAGE",
        outcome: "BLOCKED_ROBOTS",
        url: "https://www.newbury.nh.gov/",
        note: "403 to an identified automated agent at the root only; sub-paths answer 200 (the /administration page carries the town office address, 937 Route 103 — the venue citation).",
      },
    ],
    homepageUrl: "https://www.newbury.nh.gov/",
    agendaSourceType: "CIVICWEB",
    agendaSourceRef: "https://newburynh.civicweb.net/Portal/MeetingTypeList.aspx",
    coverageStatus: "LIVE",
    notes:
      "Wired via the MeetingsService JSON endpoint the portal itself uses. The town's own site carries MORE bodies (Planning, Zoning, Conservation) than the vendor portal — those remain unwired and unhunted as separate bodies. NH RSA 91-A:2 requires notice but not an agenda (D17), so a Selectboard row with Published=false may be lawful silence, not our gap. The CivicWeb archive at /filepro/documents/4744 (Agendas/Selectboard, year folders to 2026) is the backfill route.",
  },

  {
    bodyId:
      "ocd-division/country:us/state:nh/school_district:kearsarge_regional_school_district#board",
    attemptedAt: "2026-08-13",
    attemptedBy: BY_13,
    outcome: "FOUND_UNBUILT",
    rungs: [
      {
        rung: "BODY_AGENDA_PAGE",
        outcome: "BLOCKED_ROBOTS",
        url: "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-agendas-minutes",
        note: "403 to a bot; renders in a real browser (verified 2026-08-12) — a dated table of School Board agendas. On 2026-08-13 this environment's browser was also refused at the origin, so the enumeration errand remains open.",
      },
      {
        rung: "BODY_FEED",
        outcome: "MISS",
        url: "https://www.kearsarge.org/rss.xml",
        note: "403 — bot block; cannot be distinguished from absent without a browser.",
      },
      {
        rung: "BODY_AGENDA_PAGE",
        outcome: "HIT",
        url: "https://www.kearsarge.org/sites/g/files/vyhlif731/f/pages/2026-2027_school_board_schedule.pdf",
        note: "Confirmed-real via the search index (the search-through-the-bot-wall rung): one PDF carrying the year's board meeting dates. 403 to this environment; retrievable in a browser.",
      },
      {
        rung: "VENDOR_API",
        outcome: "MISS",
        url: null,
        note: "No board portal exists — no BoardDocs, no Diligent, no CivicWeb tenant found. The district self-hosts agendas as CMS pages.",
      },
      {
        rung: "BODY_FEED",
        outcome: "MISS",
        url: "https://sites.google.com/a/kearsarge.org/kearsarge-district/school-board/agendas-minutes",
        note: "302 → Google login; the legacy site is access-restricted.",
      },
    ],
    homepageUrl:
      "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-agendas-minutes",
    agendaSourceType: "HTML",
    agendaSourceRef:
      "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-agendas-minutes",
    coverageStatus: "KNOWN_UNCOVERED",
    notes:
      "Not exhausted and not blocked — the host refuses every automated client this environment has, including its browser pane, while serving humans. Next errands, in value order: extract the Google Calendar embed id from /district/family-community/pages/calendars (→ public basic.ics, the only true feed candidate); fetch the 2026-2027 schedule PDF; enumerate the agendas page. Meetings are 6:30 PM at 165 Main St, New London per the search-indexed schedule page. Same host behaviour as newbury.nh.gov; one browser-grade fetch layer would serve both.",
  },

  // ── New rows, 2026-08-13 ─────────────────────────────────────────────────

  {
    bodyId: "ocd-division/country:us/state:nj/county:morris#governing",
    attemptedAt: "2026-08-13",
    attemptedBy: BY_13,
    outcome: "FOUND_UNBUILT",
    rungs: [
      {
        rung: "BODY_HOMEPAGE",
        outcome: "BLOCKED_ROBOTS",
        url: "https://www.morriscountynj.gov/Departments/Board-of-County-Commissioners",
        note: "403 (Akamai) to plain clients including robots.txt; renders in a browser. Meetings 2nd & 4th Wednesday, work session 5:00 PM, public meeting 7:00 PM. Links the agenda system.",
      },
      {
        rung: "VENDOR_API",
        outcome: "MISS",
        url: "https://webapi.legistar.com/v1/morriscountynj/events",
        note: "500 — not a Legistar client (morriscounty also 500; control slug mesa answered, so the API itself was live).",
      },
      {
        rung: "VENDOR_API",
        outcome: "HIT",
        url: "https://morriscountynj.iqm2.com/Citizens/Default.aspx",
        note: "Granicus IQM2 / Accela Meeting Portal. 200 to plain GET: upcoming Work Sessions and Regular Meetings with Detail_Meeting.aspx?ID= links and FileOpen.aspx agenda PDFs.",
      },
      {
        rung: "BODY_FEED",
        outcome: "HIT",
        url: "https://morriscountynj.iqm2.com/Services/RSS.aspx?Feed=Calendar",
        note: "200. XML-declared pseudo-feed, one rigidly regular block per meeting with datetime, Detail_Meeting ID and agenda download links. Trivially parseable. (/Citizens/RSS.aspx is an error page — the working path is under /Services/.)",
      },
      {
        rung: "BODY_FEED",
        outcome: "MISS",
        url: "https://morriscountynj.iqm2.com/Services/iCalendar.aspx",
        note: "200 but returns the portal HTML shell, not an ics (with and without ?ID=).",
      },
    ],
    homepageUrl:
      "https://www.morriscountynj.gov/Departments/Board-of-County-Commissioners",
    agendaSourceType: "IQM2",
    agendaSourceRef: "https://morriscountynj.iqm2.com/Services/RSS.aspx?Feed=Calendar",
    coverageStatus: "KNOWN_UNCOVERED",
    notes:
      "Source found and verified; no adapter yet. Build on the /Services/RSS.aspx?Feed=Calendar pseudo-feed plus /Citizens/Calendar.aspx for the forward schedule — both answer plain GET. Venue needs a citation (the commissioners meet in Morristown; cite the county page in a browser before curating coordinates). The /Services/ pattern generalizes to every *.iqm2.com client.",
  },

  {
    bodyId:
      "ocd-division/country:us/state:nj/school_district:rockaway_township_school_district#board",
    attemptedAt: "2026-08-13",
    attemptedBy: BY_13,
    outcome: "COVERED",
    rungs: [
      {
        rung: "BODY_HOMEPAGE",
        outcome: "HIT",
        url: "https://www.rocktwp.net/page/about-the-board",
        note: "Real domain is rocktwp.net (not .org, not rtsd.us). K-8 district; grades 9-12 are Morris Hills Regional per the township's own Board of Education page.",
      },
      {
        rung: "VENDOR_PORTAL_BLOCKED",
        outcome: "MISS",
        url: "https://go.boarddocs.com/nj/rocktwp/Board.nsf/Public",
        note: "403 — not a BoardDocs client; agendas demonstrably live on the district's Apptegy site.",
      },
      {
        rung: "BODY_FEED",
        outcome: "HIT",
        url: "https://api.thrillshare.com/api/v4/o/4707/cms/events?locale=en&page_no=1",
        note: "Apptegy events API, org id 4707 extracted from the page's embedded state. Unauthenticated JSON; 'RTSD Board Meeting' events with venue (Copeland Middle School, 100 Lake Shore Dr) and coordinates. The wired source.",
      },
      {
        rung: "BODY_AGENDA_PAGE",
        outcome: "HIT",
        url: "https://www.rocktwp.net/page/annual-board-meeting-dates",
        note: "The OPMA annual meeting-dates page — 1st & 3rd Wednesday, 6:00 PM (public portion 7:30). Agenda PDFs browse from https://www.rocktwp.net/browse/828698 (per-year folders).",
      },
    ],
    homepageUrl: "https://www.rocktwp.net/",
    agendaSourceType: "APPTEGY",
    agendaSourceRef:
      "https://api.thrillshare.com/api/v4/o/4707/cms/events?locale=en&page_no=1",
    coverageStatus: "LIVE",
    notes:
      "Same platform as Vail — one adapter, two districts, which is the §0b thesis working. Agenda documents live in the /browse/828698 folder tree as dated PDFs; the events carry no per-meeting agenda link, so agendaUrl is null until the folder route is wired.",
  },

  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack#governing",
    attemptedAt: "2026-08-13",
    attemptedBy: BY_13,
    outcome: "FOUND_UNBUILT",
    rungs: [
      {
        rung: "BODY_HOMEPAGE",
        outcome: "HIT",
        url: "https://www.merrimackcounty.net/",
        note: "Real domain (merrimackcounty.org does not resolve — DNS ENOTFOUND). Revize CMS. The homepage server-renders an upcoming-meetings block: Executive Committee 8/14/2026 10:00 AM, Board of Commissioners 8/24/2026 10:00 AM.",
      },
      {
        rung: "BODY_AGENDA_PAGE",
        outcome: "HIT",
        url: "https://www.merrimackcounty.net/board_of_commissioners_/public_notices,_agendas,_minutes,_.php",
        note: "200 HTML. Chronological notice/agenda/minutes/recording lists per meeting, Feb–Aug 2026. The statutory posting location in practice (rung 9).",
      },
      {
        rung: "BODY_AGENDA_PAGE",
        outcome: "HIT",
        url: "https://www.merrimackcounty.net/elected_officials/delegation/public_notices.php",
        note: "200 HTML. Delegation, Executive Committee and budget subcommittees: notices, materials, minutes, recordings.",
      },
      {
        rung: "BODY_FEED",
        outcome: "MISS",
        url: "https://www.merrimackcounty.net/calendar.php?format=json",
        note: "Returns HTML, not JSON; month/year params also ignored. The JS calendar's XHR endpoint is the remaining browser errand.",
      },
      {
        rung: "BODY_FEED",
        outcome: "HIT",
        url: "https://cms2.revize.com/revize/merrimack/Board%20of%20Commissioners/Public%20Notices,%20Agenda,%20Minutes/Public%20Notice%206.1.26.pdf",
        note: "Document URLs are stable and directly fetchable without the ?t= cache token — canonical URLs for provenance.",
      },
    ],
    homepageUrl: "https://www.merrimackcounty.net/",
    agendaSourceType: "REVIZE",
    agendaSourceRef:
      "https://www.merrimackcounty.net/board_of_commissioners_/public_notices,_agendas,_minutes,_.php",
    coverageStatus: "KNOWN_UNCOVERED",
    notes:
      "Source found and verified; no adapter yet. Both bodies meet at 333 Daniel Webster Hwy, Boscawen (geocoded 43.359873,-71.647976 via the Census geocoder; cite the county's own page for the address before curating the venue entry). ~29 km from the 03255 internal point, which is why this body is what exercises the widened rung. Zoom links are published for remote attendance.",
  },
];

export const COVERAGE_AUDIT_FILE: CoverageAuditFile = {
  generatedAt: "2026-08-13",
  audits: COVERAGE_AUDITS,
};
