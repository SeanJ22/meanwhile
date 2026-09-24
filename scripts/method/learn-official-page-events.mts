import { join } from "node:path";

import { runLearnBatch, type LearnedRoute } from "../../lib/method/learn-batch.ts";
import { today } from "../doc-dates.mjs";

/**
 * `pnpm method:learn-official-page-events` — **A BODY'S OWN OFFICIAL PAGE
 * PUBLISHES DATED PUBLIC EVENTS ITS MEETING PORTAL NEVER CARRIES.**
 * (RULING 248, RULING 252, RULING 254.)
 *
 * One route: reading a district's or city's own CMS page (not its vendor
 * portal) for the dated public events of an effort it runs, through the
 * generic extractor in `lib/sources/official-page-events/`, with every event
 * that cannot be verified HELD under a named reason rather than guessed.
 *
 * This file carries only the route. The read, the validation before admission,
 * the version precondition and the write all belong to `runLearnBatch`, the one
 * governed writer of `data/method/knowledge.json` (RULING 252). NEVER
 * `pnpm method:ingest`. `learnRoute` refuses a duplicate id, so a re-run cannot
 * fork the route; note that the outcome's walk date is the run's stamp, so a
 * re-run on a later day records a new walk and must only be done after one.
 *
 * A SECOND JURISDICTION is added by appending a second `LearnedRoute` with the
 * SAME id, its own `outcome`, and its own `#<state>-outcome` ROUTE_OUTCOME claim:
 * the route is then already known, the new outcome is recorded, and the new
 * claim id is attached additively.
 */

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "method", "knowledge.json");

const ROUTE_ID = "official-page-dated-events-extraction";

