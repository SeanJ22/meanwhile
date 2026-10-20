import { advanceHeldWorkerFleet } from "./standing.ts";
import { reauthorizeWorkerTask, type FleetRuntime } from "./runtime.ts";
import { workerTaskAdmission } from "./scheduling.ts";
import { forEachAggregate } from "./streamed-history.ts";
import { taskIdentity, type TaskIdentity } from "./task-identity.ts";

/** Held work joins the same lease queue as acquisition. Planning invokes no worker or model. */
export async function planHeldWorkerFleet(root: string, runtime: FleetRuntime, legacyOnly = false): Promise<readonly TaskIdentity[]> {
  await advanceHeldWorkerFleet(root, runtime, Infinity, legacyOnly);
  const tasks: TaskIdentity[] = [];
  await forEachAggregate(runtime.repos.routeTasks, async ({value:task}) => {
    if (!task.workerTask || (legacyOnly && task.workerTask.contract.schemaVersion !== 1)) return;
    const attempts = (await runtime.repos.attempts.listWhere(["workItemId"],task.workItemId)).map(row => row.value);
    const now = (runtime.now ?? (() => new Date().toISOString()))();
    const admission = workerTaskAdmission(task, attempts, now);
    if (!admission.due) return;
    const selected = admission.requiresPolicyRecheck ? await reauthorizeWorkerTask(runtime, task, now) : task;
    if (selected) tasks.push(taskIdentity(selected));
  });
  return tasks;
}
