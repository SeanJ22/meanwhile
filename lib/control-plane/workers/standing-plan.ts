import { advanceHeldWorkerFleet } from "./standing.ts";
import { reauthorizeWorkerTask, type FleetRuntime } from "./runtime.ts";
import { readWorkerRetryHistory, workerTaskAdmission } from "./scheduling.ts";
import type { RouteTask } from "../route-task.ts";
import { isHeldDiggerTask, planHeldDiggers } from "./held-digger-plan.ts";

export async function planHeldWorkerFleet(root: string, runtime: FleetRuntime, legacyOnly = false): Promise<readonly RouteTask[]> {
  if (legacyOnly) return planHeldDiggers(runtime);
  await advanceHeldWorkerFleet(root, runtime);
  const snapshot = await runtime.repos.dispatchState.readOpen();
  const selected = [...snapshot.routeTasks.values()].map(row => row.value).filter(task => task.workerTask && !isHeldDiggerTask(task));
  const attempts = await readWorkerRetryHistory(runtime.repos.attempts, selected.map(task => task.id));
  const tasks: RouteTask[] = [];
  for (const task of selected) {
    const now = (runtime.now ?? (() => new Date().toISOString()))();
    const admission = workerTaskAdmission(task, attempts, now);
    if (!admission.due) continue;
    const admitted = admission.requiresPolicyRecheck ? await reauthorizeWorkerTask(runtime, task, now) : task;
    if (admitted) tasks.push(admitted);
  }
  return tasks;
}
