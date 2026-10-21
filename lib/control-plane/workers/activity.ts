import type { Attempt, ExecutionLease } from "../attempt.ts";
import type { CostEntry } from "../cost.ts";
import type { RouteTask } from "../route-task.ts";
import type { WorkItem } from "../work-item.ts";
import type { ArtifactRecord, ControlPlaneRepositories, DispositionCommit, RecordedTransition } from "../repository/types.ts";
import type { ScoutResult } from "../scheduler/scout-result.ts";
import type { PromotionPipelineRecord } from "../promotion/types.ts";
import { assertFleetResult, type WorkerResultRecord } from "./types.ts";
import { assertResearchWalk, type EvidenceWalkStep, type ResearchWalkState } from "./research-types.ts";
import { canonicalJson, projectRecord, readByKeys, type AppendOnlyRepository } from "../repository/types.ts";
import type { Sql } from "../repository/pg-store.ts";

type ActivityCapture = Pick<ArtifactRecord, "artifactId" | "workItemId" | "partial" | "canonicalUrl">;
export const LEGACY_ACTIVITY_CAPTURES_SQL = `SELECT a.log_key, a.position,
  jsonb_build_object('artifactId',a.record->'artifactId','workItemId',a.record->'workItemId',
    'partial',a.record->'partial','canonicalUrl',a.record->'canonicalUrl') AS capture
  FROM cp_log_artifacts a WHERE EXISTS (SELECT 1 FROM cp_work_items_history w
    WHERE w.id=coalesce(a.record->>'workItemId',a.log_key) AND cp_control_state(w.value)=$1)
  AND (a.log_key,a.position)>($2::text,$3::bigint) ORDER BY a.log_key,a.position LIMIT 100`;

/** This projection happens in Postgres. readAllNarrowed on a held log narrows
 * only after downloading its full records, which is too late for this probe. */
export async function readLegacyActivityCaptures(state: string, sql?: Sql): Promise<ActivityCapture[]> {
  if (!/^(?:[a-z]{2}|system)$/.test(state)) throw new Error("LEGACY_ACTIVITY_STATE_INVALID");
  if (!sql) {
    const [{ neon }, { controlPlaneUrlFromEnv }] = await Promise.all([import("@neondatabase/serverless"), import("../repository/pg-store.ts")]);
    const url = controlPlaneUrlFromEnv();
    if (!url) throw new Error("LEGACY_ACTIVITY_STORE_UNCONFIGURED");
    sql = neon(url) as unknown as Sql;
  }
  const { boundedQuery } = await import("../repository/request-bounds.ts");
  const captures: ActivityCapture[] = [];
  let key = "", position = -1;
  for (;;) {
    const rows = await boundedQuery(sql, { operation: "cp_log_artifacts.legacyActivityCaptures", callClass: "PAGE" },
      LEGACY_ACTIVITY_CAPTURES_SQL, [state, key, position]) as { log_key: string; position: string | number; capture: ActivityCapture }[];
    captures.push(...rows.map(row => row.capture));
    if (rows.length < 100) return captures;
    key = rows.at(-1)!.log_key; position = Number(rows.at(-1)!.position);
  }
}

/** Legacy catch-up starts from saved pages. Read only the work and histories
 * those pages belong to; modern and unrelated archived plans stay in Postgres.
 * All mutation and point-read methods retain their original repository. */
