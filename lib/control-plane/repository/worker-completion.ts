import { indexDetectiveFindings } from "../box.ts";
import { endAttempt, isExpired, release, type Attempt } from "../attempt.ts";
import type { AuditFinding, ValidationRecord } from "../audit.ts";
import type { RouteTask } from "../route-task.ts";
import { canonicalJson, readByKeys, type ControlPlaneRepositories } from "./types.ts";
import { recordCost, transitionWorkItem } from "./coordinator.ts";
import { assertFleetResult, type WorkerResultRecord } from "../workers/types.ts";
import { costEntryWithModel, type CostEntry } from "../cost.ts";

export type UncommittedWorkerResult = Omit<WorkerResultRecord, "completion">;

/** A result append, like a disposition append, commits all its dependent aggregate writes. */
export async function completeWorkerTask(repos: ControlPlaneRepositories, result: UncommittedWorkerResult): Promise<WorkerResultRecord> {
  const task = await repos.routeTasks.mustRead(result.routeTaskId);
  const attempt = await repos.attempts.mustRead(result.attemptId);
  const lease = await repos.leases.mustRead(result.routeTaskId);
  const spec = task.value.workerTask;
  if (!spec || spec.role !== result.worker.role || attempt.value.outcome !== null ||
      attempt.value.workItemId !== result.workItemId || attempt.value.routeTaskId !== task.id ||
      canonicalJson(attempt.value.worker) !== canonicalJson(result.worker) ||
      lease.value.id !== attempt.value.leaseId || lease.value.holder !== result.worker.instance ||
      lease.value.released || isExpired(lease.value, result.endedAt)) throw new Error("WORKER_COMPLETION_LEASE_OR_IDENTITY_REFUSED");
  assertFleetResult(result.result, spec.role, attempt.id);
  const closedAttempt = endAttempt(attempt.value, "COMPLETED", result.endedAt, { cost: result.cost, artifactIds: result.inputArtifactIds });
  const committed: WorkerResultRecord = {
    ...result,
    completion: {
      closedAttempt,
      completedTask: { ...task.value, state: "RESULT_RECORDED", attemptIds: [...new Set([...task.value.attemptIds, attempt.id])] },
      taskRevision: task.revision,
      attemptRevision: attempt.revision,
    },
  };
  await repos.workerResults.append(result.workItemId, result.id, committed, result.endedAt);
  await applyWorkerCompletion(repos, committed);
  if (committed.result.role === "DETECTIVE") {
    await indexDetectiveFindings(repos.boxFindings, { ...committed, result: committed.result },
      new Map((await repos.artifacts.readAll()).map(artifact => [artifact.artifactId, artifact])), committed.endedAt);
  }
  return committed;
}

