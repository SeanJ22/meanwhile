/**
 * `pnpm method:learn-exec-actions` — THE OFFICEHOLDER-ACTION ROUTE.
 * (AZ03, 2026-08-28. **RULING 178**, **RULING 148**.)
 *
 * ## The lead was a reader's question, and that is the whole shape
 *
 * The grounded Ask pipeline was asked *"What did Katie Hobbs do for the state
 * of Arizona in the last 12 months?"* against the real corpus and answered
 * honestly that it holds who she IS and nothing about what she has DONE. That
 * honest gap located the hunt. Reader demand → detective lead → governed corpus
 * → Ask can answer: the flywheel, working in the direction it was built for.
 *
 * ## What was found
 *
 * An executive's OWN office publishes its orders as a paginated index of detail
 * pages, each carrying the designation, the title, the DATE and the full
 * operative text, with the signed PDF beside it. That is a governmental action
 * record with a primary document behind it — not a press summary, and nothing
 * inferred from one.
 *
 * ## And what was NOT found, which matters as much
 *
 * The other half of a governor's record — bills signed and vetoed — is
 * published through the legislature's application at `apps.azleg.gov`, which
 * answers `User-agent: * / Disallow: /`. There is no permitted route through it
 * and none was attempted. That is a PERMISSION wall rather than a retrieval
 * failure: no amount of effort resolves it, varying the client to defeat a rule
 * is circumvention rather than hunting, and RULING 148 says a disallow is never
 * re-walked on a clock.
 *
 * Idempotent: `learnRoute` refuses a duplicate id, so a re-run cannot inflate
 * the method version or deepen a route's evidence.
 */

import { join } from "node:path";

import { runLearnBatch, type LearnedRoute } from "../lib/method/learn-batch.ts";
import { today } from "./doc-dates.mjs";

const STORE = join(process.cwd(), "data", "method", "knowledge.json");

const ROUTES: LearnedRoute[] = [
  {
    id: "executive-office-publishes-its-own-orders-with-dates-and-signed-pdfs",
    title:
      "an executive's OWN office as the primary source for what they have DONE — a paginated order index whose detail pages carry the date and the signed document",
    tier: "A1",
    fields: ["officeholder"],
    note:
      "THE RECORD CLASS A CORPUS OF OFFICEHOLDERS USUALLY LACKS. Rosters answer who someone IS; almost nothing answers what they have DONE, and a question about an official's year is unanswerable without it. WHAT WORKS: the office's own site publishes /executive-orders as a paginated index, and each entry links a detail page carrying the designation ('Executive Order 2026-02'), the office's own title for it, the DATE on the line immediately after the designation, the full operative text, and a signed PDF at a predictable path (/sites/default/files/executive-order-<n>.pdf). Walked on azgovernor.gov 2026-08-28: 37 orders indexed across 4 index pages, 12 detail pages read, and 12 of 12 carried BOTH a date and a signed PDF. THE DATE IS THE POINT AND IT IS READ POSITIONALLY AND THEN VALIDATED: 'in the last 12 months' is a window, an order with no date can be placed neither inside nor outside it, and a positional read that is not shape-checked produces a WRONG date the first time the template moves rather than a null. PERMISSION: robots.txt allows every content path with Crawl-delay 10, and the delay is honoured — a public body asking for ten seconds gets ten seconds. THE PORTABILITY CLAIM IS DELIBERATELY NARROW: this is one office on one Drupal template. What travels is the QUESTION — does this officeholder's own office publish its actions with dates and documents? — and that is worth asking of every executive before any third-party aggregator, because the office's own publication is the primary source and an aggregator is a copy of it.",
    origin:
      "opened 2026-08-28 by the grounded Ask pipeline answering a reader's question about a governor's year with an honest gap. AZ03 recorded that gap; this is the route that closes half of it.",
    effort: {
      repeats: "PER_STATE",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "One index walk plus one fetch per order, at whatever crawl delay the host asks for. The expensive part is not the retrieval; it is establishing that the office publishes at all, which is one page.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 12,
      outcome: "YIELDED",
      note:
        "12 executive orders with dates and signed PDFs, 6 of them inside the trailing 12 months. Committed to data/states/az/officials/az-governor-actions.json with its denominator.",
    },
  },
  {
    id: "the-other-half-of-an-executive-record-is-behind-a-legislature-disallow",
    title:
      "bills signed and vetoed — published by the LEGISLATURE rather than the executive, and behind a blanket robots disallow",
    tier: "B",
    fields: ["officeholder"],
    note:
      "A GOVERNOR'S RECORD HAS TWO HALVES AND THEY HAVE DIFFERENT PUBLISHERS. Executive orders come from the executive's own office and are readable. Bills signed and vetoed are legislative history, and in Arizona they live in the legislature's bill-status application at apps.azleg.gov, whose robots.txt is 29 bytes: 'User-agent: * / Disallow: /'. Read 2026-08-28. That is a PERMISSION verdict and not a wall — no client variation changes it, and varying the client to defeat a published rule is circumvention rather than hunting (RULING 148: a disallow is never re-walked on a clock). WHAT REMAINS ELIGIBLE: www.azleg.gov is ALLOWED with Crawl-delay 120 and named disallows (/DocumentsForBill.asp, /FormatDocument.asp, /ExecutiveNominationsByNominee.asp, /search/), so the legacy site is a live branch that was NOT walked here and is recorded so the next session starts from the permission rather than from a guess. The other eligible branches are the executive office's own announcements of bill action, the Secretary of State's chaptered-laws publication, and a public-records request. THE CONSEQUENCE FOR ANY ANSWER BUILT ON THE HALF WE HAVE: it must NAME the missing half. Six executive orders presented without saying vetoes are absent reads as a complete account of a governor's year, which is an absence asserted by omission.",
    origin:
      "read 2026-08-28 while closing the other half of AZ03. The permission document was read before an adapter was designed, which is the order the Vail agenda hunt established after NH229 proposed building one for a host that turned out to disallow it.",
    effort: {
      repeats: "PER_STATE",
      execution: "MACHINE",
      discovery: "REAPPLIED_KNOWN_METHOD",
      note:
        "One robots.txt fetch per legislature host. Cheap to establish and the expensive mistake is skipping it and building an adapter first.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 0,
      outcome: "BLOCKED",
      note:
        "apps.azleg.gov disallows all automated clients by published rule. Bills signed and vetoed have no permitted route there and the gap is NAMED in every answer built on the executive orders alone.",
    },
  },
];

runLearnBatch(STORE, ROUTES, today());
