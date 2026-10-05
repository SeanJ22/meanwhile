import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { raiseDecisionOrder, decisionOrders } from "@/lib/control-plane/decision-cards.ts";
import { ADMIN_CONFIG_ID, fleetSpendCeilingOverrideUsd } from "@/lib/control-plane/gateway/admin-config.ts";
import { submit } from "@/lib/control-plane/gateway/gateway.ts";
import { confirmReceipt } from "@/lib/control-plane/gateway/confirmation.ts";
import { easternLocalToIso } from "@/lib/control-plane/eastern-time.ts";
const AT="2026-10-05T18:00:00Z";
const setup=async()=>{
 const repos=createMemoryRepositories();const deps={repos,now:()=>AT,currentStateVersion:"pulse",codeSha:null};
 const proposal={need:"money" as const,happening:"The current ceiling stops the paid queue.",recommends:"Set the daily ceiling to $80",cost:"Up to $80 per day",gets:"The waiting work can continue within that ceiling.",order:{type:"config.setFleetSpendCeiling",subject:"us",input:{rollingCeilingUsd:80}},fields:[{key:"rollingCeilingUsd",label:"Daily ceiling ($)",kind:"number" as const}],raisedAt:AT};
 const card=await raiseDecisionOrder(repos,proposal);
 const decide=(key:string,option:string,extra:Record<string,unknown>={})=>submit({type:"decision.record",subject:card.id,input:{decisionId:card.id,cardVersion:card.version,option,...extra},stateVersion:"pulse",idempotencyKey:key,caller:"OWNER_SESSION",actorRef:"adm_test"},deps);
 return {repos,deps,proposal,card,decide};
};
test("a card stores the exact order; approval submits it once and follows its receipt",async()=>{
 const s=await setup();assert.equal(fleetSpendCeilingOverrideUsd((await s.repos.adminConfig.read(ADMIN_CONFIG_ID))!.value),null,"raising a card never decides the budget");
 assert.equal((await raiseDecisionOrder(s.repos,s.proposal)).id,s.card.id);
 const result=await s.decide("card-approve-one","approve");assert.equal(result.ok,true,result.receipt.says);
 const replay=await s.decide("card-approve-one","approve");assert.equal(replay.replayed,true);
 const config=(await s.repos.adminConfig.read(ADMIN_CONFIG_ID))!.value;assert.equal(fleetSpendCeilingOverrideUsd(config),80);
 const card=decisionOrders(config)[0];assert.equal(card.resolution!.receiptId,result.receipt.openedWork[0].id);
 assert.equal((await s.repos.adminReceipts.readAll()).filter(r=>r.type==="config.setFleetSpendCeiling").length,1);
 assert.equal((await confirmReceipt(s.repos,result.receipt,Date.parse(AT))).state,"waiting","accepted child still waits for its runner");
});
test("decline needs a reason and does not send the recommendation",async()=>{
 const s=await setup();assert.equal((await s.decide("card-no-reason","decline")).ok,false);
 const result=await s.decide("card-decline-one","decline",{words:"Keep the present limit."});assert.equal(result.ok,true);
 const config=(await s.repos.adminConfig.read(ADMIN_CONFIG_ID))!.value;assert.equal(fleetSpendCeilingOverrideUsd(config),null);assert.equal(decisionOrders(config)[0].resolution!.reason,"Keep the present limit.");
});
test("change validates the edited input; schedule saves the exact recommendation without spending now",async()=>{
 const s=await setup();assert.equal((await s.decide("card-change-bad","change",{fields:{rollingCeilingUsd:"abc"}})).ok,false);
 assert.equal((await s.decide("card-change-one","change",{fields:{rollingCeilingUsd:"50"}})).ok,true);
 assert.equal(fleetSpendCeilingOverrideUsd((await s.repos.adminConfig.read(ADMIN_CONFIG_ID))!.value),50);
 const other=await setup();assert.equal((await other.decide("card-schedule-one","schedule",{startAt:"2026-10-06T18:00:00Z"})).ok,true);
 const config=(await other.repos.adminConfig.read(ADMIN_CONFIG_ID))!.value;assert.equal(fleetSpendCeilingOverrideUsd(config),null);assert.equal(config.scheduledOrders![0].input.rollingCeilingUsd,80);
});
test("a stale card or an agent cannot approve a recommendation",async()=>{
 const s=await setup();assert.equal((await s.decide("card-stale-one","approve",{cardVersion:"old"})).ok,false);
 const out=await submit({type:"decision.record",subject:s.card.id,input:{decisionId:s.card.id,cardVersion:s.card.version,option:"approve"},stateVersion:"pulse",idempotencyKey:"card-agent-one",caller:"AGENT",actorRef:"agent"},s.deps);assert.equal(out.ok,false);
 await assert.rejects(raiseDecisionOrder(s.repos,{...s.proposal,need:"routine" as never}));
});
test("the retired route and local sync are gone; schedule times are Eastern across daylight changes",()=>{
 assert.equal(existsSync("app/api/admin/decision/route.ts"),false);assert.equal(existsSync("scripts/apply-owner-decisions.mts"),false);assert.doesNotMatch(readFileSync("package.json","utf8"),/"decisions:sync"/);
 assert.equal(easternLocalToIso("2026-07-05T09:00"),"2026-07-05T13:00:00.000Z");assert.equal(easternLocalToIso("2026-01-05T09:00"),"2026-01-05T14:00:00.000Z");assert.equal(easternLocalToIso("2026-03-08T02:30"),null);
});

test("competing owner sessions send only one order for the same card",async()=>{
 const s=await setup();
 const results=await Promise.all([s.decide("card-race-approve","approve"),s.decide("card-race-change","change",{fields:{rollingCeilingUsd:50}})]);
 assert.equal(results.filter(r=>r.ok).length,1);
 assert.equal((await s.repos.adminReceipts.readAll()).filter(r=>r.type==="config.setFleetSpendCeiling"&&r.outcome!=="REFUSED").length,1);
 assert.ok(decisionOrders((await s.repos.adminConfig.read(ADMIN_CONFIG_ID))!.value)[0].resolution);
});
