import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import { build } from "esbuild";
import { launchGuarded } from "../../scripts/browser.mts";
import { createMemoryRepositories } from "../../lib/control-plane/repository/memory.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig } from "../../lib/control-plane/gateway/admin-config.ts";
import { submit } from "../../lib/control-plane/gateway/gateway.ts";
import { confirmReceipt } from "../../lib/control-plane/gateway/confirmation.ts";
import { applyHuntOrders, HUNT_STATES } from "../../lib/control-plane/hunt-orders.ts";
import type { ActionRequest, ActionOutcome } from "../../lib/control-plane/gateway/contract.ts";

const entry = `
  import React, {useState} from "react";
  import {createRoot} from "react-dom/client";
  import {CommandCenter} from "./app/(admin)/_mw/admin-v6/command-center.tsx";
  import {liveExecutor} from "./app/(admin)/_mw/admin-v6/executor.ts";
  import {buildLiveBundle} from "./app/(admin)/_mw/admin-v6/live-data.ts";
  import {workerStatusFromPulse} from "./app/(admin)/_mw/admin-v6/pulse-view.ts";
  import {adminNowFixture} from "./tests/fixtures/admin-now/fixture.ts";
  const fixture=adminNowFixture("after");
  const live=liveExecutor({capabilities:()=>({receiptLookup:{contract:"admin-v6/receipt@1",href:"/api/admin/action-receipt"}})});
  const executor={...live,send:(receipt,request,update)=>live.send(receipt,request,next=>{
    window.latestReceipt=next; update(next);
  })};
  function App() {
    const [scope,setScope]=useState("st:az");
    return <><button onClick={()=>setScope("us")}>Country view</button><CommandCenter
      data={buildLiveBundle(fixture.snapshot,fixture.reference,workerStatusFromPulse(null))}
      mode="live" executor={executor} scopeKey={scope} onScopeChange={setScope}
      connection="live" lastGoodAt={null} recovered={false}
      access={{role:"owner",canSpend:true,outreachAuthorized:false}} initialView="now"/></>;
  }
  createRoot(document.getElementById("root")).render(<App/>);
`;

test("state and country stop controls stay pending until their runner orders are applied", async () => {
  const at="2026-10-16T10:00:00.000Z", now="2026-10-16T11:00:00.000Z";
  const repos=createMemoryRepositories();
  await repos.adminConfig.put(ADMIN_CONFIG_ID,{...defaultAdminConfig(at),expansionScopes:["az","nh"].map((state,n)=>({
    key:`zcta:2020/${85000+n}`,geography:{type:"zcta" as const,geoid:String(85000+n),version:"zcta:2020",label:`ZIP ${85000+n}`,stateAbbr:state.toUpperCase()},
    priority:1,budgetUsd:10,decidedAt:at,decidedBy:"owner",receiptId:`send-${state}`,previous:null,note:null,
  }))},at);
  const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:"hunt-stop-browser.tsx",loader:"tsx"},
    alias:{"@":process.cwd()},bundle:true,platform:"browser",format:"iife",write:false,outfile:"hunt-stop.js"});
  const browser=await launchGuarded({label:"admin-hunt-stop",headless:true});
  const outcomes=new Map<string,ActionOutcome>();
  let writes=0;
  try {
    const page=await browser.page();
    await page.route("http://admin.local/harness",route=>route.fulfill({status:200,contentType:"text/html",body:"<div id='root'></div>"}));
    await page.route("**/api/admin/action",async route=>{
      const {type,subject,stateVersion,idempotencyKey,...input}=route.request().postDataJSON();
      if(type==="expansion.scope.stopAll") writes++;
      const outcome=await submit({type,subject,stateVersion,idempotencyKey,input,caller:"OWNER_SESSION",actorRef:"adm_test"} as ActionRequest,
        {repos,now:()=>now,currentStateVersion:null,codeSha:null});
      outcomes.set(idempotencyKey,outcome);
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({...outcome,confirmation:await confirmReceipt(repos,outcome.receipt,Date.parse(now))})});
    });
    await page.route("**/api/admin/action-receipt?*",async route=>{
      const key=new URL(route.request().url()).searchParams.get("key")!;
      const outcome=outcomes.get(key)!;
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({contract:"admin-v6/receipt@1",receipt:outcome.receipt,
        confirmation:await confirmReceipt(repos,outcome.receipt,Date.parse(now))})});
    });
    await page.goto("http://admin.local/harness");
    await page.addStyleTag({content:readFileSync("app/globals.css","utf8").replace(/@import [^;]+;/g,"").replaceAll("@theme inline",":root")});
    await page.addStyleTag({content:":root{--font-dm-sans:system-ui;--font-jetbrains-mono:monospace}body{margin:0}"});
    await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith(".css"))!.text});
    await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith(".js"))!.text});
    await page.getByRole("button",{name:"Stop every hunt in Arizona",exact:true}).click();
    await page.getByRole("dialog").getByRole("button",{name:"Send",exact:true}).click();
    await page.waitForFunction(()=> (window as unknown as {latestReceipt?:{status:string}}).latestReceipt?.status==="queued");
    assert.equal(writes,1);
    assert.equal((await repos.huntOrders.pending("az")).length,1);
    await applyHuntOrders(repos,"nh",now);
    assert.equal(await page.evaluate(()=> (window as unknown as {latestReceipt:{status:string}}).latestReceipt.status),"queued");
    await applyHuntOrders(repos,"az",now);
    await page.waitForFunction(()=> (window as unknown as {latestReceipt?:{status:string}}).latestReceipt?.status==="done");
    await page.screenshot({path:"/tmp/cp01-admin-state-stop.png",fullPage:true});
    await page.getByRole("button",{name:"Country view",exact:true}).click();
    await page.getByRole("button",{name:"Stop every hunt",exact:true}).click();
    await page.getByRole("dialog").getByRole("button",{name:"Send",exact:true}).click();
    await page.waitForFunction(()=> (window as unknown as {latestReceipt?:{status:string}}).latestReceipt?.status==="queued");
    assert.equal(writes,2);
    for(const state of HUNT_STATES) await applyHuntOrders(repos,state,now);
    await page.waitForFunction(()=> (window as unknown as {latestReceipt?:{status:string}}).latestReceipt?.status==="done");
    assert.equal((await repos.adminConfig.mustRead(ADMIN_CONFIG_ID,{expansionScopes:true})).value.expansionScopes?.length,0);
    await page.close();
  }finally{await browser.close();}
});
