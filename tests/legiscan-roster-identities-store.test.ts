import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { withMigratedRoutineStore } from "./helpers/migrated-routine-store.ts";
import { publishStatePeople } from "../lib/civic-data/state-people-publication.ts";
import { normalize,yamlToPeople,indexDivisions } from "../lib/sources/plural/index.ts";
import { digest,profileUrl } from "../lib/sources/legiscan/dataset.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";

const at="2026-10-13T12:00:00.000Z",scope="US-TX:openstates-people:v1";
const url="https://raw.githubusercontent.com/openstates/people/main/data/tx/legislature/Alma-Allen-2fd6fcd3-9676-42a4-b879-e317576ff18f.yml";
const body=readFileSync(new URL("./fixtures/legiscan/openstates-alma-allen.yml",import.meta.url),"utf8");

test("production identity selectors keep current and immutable historical roster fields narrow across payload parts",async()=>{
  await withMigratedRoutineStore("openstates-people-tx",async(store,vault,pg)=>{
    const create=store.create.bind(store);
    store.create=async(record,event)=>{
      if(record.candidate.scope!==scope)return create(record,event);
      // Persist the source in its legal initial representation. Candidate source fields
      // become immutable at creation, so an UPDATE cannot manufacture a parts fixture.
      const plan=partitionCivicPayload({readModel:record.candidate.readModel},[],["readModel"]);
      for(const part of plan.parts)await pg.query("INSERT INTO civic_data_payload_parts(hash,payload)VALUES($1,$2::jsonb)ON CONFLICT(hash)DO NOTHING",[part.hash,JSON.stringify(part.payload)]);
      return create({...record,candidate:{...record.candidate,readModel:(plan.value as {readModel:unknown}).readModel}},event);
    };
    const roster=normalize(yamlToPeople(body,"tx",url,at),indexDivisions([]),at,"US-TX");
    const published=await publishStatePeople({store,vault,state:"tx",roster,releaseId:"fixture-historical-identity",now:at,
      acquisitions:[{requestedUrl:url,finalUrl:url,body,rawHash:digest(body),httpStatus:200,retrievedAt:at}]});
    assert.ok(published.outcome.promoted);
    const version=published.outcome.promoted.versionId;
    store.readPromotion=async()=>{throw Error("whole roster read");};store.readCandidate=async()=>{throw Error("whole candidate read");};
    const historical=await store.readHistoricalRosterIdentities(version);
    assert.ok(historical);assert.equal(historical.scope,scope);assert.equal(historical.jurisdiction,"US-TX");
    assert.equal(historical.officeholders.length,1);
    const person=historical.officeholders[0]!;
    assert.ok([person.websiteUrl,...person.profileUrls??[]].some(url=>profileUrl(url)==="https://house.texas.gov/members/2100"));
    assert.equal(person.provenance.sourceUrl,url);
    assert.ok(!("offices"in person)&&!("fieldSources"in person)&&!("name"in person));
    assert.deepEqual(Object.keys(person.provenance),["sourceUrl"]);
    const current=await store.readSlimRosters("STATE_LEGISLATOR",[scope]);
    assert.equal(current[0]?.versionId,version);assert.equal(current[0]?.roster.officeholders.length,1);
    assert.equal(current[0]?.roster.officeholders[0]?.offices,undefined);
    await assert.rejects(pg.query("UPDATE civic_data_candidates SET validation_receipt=jsonb_set(validation_receipt,'{sourceId}','\"other-source\"'::jsonb)WHERE id=$1",[version]),
      (error:unknown)=>{const failure=error as {code?:string;message?:string};return failure.code==="23514"&&
        failure.message==="civic_data_candidates disposition transition PROMOTED -> PROMOTED is forbidden";},
      "the existing disposition trigger rejects rewriting a published receipt");
    assert.deepEqual(await store.readHistoricalRosterIdentities(version),historical,"the refused mutation cannot change native identity evidence");
    const unpromoted={...published.candidate,id:`cv-${digest("unpromoted historical identity fixture").slice(0,32)}`};
    await store.create({candidate:unpromoted,state:"FETCHED",acquisitionSucceeded:true,receipt:null,promotedVersion:null,
      lastKnownGoodVersion:version,failureCode:null,failureDetail:null},{candidateId:unpromoted.id,sequence:1,state:"FETCHED",at,detail:"Captured native source before its independent validation."});
    assert.equal(await store.readHistoricalRosterIdentities(unpromoted.id),null,"captured source identity rows cannot pose as independently GOOD historical identities");
  });
});
