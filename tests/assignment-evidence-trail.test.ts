import assert from "node:assert/strict";
import test from "node:test";
import { assignmentEvidenceTrail } from "../lib/control-plane/admin-view/assignment-evidence-trail.ts";
import { readAssignmentSourcesById, verifiedInheritedOrigin } from "../lib/control-plane/assignment-read.ts";
import type { AssignmentSources } from "../lib/control-plane/assignment-view.ts";
import type { Attempt } from "../lib/control-plane/attempt.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import type { WorkerResultRecord } from "../lib/control-plane/workers/types.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";

const at="2026-09-28T10:00:00Z";
const child={id:"wi-child",project:"civic",subject:"body-one",obligation:"Read the official roster",createdAt:at,
  autonomousPlan:{acquisition:[{held:[{artifactId:"ar-one",inheritedFromWorkItemId:"wi-origin",
    sourceRouteId:"route-one",sourceObservationArtifactId:"ar-observe"}]}]}} as unknown as WorkItem;
const origin={id:"wi-origin",project:"civic",subject:"body-one"} as WorkItem;
const originAttempt={id:"at-origin",workItemId:"wi-origin",outcome:"COMPLETED",artifactIds:["ar-one"]} as unknown as Attempt;
const artifact={artifactId:"ar-one",workItemId:"wi-origin",attemptId:"at-origin",partial:false,contentHash:"sha256-one",
  canonicalUrl:"https://city.example/roster?session=private",byteLength:100,recordedAt:at} as ArtifactRecord;
const childAttempt={id:"at-child",workItemId:"wi-child",routeTaskId:"rt-child",worker:{role:"ACQUIRER"},
  outcome:"COMPLETED",startedAt:at,endedAt:at,abortReason:null,artifactIds:[],methodVersion:3,
  cost:{requestCount:0,bytesFetched:0}} as unknown as Attempt;
const result={id:"wr-child",workItemId:"wi-child",routeTaskId:"rt-child",attemptId:"at-child",worker:{role:"ACQUIRER"},
  endedAt:at,methodVersion:3,completion:{closedAttempt:childAttempt},result:{role:"ACQUIRER",verdict:"ACQUIRED",requestCount:0,bytesFetched:0,
    source:{id:"route-one",sourceId:"official-city",url:"https://city.example/roster?session=private",retrieval:"fetch_public",observation:{artifactId:"ar-observe"}},
    artifacts:[{artifactId:"ar-one",reused:true,acquisitionAttemptId:"at-origin",contentHash:"sha256-one",
      canonicalUrl:"https://city.example/roster?session=private"}],findings:[]}} as unknown as WorkerResultRecord;
function sources(change:Partial<AssignmentSources>={}):AssignmentSources {
  return {nowIso:"2026-09-28T10:10:00Z",workItems:[child],obligations:[],occurrences:[],attempts:[childAttempt],artifacts:[],scoutResults:[],
    workerResults:[result],servedReader:null,inheritedOrigins:[{artifact,attempt:originAttempt,originWorkItemId:origin.id}],...change} as unknown as AssignmentSources;
}

test("exact captured origin and committed zero-request result show saved-byte reuse without a dollar claim",()=>{
  const trail=assignmentEvidenceTrail(sources(),child.id,"Check the missing names");
  const reused=trail.events.find(row=>row.id==="reuse:wr-child:ar-one");
  assert.equal(reused?.title,"Earlier saved document reused");
  assert.match(reused?.says??"",/no new source request/);
  assert.match(reused?.says??"",/No dollar saving is inferred/);
  assert.equal(reused?.sourceUrl,null,"a source URL with an unreviewed query is not exposed or rewritten to a possibly broken link");
  assert.ok(reused?.references.some(([name,value])=>name==="Original work item"&&value==="wi-origin"));
  assert.equal(trail.events.some(row=>row.title==="Current public result confirmed"),false);
  assert.ok(trail.gaps.some(gap=>gap.includes("no eligible private original-copy control")));
});

