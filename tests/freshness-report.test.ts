import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { PGlite } from "@electric-sql/pglite";
import { appendFreshnessCycleDetails } from "../lib/control-plane/freshness-cycle-details.ts";
import { appendFreshnessCycleDigest } from "../lib/control-plane/freshness-cycle-outcome.ts";
import { readFreshnessIncidentReference,readFreshnessReportPage,readFreshnessTextReportPage } from "../lib/control-plane/admin-view/freshness-report-read.ts";
import { v6FreshnessReportGet,validateFreshnessReportQuery } from "../lib/control-plane/admin-view/freshness-report-route.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { pgAggregateRepository,pgAppendOnlyRepository,type Sql } from "../lib/control-plane/repository/pg-store.ts";
import { RESEARCH_BOUNDS,RESEARCH_STATE_ID,type ResearchState } from "../lib/control-plane/scheduler/research-policy.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import type { FreshnessCycleOutcome,FreshnessDetailReference,OwnerDigestRecord } from "../lib/control-plane/owner-surface.ts";
import { ADMIN_HOST,PUBLIC_HOST,adminSessionCookie,withAdminSessionKey } from "./admin-session.ts";

const NOW="2026-10-20T12:00:00.000Z",CYCLE=`freshness-cycle:test:${NOW}`;
function researchState(over:Partial<ResearchState>={}):ResearchState{return{
  formatVersion:1,beatAt:NOW,cycleStartedAt:NOW,cycleFinishedAt:null,testedSha:null,host:"test",
  modelLaneEnabled:false,modelLaneDisabledReason:"Fixture",pausedByOwner:false,pauseIntentId:null,
  workerCredential:{name:"FIXTURE_CREDENTIAL",configured:false,provider:"fixture",context:"local test"},
  model:"fixture",bounds:RESEARCH_BOUNDS,spend:{windowUsd:null,measuredAttempts:0,unmeasuredAttempts:0,asOf:NOW},
  queue:{registeredUnits:0,modelClassUnits:0,modelClassDue:0,modelClassDispatchedThisCycle:0,
    modelClassDeferredForCeiling:0,modelClassDeferredForCycleMax:0,modelClassDeferredForLane:0,deterministicDue:0,deterministicDispatchedThisCycle:0},
  running:[],runtimeConditions:[],methodCandidates:null,...over,
};}
function outcome(cycleId:string,ref:FreshnessDetailReference):FreshnessCycleOutcome{return{
  kind:"FRESHNESS_CYCLE",state:"SUCCEEDED",cycleId,startedAt:NOW,finishedAt:NOW,testedSha:null,host:"test",provider:"fixture",durable:false,executor:null,
  registry:null,obligations:ref.rows,occurrencesOpened:0,debtInherited:0,debtPersisted:ref.rows,debtCleared:0,scheduled:ref.rows,unscheduled:[],
  dueCount:0,dispatched:0,worked:[],dispositions:[],dispatchDetails:[],research:null,deferred:0,debts:ref.rows,incidents:ref,
  incidentSummary:[],risk:{incidents:ref.rows},health:null,promotedToReaderTruth:false,failure:null,
};}
async function publish(repos:ControlPlaneRepositories,cycleId=CYCLE,count=70){
  const ref=await appendFreshnessCycleDetails(repos,{cycleId,finishedAt:NOW,testedSha:null},"incidents",
    {[Symbol.iterator]:function*(){for(let n=0;n<count;n++)yield{cause:"UPSTREAM_ERROR",target:`place:${n}`,obligationsAffected:1,oldestHours:n};}});
  await appendFreshnessCycleDigest(repos,{lines:["Freshness cycle"],outcome:outcome(cycleId,ref)});
  return ref;
}

