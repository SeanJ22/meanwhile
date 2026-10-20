import { readPublishedArraySlice, type PublishedArraySlice } from "../../civic-data/published-array-slice.ts";
import { civicDataReadNotInitialized, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../../civic-data/read-model.ts";
import { PostgresRoutineDataStore } from "../../civic-data/store.ts";
import { requireRegistryState } from "../../civic-data/state-scopes.ts";
import { readOpenDataProjection } from "./publication.ts";
import { openDataScope, type OpenDataFact, type OpenDataPartitionRef, type OpenDataProjection, type OpenDataSource } from "./model.ts";

export type OpenDataAreaRead = CivicDataReadResult<OpenDataProjection> & {
  readonly sourceInputs?: readonly PublishedArraySlice<unknown>["input"][];
};

export const openDataPattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const openDataStatePartition = (state: string) => `state:${requireRegistryState(state)}`;
export function openDataReferencePattern(state: string, partitions?: readonly string[]): string {
  const selected = requireRegistryState(state);
  return partitions
    ? `^(?:${partitions.map(openDataPattern).join("|")})(?::state:${selected})?(?::page:[0-9]+)?$`
    : `(?:^division:ocd-division/country:us/(?:state|district|territory):${selected.toLowerCase()}(?:/|$)|:state:${selected}(?::|$))`;
}
function sliceRead(slice: PublishedArraySlice<OpenDataPartitionRef>, source: OpenDataSource): CivicDataReadResult<OpenDataProjection> {
  const scope = slice.input.scope, value: OpenDataProjection = { kind: "open-data", sourceId: source, records: [], reports: [], partitions: slice.records };
  const metadata = { recordClass: "CURATED_READER_RECORD" as const, scope, sourceId: source, version: slice.sourceVersion, versionId: slice.input.versionId,
    lastKnownGoodVersionId: slice.input.versionId, promotedAt: slice.input.promotedAt, retrievedAt: slice.retrievedAt, sourceThrough: slice.retrievedAt,
    stale: "UNKNOWN" as const, staleAt: null };
  return { kind: "PROMOTED", value, metadata, projection: { key: `CURATED_READER_RECORD:${scope}`, recordClass: "CURATED_READER_RECORD", scope,
    sourceId: source, versionId: slice.input.versionId, lastKnownGoodVersionId: slice.input.versionId, promotedAt: slice.input.promotedAt, receipt: slice.receipt, payload: value } };
}

/** Area manifests and legacy pointers are filtered in the database before transfer.
 * A prior state publication never opens the old national manifest in JavaScript. */
export async function readOpenDataArea(source: OpenDataSource, state: string, partitions?: readonly string[], options: PromotedCivicDataReadOptions = {}): Promise<OpenDataAreaRead> {
  const selected = requireRegistryState(state), partition = openDataStatePartition(selected), scope = openDataScope(source, partition);
  const pattern = openDataReferencePattern(selected, partitions), store = options.store ?? new PostgresRoutineDataStore();
  if (!(store instanceof PostgresRoutineDataStore)) {
    const read = await readOpenDataProjection(source, partition, { ...options, store });
    if (read.kind !== "PROMOTED") return read;
    const value = { ...read.value, partitions: read.value.partitions?.filter(row => new RegExp(pattern).test(row.id)) };
    return { ...read, value };
  }
  const read = (scope: string) => readPublishedArraySlice<OpenDataPartitionRef>({ recordClass: "CURATED_READER_RECORD", scope,
    path: ["partitions"], statePath: ["id"], statePattern: pattern });
  const current = await read(scope), legacy = await read(openDataScope(source, "national"));
  if (!current && !legacy) {
    const missing = civicDataReadNotInitialized("CURATED_READER_RECORD", scope, "The source has no held data for this state.");
    return { kind: "NOT_RECORDED", value: null, metadata: missing.metadata, detail: "The source has no held data for this state." };
  }
  const held = sliceRead(current ?? legacy!, source);
  if (held.kind !== "PROMOTED") return held;
  // New immutable references win; old independently proven slices remain usable.
  const refs = [...new Map([...(legacy?.records ?? []), ...(current?.records ?? [])].map(row => [row.id, row])).values()];
  const value = { ...held.value, partitions: refs };
  return { ...held, value, sourceInputs: [...(current ? [current.input] : []), ...(legacy ? [legacy.input] : [])] };
}

/** Compatibility for the original flat source projection: select only the
 * requested divisions or exact ZIP, without resolving the national payload. */
export async function readLegacyOpenDataRecords(source: OpenDataSource, input: { divisionIds?: readonly string[]; zip?: string | null }, options: PromotedCivicDataReadOptions = {}): Promise<readonly OpenDataFact[]> {
  if (options.store && !(options.store instanceof PostgresRoutineDataStore)) return [];
  const selectors = source === "socrata-discovery"
    ? [{ path: ["divisionIds"], pattern: `"(?:${(input.divisionIds ?? []).map(openDataPattern).join("|")})"` }]
    : [{ path: ["zip"], pattern: `^${openDataPattern(input.zip ?? "")}$` }];
  const slice = await readPublishedArraySlice<OpenDataFact>({ recordClass: "CURATED_READER_RECORD", scope: openDataScope(source, "national"),
    path: ["records"], statePath: [], statePattern: "", selectors });
  return slice?.records ?? [];
}
