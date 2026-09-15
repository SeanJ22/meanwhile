import type { Attempt } from "../attempt.ts";
import type { RouteTask } from "../route-task.ts";
import { recordFailure, type FreshnessDebt } from "../scheduler/debt.ts";

/** The existing autonomous coordinator's attempt family and capped retry calculation. */
export function autonomousScoutHistory(root: RouteTask, tasks: readonly RouteTask[], attempts: readonly Attempt[]) {
  const family = new Set(tasks.filter(task => task.workItemId === root.workItemId &&
    (task.routeId === root.routeId || task.routeId.startsWith(`${root.routeId}:continue:`))).map(task => task.id));
  const history = attempts.filter(attempt => family.has(attempt.routeTaskId))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
  let debt: FreshnessDebt | null = null;
  for (const attempt of history) {
    // Completing one bounded search does not settle an unresolved source obligation.
    if (attempt.endedAt) debt = recordFailure(debt, { obligationId: root.id,
      cause: attempt.outcome === "COMPLETED" ? "EXTRACTION_FAILED" : attempt.abortReason?.includes("COST_CEILING") ? "RATE_LIMITED" : "TRANSPORT_FAILED",
      detail: attempt.abortReason ?? "Scout completed without an accepted grounded source route",
      target: root.target, dueAt: root.createdAt, now: attempt.endedAt });
  }
  return { familyTaskIds: [...family].sort(), history, debt };
}

export function scoutTransientDenial(reason: string | null): "TRANSPORT" | "COST" | null {
  return reason?.includes("SCOUT_MODEL_TRANSPORT_UNAVAILABLE") ? "TRANSPORT"
    : reason?.includes("SCOUT_COST_CEILING") ? "COST" : null;
}

export interface ScoutTaskAdmission {
  readonly kind: "AUTONOMOUS_SCOUT";
  readonly familyRouteId: string;
  readonly familyTaskIds: readonly string[];
  readonly attemptIds: readonly string[];
  readonly latestAttemptId: string | null;
  readonly state: "TIMING_ELIGIBLE" | "BACKOFF" | "IN_FLIGHT" | "POLICY_RECHECK" | "POLICY_DENIED" | "CONTINUATION_CANDIDATE" | "CONTINUED" | "UNKNOWN";
  readonly retryAt: string | null;
  readonly debt: FreshnessDebt | null;
  readonly nextTaskId: string | null;
  readonly requiresPolicyRecheck: boolean;
  /** Source need, live transport, ceiling and cycle reservation are not inferred by this read. */
  readonly selection: "COORDINATOR_REEVALUATION_REQUIRED";
  readonly reason: string;
}

/** Only a persisted autonomous Scout family earns this reading; other execution paths stay unjoined. */
export function scoutTaskAdmission(task: RouteTask, tasks: readonly RouteTask[], attempts: readonly Attempt[], now: string): ScoutTaskAdmission | null {
  if (task.workerTask || !/^autonomous:(?:scout|novelty):[a-f0-9]{24}(?::continue:.+)?$/.test(task.routeId)) return null;
  if (!Number.isFinite(Date.parse(now))) throw new Error("SCOUT_RETRY_CLOCK_INVALID");
  const familyRouteId = task.routeId.split(":continue:")[0];
  const root = tasks.find(candidate => candidate.workItemId === task.workItemId && candidate.routeId === familyRouteId && !candidate.workerTask);
  if (!root) return null;
  const { familyTaskIds, history, debt } = autonomousScoutHistory(root, tasks, attempts);
  const latest = history.filter(attempt => attempt.routeTaskId === task.id).at(-1);
  const common = { kind: "AUTONOMOUS_SCOUT" as const, familyRouteId, familyTaskIds, attemptIds: history.map(attempt => attempt.id),
    latestAttemptId: latest?.id ?? null, debt, selection: "COORDINATOR_REEVALUATION_REQUIRED" as const };
  const reading = (state: ScoutTaskAdmission["state"], reason: string, retryAt: string | null = null,
    requiresPolicyRecheck = false, nextTaskId: string | null = null): ScoutTaskAdmission =>
    ({ ...common, state, reason, retryAt, requiresPolicyRecheck, nextTaskId });
  if (task.state === "CLAIMED" || history.some(attempt => attempt.routeTaskId === task.id && attempt.outcome === null)) {
    return reading("IN_FLIGHT", "A canonical Scout Attempt requires lease reconciliation before another admission.");
  }
  if (task.state === "POLICY_DENIED") {
    const transient = latest?.outcome === "DENIED_BY_POLICY" && task.policyDenial && scoutTransientDenial(latest.abortReason);
    if (!transient) return reading("POLICY_DENIED", task.policyDenial?.requiredChange ?? "The recorded denial has no established automatic reauthorization condition.");
    if (debt && Date.parse(debt.retryAt) > Date.parse(now)) {
      return reading("BACKOFF", "Scout backoff must elapse before the named policy condition is rechecked.", debt.retryAt, true);
    }
    return reading("POLICY_RECHECK", "Backoff elapsed; the coordinator must verify that the named transport or rolling-cost condition actually changed.", debt?.retryAt ?? null, true);
  }
  if (task.state === "DISPOSED" && latest?.outcome === "COMPLETED") {
    const continuation = tasks.find(candidate => candidate.workItemId === task.workItemId && candidate.routeId === `${familyRouteId}:continue:${latest.id}`);
    if (continuation) return reading("CONTINUED", "A canonical continuation already exists; do not execute this completed task again.", null, false, continuation.id);
    if (debt && Date.parse(debt.retryAt) > Date.parse(now)) return reading("BACKOFF", "The bounded search finished; continuation is time-blocked if source investigation remains unresolved.", debt.retryAt);
    return reading("CONTINUATION_CANDIDATE", "Timing permits a continuation only if the coordinator still finds unresolved source work. A completed search is not proof that another search is needed.", debt?.retryAt ?? null);
  }
  if (task.state === "PENDING" || task.state === "RECLAIMABLE") {
    const retryAt = debt && Date.parse(debt.retryAt) > Date.parse(task.createdAt) ? debt.retryAt : task.createdAt;
    if (Date.parse(retryAt) > Date.parse(now)) return reading("BACKOFF", "The canonical Scout task due time or existing family backoff has not elapsed.", retryAt);
    return reading("TIMING_ELIGIBLE", "Timing permits evaluation; source need, policy, transport, spending and cycle admission still belong to the existing coordinator.", retryAt);
  }
  return reading("UNKNOWN", "This task state has no automatic Scout continuation established by the joined evidence.");
}
