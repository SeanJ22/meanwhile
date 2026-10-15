import { buildMeetingPartitions } from "../../civic-data/meeting-partitions.ts";
import { readPostingToLive, type PostingToLiveRow } from "../../civic-data/posting-to-live.ts";
import { MEETINGS_RECORD_CLASS } from "../../meetings/snapshot.ts";
import { readPreparedMeetingsProjection } from "../../meetings/prepared-snapshot.ts";
import { PostgresRoutineDataStore } from "../../civic-data/store.ts";
import { meetingFactsByDoor, overdueDoors, type OverdueDoor } from "../../doors/overdue.ts";
import { doorScopeState, readOnSchedule, type DoorRecord } from "../../doors/registry.ts";
import { wiringRowsFromDoors } from "../../doors/rows.ts";
import { fixItems } from "../fix-list.ts";
import type { AdminConfig } from "../gateway/admin-config.ts";
import type { DoorNumberReadings } from "./door-numbers.ts";

async function attempt<T>(read: () => Promise<T>): Promise<T | null> {
  try { return await read(); } catch { return null; }
}

/** Open doors past their check. Live facts per door come from the live meeting snapshot; when it cannot be read they are left uncounted ("—"), not zero. */
export async function readOverdueDoors(doors: readonly DoorRecord[], now: string): Promise<readonly OverdueDoor[]> {
  const rows: OverdueDoor[] = [];
  const byState = new Map<string, DoorRecord[]>();
  for (const door of doors) {
    const state = doorScopeState(door), group = byState.get(state) ?? [];
    group.push(door); byState.set(state, group);
  }
  for (const [state, group] of byState) {
    const snapshot = await attempt(async () => { const r = await readPreparedMeetingsProjection({ now, state }); return r.kind === "PROMOTED" ? r.value : null; });
    const late = overdueDoors(group, snapshot === null ? new Map() : meetingFactsByDoor(snapshot, now), now);
    rows.push(...snapshot === null ? late.map(door => ({ ...door, liveFacts: null })) : late);
  }
  return rows.sort((a, b) => b.overdueByMinutes - a.overdueByMinutes || a.doorId.localeCompare(b.doorId));
}

export async function readRecentPostingToLive(doors: readonly DoorRecord[]): Promise<readonly PostingToLiveRow[]> {
  const store = new PostgresRoutineDataStore();
  const identities = await store.readPromotionIdentities(MEETINGS_RECORD_CLASS, buildMeetingPartitions(wiringRowsFromDoors(doors)).map(partition => partition.scope));
  const rows: PostingToLiveRow[] = [];
  for (const identity of identities) rows.push(...(await readPostingToLive(store, identity.versionId) ?? []));
  return rows;
}

export async function readDoorNumbers(input: { readonly now: string; readonly doors: readonly DoorRecord[] | null; readonly config: AdminConfig | null }): Promise<Omit<DoorNumberReadings, "shutDoors">> {
  const [overdue, posting] = await Promise.all([
    input.doors === null ? null : attempt(() => readOverdueDoors(input.doors!, input.now)),
    input.doors === null ? null : attempt(() => readRecentPostingToLive(input.doors!)),
  ]);
  const scheduled = input.doors === null ? null : input.doors.filter((door) => door.status === "OPEN" && readOnSchedule(door)).length;
  return { now: input.now, overdue, scheduled, posting, fixes: input.config === null ? null : fixItems(input.config) };
}
