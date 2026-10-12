/**
 * Records `lastSuccessAt` / `lastFailureAt` on a door after each read: for a
 * hand-wired door or a feed from its task's promotion outcome, for a derived
 * member from that member's own result. A system write: not a hand edit, and nothing
 * else on the record changes.
 */

import { observeChange } from "./observed-rate.ts";
import { feedDoorId, isDoorRecord, type DoorRepository } from "./registry.ts";

export type DoorOutcome = "SUCCESS" | "FAILURE";

/** The door a routine task's read lands on: its meeting door (the task's own id) or its feed door. Null when it has neither. */
export async function taskDoorId(repo: DoorRepository, taskId: string): Promise<string | null> {
  if ((await repo.read(taskId)) !== null) return taskId;
  const feed = feedDoorId(taskId);
  return (await repo.read(feed)) !== null ? feed : null;
}

/** Returns true when the record was written; false when there is no such door (nothing is invented). */
export async function recordDoorOutcome(
  repo: DoorRepository, doorId: string, outcome: DoorOutcome, at: string,
  /** The read promoted something different from the version before it. */
  changed = false,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const row = await repo.read(doorId);
    if (row === null || !isDoorRecord(row.value)) return false;
    const door = row.value;
    const next = outcome === "SUCCESS"
      ? { ...door, lastSuccessAt: at, ...(changed ? observeChange(door, at) : {}) }
      : { ...door, lastFailureAt: at };
    try {
      await repo.compareAndSet(doorId, row.revision, { ...next, updatedAt: door.updatedAt }, at);
      return true;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  return false;
}

/** One outcome per member of a family read, each recorded on its own door. */
export async function recordMemberOutcomes(
  repo: DoorRepository,
  members: readonly { readonly doorId: string; readonly outcome: DoorOutcome }[],
  at: string,
): Promise<{ readonly recorded: number; readonly missing: number }> {
  let recorded = 0;
  let missing = 0;
  for (const member of members) {
    if (await recordDoorOutcome(repo, member.doorId, member.outcome, at)) recorded += 1;
    else missing += 1;
  }
  return { recorded, missing };
}

/**
 * Called by the derived family child after its member reads: each member's own
 * result onto its own door. A registry that cannot be written never changes
 * the read's outcome.
 */
export async function recordFamilyReads(
  repo: DoorRepository,
  reads: readonly { readonly ok: boolean; readonly member: { readonly id: string } }[],
  at: string,
): Promise<{ readonly recorded: number; readonly missing: number } | null> {
  try {
    return await recordMemberOutcomes(repo, reads.map((read) => ({ doorId: read.member.id, outcome: read.ok ? "SUCCESS" : "FAILURE" })), at);
  } catch {
    return null;
  }
}
