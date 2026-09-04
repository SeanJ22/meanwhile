import type { Attempt, AttemptOutcome, WorkerRef } from "../attempt.ts";
import { auditRenderedNumbers, checkStatedEqualsRendered, type CountClaim, type RenderedNumber } from "../owner-surface.ts";
import { canonicalJson, type ControlPlaneRepositories } from "../repository/types.ts";
import type { RouteTask } from "../route-task.ts";
import type { WorkItemState } from "../work-item.ts";
import { assertFleetResult, FLEET_ROLES, type FleetRole, type WorkerFinding, type WorkerResultRecord } from "./types.ts";
import { workerTaskAdmission } from "./scheduling.ts";

export const WORKER_ATTEMPTS_SHOWN_PER_ROLE = 5;

/** A displayable measurement always names its population, source and observation. */
export interface WorkerFleetMetric extends RenderedNumber {
  readonly denominator: number;
  readonly contract: string;
  readonly source: string;
  readonly observedAt: string;
  readonly unit: "attempts" | "tasks" | "artifacts" | "ms" | "USD";
}
export interface WorkerAttemptView {
  readonly attemptId: string;
  readonly routeTaskId: string;
  readonly workItemId: string;
  readonly worker: WorkerRef;
  readonly outcome: AttemptOutcome | "RUNNING";
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly duration: WorkerFleetMetric | null;
  readonly cost: WorkerFleetMetric | null;
  readonly artifacts: WorkerFleetMetric;
  readonly resultStatus: "MATCHED" | "NOT_RECORDED" | "REFUSED";
  readonly resultId: string | null;
  readonly verdict: string | null;
  readonly executionMode: WorkerResultRecord["executionMode"] | null;
  readonly resultDetail: string;
  readonly findings: readonly Pick<WorkerFinding, "code" | "detail" | "severity">[];
  readonly workItemState: WorkItemState | "UNKNOWN";
  readonly reopenedByResult: boolean;
}
export interface WorkerRoleView {
  readonly role: FleetRole;
  readonly shown: WorkerFleetMetric;
  readonly pending: WorkerFleetMetric;
  readonly due: WorkerFleetMetric;
  readonly attempts: readonly WorkerAttemptView[];
}
export type WorkerFleetReadback =
  | { readonly status: "UNAVAILABLE"; readonly observedAt: string; readonly failures: readonly string[] }
  | { readonly status: "HELD"; readonly observedAt: string; readonly roles: readonly WorkerRoleView[]; readonly notices: readonly string[] };

function metric(label: string, value: number, denominator: number, contract: string, source: string, observedAt: string, unit: WorkerFleetMetric["unit"]): WorkerFleetMetric {
  if (![value, denominator].every((number) => Number.isFinite(number) && number >= 0)) throw new Error("WORKER_READBACK_INVALID_MEASUREMENT");
  return { label, value, denominator, contract, source, observedAt, unit };
}
function fleetRole(role: string): role is FleetRole { return (FLEET_ROLES as readonly string[]).includes(role); }
function resultMatches(record: WorkerResultRecord, attempt: Attempt, task: RouteTask | undefined): boolean {
  if (attempt.outcome !== "COMPLETED" || !task || task.state !== "RESULT_RECORDED" || task.workerTask?.role !== attempt.worker.role ||
      task.workItemId !== attempt.workItemId || !task.attemptIds.includes(attempt.id) ||
      record.attemptId !== attempt.id || record.workItemId !== attempt.workItemId || record.routeTaskId !== attempt.routeTaskId ||
      record.startedAt !== attempt.startedAt || record.endedAt !== attempt.endedAt ||
      record.methodVersion !== attempt.methodVersion || record.policyVersion !== attempt.policyVersion ||
      canonicalJson(record.worker) !== canonicalJson(attempt.worker) || canonicalJson(record.completion?.closedAttempt) !== canonicalJson(attempt)) return false;
  try { assertFleetResult(record.result, attempt.worker.role as FleetRole, attempt.id); return true; }
  catch { return false; }
}

