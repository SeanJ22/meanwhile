import { readFleetReceiptSnapshot } from "./fleet-receipt-snapshot.ts";
import { readDecisions, readSnapshot, unreachable, type ReadOutcome } from "./admin-data.ts";
import { isExpired } from "./attempt.ts";
import { sumMetric, type MeasuredTotal } from "./cost.ts";
import { latestDecisionFor } from "./decision-log.ts";
import { projectFleetDelivery, type FleetDeliveryReport, type FleetReceiptReadback, type PermanentAuthorityPromotion } from "./fleet-delivery.ts";
import type { FleetReceiptStore, FleetReceiptLoadReport } from "./fleet-receipt-store.ts";
import { PULSE_STALE_MS } from "./live-pulse.ts";
import { decisionCardKind, type OwnerDecisionCard, type OwnerSnapshot } from "./owner-surface.ts";
import { deriveItemState, stageCounts } from "./promotion/pipeline.ts";
import type { PipelineItemState, VerificationCheck, WindowRunRecord } from "./promotion/types.ts";
import type { PromotionReceipt } from "./promotion/historical-receipt.ts";
import type { ValidationReceipt } from "../civic-data/types.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";
import type { RouteTask } from "./route-task.ts";
import { readAutonomousActivity, type AutonomousActivityEvent, type AutonomousObligationActivity } from "./workers/activity.ts";
import { workerTaskAdmission, type WorkerTaskAdmission } from "./workers/scheduling.ts";
import { scoutTaskAdmission, type ScoutTaskAdmission } from "./workers/scout-scheduling.ts";

export const FLEET_OPERATIONS_VERSION = "fleet-operations/v1";
export const FLEET_OPERATIONS_EXTENSION_VERSION = "fleet-operations/extensions/1";
export type FleetReceiptLoading = ReadOutcome<Omit<FleetReceiptLoadReport, "receipts">>;

/** Trusted internal inputs only; the HTTP route never accepts receipt paths or caller proof. */
export interface FleetDeliveryEvidence {
  readonly windows: ReadOutcome<readonly WindowRunRecord[]>;
  readonly receipts?: readonly PromotionReceipt[];
  readonly readbacks?: readonly FleetReceiptReadback[];
  readonly receiptLoading?: FleetReceiptLoading;
  /** GOOD PDC permanent-authority publications covering these records; recognized instead of the retired approval. */
  readonly permanentAuthority?: readonly PermanentAuthorityPromotion[];
}

/**
 * Project the GOOD PDC permanent-authority publications (validated ValidationReceipt v2 promotions)
 * supplied to this read. FAIL / CANNOT_TELL receipts are NOT promotions and are dropped; a receipt
 * that is not decision GOOD never reads as a publication. Historical promoter/1 receipts arrive on a
 * separate lane (the owner-snapshot receipt transport) and are never mixed in here.
 */
export function projectPermanentAuthority(receipts: readonly ValidationReceipt[]): PermanentAuthorityPromotion[] {
  return receipts
    .filter(receipt => receipt.contractVersion === 2 && receipt.decision === "GOOD")
    .map(receipt => ({ recordClass: receipt.recordClass, scope: receipt.scope, validatedAt: receipt.validatedAt,
      candidateId: receipt.candidateId, sourceId: receipt.sourceId }));
}

export interface FleetTaskOperation {
  readonly taskId: string;
  readonly path: "WORKER_COMPUTATION" | "ROUTE_DISPOSITION";
  readonly state: RouteTask["state"];
  /** Only worker computations use workerTaskAdmission; Scout admission has a different policy. */
  readonly admission: WorkerTaskAdmission | null;
  /** Additive v1 extension: only persisted autonomous Scout families are joined. */
  readonly scoutAdmission: ScoutTaskAdmission | null;
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
    /** Served-reader proof remains unknown; inspect delivery for the narrower joined evidence. */
    readonly status: "UNKNOWN";
    readonly reason: "PER_RECORD_PROMOTION_AND_SERVED_READER_PROOF_NOT_JOINED";
    readonly recordedStages: readonly { readonly recordId: string; readonly itemId: string; readonly stage: string; readonly at: string }[];
    /** Existing pipeline derivation, explicitly a recorded chain, not replayed certification. */
    readonly recordedItems: readonly (Pick<PipelineItemState, "itemId" | "stage" | "refused" | "refusals"> & {
      readonly pendingChecks: readonly VerificationCheck[];
    })[];
    readonly recordedItemStageCounts: ReturnType<typeof stageCounts>;
    readonly delivery: ReadOutcome<FleetDeliveryReport>;
  };
  readonly spending: { readonly usd: MeasuredTotal; readonly costEntryCount: number; readonly attemptsWithoutCostEntry: readonly string[] };
}

