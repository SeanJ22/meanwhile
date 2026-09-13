import { readDecisions, readSnapshot, unreachable, type ReadOutcome } from "./admin-data.ts";
import { isExpired } from "./attempt.ts";
import { sumMetric, type MeasuredTotal } from "./cost.ts";
import { latestDecisionFor } from "./decision-log.ts";
import { PULSE_STALE_MS } from "./live-pulse.ts";
import { decisionCardKind, type OwnerDecisionCard, type OwnerSnapshot } from "./owner-surface.ts";
import { deriveItemState, stageCounts } from "./promotion/pipeline.ts";
import type { PipelineItemState, VerificationCheck } from "./promotion/types.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";
import type { RouteTask } from "./route-task.ts";
import { readAutonomousActivity, type AutonomousActivityEvent, type AutonomousObligationActivity } from "./workers/activity.ts";
import { workerTaskAdmission, type WorkerTaskAdmission } from "./workers/scheduling.ts";

export const FLEET_OPERATIONS_VERSION = "fleet-operations/v1";

export interface FleetTaskOperation {
  readonly taskId: string;
  readonly path: "WORKER_COMPUTATION" | "ROUTE_DISPOSITION";
  readonly state: RouteTask["state"];
  /** Only worker computations use workerTaskAdmission; Scout admission has a different policy. */
  readonly admission: WorkerTaskAdmission | null;
  readonly blocker: string | null;
  readonly nextAutomaticAction: "LEASE_RECONCILIATION" | "ADMISSION_CHECK" | "POLICY_RECHECK" | "WAIT_FOR_BACKOFF" | "UNKNOWN" | "NONE_FOR_THIS_TASK";
  readonly retryAt: string | null;
  readonly lease: "ACTIVE" | "EXPIRED" | "NOT_RECORDED";
}

export interface FleetOperation {
  readonly workItemId: string;
  readonly subject: string;
  readonly path: "AUTONOMOUS_PLAN" | "REGISTERED_WORKER_TASKS" | "OTHER_REGISTERED_WORK";
  /** Canonical WorkItem state; a completed computation never completes its parent here. */
  readonly stage: AutonomousObligationActivity["workItem"]["state"];
  readonly lastProgress: AutonomousActivityEvent | null;
  readonly lastActivity: AutonomousActivityEvent | null;
  readonly tasks: readonly FleetTaskOperation[];
  readonly sourceHealth: {
    /** Historical recorded observations, not a current reachability or permission grant. */
    readonly observations: readonly NonNullable<AutonomousActivityEvent["walk"]>[];
    readonly lastAcquired: { readonly resultId: string; readonly at: string; readonly artifactIds: readonly string[] } | null;
    readonly latestAcquisition: { readonly resultId: string; readonly at: string; readonly verdict: string } | null;
    readonly evidenceGaps: readonly string[];
  };
  readonly publication: {
    readonly status: "UNKNOWN";
    readonly reason: "PER_RECORD_PROMOTION_AND_SERVED_READER_PROOF_NOT_JOINED";
    readonly recordedStages: readonly { readonly recordId: string; readonly itemId: string; readonly stage: string; readonly at: string }[];
    /** Existing pipeline derivation, explicitly a recorded chain, not replayed certification. */
    readonly recordedItems: readonly (Pick<PipelineItemState, "itemId" | "stage" | "refused" | "refusals"> & {
      readonly pendingChecks: readonly VerificationCheck[];
    })[];
    readonly recordedItemStageCounts: ReturnType<typeof stageCounts>;
  };
  readonly spending: { readonly usd: MeasuredTotal; readonly costEntryCount: number; readonly attemptsWithoutCostEntry: readonly string[] };
}

export interface FleetOperationsReport {
  readonly formatVersion: typeof FLEET_OPERATIONS_VERSION;
  /** Query observation time supplied by the caller. Not an atomic historical snapshot or a source freshness clock. */
  readonly observedAt: string;
  readonly deliveryFreshness: "FRESH" | "STALE" | "UNKNOWN";
  readonly operations: ReadOutcome<readonly FleetOperation[]>;
  /** Existing ZIP reader-instrument output, unchanged; it is not the ZIP completion denominator. */
  readonly coverageGaps: ReadOutcome<{ readonly publishedAt: string; readonly zipRows: OwnerSnapshot["zipRows"] }>;
  /** Existing machine-blocker and acknowledgement cards are excluded from owner decisions. */
  readonly ownerDecisions: ReadOutcome<{ readonly publishedAt: string; readonly cards: readonly OwnerDecisionCard[] }>;
}

