import { createHash } from "node:crypto";
import { readPromotedCivicDataBatch, type PromotedCivicDataReadOptions } from "../../civic-data/read-model.ts";
import { assertOpenDataProjection } from "./publication.ts";
import { readZipLocation } from "../../place-map/locations.ts";
import { nearbyFacilityCells,facilityNear,FACILITY_RADIUS_KM } from "./geography.ts";
import { openDataScope,divisionPartition,zipPartition,type OpenDataFact,type OpenDataSource,type OpenDataProjection,type OpenDataPartitionRef } from "./model.ts";
import { readOpenDataPartition } from "./artifacts.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";
import { currentReaderSelection } from "../../db/reader-route.ts";
import { OPEN_DATA_READER_KEY_PREFIX } from "./reader-sql.ts";

export const OPEN_DATA_PAGE_ROWS=50;
// This bounds work per action, not coverage. A cursor also advances through slices with no matches.
const PAGE_PARTITIONS=4;
interface Input {divisionIds?:readonly string[];zip?:string|null;bodyId?:string|null;cursor?:string|null}
type Options=PromotedCivicDataReadOptions&{vault?:EvidenceStore};
interface Cursor {scope:string;version:string;partition:number;row:number}
export class OpenDataCursorError extends Error {
  readonly reason:"INVALID"|"CHANGED";
  constructor(reason:"INVALID"|"CHANGED") {super(reason==="CHANGED"?"The accepted source changed; restart this place's records.":"Invalid open-data page cursor.");this.reason=reason;}
}
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function decodeCursor(value:string,scope:string,version:string):Cursor {
  let cursor:Cursor;
  try {
    if(value.length>1024||!/^[\w-]+$/.test(value))throw Error();
    cursor=JSON.parse(Buffer.from(value,"base64url").toString("utf8")) as Cursor;
    if(cursor.scope!==scope||typeof cursor.version!=="string"||!Number.isSafeInteger(cursor.partition)||cursor.partition<0||!Number.isSafeInteger(cursor.row)||cursor.row<0)throw Error();
  }catch{throw new OpenDataCursorError("INVALID");}
  if(cursor.version!==version)throw new OpenDataCursorError("CHANGED");
  return cursor;
}

/** One setup and at most one held source slice in memory; API and complete Ask reads share this iterator. */
async function prepareOpenData(input:Input,options:Options) {
  const divisions=[...new Set(input.divisionIds??[])],point=input.zip?await readZipLocation(input.zip):null;
  const requested=[...divisions.map(id=>({source:"socrata-discovery" as const,partition:divisionPartition(id)})),
    ...(input.zip&&/^\d{5}$/.test(input.zip)?[zipPartition(input.zip),...(point?nearbyFacilityCells(point):[])].map(partition=>({source:"epa-echo" as const,partition})):[])];
  const selection=currentReaderSelection();for(const item of requested)selection?.keys.add(`${OPEN_DATA_READER_KEY_PREFIX}${item.partition}`);
  const sourceIds=[...new Set(requested.map(item=>item.source))];
  const manifests=await readPromotedCivicDataBatch<OpenDataProjection>("CURATED_READER_RECORD",sourceIds.map(source=>openDataScope(source)),options);
  const entries:{source:OpenDataSource;partition:string;reference?:OpenDataPartitionRef;inline?:OpenDataProjection}[]=[],unavailable=new Set<string>(),notHeld=new Set<string>(),checkedAt:Record<string,string>={};
  for(const [i,source]of sourceIds.entries()) {
    const read=manifests[i];
    if(read.kind==="STORE_UNREACHABLE"){unavailable.add(source);continue;}
    if(read.kind!=="PROMOTED"){notHeld.add(source);continue;}
    assertOpenDataProjection(read.value,source);
    const date=read.metadata.checkedAt??read.metadata.retrievedAt;if(date)checkedAt[source]=date;
    if(!read.value.partitions){entries.push({source,partition:"national",inline:read.value});continue;}
    for(const item of requested.filter(item=>item.source===source))for(const reference of read.value.partitions.filter(reference=>reference.id===item.partition||/^(?:cell|zip):/.test(item.partition)&&reference.id.startsWith(`${item.partition}:state:`)))entries.push({...item,reference});
  }
  const scope=digest([divisions,input.zip??null,input.bodyId??null]),version=digest(sourceIds.map((source,i)=>[source,manifests[i].metadata.versionId]));
  let held:{index:number;records:readonly OpenDataFact[]}|undefined;
  const matches=(row:OpenDataFact,partition:string)=>{
    if(row.sourceId==="socrata-discovery") {
      const owner=divisions.find(id=>row.divisionIds.includes(id));
      return !!owner&&(partition==="national"||partition===divisionPartition(owner))&&(!input.bodyId||!row.bodyIds.length||row.bodyIds.includes(input.bodyId));
    }
    if(partition.startsWith("cell:")&&row.zip===input.zip)return false;
    return row.zip===input.zip||!!point&&facilityNear(row,point);
  };
  return {async page(value?:string|null) {
    const cursor=value?decodeCursor(value,scope,version):{scope,version,partition:0,row:0};
    if(cursor.partition>entries.length||cursor.partition===entries.length&&cursor.row!==0)throw new OpenDataCursorError("INVALID");
    const records=new Map<string,OpenDataFact>();let visited=0;
    while(cursor.partition<entries.length&&visited<PAGE_PARTITIONS) {
      const index=cursor.partition,entry=entries[index];visited++;
      if(held?.index!==index) {
        try {held={index,records:entry.inline?.records??(await readOpenDataPartition(entry.source,entry.reference!,options.vault)).records};}
        catch {unavailable.add(entry.source);cursor.partition++;cursor.row=0;continue;}
      }
      if(cursor.row>held.records.length)throw new OpenDataCursorError("INVALID");
      while(cursor.row<held.records.length) {
        const row=held.records[cursor.row++];if(matches(row,entry.partition))records.set(row.id,row);
        if(records.size===OPEN_DATA_PAGE_ROWS)break;
      }
      if(cursor.row===held.records.length){cursor.partition++;cursor.row=0;held=undefined;}
      if(records.size===OPEN_DATA_PAGE_ROWS)break;
    }
    return {records:[...records.values()],nextCursor:cursor.partition<entries.length?Buffer.from(JSON.stringify(cursor)).toString("base64url"):null,
      unavailable:[...unavailable],notHeld:[...notHeld],radiusKm:point?FACILITY_RADIUS_KM:null,checkedAt};
  }};
}
export async function readerOpenData(input:Input,options:Options={}) {
  return (await prepareOpenData(input,options)).page(input.cursor);
}
export async function* readerOpenDataPages(input:Input,options:Options={}) {
  const read=await prepareOpenData(input,options);let cursor=input.cursor;
  do {const page=await read.page(cursor);yield page;cursor=page.nextCursor;}while(cursor);
}
