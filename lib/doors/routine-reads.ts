import type { RecordProjection } from "../control-plane/repository/types.ts";
import { PROBE_URL_KEYS } from "./probe.ts";
import { isDoorRecord, type DoorRecord, type DoorRepository } from "./registry.ts";

const IDENTITY = { formatVersion: true, doorId: true, kind: true, bodyIds: true, hosts: true,
  status: true, updatedAt: true } as const;

/** The routine coordinator needs selectors; saved source captures stay in the store. */
export const ROUTINE_DOOR_FIELDS = {
  probes: { ...IDENTITY, ocdId: true, meeting: ["family"], config: [...PROBE_URL_KEYS, "contractId"],
    validators: true, checkEveryMinutes: true },
  publication: { ...IDENTITY, meeting: ["family"], config: ["contractId"],
    validators: ["changedAt"], lastSuccessAt: true },
  refresh: { ...IDENTITY, ocdId: true, config: [...PROBE_URL_KEYS, "workItemId"],
    meeting: ["family"], observedChangeMinutes: true, observedChanges: true,
    checkEveryMinutes: true, lastSuccessAt: true },
  requests: { ...IDENTITY, meeting: ["family"], config: ["contractId"], readNow: true,
    origin: true, editedAt: true },
} as const satisfies Readonly<Record<string, RecordProjection>>;

export async function readRoutineDoors(repo: DoorRepository, purpose: keyof typeof ROUTINE_DOOR_FIELDS): Promise<DoorRecord[]> {
  const projection = ROUTINE_DOOR_FIELDS[purpose];
  // Re-read after probes/settlement: their updates must be visible in this same pass.
  const rows = purpose === "refresh"
    ? await repo.listWhereNarrowed(["kind"], "page", projection)
    : (await Promise.all((purpose === "requests" ? ["OPEN", "SHUT"] : ["OPEN"])
      .map(status => repo.listWhereNarrowed(["status"], status, projection)))).flat();
  return rows.map(row => row.value).filter(isDoorRecord)
    .sort((a, b) => a.doorId < b.doorId ? -1 : a.doorId > b.doorId ? 1 : 0);
}
