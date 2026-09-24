import { join } from "node:path";

import { runLearnBatch, type LearnedRoute } from "../../lib/method/learn-batch.ts";
import { today } from "../doc-dates.mjs";

/**
 * `pnpm method:learn-pima-school-agenda` — WHAT THE PIMA SCHOOL-AGENDA ROUTES
 * SESSION TAUGHT. (2026-09-23. RULING 248, RULING 250, RULING 252, RULING 263,
 * RULING 283.)
 *
 * Three Pima County bodies — Pima Community College, Sunnyside USD 12 and
 * Tucson USD 1 — publish their agendas through Diligent Community tenants whose
 * robots.txt refuses this client, and the routine clock had been reading them.
 * The session looked for every permitted place the same sittings and agendas
 * appear, built a route for each body it found, wired the one that is a
 * verified replacement (the college), and recorded exactly why the other two
 * are held. The per-body ledger is
 * docs/detective/pima-school-agenda-routes-2026-09-23.md.
 *
 * Idempotent: `learnRoute` refuses a duplicate id, and an outcome recorded
 * again on a known route is the evidence that later earns it a portability
 * class.
 */

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "method", "knowledge.json");
const ON = "2026-09-23";
const LEDGER = "docs/detective/pima-school-agenda-routes-2026-09-23.md";

