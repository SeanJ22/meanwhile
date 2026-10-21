import assert from "node:assert/strict";
import test from "node:test";
import {createServer} from "node:http";
import {build} from "esbuild";
import {launchGuarded} from "../scripts/browser.mts";

test("moving reader controls reuses settings while the minute clock and focus still deliver new copy",async()=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
  import React,{useState} from "react";import{createRoot}from"react-dom/client";
  import{useReaderCopy}from"./hooks/use-reader-copy.ts";
  function Copy(){const copy=useReaderCopy();return <p id="copy">{copy("copy.askMap")}</p>}
  function App(){const[shown,setShown]=useState(true);return <><button onClick={()=>setShown(s=>!s)}>Toggle</button>{shown&&<Copy/>}</>}
  createRoot(document.getElementById("root")).render(<App/>);
 `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
 let reads=0,revision=1;
 const server=createServer((request,response)=>{
  if(request.url==="/app.js")response.writeHead(200,{"content-type":"application/javascript; charset=utf-8"}).end(bundle.outputFiles[0].text);
  else if(request.url==="/api/reader/settings"){
   reads++;response.writeHead(200,{"content-type":"application/json"}).end(JSON.stringify({available:true,revision,values:{"copy.askMap":`Published ${revision}`}}));
  }else response.writeHead(200,{"content-type":"text/html"}).end('<!doctype html><div id="root"></div><script src="/app.js"></script>');
 });
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 const address=server.address();assert.ok(address&&typeof address!=="string");
 const browser=await launchGuarded({label:"rs03-reader-copy",blockWrites:true});
 try{
  const page=await browser.page();await page.clock.install();
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.waitForFunction(()=>document.querySelector("#copy")?.textContent==="Published 1");
  assert.equal(reads,1);
  await page.getByRole("button",{name:"Toggle"}).click();await page.getByRole("button",{name:"Toggle"}).click();
  assert.equal(await page.locator("#copy").innerText(),"Published 1");assert.equal(reads,1,"remounting a control does not reload unchanged settings");
  revision=2;await page.clock.fastForward(60001);
  await page.waitForFunction(()=>document.querySelector("#copy")?.textContent==="Published 2");assert.equal(reads,2);
  revision=3;await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(()=>document.querySelector("#copy")?.textContent==="Published 3");assert.equal(reads,3);
  await page.getByRole("button",{name:"Toggle"}).click();await page.clock.fastForward(60001);
  assert.equal(reads,3,"the page clock performs no reads when no control subscribes");
 }finally{await browser.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
