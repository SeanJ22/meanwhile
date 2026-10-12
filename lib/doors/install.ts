/**
 * Puts the door registry's meeting doors where adapters read them, at the
 * start of every runner pass and wherever a process reads the registry
 * itself. The registry is the only door list: a registry that cannot be read,
 * or holds no meeting door in use, gives the pass no hand-wired meeting work,
 * and the pass says so.
 */

import type { MeetingPartitionRefresh } from "../civic-data/meeting-partitions.ts";
import type { OutcomePartitionRefresh } from "../civic-data/outcome-partitions.ts";
import { installDoorRecords } from "./meeting-doors.ts";
import { listDoors, type DoorRecord, type DoorRepository } from "./registry.ts";

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

export async function refreshDoorsForPass(repo: DoorRepository): Promise<DoorPassResult> {
  let doors: readonly DoorRecord[];
  try {
    doors = (await listDoors(repo)).doors;
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
