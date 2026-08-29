/**
 * **THE PIMA CASE, CLASSIFIED — THE WORKED EXAMPLE, END TO END.** (2026-08-28.)
 *
 * On 2026-08-28 a session investigating a reader report about Pima County's
 * Board of Supervisors did four things, three of which were right:
 *
 *   A. it used a real route — read the per-source denominators before opening
 *      the adapter, then re-ask the primary source by hand;
 *   B. it measured correctly — `webapi.legistar.com/v1/pima/events` returned
 *      seven events over 2026-08-01 to 2026-11-01, newest 2026-08-25, against a
 *      snapshot recording fetched 16, normalized 16, three placeless drops
 *      accounted;
 *   C. it then called that reconciliation COMPLETE FOR THE WINDOW;
 *   D. and inferred from the silence that Pima publishes its September sittings
 *      only as a recurring rule.
 *
 * C was wrong and D was false. All three September sittings were individually
 * published on the county's own Legistar InSite portal at that moment, one of
 * them a 1:00 PM Study Session that could not have been derived from the rule
 * text, which gives study sessions no time at all.
 *
 * **A and B were never wrong and are not touched by this amendment.** That is
 * the entire point. Before claim classes there was nowhere to put that
 * distinction: the route, the measurement, the coverage claim and the
 * conclusion about a government lived in one prose field at one authority, so
 * correcting the false part meant rewriting the paragraph and hoping a later
 * reader noticed which half had moved.
 *
 * ## What this amendment does, and does not do
 *
 * It attaches twelve claims across the four routes the case produced, withdraws
 * the two that were false, and leaves every route present, unretired and
 * inheriting exactly as before. It adds no route, so it bumps no method
 * version. It deletes nothing.
 *
 * The two dependents of the withdrawn coverage claim are dispositioned by the
 * two different paths that exist, both of them real here:
 *
 *   - `#pima-september-only-as-rule` is itself WITHDRAWN — the conclusion built
 *     on the false coverage claim was false too;
 *   - `#reconciliation-answers-loss-not-sufficiency` is REVALIDATED — it rests
 *     on the withdrawn claim as its EVIDENCE, which is a different relationship
 *     entirely: the lesson survives the thing it was learned from being wrong,
 *     and it says so on the record rather than by nobody asking.
 */

import type { ClaimAmendment } from "./amend.ts";
import type { ClaimProvenance, MethodClaim } from "./claims.ts";

/** The date every stamp in this file came from. `pnpm stamp`, 2026-08-28. */
const ON = "2026-08-28";

const RECONCILE = "reconcile-the-adapter-before-suspecting-it";
const SCHEDULE = "body-publishes-its-schedule-separately-from-its-agendas";
const UI_VS_API = "vendor-api-and-vendor-web-ui-are-different-records";
const NOT_COMPLETE = "reconciled-is-not-complete";

function provenance(
  artifact: string,
  observedVia: string,
  over: Partial<ClaimProvenance> = {},
): ClaimProvenance {
  return {
    artifact,
    observedVia,
    disposition: "YIELDED",
    jurisdictions: ["az"],
    vendors: ["legistar"],
    observedOn: ON,
    ...over,
  };
}

const RECONCILE_CLAIMS: MethodClaim[] = [
  {
    id: `${RECONCILE}#route-exists`,
    class: "ROUTE_EXISTENCE",
    statement:
      "Reading a source's own fetched / normalized / dropped-by-reason counters before opening the adapter, then re-asking the primary source the same query by hand over the same window, is an available route for deciding whether a 'missing rows' report is about the pipeline or about the publisher.",
    restsOn: [],
  },
  {
    id: `${RECONCILE}#pima-denominators-reconciled`,
    class: "ROUTE_OUTCOME",
    statement:
      "Walked in az on 2026-08-28: the snapshot recorded fetched 16, normalized 16, three placeless drops accounted, and webapi.legistar.com/v1/pima/events over 2026-08-01 to 2026-11-01 returned seven events, newest 2026-08-25 — so nothing was lost between that source and the screen.",
    restsOn: [RECONCILE],
  },
  {
    id: `${RECONCILE}#pima-window-complete`,
    class: "COVERAGE_CLAIM",
    statement:
      "That reconciliation established the Pima County meeting record as COMPLETE for 2026-08-01 to 2026-11-01.",
    restsOn: [`${RECONCILE}#pima-denominators-reconciled`],
    provenance: provenance(
      "https://webapi.legistar.com/v1/pima/events over 2026-08-01 to 2026-11-01, read beside the ingestion snapshot's per-source counters for the same run",
      RECONCILE,
    ),
    validation: {
      state: "CONTRADICTED",
      on: ON,
      by: UI_VS_API,
      note:
        "Contradicted the same day by driving the tenant's own Calendar.aspx date-range filter, which returned three individually published sittings inside the same window.",
    },
  },
];

