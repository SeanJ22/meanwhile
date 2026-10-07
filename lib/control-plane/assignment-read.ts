/** Read-only. A failed read is STORE_UNREACHABLE, never an empty assignment. */
import type { Attempt, ExecutionLease } from "./attempt.ts";
import { unreachable, type ReadOutcome } from "./admin-data.ts";
import { parseAskGapObligationId } from "./ask-gap-id.ts";
import { readAskGapObservations } from "./ask-gap-observations.ts";
import type { AssignmentSources } from "./assignment-view.ts";
import type { CostEntry } from "./cost.ts";
import { deriveItemState, isPipelineRecord, methodCandidateItemId, scoutResultItemId } from "./promotion/pipeline.ts";
import type { ActivationGateReading, PipelineItemState, PromotionPipelineRecord } from "./promotion/types.ts";
import type { ArtifactRecord, ControlPlaneRepositories, DispositionCommit, Persisted, RecordProjection } from "./repository/types.ts";
import type { RouteTask } from "./route-task.ts";
import type { FreshnessDebt } from "./scheduler/debt.ts";
import { occurrenceId, type FreshnessOccurrence, type StandingObligation } from "./scheduler/durable.ts";
import type { ScoutResult } from "./scheduler/scout-result.ts";
import type { WorkItem } from "./work-item.ts";
import type { WorkerResultRecord } from "./workers/types.ts";

export interface AssignmentReadBase {
  readonly nowIso: string;
  readonly activation: ActivationGateReading | null;
  readonly pilotZips: readonly string[];
}

export const ASSIGNMENT_ATTEMPT_PROJECTION = {
  id: true, routeTaskId: true, workItemId: true, worker: ["role", "provider", "version"],
  leaseId: true, startedAt: true, endedAt: true, outcome: true, abortReason: true, artifactIds: true,
  cost: ["durationMs"],
} satisfies RecordProjection;

export const ASSIGNMENT_OBLIGATION_PROJECTION = {
  id: true, recordClass: true, subjectId: true, routeId: true, active: true, readerImpactAt: true,
  meetingStartsAt: true, observedChangeRateHours: true, declaredCycleHours: true, lastWorkedAt: true,
  absentUntil: true, absenceUnlock: true, assignments: true, nextDueAt: true, occurrenceCount: true, openOccurrenceId: true,
  retiredAt: true, retirementReason: true,
} satisfies RecordProjection;

const WORK_ITEM_PROJECTION = {
  id: true, project: true, subject: true, obligation: true, why: true, question: true, state: true,
  dependencies: true, routeTaskIds: true, escalations: true, createdAt: true, transitions: true,
  directoryParent: true, manualSourceGap: true, publicationOutcome: true, planRepair: true,
  autonomousPlan: ["publication", "contract", "ownerInstructions"],
} satisfies RecordProjection;
const ROUTE_TASK_PROJECTION = {
  id: true, workItemId: true, routeId: true, state: true, disposition: true, attemptIds: true,
  createdAt: true, policyDenial: true, workerTask: ["contract"],
} satisfies RecordProjection;
const OCCURRENCE_PROJECTION = {
  id: true, obligationId: true, sequence: true, dueAt: true, workItemId: true, routeTaskId: true,
  openedAt: true, closedAt: true, unresolvedReason: true,
} satisfies RecordProjection;
const DEBT_PROJECTION = {
  obligationId: true, cause: true, consecutiveFailures: true, detail: true, firstFailedAt: true,
  lastFailedAt: true, retryAt: true,
} satisfies RecordProjection;

/** At most this many targeted reads are in flight at once, so one drilldown never floods the store. */
const READ_CONCURRENCY = 16;
const MAX_INHERITED_ORIGIN_REFERENCES = 32;

/** Metadata alone is not authority to reuse bytes. */
export function verifiedInheritedOrigin(input: {
  child: WorkItem; origin: WorkItem | null; artifact: ArtifactRecord | null; attempt: Attempt | null;
  declaredArtifactId: string; declaredOriginWorkItemId: string;
}): { readonly artifact: ArtifactRecord; readonly attempt: Attempt; readonly originWorkItemId: string } | null {
  const {child,origin,artifact,attempt}=input;
  if(!origin||!artifact||!attempt||origin.id===child.id||origin.id!==input.declaredOriginWorkItemId||
    origin.project!==child.project||origin.subject!==child.subject||artifact.artifactId!==input.declaredArtifactId||
    artifact.workItemId!==origin.id||artifact.partial||artifact.tier==="RESTRICTED_RAW"||artifact.attemptId!==attempt.id||
    attempt.workItemId!==origin.id||attempt.outcome!=="COMPLETED"||!attempt.artifactIds.includes(artifact.artifactId)) return null;
  return {artifact,attempt,originWorkItemId:origin.id};
}

