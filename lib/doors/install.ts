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
import { withHistoryIndex } from "../control-plane/workers/streamed-history.ts";

const DOOR_READ_BATCH = 128;
const SKIPPED_SAMPLE = 25;

export interface DoorPassResult {
  /** Hand-wired meeting door rows adapters read now. */
  readonly rows: number;
  /** Why there is no hand-wired meeting work this pass, in a sentence; null when there is. */
  readonly reason: string | null;
  /** Skipped lists are bounded samples; skippedCount includes every skipped door. */
  readonly partitions: (MeetingPartitionRefresh & { readonly skippedCount?: number }) | null;
  readonly outcomes: (OutcomePartitionRefresh & { readonly skippedCount?: number }) | null;
  /** The doors the registry held, for what a pass builds from them; absent when it could not be read. */
  readonly doors?: readonly DoorRecord[];
}

export async function refreshDoorsForPass(repo: DoorRepository, options: { readonly state?: string } = {}): Promise<DoorPassResult> {
  try {
    if (!repo.listChangedSince) throw new Error("DOOR_PAGED_INVENTORY_REQUIRED");
    return await withHistoryIndex(async index => {
      index.exec("CREATE TABLE doors(id TEXT PRIMARY KEY,state TEXT NOT NULL,position INTEGER NOT NULL); CREATE INDEX door_states ON doors(state,position)");
      const insert = index.prepare("INSERT INTO doors VALUES(?,?,?)");
      const selectedState = options.state?.toUpperCase();
      const schedules = new Map<string, MeetingPartitionContract>();
      const outcomes: RoutineSourceContract[] = [];
      const skipped: string[] = [];
      const skippedOutcomes: { doorId: string; why: string }[] = [];
      let skippedCount = 0, skippedOutcomeCount = 0, position = 0;
      const skip = (why: string) => { skippedCount++; if (skipped.length < SKIPPED_SAMPLE) skipped.push(why); };
      // Only one projected page leaves the repository at a time. Country identities
      // stay on disk; a child's index holds only its own state's identities.
      await repo.listChangedSince!(null, undefined, {
        projection: { ocdId: true, bodyIds: true },
        page: rows => {
          for (const row of rows) {
            const identity = row.value as { ocdId?: string; bodyIds?: readonly string[] };
            const state = ocdStateCode(identity.ocdId)?.toUpperCase() ??
              (Array.isArray(identity.bodyIds) ? identity.bodyIds.flatMap(registryJurisdictions)[0] : undefined);
            if (!state) { skip(`${row.id}: its division and body ids do not name a state; source work remains owed`); continue; }
            if (!selectedState || state === selectedState) insert.run(row.id, state, position++);
          }
        },
      });
      let count = 0;
      let selectedDoors: readonly DoorRecord[] = [];
      let stateCount = 0;
      for (const { state } of index.prepare("SELECT state FROM doors GROUP BY state ORDER BY min(position)").iterate()) {
        stateCount++;
        const doors: DoorRecord[] = [];
        let ids: string[] = [];
        const readBatch = async () => {
          const saved = repo.readMany ? await repo.readMany(ids) : (await Promise.all(ids.map(id => repo.read(id)))).filter(row => row !== null);
          for (const row of saved) if (isDoorRecord(row.value)) doors.push(row.value);
          ids = [];
        };
        for (const { id } of index.prepare("SELECT id FROM doors WHERE state=? ORDER BY position").iterate(state)) {
          ids.push(id);
          if (ids.length === DOOR_READ_BATCH) await readBatch();
        }
        if (ids.length) await readBatch();
        const installed = installDoorRecords(doors, `${state} door registry`);
        count += installed.rows;
        for (const why of installed.partitions.skipped) skip(why);
        for (const why of installed.outcomes.skipped) {
          skippedOutcomeCount++;
          if (skippedOutcomes.length < SKIPPED_SAMPLE) skippedOutcomes.push(why);
        }
        for (const contract of MEETING_PARTITION_CONTRACTS) schedules.set(contract.id, { ...contract, wiring: null,
          acquisitionAdapter: { ...contract.acquisitionAdapter,
            command: [...contract.acquisitionAdapter.command, `--state=${contract.derivedFamily?.replace(/^US-/, "") ?? state}`] } });
        for (const { wiring: _wiring, tenant: _tenant, eventBodyId: _eventBodyId, ...contract } of OUTCOME_PARTITION_CONTRACTS) outcomes.push(contract);
        if (selectedState) selectedDoors = doors;
      }
      if (selectedState && stateCount === 0) installDoorRecords([]);
      if (!selectedState) {
        installDoorRecords([]);
        installMeetingPartitionSchedules([...schedules.values()]);
        RUNTIME_ROUTINE_CONTRACTS.splice(0, RUNTIME_ROUTINE_CONTRACTS.length, ...outcomes);
      }
      return { rows: count, reason: count === 0 ? "the door registry holds no meeting door in use" : null,
        partitions: { refreshed: true, partitions: schedules.size, reason: null, skipped, skippedCount },
        outcomes: { refreshed: true, partitions: outcomes.length, reason: null, skipped: skippedOutcomes, skippedCount: skippedOutcomeCount },
        ...(selectedState ? { doors: selectedDoors } : {}) };
    });
  } catch (error) {
    return { rows: 0, reason: `the door registry could not be read (${error instanceof Error ? error.message : String(error)})`, partitions: null, outcomes: null };
  }
}