export async function applyWorkerCompletion(repos: ControlPlaneRepositories, record: WorkerResultRecord, costAlreadyApplied = false): Promise<void> {
  const { completion: c, endedAt: now } = record;
  const attempt = await repos.attempts.mustRead(record.attemptId);
  if (canonicalJson(attempt.value) !== canonicalJson(c.closedAttempt)) {
    if (attempt.revision !== c.attemptRevision) throw new Error("WORKER_COMPLETION_CONCURRENT_ATTEMPT");
    await repos.attempts.compareAndSet(attempt.id, c.attemptRevision, c.closedAttempt, now);
  }
  const task = await repos.routeTasks.mustRead(record.routeTaskId);
  if (canonicalJson(task.value) !== canonicalJson(c.completedTask)) {
    if (task.revision !== c.taskRevision) throw new Error("WORKER_COMPLETION_CONCURRENT_TASK");
    await repos.routeTasks.compareAndSet(task.id, c.taskRevision, c.completedTask, now);
  }
  const lease = await repos.leases.read(record.routeTaskId);
  if (lease && !lease.value.released && lease.value.id === c.closedAttempt.leaseId) {
    await repos.leases.compareAndSet(lease.id, lease.revision, release(lease.value), now);
  }
  if (!costAlreadyApplied) await recordCost(repos, {
    attemptId: record.attemptId, workItemId: record.workItemId, routeTaskId: record.routeTaskId,
    routeId: task.value.routeId, source: task.value.target, jurisdiction: task.value.workerTask!.contract.subjectId,
    project: record.grant.project, role: record.worker.role, cost: record.cost, recordedAt: now,
    model: record.executionMode === "MODEL_ASSISTED" ? (record.modelParse?.model ?? record.modelReview?.model ?? record.worker.version) : null,
    ...(record.modelParse?.byModel ? { byModel: record.modelParse.byModel } : {}),
  }, now);
  // An explicitly requested replay measures reproducibility. Its Attempt,
  // result and accounting survive, but it cannot rewind the civic workflow.
  if (c.completedTask.workerTask?.purpose === "DIAGNOSTIC_REPLAY") return;
  const result = record.result;
  // Research computation never rewinds an obligation already awaiting independent review.
  // Its blockers and next actions are canonical in the result, not civic dispositions.
  if (result.role === "ACQUIRER" || result.role === "DETECTIVE") return;
  const to = result.role === "PARSER" ? (result.verdict === "EXTRACTED" ? "AWAITING_VALIDATION" : "BLOCKED")
    : result.role === "VALIDATOR" ? (result.verdict === "PASS" ? "AWAITING_AUDIT" : "BLOCKED")
    : result.verdict === "BROKE" ? "REOPENED" : result.verdict === "INCONCLUSIVE" ? "BLOCKED" : "OPEN";
  const findings = result.role === "PARSER" ? result.warnings : result.findings;
  const why = `${result.role} ${result.verdict}; result ${record.id}; ${findings.map(f => f.code).join(", ") || "no blocking findings"}. ` +
    "This scoped worker result confers no canonical promotion or whole-obligation completion.";
  const by = `worker-result:${record.id}`;
  const item = await repos.workItems.mustRead(record.workItemId);
  if (!item.value.transitions.some(t => t.by === by)) {
    await transitionWorkItem(repos, { workItemId: item.id, to, by, why, now });
  }
  if (result.role === "ADVERSARIAL_AUDITOR" && result.verdict === "BROKE") {
    for (const dependent of await repos.workItems.list()) {
      if (dependent.value.dependencies.some(d => d.upstreamId === item.id) && !dependent.value.transitions.some(t => t.by === by)) {
        await transitionWorkItem(repos, { workItemId: dependent.id, to: "REOPENED", by, why, now });
      }
    }
  }
}

/** How far before a process's last pass its next pass re-reads appended results, so a writer's clock running ahead loses none. */
export const RECONCILE_APPEND_SLACK_MS = 10 * 60_000;

/** Per process and store: the first pass reads every result; later passes read what was appended since (with slack) plus those still pending. */
const reconcileState = new WeakMap<ControlPlaneRepositories, { since: string; pending: Map<string, WorkerResultRecord> }>();

async function readByIds<T>(repo: { readMany?(ids: readonly string[]): Promise<readonly { id: string; value: T }[]>; read(id: string): Promise<{ id: string; value: T } | null> },
  ids: readonly string[]): Promise<Map<string, T>> {
  const unique = [...new Set(ids)];
  const rows = repo.readMany ? await repo.readMany(unique)
    : (await Promise.all(unique.map(id => repo.read(id)))).filter((row): row is { id: string; value: T } => row !== null);
  return new Map(rows.map(row => [row.id, row.value]));
}