test("only a complete RAW capture on exact freshness work offers the private copy control",()=>{
  const work={...child,project:"freshness"} as WorkItem;
  const saved={...artifact,workItemId:work.id,attemptId:childAttempt.id,artifactId:"ar-complete",
    tier:"RAW",partial:false,byteLength:107106} as ArtifactRecord;
  const attempt={...childAttempt,artifactIds:[saved.artifactId]} as Attempt;
  const event=(row:ArtifactRecord, owner:WorkItem=work)=>assignmentEvidenceTrail(sources({workItems:[owner],attempts:[attempt],
    artifacts:[row],workerResults:[]}),owner.id,null).events.find(e=>e.id===`saved:${owner.id}:${row.artifactId}`);
  assert.deepEqual(event(saved)?.privateCopy,{path:`/api/admin/evidence/${work.id}/${attempt.id}/${saved.artifactId}`,
    byteLength:saved.byteLength});
  assert.equal(event({...saved,partial:true})?.privateCopy,undefined);
  assert.equal(event({...saved,tier:"RESTRICTED_RAW"})?.privateCopy,undefined);
  assert.equal(event({...saved,byteLength:32*1024*1024+1})?.privateCopy,undefined);
  assert.equal(event(saved,{...work,project:"civic"})?.privateCopy,undefined);
});

test("unconfirmed origin or nonzero request cannot claim validated reuse or avoided request",()=>{
  const wrong={...artifact,contentHash:"different"};
  const changed={...result,result:{...result.result,requestCount:1}} as WorkerResultRecord;
  const trail=assignmentEvidenceTrail(sources({inheritedOrigins:[{artifact:wrong,attempt:originAttempt,originWorkItemId:origin.id}],
    workerResults:[changed]}),child.id,"Find the correct source");
  const reused=trail.events.find(row=>row.stage==="SAVED"&&row.id.startsWith("reuse:"));
  assert.equal(reused?.title,"Reuse reported; origin unconfirmed");
  assert.doesNotMatch(reused?.says??"",/This acquisition made no new source request/);
  assert.equal(reused?.references.some(([name])=>name==="Original work item"),false);
});

test("origin metadata refuses unrelated owners, incomplete attempts and partial captures",()=>{
  const input={child,origin,artifact,attempt:originAttempt,declaredArtifactId:"ar-one",declaredOriginWorkItemId:"wi-origin"};
  assert.ok(verifiedInheritedOrigin(input));
  assert.equal(verifiedInheritedOrigin({...input,origin:{...origin,project:"other"}}),null);
  assert.equal(verifiedInheritedOrigin({...input,origin:{...origin,subject:"other"}}),null);
  assert.equal(verifiedInheritedOrigin({...input,attempt:{...originAttempt,outcome:"ABORTED"}}),null);
  assert.equal(verifiedInheritedOrigin({...input,artifact:{...artifact,partial:true}}),null);
  assert.equal(verifiedInheritedOrigin({...input,artifact:{...artifact,tier:"RESTRICTED_RAW"}}),null);
  assert.equal(verifiedInheritedOrigin({...input,declaredArtifactId:"ar-unrelated"}),null);
});

test("only exact current publication version and body readback becomes a public link",()=>{
  const published={...child,autonomousPlan:{...child.autonomousPlan!,publication:{contractId:"registry-runtime:AZ",bodyId:"body-one"}},
    publicationOutcome:{at,workerResultId:"wr-child",status:"PUBLISHED",code:"ACCEPTED",detail:"accepted",candidateId:"candidate-one",
      versionId:"version-one",acceptedRecordIds:["record-one"]}} as WorkItem;
  const reader={checkedAt:at,witnesses:[{itemId:child.id,approvalId:"wr-child",versionId:"version-one",readerKey:"body-one",
    url:`${PUBLIC_SITE_ORIGIN}/body-one`,checkedAt:at,state:"CONFIRMED",reason:"matched",responseSha256:"hash-one"}],errors:[]} as AssignmentSources["servedReader"];
  const confirmed=assignmentEvidenceTrail(sources({workItems:[published],servedReader:reader}),child.id,null);
  assert.equal(confirmed.events.find(row=>row.stage==="READER")?.publicUrl,`${PUBLIC_SITE_ORIGIN}/body-one`);
  const ballot={...reader!,witnesses:[{...reader!.witnesses[0]!,url:`${PUBLIC_SITE_ORIGIN}/ballot?zip=85635`}]};
  assert.equal(assignmentEvidenceTrail(sources({workItems:[published],servedReader:ballot}),child.id,null)
    .events.find(row=>row.stage==="READER")?.publicUrl,`${PUBLIC_SITE_ORIGIN}/ballot?zip=85635`);
  const laterSuccess={...ballot,witnesses:[...ballot.witnesses,{...ballot.witnesses[0]!,checkedAt:"2026-09-28T10:01:00Z"}]};
  assert.equal(assignmentEvidenceTrail(sources({workItems:[published],servedReader:laterSuccess}),child.id,null)
    .events.find(row=>row.stage==="READER")?.publicUrl,`${PUBLIC_SITE_ORIGIN}/ballot?zip=85635`,"the newest passing check is usable when the read includes an older passing check");
  const privateQuery={...ballot,witnesses:[{...ballot.witnesses[0]!,url:`${PUBLIC_SITE_ORIGIN}/ballot?zip=85635&token=private`}]};
  assert.equal(assignmentEvidenceTrail(sources({workItems:[published],servedReader:privateQuery}),child.id,null)
    .events.find(row=>row.stage==="READER")?.publicUrl,null);
  const changed=assignmentEvidenceTrail(sources({workItems:[{...published,publicationOutcome:{...published.publicationOutcome!,versionId:"version-two"}}],
    servedReader:reader}),child.id,null);
  assert.equal(changed.events.find(row=>row.stage==="READER")?.publicUrl,null);
  assert.match(changed.events.find(row=>row.stage==="READER")?.title??"",/did not confirm/);
  const laterFailure={...reader!,witnesses:[...reader!.witnesses,{...reader!.witnesses[0]!,checkedAt:"2026-09-28T10:01:00Z",
    state:"NOT_OBSERVED" as const,reason:"reader no longer shows this version"}]};
  const failed=assignmentEvidenceTrail(sources({workItems:[published],servedReader:laterFailure}),child.id,null);
  assert.equal(failed.events.find(row=>row.stage==="READER")?.publicUrl,null,"an older passing readback cannot hide a later failed check");
});