export async function legacyArtifactActivityRepositories(repos: ControlPlaneRepositories,
  eligible: (artifact: Pick<ArtifactRecord, "partial" | "canonicalUrl">) => boolean,
  readCaptures: () => Promise<readonly ActivityCapture[]> = () => repos.artifacts.readAllNarrowed({ artifactId: true, workItemId: true, partial: true, canonicalUrl: true }) as Promise<ActivityCapture[]>,
): Promise<ControlPlaneRepositories | null> {
  const captures = (await readCaptures()).filter(eligible);
  const owners = [...new Set(captures.map(row => row.workItemId))].sort();
  if (!owners.length) return null;
  if (!repos.workItems.readManyNarrowed || !repos.workItems.readMany) throw new Error("LEGACY_ACTIVITY_INDEXED_READ_UNAVAILABLE");
  const metadata = await repos.workItems.readManyNarrowed(owners, { autonomousPlan: ["contract"] });
  const legacyIds = metadata.filter(row => (row.value as Pick<WorkItem, "autonomousPlan">).autonomousPlan?.contract.schemaVersion !== 2).map(row => row.id);
  if (!legacyIds.length) return null;
  const selected = new Set(legacyIds);
  const captureIds = new Set(captures.filter(row => selected.has(row.workItemId)).map(row => row.artifactId));
  const items = await repos.workItems.readMany(legacyIds);
  const log = async <T,>(repository: AppendOnlyRepository<T>): Promise<T[]> =>
    [...(await readByKeys(repository, legacyIds)).values()].flat();
  return { ...repos,
    workItems: { ...repos.workItems, list: async () => items },
    artifacts: { ...repos.artifacts,
      readAll: async () => (await log(repos.artifacts)).filter(row => captureIds.has(row.artifactId)),
      readAllNarrowed: async projection => captures.filter(row => captureIds.has(row.artifactId)).map(row => projectRecord(row, projection)),
    },
    attempts: { ...repos.attempts, list: async () => {
      if (!repos.attempts.listWhereIn || !repos.attempts.readMany) throw new Error("LEGACY_ACTIVITY_INDEXED_READ_UNAVAILABLE");
      const ids = await repos.attempts.listWhereIn(["workItemId"], legacyIds, { id: true });
      return repos.attempts.readMany(ids.map(row => row.id));
    } },
    workerResults: { ...repos.workerResults, readAll: () => log(repos.workerResults) },
  };
}

export interface AutonomousActivitySnapshot {
  readonly workItems: readonly WorkItem[];
  readonly routeTasks: readonly RouteTask[];
  readonly attempts: readonly Attempt[];
  readonly leases: readonly ExecutionLease[];
  readonly transitions: readonly RecordedTransition[];
  readonly dispositions: readonly DispositionCommit[];
  readonly artifacts: readonly ArtifactRecord[];
  readonly costs: readonly CostEntry[];
  readonly scouts: readonly ScoutResult[];
  readonly workers: readonly WorkerResultRecord[];
  readonly promotion: readonly PromotionPipelineRecord[];
}
export interface AutonomousActivityEvent {
  readonly at: string;
  readonly kind: "WORK_ITEM_CREATED" | "ATTEMPT_STARTED" | "ATTEMPT_ENDED" | "RUNG" | "ARTIFACT" | "WORKER_RESULT" | "SCOUT_RESULT" | "TRANSITION" | "DISPOSITION";
  readonly id: string;
  readonly workItemId: string;
  readonly attemptId: string | null;
  readonly routeTaskId: string | null;
  readonly artifactIds: readonly string[];
  readonly walk?: EvidenceWalkStep;
}
export interface AutonomousObligationActivity {
  /** Held inputs may originate in another canonical obligation; ownership is retained. */
  readonly referencedArtifacts: readonly ArtifactRecord[];
  readonly referencedAttempts: readonly Attempt[];
  readonly workItem: WorkItem;
  readonly jurisdiction: string | null;
  readonly capability: string | null;
  readonly recordClass: string | null;
  readonly timeline: readonly AutonomousActivityEvent[];
  /** Canonical records are returned intact: no lossy panel-specific reclassification. */
  readonly facts: AutonomousActivitySnapshot;
  readonly walk: {readonly state: "NOT_WALKED" | "OPEN" | "CLOSED"; readonly proof: ResearchWalkState | null; readonly nextUnwalkedRouteIds: readonly string[]};
  readonly evidenceGaps: readonly string[];
  readonly accounting: {readonly attemptIds: readonly string[]; readonly terminalAttemptIds: readonly string[]; readonly transitionIds: readonly string[]};
}

