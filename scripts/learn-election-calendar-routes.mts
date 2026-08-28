/**
 * `pnpm method:learn-election-calendar` — THE ROUTE THAT ANSWERS "IS THIS
 * CONTEST ON THE BALLOT YET?" WITHOUT A RECORDS REQUEST.
 * (2026-08-27. **RULING 100**, **RULING 184**.)
 *
 * One route, and its value is that it converts an expensive human blocker into
 * a cheap dated recheck. NH244 had a public-records request as its named next
 * step. Reading the county election authority's own upcoming-elections page
 * showed why that request would have failed: the document does not exist yet,
 * and the authority says so on the page.
 *
 * Idempotent: `learnRoute` refuses a duplicate id.
 */

import { join } from "node:path";

import { runLearnBatch, type LearnedRoute } from "../lib/method/learn-batch.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "method", "knowledge.json");

const ROUTES: LearnedRoute[] = [
  {
    id: "county-upcoming-elections-page-as-a-document-inventory",
    title:
      "the county election authority's upcoming-elections page, read as an INVENTORY of which election's documents exist yet — the cheap answer to whether a contest can be known at all",
    tier: "A1",
    fields: ["contest", "candidacy", "election"],
    note:
      "THE SHAPE IS GENERAL AND IT ANSWERS A DIFFERENT QUESTION FROM THE ONE IT LOOKS LIKE. An election authority's upcoming-elections page is usually read for DATES. Read instead as an inventory of WHICH DOCUMENTS IT HAS PUBLISHED PER ELECTION, it answers whether a contest question is answerable at all today — before any adapter, request or fetch of a document is designed. Pima County on 2026-08-27 is the worked example: for the July 21 primary it publishes nine documents including the Official Candidate List, the Write-In List and the Proposition Text; for the November 3 GENERAL it publishes exactly ONE, the vote-center locations spreadsheet, beside its own sentence 'Additional information will be added as it is available'. So a question about a general-election contest has no available source, and that is a fact about the CALENDAR rather than about our retrieval. WHY IT MATTERS MORE THAN IT SOUNDS: the alternative route on the tracker row was a public-records request, which would have been answered 'not yet available' at real cost in time and in a person's attention. A one-page read replaced a human blocker with a dated recheck against a named publisher and a named expected document. THE ANTI-PATTERN THIS FORBIDS: the absence of a contest from a PRIMARY candidate list is not evidence about a GENERAL ballot, because an office with no primary is not on a primary ballot at all. Check that the primary list carries nonpartisan candidates at all before reading anything into a nonpartisan office's absence from it — Pima's does, four separate runs of them, which is the control that makes its silence interpretable.",
    origin:
      "conceived 2026-08-27 while working NH244, which asks whether a Central Arizona Water Conservation District contest is on the 2026 Pima County general ballot. The prior session had established that the four expiring Pima terms do NOT imply four contests (A.R.S. 16-410 permits cancelling uncontested Title 48 elections) and had named a records request as the remaining route. The county's own page shows the deciding document is simply not published yet.",
    effort: {
      repeats: "PER_COUNTY",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "One robots read, one sitemap read, one page read. Repeats per county because each election authority publishes its own inventory; the READING is generic.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 0,
      outcome: "ZERO",
      note:
        "ZERO and argued, never an absence claim: the route was walked successfully and established that the general-election candidate list does not exist yet. RECHECK_DUE against www.pima.gov/810/Upcoming-Elections-and-Events. Two primary PDFs were read in full (2 pages/1,528 chars and 9 pages/7,991 chars) with zero water-district hits, which is the EXPECTED result for a general-election-only office and settles nothing on its own.",
    },
  },
];

runLearnBatch(STORE, ROUTES, today());