const ROUTES: LearnedRoute[] = [
  {
    id: ROUTE_ID,
    title:
      "a body's own official web page, not its vendor portal, publishes the dated public events of an effort it runs; read them in a fixed structural order and HOLD every event that cannot be verified",
    tier: "B",
    fields: ["meeting"],
    note:
      "THE MISS THIS PREVENTS: a body's committee meetings and community engagement sessions for a named effort (a school reconfiguration, a bond, a facilities plan) are published on the body's own CMS page for that effort and nowhere on the meeting portal a meetings adapter reads, so a portal-only walk never sees them. WHAT THE PAGE LOOKS LIKE: a district or city CMS page carrying (1) prose statements such as 'Joint Committee Meeting Sept. 11, 2026', 'Next Meeting October 1, 2026' and 'Joint Committee Meeting Aug 29, 2026 ... 9AM to 4PM'; (2) structured event cards with a title, a date such as '9/23/2026', a time range such as '4:00pm - 6:30pm', an event name, and venue lines such as 'Cholla High School' / 'South Gym'; (3) RSVP and livestream links. THE EXTRACTION ORDER (lib/sources/official-page-events/): schema.org Event JSON-LD; then embedded event state (a CMS that renders its event list client-side from an inline JSON.parse(\"...\") literal or an application/json script, each record carrying a title and an offset-bearing start_at, as Apptegy/Thrillshare district sites do); then microdata Event; then linked .ics files (retrieved only on an authorized host); then structured event cards (an element whose class or id names an event, grown to the smallest wrapper that still holds exactly one date: date + time range + venue line, the most specific venue line winning); then dated headings ('Joint Committee Meeting Sept. 11, 2026', whose own block may state the time 'from 9AM to 4PM' when it names no other date); then 'Next meeting <Month D, YYYY>' statements, titled from the heading of the block that carries them. A PURE route check for discovery shares the same rules: verifyOfficialPageEvents({ body, url, html, now }) returns YIELDED, EMPTY or NOT_CONFIRMED with the verified sample events and every held event's reasons. VERIFICATION, every rule of which HOLDS the event with a named reason instead of guessing: the page host must equal the body's registered official domain or be explicitly authorized in the wiring; each date must parse unambiguously and fall inside the serving window (a day named without a year, such as 'September 21st', is ambiguous); the event title must name the body or its committee. RENDERING RULES the extractor keeps: a date with no time is date-only (startPrecision DAY), never a guessed time, and a range whose start has no am/pm is not read; a venue the page does not state is the publisher's named gap (venueGap NOT_STATED_BY_PUBLISHER) and a stated venue with no reviewed coordinates is carried verbatim as our gap (STATED_NOT_PLACED), never pinned; an end equal to the start is no end; the event type is preserved as published (a Joint Committee meeting or a community engagement session) and never inflated into a Governing Board meeting; an event is cancelled only when the page says so; provenance is the page URL plus the evidence excerpt the event was read from. TRANSPORT: the recording session observed curl receive a Cloudflare 520 from www.tusd1.org while a Node fetch with the project user agent (politeGetText, lib/sources/http.ts) received HTTP 200 for the same page, so a refused curl is not a wall here. robots.txt was read first and allowed the page (it disallows only /TUSD-school-exit-survey and /PLC-Roskruge).",
    origin:
      "conceived 2026-09-23 while acquiring Tucson Unified School District's school reconfiguration meetings, which the district publishes on its own page https://www.tusd1.org/Reconfiguration rather than as Governing Board meetings. The page was fetched through politeGetText and committed as tests/fixtures/official-page-events/tusd-reconfiguration.html with its retrieval record beside it (tusd-reconfiguration.meta.json: HTTP 200, 28,642 bytes, robots verdict ALLOWED).",
    effort: {
      repeats: "ONCE",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "The extractor is generic and written once; each further body costs one wiring entry naming its official page URL (and an explicit host authorization only when the page lives off the body's registered domain). One robots read and one page fetch per body per walk.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 5,
      outcome: "YIELDED",
      note:
        "Tucson Unified School District, https://www.tusd1.org/Reconfiguration, read 2026-09-23. rows = the distinct dated public events the page carries with an unambiguous full date, counted from the committed fixture: three Joint Committee meetings (Aug 29, 2026, 9AM to 4PM; Sept. 11, 2026, date-only; October 1, 2026, the stated next meeting, date-only) and two Tucson Unified Facility Plans Community Engagement sessions (9/23/2026 4:00pm - 6:30pm, Cholla High School, South Gym; 9/26/2026 9:00am - 11:30am, Tucson High Magnet School, East Gym). The prose 'sessions scheduled for September 21st, September 23rd, and September 26th' names days without a year and is HELD as ambiguous rather than parsed. Which of the five fall inside the reader's serving window is the extractor's decision on its own run, not asserted by this count.",
    },
    claims: [
      {
        id: `${ROUTE_ID}#exists`,
        class: "ROUTE_EXISTENCE",
        statement:
          "Reading a body's own official CMS page for an effort it runs, in the order schema.org Event JSON-LD, embedded event state, microdata Event, linked .ics files, structured event cards, dated headings, then 'Next meeting <Month D, YYYY>' statements, and holding every event whose host, date or title cannot be verified, is a retrieval route to dated public events such as committee meetings and community engagement sessions.",
        restsOn: [],
      },
      {
        id: `${ROUTE_ID}#az-outcome`,
        class: "ROUTE_OUTCOME",
        statement:
          "On 2026-09-23 politeGetText read https://www.tusd1.org/Reconfiguration at HTTP 200 with robots.txt allowing it, and the page carried five distinct dated public events with an unambiguous full date: three Joint Committee meetings and two community engagement sessions.",
        restsOn: [`${ROUTE_ID}#exists`],
      },
    ],
  },
  // The cross-state transfer: the SAME route, a second jurisdiction, facts
  // read only from the New Mexico page.
  {
    id: ROUTE_ID,
    title:
      "a body's own official web page, not its vendor portal, publishes the dated public events of an effort it runs; read them in a fixed structural order and HOLD every event that cannot be verified",
    tier: "B",
    fields: ["meeting"],
    note: "Second jurisdiction for the same route; see the route note.",
    origin:
      "transfer test 2026-09-23: Santa Fe Public Schools (NM) board page https://www.sfps.info/page/board-of-education-2, fetched once through politeGetText and committed as tests/fixtures/official-page-events/sfps-board-of-education.html with sfps-board-of-education.meta.json (HTTP 200, 1,679,195 bytes, robots verdict ALLOWED).",
    effort: {
      repeats: "ONCE",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note: "No code change for the second state: one identity (official host from the NCES directory, the page's own names for the body and its committees, America/Denver).",
    },
    outcome: {
      jurisdiction: "nm",
      rows: 13,
      outcome: "YIELDED",
      note:
        "Santa Fe Public Schools, https://www.sfps.info/page/board-of-education-2 (official host www.sfps.info per the NCES directory for LEAID 3502370; the Census-listed sfps.k12.nm.us no longer resolves), read 2026-09-23 at HTTP 200; robots.txt allows / and disallows only /api/. The page renders its events client-side from embedded state (window.clientWorkStateTemp = JSON.parse(...)) and carries no JSON-LD, microdata, .ics or event markup. 20 events in the embedded state: 13 verified with New Mexico identity (Board of Education Regular Meetings, Audit Committee and Community Review Committee sittings, Mountain time from the publisher's own start_at offsets, one concluded); 7 HELD as TITLE_DOES_NOT_NAME_BODY: five 'No school' closures and two misspelled titles ('Board of Educaiton Regular Meeting' 2026-09-24 and 'Communtiy Review Committee (tentative)' 2026-10-14), held rather than corrected. Every venue field is empty: a named gap, never the district office the page's prose names. The embedded state is page 1 of 3 of a 57-entry feed whose other pages sit under the robots-disallowed /api/ path, so this page is not the body's whole calendar. Not wired: Santa Fe Public Schools is not a registered body.",
    },
    claims: [
      {
        id: `${ROUTE_ID}#nm-outcome`,
        class: "ROUTE_OUTCOME",
        statement:
          "On 2026-09-23 politeGetText read https://www.sfps.info/page/board-of-education-2 at HTTP 200 with robots.txt allowing it, and the same extractor verified 13 dated Santa Fe Public Schools board and committee events from the page's embedded event state with New Mexico identity alone, holding 7 whose titles do not name the body.",
        restsOn: [`${ROUTE_ID}#exists`],
      },
    ],
  },
];

// One batch per jurisdiction: the first learns the route, each later one
// records its own outcome and claim against the route now known. A single
// batch carrying the same id twice is refused by the candidate lifecycle.
for (const route of ROUTES) runLearnBatch(STORE, [route], today());
