/** Each read fails alone to null, so its row says why it is not measured instead of showing a zero. */
import { MEETING_PARTITION_CONTRACTS } from "../../civic-data/meeting-partitions.ts";
import { readPostingToLive, type PostingToLiveRow } from "../../civic-data/posting-to-live.ts";
import { MEETINGS_RECORD_CLASS } from "../../meetings/snapshot.ts";
import { readMeetingBodies } from "../../meetings/edge-serving.ts";
import { PostgresRoutineDataStore } from "../../civic-data/store.ts";
import { doorFactsAt, meetingSittingsByDoor, overdueDoors, type DoorFacts, type OverdueDoor } from "../../doors/overdue.ts";
import { readOnSchedule, type DoorRecord } from "../../doors/registry.ts";
import { ensureMeetingDoors } from "../../doors/meeting-doors.ts";
import { fixItems } from "../fix-list.ts";
import type { AdminConfig } from "../gateway/admin-config.ts";
import type { DoorNumberReadings } from "./door-numbers.ts";

async function attempt<T>(read: () => Promise<T>): Promise<T | null> {
  try { return await read(); } catch { return null; }
}

/** The live facts behind every meeting door, read one state and one body at a time. A body that cannot be read leaves the whole count unread. */
async function meetingDoorFacts(now: string): Promise<ReadonlyMap<string, DoorFacts> | null> {
  const facts = new Map<string, DoorFacts>();
  for await (const body of readMeetingBodies({ includeAgenda: false, now })) {
    const read = await body.load();
    if (read === null) return null;
    const held = meetingSittingsByDoor(read.snapshot);
    for (const [key, sittings] of held) facts.set(key, doorFactsAt(sittings, now));
  }
  return facts;
}

/** Open doors past their check. Live facts per door come from the bodies' records; when they cannot be read they are left uncounted ("—"), not zero. */
export async function readOverdueDoors(doors: readonly DoorRecord[], now: string): Promise<readonly OverdueDoor[]> {
  const facts = await attempt(() => meetingDoorFacts(now));
  const late = overdueDoors(doors, facts ?? new Map(), now);
  return facts === null ? late.map((d) => ({ ...d, liveFacts: null })) : late;
}

export async function readRecentPostingToLive(): Promise<readonly PostingToLiveRow[]> {
  await ensureMeetingDoors();
  const store = new PostgresRoutineDataStore();
  const identities = await store.readPromotionIdentities(MEETINGS_RECORD_CLASS, MEETING_PARTITION_CONTRACTS.map((p) => p.scope));
  const rows: PostingToLiveRow[] = [];
  for (const identity of identities) rows.push(...(await readPostingToLive(store, identity.versionId) ?? []));
  return rows;
}

export async function readDoorNumbers(input: { readonly now: string; readonly doors: readonly DoorRecord[] | null; readonly config: AdminConfig | null }): Promise<Omit<DoorNumberReadings, "shutDoors">> {
  const [overdue, posting] = await Promise.all([
    input.doors === null ? null : attempt(() => readOverdueDoors(input.doors!, input.now)),
    attempt(() => readRecentPostingToLive()),
  ]);
  const scheduled = input.doors === null ? null : input.doors.filter((door) => door.status === "OPEN" && readOnSchedule(door)).length;
  return { now: input.now, overdue, scheduled, posting, fixes: input.config === null ? null : fixItems(input.config) };
}
