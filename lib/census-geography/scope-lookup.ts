import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import { readCensusGeographyIndex, type ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import type { ExpansionScopeGeography } from "../control-plane/expansion/scopes.ts";
import { resolveReaderArtifactStore, type ReaderArtifactReadStore } from "../meetings/edge-store.ts";
import { mergeCensusDatasets, selectedStateDatasets, unavailableCensusLookup } from "./area-lookup.ts";
import { createCensusDistrictReaderEdge } from "./district-edge.ts";
import { createLookup } from "./lookup.ts";
import type { PublishedLookupState } from "./reader.ts";

export async function loadPublishedScopeLookupState(scopes: readonly ExpansionScopeGeography[], query: ReadOnlyQuery | null = readerQuery(),
  store: ReaderArtifactReadStore | null = resolveReaderArtifactStore()): Promise<PublishedLookupState> {
  const index = await readCensusGeographyIndex(query);
  if (index.kind !== "HELD") return unavailableCensusLookup(index.kind);
  if (!store) return unavailableCensusLookup("ARTIFACT_STORE_UNAVAILABLE");
  try {
    const states = new Set(scopes.filter(scope => scope.type !== "zcta").map(scope => scope.stateAbbr.toUpperCase()));
    const edge = createCensusDistrictReaderEdge(index.value, store, index.versionId);
    for (const scope of scopes.filter(scope => scope.type === "zcta")) {
      const code = await edge.loadZip(scope.geoid);
      if (code.kind !== "HELD") return unavailableCensusLookup("UNREAD");
      for (const container of code.value.containers) if (container.ref.type === "county") states.add(container.ref.stateAbbr);
    }
    const datasets = await selectedStateDatasets(index.value, [...states], store);
    const sharedStates = new Set(scopes.filter(scope => scope.type === "cbsa").flatMap(scope => datasets.flatMap(dataset => dataset.scopes
      .filter(built => built.type === scope.type && built.version === scope.version).flatMap(built => built.groupings
        .filter(group => group.geoid === scope.geoid).flatMap(group => group.memberStates)))).filter(state => !states.has(state)));
    datasets.push(...await selectedStateDatasets(index.value, [...sharedStates], store));
    const dataset = mergeCensusDatasets(index.value, datasets, (built, group) => scopes.some(scope =>
      scope.type === "state" ? built.type === "county" && group.stateAbbr === scope.stateAbbr :
        scope.type === "zcta" ? group.overlaps.some(overlap => overlap.zcta5 === scope.geoid) :
          scope.type === built.type && scope.geoid === group.geoid && scope.version === built.version));
    return { lookup: createLookup(dataset, index.versionId), source: "published", versionId: index.versionId };
  } catch { return unavailableCensusLookup("UNREAD"); }
}