/** Read the existing repositories only. A failed repository read never becomes a zero count. */
export async function readWorkerFleet(repos: ControlPlaneRepositories, now: string): Promise<WorkerFleetReadback> {
  if (!Number.isFinite(Date.parse(now))) return { status: "UNAVAILABLE", observedAt: now, failures: ["WORKER_READBACK_INVALID_OBSERVATION_TIME"] };
  const reads = await Promise.allSettled([repos.attempts.list(), repos.workerResults.readAll(), repos.routeTasks.list(), repos.workItems.list()]);
  const names = ["Attempts", "worker results", "RouteTasks", "WorkItems"];
  const failures = reads.flatMap((read, index) => read.status === "rejected" ? [`Reading canonical ${names[index]} failed (${read.reason instanceof Error ? read.reason.name : "error"}); no counts or verdicts were inferred.`] : []);
  if (failures.length) return { status: "UNAVAILABLE", observedAt: now, failures };
  // The discriminant check is explicit for TypeScript and for a future added read.
  const [attemptRead, resultRead, taskRead, itemRead] = reads;
  if (attemptRead.status !== "fulfilled" || resultRead.status !== "fulfilled" || taskRead.status !== "fulfilled" || itemRead.status !== "fulfilled") return { status: "UNAVAILABLE", observedAt: now, failures: ["WORKER_READBACK_INCOMPLETE_READ"] };
  const attempts = attemptRead.value.map((row) => row.value);
  const results = resultRead.value;
  const tasks = taskRead.value.map((row) => row.value);
  const items = new Map(itemRead.value.map((row) => [row.id, row.value]));
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const notices = results.filter((record) => !attempts.some((attempt) => attempt.id === record.attemptId)).map((record) => `WORKER_RESULT_ATTEMPT_MISSING: ${record.id} is not a certified worker run.`);
  try {
    const roles = FLEET_ROLES.map((role): WorkerRoleView => {
      const all = attempts.filter((attempt) => attempt.worker.role === role).sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
      const roleTasks = tasks.filter((task) => task.workerTask?.role === role);
      const pending = roleTasks.filter((task) => task.state === "PENDING" || task.state === "RECLAIMABLE");
      if (pending.some((task) => !Number.isFinite(Date.parse(task.createdAt)))) throw new Error("WORKER_READBACK_INVALID_DUE_TIME");
      const latest = all.slice(0, WORKER_ATTEMPTS_SHOWN_PER_ROLE).map((attempt): WorkerAttemptView => {
        const matching = results.filter((record) => record.attemptId === attempt.id);
        const candidate = matching.length === 1 ? matching[0] : null;
        const record = candidate && resultMatches(candidate, attempt, tasksById.get(attempt.routeTaskId)) ? candidate : null;
        const item = items.get(attempt.workItemId);
        const findings = record ? (record.result.role === "PARSER" ? record.result.warnings : record.result.findings)
          .filter((finding) => finding.severity !== "INFO")
          .map(({ code, detail, severity }) => ({ code, detail, severity })) : [];
        const source = `control-plane Attempts/${attempt.id}`;
        const artifactIds = new Set(attempt.artifactIds);
        return {
          attemptId: attempt.id, routeTaskId: attempt.routeTaskId, workItemId: attempt.workItemId,
          worker: { role: attempt.worker.role, provider: attempt.worker.provider, version: attempt.worker.version, instance: attempt.worker.instance },
          outcome: attempt.outcome ?? "RUNNING", startedAt: attempt.startedAt, endedAt: attempt.endedAt,
          duration: attempt.cost.durationMs === null ? null : metric(`${attempt.id} duration`, attempt.cost.durationMs, 1, "Measured elapsed milliseconds for this Attempt; no running-time estimate is substituted.", `${source}.cost.durationMs`, now, "ms"),
          cost: attempt.cost.usd === null ? null : metric(`${attempt.id} cost`, attempt.cost.usd, 1, "Measured USD for this Attempt; missing provider accounting remains NOT MEASURED.", `${source}.cost.usd`, now, "USD"),
          artifacts: metric(`${attempt.id} artifacts`, artifactIds.size, attempt.artifactIds.length, "Unique immutable input artifact IDs among this Attempt's recorded artifact references.", `${source}.artifactIds`, now, "artifacts"),
          resultStatus: record ? "MATCHED" : matching.length ? "REFUSED" : "NOT_RECORDED",
          resultId: record?.id ?? null, verdict: record?.result.verdict ?? null, executionMode: record?.executionMode ?? null,
          resultDetail: record ? "Typed result matches the COMPLETED Attempt, its exact worker identity, and committed RouteTask. It does not authorize promotion."
            : matching.length ? "WORKER_RESULT_UNCOMMITTED_OR_MISMATCHED: a typed result cannot certify a running, failed, conflicting, or differently identified Attempt."
              : "No typed worker result is recorded for this Attempt; its execution outcome is shown separately.",
          findings, workItemState: item?.state ?? "UNKNOWN",
          reopenedByResult: Boolean(record && item?.transitions.some((transition) => transition.to === "REOPENED" && transition.by === `worker-result:${record.id}`)),
        };
      });
      return {
        role, attempts: latest,
        shown: metric(`${role} Attempts shown`, latest.length, all.length, "Latest recorded Attempts for this role, ordered by start time; denominator is all recorded Attempts for the role.", `control-plane Attempts where worker.role=${role}`, now, "attempts"),
        pending: metric(`${role} queue`, pending.length, roleTasks.length, "PENDING or RECLAIMABLE computational RouteTasks among every registered task for this worker role.", `control-plane RouteTasks where workerTask.role=${role}`, now, "tasks"),
        due: metric(`${role} due`, pending.filter((task) => workerTaskAdmission(task, attempts, now).due).length, pending.length, "Queued tasks whose canonical Attempt-derived retry backoff has elapsed; execution still depends on lease, policy and budget checks. Policy-denied tasks are excluded until reauthorized.", `control-plane RouteTasks and Attempts where workerTask.role=${role}; state=PENDING|RECLAIMABLE; retryAt<=observation`, now, "tasks"),
      };
    });
    return { status: "HELD", observedAt: now, roles, notices };
  } catch (error) {
    return { status: "UNAVAILABLE", observedAt: now, failures: [`WORKER_READBACK_INVALID_CANONICAL_STATE (${error instanceof Error ? error.message : "unknown shape"}); measurements were refused.`] };
  }
}