export interface FleetOperationsReport {
  readonly formatVersion: typeof FLEET_OPERATIONS_VERSION;
  readonly extensionVersion: typeof FLEET_OPERATIONS_EXTENSION_VERSION;
  /** Query observation time supplied by the caller. Not an atomic historical snapshot or a source freshness clock. */
  readonly observedAt: string;
  readonly deliveryFreshness: "FRESH" | "STALE" | "UNKNOWN";
  readonly operations: ReadOutcome<readonly FleetOperation[]>;
  readonly receiptLoading: FleetReceiptLoading;
  /** Receipt provenance only. Historical promoter/1 receipts stay DISTINCT from PDC's permanent authority. */
  readonly receiptSource?: { readonly kind: "OWNER_SNAPSHOT" | "INJECTED_STORE"; readonly observedAt: string | null;
    readonly authority: "HISTORICAL_PROMOTER_1"; readonly freshness: "FRESH" | "STALE" | "UNKNOWN";
    readonly permanentAuthority: "NOT_CONNECTED" | "CONNECTED";
    /** GOOD ValidationReceipt v2 publications supplied to this read; empty/absent when NOT_CONNECTED. */
    readonly permanentAuthorityPromotions?: readonly PermanentAuthorityPromotion[] };
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
  const scoutAdmission = scoutTaskAdmission(task, activity.facts.routeTasks, activity.facts.attempts, observedAt);
  const inFlight = task.state === "CLAIMED" || admission?.state === "IN_FLIGHT" || scoutAdmission?.state === "IN_FLIGHT";
  let nextAutomaticAction: FleetTaskOperation["nextAutomaticAction"] = "UNKNOWN";
  if (inFlight) nextAutomaticAction = "LEASE_RECONCILIATION";
  else if (scoutAdmission?.state === "BACKOFF") nextAutomaticAction = "WAIT_FOR_BACKOFF";
  else if (scoutAdmission?.state === "POLICY_RECHECK") nextAutomaticAction = "POLICY_RECHECK";
  else if (scoutAdmission?.state === "TIMING_ELIGIBLE" || scoutAdmission?.state === "CONTINUATION_CANDIDATE") nextAutomaticAction = "ADMISSION_CHECK";
  else if (admission?.state === "BACKOFF") nextAutomaticAction = "WAIT_FOR_BACKOFF";
  else if (admission?.state === "DUE") nextAutomaticAction = admission.requiresPolicyRecheck ? "POLICY_RECHECK" : "ADMISSION_CHECK";
  else if (task.state === "RESULT_RECORDED" || task.state === "DISPOSED") nextAutomaticAction = "NONE_FOR_THIS_TASK";
  return { taskId: task.id, path: task.workerTask ? "WORKER_COMPUTATION" : "ROUTE_DISPOSITION", state: task.state,
    admission, scoutAdmission, lease, nextAutomaticAction, retryAt: admission?.retryAt ?? scoutAdmission?.retryAt ?? null,
    blocker: inFlight ? active ? "LIVE_LEASE_PREVENTS_DUPLICATE_EXECUTION" : "LEASE_RECONCILIATION_REQUIRED"
      : admission && !admission.due && admission.state !== "TERMINAL" ? admission.reason
      : scoutAdmission && ["BACKOFF", "POLICY_DENIED", "POLICY_RECHECK"].includes(scoutAdmission.state) ? scoutAdmission.reason
      : task.policyDenial?.requiredChange ?? null };
}

