import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { peopleSourceProbe, probePeopleSource, reuseProbedPeopleSources } from "../lib/civic-data/people-source-probe.ts";
import { sourceContentHash } from "../lib/civic-data/source-hash.ts";
import { sourceAuthority } from "../lib/civic-data/source-authority.ts";
import type { RoutineDataStore, SourceHead } from "../lib/civic-data/store.ts";
import type { KnownRelease } from "../lib/sources/known-release.ts";
import type { OfficeholderSet } from "../lib/officials/types.ts";
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";

const at = "2026-10-01T00:00:00.000Z", later = "2026-10-01T01:00:00.000Z";
const url = "https://legislature.example.gov/members", body = "<h1>Member One — State Senator</h1>";
const roster: OfficeholderSet = {scope:"US-AZ",generatedAt:at,officeholders:[],divisions:[],unmatched:[]};
const pages = [{requestedUrl:url,finalUrl:url,httpStatus:200,retrievedAt:at,body}];
const input = {sourceId:"official-state-people",state:"az",roster,acquisitions:pages,gaps:[],dependencies:{input:["cv-upstream","a".repeat(64),"b".repeat(64),"p"] as const},now:at,complete:true};
function release(text = body): KnownRelease {
  return {sourceId:input.sourceId,releaseId:"probe",bytes:Buffer.from(text),sha256:createHash("sha256").update(text).digest("hex"),
    requestedUrl:url,finalUrl:url,httpStatus:200,retrievedAt:later,sourceObservedAt:later,checkedAt:later,lastCheckStatus:200,
    etag:null,lastModified:null,contentType:"text/html",reused:false};
}

test("a complete dependent source probes every saved discovery page and confirms without a held roster", async () => {
  const plan = peopleSourceProbe(input), reads:string[] = [];
  const head: SourceHead = {sourceId:input.sourceId,recordClass:"STATE_LEGISLATOR",scope:"US-AZ:people:official-state-people:v1",
    versionId:"cv-one",lastKnownGoodVersionId:"cv-one",rawHash:sourceContentHash(pages,{normalizationInputHash:plan.normalizationInputHash}),rawHashBasis:"SOURCE_CONTENT_V1",
    normalizedHash:"b".repeat(64),parserVersion:sourceAuthority(input.sourceId)!.parserVersion,promotedAt:at,
    candidateState:"PROMOTED",acquisitionSucceeded:true,imported:false};
  const store = {readSourceHead:async()=>head,readCandidatePath:async(_id:string,path:string[])=>{
    reads.push(path.join("."));assert.deepEqual(path,["normalizedPayload","sourceProbe"]);return plan;
  },confirmUnchanged:async()=>({kind:"CONFIRMED",versionId:head.versionId,at:later})} as unknown as RoutineDataStore;
  let fetched = 0;
  const probe = (changes:Partial<Parameters<typeof probePeopleSource>[0]> = {}) => probePeopleSource({store,state:input.state,sourceId:input.sourceId,
    now:later,signal:new AbortController().signal,dependencies:input.dependencies,maxSourceAgeMs:3_600_000,acquire:async()=>{fetched++;return release();},...changes});
  assert.ok((await probe()).confirmed);assert.equal(fetched,plan.requests.length);assert.deepEqual(reads,["normalizedPayload.sourceProbe"]);
  assert.equal((await probe({dependencies:{}})).confirmed,null);assert.equal(fetched,1,"changed upstream people are parsed normally before another probe");
});

test("an incomplete parse or reached term boundary resumes acquisition rather than confirming the same bytes", async () => {
  const plan = peopleSourceProbe({...input,complete:false});
  const store = {readSourceHead:async()=>({versionId:"cv-one",rawHashBasis:"SOURCE_CONTENT_V1",candidateState:"PROMOTED",imported:false}),readCandidatePath:async()=>plan} as unknown as RoutineDataStore;
  const probe = () => probePeopleSource({store,state:input.state,sourceId:input.sourceId,now:later,signal:new AbortController().signal,
    dependencies:input.dependencies,acquire:async()=>{throw new Error("incomplete work must acquire normally");}});
  assert.equal((await probe()).confirmed,null);
  const crossed = {...peopleSourceProbe(input),nextTermAt:later};
  Object.assign(store,{readCandidatePath:async()=>crossed});
  assert.equal((await probe()).confirmed,null);
});

