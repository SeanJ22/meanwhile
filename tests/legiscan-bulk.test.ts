import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { zip } from "../scripts/xlsx.mjs";
import { normalizeSession,hydrateBillPart,parseDatasetList,billScope,LEGISCAN_BULK_SCOPE,joinSponsors,stateOfDataset,type Dataset } from "../lib/sources/legiscan/bills.ts";
import { bulkCandidate,publishBulkCandidate,LEGISCAN_PART_ROWS } from "../lib/sources/legiscan/publication.ts";
import { readBulkProjection,readBillsForState,billsForPerson } from "../lib/sources/legiscan/reader.ts";
import { refreshLegiscan,bulkDatasetOrder } from "../scripts/legiscan-bulk.mts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { legiscanBillEvidence } from "../lib/ask/legiscan-bills.ts";
import { recordRegisteredSourceAcquisitionFailure,sourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-failure.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { normalizedHash } from "../lib/civic-data/candidate-builders.ts";
import { feedDoorDrafts } from "../lib/doors/seed-feeds.ts";
import { readerRoute } from "../lib/api/reader-route.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { civicRecordsFor } from "../lib/civic-data/changes.ts";

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
  return {capture:capture(JSON.stringify({dataset:publicDataset,archiveHash:hash(bodies.join("")),memberHashes:bodies.map(hash)})),dataset,bodies,people:[person],archiveHash:hash(bodies.join(""))};
}
test("real source fixtures retain every bill, committee sponsor, status date and text publication",()=>{
  const alaska=normalizeSession(datasets[0],ak,at,[person]),arkansas=normalizeSession(datasets[1],ar,at,[person]);
  const alaskaBills=hydrateBillPart(alaska),arkansasBills=hydrateBillPart(arkansas);
  assert.deepEqual(alaska.counts,{rows:2,joined:2,unjoined:0,sponsorsJoined:2,sponsorsUnjoined:6});
  assert.equal(alaska.bills[0].fips,"02"); assert.equal(alaska.bills[0].ocdId,"ocd-division/country:us/state:ak");
  assert.equal(alaska.bills[0].statusDate,"2011-04-11");assert.equal(alaska.bills[0].texts.length,3);
  assert.equal(alaskaBills[0].facts.status.publishedAt,"2012-12-30");assert.equal(alaskaBills[0].facts["text:153588"].publishedAt,"2011-01-18");
  assert.equal(alaskaBills[0].facts["text:153588"].sourceUrl,alaskaBills[0].texts[0].url);
  assert.equal(arkansasBills[0].sponsors[0].name,"Joint Budget Committee");
  assert.equal(arkansasBills[0].sponsors[0].joinReason,"Committee sponsor"); assert.equal(arkansas.counts.unjoined,1);
  assert.equal(normalizeSession(datasets[0],ak,at,[]).bills.length,2);
  assert.deepEqual(billsForPerson(alaskaBills,person).map(row=>row.billId),[230084,230085]);
  const sponsor=alaskaBills[0].sponsors[0];
  assert.equal(joinSponsors([person,{...person,id:"other"}])(sponsor).officeholderId,null);
  assert.throws(()=>normalizeSession(datasets[1],ak,at),/SCOPE_MISMATCH/);
  assert.throws(()=>normalizeSession(datasets[0],[ak[0],ak[0]],at),/DUPLICATE_BILL/);
});
test("compact source parts retain ordered sponsors and exact provenance without repeated public facts",()=>{
  const part=normalizeSession(datasets[0],ak,at,[person]),bills=hydrateBillPart(part);
  assert.deepEqual(hydrateBillPart(part,person),billsForPerson(bills,person));
  assert.ok(part.sponsors.length<part.bills.reduce((sum,bill)=>sum+bill.sponsorRefs.length,0));
  assert.ok(part.bills.every(bill=>!("facts" in bill)&&!("sponsors" in bill)));
  for(const bill of bills){
    assert.equal(bill.facts.title.collectedAt,at);assert.equal(bill.facts.title.verifiedAt,at);
    assert.equal(bill.facts.title.sourceUrl,bill.sourceUrl);
    assert.deepEqual(bill.sponsors.map(row=>row.peopleId),JSON.parse(ak.find(body=>JSON.parse(body).bill.bill_id===bill.billId)!).bill.sponsors.map((row:{people_id:number})=>row.people_id));
  }
  const changed=structuredClone(part);changed.sponsors[0].name="Different saved source sponsor";
  assert.notDeepEqual(civicRecordsFor("STATE_BILL",changed),civicRecordsFor("STATE_BILL",part),"dictionary changes must remain material bill facts");
  const broken=structuredClone(part);broken.bills[0].sponsorRefs[0]=part.sponsors.length;
  assert.throws(()=>hydrateBillPart(broken),/SPONSOR_REFERENCE_INVALID/);
});
test("person filters preserve previously ambiguous and committee sponsors",()=>{
  const ambiguous=normalizeSession(datasets[0],ak,at,[person,{...person,id:"other-held-person"}]);
  assert.ok(ambiguous.sponsors.some(sponsor=>sponsor.joinReason==="Ambiguous source identifiers"));
  assert.deepEqual(hydrateBillPart(ambiguous,person),[]);
  assert.deepEqual(billsForPerson(hydrateBillPart(ambiguous),person),[]);
  const committee=normalizeSession(datasets[1],ar,at),committeePerson={id:"committee-is-not-a-person",nativeIds:{legiscan:[String(committee.sponsors[0].peopleId)]}};
  assert.deepEqual(hydrateBillPart(committee,committeePerson),[]);
  assert.deepEqual(billsForPerson(hydrateBillPart(committee),committeePerson),[]);
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
    assert.equal(session.bills[0].ocdId,state==="US"?"ocd-division/country:us":"ocd-division/country:us/district:dc");
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
  if(read.kind!=="PROMOTED"||read.value.kind!=="SESSION")throw Error("Session manifest was not published");
  const part=await readBulkProjection(read.value.parts[0].scope,{store,now:at,bypassCache:true});
  if(part.kind!=="PROMOTED"||part.value.kind!=="PART")throw Error("Bill part was not published");
  assert.equal(billsForPerson(hydrateBillPart(part.value),holder).length,2);
  assert.equal(hydrateBillPart(part.value)[0].sponsors[0].officeholderId,holder.id);
  assert.equal(normalizeSession(datasets[0],ak,at,[holder,{...holder,id:"ambiguous",personId:"ocd-person/22222222-2222-4222-8222-222222222222",nativeIds:{}}]).counts.joined,0);
  const inconsistent=JSON.parse(ak[1]);
  inconsistent.bill.sponsors[0].ballotpedia="Different_Person";
  const other={...holder,id:"plural:ak:22222222-2222-4222-8222-222222222222",personId:"ocd-person/22222222-2222-4222-8222-222222222222",
    nativeIds:{"ocd-person":["ocd-person/22222222-2222-4222-8222-222222222222"]},profileUrls:["https://ballotpedia.org/Different_Person"]};
  const ambiguous=normalizeSession(datasets[0],[ak[0],JSON.stringify(inconsistent)],at,[holder,other]);
  assert.ok(hydrateBillPart(ambiguous).every(bill=>bill.sponsors.filter(sponsor=>sponsor.peopleId===6033).every(sponsor=>sponsor.officeholderId===null)),
    "conflicting saved profiles for one session sponsor cannot bind it to two held people across bills");
});
test("real DC bill retains its native ID and reaches the canonical Council body in Ask",async()=>{
  const body=fixture("DC-B26-0008"),dataset={...catalog(body),dataset_date:"2026-10-18"},dcAt="2026-10-23T09:00:00.000Z";
  const input=source(dataset,[body]);input.capture.retrievedAt=dcAt;
  const store=new MemoryRoutineDataStore();
  const {access_key:_access,...publicDataset}=dataset;
  await publishBulkCandidate(store,{capture:capture(JSON.stringify({status:"OK",datasetlist:[publicDataset]}),dcAt,"getDatasetList"),datasets:[dataset]},dcAt);
  const published=await publishBulkCandidate(store,input,dcAt);assert.ok(published.outcome.promoted);
  const read=await readBillsForState("DC",{store,now:dcAt,bypassCache:true});
  assert.equal(read.bills[0].id,"legiscan:bill:1905130");assert.equal(read.bills[0].number,"B26-0008");
  assert.equal(read.bills[0].ocdId,"ocd-division/country:us/district:dc");assert.equal(read.bills[0].fips,"11");
  const ask=await legiscanBillEvidence({question:"What legislation is published by the Council?",states:["DC"],
    subject:{kind:"BODY",id:"ocd-division/country:us/district:dc#legislature",name:"Council of the District of Columbia"}},{store,now:dcAt,bypassCache:true});
  assert.equal(ask.denominators.legiscanBillsMatched,1);
  assert.equal(ask.records.find(row=>row.kind==="STATE_BILL")?.id,"legiscan:bill:1905130");
});
test("the normal readerRoute filters a selected member after proving each complete canonical part",async()=>{
  const other=JSON.parse(ak[1]);other.bill.bill_id+=1_000_000;other.bill.sponsors=other.bill.sponsors.filter((row:{people_id:number})=>row.people_id!==6033);
  const bodies=[...ak,JSON.stringify(other)],store=new MemoryRoutineDataStore(),input=source(datasets[0],bodies);
  const {access_key:_access,...dataset}=datasets[0];
  await publishBulkCandidate(store,{capture:capture(JSON.stringify({status:"OK",datasetlist:[dataset]}),at,"getDatasetList"),datasets:[datasets[0]]},at);
  await publishBulkCandidate(store,input,at);
  const requestedScopes:string[]=[];
  installReaderDatabaseQuery(async statements=>Promise.all(statements.map(async statement=>{
    assert.doesNotMatch(statement.text,/reader_place_payload/);
    const rows=[];
    for(const key of statement.params![0] as readonly string[]){
      const scope=key.slice("STATE_BILL:".length);requestedScopes.push(scope);
      const pointer=await store.readPromotion("STATE_BILL",scope);if(!pointer)continue;
      const saved=await store.readCandidate(pointer.versionId);assert.ok(saved);
      rows.push({row_kind:"promotion",key:pointer.key,record_class:pointer.recordClass,scope:pointer.scope,source_id:pointer.sourceId,
        current_version_id:pointer.versionId,last_known_good_version_id:pointer.lastKnownGoodVersionId,promoted_at:pointer.promotedAt,
        validation_receipt:pointer.receipt,payload:pointer.payload,normalized_hash:saved.candidate.normalization.normalizedHash,
        retrieved_at:saved.candidate.retrieval.retrievedAt,confirmation:null,published:true});
    }
    return structuredClone(rows);
  })));
  try{
    const route=readerRoute("/api/bills",async(_request:Request)=>{
      const read=await readBillsForState("AK",{now:at});assert.equal(read.bills.length,3);
      const selected=await readBillsForState("AK",{now:at,person});
      assert.deepEqual(selected.bills,billsForPerson(read.bills,person));
      return selected.bills;
    });
    const selected=await route(new Request(`https://example.org/api/bills?state=AK&member=${person.id}`));
    assert.deepEqual(selected.map(row=>row.billId),[230084,230085]);
    assert.ok(requestedScopes.some(scope=>scope.includes(":part:")));
  }finally{installReaderDatabaseQuery(undefined);}
});
test("LegiScan canonical part loading honors the existing edge-only database refusal",async()=>{
  let databaseReads=0;installReaderDatabaseQuery(async()=>{databaseReads++;return [[]];});
  try{
    await assert.rejects(withReaderAuthorityEdge({edgeOnly:true},()=>readBillsForState("AK")),/never reads the database/);
    assert.equal(databaseReads,0);
  }finally{installReaderDatabaseQuery(undefined);}
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
    assert.equal(Object.hasOwn(published.candidate.normalizedPayload as object,"bodies"),false,"exact bill bytes are saved once in capture.body");
  }
  assert.equal((await readBillsForState("AK",{store,now:at,bypassCache:true})).bills.length,2);
  assert.equal((await readBillsForState("AR",{store,now:at,bypassCache:true})).bills.length,1);
  const evidence=await legiscanBillEvidence({question:"Which bills did Carl Gatto sponsor?",states:["AK"],subject:{kind:"PERSON",id:person.id,name:"Carl Gatto"},person},{store,now:at,bypassCache:true});
  assert.equal(evidence.denominators.legiscanBillsMatched,2);assert.equal(evidence.records.filter(row=>row.kind==="STATE_BILL").length,2);
  assert.ok(evidence.records.every(row=>row.sourceUrl&&row.retrievedAt));
  const unresolved=await legiscanBillEvidence({question:"Which bills did Carl Gatto sponsor?",states:["AK"],subject:{kind:"PERSON",id:person.id,name:"Carl Gatto"}},{store,now:at,bypassCache:true});
  assert.equal(unresolved.records.length,0);assert.equal(unresolved.gaps.length,1);
  const {processRegisteredFanOutCandidate}=await import("../lib/civic-data/promotion.ts");
  const session=await store.readPromotion<import("../lib/sources/legiscan/bills.ts").BillSession>("STATE_BILL",billScope(datasets[0].session_id));
  assert.ok(session);const part=await store.readCandidate(session.payload.parts[0].versionId);assert.ok(part);
  const control=await processRegisteredFanOutCandidate(new MemoryRoutineDataStore(),"legiscan-bulk",structuredClone(part.candidate),at);
  assert.ok(control.promoted,"the original exact saved part remains admissible");
  const forged=structuredClone(part.candidate);(forged.readModel as {bills:{title:string}[]}).bills[0].title="Invented";
  (forged.normalization as {normalizedHash:string}).normalizedHash=normalizedHash(forged.readModel);
  const refused=await processRegisteredFanOutCandidate(new MemoryRoutineDataStore(),"legiscan-bulk",forged,at);
  assert.equal(refused.promoted,null);
  assert.match(JSON.stringify(refused.candidate.receipt),/SOURCE_SCOPED|projection|source/i);
  const forgedDictionary=structuredClone(part.candidate);
  (forgedDictionary.readModel as import("../lib/sources/legiscan/bills.ts").BillPart).sponsors[0].name="Invented sponsor";
  (forgedDictionary.normalization as {normalizedHash:string}).normalizedHash=normalizedHash(forgedDictionary.readModel);
  const dictionaryRefused=await processRegisteredFanOutCandidate(new MemoryRoutineDataStore(),"legiscan-bulk",forgedDictionary,at);
  assert.equal(dictionaryRefused.promoted,null,"a re-hashed dictionary still has to match exact saved source sponsors");
  const changedSource=structuredClone(part.candidate),payload=changedSource.normalizedPayload as {capture:{body:string}};
  payload.capture.body=payload.capture.body.replace("Carl Gatto","Someone else");
  (changedSource.normalization as {normalizedPayloadHash:string}).normalizedPayloadHash=normalizedHash(payload);
  const sourceRefused=await processRegisteredFanOutCandidate(new MemoryRoutineDataStore(),"legiscan-bulk",changedSource,at);
  assert.equal(sourceRefused.promoted,null);assert.match(JSON.stringify(sourceRefused.candidate.receipt),/source|hash|projection/i);
  const readPromotion=store.readPromotion.bind(store);
  const corruptStore={...store,readCandidate:store.readCandidate.bind(store),readPublishedCandidateMetadata:store.readPublishedCandidateMetadata.bind(store),
    readPromotion:async<T>(recordClass:Parameters<MemoryRoutineDataStore["readPromotion"]>[0],scope:string)=>{
      const held=await readPromotion<T>(recordClass,scope);
      if(held&&scope===session.payload.parts[0].scope){const value=structuredClone(held.payload) as {bills:{title:string}[]};value.bills[0].title="Corrupt stored title";return {...held,payload:value as T};}
      return held;
    }};
  const corrupt=await readBulkProjection(session.payload.parts[0].scope,{store:corruptStore,now:at,bypassCache:true});
  assert.equal(corrupt.kind,"STORE_UNREACHABLE","the normal reader still enforces its canonical read-model hash");
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
test("a bounded pass publishes each state's current session before history and resumes every older session",async()=>{
  const oldAk={...datasets[0],session_id:datasets[0].session_id-1,dataset_hash:"older-alaska"};
  const oldAr={...datasets[1],session_id:datasets[1].session_id-1,dataset_hash:"older-arkansas"};
  const grouped=[datasets[0],oldAk,datasets[1],oldAr];
  assert.deepEqual(bulkDatasetOrder(grouped).map(row=>row.session_id),[datasets[0].session_id,datasets[1].session_id,oldAk.session_id,oldAr.session_id]);
  const bodies=new Map(grouped.map((dataset,index)=>[dataset.session_id,(dataset.state_id===2?ak:ar).map(body=>{
    const value=JSON.parse(body);value.bill.session_id=dataset.session_id;value.bill.bill_id+=index*1_000_000;return JSON.stringify(value);
  })]));
  const store=new MemoryRoutineDataStore(),calls:number[]=[],controller=new AbortController();let count=0,now=at;
  const fetchImpl:typeof fetch=async value=>{
    const url=new URL(String(value));
    if(url.searchParams.get("op")==="getDatasetList")return Response.json({status:"OK",datasetlist:grouped});
    const id=Number(url.searchParams.get("id")),dataset=grouped.find(row=>row.session_id===id)!;calls.push(id);
    const archive=zip(bodies.get(id)!.map((body,index)=>({name:`${id}/bill/${index}.json`,data:Buffer.from(body)})),"2026-10-12");
    return Response.json({status:"OK",dataset:{...dataset,mime_type:"application/zip",zip:archive.toString("base64")}});
  };
  await assert.rejects(refreshLegiscan(store,controller.signal,{key:"fixture-key",fetchImpl,now:()=>now,peopleForState:async()=>{
    if(++count===2)controller.abort(Error("controlled source budget"));return [person];
  }}),/controlled source budget/);
  assert.deepEqual(calls,[datasets[0].session_id,datasets[1].session_id]);
  for(const dataset of [datasets[0],datasets[1]])assert.ok(await store.readPromotion("STATE_BILL",billScope(dataset.session_id)));
  now=later;
  const resumed=await refreshLegiscan(store,AbortSignal.timeout(10000),{key:"fixture-key",fetchImpl,now:()=>now,peopleForState:async()=>[person]});
  assert.deepEqual(calls,[datasets[0].session_id,datasets[1].session_id,oldAk.session_id,oldAr.session_id]);
  assert.equal(resumed.counts.AK.unchanged,1);assert.equal(resumed.counts.AR.unchanged,1);
  for(const dataset of grouped)assert.ok(await store.readPromotion("STATE_BILL",billScope(dataset.session_id)));
});
test("bounded parts preserve cross-bill ambiguity, reject a truncated archive inventory, and keep the serving session after an interrupted replacement",async()=>{
  class InterruptedStore extends MemoryRoutineDataStore {
    refuseSession=false;
    override async create(record:Parameters<MemoryRoutineDataStore["create"]>[0],event:Parameters<MemoryRoutineDataStore["create"]>[1]){
      if(this.refuseSession&&(record.candidate.readModel as {kind:string}).kind==="SESSION")throw Error("controlled manifest failure");
      return super.create(record,event);
    }
  }
  const bodies=Array.from({length:LEGISCAN_PART_ROWS+1},(_,index)=>{
    const bill=JSON.parse(ak[0]);bill.bill.bill_id+=index;
    if(index===LEGISCAN_PART_ROWS)bill.bill.sponsors[0].ballotpedia="Different_Person";
    return JSON.stringify(bill);
  });
  const holders=[1,2].map(index=>({id:`plural:ak:${index===1?"11111111-1111-4111-8111-111111111111":"22222222-2222-4222-8222-222222222222"}`,
    personId:`ocd-person/${index===1?"11111111-1111-4111-8111-111111111111":"22222222-2222-4222-8222-222222222222"}`,nativeIds:{},level:"STATE" as const,
    profileUrls:[`https://ballotpedia.org/${index===1?"Carl_Gatto":"Different_Person"}`],
    provenance:{sourceUrl:"https://example.gov/member/1",sourceOrg:"Legislature",collectedAt:at,verifiedAt:at}}));
  const store=new InterruptedStore(),input={...source(datasets[0],bodies),people:holders};
  const index=[(({access_key:_access,...row})=>row)(datasets[0])];
  await publishBulkCandidate(store,{capture:capture(JSON.stringify({status:"OK",datasetlist:index}),at,"getDatasetList"),datasets:[datasets[0]]},at);
  const published=await publishBulkCandidate(store,input,at);
  assert.ok(published.outcome.promoted);
  const session=published.candidate.readModel as import("../lib/sources/legiscan/bills.ts").BillSession;
  assert.ok(session.parts.length>=2);
  const read=await readBillsForState("AK",{store,now:at,bypassCache:true});
  assert.equal(read.bills.length,bodies.length);assert.equal(read.complete,true);
  assert.ok(read.bills.every(bill=>bill.sponsors.filter(sponsor=>sponsor.peopleId===6033).every(sponsor=>sponsor.officeholderId===null)));
  for(const pointer of session.parts){const held=await store.readCandidate(pointer.versionId);assert.ok(held);assert.ok(pointer.rows<=LEGISCAN_PART_ROWS);assert.equal(Object.hasOwn(held.candidate.normalizedPayload as object,"bodies"),false);}
  const manifestInput=structuredClone(published.candidate.normalizedPayload) as Parameters<typeof bulkCandidate>[0];
  const evidence=JSON.parse(manifestInput.capture.body),inventory=JSON.parse(evidence.parentCapture.body);
  inventory.memberHashes.pop();evidence.parentCapture.body=JSON.stringify(inventory);evidence.parentCapture.rawHash=hash(evidence.parentCapture.body);
  manifestInput.capture.body=JSON.stringify(evidence);manifestInput.capture.rawHash=hash(manifestInput.capture.body);manifestInput.capture.retrievedAt=later;
  const forged=bulkCandidate(manifestInput);
  const {processRegisteredFanOutCandidate}=await import("../lib/civic-data/promotion.ts");
  const refused=await processRegisteredFanOutCandidate(store,"legiscan-bulk",forged,later);
  assert.equal(refused.promoted,null);assert.match(JSON.stringify(refused.candidate.receipt),/source|archive|part/i);
  store.refuseSession=true;
  await assert.rejects(publishBulkCandidate(store,{...input,capture:{...input.capture,retrievedAt:later}},later),/controlled manifest failure/);
  const after=await readBillsForState("AK",{store,now:later,bypassCache:true});
  assert.deepEqual(after.bills.map(bill=>bill.id).sort(),read.bills.map(bill=>bill.id).sort());assert.equal(after.complete,true);
  assert.equal((await store.readPromotion("STATE_BILL",billScope(datasets[0].session_id)))?.versionId,published.candidate.id);
});