/** Deterministic view only. This function has no repository write or readiness-state input. */
export function projectAutonomousActivity(snapshot: AutonomousActivitySnapshot, options: { readonly observedAt?: string } = {}): readonly AutonomousObligationActivity[] {
  if(options.observedAt!==undefined && !Number.isFinite(Date.parse(options.observedAt))) throw new Error("AUTONOMOUS_ACTIVITY_CLOCK_INVALID");
  // Index once for the whole Fleet; preserve each original row and its order,
  // including repeated log records and evidence owned by another obligation.
  const indexBy = <T,>(rows: readonly T[], key: (row: T) => string) => {
    const index = new Map<string, { row: T; at: number }[]>();
    rows.forEach((row, at) => {
      const id = key(row), group = index.get(id) ?? [];
      group.push({ row, at }); index.set(id, group);
    });
    return index;
  };
  const rowsFor = <T,>(index: ReadonlyMap<string, readonly { row: T; at: number }[]>, id: string): T[] =>
    (index.get(id) ?? []).map(entry => entry.row);
  const orderedFor = <T,>(index: ReadonlyMap<string, readonly { row: T; at: number }[]>, ids: ReadonlySet<string>): T[] =>
    [...ids].flatMap(id => index.get(id) ?? []).sort((a, b) => a.at - b.at).map(entry => entry.row);
  const tasksByWork = indexBy(snapshot.routeTasks, row => row.workItemId);
  const attemptsByWork = indexBy(snapshot.attempts, row => row.workItemId);
  const attemptsById = indexBy(snapshot.attempts, row => row.id);
  const leasesByTask = indexBy(snapshot.leases, row => row.routeTaskId);
  const transitionsByWork = indexBy(snapshot.transitions, row => row.workItemId);
  const dispositionsByWork = indexBy(snapshot.dispositions, row => row.workItemId);
  const artifactsByWork = indexBy(snapshot.artifacts, row => row.workItemId);
  const artifactsById = indexBy(snapshot.artifacts, row => row.artifactId);
  const costsByWork = indexBy(snapshot.costs, row => row.workItemId);
  const scoutsByWork = indexBy(snapshot.scouts, row => row.workItemId);
  const workersByWork = indexBy(snapshot.workers, row => row.workItemId);
  const promotionByItem = indexBy(snapshot.promotion, row => row.itemId);
  const promotionByWork = new Map<string, PromotionPipelineRecord[]>();
  for (const record of snapshot.promotion) {
    if (record.stage !== "SCOUTED" || record.source.kind === "PROMOTED_CANDIDACY") continue;
    const owners = new Set(rowsFor(attemptsById, record.source.attemptId).map(attempt => attempt.workItemId));
    for (const owner of owners) {
      const group = promotionByWork.get(owner) ?? [];
      group.push(record); promotionByWork.set(owner, group);
    }
  }
  return snapshot.workItems.map((workItem): AutonomousObligationActivity => {
    const workItemId = workItem.id;
    const routeTasks = rowsFor(tasksByWork, workItemId);
    const routeTaskIds = new Set(routeTasks.map(task => task.id));
    const facts: AutonomousActivitySnapshot = {
      workItems: [workItem], routeTasks,
      attempts: rowsFor(attemptsByWork, workItemId),
      leases: orderedFor(leasesByTask, routeTaskIds),
      transitions: rowsFor(transitionsByWork, workItemId),
      dispositions: rowsFor(dispositionsByWork, workItemId),
      artifacts: rowsFor(artifactsByWork, workItemId), costs: rowsFor(costsByWork, workItemId),
      scouts: rowsFor(scoutsByWork, workItemId), workers: rowsFor(workersByWork, workItemId),
      promotion: promotionByWork.get(workItemId) ?? [],
    };
    const itemPipelineIds = new Set(facts.promotion.map(p => p.itemId));
    const fullFacts = { ...facts, promotion: orderedFor(promotionByItem, itemPipelineIds) };
    const references = referencedArtifactIds(facts.routeTasks, facts.workers);
    const referencedArtifacts=orderedFor(artifactsById,references).filter(artifact=>artifact.workItemId!==workItemId);
    const referencedAttempts=orderedFor(attemptsById,new Set(referencedArtifacts.map(artifact=>artifact.attemptId)))
      .filter(attempt=>attempt.workItemId!==workItemId);
    const heldArtifacts=[...facts.artifacts,...referencedArtifacts]; const attributableAttempts=[...facts.attempts,...referencedAttempts];
    const timeline: AutonomousActivityEvent[] = [{ at: workItem.createdAt, kind: "WORK_ITEM_CREATED", id: workItemId, workItemId,
      attemptId: null, routeTaskId: null, artifactIds: [] }];
    const gaps: string[] = [];
    for (const a of facts.attempts) {
      timeline.push({ at: a.startedAt, kind: "ATTEMPT_STARTED", id: `${a.id}:start`, workItemId, attemptId: a.id, routeTaskId: a.routeTaskId, artifactIds: [] });
      if (a.endedAt) timeline.push({ at: a.endedAt, kind: "ATTEMPT_ENDED", id: `${a.id}:end`, workItemId, attemptId: a.id, routeTaskId: a.routeTaskId, artifactIds: a.artifactIds });
    }
    for (const a of facts.artifacts) timeline.push({ at: a.recordedAt, kind: "ARTIFACT", id: a.artifactId, workItemId, attemptId: a.attemptId, routeTaskId: a.routeTaskId, artifactIds: [a.artifactId] });
    for (const t of facts.transitions) timeline.push({ at: t.transition.at, kind: "TRANSITION", id: t.transitionId, workItemId, attemptId: null, routeTaskId: null, artifactIds: [] });
    for (const d of facts.dispositions) timeline.push({ at: d.committedAt, kind: "DISPOSITION", id: d.attemptId, workItemId, attemptId: d.attemptId, routeTaskId: d.routeTaskId, artifactIds: d.disposition.artifactIds });
    for (const scout of facts.scouts) {
      timeline.push({ at: scout.recordedAt, kind: "SCOUT_RESULT", id: scout.attemptId, workItemId, attemptId: scout.attemptId, routeTaskId: scout.routeTaskId, artifactIds: scout.artifactIds });
      const attempt = facts.attempts.find(a => a.id === scout.attemptId);
      if (!attempt) { gaps.push(`SCOUT_ATTEMPT_MISSING:${scout.attemptId}`); continue; }
      for (const rung of scout.rungs) {
        // Older fields remain unknown; a model note never fills the gap.
        if (rung.transport === undefined) gaps.push(`LEGACY_TRANSPORT_NOT_RECORDED:${scout.attemptId}:${rung.index}`);
        const walk: EvidenceWalkStep = { sequence: rung.index, at: rung.at, worker: attempt.worker, attemptId: attempt.id,
          routeId: scout.routeId ?? scout.routeTaskId, rung: rung.rung, target: rung.target,
          applicableBecause: rung.applicableBecause ?? "Applicability reason not recorded by the legacy tool",
          permission: rung.permission ?? "CANNOT_TELL", transport: rung.transport ?? "NOT_ATTEMPTED", observed: rung.observed,
          returnedCount: rung.returnedCount ?? null, artifactIds: rung.artifactIds, nextRouteIds: rung.nextHopUrls ?? [],
          outcome: rung.ok === false ? "BLOCKED" : rung.returnedCount === 0 ? "WALKED_AND_EMPTY" : rung.artifactIds.length ? "WALKED_AND_FOUND" : "NOT_WALKED",
          pass: "INITIAL" };
        timeline.push({ at: rung.at, kind: "RUNG", id: `${scout.attemptId}:rung:${rung.index}`, workItemId, attemptId: attempt.id, routeTaskId: scout.routeTaskId, artifactIds: rung.artifactIds, walk });
      }
    }
    let closed: ResearchWalkState | null = null;
    const namedNext = new Set<string>();
    for (const record of [...facts.workers].sort((a,b) => a.endedAt.localeCompare(b.endedAt))) {
      const a = facts.attempts.find(x => x.id === record.attemptId);
      const task = facts.routeTasks.find(x => x.id === record.routeTaskId);
      try {
        if (!a || a.outcome !== "COMPLETED" || !task || task.state !== "RESULT_RECORDED" || task.workerTask?.role !== record.result.role ||
          a.worker.instance !== record.worker.instance || a.endedAt !== record.endedAt ||
          canonicalJson(a)!==canonicalJson(record.completion.closedAttempt) || canonicalJson(task)!==canonicalJson(record.completion.completedTask)) throw new Error("UNCOMMITTED_OR_MISMATCHED_RESULT");
        assertFleetResult(record.result, task.workerTask.role, a.id);
      } catch { gaps.push(`WORKER_RESULT_UNPROVEN:${record.id}`); continue; }
      timeline.push({ at: record.endedAt, kind: "WORKER_RESULT", id: record.id, workItemId, attemptId: record.attemptId, routeTaskId: record.routeTaskId, artifactIds: record.inputArtifactIds });
      if (record.result.role === "ACQUIRER" || record.result.role === "DETECTIVE") {
        assertResearchWalk(record.result.walk, record.result.walkState);
        const attributable = record.result.walk.every(rung => attributableAttempts.some(attempt => attempt.id===rung.attemptId &&
          rung.artifactIds.every(id => attempt.artifactIds.includes(id) || heldArtifacts.some(artifact=>artifact.artifactId===id && artifact.attemptId===attempt.id)))) &&
          record.result.walk.every(rung=>rung.artifactIds.every(id=>heldArtifacts.some(artifact=>artifact.artifactId===id)));
        if(!attributable) { gaps.push(`WORKER_WALK_ATTRIBUTION_UNPROVEN:${record.id}`); continue; }
        for (const rung of record.result.walk) timeline.push({ at: rung.at, kind: "RUNG", id: `${record.id}:rung:${rung.sequence}`, workItemId,
          attemptId: rung.attemptId, routeTaskId: record.routeTaskId, artifactIds: rung.artifactIds, walk: rung });
        if (record.result.walkState.state === "CLOSED") {
          const supported=record.result.role==="DETECTIVE"&&record.result.verdict==="SUPPORTED"&&record.result.blockers.length===0&&
            record.result.burden==="EVIDENCE_SUPPORTED_PENDING_INDEPENDENT_VALIDATION"&&record.result.walkState.supportingArtifactIds.every(id=>
              record.result.role==="DETECTIVE"&&record.result.spans.some(span=>span.artifactId===id&&heldArtifacts.some(artifact=>artifact.artifactId===id&&artifact.contentHash===span.contentHash)&&
                Number.isSafeInteger(span.start)&&Number.isSafeInteger(span.end)&&span.start>=0&&span.end>span.start&&span.quote.length===span.end-span.start));
          if(!supported) gaps.push(`CLOSED_WALK_RESULT_NOT_EVIDENCE_SUPPORTED:${record.id}`);
          else if(!options.observedAt) gaps.push(`CLOSED_WALK_FRESHNESS_UNOBSERVED:${record.id}`);
          else if(Date.parse(record.result.walkState.expiresAt)<=Date.parse(options.observedAt)) gaps.push(`CLOSED_WALK_EXPIRED:${record.id}`);
          else closed = record.result.walkState;
        }
        else for (const route of record.result.walkState.nextRouteIds) namedNext.add(route);
      }
    }
    for (const task of facts.routeTasks) if (["PENDING", "RECLAIMABLE", "POLICY_DENIED", "CLAIMED"].includes(task.state)) namedNext.add(task.routeId);
    for (const scout of facts.scouts) for (const next of scout.nextRungs) namedNext.add(next);
    const walked = timeline.some(e => e.kind === "RUNG" && e.walk?.outcome !== "NOT_WALKED") || facts.dispositions.length > 0;
    // A closed proof is scoped to its ladder and expires. Later open work never disappears behind it.
    if (namedNext.size) closed = null;
    const plan = workItem.autonomousPlan;
    const contract = plan?.contract ?? facts.routeTasks.find(t => t.workerTask)?.workerTask?.contract;
    return { workItem, referencedArtifacts, referencedAttempts, jurisdiction: plan?.jurisdiction ?? (contract?.schemaVersion === 2 ? contract.jurisdiction.canonicalId : null),
      capability: plan?.capability ?? null, recordClass: contract?.recordClass ?? facts.scouts[0]?.recordClass ?? null,
      timeline: timeline.sort((a,b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)), facts: fullFacts,
      walk: { state: closed ? "CLOSED" : walked ? "OPEN" : "NOT_WALKED", proof: closed, nextUnwalkedRouteIds: [...namedNext].sort() },
      evidenceGaps: [...new Set(gaps)].sort(), accounting: {attemptIds: facts.attempts.map(a => a.id).sort(),
        terminalAttemptIds: facts.attempts.filter(a => a.outcome !== null).map(a => a.id).sort(), transitionIds: facts.transitions.map(t => t.transitionId).sort()} };
  }).sort((a,b) => a.workItem.id.localeCompare(b.workItem.id));
}