test("freshness incident pages retain exact targets and cycle pinning while transferring one partition",async()=>{
  const pg=new PGlite(),transferred:unknown[]=[];
  try{
    await pg.exec(`CREATE TABLE cp_log_heads(log_table text,log_key text,next_position bigint,PRIMARY KEY(log_table,log_key));
      CREATE TABLE cp_log_owner_digests(log_key text,record_id text,position bigint,recorded_at timestamptz,record jsonb,
      changed_at timestamptz DEFAULT now(),PRIMARY KEY(log_key,record_id))`);
    const sql:Sql={query:async(text,params)=>{const rows=(await pg.query(text,params?[...params]:[])).rows;transferred.push(rows);return rows;}};
    const repos={...createMemoryRepositories(),ownerDigests:pgAppendOnlyRepository<OwnerDigestRecord>(sql,"owner_digests")};
    await publish(repos);
    const legacy=`freshness-cycle:legacy:${NOW}`;
    await repos.ownerDigests.append("owner-digest",legacy,{formatVersion:1,digestId:legacy,writtenAt:NOW,headline:"Old report",lines:[],cycleOk:true,testedSha:null,
      runtimeOutcome:{...outcome(legacy,{cycleId:legacy,logKey:`freshness-details:${legacy}:incidents`,section:"incidents",rows:0,pages:0}),
        incidents:Array.from({length:2000},()=>({cause:"UPSTREAM_ERROR",target:"LEGACY_COUNTRY_EVIDENCE".repeat(100),obligationsAffected:1}))}},NOW);
    transferred.length=0;
    assert.equal(await readFreshnessIncidentReference(repos,legacy),null,"legacy arrays cannot satisfy the native-reference predicate");
    const first=await readFreshnessReportPage(repos,{cycleId:CYCLE,page:0});
    assert.equal(first.kind,"READ");
    if(first.kind!=="READ")return;
    assert.equal(first.value.rows.length,32);assert.equal(first.value.total,70);assert.equal(first.value.nextPage,1);
    assert.deepEqual(first.value.rows.map(row=>row.target),Array.from({length:32},(_,n)=>`place:${n}`));
    assert.ok(!JSON.stringify(transferred).includes("place:32"));
    assert.ok(!JSON.stringify(transferred).includes("LEGACY_COUNTRY_EVIDENCE"));
    await publish(repos,`freshness-cycle:newer:${NOW}`,1);
    const next=await readFreshnessReportPage(repos,{cycleId:first.value.cycleId,page:1});
    assert.equal(next.kind,"READ");
    if(next.kind==="READ")assert.deepEqual(next.value.rows.map(row=>row.target),Array.from({length:32},(_,n)=>`place:${n+32}`));
    const last=await readFreshnessReportPage(repos,{cycleId:CYCLE,page:2});
    assert.equal(last.kind,"READ");if(last.kind==="READ"){assert.equal(last.value.rows.length,6);assert.equal(last.value.nextPage,null);}
    assert.equal((await readFreshnessReportPage(repos,{cycleId:CYCLE,page:3})).kind,"OUT_OF_RANGE");
    const latest=await readFreshnessReportPage(repos,{cycleId:null,page:0});
    assert.equal(latest.kind,"READ");if(latest.kind==="READ")assert.match(latest.value.cycleId,/newer/);
  }finally{await pg.close();}
});

test("freshness report GET enforces the Admin host and session, rejects arbitrary keys, and distinguishes unread from a recorded empty page",async()=>{
  const repos=createMemoryRepositories();await publish(repos,CYCLE,0);
  let opened=0;
  const deps={open:async()=>{opened++;return{ok:true as const,repos};}};
  const request=(host:string,query="",cookie?:string)=>new NextRequest(`https://${host}/api/admin/v6/freshness-report${query}`,{headers:{host,...cookie?{cookie}:{}}});
  assert.equal((await v6FreshnessReportGet(request(PUBLIC_HOST),deps)).status,404);
  assert.equal((await v6FreshnessReportGet(request(ADMIN_HOST),deps)).status,401);
  assert.equal(opened,0);
  await withAdminSessionKey(async()=>{
    const cookie=await adminSessionCookie(),ask=(query="")=>v6FreshnessReportGet(request(ADMIN_HOST,query,cookie),deps);
    for(const bad of["?logKey=owner-digest","?page=-1","?page=1.2","?page=9007199254740992","?page=0&page=1","?cycleId=../../another-log","?cycleId=a&cycleId=b",
      "?section=another-log","?section=lines&section=runtimeConditions"])
      assert.equal((await ask(bad)).status,400,bad);
    assert.equal(opened,0);
    const empty=await ask();assert.equal(empty.status,200);assert.match(empty.headers.get("cache-control")??"",/private.*no-store/);
    assert.deepEqual(await empty.json(),{cycleId:CYCLE,page:0,rows:[],total:0,nextPage:null});
    assert.equal((await ask("?page=1")).status,404);
    const unavailable=await v6FreshnessReportGet(request(ADMIN_HOST,"",cookie),{open:async()=>({ok:false as const,detail:"Unavailable"})});
    assert.equal(unavailable.status,503);assert.ok(!("rows"in await unavailable.json()));
  });
});

