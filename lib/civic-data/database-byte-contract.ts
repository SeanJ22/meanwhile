/** Expected database transfer, including requests and responses. These numbers are workload declarations, not Sean's spending limits. */
export interface DatabaseByteContract {
  readonly databaseBytesPerRun: number;
  readonly databaseBytesPerUnchangedRun: number;
  readonly databaseByteBasis: "EXPECTED" | "MEASURED";
}

const MiB = 1024 ** 2;
const profiles: Readonly<Record<string, readonly [number, number]>> = {
  "people-portraits": [16 * MiB, 64 * 1024],
  "member-offices": [32 * MiB, 64 * 1024],
  "routine-civic-data": [64 * MiB, MiB],
  "publish-now": [16 * MiB, 64 * 1024],
  "research-cycle": [64 * MiB, MiB],
  "STATE_LEGISLATOR": [32 * MiB, 128 * 1024],
  "STATE_BILL": [64 * MiB, 256 * 1024],
  "STATE_ROLL_CALL": [32 * MiB, 128 * 1024],
  "STATE_LEGISLATOR_VOTES": [32 * MiB, 128 * 1024],
  "FEDERAL_CIVIC_RECORD": [32 * MiB, 128 * 1024],
  "FEDERAL_MONEY": [64 * MiB, 128 * 1024],
  "CENSUS_REFERENCE": [64 * MiB, 128 * 1024],
  "CENSUS_GEOGRAPHY": [64 * MiB, 128 * 1024],
  "REGISTRATION": [32 * MiB, 128 * 1024],
  "MEETING": [8 * MiB, 64 * 1024],
};

/** Shared declarations cover generated state/body contracts as well as the static catalog. */
export function databaseByteContract(source: { readonly id: string; readonly sourceId?: string; readonly recordClass?: string }): DatabaseByteContract {
  const [databaseBytesPerRun, databaseBytesPerUnchangedRun] = profiles[source.id] ?? profiles[source.sourceId ?? ""] ??
    profiles[source.recordClass ?? ""] ?? [16 * MiB, 64 * 1024];
  return { databaseBytesPerRun, databaseBytesPerUnchangedRun, databaseByteBasis: "EXPECTED" };
}

export function withDatabaseByteContract<T extends { readonly id: string; readonly sourceId?: string; readonly recordClass?: string }>(source: T): T & DatabaseByteContract {
  return { ...source, ...databaseByteContract(source) };
}

export const ROUTINE_RUN_DATABASE_BYTES = databaseByteContract({ id: "routine-civic-data" });
export const PUBLISH_NOW_DATABASE_BYTES = databaseByteContract({ id: "publish-now" });

export const ROUTINE_SUPERVISOR_DATABASE_CONTRACT = { id: "routine-civic-data", ...ROUTINE_RUN_DATABASE_BYTES };
export const PUBLISH_NOW_DATABASE_CONTRACT = { id: "publish-now", ...PUBLISH_NOW_DATABASE_BYTES };
export const RESEARCH_CYCLE_DATABASE_CONTRACT = {id:"research-cycle",...databaseByteContract({id:"research-cycle"})};
