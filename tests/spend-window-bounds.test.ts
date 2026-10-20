import assert from "node:assert/strict";
import test from "node:test";
import { ZERO_COST } from "../lib/control-plane/attempt.ts";
import type { SpendHold } from "../lib/control-plane/budget.ts";
import type { CostEntry } from "../lib/control-plane/cost.ts";
import { aggregatePricedSpend, pricedModelCharge, type PricedCharge } from "../lib/control-plane/fleet-safety.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { recordCost } from "../lib/control-plane/repository/coordinator.ts";
import { costRecordId, readSpendWindow, SPEND_WINDOW_ID } from "../lib/control-plane/spend-window.ts";

const NOW="2026-10-20T12:00:00.000Z";
const entry=(id:string,usd=1):CostEntry=>({attemptId:id,workItemId:id,routeTaskId:id,routeId:null,source:"api.anthropic.com",jurisdiction:"own-place",
  project:"freshness",role:"SCOUT",model:"claude-haiku-4-5",recordedAt:NOW,cost:{...ZERO_COST,usd,requestCount:1}});

test("the spend snapshot pages stable ids across concurrent prefix expiry and never opens a complete counter",async()=>{
  const repos=createMemoryRepositories();
  const own=Array.from({length:100},(_,n)=>pricedModelCharge(entry(`job-${n}`),String(n).padStart(4,"0"))!);
  await repos.spendWindow.put(SPEND_WINDOW_ID,{charges:[{...own[0],id:"expired",at:"2026-10-01T00:00:00Z"},...own]},NOW);
  repos.spendWindow.read=async()=>{throw new Error("Country counter read forbidden");};
  repos.spendWindow.compareAndSet=async()=>{throw new Error("Country counter rewrite forbidden");};
  repos.costs.readChangedSince=async()=>{throw new Error("Initialized counter must not scan the ledger");};
  const read=repos.spendWindow.readArrayPage!.bind(repos.spendWindow);
  let pages=0,largest=0;
  repos.spendWindow.readArrayPage=async(id,field,query)=>{
    const page=await read(id,field,query);largest=Math.max(largest,page?.values.length??0);
    if(query?.order&&++pages===1){
      const current=await repos.spendWindow.readNarrowed(SPEND_WINDOW_ID,{});
      assert.equal(field,"charges");
      await repos.spendWindow.compareAndSetArrayItem!(id,current!.revision,"charges",["id"],"expired",null,NOW);
    }
    return page;
  };
  const snapshot=await readSpendWindow(repos,NOW);
  try{
    assert.equal(snapshot.size,100);assert.equal(largest,32);assert.equal(pages,4);
    assert.deepEqual(Array.from(snapshot,c=>c.id),own.map(c=>c.id));
    assert.deepEqual(Array.from(snapshot,c=>c.id),own.map(c=>c.id),"a second fold traverses the same disk snapshot");
    assert.deepEqual(snapshot.get("0003"),JSON.parse(JSON.stringify(own[3])));
    assert.deepEqual(Array.from(snapshot.forJob(own[3].jobId)),[JSON.parse(JSON.stringify(own[3]))]);
  }finally{snapshot.close();}
  assert.throws(()=>snapshot.get("0003"),/CLOSED/);
});

test("an interrupted first seed refuses a reading and resumes idempotently; counts arriving during the seed remain charged",async()=>{
  const repos=createMemoryRepositories(),first=entry("first"),late=entry("late",2);
  await repos.costs.append(first.workItemId,costRecordId(first),first,NOW);
  const read=repos.costs.readChangedSince.bind(repos.costs);
  let interrupted=true,added=false;
  repos.costs.readChangedSince=async(since,held,options)=>{
    const result=await read(since,held,options);
    if(!added){added=true;await recordCost(repos,late,NOW);}
    if(interrupted)throw new Error("Seed interrupted");
    return result;
  };
  await assert.rejects(readSpendWindow(repos,NOW),/Seed interrupted/);
  assert.equal(((await repos.spendWindow.readNarrowed(SPEND_WINDOW_ID,{seedState:true}))!.value as {seedState:string}).seedState,"SEEDING");
  interrupted=false;
  const snapshot=await readSpendWindow(repos,NOW);
  try{assert.equal(snapshot.size,2);assert.equal(aggregatePricedSpend(snapshot,NOW,NOW).usd,3);}
  finally{snapshot.close();}
  assert.equal(((await repos.spendWindow.readNarrowed(SPEND_WINDOW_ID,{seedState:true}))!.value as {seedState:string}).seedState,"READY");
});

test("country job and hold joins fold repeatable streams without losing known prices or exact hold attribution",()=>{
  const count=5000,base=pricedModelCharge(entry("base"),"base")!;
  const charges:Iterable<PricedCharge>={[Symbol.iterator]:function*(){
    for(let n=0;n<count;n++){
      const jobId=`job-${n}`;
      yield{...base,id:`${n}:measured`,jobId,usd:.01,knownUsd:.01,measured:true,bounded:false};
      yield{...base,id:`${n}:bounded`,jobId,usd:10,knownUsd:0,measured:false,bounded:true};
    }
  }};
  const holds:Iterable<SpendHold>={[Symbol.iterator]:function*(){
    for(let n=0;n<count;n++){
      const first:SpendHold={holdId:`${n}:one`,jobId:`job-${n}`,obligationId:"own",keys:[],usd:.02,heldAt:NOW,what:"send maximum",settled:null};
      yield first;yield first;
      yield{...first,holdId:`${n}:two`,usd:.03,settled:{usd:0,costRecordedAt:NOW}};
    }
    yield{holdId:"unrelated",jobId:"another-job",obligationId:"own",keys:[],usd:1000,heldAt:NOW,what:"unrelated hold",settled:null};
  }};
  const total=aggregatePricedSpend(charges,NOW,NOW,holds);
  assert.ok(Math.abs(total.usd-count*.05)<1e-8);assert.ok(Math.abs(total.knownUsd-count*.01)<1e-8);
  assert.equal(total.measured,count);assert.equal(total.unmeasured,count);assert.equal(total.worstCaseCharges,count);
  assert.deepEqual(aggregatePricedSpend(charges,NOW,NOW,holds),total,"every fold is repeatable");
});