export function workerFleetRenderedNumbers(view: WorkerFleetReadback): readonly WorkerFleetMetric[] {
  if (view.status !== "HELD") return [];
  return view.roles.flatMap((role) => [role.shown, role.pending, role.due, ...role.attempts.flatMap((attempt) => [attempt.artifacts, ...(attempt.duration ? [attempt.duration] : []), ...(attempt.cost ? [attempt.cost] : [])])]);
}
export function workerFleetCountClaims(view: WorkerFleetReadback): readonly CountClaim[] {
  return view.status !== "HELD" ? [] : view.roles.map((role) => ({ label: `${role.role} Attempts shown`, stated: role.shown.value, rendered: role.attempts.length }));
}
/** The panel invokes the same governed audits against exactly the rows/metrics it renders. */
export function auditWorkerFleetView(view: WorkerFleetReadback): { readonly ok: boolean; readonly failures: readonly string[] } {
  const numbers = workerFleetRenderedNumbers(view);
  const numeric = auditRenderedNumbers(numbers);
  const counts = checkStatedEqualsRendered(workerFleetCountClaims(view));
  const missing = numbers.filter((number) => !number.source?.trim() || !number.observedAt || !Number.isFinite(Date.parse(number.observedAt)) || !Number.isFinite(number.value) || !Number.isFinite(number.denominator)).map((number) => `${number.label}: missing source, observation, or finite measurement`);
  const rolesValid = view.status !== "HELD" || (view.roles.length === FLEET_ROLES.length && view.roles.every((role, index) => fleetRole(role.role) && role.role === FLEET_ROLES[index]));
  const failures = [...(numeric.ok ? [] : [numeric.detail]), ...(counts.ok ? [] : [counts.detail]), ...missing, ...(rolesValid ? [] : ["The canonical worker-role rows are missing or duplicated."])];
  return { ok: failures.length === 0, failures };
}
