import type { MeetingPartitionRefresh } from "../civic-data/meeting-partitions.ts";
import type { OutcomePartitionRefresh } from "../civic-data/outcome-partitions.ts";
import { installDoorRecords } from "./meeting-doors.ts";
import { isDoorRecord, listDoors, type DoorRecord, type DoorRepository } from "./registry.ts";

export interface DoorPassResult {
  /** Hand-wired meeting door rows adapters read now. */
  readonly rows: number;
  /** Why there is no hand-wired meeting work this pass, in a sentence; null when there is. */
  readonly reason: string | null;
  readonly partitions: MeetingPartitionRefresh | null;
  readonly outcomes: OutcomePartitionRefresh | null;
  /** The doors the registry held, for what a pass builds from them; absent when it could not be read. */
  readonly doors?: readonly DoorRecord[];
}

export async function refreshDoorsForPass(repo: DoorRepository, state?: string): Promise<DoorPassResult> {
  let doors: readonly DoorRecord[];
  try {
    doors = state === undefined ? (await listDoors(repo)).doors
      : (await repo.listWhere(["scopeState"], state)).map(row => row.value).filter(isDoorRecord);
  } catch (error) {
    return { rows: 0, reason: `the door registry could not be read (${error instanceof Error ? error.message : String(error)})`, partitions: null, outcomes: null };
  }
  const installed = installDoorRecords(doors);
  return {
    rows: installed.rows,
    reason: installed.rows === 0 ? "the door registry holds no meeting door in use" : null,
    partitions: installed.partitions,
    outcomes: installed.outcomes,
    doors,
  };
}
