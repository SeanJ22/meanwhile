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
import { routineTaskFromContract,routineTaskDue } from "../lib/civic-data/runner.ts";
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
test("Gonzales joins the official card by the source's full name and Senate district",()=>{
  const body=fixture("AZ-Gonzales-2026"),dataset=catalog(body);
  const holder={id:"az-legislature:2381",name:"Sally Ann Gonzales",state:"AZ",chamber:"upper",level:"STATE" as const,
    nativeIds:{"az-legislature":["2381"]},memberships:[{id:"senate20",personId:"az-legislature:2381",officeId:"US-AZ:upper:20",jurisdiction:"US-AZ",chamber:"upper",district:"20",sourceUrl:"https://www.azleg.gov/"}]};
  const part=normalizeSession(dataset,[body],at,[holder]),sponsor=part.sponsors.find(row=>row.peopleId===10704)!;
  assert.equal(sponsor.name,"Sally Gonzales");assert.equal(sponsor.fullName,"Sally Ann Gonzales");
  assert.equal(sponsor.officeholderId,holder.id);
  assert.equal(hydrateBillPart(part,holder).length,1);
  const {level:_level,...card}=holder;
  assert.equal(billsForPerson(hydrateBillPart(part),card).length,1,"the normal SeatHolder card omits level");
  for(const mismatch of [{state:"NM"},{chamber:"lower",memberships:holder.memberships.map(row=>({...row,chamber:"lower"}))},
    {memberships:holder.memberships.map(row=>({...row,district:"21"}))},{nativeIds:{legiscan:["99999"]}}]) {
    assert.equal(billsForPerson(hydrateBillPart(part),{...holder,...mismatch}).length,0,"do not guess across a conflicting native ID or seat");
  }
  const native={...holder,id:"legiscan:az:10704",name:"A different display name",nativeIds:{legiscan:["10704"]}};
  assert.equal(joinSponsors([holder,native])(sponsor).officeholderId,native.id,"LegiScan's own ID takes precedence over a fallback name");
  const ambiguous=normalizeSession(dataset,[body],at,[holder,{...holder,id:"different-person"}]);
  assert.equal(billsForPerson(hydrateBillPart(ambiguous),holder).length,0,"the reader cannot resolve a saved ambiguity from a one-person query");
});
test("name and district fallback covers every state and DC with punctuation and omitted middle names",()=>{
  for(let state_id=1;state_id<=51;state_id++){
    const dataset={...datasets[0],state_id},state=stateOfDataset(dataset),raw=JSON.parse(ak[0]);
    Object.assign(raw.bill,{state,state_id,url:`https://legiscan.com/${state}/bill/HB1/2026`});
    const sponsor=raw.bill.sponsors[0];
    Object.assign(sponsor,{name:"Jose Garcia",first_name:"José",middle_name:"Luis",last_name:"García",district:"SD-020",role_id:2});
    raw.bill.sponsors=[sponsor];
    const chamber=state==="DC"||state==="NE"?"legislature":"upper";
    const holder={id:`official:${state}:1`,name:"Jose Garcia",state,level:"STATE" as const,chamber,
      memberships:[{id:"20",personId:"official",officeId:"20",jurisdiction:`US-${state}`,chamber,district:"20",sourceUrl:"https://example.gov/"}]};
    const part=normalizeSession(dataset,[JSON.stringify(raw)],at,[holder]);
    assert.equal(part.sponsors[0].officeholderId,holder.id,state);
    assert.equal(hydrateBillPart(part,holder).length,1,state);
  }
});
test("a sponsor cannot bind to different names or districts across session parts",async()=>{
  const first=JSON.parse(ak[0]),second=structuredClone(first);second.bill.bill_id++;
  first.bill.sponsors=[first.bill.sponsors[0]];second.bill.sponsors=[{...first.bill.sponsors[0],name:"Another Person",first_name:"Another",middle_name:"",last_name:"Person",district:"HD-014"}];
  const holders=[{id:"one",name:"Carl Gatto",district:"13"},{id:"two",name:"Another Person",district:"14"}].map(row=>({
    id:row.id,name:row.name,state:"AK",level:"STATE" as const,chamber:"lower",memberships:[{id:row.id,personId:row.id,officeId:row.id,jurisdiction:"US-AK",chamber:"lower",district:row.district,sourceUrl:"https://example.gov/"}]}));
  const bodies=[JSON.stringify(first),JSON.stringify(second)];
  const {sessionSponsorEvidence}=await import("../lib/sources/legiscan/bills.ts");
  const part=normalizeSession(datasets[0],[bodies[0]],at,holders,sessionSponsorEvidence(bodies));
  assert.equal(part.sponsors[0].officeholderId,null);
  assert.equal(hydrateBillPart(part,holders[0]).length,0);
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
  const read=await readBulkProjection(billScope(datasets[0].session_id),{store,now:at});
  assert.equal(read.kind,"PROMOTED");
  if(read.kind!=="PROMOTED"||read.value.kind!=="SESSION")throw Error("Session manifest was not published");
  const part=await readBulkProjection(read.value.parts[0].scope,{store,now:at});
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
  const read=await readBillsForState("DC",{store,now:dcAt});
  assert.equal(read.bills[0].id,"legiscan:bill:1905130");assert.equal(read.bills[0].number,"B26-0008");
  assert.equal(read.bills[0].ocdId,"ocd-division/country:us/district:dc");assert.equal(read.bills[0].fips,"11");
  const ask=await legiscanBillEvidence({question:"What legislation is published by the Council?",states:["DC"],
    subject:{kind:"BODY",id:"ocd-division/country:us/district:dc#legislature",name:"Council of the District of Columbia"}},{store,now:dcAt});
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
  assert.equal((await readBillsForState("AK",{store,now:at})).bills.length,2);
  assert.equal((await readBillsForState("AR",{store,now:at})).bills.length,1);
  const evidence=await legiscanBillEvidence({question:"Which bills did Carl Gatto sponsor?",states:["AK"],subject:{kind:"PERSON",id:person.id,name:"Carl Gatto"},person},{store,now:at});
  assert.equal(evidence.denominators.legiscanBillsMatched,2);assert.equal(evidence.records.filter(row=>row.kind==="STATE_BILL").length,2);
  assert.ok(evidence.records.every(row=>row.sourceUrl&&row.retrievedAt));
  const unresolved=await legiscanBillEvidence({question:"Which bills did Carl Gatto sponsor?",states:["AK"],subject:{kind:"PERSON",id:person.id,name:"Carl Gatto"}},{store,now:at});
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
  const corrupt=await readBulkProjection(session.payload.parts[0].scope,{store:corruptStore,now:at});
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
  assert.equal((await readBulkProjection(billScope(datasets[0].session_id),{store,now:later})).metadata.retrievedAt,later);
  const held=await store.readPromotion("STATE_BILL",LEGISCAN_BULK_SCOPE);
  const failed=await recordRegisteredSourceAcquisitionFailure({store,contractId:"legiscan-bulk",failure:sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE","LegiScan HTTP 403"),attemptedAt:later});
  assert.equal(failed.outcome.candidate.state,"SOURCE_BLOCKED");assert.equal(failed.outcome.promoted,null);
  assert.equal((await store.readPromotion("STATE_BILL",LEGISCAN_BULK_SCOPE))?.versionId,held?.versionId);
});
test("a fresh index cannot postpone unfinished sessions for the weekly cadence",async()=>{
  const store=new MemoryRoutineDataStore(),index=datasets.map(({access_key:_access,...row})=>row);
  const marker=await publishBulkCandidate(store,{capture:capture(JSON.stringify({status:"OK",datasetlist:index}),at,"getDatasetList"),datasets},at);
  const current=datasets.map(row=>({...row,year_start:2026,year_end:2026}));let refuseArkansas=true;
  const task=routineTaskFromContract(requiredRoutineContract("legiscan-bulk"));
  const readClock=()=>store.clock("legiscan-bills","STATE_BILL",LEGISCAN_BULK_SCOPE,task.parserVersion);
  assert.equal((await readClock()).continuationPending,true,"an old index with no completed fan-out is still owed");
  assert.equal(routineTaskDue(task,await readClock(),Date.parse(at)+5*60_000),true);
  const fetchImpl:typeof fetch=async value=>{
    const url=new URL(String(value));if(url.searchParams.get("op")==="getDatasetList")return Response.json({status:"OK",datasetlist:current});
    const dataset=current.find(row=>row.session_id===Number(url.searchParams.get("id")))!;
    if(dataset.state_id===4&&refuseArkansas)return new Response("unavailable",{status:403});
    const bodies=dataset.state_id===2?ak:ar;
    const archive=zip(bodies.map((body,index)=>({name:`${dataset.session_id}/bill/${index}.json`,data:Buffer.from(body)})),"2026-10-12");
    return Response.json({status:"OK",dataset:{...dataset,mime_type:"application/zip",zip:archive.toString("base64")}});
  };
  await refreshLegiscan(store,AbortSignal.timeout(10000),{key:"fixture",fetchImpl,now:()=>later,peopleForState:async()=>[person]});
  assert.equal((await readClock()).continuationPending,true);
  assert.equal(routineTaskDue(task,await readClock(),Date.parse(later)+5*60_000),true,"unfinished states remain owed even after a fresh index");
  refuseArkansas=false;
  await refreshLegiscan(store,AbortSignal.timeout(10000),{key:"fixture",fetchImpl,now:()=>later,peopleForState:async()=>[person]});
  assert.equal((await readClock()).continuationPending,false);
  assert.equal(routineTaskDue(task,await readClock(),Date.parse(later)+5*60_000),false);
  assert.ok(marker.outcome.promoted);
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
  const read=await readBulkProjection(billScope(datasets[0].session_id),{store,now:later});
  assert.equal(read.kind,"PROMOTED");
  if(read.kind==="PROMOTED"&&read.value.kind==="SESSION") assert.equal(read.value.dataset.dataset_hash,"00000000000000000000000000000000");
});
test("a cycle reaches each current state, oldest checks first, and preserves serving history",async()=>{
  const oldAk={...datasets[0],session_id:datasets[0].session_id-1,dataset_hash:"older-alaska"};
  const oldAr={...datasets[1],session_id:datasets[1].session_id-1,dataset_hash:"older-arkansas"};
  const grouped=[datasets[0],oldAk,datasets[1],oldAr];
  assert.deepEqual(bulkDatasetOrder(grouped).map(row=>row.session_id),[datasets[0].session_id,datasets[1].session_id]);
  assert.deepEqual(bulkDatasetOrder(grouped,new Map([["AK",later],["AR",at]])).map(stateOfDataset),["AR","AK"]);
  assert.deepEqual(bulkDatasetOrder(grouped,new Map([["AK",at]])).map(stateOfDataset),["AR","AK"]);
  const bodies=new Map(grouped.map((dataset,index)=>[dataset.session_id,(dataset.state_id===2?ak:ar).map(body=>{
    const value=JSON.parse(body);value.bill.session_id=dataset.session_id;value.bill.bill_id+=index*1_000_000;return JSON.stringify(value);
  })]));
  const store=new MemoryRoutineDataStore(),calls:number[]=[];let now=at;
  for(const dataset of [oldAk,oldAr])await publishBulkCandidate(store,source(dataset,bodies.get(dataset.session_id)!),at);
  const fetchImpl:typeof fetch=async value=>{
    const url=new URL(String(value));
    if(url.searchParams.get("op")==="getDatasetList")return Response.json({status:"OK",datasetlist:grouped});
    const id=Number(url.searchParams.get("id")),dataset=grouped.find(row=>row.session_id===id)!;calls.push(id);
    const archive=zip(bodies.get(id)!.map((body,index)=>({name:`${id}/bill/${index}.json`,data:Buffer.from(body)})),"2026-10-12");
    return Response.json({status:"OK",dataset:{...dataset,mime_type:"application/zip",zip:archive.toString("base64")}});
  };
  await refreshLegiscan(store,AbortSignal.timeout(10000),{key:"fixture-key",fetchImpl,now:()=>now,peopleForState:async()=>[person]});
  assert.deepEqual(calls,[datasets[0].session_id,datasets[1].session_id]);
  for(const dataset of [datasets[0],datasets[1]])assert.ok(await store.readPromotion("STATE_BILL",billScope(dataset.session_id)));
  now=later;
  const resumed=await refreshLegiscan(store,AbortSignal.timeout(10000),{key:"fixture-key",fetchImpl,now:()=>now,peopleForState:async()=>[person]});
  assert.deepEqual(calls,[datasets[0].session_id,datasets[1].session_id]);
  assert.equal(resumed.counts.AK.unchanged,1);assert.equal(resumed.counts.AR.unchanged,1);
  for(const dataset of grouped)assert.ok(await store.readPromotion("STATE_BILL",billScope(dataset.session_id)));
  assert.equal((await readBillsForState("AK",{store,now:later})).bills.length,4);
});
test("publisher years select current regular and special sessions instead of the largest ID",async()=>{
  const regular={...datasets[0],state_id:23,session_id:2151,year_start:2025,year_end:2026,special:0};
  const oldSpecial={...regular,session_id:2217,year_end:2025,special:1};
  const currentSpecial={...regular,session_id:2265,year_start:2026,special:1};
  const future={...regular,session_id:2400,year_start:2027,year_end:2028,prefile:1};
  const catalog=[oldSpecial,regular,currentSpecial,future];
  assert.deepEqual(bulkDatasetOrder(catalog,undefined,at).map(row=>row.session_id),[2151,2265]);
  const parsed=parseDatasetList({status:"OK",datasetlist:catalog});assert.equal(parsed[0].year_end,2025);
  assert.throws(()=>parseDatasetList({status:"OK",datasetlist:[{...regular,year_end:2024}]}),/SESSION_YEARS_INVALID/);
  const calls:number[]=[],store=new MemoryRoutineDataStore();
  const fetchImpl:typeof fetch=async value=>{
    const url=new URL(String(value));
    if(url.searchParams.get("op")==="getDatasetList")return Response.json({status:"OK",datasetlist:catalog});
    const id=Number(url.searchParams.get("id")),dataset=catalog.find(row=>row.session_id===id)!;calls.push(id);
    const raw=JSON.parse(ak[0]);Object.assign(raw.bill,{state:"MN",state_id:23,session_id:id,bill_id:id,url:`https://legiscan.com/MN/bill/HB1/${id}`});
    const archive=zip([{name:`${id}/bill/HB1.json`,data:Buffer.from(JSON.stringify(raw))}],"2026-10-12");
    return Response.json({status:"OK",dataset:{...dataset,mime_type:"application/zip",zip:archive.toString("base64")}});
  };
  const result=await refreshLegiscan(store,AbortSignal.timeout(10000),{key:"fixture",fetchImpl,now:()=>at,peopleForState:async()=>[person]});
  assert.deepEqual(calls,[2151,2265]);assert.equal(result.counts.MN.datasets,2);assert.deepEqual(result.counts.MN.failures,[]);
  assert.equal((await readBillsForState("MN",{store,now:at})).bills.length,2);
});
test("a thousand-session catalog reaches every jurisdiction in one cycle despite an early state failure",async()=>{
  const catalog=Array.from({length:52},(_,state)=>Array.from({length:20},(_,age)=>({...datasets[0],state_id:state+1,session_id:10_000+state*20-age,dataset_hash:`state-${state}-age-${age}`}))).flat();
  const requested:number[]=[],store=new MemoryRoutineDataStore();
  const fetchImpl:typeof fetch=async value=>{
    const url=new URL(String(value));
    if(url.searchParams.get("op")==="getDatasetList")return Response.json({status:"OK",datasetlist:catalog});
    const id=Number(url.searchParams.get("id")),dataset=catalog.find(row=>row.session_id===id)!;
    requested.push(dataset.state_id);
    if(dataset.state_id===1)return new Response("unavailable",{status:403});
    const raw=JSON.parse(ak[0]),state=stateOfDataset(dataset);
    Object.assign(raw.bill,{bill_id:id,state,state_id:dataset.state_id,session_id:id,url:`https://legiscan.com/${state}/bill/HB1/2026`});
    const archive=zip([{name:`${id}/bill/HB1.json`,data:Buffer.from(JSON.stringify(raw))}],"2026-10-12");
    return Response.json({status:"OK",dataset:{...dataset,mime_type:"application/zip",zip:archive.toString("base64")}});
  };
  const result=await refreshLegiscan(store,AbortSignal.timeout(15000),{key:"fixture",fetchImpl,now:()=>at,peopleForState:async()=>[]});
  assert.deepEqual([...requested].sort((a,b)=>a-b),Array.from({length:52},(_,i)=>i+1));
  assert.equal(result.counts.AL.failures.length,1);
  assert.equal(Object.values(result.counts).filter(row=>row.datasets===1).length,51);
});
test("an empty newer session cannot prevent the state's latest nonempty session from publishing",async()=>{
  const empty={...datasets[0],session_id:datasets[0].session_id+1,dataset_hash:"empty-prefile"},calls:number[]=[];
  const fetchImpl:typeof fetch=async value=>{
    const url=new URL(String(value));
    if(url.searchParams.get("op")==="getDatasetList")return Response.json({status:"OK",datasetlist:[empty,datasets[0]]});
    const id=Number(url.searchParams.get("id")),dataset=id===empty.session_id?empty:datasets[0];calls.push(id);
    const archive=zip(id===empty.session_id?[]:ak.map((body,index)=>({name:`${id}/bill/${index}.json`,data:Buffer.from(body)})),"2026-10-12");
    return Response.json({status:"OK",dataset:{...dataset,mime_type:"application/zip",zip:archive.toString("base64")}});
  };
  const store=new MemoryRoutineDataStore(),result=await refreshLegiscan(store,AbortSignal.timeout(10000),{key:"fixture",fetchImpl,now:()=>at,peopleForState:async()=>[person]});
  assert.deepEqual(calls,[empty.session_id,datasets[0].session_id]);
  assert.equal(result.counts.AK.datasets,1);assert.deepEqual(result.counts.AK.failures,[]);
  assert.equal((await readBillsForState("AK",{store,now:at})).bills.length,2);
});
test("an interrupted session reuses verified parts but recomputes changed sponsor joins",async()=>{
  class PartFailureStore extends MemoryRoutineDataStore {
    fail=true;createdParts=0;
    override async create(record:Parameters<MemoryRoutineDataStore["create"]>[0],event:Parameters<MemoryRoutineDataStore["create"]>[1]){
      if((record.candidate.readModel as {kind:string}).kind==="PART"){
        if(this.fail&&(record.candidate.normalizedPayload as {partIndex:number}).partIndex===2)throw Error("controlled part interruption");
        this.createdParts++;
      }
      return super.create(record,event);
    }
  }
  const bodies=Array.from({length:LEGISCAN_PART_ROWS*2+1},(_,index)=>{
    const raw=JSON.parse(ak[0]);raw.bill.bill_id+=index;return JSON.stringify(raw);
  });
  const store=new PartFailureStore(),input=source(datasets[0],bodies);
  const index=datasets.map(({access_key:_access,...row})=>row);
  await publishBulkCandidate(store,{capture:capture(JSON.stringify({status:"OK",datasetlist:index}),at,"getDatasetList"),datasets},at);
  await assert.rejects(publishBulkCandidate(store,input,at),/controlled part interruption/);
  assert.equal(store.createdParts,2);
  store.fail=false;
  const next={...input,capture:{...input.capture,retrievedAt:later}};
  const complete=await publishBulkCandidate(store,next,later);assert.ok(complete.outcome.promoted);
  assert.equal(store.createdParts,3,"only the unfinished part is newly published");
  assert.equal((await readBillsForState("AK",{store,now:later})).bills.length,bodies.length);
  const changed=await publishBulkCandidate(store,{...next,people:[]},later);
  assert.ok(changed.outcome.promoted);assert.equal(store.createdParts,6,"changed joins cannot reuse old sponsor assignments");
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
  const read=await readBillsForState("AK",{store,now:at});
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
  const revised=bodies.map((body,index)=>{const value=JSON.parse(body);if(index===0)value.bill.title="Publisher's revised title";return JSON.stringify(value);});
  const replacement={...source(datasets[0],revised),people:holders};replacement.capture.retrievedAt=later;
  await assert.rejects(publishBulkCandidate(store,replacement,later),/controlled manifest failure/);
  const after=await readBillsForState("AK",{store,now:later});
  assert.deepEqual(after.bills.map(bill=>bill.id).sort(),read.bills.map(bill=>bill.id).sort());assert.equal(after.complete,true);
  assert.equal((await store.readPromotion("STATE_BILL",billScope(datasets[0].session_id)))?.versionId,published.candidate.id);
});
test("parts saved with the whole held roster resume while it is unchanged and republish, never read whole, once it changes",async()=>{
  const {sessionSponsorEvidence}=await import("../lib/sources/legiscan/bills.ts");
  const {processRegisteredFanOutCandidate}=await import("../lib/civic-data/promotion.ts");
  const bodies=Array.from({length:LEGISCAN_PART_ROWS*2+1},(_,index)=>{const raw=JSON.parse(ak[0]);raw.bill.bill_id+=index;return JSON.stringify(raw);});
  const card={...person,level:"STATE" as const,state:"AK",offices:[{name:"capitol",address:"Room 410"}]};
  // The shape production saved before this change: every part embeds the whole held card.
  async function legacyParts(store:MemoryRoutineDataStore,input:ReturnType<typeof source>,roster:readonly object[]){
    const {access_key:_access,...dataset}=input.dataset,sessionSponsors=sessionSponsorEvidence(bodies),ids:string[]=[];
    for(const partIndex of [0,1]){
      const members=bodies.slice(partIndex*LEGISCAN_PART_ROWS,(partIndex+1)*LEGISCAN_PART_ROWS);
      const body=JSON.stringify({dataset,archiveHash:input.archiveHash,parentRawHash:input.capture.rawHash,partIndex,memberOffset:partIndex*LEGISCAN_PART_ROWS,bodies:members,sessionSponsors});
      const candidate=bulkCandidate({capture:{...input.capture,body,rawHash:hash(body)},dataset,bodies:members,people:roster as never,partIndex,archiveHash:input.archiveHash,sessionSponsors});
      assert.ok((await processRegisteredFanOutCandidate(store,"legiscan-bulk",candidate,at)).promoted);ids.push(candidate.id);
    }
    return new Set(ids);
  }
  class CountingStore extends MemoryRoutineDataStore {
    createdParts=0;legacy=new Set<string>();
    override async create(record:Parameters<MemoryRoutineDataStore["create"]>[0],event:Parameters<MemoryRoutineDataStore["create"]>[1]){
      if((record.candidate.readModel as {kind:string}).kind==="PART")this.createdParts++;
      return super.create(record,event);
    }
    override async readCandidate(id:string){if(this.legacy.has(id))throw Error("whole legacy part read");return super.readCandidate(id);}
  }
  const index=datasets.map(({access_key:_access,...row})=>row);
  for(const edited of [false,true]){
    const store=new CountingStore(),input=source(datasets[0],bodies);
    await publishBulkCandidate(store,{capture:capture(JSON.stringify({status:"OK",datasetlist:index}),at,"getDatasetList"),datasets},at);
    store.legacy=await legacyParts(store,input,[card]);store.createdParts=0;
    const roster=edited?[{...card,offices:[{name:"capitol",address:"Room 500"}]}]:[card];
    const resumed=await publishBulkCandidate(store,{...input,people:roster,capture:{...input.capture,retrievedAt:later}},later);
    assert.ok(resumed.outcome.promoted,JSON.stringify(resumed.outcome.candidate.receipt?.checks.filter(check=>check.verdict!=="PASS")));
    const kept=(resumed.candidate.readModel as import("../lib/sources/legiscan/bills.ts").BillSession).parts.filter(part=>store.legacy.has(part.versionId)).length;
    assert.deepEqual({kept,created:store.createdParts},edited?{kept:0,created:3}:{kept:2,created:1});
    assert.equal((await readBillsForState("AK",{store,now:later})).bills.length,bodies.length);
  }
});
