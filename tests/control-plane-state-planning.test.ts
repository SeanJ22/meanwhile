import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { defaultAdminConfig, ADMIN_CONFIG_ID } from "../lib/control-plane/gateway/admin-config.ts";
import { requestHuntStop, applyHuntOrders, HUNT_STATES, scopeControlKey } from "../lib/control-plane/hunt-orders.ts";
import { expansionScopesOf, type ExpansionScopeDecision } from "../lib/control-plane/expansion/scopes.ts";
import { PLANNING_STATES, PLANNING_SUMMARY_SQL, planningStateOf, runStatePlanningRound, stateDispatchTarget } from "../lib/control-plane/scheduler/state-planning.ts";
import { parseDispatchTarget } from "../lib/control-plane/scheduler/dispatch-target.ts";
import { huntPacketObligationId } from "../lib/hunt/packet.ts";
import { submit } from "../lib/control-plane/gateway/gateway.ts";
import { confirmReceipt } from "../lib/control-plane/gateway/confirmation.ts";
import type { StandingObligation } from "../lib/control-plane/scheduler/durable.ts";

const AT="2026-10-16T10:00:00.000Z",STOP="2026-10-16T11:00:00.000Z";
const scope=(state:string,n:number):ExpansionScopeDecision=>({key:`zcta:2020/${85000+n}`,geography:{type:"zcta",geoid:String(85000+n),version:"zcta:2020",label:`ZIP ${85000+n}`,stateAbbr:state.toUpperCase()},priority:n+1,budgetUsd:10,decidedAt:AT,decidedBy:"owner",receiptId:`send-${state}-${n}`,previous:null,note:null});
async function setup() {
  const repos=createMemoryRepositories();
  const scopes=[...Array.from({length:79},(_,n)=>scope("az",n)),scope("nh",100)];
  await repos.adminConfig.put(ADMIN_CONFIG_ID,{...defaultAdminConfig(AT),expansionScopes:scopes},AT);
  for(const decision of scopes) {
    const subjectId=`ocd-division/country:us/state:${decision.geography.stateAbbr.toLowerCase()}/place:${decision.geography.geoid}`;
    const id=huntPacketObligationId(subjectId);
    await repos.obligations.put(id,{id,subjectId,active:true,materializedBy:"OWNER_DISPATCH",nextDueAt:AT,updatedAt:AT,
      assignments:[{assignmentKey:decision.key,ref:decision.receiptId,at:AT,relation:"CREATED"}]} as unknown as StandingObligation,AT);
  }
  return {repos,scopes};
}

test("a full round runs each state in order with no overlapping planning children and continues after a failed state",async()=>{
  let active=0,peak=0;const visited:string[]=[];
  const round=await runStatePlanningRound(async state=>{active++;peak=Math.max(peak,active);visited.push(state);await Promise.resolve();active--;return state!=="az";});
  assert.equal(peak,1);assert.deepEqual(visited,PLANNING_STATES);assert.equal(round.completed,PLANNING_STATES.length-1);assert.deepEqual(round.failed,["az"]);
  assert.equal(planningStateOf("hunt:packet:government:US-AZ:04019"),"az");assert.equal(planningStateOf("ocd-division/country:us/territory:pr/place:san_juan"),"pr");assert.equal(planningStateOf("US-national"),null);
  const target=parseDispatchTarget("Arizona and New Hampshire");assert.deepEqual(stateDispatchTarget(target,"az")?.states,["az"]);assert.equal(stateDispatchTarget(target,"ca"),null);
});

test("79 concurrent stop requests are independent; the next state pass stops all 79 and retains another state's hunt",async()=>{
  const {repos,scopes}=await setup();
  const before=(await repos.adminConfig.mustRead(ADMIN_CONFIG_ID)).revision;
  await Promise.all(scopes.slice(0,79).map((decision,n)=>requestHuntStop(repos,{receiptId:`stop-${n}`,state:"az",scopeKey:decision.key,at:STOP,actor:"owner"})));
  assert.equal((await repos.huntOrders.pending("az")).length,79);assert.equal((await repos.adminConfig.mustRead(ADMIN_CONFIG_ID)).revision,before);
  assert.equal(await applyHuntOrders(repos,"az",STOP),79);
  assert.deepEqual(expansionScopesOf((await repos.adminConfig.mustRead(ADMIN_CONFIG_ID,{expansionScopes:true})).value).scopes.map(row=>row.receiptId),["send-nh-100"]);
  const active=(await repos.obligations.list()).filter(row=>row.value.active);assert.equal(active.length,1);assert.match(active[0].value.subjectId,/state:nh/);
  assert.equal(await applyHuntOrders(repos,"az",STOP),0);
});

