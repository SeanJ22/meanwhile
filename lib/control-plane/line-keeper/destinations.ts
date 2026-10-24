import { zipNeedsAddress } from '../../geo/postal.ts';
import { readStateZipPlaces } from '../../place-map/reader.ts';
import { REGISTRY_STATES } from '../../civic-data/state-scopes.ts';

/** Prefer a ZIP wholly within the selected place over one crossing it. */
export async function readerDestinations(state: string): Promise<ReadonlyMap<string, string>> {
  const choices = new Map<string, { zip: string; partial: boolean }>();
  for (const code of state.toUpperCase() === 'US' ? REGISTRY_STATES : [state]) {
    for (const [zip, entry] of await readStateZipPlaces(code)) {
      if (zipNeedsAddress(zip)) continue;
      for (const division of entry.ids) {
        const partial = entry.partial.includes(division), prior = choices.get(division);
        if (!prior || prior.partial && !partial) choices.set(division, { zip, partial });
      }
    }
  }
  return new Map([...choices].map(([id, value]) => [id, value.zip]));
}

import type { Sql } from '../repository/pg-store.ts';
import { boundedQuery } from '../repository/request-bounds.ts';
import { censusWorkDivision } from '../../census-geography/division-id.ts';
import { currentRepresentationSelection,selectGeographyVersion } from '../../census-geography/selection.ts';
import type { GeographyRef,GeographyVersion } from '../../census-geography/contract.ts';
/** Only a changed Census pointer (or the separate deployment seed). Metadata and
 * a few candidate ZIPs cross the wire, never the full overlap document. */
export const DESTINATIONS_SQL=`SELECT root.scope->>'type' type,root.scope->>'version' version,reader_payload_value(root.scope->'versionMeta') metadata,
 g->>'geoid' geoid,g->>'ocdId' ocd_id,g->>'label' label,g->>'stateAbbr' state,
 (SELECT coalesce(jsonb_agg(z),'[]'::jsonb) FROM (SELECT o->>'zcta5' z FROM reader_payload_members(g->'overlaps') members
 CROSS JOIN LATERAL (SELECT reader_payload_node(item) o) row ORDER BY (o->>'whole')::boolean DESC,o->>'zcta5' LIMIT 20) choices) zips
 FROM civic_data_promotions p CROSS JOIN LATERAL reader_payload_members(reader_payload_node(p.payload)->'scopes') scopes
 CROSS JOIN LATERAL (SELECT reader_payload_node(scopes.item) scope) root
 CROSS JOIN LATERAL reader_payload_members(root.scope->'groupings') groups
 CROSS JOIN LATERAL (SELECT reader_payload_node(groups.item) g) grouping
 WHERE p.record_class='CENSUS_GEOGRAPHY' AND p.scope='US:zcta-geography-overlaps'
 AND root.scope->>'type' IN ('congressional_district','state_leg_upper','state_leg_lower')
 AND p.promoted_at >= $1::timestamptz AND p.promoted_at <= greatest($2::timestamptz,statement_timestamp())`;
export async function readDestinationDelta(reader:Sql,from:string,through:string,seed=false):Promise<Readonly<Record<string,string>>|null>{
 const rows=await boundedQuery(reader,{operation:`line-keeper.${seed?'initialize-':''}destinations`,callClass:'PAGE'},
 seed?DESTINATIONS_SQL.replace(' AND p.promoted_at >= $1::timestamptz AND p.promoted_at <= greatest($2::timestamptz,statement_timestamp())',''):DESTINATIONS_SQL,seed?[]:[from,through]) as Record<string,unknown>[];
 if(!rows.length)return null;
 const scopes=[...new Map(rows.map(r=>[`${r.type}:${r.version}`,{...r.metadata as object,key:String(r.version),type:r.type}])).values()] as GeographyVersion[];
 const out:Record<string,string>={};
 for(const r of rows){
  const selected=selectGeographyVersion(scopes,r.type as GeographyVersion['type'],currentRepresentationSelection(),String(r.state));
  if(!selected||selected.key!==r.version)continue;
  const id=censusWorkDivision({type:r.type,geoid:r.geoid,ocdId:r.ocd_id,label:r.label,stateAbbr:r.state} as GeographyRef),zip=(r.zips as string[]).find(z=>!zipNeedsAddress(z));
  if(id&&zip)out[id]=zip;
 }
 return out;
}