/** Pure projection of the existing attributed activity read. No ledger writes or scheduler invocation. */
export function projectFleetOperation(activity: AutonomousObligationActivity, observedAt: string, deliveryEvidence?: FleetDeliveryEvidence): FleetOperation {
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
  let delivery: ReadOutcome<FleetDeliveryReport>;
  try {
    delivery = !deliveryEvidence
      ? { kind: "NOT_RECORDED", detail: "Delivery window evidence was not supplied to this projection." }
      : deliveryEvidence.windows.kind !== "HELD" ? deliveryEvidence.windows
      : { kind: "HELD", value: projectFleetDelivery({ activity, windows: deliveryEvidence.windows.value,
        receipts: deliveryEvidence.receipts, readbacks: deliveryEvidence.readbacks, receiptLoading: deliveryEvidence.receiptLoading,
        permanentAuthority: deliveryEvidence.permanentAuthority }) };
  } catch (error) { delivery = unreachable("fleet delivery projection", error); }
  return { workItemId: activity.workItem.id, subject: activity.workItem.subject,
    path: activity.workItem.autonomousPlan ? "AUTONOMOUS_PLAN" : activity.facts.routeTasks.some(t => t.workerTask) ? "REGISTERED_WORKER_TASKS" : "OTHER_REGISTERED_WORK",
    stage: activity.workItem.state, lastProgress: progress.at(-1) ?? null, lastActivity: activity.timeline.at(-1) ?? null,
    tasks: activity.facts.routeTasks.map(t => taskOperation(t, activity, observedAt)),
    sourceHealth: { observations: activity.timeline.flatMap(e => e.walk ? [e.walk] : []),
      lastAcquired: held && held.result.role === "ACQUIRER" ? { resultId: held.id, at: held.endedAt, artifactIds: held.result.artifacts.map(a => a.artifactId) } : null,
      latestAcquisition: latest ? { resultId: latest.id, at: latest.endedAt, verdict: latest.result.verdict } : null, evidenceGaps: activity.evidenceGaps },
    publication: { status: "UNKNOWN", reason: "PER_RECORD_PROMOTION_AND_SERVED_READER_PROOF_NOT_JOINED",
      recordedStages: activity.facts.promotion.map(p => ({ recordId: p.recordId, itemId: p.itemId, stage: p.stage, at: p.at })), recordedItems,
      recordedItemStageCounts: stageCounts(pipelineStates), delivery },
    spending: { usd: sumMetric(activity.facts.costs, "usd"), costEntryCount: activity.facts.costs.length,
      attemptsWithoutCostEntry: activity.facts.attempts.filter(a => !costed.has(a.id)).map(a => a.id).sort() } };
}

