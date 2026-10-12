/**
 * A door is overdue when its last successful read is older than its check:
 * its own `checkEveryMinutes`, or the standing check for its kind (meeting
 * doors: hourly with a sitting within 7 days either side, else twice daily).
 * A door that never succeeded is measured from its last record change. Only
 * doors a routine task reads on a clock can be overdue; shut and suspended
 * doors are not listed. Pure.
 */
import type { MeetingsSnapshot } from "../meetings/snapshot.ts";
import { checkEveryWithObserved } from "./observed-rate.ts";
import { readOnSchedule, type DoorRecord } from "./registry.ts";

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** A body with a sitting inside this many days either side is checked hourly. */
export const HOT_SITTING_DAYS = 7;
export const HOT_CHECK_MINUTES = 60;
export const COLD_CHECK_MINUTES = 12 * 60;
/** A non-meeting door with no setting of its own: daily, until its kind states a standing check. */
export const STANDING_CHECK_MINUTES = 24 * 60;

/** What the live meeting rows say about one door: how many facts sit behind it and whether a sitting is near. */
export interface DoorFacts {
  readonly liveFacts: number;
  readonly hot: boolean;
}

/** The key a meeting row and a meeting door share: the adapter it was read by and the body it belongs to. */
export function doorFactsKey(source: string, bodyId: string): string {
  return `${source}\u0000${bodyId}`;
}

/** Live meeting facts per (adapter, body), and whether any sitting is inside the hot window of `now`. Pure. */
export function meetingFactsByDoor(snapshot: Pick<MeetingsSnapshot, "meetings">, now: string): ReadonlyMap<string, DoorFacts> {
  const nowMs = Date.parse(now);
  const out = new Map<string, { liveFacts: number; hot: boolean }>();
  for (const meeting of snapshot.meetings) {
    const source = meeting.carried?.source ?? meeting.id.split(":")[0];
    if (!source || !meeting.bodyId) continue;
    const key = doorFactsKey(source, meeting.bodyId);
    const held = out.get(key) ?? { liveFacts: 0, hot: false };
    held.liveFacts += 1;
    const startsAt = Date.parse(meeting.startsAt);
    if (Number.isFinite(startsAt) && Math.abs(startsAt - nowMs) <= HOT_SITTING_DAYS * DAY_MS) held.hot = true;
    out.set(key, held);
  }
  return out;
}

export interface OverdueDoor {
  readonly doorId: string;
  readonly kind: string;
  readonly bodyIds: readonly string[];
  readonly lastSuccessAt: string | null;
  /** The check this door owes, in minutes, and whether it is the door's own setting. */
  readonly checkEveryMinutes: number;
  readonly checkEverySetOnDoor: boolean;
  /** How long past that check, in minutes. */
  readonly overdueByMinutes: number;
  /** Live facts behind the door; null where the facts are not yet counted per door (a door that is not a meeting door). */
  readonly liveFacts: number | null;
}

/** The check a door owes at `now`. */
export function checkEveryFor(door: DoorRecord, facts: DoorFacts | undefined): { readonly minutes: number; readonly own: boolean } {
  if (door.checkEveryMinutes !== null) return { minutes: door.checkEveryMinutes, own: true };
  // The faster of the standing check and the observed change rate.
  const standing = door.meeting != null ? (facts?.hot ? HOT_CHECK_MINUTES : COLD_CHECK_MINUTES) : STANDING_CHECK_MINUTES;
  return { minutes: checkEveryWithObserved(door, standing).minutes, own: false };
}

/** Open doors whose last success is older than their check, most late first. */
export function overdueDoors(
  doors: readonly DoorRecord[],
  facts: ReadonlyMap<string, DoorFacts>,
  now: string,
): OverdueDoor[] {
  const nowMs = Date.parse(now);
  const out: OverdueDoor[] = [];
  for (const door of doors) {
    if (door.status !== "OPEN" || !readOnSchedule(door)) continue;
    const key = door.meeting != null && door.bodyIds.length === 1 ? doorFactsKey(door.kind, door.bodyIds[0]!) : null;
    const held = key === null ? undefined : facts.get(key);
    const check = checkEveryFor(door, held);
    const sinceMs = Date.parse(door.lastSuccessAt ?? door.updatedAt);
    if (!Number.isFinite(sinceMs)) continue;
    const overdueMs = nowMs - sinceMs - check.minutes * MINUTE_MS;
    if (!(overdueMs > 0)) continue;
    out.push({
      doorId: door.doorId,
      kind: door.kind,
      bodyIds: door.bodyIds,
      lastSuccessAt: door.lastSuccessAt,
      checkEveryMinutes: check.minutes,
      checkEverySetOnDoor: check.own,
      overdueByMinutes: Math.floor(overdueMs / MINUTE_MS),
      liveFacts: key === null ? null : held?.liveFacts ?? 0,
    });
  }
  return out.sort((a, b) => b.overdueByMinutes - a.overdueByMinutes || (a.doorId < b.doorId ? -1 : 1));
}
