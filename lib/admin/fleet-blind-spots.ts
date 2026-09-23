/**
 * The nine things the fleet page cannot see or do (WIRING.md), as data so the
 * blind-spots tab (BUILD.md §G) can render them and derive its badge count from
 * the array length. Closing a finding is deleting one entry; the card count
 * cannot then drift from the truth. Each brief is paste-ready into Claude Code
 * or Codex as it stands. Severity: red for the two reporting defects and the
 * cannot-answer-a-decision finding, amber for the rest, dashed for the one that
 * is presentation only.
 */

export type BlindSpotSeverity = "red" | "amber" | "dashed";

export interface BlindSpot {
  readonly n: number;
  readonly severity: BlindSpotSeverity;
  readonly title: string;
  readonly summary: string;
  readonly paths: readonly string[];
  readonly brief: string;
}

export const FLEET_BLIND_SPOTS: readonly BlindSpot[] = [
  {
    n: 1, severity: "red", title: "Deferral counters cover one lane out of two",
    summary:
      "Every deferral counter is model-class, but “due” sums model-class and deterministic. Deterministic non-dispatch has no deferral accounting, so a row of zeros does not account for the undispatched units — by construction.",
    paths: ["lib/control-plane/research-progress-health.ts", "components/admin/research-progress.tsx"],
    brief:
      "Fleet operations: the 'Why work waits' row prints four deferral counters (modelClassDeferredForBudget, ForCycleMax, ForCeiling, ForLane) in lib/control-plane/research-progress-health.ts, but 'due' sums modelClassDue + deterministicDue. Deterministic non-dispatch therefore has no deferral accounting and the four zeros do not account for the undispatched units. Either add deterministicDeferredFor* counters to ResearchState.queue, or scope the sentence to model-class units so the zeros stop reading as fleet-wide.",
  },
  {
    n: 2, severity: "red", title: "Stage zeros print without their denominator",
    summary:
      "Six stage counts describe the registered investigations, a fraction of a percent of the fleet, but the scope statement that says so is the last clause of the sentence — after the numbers it invalidates.",
    paths: ["lib/control-plane/research-progress-health.ts", "components/admin/research-progress.tsx"],
    brief:
      "Fleet operations: researchProgressHealth's advancement string lists six stage counts and then states the scope as its final clause, so the zeros read as fleet-wide when they describe a fraction of the fleet. Render each stage count as N / scope.obligations, and put excludedUnclassifiedWorkItems in front of the numbers rather than after them.",
  },
  {
    n: 3, severity: "amber", title: "Two clocks on one page, neither labelled",
    summary:
      "The page renders the research progress clock and the fleet read clock as one moment, tens of minutes apart, with nothing saying they are different clocks measuring different things.",
    paths: ["app/(admin)/admin/fleet/page.tsx"],
    brief:
      "Fleet operations: the page renders ResearchProgress from progressState (read via readFleetSafety) and the operations map from report.observedAt (the read time), with no label saying they are different clocks. Label each timestamp with what it measures, and surface the gap when it exceeds the heartbeat-late threshold from lib/control-plane/owner-surface.ts.",
  },
  {
    n: 4, severity: "amber", title: "The read's age is an ISO string, and nothing re-reads",
    summary:
      "The page prints observedAt verbatim and never re-reads, while the sibling control centre refreshes every 45 seconds — setting an expectation this page silently breaks. An hour-old read looks identical to a live one.",
    paths: ["components/admin/fleet-operations-map.tsx"],
    brief:
      "Fleet operations: the map prints observedAt verbatim and there is no auto re-read on this surface (correctly — it is not the heartbeat). Show the age in human terms ('read 34 minutes ago') next to the Refresh control, and state that nothing re-reads it, so an operator cannot mistake an hour-old read for live.",
  },
  {
    n: 5, severity: "amber", title: "Decisions are answered on Fleet · Now, not here",
    summary:
      "This page counts what needs you; the decisions themselves are answered on Fleet · Now, which carries each card's options, what each one does, your own words, and the receipt. The count here does not link there yet.",
    paths: ["components/admin/fleet-operations-map.tsx", "app/(admin)/_mw/next-steps.tsx", "app/api/admin/action/route.ts"],
    brief:
      "Fleet operations: link the 'Needs you' count to Fleet · Now (/admin), where app/(admin)/_mw/next-steps.tsx answers each decision through decision.record at the admin action gateway. Do not mount a second decision queue here — one control, one place (Admin redesign, 2026-09-23).",
  },
  {
    n: 6, severity: "amber", title: "The projection drops nine of the card's eleven fields",
    summary:
      "OwnerDecisionCard publishes eleven fields; the page renders rowId and title, so it cannot group by priority, sort by age, or show a single option. §6b (blockedDescendants) is separate backend work with a schema question in front of it.",
    paths: ["lib/control-plane/owner-surface.ts", "components/admin/fleet-operations-map.tsx"],
    brief:
      "Fleet operations: OwnerDecisionCard publishes rowId, title, whatIsNeeded, whyNoMachineCanDecide, options[]{option,consequence}, blockedDescendants, openedOn, ageDays, priority, verifiability and blocker. The page renders rowId and title only. Render the fields already on the object and group by priority rather than by rowId prefix. Do NOT try to make blockedDescendants work as part of this — it is null on every card and has no producer; render the literal 'not measured' and file the separate §6b ticket.",
  },
  {
    n: 7, severity: "amber", title: "The decision store is project-wide; the page is not",
    summary:
      "report.ownerDecisions holds the whole project's decision store, so the fleet page's queue shows business, legal, commercial and design decisions unrelated to fleet work. The exclusion rule is stated only in the empty state.",
    paths: ["components/admin/fleet-operations-map.tsx"],
    brief:
      "Fleet operations: report.ownerDecisions holds the whole project's decision store, so the fleet page's 'Needs you' shows cards unrelated to fleet work (rowId prefixes B, T, C, V, X, PB, NS, OWN). Either scope this list to cards that reference a work item, or state the exclusion rule on the list itself — today it appears only in the empty state, the one case nobody needs it.",
  },
  {
    n: 8, severity: "amber", title: "2 665 rows ship to the browser, sorted by hex id",
    summary:
      "All operations are held client-side and paginated in workItemId order — a hexadecimal identifier, so an arbitrary order for a human. The single failing item is findable only by clicking the lane filter; lastActivity.at is never sorted on.",
    paths: ["components/admin/fleet-operations-map.tsx", "GET /api/admin/fleet/operations"],
    brief:
      "Fleet operations: the map holds all operations client-side and paginates in ascending workItemId order, which is a hexadecimal identifier and so arbitrary for a human. Add server-side sort and filter: default sort on lastActivity.at ascending (oldest owed first), a subject-substring search, and a record-class facet derived from the subject prefix. The single failing item is currently findable only by clicking the lane filter.",
  },
  {
    n: 9, severity: "dashed", title: "Empty panels sit at the weight of measured ones",
    summary:
      "FLEET_MAP_PANELS renders all six panels into one grid; the three with no producer differ from the wired ones only by a badge, so the page's honesty is legible only on inspection. Presentation only.",
    paths: ["lib/admin/fleet-map-meta.ts", "components/admin/fleet-operations-map.tsx"],
    brief:
      "Fleet operations: FLEET_MAP_PANELS renders all six panels into one grid, so the three NO_PRODUCER panels carry the same card weight as the wired ones and differ only by a badge. Split the grid into a 'reads something' group and a 'no producer' group with a dashed rim, so the page's honesty is legible at a glance.",
  },
] as const;

/** The recommended order of work, closing the tab (BUILD.md §G). */
export const FLEET_BLIND_SPOT_ORDER =
  "Recommended order: §5 and §6a first (the cheapest, and the only two that let you act), then §1 and §2 (what makes the rest readable), then §3, §4 and §7, then §8 and §9 (presentation, once the reads underneath are honest). §6b is the one backend item and has a schema question in front of it.";
