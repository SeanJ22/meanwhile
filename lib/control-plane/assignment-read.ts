/**
 * **WHAT THE ASSIGNMENT VIEW READS — ONCE FOR THE PUBLISHER, BY ID FOR THE DRILLDOWN.**
 *
 * Two read paths, one projection (`assignment-view.ts`):
 *
 * ```
 *   readAllAssignmentSources   every record the join needs, read once through
 *                              the repositories (keyset-paged, so no response
 *                              nears the 64 MiB cap). The standing publisher
 *                              calls it; the admin page never does.
 *   readAssignmentSourcesById  ONE assignment's records, by targeted reads
 *                              keyed the way the logs are keyed — the obligation
 *                              and its debt and Scout results by obligation id,
 *                              its rounds by their derived occurrence ids, the
 *                              artifacts, costs and worker results by work item,
 *                              the disposition commits by route task, the
 *                              pipeline items by their derived item ids. The
 *                              admin drilldown calls it, for any id, including
 *                              the ones the bounded published list left out.
 * ```
 *
 * Read-only: nothing here appends, puts or compare-and-sets. A failed read is
 * STORE_UNREACHABLE, never an empty assignment (`admin-data.ts`).
 */
import type { Attempt, ExecutionLease } from "./attempt.ts";
import { unreachable, type ReadOutcome } from "./admin-data.ts";
import { parseAskGapObligationId } from "./ask-gap-id.ts";
import { readAskGapObservations } from "./ask-gap-observations.ts";
import type { AssignmentSources } from "./assignment-view.ts";
import type { CostEntry } from "./cost.ts";
import { deriveItemState, isPipelineRecord, methodCandidateItemId, scoutResultItemId } from "./promotion/pipeline.ts";
import type { ActivationGateReading, PipelineItemState, PromotionPipelineRecord } from "./promotion/types.ts";
import type { ArtifactRecord, ControlPlaneRepositories, DispositionCommit, Persisted } from "./repository/types.ts";
import type { RouteTask } from "./route-task.ts";
import type { FreshnessDebt } from "./scheduler/debt.ts";
import { occurrenceId, type FreshnessOccurrence, type StandingObligation } from "./scheduler/durable.ts";
import type { ScoutResult } from "./scheduler/scout-result.ts";
import type { WorkItem } from "./work-item.ts";
import type { WorkerResultRecord } from "./workers/types.ts";

/** What every read shares: the clock, the activation reading and the pilot ZIPs the band is read against. */
export interface AssignmentReadBase {
  readonly nowIso: string;
  readonly activation: ActivationGateReading | null;
  readonly pilotZips: readonly string[];
}

/** At most this many targeted reads are in flight at once, so one drilldown never floods the store. */
const READ_CONCURRENCY = 16;

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

/** Group a whole promotion-pipeline log into item states, in append order. */
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

/** Leases only for the route tasks that hold an open Attempt: the one question a lease answers here. */
async function leasesFor(repos: ControlPlaneRepositories, attempts: readonly Attempt[]): Promise<ExecutionLease[]> {
  const open = unique(attempts.filter((a) => a.outcome === null).map((a) => a.routeTaskId));
  return values(await inBatches(open, (id) => repos.leases.read(id)));
}

/**
 * Every record the assignment view joins, read once. Arrays the caller has
 * already read (the publisher reads costs, attempts, obligations and the
 * pipeline for its other panels) are passed in and not read twice.
 */
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
    already.obligations ? Promise.resolve(already.obligations) : repos.obligations.list().then((rows) => rows.map((r) => r.value)),
    repos.occurrences.list().then((rows) => rows.map((r) => r.value)),
    repos.workItems.list().then((rows) => rows.map((r) => r.value)),
    repos.routeTasks.list().then((rows) => rows.map((r) => r.value)),
    already.attempts ? Promise.resolve(already.attempts) : repos.attempts.list().then((rows) => rows.map((r) => r.value)),
    repos.debts.list().then((rows) => rows.map((r) => r.value)),
    repos.artifacts.readAll(),
    already.costs ? Promise.resolve(already.costs) : repos.costs.readAll(),
    repos.scoutResults.readAll(),
    repos.workerResults.readAll(),
  ]);
  const pipeline =
    already.pipeline !== undefined ? already.pipeline : pipelineStatesOf(await repos.promotionPipeline.readAll());
  /* What readers were told (v13). A failed read is null — the page says it was not read — and never fails the publish. */
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

/** The pipeline item ids a set of Scout results can have produced (the ids are derived, never stored elsewhere). */
function pipelineItemIdsOf(results: readonly ScoutResult[]): string[] {
  const ids: string[] = [];
  for (const r of results) {
    if (r.outcome === "ROUTE_CANDIDATE") for (const c of r.candidates) ids.push(scoutResultItemId(r, c.routeId));
    if (r.outcome === "EVIDENCE_FOUND") ids.push(scoutResultItemId(r, null));
    for (const id of r.methodCandidateIds ?? []) ids.push(methodCandidateItemId(id));
  }
  return unique(ids);
}