function taskOperation(task: RouteTask, activity: AutonomousObligationActivity, observedAt: string): FleetTaskOperation {
  const leases = activity.facts.leases.filter(l => l.routeTaskId === task.id && !l.released);
  const active = leases.some(l => !isExpired(l, observedAt));
  const lease = active ? "ACTIVE" : leases.length ? "EXPIRED" : "NOT_RECORDED";
  const admission = task.workerTask ? workerTaskAdmission(task, activity.facts.attempts, observedAt) : null;
  const inFlight = task.state === "CLAIMED" || admission?.state === "IN_FLIGHT";
  let nextAutomaticAction: FleetTaskOperation["nextAutomaticAction"] = "UNKNOWN";
  if (inFlight) nextAutomaticAction = "LEASE_RECONCILIATION";
  else if (admission?.state === "BACKOFF") nextAutomaticAction = "WAIT_FOR_BACKOFF";
  else if (admission?.state === "DUE") nextAutomaticAction = admission.requiresPolicyRecheck ? "POLICY_RECHECK" : "ADMISSION_CHECK";
  else if (task.state === "RESULT_RECORDED" || task.state === "DISPOSED") nextAutomaticAction = "NONE_FOR_THIS_TASK";
  return { taskId: task.id, path: task.workerTask ? "WORKER_COMPUTATION" : "ROUTE_DISPOSITION", state: task.state,
    admission, lease, nextAutomaticAction, retryAt: admission?.retryAt ?? null,
    blocker: inFlight ? active ? "LIVE_LEASE_PREVENTS_DUPLICATE_EXECUTION" : "LEASE_RECONCILIATION_REQUIRED"
      : admission && !admission.due && admission.state !== "TERMINAL" ? admission.reason : task.policyDenial?.requiredChange ?? null };
}

/** Pure projection of the existing attributed activity read. No ledger writes or scheduler invocation. */
export function projectFleetOperation(activity: AutonomousObligationActivity, observedAt: string): FleetOperation {
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error("FLEET_OPERATIONS_CLOCK_INVALID");
  const committed = new Set(activity.timeline.filter(e => e.kind === "WORKER_RESULT").map(e => e.id));
  const acquisitions = activity.facts.workers.filter(r => committed.has(r.id) && r.result.role === "ACQUIRER" &&
    r.completion.completedTask.workerTask?.purpose !== "DIAGNOSTIC_REPLAY" &&
    !activity.evidenceGaps.includes(`WORKER_WALK_ATTRIBUTION_UNPROVEN:${r.id}`))
    .sort((a, b) => a.endedAt.localeCompare(b.endedAt) || a.id.localeCompare(b.id));
  const latest = acquisitions.at(-1);
  const held = acquisitions.filter(r => r.result.role === "ACQUIRER" && r.result.verdict === "ACQUIRED" && r.result.artifacts.some(a => a.byteCount > 0)).at(-1);
  // Retry/failure activity cannot make a stalled investigation look as if its evidence advanced.
  const successfulResults = new Set(activity.facts.workers.filter(r =>
    ["ACQUIRED", "EXTRACTED", "SUPPORTED", "PASS", "SURVIVED"].includes(r.result.verdict) &&
    !activity.evidenceGaps.includes(`WORKER_WALK_ATTRIBUTION_UNPROVEN:${r.id}`) &&
    r.completion.completedTask.workerTask?.purpose !== "DIAGNOSTIC_REPLAY").map(r => r.id));
  const progressArtifacts = new Set([
    ...acquisitions.flatMap(r => r.result.role === "ACQUIRER" && r.result.verdict === "ACQUIRED" ? r.result.artifacts.map(a => a.artifactId) : []),
    ...activity.facts.dispositions.flatMap(d => d.disposition.disposition === "INGESTED" ? d.disposition.artifactIds : []),
  ]);
  const progress = activity.timeline.filter(e =>
    e.kind === "WORKER_RESULT" ? successfulResults.has(e.id) :
    e.kind === "ARTIFACT" ? progressArtifacts.has(e.id) && activity.facts.artifacts.some(a => a.artifactId === e.id && a.byteLength > 0 && !a.partial &&
      activity.facts.attempts.some(t => t.id === a.attemptId && t.outcome === "COMPLETED")) :
    e.kind === "DISPOSITION" && activity.facts.dispositions.some(d => d.attemptId === e.attemptId && d.disposition.disposition === "INGESTED"));
  const pipelineStates = [...new Set(activity.facts.promotion.map(p => p.itemId))].sort().map(itemId => {
    // The canonical pipeline replays append order; timestamps may tie or come from skewed clocks.
    const records = activity.facts.promotion.filter(p => p.itemId === itemId);
    return deriveItemState(itemId, records);
  });
  const recordedItems = pipelineStates.map(state => ({ itemId: state.itemId, stage: state.stage, refused: state.refused, refusals: state.refusals,
    pendingChecks: state.byStage.VERIFIED?.checks.filter(c => c.result !== "PASS") ?? [] }));
  const costed = new Set(activity.facts.costs.map(c => c.attemptId));
  return { workItemId: activity.workItem.id, subject: activity.workItem.subject,
    path: activity.workItem.autonomousPlan ? "AUTONOMOUS_PLAN" : activity.facts.routeTasks.some(t => t.workerTask) ? "REGISTERED_WORKER_TASKS" : "OTHER_REGISTERED_WORK",
    stage: activity.workItem.state, lastProgress: progress.at(-1) ?? null, lastActivity: activity.timeline.at(-1) ?? null,
    tasks: activity.facts.routeTasks.map(t => taskOperation(t, activity, observedAt)),
    sourceHealth: { observations: activity.timeline.flatMap(e => e.walk ? [e.walk] : []),
      lastAcquired: held && held.result.role === "ACQUIRER" ? { resultId: held.id, at: held.endedAt, artifactIds: held.result.artifacts.map(a => a.artifactId) } : null,
      latestAcquisition: latest ? { resultId: latest.id, at: latest.endedAt, verdict: latest.result.verdict } : null, evidenceGaps: activity.evidenceGaps },
    publication: { status: "UNKNOWN", reason: "PER_RECORD_PROMOTION_AND_SERVED_READER_PROOF_NOT_JOINED",
      recordedStages: activity.facts.promotion.map(p => ({ recordId: p.recordId, itemId: p.itemId, stage: p.stage, at: p.at })), recordedItems,
      recordedItemStageCounts: stageCounts(pipelineStates) },
    spending: { usd: sumMetric(activity.facts.costs, "usd"), costEntryCount: activity.facts.costs.length,
      attemptsWithoutCostEntry: activity.facts.attempts.filter(a => !costed.has(a.id)).map(a => a.id).sort() } };
}

