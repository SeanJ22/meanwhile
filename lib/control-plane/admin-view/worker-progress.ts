import type { Attempt, ExecutionLease } from "../attempt.ts";
import { unreachable, type ReadOutcome } from "../admin-data.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { RouteTask } from "../route-task.ts";
import type { ScoutResult } from "../scheduler/scout-result.ts";
import type { WorkItem } from "../work-item.ts";
import type { WorkerResultRecord } from "../workers/types.ts";

export const WORKER_PROGRESS_VERSION = "worker-progress/v1" as const;
export const WORKER_PROGRESS_DEFAULT_LIMIT = 40;
export const WORKER_PROGRESS_MAX_LIMIT = 100;
const READ_CONCURRENCY = 16;

export type WorkerProgressEvent = {
  readonly id: string;
  readonly workItemId: string;
  readonly routeTaskId: string;
  readonly attemptId: string;
  readonly role: string;
  readonly at: string | null;
  readonly kind: "ATTEMPT_STARTED" | "RESULT_RECORDED" | "ATTEMPT_ENDED";
  readonly outcome: string | null;
  /** Only an unclosed Attempt with a live lease can be called active. */
  readonly active: boolean;
  readonly evidenceId: string;
};

export interface WorkerProgressRead {
  readonly formatVersion: typeof WORKER_PROGRESS_VERSION;
  readonly observedAt: string;
  readonly workItemId: string;
  readonly workState: WorkItem["state"];
  readonly totalEvents: number;
  readonly returnedEvents: number;
  readonly hasEarlier: boolean;
  readonly events: readonly WorkerProgressEvent[];
  /** Missing/cross-linked records or bad clocks make the chronology incomplete. */
  readonly issues: readonly string[];
  /** These events describe execution, not verified publication or reader delivery. */
  readonly provesPublicDelivery: false;
}

type ProgressSources = {
  readonly work: WorkItem;
  readonly tasks: readonly RouteTask[];
  readonly attempts: readonly Attempt[];
  readonly leases: readonly ExecutionLease[];
  readonly scouts: readonly ScoutResult[];
  readonly results: readonly WorkerResultRecord[];
  readonly missingTaskIds?: readonly string[];
  readonly missingAttemptIds?: readonly string[];
};

function validTime(value: string | null): string | null {
  return value !== null && Number.isFinite(Date.parse(value)) ? value : null;
}

function orderedUnique(values: readonly string[]): string[] { return [...new Set(values)]; }

async function batches<T, R>(items: readonly T[], read: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += READ_CONCURRENCY) {
    out.push(...await Promise.all(items.slice(i, i + READ_CONCURRENCY).map(read)));
  }
  return out;
}