/** Read service for Admin's authenticated server. Caller opens repos; no connection/env lookup or side effect here. */
export async function readFleetOperations(repos: ControlPlaneRepositories, input: { readonly observedAt: string;
  readonly deliveryEvidence?: Omit<FleetDeliveryEvidence, "windows" | "receiptLoading" | "permanentAuthority">;
  /** PDC permanent-authority publication evidence (GOOD ValidationReceipt v2). An isolated, injected
   *  input here; the served surface would read it from the permanent data plane. Absent → NOT_CONNECTED. */
  readonly permanentAuthority?: readonly ValidationReceipt[];
  readonly receiptStore?: FleetReceiptStore }): Promise<FleetOperationsReport> {
  if (!Number.isFinite(Date.parse(input.observedAt))) throw new Error("FLEET_OPERATIONS_CLOCK_INVALID");
  const [activities, snapshot, decisions, windows] = await Promise.all([
    readAutonomousActivity(repos, undefined, input).then(value => ({ kind: "HELD" as const, value }))
      .catch(error => unreachable<readonly AutonomousObligationActivity[]>("fleet activity", error)),
    readSnapshot(repos), readDecisions(repos),
    repos.windowRuns.readAll().then(value => ({ kind: "HELD" as const, value }))
      .catch(error => unreachable<readonly WindowRunRecord[]>("fleet delivery windows", error)),
  ]);
  let receiptLoading: FleetReceiptLoading = { kind: "NOT_RECORDED", detail: "No trusted receipt store was supplied to this read." };
  let receipts = input.deliveryEvidence?.receipts;
  const stored = snapshot.kind === "HELD" ? readFleetReceiptSnapshot(snapshot.value.fleetReceipts, input.observedAt)
    : { observedAt: null, freshness: "UNKNOWN" as const, loading: snapshot };
  const permanentAuthorityPromotions = projectPermanentAuthority(input.permanentAuthority ?? []);
  const receiptSource: NonNullable<FleetOperationsReport["receiptSource"]> = {
    kind: input.receiptStore ? "INJECTED_STORE" : "OWNER_SNAPSHOT",
    observedAt: input.receiptStore ? input.observedAt : stored.observedAt,
    authority: "HISTORICAL_PROMOTER_1", freshness: input.receiptStore ? "UNKNOWN" : stored.freshness,
    permanentAuthority: permanentAuthorityPromotions.length ? "CONNECTED" : "NOT_CONNECTED", permanentAuthorityPromotions };
  if (input.receiptStore) {
    // A supplied store owns receipt availability; injected/old receipts cannot hide its failure.
    receipts = [];
    if (windows.kind !== "HELD") receiptLoading = windows;
    else try {
      const { receipts: loaded, ...loading } = await input.receiptStore.read(windows.value, input.observedAt);
      receipts = loaded;
      receiptLoading = { kind: "HELD", value: loading };
    } catch (error) { receiptLoading = unreachable("fleet receipt store", error); }
  }
  else {
    const { loading } = stored;
    if (loading.kind === "HELD") {
      const { receipts: loaded, ...metadata } = loading.value;
      receipts = loaded; receiptLoading = { kind: "HELD", value: metadata };
    } else {
      receiptLoading = loading;
      // Explicit fixture evidence remains supported only when no snapshot extension exists.
      if (snapshot.kind === "STORE_UNREACHABLE" || (snapshot.kind === "HELD" && snapshot.value.fleetReceipts != null)) receipts = [];
    }
  }
  let operations: FleetOperationsReport["operations"];
  try {
    operations = activities.kind !== "HELD" ? activities
      : { kind: "HELD", value: activities.value.map(activity => projectFleetOperation(activity, input.observedAt,
        { ...input.deliveryEvidence, receipts, windows, permanentAuthority: permanentAuthorityPromotions, ...((input.receiptStore || snapshot.kind === "STORE_UNREACHABLE" || (snapshot.kind === "HELD" && snapshot.value.fleetReceipts != null)) ? { receiptLoading } : {}) })) };
  } catch (error) { operations = unreachable("fleet activity projection", error); }
  const coverageGaps: FleetOperationsReport["coverageGaps"] = snapshot.kind === "HELD"
    ? { kind: "HELD", value: { publishedAt: snapshot.value.publishedAt, zipRows: snapshot.value.zipRows } } : snapshot;
  const ownerDecisions: FleetOperationsReport["ownerDecisions"] = snapshot.kind !== "HELD" ? snapshot : decisions.kind !== "HELD" ? decisions
    : { kind: "HELD", value: { publishedAt: snapshot.value.publishedAt, cards: snapshot.value.decisionCards.filter(card =>
      decisionCardKind(card) === "DECISION" && card.verifiability === "NOT_MACHINE_VERIFIABLE" && card.whyNoMachineCanDecide.trim() &&
      latestDecisionFor(decisions.value, card.rowId) === null) } };
  const readsAvailable = ![operations, coverageGaps, ownerDecisions, windows, receiptLoading].some(value => value.kind === "STORE_UNREACHABLE") &&
    !(operations.kind === "HELD" && operations.value.some(row => row.publication.delivery.kind === "STORE_UNREACHABLE"));
  const fullyRead = readsAvailable &&
    !(receiptLoading.kind === "HELD" && (receiptLoading.value.truncated > 0 || receiptLoading.value.entries.some(entry => entry.state !== "LOADED")));
  return { formatVersion: FLEET_OPERATIONS_VERSION, extensionVersion: FLEET_OPERATIONS_EXTENSION_VERSION, observedAt: input.observedAt,
    deliveryFreshness: !fullyRead ? (readsAvailable && stored.freshness === "STALE" && !input.receiptStore ? "STALE" : "UNKNOWN")
      : input.receiptStore ? "FRESH" : stored.freshness, operations, receiptLoading,
    receiptSource: input.receiptStore ? { ...receiptSource, freshness: fullyRead ? "FRESH" : "UNKNOWN" } : receiptSource, coverageGaps, ownerDecisions };
}

/** What the panels tab (BUILD.md §F) reads. Receipts, coverage and spend all
 *  live on the owner snapshot, so this reads ONLY the snapshot — never the
 *  fleet-activity scan `readAutonomousActivity` runs. That scan is the render's
 *  one unbounded cost and belongs to the work tab alone (§0); reading it for a
 *  panel of aggregates would defeat the point. This is the targeted read the
 *  read fix asks for: exactly what the panels need. */
export interface FleetPanelsReading {
  readonly observedAt: string;
  readonly deliveryFreshness: "FRESH" | "STALE" | "UNKNOWN";
  readonly receiptLoading: FleetReceiptLoading;
  readonly receiptSource: FleetOperationsReport["receiptSource"];
  readonly coverageGaps: FleetOperationsReport["coverageGaps"];
  readonly spending: NonNullable<OwnerSnapshot["costSummary"]> | null;
}

