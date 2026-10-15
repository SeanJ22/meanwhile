import { meetingPartitionOfId } from "../civic-data/meeting-partitions.ts";
import { observeChange } from "./observed-rate.ts";
import { feedDoorId, isDoorRecord, type DoorRepository } from "./registry.ts";

export type DoorOutcome = "SUCCESS" | "FAILURE";

export async function taskDoorIds(repo: DoorRepository, taskId: string): Promise<readonly string[]> {
  const partition = meetingPartitionOfId(taskId);
  if (partition) {
    return (await repo.listWhere(["bodyIds", "0"], partition.bodyId))
      .filter(row => row.value.kind === partition.source && row.value.meeting != null && row.value.status !== "SUSPENDED")
      .map(row => row.value.doorId);
  }
  if ((await repo.read(taskId)) !== null) return [taskId];
  const feed = feedDoorId(taskId);
  return (await repo.read(feed)) !== null ? [feed] : [];
}

/** Returns true when the record was written; false when there is no such door (nothing is invented). */
export async function recordDoorOutcome(
  repo: DoorRepository, doorId: string, outcome: DoorOutcome, at: string,
  /** The read promoted something different from the version before it. */
  changed = false,
  failureReason?: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const row = await repo.read(doorId);
    if (row === null || !isDoorRecord(row.value)) return false;
    const door = row.value;
    const next = outcome === "SUCCESS"
      ? { ...door, lastSuccessAt: at, lastFailureReason: null, ...(changed ? observeChange(door, at) : {}) }
      : { ...door, lastFailureAt: at, ...(failureReason ? { lastFailureReason: failureReason } : {}) };
    try {
      await repo.compareAndSet(doorId, row.revision, { ...next, updatedAt: door.updatedAt }, at);
      return true;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  return false;
}
