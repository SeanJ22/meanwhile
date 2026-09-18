/**
 * Triage derivation for the fleet page (BUILD.md §B bands, §C red cards).
 *
 * Server-only and PURE. The two RED findings and the band counts are derived
 * from the read, never authored — a band that says 2 while the page shows 3 red
 * cards is worse than no band. The red findings are the two reporting defects
 * that make the rest of the page untrustworthy (WIRING.md §1, §2); each is
 * detected from the research state, and its verdict names the denominator
 * BEFORE the number.
 */

import { RESEARCH_MILESTONES } from "@/lib/control-plane/research-progression.ts";
import type { ResearchState } from "@/lib/control-plane/scheduler/research-policy.ts";
import { FLEET_MAP_PANELS } from "@/lib/admin/fleet-map-meta.ts";

export interface RedFinding {
  readonly n: number;
  readonly kind: string;
  readonly affected: string;
  readonly verdict: string;
  readonly explanation: string;
  readonly rows: readonly { readonly label: string; readonly value: string }[];
  readonly inference: string;
}

/** The two reporting defects, each only when the read actually shows it. */
export function fleetRedFindings(state: ResearchState | null): readonly RedFinding[] {
  if (!state) return [];
  const out: RedFinding[] = [];
  const q = state.queue;
  const due = q.modelClassDue + q.deterministicDue;
  const scheduled = q.modelClassDispatchedThisCycle + q.deterministicDispatchedThisCycle;
  const deferralsAccounted = q.modelClassDeferredForBudget === undefined
    ? 0
    : q.modelClassDeferredForBudget + q.modelClassDeferredForCycleMax + q.modelClassDeferredForCeiling + q.modelClassDeferredForLane;
  const unaccounted = due - scheduled - deferralsAccounted;
  // Finding 1: deterministic non-dispatch has no deferral accounting, so a row
  // of counters cannot explain the units that went nowhere.
  if (q.deterministicDue > 0 && unaccounted > 0) {
    out.push({
      n: 1,
      kind: "Nothing accounts for it",
      affected: "Due this cycle · why work waits",
      verdict: `${due} units were due. ${scheduled} started. ${deferralsAccounted === 0 ? "All four “why work waits” counters read zero." : `The four deferral counters explain only ${deferralsAccounted}.`}`,
      explanation:
        "Every deferral counter covers the model-class lane, but “due” sums model-class and deterministic. Deterministic non-dispatch has no deferral accounting at all, so the counters do not account for the units that went nowhere. This is by construction, not a runner fault.",
      rows: [
        { label: "Due this cycle", value: `${due} (${q.modelClassDue} model-class, ${q.deterministicDue} deterministic)` },
        { label: "Scheduled", value: `${scheduled}` },
        { label: "Deferred — accounted (model-class only)", value: `${deferralsAccounted}` },
        { label: "Deterministic units", value: `${q.deterministicDue} due, ${q.deterministicDispatchedThisCycle} dispatched, no per-reason accounting` },
      ],
      inference: `${unaccounted} units are unexplained by the counters — not because something is broken, but because the accounting does not cover their lane.`,
    });
  }
  // Finding 2: six stage counts describe the registered investigations only, a
  // small slice of the fleet, but read as fleet-wide.
  const progress = state.researchProgression;
  if (progress) {
    const obligations = progress.scope.obligations;
    const excluded = progress.scope.excludedUnclassifiedWorkItems;
    const total = obligations + excluded;
    const stages = RESEARCH_MILESTONES.filter((s) => s !== "discovered");
    const stageRows = stages.map((s) => ({ label: s, value: `${progress.milestones[s].newlyReached} / ${obligations}` }));
    const allZero = stages.every((s) => progress.milestones[s].newlyReached === 0);
    if (total > 0 && obligations < total) {
      out.push({
        n: 2,
        kind: "Wrong denominator",
        affected: "Stage advancement",
        verdict: `${stages.length} stage counts describe ${obligations} of ${total} items${allZero ? ", and every one reads zero" : ""}.`,
        explanation:
          "The stage counts are advancement over the registered investigations, not the fleet. The scope statement that says so is the last clause of the sentence, after the numbers it qualifies, so the counts read as fleet-wide when they cover a fraction of a percent.",
        rows: [...stageRows, { label: "Excluded, unclassified", value: `${excluded} work items not in this report` }],
        inference: `The denominator is ${obligations}, not ${total}. ${excluded} work items are not classified in this report at all.`,
      });
    }
  }
  return out;
}

export interface FleetBandCounts {
  readonly red: number;
  readonly amber: number;
  readonly green: number;
  readonly dashed: number;
}

/**
 * The four band counts, all derived. `amber` is the whole decision queue.
 * `green` counts the measured readings that ANSWERED in the cheap common read
 * (receipts, spend, coverage); the lane reading lives on the work tab and is
 * not counted here, so this never claims a reading it did not make. `dashed` is
 * the NO_PRODUCER panels.
 */
export function fleetBandCounts(input: {
  readonly state: ResearchState | null;
  readonly decisionCount: number;
  readonly measuredAnswered: number;
}): FleetBandCounts {
  return {
    red: fleetRedFindings(input.state).length,
    amber: input.decisionCount,
    green: input.measuredAnswered,
    dashed: FLEET_MAP_PANELS.filter((p) => p.producer === "NO_PRODUCER").length,
  };
}
