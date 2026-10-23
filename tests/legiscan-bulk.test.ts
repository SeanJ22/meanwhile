import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { zip } from "../scripts/xlsx.mjs";
import { normalizeSession,parseDatasetList,billScope,LEGISCAN_BULK_SCOPE,joinSponsor,stateOfDataset,type Dataset } from "../lib/sources/legiscan/bills.ts";
import { bulkCandidate,publishBulkCandidate } from "../lib/sources/legiscan/publication.ts";
import { readBulkProjection,readBillsForState,billsForPerson } from "../lib/sources/legiscan/reader.ts";
import { refreshLegiscan } from "../scripts/legiscan-bulk.mts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { legiscanBillEvidence } from "../lib/ask/legiscan-bills.ts";
import { recordRegisteredSourceAcquisitionFailure,sourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-failure.ts";
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
  const national=parseDatasetList({status:"OK",datasetlist:[
    {...datasets[0],state_id:51,session_id:2198,session_name:"26th Council"},
    {...datasets[0],state_id:52,session_id:2199,session_name:"119th Congress"},
  ]});
  assert.deepEqual(national.map(stateOfDataset),["DC","US"]);
  for(const [index,state] of ["DC","US"].entries()) {
    const bill=JSON.parse(ak[0]);
    Object.assign(bill.bill,{state,state_id:national[index].state_id,session_id:national[index].session_id,url:`https://legiscan.com/${state}/bill/HB1/2026`});
    const session=normalizeSession(national[index],[JSON.stringify(bill)],at);
    assert.equal(session.state,state);
    assert.equal(session.bills[0].ocdId,state==="US"?"ocd-division/country:us":"ocd-division/country:us/state:dc");
  }
});
test("bulk sponsors reuse the saved-profile identity join used by state votes",async()=>{
  const native="ocd-person/11111111-1111-4111-8111-111111111111";
  const holder={id:"plural:ak:11111111-1111-4111-8111-111111111111",personId:native,nativeIds:{"ocd-person":[native]},level:"STATE" as const,
    profileUrls:["https://ballotpedia.org/Carl_Gatto"],
    provenance:{sourceUrl:"https://example.gov/member/1",sourceOrg:"State legislature",collectedAt:at,verifiedAt:at}};
  const input={...source(datasets[0],ak),people:[holder]};
  const store=new MemoryRoutineDataStore(),published=await publishBulkCandidate(store,input,at);
  assert.ok(published.outcome.promoted,JSON.stringify(published.outcome.candidate.receipt));
  const read=await readBulkProjection(billScope(datasets[0].session_id),{store,now:at,bypassCache:true});
  assert.equal(read.kind,"PROMOTED");
  if(read.kind!=="PROMOTED"||read.value.kind!=="SESSION") return;
  assert.equal(billsForPerson(read.value.bills,holder).length,2);
  assert.equal(read.value.bills[0].sponsors[0].officeholderId,holder.id);
  assert.equal(normalizeSession(datasets[0],ak,at,[holder,{...holder,id:"ambiguous",personId:"ocd-person/22222222-2222-4222-8222-222222222222",nativeIds:{}}]).counts.joined,0);
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
    return Response.json({status:"OK",dataset:{...dataset,mime_type:"application/zip",zip:archive.toString("base64")}});
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
  const failed=await recordRegisteredSourceAcquisitionFailure({store,contractId:"legiscan-bulk",failure:sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE","LegiScan HTTP 403"),attemptedAt:later});
  assert.equal(failed.outcome.candidate.state,"SOURCE_BLOCKED");assert.equal(failed.outcome.promoted,null);
  assert.equal((await store.readPromotion("STATE_BILL",LEGISCAN_BULK_SCOPE))?.versionId,held?.versionId);
});
test("later publisher editions promote when the archive hash sorts before the held hash",async()=>{
  const store=new MemoryRoutineDataStore();
  for(const [i,dataset_hash] of ["ffffffffffffffffffffffffffffffff","00000000000000000000000000000000"].entries()) {
    const now=i?later:at,dataset={...datasets[0],dataset_hash,dataset_date:i?"2013-01-06":"2012-12-30"};
    const index=[(({access_key:_access,...row})=>row)(dataset)];
    const marker=await publishBulkCandidate(store,{capture:capture(JSON.stringify({status:"OK",datasetlist:index}),now,"getDatasetList"),datasets:[dataset]},now);
    assert.ok(marker.outcome.promoted,JSON.stringify(marker.outcome.candidate.receipt));
    const input=source(dataset,ak);input.capture.retrievedAt=now;
    const published=await publishBulkCandidate(store,input,now);
    assert.ok(published.outcome.promoted,JSON.stringify(published.outcome.candidate.receipt));
    assert.equal(published.candidate.temporal.version,dataset.dataset_date);
  }
  const read=await readBulkProjection(billScope(datasets[0].session_id),{store,now:later,bypassCache:true});
  assert.equal(read.kind,"PROMOTED");
  if(read.kind==="PROMOTED"&&read.value.kind==="SESSION") assert.equal(read.value.dataset.dataset_hash,"00000000000000000000000000000000");
});
