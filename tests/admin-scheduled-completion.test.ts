import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { submit } from "@/lib/control-plane/gateway/gateway.ts";
import { fireDueOrders } from "@/lib/control-plane/gateway/scheduled-fire.ts";
import { ADMIN_CONFIG_ID } from "@/lib/control-plane/gateway/admin-config.ts";
import { RESEARCH_FORMAT_VERSION, RESEARCH_INTENT_LOG_KEY } from "@/lib/control-plane/scheduler/research-policy.ts";
import type { GatewayDeps } from "@/lib/control-plane/gateway/registry.ts";
const NOW="2026-10-05T18:00:00Z";
const setup=()=>{const repos=createMemoryRepositories();const d:GatewayDeps={repos,now:()=>NOW,currentStateVersion:null,codeSha:null};return {repos,d};};
const schedule=(d:GatewayDeps,key:string,orderType:string,input:Record<string,unknown>,when:Record<string,unknown>)=>submit({type:"orders.schedule",subject:"",input:{orderType,input,...when},stateVersion:null,idempotencyKey:key,caller:"OWNER_SESSION",actorRef:"adm_test"},d);
test("after waits for the child to be Done, including after the first schedule is removed",async()=>{
 const {repos,d}=setup();const first=await schedule(d,"seq-first-one","runner.pause",{},{startAt:NOW});assert.equal(first.ok,true);
 const second=await schedule(d,"seq-second-one","runner.resume",{},{after:first.receipt.subject});assert.equal(second.ok,true);
 assert.equal((await fireDueOrders(d,NOW)).length,1);
 assert.equal((await fireDueOrders(d,NOW)).length,0,"removed schedule is not completion");
 const pause=(await repos.adminReceipts.readAll()).find(r=>r.type==="runner.pause")!;
 assert.equal(pause.scheduleOrigin!.id,first.receipt.subject);
 await repos.researchIntents.append(RESEARCH_INTENT_LOG_KEY,"seq-honored",{formatVersion:RESEARCH_FORMAT_VERSION,kind:"HONORED",intentId:"seq-honored",honors:pause.subject,action:"PAUSE_RUNNER",honoredAt:NOW,honoredBy:"test",detail:""},NOW);
 assert.equal((await fireDueOrders(d,NOW)).length,1);assert.equal((await fireDueOrders(d,NOW)).length,0);
});
test("a late finish-by still sends, records its due date and preserves a config action's value",async()=>{
 const {repos,d}=setup();const order=await schedule(d,"late-config-one","config.setSetting",{key:"detective.shutThreshold",value:3},{startAt:"2026-10-04T18:00:00Z",finishBy:"2026-10-04T19:00:00Z"});assert.equal(order.ok,true,order.receipt.says);
 const fired=await fireDueOrders(d,NOW);assert.equal(fired.length,1);assert.equal(fired[0].ok,true);
 const config=(await repos.adminConfig.read(ADMIN_CONFIG_ID))!.value;assert.equal(config.settings!["detective.shutThreshold"],3);assert.equal(config.scheduledOrders!.length,0);
 const receipt=(await repos.adminReceipts.readAll()).find(r=>r.type==="config.setSetting")!;assert.equal(receipt.scheduleOrigin!.finishBy,"2026-10-04T19:00:00Z");assert.equal((await fireDueOrders(d,NOW)).length,0);
});
test("a repeating config action advances once and restart uses its saved occurrence",async()=>{
 const {repos,d}=setup();const scheduled=await schedule(d,"repeat-config-one","config.setSetting",{key:"detective.shutThreshold",value:3},{startAt:NOW,repeat:"hourly"});assert.equal(scheduled.ok,true);
 assert.equal((await fireDueOrders(d,NOW)).length,1);assert.equal((await fireDueOrders(d,"2026-10-05T18:30:00Z")).length,0);assert.equal((await fireDueOrders(d,"2026-10-05T19:00:00Z")).length,1);
 assert.equal((await repos.adminReceipts.readAll()).filter(r=>r.type==="config.setSetting").length,2);
});