function referencedArtifactIds(tasks: readonly RouteTask[], workers: readonly WorkerResultRecord[]): Set<string> {
  const references = new Set(workers.flatMap(record => record.inputArtifactIds));
  for (const task of tasks) {
    const spec = task.workerTask;
    if (!spec) continue;
    references.add(spec.artifactId);
    if (spec.acquisition) {
      references.add(spec.acquisition.route.observation.artifactId);
      for (const span of spec.acquisition.route.publisherSubjectEvidence) references.add(span.artifactId);
    }
    if (spec.contract.schemaVersion === 2) for (const id of [...spec.contract.sourceScope.observationArtifactIds,
      ...spec.contract.verification.authorities.flatMap(authority => [...authority.artifactIds, ...authority.authorityEvidenceArtifactIds])]) references.add(id);
  }
  return references;
}

async function matchingKeys<T>(log: AppendOnlyRepository<T>, path: readonly string[], values: readonly string[]): Promise<string[]> {
  if (!log.keysWhere) throw new Error("ACTIVITY_INDEXED_LOOKUP_UNAVAILABLE");
  const keys = new Set<string>();
  for (const value of new Set(values)) for (const key of await log.keysWhere(path, value)) keys.add(key);
  return [...keys].sort();
}

export async function readAutonomousActivity(repos: ControlPlaneRepositories, workItemIds: readonly string[], options: {
  readonly observedAt?: string;
  readonly workItems?: readonly WorkItem[];
  readonly scouts?: readonly ScoutResult[];
} = {}) {
  const ids = [...new Set(workItemIds)].sort();
  const selected = new Set(ids);
  const records = async <T,>(log: AppendOnlyRepository<T>, keys: readonly string[]) => [...(await readByKeys(log, keys)).values()].flat();
  const [items, tasks, ownAttempts, transitions, costs, workers, scoutKeys] = await Promise.all([
    options.workItems ? Promise.resolve(options.workItems.filter(item => selected.has(item.id))) : Promise.all(ids.map(id => repos.workItems.mustRead(id))).then(rows => rows.map(row => row.value)),
    Promise.all(ids.map(id => repos.routeTasks.listWhere(["workItemId"], id))).then(groups => groups.flat().map(row => row.value)),
    Promise.all(ids.map(id => repos.attempts.listWhere(["workItemId"], id))).then(groups => groups.flat().map(row => row.value)),
    records(repos.transitions, ids), records(repos.costs, ids), records(repos.workerResults, ids),
    options.scouts ? Promise.resolve([]) : matchingKeys(repos.scoutResults, ["workItemId"], ids),
  ]);
  const [leases, dispositions, referenceKeys, scouts, promotionKeys] = await Promise.all([
    Promise.all(tasks.map(task => repos.leases.read(task.id))).then(rows => rows.filter(row => row !== null).map(row => row.value)),
    records(repos.dispositions, tasks.map(task => task.id)),
    matchingKeys(repos.artifacts, ["artifactId"], [...referencedArtifactIds(tasks, workers)]),
    options.scouts ?? records(repos.scoutResults, scoutKeys),
    matchingKeys(repos.promotionPipeline, ["source", "attemptId"], ownAttempts.map(attempt => attempt.id)),
  ]);
  const [artifacts, promotion] = await Promise.all([
    records(repos.artifacts, [...new Set([...ids, ...referenceKeys])].sort()), records(repos.promotionPipeline, promotionKeys),
  ]);
  const attempts = new Map(ownAttempts.map(attempt => [attempt.id, attempt]));
  for (const id of new Set(artifacts.filter(artifact => !selected.has(artifact.workItemId)).map(artifact => artifact.attemptId))) {
    if (!attempts.has(id)) { const row = await repos.attempts.read(id); if (row) attempts.set(id, row.value); }
  }
  return projectAutonomousActivity({ workItems: items, routeTasks: tasks,
    attempts: [...attempts.values()].sort((a, b) => a.id.localeCompare(b.id)), leases, transitions, dispositions,
    artifacts, costs, scouts, workers, promotion }, { observedAt: options.observedAt ?? new Date().toISOString() });
}
