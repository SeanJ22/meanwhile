import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {MemoryRoutineDataStore} from "../lib/civic-data/store.ts";
import {MemoryEvidenceStore,type EvidenceStore} from "../lib/control-plane/evidence/store.ts";
import {normalizeEcho,openDataReports} from "../lib/sources/open-data/normalize.ts";
import {saveOpenDataPartition} from "../lib/sources/open-data/artifacts.ts";
import {publishOpenData} from "../lib/sources/open-data/publication.ts";
import {readerOpenData,readerOpenDataPages,OpenDataCursorError} from "../lib/sources/open-data/reader.ts";
import {facilityCell,FACILITY_RADIUS_KM} from "../lib/sources/open-data/geography.ts";
import {fixtureZipLocation} from "./helpers/zip-location.ts";
import {streamCsvObjects} from "../lib/sources/prl/streaming.ts";
import {ECHO_EXPORT,type OpenDataFact,type OpenDataPartitionRef} from "../lib/sources/open-data/model.ts";

const NOW="2026-10-23T09:06:56.174Z",LATER="2026-10-23T09:07:56.174Z",zip="85331",point=fixtureZipLocation(zip)!;
async function rows(count:number,location:{zip:string;lat:number;lng:number},start=0) {
  const sample=readFileSync(new URL("./fixtures/src-so/echo-exporter-sample.csv",import.meta.url),"utf8");
  let source:Record<string,unknown>={};for await(const row of streamCsvObjects((async function*(){yield sample;})())){source=row;break;}
  return Array.from({length:count},(_,index)=>normalizeEcho({...source,REGISTRY_ID:String(110000000000+start+index),FAC_NAME:`Paging fixture ${start+index}`,FAC_ZIP:location.zip,FAC_LAT:String(location.lat),FAC_LONG:String(location.lng)},NOW,null));
}
async function publish(store:MemoryRoutineDataStore,vault:MemoryEvidenceStore,all:OpenDataFact[],parts:[string,OpenDataFact[]][],now=NOW) {
  const capture={url:ECHO_EXPORT,retrievedAt:NOW,rawHash:createHash("sha256").update(JSON.stringify(all.map(row=>row.sourceRow))).digest("hex"),sourceRows:all.map(row=>row.sourceRow)},references:OpenDataPartitionRef[]=[];
  for(const [partition,records]of parts)references.push(await saveOpenDataPartition({source:"epa-echo",partition,rows:records,captures:[capture],now},vault));
  const result=await publishOpenData({store,source:"epa-echo",rows:[],reports:openDataReports(all),partitions:references,captures:[capture],replace:true,now});
  assert.ok(result.outcome.promoted||result.outcome.confirmed);return references;
}
test("Cursor pages retain all ZIP and nearby facts once, and refuse another place or source version",async()=>{
  const exact=await rows(60,{...point,zip}),near=await rows(60,{...point,zip:"85332"},60),all=[...exact,...near],store=new MemoryRoutineDataStore(),vault=new MemoryEvidenceStore();
  const cell=facilityCell(point.lat,point.lng),parts:[string,OpenDataFact[]][]=[...Array.from({length:2},(_,index)=>[`zip:${zip}:state:AZ:part:${index}`,exact.slice(index*30,index*30+30)] as [string,OpenDataFact[]]),...Array.from({length:3},(_,index)=>[`${cell}:state:AZ:part:${index}`,all.slice(index*40,index*40+40)] as [string,OpenDataFact[]])];
  await publish(store,vault,all,parts);
  let requests=0;const measured:EvidenceStore={put:vault.put.bind(vault),head:vault.head.bind(vault),list:vault.list.bind(vault),async get(key){requests++;return vault.get(key);}};
  const options={store,vault:measured,now:NOW,bypassCache:true},first=await readerOpenData({zip},options);
  assert.equal(first.records.length,50);assert.ok(first.nextCursor);assert.ok(requests<=4);
  const found:OpenDataFact[]=[];for await(const page of readerOpenDataPages({zip},options)){assert.ok(page.records.length<=50);found.push(...page.records);}
  assert.deepEqual(found.map(row=>row.id),all.map(row=>row.id));assert.equal(new Set(found.map(row=>row.id)).size,120);
  await assert.rejects(readerOpenData({zip:"85332",cursor:first.nextCursor},options),error=>error instanceof OpenDataCursorError&&error.reason==="INVALID");
  await assert.rejects(readerOpenData({zip,cursor:"not-json"},options),error=>error instanceof OpenDataCursorError&&error.reason==="INVALID");
  const invalid=JSON.parse(Buffer.from(first.nextCursor,"base64url").toString());invalid.row=10000;
  await assert.rejects(readerOpenData({zip,cursor:Buffer.from(JSON.stringify(invalid)).toString("base64url")},options),error=>error instanceof OpenDataCursorError&&error.reason==="INVALID");
  const changed=normalizeEcho({...exact[0].sourceRow,FAC_INSPECTION_COUNT:"37"},NOW,null),next=all.map(row=>row.id===changed.id?changed:row);
  await publish(store,vault,next,parts.map(([id,held])=>[id,held.map(row=>row.id===changed.id?changed:row)]),LATER);
  await assert.rejects(readerOpenData({zip,cursor:first.nextCursor},{...options,now:LATER}),error=>error instanceof OpenDataCursorError&&error.reason==="CHANGED");
  assert.equal((await readerOpenData({zip},{...options,now:LATER})).records[0].fields.inspectionCount,"37");
});
test("A page bounds rejected spatial work and continues through empty slices without hiding later facts",async()=>{
  const far={lat:point.lat-FACILITY_RADIUS_KM/110.574*.99,lng:point.lng-FACILITY_RADIUS_KM/(111.32*Math.cos(point.lat*Math.PI/180))*.99};
  const outside=await rows(5,{...far,zip:"85332"}),near=await rows(3,{...point,zip:"85332"},5),all=[...outside,...near],store=new MemoryRoutineDataStore(),vault=new MemoryEvidenceStore();
  const parts:[string,OpenDataFact[]][]=[...outside.map((row,index)=>[`${facilityCell(far.lat,far.lng)}:state:AZ:part:${index}`,[row]] as [string,OpenDataFact[]]),[`${facilityCell(point.lat,point.lng)}:state:AZ:part:0`,near]];
  await publish(store,vault,all,parts);
  const options={store,vault,now:NOW,bypassCache:true},first=await readerOpenData({zip},options);assert.deepEqual(first.records,[]);assert.ok(first.nextCursor);
  const found:OpenDataFact[]=[];for await(const page of readerOpenDataPages({zip},options))found.push(...page.records);
  assert.deepEqual(found.map(row=>row.id),near.map(row=>row.id));
});
