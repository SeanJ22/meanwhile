import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import { readCensusGeographyIndex } from "../control-plane/admin-view/promoted-slices.ts";
import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { resolveReaderArtifactStore, type ReaderArtifactReadStore } from "../meetings/edge-store.ts";
import type { CensusGeographyLookup, GeographyKey, GeographyType } from "./contract.ts";
import { censusStateDataset, createCensusDistrictReaderEdge, readCensusDistrictState, type CensusDistrictEdge } from "./district-edge.ts";
import { createLookup, notYetPublishedLookup } from "./lookup.ts";
import { readCensusGeographyProjection } from "./publication.ts";

export interface CensusGeographyReadOptions extends PromotedCivicDataReadOptions {
  readonly artifactStore?: ReaderArtifactReadStore | null;
  readonly state?: string;
}

export type PublishedLookupSource = "published" | "unavailable";

export interface PublishedLookupState {
  readonly lookup: CensusGeographyLookup;
  readonly source: PublishedLookupSource;
  readonly versionId: string;
}

export function createPublishedIndexLookup(index: CensusDistrictEdge, versionId: string, store: ReaderArtifactReadStore | null): CensusGeographyLookup {
  if (Object.keys(index.states).length !== 1) throw new Error("A Census lookup requires exactly one state publication");
  const empty = notYetPublishedLookup(versionId);
  const edge = store ? createCensusDistrictReaderEdge(index, store, versionId) : null;
  const state = Object.keys(index.states)[0];
  let held: Promise<CensusGeographyLookup | null> | undefined;
  const stateLookup = () => held ??= store ? readCensusDistrictState(index, state, store)
    .then(value => value ? createLookup(censusStateDataset(value), versionId) : null) : Promise.resolve(null);
  const unknown = (note: string) => ({ kind: "UNKNOWN" as const, note });
  return {
    async activePublishedVersion() { return versionId; },
    async manifest() { return { publishedVersion: versionId, publishedAt: index.builtAt,
      scopes: index.scopes.map(scope => ({ type: scope.type, version: scope.version, instanceCount: scope.instanceCount, zctaEdgeCount: scope.zctaEdgeCount })),
      versions: index.scopes.map(scope => scope.versionMeta) }; },
    async listVersions() { return index.scopes.map(scope => scope.versionMeta); },
    async enumerateGroupings(type: GeographyType, version?: string) {
      const lookup = await stateLookup();
      return lookup ? lookup.enumerateGroupings(type, version) : { ...await empty.enumerateGroupings(type, version),
        status: unknown("The selected Census state artifact is unavailable.") };
    },
    async zctasForGrouping(key: GeographyKey) {
      const lookup = await stateLookup();
      return lookup ? lookup.zctasForGrouping(key) : { ...await empty.zctasForGrouping(key),
        status: unknown("The selected Census state artifact is unavailable.") };
    },
    async groupingsForZcta(zip: string, version?: string) {
      const slice = await edge?.loadZip(zip);
      if (!slice || slice.kind !== "HELD") return { ...await empty.groupingsForZcta(zip, version), status: unknown("The Census ZIP artifact is unavailable.") };
      if (!slice.value.known) return { publishedVersion: versionId, status: { kind: "NOT_IN_COVERAGE" as const, note: `${zip} is not a Census ZCTA in the published coverage.` }, zcta5: zip, memberships: [] };
      return { publishedVersion: versionId, status: { kind: "OK" as const }, zcta5: zip,
        memberships: slice.value.containers.filter(row => !version || row.ref.version === version).flatMap(row => {
          const scope = index.scopes.find(scope => scope.type === row.ref.type && scope.version === row.ref.version &&
            (!scope.versionMeta.stateFips || scope.versionMeta.stateFips === row.ref.stateFips));
          return (row.overlaps ?? []).map(overlap => ({ geography: row.ref, whole: overlap.whole, fraction: overlap.fraction,
            fractionBasis: scope?.fractionBasis ?? "unknown" as const }));
        }) };
    },
    async reconcilePostalZips(zips: readonly string[]) {
      return Promise.all(zips.map(async zip => {
        const slice = await edge?.loadZip(zip);
        if (!slice || slice.kind !== "HELD") return { zip, isZcta: false, outsideCoverageReason: "unknown" as const };
        return { zip, isZcta: slice.value.known, outsideCoverageReason: slice.value.known ? null : "not_a_census_zcta" as const };
      }));
    },
  };
}

export async function loadPublishedLookupState(options: CensusGeographyReadOptions = {}): Promise<PublishedLookupState> {
  const state = options.state?.toUpperCase();
  if (!state || !/^[A-Z]{2}$/.test(state)) {
    const empty = notYetPublishedLookup("STATE_REQUIRED");
    const status = { kind: "UNKNOWN" as const, note: "A state or place is required to read Census geography." };
    return { source: "unavailable", versionId: "STATE_REQUIRED", lookup: { ...empty,
      async enumerateGroupings(type, version) { return { ...await empty.enumerateGroupings(type, version), status }; },
      async zctasForGrouping(key) { return { ...await empty.zctasForGrouping(key), status }; },
      async groupingsForZcta(zip, version) { return { ...await empty.groupingsForZcta(zip, version), status }; } } };
  }
  const store = options.artifactStore === undefined ? resolveReaderArtifactStore() : options.artifactStore;
  if (!options.store && !options.edge) {
    const index = await readCensusGeographyIndex(readerQuery(), state);
    return index.kind === "HELD" ? { lookup: createPublishedIndexLookup(index.value, index.versionId, store), source: "published", versionId: index.versionId }
      : { lookup: notYetPublishedLookup(index.kind), source: "unavailable", versionId: index.kind };
  }
  const result = await readCensusGeographyProjection(state, options);
  if (result.kind === "PROMOTED") {
    const versionId = result.metadata.versionId ?? "PROMOTED";
    const index = result.value;
    if (index.formatVersion === 2 && Array.isArray(index.scopes) && index.states && index.zipPrefixes && Object.keys(index.states).length === 1 && Object.hasOwn(index.states, state)) {
      return { lookup: createPublishedIndexLookup(index, versionId, store), source: "published", versionId };
    }
    return { lookup: notYetPublishedLookup("INVALID_INDEX"), source: "unavailable", versionId: "INVALID_INDEX" };
  }
  return { lookup: notYetPublishedLookup(result.kind), source: "unavailable", versionId: result.kind };
}

export async function loadPublishedLookup(options: CensusGeographyReadOptions = {}): Promise<CensusGeographyLookup> {
  return (await loadPublishedLookupState(options)).lookup;
}