test("one state stop waits for the runner's exact confirmation; global stop writes one order per state",async()=>{
  const {repos}=await setup();
  const out=await submit({type:"expansion.scope.stopAll",subject:"Arizona",input:{state:"az"},stateVersion:null,idempotencyKey:"stop-arizona-once",caller:"OWNER_SESSION",actorRef:"adm_test"},{repos,now:()=>STOP,currentStateVersion:null,codeSha:null});
  assert.equal(out.ok,true,out.receipt.says);
  assert.equal((await confirmReceipt(repos,out.receipt,Date.parse(STOP))).state,"waiting");
  await applyHuntOrders(repos,"nh",STOP);assert.equal((await confirmReceipt(repos,out.receipt,Date.parse(STOP))).state,"waiting");
  await applyHuntOrders(repos,"az",STOP);assert.equal((await confirmReceipt(repos,out.receipt,Date.parse(STOP))).state,"applied");
  await requestHuntStop(repos,{receiptId:"stop-country",at:STOP,actor:"owner"});
  const orders=await repos.huntOrders.listWhere(["receiptId"],"stop-country");assert.equal(orders.length,HUNT_STATES.length);assert.equal(new Set(orders.map(row=>row.value.state)).size,HUNT_STATES.length);
});

test("a new hunt after a stop survives and a replay finishes deactivating work if the scope was already removed",async()=>{
  const {repos,scopes}=await setup();
  await requestHuntStop(repos,{receiptId:"stop-az",state:"az",at:STOP,actor:"owner"});
  const held=await repos.adminConfig.mustRead(ADMIN_CONFIG_ID,{expansionScopes:true});
  const later={...scope("az",200),decidedAt:"2026-10-16T12:00:00.000Z"};
  await repos.adminConfig.save(held,{...held.value,expansionScopes:[scopes.at(-1)!,later]},STOP);
  await applyHuntOrders(repos,"az",STOP);
  assert.deepEqual(expansionScopesOf((await repos.adminConfig.mustRead(ADMIN_CONFIG_ID,{expansionScopes:true})).value).scopes.map(row=>row.receiptId),["send-nh-100",later.receiptId]);
  assert.equal((await repos.obligations.list()).filter(row=>row.value.active).length,1);
});

test("the national control summary sums counts without copying state assignments or government records",async()=>{
  const db=new PGlite();
  try {
    await db.exec("CREATE TABLE cp_research_state(id text PRIMARY KEY,revision bigint NOT NULL,updated_at timestamptz NOT NULL,value jsonb NOT NULL)");
    for(const [state,n] of [["az",79],["nh",1]] as const)await db.query("INSERT INTO cp_research_state VALUES($1,1,$2,$3::jsonb)",[`level-1:${state}`,STOP,JSON.stringify({formatVersion:1,beatAt:STOP,cycleStartedAt:AT,cycleFinishedAt:STOP,host:"runner",queue:{registeredUnits:n,modelClassDue:n,lanes:{at:STOP,final:true,model:{due:n,dispatched:0,active:0,waiting:n,oldestWaitingDueAt:AT}}},assignments:{assignments:[{ref:`private-${state}`} ]},running:[{obligationId:`private-${state}`}],expansion:{scopes:[state]}})]);
    await db.query(PLANNING_SUMMARY_SQL,[["level-1:az","level-1:nh"],AT,STOP,"level-1"]);
    const row=(await db.query<{value:{queue:{registeredUnits:number;lanes:{model:{waiting:number}}};assignments:null;running:unknown[]}}>("SELECT value FROM cp_research_state WHERE id='level-1'")).rows[0].value;
    assert.equal(row.queue.registeredUnits,80);assert.equal(row.queue.lanes.model.waiting,80);assert.equal(row.assignments,null);assert.deepEqual(row.running,[]);assert.ok(!JSON.stringify(row).includes("private-"));
  }finally{await db.close();}
});

test("a state query includes a crossing hunt's declared reach without reading an unrelated state's orders",async()=>{
  const {repos}=await setup();
  const held=await repos.adminConfig.mustRead(ADMIN_CONFIG_ID,{expansionScopes:{ids:["zcta:2020/85000"]}});
  await repos.adminConfig.save(held,{...held.value,expansionScopes:held.value.expansionScopes!.map(scope=>({...scope,planningStates:["AZ","CA"]}))},STOP);
  const ca=await repos.adminConfig.mustRead(ADMIN_CONFIG_ID,{expansionScopes:{where:{path:["geography","stateAbbr"],value:"CA"}}});
  assert.deepEqual(ca.value.expansionScopes?.map(scope=>scope.key),["zcta:2020/85000"]);
});

test("a system-wide stop is one atomic database request and a rejected batch leaves no partial orders",async()=>{
  const {HUNT_ORDER_DDL}=await import("../lib/control-plane/hunt-orders.ts");
  const {pgHuntOrderRepository}=await import("../lib/control-plane/repository/pg-store.ts");
  const db=new PGlite();
  try {
    for(const ddl of HUNT_ORDER_DDL)await db.exec(ddl);
    let requests=0;
    const repository=pgHuntOrderRepository({query:async(text,params)=>{requests++;return (await db.query(text,[...params??[]])).rows;}});
    const orders=HUNT_STATES.map(state=>({id:`receipt:${state}`,receiptId:"receipt",state,scopeKey:null,requestedAt:STOP,requestedBy:"owner",confirmedAt:null,affected:null}));
    await assert.rejects(repository.request([orders[0],{...orders[1],id:null} as never],STOP),/null value/);
    assert.equal((await db.query<{n:number}>("SELECT count(*)::integer AS n FROM cp_hunt_orders")).rows[0].n,0);
    requests=0;await repository.request(orders,STOP);assert.equal(requests,1);
    assert.equal((await repository.latestStop("az"))?.value.requestedAt,STOP);
    assert.equal((await repository.pending("az")).length,1);
  }finally{await db.close();}
});