export async function readFleetPanels(
  repos: ControlPlaneRepositories,
  input: { readonly observedAt: string },
): Promise<FleetPanelsReading> {
  return projectFleetPanels(await readSnapshot(repos), input.observedAt);
}

/** Pure projection so the shell can read the snapshot once and share it across
 *  the panels, the decision queue and the pulse revision (BUILD.md §0). */
export function projectFleetPanels(snapshot: ReadOutcome<OwnerSnapshot>, observedAt: string): FleetPanelsReading {
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error("FLEET_OPERATIONS_CLOCK_INVALID");
  const input = { observedAt };
  const stored = snapshot.kind === "HELD"
    ? readFleetReceiptSnapshot(snapshot.value.fleetReceipts, input.observedAt)
    : { observedAt: null, freshness: "UNKNOWN" as const, loading: snapshot };
  let receiptLoading: FleetReceiptLoading = { kind: "NOT_RECORDED", detail: "No receipt reading was available from the owner snapshot." };
  const { loading } = stored;
  if (loading.kind === "HELD") {
    const { receipts: _loaded, ...metadata } = loading.value;
    receiptLoading = { kind: "HELD", value: metadata };
  } else {
    receiptLoading = loading;
  }
  const receiptSource: FleetOperationsReport["receiptSource"] = {
    kind: "OWNER_SNAPSHOT", observedAt: stored.observedAt, authority: "HISTORICAL_PROMOTER_1",
    freshness: stored.freshness, permanentAuthority: "NOT_CONNECTED", permanentAuthorityPromotions: [],
  };
  const coverageGaps: FleetOperationsReport["coverageGaps"] = snapshot.kind === "HELD"
    ? { kind: "HELD", value: { publishedAt: snapshot.value.publishedAt, zipRows: snapshot.value.zipRows } }
    : snapshot;
  const fullyLoaded = receiptLoading.kind === "HELD"
    && receiptLoading.value.truncated === 0
    && receiptLoading.value.entries.every((e) => e.state === "LOADED");
  return {
    observedAt: input.observedAt,
    deliveryFreshness: fullyLoaded ? stored.freshness : "UNKNOWN",
    receiptLoading,
    receiptSource,
    coverageGaps,
    spending: snapshot.kind === "HELD" ? snapshot.value.costSummary ?? null : null,
  };
}

/** The Needs-Sean queue the decisions tab (BUILD.md §E) mounts, read WITHOUT
 *  the fleet-activity scan: the cards live on the owner snapshot, and whether
 *  each is still open is the decision log. This is the same filter
 *  `readFleetOperations` applies to `ownerDecisions`, as a targeted read the
 *  four non-work tabs can share (BUILD.md §0). */
export interface FleetDecisionQueueReading {
  readonly available: boolean;
  readonly cards: readonly OwnerDecisionCard[];
}

export async function readFleetDecisionQueue(repos: ControlPlaneRepositories): Promise<FleetDecisionQueueReading> {
  const [snapshotOut, decisionsOut] = await Promise.all([readSnapshot(repos), readDecisions(repos)]);
  return projectFleetDecisionQueue(snapshotOut, decisionsOut);
}

/** Pure projection so the shell can reuse its one snapshot + decision-log read. */
export function projectFleetDecisionQueue(
  snapshotOut: ReadOutcome<OwnerSnapshot>,
  decisionsOut: Awaited<ReturnType<typeof readDecisions>>,
): FleetDecisionQueueReading {
  if (snapshotOut.kind !== "HELD" || decisionsOut.kind !== "HELD") return { available: false, cards: [] };
  const decisions = decisionsOut.value;
  const cards = snapshotOut.value.decisionCards.filter((card) =>
    decisionCardKind(card) === "DECISION" && card.verifiability === "NOT_MACHINE_VERIFIABLE" &&
    card.whyNoMachineCanDecide.trim() && latestDecisionFor(decisions, card.rowId) === null);
  return { available: true, cards };
}

/** Delivery freshness only, using Admin's existing pulse tolerance; never certifies source data. */
export function fleetReadFreshness(lastSuccessfulReadAt: string | null, now: string): "FRESH" | "STALE" | "UNKNOWN" {
  const current = Date.parse(now), read = lastSuccessfulReadAt === null ? NaN : Date.parse(lastSuccessfulReadAt);
  if (!Number.isFinite(current) || !Number.isFinite(read) || read > current) return "UNKNOWN";
  return current - read >= PULSE_STALE_MS ? "STALE" : "FRESH";
}
