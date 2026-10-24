import assert from "node:assert/strict";
import test from "node:test";
import {createServer} from "node:http";
import {mkdir} from "node:fs/promises";
import {build} from "esbuild";
import {launchGuarded} from "../scripts/browser.mts";
import type {OpenDataFact} from "../lib/sources/open-data/model.ts";

const record=(id:string):OpenDataFact=>({id:`epa-echo:${id}`,kind:"EPA_FACILITY",sourceId:"epa-echo",nativeIds:{registry_id:id},title:`Held facility ${id}`,
  state:"CA",divisionIds:[],bodyIds:[],zip:"90210",sourceUrl:`https://echo.epa.gov/detailed-facility-report?fid=${id}`,sourceOrg:"EPA ECHO",official:true,
  publishedAt:null,updatedAt:null,capturedAt:"2026-10-23T09:06:56.174Z",description:"Captured inspection and compliance data",fields:{inspectionCount:"2"},sourceRow:{REGISTRY_ID:id,FAC_NAME:`Held facility ${id}`}});
const page=(ids:string[],nextCursor:string|null,checked="2026-10-01T00:00:00Z")=>({records:ids.map(record),unavailable:[],notHeld:[],checkedAt:{"epa-echo":checked},nextCursor,radiusKm:25});

test("Open data follows opaque cursors, replaces a changed publication, reaches empty-page continuations and aborts old places",async()=>{
  const output=await build({stdin:{contents:`import React,{useState} from "react";import{createRoot}from"react-dom/client";
    import{PlaceOpenData}from"./components/map/open-data.tsx";import{Card}from"./components/ui/card.tsx";
    function App(){const[zip,setZip]=useState("10001");return <>
      <div id="version"><Card title="Accepted publication" sources={[]}><PlaceOpenData zip="90210"/></Card></div>
      <div id="empty"><Card title="Empty bounded page" sources={[]}><PlaceOpenData zip="02108"/></Card></div>
      <div id="place"><Card title="Selected place" sources={[]}><PlaceOpenData zip={zip}/><button onClick={()=>setZip("10002")}>Change ZIP</button></Card></div>
    </>};createRoot(document.getElementById("root")).render(<App/>);`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,
    platform:"browser",format:"iife",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
  const cursorA="edition A:page/1+?=",cursorB="edition A:page/2+?=",cursorNew="edition B:page/1+?=";
  const requests:{zip:string|null;cursor:string|null;offset:string|null}[]=[];
  let edition=1,oldPlaceReads=0,releaseFresh:(()=>void)|undefined,releaseOldPlace:(()=>void)|undefined,oldPlaceAborted=false;
  let oldResetRequested!:()=>void;const oldResetRequest=new Promise<void>(resolve=>{oldResetRequested=resolve;});
  let oldAbortObserved!:()=>void;const oldAbort=new Promise<void>(resolve=>{oldAbortObserved=resolve;});
  const server=createServer(async(request,response)=>{
    const url=new URL(request.url??"/","http://localhost");
    if(url.pathname==="/app.js"){response.writeHead(200,{"content-type":"application/javascript"}).end(output.outputFiles[0].text);return;}
    if(url.pathname!=="/api/open-data"){response.writeHead(200,{"content-type":"text/html"}).end('<!doctype html><div id="root"></div><script src="/app.js"></script>');return;}
    const zip=url.searchParams.get("zip"),cursor=url.searchParams.get("cursor");requests.push({zip,cursor,offset:url.searchParams.get("offset")});
    let value:ReturnType<typeof page>;
    if(zip==="90210"){
      if(cursor===cursorB){edition=2;response.writeHead(409,{"content-type":"application/json"}).end(JSON.stringify({reset:true,error:"The accepted source changed; restart this place's records."}));return;}
      if(edition===1)value=cursor===cursorA?page(["a2","a3"],cursorB):page(["a1","a2"],cursorA);
      else if(cursor===cursorNew)value=page(["b2","b3"],null,"2026-10-23T00:00:00Z");
      else{await new Promise<void>(resolve=>{releaseFresh=resolve;});value=page(["b1","b2"],cursorNew,"2026-10-23T00:00:00Z");}
    }else if(zip==="02108")value=cursor?page(["empty-reached"],null):page([],"empty:next");
    else if(zip==="10001"&&cursor){response.writeHead(409,{"content-type":"application/json"}).end(JSON.stringify({reset:true,error:"The accepted source changed; restart this place's records."}));return;}
    else if(zip==="10001"&&++oldPlaceReads>1){response.on("close",()=>{if(!response.writableEnded){oldPlaceAborted=true;oldAbortObserved();}});await new Promise<void>(resolve=>{releaseOldPlace=resolve;oldResetRequested();});value=page(["old-late"],null);}
    else value=page([zip==="10002"?"new-place":"old-place"],zip==="10002"?null:"old:next");
    response.writeHead(200,{"content-type":"application/json"}).end(JSON.stringify(value));
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();assert.ok(address&&typeof address!=="string");
  let browser:Awaited<ReturnType<typeof launchGuarded>>|undefined;
  try{
    browser=await launchGuarded({label:"src01-open-data-cursor",blockWrites:true});const context=await browser.context({viewport:{width:1000,height:900}}),view=await context.newPage();
    const errors:string[]=[];view.on("pageerror",error=>errors.push(error.message));
    await view.goto(`http://127.0.0.1:${address.port}/`);
    const version=view.locator("#version"),empty=view.locator("#empty"),place=view.locator("#place");
    await version.locator('[data-open-data-record="epa-echo:a1"]').waitFor();
    await version.getByRole("button",{name:"Show more",exact:true}).click();
    await version.locator('[data-open-data-record="epa-echo:a3"]').waitFor();
    assert.equal(await version.locator("[data-open-data-record]").count(),3,"same-edition overlap is deduplicated");
    await version.getByRole("button",{name:"Show more",exact:true}).click();
    await view.waitForFunction(()=>document.querySelector("#version [role=status]")?.textContent==="Loading open data…");
    assert.equal(await version.locator("[data-open-data-record]").count(),0,"409 removes the previous edition before its replacement arrives");
    assert.ok(releaseFresh);releaseFresh();
    await version.locator('[data-open-data-record="epa-echo:b1"]').waitFor();
    await version.getByRole("button",{name:"Show more",exact:true}).click();await version.locator('[data-open-data-record="epa-echo:b3"]').waitFor();
    assert.deepEqual(await version.locator("[data-open-data-record]").evaluateAll(rows=>rows.map(row=>row.getAttribute("data-open-data-record"))),["epa-echo:b1","epa-echo:b2","epa-echo:b3"]);
    await version.getByRole("button",{name:/Sources/}).click();assert.match(await version.innerText(),/Last checked 2026-10-23/);assert.doesNotMatch(await version.innerText(),/Last checked 2026-10-01/);
    assert.equal(await version.getByRole("button",{name:"Show more",exact:true}).count(),0);
    await empty.getByRole("button",{name:"Show more",exact:true}).waitFor();assert.equal(await empty.locator("[data-card-gap]").count(),0,"an empty bounded page is not an absence claim");
    await empty.getByRole("button",{name:"Show more",exact:true}).click();await empty.locator('[data-open-data-record="epa-echo:empty-reached"]').waitFor();
    await place.getByRole("button",{name:"Show more",exact:true}).click();
    await Promise.race([oldResetRequest,new Promise<never>((_resolve,reject)=>AbortSignal.timeout(5000).addEventListener("abort",()=>reject(Error("Old place never requested its409 reset page"))))]);
    await place.getByRole("button",{name:"Change ZIP",exact:true}).click();await place.locator('[data-open-data-record="epa-echo:new-place"]').waitFor();
    await Promise.race([oldAbort,new Promise<never>((_resolve,reject)=>AbortSignal.timeout(5000).addEventListener("abort",()=>reject(Error("Changing ZIP did not abort the previous reset"))))]);
    assert.ok(releaseOldPlace);releaseOldPlace();await view.waitForFunction(()=>document.querySelectorAll('#place [data-open-data-record]').length===1);
    assert.equal(await place.locator('[data-open-data-record="epa-echo:old-late"]').count(),0);assert.equal(oldPlaceAborted,true);
    assert.ok(requests.some(row=>row.cursor===cursorA));assert.ok(requests.some(row=>row.cursor===cursorNew));assert.ok(requests.every(row=>row.offset===null));
    assert.deepEqual(errors,[]);
    await mkdir(".scratch/ci",{recursive:true});await view.screenshot({path:".scratch/ci/open-data-cursor.png",fullPage:true});await context.close();
  }finally{releaseFresh?.();releaseOldPlace?.();await browser?.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
