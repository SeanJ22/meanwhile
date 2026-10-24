import { advanceHeldWorkerFleet } from "./standing.ts";
import { reauthorizeWorkerTask, type FleetRuntime } from "./runtime.ts";
import { workerTaskAdmission } from "./scheduling.ts";
import type { RouteTask } from "../route-task.ts";
import { isHeldDiggerTask, planHeldDiggers } from "./held-digger-plan.ts";

export async function planHeldWorkerFleet(root: string, runtime: FleetRuntime, legacyOnly = false): Promise<readonly RouteTask[]> {
  if (legacyOnly) return planHeldDiggers(runtime);
  await advanceHeldWorkerFleet(root, runtime);
  const snapshot = await runtime.repos.dispatchState.readOpen();
  const workIds = [...new Set([...snapshot.routeTasks.values()].map(row => row.value.workItemId))];
  const attempts = (await Promise.all(workIds.map(id => runtime.repos.attempts.listWhere(["workItemId"], id)))).flat().map(row => row.value);
  const tasks: RouteTask[] = [];
  for (const { value: task } of snapshot.routeTasks.values()) {
    if (!task.workerTask || isHeldDiggerTask(task)) continue;
    const now = (runtime.now ?? (() => new Date().toISOString()))();
    const admission = workerTaskAdmission(task, attempts, now);
    if (!admission.due) continue;
    const selected = admission.requiresPolicyRecheck ? await reauthorizeWorkerTask(runtime, task, now) : task;
    if (selected) tasks.push(selected);
  }
  return tasks;
}
