import {
  CivicDataStoreUnavailableError,
  readPromotedCivicData,
  type CivicDataReadMetadata,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import { meetingPartitionFreshnessMs } from "../civic-data/contracts.ts";
import type { HeldMeetingPartition, MeetingPartitionContract } from "../civic-data/meeting-partitions.ts";
import { DERIVED_FAMILY_SOURCE } from "../civic-data/meeting-partitions.ts";
import { MEETINGS_RECORD_CLASS, validateSnapshot, type MeetingsSnapshot } from "./snapshot.ts";

const validatedProjectionValues = new WeakSet<object>();

export type MeetingsProjectionReadResult =
  | {
      readonly kind: "PROMOTED";
      readonly value: MeetingsSnapshot;
      readonly metadata: CivicDataReadMetadata;
      readonly detail: string;
    }
  | Extract<CivicDataReadResult<MeetingsSnapshot>, { readonly kind: "BOOTSTRAP" | "NOT_RECORDED" | "STORE_UNREACHABLE" }>;

export async function readMeetingPartitionProjection(
  partition: MeetingPartitionContract,
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<MeetingsSnapshot>> {
  const now = options.now ?? new Date().toISOString();
  const result = await readPromotedCivicData<MeetingsSnapshot>(MEETINGS_RECORD_CLASS, partition.scope, {
    ...(options.store ? { store: options.store } : {}),
    now,
    maxAgeMs: options.maxAgeMs ?? meetingPartitionFreshnessMs(now),

  });
  return validateMeetingPartitionProjection(partition, result);
}

function validateMeetingPartitionProjection(
  partition: Pick<MeetingPartitionContract | HeldMeetingPartition, "id" | "meetingSource" | "bodyId"> & {
    readonly derivedFamily?: string | null;
    readonly historyOf?: string;
  },
  result: CivicDataReadResult<MeetingsSnapshot>,
): CivicDataReadResult<MeetingsSnapshot> {
  if (result.kind !== "PROMOTED") return result;
  try {
    if (!validatedProjectionValues.has(result.value)) {
      // A durable partition may consist entirely of carried rows from one failed route; it is served, not read as blank.
      validateSnapshot(result.value, {
        allowAllSourcesFailedForDurableTransfer: true,
      });
      validatedProjectionValues.add(result.value);
    }
    if (partition.historyOf !== undefined) {
      const family = partition.meetingSource === DERIVED_FAMILY_SOURCE;
      for (const meeting of result.value.meetings) {
        if (!meeting.id || !meeting.bodyId || ("derivedParentId" in partition&&partition.derivedParentId&&meeting.bodyId!==partition.bodyId) || (!family && (meeting.bodyId !== partition.bodyId || !meeting.id.startsWith(`${partition.meetingSource}:`)))) {
          throw new Error(`MEETING_HISTORY_ROW_SCOPE_MISMATCH:${partition.id}:${meeting.id}`);
        }
      }
      return result;
    }
    if (partition.derivedFamily) {
      if("derivedParentId" in partition&&partition.derivedParentId&&result.value.meetings.some(meeting=>meeting.bodyId!==partition.bodyId))
        throw new Error(`MEETING_DERIVED_BODY_SCOPE_MISMATCH:${partition.id}`);
      const members = result.value.derivedMembers;
      if (!Array.isArray(members) || members.length === 0) throw new Error(`MEETING_FAMILY_MEMBERS_MISSING:${partition.id}`);
      const memberSources = new Set(members.map((member) => member.source));
      if (result.value.sources.some((source) => !memberSources.has(source.source))) {
        throw new Error(`MEETING_FAMILY_SOURCE_NOT_A_MEMBER:${partition.id}`);
      }
      for (const meeting of result.value.meetings) {
        if (!members.some((member) => member.bodyId === meeting.bodyId && meeting.id.startsWith(`${member.source}:`))) {
          throw new Error(`MEETING_FAMILY_ROW_NOT_A_MEMBER:${partition.id}:${meeting.id}`);
        }
      }
      return result;
    }
    if (result.value.sources.length !== 1 || result.value.sources[0]?.source !== partition.meetingSource) {
      throw new Error(`MEETING_PARTITION_SOURCE_MISMATCH:${partition.id}`);
    }
    for (const meeting of result.value.meetings) {
      if (meeting.bodyId !== partition.bodyId || !meeting.id.startsWith(`${partition.meetingSource}:`)) {
        throw new Error(`MEETING_PARTITION_ROW_SCOPE_MISMATCH:${partition.id}:${meeting.id}`);
      }
    }
    return result;
  } catch (error) {
    return {
      kind: "STORE_UNREACHABLE",
      value: null,
      metadata: result.metadata,
      code: "PROMOTION_PROOF_INVALID",
      detail: error instanceof Error ? error.message : `MEETING_PARTITION_PAYLOAD_INVALID:${partition.id}`,
    };
  }
}

/** Convert the typed state to data or a loud serving failure. */
export function requireMeetingsProjection(
  result: MeetingsProjectionReadResult,
): MeetingsSnapshot {
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") return result.value;
  if (result.kind === "STORE_UNREACHABLE") {
    throw new CivicDataStoreUnavailableError(result);
  }
  throw new Error(result.detail);
}
