import type { BodyCoverageAudit, CoverageAuditFile } from "./audit.ts";

/**
 * Every source hunt anyone has actually run, and what each rung returned.
 *
 * Hand-maintained and cited, the same way `lib/sources/legistar/clients.ts` is
 * and for the same reason: this records work a person did — pages opened and
 * read — so it cannot be generated, and a row without the URL it was read from
 * is worthless. `scripts/build-registry.ts` overlays it onto the derived bodies.
 *
 * **Seven rows out of 265 bodies, and that ratio is the honest output rather
 * than an embarrassment.** The other 258 are `NOT_ATTEMPTED` and now say so.
 * Before this file they were indistinguishable from these seven, because
 * `NO_SOURCE_FOUND` was the derivation's default for all 265 alike.
 *
 * Adding a row means having opened the pages. Two entries below exist because
 * checking overturned something already written down — see Vail.
 */

/** Everything here was walked on this date unless a rung says otherwise. */
const HUNT_DATE = "2026-08-12";
const BY = "session 2026-08-12, Phase 4.6.10";

export const COVERAGE_AUDITS: BodyCoverageAudit[] = [
  {
    bodyId: "ocd-division/country:us/state:az/county:pima#governing",
    attemptedAt: HUNT_DATE,
    attemptedBy: "D12, the Legistar adapter",
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
    // The reader-facing calendar, verified 200 — not the API slug. The slug
    // "pima" belongs to the adapter and already lives in
    // lib/sources/legistar/clients.ts; putting it here made agendaSourceRef
    // mean two different things depending on the row, and the link ladder
    // renders this field.
    agendaSourceRef: "https://pima.legistar.com/Calendar.aspx",
    // COVERED as a hunt outcome, KNOWN_UNCOVERED as a coverage status, and the
    // gap between them is deliberate rather than an inconsistency. The adapter
    // is built and verified against the live API; `lib/meetings/registry.ts`
    // still resolves to the mock, so a reader sees none of it. The hunt found
    // the source; the product does not serve it. D12 stays open on exactly that.
    coverageStatus: "KNOWN_UNCOVERED",
    notes:
      "Adapter built and verified live (D12). The app's active source is still the mock, so this is not LIVE to a reader. Pima exposes only 4 bodies, all Board of Supervisors variants — the Library District sits inside this feed rather than beside it (D19).",
  },

  {
    bodyId: "ocd-division/country:us/state:az/place:tucson#governing",
    attemptedAt: HUNT_DATE,
    attemptedBy: "D16, following the clerk page rather than guessing slugs",
    outcome: "BLOCKED",
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
        rung: "VENDOR_PORTAL_BLOCKED",
        outcome: "BLOCKED_TERMS",
        url: "https://tucsonaz.hylandcloud.com/221agendaonline",
        note: "Hyland OnBase Agenda Online. Parses cleanly; hyland.com terms forbid scraping, data-mining, commercial exploitation and competitive use. Do not build. (D14)",
      },
      {
        rung: "BODY_SUBSCRIBE",
        outcome: "HIT",
        url: "https://public.govdelivery.com/accounts/AZTUCSON/subscriber/topics",
        note: "A syndication channel the City itself operates. Carries no vendor question — this is the route to take.",
      },
    ],
    homepageUrl: "https://www.tucsonaz.gov/",
    agendaSourceType: "NONE",
    agendaSourceRef: null,
    coverageStatus: "SOURCE_BLOCKED",
    notes:
      "The vendor route is closed by terms, not by capability. Routes remaining, in order: ask the City Clerk for a feed, the GovDelivery channel above, and joint Tucson/Pima meetings that already appear on pima.legistar.com. The Hyland and GovDelivery URLs are D16's findings from earlier the same day and were not re-opened in this pass; tucsonaz.gov was.",
  },

  {
    bodyId:
      "ocd-division/country:us/state:az/school_district:tucson_unified_district#board",
    attemptedAt: HUNT_DATE,
    attemptedBy: BY,
    outcome: "FOUND_UNBUILT",
    rungs: [
      {
        rung: "BODY_HOMEPAGE",
        outcome: "HIT",
        url: "https://www.tusd1.org/",
        note: "200.",
      },
      {
        rung: "VENDOR_API",
        outcome: "HIT",
        url: "https://tusd1-schooldesk.community.diligentoneplatform.com/Portal/",
        note: "200. Diligent Community (successor to BoardDocs). Meetings at /Portal/MeetingInformation.aspx?Org=Cal&Id=<n>. No official public API.",
      },
    ],
    homepageUrl: "https://www.tusd1.org/",
    agendaSourceType: "DILIGENT",
    agendaSourceRef:
      "https://tusd1-schooldesk.community.diligentoneplatform.com/Portal/",
    coverageStatus: "KNOWN_UNCOVERED",
    notes:
      "D13. Not cleared and not blocked — the Diligent website ToU carves out products to the customer's own agreement, so the district's agreement governs and that question is B09. Try the portal's subscribe channel and the district's own site before the portal itself.",
  },

  {
    bodyId:
      "ocd-division/country:us/state:az/school_district:vail_unified_district#board",
    attemptedAt: HUNT_DATE,
    attemptedBy: BY,
    outcome: "FOUND_UNBUILT",
    rungs: [
      {
        rung: "VENDOR_PORTAL_BLOCKED",
        outcome: "MISS",
        url: "https://go.boarddocs.com/az/vail/Board.nsf/Public",
        note: "Search results assert this is Vail's BoardDocs. It is not: 403 to a bot and a real browser renders BoardDocs' own 'page isn't here' error. Never recorded as a link.",
      },
      {
        rung: "BODY_HOMEPAGE",
        outcome: "HIT",
        url: "https://www.vailschooldistrict.org/page/governing-board",
        note: "200. The district's own Governing Board page, which is what names the real vendor.",
      },
      {
        rung: "VENDOR_API",
        outcome: "HIT",
        url: "https://vailschools.novusagenda.com/agendapublic/",
        note: "200. NovusAgenda, linked from the Governing Board page above. Not Diligent.",
      },
    ],
    homepageUrl: "https://www.vailschooldistrict.org/page/governing-board",
    agendaSourceType: "NOVUSAGENDA",
    agendaSourceRef: "https://vailschools.novusagenda.com/agendapublic/",
    coverageStatus: "KNOWN_UNCOVERED",
    notes:
      "VAIL IS NOVUSAGENDA, NOT DILIGENT — this corrects a premise the Diligent adapter was scoped against. It is the D16 lesson repeating exactly: inferring a vendor from anything other than the body's own page gets it wrong. So Diligent covers TUSD but not Vail, and a second school-board vendor is needed to reach both of the target zips' districts.",
  },

  {
    bodyId:
      "ocd-division/country:us/state:nj/county:morris/place:rockaway_township#governing",
    attemptedAt: HUNT_DATE,
    attemptedBy: BY,
    outcome: "FOUND_UNBUILT",
    rungs: [
      {
        rung: "BODY_HOMEPAGE",
        outcome: "HIT",
        url: "https://www.rockawaytownship.org/157/Township-Council",
        note: "200. CivicPlus CivicEngage.",
      },
      {
        rung: "BODY_FEED",
        outcome: "HIT",
        url: "https://www.rockawaytownship.org/RSSFeed.aspx?ModID=65&CID=All-agendacenter",
        note: "200 application/rss+xml, POPULATED — real agenda items with permalinks to /AgendaCenter/PreviousVersions/<id>.",
      },
      {
        rung: "BODY_FEED",
        outcome: "HIT",
        url: "https://www.rockawaytownship.org/common/modules/iCalendar/iCalendar.aspx?catID=25&feed=calendar",
        note: "200 text/calendar, 5484 bytes.",
      },
    ],
    homepageUrl: "https://www.rockawaytownship.org/157/Township-Council",
    agendaSourceType: "CIVICPLUS",
    agendaSourceRef:
      "https://www.rockawaytownship.org/RSSFeed.aspx?ModID=65&CID=All-agendacenter",
    coverageStatus: "KNOWN_UNCOVERED",
    notes:
      "The best result on the board: a first-party machine-readable feed, both RSS and iCal, no vendor API and no terms question — CivicPlus publishes these for the municipality. Both feed patterns are CivicPlus-wide rather than Rockaway-specific, so this is one adapter reaching many municipalities. Note this is the TOWNSHIP; Rockaway borough is a separate government with its own row (M17).",
  },

  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#governing",
    attemptedAt: HUNT_DATE,
    attemptedBy: BY,
    outcome: "FOUND_UNBUILT",
    rungs: [
      {
        rung: "VENDOR_API",
        outcome: "HIT",
        url: "https://newburynh.civicweb.net/Portal/MeetingTypeList.aspx",
        note: "200. CivicWeb, footer reads '© iCompass - A Diligent Brand 2026'. Lists Selectboard only.",
      },
      {
        rung: "BODY_FEED",
        outcome: "MISS",
        url: "https://www.newbury.nh.gov/rss.xml",
        note: "200 application/rss+xml and EMPTY — a valid feed with zero items. A status code and content type would have read as a hit.",
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
        note: "200. Drupal 7. The town's own site also lists Zoning, Planning and Conservation Commission meetings the CivicWeb portal does not.",
      },
      {
        rung: "BODY_HOMEPAGE",
        outcome: "BLOCKED_ROBOTS",
        url: "https://www.newbury.nh.gov/",
        note: "403 to an identified automated agent at the root only; sub-paths answer 200 and a real browser renders it fully. A bot posture, not a dead link — verified in a browser before recording.",
      },
    ],
    homepageUrl: "https://www.newbury.nh.gov/",
    agendaSourceType: "CIVICWEB",
    agendaSourceRef: "https://newburynh.civicweb.net/Portal/MeetingTypeList.aspx",
    coverageStatus: "KNOWN_UNCOVERED",
    notes:
      "The town's own site carries MORE bodies than the vendor portal, which is an argument for reading first-party before vendor wherever both exist. NH STATUTORY NOTE for D17: RSA 91-A:2 requires notice but not an agenda, so an absent agenda here can be the body's lawful choice rather than our gap — the wording is undecided and this row does not implement it.",
  },

  {
    bodyId:
      "ocd-division/country:us/state:nh/school_district:kearsarge_regional_school_district#board",
    attemptedAt: HUNT_DATE,
    attemptedBy: BY,
    outcome: "FOUND_UNBUILT",
    rungs: [
      {
        rung: "BODY_AGENDA_PAGE",
        outcome: "BLOCKED_ROBOTS",
        url: "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-agendas-minutes",
        note: "403 to a bot, renders fully in a real browser — a dated table of School Board agendas. Verified in a browser before recording.",
      },
      {
        rung: "BODY_FEED",
        outcome: "MISS",
        url: null,
        note: "No feed found on the board pages.",
      },
    ],
    homepageUrl:
      "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-agendas-minutes",
    agendaSourceType: "HTML",
    agendaSourceRef:
      "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-agendas-minutes",
    coverageStatus: "KNOWN_UNCOVERED",
    notes:
      "First-party HTML, no vendor. The visible table is heavily historical, so whether it carries UPCOMING agendas is unconfirmed and an adapter must check before this is treated as a live calendar. Same NH RSA 91-A:2 note as Newbury (D17).",
  },
];

export const COVERAGE_AUDIT_FILE: CoverageAuditFile = {
  generatedAt: HUNT_DATE,
  audits: COVERAGE_AUDITS,
};
