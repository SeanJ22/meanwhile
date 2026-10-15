import { installFactReader } from "../../lib/facts/db.ts";
import { DERIVED_WIRING_SOURCE_NAMES, type DerivedWiringRecord } from "../../lib/civic-data/derived-meeting-wiring.ts";
import { meetingPartitionId, requiredMeetingPartitionContract } from "../../lib/civic-data/meeting-partitions.ts";
import type { RoutineDataStore } from "../../lib/civic-data/store.ts";
import { installDoorRecords } from "../../lib/doors/meeting-doors.ts";
import { applyDerivedRow, checkDoorDraft } from "../../lib/doors/registry.ts";
import { doorFromDerivedRecord } from "../../lib/doors/seed-meetings.ts";
import type { MeetingsSnapshot } from "../../lib/meetings/snapshot.ts";
import type { SourceAcquisitionEvidence } from "../../lib/sources/acquisition-trace.ts";
import type { Meeting } from "../../lib/sources/types.ts";
import { promoteMeetingPartitions } from "../../scripts/ingest.ts";

export function installReviewedMeetingDoors(members: readonly DerivedWiringRecord[], now: string): void {
  installFactReader(null);
  installDoorRecords(members.map(member => {
    const checked = checkDoorDraft(doorFromDerivedRecord(member));
    if (!checked.ok) throw new Error(checked.why);
    return applyDerivedRow(null, checked.value, now, now)!;
  }));
}

export function reviewedMeetingPartition(member: DerivedWiringRecord) {
  return requiredMeetingPartitionContract(meetingPartitionId(DERIVED_WIRING_SOURCE_NAMES[member.row.kind], member.row.bodyId));
}

export async function publishReviewedMeetingBody(input: {
  readonly store: RoutineDataStore;
  readonly member: DerivedWiringRecord;
  readonly meetings: readonly Meeting[];
  readonly acquisitions: readonly Omit<SourceAcquisitionEvidence, "source">[];
  readonly now: string;
  readonly error?: string;
}) {
  const partition = reviewedMeetingPartition(input.member);
  const [result] = await promoteMeetingPartitions({
    store: input.store, partitions: [partition], meetings: input.meetings, agendaDocuments: [], generatedAt: input.now,
    reports: [{ source: partition.meetingSource, ok: !input.error, error: input.error ?? null,
      fetched: input.meetings.length, normalized: input.meetings.length,
      drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
      acquisitions: input.acquisitions.map(row => ({ ...row, source: partition.meetingSource })) }],
    venueFetch: async () => new Response("venue not supplied", { status: 404 }),
  });
  return { ...result, snapshot: result.candidate.readModel as MeetingsSnapshot };
}
