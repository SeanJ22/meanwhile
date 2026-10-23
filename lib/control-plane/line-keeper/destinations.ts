import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zipNeedsAddress } from '../../geo/postal.ts';
import { shardEntry, type ZipDivisionShard } from '../../geo/zip-division-index.ts';

const held=new Map<string,Promise<ReadonlyMap<string,string>>>();
/** A ZIP wholly within the division comes before a boundary ZIP. A partial ZIP's centroid
 * can be outside the school district or city we are checking. No test place is special. */
export function readerDestinations(state:string):Promise<ReadonlyMap<string,string>> {
  const code=state.toUpperCase();
  if(!held.has(code))held.set(code,(async()=>{
    const root=join(process.cwd(),'data','derived','zip-divisions');
    const index=JSON.parse(await readFile(join(root,'index.json'),'utf8')) as {statesToShards:Record<string,string[]>};
    const choices=new Map<string,{zip:string;partial:boolean}>();
    const shards=code==='US'?[...new Set(Object.values(index.statesToShards).flat())]:index.statesToShards[code]??[];
    for(const name of [...shards].sort()){
      const shard=JSON.parse(await readFile(join(root,`${name}.json`),'utf8')) as ZipDivisionShard;
      for(const zip of Object.keys(shard.zips).sort()){
        if(zipNeedsAddress(zip))continue;
        if(!choices.has('ocd-division/country:us'))choices.set('ocd-division/country:us',{zip,partial:false});
        const entry=shardEntry(shard,zip)!;
        for(const division of entry.ids){
          const state=/^(ocd-division\/country:us\/(?:state|territory|district):[a-z]{2})(?:\/|$)/.exec(division)?.[1];
          if(state&&!choices.has(state))choices.set(state,{zip,partial:false});
          const partial=entry.partial.includes(division),prior=choices.get(division);
          if(!prior||prior.partial&&!partial)choices.set(division,{zip,partial});
        }
      }
    }
    return new Map([...choices].map(([id,v])=>[id,v.zip]));
  })());
  return held.get(code)!;
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
