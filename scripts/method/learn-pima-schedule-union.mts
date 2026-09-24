import { join } from "node:path";

import { runLearnBatch, type LearnedRoute } from "../../lib/method/learn-batch.ts";
import { today } from "../doc-dates.mjs";

/**
 * `pnpm method:learn-pima-schedule-union` — WHAT THE EVENING PASS OF THE PIMA
 * SCHOOL-AGENDA SESSION TAUGHT. (2026-09-23. RULING 248, RULING 250,
 * RULING 252, RULING 263.)
 *
 * The owner asked for the governing-board schedule on each district's own site
 * to be reconciled through the configured forward window, and for every agenda
 * blocker to be re-challenged by a materially different method before anyone
 * is asked for anything. This records the reconciliation route that was wired
 * and the four re-challenges, including the ones that found no permitted copy
 * in the sources checked. The ledger is
 * docs/detective/pima-school-agenda-routes-2026-09-23.md, sections 10 and 11.
 *
 * A separate script from learn-pima-school-agenda-routes.mts on purpose: an
 * outcome recorded again on a known route counts as new evidence, so the
 * earlier batch is never re-run to add these.
 */

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "method", "knowledge.json");

const ROUTES: LearnedRoute[] = [
  {
    id: "union-the-districts-own-calendar-with-its-portal-for-the-forward-window",
    title:
      "publish every forward sitting that EITHER the district's own calendar or its agenda portal verifies — one partition, one writer, identity by body + local date and time",
    tier: "A1",
    fields: ["meeting", "source"],
    note:
      "A district often publishes its sittings twice: in the agenda portal (the partition's list, with agenda links " +
      "and cancellation notes) and on its own site's calendar, which lists Governing Board sittings months before the " +
      "portal does. Neither is a superset, so neither replaces the other; the partition publishes the UNION for the " +
      "forward window (lib/sources/diligent/schedule-union.ts). A calendar sitting matching a portal sitting on body key " +
      "+ local date + time is the same sitting (the portal row stands); an unmatched one is published from the " +
      "calendar with the place its own sentence names, online when it says Zoom or Virtual, and NO place when it names " +
      "none — a missing place or agenda never withholds a verified sitting. Identity: sittings new to the partition are " +
      "`<YYYY-MM-DD>T<HHMM>-<body key>` whichever source lists them, so the day the portal starts listing a sitting " +
      "first published from the calendar nothing is carried twice; portal ids readers already hold stay " +
      "(legacyIdsThrough) and the upcoming ones are pinned by sitting key (legacySitting:<id>). Measured 2026-09-23: " +
      "Tucson Unified's board calendar (govboard.tusd1.org inCal.aspx) added the Oct 6, Oct 27, Nov 17 and Dec 8 " +
      "Governing Board sittings the portal did not list; Sunnyside's SmartSites calendar JSON added Jan 12, 2027. Dry " +
      "runs of both first promotions: GOOD, 0 removed. The host must also be in the meetings source authority or the " +
      "candidate is refused FINAL_HOST_NOT_AUTHORIZED (the SUSD dry run caught exactly that).",
    origin:
      "the owner's directive of 2026-09-23 ('Reconcile the governing-board schedule on the district's own site " +
      "throughout our configured forward window'), after the calendar route had been held because a cutover would lose facts.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note: "Five permitted calendar reads per run (TUSD) or one JSON read (SUSD), under the same permission gate as the portal's records.",
    },
    outcome: { jurisdiction: "az", rows: 5, outcome: "YIELDED", note: "5 forward sittings the portals did not list: TUSD 4, SUSD 1." },
    claims: [
      {
        id: "union-the-districts-own-calendar-with-its-portal-for-the-forward-window#exists",
        class: "ROUTE_EXISTENCE",
        statement: "A district's own permitted calendar can be unioned with its portal list inside one partition, matched on body + local date and time.",
        restsOn: [],
      },
      {
        id: "union-the-districts-own-calendar-with-its-portal-for-the-forward-window#az-outcome",
        class: "ROUTE_OUTCOME",
        statement: "On 2026-09-23 the union added 4 Tucson Unified and 1 Sunnyside forward Governing Board sittings, with 0 removals in either dry run.",
        restsOn: ["union-the-districts-own-calendar-with-its-portal-for-the-forward-window#exists"],
      },
    ],
  },
  {
    id: "agenda-portal-email-subscription-links-back-to-the-portal",
    title:
      "an agenda platform's email subscription announces a published agenda with a link to the platform's own host — it moves no document to a permitted host",
    tier: "B",
    fields: ["agenda", "document"],
    note:
      "Diligent Community's Public Site Resource (connect.diligent.com, read 2026-09-23T23:24Z): 'E-updates will " +
      "automatically send out notification emails, including a link to the published document'. The Community help " +
      "pages (help.diligentoneplatform.com, no robots.txt) add that a subscription is confirmed by email, that the clerk " +
      "chooses per publication whether to notify subscribers, and that an admin may enter a 'Public meetings ICS feed'. " +
      "Nothing documents an attachment or inline agenda text, and the linked document sits on the tenant host, whose " +
      "robots.txt refuses this client, so following the link automatically is barred. Subscribing needs a mailbox and " +
      "a person to confirm it: an owner action, and one that would still end at the refused host.",
    origin: "the owner's re-challenge of 2026-09-23 named the subscription feature as a method to test before asking him for anything.",
    effort: { repeats: "PER_VENDOR", execution: "MACHINE", discovery: "NEW_METHOD", note: "Two vendor guides and three help pages read; nothing subscribed." },
    outcome: { jurisdiction: "az", rows: 0, outcome: "BLOCKED", note: "The documented email carries a link to the refused tenant host, not the document." },
    claims: [
      {
        id: "agenda-portal-email-subscription-links-back-to-the-portal#exists",
        class: "ROUTE_EXISTENCE",
        statement: "Diligent Community's documented e-update email carries a link to the published document on the tenant's public site.",
        restsOn: [],
      },
      {
        id: "agenda-portal-email-subscription-links-back-to-the-portal#az-outcome",
        class: "ROUTE_OUTCOME",
        statement: "On 2026-09-23 the subscription route reached no agenda on a host this client may read, for SUSD or TUSD.",
        restsOn: ["agenda-portal-email-subscription-links-back-to-the-portal#exists"],
      },
    ],
  },
  {
    id: "read-the-statutory-notice-posting-statement-first",
    title:
      "read the body's statutory statement of where meeting notices are posted (A.R.S. 38-431.02(A)(2)(a) in Arizona) — it names the electronic location the law makes the record's home",
    tier: "A1",
    fields: ["meeting", "agenda", "source"],
    note:
      "A.R.S. 38-431.02 (azleg.gov, read 2026-09-23T23:09Z): school districts shall 'Conspicuously post a statement on " +
      "their website stating where all public notices of their meetings will be posted, including the physical and " +
      "electronic locations', and (G) a notice 'shall include an agenda ... or information on how the public may obtain " +
      "a copy'. Tucson Unified's statements name the District Office door (physical), Diligent Community (electronic: " +
      "notices and agendas; refused to this client) and govboard.tusd1.org for 'Information concerning the Board's " +
      "agenda' (permitted; carries the calendar, Board Actions and quorum postings, not committee agendas). Sunnyside: no " +
      "posting statement found on any readable page checked; its agenda page names Diligent. The statement tells you which " +
      "host is the record's legal home before any search is spent, and a missing one is itself a question for the body.",
    origin: "the owner's re-challenge of 2026-09-23 ('Arizona open-meeting posting locations the districts name').",
    effort: { repeats: "PER_STATE", execution: "MACHINE", discovery: "NEW_METHOD", note: "One statute page and each district's governing-board pages." },
    outcome: { jurisdiction: "az", rows: 0, outcome: "BLOCKED", note: "Both districts' electronic posting location for agendas is the refused Diligent tenant." },
    claims: [
      {
        id: "read-the-statutory-notice-posting-statement-first#exists",
        class: "ROUTE_EXISTENCE",
        statement: "Arizona school districts must post on their website where meeting notices, physical and electronic, will be posted.",
        restsOn: [],
      },
      {
        id: "read-the-statutory-notice-posting-statement-first#az-outcome",
        class: "ROUTE_OUTCOME",
        statement: "On 2026-09-23 Tucson Unified's statements named Diligent Community for notices and agendas; no Sunnyside statement was found on the pages checked.",
        restsOn: ["read-the-statutory-notice-posting-statement-first#exists"],
      },
    ],
  },
  {
    id: "search-api-parameters-the-integration-leaves-unused",
    title:
      "before concluding a search found nothing, check which API parameters the integration actually sends — domain filters and the video index found what the default query did not",
    tier: "B",
    fields: ["meeting", "agenda", "source"],
    note:
      "The product's search integration (lib/control-plane/scheduler/scout-search.ts) sends Brave only q and count, " +
      "and Exa query, type fast, numResults and optionally includeDomains. Tested 2026-09-23 against the configured " +
      "keys: Brave honored result_filter and a freshness date range and returned extra_snippets by default (so the " +
      "integration's comment that the default response carries none is wrong); Exa honored includeDomains, " +
      "excludeDomains and startPublishedDate, and returns no page text unless contents is requested. includeDomains on " +
      "youtube.com surfaced Tucson Unified's own channel (TUSDMedia): Audit Committee and Bond Oversight recordings with " +
      "empty descriptions, and scheduled streams for the Oct 6, Oct 27, Nov 17 and Dec 8 Governing Board sittings — an " +
      "independent witness for the calendar-only sittings. No permitted copy of a 2026 SUSD or TUSD committee agenda was " +
      "found in the sources checked (18 queries, $0.114 at list price). Snippets of documents on a refused host are page " +
      "text: not read, and not the record.",
    origin: "the owner's instruction of 2026-09-23 to check whether the integration exposes a capability rather than assume the key was used.",
    effort: { repeats: "PER_VENDOR", execution: "MACHINE", discovery: "NEW_METHOD", note: "18 pointer-only queries with explicit parameters." },
    outcome: { jurisdiction: "az", rows: 4, outcome: "YIELDED", note: "4 scheduled Governing Board streams corroborating the calendar-only sittings; 0 agendas." },
    claims: [
      {
        id: "search-api-parameters-the-integration-leaves-unused#exists",
        class: "ROUTE_EXISTENCE",
        statement: "The configured Brave and Exa keys honor filter parameters the product's integration does not send.",
        restsOn: [],
      },
      {
        id: "search-api-parameters-the-integration-leaves-unused#az-outcome",
        class: "ROUTE_OUTCOME",
        statement: "On 2026-09-23 a youtube.com domain filter found Tucson Unified's scheduled streams for 4 Governing Board sittings; no committee agenda copy was found.",
        restsOn: ["search-api-parameters-the-integration-leaves-unused#exists"],
      },
    ],
  },
];

runLearnBatch(STORE, ROUTES, today());
