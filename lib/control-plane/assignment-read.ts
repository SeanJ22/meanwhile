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

/** The pipeline items a set of Scout results names, read by their derived ids, as item states. */
async function pipelineOfScouts(repos: ControlPlaneRepositories, itemIds: readonly string[]): Promise<PipelineItemState[]> {
  const lists = await inBatches(itemIds, (itemId) => repos.promotionPipeline.read(itemId));
  return itemIds
    .map((itemId, i) => ({ itemId, records: lists[i].filter(isPipelineRecord) }))
    .filter((x) => x.records.length > 0)
    .map((x) => deriveItemState(x.itemId, x.records));
}

/**
 * One assignment's records, by id: a standing obligation id, or a work item id.
 * NOT_RECORDED when neither exists; STORE_UNREACHABLE when a read failed.
 *
 * Each read starts as soon as the ids it is keyed by are known, so the reads
 * form as few dependent round trips as the keys allow (Sean, 2026-09-24: a load
 * over three seconds is not a win). Measured 2026-09-25 on production for
 * `freshness:campaign-finance:ballot-az-pima:prop-423#AZ_PIMA_COUNTY_CAMPAIGN_FINANCE_PAGE`:
 * 76 point reads in five dependent waves, 1.31 s from a workstation, the
 * pipeline read waiting on the attempts it does not need. Now:
 *
 * ```
 *   wave 1   everything keyed by the id itself: the obligation, its debt, its
 *            Scout results (a work item id finds no debt and no Scout result
 *            under its own key: two empty point reads, dropped)
 *   wave 2   the obligation's rounds by their derived ids, beside the pipeline
 *            items its Scout results name — or, for a work item id, the item
 *   wave 3   the work items and route tasks the rounds name, and everything
 *            keyed by them: artifacts, costs, worker results, disposition commits
 *   wave 4   the attempts of those route tasks, beside any later route task a
 *            work item lists that no round names
 *   (wave 5) only when wave 4 found such a task or an open attempt: its
 *            attempts and commits, and the leases of open attempts
 * ```
 *
 * The answer is the same records, in the same order, as reading each wave only
 * after the one before had fully finished.
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
    /* The work item a work-item drilldown already read, reused rather than read twice. */
    let itemRows: (Persisted<WorkItem> | null)[] | null = null;
    /* What wave 3 reads beside the rounds' records: nothing more for an obligation; for a work item, its Scout results and the pipeline. */
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
          // A fleet extraction names its work item, not a derivable item id: the (small) log is read whole.
          repos.promotionPipeline.readAll(),
        ]);
        return { scoutResults: scouts.filter((r) => r.workItemId === id), pipeline: pipelineStatesOf(all) };
      };
    }

    const [workItemRows, routeTaskRows, artifactLists, costLists, workerLists, commitLists, extra] = await Promise.all([
      itemRows !== null ? Promise.resolve(itemRows) : inBatches(workItemIds, (wi) => repos.workItems.read(wi)),
      inBatches(routeTaskIds, (rt) => repos.routeTasks.read(rt)),
      inBatches(workItemIds, (wi) => repos.artifacts.read(wi)),
      inBatches(workItemIds, (wi) => repos.costs.read(wi)),
      inBatches(workItemIds, (wi) => repos.workerResults.read(wi)),
      inBatches(routeTaskIds, (rt) => repos.dispositions.read(rt)),
      wave3Extra(),
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
    // A later task's attempts and commits (and any task whose id is not the key it was read by) are read once they are known.
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
        costs,
        scoutResults,
        workerResults,
        pipeline,
        activation: base.activation,
        servedReader: null,
        pilotZips: base.pilotZips,
      },
    };
  } catch (error) {
    return unreachable(`the records of assignment ${id}`, error);
  }
}
