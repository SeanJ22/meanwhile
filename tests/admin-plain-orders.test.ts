import assert from "node:assert/strict";
import test from "node:test";
import { respondToOperator } from "@/lib/control-plane/operator-chat/turn.ts";
import { actionDefinitions } from "@/lib/control-plane/gateway/registry.ts";
import { defaultAdminConfig } from "@/lib/control-plane/gateway/admin-config.ts";
import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { submit } from "@/lib/control-plane/gateway/gateway.ts";
import { parsePlainOrder } from "@/lib/control-plane/operator-chat/orders.ts";
const AT="2026-10-05T18:00:00Z";
const context={nowIso:AT,from:"/admin?scope=geo:az.congressional_district.0406",stateVersion:null,adminConfig:defaultAdminConfig(AT)};
test("each BR-18 phrase is a sendable proposal, and only confirmation submits the registered order",async()=>{
 for(const text of ["send agents to Arizona","start a mission in Arizona","set the budget to $80","pause all workers","resume paid research","take back DISPATCH:2026-10-05T17:00:00Z"]){
  const repos=createMemoryRepositories();let submissions=0;
  const deps={actorRef:"adm_test",gateway:{registry:actionDefinitions(),caller:"OWNER_SESSION" as const,submit:async(request:Parameters<typeof submit>[0])=>{submissions++;return {ok:true as const,outcome:await submit(request,{repos,now:()=>AT,currentStateVersion:null,codeSha:null})};}}};
  const proposal=await respondToOperator(deps,context,{text,from:context.from});assert.equal(proposal.kind,"PROPOSED",JSON.stringify(proposal));assert.equal(submissions,0);
  if(proposal.kind!=="PROPOSED")continue;
  const confirmation={token:proposal.proposal.confirmToken,proposedAt:AT};
  const result=await respondToOperator(deps,context,{text,from:context.from,confirm:confirmation});assert.equal(result.kind,"SUBMITTED",JSON.stringify(result));
  if(result.kind==="SUBMITTED")assert.equal(result.outcome.ok,true,result.outcome.receipt.says);
  const altered=await respondToOperator(deps,context,{text:text+" changed",from:context.from,confirm:confirmation});assert.notEqual(altered.kind,"SUBMITTED");
 }
});
test("selected place words use the selected district; an unknown place and unread budgets are never guessed",()=>{
 const order=parsePlainOrder("send agents to school boards in this district",context);assert.ok(order&&"type" in order);if(order&&"type" in order)assert.equal(order.input.note,"school boards in AZ 0406");
 assert.ok("why" in parsePlainOrder("start a mission in Atlantis",context)!);
 assert.ok("why" in parsePlainOrder("start a mission in Arizona",{...context,adminConfig:null})!);
 const mission=parsePlainOrder("start a mission in Arizona",context);assert.ok(mission&&"type" in mission);if(mission&&"type" in mission){assert.equal(mission.input.budgetUsd,0);assert.match(mission.willDo,/\$0/);}
});
test("delegated operator chat still cannot decide a budget; the owner route supplies its verified session authority",async()=>{
 const out=await respondToOperator({actorRef:"adm_agent",gateway:{registry:actionDefinitions(),submit:async()=>{throw new Error("must not submit");}}},context,{text:"set the budget to $80",from:context.from});assert.equal(out.kind,"REFUSED");
});
