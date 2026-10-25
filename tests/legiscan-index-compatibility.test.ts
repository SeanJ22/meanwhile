import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { readPromotedCivicData, type CivicDataReadStore, type PromotedEdgeEntry } from "../lib/civic-data/read-model.ts";
import { LEGISCAN_BULK_SCOPE, publicDatasetIndex, type Dataset } from "../lib/sources/legiscan/bills.ts";
import { bulkCandidate, publishBulkCandidate } from "../lib/sources/legiscan/publication.ts";
import { readBillsForState, readBulkProjection } from "../lib/sources/legiscan/reader.ts";
import {provenEdgeEntry} from "./helpers/promoted-edge-entry.ts";

const at="2026-10-12T12:00:00.000Z";
const hash=(body:string)=>createHash("sha256").update(body).digest("hex");
const bodies=["HB1","HB2"].map(name=>readFileSync(new URL(`./fixtures/legiscan/bill/${name}.json`,import.meta.url),"utf8"));
const bill=JSON.parse(bodies[0]).bill;
const dataset:Dataset={state_id:bill.state_id,session_id:bill.session_id,session_name:bill.session.session_name,dataset_hash:hash(bodies[0]),dataset_date:"2012-12-30"};
const capture=(body:string)=>({body,requestedUrl:"https://api.legiscan.com/?op=getDatasetList",finalUrl:"https://api.legiscan.com/?op=getDatasetList",httpStatus:200,retrievedAt:at,rawHash:hash(body)});

async function published() {
  const store=new MemoryRoutineDataStore();
  const historical={...dataset,session_id:dataset.session_id-1};
  const list=[dataset,historical];
  const index=await publishBulkCandidate(store,{capture:capture(JSON.stringify({status:"OK",datasetlist:list})),datasets:list},at);
  assert.ok(index.outcome.promoted);
  const archiveHash=hash(bodies.join(""));
  const session=await publishBulkCandidate(store,{capture:capture(JSON.stringify({dataset,archiveHash,memberHashes:bodies.map(hash)})),dataset,bodies,archiveHash},at);
  assert.ok(session.outcome.promoted);
  const edges=new Map<string,PromotedEdgeEntry>();
  for(const projection of (store as unknown as {promotions:Map<string,import("../lib/civic-data/types.ts").PromotedProjection>}).promotions.values()) {
    edges.set(projection.scope,{kind:"PROMOTED",projection,attested:{recordClass:projection.recordClass,scope:projection.scope,versionId:projection.versionId,payloadSha256:canonicalCivicDataHash(projection.payload),retrievedAt:at,staleAtRetrieval:false,version:null,sourceThrough:null}});
  }
  return edges;
}
function revised(edge:PromotedEdgeEntry,mutate:(payload:Record<string,unknown>)=>void):PromotedEdgeEntry {
  assert.equal(edge.kind,"PROMOTED");if(edge.kind!=="PROMOTED")throw Error("Expected published fixture");
  const copy=structuredClone(edge);mutate(copy.projection.payload as Record<string,unknown>);
  return {...copy,attested:{...copy.attested,payloadSha256:canonicalCivicDataHash(copy.projection.payload)}};
}

test("the proven v2 and v4 catalogues use the same public dataset schema",async()=>{
  const edges=await published(),edge=edges.get(LEGISCAN_BULK_SCOPE)!;
  for(const parser of [undefined,"legiscan-bulk/2","legiscan-bulk/4"]) {
    const selected=revised(edge,payload=>{if(parser)payload.parserVersion=parser;else delete payload.parserVersion;});
    const proof=await readPromotedCivicData("STATE_BILL",LEGISCAN_BULK_SCOPE,{edge:selected,now:at});
    assert.equal(proof.kind,"PROMOTED","the original canonical receipt/hash remains required");
    const read=await readBulkProjection(LEGISCAN_BULK_SCOPE,{edge:selected,now:at});
    assert.equal(read.kind,"PROMOTED");
    if(read.kind==="PROMOTED"&&read.value.kind==="INDEX")assert.deepEqual(publicDatasetIndex(read.value).datasets.map(row=>row.session_id),[dataset.session_id,dataset.session_id-1]);
  }
});

