/**
 * DB-21: each door knows when it last worked.
 *
 * `lastSuccessAt` and `lastFailureAt` are written onto the door's record by the
 * runner after each read of it: for a hand-wired door from its partition's
 * promotion outcome, for a derived member from that member's own result (never
 * the family's, so one failing calendar does not mark its healthy neighbours).
 * A system write: it does not count as a hand edit and changes nothing else
 * on the record, including its status (shutting a door is DB-32).
 */

import { observeChange } from "./observed-rate.ts";
import { isDoorRecord, type DoorRepository } from "./registry.ts";

export type DoorOutcome = "SUCCESS" | "FAILURE";

/** Returns true when the record was written; false when there is no such door (nothing is invented). */
export async function recordDoorOutcome(
  repo: DoorRepository, doorId: string, outcome: DoorOutcome, at: string,
  /** DB-30: the read promoted something different from the version before it. Written in the same single write. */
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
 * The one line the derived family child calls after its member reads (hook for
 * the meetings lane's `scripts/ingest.ts`): each member's own result onto its
 * own door. A registry that cannot be written never changes the read's outcome.
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
