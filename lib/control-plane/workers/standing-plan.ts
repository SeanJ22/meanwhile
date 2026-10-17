import { advanceHeldWorkerFleet } from "./standing.ts";
import { reauthorizeWorkerTask, type FleetRuntime } from "./runtime.ts";
import { workerTaskAdmission } from "./scheduling.ts";
import type { RouteTask } from "../route-task.ts";

/** Held work joins the same lease queue as acquisition. Planning invokes no worker or model. */
export async function planHeldWorkerFleet(root: string, runtime: FleetRuntime, legacyOnly = false): Promise<readonly RouteTask[]> {
  await advanceHeldWorkerFleet(root, runtime, Infinity, legacyOnly);
  const attempts = (await runtime.repos.attempts.list()).map(row => row.value);
  const tasks: RouteTask[] = [];
  for (const { value: task } of await runtime.repos.routeTasks.list()) {
    if (!task.workerTask || (legacyOnly && task.workerTask.contract.schemaVersion !== 1)) continue;
    const now = (runtime.now ?? (() => new Date().toISOString()))();
    const admission = workerTaskAdmission(task, attempts, now);
    if (!admission.due) continue;
    const selected = admission.requiresPolicyRecheck ? await reauthorizeWorkerTask(runtime, task, now) : task;
    if (selected) tasks.push(selected);
  }
  return tasks;
}
