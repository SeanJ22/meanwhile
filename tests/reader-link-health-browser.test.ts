import assert from "node:assert/strict";
import test from "node:test";
import {createServer} from "node:http";
import {build} from "esbuild";
import {launchGuarded} from "../scripts/browser.mts";
import {readerStartScript} from "../lib/reader/bootstrap.ts";

test("the ballot reads its link sweep while HTML streams, then retains focus and minute updates",async()=>{
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
    import React,{useState}from"react";import{createRoot}from"react-dom/client";
    import{useReaderDeadLink}from"./hooks/use-reader-link-health.ts";
    function LinkState(){const dead=useReaderDeadLink("https://example.gov/held");return <p id="state">{dead?"Dead":"Live"}</p>}
    function App(){const[shown,setShown]=useState(true);return <><button onClick={()=>setShown(v=>!v)}>Toggle</button>{shown&&<LinkState/>}</>}
    createRoot(document.getElementById("root")).render(<App/>);
  `},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
  let reads=0,revision=1,releaseClient=()=>{},sawSweep=()=>{};
  const client=new Promise<void>(resolve=>{releaseClient=resolve;}),sweep=new Promise<void>(resolve=>{sawSweep=resolve;});
  const server=createServer(async(request,response)=>{
    if(request.url==="/app.js"){await client;response.writeHead(200,{"content-type":"application/javascript"}).end(bundle.outputFiles[0].text);}
    else if(request.url==="/api/reader/link-health"){
      reads++;sawSweep();response.writeHead(200,{"content-type":"application/json"}).end(JSON.stringify({formatVersion:1,
        sweptAt:new Date(Date.UTC(2026,9,20,revision)).toISOString(),deadAddresses:revision===2?[]:["https://example.gov/held"]}));
    }else response.writeHead(200,{"content-type":"text/html"}).end(`<!doctype html><head><script>${readerStartScript("")}</script></head><body><div id="root"></div><script src="/app.js"></script></body>`);
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();assert.ok(address&&typeof address!=="string");
  const browser=await launchGuarded({label:"rs03-early-link-health",blockWrites:true});
  try{
    const page=await browser.page();await page.clock.install();
    await page.goto(`http://127.0.0.1:${address.port}/ballot?zip=07005`,{waitUntil:"commit"});
    await sweep;assert.equal(reads,1,"the publication read starts while hydration is blocked");
    releaseClient();await page.waitForFunction(()=>document.querySelector("#state")?.textContent==="Dead");assert.equal(reads,1,"hydration consumes the arriving response once");
    revision=2;await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
    await page.waitForFunction(()=>document.querySelector("#state")?.textContent==="Live");assert.equal(reads,2);
    revision=3;await page.clock.fastForward(60001);
    await page.waitForFunction(()=>document.querySelector("#state")?.textContent==="Dead");assert.equal(reads,3);
    await page.getByRole("button",{name:"Toggle"}).click();await page.clock.fastForward(60001);assert.equal(reads,3);
  }finally{releaseClient();await browser.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
