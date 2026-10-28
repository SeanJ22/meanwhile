import test from "node:test";
import assert from "node:assert/strict";
import { operationalReferenceSourceProbe,operationalReferenceSourceHash,confirmOperationalReferenceSources,
  OPERATIONAL_REFERENCE_RECORD_CLASS,JURISDICTION_REFERENCE_SOURCE_ID,JURISDICTION_REFERENCE_SCOPE,JURISDICTION_REFERENCE_STATES,JURISDICTION_REFERENCE_PARSER_VERSION } from "../lib/civic-data/operational-references.ts";
import { JURISDICTION_REFERENCE_HTTP_SOURCES,type JurisdictionReferenceSourceReceipt } from "../lib/civic-data/jurisdiction-reference-acquisition.ts";
import type { RoutineDataStore,SourceHead } from "../lib/civic-data/store.ts";

const at="2026-10-20T12:00:00.000Z",later="2026-10-20T13:00:00.000Z";
const receipts:JurisdictionReferenceSourceReceipt[]=JURISDICTION_REFERENCE_HTTP_SOURCES.map((source,index)=>({sourceId:source.id,
  requestedUrl:source.url,finalUrl:source.url,httpStatus:200,rawHash:(index?"b":"a").repeat(64),byteCount:100+index,retrievedAt:at}));
const probe=()=>operationalReferenceSourceProbe({sourceReceipts:receipts,configurationHash:"c".repeat(64),states:JURISDICTION_REFERENCE_STATES,corrections:[]});

test("operational reference hashes all exact publisher bytes and reviewed configuration without observation churn",()=>{
  const original=probe(),rawHash=operationalReferenceSourceHash(receipts,original);
  assert.equal(original.complete,true);
  assert.equal(rawHash,operationalReferenceSourceHash([...receipts].reverse().map(receipt=>({...receipt,retrievedAt:later})),original));
  assert.notEqual(rawHash,operationalReferenceSourceHash(receipts,{...original,configurationHash:"d".repeat(64)}));
  assert.notEqual(rawHash,operationalReferenceSourceHash(receipts.map((receipt,index)=>index?receipt:{...receipt,rawHash:"e".repeat(64)}),original));
  assert.equal(operationalReferenceSourceProbe({sourceReceipts:receipts.slice(1),configurationHash:"c".repeat(64),states:JURISDICTION_REFERENCE_STATES,corrections:[]}).complete,false);
  assert.equal(operationalReferenceSourceProbe({sourceReceipts:receipts,configurationHash:"c".repeat(64),states:JURISDICTION_REFERENCE_STATES,
    corrections:[{jurisdictionId:"old-source",recorded:"https://old.gov",corrected:"https://new.gov",disposition:"APPLIED_ON_REVIEWED_EVIDENCE",detail:"not checked now"}]}).complete,false,
    "a retained independent correction cannot acquire whole-package freshness from other successful sources");
});

test("complete matching operational sources use scalar confirmation; partial source/state sets read no held payload and do not confirm",async()=>{
  const sourceProbe=probe(),rawHash=operationalReferenceSourceHash(receipts,sourceProbe);
  const head:SourceHead={sourceId:JURISDICTION_REFERENCE_SOURCE_ID,recordClass:OPERATIONAL_REFERENCE_RECORD_CLASS,scope:JURISDICTION_REFERENCE_SCOPE,
    versionId:"held-operational",lastKnownGoodVersionId:"held-operational",rawHash,rawHashBasis:"SOURCE_CONTENT_V1",normalizedHash:"f".repeat(64),
    parserVersion:JURISDICTION_REFERENCE_PARSER_VERSION,promotedAt:at,candidateState:"PROMOTED",acquisitionSucceeded:true,imported:false};
  let confirmed=0;
  const store={readSourceHead:async()=>head,confirmUnchanged:async(input:{retrieval:{retrievedAt:string}},observedAt:string)=>{
    confirmed++;assert.equal(input.retrieval.retrievedAt,at);return{kind:"CONFIRMED",at:observedAt,versionId:head.versionId};},
    readPromotion:async()=>{throw Error("held operational registry read");},readCandidate:async()=>{throw Error("held operational candidate/history read");}} as unknown as RoutineDataStore;
  assert.equal((await confirmOperationalReferenceSources({store,sourceReceipts:receipts,probe:sourceProbe,now:later}))?.head.versionId,head.versionId);
  assert.equal(await confirmOperationalReferenceSources({store,sourceReceipts:receipts,probe:{...sourceProbe,complete:false},now:later}),null);
  assert.equal(await confirmOperationalReferenceSources({store,sourceReceipts:receipts,probe:{...sourceProbe,states:["az"]},now:later}),null);
  assert.equal(confirmed,1);
});