export function projectWorkerProgress(sources: ProgressSources, observedAt: string, requestedLimit = WORKER_PROGRESS_DEFAULT_LIMIT): WorkerProgressRead {
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(WORKER_PROGRESS_MAX_LIMIT, requestedLimit)) : WORKER_PROGRESS_DEFAULT_LIMIT;
  const issues = new Set<string>();
  if (sources.missingTaskIds?.length) issues.add("Some named route tasks could not be read.");
  if (sources.missingAttemptIds?.length) issues.add("Some named attempts could not be read.");
  if (!validTime(observedAt)) issues.add("The observation time is unreadable.");
  if (sources.tasks.some(task => task.workItemId !== sources.work.id)) issues.add("A named route task belongs to another work item.");
  const taskIds = new Set(sources.tasks.filter(task => task.workItemId === sources.work.id).map(task => task.id));
  const leases = new Map(sources.leases.map(lease => [lease.routeTaskId, lease]));
  const attempts = new Map<string, Attempt>();
  const events: WorkerProgressEvent[] = [];
  for (const attempt of sources.attempts) {
    if (attempt.workItemId !== sources.work.id || !taskIds.has(attempt.routeTaskId)) {
      issues.add("An attempt's saved work or route link did not match this item.");
      continue;
    }
    attempts.set(attempt.id, attempt);
    const lease = leases.get(attempt.routeTaskId);
    const active = attempt.outcome === null && lease !== undefined && lease.id === attempt.leaseId && !lease.released &&
      Number.isFinite(Date.parse(lease.expiresAt)) && Date.parse(lease.expiresAt) > Date.parse(observedAt);
    if (attempt.outcome === null && !active) issues.add("An open attempt has no confirmed live lease.");
    const startedAt = validTime(attempt.startedAt);
    if (!startedAt) issues.add("An attempt has an unreadable start time.");
    events.push({ id: `start:${attempt.id}`, workItemId: sources.work.id, routeTaskId: attempt.routeTaskId,
      attemptId: attempt.id, role: attempt.worker.role, at: startedAt, kind: "ATTEMPT_STARTED",
      outcome: null, active, evidenceId: attempt.id });
    if (attempt.outcome !== null) {
      const endedAt = validTime(attempt.endedAt);
      if (!endedAt) issues.add("A closed attempt has no readable end time.");
      events.push({ id: `end:${attempt.id}`, workItemId: sources.work.id, routeTaskId: attempt.routeTaskId,
        attemptId: attempt.id, role: attempt.worker.role, at: endedAt, kind: "ATTEMPT_ENDED",
        outcome: attempt.outcome, active: false, evidenceId: attempt.id });
    }
  }
  for (const result of sources.results) {
    if (result.workItemId !== sources.work.id || !attempts.has(result.attemptId) ||
      result.routeTaskId !== attempts.get(result.attemptId)?.routeTaskId ||
      result.worker.role !== attempts.get(result.attemptId)?.worker.role) {
      issues.add("A saved worker result has no matching attempt on this item.");
      continue;
    }
    const at = validTime(result.endedAt);
    if (!at) issues.add("A worker result has an unreadable recorded time.");
    events.push({ id: `result:${result.id}`, workItemId: sources.work.id, routeTaskId: result.routeTaskId,
      attemptId: result.attemptId, role: result.worker.role, at, kind: "RESULT_RECORDED",
      outcome: "verdict" in result.result && typeof result.result.verdict === "string" ? result.result.verdict : null,
      active: false, evidenceId: result.id });
  }
  for (const scout of sources.scouts) {
    if (scout.workItemId !== sources.work.id || !attempts.has(scout.attemptId) ||
      scout.routeTaskId !== attempts.get(scout.attemptId)?.routeTaskId ||
      attempts.get(scout.attemptId)?.worker.role !== "SCOUT") {
      issues.add("A saved Scout result has no matching attempt on this item.");
      continue;
    }
    const at = validTime(scout.recordedAt);
    if (!at) issues.add("A Scout result has an unreadable recorded time.");
    events.push({ id: `scout:${scout.attemptId}`, workItemId: sources.work.id, routeTaskId: scout.routeTaskId,
      attemptId: scout.attemptId, role: "SCOUT", at, kind: "RESULT_RECORDED",
      outcome: scout.refusal ? "REFUSED" : scout.outcome, active: false, evidenceId: scout.attemptId });
  }
  const order = { ATTEMPT_STARTED: 0, RESULT_RECORDED: 1, ATTEMPT_ENDED: 2 } as const;
  events.sort((a, b) => (a.at === null ? -Infinity : Date.parse(a.at)) - (b.at === null ? -Infinity : Date.parse(b.at)) ||
    order[a.kind] - order[b.kind] || a.id.localeCompare(b.id));
  const page = events.slice(-limit).reverse();
  return { formatVersion: WORKER_PROGRESS_VERSION, observedAt, workItemId: sources.work.id,
    workState: sources.work.state, totalEvents: events.length, returnedEvents: page.length,
    hasEarlier: events.length > page.length, events: page, issues: [...issues], provesPublicDelivery: false };
}

export async function readWorkerProgress(repos: ControlPlaneRepositories, workItemId: string, observedAt: string,
  limit = WORKER_PROGRESS_DEFAULT_LIMIT): Promise<ReadOutcome<WorkerProgressRead>> {
  try {
    const workRow = await repos.workItems.read(workItemId);
    if (!workRow) return { kind: "NOT_RECORDED", detail: "No work item with that identity is recorded." };
    const work = workRow.value;
    const taskIds = orderedUnique(work.routeTaskIds);
    const [taskRows, results, scouts] = await Promise.all([
      batches(taskIds, id => repos.routeTasks.read(id)),
      repos.workerResults.read(work.id),
      repos.scoutResults.readWhere(work.obligation, ["workItemId"], work.id),
    ]);
    const tasks = taskRows.filter((row): row is NonNullable<typeof row> => row !== null).map(row => row.value);
    const attemptIds = orderedUnique(tasks.flatMap(task => task.attemptIds));
    const [attemptRows, leaseRows] = await Promise.all([
      batches(attemptIds, id => repos.attempts.read(id)),
      batches(tasks.map(task => task.id), id => repos.leases.read(id)),
    ]);
    return { kind: "HELD", value: projectWorkerProgress({ work, tasks,
      attempts: attemptRows.filter((row): row is NonNullable<typeof row> => row !== null).map(row => row.value),
      leases: leaseRows.filter((row): row is NonNullable<typeof row> => row !== null).map(row => row.value),
      scouts, results,
      missingTaskIds: taskIds.filter((_, i) => taskRows[i] === null),
      missingAttemptIds: attemptIds.filter((_, i) => attemptRows[i] === null),
    }, observedAt, limit) };
  } catch (error) { return unreachable(`worker progress for ${workItemId}`, error); }
}
