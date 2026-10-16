import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import { type ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import type { ExpansionScopeGeography } from "../control-plane/expansion/scopes.ts";
import { resolveReaderArtifactStore, type ReaderArtifactReadStore } from "../meetings/edge-store.ts";
import { mergeCensusDatasets, selectedStateDatasets, selectedCensusVersion, unavailableCensusLookup } from "./area-lookup.ts";
import { heldZipStates } from "../geo/zip-division-shards.ts";
import { createLookup } from "./lookup.ts";
import type { PublishedLookupState } from "./reader.ts";

export async function loadPublishedScopeLookupState(scopes: readonly ExpansionScopeGeography[], query: ReadOnlyQuery | null = readerQuery(),
  store: ReaderArtifactReadStore | null = resolveReaderArtifactStore()): Promise<PublishedLookupState> {
  if (!scopes.length) return unavailableCensusLookup("STATE_REQUIRED");
  if (!store) return unavailableCensusLookup("ARTIFACT_STORE_UNAVAILABLE");
  try {
    const states = new Set(scopes.filter(scope => scope.type !== "zcta").map(scope => scope.stateAbbr.toUpperCase()));
    for (const scope of scopes.filter(scope => scope.type === "zcta")) {
      const touching = await heldZipStates(scope.geoid);
      if (!touching) return unavailableCensusLookup("ZIP_STATES_UNREAD");
      for (const state of touching) states.add(state);
    }
    const selected = await selectedStateDatasets([...states], query, store);
    const datasets = selected.map(row => row.dataset);
    const sharedStates = new Set(scopes.filter(scope => scope.type === "cbsa").flatMap(scope => datasets.flatMap(dataset => dataset.scopes
      .filter(built => built.type === scope.type && built.version === scope.version).flatMap(built => built.groupings
        .filter(group => group.geoid === scope.geoid).flatMap(group => group.memberStates)))).filter(state => !states.has(state)));
    const shared = await selectedStateDatasets([...sharedStates], query, store);
    selected.push(...shared);
    datasets.push(...shared.map(row => row.dataset));
    const dataset = mergeCensusDatasets(datasets, (built, group) => scopes.some(scope =>
      scope.type === "state" ? built.type === "county" && group.stateAbbr === scope.stateAbbr :
        scope.type === "zcta" ? group.overlaps.some(overlap => overlap.zcta5 === scope.geoid) :
          scope.type === built.type && scope.geoid === group.geoid && scope.version === built.version));
    const versionId = selectedCensusVersion(selected);
    return { lookup: createLookup(dataset, versionId), source: "published", versionId };
  } catch { return unavailableCensusLookup("UNREAD"); }
}
