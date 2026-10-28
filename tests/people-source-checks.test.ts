import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { bindPeopleSourceHashes, recordPeopleSourceChecks, withPeopleSourceChecks } from "../lib/civic-data/people-source-checks.ts";
import type { RoutineDataStore, SourceHead } from "../lib/civic-data/store.ts";
import type { StatePeopleCapture } from "../lib/civic-data/state-people-publication.ts";
import type { RecordPublishedSourceCheck } from "../lib/civic-data/source-checks.ts";
import type { Provenance } from "../lib/sources/types.ts";
import { civicRecordFacts } from "../lib/civic-data/changes.ts";

const at="2026-10-01T00:00:00.000Z",old="2026-09-01T00:00:00.000Z",checked="2026-10-02T00:00:00.000Z";
const body="Member One; phone 555-1000",rawHash=createHash("sha256").update(body).digest("hex");
const head:SourceHead={sourceId:"plural-openstates",recordClass:"STATE_LEGISLATOR",scope:"US-AZ:openstates-people:v1",
  versionId:"cv-one",lastKnownGoodVersionId:"cv-one",rawHash:"f".repeat(64),rawHashBasis:"SOURCE_CONTENT_V1",normalizedHash:"b".repeat(64),
  parserVersion:"plural-roster/3",promotedAt:at,candidateState:"PROMOTED",acquisitionSucceeded:true,imported:false};
const capture=(sourceUrl:string,hash=rawHash,retrievedAt=at)=>({requestedUrl:sourceUrl,finalUrl:sourceUrl,httpStatus:200,retrievedAt,
  capture:{rawHash:hash}} as StatePeopleCapture);
const source=(sourceUrl:string,collectedAt=at):Provenance=>({sourceUrl,sourceOrg:"Source",collectedAt,verifiedAt:collectedAt});

test("only the exact originally captured body refreshes a person's Sources date",async()=>{
  const url="https://legislature.example.gov/members/one",shared=source(url),prior=source(url,old);
  const original={provenance:shared,fieldSources:{phone:shared,email:prior}},bound=bindPeopleSourceHashes(original,[capture(url),capture(url,"e".repeat(64),old)]);
  assert.equal(bound.provenance.rawHash,rawHash);assert.equal(bound.fieldSources.phone.rawHash,rawHash,"shared provenance references all retain the binding");
  const checks:RecordPublishedSourceCheck[]=[];
  const store={recordSourceCheck:async(value:RecordPublishedSourceCheck)=>{checks.push(value);return true;},
    readSourceChecks:async(_class:string,_scope:string,keys:string[])=>checks.filter(row=>keys.includes(row.sourceKey))} as unknown as RoutineDataStore;
  await recordPeopleSourceChecks({store,head,pages:[{requestedUrl:url,finalUrl:url,retrievedAt:at,body,
    sourceCheck:{requestedUrl:url,finalUrl:url,httpStatus:304,rawHash,checkedAt:checked}}]});
  assert.equal(checks[0].sourceHash,head.rawHash);assert.equal(checks[0].checkedAt,checked);
  const fresh=await withPeopleSourceChecks(bound,head.recordClass,head.scope,store);
  assert.equal(fresh.provenance.verifiedAt,checked);assert.equal(fresh.fieldSources.phone.verifiedAt,checked);
  assert.equal(fresh.fieldSources.email.verifiedAt,old,"a carried field from older bytes keeps its own check date");
  assert.equal(fresh.provenance.collectedAt,at);assert.equal(original.provenance.verifiedAt,at,"reading freshness never mutates the held record");
  assert.deepEqual(civicRecordFacts("STATE_LEGISLATOR",{key:"member:one",record:original}),
    civicRecordFacts("STATE_LEGISLATOR",{key:"member:one",record:fresh}),"source clock metadata is not a newly delivered civic fact");
});

test("the same Open States member bytes confirm an earlier pinned URL without refreshing another member",async()=>{
  const member="data/az/legislature/One.yml",previous=`https://raw.githubusercontent.com/openstates/people/${"a".repeat(40)}/${member}`;
  const current=`https://raw.githubusercontent.com/openstates/people/${"b".repeat(40)}/${member}`,archive=`https://codeload.github.com/openstates/people/zip/${"b".repeat(40)}`;
  const bound=bindPeopleSourceHashes({provenance:source(previous),other:source(previous.replace("One.yml","Two.yml"))},[capture(previous),capture(previous.replace("One.yml","Two.yml"))]);
  const checks:RecordPublishedSourceCheck[]=[];
  const store={recordSourceCheck:async(value:RecordPublishedSourceCheck)=>{checks.push(value);return true;},
    readSourceChecks:async()=>checks} as unknown as RoutineDataStore;
  await recordPeopleSourceChecks({store,head,pages:[{requestedUrl:archive,finalUrl:archive,retrievedAt:checked,body,
    extractedFrom:{requestedUrl:archive,finalUrl:archive,sha256:"c".repeat(64),member}}]});
  assert.ok(checks[0].sourceUrls.includes(current));
  const fresh=await withPeopleSourceChecks(bound,head.recordClass,head.scope,store);
  assert.equal(fresh.provenance.verifiedAt,checked);assert.equal(fresh.other.verifiedAt,at);
});
test("a provider redirect confirms exact fields that still cite its public requested address",async()=>{
  const requested="https://nces.ed.gov/ccd/native.csv",final="https://ies.ed.gov/native.csv",checks:RecordPublishedSourceCheck[]=[];
  const store={recordSourceCheck:async(value:RecordPublishedSourceCheck)=>{checks.push(value);return true;},
    readSourceChecks:async(_class:string,_scope:string,keys:string[])=>checks.filter(row=>keys.includes(row.sourceKey))} as unknown as RoutineDataStore;
  await recordPeopleSourceChecks({store,head,pages:[{requestedUrl:requested,finalUrl:final,retrievedAt:at,capture:{rawHash},
    sourceCheck:{requestedUrl:requested,finalUrl:final,httpStatus:304,rawHash,checkedAt:checked}}]});
  const value=await withPeopleSourceChecks({provenance:{...source(requested),rawHash}},head.recordClass,head.scope,store);
  assert.equal(value.provenance.verifiedAt,checked);assert.equal(checks.length,2);
});
