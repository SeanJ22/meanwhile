/**
 * `pnpm method:learn-novus` — WHAT DRIVING THE NOVUS PORTAL'S REAL CONTROLS
 * TAUGHT. (2026-08-28. **RULING 100**, **RULING 178**, **RULING 184**.)
 *
 * ## The lead, and where it came from
 *
 * `novusagenda-public-portal-viewstate-search` (v34, 2026-08-27) recorded a
 * FAILED extraction and named three untried branches. This session walked one
 * of them — a real browser at rung 6 — and the failure turned out to have a
 * cause nobody had looked for.
 *
 * ## The cause: the search is not driven by the fields the POST set
 *
 * The date TEXT BOXES on `MeetingsResponsive.aspx` are `disabled`. Playwright
 * refused to click one and said so, which is the fact the hand-built POST could
 * never learn: `hfFromDate` and `hfToDate` are OUTPUTS of a `<select>` called
 * `ddlDateRange`, not inputs to the search. Setting them and pressing Search
 * was always going to come back with the portal's own defaults, and that is
 * exactly what it did.
 *
 * Choose the window through the dropdown and the portal accepts it. Eight
 * preset windows were walked and every one echoed back precisely the dates it
 * was asked for.
 *
 * ## The result, and the control that makes it a result
 *
 * All eight preset windows — spanning 2025-08-28 to 2027-08-28 — returned ZERO
 * meetings. That number is worth nothing without an instrument check, and five
 * candidate control tenants proved nothing: every one is a wildcard host
 * answering *"Error: An HTTP error occurred"* with no search form at all.
 *
 * The control that worked was on Vail's own tenant. **Custom Date Range**
 * enables the disabled boxes, and over 2010-01-01 to 2027-12-31 the same
 * selectors in the same session returned **30 meeting rows and 30 agenda-item
 * rows**, newest 2017-02-28, with Online Agenda / Agenda PDF / Minutes Recap /
 * Legal Minutes links and real item titles. The reader reads.
 *
 * So the zero is a MEASURED zero: 2024-01-01 to 2026-12-31 returns *"No records
 * to display"* from a query that ran and was echoed, minutes after the same
 * code read thirty rows.
 *
 * ## What that means, stated exactly
 *
 * Vail Unified's NovusAGENDA tenant is a HISTORICAL ARCHIVE that stops in early
 * 2017. It is a real, permitted, machine-readable source of that district's
 * board agendas up to that date — and it does not contain the next one.
 *
 * It does NOT mean Vail publishes no agendas. They publish to Highbond, which
 * disallows every automated client by published rule. That wall is unchanged
 * and is not circumvented.
 *
 * NH229's claim that this portal "carries everything before 2017-03-14" was
 * recorded as UNVERIFIED. It is now VERIFIED, by observation, with the boundary
 * measured at 2017-02-28.
 *
 * Idempotent: `learnRoute` refuses a duplicate id, so a re-run cannot inflate
 * the method version or deepen a route's evidence.
 */

import { join } from "node:path";

import { runLearnBatch, type LearnedRoute } from "../lib/method/learn-batch.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "method", "knowledge.json");

