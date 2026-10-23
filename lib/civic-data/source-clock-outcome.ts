import type { RoutineTaskClock } from "./runner.ts";
import { taskDoorId } from "../doors/outcome.ts";
import { isDoorRecord, type DoorRepository } from "../doors/registry.ts";

/** Carry the native store's verified observation to its existing scheduled source. */
export async function syncNativeSourceClock(
  repo: DoorRepository, taskId: string, clock: RoutineTaskClock | undefined, now: string,
): Promise<"RECORDED" | "CURRENT" | "UNVERIFIED" | "MISSING"> {
  const checkedAt = clock?.lastSucceededObservedAt;
  if (!checkedAt || !Number.isFinite(Date.parse(checkedAt)) || !Number.isFinite(Date.parse(now)) ||
    Date.parse(checkedAt) > Date.parse(now)) return "UNVERIFIED";
  const doorId = await taskDoorId(repo, taskId);
  if (!doorId) return "MISSING";
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = await repo.read(doorId);
    if (!row || !isDoorRecord(row.value)) return "MISSING";
    const door = row.value;
    if (door.lastSuccessAt && Date.parse(door.lastSuccessAt) >= Date.parse(checkedAt)) return "CURRENT";
    // Reconciliation can follow a later failed read. Its reason still belongs in Admin.
    const laterFailure = door.lastFailureAt && Date.parse(door.lastFailureAt) > Date.parse(checkedAt);
    try {
      await repo.compareAndSet(doorId, row.revision, { ...door, lastSuccessAt: checkedAt,
        ...(laterFailure ? {} : { lastFailureReason: null }) }, now);
      return "RECORDED";
    } catch (error) { if (attempt === 1) throw error; }
  }
  return "CURRENT";
}
