/**
 * A door is overdue when its last successful read is older than its check:
 * its own `checkEveryMinutes`, or the standing check for its kind (meeting
 * doors: hourly with a sitting within 7 days either side, else twice daily).
 * A door that never succeeded is measured from its last record change. Only
 * doors a routine task reads on a clock can be overdue; shut and suspended
 * doors are not listed. Pure.
 */
import { currentMeetingClock } from "../civic-data/contracts.ts";
import type { MeetingsSnapshot } from "../meetings/snapshot.ts";
import { checkEveryWithObserved } from "./observed-rate.ts";
import { readOnSchedule, type DoorRecord } from "./registry.ts";

const MINUTE_MS = 60_000;
/** A body with a sitting inside this span either side is checked at the hot interval; Admin's settings state all three. */
export const hotSittingMs = (): number => currentMeetingClock().windowMs;
export const hotCheckMinutes = (): number => currentMeetingClock().hotEveryMs / MINUTE_MS;
export const coldCheckMinutes = (): number => currentMeetingClock().baseEveryMs / MINUTE_MS;
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

/** The rows behind one door: how many, and when each sits. What is hot depends on the clock, so the times are kept. */
export interface DoorSittings {
  readonly liveFacts: number;
  readonly starts: readonly number[];
}

/** Live meeting rows per (adapter, body). Pure. */
export function meetingSittingsByDoor(snapshot: Pick<MeetingsSnapshot, "meetings">): ReadonlyMap<string, DoorSittings> {
  const out = new Map<string, { liveFacts: number; starts: number[] }>();
  for (const meeting of snapshot.meetings) {
    const source = meeting.carried?.source ?? meeting.id.split(":")[0];
    if (!source || !meeting.bodyId) continue;
    const key = doorFactsKey(source, meeting.bodyId);
    const held = out.get(key) ?? { liveFacts: 0, starts: [] };
    held.liveFacts += 1;
    const startsAt = Date.parse(meeting.startsAt);
    if (Number.isFinite(startsAt)) held.starts.push(startsAt);
    out.set(key, held);
  }
  return out;
}

/** What those rows say about a door at `now`: how many facts sit behind it and whether a sitting is inside the hot window. */
export function doorFactsAt(sittings: DoorSittings, now: string): DoorFacts {
  const nowMs = Date.parse(now);
  return { liveFacts: sittings.liveFacts, hot: sittings.starts.some((startsAt) => Math.abs(startsAt - nowMs) <= hotSittingMs()) };
}

export function meetingFactsByDoor(snapshot: Pick<MeetingsSnapshot, "meetings">, now: string): ReadonlyMap<string, DoorFacts> {
  return new Map([...meetingSittingsByDoor(snapshot)].map(([key, sittings]) => [key, doorFactsAt(sittings, now)]));
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
  const standing = door.meeting != null ? (facts?.hot ? hotCheckMinutes() : coldCheckMinutes()) : STANDING_CHECK_MINUTES;
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
