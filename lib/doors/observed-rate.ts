/**
 * **REFRESH FOLLOWS HOW OFTEN EACH DOOR ACTUALLY CHANGES** (DB-30).
 *
 * Each read that promotes something different from the version before it is a change. The door keeps when the last
 * one happened and the running average of the gaps between them (`observedChangeMinutes`: the plain mean of the first
 * few gaps, then weighted a quarter toward each new one, so a door whose habit changes is followed within a few changes). Its check defaults to the faster of its policy and that observed rate, never faster than the hourly
 * floor of rulings §4 and never slower than the policy: a door that changes more often than its policy says is read
 * as often as it changes, and a door that changes rarely is read on its policy. A check a person set on the door
 * stays exactly as set. Meetings keep their §4 sitting-window schedule, which is already the floor, so no
 * observation can make a meeting door slower than it.
 *
 * Plain code: no model and no clock of its own.
 */

import { isDoorRecord, type DoorRecord, type DoorRepository } from "./registry.ts";

const MINUTE_MS = 60_000;
/** Rulings §4: hourly is the fastest standing check. */
export const MIN_OBSERVED_CHECK_MINUTES = 60;
/** Once a few gaps are in, each new gap counts for a quarter of the average. */
const RECENT_WEIGHT = 0.25;

export type ObservedFields = Pick<DoorRecord, "lastChangedAt" | "observedChangeMinutes" | "observedChanges">;

/** The door's observation after a changed promotion at `at`. Pure; an `at` not after the last change leaves it as it was. */
export function observeChange(door: Pick<DoorRecord, "lastChangedAt" | "observedChangeMinutes" | "observedChanges">, at: string): ObservedFields {
  const atMs = Date.parse(at);
  const lastMs = door.lastChangedAt ? Date.parse(door.lastChangedAt) : Number.NaN;
  const kept: ObservedFields = {
    lastChangedAt: door.lastChangedAt ?? null,
    observedChangeMinutes: door.observedChangeMinutes ?? null,
    observedChanges: door.observedChanges ?? 0,
  };
  if (!Number.isFinite(atMs)) return kept;
  if (!Number.isFinite(lastMs)) return { ...kept, lastChangedAt: at };
  if (atMs <= lastMs) return kept;
  const gap = (atMs - lastMs) / MINUTE_MS;
  const gapsSoFar = kept.observedChanges ?? 0;
  const average = kept.observedChangeMinutes === null || kept.observedChangeMinutes === undefined || gapsSoFar === 0
    ? gap
    : kept.observedChangeMinutes + (gap - kept.observedChangeMinutes) * Math.max(1 / (gapsSoFar + 1), RECENT_WEIGHT);
  return { lastChangedAt: at, observedChangeMinutes: Math.round(average * 10) / 10, observedChanges: (kept.observedChanges ?? 0) + 1 };
}

/** The check a door is owed, in minutes: its own setting, else the faster of `policyMinutes` and its observed rate. */
export function checkEveryWithObserved(
  door: Pick<DoorRecord, "checkEveryMinutes" | "observedChangeMinutes">,
  policyMinutes: number,
): { readonly minutes: number; readonly basis: "SET_ON_DOOR" | "OBSERVED" | "POLICY" } {
  if (door.checkEveryMinutes !== null) return { minutes: door.checkEveryMinutes, basis: "SET_ON_DOOR" };
  const observed = door.observedChangeMinutes;
  if (observed === null || observed === undefined || !(observed > 0)) return { minutes: policyMinutes, basis: "POLICY" };
  const bounded = Math.max(observed, MIN_OBSERVED_CHECK_MINUTES);
  return bounded < policyMinutes ? { minutes: Math.round(bounded), basis: "OBSERVED" } : { minutes: policyMinutes, basis: "POLICY" };
}

/** What Admin's door list shows for one door: how often it changes and the check that produces. */
export interface DoorRateRow {
  readonly doorId: string;
  readonly observedChangeMinutes: number | null;
  readonly changesSeen: number;
  readonly lastChangedAt: string | null;
  readonly checkEveryMinutes: number;
  readonly basis: "SET_ON_DOOR" | "OBSERVED" | "POLICY";
}

export function doorRateRow(door: DoorRecord, policyMinutes: number): DoorRateRow {
  const check = checkEveryWithObserved(door, policyMinutes);
  return {
    doorId: door.doorId,
    observedChangeMinutes: door.observedChangeMinutes ?? null,
    changesSeen: door.observedChanges ?? 0,
    lastChangedAt: door.lastChangedAt ?? null,
    checkEveryMinutes: check.minutes,
    basis: check.basis,
  };
}

/** Door id → observed change minutes, for the runner's due check. Doors with no observation yet are absent. */
export function observedChangeMinutesByDoor(doors: readonly DoorRecord[]): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const door of doors) {
    if (door.status === "OPEN" && door.checkEveryMinutes === null && typeof door.observedChangeMinutes === "number" && door.observedChangeMinutes > 0) {
      out.set(door.doorId, door.observedChangeMinutes);
    }
  }
  return out;
}

/** Record a changed promotion on a door. False when there is no such door (nothing is invented). A system write: it leaves `updatedAt` alone. */
export async function recordDoorChange(repo: DoorRepository, doorId: string, at: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const row = await repo.read(doorId);
    if (row === null || !isDoorRecord(row.value)) return false;
    const door = row.value;
    const observed = observeChange(door, at);
    if (observed.lastChangedAt === (door.lastChangedAt ?? null)) return true;
    try {
      await repo.compareAndSet(doorId, row.revision, { ...door, ...observed, updatedAt: door.updatedAt }, at);
      return true;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  return false;
}
