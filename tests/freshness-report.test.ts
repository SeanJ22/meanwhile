import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { PGlite } from "@electric-sql/pglite";
import { appendFreshnessCycleDetails } from "../lib/control-plane/freshness-cycle-details.ts";
import { appendFreshnessCycleDigest } from "../lib/control-plane/freshness-cycle-outcome.ts";
import { readFreshnessIncidentReference,readFreshnessReportPage } from "../lib/control-plane/admin-view/freshness-report-read.ts";
import { v6FreshnessReportGet,validateFreshnessReportQuery } from "../lib/control-plane/admin-view/freshness-report-route.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { pgAppendOnlyRepository,type Sql } from "../lib/control-plane/repository/pg-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import type { FreshnessCycleOutcome,FreshnessDetailReference,OwnerDigestRecord } from "../lib/control-plane/owner-surface.ts";
import { ADMIN_HOST,PUBLIC_HOST,adminSessionCookie,withAdminSessionKey } from "./admin-session.ts";

const NOW="2026-10-20T12:00:00.000Z",CYCLE=`freshness-cycle:test:${NOW}`;
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
    for(const bad of["?logKey=owner-digest","?page=-1","?page=1.2","?page=9007199254740992","?page=0&page=1","?cycleId=../../another-log","?cycleId=a&cycleId=b"])
      assert.equal((await ask(bad)).status,400,bad);
    assert.equal(opened,0);
    const empty=await ask();assert.equal(empty.status,200);assert.match(empty.headers.get("cache-control")??"",/private.*no-store/);
    assert.deepEqual(await empty.json(),{cycleId:CYCLE,page:0,rows:[],total:0,nextPage:null});
    assert.equal((await ask("?page=1")).status,404);
    const unavailable=await v6FreshnessReportGet(request(ADMIN_HOST,"",cookie),{open:async()=>({ok:false as const,detail:"Unavailable"})});
    assert.equal(unavailable.status,503);assert.ok(!("rows"in await unavailable.json()));
  });
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
