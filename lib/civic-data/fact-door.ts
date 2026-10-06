/**
 * **EVERY LIVE FACT KNOWS ITS DOOR** (DB-28), meeting side.
 *
 * A hand-wired meeting door is keyed on its partition id (`doorsFromWiringRow`), so a row read from that partition
 * takes that id as `provenance.doorId`. A derived family's partition holds many doors, one per body: its rows are left
 * for the door that matches the row's body (the family member), so nothing is guessed here. A row that already names a
 * door keeps it. Pure; stamped when the partition is composed, so every reader sees it without a new promotion.
 */
import type { MeetingsSnapshot } from "../meetings/snapshot.ts";

export function stampMeetingDoor(partition: { readonly id: string; readonly derivedFamily: unknown }, value: MeetingsSnapshot): MeetingsSnapshot {
  if (partition.derivedFamily !== null) return value;
  if (value.meetings.every((meeting) => meeting.provenance.doorId !== undefined)) return value;
  return {
    ...value,
    meetings: value.meetings.map((meeting) =>
      meeting.provenance.doorId !== undefined ? meeting : { ...meeting, provenance: { ...meeting.provenance, doorId: partition.id } }),
  };
}
