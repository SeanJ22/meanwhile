import type { IndependentRuntimeLane } from "../ops/independent-runtime-pass.ts";
import type { RoutineSourceTask } from "./runner.ts";
import type { WorkItem } from "../control-plane/work-item.ts";
import type { WorkerResultRecord } from "../control-plane/workers/types.ts";
import type { DoorRecord } from "../doors/registry.ts";
import { doorPartitionIds } from "../doors/mission-refresh.ts";
import { workerPublicationTasks } from "./worker-publication-tasks.ts";
import { latestParserResult } from "./worker-publication-evidence.ts";

export const PUBLISH_NOW_INTERVAL_MS = 60_000;
export const PUBLISH_NOW_SINGLETON_PORT = 49_373;
/** Register on the parent's independent scheduler, beside its routine lane. */
export function publishNowLane(run: () => Promise<void>): IndependentRuntimeLane {
  return { id: "publish-now", everyMs: PUBLISH_NOW_INTERVAL_MS, run };
}

/** Parser results are already a durable, non-expiring outbox. Their exact ids
 * are acknowledged by publicationOutcome.workerResultId; a crash cannot eat a
 * request. The hourly held-page scan stays on the routine lane. */
export function publishNowWorkerTasks(items: readonly WorkItem[], results: readonly WorkerResultRecord[], now: string): RoutineSourceTask[] {
  return workerPublicationTasks(items.filter(item => latestParserResult(results, item.id) !== undefined), results, now);
}

/** Probe changes stay pending until a successful read; no due-request expiry
 * can discard them. The ordinary source executor retains its retry interval. */
export function publishNowDoorTasks(doors: readonly DoorRecord[], tasks: readonly RoutineSourceTask[], now: string): RoutineSourceTask[] {
  const requests = new Map<string, string>();
  for (const door of doors) {
    const at = door.validators?.changedAt;
    if (door.status !== "OPEN" || !at || !Number.isFinite(Date.parse(at)) || Date.parse(at) > Date.parse(now) ||
      (door.lastSuccessAt !== null && Date.parse(door.lastSuccessAt) >= Date.parse(at))) continue;
    for (const id of doorPartitionIds(door)) if (!requests.has(id) || requests.get(id)! < at) requests.set(id, at);
  }
  return tasks.flatMap(task => {
    const requestedAt = requests.get(task.id);
    return requestedAt ? [{ ...task, ownerInvocation: { publicationPending: true, requestedAt,
      instructions: ["publish-now:source-changed"] } }] : [];
  });
}
