import assert from "node:assert/strict";
import test from "node:test";
import { orderWhen, scheduledWhen } from "@/app/(admin)/_mw/admin-v6/order-when.ts";
import { liveExecutor } from "@/app/(admin)/_mw/admin-v6/executor.ts";
import { actionDef } from "@/app/(admin)/_mw/admin-v6/actions.ts";
import { startReceipt } from "@/app/(admin)/_mw/admin-v6/receipts.ts";
import { buildQueue, type QueueInput } from "@/app/(admin)/_mw/admin-v6/queue.ts";
import { projectV6History } from "@/lib/control-plane/admin-view/admin-v6-history.ts";
import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { submit } from "@/lib/control-plane/gateway/gateway.ts";
const at="2026-10-06T13:00:00Z";
test("every calendar entry uses Eastern time; a nonexistent spring time is refused",()=>{
 assert.equal(orderWhen("at","2026-01-06T09:00","","daily","")?.startAt,"2026-01-06T14:00:00.000Z");assert.equal(orderWhen("at","2026-07-06T09:00","","daily","")?.startAt,"2026-07-06T13:00:00.000Z");assert.equal(orderWhen("at","2026-03-08T02:30","","daily",""),null);
 assert.deepEqual(orderWhen("after","","child-1","daily",""),{mode:"after",after:"child-1"});assert.equal(orderWhen("after","","","daily",""),null);
 assert.deepEqual(scheduledWhen({mode:"finish-by",finishBy:"2026-10-07T13:00:00Z"},at),{startAt:at,after:null,repeat:null,finishBy:"2026-10-07T13:00:00Z"});
});
test("When sends the exact selected registered order through the scheduler, and now records a separate wake",async()=>{
 const bodies:Record<string,unknown>[]=[];const def=actionDef("global-runner-pause");
 const ex=liveExecutor({capabilities:()=>null,now:()=>at,fetch:async(_url,init)=>{bodies.push(JSON.parse(init.body??"{}"));return {status:200,json:async()=>({ok:true})};}});
 const r=startReceipt({key:"when-test",def,target:"runner",targetName:"Runner",scopeKey:"us",scopeName:"United States",label:def.label,level:"global",at,simulated:false});
 const req={def,target:"runner",scopeKey:"us",option:null,words:"",amount:"",selectedItems:[]};
 await ex.send(r,{...req,when:{mode:"repeat",startAt:at,repeat:"hourly"}},()=>{});assert.equal(bodies[0].type,"orders.schedule");const scheduledInput=bodies[0].input as Record<string,unknown>;assert.equal(scheduledInput.orderType,"runner.pause");assert.equal(scheduledInput.repeat,"hourly");
 const repos=createMemoryRepositories();const outcome=await submit({type:"orders.schedule",subject:String(bodies[0].subject),input:scheduledInput,stateVersion:null,idempotencyKey:"when-live-shape",caller:"OWNER_SESSION",actorRef:"owner"},{repos,now:()=>at,currentStateVersion:null,codeSha:null});assert.equal(outcome.ok,true,outcome.receipt.says);
 await ex.send({...r,key:"when-now"},{...req,when:{mode:"now"}},()=>{});assert.equal(bodies[1].type,"runner.pause");assert.equal(bodies[2].type,"runner.runCycleNow");assert.equal(bodies[2].idempotencyKey,"when-now-start-now");ex.dispose?.();
});
test("late finish-by is the Queue due date and is red without pausing the runner; not-picked-up survives a reload",async()=>{
 const repos=createMemoryRepositories();const deps={repos,now:()=>at,currentStateVersion:null,codeSha:null};
 const out=await submit({type:"runner.pause",subject:"us",input:{},stateVersion:null,idempotencyKey:"late-queue-order",caller:"OWNER_SESSION",actorRef:"owner",scheduleOrigin:{id:"schedule-1",occurrence:at,finishBy:"2026-10-06T12:00:00Z"}},deps);
 const receipt=projectV6History([out.receipt],{scope:"us",asOf:at},new Map([[out.receipt.receiptId,{state:"not-picked-up",words:"The runner has not checked in",at:null}]])).data[0];
 assert.equal(receipt.notPickedUp,true);
 const input:QueueInput={receipts:[receipt],sends:null,hunts:null,stuck:null,fixes:null,doors:null,scheduled:null};const row=buildQueue(input,Date.parse(at))[0];assert.equal(row.tone,"warn");assert.equal(row.chip,"Late");assert.match(row.due!,/Finish by/);assert.match(row.next,/Past its finish-by/);assert.equal(row.filter,"needs-me");
 const scheduled=buildQueue({...input,receipts:null,scheduled:[{id:"later",label:"Refresh records",when:"Today",repeats:null,finishBy:"8:00 AM",finishByAt:"2026-10-06T12:00:00Z"}]},Date.parse(at))[0];assert.equal(scheduled.tone,"warn");assert.equal(scheduled.chip,"Late");assert.equal(scheduled.filter,"scheduled");
});
test("a saved schedule is Scheduled once; after firing its child replaces the parent receipt",async()=>{
 const repos=createMemoryRepositories();const deps={repos,now:()=>at,currentStateVersion:null,codeSha:null};
 const out=await submit({type:"orders.schedule",subject:"us",input:{orderType:"runner.pause",subject:"us",input:{},startAt:"2026-10-07T13:00:00Z"},stateVersion:null,idempotencyKey:"queue-schedule-one",caller:"OWNER_SESSION",actorRef:"owner"},deps);
 const receipt=projectV6History([out.receipt],{scope:"us",asOf:at},new Map([[out.receipt.receiptId,{state:"waiting",words:"Scheduled. The timer will send it tomorrow.",at:null}]])).data[0];assert.equal(receipt.status,"queued");
 const input:QueueInput={receipts:[receipt],sends:null,hunts:null,stuck:null,fixes:null,doors:null,scheduled:[{id:out.receipt.receiptId,label:"Pause the runner",when:"Tomorrow",repeats:null,finishBy:null}]};assert.equal(buildQueue(input).length,1);assert.equal(buildQueue(input)[0].filter,"scheduled");
 const child={...receipt,key:"child-one",gatewayReceiptId:"child-one",gatewayType:"runner.pause",scheduledParentId:out.receipt.receiptId};const rows=buildQueue({...input,scheduled:[],receipts:[receipt,child]});assert.equal(rows.length,1);assert.equal(rows[0].key,"order:child-one");
});
