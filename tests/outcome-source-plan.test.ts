import assert from "node:assert/strict";
import test from "node:test";
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";
import type { RoutineDataStore, SourceHead } from "../lib/civic-data/store.ts";
import type { RecordPublishedSourceCheck } from "../lib/civic-data/source-checks.ts";
import { bindOutcomeSourceHashes, outcomeSourcePlanHash, probeOutcomeSourcePlan, recordOutcomeSourceChecks,
  withOutcomeSourceChecks, type OutcomeSourcePlan, type OutcomeSourceRequest } from "../lib/outcomes/source-plan.ts";
import type { OutcomeSnapshot } from "../lib/outcomes/types.ts";

const endpoint="https://webapi.legistar.com/v1/pima/events/1825/eventitems";
const request=(suffix:string,hash:string):OutcomeSourceRequest=>({source:"legistar",requestedUrl:endpoint+suffix,finalUrl:endpoint+suffix,
  rawHash:hash.repeat(64),byteCount:100,httpStatus:200,meetingId:"legistar:pima:1825",checkedAt:"2026-10-25T12:00:00.000Z"});
const pages=[request("?$top=1000","a"),request("?$top=1000&$skip=1000","b")];
const plan:OutcomeSourcePlan={formatVersion:1,context:"pima-current-window",complete:true,requests:pages};
const head:SourceHead={sourceId:"legistar",recordClass:"MEETING_OUTCOME",scope:"US-AZ:county:pima:legistar-outcomes",versionId:"held",
  lastKnownGoodVersionId:"held",rawHash:outcomeSourcePlanHash(plan),normalizedHash:"c".repeat(64),parserVersion:"legistar/1",
  promotedAt:"2026-10-25T12:00:00.000Z",candidateState:"PROMOTED",acquisitionSucceeded:true,imported:false,rawHashBasis:"SOURCE_CONTENT_V1"};

test("outcome source hashes ignore observation stamps and keep each exact request",()=>{
  assert.equal(outcomeSourcePlanHash(plan),outcomeSourcePlanHash({...plan,requests:[...pages].reverse().map(row=>({...row,checkedAt:"2026-10-26T12:00:00.000Z"}))}));
  assert.notEqual(outcomeSourcePlanHash(plan),outcomeSourcePlanHash({...plan,requests:[pages[0]!,{...pages[1]!,rawHash:"d".repeat(64)}]}));
});

test("a cutoff resumes completed exact checks before confirming the held source",async()=>{
  const memory=new Map<string,string>(),cache=new CivicReadCache({read:async key=>memory.get(key)??null,write:async(key,value)=>{memory.set(key,value);}});
  const confirmations:unknown[]=[],checks:RecordPublishedSourceCheck[]=[];
  const store={readSourceHead:async()=>head,confirmUnchanged:async(value:unknown,at:string)=>{confirmations.push(value);return{kind:"CONFIRMED",at};},
    recordSourceCheck:async(value:RecordPublishedSourceCheck)=>{checks.push(value);return true;},
    readCandidate:async()=>{throw Error("held payload must not open");}} as unknown as RoutineDataStore;
  const first=new AbortController(),acquired:string[]=[];
  const common={store,head,plan,context:plan.context,fresh:[],cache,maxAgeMs:3_600_000,now:()=>"2026-10-26T12:00:00.000Z"};
  await assert.rejects(probeOutcomeSourcePlan({...common,signal:first.signal,acquire:async row=>{acquired.push(row.requestedUrl);first.abort(Error("pass deadline"));return row;}}),/pass deadline/);
  assert.equal(confirmations.length,0);
  const result=await probeOutcomeSourcePlan({...common,signal:new AbortController().signal,acquire:async row=>{acquired.push(row.requestedUrl);return row;}});
  assert.ok(result.confirmed);assert.equal(confirmations.length,1);
  assert.deepEqual(acquired,pages.map(row=>row.requestedUrl),"the completed first request is not fetched again");
  assert.equal(checks.length,2);
});

test("a field refresh requires all of its exact pages; an unrelated check leaves old evidence untouched",async()=>{
  const snapshot={generatedOn:"2026-10-24",generatedAt:"2026-10-24T12:00:00.000Z",tenants:["pima"],sittings:[{
    meetingId:"legistar:pima:1825",agenda:[{title:"A sourced agenda",provenance:{endpoint,sourceOrg:"County clerk",readOn:"2026-10-24"}}],
    outcomes:[],rollCalls:[],
  }]} as unknown as OutcomeSnapshot;
  const bound=bindOutcomeSourceHashes(snapshot,pages),checks:RecordPublishedSourceCheck[]=[];
  const store={recordSourceCheck:async(check:RecordPublishedSourceCheck)=>{checks.push(check);return true;}} as unknown as RoutineDataStore;
  await recordOutcomeSourceChecks(store,head,{...plan,requests:pages.map(row=>({...row,checkedAt:"2026-10-26T12:00:00.000Z"}))});
  const partial=await withOutcomeSourceChecks(bound,head.scope,{store:{readSourceChecks:async()=>checks.slice(0,1)}});
  assert.equal(partial.sittings[0]!.agenda[0]!.provenance.readOn,"2026-10-24");
  const full=await withOutcomeSourceChecks(bound,head.scope,{store:{readSourceChecks:async()=>checks}});
  assert.equal(full.sittings[0]!.agenda[0]!.provenance.readOn,"2026-10-26");
});
