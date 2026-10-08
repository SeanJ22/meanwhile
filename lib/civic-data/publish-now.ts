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
export function publishNowLane(run: () => Promise<void>): IndependentRuntimeLane {
  return { id: "publish-now", everyMs: PUBLISH_NOW_INTERVAL_MS, run };
}

/** A publish-now minute that selected nothing, with nothing failed on the way there, ends quietly: no outcome, no count. */
export function publishNowHasNothingOwed(publishNow: boolean, selectedTasks: number, failures: number): boolean {
  return publishNow && selectedTasks === 0 && failures === 0;
}

/** Parser results are a durable outbox acknowledged by publicationOutcome.workerResultId, so a crash cannot lose a request. */
export function publishNowWorkerTasks(items: readonly WorkItem[], results: readonly WorkerResultRecord[], now: string): RoutineSourceTask[] {
  return workerPublicationTasks(items.filter(item => latestParserResult(results, item.id) !== undefined), results, now);
}

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
