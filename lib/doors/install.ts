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
import { type DoorRecord, type DoorRepository } from "./registry.ts";
import { isDoorRecord } from "./registry.ts";
import { ocdStateCode } from "../ocd/state-of.ts";
import { MEETING_PARTITION_CONTRACTS, installMeetingPartitionSchedules, type MeetingPartitionContract } from "../civic-data/meeting-partitions.ts";
import { OUTCOME_PARTITION_CONTRACTS } from "../civic-data/outcome-partitions.ts";
import { RUNTIME_ROUTINE_CONTRACTS } from "../civic-data/runtime-routine-contracts.ts";
import type { RoutineSourceContract } from "../civic-data/contracts.ts";
import { registryJurisdictions } from "../civic-data/state-scopes.ts";

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

export async function refreshDoorsForPass(repo: DoorRepository, options: { readonly state?: string } = {}): Promise<DoorPassResult> {
  try {
    // The country-wide inventory contains only ids and division ids. Configurations
    // are read by state, consumed there, and absent from the final scheduling list.
    const byState = new Map<string, string[]>();
    const unscoped: string[] = [];
    for (const row of await repo.listNarrowed({ ocdId: true, bodyIds: true })) {
      const identity = row.value as { ocdId?: string; bodyIds?: readonly string[] };
      const state = ocdStateCode(identity.ocdId)?.toUpperCase() ?? registryJurisdictions(identity.bodyIds?.[0])[0];
      if (!state) { unscoped.push(`${row.id}: its division and body ids do not name a state; source work remains owed`); continue; }
      if (options.state && state !== options.state.toUpperCase()) continue;
      const ids = byState.get(state) ?? []; ids.push(row.id); byState.set(state, ids);
    }
    const schedules = new Map<string, MeetingPartitionContract>();
    const outcomes: RoutineSourceContract[] = [];
    const skipped: string[] = [...unscoped];
    const skippedOutcomes: { doorId: string; why: string }[] = [];
    let count = 0;
    let selectedDoors: readonly DoorRecord[] = [];
    for (const [state, ids] of byState) {
      const saved = repo.readMany ? await repo.readMany(ids) : (await Promise.all(ids.map(id => repo.read(id)))).filter(row => row !== null);
      const doors = saved.flatMap(row => isDoorRecord(row.value) ? [row.value] : []);
      const installed = installDoorRecords(doors, `${state} door registry`);
      count += installed.rows;
      skipped.push(...installed.partitions.skipped);
      skippedOutcomes.push(...installed.outcomes.skipped);
      for (const contract of MEETING_PARTITION_CONTRACTS) schedules.set(contract.id, { ...contract, wiring: null,
        acquisitionAdapter: { ...contract.acquisitionAdapter,
          command: [...contract.acquisitionAdapter.command, `--state=${contract.derivedFamily?.replace(/^US-/, "") ?? state}`] } });
      for (const { wiring: _wiring, tenant: _tenant, eventBodyId: _eventBodyId, ...contract } of OUTCOME_PARTITION_CONTRACTS) outcomes.push(contract);
      if (options.state) selectedDoors = doors;
    }
    if (options.state && byState.size === 0) installDoorRecords([]);
    if (!options.state) {
      installDoorRecords([]);
      installMeetingPartitionSchedules([...schedules.values()]);
      RUNTIME_ROUTINE_CONTRACTS.splice(0, RUNTIME_ROUTINE_CONTRACTS.length, ...outcomes);
    }
    return { rows: count, reason: count === 0 ? "the door registry holds no meeting door in use" : null,
      partitions: { refreshed: true, partitions: schedules.size, reason: null, skipped },
      outcomes: { refreshed: true, partitions: outcomes.length, reason: null, skipped: skippedOutcomes },
      ...(options.state ? { doors: selectedDoors } : {}) };
  } catch (error) {
    return { rows: 0, reason: `the door registry could not be read (${error instanceof Error ? error.message : String(error)})`, partitions: null, outcomes: null };
  }
}