test("runtime conditions and native log text page exactly while legacy condition arrays stay inside PostgreSQL",async()=>{
  const pg=new PGlite(),transferred:unknown[]=[];
  try{
    await pg.exec(`CREATE TABLE cp_log_heads(log_table text,log_key text,next_position bigint,PRIMARY KEY(log_table,log_key));
      CREATE TABLE cp_log_owner_digests(log_key text,record_id text,position bigint,recorded_at timestamptz,record jsonb,
      changed_at timestamptz DEFAULT now(),PRIMARY KEY(log_key,record_id));
      CREATE TABLE cp_research_state(id text PRIMARY KEY,revision bigint NOT NULL,updated_at timestamptz NOT NULL,value jsonb NOT NULL,changed_at timestamptz DEFAULT now())`);
    const sql:Sql={query:async(text,params)=>{const rows=(await pg.query(text,params?[...params]:[])).rows;transferred.push(rows);return rows;}};
    const repos={...createMemoryRepositories(),ownerDigests:pgAppendOnlyRepository<OwnerDigestRecord>(sql,"owner_digests"),
      researchState:pgAggregateRepository<ResearchState>(sql,"ResearchState","cp_research_state")};
    const cycle={cycleId:CYCLE,finishedAt:NOW,testedSha:null},text=(n:number)=>`condition:${n}\nexact native text`,
      ref=await appendFreshnessCycleDetails(repos,cycle,"runtimeConditions",Array.from({length:70},(_,n)=>text(n))),
      log=await appendFreshnessCycleDetails(repos,cycle,"lines",["PILOT HEALTH","",...Array.from({length:68},(_,n)=>`  owner dispatch ${n}`)]);
    await appendFreshnessCycleDigest(repos,{lines:["first twelve lines are examples"],outcome:{...outcome(CYCLE,{...ref,section:"incidents",logKey:`freshness-details:${CYCLE}:incidents`,rows:0,pages:0}),
      research:{lanes:null,runtimeConditionCount:70,runtimeConditionDetails:ref,cycleLogLineCount:70,cycleLogDetails:log,
        ...{runtimeConditions:Array.from({length:2000},()=>"LEGACY_COUNTRY_CONDITIONS".repeat(100))}}}});
    transferred.length=0;
    const first=await readFreshnessTextReportPage(repos,{cycleId:CYCLE,section:"runtimeConditions",page:0});
    assert.equal(first.kind,"READ");if(first.kind!=="READ")return;
    assert.equal(first.value.total,70);assert.equal(first.value.recorded,70);assert.equal(first.value.unavailable,null);
    assert.deepEqual(first.value.rows,Array.from({length:32},(_,n)=>text(n)));
    assert.ok(!JSON.stringify(transferred).includes("condition:32"));
    assert.ok(!JSON.stringify(transferred).includes("LEGACY_COUNTRY_CONDITIONS"));
    const next=await readFreshnessTextReportPage(repos,{cycleId:CYCLE,section:"runtimeConditions",page:1});
    assert.equal(next.kind,"READ");if(next.kind==="READ")assert.deepEqual(next.value.rows,Array.from({length:32},(_,n)=>text(n+32)));
    const last=await readFreshnessTextReportPage(repos,{cycleId:CYCLE,section:"runtimeConditions",page:2});
    assert.equal(last.kind,"READ");if(last.kind==="READ"){assert.equal(last.value.rows.length,6);assert.equal(last.value.nextPage,null);}
    const lines=await readFreshnessTextReportPage(repos,{cycleId:null,section:"lines",page:0});
    assert.equal(lines.kind,"READ");if(lines.kind==="READ"){assert.equal(lines.value.cycleId,CYCLE);assert.deepEqual(lines.value.rows.slice(0,3),["PILOT HEALTH","","  owner dispatch 0"]);}
    assert.equal((await readFreshnessTextReportPage(repos,{cycleId:CYCLE,section:"lines",page:3})).kind,"OUT_OF_RANGE");
    const active=`freshness-cycle:active:${NOW}`;
    await repos.researchState.put(RESEARCH_STATE_ID,researchState({host:"active",cycleStartedAt:NOW,runtimeConditionCount:70,
      runtimeConditionDetails:{...ref,cycleId:active,logKey:`freshness-details:${active}:runtimeConditions`},
      runtimeConditions:Array.from({length:2000},()=>"LEGACY_STATE_CONDITIONS".repeat(100))}),NOW);
    const activeRef=await appendFreshnessCycleDetails(repos,{...cycle,cycleId:active},"runtimeConditions",["active exact condition"]);
    const state=await repos.researchState.mustRead(RESEARCH_STATE_ID);
    await repos.researchState.compareAndSet(RESEARCH_STATE_ID,state.revision,{...state.value,runtimeConditionDetails:activeRef,
      runtimeConditionDetailsUnavailable:"Remaining conditions are preserved in the local cycle diagnostic."},NOW);
    transferred.length=0;
    const current=await readFreshnessTextReportPage(repos,{cycleId:active,section:"runtimeConditions",page:0});
    assert.equal(current.kind,"READ");if(current.kind==="READ"){assert.equal(current.value.total,70);assert.equal(current.value.recorded,1);assert.match(current.value.unavailable!,/local cycle diagnostic/);}
    assert.ok(!JSON.stringify(transferred).includes("LEGACY_STATE_CONDITIONS"));
    assert.equal((await readFreshnessTextReportPage(repos,{cycleId:`freshness-cycle:wrong:${NOW}`,section:"runtimeConditions",page:0})).kind,"NOT_RECORDED");
  }finally{await pg.close();}
});

