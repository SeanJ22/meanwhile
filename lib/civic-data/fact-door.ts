import type { MeetingsSnapshot } from "../meetings/snapshot.ts";

/** A row keeps its acquired door identity; otherwise its own body partition supplies it. */
export function stampMeetingDoor(partition: { readonly id: string }, value: MeetingsSnapshot): MeetingsSnapshot {
  if (value.meetings.every((meeting) => meeting.provenance.doorId !== undefined)) return value;
  return {
    ...value,
    meetings: value.meetings.map((meeting) =>
      meeting.provenance.doorId !== undefined ? meeting : { ...meeting, provenance: { ...meeting.provenance, doorId: partition.id } }),
  };
}
