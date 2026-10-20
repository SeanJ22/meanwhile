import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import { censusAreaSelectionStatement, geographyOfRows, type ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import type { BuiltDataset, BuiltScope } from "./dataset.ts";
import type { GeographyVersion } from "./contract.ts";
import { createLookup, notYetPublishedLookup } from "./lookup.ts";
import type { PublishedLookupState } from "./reader.ts";

/** Postgres selects the place and every touching district within its county
 * states before returning any row, from current state pointers or held evidence. */
export async function loadPublishedAreaLookupState(zips: readonly string[], query: ReadOnlyQuery | null = readerQuery(), state?: string): Promise<PublishedLookupState> {
  if (!zips.length || zips.some(zip=>!/^\d{5}$/.test(zip))) throw new Error("A five-digit ZIP is required");
  if (!query) return {lookup:notYetPublishedLookup("STORE_UNAVAILABLE"),source:"unavailable",versionId:"STORE_UNAVAILABLE"};
  const [rows]=await query([censusAreaSelectionStatement(zips, state)]);
  const held=geographyOfRows(rows,true);
  if(!held.containers.length)return {lookup:notYetPublishedLookup("NOT_RECORDED"),source:"unavailable",versionId:"NOT_RECORDED"};
  const scopes:BuiltScope[]=held.scopes.flatMap(meta=>{
    const groupings=held.containers.filter(row=>row.ref.type===meta.type&&row.ref.version===meta.version).map(row=>({...row.ref,overlaps:row.overlaps??[]}));
    if(!groupings.length)return [];
    const source=rows.find(row=>row.row_kind==="scope"&&row.type===meta.type&&row.version===meta.version)!.version_meta as GeographyVersion;
    return [{type:meta.type,version:meta.version,versionMeta:source,fractionBasis:meta.fractionBasis??"unknown",groupings,
      instanceCount:groupings.length,zctaEdgeCount:groupings.reduce((n,g)=>n+g.overlaps.length,0)}];
  });
  const dataset:BuiltDataset={formatVersion:1,builtAt:scopes.flatMap(s=>s.versionMeta.provenance.computedAt).sort().at(-1)??"",
    coverage:"Selected places and in-state touching districts",scopes,zctaUniverse:[...new Set(zips)]};
  const versionId=scopes.map(scope=>`${scope.version}:${scope.versionMeta.provenance.computedAt}`).sort().join("+");
  return {lookup:createLookup(dataset,versionId),source:"published",versionId};
}


/** Source admission needs ZIP/state identities, so the server projects those before any geography is transferred. */
export async function readPublishedZipStates(zips: readonly string[], query: ReadOnlyQuery | null = readerQuery()): Promise<ReadonlyMap<string,readonly string[]>> {
  if (!zips.length || zips.length > 128 || zips.some(zip=>!/^\d{5}$/.test(zip))) throw new Error("One through 128 five-digit ZIPs are required");
  if (!query) return new Map();
  const statement=censusAreaSelectionStatement(zips);
  const [rows]=await query([{text:`WITH geography AS MATERIALIZED (${statement.text})
    SELECT DISTINCT overlap->>'zcta5' AS zip,g.state_abbr AS state FROM geography g
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(g.overlaps,'[]'::jsonb)) overlap
    WHERE g.row_kind='grouping' AND g.type='county' AND overlap->>'zcta5'=ANY($4::text[]) ORDER BY zip,state`,params:statement.params}]);
  const result=new Map<string,string[]>();
  for(const row of rows)if(typeof row.zip==="string"&&typeof row.state==="string"&&/^[A-Z]{2}$/.test(row.state))result.set(row.zip,[...result.get(row.zip)??[],row.state]);
  return result;
}


export interface PublishedPlaceMembership { readonly zip:string;readonly type:string;readonly geoid:string;readonly version:string;readonly state:string;readonly zctaTabulation:string }
/** A lease's Send check reads only its ZIPs' membership identities, never another Send's source dataset. */
export async function readPublishedPlaceMemberships(zips:readonly string[],query:ReadOnlyQuery|null=readerQuery()):Promise<readonly PublishedPlaceMembership[]> {
  if(!zips.length||zips.length>128||zips.some(zip=>!/^\d{5}$/.test(zip)))throw new Error("One through 128 five-digit ZIPs are required");
  if(!query)return[];
  const source=censusAreaSelectionStatement(zips);
  const [rows]=await query([{text:`WITH zip_source_memberships AS MATERIALIZED (${source.text})
    SELECT DISTINCT overlap->>'zcta5' AS zip,g.type,g.geoid,g.version,g.state_abbr AS state,s.version_meta->>'zctaTabulation' AS zcta_tabulation
    FROM zip_source_memberships g CROSS JOIN LATERAL jsonb_array_elements(coalesce(g.overlaps,'[]'::jsonb)) overlap
    JOIN zip_source_memberships s ON s.row_kind='scope' AND s.type=g.type AND s.version=g.version
    WHERE g.row_kind='grouping' AND overlap->>'zcta5'=ANY($4::text[]) ORDER BY zip,type,geoid,version,state`,params:source.params}]);
  return rows.map(row=>({zip:String(row.zip),type:String(row.type),geoid:String(row.geoid),version:String(row.version),state:String(row.state),zctaTabulation:String(row.zcta_tabulation)}));
}
