import assert from "node:assert/strict";
import test from "node:test";
import { CycleWorkset } from "../lib/control-plane/scheduler/cycle-workset.ts";
import { DiskRows } from "../lib/control-plane/scheduler/disk-rows.ts";
import { CycleRecords } from "../lib/control-plane/scheduler/cycle-records.ts";
import { runCycleQueue } from "../lib/control-plane/scheduler/cycle-queue.ts";
import { runPool } from "../lib/control-plane/scheduler/shadow-loop.ts";
import type { DispatchResult } from "../lib/control-plane/scheduler/dispatch.ts";
import { aggregateIncidents, recordFailure } from "../lib/control-plane/scheduler/debt.ts";
import { scheduleAll, dueNow, plainCodeQueueOrder, type FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";

const NOW="2026-10-20T12:00:00.000Z",nowMs=Date.parse(NOW);
const obligation=(id:string,nextDueAt:string):FreshnessObligation=>({id,recordClass:"ROSTER",subjectId:id,routeId:null,active:true,readerImpactAt:null,observedChangeRateHours:null,lastWorkedAt:null,nextDueAt});

test("disk scheduling and debt order equal the existing queue, including retry, owner placement and hunt rounds",async()=>{
  const store=await CycleWorkset.open();
  try {
    const obligations=[obligation("a","2026-10-19T00:00:00Z"),obligation("b","2026-10-18T00:00:00Z"),obligation("c","2026-10-17T00:00:00Z"),obligation("d","2026-10-16T00:00:00Z")];
    const debt=recordFailure(null,{obligationId:"b",cause:"UPSTREAM_ERROR",detail:"original",target:"route",dueAt:obligations[1].nextDueAt!,now:"2026-10-20T11:00:00Z"});
    store.addDebt(debt,nowMs,true);
    const pass=scheduleAll(obligations,nowMs);
    for(const row of pass.scheduled)store.add(row,row.obligation.id==="d",nowMs);
    const due=dueNow(pass,nowMs);
    const expected=plainCodeQueueOrder(due,id=>id==="b"?debt:undefined);
    expected.sort((a,b)=>Number(b.obligation.id==="d")-Number(a.obligation.id==="d"));
    await store.classify(undefined);store.prepareQueue(undefined);
    assert.deepEqual([...store.pending()].map(slot=>slot.row.obligation.id),expected.map(row=>row.obligation.id));
    store.clearDebt("b");assert.equal(store.debts.length,0);assert.deepEqual(store.debt("b",true),debt,"cycle-start debt is retained after discharge for exact waiting-age accounting");
    store.sortPending((a,b)=>b.obligation.id.localeCompare(a.obligation.id));
    assert.deepEqual([...store.pending()].map(slot=>slot.row.obligation.id),["d","c","b","a"]);
    store.sortPending(()=>0);
    assert.deepEqual([...store.pending()].map(slot=>slot.row.obligation.id),["d","c","b","a"],"ties keep the most recently sorted order");
  } finally {await store.close();}
});

test("disk incident aggregation preserves every debt, group order, oldest example and retry",async()=>{
  const store=await CycleWorkset.open();
  try {
    const debts=Array.from({length:1000},(_,n)=>recordFailure(null,{obligationId:`o${n}`,cause:n%3?"UPSTREAM_ERROR":"RATE_LIMITED",detail:`detail${n}`,target:`target${n%7}`,dueAt:new Date(nowMs-n*3600000).toISOString(),now:NOW}));
    for(const debt of debts)store.addDebt(debt,nowMs,true);
    store.buildIncidents(nowMs);
    assert.deepEqual([...store.incidents],aggregateIncidents(debts,nowMs));
    assert.deepEqual([...store.debts],debts);
  } finally {await store.close();}
});

test("disk views are repeatable and lazy through projections, filters, slices and visitors",async()=>{
  let live=0;
  const rows=new DiskRows(function*(){for(let n=0;n<100000;n++){live++;try{yield n;}finally{live--;}}});
  const view=rows.filter(n=>n%2===0).map(n=>n+1).slice(3,8);
  assert.deepEqual([...view],[7,9,11,13,15]);assert.equal(view.length,5);assert.equal(live,0);
  let sum=0;await view.visit(n=>{assert.equal(live,1);sum+=n;});assert.equal(sum,55);assert.equal(live,0);
});

test("the persistence pool reads only active rows and joins every operation before reporting its first failure",async()=>{
  let pulled=0,settled=0,active=0,maximum=0;
  const first=new Error("first operation failed"),later=new Error("later operation failed");
  const rows={*[Symbol.iterator](){for(let n=0;n<10000;n++){pulled++;yield n;}}};
  await assert.rejects(runPool(rows,3,async n=>{
    active++;maximum=Math.max(maximum,active);
    assert.ok(pulled-settled<=3,"only active operations retain a source row");
    try{await Promise.resolve();if(n===0)throw first;if(n===2)throw later;}
    finally{active--;settled++;}
  }),error=>error===first);
  assert.equal(settled,10000);assert.equal(active,0);assert.equal(maximum,3);
});

test("cycle recording keeps simulation and foreign leases owed while failures retain their original debt age",async()=>{
  const store=await CycleWorkset.open();
  try {
    const row=scheduleAll([obligation("a","2026-10-18T00:00:00Z")],nowMs).scheduled[0];store.add(row,false,nowMs);
    const original=recordFailure(null,{obligationId:"a",cause:"UPSTREAM_ERROR",detail:"original",target:"a",dueAt:row.nextDueAt,now:"2026-10-19T00:00:00Z"});
    store.addDebt(original,nowMs,true);const records=new CycleRecords(store,NOW);
    const result:DispatchResult={obligationId:"a",routeTaskId:null,executor:null,executorChosen:null,decisionDisagreement:null,executorMismatch:false,claimed:false,outcome:"SIMULATED",attemptId:null,dispositionCommitted:false,disposition:null,artifactIds:[],cost:null,worker:null,detail:"not run"};
    records.record(row,result);assert.deepEqual(store.debt("a"),original);
    records.record(row,{...result,outcome:"NOT_CLAIMED"});assert.deepEqual(store.debt("a"),original);
    records.record(row,{...result,outcome:"NO_ROUTE_TASK",detail:"no route"});
    assert.equal(store.debt("a")?.consecutiveFailures,2);assert.equal(store.debt("a")?.firstFailedAt,original.firstFailedAt);
    assert.equal(store.output("dispatched").length,3);assert.equal(store.output("simulated").length,1);
    assert.deepEqual(records.outcomes,{SIMULATED:1,NOT_CLAIMED:1,NO_ROUTE_TASK:1});
  } finally {await store.close();}
});

test("disk selection preserves hunt rounds across place changes and provider concurrency",async()=>{
  const store=await CycleWorkset.open();
  try {
    const rows=scheduleAll(["a1","a2","b1","b2"].map(id=>obligation(id,NOW)),nowMs).scheduled;
    for(const row of rows)store.add(row,false,nowMs);
    await store.classify(undefined);store.prepareQueue(row=>row.obligation.id[0]);
    const started:string[]=[],active=new Map<string,number>();let revision=0;
    await runCycleQueue(store,{capacity:3,huntRounds:true,
      placePriority:async()=>({revision:String(revision),rank:id=>revision===0?(id[0]==="a"?0:1):(id[0]==="b"?0:1)}),
      providerLimitOf:row=>({key:row.obligation.id[0],limit:1}),run:async slot=>{
        const id=slot.row.obligation.id,key=id[0];assert.equal(active.get(key)??0,0);active.set(key,1);started.push(id);
        if(started.length===1)revision++;
        await new Promise<void>(resolve=>setTimeout(resolve,1));active.set(key,0);
      }});
    assert.deepEqual(started.slice(0,2),["a1","b1"]);assert.deepEqual(new Set(started),new Set(["a1","a2","b1","b2"]));
  } finally {await store.close();}
});
