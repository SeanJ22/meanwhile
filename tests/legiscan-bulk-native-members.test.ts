import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { publishBulkCandidate } from "../lib/sources/legiscan/publication.ts";
import { readBillsForState } from "../lib/sources/legiscan/reader.ts";
import { type BillSession,type BillPart,type Dataset } from "../lib/sources/legiscan/bills.ts";
const at="2026-10-12T12:00:00.000Z",later="2026-10-12T12:01:00.000Z";
const hash=(body:string)=>createHash("sha256").update(body).digest("hex");
const first=JSON.parse(readFileSync(new URL("./fixtures/legiscan/bill/HB1.json",import.meta.url),"utf8"));
const second=structuredClone(first);second.bill.bill_id+=1000;
const original=[JSON.stringify(first),JSON.stringify(second)];
const dataset:Dataset={state_id:first.bill.state_id,session_id:first.bill.session_id,session_name:first.bill.session.session_name,dataset_hash:hash(original.join("")),dataset_date:"2012-12-30"};
function source(dataset:Dataset,bodies:string[],retrievedAt:string){const body=JSON.stringify({dataset,archiveHash:hash(bodies.join("")),memberHashes:bodies.map(hash)});return{dataset,bodies,people:[],archiveHash:hash(bodies.join("")),capture:{body,requestedUrl:"https://api.legiscan.com/?op=getDataset",finalUrl:"https://api.legiscan.com/?op=getDataset",httpStatus:200,retrievedAt,rawHash:hash(body)}};}
const pointers=(candidate:{readModel:unknown})=>(candidate.readModel as BillSession).parts;

test("a changed source edition reuses native bill groups whose bytes and sponsor joins did not change",async()=>{
  class CountingStore extends MemoryRoutineDataStore{
    parts=0;
    override async create(record:Parameters<MemoryRoutineDataStore["create"]>[0],event:Parameters<MemoryRoutineDataStore["create"]>[1]){
      if((record.candidate.readModel as {kind:string}).kind==="PART")this.parts++;
      return super.create(record,event);
    }
  }
  const store=new CountingStore(),old=await publishBulkCandidate(store,source(dataset,original,at),at);
  assert.ok(old.outcome.promoted);assert.equal(store.parts,2);
  const unchanged=await store.readPromotion<BillPart>("STATE_BILL",pointers(old.candidate)[1].scope);assert.ok(unchanged);
  const changed=structuredClone(first);changed.bill.title="Publisher revised title";
  const bodies=[JSON.stringify(changed),original[1]],edition={...dataset,dataset_hash:hash(bodies.join("")),dataset_date:"2013-01-06"};
  const next=await publishBulkCandidate(store,source(edition,bodies,later),later);
  assert.ok(next.outcome.promoted,JSON.stringify(next.outcome.candidate.receipt));assert.equal(store.parts,3,"only the changed native group publishes again");
  assert.deepEqual(pointers(next.candidate)[1],pointers(old.candidate)[1]);
  const indexBody=JSON.stringify({status:"OK",datasetlist:[edition]});
  await publishBulkCandidate(store,{capture:{...source(edition,bodies,later).capture,body:indexBody,rawHash:hash(indexBody),
    requestedUrl:"https://api.legiscan.com/?op=getDatasetList",finalUrl:"https://api.legiscan.com/?op=getDatasetList"},datasets:[edition]},later);
  const read=await readBillsForState("AK",{store,now:later});
  assert.equal(read.complete,true);assert.equal(read.bills.length,2);
  assert.equal(read.bills.find(row=>row.billId===first.bill.bill_id)?.title,changed.bill.title);
  assert.deepEqual(read.bills.find(row=>row.billId===second.bill.bill_id)?.texts,unchanged.payload.bills[0].texts);
  const retained=await store.readCandidate(pointers(next.candidate)[1].versionId);assert.ok(retained);
  assert.deepEqual(JSON.parse((retained.candidate.normalizedPayload as {capture:{body:string}}).capture.body).bodies,[original[1]],"the complete untouched native bill, including source actions and text metadata, stays held");
});
