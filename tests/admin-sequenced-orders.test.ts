import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { submit } from "@/lib/control-plane/gateway/gateway.ts";
import { confirmReceipt } from "@/lib/control-plane/gateway/confirmation.ts";
import { fireDueOrders } from "@/lib/control-plane/gateway/scheduled-fire.ts";
import { parsePlainOrder } from "@/lib/control-plane/operator-chat/orders.ts";
import { RESEARCH_FORMAT_VERSION,RESEARCH_INTENT_LOG_KEY,RESEARCH_STATE_ID,type ResearchState } from "@/lib/control-plane/scheduler/research-policy.ts";
const AT="2026-10-05T18:00:00Z";
test("the example reads back two linked registered orders in the selected district",()=>{
 const order=parsePlainOrder("Put everything on school boards in this district until they're done, then go back to candidates",{nowIso:AT,from:"/admin?scope=geo:az.congressional_district.0406",stateVersion:null});
 assert.ok(order&&"type" in order);if(!order||!("type" in order))return;
 assert.equal(order.type,"orders.sequence");assert.match(order.willDo,/First:.*school boards.*When its work is done:.*candidates/);
 const inputs=order.input as {first:{input:{note:string}};second:{input:{note:string}}};assert.match(inputs.first.input.note,/AZ 0406/);assert.match(inputs.second.input.note,/AZ 0406/);
});
test("pickup is not Done for an until-done send; its second order fires only after recorded work completion",async()=>{
 const repos=createMemoryRepositories();const deps={repos,now:()=>AT,currentStateVersion:null,codeSha:null};
 const out=await submit({type:"orders.sequence",subject:"st:az",input:{first:{type:"fleet.deployHere",subject:"st:az",input:{note:"Arizona"}},second:{type:"fleet.deployHere",subject:"st:az",input:{note:"Arizona candidates"}}},stateVersion:null,idempotencyKey:"sequence-one",caller:"OWNER_SESSION",actorRef:"adm_test"},deps);assert.equal(out.ok,true,out.receipt.says);
 const receipts=await repos.adminReceipts.readAll();const first=receipts.find(r=>r.type==="fleet.deployHere")!;assert.equal(first.untilDone,true);assert.equal((await fireDueOrders(deps,AT)).length,0);
 await repos.researchIntents.append(RESEARCH_INTENT_LOG_KEY,"sequence-honor",{formatVersion:RESEARCH_FORMAT_VERSION,kind:"HONORED",intentId:"sequence-honor",honors:first.subject,action:"DISPATCH",honoredAt:AT,honoredBy:"test",detail:""},AT);
 assert.equal((await confirmReceipt(repos,first,Date.parse(AT))).state,"in-progress");assert.equal((await fireDueOrders(deps,AT)).length,0,"runner pickup alone cannot fire the sequence");
 await repos.researchState.put(RESEARCH_STATE_ID,{formatVersion:RESEARCH_FORMAT_VERSION,assignments:{at:AT,assignments:[{ref:first.subject,completion:{kind:"COMPLETE"}}]}} as unknown as ResearchState,AT);
 assert.equal((await confirmReceipt(repos,first,Date.parse(AT))).state,"applied");assert.equal((await fireDueOrders(deps,AT)).length,1);assert.equal((await fireDueOrders(deps,AT)).length,0);
 const sends=(await repos.adminReceipts.readAll()).filter(r=>r.type==="fleet.deployHere");assert.equal(sends.length,2);assert.equal(sends[1].requestedSubject,"st:az");
});

test("a family filter cannot silently disappear from an until-done sequence",async()=>{
 const repos=createMemoryRepositories();const order=parsePlainOrder("Put everything on school boards in this district until they're done, then go back to candidates",{nowIso:AT,from:"/admin?scope=geo:az.congressional_district.0406",stateVersion:null});assert.ok(order&&"type" in order);if(!order||!("type" in order))return;
 const out=await submit({type:order.type,subject:order.subject,input:order.input,stateVersion:null,idempotencyKey:"sequence-filter-one",caller:"OWNER_SESSION",actorRef:"adm_test"},{repos,now:()=>AT,currentStateVersion:null,codeSha:null});
 assert.equal(out.ok,false,"BR-22's filter must land before this example can execute");assert.match(out.receipt.says,/focus is not connected/);assert.equal((await repos.researchIntents.readAll()).length,0);
});
