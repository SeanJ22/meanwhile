import { civicDataReadNotInitialized, readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import type { CuratedReaderProjection } from "../civic-data/manual-projections.ts";
import { readPublishedArraySlice, type PublishedArraySlice } from "../civic-data/published-array-slice.ts";
import { requireRegistryState, registryJurisdictions } from "../civic-data/state-scopes.ts";
import { PostgresRoutineDataStore } from "../civic-data/store.ts";
import { activeWiring, meetingSourceNamesForWiring } from "../registry/source-wiring.ts";

export const LEGACY_VENUE_SCOPE = "US-AZ+US-NH+US-NJ:reviewed-venue-resolutions";
export const venueResolutionScope = (state: string): string => `US-${requireRegistryState(state)}:venue-resolutions`;
export interface VenueResolutionReadOptions extends PromotedCivicDataReadOptions {
  readonly state?: string;
  readonly bodyOcdIds?: readonly string[];
}

const escaped = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function projectionRead(slice: PublishedArraySlice<CuratedReaderProjection["records"][number]>, scope: string): CivicDataReadResult<CuratedReaderProjection> {
  const value: CuratedReaderProjection = { kind: "venue-resolutions", records: slice.records };
  const metadata = { recordClass: "CURATED_READER_RECORD" as const, scope, sourceId: slice.sourceId, version: slice.sourceVersion,
    versionId: slice.input.versionId, lastKnownGoodVersionId: slice.input.versionId, promotedAt: slice.input.promotedAt,
    retrievedAt: slice.retrievedAt, sourceThrough: slice.retrievedAt, stale: "UNKNOWN" as const, staleAt: null };
  return { kind: "PROMOTED", value, metadata, projection: { key: `CURATED_READER_RECORD:${scope}`, recordClass: "CURATED_READER_RECORD", scope,
    sourceId: slice.sourceId, versionId: slice.input.versionId, lastKnownGoodVersionId: slice.input.versionId,
    promotedAt: slice.input.promotedAt, receipt: slice.receipt, payload: value } };
}

/** A state's new pins and independently proven legacy pins remain usable together.
 * The returned projection retains its own version; the combined records carry their own citations. */
export async function readVenueResolutionRecords(state: string, options: VenueResolutionReadOptions = {}): Promise<{
  readonly read: CivicDataReadResult<CuratedReaderProjection>;
  readonly records: CuratedReaderProjection["records"];
}> {
  const selected = requireRegistryState(state), bodyIds = options.bodyOcdIds;
  if (bodyIds?.some(body => !registryJurisdictions(body).includes(selected))) throw new Error("VENUE_STATE_BOUNDARY_MISMATCH");
  const store = options.store ?? new PostgresRoutineDataStore();
  const selectors = [{ path: ["bodyOcdId"], pattern: bodyIds?.length ? `^(?:${bodyIds.map(escaped).join("|")})$` : `/(state|district|territory):${selected.toLowerCase()}(/|$)` }];
  for (const wiring of bodyIds?.length ? [] : activeWiring().filter(row => row.ocdId === null && registryJurisdictions(row.bodyId).includes(selected))) {
    const tenant = wiring.config.venueTenant ?? wiring.config.slug;
    if (!tenant) continue;
    for (const source of wiring.config.venueSourceId ? [wiring.config.venueSourceId] : meetingSourceNamesForWiring(wiring))
      selectors.push({ path: ["id"], pattern: `^venue:${escaped(source)}:curated:tenant/${escaped(tenant)}:` });
  }
  const scope = venueResolutionScope(selected);
  const sliceCurrent = bodyIds?.length && store instanceof PostgresRoutineDataStore;
  const currentSlice = sliceCurrent ? await readPublishedArraySlice<CuratedReaderProjection["records"][number]>({
    recordClass: "CURATED_READER_RECORD", scope, path: ["records"], statePath: [], statePattern: "", selectors,
  }) : null;
  const missing = civicDataReadNotInitialized("CURATED_READER_RECORD", scope, "No reviewed venue projection is recorded for this state.");
  const read = sliceCurrent ? currentSlice ? projectionRead(currentSlice, scope)
    : { kind: "NOT_RECORDED" as const, value: null, metadata: missing.metadata, detail: "No reviewed venue projection is recorded for this state." }
    : await readPromotedCivicData<CuratedReaderProjection>("CURATED_READER_RECORD", scope, { ...options, store });
  if (read.kind !== "PROMOTED" && read.kind !== "NOT_RECORDED") return { read, records: [] };
  // Injected stores have no database-side legacy slice. They still exercise the
  // exact state pointer, without loading a national fixture as a fallback.
  const legacy = store instanceof PostgresRoutineDataStore ? await readPublishedArraySlice<CuratedReaderProjection["records"][number]>({
    recordClass: "CURATED_READER_RECORD", scope: LEGACY_VENUE_SCOPE, path: ["records"], statePath: [], statePattern: "", selectors,
  }) : null;
  const current = read.kind === "PROMOTED" ? read.value.records.filter(row => !bodyIds?.length || bodyIds.includes(String(row.bodyOcdId))) : [];
  const records = [...new Map([...(legacy?.records ?? []), ...current].map(row => [row.id, row])).values()];
  if (read.kind === "PROMOTED" || !legacy) return { read, records };
  return { records, read: projectionRead(legacy, LEGACY_VENUE_SCOPE) };
}