export async function reconcileWorkerCompletions(repos: ControlPlaneRepositories): Promise<void> {
  const passStartedAt = new Date().toISOString();
  const state = reconcileState.get(repos);
  const appended = state === undefined ? await repos.workerResults.readAll()
    : await repos.workerResults.readSince(new Date(Date.parse(state.since) - RECONCILE_APPEND_SLACK_MS).toISOString());
  const candidates = new Map(state?.pending ?? []);
  for (const record of appended) candidates.set(record.id, record);
  const records = [...candidates.values()];
  if (records.length === 0) { reconcileState.set(repos, { since: passStartedAt, pending: new Map() }); return; }
  // Only exact, fully applied commits skip replay; incomplete projections use the guarded writer.
  // Only the rows these results name are read.
  const itemIds = [...new Set(records.map(record => record.workItemId))];
  const needsDependents = records.some(record => record.result.role === "ADVERSARIAL_AUDITOR" && record.result.verdict === "BROKE");
  const [attempts, tasks, leases, costs, items, dependentRows] = await Promise.all([
    readByIds(repos.attempts, records.map(record => record.attemptId)),
    readByIds(repos.routeTasks, records.map(record => record.routeTaskId)),
    readByIds(repos.leases, records.map(record => record.routeTaskId)),
    Promise.all(itemIds.map(id => repos.costs.read(id))).then(rows => rows.flat()),
    readByIds(repos.workItems, itemIds),
    /* Dependents of a broken audit have no index to find them by; only that rare case lists the work items. */
    needsDependents ? repos.workItems.list() : Promise.resolve([]),
  ]);
  const itemRows = dependentRows;
  const stillPending = new Map<string, WorkerResultRecord>();
  const costsByAttempt = new Map<string, CostEntry[]>();
  for (const cost of costs) {
    const rows = costsByAttempt.get(cost.attemptId) ?? [];
    rows.push(cost);
    costsByAttempt.set(cost.attemptId, rows);
  }
  for (const record of records) {
    const task = tasks.get(record.routeTaskId);
    const lease = leases.get(record.routeTaskId);
    const result = record.result;
    const noTransition = record.completion.completedTask.workerTask?.purpose === "DIAGNOSTIC_REPLAY" ||
      result.role === "ACQUIRER" || result.role === "DETECTIVE";
    const transitioned = noTransition || items.get(record.workItemId)?.transitions.some(t => t.by === `worker-result:${record.id}`);
    const expectedCost = task?.workerTask ? costEntryWithModel({
      attemptId: record.attemptId, workItemId: record.workItemId, routeTaskId: record.routeTaskId,
      routeId: task.routeId, source: task.target, jurisdiction: task.workerTask.contract.subjectId,
      project: record.grant.project, role: record.worker.role, cost: record.cost, recordedAt: record.endedAt,
      model: record.executionMode === "MODEL_ASSISTED" ? (record.modelParse?.model ?? record.modelReview?.model ?? record.worker.version) : null,
      ...(record.modelParse?.byModel ? { byModel: record.modelParse.byModel } : {}),
    }, record.executionMode === "MODEL_ASSISTED" ? (record.modelParse?.model ?? record.modelReview?.model ?? record.worker.version) : null) : null;
    // Cost annotations were added after these immutable charges: compare under today's shape without rewriting history.
    const costApplied = expectedCost !== null && (costsByAttempt.get(record.attemptId) ?? []).some(cost =>
      canonicalJson(costEntryWithModel(cost, expectedCost.model ?? null)) === canonicalJson(expectedCost));
    const dependentsApplied = noTransition || result.role !== "ADVERSARIAL_AUDITOR" || result.verdict !== "BROKE" ||
      itemRows.every(row => !row.value.dependencies.some(d => d.upstreamId === record.workItemId) ||
        row.value.transitions.some(t => t.by === `worker-result:${record.id}`));
    if (task && canonicalJson(task) === canonicalJson(record.completion.completedTask) &&
        canonicalJson(attempts.get(record.attemptId) ?? null) === canonicalJson(record.completion.closedAttempt) &&
        (!lease || lease.released || lease.id !== record.completion.closedAttempt.leaseId) &&
        costApplied && transitioned && dependentsApplied) continue;
    /* Applied now; checked again next pass, so a failed apply is retried and never dropped. */
    stillPending.set(record.id, record);
    await applyWorkerCompletion(repos, record, costApplied);
  }
  reconcileState.set(repos, { since: passStartedAt, pending: stillPending });
}

