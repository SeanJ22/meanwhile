import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import { censusScopeSelectionStatement, geographyOfRows, type ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import type { ExpansionScopeGeography } from "../control-plane/expansion/scopes.ts";
import type { BuiltDataset } from "./dataset.ts";
import { createLookup, notYetPublishedLookup } from "./lookup.ts";
import type { PublishedLookupState } from "./reader.ts";
import type { GeographyVersion } from "./contract.ts";

/** Resolve existing owner instructions with only their selected groupings.
 * A small Send never copies the national geography payload into a runner. */
export async function loadPublishedScopeLookupState(scopes: readonly ExpansionScopeGeography[], query: ReadOnlyQuery | null = readerQuery()): Promise<PublishedLookupState> {
  if (!query) return { lookup: notYetPublishedLookup("STORE_UNAVAILABLE"), source: "unavailable", versionId: "STORE_UNAVAILABLE" };
  const states = [...new Set(scopes.map(scope => scope.stateAbbr.toUpperCase()))];
  const results = await query(states.map(state => censusScopeSelectionStatement(state,scopes.filter(scope => scope.stateAbbr.toUpperCase() === state))));
  const built = new Map<string,BuiltDataset["scopes"][number]>();
  for (const rows of results) {
    const geography = geographyOfRows(rows,true);
    for (const meta of geography.scopes) {
      const groupings = geography.containers.filter(row => row.ref.type === meta.type && row.ref.version === meta.version).map(row => ({
        ...row.ref, overlaps: row.overlaps ?? [],
      }));
      const key = `${meta.type}:${meta.version}`, previous = built.get(key);
      const merged = [...previous?.groupings ?? [],...groupings];
      built.set(key,{ type:meta.type,version:meta.version,fractionBasis:meta.fractionBasis??"unknown",groupings:merged,
        instanceCount:merged.length,zctaEdgeCount:merged.reduce((n,g)=>n+g.overlaps.length,0),
        versionMeta:rows.find(row=>row.row_kind === "scope" && row.version === meta.version && row.type === meta.type)!.version_meta as GeographyVersion });
    }
  }
  const selected = [...built.values()];
  if (!selected.length) return {lookup:notYetPublishedLookup("NOT_RECORDED"),source:"unavailable",versionId:"NOT_RECORDED"};
  const dataset:BuiltDataset={formatVersion:1,builtAt:selected.flatMap(scope=>scope.versionMeta.provenance.computedAt).sort().at(-1)??"",
    coverage:"Explicit owner scope groupings",scopes:selected,zctaUniverse:[...new Set(selected.flatMap(scope=>scope.groupings.flatMap(g=>g.overlaps.map(o=>o.zcta5))))]};
  const versionId = selected.map(scope=>`${scope.version}:${scope.versionMeta.provenance.computedAt}`).sort().join("+");
  return { lookup: createLookup(dataset,versionId),source:"published",versionId };
}
