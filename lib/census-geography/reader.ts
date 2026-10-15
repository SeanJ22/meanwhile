import { readFileSync } from "node:fs";
import { join } from "node:path";

import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import { readCensusGeographyIndex } from "../control-plane/admin-view/promoted-slices.ts";
import { readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { resolveReaderArtifactStore, type ReaderArtifactStore } from "../meetings/edge-store.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import type { CensusGeographyLookup, GeographyKey, GeographyType } from "./contract.ts";
import type { BuiltDataset } from "./dataset.ts";
import { censusStateDataset, createCensusDistrictReaderEdge, readCensusDistrictState, type CensusDistrictEdge } from "./district-edge.ts";
import { createLookup, notYetPublishedLookup } from "./lookup.ts";
import { CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE } from "./publication.ts";

export { CENSUS_GEO_SCOPE } from "./publication.ts";

const CENSUS_GEO_MAX_AGE_MS = 100 * 365 * 24 * 60 * 60 * 1000;

function readBootstrapDataset(): BuiltDataset {
  return JSON.parse(readFileSync(join(import.meta.dirname, "bootstrap-az.json"), "utf8")) as BuiltDataset;
}

export interface CensusGeographyReadOptions extends PromotedCivicDataReadOptions {
  readonly artifactStore?: ReaderArtifactStore | null;
}

export async function readCensusGeographyProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<CensusDistrictEdge>> {
  return readPromotedCivicData<CensusDistrictEdge>(CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE,
    { ...options, maxAgeMs: options.maxAgeMs ?? CENSUS_GEO_MAX_AGE_MS });
}

export type PublishedLookupSource = "published" | "unavailable";

export interface PublishedLookupState {
  readonly lookup: CensusGeographyLookup;
  readonly source: PublishedLookupSource;
  readonly versionId: string;
}

export function createPublishedIndexLookup(index: CensusDistrictEdge, versionId: string, store: ReaderArtifactStore | null): CensusGeographyLookup {
  const empty = notYetPublishedLookup(versionId);
  const edge = store ? createCensusDistrictReaderEdge(index, store, versionId) : null;
  const states = new Map<string, Promise<CensusGeographyLookup | null>>();
  function stateLookup(state: string): Promise<CensusGeographyLookup | null> {
    let read = states.get(state);
    if (!read) {
      read = store && Object.hasOwn(index.states, state) ? readCensusDistrictState(index, state, store)
        .then(value => value ? createLookup(censusStateDataset(value), versionId) : null) : Promise.resolve(null);
      states.set(state, read);
    }
    return read;
  }
  const unknown = (note: string) => ({ kind: "UNKNOWN" as const, note });
  return {
    async activePublishedVersion() { return versionId; },
    async manifest() { return { publishedVersion: versionId, publishedAt: index.builtAt,
      scopes: index.scopes.map(scope => ({ type: scope.type, version: scope.version, instanceCount: scope.instanceCount, zctaEdgeCount: scope.zctaEdgeCount })),
      versions: index.scopes.map(scope => scope.versionMeta) }; },
    async listVersions() { return index.scopes.map(scope => scope.versionMeta); },
    async enumerateGroupings(type: GeographyType, version?: string) {
      const value = await empty.enumerateGroupings(type, version);
      const scope = index.scopes.find(scope => scope.type === type && (!version || scope.version === version));
      return { ...value, ...(scope ? { version: scope.versionMeta } : {}), status: unknown("A state or place is required to enumerate Census geography.") };
    },
    async zctasForGrouping(key: GeographyKey) {
      const state = key.type !== "cbsa" && key.type !== "aiannh" ? FIPS_TO_STATE[key.geoid.slice(0, 2)]?.postal : undefined;
      const lookup = state ? await stateLookup(state) : null;
      if (lookup) return lookup.zctasForGrouping(key);
      return { ...await empty.zctasForGrouping(key), status: unknown("The selected Census geography state artifact is unavailable or requires a state.") };
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
  const store = options.artifactStore === undefined ? resolveReaderArtifactStore() : options.artifactStore;
  if (!options.store && !options.edge) {
    const index = await readCensusGeographyIndex(readerQuery());
    return index.kind === "HELD" ? { lookup: createPublishedIndexLookup(index.value, index.versionId, store), source: "published", versionId: index.versionId }
      : { lookup: notYetPublishedLookup(index.kind), source: "unavailable", versionId: index.kind };
  }
  const result = await readCensusGeographyProjection(options);
  if (result.kind === "PROMOTED") {
    const versionId = result.metadata.versionId ?? "PROMOTED";
    const index = result.value;
    if (index.formatVersion === 2 && Array.isArray(index.scopes) && index.states && index.zipPrefixes) {
      return { lookup: createPublishedIndexLookup(index, versionId, store), source: "published", versionId };
    }
    return { lookup: notYetPublishedLookup("INVALID_INDEX"), source: "unavailable", versionId: "INVALID_INDEX" };
  }
  return { lookup: notYetPublishedLookup(result.kind), source: "unavailable", versionId: result.kind };
}

export async function loadPublishedLookup(options: CensusGeographyReadOptions = {}): Promise<CensusGeographyLookup> {
  return (await loadPublishedLookupState(options)).lookup;
}

export function loadBootstrapLookup(): CensusGeographyLookup {
  return createLookup(readBootstrapDataset(), "bootstrap:census-geography:az");
}