/** Result consumers never accept output from an uncommitted, dead, or mismatched producer. */
export async function readCompletedWorkerResult(repos: ControlPlaneRepositories, id: string): Promise<{ record: WorkerResultRecord; attempt: Attempt }> {
  const record = (await repos.workerResults.readAll()).find(r => r.id === id);
  if (!record) throw new Error("WORKER_RESULT_MISSING");
  const attempt = (await repos.attempts.mustRead(record.attemptId)).value;
  assertCompletedWorkerResult(record, attempt);
  return { record, attempt };
}

function assertCompletedWorkerResult(record: WorkerResultRecord, attempt: Attempt): void {
  if (attempt.outcome !== "COMPLETED" || canonicalJson(attempt) !== canonicalJson(record.completion.closedAttempt)) throw new Error("WORKER_RESULT_UNCOMMITTED_PRODUCER");
  assertFleetResult(record.result, record.completion.completedTask.workerTask!.role, attempt.id);
}

/** Reads the named Attempts by id (batched where the store can); ids with no row are left out. */
async function readAttemptsById(repos: ControlPlaneRepositories, ids: readonly string[]) {
  const unique = [...new Set(ids)];
  if (repos.attempts.readMany) return repos.attempts.readMany(unique);
  const rows: { readonly id: string; readonly value: Attempt }[] = [];
  for (let at = 0; at < unique.length; at += 16) {
    for (const row of await Promise.all(unique.slice(at, at + 16).map(id => repos.attempts.read(id)))) if (row) rows.push(row);
  }
  return rows;
}

/** Same exact producer validation as a point read, with bounded repository reads for inherited history. */
export async function readCompletedWorkerResults(repos: ControlPlaneRepositories, workItemId?: string): Promise<readonly WorkerResultRecord[]> {
  /* One item's results can only have been produced by that item's Attempts
     (`completeWorkerTask` refuses a result whose Attempt belongs to another
     item), so an item-scoped read lists only those Attempts. */
  /* The unscoped read point-reads each result's own Attempt by id rather than listing all Attempts. */
  const [records, scopedAttempts] = await Promise.all([
    workItemId === undefined ? repos.workerResults.readAll() : repos.workerResults.read(workItemId),
    workItemId === undefined ? Promise.resolve(null) : repos.attempts.listWhere(["workItemId"], workItemId),
  ]);
  const attemptRows = scopedAttempts ?? await readAttemptsById(repos, records.map(record => record.attemptId));
  const attempts = new Map(attemptRows.map(row => [row.id, row.value]));
  return records.filter(record => {
    const attempt = attempts.get(record.attemptId);
    if (!attempt) return false;
    try { assertCompletedWorkerResult(record, attempt); return true; }
    catch { return false; /* Uncommitted or malformed history is never inherited as evidence. */ }
  });
}

/** `readCompletedWorkerResults` for the named work items only, in one batched read of their results and of each result's own Attempt. */
export async function readCompletedWorkerResultsOf(repos: ControlPlaneRepositories, workItemIds: readonly string[]): Promise<readonly WorkerResultRecord[]> {
  const records = [...(await readByKeys(repos.workerResults, workItemIds)).values()].flat();
  const attempts = new Map((await readAttemptsById(repos, records.map(record => record.attemptId))).map(row => [row.id, row.value]));
  return records.filter(record => {
    const attempt = attempts.get(record.attemptId);
    if (!attempt) return false;
    try { assertCompletedWorkerResult(record, attempt); return true; }
    catch { return false; }
  });
}

