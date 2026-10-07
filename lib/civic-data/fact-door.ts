import type { MeetingsSnapshot } from "../meetings/snapshot.ts";

/** A hand-wired partition's rows take its id as `provenance.doorId`; a derived family's rows are left for the member door that matches their body. A row that already names a door keeps it. */
export function stampMeetingDoor(partition: { readonly id: string; readonly derivedFamily: unknown }, value: MeetingsSnapshot): MeetingsSnapshot {
  if (partition.derivedFamily !== null) return value;
  if (value.meetings.every((meeting) => meeting.provenance.doorId !== undefined)) return value;
  return {
    ...value,
    meetings: value.meetings.map((meeting) =>
      meeting.provenance.doorId !== undefined ? meeting : { ...meeting, provenance: { ...meeting.provenance, doorId: partition.id } }),
  };
}