test("by-ID read checks only declared origin records and never scans all artifacts",async()=>{
  const calls:string[]=[];
  const item={...child,routeTaskIds:[]} as WorkItem;
  const row=<T>(value:T)=>({value,revision:1,recordedAt:at});
  const repos={
    obligations:{read:async()=>null},debts:{read:async()=>null},scoutResults:{read:async()=>[]},
    workItems:{read:async(id:string)=>{calls.push(`work:${id}`);return id===item.id?row(item):id===origin.id?row(origin):null;}},
    artifacts:{read:async(id:string)=>{calls.push(`artifacts:${id}`);return id===origin.id?[artifact]:[];},
      readAll:async()=>{throw new Error("unbounded artifact scan forbidden");}},
    attempts:{read:async(id:string)=>id===originAttempt.id?row(originAttempt):null},
    costs:{read:async()=>[]},workerResults:{read:async()=>[]},promotionPipeline:{readAll:async()=>[]},
  } as unknown as ControlPlaneRepositories;
  const read=await readAssignmentSourcesById(repos,item.id,{nowIso:at,activation:null,pilotZips:[]});
  assert.equal(read.kind,"HELD");
  assert.ok(calls.includes("artifacts:wi-origin"));
  assert.equal(calls.some(call=>call.includes("unrelated")),false);
  if(read.kind==="HELD") assert.equal(read.value.inheritedOrigins?.length,1);
});

test("an older incomplete acquisition result becomes a named gap, not a broken detail page",()=>{
  const old={...result,result:{role:"ACQUIRER",verdict:"ACQUIRED",artifacts:[]}} as unknown as WorkerResultRecord;
  const trail=assignmentEvidenceTrail(sources({workerResults:[old]}),child.id,null);
  assert.ok(trail.gaps.some(gap=>gap.includes("lacks a readable source")));
});

test("historical Sierra Vista clock contradiction is disclosed without changing saved timestamps",()=>{
  const rosterAttempt={...childAttempt,id:"at-fdaa3625d1b2bb95157bdf44",worker:{role:"SCOUT"},
    startedAt:"2026-09-28T06:23:49.440Z",endedAt:"2026-09-28T06:23:49.440Z",
    artifactIds:["ar-be10df3d3aa3c72f6076ae6b"],cost:{...childAttempt.cost,durationMs:43131}} as unknown as Attempt;
  const rosterArtifact={...artifact,artifactId:"ar-be10df3d3aa3c72f6076ae6b",workItemId:child.id,
    attemptId:rosterAttempt.id,recordedAt:"2026-09-28T06:27:49.882Z",
    canonicalUrl:"https://www.sierravistaaz.gov/government/city-council/contact-the-mayor-council"};
  const trail=assignmentEvidenceTrail(sources({attempts:[rosterAttempt],artifacts:[rosterArtifact],workerResults:[]}),child.id,null);
  assert.ok(trail.gaps.some(gap=>gap.includes("identical start and end")));
  assert.ok(trail.gaps.some(gap=>gap.includes("recorded after its Attempt's stated end")));
  assert.equal(trail.events.find(event=>event.stage==="SAVED")?.at,rosterArtifact.recordedAt);
  assert.equal(trail.events.some(event=>event.stage==="EXTRACTED"||event.stage==="PUBLISHED"),false);
});
