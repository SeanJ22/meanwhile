/**
 * `pnpm method:learn-governor-letters` — THE VETO RECORD, MEASURED.
 * (2026-08-28. **RULING 182**, **RULING 184**.)
 *
 * The route `sibling-host-is-a-different-permission-decision` established that
 * `www.azleg.gov` is permitted and named `/governors-letters/` as a candidate.
 * This is what walking it actually returned, so the record moves from
 * IDENTIFIED to MEASURED.
 *
 * ## The legislature's own description of the record
 *
 * > Governor's Letters include the official letters that are sent from the
 * > Governor to the Legislature on a specific bill and usually include a brief
 * > explanation as to why the Governor has vetoed or signed the bill.
 *
 * That is the signed-and-vetoed record, described by the body that publishes
 * it, on a permitted host, in the open.
 *
 * ## What is there
 *
 * **151 letters** for the 57th Legislature, 2nd Regular Session — 83 House
 * bills and 68 Senate bills — each its own PDF under a scheme that needs no
 * search, no form and no session token:
 *
 * ```
 * https://www.azleg.gov/govlettr/<leg>/<session>/<billno>.pdf
 * https://www.azleg.gov/govlettr/57leg/2r/hb2003.pdf
 * ```
 *
 * `/govlettr/` appears nowhere in the host's disallow list. The PDFs are
 * born-digital, so rung 9 reads them with the text layer already in the
 * repository.
 *
 * ## Why this matters beyond Arizona
 *
 * The corpus recorded this whole fact class as unreachable because ONE HOST —
 * the interactive bill-status application — disallows automation. The record
 * was never in that application. It is a directory of PDFs on the
 * legislature's own publication site, and finding it cost two robots.txt reads
 * and a link extraction from a 404 page.
 *
 * **The generalisation is that a signed or vetoed bill produces a TRANSMITTAL
 * DOCUMENT, and a transmittal document has to be published somewhere the other
 * branch can read it.** A legislature that receives the governor's letters
 * publishes the governor's letters. When the executive's own site is thin or
 * the bill-status app is walled, ask the RECEIVING body for the same act.
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
    id: "governor-transmittal-letters-published-by-the-receiving-chamber",
    title:
      "signed and vetoed bills read from the letters the governor sends the legislature, rather than from the walled bill-status app",
    tier: "A0",
    fields: ["document", "vote", "officeholder"],
    note:
      "MEASURED 2026-08-28 ON www.azleg.gov/governors-letters/, WHICH IS PERMITTED. The page describes itself: 'Governor's Letters include the official letters that are sent from the Governor to the Legislature on a specific bill and usually include a brief explanation as to why the Governor has vetoed or signed the bill.' It links 151 letters for the 57th Legislature 2nd Regular Session — 83 HB and 68 SB — each a separate born-digital PDF at https://www.azleg.gov/govlettr/<leg>/<session>/<billno>.pdf, e.g. /govlettr/57leg/2r/hb2003.pdf. No search, no form, no session token, and /govlettr/ appears nowhere in the host's disallow list. THE GENERAL SHAPE, WHICH IS THE PORTABLE PART: a signed or vetoed bill produces a TRANSMITTAL DOCUMENT, and a transmittal document must be published somewhere the other branch can read it. So when an executive's own site is thin or the bill-status application is walled, ASK THE RECEIVING BODY FOR THE SAME ACT — a legislature that receives the governor's letters publishes them. The same reasoning reaches session laws, journals and enrolled-bill lists, all of which are records of one act held by more than one government. WHAT THIS CORRECTS: the corpus recorded this entire fact class as unreachable on the strength of one host's disallow, and the record was never in that host.",
    origin:
      "walked 2026-08-28, honouring the host's Crawl-delay of 120 seconds, after sibling-host-is-a-different-permission-decision identified the route and read-the-navigation-off-the-404-page found its current address.",
    effort: {
      repeats: "PER_STATE",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "One index read per session, then one PDF per bill. The crawl-delay dominates: 151 letters at 120 seconds apart is about five hours for a full session, so an ingest has to be paced and resumable rather than run in one pass.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 151,
      outcome: "YIELDED",
      note:
        "151 Governor's Letter PDFs enumerated for 57leg/2r with a predictable per-bill URL scheme. The letters themselves are not yet ingested; what is measured is that they exist, are permitted, are individually addressable and state whether the bill was signed or vetoed.",
    },
  },
];

runLearnBatch(STORE, ROUTES, today());
