/**
 * `pnpm method:learn-az-seethemoney` — **THE ZERO-ROW ANSWER WAS A MISSING
 * PARAMETER, AND THE CHECK THAT REFUTED THE HYPOTHESIS COULD NOT HAVE PASSED.**
 * (Session C2, 2026-08-31. RULING 100, RULING 205, RULING 206, RULING 207.)
 *
 * Three routes, and the second is the one worth a later session's attention
 * because it is a way of being wrong rather than a way of being blocked.
 *
 * NEVER `pnpm method:ingest`: it used to rebuild the store from the legacy
 * manifest and silently shrink it from 88 routes to 62 while reporting success.
 * `learnRoute` refuses a duplicate id, so this is idempotent.
 */

import { join } from "node:path";

import { runLearnBatch, type LearnedRoute } from "../lib/method/learn-batch.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "method", "knowledge.json");

const ROUTES: LearnedRoute[] = [
  {
    id: "zero-rows-with-a-well-formed-envelope-is-a-missing-parameter",
    title:
      "an endpoint answering HTTP 200 with a valid envelope and recordsTotal 0 is reporting our request, not the government's records",
    tier: "A0",
    fields: ["filing", "document", "source"],
    note:
      "THE MISTAKE THIS PREVENTS IS READING A WELL-FORMED EMPTY ANSWER AS AN ABSENCE. RULING 100's warning is usually described against a MALFORMED reply — seethemoney.az.gov returns a two-byte empty string for a bad DataTables body, which is obviously wrong on sight. The dangerous case is the WELL-FORMED one: /Reporting/GetNEWDetailedTableData answers HTTP 200 with a complete DataTables envelope, draw and recordsFiltered present, and recordsTotal 0. Nothing about it looks like a failure, and a session that recorded it as 'this committee has no transactions' would have written a false fact about a government. MEASURED 2026-08-31: the endpoint needs BOTH the page's own Name=1~<id> form AND a separate entityId=<id> query parameter. With Name alone it returns the well-formed zero; with entityId it returns the committee's itemised ledger — 229 income transactions for entity 102162. THE PROCEDURE: when an endpoint returns a well-formed zero for a subject you have independent reason to believe exists, do not record the zero. Enumerate every identifier-shaped parameter the application's own code sets — GetParameters() in the bundle here builds Name, OfficeID, PartyID, transactionDispositionID AND entityId — and send them all before concluding. A parameter the SPA sets from a variable rather than from the URL hash is the one a hash-replay will miss.",
    origin:
      "walked 2026-08-31 (Session C2). The prior record named the itemised ledger as the one source that could settle Arizona's row semantics and reported it as returning nothing. It was returning nothing because our request was short one parameter.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "One read of the app's own parameter builder, then an eight-variant sweep of identifier parameters. Minutes, and it unblocked a fact class that had been recorded as unreachable across two sessions.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 58,
      outcome: "YIELDED",
      note:
        "58 Arizona committees' itemised income and expense ledgers read and aggregated, which is what licensed data/funding/state-money-az-2026.json. Aggregates only: the itemised rows carry contributor name, occupation and employer (RULING 167) and were never persisted.",
    },
    claims: [
      {
        id: "zero-rows-with-a-well-formed-envelope-is-a-missing-parameter#exists",
        class: "ROUTE_EXISTENCE",
        statement:
          "Enumerating every identifier-shaped parameter an SPA's own parameter builder sets — not only those it writes into the URL hash — is a route that can turn a well-formed zero-row answer into data.",
        restsOn: ["datatables-endpoint-needs-its-column-array#exists"],
      },
      {
        id: "zero-rows-with-a-well-formed-envelope-is-a-missing-parameter#az-outcome",
        class: "ROUTE_OUTCOME",
        statement:
          "On 2026-08-31 adding entityId=<id> alongside Name=1~<id> turned GetNEWDetailedTableData from recordsTotal 0 into Arizona's itemised transaction ledger.",
        restsOn: ["zero-rows-with-a-well-formed-envelope-is-a-missing-parameter#exists"],
      },
    ],
  },
  {
    id: "a-refuted-hypothesis-may-have-been-tested-against-the-wrong-quantity",
    title:
      "before accepting a refutation, check that the two quantities compared were commensurable at all",
    tier: "A0",
    fields: ["filing", "source"],
    note:
      "THE MISTAKE THIS PREVENTS IS TREATING A POPULATION-SCALE REFUTATION AS SETTLED WHEN THE TEST ITSELF WAS INVALID. Session C tested whether SeeTheMoney's several per-candidate rows are PARTS by checking sum(Income) - sum(Expense) == CashBalance across 255 entities. It held for 134 and broke for 121, including for single-row entities where there is nothing to sum, and the session correctly refused to ship. That refusal was right; the CONCLUSION drawn from it — that the row semantics were unknown — was an artifact of the test. MEASURED 2026-08-31: CashBalance is repeated IDENTICALLY on every row of an entity (94 of 94 multi-row entities) and does not move when the query window moves, because it carries a balance brought forward from before the cycle. A within-window SUM and an across-window BALANCE are different quantities, so the identity could never have held generally, and the 134 that agreed were the committees that happened to start from zero. Against a COMMENSURABLE quantity — the publisher's own itemised transaction ledger for the same window — sum(summary Income) == sum(itemised income) HOLDS FOR 255 OF 255 AND BREAKS FOR 0, and likewise for expense. THE PROCEDURE: when a hypothesis is refuted over a population, before recording the fact as unknown, ask whether the two sides of the comparison are scoped to the SAME window, the SAME grouping and the SAME units. A field that is constant across the rows you are summing is entity-level and cannot validate a row-level sum. Then find a quantity that IS commensurable and re-test over the same population.",
    origin:
      "walked 2026-08-31 (Session C2), re-opening a conclusion the previous session had recorded with an honest 134/121 measurement. The measurement was real; what it measured was not the question.",
    effort: {
      repeats: "PER_STATE",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "One pass over 255 entities' itemised ledgers, paced. The comparison itself is arithmetic; the cost is entirely in reading the second representation.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 255,
      outcome: "YIELDED",
      note:
        "255 of 255 entities reconciled exactly on both income and expense against the publisher's own itemised ledger; 0 broke. The same population on which the CashBalance identity held for 133 and broke for 122. That is what turned Arizona from OWED to PUBLISHED.",
    },
    claims: [
      {
        id: "a-refuted-hypothesis-may-have-been-tested-against-the-wrong-quantity#exists",
        class: "ROUTE_EXISTENCE",
        statement:
          "Re-examining whether a refuted hypothesis's two sides were commensurable — same window, same grouping, same units — is a route that can reopen a fact class recorded as undetermined.",
        restsOn: ["zero-rows-with-a-well-formed-envelope-is-a-missing-parameter#exists"],
      },
      {
        id: "a-refuted-hypothesis-may-have-been-tested-against-the-wrong-quantity#az-outcome",
        class: "ROUTE_OUTCOME",
        statement:
          "On 2026-08-31 it established that Arizona's per-office summary rows are parts whose sum is the cycle total, verified over 255 of 255 entities against the itemised ledger.",
        restsOn: ["a-refuted-hypothesis-may-have-been-tested-against-the-wrong-quantity#exists"],
      },
    ],
  },
  {
    id: "a-portals-default-filter-is-not-its-universe",
    title:
      "a publisher-declared recordsTotal is complete for the QUERY, and a default filter can hide most of the register",
    tier: "A0",
    fields: ["filing", "source", "roster"],
    note:
      "THE MISTAKE THIS PREVENTS IS TREATING 'N of N rows the publisher itself declares' AS THE SOURCE UNIVERSE. It is the strongest-sounding completeness claim available — the publisher's own count — and it is scoped to the filters that were sent. MEASURED 2026-08-31 on seethemoney.az.gov /Reporting/GetNEWTableData at JurisdictionId=0 for 2025-2026: the DEFAULT view (IsLessActive=false, ShowOfficeHolder=false) declares 370 rows in 255 entities; IsLessActive=true declares 844 rows in 716 entities — 461 entities the default never shows; ShowOfficeHolder=true declares a further DISJOINT 16, so it REPLACES rather than widens. The union is 860 rows in 732 entities. A pilot-ballot candidate sitting behind either flag, asked for with the defaults, comes back as nothing, and recording that as 'no reports on file' is an absence manufactured by our own query. CONCRETELY: Kevin Volk, a candidate for Arizona State Representative District 17 on the 85701 and 85641 ballot with $173,742.29 raised, is NOT in the default 370. THE PROCEDURE: enumerate every boolean and enum filter the search UI exposes, request the CROSS PRODUCT rather than the defaults, and record each query's declared total separately so a later reader can see which one a coverage claim was scoped to. A filter that returns FEWER rows when enabled is replacing the set, not widening it, and must be unioned rather than substituted.",
    origin:
      "walked 2026-08-31 (Session C2) while building the Arizona snapshot, and re-checked against a parallel lane's staged acquisition of the same endpoint, which had recorded the default view's 370 as complete:true.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "Three requests instead of one. The cost is trivial and the failure it prevents is a false absence on a named candidate's card.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 732,
      outcome: "YIELDED",
      note:
        "732 entities in the union against 255 in the default view — 2.9x. One of the 45 committees published on the Arizona pilot ballot sits outside the default set entirely.",
    },
    claims: [
      {
        id: "a-portals-default-filter-is-not-its-universe#exists",
        class: "ROUTE_EXISTENCE",
        statement:
          "Requesting the cross product of a search UI's own filter flags, and unioning the results, is a route that can enlarge a set a publisher-declared total presented as complete.",
        restsOn: ["datatables-endpoint-needs-its-column-array#exists"],
      },
      {
        id: "a-portals-default-filter-is-not-its-universe#az-outcome",
        class: "ROUTE_OUTCOME",
        statement:
          "On 2026-08-31 the union of three filter settings returned 732 Arizona committee entities where the default view declared 255 complete.",
        restsOn: ["a-portals-default-filter-is-not-its-universe#exists"],
      },
    ],
  },
];

runLearnBatch(STORE, ROUTES, today());
