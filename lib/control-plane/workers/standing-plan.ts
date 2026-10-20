import { randomUUID } from "node:crypto";
import type { Attempt } from "../attempt.ts";
import type { DiskRows } from "../scheduler/disk-rows.ts";
import { createPlannerSpool, type PlannerSpool } from "../scheduler/planner-spool.ts";
import { advanceHeldWorkerFleet } from "./standing.ts";
import { reauthorizeWorkerTask, type FleetRuntime } from "./runtime.ts";
import { workerTaskAdmission } from "./scheduling.ts";
import { forEachAggregate } from "./streamed-history.ts";
import { taskIdentity, type TaskIdentity } from "./task-identity.ts";

/** Held work joins the same lease queue as acquisition. Planning invokes no worker or model. */
export function planHeldWorkerFleet(root: string, runtime: FleetRuntime, legacyOnly: boolean, planner: PlannerSpool): Promise<DiskRows<TaskIdentity>>;
export function planHeldWorkerFleet(root: string, runtime: FleetRuntime, legacyOnly?: boolean): Promise<readonly TaskIdentity[]>;
export async function planHeldWorkerFleet(root: string, runtime: FleetRuntime, legacyOnly = false, planner?: PlannerSpool): Promise<readonly TaskIdentity[] | DiskRows<TaskIdentity>> {
  const owned = planner ? null : await createPlannerSpool();
  const tasks = (planner ?? owned!).table<TaskIdentity>(`held-worker-plan:${randomUUID()}`, task => task.id);
  try {
    await advanceHeldWorkerFleet(root, runtime, Infinity, legacyOnly);
    await forEachAggregate(runtime.repos.routeTasks, async ({value:task}) => {
      if (!task.workerTask || (legacyOnly && task.workerTask.contract.schemaVersion !== 1)) return;
      const attempts = (await runtime.repos.attempts.listWhereNarrowed(["routeTaskId"], task.id,
        { id: true, routeTaskId: true, startedAt: true, endedAt: true, outcome: true, abortReason: true })).map(row => row.value as Attempt);
      const now = (runtime.now ?? (() => new Date().toISOString()))();
      const admission = workerTaskAdmission(task, attempts, now);
      if (!admission.due) return;
      const selected = admission.requiresPolicyRecheck ? await reauthorizeWorkerTask(runtime, task, now) : task;
      if (selected) tasks.add(taskIdentity(selected));
    }, { id: true, workItemId: true, state: true, createdAt: true, routeId: true, target: true, policyDenial: true,
      workerTask: { role: true, artifactId: true, contract: ["subjectId", "schemaVersion"] } });
    return planner ? tasks.rows : [...tasks.rows];
  } finally { await owned?.close(); }
}