const ROUTES: LearnedRoute[] = [
  {
    id: "diligent-community-robots-is-a-named-crawler-allowlist",
    title:
      "a Diligent Community tenant's robots.txt is an ALLOWLIST of six search crawlers, so the permission ask is one named group, not a policy fight",
    tier: "B",
    fields: ["meeting", "agenda", "source"],
    note:
      "READ 2026-09-23T20:02Z ON THREE TENANTS — pima.community.highbond.com, susd-12.community.highbond.com, " +
      "tusd1-schooldesk.community.diligentoneplatform.com — AND ALL THREE SERVE ONE BYTE-IDENTICAL FILE: 23,479 bytes, " +
      "sha256 b5cbf0b4b2cbcf18…, 484 groups. `User-agent: *` carries `Disallow: /`. Six groups do NOT: msnbot, slurp, " +
      "googlebot, bingbot, duckduckbot and AddSearchBot, each with the same ten narrow disallows (/FileStorage/, " +
      "/WorkSpace/, /js/, /scripts/, /css/, /images/, /fonts/, /Content/, /WebResource.axd, /ScriptResource.axd) and " +
      "`Crawl-delay: 120`. Evaluated with lib/control-plane/scheduler/robots.ts: googlebot is ALLOWED on /Portal/, " +
      "/document/<id> and /Services/MeetingsService.svc; the token we-the-people is DISALLOWED on all three. So the " +
      "refusal is a vendor-wide default, not a district's choice, and the exact request that would change our verdict " +
      "is: add a `User-agent: we-the-people` group mirroring the search-engine groups. Because selectGroups() reads the " +
      "group for OUR product token before `*`, that one change flips every Diligent tenant to ALLOWED at once, and it " +
      "is verifiable afterwards by re-reading robots.txt. DO NOT re-walk the tenants on a clock meanwhile: a disallow " +
      "is a rule, not an absence with an expiry.",
    origin:
      "conceived 2026-09-23 while re-reading the three tenants' robots.txt before building replacements: counting the " +
      "groups that do NOT disallow root, instead of stopping at the `*` group, is what turned 'Diligent forbids " +
      "crawling' into a named, answerable request.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note: "One robots.txt read per tenant and one evaluator pass. The value is the precision of the owner's ask.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 0,
      outcome: "BLOCKED",
      note:
        "Three Pima County tenants refuse this client by published rule; their agendas stay owed through the permitted " +
        "routes below and the owner's allowlist request to legal@diligent.com (drafted in docs/email-diligent-legal.md).",
    },
    claims: [
      {
        id: "diligent-community-robots-is-a-named-crawler-allowlist#exists",
        class: "ROUTE_EXISTENCE",
        statement:
          "Reading every group of a Diligent Community tenant's robots.txt, not only `*`, names the crawlers the vendor admits and the exact group that would admit this client.",
        restsOn: ["agenda-vendor-portal-blanket-robots-disallow"],
      },
      {
        id: "diligent-community-robots-is-a-named-crawler-allowlist#az-outcome",
        class: "ROUTE_OUTCOME",
        statement:
          "On 2026-09-23 three Pima County Diligent tenants served one byte-identical robots.txt that admits six named search crawlers and refuses `*`.",
        restsOn: ["diligent-community-robots-is-a-named-crawler-allowlist#exists"],
      },
      {
        id: "diligent-community-robots-is-a-named-crawler-allowlist#vendor-default",
        class: "DERIVED_CONCLUSION",
        statement:
          "The refusal on these tenants is Diligent's platform default rather than a district setting, so a permission request goes to Diligent and one grant would cover every tenant.",
        restsOn: ["diligent-community-robots-is-a-named-crawler-allowlist#az-outcome"],
        provenance: {
          artifact: "tests/fixtures/pima-edu/robots-pima.community.highbond.com.txt (read 2026-09-23T20:02Z; SUSD and TUSD tenants byte-identical, " + LEDGER + ")",
          observedVia: "diligent-community-robots-is-a-named-crawler-allowlist",
          disposition: "BLOCKED",
          jurisdictions: ["az"],
          vendors: ["Diligent Community"],
          observedOn: ON,
        },
        validation: {
          state: "UNVALIDATED",
          on: ON,
          by: "three tenants byte-identical (sha256 b5cbf0b4b2cbcf18…); not yet confirmed by Diligent",
        },
      },
    ],
  },
  {
    id: "college-documents-table-and-events-calendar-replace-a-disallowed-agenda-platform",
    title:
      "a college's own board-documents table plus its events calendar re-find every sitting its disallowed agenda platform carried — and some of the agendas",
    tier: "A1",
    fields: ["meeting", "agenda"],
    note:
      "PIMA COMMUNITY COLLEGE, READ 2026-09-23. www.pima.edu/about-pima/leadership-policies/governing-board/board-" +
      "meetings/documents.html is the year's table of EVERY Governing Board sitting (regular, executive session, study " +
      "session, retreat) with the college's own links per row: the agenda (a first-party PDF on www.pima.edu for the " +
      "Aug 10 study session — agendas-docs-2026/0810.pdf, 2 pages, full items — or the college's link into its Diligent " +
      "tenant), 'Approved Items' PDFs, and the video. events.pima.edu's Board of Governors calendar " +
      "(`/?calendar[]=3&calId=10`) carries every UPCOMING sitting (8 on the day) — past sittings are not in that view " +
      "(a date filter in MM/DD/YYYY returns 3 for October and 0 for June–September). The Finance and Audit Committee " +
      "page carries its fiscal-year schedule (date, 9:00am, Zoom Webinar) and a per-sitting document table. robots: " +
      "www.pima.edu has eight narrow disallows, none on these paths; events.pima.edu is the Drupal default set. The " +
      "route re-found 7 of 7 sittings production held from the tenant and 5 more it did not, and it CORRECTED one: the " +
      "Aug 10 agenda says 'VIRTUAL MEETING' where the tenant's location field said 'District Office TBD'. Built as " +
      "lib/sources/pima-edu and WIRED 2026-09-23; the Diligent route for the college is retired in " +
      "RETIRED_MEETING_ROUTES.",
    origin:
      "conceived 2026-09-23 by reading the college's own board pages BEFORE asking whether the vendor could be read — " +
      "the registry already named documents.html as the body's agendaSourceRef, and nothing had read it as a source.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note: "About 15 permitted requests per run: two robots files, the table, the listing, one page per upcoming event, two committee pages, and at most six agenda PDFs.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 12,
      outcome: "YIELDED",
      note:
        "12 in-window sittings on 2026-09-23 (7 the tenant held + 5 new), one first-party agenda with items; an " +
        "in-memory dry run of the partition promotion returned GOOD.",
    },
    claims: [
      {
        id: "college-documents-table-and-events-calendar-replace-a-disallowed-agenda-platform#exists",
        class: "ROUTE_EXISTENCE",
        statement:
          "A body that publishes agendas through a vendor portal may also publish a per-sitting document table and an events calendar on its own permitted hosts.",
        restsOn: [],
      },
      {
        id: "college-documents-table-and-events-calendar-replace-a-disallowed-agenda-platform#az-outcome",
        class: "ROUTE_OUTCOME",
        statement:
          "On 2026-09-23 Pima Community College's own pages yielded 12 in-window Governing Board and committee sittings, including all 7 its Diligent tenant carried.",
        restsOn: ["college-documents-table-and-events-calendar-replace-a-disallowed-agenda-platform#exists"],
      },
    ],
  },
  {
    id: "event-page-add-to-calendar-link-is-sitting-data",
    title: "an event page's 'Add to My Calendar' link states the sitting's start, end and room as machine-readable data",
    tier: "B",
    fields: ["meeting"],
    note:
      "events.pima.edu event pages carry a Google Calendar template link: " +
      "`calendar/render?action=TEMPLATE&dates=20260925T161500/20260925T170000&ctz=-07:00&location=District+Office+C-228`. " +
      "Parsing that link rather than the page prose gives the wall-clock start and end and the room exactly as the " +
      "publisher encoded them — the listing teaser only says 'District Office'. The shape is general: any CMS that " +
      "renders an add-to-calendar button has already serialised the event; read the serialisation. " +
      "lib/sources/pima-edu parseEventPage.",
    origin: "found 2026-09-23 looking for the room the listing omitted; the button's href was the only structured copy on the page.",
    effort: { repeats: "PER_VENDOR", execution: "MACHINE", discovery: "NEW_METHOD", note: "No extra request: the event page is read anyway." },
    outcome: { jurisdiction: "az", rows: 8, outcome: "YIELDED", note: "8 of 8 upcoming PCC board event pages carried the link with start, end and room." },
    claims: [
      {
        id: "event-page-add-to-calendar-link-is-sitting-data#exists",
        class: "ROUTE_EXISTENCE",
        statement: "An add-to-calendar template link on an event page is a machine-readable statement of that event's time and place.",
        restsOn: [],
      },
      {
        id: "event-page-add-to-calendar-link-is-sitting-data#az-outcome",
        class: "ROUTE_OUTCOME",
        statement: "On 2026-09-23 all 8 upcoming Pima Community College board event pages carried start, end and room in their calendar link.",
        restsOn: ["event-page-add-to-calendar-link-is-sitting-data#exists"],
      },
    ],
  },
  {
    id: "smartsites-calendar-component-json-api",
    title:
      "a ParentSquare SmartSites district's calendar component reads its own JSON — dates are right, the tenant's offset and the place are not there to trust",
    tier: "B",
    fields: ["meeting"],
    note:
      "SUNNYSIDE USD, READ 2026-09-23. The home page carries the component config as JSON " +
      "(`data-view-data-events-sliders`, `\"calendarApiID\": 150042`) and its bundle /dist/assets/EventsRepository-*.js " +
      "calls `<site>/api/calendars/<calendarApiID>/events?start_date=&end_date=&view_source=event-slider` on the " +
      "district's own origin. robots on www.susd12.org disallows only /admin, /*lesson_plan and /userFiles (Crawl-delay " +
      "5), so the API path is ALLOWED. It returned 32 events for Jun 25–Dec 31: 13 Governing Board entries that match " +
      "all 12 sittings the district's Diligent tenant carried at the same WALL CLOCK. TWO TRAPS: (1) the tenant's " +
      "site_timezone is America/Denver, so start_datetime carries -06:00 for a 4:30 pm Arizona sitting — read " +
      "start_date+start_time in the body's zone; (2) every board event's `address` is empty, and the district's " +
      "Diligent titles mark two upcoming sittings VIRTUAL that this calendar does not. The file host " +
      "files.smartsites.parentsquare.com is `Disallow: /`. Built as lib/sources/smartsites; NOT wired — without a " +
      "per-sitting place it would drop 12 of 13 sittings.",
    origin:
      "conceived 2026-09-23 from the district's own sentence 'check the calendar located on the home page … for the " +
      "most up-to-date board meeting dates', then rung 7: the calendar is empty in served HTML, so the component's " +
      "network call was read out of its bundle.",
    effort: { repeats: "PER_VENDOR", execution: "MACHINE", discovery: "NEW_METHOD", note: "One page read to find the calendar id, one JSON call per run." },
    outcome: {
      jurisdiction: "az",
      rows: 13,
      outcome: "YIELDED",
      note: "13 Governing Board dates and times; 1 placeable (a title saying Virtual); 12 carry no place on this route.",
    },
    claims: [
      {
        id: "smartsites-calendar-component-json-api#exists",
        class: "ROUTE_EXISTENCE",
        statement: "A SmartSites district exposes its calendar as JSON at /api/calendars/<calendarApiID>/events on its own origin, the id read from the home page's component config.",
        restsOn: [],
      },
      {
        id: "smartsites-calendar-component-json-api#az-outcome",
        class: "ROUTE_OUTCOME",
        statement: "On 2026-09-23 Sunnyside USD's calendar API returned all 12 Governing Board sittings its Diligent tenant carried, with no place on any board event.",
        restsOn: ["smartsites-calendar-component-json-api#exists"],
      },
    ],
  },
  {
    id: "ixcal-month-fragment-and-board-actions-record",
    title:
      "Tucson Unified's board calendar loads a server-rendered month fragment carrying the board AND its committees, and its Board Actions PDFs are the agenda with actions",
    tier: "A1",
    fields: ["meeting", "agenda"],
    note:
      "govboard.tusd1.org/Meeting-Calendar is empty to a plain client; its inline script calls " +
      "`/inflow/xti/inCal.aspx?PID=36871&C=0&D=<YYYY-MM-DD>&V=12`, a month fragment with one modal per sitting: title, " +
      "`Date & Time: MM/DD/YYYY h:mmpm - h:mmpm`, and the district's own sentence about place ('held at the Duffy " +
      "Community Center …', 'held via Zoom', 'location TBD', and for Jul 15 a Zoom webinar link). robots on " +
      "govboard.tusd1.org names only GPTbot and PetalBot — no `*` group. /Actions lists a Board Actions PDF per " +
      "Governing Board sitting (`/_theme/files/GovBoard/Docs/actions/<MM-DD-YYYY><R|S>.pdf`) titled 'GOVERNING BOARD " +
      "AGENDA … – Board Actions': every agenda item with the action taken. Read 2026-09-23: 19 in-window sittings, 15 of " +
      "the 18 the Diligent tenant held at the same clock, 7 Board Actions records, 4 future board sittings the tenant " +
      "lacks, and a CORRECTION (Jul 15 Audit Committee moved to Zoom while the tenant kept the old room). NOT WIRED: " +
      "the calendar lacks Budget Advisory Sep 30 and EBT Oct 5 (the EBT page states Oct 5 in prose), and shows Budget " +
      "Advisory Sep 11 as an ordinary meeting where the tenant's title says CANCELLED DUE TO LACK OF QUORUM. Built as " +
      "lib/sources/tusd-govboard.",
    origin:
      "conceived 2026-09-23 by opening the board site's own Meeting-Calendar page, finding it empty in served HTML, " +
      "and reading the one function its script calls.",
    effort: { repeats: "PER_VENDOR", execution: "MACHINE", discovery: "NEW_METHOD", note: "Eight month fragments and one Actions page per run." },
    outcome: {
      jurisdiction: "az",
      rows: 19,
      outcome: "YIELDED",
      note: "19 in-window sittings and 7 Board Actions agenda records; held from wiring because three held facts are absent here.",
    },
    claims: [
      {
        id: "ixcal-month-fragment-and-board-actions-record#exists",
        class: "ROUTE_EXISTENCE",
        statement: "Tucson Unified's board site serves its calendar as month fragments at /inflow/xti/inCal.aspx and its Board Actions as per-sitting PDFs listed at /Actions.",
        restsOn: [],
      },
      {
        id: "ixcal-month-fragment-and-board-actions-record#az-outcome",
        class: "ROUTE_OUTCOME",
        statement: "On 2026-09-23 the fragments carried 19 in-window TUSD sittings (15 of 18 the Diligent tenant held) and /Actions carried 7 in-window Board Actions records.",
        restsOn: ["ixcal-month-fragment-and-board-actions-record#exists"],
      },
    ],
  },
  {
    id: "a-permitted-replacement-must-carry-every-held-fact-before-cutover",
    title:
      "before a permitted route replaces a disallowed one, diff it against the held record per sitting AND per fact — dates are the easy part",
    tier: "A1",
    fields: ["meeting", "agenda", "source"],
    note:
      "THE DISCIPLINE. RULING 283 makes a cutover disable the old writer, so a replacement that re-finds the dates but " +
      "loses a place, a cancellation or a sitting turns a permission fix into a false claim on a reader's screen. Diff " +
      "the candidate against the held partition sitting by sitting and fact by fact (time, place, virtual/in-person, " +
      "cancellation, agenda link), and cut over only where the permitted route is a superset. Measured 2026-09-23: " +
      "Pima Community College 7/7 sittings with every place stated and one corrected → WIRED; Sunnyside 12/12 dates but " +
      "1/12 places → HELD; Tucson Unified 15/18 sittings, a lost CANCELLED annotation and a TBD place → HELD. The held " +
      "partition is read read-only; nothing is fetched from the refused host to make the comparison. A permitted page " +
      "can also be MORE current than the platform (PCC Aug 10 virtual, TUSD Jul 15 Zoom): the sitting's own most " +
      "specific statement governs place, never the standing sentence.",
    origin: "stated 2026-09-23 after the three dry-run diffs disagreed about which bodies could be cut over.",
    effort: { repeats: "PER_VENDOR", execution: "MACHINE", discovery: "NEW_METHOD", note: "One read-only production read and one diff per body." },
    outcome: { jurisdiction: "az", rows: 3, outcome: "YIELDED", note: "3 bodies diffed: 1 superset (wired), 2 held with named losses." },
    claims: [
      {
        id: "a-permitted-replacement-must-carry-every-held-fact-before-cutover#exists",
        class: "ROUTE_EXISTENCE",
        statement: "A per-sitting, per-fact diff of a candidate route against the held partition decides whether a cutover loses facts.",
        restsOn: [],
      },
      {
        id: "a-permitted-replacement-must-carry-every-held-fact-before-cutover#az-outcome",
        class: "ROUTE_OUTCOME",
        statement: "On 2026-09-23 the diff wired Pima Community College and held Sunnyside and Tucson Unified with their missing facts named.",
        restsOn: ["a-permitted-replacement-must-carry-every-held-fact-before-cutover#exists"],
      },
    ],
  },
  {
    id: "move-the-agenda-record-to-a-permitted-host-before-the-list-can-move",
    title:
      "when a body's meeting LIST must stay on its current route, its per-sitting agenda RECORD can still move to a permitted host — one partition, one writer, a better representation",
    tier: "A1",
    fields: ["agenda", "document"],
    note:
      "TUCSON UNIFIED, 2026-09-23. The meeting list could not yet move off the district's Diligent tenant without losing " +
      "facts (see a-permitted-replacement-must-carry-every-held-fact-before-cutover), and the agenda the tenant links " +
      "is a document on the same refused host — so production held 967 reads of portal PAGES and no agenda. The " +
      "district's own govboard.tusd1.org/Actions (permitted) lists a Board Actions PDF per Governing Board sitting. The " +
      "existing Diligent adapter now reads that index when its wiring row names it (`agendaRecordsUrl`, " +
      "`agendaRecordsTypeIds: 17,29` — the portal's own type ids for Regular and Special, not 28 Executive Session) " +
      "and links a CONCLUDED sitting's record instead of the portal page; the ingest then retrieves the PDF from the " +
      "permitted host. The partition, its identities and its single clock are unchanged. In-memory dry run against " +
      "production's partition as promoted 2026-09-23T20:41:55Z: GOOD, 7 sittings changed agenda link, 7 documents " +
      "added with 2–13 items each, 0 removals. General shape: separate the LIST route from the DOCUMENT route; a body " +
      "often publishes its records somewhere its platform does not.",
    origin:
      "conceived 2026-09-23 after the coordinator relayed the owner's point that TUSD meetings were already current — " +
      "what readers lacked was the agenda content, not the sittings.",
    effort: { repeats: "PER_VENDOR", execution: "MACHINE", discovery: "NEW_METHOD", note: "One extra permitted request per run for the index; one per new record." },
    outcome: {
      jurisdiction: "az",
      rows: 7,
      outcome: "YIELDED",
      note: "7 concluded Tucson Unified Governing Board sittings in the window gain their Board Actions record; committee sittings keep the portal link.",
    },
    claims: [
      {
        id: "move-the-agenda-record-to-a-permitted-host-before-the-list-can-move#exists",
        class: "ROUTE_EXISTENCE",
        statement: "A per-sitting agenda record on a permitted host can replace a refused document read inside an existing partition without moving the meeting list.",
        restsOn: ["ixcal-month-fragment-and-board-actions-record#exists"],
      },
      {
        id: "move-the-agenda-record-to-a-permitted-host-before-the-list-can-move#az-outcome",
        class: "ROUTE_OUTCOME",
        statement: "On 2026-09-23 an in-memory promotion of Tucson Unified's partition with Board Actions records validated GOOD with 7 records added and nothing removed.",
        restsOn: ["move-the-agenda-record-to-a-permitted-host-before-the-list-can-move#exists"],
      },
    ],
  },
  {
    id: "district-youtube-playlist-is-a-schedule-not-an-agenda",
    title: "a district's YouTube board playlist pre-creates every sitting as a scheduled stream — a dated schedule, and no agenda",
    tier: "B",
    fields: ["meeting", "agenda"],
    note:
      "www.youtube.com robots allows /watch and /playlist and disallows /feeds/videos.xml, /api/ and /youtubei/ (read " +
      "2026-09-23). Sunnyside's board playlist (linked as 'Video Archive' from susd12.org) holds scheduled live streams " +
      "for every sitting through May 2027, each with liveBroadcastDetails.startTimestamp; descriptions are one line " +
      "('Sunnyside Unified School District No. 12 • Governing Board Meeting • September 29, 2026') with no agenda items. " +
      "Pima Community College's documents table links a video per sitting. Useful as a schedule witness and a recording " +
      "link; never an agenda source, and caption tracks sit under the disallowed /api/.",
    origin: "walked 2026-09-23 as the brief's 'YouTube meeting-video descriptions' branch.",
    effort: { repeats: "PER_VENDOR", execution: "MACHINE", discovery: "REAPPLIED_KNOWN_METHOD", note: "One playlist page and two watch pages." },
    outcome: { jurisdiction: "az", rows: 0, outcome: "ZERO", note: "ZERO agenda items in Sunnyside's board video descriptions; the dates matched the district calendar." },
    claims: [
      {
        id: "district-youtube-playlist-is-a-schedule-not-an-agenda#exists",
        class: "ROUTE_EXISTENCE",
        statement: "A district's YouTube board playlist and watch pages are permitted reads that carry sitting dates and stream start times.",
        restsOn: [],
      },
      {
        id: "district-youtube-playlist-is-a-schedule-not-an-agenda#az-outcome",
        class: "ROUTE_OUTCOME",
        statement: "On 2026-09-23 Sunnyside's board video descriptions carried no agenda items.",
        restsOn: ["district-youtube-playlist-is-a-schedule-not-an-agenda#exists"],
      },
    ],
  },
  {
    id: "a-sites-file-host-carries-its-own-robots",
    title: "a permitted site's documents can live on a file host whose robots.txt refuses — permission is read per document host",
    tier: "A1",
    fields: ["agenda", "document", "source"],
    note:
      "www.susd12.org permits this client, and every PDF it links (the Employee Benefits Trust agendas, the Possible " +
      "Governing Board Quorum notice) sits on files.smartsites.parentsquare.com, whose robots.txt is `User-agent: * / " +
      "Disallow: /` (63 bytes, read 2026-09-23). Same shape as legistar.granicus.com under pima.legistar.com " +
      "(docs/sources.md, 2026-08-29). The rule: check permission for the host in the DOCUMENT URL, never inherit it from " +
      "the page that linked it — lib/sources/permission-gate.ts does this per URL, per origin.",
    origin: "found 2026-09-23 when the first document link on the permitted SUSD agenda page pointed off-host.",
    effort: { repeats: "PER_VENDOR", execution: "MACHINE", discovery: "REAPPLIED_KNOWN_METHOD", note: "One robots.txt read per document host." },
    outcome: { jurisdiction: "az", rows: 0, outcome: "BLOCKED", note: "SmartSites file host refuses; the documents it holds are owed by another route." },
    claims: [
      {
        id: "a-sites-file-host-carries-its-own-robots#exists",
        class: "ROUTE_EXISTENCE",
        statement: "A document linked from a permitted page is governed by the robots.txt of the document's own host.",
        restsOn: [],
      },
      {
        id: "a-sites-file-host-carries-its-own-robots#az-outcome",
        class: "ROUTE_OUTCOME",
        statement: "On 2026-09-23 files.smartsites.parentsquare.com refused every agent while www.susd12.org permitted this client.",
        restsOn: ["a-sites-file-host-carries-its-own-robots#exists"],
      },
    ],
  },
];

runLearnBatch(STORE, ROUTES, today());
