import { sittingWindowHotByConclusion, meetingPayloadStatedEnds } from "../civic-data/sitting-window-admission.ts";
import type { AdminConfig } from "../control-plane/gateway/admin-config.ts";
import { meetingScheduleFromSettings, MEETING_SETTING_DEFAULTS } from "../meetings/settings.ts";
import type { Meeting } from "../sources/types.ts";
import type { MeetingsSnapshot } from "../meetings/snapshot.ts";
import { checkEveryWithObserved } from "./observed-rate.ts";
import { readOnSchedule, type DoorRecord } from "./registry.ts";

const MINUTE_MS = 60_000;
export const HOT_CHECK_MINUTES = MEETING_SETTING_DEFAULTS["meetings.hotEveryMinutes"];
export const COLD_CHECK_MINUTES = MEETING_SETTING_DEFAULTS["meetings.baseEveryMinutes"];
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
export function meetingFactsByDoor(snapshot: Pick<MeetingsSnapshot, "meetings">, now: string, config: AdminConfig | null = null): ReadonlyMap<string, DoorFacts> {
  const nowMs = Date.parse(now);
  const out = new Map<string, { liveFacts: number; hot: boolean }>();
  const bodies = new Map<string, Meeting[]>();
  const schedule = meetingScheduleFromSettings(config);
  for (const meeting of snapshot.meetings) {
    const source = meeting.carried?.source ?? meeting.id.split(":")[0];
    if (!source || !meeting.bodyId) continue;
    const key = doorFactsKey(source, meeting.bodyId);
    const held = out.get(key) ?? { liveFacts: 0, hot: false };
    held.liveFacts += 1;
    out.set(key, held);
    const siblings = bodies.get(meeting.bodyId) ?? [];
    siblings.push(meeting); bodies.set(meeting.bodyId, siblings);
  }
  const hot = new Set([...bodies].filter(([, meetings]) => sittingWindowHotByConclusion(schedule,
    [meetings.map(meeting => meeting.startsAt)], nowMs, meetingPayloadStatedEnds({ meetings })) === true).map(([bodyId]) => bodyId));
  for (const [key, facts] of out) facts.hot = hot.has(key.slice(key.indexOf("\u0000") + 1));
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
export function checkEveryFor(door: DoorRecord, facts: DoorFacts | undefined, config: AdminConfig | null = null): { readonly minutes: number; readonly own: boolean } {
  if (door.checkEveryMinutes !== null) return { minutes: door.checkEveryMinutes, own: true };
  // The faster of the standing check and the observed change rate.
  const schedule = meetingScheduleFromSettings(config);
  const standing = door.meeting != null ? (facts?.hot !== false ? schedule.hotEveryMs : schedule.baseEveryMs) / MINUTE_MS : STANDING_CHECK_MINUTES;
  return { minutes: checkEveryWithObserved(door, standing).minutes, own: false };
}

/** Open doors whose last success is older than their check, most late first. */
export function overdueDoors(
  doors: readonly DoorRecord[],
  facts: ReadonlyMap<string, DoorFacts> | null,
  now: string,
  config: AdminConfig | null = null,
): OverdueDoor[] {
  const nowMs = Date.parse(now);
  const out: OverdueDoor[] = [];
  const hotBodies = new Set([...(facts ?? [])].filter(([, value]) => value.hot).map(([key]) => key.slice(key.indexOf("\u0000") + 1)));
  for (const door of doors) {
    if (door.status !== "OPEN" || !readOnSchedule(door)) continue;
    const key = door.meeting != null && door.bodyIds.length === 1 ? doorFactsKey(door.kind, door.bodyIds[0]!) : null;
    const held = key === null || facts === null ? undefined : facts.get(key) ?? { liveFacts: 0, hot: hotBodies.has(door.bodyIds[0]!) };
    const check = checkEveryFor(door, held, config);
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
      liveFacts: key === null || facts === null ? null : held?.liveFacts ?? 0,
    });
  }
  return out.sort((a, b) => b.overdueByMinutes - a.overdueByMinutes || (a.doorId < b.doorId ? -1 : 1));
}
