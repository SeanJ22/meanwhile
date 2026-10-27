import test from "node:test";
import assert from "node:assert/strict";
import { publishManualProjectionPackage } from "../lib/civic-data/manual-package-publication.ts";
import { manualPackageInputDigest } from "../lib/civic-data/manual-package-replay.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { ManualProjectionPackage,CuratedReaderProjection } from "../lib/civic-data/manual-projections.ts";

const firstAt="2026-10-20T12:00:00.000Z",later="2026-10-20T13:00:00.000Z",replayAt="2026-10-21T12:00:00.000Z";
function input(at=firstAt,onlyFirst=false):ManualProjectionPackage {
  const urls=["https://one.example.gov/venue","https://two.example.gov/venue"];
  const sources=urls.map((url,index)=>({requestedUrl:url,finalUrl:url,publisher:`Official source ${index+1}`,sourceClass:"OFFICIAL_PUBLISHER" as const,
    retrievedAt:at,httpStatus:200,rawHash:(index?"2":at===firstAt?"1":"3").repeat(64),reviewedEvidence:"Exact public body address and official map coordinates were reviewed."}));
  const records=urls.map((url,index)=>({id:`venue:replay:${index+1}`,sourceId:`source-${index}`,bodyOcdId:`ocd-division/country:us/state:az/place:test-${index+1}`,
    match:`${index+1} Main St`,name:`Room ${at}-${index}`,address:`${index+1} Main St, Test, AZ 85000`,lat:32+index/10,lng:-110-index/10,
    addressSourceUrl:url,coordinateSourceUrl:url,verifiedAt:at}));
  return {contractId:"venue-resolutions",version:at,sourceThrough:at,sourceReceipt:{contractVersion:1,reviewedAt:at,reviewedBy:"package-replay-test",
    sources:onlyFirst?sources.slice(0,1):sources},payload:{kind:"venue-resolutions",records:onlyFirst?records.slice(0,1):records}};
}
function denyHeldReads(store:MemoryRoutineDataStore){
  store.readPromotion=async()=>{throw Error("replay held payload read");};
  store.readCandidate=async()=>{throw Error("replay held candidate/history read");};
  store.readCandidateProof=async()=>{throw Error("replay proof body read");};
  store.readPublishedCandidateMetadata=async()=>{throw Error("replay source receipt array read");};
  store.events=async()=>{throw Error("replay event history read");};
  store.appendEvidence=async()=>{throw Error("replay must not append a source freshness event");};
}

test("an exact reviewed package replay reads scalar source/proof/input metadata and leaves every source date and event unchanged",async()=>{
  const store=new MemoryRoutineDataStore(),pack=input(),first=await publishManualProjectionPackage(pack,store,firstAt);
  assert.ok(first.publication?.outcome.promoted,JSON.stringify(first.publication?.outcome.candidate.receipt));
  const id=first.publication.candidate.id,read=store.readCandidate.bind(store),events=store.events.bind(store);
  const before=await read(id),history=await events(id);
  assert.equal(before?.candidate.normalization.sourceInputDigest,manualPackageInputDigest(pack.contractId,pack));
  assert.equal((await store.readSourceHead("CURATED_READER_RECORD",first.publication.candidate.scope))?.proofCoupled,true);
  denyHeldReads(store);
  const replay=await publishManualProjectionPackage(pack,store,replayAt);
  assert.equal(replay.publication,null);assert.equal(replay.replay?.versionId,id);
  assert.deepEqual(await events(id),history);
  assert.deepEqual((await read(id))?.candidate,before?.candidate,"no date, receipt or published fact is restamped");
});

test("a partial package retains independent prior source facts and can replay without reloading those facts",async()=>{
  const store=new MemoryRoutineDataStore(),first=await publishManualProjectionPackage(input(),store,firstAt);
  assert.ok(first.publication?.outcome.promoted);
  const pack=input(later,true),next=await publishManualProjectionPackage(pack,store,later);
  assert.ok(next.publication?.outcome.promoted,JSON.stringify(next.publication?.outcome.candidate.receipt));
  const before=first.publication.candidate.readModel as CuratedReaderProjection,after=next.publication.candidate.readModel as CuratedReaderProjection;
  assert.equal(after.records.length,2);assert.deepEqual(after.records.find(row=>row.id===before.records[1].id),before.records[1]);
  assert.equal(next.publication.candidate.retrieval.complete,false,"a source-isolated partial update does not claim a whole-source acquisition");
  const id=next.publication.candidate.id;denyHeldReads(store);
  const replay=await publishManualProjectionPackage(pack,store,replayAt);
  assert.equal(replay.publication,null);assert.equal(replay.replay?.versionId,id);
  const payload=pack.payload as CuratedReaderProjection,changed:ManualProjectionPackage={...pack,payload:{...payload,
    records:payload.records.map((row,index)=>index?row:{...row,name:"A revised reviewed room"})}};
  await assert.rejects(publishManualProjectionPackage(changed,store,replayAt),/replay held|MANUAL_PROMOTION_BASE_UNAVAILABLE/,
    "changed package content must return to the real successor merge even when its remote source hashes match");
});