test("a v2 catalogue shows independently published v4 bills while historical coverage stays incomplete",async()=>{
  const edges=await published();
  edges.set(LEGISCAN_BULK_SCOPE,revised(edges.get(LEGISCAN_BULK_SCOPE)!,payload=>{delete payload.parserVersion;}));
  const store:CivicDataReadStore={async readCandidate(){throw Error("Not a candidate read");},async readPromotion(){throw Error("Not a pointer read");},async readPromotedEntry(recordClass,scope){return edges.get(scope)??{kind:"NOT_RECORDED" as const,recordClass,scope};}};
  const read=await readBillsForState("AK",{store,now:at,bypassCache:true});
  assert.equal(read.complete,false);
  assert.deepEqual(read.bills.map(row=>row.billId),bodies.map(body=>JSON.parse(body).bill.bill_id));
  const part=[...edges.entries()].find(([,edge])=>edge.kind==="PROMOTED"&&(edge.projection.payload as {kind:string}).kind==="PART")!;
  edges.set(part[0],revised(part[1],payload=>{delete payload.parserVersion;}));
  await assert.rejects(readBillsForState("AK",{store,now:at,bypassCache:true}),/LEGISCAN_BULK_SOURCE_INVALID/);
});

test("catalogue compatibility does not accept malformed data, another source or a legacy session",async()=>{
  const edges=await published(),edge=edges.get(LEGISCAN_BULK_SCOPE)!;
  for(const mutate of [
    (payload:Record<string,unknown>)=>{payload.parserVersion="legiscan-bulk/3";},
    (payload:Record<string,unknown>)=>{(payload.datasets as Dataset[])[0].state_id=99;},
    (payload:Record<string,unknown>)=>{(payload.datasets as Dataset[])[0].session_name="";},
    (payload:Record<string,unknown>)=>{(payload.datasets as Dataset[]).push((payload.datasets as Dataset[])[0]);},
  ])await assert.rejects(readBulkProjection(LEGISCAN_BULK_SCOPE,{edge:revised(edge,mutate),now:at}));
  const session=[...edges.values()].find(edge=>edge.kind==="PROMOTED"&&(edge.projection.payload as {kind:string}).kind==="SESSION")!;
  assert.equal(session.kind,"PROMOTED");if(session.kind!=="PROMOTED")return;
  await assert.rejects(readBulkProjection(session.projection.scope,{edge:revised(session,payload=>{delete payload.parserVersion;}),now:at}),/LEGISCAN_BULK_SOURCE_INVALID/);
  if(edge.kind!=="PROMOTED")throw Error("Expected published fixture");
  const other={...edge,projection:{...edge.projection,sourceId:"another-source",receipt:{...edge.projection.receipt,sourceId:"another-source"}}};
  await assert.rejects(readBulkProjection(LEGISCAN_BULK_SCOPE,{edge:other,now:at}),/LEGISCAN_BULK_SOURCE_INVALID/);
});

test("saved-source verification uses the same public index facts across v2 and v4 without accepting changed facts",async()=>{
  const original=bulkCandidate({capture:capture(JSON.stringify({status:"OK",datasetlist:[dataset]})),datasets:[dataset]});
  const payload=structuredClone(original.readModel) as Record<string,unknown>;
  delete payload.parserVersion;
  const candidate={...original,normalization:{...original.normalization,parserVersion:"legiscan-bulk/2",normalizedHash:canonicalCivicDataHash(payload)},readModel:payload};
  const edge=provenEdgeEntry({recordClass:"STATE_BILL",scope:LEGISCAN_BULK_SCOPE,sourceId:"legiscan-bills",versionId:candidate.id,value:payload,retrievedAt:at});
  const store:CivicDataReadStore={async readPromotion(){throw Error("The edge carries this pointer");},async readCandidate(){return {candidate,state:"PROMOTED",acquisitionSucceeded:true,receipt:edge.projection.receipt,promotedVersion:candidate.id,lastKnownGoodVersion:candidate.id,failureCode:null,failureDetail:null};}};
  assert.equal((await readBulkProjection(LEGISCAN_BULK_SCOPE,{store,edge,verifySavedSource:true,now:at})).kind,"PROMOTED");
  const changed=revised(edge,value=>{(value.datasets as Dataset[])[0].session_name="Different source session";});
  await assert.rejects(readBulkProjection(LEGISCAN_BULK_SCOPE,{store,edge:changed,verifySavedSource:true,now:at}),/LEGISCAN_BULK_PROJECTION_INVALID/);
});
