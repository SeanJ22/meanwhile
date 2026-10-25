import { MEETING_PARTITION_CONTRACTS, meetingPartitionOfId, type MeetingPartitionContract } from "./meeting-partitions.ts";

/** Isolated calendar children use the parent's exact selection even when the published registry changes. */
export function installMeetingPartitionSelection(contracts: readonly MeetingPartitionContract[]): void {
  if (contracts.length === 0) throw new Error("MEETING_PARTITION_SELECTION_INVALID");
  const ids = new Set<string>(), scopes = new Set<string>();
  for (const contract of contracts) {
    const identity = contract && typeof contract.id === "string" ? meetingPartitionOfId(contract.id) : null;
    if (!identity || contract.recordClass !== "MEETING" || contract.sourceId !== (identity.source === "derived" ? "meetings-derived-routes" : "meetings-public-bodies") ||
        identity.source !== contract.meetingSource || identity.bodyId !== contract.bodyId || identity.scope !== contract.scope ||
        !contract.readerProjection?.id || ids.has(contract.id) || scopes.has(contract.scope) ||
        (contract.wiring !== null && (contract.wiring?.bodyId !== contract.bodyId || contract.wiring?.ocdId !== contract.ocdId))) {
      throw new Error("MEETING_PARTITION_SELECTION_INVALID");
    }
    ids.add(contract.id); scopes.add(contract.scope);
  }
  MEETING_PARTITION_CONTRACTS.splice(0, MEETING_PARTITION_CONTRACTS.length, ...contracts);
}
