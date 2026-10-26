import type { RecordProjection } from "../control-plane/repository/types.ts";
import { PROBE_URL_KEYS } from "./probe.ts";
import { isDoorRecord, type DoorRecord, type DoorRepository } from "./registry.ts";

/** Scheduling and routing fields; saved web pages and extraction inputs are never read to choose work. */
export const RUNNER_DOOR_FIELDS: RecordProjection = {
  formatVersion: true, doorId: true, kind: true, bodyIds: true, hosts: true, holds: true,
  status: true, updatedAt: true, ocdId: true, origin: true, editedAt: true,
  checkEveryMinutes: true, lastSuccessAt: true, lastFailureAt: true, readNow: true,
  validators: true, meeting: true,
  config: [...PROBE_URL_KEYS, "contractId", "partitionRoute", "workItemId"],
};

const IDENTITY = { formatVersion: true, doorId: true, kind: true, bodyIds: true, hosts: true,
  status: true, updatedAt: true } as const;
const PARTITION = { meeting: ["family"], config: ["contractId", "partitionRoute"] } as const;

/** Each stage reads its own current selectors after the preceding stage's writes. */
export const RUNNER_DOOR_STAGE_FIELDS = {
  probes: { ...IDENTITY, ...PARTITION, ocdId: true, config: [...PROBE_URL_KEYS, ...PARTITION.config],
    validators: true, checkEveryMinutes: true },
  publication: { ...IDENTITY, ...PARTITION, validators: ["changedAt"], lastSuccessAt: true },
  refresh: { ...IDENTITY, ocdId: true, config: [...PROBE_URL_KEYS, "workItemId"], meeting: ["family"],
    observedChangeMinutes: true, observedChanges: true, checkEveryMinutes: true, lastSuccessAt: true },
  requests: { ...IDENTITY, ...PARTITION, readNow: true, origin: true, editedAt: true },
} as const satisfies Readonly<Record<string, RecordProjection>>;

/** Current membership, with only changed projected values supplied by the repository's revision reader. */
export async function readRunnerDoors(repo: DoorRepository, path: readonly string[], value: string,
  stage?: keyof typeof RUNNER_DOOR_STAGE_FIELDS): Promise<readonly DoorRecord[]> {
  const rows = await repo.listWhereNarrowed(path, value, stage ? RUNNER_DOOR_STAGE_FIELDS[stage] : RUNNER_DOOR_FIELDS);
  const rank = { SHUT: 0, SUSPENDED: 1, OPEN: 2 };
  return rows.map(row => row.value).filter(isDoorRecord)
    .sort((a, b) => rank[a.status] - rank[b.status] || (a.doorId < b.doorId ? -1 : a.doorId > b.doorId ? 1 : 0));
}
