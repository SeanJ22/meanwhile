import type { DoorRecord } from "../doors/registry.ts";
import type { CarriedForward, Meeting } from "../sources/types.ts";
import type { SnapshotFailureNote } from "./freshness.ts";

/** What a place's calendars say about their last reads, from the door records that read them. */
export type CalendarDoor = Pick<DoorRecord, "doorId" | "kind" | "ocdId" | "bodyIds" | "status" | "lastSuccessAt" | "lastFailureAt">;

export interface CalendarStatus {
  /** The latest successful read among the place's calendar doors; null when none of them has been read. */
  readonly lastCheckedAt: string | null;
  /** Each source whose latest read failed, with the divisions it serves. */
  readonly failed: SnapshotFailureNote[];
  /** Sittings whose source's latest read failed: their verified facts stay, dated by the last read that worked. */
  readonly carried: ReadonlyMap<string, CarriedForward>;
}

const at = (iso: string | null | undefined) => Date.parse(iso ?? "");

/** A door is dark when it was last read unsuccessfully: a failure after its last success, or a failure and no success. */
export const doorIsDark = (door: Pick<CalendarDoor, "lastSuccessAt" | "lastFailureAt">): boolean =>
  Number.isFinite(at(door.lastFailureAt)) && !(at(door.lastSuccessAt) >= at(door.lastFailureAt));

/**
 * A failed read is a source's status, not a fact about the government: the last verified value stays with its last-checked date,
 * and the failure is fix work. A body is dark only when every door that reads it is dark.
 */
export function calendarStatus(doors: readonly CalendarDoor[], place: { readonly bodyIds: readonly string[]; readonly divisionIds: readonly string[] },
  sittings: readonly Pick<Meeting, "id" | "bodyId">[]): CalendarStatus {
  const bodies = new Set(place.bodyIds), divisions = new Set(place.divisionIds);
  const serving = doors.filter(door => door.bodyIds.some(id => bodies.has(id)) || door.ocdId !== null && divisions.has(door.ocdId));
  const successes = serving.map(door => door.lastSuccessAt).filter((value): value is string => Number.isFinite(at(value)));
  const lastCheckedAt = successes.length ? new Date(Math.max(...successes.map(at))).toISOString() : null;
  const dark = serving.filter(doorIsDark);
  const failed = new Map<string, Set<string>>();
  for (const door of dark) {
    const ocdIds = failed.get(door.kind) ?? failed.set(door.kind, new Set()).get(door.kind)!;
    if (door.ocdId) ocdIds.add(door.ocdId);
  }
  const carried = new Map<string, CarriedForward>();
  for (const sitting of sittings) {
    const reading = serving.filter(door => sitting.bodyId !== undefined && door.bodyIds.includes(sitting.bodyId));
    if (!reading.length || !reading.every(doorIsDark)) continue;
    const last = reading.map(door => door.lastSuccessAt).filter((value): value is string => Number.isFinite(at(value))).sort().at(-1);
    if (last) carried.set(sitting.id, { source: reading[0]!.kind, lastFreshAt: last, reason: "SOURCE_UNAVAILABLE" });
  }
  return { lastCheckedAt, failed: [...failed].map(([source, ocdIds]) => ({ source, ocdIds: [...ocdIds].sort() })).sort((a, b) => a.source.localeCompare(b.source)), carried };
}