/**
 * One assignment's records, by id: a standing obligation id, or a work item id.
 * NOT_RECORDED when neither exists; STORE_UNREACHABLE when a read failed.
 */
export async function readAssignmentSourcesById(
  repos: ControlPlaneRepositories,
  id: string,
  base: AssignmentReadBase,
): Promise<ReadOutcome<AssignmentSources>> {
  try {
    const obligationRow = await repos.obligations.read(id);
    let obligations: StandingObligation[] = [];
    let occurrences: FreshnessOccurrence[] = [];
    let debts: FreshnessDebt[] = [];
    let scoutResults: ScoutResult[] = [];
    let workItemIds: string[] = [];
    let routeTaskIds: string[] = [];
    let wholePipeline = false;

    if (obligationRow !== null) {
      const ob = obligationRow.value;
      obligations = [ob];
      const sequences = Array.from({ length: Math.max(0, ob.occurrenceCount) }, (_, i) => i + 1);
      const [debtRow, scouts, occRows] = await Promise.all([
        repos.debts.read(id),
        repos.scoutResults.read(id),
        inBatches(sequences, (n) => repos.occurrences.read(occurrenceId(id, n))),
      ]);
      debts = debtRow === null ? [] : [debtRow.value];
      scoutResults = [...scouts];
      occurrences = values(occRows);
      workItemIds = unique(occurrences.map((o) => o.workItemId));
      routeTaskIds = unique(occurrences.map((o) => o.routeTaskId));
    } else {
      const itemRow = await repos.workItems.read(id);
      if (itemRow === null) {
        return {
          kind: "NOT_RECORDED",
          detail: `The control plane is reachable and holds no standing obligation or work item with the id ${id}.`,
        };
      }
      workItemIds = [id];
      routeTaskIds = [...itemRow.value.routeTaskIds];
      // A work item created against an obligation's clause keeps its Scout results under that obligation's key.
      const clause = itemRow.value.obligation;
      if (clause.startsWith("freshness:")) {
        scoutResults = (await repos.scoutResults.read(clause)).filter((r) => r.workItemId === id);
      }
      wholePipeline = true;
    }

    const [workItemRows, routeTaskRows] = await Promise.all([
      inBatches(workItemIds, (wi) => repos.workItems.read(wi)),
      inBatches(routeTaskIds, (rt) => repos.routeTasks.read(rt)),
    ]);
    const workItems: WorkItem[] = values(workItemRows);
    // A work item may list route tasks an occurrence does not name (a created chain's later steps).
    const moreTaskIds = unique(workItems.flatMap((w) => w.routeTaskIds)).filter((rt) => !routeTaskIds.includes(rt));
    const routeTasks: RouteTask[] = [...values(routeTaskRows), ...values(await inBatches(moreTaskIds, (rt) => repos.routeTasks.read(rt)))];
    const attemptIds = unique(routeTasks.flatMap((t) => t.attemptIds));
    const allTaskIds = unique(routeTasks.map((t) => t.id));

    const [attemptRows, artifactLists, costLists, workerLists, commitLists] = await Promise.all([
      inBatches(attemptIds, (a) => repos.attempts.read(a)),
      inBatches(workItemIds, (wi) => repos.artifacts.read(wi)),
      inBatches(workItemIds, (wi) => repos.costs.read(wi)),
      inBatches(workItemIds, (wi) => repos.workerResults.read(wi)),
      inBatches(allTaskIds, (rt) => repos.dispositions.read(rt)),
    ]);
    const attempts: Attempt[] = values(attemptRows);
    const artifacts: ArtifactRecord[] = artifactLists.flat();
    const costs: CostEntry[] = costLists.flat();
    const workerResults: WorkerResultRecord[] = workerLists.flat();
    const dispositions: DispositionCommit[] = commitLists.flat();

    /* An Ask-gap obligation's body: what readers were told of its gaps, read by body. A failed read is null, never a failed drilldown. */
    const askGap = obligations.length === 1 ? parseAskGapObligationId(obligations[0]!.id) : null;
    const askGapObservations = askGap === null
      ? undefined
      : await repos.askGapObservations.listWhere(["bodyId"], askGap.bodyId).then((rows) => rows.map((row) => row.value), () => null);

    let pipeline: PipelineItemState[];
    if (wholePipeline) {
      // A fleet extraction names its work item, not a derivable item id: the (small) log is read whole.
      pipeline = pipelineStatesOf(await repos.promotionPipeline.readAll());
    } else {
      const itemIds = pipelineItemIdsOf(scoutResults);
      const lists = await inBatches(itemIds, (itemId) => repos.promotionPipeline.read(itemId));
      pipeline = itemIds
        .map((itemId, i) => ({ itemId, records: lists[i].filter(isPipelineRecord) }))
        .filter((x) => x.records.length > 0)
        .map((x) => deriveItemState(x.itemId, x.records));
    }

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
