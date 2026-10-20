import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { runCycle } from "../lib/control-plane/scheduler/shadow-loop.ts";
import { recordFailure } from "../lib/control-plane/scheduler/debt.ts";
import type { CycleInput } from "../lib/control-plane/scheduler/shadow-loop.ts";
import type { FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";

const NOW="2026-10-20T12:00:00Z",nowMs=Date.parse(NOW);
const obligation=(n:number):FreshnessObligation=>({id:`o${n}`,recordClass:"ROSTER",subjectId:`place${n%7}`,routeId:null,active:n%13!==0,readerImpactAt:null,observedChangeRateHours:null,lastWorkedAt:null,nextDueAt:new Date(nowMs-(n%11)*3600000).toISOString()});

test("the mixed cycle preserves the prior cycle's recorded ordering, backoffs, lane reasons, debts and risk",async()=>{
  const obligations=Array.from({length:75},(_,n)=>obligation(n));
  const debts=obligations.filter((_,n)=>n%5===0).map((row,n)=>recordFailure(null,{obligationId:row.id,cause:n%3===0?"AWAITING_ADAPTER":"UPSTREAM_ERROR",detail:`failure${n}`,target:row.subjectId,dueAt:row.nextDueAt!,now:new Date(nowMs-(n%2)*3600000).toISOString()}));
  const input:CycleInput={repos:createMemoryRepositories(),obligations,debts,routeTaskFor:()=>null,maturity:()=>"GRADUATED",holder:"fixture",now:NOW,leaseTtlMs:60000,maxDispatches:7,workerCapacity:1,skipReclaim:true,
    executor:{lane:"DETERMINISTIC",run:async()=>{throw new Error("no task");}},
    placeFirst:new Set(["o71","o19"]),huntFor:row=>row.obligation.subjectId,
    placeComparator:async()=>(a,b)=>b.obligation.subjectId.localeCompare(a.obligation.subjectId),
    research:{decide:row=>({kind:Number(row.obligation.id.slice(1))%3?"DETERMINISTIC":"BOUNDED_MODEL_WORKER",why:"fixture",disagreement:null})}};
  const cycle=await runCycle(input);
  try{
    assert.deepEqual([...cycle.dispatched].map(row=>row.obligationId),["o41","o19","o32","o31","o16","o71","o7"]);
    assert.equal(cycle.deferred.length,63);assert.equal(cycle.debts.length,22);assert.equal(cycle.incidents.length,19);
    assert.deepEqual(cycle.risk,{obligationsScheduled:69,obligationsUnscheduled:6,obligationsOverdue:60,debtRows:22,incidents:19,oldestDebtHours:10,activation:"SHADOW_NOT_ACTIVATED"});
    assert.deepEqual(cycle.lanes,{deterministic:{due:41,dispatched:7,deferredBy:{DISPATCH_CEILING:34},recovered:0,oldestWaitingDueAt:"2026-10-20T02:00:00.000Z"},model:{due:19,dispatched:0,deferred:19,deferredBy:{HUNTED_IN_PACKET:19},recovered:0,oldestWaitingDueAt:"2026-10-20T02:00:00.000Z"}});
  }finally{await cycle.close();}
});

test("a source streams a country backlog and hydrates only admitted rows while every hold remains on disk",async()=>{
  let visited=0,hydrated=0,active=0,maxActive=0;
  const count=20000;
  const result=await runCycle({repos:createMemoryRepositories(),debts:[],obligationSource:{visit:async visit=>{for(let n=1;n<=count;n++){visited++;await visit(obligation(n));}},read:async id=>{hydrated++;return {...obligation(Number(id.slice(1))),active:true};}},
    routeTaskFor:()=>null,maturity:()=>"GRADUATED",holder:"fixture",now:NOW,leaseTtlMs:60000,maxDispatches:3,workerCapacity:2,skipReclaim:true,
    executor:{lane:"DETERMINISTIC",run:async()=>{active++;maxActive=Math.max(maxActive,active);await Promise.resolve();active--;return {ranAs:"DETERMINISTIC",kind:"ABORTED",detail:"fixture"};}}});
  try{
    assert.equal(visited,count);assert.equal(hydrated,3);assert.equal(result.dispatched.length,3);
    assert.equal(result.deferred.length,result.dueCount-3);assert.equal(result.schedule.scheduled.length+result.schedule.unscheduled.length,count);
    assert.equal(result.summary.outcomes.NO_ROUTE_TASK,3);assert.ok(maxActive<=2);
    let deferred=0;await result.deferred.visit(()=>{deferred++;});assert.equal(deferred,result.deferred.length);
  }finally{await result.close();}
});