/** Read service for Admin's authenticated server. Caller opens repos; no connection/env lookup or side effect here. */
export async function readFleetOperations(repos: ControlPlaneRepositories, input: { readonly observedAt: string }): Promise<FleetOperationsReport> {
  if (!Number.isFinite(Date.parse(input.observedAt))) throw new Error("FLEET_OPERATIONS_CLOCK_INVALID");
  const [operations, snapshot, decisions] = await Promise.all([
    readAutonomousActivity(repos, undefined, input).then(activities => ({ kind: "HELD" as const, value: activities.map(a => projectFleetOperation(a, input.observedAt)) }))
      .catch(error => unreachable<readonly FleetOperation[]>("fleet activity", error)),
    readSnapshot(repos), readDecisions(repos),
  ]);
  const coverageGaps: FleetOperationsReport["coverageGaps"] = snapshot.kind === "HELD"
    ? { kind: "HELD", value: { publishedAt: snapshot.value.publishedAt, zipRows: snapshot.value.zipRows } } : snapshot;
  const ownerDecisions: FleetOperationsReport["ownerDecisions"] = snapshot.kind !== "HELD" ? snapshot : decisions.kind !== "HELD" ? decisions
    : { kind: "HELD", value: { publishedAt: snapshot.value.publishedAt, cards: snapshot.value.decisionCards.filter(card =>
      decisionCardKind(card) === "DECISION" && card.verifiability === "NOT_MACHINE_VERIFIABLE" && card.whyNoMachineCanDecide.trim() &&
      latestDecisionFor(decisions.value, card.rowId) === null) } };
  const fullyRead = ![operations, coverageGaps, ownerDecisions].some(value => value.kind === "STORE_UNREACHABLE");
  return { formatVersion: FLEET_OPERATIONS_VERSION, observedAt: input.observedAt,
    deliveryFreshness: fleetReadFreshness(fullyRead ? input.observedAt : null, input.observedAt), operations, coverageGaps, ownerDecisions };
}

/** Delivery freshness only, using Admin's existing pulse tolerance; never certifies source data. */
export function fleetReadFreshness(lastSuccessfulReadAt: string | null, now: string): "FRESH" | "STALE" | "UNKNOWN" {
  const current = Date.parse(now), read = lastSuccessfulReadAt === null ? NaN : Date.parse(lastSuccessfulReadAt);
  if (!Number.isFinite(current) || !Number.isFinite(read) || read > current) return "UNKNOWN";
  return current - read >= PULSE_STALE_MS ? "STALE" : "FRESH";
}
