import type { Attempt } from "../attempt.ts";
import type { RouteTask } from "../route-task.ts";
import type { AggregateRepository, RecordProjection } from "../repository/types.ts";
import { recordFailure, type DebtCause, type FreshnessDebt } from "../scheduler/debt.ts";

export interface WorkerTaskAdmission {
  readonly due: boolean;
  readonly state: "DUE" | "BACKOFF" | "POLICY_DENIED" | "IN_FLIGHT" | "TERMINAL";
  readonly retryAt: string | null;
  readonly consecutiveFailures: number;
  readonly reason: string;
  /** The caller must prove the named transient condition changed before reauthorizing. */
  readonly requiresPolicyRecheck: boolean;
  readonly debt: FreshnessDebt | null;
}

export type WorkerRetryAttempt = Pick<Attempt, "id" | "routeTaskId" | "startedAt" | "endedAt" | "outcome" | "abortReason">;
const RETRY_FIELDS: RecordProjection = { id: true, routeTaskId: true, startedAt: true, endedAt: true, outcome: true, abortReason: true };

/** Admission uses only these exact tasks' retry clocks, never source evidence or another task's history. */
export async function readWorkerRetryHistory(repo: Pick<AggregateRepository<Attempt>, "listWhereNarrowed">,
  taskIds: readonly string[]): Promise<readonly WorkerRetryAttempt[]> {
  const ids = [...new Set(taskIds)], rows: WorkerRetryAttempt[] = [];
  for (let offset = 0; offset < ids.length; offset += 8) {
    const batch = await Promise.all(ids.slice(offset, offset + 8).map(id => repo.listWhereNarrowed(["routeTaskId"], id, RETRY_FIELDS)));
    rows.push(...batch.flat().map(row => row.value as WorkerRetryAttempt));
  }
  return rows;
}

function transientDenial(reason: string | null): boolean {
  return /^(?:DENIED_BY_POLICY:)?AUDIT_(?:ROLLING_COST_CEILING|MODEL_TRANSPORT_UNAVAILABLE)(?:[;:]|$)/.test(reason ?? "");
}

function debtCause(attempt: WorkerRetryAttempt): DebtCause {
  if (attempt.outcome === "CRASHED" || attempt.outcome === "LEASE_EXPIRED") return "WORKER_LOST";
  if (/(?:AUDIT|PARSE)_ROLLING_COST_CEILING|(?:AUDIT|PARSE)_PROVIDER_FAILURE:429/.test(attempt.abortReason ?? "")) return "RATE_LIMITED";
  if (/(?:AUDIT|PARSE)_PROVIDER_FAILURE:5\d\d/.test(attempt.abortReason ?? "")) return "UPSTREAM_ERROR";
  if (attempt.outcome === "TIMED_OUT" || /(?:AUDIT|PARSE)_(?:PROVIDER_FAILURE|MODEL_TRANSPORT_UNAVAILABLE)/.test(attempt.abortReason ?? "")) return "TRANSPORT_FAILED";
  return "EXTRACTION_FAILED";
}

/** An explicit permanent HTTP rejection wins over words inside its diagnostic body. */
export function workerFailureCanRetry(detail: string): boolean {
  const status = /\b(?:HTTP[\s:]+|(?:AUDIT|PARSE)_PROVIDER_FAILURE:)(\d{3})\b/i.exec(detail);
  const code = status ? Number(status[1]) : null;
  if (code !== null && code >= 400 && code < 500 && code !== 408 && code !== 429) return false;
  return /\bHTTP (?:408|429|5\d\d)\b|provider[^\n]*(?:408|429|5\d\d)|timeout|timed out|network|econnreset|eai_again|fetch failed/i.test(detail);
}

/** A reading of canonical Attempts, not a second retry store or a lifetime attempt limit. */
export function workerTaskAdmission(task: RouteTask, attempts: readonly WorkerRetryAttempt[], now: string): WorkerTaskAdmission {
  const result = (state: WorkerTaskAdmission["state"], reason: string, debt: FreshnessDebt | null = null,
    requiresPolicyRecheck = false): WorkerTaskAdmission => ({
    due: state === "DUE", state, retryAt: debt?.retryAt ?? null,
    consecutiveFailures: debt?.consecutiveFailures ?? 0, reason, requiresPolicyRecheck, debt,
  });
  if (!task.workerTask || task.state === "RESULT_RECORDED" || task.state === "DISPOSED") {
    return result("TERMINAL", "The task has no outstanding worker computation.");
  }
  const history = attempts.filter(a => a.routeTaskId === task.id)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
  const latest = history.at(-1);
  if (task.state === "CLAIMED" || history.some(a => a.outcome === null)) {
    return result("IN_FLIGHT", "An active Attempt requires lease reconciliation before another admission.");
  }
  if (latest?.outcome === "COMPLETED") return result("TERMINAL", "A completed computation awaits its existing durable result boundary.");
  const policyDenied = task.state === "POLICY_DENIED" || latest?.outcome === "DENIED_BY_POLICY";
  const mayRecheck = policyDenied && latest?.outcome === "DENIED_BY_POLICY" && transientDenial(latest.abortReason) &&
    (!task.policyDenial || task.policyDenial.attemptId === latest.id);
  if (policyDenied && !mayRecheck) {
    return result("POLICY_DENIED", task.policyDenial?.requiredChange ?? latest?.abortReason ?? "The denied capability or policy requires an explicit authorized change.");
  }
  if (latest?.endedAt && !mayRecheck && !["CRASHED", "LEASE_EXPIRED"].includes(latest.outcome ?? "") &&
    !workerFailureCanRetry(latest.abortReason ?? "")) {
    return result("TERMINAL", "The same task already failed; a changed source, method or input must create its successor before another attempt.");
  }
  let debt: FreshnessDebt | null = null;
  for (const attempt of history) {
    if (attempt.outcome === "COMPLETED") { debt = null; continue; }
    if (!attempt.endedAt || !Number.isFinite(Date.parse(attempt.endedAt))) throw new Error("WORKER_RETRY_HISTORY_INVALID");
    debt = recordFailure(debt, { obligationId: task.id, cause: debtCause(attempt),
      detail: attempt.abortReason ?? attempt.outcome ?? "WORKER_FAILURE", target: task.target,
      dueAt: task.createdAt, now: attempt.endedAt });
  }
  if (!Number.isFinite(Date.parse(now))) throw new Error("WORKER_RETRY_CLOCK_INVALID");
  if (Date.parse(task.createdAt) > Date.parse(now) && (!debt || Date.parse(task.createdAt) > Date.parse(debt.retryAt))) {
    return { ...result("BACKOFF", "The canonical task's due time has not arrived.", debt, mayRecheck), retryAt: task.createdAt };
  }
  if (debt && Date.parse(debt.retryAt) > Date.parse(now)) {
    return result("BACKOFF", "The existing capped failure backoff has not elapsed.", debt, mayRecheck);
  }
  return result("DUE", mayRecheck
    ? "The transient denial is due for a current-policy check; this reading itself does not reauthorize execution."
    : "The worker computation is due under the existing capped failure backoff.", debt, mayRecheck);
}
