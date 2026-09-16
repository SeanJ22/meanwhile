import { HEARTBEAT_LATE_MINUTES, type HealthLevel } from "./owner-surface.ts";
import { RESEARCH_MILESTONES } from "./research-progression.ts";
import type { ResearchState } from "./scheduler/research-policy.ts";

/** A heartbeat proves process liveness. This projection asks whether work advanced. */
export interface ResearchProgressHealth {
  readonly state: "STALLED" | "WORKING" | "WAITING" | "PAUSED" | "DISABLED" | "STALE" | "UNKNOWN";
  readonly level: HealthLevel;
  readonly detail: string;
  readonly asOf: string | null;
  readonly dispatch: string;
  readonly deferrals: string;
  readonly advancement: string;
  readonly acquisition: string;
  readonly publication: string;
  readonly spend: string;
  readonly window: { readonly since: string; readonly through: string } | null;
}

/** Uses the already-held singleton state; no history scan or new database query. */
export function researchProgressHealth(state: ResearchState | null, nowIso: string): ResearchProgressHealth {
  const missing: ResearchProgressHealth = {
    state: "UNKNOWN", level: "UNKNOWN", detail: "Research progress has not been read.", asOf: null,
    dispatch: "No dispatch reading.", deferrals: "No deferral reading.", advancement: "No stage-advancement reading.",
    acquisition: "No research acquisition reading.", publication: "No research publication reading.",
    spend: "Research model spending is not measured.", window: null,
  };
  if (!state) return missing;
  const q = state.queue;
  if (![q.modelClassDue, q.deterministicDue, q.modelClassDispatchedThisCycle, q.deterministicDispatchedThisCycle]
    .every((count) => Number.isSafeInteger(count) && count >= 0)) {
    return { ...missing, detail: "The research state contains invalid dispatch counts; progress cannot be determined." };
  }
  const due = q.modelClassDue + q.deterministicDue;
  const scheduled = q.modelClassDispatchedThisCycle + q.deterministicDispatchedThisCycle;
  const downstream = q.autonomousDispatchedThisCycle;
  const dispatched = scheduled + (downstream ?? 0);
  const history = state.metrics?.share.window;
  const progress = state.researchProgression;
  const completed = progress?.activity.completedResults.reduce((n, row) => n + row.count, 0) ?? 0;
  const age = Date.parse(nowIso) - Date.parse(state.beatAt);
  const fresh = Number.isFinite(age) && age >= 0 && age < HEARTBEAT_LATE_MINUTES * 60_000;
  let reading: Pick<ResearchProgressHealth, "state" | "level" | "detail">;
  if (!fresh) {
    reading = { state: "STALE", level: "AMBER", detail: "The research observation is too old or has an invalid clock; current progress is unknown." };
  } else if (state.pausedByOwner) {
    reading = { state: "PAUSED", level: "AMBER", detail: "Research is paused by the owner. Due work remains owed." };
  } else if (dispatched > 0 || state.running.length > 0) {
    reading = { state: "WORKING", level: "AMBER", detail: "Workers started in this cycle. Stage advancement and publication are measured separately below." };
  } else if (!state.modelLaneEnabled && q.modelClassDue > 0) {
    reading = { state: "DISABLED", level: "AMBER", detail: state.modelLaneDisabledReason ?? "The model lane is disabled while model work is due." };
  } else if (due > 0 && history && history.cycles >= 3 && history.model + history.deterministic === 0 && completed === 0) {
    reading = {
      state: "STALLED", level: "RED",
      detail: `${history.cycles} recorded cycles started no scheduled workers while ${due} route units are due now. ${progress ? "No completed downstream results appear in the latest research window." : "Downstream completion evidence was not read."} Process liveness does not establish progress.`,
    };
  } else {
    reading = {
      state: "WAITING", level: "AMBER",
      detail: due > 0 ? "Work is due, but no worker started in this cycle. Check dispatch deferrals before treating this as healthy."
        : "No scheduled route unit is due in this observation. This does not certify completed records or publication.",
    };
  }
  const advanced = progress ? RESEARCH_MILESTONES.filter((stage) => stage !== "discovered")
    .map((stage) => `${stage}: ${progress.milestones[stage].newlyReached}`).join("; ") : null;
  const knownUsd = state.spend.windowUsd;
  const unknownCosts = state.spend.unmeasuredAttempts;
  const spend = knownUsd === null || !Number.isFinite(knownUsd) || knownUsd < 0
    ? `Research model spending is unknown; ${unknownCosts} unmeasured cost entries in the rolling window.`
    : `$${knownUsd.toFixed(2)} measured research model spending across ${state.spend.measuredAttempts} cost entries in the trailing ${state.bounds.windowHours} hours${unknownCosts > 0 ? `; ${unknownCosts} additional entries have unknown cost, so this is a partial total` : ""}. Routine fetch activity is accounted for separately.`;
  return {
    ...reading, asOf: state.beatAt,
    dispatch: `${scheduled} scheduled dispatches from ${due} due route units (${q.modelClassDue} model-class, ${q.deterministicDue} deterministic) this cycle; ${downstream === undefined ? "downstream dispatch count was not recorded" : `${downstream} downstream dispatches`}.`,
    deferrals: q.modelClassDeferredForBudget === undefined ? "Wall-time deferrals were not recorded separately by this runner version."
      : `Model-class deferrals (of ${q.modelClassDue} due): ${q.modelClassDeferredForBudget} by execution budget; ${q.modelClassDeferredForCycleMax} by dispatch-count limit; ${q.modelClassDeferredForCeiling} by model-spend ceiling; ${q.modelClassDeferredForLane} by lane state. Deterministic units (${q.deterministicDue} due, ${q.deterministicDispatchedThisCycle} dispatched) do not have per-reason deferral accounting.`,
    advancement: progress ? `${completed} completed role results across ${progress.activity.obligationsWorked} worked investigations. Newly reached stages, counted as distinct investigations per stage: ${advanced}. Scope: ${progress.scope.obligations} registered investigations; ${progress.scope.excludedUnclassifiedWorkItems} other work items are not classified in this report.` : missing.advancement,
    acquisition: progress ? `${progress.milestones.acquired.newlyReached} investigations first reached acquisition in this window; ${progress.activity.newEvidenceArtifacts} new evidence artifacts. These are research results, separate from routine source refreshes.` : missing.acquisition,
    publication: progress ? `${progress.readerVisible.count === null ? "Unknown number of" : progress.readerVisible.count} reader-visible research records in this window. ${progress.readerVisible.reason}` : missing.publication,
    spend, window: progress ? { since: progress.since, through: progress.through } : null,
  };
}
