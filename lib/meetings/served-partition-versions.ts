import type { Meeting } from "../sources/types.ts";
import type { MeetingPartitionReadback } from "./snapshot.ts";

export interface ServedMeetingPartitionVersion {
  readonly scope: string;
  readonly versionId: string;
  readonly meetingIds: readonly string[];
}

/** A cached route answer for an earlier pointer must never certify a successor. */
export function hostedMeetingPartitionMatches(
  entries: readonly ServedMeetingPartitionVersion[] | undefined,
  scope: string,
  versionId: string,
  meetingIds: readonly string[],
): boolean {
  return entries?.some((row) => row.scope === scope && row.versionId === versionId &&
    JSON.stringify([...row.meetingIds].sort()) === JSON.stringify([...meetingIds].sort())) ?? false;
}

/** A compact public version witness for only the named rows in one response.
 * Ambiguous, held-from, or unversioned partitions are omitted, never guessed. */
export function servedMeetingPartitionVersions(
  meetings: readonly Pick<Meeting, "id" | "bodyId">[],
  partitions: readonly MeetingPartitionReadback[] | undefined,
): readonly ServedMeetingPartitionVersion[] {
  if (!partitions) return [];
  const grouped = new Map<string, { versionId: string; meetingIds: string[] }>();
  for (const meeting of meetings) {
    const matches = partitions.filter((partition) => partition.kind === "PROMOTED" &&
      !partition.heldFrom && partition.versionId && meeting.bodyId === partition.bodyId &&
      meeting.id.startsWith(`${partition.source}:`));
    if (matches.length !== 1) continue;
    const partition = matches[0]!;
    const previous = grouped.get(partition.scope);
    if (previous && previous.versionId !== partition.versionId) continue;
    if (previous) previous.meetingIds.push(meeting.id);
    else grouped.set(partition.scope, { versionId: partition.versionId!, meetingIds: [meeting.id] });
  }
  return [...grouped].map(([scope, value]) => ({ scope, versionId: value.versionId,
    meetingIds: [...new Set(value.meetingIds)].sort() }))
    .sort((a, b) => a.scope.localeCompare(b.scope));
}
