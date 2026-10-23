import assert from "node:assert/strict";
import test from "node:test";
import {createServer} from "node:http";
import {build} from "esbuild";
import {launchGuarded} from "../scripts/browser.mts";

type LayoutSnapshot = {menu:boolean;bp:string;headerBottom:number;insets:{top:number}};
declare global {interface Window {__rs03Layout:LayoutSnapshot;__rs03LayoutSamples:LayoutSnapshot[]}}

test("opening and closing the phone menu retains the measured header without a fallback camera jump",async()=>{
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
    import React,{useState,useLayoutEffect} from 'react';import{createRoot}from'react-dom/client';
    import{useReaderLayout}from'./hooks/use-reader-layout.ts';
    window.__rs03LayoutSamples=[];
    function App(){
      const[menu,setMenu]=useState(false),layout=useReaderLayout();
      const insets=layout.mapInsets({sidebar:menu,selection:0});
      useLayoutEffect(()=>{window.__rs03Layout={menu,bp:layout.bp,headerBottom:layout.headerBottom,insets};window.__rs03LayoutSamples.push(window.__rs03Layout)});
      return <>{!menu&&<header ref={layout.measureHeader} style={{position:'absolute',top:0,left:0,width:'100%',height:layout.bp==='phone'?215:66}}>Header</header>}
        <button id="toggle" style={{position:'fixed',bottom:10}} onClick={()=>setMenu(value=>!value)}>Toggle menu</button></>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
  const server=createServer((request,response)=>{
    if(request.url==="/app.js")response.writeHead(200,{"content-type":"text/javascript"}).end(bundle.outputFiles[0].text);
    else response.writeHead(200,{"content-type":"text/html"}).end('<!doctype html><style>body{margin:0}</style><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();assert.ok(address&&typeof address!=="string");
  const browser=await launchGuarded({label:"rs03-reader-header",blockWrites:true});
  try{
    const context=await browser.context({viewport:{width:390,height:844}}),page=await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.waitForFunction(()=>window.__rs03Layout?.bp==="phone"&&window.__rs03Layout?.headerBottom===215);
    await page.evaluate(()=>{window.__rs03LayoutSamples=[]});
    await page.locator("#toggle").click();await page.waitForFunction(()=>window.__rs03Layout?.menu===true);
    assert.equal(await page.evaluate(()=>window.__rs03Layout.headerBottom),215,"the unmounted header keeps its known height");
    await page.locator("#toggle").click();await page.waitForFunction(()=>window.__rs03Layout?.menu===false);
    const returned=await page.evaluate(()=>window.__rs03LayoutSamples.filter(row=>!row.menu).map(row=>row.insets.top));
    assert.ok(returned.length>0&&returned.every(top=>top===227),
      "returning to the header never uses the 235-pixel fallback between measured layouts");
    await page.locator("#toggle").click();await page.waitForFunction(()=>window.__rs03Layout?.menu===true);
    await page.setViewportSize({width:1280,height:800});
    await page.waitForFunction(()=>window.__rs03Layout?.bp==="wide");
    assert.equal(await page.evaluate(()=>window.__rs03Layout.headerBottom),66,"a viewport change cannot reuse a phone measurement");
    await page.locator("#toggle").click();await page.waitForFunction(()=>window.__rs03Layout?.menu===false&&window.__rs03Layout.headerBottom===66);
    await context.close();
  }finally{await browser.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