test("planning reads effective controls and this state's live Sends instead of all prior commands",async()=>{
  const {pgPlanningIntents}=await import("../lib/control-plane/repository/pg-store.ts");
  const {CONTROL_READS_BACKFILL_DDL}=await import("../lib/control-plane/repository/control-reads-backfill.ts");
  const {readIntents}=await import("../lib/control-plane/scheduler/research-policy.ts");
  const {buildResearchIntent}=await import("../lib/control-plane/research-view.ts");
  const db=new PGlite();
  try {
    await db.exec("CREATE TABLE cp_log_research_intents(log_key text,record_id text,position bigint,record jsonb); CREATE TABLE cp_obligations(id text,value jsonb)");
    await db.exec(CONTROL_READS_BACKFILL_DDL[0]);
    const log=[];
    for(let n=0;n<2000;n++)log.push(buildResearchIntent(n%2?"RESUME":"PAUSE",new Date(Date.parse(AT)-2000+n).toISOString(),"owner",null,`old-${n}`));
    const send=buildResearchIntent("DISPATCH",AT,"owner","Arizona", "send");
    const cancelled=buildResearchIntent("DISPATCH","2026-10-16T10:00:00.001Z","owner","New Hampshire", "cancelled");
    const cancel=buildResearchIntent("CANCEL_DISPATCH",STOP,"owner",cancelled.intentId,"cancel");
    log.push(send,cancelled,cancel);
    for(let at=0;at<log.length;at+=100)await db.query(`INSERT INTO cp_log_research_intents SELECT 'level-1',entry.value->>'intentId',$1::bigint+entry.n,entry.value
      FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY entry(value,n)`,[at,JSON.stringify(log.slice(at,at+100))]);
    const sql={query:async(text:string,params?:readonly unknown[])=>(await db.query(text,[...params??[]])).rows};
    const effective=await pgPlanningIntents(sql,"az",null);
    assert.equal(readIntents(effective).paused,readIntents(log).paused);
    assert.equal(effective.length,4);assert.deepEqual(readIntents(effective).pendingDispatch.map(row=>row.intentId),[send.intentId]);
    assert.equal((await pgPlanningIntents(sql,"az",STOP)).some(row=>row.kind==="INTENT" && row.action==="DISPATCH"),false);
  }finally{await db.close();}
});

test("pausing hunts removes their next-round obligations and resuming restores only the current funded places",async()=>{
  const {deactivateUnfundedHunts,readMaterializedPlanningIds}=await import("../lib/control-plane/repository/pg-store.ts");
  const {repos,scopes}=await setup();
  const stateRepos={...repos,planningState:"az"};
  assert.equal(await deactivateUnfundedHunts(stateRepos,[],STOP),79);
  assert.equal((await readMaterializedPlanningIds(stateRepos,[])).size,0);
  const funded=scopes[0].receiptId;
  const resumed=await readMaterializedPlanningIds(stateRepos,[funded]);
  assert.equal(resumed.size,1);
  await requestHuntStop(repos,{receiptId:"stop-paused-hunts",state:"az",at:STOP,actor:"owner"});
  await applyHuntOrders(repos,"az",STOP);
  assert.equal((await readMaterializedPlanningIds(stateRepos,[funded])).size,0);
});

test("a hunt pause waits for its exact completed-state acknowledgement, regardless of later runner heartbeats",async()=>{
  const {repos,scopes}=await setup();
  const outcome=await submit({type:"expansion.scope.budget",subject:"geo:az.zcta.85000",input:{placeKey:"geo:az.zcta.85000",change:"pause"},
    stateVersion:null,idempotencyKey:"pause-one-hunt-now",caller:"OWNER_SESSION",actorRef:"adm_test"},
    {repos,now:()=>STOP,currentStateVersion:null,codeSha:null});
  assert.equal(outcome.ok,true,outcome.receipt.says);
  assert.equal((await confirmReceipt(repos,outcome.receipt,Date.parse(STOP))).state,"waiting");
  await repos.researchState.put("level-1:az",{cycleFinishedAt:STOP,scopeControls:{[scopeControlKey(scopes[0].key)]:"another-order"}} as never,STOP);
  assert.equal((await confirmReceipt(repos,outcome.receipt,Date.parse(STOP))).state,"waiting");
  const state=await repos.researchState.mustRead("level-1:az");
  await repos.researchState.compareAndSet(state.id,state.revision,{cycleFinishedAt:STOP,scopeControls:{[scopeControlKey(scopes[0].key)]:outcome.receipt.receiptId}} as never,STOP);
  assert.equal((await confirmReceipt(repos,outcome.receipt,Date.parse(STOP))).state,"applied");
});
