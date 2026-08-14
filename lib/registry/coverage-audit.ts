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
    outcome: "COVERED",
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
      {
        rung: "VENDOR_API",
        outcome: "HIT",
        url: "https://morriscountynj.iqm2.com/Citizens/Calendar.aspx?From=8/1/2026&To=12/31/2026",
        note: "2026-08-13, the wired rung: Calendar.aspx with From/To is fully server-rendered — future meetings through December, and each row's title tooltip carries board, type, status, and the venue with full street address (Knox Room 525 / Public Meeting Room 555, Administration and Records Building, 10 Court Street, Morristown). That tooltip also resolved the venue-citation errand the county's Akamai-fronted site had blocked. Agenda links (FileOpen.aspx?Type=14) present exactly where published.",
      },
    ],
    homepageUrl:
      "https://www.morriscountynj.gov/Departments/Board-of-County-Commissioners",
    agendaSourceType: "IQM2",
    agendaSourceRef:
      "https://morriscountynj.iqm2.com/Citizens/Calendar.aspx",
    coverageStatus: "LIVE",
    notes:
      "Wired 2026-08-13 (lib/sources/iqm2, adapter on Calendar.aspx rather than the RSS pseudo-feed — the feed lists only published documents, the calendar lists the schedule). Earlier note said the venue needed a browser errand against the county page; overtaken by the calendar tooltip publishing the address itself. The /Services/ and Calendar.aspx patterns generalize to every *.iqm2.com client.",
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
    outcome: "COVERED",
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
      {
        // The statutory posting location in practice (source-ladder rung 9),
        // reached through the body's own agenda page.
        rung: "BODY_AGENDA_PAGE",
        outcome: "HIT",
        url: "https://www.merrimackcounty.net/Board%20of%20Commissioners/Public%20Notices%2C%20Agenda%2C%20Minutes/Public%20Notice%207.27.26.pdf",
        note: "2026-08-13: the notice PDFs state each meeting's venue. 7/27 notice: 'Location: OCH, 163 N. Main St., Concord, NH 03301' — which decodes the homepage block's cryptic 'OCH - Concord'. The 8/10 notice placed that meeting at 333 Daniel Webster Hwy, Boscawen: the Board alternates venues per meeting, so no single venue row can cover the body.",
      },
    ],
    homepageUrl: "https://www.merrimackcounty.net/",
    agendaSourceType: "REVIZE",
    agendaSourceRef:
      "https://www.merrimackcounty.net/board_of_commissioners_/public_notices,_agendas,_minutes,_.php",
    coverageStatus: "LIVE",
    notes:
      "Wired 2026-08-13 (lib/sources/revize: meetings from the homepage upcoming-meetings block, agenda/notice PDFs matched by filename date, ?t= stripped). CORRECTION, overturned by the notices themselves: the earlier note said both bodies meet at 333 Daniel Webster Hwy, Boscawen — the Board in fact alternates venues per meeting (7/27 at OCH Concord, 8/10 at Boscawen), so venue rows are keyed per observed string and an unobserved venue drops counted rather than guessed. Still ~29 km (Concord ~33 km) from the 03255 internal point — the widened-rung exerciser. The delegation's Executive Committee appears in the same homepage block and is deliberately unwired (a different government).",
  },

  // ── Sunnyside USD Governing Board — the author's catch, wired ───────────
  {
    bodyId:
      "ocd-division/country:us/state:az/school_district:sunnyside_unified_district#board",
    attemptedAt: "2026-08-14",
    attemptedBy: "session 2026-08-18 item 2 — the Sunnyside/Amphitheater wiring",
    outcome: "COVERED",
    rungs: [
      {
        rung: "BODY_AGENDA_PAGE",
        outcome: "HIT",
        url: "https://www.susd12.org/agenda-and-minutes",
        note: "200. The district's own page names the current portal (Diligent, susd-12.community.highbond.com) and the NovusAgenda archive for 2008–2023 minutes.",
      },
      {
        rung: "VENDOR_API",
        outcome: "HIT",
        url: "https://susd-12.community.highbond.com/Services/MeetingsService.svc/meetings?from=2026-07-01&to=2026-10-31",
        note: "200 JSON, 9 rows, plain GET no auth — the same MeetingsService wire format as TUSD and PCC. Regular meetings 2nd+4th Tuesday 6:30 PM at the Fred T. Bull Administration Building Governing Board Room.",
      },
      {
        rung: "VENDOR_API",
        outcome: "HIT",
        url: "https://susd-12.community.highbond.com/Portal/MeetingInformation.aspx?Org=Cal&Id=168",
        note: "Permalink pattern verified resolving (the Sep 22, 2026 regular meeting page) before being relied on.",
      },
      {
        rung: "BODY_HOMEPAGE",
        outcome: "HIT",
        url: "https://www.susd12.org/governing-board-home",
        note: "200. Five members with roles (Quintero President, Rodriquez Clerk), meeting cadence, Call to the Audience procedure, and the Governing Board Room address (2238 E. Ginter Road).",
      },
    ],
    homepageUrl: "https://www.susd12.org/governing-board-home",
    agendaSourceType: "DILIGENT",
    agendaSourceRef: "https://susd-12.community.highbond.com/portal/",
    coverageStatus: "LIVE",
    notes:
      "Wired 2026-08-18 (session-date label; wall clock 2026-08-14). The board that made the audit's denominator rule real: a registry division with a derived board since the school layer was built, and nothing on screen until this hunt. Venue row keyed on the feed's 'Fred T. Bull Administration Building' string — the district renamed its Ginter Road headquarters for the retired superintendent in 1992.",
  },

  // ── Amphitheater USD Governing Board — the second half of the catch ─────
  {
    bodyId:
      "ocd-division/country:us/state:az/school_district:amphitheater_unified_district#board",
    attemptedAt: "2026-08-14",
    attemptedBy: "session 2026-08-18 item 2 — the Sunnyside/Amphitheater wiring",
    outcome: "COVERED",
    rungs: [
      {
        rung: "BODY_AGENDA_PAGE",
        outcome: "HIT",
        url: "https://www.amphi.com/agenda-information-current-and-past",
        note: "200. The district's own page names BoardBook Premier and the org URL; agendas also post physically at 701 W. Wetmore Road.",
      },
      {
        rung: "VENDOR_API",
        outcome: "HIT",
        url: "https://meetings.boardbook.org/Public/Organization/2065",
        note: "200 HTML, server-rendered, plain GET no auth: 401 archive rows back to 2018, 15 in 2026, per-row venue name AND street address, public Agenda/PublicNotice links. New adapter lib/sources/boardbook. Notices post days ahead (Aug 11 sitting released Aug 10), so an empty upcoming window between postings is the portal's honest state.",
      },
      {
        rung: "BODY_HOMEPAGE",
        outcome: "HIT",
        url: "https://www.amphi.com/348925_2",
        note: "200. Five members with roles (Cox Golder President, Kopec Vice President); contact via per-member message forms and 520-696-5205 for board business.",
      },
    ],
    homepageUrl: "https://www.amphi.com/our-district/governing-board",
    agendaSourceType: "BOARDBOOK",
    agendaSourceRef: "https://meetings.boardbook.org/Public/Organization/2065",
    coverageStatus: "LIVE",
    notes:
      "Wired 2026-08-18 (session-date label; wall clock 2026-08-14) — first BoardBook Premier tenant, new vendor entry in docs/vendor-review.md. Two venues observed in 2026 rows, both in the venue cache with the feed's own published addresses.",
  },
];

export const COVERAGE_AUDIT_FILE: CoverageAuditFile = {
  generatedAt: "2026-08-14",
  audits: COVERAGE_AUDITS,
};
