import assert from "node:assert/strict";
import test from "node:test";
import { freezeDurableJson } from "../lib/civic-data/durable-json.ts";
import { manualProjectionCandidate } from "../lib/civic-data/manual-projections.ts";
import { immutableStateCandidate, statePublicationScope, withStateRecordHashes } from "../lib/civic-data/state-publication.ts";
import { VALIDATION_CHECKS, type RoutineCandidate, type ValidationReceipt } from "../lib/civic-data/types.ts";
import { manualSourceUrls } from "../lib/civic-data/manual-source-urls.ts";
import { readMemberOfficeStateProjection } from "../lib/civic-data/curated-reader-read-model.ts";
import { memberOfficeStateScope } from "../lib/officials/member-office-data.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { withMigratedRoutineStore } from "./helpers/migrated-routine-store.ts";

const at="2026-10-01T00:00:00.000Z", later="2026-10-02T00:00:00.000Z", sha="a".repeat(40);
const archive=`https://codeload.github.com/openstates/people/zip/${sha}`;
const url=(state:string)=>`https://raw.githubusercontent.com/openstates/people/${sha}/data/${state}/legislature/one.yml`;
const office=(state:string,phone="555-1000")=>({id:`member-office:plural:${state}:one:capitol`,kind:"MEMBER_OFFICE",officeholderId:`plural:${state}:one`,officeKind:"CAPITOL",
  office:{address:state==="tx"?"Unrelated Texas public office ".repeat(20_000):"Room 1, State Capitol",city:null,state:state.toUpperCase(),zip:null,phone,email:"office@example.gov",lat:null,lng:null},
  sourceUrl:url(state),sourceOrg:"Open States (Plural, CC-0)",official:false,collectedAt:at});
const source={requestedUrl:archive,finalUrl:archive,publisher:"Open States (Plural, CC-0)",sourceClass:"REFERENCE_PUBLISHER" as const,retrievedAt:at,httpStatus:200,
  rawHash:"b".repeat(64),extractedMembers:[{path:"data/ca/legislature/one.yml",sha256:"c".repeat(64)},{path:"data/tx/legislature/one.yml",sha256:"d".repeat(64)}],reviewedEvidence:"The exact archive and each extracted member are retained."};

test("legacy office rows and extracted-member evidence cut over one state at a time without national reads",async()=>{
  installFactReader(async()=>[]);
  try{await withMigratedRoutineStore("member-offices",async(store,_vault,pg)=>{
    const owned=store as unknown as {writeAuthority:Record<string,unknown>};owned.writeAuthority={...owned.writeAuthority,capability:"MANUAL_CONTRACT"};
    const admit=async(input:RoutineCandidate,base:string|null=null)=>{
      const candidate=statePublicationScope(input.scope)?withStateRecordHashes(immutableStateCandidate(input)):freezeDurableJson(input);
      const receipt:ValidationReceipt={contractVersion:2,candidateId:candidate.id,sourceId:candidate.sourceId,recordClass:candidate.recordClass,scope:candidate.scope,decision:"GOOD",validatedAt:candidate.retrieval.retrievedAt,
        checks:VALIDATION_CHECKS.map(check=>({check,verdict:"PASS",code:"MEMBER_OFFICE_SOURCE",detail:"Exact source fixture."})),excludedFacts:[]};
      await store.create({candidate,state:"FETCHED",acquisitionSucceeded:true,receipt:null,promotedVersion:null,lastKnownGoodVersion:base,failureCode:null,failureDetail:null},
        {candidateId:candidate.id,sequence:1,state:"FETCHED",at:candidate.retrieval.retrievedAt,detail:"Source acquired."});
      await store.transition(candidate.id,"NORMALIZED",candidate.retrieval.retrievedAt,"Source parsed.",undefined,undefined,{candidate});
      await store.transition(candidate.id,"VALIDATED",candidate.retrieval.retrievedAt,"Source verified.",receipt,undefined,{candidate});
      await store.promote(candidate.id,receipt,candidate.retrieval.retrievedAt,{candidate});
      return candidate;
    };
    const first=await admit(manualProjectionCandidate({contractId:"member-offices",version:at,sourceThrough:at,
      sourceReceipt:{contractVersion:1,reviewedAt:at,reviewedBy:"test",sources:[source]},payload:{kind:"member-offices",records:[office("ca"),office("tx")]}}));
    store.readCandidate=async()=>{throw new Error("whole candidate read");};
    store.readPromotion=async()=>{throw new Error("whole national package read");};
    const ca=await store.readMemberOfficeSlice("CA");
    assert.deepEqual(ca?.records,[office("ca")]);
    assert.ok(Buffer.byteLength(JSON.stringify(ca))<8_000,"one state's lookup excludes the other state's held record");
    assert.deepEqual(ca?.sources[0].extractedMembers,[source.extractedMembers[0]]);
    assert.ok(manualSourceUrls(ca!.sources[0]).includes(url("ca")));
    assert.ok(!manualSourceUrls(ca!.sources[0]).includes(url("tx")));
    const legacyRead=await readMemberOfficeStateProjection("CA",{store,now:at});
    assert.equal(legacyRead.kind,"BOOTSTRAP");
    assert.deepEqual(legacyRead.value?.records,[office("ca")]);
    const nextSha="f".repeat(40),nextArchive=`https://codeload.github.com/openstates/people/zip/${nextSha}`;
    const changed={...office("ca","555-2000"),collectedAt:later,sourceUrl:`https://raw.githubusercontent.com/openstates/people/${nextSha}/data/ca/legislature/one.yml`};
    const nextSource={...source,requestedUrl:nextArchive,finalUrl:nextArchive,retrievedAt:later,rawHash:"e".repeat(64),extractedMembers:[source.extractedMembers[0]]};
    const next=await admit(manualProjectionCandidate({contractId:"member-offices",version:later,sourceThrough:later,
      sourceReceipt:{contractVersion:1,reviewedAt:later,reviewedBy:"test",sources:[nextSource]},payload:{kind:"member-offices",state:"CA",records:[changed]}}));
    assert.equal(next.scope,memberOfficeStateScope("CA"));
    assert.deepEqual((await store.readMemberOfficeSlice("CA"))?.records,[changed]);
    assert.deepEqual((await store.readMemberOfficeSlice("TX"))?.records,[office("tx")]);
    assert.deepEqual(await store.readMemberOfficeMembers([changed.officeholderId]),[changed],"a global id sees the state successor once");
    const current=await readMemberOfficeStateProjection("CA",{store,now:later});
    assert.equal(current.kind,"PROMOTED");
    assert.equal(current.metadata.versionId,next.id);
    assert.deepEqual(current.value?.records,[changed]);
    assert.equal((await pg.query<{id:string}>("SELECT current_version_id AS id FROM civic_data_promotions WHERE scope='US:state-legislator-member-offices'")).rows[0].id,first.id,"the old edition stays immutable for states still using it");
  });}finally{installFactReader(undefined);}
});