export interface WorkerCompletionEvidence {
  /** When true, these records replace legacy caller assertions for this item. */
  readonly managed: boolean;
  readonly latestProducerAttemptId: string | null;
  readonly validations: readonly ValidationRecord[];
  readonly audits: readonly AuditFinding[];
}

interface ExecutionHead {
  readonly task: RouteTask;
  readonly attempt: Attempt | null;
  readonly at: number;
}

function executionHead(tasks: readonly RouteTask[], attempts: readonly Attempt[]): ExecutionHead | null {
  const heads = tasks.map((task) => {
    const executions = attempts.filter((attempt) => attempt.routeTaskId === task.id)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    const attempt = executions[0] ?? null;
    return { task, attempt, at: Math.max(Date.parse(task.createdAt), attempt ? Date.parse(attempt.startedAt) : -Infinity) };
  }).sort((a, b) => b.at - a.at);
  // An unordered tie is not proof that the more convenient candidate is latest.
  return heads.length === 0 || !Number.isFinite(heads[0].at) || (heads.length > 1 && heads[0].at === heads[1].at) ? null : heads[0];
}

/** One aggregate validation, so a good artifact cannot hide another pending or failed one. */
export async function loadWorkerCompletionEvidence(repos: ControlPlaneRepositories, workItemId: string): Promise<WorkerCompletionEvidence> {
  /* One work item's rows only, filtered in the database. */
  const [taskRows, attemptRows, allResults] = await Promise.all([
    repos.routeTasks.listWhere(["workItemId"], workItemId),
    repos.attempts.listWhere(["workItemId"], workItemId),
    repos.workerResults.read(workItemId),
  ]);
  const tasks = taskRows.map((row) => row.value).filter((task) => task.workItemId === workItemId &&
    task.workerTask && task.workerTask.purpose !== "DIAGNOSTIC_REPLAY");
  if (tasks.length === 0) return { managed: false, latestProducerAttemptId: null, validations: [], audits: [] };
  const attempts = attemptRows.map((row) => row.value).filter((attempt) => attempt.workItemId === workItemId);
  const byAttempt = new Map(attempts.map((attempt) => [attempt.id, attempt]));
  const byTask = new Map(tasks.map((task) => [task.id, task]));
  const results = new Map(allResults.filter((record) => record.workItemId === workItemId).map((record) => [record.id, record]));
  const complete = (record: WorkerResultRecord | null | undefined): record is WorkerResultRecord => {
    if (!record) return false;
    const attempt = byAttempt.get(record.attemptId);
    const task = byTask.get(record.routeTaskId);
    if (!attempt || !task?.workerTask || task.state !== "RESULT_RECORDED" || attempt.outcome !== "COMPLETED" ||
        record.result.attemptId !== attempt.id || record.result.role !== task.workerTask.role ||
        record.worker.role !== record.result.role || canonicalJson(record.worker) !== canonicalJson(attempt.worker) ||
        canonicalJson(attempt) !== canonicalJson(record.completion.closedAttempt) ||
        canonicalJson(task) !== canonicalJson(record.completion.completedTask) ||
        !record.inputArtifactIds.includes(task.workerTask.artifactId)) return false;
    try { assertFleetResult(record.result, task.workerTask.role, attempt.id); return true; }
    catch { return false; }
  };
  const atHead = (head: ExecutionHead | null): WorkerResultRecord | null => {
    if (!head?.attempt || head.task.state !== "RESULT_RECORDED") return null;
    const record = [...results.values()].find((value) => value.attemptId === head.attempt!.id);
    return complete(record) ? record : null;
  };
  const producerOf = (record: WorkerResultRecord): WorkerResultRecord | null => {
    const spec = record.completion.completedTask.workerTask!;
    const producer = spec.producerResultId ? results.get(spec.producerResultId) : null;
    if (!complete(producer) || producer.result.role !== "PARSER" || producer.result.verdict !== "EXTRACTED" ||
        producer.result.artifactId !== spec.artifactId || (record.result.role !== "VALIDATOR" && record.result.role !== "ADVERSARIAL_AUDITOR") ||
        record.result.producerAttemptId !== producer.attemptId || !record.inputResultIds.includes(producer.id) ||
        canonicalJson(producer.completion.completedTask.workerTask!.contract) !== canonicalJson(spec.contract) ||
        producer.worker.instance === record.worker.instance || !producer.worker.instance.trim() || !record.worker.instance.trim()) return null;
    return producer;
  };
  const validationFor = (record: WorkerResultRecord, producer: WorkerResultRecord): boolean =>
    complete(record) && record.result.role === "VALIDATOR" && record.result.verdict === "PASS" &&
    producerOf(record)?.id === producer.id && record.worker.role === "VALIDATOR";
  const auditChain = (record: WorkerResultRecord): { producer: WorkerResultRecord; validator: WorkerResultRecord } | null => {
    if (!complete(record) || record.result.role !== "ADVERSARIAL_AUDITOR") return null;
    const producer = producerOf(record);
    const validatorId = record.completion.completedTask.workerTask!.validatorResultId;
    const validator = validatorId ? results.get(validatorId) : null;
    if (!producer || !validator || !validationFor(validator, producer) ||
        record.result.validatorAttemptId !== validator.attemptId || !record.inputResultIds.includes(validator.id) ||
        new Set([record.worker.instance, producer.worker.instance, validator.worker.instance]).size !== 3 ||
        new Set([record.attemptId, producer.attemptId, validator.attemptId]).size !== 3) return null;
    return { producer, validator };
  };
  const sourceSurvived = (record: WorkerResultRecord | null): boolean => {
    if (!record || record.result.role !== "ADVERSARIAL_AUDITOR" || record.result.verdict !== "SURVIVED" ||
        record.completion.completedTask.workerTask!.auditScope !== "SOURCE_UNIVERSE" ||
        record.result.startedFrom.includes("OUR_SUMMARY") || record.result.findings.some((finding) => finding.severity === "BLOCKING") ||
        record.result.attacks.some((attack) => attack.applicable && (!attack.executed || attack.verdict !== "SURVIVED"))) return false;
    const bases = record.result.startedFrom;
    return ["CANONICAL_SUBJECT_IDENTITY", "PUBLISHER_SOURCE_UNIVERSE", "METHOD_REGISTRY", "EVIDENCE_VAULT"].every((basis) => bases.includes(basis as typeof bases[number]));
  };

  const artifactIds = [...new Set(tasks.map((task) => task.workerTask!.artifactId))];
  const reasons: string[] = [];
  const checked = new Set<string>(["LATEST_EXACT_WORKER_CHAINS"]);
  const producers: Attempt[] = [];
  const latestAudits = new Map<string, WorkerResultRecord>();
  let everyArtifactValidated = true;
  let everyArtifactAudited = true;
  let latestAt = 0;
  for (const artifactId of artifactIds) {
    const owned = tasks.filter((task) => task.workerTask!.artifactId === artifactId);
    const producerHead = executionHead(owned.filter((task) => task.workerTask!.role === "PARSER"), attempts);
    if (producerHead?.attempt) producers.push(producerHead.attempt);
    latestAt = Math.max(latestAt, ...owned.map((task) => Date.parse(task.createdAt)), ...owned.flatMap((task) => attempts.filter((attempt) => attempt.routeTaskId === task.id).map((attempt) => Date.parse(attempt.startedAt))));
    const producer = atHead(producerHead);
    if (!producer || producer.result.role !== "PARSER" || producer.result.verdict !== "EXTRACTED") {
      everyArtifactValidated = false; everyArtifactAudited = false;
      reasons.push(`${artifactId}: latest Parser is pending, failed, ambiguous, or not durably committed.`);
      continue;
    }
    const validatorHead = executionHead(owned.filter((task) => task.workerTask!.role === "VALIDATOR" && task.workerTask!.producerResultId === producer.id), attempts);
    const validator = atHead(validatorHead);
    if (!validator || !validationFor(validator, producer)) {
      everyArtifactValidated = false; everyArtifactAudited = false;
      reasons.push(`${artifactId}: latest Validator does not PASS the exact current Parser Attempt.`);
      continue;
    }
    if (validator.result.role === "VALIDATOR") for (const name of validator.result.checked) checked.add(name);
    const auditorHead = executionHead(owned.filter((task) => task.workerTask!.role === "ADVERSARIAL_AUDITOR" && task.workerTask!.producerResultId === producer.id), attempts);
    const auditor = atHead(auditorHead);
    const chain = auditor ? auditChain(auditor) : null;
    if (!auditor || !chain || chain.producer.id !== producer.id || chain.validator.id !== validator.id) {
      everyArtifactAudited = false;
      reasons.push(`${artifactId}: no current independent Auditor is bound to both exact current producer and Validator.`);
      continue;
    }
    latestAudits.set(artifactId, auditor);
    if (!sourceSurvived(auditor)) {
      everyArtifactAudited = false;
      reasons.push(`${artifactId}: latest audit ${auditor.result.verdict} covers ${auditor.completion.completedTask.workerTask!.auditScope}; whole-obligation audit is not earned.`);
    }
  }
  const audits: AuditFinding[] = [];
  for (const record of results.values()) {
    if (record.result.role !== "ADVERSARIAL_AUDITOR" || record.result.verdict !== "BROKE" || !auditChain(record)) continue;
    const artifactId = record.completion.completedTask.workerTask!.artifactId;
    const latest = latestAudits.get(artifactId) ?? null;
    const currentChain = latest ? auditChain(latest) : null;
    // A different artifact or a captured-only rerun cannot erase this failure.
    const superseded = latest !== null && sourceSurvived(latest) && currentChain !== null &&
      Date.parse(currentChain.producer.startedAt) > Date.parse(record.endedAt) &&
      Date.parse(currentChain.validator.startedAt) > Date.parse(record.endedAt) &&
      Date.parse(latest.startedAt) > Date.parse(record.endedAt);
    if (superseded) continue;
    audits.push({ id: `worker-audit:${record.id}`, workItemId, mode: record.result.attacks.find((attack) => attack.verdict === "BROKE")?.mode ?? "OPERATIONAL",
      severity: "HIGH", survived: false, startedFrom: record.result.startedFrom, at: record.endedAt, resolvedAt: null,
      detail: `${record.id} BROKE ${artifactId}: ${record.result.findings.map((finding) => finding.code).join(", ")}. A newer exact independent source-universe chain has not superseded it.` });
  }
  const at = new Date(Number.isFinite(latestAt) ? latestAt : 0).toISOString();
  if (everyArtifactValidated && everyArtifactAudited && audits.length === 0) {
    audits.push({ id: `worker-audit-chain:${[...latestAudits.values()].map((record) => record.id).sort().join(":")}`, workItemId,
      mode: "SOURCE_UNIVERSE", severity: "LOW", survived: true,
      startedFrom: ["CANONICAL_SUBJECT_IDENTITY", "PUBLISHER_SOURCE_UNIVERSE", "METHOD_REGISTRY", "EVIDENCE_VAULT"],
      at, resolvedAt: null, detail: `All ${artifactIds.length} current artifact chains survived source-universe audits with exact independent producer/Validator bindings.` });
  }
  producers.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  return { managed: true, latestProducerAttemptId: producers[0]?.id ?? null,
    validations: [{ workItemId, passed: everyArtifactValidated, at, by: "worker-completion-evidence",
      checked: [...checked], detail: reasons.length ? reasons.join(" ") : `All ${artifactIds.length} latest immutable-artifact chains passed exact independent validation.` }], audits };
}
