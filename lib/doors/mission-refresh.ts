/**
 * Starting a mission marks every open door inside the place `readNow`, so the
 * routine runner reads it at once instead of on its schedule.
 *
 * 1. `markDoorsReadNow`: at mission start, sets only `readNow` and `updatedAt`
 *    on matching OPEN doors; never touches `editedAt`.
 * 2. `readNowDueRequests`: each marked meeting door becomes an ordinary due
 *    request, spent by the partition's first attempt after the mark and
 *    expiring after the request lifetime.
 * 3. `settleReadNow`: clears a mark once the door has recorded an outcome
 *    since it, or it has expired.
 *
 * A door is inside the place when its division, or any body it feeds, is one
 * of the caller's divisions or a child of one.
 */
import { ROUTINE_DUE_REQUEST_MAX_LIFETIME_MS, type RoutineDueRequest } from "../civic-data/routine-due-request.ts";
import { isDoorRecord, listDoors, type DoorRecord, type DoorRepository } from "./registry.ts";

/** An OCD id is inside a division when it is that division or a child of it (`/` for a child, `#` for a body). */
export function ocdInside(ocdId: string, division: string): boolean {
  return ocdId === division || ocdId.startsWith(`${division}/`) || ocdId.startsWith(`${division}#`);
}

/** Whether a door's division, or any body it feeds, is inside one of the mission's divisions. */
export function doorInDivisions(door: Pick<DoorRecord, "ocdId" | "bodyIds">, divisions: readonly string[]): boolean {
  const named = [...(door.ocdId === null ? [] : [door.ocdId]), ...door.bodyIds];
  return named.some((ocdId) => divisions.some((division) => ocdInside(ocdId, division)));
}

export interface MissionRefreshCount {
  /** Doors inside the mission's place. */
  readonly inPlace: number;
  /** Open doors newly marked to be read now. */
  readonly marked: number;
  /** Open doors that already carried a mark. */
  readonly alreadyMarked: number;
  /** Shut or suspended doors, which are not read and so are not marked. */
  readonly notRead: number;
  /** A mark that lost a race and was not written; the next mission start retries it. */
  readonly raced: number;
}

/** At mission start: mark every open door inside `divisions` to be read now. Writes `readNow` and `updatedAt` only. */
export async function markDoorsReadNow(
  repo: DoorRepository,
  divisions: readonly string[],
  at: string,
): Promise<MissionRefreshCount> {
  const wanted = divisions.filter((division) => division.startsWith("ocd-division/"));
  const counts = { inPlace: 0, marked: 0, alreadyMarked: 0, notRead: 0, raced: 0 };
  if (wanted.length === 0) return counts;
  for (const row of await repo.list()) {
    const door = row.value;
    if (!isDoorRecord(door) || !doorInDivisions(door, wanted)) continue;
    counts.inPlace += 1;
    if (door.status !== "OPEN") { counts.notRead += 1; continue; }
    if (door.readNow) { counts.alreadyMarked += 1; continue; }
    try {
      await repo.compareAndSet(door.doorId, row.revision, { ...door, readNow: true, updatedAt: at }, at);
      counts.marked += 1;
    } catch {
      counts.raced += 1;
    }
  }
  return counts;
}

/**
 * The partition a meeting door is read through: a hand-wired door's id is its partition's id, and a derived member is
 * read by its family's partition (`meeting.family`). A door that is not a meeting door is read by no partition.
 */
export function doorPartitionIds(door: DoorRecord): readonly string[] {
  if (door.meeting == null) return [];
  return [door.meeting.family ?? door.doorId];
}

/**
 * The pass's due requests for doors marked `readNow`: due from the mark, expiring after the request lifetime. Only
 * partitions the pass knows (`known`) are named, so a mark on a door the code cannot yet read asks for nothing.
 */
export function readNowDueRequests(
  doors: readonly DoorRecord[],
  known: ReadonlySet<string>,
  now: string,
): RoutineDueRequest[] {
  const nowMs = Date.parse(now);
  const requests: RoutineDueRequest[] = [];
  for (const door of doors) {
    if (!door.readNow || door.status !== "OPEN") continue;
    const requestedMs = Date.parse(door.updatedAt);
    if (!Number.isFinite(requestedMs) || nowMs - requestedMs >= ROUTINE_DUE_REQUEST_MAX_LIFETIME_MS) continue;
    for (const contractId of doorPartitionIds(door)) {
      if (!known.has(contractId)) continue;
      requests.push({
        id: `door-read-now:${door.doorId}:${contractId}`,
        contractId,
        requestedAt: door.updatedAt,
        dueAt: door.updatedAt,
        expiresAt: new Date(requestedMs + ROUTINE_DUE_REQUEST_MAX_LIFETIME_MS).toISOString(),
        reason: "a mission started in this place; the door's known route is read now",
        withdrawnAt: null,
      });
    }
  }
  return requests;
}

/**
 * Clear the marks that are spent: the door has recorded an outcome since the mark (`recordDoorOutcome` writes
 * `lastSuccessAt` or `lastFailureAt` and leaves `updatedAt`, the mark's own time, alone), or the mark is older than the
 * request lifetime. Returns how many were cleared.
 */
export async function settleReadNow(repo: DoorRepository, now: string): Promise<number> {
  let cleared = 0;
  const nowMs = Date.parse(now);
  for (const door of (await listDoors(repo)).doors) {
    if (!door.readNow) continue;
    const markedMs = Date.parse(door.updatedAt);
    const expired = !Number.isFinite(markedMs) || nowMs - markedMs >= ROUTINE_DUE_REQUEST_MAX_LIFETIME_MS;
    const outcomeSince = [door.lastSuccessAt, door.lastFailureAt].some((at) => at !== null && Date.parse(at) >= markedMs);
    if (!expired && !outcomeSince) continue;
    const row = await repo.read(door.doorId);
    if (row === null || !isDoorRecord(row.value) || !row.value.readNow) continue;
    try {
      await repo.compareAndSet(door.doorId, row.revision, { ...row.value, readNow: false, updatedAt: row.value.updatedAt }, now);
      cleared += 1;
    } catch {
      // Lost a race: the next pass settles it.
    }
  }
  return cleared;
}