const SCHEDULE_CLAIMS: MethodClaim[] = [
  {
    id: `${SCHEDULE}#route-exists`,
    class: "ROUTE_EXISTENCE",
    statement:
      "When a vendor calendar runs dry a fortnight out, the body's OWN site is a separate record on a different publication clock, and a meeting-schedule page is usually in its sitemap under a name containing 'Schedule' or 'Calendar'.",
    restsOn: [],
  },
  {
    id: `${SCHEDULE}#pima-recurring-rule-published`,
    class: "ROUTE_OUTCOME",
    statement:
      "Walked in az on 2026-08-28: www.pima.gov/2599/Board-of-Supervisors-Agenda-Schedule publishes the Board's recurring rule — 2nd and 4th Tuesdays, 5 p.m., Administration Building, 130 W. Congress St.",
    restsOn: [SCHEDULE],
  },
  {
    id: `${SCHEDULE}#pima-september-only-as-rule`,
    class: "DERIVED_CONCLUSION",
    statement:
      "Pima County's September 2026 sittings exist only as that recurring rule and are not individually published anywhere.",
    restsOn: [`${RECONCILE}#pima-window-complete`, `${SCHEDULE}#pima-recurring-rule-published`],
    provenance: provenance(
      "https://www.pima.gov/2599/Board-of-Supervisors-Agenda-Schedule, read beside the /events window that returned no September sitting",
      SCHEDULE,
      { vendors: [] },
    ),
    validation: {
      state: "CONTRADICTED",
      on: ON,
      by: `${UI_VS_API}#pima-september-individually-published`,
      note:
        "Three individually published September sittings were recovered from the county's own Legistar InSite portal on the same day.",
    },
  },
];

const UI_VS_API_CLAIMS: MethodClaim[] = [
  {
    id: `${UI_VS_API}#route-exists`,
    class: "ROUTE_EXISTENCE",
    statement:
      "A vendor's public API and the vendor's own public web UI are two different records of the same body's calendar; driving the UI's date-range filter is an available route when the API's forward horizon runs dry.",
    restsOn: [],
  },
  {
    id: `${UI_VS_API}#three-tenant-ui-vs-api`,
    class: "ROUTE_OUTCOME",
    statement:
      "Walked in az on 2026-08-28 across three Legistar tenants on one 'Next Month' filter: Mesa 15 grid rows with 12 marked meeting_NotViewable and /events returning exactly the other 3; Phoenix 8 rows, 8 not viewable, 0 returned; Pima 3 rows, 3 not viewable, 0 returned — 26 future sittings visible in the UI and invisible to the API.",
    restsOn: [UI_VS_API],
  },
  {
    id: `${UI_VS_API}#legistar-events-omits-non-viewable`,
    class: "COVERAGE_CLAIM",
    statement:
      "webapi.legistar.com/v1/{client}/events is an INCOMPLETE view of a tenant's calendar: it returns only sittings whose InSite meeting-detail page is publicly viewable, the omitted events have no WebAPI record at all (40 of 40 probed ids 404 on the item endpoint), and the two routes number their meetings in disjoint id spaces.",
    restsOn: [`${UI_VS_API}#three-tenant-ui-vs-api`],
    provenance: provenance(
      "https://pima.legistar.com/Calendar.aspx (and the Mesa and Phoenix tenants) 'Next Month' filter, compared row by row against webapi.legistar.com/v1/{client}/events over the same window, plus 40 item-endpoint probes",
      UI_VS_API,
    ),
    validation: {
      state: "VALIDATED",
      on: ON,
      by: "three independent tenants measured on one filter, with the id-space disjunction and the 404 probes as the mechanism",
      note:
        "An incompleteness claim, which is the safe direction: it says this route returns less than the calendar holds, never that any calendar is complete.",
    },
  },
  {
    id: `${UI_VS_API}#pima-september-individually-published`,
    class: "DERIVED_CONCLUSION",
    statement:
      "Pima County individually published all three of its September 2026 sittings — 2026-09-08 1:00 PM Study Session, 2026-09-08 5:00 PM and 2026-09-22 5:00 PM, all in the Board of Supervisors' Hearing Room — on its own Legistar InSite portal, with the 22 September sitting published on 2026-06-15, 74 days ahead.",
    restsOn: [`${UI_VS_API}#three-tenant-ui-vs-api`, `${UI_VS_API}#legistar-events-omits-non-viewable`],
    provenance: provenance(
      "https://pima.legistar.com/Calendar.aspx date-range postback over September 2026, with the InSite calendar RSS pubDate giving the 74-day lead time on the 22 September sitting",
      UI_VS_API,
    ),
    validation: {
      state: "VALIDATED",
      on: ON,
      by: "the portal's own rows, each carrying a date, a time, a room and a meeting kind",
      note:
        "The 1:00 PM Study Session is the control: the recurrence rule gives study sessions no time at all, so this row cannot have been synthesised from the rule and can only have been read off a published record.",
    },
  },
];

