import { readPromotedCivicDataBatch, type PromotedCivicDataReadOptions } from "../../civic-data/read-model.ts";
import { assertOpenDataProjection } from "./publication.ts";
import { readZipLocation } from "../../place-map/locations.ts";
import { nearbyFacilityCells,facilityNear,FACILITY_RADIUS_KM } from "./geography.ts";
import { openDataScope,divisionPartition, zipPartition, type OpenDataFact,type OpenDataProjection } from "./model.ts";
import { readOpenDataPartition } from "./artifacts.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";
export async function readerOpenData(input:{divisionIds?:readonly string[];zip?:string|null;bodyId?:string|null}, options:PromotedCivicDataReadOptions&{vault?:EvidenceStore}={}) {
  const partitions=[...new Set(input.divisionIds ?? [])].map(id=>({source:"socrata-discovery" as const,partition:divisionPartition(id)}));
  const point=input.zip?await readZipLocation(input.zip):null;
  const requested=[...partitions,...(input.zip && /^\d{5}$/.test(input.zip)?[zipPartition(input.zip),...(point?nearbyFacilityCells(point):[])].map(partition=>({source:"epa-echo" as const,partition})):[])];
  const sourceIds=[...new Set(requested.map(r=>r.source))];
  const manifests=await readPromotedCivicDataBatch<OpenDataProjection>("CURATED_READER_RECORD",sourceIds.map(source=>openDataScope(source)),options);
  const indexed=new Map(sourceIds.flatMap((source,i)=>{
    const read=manifests[i];if(read.kind!=="PROMOTED")return [];
    assertOpenDataProjection(read.value,source);return read.value.partitions?[[source,read] as const]:[];
  }));
  const reads=sourceIds.filter(source=>!indexed.has(source)).map(source=>({item:{source,partition:"national"},read:manifests[sourceIds.indexOf(source)]}));
  for(const item of requested) {
    const manifest=indexed.get(item.source);if(!manifest)continue;
    const references=manifest.value.partitions!.filter(p=>p.id===item.partition || /^(?:cell|zip):/.test(item.partition) && p.id.startsWith(`${item.partition}:state:`));
    for(const reference of references) {
      try {reads.push({item,read:{...manifest,value:await readOpenDataPartition(item.source,reference,options.vault)}});}
      catch {reads.push({item,read:{kind:"STORE_UNREACHABLE",value:null,metadata:manifest.metadata,code:"STORE_READ_FAILED",detail:"The source's accepted reader slice could not be read."}});}
    }
  }
  const records=new Map<string,OpenDataFact>();
  const unavailable:string[]=[],notHeld:string[]=[];
  const checkedAt:Record<string,string>={};
  for(let i=0;i<sourceIds.length;i++)if(manifests[i].kind==="PROMOTED") {
    const date=manifests[i].metadata.checkedAt??manifests[i].metadata.retrievedAt;if(date)checkedAt[sourceIds[i]]=date;
  }
  for(const {item,read}of reads) {
    if(read.kind==="STORE_UNREACHABLE"){unavailable.push(item.source);continue;}
    if(read.kind!=="PROMOTED"){if(!item.partition.startsWith("cell:"))notHeld.push(item.source);continue;}
    assertOpenDataProjection(read.value,item.source);
    for(const row of read.value.records) {
      if(row.sourceId==="socrata-discovery" && !(input.divisionIds??[]).some(id=>row.divisionIds.includes(id)))continue;
      if(row.sourceId==="socrata-discovery" && input.bodyId && row.bodyIds.length && !row.bodyIds.includes(input.bodyId))continue;
      if(row.sourceId==="epa-echo" && row.zip!==input.zip && (!point || !facilityNear(row,point)))continue;
      records.set(row.id,row);
    }
  }
  return {records:[...records.values()],unavailable:[...new Set(unavailable)],notHeld:[...new Set(notHeld)],radiusKm:point?FACILITY_RADIUS_KM:null,checkedAt};
}
