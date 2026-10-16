import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import { readCensusGeographyIndex, type ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { resolveReaderArtifactStore, type ReaderArtifactReadStore } from "../meetings/edge-store.ts";
import type { BuiltDataset, BuiltScope } from "./dataset.ts";
import { censusStateDataset, readCensusDistrictState, type CensusDistrictEdge } from "./district-edge.ts";
import { createLookup, notYetPublishedLookup } from "./lookup.ts";
import type { PublishedLookupState } from "./reader.ts";
import { heldZipStates } from "../geo/zip-division-shards.ts";

export function unavailableCensusLookup(versionId: string): PublishedLookupState {
  const empty = notYetPublishedLookup(versionId);
  const status = { kind: "UNKNOWN" as const, note: "The selected Census geography could not be read." };
  return { source: "unavailable", versionId, lookup: { ...empty,
    async enumerateGroupings(type, version) { return { ...await empty.enumerateGroupings(type, version), status }; },
    async zctasForGrouping(key) { return { ...await empty.zctasForGrouping(key), status }; },
    async groupingsForZcta(zip, version) { return { ...await empty.groupingsForZcta(zip, version), status }; } } };
}

export interface SelectedCensusState {
  readonly state: string;
  readonly versionId: string;
  readonly index: CensusDistrictEdge;
  readonly dataset: BuiltDataset;
}

export async function selectedStateDatasets(states: readonly string[], query: ReadOnlyQuery | null,
  store: ReaderArtifactReadStore): Promise<SelectedCensusState[]> {
  const selected: SelectedCensusState[] = [];
  for (const state of [...new Set(states)].sort()) {
    const index = await readCensusGeographyIndex(query, state);
    if (index.kind !== "HELD") throw new Error(`Selected Census state index is ${index.kind}`);
    const artifact = await readCensusDistrictState(index.value, state, store);
    if (!artifact) throw new Error("Selected Census state artifact is unavailable");
    selected.push({ state, versionId: index.versionId, index: index.value, dataset: censusStateDataset(artifact) });
  }
  return selected;
}

export function selectedCensusVersion(selected: readonly SelectedCensusState[]): string {
  return selected.length === 1 ? selected[0].versionId : selected.map(row => `${row.state}:${row.versionId}`).sort().join("|");
}

export function mergeCensusDatasets(datasets: readonly BuiltDataset[], select: (scope: BuiltScope, group: BuiltScope["groupings"][number]) => boolean,
  universe?: readonly string[]): BuiltDataset {
  const scopes = new Map<string, BuiltScope>();
  for (const dataset of datasets) for (const scope of dataset.scopes) {
    const key = `${scope.type}|${scope.version}`;
    const prior = scopes.get(key);
    const groups = new Map((prior?.groupings ?? []).map(group => [group.geoid, group]));
    for (const group of scope.groupings) if (select(scope, group)) {
      const previous = groups.get(group.geoid);
      const overlaps = new Map((previous?.overlaps ?? []).map(overlap => [overlap.zcta5, overlap]));
      for (const overlap of group.overlaps) {
        const prior = overlaps.get(overlap.zcta5);
        if (prior && (prior.whole !== overlap.whole || prior.fraction !== overlap.fraction)) throw new Error("Selected Census states disagree about an overlap");
        overlaps.set(overlap.zcta5, overlap);
      }
      groups.set(group.geoid, { ...group, overlaps: [...overlaps.values()].sort((a, b) => a.zcta5.localeCompare(b.zcta5)) });
    }
    if (!groups.size) continue;
    const groupings = [...groups.values()];
    scopes.set(key, { ...scope, versionMeta: prior ? { ...scope.versionMeta,
      states: [...new Set([...(prior.versionMeta.states ?? []), ...(scope.versionMeta.states ?? [])])],
      provenance: { ...scope.versionMeta.provenance, sourceUrls: [...new Set([...prior.versionMeta.provenance.sourceUrls, ...scope.versionMeta.provenance.sourceUrls])] } } : scope.versionMeta,
      groupings, instanceCount: groupings.length, zctaEdgeCount: groupings.reduce((sum, group) => sum + group.overlaps.length, 0) });
  }
  return { formatVersion: 1, builtAt: datasets.map(dataset => dataset.builtAt).sort().at(-1) ?? new Date(0).toISOString(), coverage: "Selected Census geography", scopes: [...scopes.values()],
    zctaUniverse: universe ?? [...new Set([...scopes.values()].flatMap(scope => scope.groupings.flatMap(group => group.overlaps.map(overlap => overlap.zcta5))))] };
}

export async function loadPublishedAreaLookupState(zips: readonly string[], query: ReadOnlyQuery | null = readerQuery(),
  store: ReaderArtifactReadStore | null = resolveReaderArtifactStore()): Promise<PublishedLookupState> {
  if (!zips.length || zips.some(zip => !/^\d{5}$/.test(zip))) throw new Error("A five-digit ZIP is required");
  if (!store) return unavailableCensusLookup("ARTIFACT_STORE_UNAVAILABLE");
  try {
    const states = new Set<string>();
    for (const zip of new Set(zips)) {
      const touching = await heldZipStates(zip);
      if (!touching) return unavailableCensusLookup("ZIP_STATES_UNREAD");
      for (const state of touching) states.add(state);
    }
    const selected = await selectedStateDatasets([...states], query, store);
    const datasets = selected.map(row => row.dataset);
    const known = new Set(datasets.flatMap(dataset => dataset.zctaUniverse));
    const dataset = mergeCensusDatasets(datasets, (_scope, group) => group.overlaps.some(overlap => zips.includes(overlap.zcta5)),
      [...new Set(zips)].filter(zip => known.has(zip)));
    const allowed = new Set(datasets.flatMap(dataset => dataset.zctaUniverse));
    const bounded = { ...dataset, scopes: dataset.scopes.map(scope => {
      const groupings = scope.groupings.map(group => ({ ...group, overlaps: group.overlaps.filter(overlap => allowed.has(overlap.zcta5)) }));
      return { ...scope, groupings, zctaEdgeCount: groupings.reduce((sum, group) => sum + group.overlaps.length, 0) };
    }) };
    const versionId = selectedCensusVersion(selected);
    return { lookup: createLookup(bounded, versionId), source: "published", versionId };
  } catch { return unavailableCensusLookup("UNREAD"); }
}
