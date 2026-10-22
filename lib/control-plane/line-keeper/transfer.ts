import type { Sql } from '../repository/pg-store.ts';
import { boundedQuery } from '../repository/request-bounds.ts';
import { HOUR } from './model.ts';

export interface TransferCounter {readonly day:string;readonly database:string;readonly client:string;readonly bytes:number;readonly callers:Readonly<Record<string,number>>}
export interface TransferSample {readonly at:string;readonly complete:boolean;readonly counters:Readonly<Record<string,TransferCounter>>}
const fields=`day::text,database_name AS database,client,response_bytes::text AS bytes,
 (SELECT coalesce(jsonb_object_agg(k,(v->>2)::bigint),'{}'::jsonb) FROM jsonb_each(reads) x(k,v)) callers`;
/** TX-01's existing daily counters include web and runner processes. Only updated
 * rows are read hourly; yesterday is retained across Eastern midnight. */
export const TRANSFER_DELTA_SQL=`SELECT ${fields} FROM database_transfer_daily
 WHERE day >= ($1::timestamptz AT TIME ZONE 'America/New_York')::date-1
 AND updated_at >= $2::timestamptz`;
export async function readTransferCounters(sql:Sql,at:string,initialize=false,from?:string):Promise<TransferSample>{
 const rows=await boundedQuery(sql,{operation:'line-keeper.transfer-counters',callClass:'PAGE'},
  initialize?TRANSFER_DELTA_SQL.replace(' AND updated_at >= $2::timestamptz',''):TRANSFER_DELTA_SQL,
  initialize?[at]:[at,from??new Date(Date.parse(at)-HOUR).toISOString()]) as Record<string,unknown>[];
 return {at,complete:initialize,counters:Object.fromEntries(rows.map(r=>{
  const value={day:String(r.day),database:String(r.database),client:String(r.client),bytes:Number(r.bytes),callers:(r.callers??{}) as Record<string,number>};
  return [JSON.stringify([value.day,value.database,value.client]),value];
 }))};
}
export function transferSince(previous:TransferSample|undefined,current:TransferSample|null){
 if(!current)return {sample:previous,reading:null};
 const elapsed=previous?Date.parse(current.at)-Date.parse(previous.at):0;
 const since=new Date(Date.parse(current.at)-2*86_400_000).toISOString().slice(0,10);
 const counters=Object.fromEntries(Object.entries({...previous?.counters,...current.counters}).filter(([,v])=>v.day>=since));
 const sample={at:current.at,complete:previous?.complete===true||current.complete,counters};
 if(elapsed>HOUR+120_000)return {sample:{...sample,complete:false},reading:null};
 if(!previous?.complete||elapsed<HOUR-120_000||elapsed>HOUR+120_000)return {sample,reading:null};
 let control=0,reader=0;const byCaller=new Map<string,number>();
 for(const [key,row]of Object.entries(current.counters)){
  const old=previous.counters[key];
  if(old&&row.bytes<old.bytes)return {sample,reading:null};
  const bytes=(row.bytes-(old?.bytes??0))*HOUR/elapsed;
  if(row.database==='reader')reader+=bytes;else if(row.database==='control-plane')control+=bytes;else continue;
  let attributed=0;
  for(const [caller,total]of Object.entries(row.callers)){
   const delta=Math.max(0,total-(old?.callers[caller]??0))*HOUR/elapsed;attributed+=delta;
   const name=`${row.database} · ${row.client} · ${caller}`;byCaller.set(name,(byCaller.get(name)??0)+delta);
  }
  if(bytes>attributed){const name=`${row.database} · ${row.client} · other recorded calls`;byCaller.set(name,(byCaller.get(name)??0)+bytes-attributed);}
 }
 return {sample,reading:{control,reader,complete:true as const,window:{from:previous.at,through:current.at},byCaller:[...byCaller].map(([caller,bytes])=>({caller,bytes})).sort((a,b)=>b.bytes-a.bytes)}};
}