test("changed probe bytes feed the normal parser and run its validation before cache reuse", async () => {
  const fresh = release("new source bytes");let fallback = 0, validated = 0;
  const acquire = reuseProbedPeopleSources([{request:pages[0],release:fresh}],async()=>{fallback++;return release("fallback");});
  const parsed = await acquire({sourceId:input.sourceId,releaseId:"normal-parser",url,parserVersion:"p",signal:new AbortController().signal,maxBytes:100,
    checkAfterMs:100,validate:bytes=>{validated++;assert.equal(Buffer.from(bytes).toString(),"new source bytes");}});
  assert.equal(parsed.releaseId,"normal-parser");assert.equal(parsed.sha256,fresh.sha256);assert.equal(validated,1);assert.equal(fallback,0);
});

test("a deadline resumes unchecked requests and retains the original provider times for whole-source freshness", async()=>{
  const other="https://legislature.example.gov/members/two",otherBody="<h1>Member Two</h1>";
  const allPages=[...pages,{...pages[0],requestedUrl:other,finalUrl:other,body:otherBody}],plan=peopleSourceProbe({...input,acquisitions:allPages});
  const saved=new Map<string,string>(),checkpoint=new CivicReadCache({read:async key=>saved.get(key)??null,write:async(key,value)=>{saved.set(key,value);}});
  const after=new Date(Date.parse(later)+60_000).toISOString();let confirmedCheck:string|undefined;
  const head:SourceHead={sourceId:input.sourceId,recordClass:"STATE_LEGISLATOR",scope:"US-AZ:people:official-state-people:v1",versionId:"cv-one",lastKnownGoodVersionId:"cv-one",
    rawHash:sourceContentHash(allPages,{normalizationInputHash:plan.normalizationInputHash}),rawHashBasis:"SOURCE_CONTENT_V1",normalizedHash:"b".repeat(64),
    parserVersion:sourceAuthority(input.sourceId)!.parserVersion,promotedAt:at,candidateState:"PROMOTED",acquisitionSucceeded:true,imported:false};
  const store={readSourceHead:async()=>head,readCandidatePath:async()=>plan,confirmUnchanged:async(value:{retrieval:{sourceCheck?:{checkedAt:string}}})=>{
    confirmedCheck=value.retrieval.sourceCheck?.checkedAt;return {kind:"CONFIRMED",versionId:head.versionId,at:after};
  }} as unknown as RoutineDataStore;
  const signal=new AbortController();let reads:string[]=[];
  await assert.rejects(probePeopleSource({store,sourceId:input.sourceId,state:input.state,now:later,dependencies:input.dependencies,checkpoint,maxSourceAgeMs:3_600_000,signal:signal.signal,
    acquire:async request=>{reads.push(request.requestedUrl);if(request.requestedUrl===other){signal.abort(new Error("pass deadline"));throw signal.signal.reason;}return release();}}),/pass deadline/);
  assert.deepEqual(reads,[url,other]);reads=[];
  const resumed=await probePeopleSource({store,sourceId:input.sourceId,state:input.state,now:after,dependencies:input.dependencies,checkpoint,maxSourceAgeMs:3_600_000,signal:new AbortController().signal,
    acquire:async request=>{reads.push(request.requestedUrl);return {...release(otherBody),requestedUrl:other,finalUrl:other,checkedAt:after,retrievedAt:after,sourceObservedAt:after};}});
  assert.ok(resumed.confirmed);assert.deepEqual(reads,[other]);assert.equal(confirmedCheck,later,"finishing later cannot freshen an earlier checked page");
});