const ROUTES: LearnedRoute[] = [
  {
    id: "aspnet-search-driven-by-a-select-not-by-its-hidden-fields",
    title:
      "an ASP.NET search whose hidden date fields are OUTPUTS of a dropdown — why setting them and pressing Search returns the server's own defaults",
    tier: "B",
    fields: ["meeting", "agenda"],
    note:
      "THE GENERAL SHAPE, AND IT EXPLAINS A WHOLE CLASS OF 'THE PORTAL IGNORED MY QUERY'. On NovusAGENDA's MeetingsResponsive.aspx the visible date inputs txtCalendarFrom and txtCalendarTo carry the DISABLED attribute, and the hidden hfFromDate/hfToDate beside them are written by the ddlDateRange <select> ('Last Month', 'Last Year', 'Custom Date Range', ...). A POST that sets the hidden fields and submits btnSearch therefore sets a value the server recomputes from the dropdown before the search runs, and the response echoes the DEFAULT window rather than the requested one. THE DIAGNOSTIC IS THE ECHO: read back whatever the page reports the applied window to be, and compare it to the window you asked for. Equal means the query ran; different means it did not, and a zero-row result from a query that did not run is a FAILED extraction (RULING 100) and never an absence. THE FIX IS TO OPERATE THE CONTROL THAT OWNS THE VALUE: select the named window, or select 'Custom Date Range' — which is what ENABLES the text boxes — and then type into them. A browser at rung 6 finds this in one step because it refuses to click a disabled element and says so; a hand-built POST cannot find it at all, because a disabled input is still serialisable and still ignored.",
    origin:
      "found 2026-08-28 walking the branch route novusagenda-public-portal-viewstate-search named as untried. The previous session's diagnosis — 'the date parameters were not applied' — was exactly right and the cause was one layer further in than a viewstate problem.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "One browser session to find it, and then it is a property of the platform rather than of the tenant. Every NovusAGENDA tenant has the same form.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 30,
      outcome: "YIELDED",
      note:
        "Custom Date Range over 2010-01-01 to 2027-12-31 returned 30 meeting rows and 30 agenda-item rows on vailschools.novusagenda.com, with agenda and minutes links on each. The eight preset windows were also accepted and echoed correctly.",
    },
  },
  {
    id: "vendor-portal-is-a-historical-archive-with-a-measured-boundary",
    title:
      "a vendor portal a body has MIGRATED OFF — live, permitted, fully readable, and stopping at a date that has to be measured rather than assumed",
    tier: "B",
    fields: ["meeting", "agenda"],
    note:
      "THE FINDING, AND THE CONTROL THAT MAKES IT ONE. vailschools.novusagenda.com is live (robots.txt is 404, so the host publishes NO restriction) and its search works once driven through ddlDateRange. Over 2010-01-01 to 2027-12-31 it returns meetings and agenda ITEMS whose newest is 2017-02-28. Over 2024-01-01 to 2026-12-31 it returns 'No records to display' — a MEASURED zero, from a query whose window the portal echoed back correctly, minutes after the same selectors in the same session read thirty rows. THE INSTRUMENT CHECK IS THE WHOLE POINT: a reader that returns zero because its selector is wrong returns zero on every tenant in the world and reads, in a report, exactly like a body that publishes nothing. Five candidate control tenants (hillsboroughcounty, cityofmesaaz, pinalcountyaz, cityofsanmateo, brevardcounty) proved NOTHING in either direction — all five are wildcard hosts answering 'Error: An HTTP error occurred' with no search form — and are recorded as proving nothing. The control that worked was the same tenant over a wider window. WHAT THIS DOES AND DOES NOT LICENSE: it licenses 'this vendor holds this body's agendas through 2017-02-28 and no later'. It does NOT license 'this body publishes no current agenda' — Vail publishes to Highbond, which disallows every automated client by published rule, and that wall is unchanged. A migrated-off portal is a real historical source and a permanent non-source for anything after its boundary.",
    origin:
      "walked 2026-08-28. NH229 asserted this portal 'carries everything before 2017-03-14' and the previous session recorded that claim as UNVERIFIED and mildly contradicted by the portal's current-window default. It is now VERIFIED by observation, with the boundary measured at 2017-02-28 rather than taken from the claim.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "Two browser sessions: one to find the control, one to establish the boundary with a wide window and a narrow one. The adapter itself is ordinary once the form is understood.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 30,
      outcome: "YIELDED",
      note:
        "30 meetings and 30 agenda items read from Vail Unified's Novus tenant, newest 2017-02-28. The current agenda is NOT here and remains walled behind Highbond's published disallow.",
    },
  },
  {
    id: "prove-the-reader-before-believing-a-zero",
    title:
      "the instrument check that has to happen before a zero-row result is written down as anything at all",
    tier: "A1",
    fields: ["meeting", "agenda", "roster"],
    note:
      "A ZERO IS A CLAIM ABOUT A GOVERNMENT AND AN INSTRUMENT AT THE SAME TIME, AND ONLY ONE OF THEM IS USUALLY CHECKED. A selector that matches nothing, a table id that changed, a grid that renders after the read — each returns zero, and each reads identically to a body that publishes nothing. THE CHECK IS TO MAKE THE SAME READER RETURN NON-ZERO, in the same session, against something it should find: a wider window, an older year, a sibling tenant, a different body on the same platform. Only after it does is the zero evidence. THE CHECK ITSELF CAN FAIL TO PROVE ANYTHING and that has to be reported rather than absorbed: five candidate Novus tenants were tried on 2026-08-28 as controls and every one was a wildcard error page with no form, which is not a passing control and is not a failing one either. Recording 'the control proved nothing, so the zero proves nothing' is the honest outcome, and it is what keeps a broken reader from being written into the record as a government's silence.",
    origin:
      "generalised 2026-08-28 from the Novus walk, where eight windows returned zero and the number was worth nothing until the same code read thirty rows over a wider window. It is the retrieval-side twin of RULING 100.",
    effort: {
      repeats: "ONCE",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "One extra query per hunt. It is the cheapest thing in this file and the only one that decides whether the rest of it means anything.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 30,
      outcome: "YIELDED",
      note:
        "Applied on 2026-08-28: it turned eight uninterpretable zeros into one measured boundary, and it refused five invalid controls rather than counting them.",
    },
  },
];

runLearnBatch(STORE, ROUTES, today());