const NOT_COMPLETE_CLAIMS: MethodClaim[] = [
  {
    id: `${NOT_COMPLETE}#route-exists`,
    class: "ROUTE_EXISTENCE",
    statement:
      "Asking a second independent route the same question, before the word 'complete' may be written about the first route's answer, is an available and cheap step — the vendor's own web UI for a vendor-backed body, the sitemap for a body's own site.",
    restsOn: [],
  },
  {
    id: `${NOT_COMPLETE}#reconciliation-answers-loss-not-sufficiency`,
    class: "COVERAGE_CLAIM",
    statement:
      "A reconciled denominator establishes only that nothing was LOST between one source and the screen. It never establishes that enough was ASKED FOR, so a reconciled count licenses 'this route returned N and nothing was lost' and never 'there are N'.",
    restsOn: [
      `${UI_VS_API}#pima-september-individually-published`,
      `${RECONCILE}#pima-window-complete`,
    ],
    provenance: provenance(
      "the Pima correction of 2026-08-28: a snapshot recording fetched 16 / normalized 16 / three drops accounted, set beside three sittings the same window held and that route could not return",
      NOT_COMPLETE,
    ),
    validation: {
      state: "REVALIDATED_AFTER_UPSTREAM_RETRACTION",
      on: ON,
      by: `${UI_VS_API}#pima-september-individually-published`,
      note:
        "This claim RESTS ON a withdrawn claim as its evidence, which is the opposite of depending on it being true: the lesson exists because that claim was false, and it is stronger, not weaker, for the withdrawal. Recorded explicitly so the dependency flag is dispositioned on the record rather than by nobody asking.",
    },
  },
];

/**
 * The amendment, ready to apply. Idempotent: attaching a claim id the route
 * already carries is a no-op, and retracting an already-withdrawn claim is a
 * no-op.
 */
export const PIMA_CLAIM_CLASSES: ClaimAmendment = {
  name: "classify the Pima case, and withdraw the coverage claim and the conclusion that were false",
  attach: [
    { routeId: RECONCILE, claims: RECONCILE_CLAIMS },
    { routeId: SCHEDULE, claims: SCHEDULE_CLAIMS },
    { routeId: UI_VS_API, claims: UI_VS_API_CLAIMS },
    { routeId: NOT_COMPLETE, claims: NOT_COMPLETE_CLAIMS },
  ],
  retract: [
    {
      claimId: `${RECONCILE}#pima-window-complete`,
      retraction: {
        kind: "SUPERSEDED",
        on: ON,
        why:
          "The reconciliation was real and the measurement was right; the word 'complete' was not licensed by either. Reconciling proves nothing was DROPPED between a source and the screen. It never proves enough was ASKED FOR, and three published Pima sittings were inside the same window and outside that route's reach.",
        supersededBy: `${NOT_COMPLETE}#reconciliation-answers-loss-not-sufficiency`,
        survives:
          "THE ROUTE AND ITS OUTCOME, BOTH INTACT AND BOTH STILL USABLE. Reading the per-source denominators before opening the adapter is still the right first move and still exonerated the pipeline by observation rather than by inspection, and the seven events over the window are still exactly what that endpoint returned. What is withdrawn is one word about what that answer established.",
      },
    },
    {
      claimId: `${SCHEDULE}#pima-september-only-as-rule`,
      retraction: {
        kind: "CORRECTED",
        on: ON,
        why:
          "False. All three September sittings were individually published on Pima County's own Legistar InSite portal at the time this was recorded, with a date, a time, a room and a meeting kind, and the 2026-09-08 1:00 PM Study Session could not have been derived from the rule text, which gives study sessions no time at all. This was a claim about what a government publishes, made from one route's silence.",
        supersededBy: `${UI_VS_API}#pima-september-individually-published`,
        survives:
          "THE ROUTE, AND THE PUBLISHING-PRACTICE OBSERVATION UNDER IT. A body's schedule and its agendas really are different records on different publication clocks, Vail Unified remains the control that makes it practice rather than a defect, and asking the body's own site is still worth doing. What is withdrawn is the conclusion that the body's own site was the ONLY place those sittings existed — the diagnostic was too narrow, because the vendor's own web UI is a third record again.",
      },
    },
  ],
};
