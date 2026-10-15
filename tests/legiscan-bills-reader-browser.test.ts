import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { launchGuarded } from "../scripts/browser.mts";
import { normalizeSession,type Dataset } from "../lib/sources/legiscan/bills.ts";

test("a legislator card shows sourced bulk bills and one Sources list at the bottom on first use",async()=>{
  const bodies=["HB1","HB2"].map(name=>readFileSync(new URL(`./fixtures/legiscan/bill/${name}.json`,import.meta.url),"utf8"));
  const dataset:Dataset={state_id:2,session_id:122,session_name:"27th Legislature",dataset_date:"2012-12-30",dataset_hash:"fixture"};
  const bills=normalizeSession(dataset,bodies,"2026-10-12T12:00:00.000Z").bills;
  const output=await build({stdin:{contents:`
    import React from "react";import {createRoot} from "react-dom/client";
    import {PersonCard} from "./components/ui/person-card.tsx";
    import {LegislatorBills} from "./components/officials/legislator-bills.tsx";
    const holder={id:"plural:ak:fixture",name:"Carl Gatto",officeTitle:"State Representative",state:"AK"};
    createRoot(document.getElementById("root")).render(<PersonCard title={holder.name} identity={<h1>{holder.name}</h1>} contact={<p>State Representative</p>} sections={{}} sources={[]} independent
      afterSections={<LegislatorBills holder={holder}/>}/>);`,resolveDir:process.cwd(),sourcefile:"legiscan-reader-fixture.tsx",loader:"tsx"},
    bundle:true,write:false,outfile:".scratch/legiscan-reader.js",platform:"browser",format:"iife",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
  const js=output.outputFiles.find(row=>row.path.endsWith(".js"))!.text;
  const server=createServer((request,response)=>{
    if(request.url==="/fixture.js") response.writeHead(200,{"content-type":"application/javascript"}).end(js);
    else if(request.url?.startsWith("/api/bills?")) response.writeHead(200,{"content-type":"application/json"}).end(JSON.stringify({bills,complete:true,checkedAt:"2026-10-12T12:00:00.000Z"}));
    else if(request.url==="/") response.writeHead(200,{"content-type":"text/html"}).end('<!doctype html><meta name="viewport" content="width=device-width"><div id="root"></div><script src="/fixture.js"></script>');
    else response.writeHead(200,{"content-type":"application/json"}).end("{}");
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();assert.ok(address&&typeof address!=="string");
  let browser:Awaited<ReturnType<typeof launchGuarded>>|null=null;
  try {
    browser=await launchGuarded({label:"legiscan-reader",blockWrites:true});
    const context=await browser.context({viewport:{width:1000,height:900}}),page=await context.newPage();
    const start=Date.now();await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.locator('[data-bill-id="legiscan:bill:230084"]').waitFor({state:"visible"});
    assert.ok(Date.now()-start<3000,"first-use bill content must be usable within three seconds");
    assert.equal(await page.locator("[data-bill-id]").count(),2);
    assert.match(await page.locator("[data-legislator-bills]").innerText(),/Engrossed.*2011-04-11/);
    assert.match(await page.locator("[data-legislator-bills]").innerText(),/Sponsors: Carl Gatto/);
    assert.equal(await page.locator('[data-bill-id="legiscan:bill:230084"] a').count(),4);
    const disclosure=page.locator("[data-card-sources]").filter({has:page.getByRole("button",{name:/^Sources/})});
    assert.equal(await disclosure.count(),1);
    await disclosure.getByRole("button",{name:/^Sources/}).click();
    await page.getByText(/Bill data licence: CC BY 4.0/).waitFor({state:"visible"});
    assert.equal(await disclosure.evaluate(element=>element.parentElement?.lastElementChild===element),true);
    assert.match(await disclosure.innerText(),/published 2012-12-30/);
    await mkdir(".scratch/ci",{recursive:true});await page.screenshot({path:".scratch/ci/src-ls-card-desktop.png",fullPage:true});
    await page.setViewportSize({width:375,height:800});await page.screenshot({path:".scratch/ci/src-ls-card-mobile.png",fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    await context.close();
  } finally {await browser?.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