async function inBatches<T, R>(items: readonly T[], read: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += READ_CONCURRENCY) {
    out.push(...(await Promise.all(items.slice(i, i + READ_CONCURRENCY).map(read))));
  }
  return out;
}

function values<T>(rows: readonly (Persisted<T> | null)[]): T[] {
  return rows.filter((r): r is Persisted<T> => r !== null).map((r) => r.value);
}

function unique(ids: readonly (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id !== ""))];
}

export function pipelineStatesOf(records: readonly unknown[]): PipelineItemState[] {
  const byItem = new Map<string, PromotionPipelineRecord[]>();
  for (const r of records) {
    if (!isPipelineRecord(r)) continue;
    const list = byItem.get(r.itemId);
    if (list) list.push(r);
    else byItem.set(r.itemId, [r]);
  }
  return [...byItem.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([itemId, recs]) => deriveItemState(itemId, recs));
}

async function leasesFor(repos: ControlPlaneRepositories, attempts: readonly Attempt[]): Promise<ExecutionLease[]> {
  const open = unique(attempts.filter((a) => a.outcome === null).map((a) => a.routeTaskId));
  return values(await inBatches(open, (id) => repos.leases.read(id)));
}

export async function readAllAssignmentSources(
  repos: ControlPlaneRepositories,
  base: AssignmentReadBase,
  already: {
    readonly costs?: readonly CostEntry[];
    readonly attempts?: readonly Attempt[];
    readonly obligations?: readonly StandingObligation[];
    readonly pipeline?: readonly PipelineItemState[] | null;
  } = {},
): Promise<AssignmentSources> {
  const [obligations, occurrences, workItems, routeTasks, attempts, debts, artifacts, costs, scoutResults, workerResults] = await Promise.all([
    already.obligations ? Promise.resolve(already.obligations) : repos.obligations.listNarrowed(ASSIGNMENT_OBLIGATION_PROJECTION).then((rows) => rows.map((r) => r.value as StandingObligation)),
    repos.occurrences.listNarrowed(OCCURRENCE_PROJECTION).then((rows) => rows.map((r) => r.value as FreshnessOccurrence)),
    repos.workItems.listNarrowed(WORK_ITEM_PROJECTION).then((rows) => rows.map((r) => r.value as WorkItem)),
    repos.routeTasks.listNarrowed(ROUTE_TASK_PROJECTION).then((rows) => rows.map((r) => r.value as RouteTask)),
    already.attempts ? Promise.resolve(already.attempts) : repos.attempts.listNarrowed(ASSIGNMENT_ATTEMPT_PROJECTION).then((rows) => rows.map((r) => r.value as Attempt)),
    repos.debts.listNarrowed(DEBT_PROJECTION).then((rows) => rows.map((r) => r.value as FreshnessDebt)),
    repos.artifacts.readAll(),
    already.costs ? Promise.resolve(already.costs) : repos.costs.readAll(),
    repos.scoutResults.readAll(),
    repos.workerResults.readAll(),
  ]);
  const pipeline =
    already.pipeline !== undefined ? already.pipeline : pipelineStatesOf(await repos.promotionPipeline.readAll());
  const observed = await readAskGapObservations(repos.askGapObservations);
  return {
    nowIso: base.nowIso,
    obligations,
    occurrences,
    workItems,
    routeTasks,
    attempts,
    debts,
    leases: await leasesFor(repos, attempts),
    // The applied disposition rides on each RouteTask; the commit log is read by the drilldown only.
    dispositions: null,
    artifacts,
    costs,
    scoutResults,
    workerResults,
    pipeline,
    activation: base.activation,
    servedReader: null,
    pilotZips: base.pilotZips,
    askGapObservations: "unreadable" in observed ? null : observed.rows,
  };
}

function pipelineItemIdsOf(results: readonly ScoutResult[]): string[] {
  const ids: string[] = [];
  for (const r of results) {
    if (r.outcome === "ROUTE_CANDIDATE") for (const c of r.candidates) ids.push(scoutResultItemId(r, c.routeId));
    if (r.outcome === "EVIDENCE_FOUND") ids.push(scoutResultItemId(r, null));
    for (const id of r.methodCandidateIds ?? []) ids.push(methodCandidateItemId(id));
  }
  return unique(ids);
}

