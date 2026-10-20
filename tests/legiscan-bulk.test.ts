import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { zip } from "../scripts/xlsx.mjs";
import { normalizeSession,parseDatasetList,billScope,LEGISCAN_BULK_SCOPE,joinSponsor,type Dataset } from "../lib/sources/legiscan/bills.ts";
import { bulkCandidate,publishBulkCandidate } from "../lib/sources/legiscan/publication.ts";
import { readBulkProjection,readBillsForState,billsForPerson } from "../lib/sources/legiscan/reader.ts";
import { refreshLegiscan,recordLegiscanBulkFailure } from "../scripts/legiscan-bulk.mts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { legiscanBillEvidence } from "../lib/ask/legiscan-bills.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { normalizedHash } from "../lib/civic-data/candidate-builders.ts";
import { feedDoorDrafts } from "../lib/doors/seed-feeds.ts";

const at="2026-10-12T12:00:00.000Z", later="2026-10-12T12:01:00.000Z";
const hash=(body:string)=>createHash("sha256").update(body).digest("hex");
const fixture=(name:string)=>readFileSync(new URL(`./fixtures/legiscan/bill/${name}.json`,import.meta.url),"utf8");
const ak=[fixture("HB1"),fixture("HB2")],ar=[fixture("HB1044")];
const catalog=(body:string):Dataset=>{
  const bill=JSON.parse(body).bill;
  return {state_id:bill.state_id,session_id:bill.session_id,session_name:bill.session.session_name,dataset_hash:hash(body),dataset_date:"2012-12-30",access_key:"fixture-access"};
};
const datasets=[catalog(ak[0]),catalog(ar[0])];
const person={id:"held:ak-gatto",nativeIds:{legiscan:["6033"]}};
function capture(body:string,now=at,op="getDataset") {return {body,requestedUrl:`https://api.legiscan.com/?op=${op}`,finalUrl:`https://api.legiscan.com/?op=${op}`,httpStatus:200,retrievedAt:now,rawHash:hash(body)};}
function source(dataset:Dataset,bodies:string[]) {
  const {access_key:_access,...publicDataset}=dataset;
  return {capture:capture(JSON.stringify({dataset:publicDataset,archiveHash:hash(bodies.join("")),bodies})),dataset,bodies,people:[person]};
}
test("real source fixtures retain every bill, committee sponsor, status date and text publication",()=>{
  const alaska=normalizeSession(datasets[0],ak,at,[person]),arkansas=normalizeSession(datasets[1],ar,at,[person]);
  assert.deepEqual(alaska.counts,{rows:2,joined:2,unjoined:0,sponsorsJoined:2,sponsorsUnjoined:6});
  assert.equal(alaska.bills[0].fips,"02"); assert.equal(alaska.bills[0].ocdId,"ocd-division/country:us/state:ak");
  assert.equal(alaska.bills[0].statusDate,"2011-04-11");assert.equal(alaska.bills[0].texts.length,3);
  assert.equal(alaska.bills[0].facts.status.publishedAt,"2012-12-30");assert.equal(alaska.bills[0].facts["text:153588"].publishedAt,"2011-01-18");
  assert.equal(arkansas.bills[0].sponsors[0].name,"Joint Budget Committee");
  assert.equal(arkansas.bills[0].sponsors[0].joinReason,"Committee sponsor"); assert.equal(arkansas.counts.unjoined,1);
  assert.equal(normalizeSession(datasets[0],ak,at,[]).bills.length,2);
  assert.deepEqual(billsForPerson(alaska.bills,person).map(row=>row.billId),[230084,230085]);
  const sponsor=alaska.bills[0].sponsors[0];
  assert.equal(joinSponsor(sponsor,[person,{...person,id:"other"}]).officeholderId,null);
  assert.throws(()=>normalizeSession(datasets[1],ak,at),/SCOPE_MISMATCH/);
  assert.throws(()=>normalizeSession(datasets[0],[ak[0],ak[0]],at),/DUPLICATE_BILL/);
});
test("one national routine uses the publisher weekly clock and installs a keyed source door",()=>{
  const contract=requiredRoutineContract("legiscan-bulk");assert.equal(contract.cadence.defaultEveryMs,7*86400000);
  assert.equal(contract.fanOut,true);
  assert.equal(feedDoorDrafts().find(row=>row.config?.contractId==="legiscan-bulk")?.config?.keyRef,"LEGISCAN_API_KEY");
  assert.equal(parseDatasetList({status:"OK",datasetlist:datasets}).length,2);
  assert.throws(()=>parseDatasetList({status:"OK",datasetlist:[]}),/LIST_INVALID/);
});
test("saved source bytes publish to state readers and Ask; a forged title cannot pass",async()=>{
  const store=new MemoryRoutineDataStore();
  const index=datasets.map(({access_key:_access,...row})=>row);
  const marker=await publishBulkCandidate(store,{capture:capture(JSON.stringify({status:"OK",datasetlist:index}),at,"getDatasetList"),datasets},at);
  assert.ok(marker.outcome.promoted,JSON.stringify(marker.outcome.candidate.receipt));
  for(const [i,bodies] of [ak,ar].entries()) {
    const published=await publishBulkCandidate(store,source(datasets[i],bodies),at);
    assert.ok(published.outcome.promoted,JSON.stringify(published.outcome.candidate.receipt));
    assert.ok(!JSON.stringify(published.candidate).includes("fixture-access"));
  }
  assert.equal((await readBillsForState("AK",{store,now:at,bypassCache:true})).bills.length,2);
  assert.equal((await readBillsForState("AR",{store,now:at,bypassCache:true})).bills.length,1);
  const evidence=await legiscanBillEvidence({question:"Which bills did Carl Gatto sponsor?",states:["AK"],subject:{kind:"PERSON",id:person.id,name:"Carl Gatto"},person},{store,now:at,bypassCache:true});
  assert.equal(evidence.denominators.legiscanBillsMatched,2);assert.equal(evidence.records.filter(row=>row.kind==="STATE_BILL").length,2);
  assert.ok(evidence.records.every(row=>row.sourceUrl&&row.retrievedAt));
  const unresolved=await legiscanBillEvidence({question:"Which bills did Carl Gatto sponsor?",states:["AK"],subject:{kind:"PERSON",id:person.id,name:"Carl Gatto"}},{store,now:at,bypassCache:true});
  assert.equal(unresolved.records.length,0);assert.equal(unresolved.gaps.length,1);
  const forged=bulkCandidate(source(datasets[0],ak));(forged.readModel as {bills:{title:string}[]}).bills[0].title="Invented";
  (forged.normalization as {normalizedHash:string}).normalizedHash=normalizedHash(forged.readModel);
  const {processRegisteredFanOutCandidate}=await import("../lib/civic-data/promotion.ts");
  const refused=await processRegisteredFanOutCandidate(new MemoryRoutineDataStore(),"legiscan-bulk",forged,at);
  assert.equal(refused.promoted,null);
  assert.match(JSON.stringify(refused.candidate.receipt),/SOURCE_SCOPED|projection|source/i);
});
test("bulk refresh downloads archives once and unchanged hashes confirm success without per-bill calls",async()=>{
  const store=new MemoryRoutineDataStore(),calls:string[]=[],nativeBodies=[ak,ar]; let now=at;
  const fetchImpl:typeof fetch=async value=>{
    const url=new URL(String(value)),op=url.searchParams.get("op")!; calls.push(op);
    assert.equal(url.searchParams.get("key"),"fixture-key");
    if(op==="getDatasetList") return Response.json({status:"OK",datasetlist:datasets});
    assert.equal(op,"getDataset");
    const index=datasets.findIndex(row=>row.session_id===Number(url.searchParams.get("id"))),dataset=datasets[index];
    const archive=zip(nativeBodies[index].map((body,i)=>({name:`${dataset.session_id}/bill/${i}.json`,data:Buffer.from(body)})),"2026-10-12");
    return Response.json({status:"OK",dataset:{...dataset,mime:"application/zip",zip:archive.toString("base64")}});
  };
  const options={key:"fixture-key",fetchImpl,now:()=>now,peopleForState:async()=>[person]};
  const first=await refreshLegiscan(store,AbortSignal.timeout(10000),options);
  assert.deepEqual(calls,["getDatasetList","getDataset","getDataset"]);
  assert.equal(first.counts.AK.rows,2);assert.equal(first.counts.AR.unjoined,1);
  now=later;const second=await refreshLegiscan(store,AbortSignal.timeout(10000),options);
  assert.deepEqual(calls,["getDatasetList","getDataset","getDataset","getDatasetList"]);
  assert.equal(second.counts.AK.unchanged,1);assert.equal(second.counts.AR.unchanged,1);
  assert.equal((await readBulkProjection(billScope(datasets[0].session_id),{store,now:later,bypassCache:true})).metadata.retrievedAt,later);
  const held=await store.readPromotion("STATE_BILL",LEGISCAN_BULK_SCOPE);
  let acquisitionError:unknown;
  try {
    await refreshLegiscan(store,AbortSignal.timeout(10000),{...options,fetchImpl:async()=>new Response("",{status:403})});
  } catch(error) {acquisitionError=error;}
  assert.ok(acquisitionError instanceof Error);
  assert.equal(acquisitionError.message,"LegiScan getDatasetList HTTP 403");
  const failed=await recordLegiscanBulkFailure(store,acquisitionError,later);
  assert.equal(failed.outcome.candidate.state,"SOURCE_BLOCKED");assert.equal(failed.outcome.promoted,null);
  assert.equal(failed.outcome.candidate.candidate.retrieval.requestedUrl,"https://api.legiscan.com/?op=getDatasetList");
  assert.equal(failed.outcome.candidate.candidate.retrieval.failureDetail,"PUBLISHER_UNAVAILABLE: LegiScan getDatasetList HTTP 403");
  assert.equal((await store.readPromotion("STATE_BILL",LEGISCAN_BULK_SCOPE))?.versionId,held?.versionId);
});
