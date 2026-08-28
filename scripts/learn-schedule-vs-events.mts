/**
 * `pnpm method:learn-schedule-vs-events` — WHAT THE PIMA "MISSING MEETINGS"
 * REPORT ACTUALLY WAS. (2026-08-28. **RULING 100**, **RULING 184**.)
 *
 * ## The report, and why it looked like a pipeline defect
 *
 * The 2026-08-28 reader walkthrough said the Pima County Board of Supervisors
 * was missing its recent and upcoming meetings, and named September 8 and
 * September 22, 2026 as sittings the product did not show. The obvious
 * suspicion — and the one the session brief carried — was that rows were being
 * lost somewhere between the Legistar API and the reader.
 *
 * ## The denominators say otherwise, and they reconcile exactly
 *
 * ```
 * legistar   fetched 16   normalized 16   drops: placeless 3, unknownVenue 0,
 *                                                unplaceableInTime 0
 * ```
 *
 * Nothing is lost. And the primary source agrees: `webapi.legistar.com/v1/pima`
 * queried directly over 2026-08-01 to 2026-11-01 returns SEVEN events, the
 * newest 2026-08-25, and NOT ONE in September. The forward horizon is 60 days,
 * so September was inside the window the whole time. The adapter asked, the
 * tenant answered, and the answer had no September in it.
 *
 * ## Where the September sittings actually are
 *
 * On the county's own site, published as a RULE rather than as events:
 *
 * > Meetings Beginning at 5 p.m. 2nd and 4th Tuesdays of the month. Study
 * > Sessions held the 2nd Tuesday of the month before the regular meeting.
 * > Pima County Administration Building, 130 W. Congress St. 1st Floor,
 * > Board of Supervisors Hearing Room.
 * > — www.pima.gov/2599/Board-of-Supervisors-Agenda-Schedule, read 2026-08-28
 *
 * September 2026's 2nd and 4th Tuesdays are the 8th and the 22nd. The reader
 * was right about the dates and right that the product did not show them, and
 * there is no defect in the pipeline that carries them.
 *
 * ## The lesson, which is the reusable part
 *
 * **A VENDOR TENANT IS ONE ROUTE, AND A BODY'S SCHEDULE IS A DIFFERENT RECORD
 * FROM ITS AGENDAS.** Many bodies post individual agendas to their vendor only
 * a week or two ahead, while publishing the recurring rule on their own site
 * months ahead. A hunt that only ever asks the vendor sees a calendar that
 * stops dead a fortnight out and cannot tell that from a body that has stopped
 * meeting.
 *
 * Vail Unified is the control that makes this a property of PUBLISHING PRACTICE
 * rather than of our code: the same snapshot, the same pipeline, the same day —
 * and Vail's source publishes individual future sittings, so Vail's September 8
 * and September 22 render while Pima's do not.
 *
 * ## What this does NOT license, and it is the important half
 *
 * It does not license synthesising meetings from the rule. A recurring schedule
 * is a statement of intent that cancellations, holidays and special sessions
 * override, and rendering a computed date as a published sitting would be a
 * render default manufacturing a claim — which `CLAUDE.md` forbids outright.
 *
 * What it licenses is the honest sentence: we hold the body's published meeting
 * SCHEDULE and not yet its September agendas, and the gap is THEIRS — not yet
 * posted — rather than ours. Which of those two records a surface shows, and in
 * what words, is a product decision and is carried as one.
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
    id: "body-publishes-its-schedule-separately-from-its-agendas",
    title:
      "a body whose vendor holds only the next fortnight while its own site publishes the recurring rule months ahead",
    tier: "A0",
    fields: ["meeting"],
    note:
      "THE SHAPE, AND IT IS A PUBLISHING PRACTICE RATHER THAN A DEFECT. Pima County's Legistar tenant answered a 2026-08-01 to 2026-11-01 query with seven events, newest 2026-08-25 and none in September, from an adapter whose forward horizon is 60 days and whose denominators reconcile exactly (fetched 16, normalized 16, three placeless drops accounted). The September sittings are real and are published on the county's own site as a RULE — 'Meetings Beginning at 5 p.m. 2nd and 4th Tuesdays of the month', with the room and street address — at www.pima.gov/2599/Board-of-Supervisors-Agenda-Schedule. THE DIAGNOSTIC: when a tenant's calendar stops a fortnight out, ask the body's OWN site for a meeting-schedule page before concluding anything about the body; the two records have different publication clocks and a vendor calendar running dry is not a body that has stopped meeting. THE CONTROL that makes this practice rather than code: Vail Unified, same snapshot and same pipeline on the same day, DOES publish individual future sittings and its September 8 and September 22 render. WHAT IT DOES NOT LICENSE: computing meetings from the rule. Cancellations, holidays and special sessions override a recurring schedule, and rendering a computed date as a published sitting is a render default manufacturing a claim. The rule is a different RECORD, honestly describable as one.",
    origin:
      "found 2026-08-28 investigating a reader report that the Pima County Board of Supervisors was missing its upcoming meetings. The report named September 8 and September 22 and was right about both; the suspicion that rows were being dropped was wrong, and the denominators said so before the primary source confirmed it.",
    effort: {
      repeats: "PER_COUNTY",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "One sitemap read and one page fetch per body. The schedule page is nearly always in the sitemap under a name containing 'Schedule' or 'Calendar'.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 1,
      outcome: "YIELDED",
      note:
        "Pima County's own published meeting rule read from www.pima.gov on 2026-08-28: 2nd and 4th Tuesdays, 5 p.m., Administration Building, 130 W. Congress St. Legistar over the same window holds seven events, newest 2026-08-25.",
    },
  },
  {
    id: "reconcile-the-adapter-before-suspecting-it",
    title:
      "the denominator read that decides whether a 'missing rows' report is about the pipeline or about the publisher",
    tier: "A1",
    fields: ["meeting", "agenda", "roster"],
    note:
      "A READER SAYING 'THE MEETINGS ARE MISSING' IS A CLAIM ABOUT A SURFACE, AND IT HAS TWO COMPLETELY DIFFERENT CAUSES THAT LOOK IDENTICAL. Either rows are being lost between the source and the screen, or the source never had them. THE CHEAP DISCRIMINATOR RUNS FIRST AND IS ALREADY WRITTEN DOWN: the snapshot records fetched, normalized and drops-by-reason per source. If fetched equals normalized and the drops are accounted, no row was lost and the pipeline is not the suspect — which is a strictly stronger statement than 'the code looks right'. THEN ASK THE PRIMARY SOURCE THE SAME QUESTION THE ADAPTER ASKED, by hand, over the same window: if the API returns what the snapshot holds, the adapter is exonerated by observation rather than by inspection. Only then is the question about the publisher, and only then is it worth hunting other routes. Doing this in the other order costs a session: it is possible to read an adapter for an hour and learn nothing that one query would have settled. NOTE THE TRAP IN THE OTHER DIRECTION TOO — a reconciled denominator that is missing required source records is still a wrong result (RULING 100). Reconciling proves nothing was DROPPED; it never proves enough was ASKED FOR.",
    origin:
      "generalised 2026-08-28 from the Pima investigation, where the session brief carried a specific suspicion of downstream row loss and the snapshot's own counters refuted it in one read, before a single line of the adapter was opened.",
    effort: {
      repeats: "ONCE",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "Two reads: the snapshot's per-source counters, then one hand query against the primary API over the adapter's own window.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 7,
      outcome: "YIELDED",
      note:
        "webapi.legistar.com/v1/pima/events over 2026-08-01 to 2026-11-01 returned 7 events, newest 2026-08-25, confirming the snapshot's 16-fetched-16-normalized as complete for the window rather than truncated.",
    },
  },
];

runLearnBatch(STORE, ROUTES, today());
