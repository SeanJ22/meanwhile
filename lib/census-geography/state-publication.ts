import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { BuiltDataset, BuiltScope, BuiltGrouping } from "./dataset.ts";
import type { ContainerSlice, ScopeSlice } from "../control-plane/admin-view/promoted-slices.ts";
import { publishScopeBoundaries } from "./boundary-artifacts.ts";
import { processRegisteredFanOutCandidate, type PromotionOutcome } from "../civic-data/promotion.ts";
import { publishRoutineReaderEdgeOutcome } from "../civic-data/reader-edge-publication.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import { sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import type { ReaderArtifactStore } from "../meetings/edge-store.ts";
import { censusGeographyCandidate } from "./candidate.ts";
import { censusDistrictEdgeVersion, type CensusDistrictStateInput, type CensusDistrictArtifactRef, type CensusDistrictStateArtifact, type CensusZipPrefixArtifact, type CensusDistrictEdge } from "./district-edge.ts";
import { CENSUS_GEO_CONTRACT_ID, CENSUS_GEO_RECORD_CLASS } from "./publication.ts";

export async function promoteCensusState(
  input: CensusDistrictStateInput & { readonly sourceVersion: string },
  options: { readonly store: RoutineDataStore; readonly artifactStore: ReaderArtifactStore; readonly now?: string },
): Promise<PromotionOutcome> {
  const index = await publishCensusDistrictState(input, input.sourceVersion, options.artifactStore);
  const candidate = censusGeographyCandidate(index);
  const now = options.now ?? candidate.retrieval.retrievedAt;
  const outcome = await processRegisteredFanOutCandidate(options.store, CENSUS_GEO_CONTRACT_ID, candidate, now);
  if (outcome.promoted) {
    const publication = await publishRoutineReaderEdgeOutcome(options.store, now,
      [{ recordClass: CENSUS_GEO_RECORD_CLASS, scope: candidate.scope }], { artifactStore: options.artifactStore });
    if (!publication.ok) throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", `Census state ${input.state} reader publication failed: ${publication.detail ?? publication.readerEdge}`);
  }
  return outcome;
}

async function putArtifact(value: CensusDistrictStateArtifact | CensusZipPrefixArtifact, store: ReaderArtifactStore): Promise<CensusDistrictArtifactRef> {
  const bytes = gzipSync(Buffer.from(JSON.stringify(value)));
  return { key: await store.putImmutable(bytes, "json.gz"), sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength };
}

function stateArtifact(dataset: BuiltDataset, state: string, versionId: string): CensusDistrictStateArtifact {
  const containers: Omit<ContainerSlice, "overlaps">[] = [];
  const codes: Record<string, [number, boolean, number | null][]> = {};
  const scopes: ScopeSlice[] = [];
  const scopeDetails: Omit<BuiltScope, "groupings">[] = [];
  for (const scope of dataset.scopes) {
    const { groupings, ...details } = scope;
    scopeDetails.push(details);
    scopes.push({ type: scope.type, version: scope.version, plan: scope.versionMeta.plan,
      ...(scope.versionMeta.stateFips ? { stateFips: scope.versionMeta.stateFips } : {}),
      ...(scope.versionMeta.chamber ? { chamber: scope.versionMeta.chamber } : {}),
      ...(scope.versionMeta.applicability ? { applicability: scope.versionMeta.applicability } : {}),
      ...(scope.versionMeta.retrievalComplete === undefined ? {} : { retrievalComplete: scope.versionMeta.retrievalComplete }),
      ...(scope.versionMeta.states ? { states: scope.versionMeta.states } : {}),
      sourceUrls: scope.versionMeta.provenance.sourceUrls, observedAt: scope.versionMeta.provenance.computedAt });
    for (const group of groupings) {
      if (group.geometry) throw new Error("Census state artifacts require published boundary references");
      const index = containers.length;
      for (const overlap of group.overlaps) (codes[overlap.zcta5] ??= []).push([index, overlap.whole, overlap.fraction]);
      // The publisher owns this input; move identities and release their consumed overlap rows.
      const ref = group as { -readonly [K in keyof BuiltGrouping]?: BuiltGrouping[K] } & { type: BuiltScope["type"]; version: string };
      delete ref.overlaps;
      ref.type = scope.type; ref.version = scope.version;
      containers.push({ ref: ref as ContainerSlice["ref"], plan: scope.versionMeta.plan });
    }
    (groupings as BuiltGrouping[]).length = 0;
  }
  return { formatVersion: 2, versionId, state, builtAt: dataset.builtAt, coverage: dataset.coverage,
    ...(dataset.sourceFailures ? { sourceFailures: dataset.sourceFailures } : {}),
    ...(dataset.sourceDiscrepancies ? { sourceDiscrepancies: dataset.sourceDiscrepancies } : {}),
    scopeDetails, zctaUniverse: dataset.zctaUniverse, scopes, containers, codes };
}

export async function publishCensusDistrictState(
  { state, dataset }: CensusDistrictStateInput, sourceVersion: string, store: ReaderArtifactStore,
): Promise<CensusDistrictEdge> {
  if (!/^[A-Z]{2}$/.test(state)) throw new Error("A Census publication requires one state");
  for (const scope of dataset.scopes) {
    if (scope.groupings.length !== scope.instanceCount) throw new Error("Census publication requires an unconsumed state dataset");
    if (scope.groupings.some(group => group.stateAbbr !== state && !group.memberStates.includes(state))) throw new Error("Census publication contains another state's geography");
  }
  const versionId = censusDistrictEdgeVersion(sourceVersion);
  for (const scope of dataset.scopes) await publishScopeBoundaries(scope, store);
  const value = stateArtifact(dataset, state, versionId);
  const states = { [state]: await putArtifact(value, store) };
  const zipPrefixes: Record<string, CensusDistrictArtifactRef> = {};
  const prefixes = new Map<string, Record<string, readonly string[]>>();
  for (const zip of value.zctaUniverse) {
    if (!/^\d{5}$/.test(zip)) throw new Error(`Invalid Census ZIP ${zip}`);
    const prefix = zip.slice(0, 3);
    let shard = prefixes.get(prefix);
    if (!shard) { shard = {}; prefixes.set(prefix, shard); }
    shard[zip] = Object.hasOwn(value.codes, zip) ? [state] : [];
  }
  for (const [prefix, statesByZip] of prefixes) {
    zipPrefixes[prefix] = await putArtifact({ formatVersion: 2, versionId, prefix, statesByZip }, store);
    prefixes.delete(prefix);
  }
  return { formatVersion: 2, versionId, builtAt: value.builtAt, coverage: value.coverage,
    scopes: value.scopeDetails.filter(scope => scope.instanceCount > 0), zctaCount: value.zctaUniverse.length,
    sourceFailureCount: value.sourceFailures?.length ?? 0,
    sourceDiscrepancyCount: value.sourceDiscrepancies?.length ?? 0, states, zipPrefixes };
}

export async function buildCensusDistrictEdge(dataset: BuiltDataset, sourceVersion: string, store: ReaderArtifactStore): Promise<CensusDistrictEdge> {
  const states = [...new Set(dataset.scopes.filter(scope => scope.type !== "cbsa").flatMap(scope => scope.groupings.map(group => group.stateAbbr)))];
  if (states.length !== 1) throw new Error("A Census publication contains exactly one state");
  return publishCensusDistrictState({ state: states[0], dataset }, sourceVersion, store);
}