async function pipelineOfScouts(repos: ControlPlaneRepositories, itemIds: readonly string[]): Promise<PipelineItemState[]> {
  const lists = await inBatches(itemIds, (itemId) => repos.promotionPipeline.read(itemId));
  return itemIds
    .map((itemId, i) => ({ itemId, records: lists[i].filter(isPipelineRecord) }))
    .filter((x) => x.records.length > 0)
    .map((x) => deriveItemState(x.itemId, x.records));
}

/**
 * NOT_RECORDED when neither id exists; STORE_UNREACHABLE when a read failed. Each read starts as soon as the ids it is
 * keyed by are known; the answer is the same records, in the same order, as reading wave by wave.
 */
export async function readAssignmentSourcesById(
  repos: ControlPlaneRepositories,
  id: string,
  base: AssignmentReadBase,
): Promise<ReadOutcome<AssignmentSources>> {
  try {
    const [obligationRow, debtRow, scoutsById] = await Promise.all([repos.obligations.read(id), repos.debts.read(id), repos.scoutResults.read(id)]);
    let obligations: StandingObligation[] = [];
    let occurrences: FreshnessOccurrence[] = [];
    let debts: FreshnessDebt[] = [];
    let workItemIds: string[];
    let routeTaskIds: string[];
    let itemRows: (Persisted<WorkItem> | null)[] | null = null;
    let wave3Extra: () => Promise<{ readonly scoutResults: ScoutResult[]; readonly pipeline: PipelineItemState[] }>;

    if (obligationRow !== null) {
      const ob = obligationRow.value;
      obligations = [ob];
      debts = debtRow === null ? [] : [debtRow.value];
      const scoutResults = [...scoutsById];
      const sequences = Array.from({ length: Math.max(0, ob.occurrenceCount) }, (_, i) => i + 1);
      const [occRows, pipeline] = await Promise.all([
        inBatches(sequences, (n) => repos.occurrences.read(occurrenceId(id, n))),
        pipelineOfScouts(repos, pipelineItemIdsOf(scoutResults)),
      ]);
      occurrences = values(occRows);
      workItemIds = unique(occurrences.map((o) => o.workItemId));
      routeTaskIds = unique(occurrences.map((o) => o.routeTaskId));
      wave3Extra = async () => ({ scoutResults, pipeline });
    } else {
      const itemRow = await repos.workItems.read(id);
      if (itemRow === null) {
        return {
          kind: "NOT_RECORDED",
          detail: `The control plane is reachable and holds no standing obligation or work item with the id ${id}.`,
        };
      }
      itemRows = [itemRow];
      workItemIds = [id];
      routeTaskIds = [...itemRow.value.routeTaskIds];
      // A work item created against an obligation's clause keeps its Scout results under that obligation's key.
      const clause = itemRow.value.obligation;
      wave3Extra = async () => {
        const [scouts, all] = await Promise.all([
          clause.startsWith("freshness:") ? repos.scoutResults.read(clause) : Promise.resolve([] as readonly ScoutResult[]),
          repos.promotionPipeline.readAll(),
        ]);
        return { scoutResults: scouts.filter((r) => r.workItemId === id), pipeline: pipelineStatesOf(all) };
      };
    }

    const askGap = obligations.length === 1 ? parseAskGapObligationId(obligations[0]!.id) : null;
    const askGapRead = askGap === null
      ? Promise.resolve(undefined)
      : repos.askGapObservations.listWhere(["bodyId"], askGap.bodyId).then((rows) => rows.map((row) => row.value), () => null);
    const [workItemRows, routeTaskRows, artifactLists, costLists, workerLists, commitLists, extra, askGapObservations] = await Promise.all([
      itemRows !== null ? Promise.resolve(itemRows) : inBatches(workItemIds, (wi) => repos.workItems.read(wi)),
      inBatches(routeTaskIds, (rt) => repos.routeTasks.read(rt)),
      inBatches(workItemIds, (wi) => repos.artifacts.read(wi)),
      inBatches(workItemIds, (wi) => repos.costs.read(wi)),
      inBatches(workItemIds, (wi) => repos.workerResults.read(wi)),
      inBatches(routeTaskIds, (rt) => repos.dispositions.read(rt)),
      wave3Extra(),
      askGapRead,
    ]);
    const workItems: WorkItem[] = values(workItemRows);
    const namedTasks: RouteTask[] = values(routeTaskRows);
    // A work item may list route tasks an occurrence does not name (a created chain's later steps).
    const moreTaskIds = unique(workItems.flatMap((w) => w.routeTaskIds)).filter((rt) => !routeTaskIds.includes(rt));
    const namedAttemptIds = unique(namedTasks.flatMap((t) => t.attemptIds));
    const [moreTaskRows, namedAttemptRows] = await Promise.all([
      inBatches(moreTaskIds, (rt) => repos.routeTasks.read(rt)),
      inBatches(namedAttemptIds, (a) => repos.attempts.read(a)),
    ]);
    const routeTasks: RouteTask[] = [...namedTasks, ...values(moreTaskRows)];
    const attemptIds = unique(routeTasks.flatMap((t) => t.attemptIds));
    const allTaskIds = unique(routeTasks.map((t) => t.id));

    const attemptById = new Map<string, Persisted<Attempt> | null>(namedAttemptIds.map((a, i) => [a, namedAttemptRows[i]]));
    const commitsByTask = new Map<string, readonly DispositionCommit[]>(routeTaskIds.map((rt, i) => [rt, commitLists[i]]));
    const lateAttemptIds = attemptIds.filter((a) => !attemptById.has(a));
    const lateTaskIds = allTaskIds.filter((rt) => !commitsByTask.has(rt));
    if (lateAttemptIds.length + lateTaskIds.length > 0) {
      const [lateAttempts, lateCommits] = await Promise.all([
        inBatches(lateAttemptIds, (a) => repos.attempts.read(a)),
        inBatches(lateTaskIds, (rt) => repos.dispositions.read(rt)),
      ]);
      lateAttemptIds.forEach((a, i) => attemptById.set(a, lateAttempts[i]));
      lateTaskIds.forEach((rt, i) => commitsByTask.set(rt, lateCommits[i]));
    }

    const attempts: Attempt[] = values(attemptIds.map((a) => attemptById.get(a) ?? null));
    const artifacts: ArtifactRecord[] = artifactLists.flat();
    const costs: CostEntry[] = costLists.flat();
    const workerResults: WorkerResultRecord[] = workerLists.flat();
    const inheritedReferences = workItems.flatMap(child => (child.autonomousPlan?.acquisition ?? []).flatMap(acquisition =>
      (acquisition.held??[]).filter(held => held.inheritedFromWorkItemId && held.inheritedFromWorkItemId !== child.id)
        .map(held => ({child,artifactId:held.artifactId,originId:held.inheritedFromWorkItemId!}))));
    const uniqueReferences = [...new Map(inheritedReferences.map(ref => [`${ref.child.id}:${ref.originId}:${ref.artifactId}`,ref])).values()];
    let inheritedOrigins: AssignmentSources["inheritedOrigins"] = null;
    if(uniqueReferences.length<=MAX_INHERITED_ORIGIN_REFERENCES) {
      const originIds=unique(uniqueReferences.map(ref=>ref.originId));
      const originReads=await inBatches(originIds,async originId=>Promise.all([
        repos.workItems.read(originId),repos.artifacts.read(originId)] as const));
      const byOrigin=new Map(originIds.map((originId,index)=>[originId,originReads[index]] as const));
      const selected=uniqueReferences.map(ref=>({ref,origin:byOrigin.get(ref.originId),artifact:
        byOrigin.get(ref.originId)?.[1].find(row=>row.artifactId===ref.artifactId)??null}));
      const attemptIds=unique(selected.map(row=>row.artifact?.attemptId));
      const attemptReads=await inBatches(attemptIds,id=>repos.attempts.read(id));
      const byOriginAttempt=new Map(attemptIds.map((attemptId,index)=>[attemptId,attemptReads[index]?.value??null] as const));
      const origins=selected.map(({ref,origin,artifact})=>verifiedInheritedOrigin({child:ref.child,
        origin:origin?.[0]?.value??null,artifact,attempt:artifact?byOriginAttempt.get(artifact.attemptId)??null:null,
        declaredArtifactId:ref.artifactId,declaredOriginWorkItemId:ref.originId}));
      inheritedOrigins=origins.filter((row):row is NonNullable<typeof row>=>row!==null);
    }
    const dispositions: DispositionCommit[] = allTaskIds.flatMap((rt) => commitsByTask.get(rt) ?? []);
    const { scoutResults, pipeline } = extra;

    return {
      kind: "HELD",
      value: {
        nowIso: base.nowIso,
        obligations,
        occurrences,
        workItems,
        routeTasks,
        attempts,
        debts,
        leases: await leasesFor(repos, attempts),
        dispositions,
        artifacts,
        inheritedOrigins,
        costs,
        scoutResults,
        workerResults,
        pipeline,
        activation: base.activation,
        servedReader: null,
        pilotZips: base.pilotZips,
        ...(askGapObservations !== undefined ? { askGapObservations } : {}),
      },
    };
  } catch (error) {
    return unreachable(`the records of assignment ${id}`, error);
  }
}
