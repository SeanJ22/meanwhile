/**
 * The discovery methods the 2026-09-24 Pima data-center miss produced, written
 * through the one governed path (RULING 252).
 *
 * A reader asked whether Pima County was voting on data centers. The product
 * answered from a September 8 snapshot; news reported the Board's September 22
 * approval. Two methods resolved it, and both are portable knowledge, measured
 * where they were reused:
 *
 * 1. A Legistar tenant's public Web API event items carry the clerk's recorded
 *    action, pass flag and motion text for each agenda item: the body's own
 *    outcome record, available the day after the sitting. Reused on Mesa the
 *    same night, it yielded nothing: that tenant's clerk records no action on
 *    the event items. Portability is per tenant, and is measured, not assumed.
 * 2. A news report is a lead; the body's own record is the proof. The reader's
 *    exact question typed into a search engine found five outlets reporting a
 *    3-2 approval; the county's Legistar record confirmed it item by item.
 */
import { join } from "node:path";

import { runLearnBatch, type LearnedRoute } from "../../lib/method/learn-batch.ts";
import { today } from "../doc-dates.mjs";

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "method", "knowledge.json");

const ROUTES: LearnedRoute[] = [
  {
    id: "legistar-webapi-eventitems-carry-the-recorded-action",
    title:
      "a Legistar tenant's public Web API event items carry the clerk's recorded action, pass flag and motion text per agenda item — the body's own outcome record — when that tenant's clerk records them",
    tier: "A0",
    fields: ["meeting", "outcome", "vote"],
    note:
      "GET https://webapi.legistar.com/v1/<tenant>/events?$filter=EventDate eq datetime'<date>' then " +
      "/events/<EventId>/eventitems?AgendaNote=1&MinutesNote=1: EventItemActionName, EventItemPassedFlagName, " +
      "EventItemMover/Seconder and EventItemActionText (the tally) are the clerk's recorded disposition, and " +
      "EventItemMatterStatus names the matter's state. Pima County, 2026-09-24: event 1828 (Board of Supervisors, " +
      "2026-09-22), item 331773, agenda 18, File ID 20801, Resolution 2026-56 'Moratorium on Data Center Development': " +
      "action 'approve as amended', Pass, 'approved as amended with 2 conditions 3-2, Supervisors Christy and Scott " +
      "voted nay', matter status Approved, last modified 2026-09-23T22:56Z while the minutes stayed 'Draft' (Draft is " +
      "Pima's steady state, not a signal). Reuse measured the same night on Mesa (webapi.legistar.com/v1/mesa): the " +
      "API answers, but 0 of 33 items on the 2026-09-14 City Council sitting carry an action or pass flag; that clerk " +
      "records outcomes elsewhere. The route is per tenant: walk it, count the acted items, never assume it. " +
      "Wired for Pima as the routine contract pima-legistar-outcomes (lib/civic-data/contracts.ts).",
    origin:
      "the owner's 2026-09-24 brief after Ask told a reader 'we have no record of what the Board decided' about a " +
      "moratorium the Board had approved two days earlier.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "REAPPLIED_KNOWN_METHOD",
      note: "One events query per window plus one event-items query per changed sitting; no key, no model.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 1,
      outcome: "YIELDED",
      note: "Pima Board of Supervisors 2026-09-22 item 18 recorded action found; Mesa City Council 2026-09-14 reuse: 0 of 33 items acted (ZERO for that tenant).",
    },
    claims: [
      {
        id: "legistar-webapi-eventitems-carry-the-recorded-action#exists",
        class: "ROUTE_EXISTENCE",
        statement: "Legistar's public Web API exposes per-item recorded action, pass flag and motion text on /events/<id>/eventitems.",
        restsOn: [],
      },
      {
        id: "legistar-webapi-eventitems-carry-the-recorded-action#pima-outcome",
        class: "ROUTE_OUTCOME",
        statement: "On 2026-09-24 Pima County's event 1828 item 331773 (Resolution 2026-56) read 'approve as amended', Pass, 3-2.",
        restsOn: ["legistar-webapi-eventitems-carry-the-recorded-action#exists"],
      },
      {
        id: "legistar-webapi-eventitems-carry-the-recorded-action#mesa-outcome",
        class: "ROUTE_OUTCOME",
        statement: "On 2026-09-24 Mesa's event 4491 (City Council, 2026-09-14) returned 33 items and none carried an action or pass flag.",
        restsOn: ["legistar-webapi-eventitems-carry-the-recorded-action#exists"],
      },
    ],
  },
  {
    id: "news-is-a-lead-the-bodys-own-record-is-the-proof",
    title:
      "type the reader's exact question into a search engine, treat every news result as a lead, and confirm the outcome item by item in the body's own record before any sentence states it",
    tier: "C",
    fields: ["outcome", "meeting"],
    note:
      "Query typed verbatim on 2026-09-24: 'is pima county voting on data centers'. Leads: AZ Luminaria (2026-09-23), " +
      "KJZZ (2026-09-23), AZPM (2026-09-23), Tucson Sentinel (2026-09-22) and the Arizona Daily Star all reported a " +
      "3-2 approval of a 120-day moratorium, amended before passage. A search engine's own summary misdated the " +
      "meeting to Wednesday the 23rd; the articles said Tuesday. Proof came from the county's own Legistar record " +
      "(see legistar-webapi-eventitems-carry-the-recorded-action). A news report never becomes the answer: it is the " +
      "reason to look, and the reader is told what the official record says.",
    origin: "the owner's 2026-09-24 brief: independently search the same question and compare with the product's answer.",
    effort: {
      repeats: "ONCE",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note: "Two searches, four articles opened, one official Web API read.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 1,
      outcome: "YIELDED",
      note: "The approval the news reported was confirmed in the county's own record the same night.",
    },
    claims: [
      {
        id: "news-is-a-lead-the-bodys-own-record-is-the-proof#exists",
        class: "ROUTE_EXISTENCE",
        statement: "A verbatim reader question returns news leads that name the sitting and the item to confirm in the body's own record.",
        restsOn: [],
      },
      {
        id: "news-is-a-lead-the-bodys-own-record-is-the-proof#pima-outcome",
        class: "ROUTE_OUTCOME",
        statement: "On 2026-09-24 five news reports of a 3-2 approval were confirmed by Pima County's Legistar record for event 1828, item 18.",
        restsOn: ["news-is-a-lead-the-bodys-own-record-is-the-proof#exists"],
      },
    ],
  },
];

runLearnBatch(STORE, ROUTES, today());
