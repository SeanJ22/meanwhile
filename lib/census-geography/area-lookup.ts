import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import { readCensusGeographyIndex, type ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { resolveReaderArtifactStore, type ReaderArtifactReadStore } from "../meetings/edge-store.ts";
import type { BuiltDataset, BuiltScope } from "./dataset.ts";
import { censusStateDataset, createCensusDistrictReaderEdge, readCensusDistrictState, type CensusDistrictEdge } from "./district-edge.ts";
import { createLookup, notYetPublishedLookup } from "./lookup.ts";
import type { PublishedLookupState } from "./reader.ts";

export function unavailableCensusLookup(versionId: string): PublishedLookupState {
  return { lookup: notYetPublishedLookup(versionId), source: "unavailable", versionId };
}

export async function selectedStateDatasets(index: CensusDistrictEdge, states: readonly string[], store: ReaderArtifactReadStore): Promise<BuiltDataset[]> {
  return Promise.all([...new Set(states)].map(async state => {
    const artifact = await readCensusDistrictState(index, state, store);
    if (!artifact) throw new Error("Selected Census state artifact is unavailable");
    return censusStateDataset(artifact);
  }));
}

export function mergeCensusDatasets(index: CensusDistrictEdge, datasets: readonly BuiltDataset[], select: (scope: BuiltScope, group: BuiltScope["groupings"][number]) => boolean,
  universe?: readonly string[]): BuiltDataset {
  const scopes = new Map<string, BuiltScope>();
  for (const dataset of datasets) for (const scope of dataset.scopes) {
    const key = `${scope.type}|${scope.version}`;
    const prior = scopes.get(key);
    const groups = new Map((prior?.groupings ?? []).map(group => [group.geoid, group]));
    for (const group of scope.groupings) if (select(scope, group)) {
      const previous = groups.get(group.geoid);
      const overlaps = new Map((previous?.overlaps ?? []).map(overlap => [overlap.zcta5, overlap]));
      for (const overlap of group.overlaps) overlaps.set(overlap.zcta5, overlap);
      groups.set(group.geoid, { ...group, overlaps: [...overlaps.values()].sort((a, b) => a.zcta5.localeCompare(b.zcta5)) });
    }
    if (!groups.size) continue;
    const groupings = [...groups.values()];
    scopes.set(key, { ...scope, versionMeta: prior ? { ...scope.versionMeta,
      states: [...new Set([...(prior.versionMeta.states ?? []), ...(scope.versionMeta.states ?? [])])],
      provenance: { ...scope.versionMeta.provenance, sourceUrls: [...new Set([...prior.versionMeta.provenance.sourceUrls, ...scope.versionMeta.provenance.sourceUrls])] } } : scope.versionMeta,
      groupings, instanceCount: groupings.length, zctaEdgeCount: groupings.reduce((sum, group) => sum + group.overlaps.length, 0) });
  }
  return { formatVersion: 1, builtAt: index.builtAt, coverage: "Selected Census geography", scopes: [...scopes.values()],
    zctaUniverse: universe ?? [...new Set([...scopes.values()].flatMap(scope => scope.groupings.flatMap(group => group.overlaps.map(overlap => overlap.zcta5))))] };
}

export async function loadPublishedAreaLookupState(zips: readonly string[], query: ReadOnlyQuery | null = readerQuery(),
  store: ReaderArtifactReadStore | null = resolveReaderArtifactStore()): Promise<PublishedLookupState> {
  if (!zips.length || zips.some(zip => !/^\d{5}$/.test(zip))) throw new Error("A five-digit ZIP is required");
  const index = await readCensusGeographyIndex(query);
  if (index.kind !== "HELD") return unavailableCensusLookup(index.kind);
  if (!store) return unavailableCensusLookup("ARTIFACT_STORE_UNAVAILABLE");
  try {
    const edge = createCensusDistrictReaderEdge(index.value, store, index.versionId);
    const codes = await Promise.all([...new Set(zips)].map(zip => edge.loadZip(zip)));
    if (codes.some(code => code.kind !== "HELD")) return unavailableCensusLookup("UNREAD");
    const states = [...new Set(codes.flatMap(code => code.kind === "HELD" ? code.value.containers
      .filter(row => row.ref.type === "county").map(row => row.ref.stateAbbr) : []))];
    const datasets = await selectedStateDatasets(index.value, states, store);
    const dataset = mergeCensusDatasets(index.value, datasets, (_scope, group) => group.overlaps.some(overlap => zips.includes(overlap.zcta5)),
      codes.flatMap((code, position) => code.kind === "HELD" && code.value.known ? [[...new Set(zips)][position]] : []));
    const allowed = new Set(datasets.flatMap(dataset => dataset.scopes.filter(scope => scope.type === "county")
      .flatMap(scope => scope.groupings.filter(group => states.includes(group.stateAbbr)).flatMap(group => group.overlaps.map(overlap => overlap.zcta5)))));
    const bounded = { ...dataset, scopes: dataset.scopes.map(scope => {
      const groupings = scope.groupings.map(group => ({ ...group, overlaps: group.overlaps.filter(overlap => allowed.has(overlap.zcta5)) }));
      return { ...scope, groupings, zctaEdgeCount: groupings.reduce((sum, group) => sum + group.overlaps.length, 0) };
    }) };
    return { lookup: createLookup(bounded, index.versionId), source: "published", versionId: index.versionId };
  } catch { return unavailableCensusLookup("UNREAD"); }
}