test("runtime report distinguishes a recorded empty cycle from failed detail publication and serves only acknowledged pages",async()=>{
  const repos=createMemoryRepositories(),cycle={cycleId:CYCLE,finishedAt:NOW,testedSha:null};
  const zero=await appendFreshnessCycleDetails(repos,cycle,"runtimeConditions",[]);
  await repos.researchState.put(RESEARCH_STATE_ID,researchState({runtimeConditionCount:0,runtimeConditionDetails:zero}),NOW);
  const empty=await readFreshnessTextReportPage(repos,{cycleId:CYCLE,section:"runtimeConditions",page:0});
  assert.equal(empty.kind,"READ");if(empty.kind==="READ")assert.deepEqual(empty.value.rows,[]);
  const state=await repos.researchState.mustRead(RESEARCH_STATE_ID);
  await repos.researchState.compareAndSet(RESEARCH_STATE_ID,state.revision,{...state.value,runtimeConditionCount:2,
    runtimeConditionDetailsUnavailable:"Exact pending conditions remain local; details are not durable."},NOW);
  assert.equal((await readFreshnessTextReportPage(repos,{cycleId:CYCLE,section:"runtimeConditions",page:0})).kind,"UNAVAILABLE");
  await withAdminSessionKey(async()=>{
    const cookie=await adminSessionCookie(),request=new NextRequest(`https://${ADMIN_HOST}/api/admin/v6/freshness-report?cycleId=${encodeURIComponent(CYCLE)}&section=runtimeConditions`,{headers:{host:ADMIN_HOST,cookie}});
    const result=await v6FreshnessReportGet(request,{open:async()=>({ok:true as const,repos})});
    assert.equal(result.status,503);assert.match((await result.json()).says,/not durable/);
  });
  const ref=await appendFreshnessCycleDetails(repos,cycle,"runtimeConditions",["acknowledged exact condition"]),current=await repos.researchState.mustRead(RESEARCH_STATE_ID);
  await repos.researchState.compareAndSet(RESEARCH_STATE_ID,current.revision,{...current.value,runtimeConditionDetails:ref},NOW);
  const partial=await readFreshnessTextReportPage(repos,{cycleId:CYCLE,section:"runtimeConditions",page:0});
  assert.equal(partial.kind,"READ");if(partial.kind==="READ"){assert.equal(partial.value.total,2);assert.equal(partial.value.recorded,1);assert.equal(partial.value.nextPage,null);assert.match(partial.value.unavailable!,/not durable/);}
  assert.equal((await readFreshnessTextReportPage(repos,{cycleId:CYCLE,section:"runtimeConditions",page:1})).kind,"OUT_OF_RANGE");
  const lines=await appendFreshnessCycleDetails(repos,cycle,"lines",["exact full cycle log line"]),
    sends=await appendFreshnessCycleDetails(repos,cycle,"assignments:test",[{key:"scope:exact-send",kind:"SCOPE",label:"Exact Send",ref:"receipt:exact",
      members:{created:80,reordered:3,createdSample:[],reorderedSample:[]},budget:null}]);
  await appendFreshnessCycleDigest(repos,{lines:["bounded examples"],outcome:{...outcome(CYCLE,{...zero,section:"incidents",logKey:`freshness-details:${CYCLE}:incidents`}),
    research:{lanes:null,runtimeConditionCount:2,runtimeConditionDetails:ref,runtimeConditionDetailsUnavailable:"One pending condition remains local, not durable.",
      cycleLogLineCount:1,cycleLogDetails:lines,assignmentDetails:sends}}});
  await withAdminSessionKey(async()=>{
    const cookie=await adminSessionCookie();
    for(const section of["runtimeConditions","lines","assignments"]){
      const request=new NextRequest(`https://${ADMIN_HOST}/api/admin/v6/freshness-report?cycleId=${encodeURIComponent(CYCLE)}&section=${section}`,{headers:{host:ADMIN_HOST,cookie}});
      const response=await v6FreshnessReportGet(request,{open:async()=>({ok:true as const,repos})});
      assert.equal(response.status,200);const body=await response.json();assert.equal(body.cycleId,CYCLE);assert.equal(body.rows.length,1);
      if(section==="assignments")assert.equal(body.rows[0].members.created,80);
      if(section==="lines")assert.equal(body.rows[0],"exact full cycle log line");
      if(section==="runtimeConditions"){assert.equal(body.total,2);assert.match(body.unavailable,/not durable/);}
    }
  });
  const read=repos.ownerDigests.readRecent.bind(repos.ownerDigests);
  repos.ownerDigests.readRecent=async(key,limit)=>(await read(key,limit)).map(row=>({...row,freshnessDetails:row.freshnessDetails?{...row.freshnessDetails,section:"lines"}:undefined}));
  await assert.rejects(readFreshnessTextReportPage(repos,{cycleId:CYCLE,section:"runtimeConditions",page:0}),/PAGE_INVALID/);
});

test("a wrong-cycle or missing detail partition fails visibly instead of becoming an empty incident list",async()=>{
  const repos=createMemoryRepositories();await publish(repos,CYCLE,1);
  const read=repos.ownerDigests.readRecent.bind(repos.ownerDigests);
  repos.ownerDigests.readRecent=async(key,limit)=>{
    const records=await read(key,limit);
    return records.map(record=>({...record,freshnessDetails:record.freshnessDetails?{...record.freshnessDetails,cycleId:"another-cycle"}:undefined}));
  };
  await assert.rejects(readFreshnessReportPage(repos,{cycleId:CYCLE,page:0}),/PAGE_INVALID/);
  repos.ownerDigests.readRecent=async()=>[];
  await assert.rejects(readFreshnessReportPage(repos,{cycleId:CYCLE,page:0}),/PAGE_INVALID/);
  assert.equal(validateFreshnessReportQuery(new URLSearchParams(`cycleId=${encodeURIComponent(CYCLE)}&page=2`)).ok,true);
});
