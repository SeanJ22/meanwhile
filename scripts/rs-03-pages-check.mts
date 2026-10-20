/** Fresh browser visits on current main, or --built with the existing production readonly connection.
 * NODE_USE_ENV_PROXY=1 WTP_CHROMIUM_EXECUTABLE=/usr/bin/chromium node --env-file=/tmp/rs03-production.env
 *   --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/rs-03-pages-check.mts --provider [--built] --out=...
 * Normal basemap checks also set WTP_PROVIDER_ACCESS=maptiler and WTP_PROVIDER_REQUEST_CEILING=200.
 */
import assert from "node:assert/strict";
import {execFileSync,spawn} from "node:child_process";
import {once} from "node:events";
import {mkdir,mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {request as httpRequest} from "node:http";
import {createSecureServer, type ServerHttp2Session} from "node:http2";
import {tmpdir} from "node:os";
import {join,resolve,extname} from "node:path";
import {gzipSync} from "node:zlib";
import {neon,neonConfig} from "@neondatabase/serverless";
import type {Request as BrowserRequest} from "playwright";
import {launchGuarded} from "./browser.mts";

const built=process.argv.includes("--built");
const motion=process.argv.includes("--reduced-motion")?"reduce":"no-preference";
const origin="https://meanwhileusa.com";
const serverOrigin="http://127.0.0.1:3305";
const output=process.argv.find(arg=>arg.startsWith("--out="))?.slice(6)??`.scratch/rs03/pages/${built?"built":"main-full"}`;
const zips=(process.argv.find(arg=>arg.startsWith("--zips="))?.slice(7)??"03046,03032,07005,85701").split(",");
const surfaces=(process.argv.find(arg=>arg.startsWith("--surfaces="))?.slice(11)??"home,map,meetings,officials,ask,ballot").split(",");
const profiles=(process.argv.find(arg=>arg.startsWith("--profiles="))?.slice(11)??"phone,desktop").split(",");
assert.ok(profiles.length&&profiles.every(profile=>["phone","desktop"].includes(profile)));
assert.ok(zips.length&&zips.every(zip=>/^\d{5}$/.test(zip)));
assert.ok(surfaces.length&&surfaces.every(surface=>["home","map","meetings","officials","ask","ballot"].includes(surface)));
await mkdir(output,{recursive:true});
let directReadBytes=0,serverReadBytes=0,serverLog="";
let server:ReturnType<typeof spawn>|undefined;
let relay:ReturnType<typeof createSecureServer>|undefined,certDirectory:string|undefined;
const relaySessions=new Set<ServerHttp2Session>();
const rows:Record<string,unknown>[]=[];
let build:unknown,buildId:string|undefined,identity:unknown;
const save=()=>writeFile(`${output}/timings.json`,JSON.stringify({at:new Date().toISOString(),origin,serverOrigin:built?serverOrigin:null,motion,build,buildId,identity,
  transport:built?"Streaming HTTP/2 TLS loopback proxy; DNS override in this browser only":"Live production",
  provider:{mode:browser.provider.policy.mode,spent:browser.provider.spent,blocked:browser.provider.blocked,refused:browser.provider.refused},
  productionReadBytes:built?{direct:directReadBytes,server:serverReadBytes,total:directReadBytes+serverReadBytes}:null,
  method:"Fresh browser context per ZIP/profile/surface, sequential; navigation through full rendering, load event, complete initial API reads, and two painted frames; one real first Ask click; no question submission",rows},null,2)+"\n");
if(built){
 const connection=process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
 assert.ok(connection,"The existing production readonly connection is required");
 const target=new URL(connection);assert.equal(target.username,"readonly");
 assert.ok(target.hostname.replace(/-pooler(?=\.)/,"").startsWith("ep-dry-river-axwtolzc."));
 neonConfig.fetchFunction=async(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1])=>{
  const response=await fetch(input,init);directReadBytes+=(await response.clone().arrayBuffer()).byteLength;return response;
 };
 const sql=neon(connection);
 const [[role]]=await sql.transaction([sql.query(`SELECT current_user AS role,current_setting('transaction_read_only') AS read_only,
  EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND has_table_privilege(current_user,quote_ident(schemaname)||'.'||quote_ident(tablename),'INSERT,UPDATE,DELETE')) AS can_write`,[])],{readOnly:true});
 assert.equal(role.role,"readonly");assert.equal(role.read_only,"on");assert.equal(role.can_write,false);identity=role;
 buildId=(await readFile(".next/BUILD_ID","utf8")).trim();
 server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-p","3305","-H","127.0.0.1"],{
  env:{...process.env,DATABASE_URL:connection,WTP_DB_ROLE:"production",WTP_VITAL_SIGNS_REPORT:"1",NODE_ENV:"production"},stdio:["ignore","pipe","pipe"],
 });
 server.stdout!.on("data",chunk=>{serverLog+=chunk;});server.stderr!.on("data",chunk=>{serverLog+=chunk;});
 await new Promise<void>((ready,fail)=>{
  const timer=setTimeout(()=>fail(new Error("Built server did not start")),20000);
  server!.stdout!.on("data",()=>{if(serverLog.includes("Ready in")){clearTimeout(timer);ready();}});
  server!.once("exit",code=>{clearTimeout(timer);fail(new Error(`Built server exited (${code})`));});
 });
 // Stream the production build under its actual public origin in this browser.
 // A buffered route.fulfill would delay streamed HTML and decompress every asset.
 certDirectory=await mkdtemp(join(tmpdir(),"rs03-browser-"));
 execFileSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-keyout",join(certDirectory,"key.pem"),"-out",join(certDirectory,"cert.pem"),"-days","1","-subj","/CN=meanwhileusa.com","-addext","subjectAltName=DNS:meanwhileusa.com"],{stdio:"ignore"});
 // Netlify serves build assets from its CDN, without invoking the Next function.
 // Project those same bytes here; dynamic documents and APIs stay on cold Next.
 const staticFiles=new Map<string,{body:Buffer;type:string;compressed:boolean}>();
 const {readdir}=await import("node:fs/promises");
 for(const [directory,prefix] of [[".next/static","/_next/static"],["public",""]]){
  for(const name of await readdir(directory,{recursive:true})){
   const path=resolve(directory,name),extension=extname(name);
   const type=({".js":"text/javascript",".mjs":"text/javascript",".css":"text/css",".json":"application/json",".geojson":"application/geo+json",".woff2":"font/woff2",".svg":"image/svg+xml"} as Record<string,string>)[extension];
   if(!type)continue;
   const raw=await readFile(path).catch(()=>null);if(!raw)continue;
   const compressed=/javascript|css|json|svg/.test(type);
   staticFiles.set(`${prefix}/${name}`,{body:compressed?gzipSync(raw):raw,type,compressed});
  }
 }
 const prerender=JSON.parse(await readFile(".next/prerender-manifest.json","utf8"));
 assert.equal(prerender.routes["/"]?.compute,"static","Only the build's static document can bypass its function");
 staticFiles.set("/",{body:gzipSync(await readFile(".next/server/app/index.html")),type:"text/html; charset=utf-8",compressed:true});
 relay=createSecureServer({allowHTTP1:true,key:await readFile(join(certDirectory,"key.pem")),cert:await readFile(join(certDirectory,"cert.pem"))},(request,response)=>{
  const asset=request.method==="GET"&&!request.headers.rsc?staticFiles.get(new URL(request.url!,origin).pathname):undefined;
  if(asset){response.writeHead(200,{"content-type":asset.type,"content-length":asset.body.length,...(asset.compressed?{"content-encoding":"gzip"}:{}),"x-rs03-build":buildId});response.end(asset.body);return;}
  const headers=Object.fromEntries(Object.entries(request.headers).filter(([key])=>!key.startsWith(":")));
  const upstream=httpRequest(`${serverOrigin}${request.url}`,{method:request.method,headers:{...headers,host:"meanwhileusa.com"}},reply=>{
   const headers=Object.fromEntries(Object.entries(reply.headers).filter(([key])=>!["connection","keep-alive","transfer-encoding","upgrade","proxy-connection"].includes(key)));
   response.writeHead(reply.statusCode??502,{...headers,"x-rs03-build":buildId});reply.pipe(response);
  });
  upstream.on("error",()=>{if(!response.headersSent)response.writeHead(502);response.end();});
  request.pipe(upstream);
 });
 relay.on("session",session=>{relaySessions.add(session);session.on("close",()=>relaySessions.delete(session));});
 await new Promise<void>((resolve,reject)=>{relay!.once("error",reject);relay!.listen(3310,"127.0.0.1",resolve);});
}
const browser=await launchGuarded({label:"rs03-full-pages",blockWrites:true,headless:true,
 ...(process.argv.includes("--provider")?{spendsProviderQuota:"maptiler" as const}:{}),
 proxy:{server:process.env.HTTPS_PROXY??"http://proxy:8080",bypass:`127.0.0.1,localhost${built?",meanwhileusa.com":""}`},
 args:["--no-sandbox","--disable-dev-shm-usage","--ignore-certificate-errors","--use-angle=swiftshader","--enable-unsafe-swiftshader",...(built?["--host-resolver-rules=MAP meanwhileusa.com 127.0.0.1:3310"]:[])],
});
try{
 build=built?{localBuildId:buildId}:await(await fetch(`${origin}/api/build`,{headers:{"x-wtp-synthetic-run":browser.runId}})).json();
 for(const zip of zips)for(const profile of profiles)for(const surface of surfaces){
  const phone=profile==="phone";
  const context=await browser.context({viewport:phone?{width:390,height:844}:{width:1280,height:800},deviceScaleFactor:2,
   isMobile:phone,hasTouch:phone,ignoreHTTPSErrors:true,reducedMotion:motion});
  // Local Next has no Netlify Blobs context; these two platform snapshots stay live.
  if(built)for(const path of ["/api/reader/settings","/api/reader/link-health"])await context.route(`${origin}${path}`,async route=>{
   assert.equal(route.request().method(),"GET");
   const response=await fetch(`${origin}${path}`,{headers:{"x-wtp-synthetic-run":browser.runId},signal:AbortSignal.timeout(10000)});
   await route.fulfill({status:response.status,contentType:"application/json",body:Buffer.from(await response.arrayBuffer())});
  });
  await context.addInitScript(()=>localStorage.setItem("wtp.tutorial_seen","1"));
  const page=await context.newPage(),pending=new Set<BrowserRequest>();
  if(process.argv.includes("--profile")||process.argv.includes("--stages")||process.argv.includes("--trace"))await page.addInitScript(()=>{
   const host=window as unknown as {__rs03Stages:Record<string,unknown>[];__wtpMap?:unknown};host.__rs03Stages=[];
   const seen=new Set<string>();
   const buffer=Response.prototype.arrayBuffer;
   Response.prototype.arrayBuffer=function(){
    const started=performance.now();return buffer.call(this).then(value=>{
     if(!this.url)host.__rs03Stages.push({event:"stream-buffer",at:started,ms:performance.now()-started,bytes:value.byteLength});return value;
    });
   };
   new MutationObserver(()=>{
    for(const [name,ready] of [["location-visible",/\d{5}/.test(document.querySelector(".mw-nav-zip")?.textContent??"")],
      ["loading-visible",Boolean(document.querySelector(".mw-loading-note"))],
      ["counts-visible",/^\d/.test(document.querySelector('[data-stat="meetings"] .num')?.textContent??"")],
      ["here-visible",Boolean(document.querySelector(".wtp-here"))]] as const){
     if(ready&&!seen.has(name)){seen.add(name);host.__rs03Stages.push({event:name,at:performance.now()});}
    }
   }).observe(document,{childList:true,subtree:true,characterData:true});
   const original=HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,...args:Parameters<typeof original>){
    const started=performance.now();const result=Reflect.apply(original,this,args);
    if(String(args[0]).startsWith("webgl"))host.__rs03Stages.push({event:"graphics-context",started,ms:performance.now()-started});
    return result;
   } as typeof original;
   new PerformanceObserver(list=>{for(const entry of list.getEntries())host.__rs03Stages.push({event:"long-task",start:entry.startTime,ms:entry.duration});}).observe({type:"longtask",buffered:true});
   let map:unknown;
   Object.defineProperty(window,"__wtpMap",{configurable:true,get:()=>map,set:value=>{
    map=value;host.__rs03Stages.push({event:"map-created",at:performance.now()});
    for(const event of ["load","idle","movestart","moveend"])value.on(event,()=>host.__rs03Stages.push({event,at:performance.now()}));
    value.on("sourcedata",(event:{sourceId?:string;sourceDataType?:string})=>{if(event.sourceDataType==="content")host.__rs03Stages.push({event:"source-content",source:event.sourceId,at:performance.now()});});
   }});
  });
  const profiler=process.argv.includes("--profile")?await context.newCDPSession(page):null;
  if(profiler){await profiler.send("Profiler.enable");await profiler.send("Profiler.start");}
  const tracer=process.argv.includes("--trace")?await context.newCDPSession(page):null;
  if(tracer)await tracer.send("Tracing.start",{categories:"toplevel,devtools.timeline,cc,gpu,viz,blink,renderer.scheduler",transferMode:"ReturnAsStream"});
  const requests:Record<string,unknown>[]=[],archiveRanges:string[]=[],errors:string[]=[],ballotPrefetches:string[]=[];let bytes=0,ms:number|null=null,usableMs:number|null=null,note:string|undefined;
  let rasterResponses=0;
  context.on("response",response=>{
   const url=new URL(response.url());
   if(url.hostname==="maptiler.com"||url.hostname.endsWith(".maptiler.com")){
    if(response.status()>=400)errors.push(`Basemap ${url.pathname}: HTTP ${response.status()}`);
    else if(url.pathname.endsWith(".png"))rasterResponses++;
   }
  });
  context.on("request",request=>{
   if(surface!=="ballot"&&new URL(request.url()).pathname==="/ballot")ballotPrefetches.push(request.url());
   if(new URL(request.url()).pathname.endsWith(".pmtiles"))archiveRanges.push(request.headers().range??"");
   if(new URL(request.url()).pathname.startsWith("/api/")&&!/\/api\/(log|events|reactions)(?:\/|$)/.test(new URL(request.url()).pathname))pending.add(request);
  });
  context.on("requestfailed",request=>pending.delete(request));
  context.on("requestfinished",async request=>{
   pending.delete(request);const sizes=await request.sizes().catch(()=>null);bytes+=sizes?.responseBodySize??0;
   if(request.url().includes("/api/"))requests.push({url:request.url(),timing:request.timing(),sizes});
  });
  page.on("pageerror",error=>errors.push(error.message));
  try{
   const navigation=await page.goto(`${origin}${surface==="ballot"?"/ballot":"/"}?zip=${zip}`,{waitUntil:"commit",timeout:45000});
   if(built)assert.equal(navigation?.headers()["x-rs03-build"],buildId,"The browser must receive the measured build through the streaming proxy");
   if(surface==="ask"){
    // A real first click waits for a usable control; a custom event before hydration is lost.
    await page.locator(".ask-pill").filter({visible:true}).first().click({timeout:15000});
    const box=page.locator("[data-ask-panel] [data-ask-box]").first();await box.waitFor({state:"visible",timeout:15000});
    await page.waitForFunction(()=>document.activeElement?.matches("[data-ask-panel] [data-ask-box]"),undefined,{timeout:5000});
    await box.fill("Where can I attend a meeting?");
   }else if(surface==="ballot"){
    await page.getByRole("heading",{name:/^What's on the ballot/}).first().waitFor({state:"visible",timeout:20000});
    await page.locator("[data-ballot-ask-pill]").first().click({timeout:15000});
    await page.waitForFunction(()=>document.activeElement?.matches("[data-ballot-ask] [data-ask-input]"),undefined,{timeout:5000});
    await page.locator("[data-ballot-ask] [data-ask-input]").first().fill("What is on my ballot?",{timeout:15000});
   }else{
    await page.waitForFunction(phone=>{
     const count=document.querySelector('[data-stat="meetings"] .num');
     return !!document.querySelector("canvas.maplibregl-canvas")&&!!count&&/^\d/.test(count.textContent??"")
      &&!document.querySelector(".mw-loading-note")&&(!phone||!!document.querySelector(".count-badge"));
    },phone,{timeout:20000});
    if(surface==="meetings"||surface==="officials"){
     if(phone)await page.locator(".mw-sheet-handle").click({timeout:5000});
     await page.locator(`[data-stat="${surface}"]`).click({timeout:5000});
     await page.locator(surface==="meetings"?".al-overlay-body":".door-panel").filter({visible:true}).first().waitFor({state:"visible",timeout:10000});
    }
    if(surface==="home"||surface==="map"){
     await page.waitForFunction(()=>{
      const marker=document.querySelector(".wtp-here");
      if(!marker)return false;
      const box=marker.getBoundingClientRect(),style=getComputedStyle(marker);
      return Boolean(box.width&&box.height&&style.visibility!=="hidden"&&style.display!=="none");
     },undefined,{timeout:15000});
    }
   }
   usableMs=await page.evaluate(()=>performance.now());
   if(surface!=="ballot")await page.waitForFunction(()=>{
    const map=(window as unknown as {__wtpMap?:{loaded:()=>boolean;isMoving:()=>boolean}}).__wtpMap;
    return Boolean(map?.loaded()&&!map.isMoving());
   },undefined,{timeout:20000});
   await page.waitForFunction(()=>document.readyState==="complete"&&Array.from(document.images).every(img=>{
    const box=img.getBoundingClientRect();
    return !box.width||!box.height||box.bottom<=0||box.right<=0||box.top>=innerHeight||box.left>=innerWidth||img.complete;
   }),undefined,{timeout:10000});
   const deadline=Date.now()+15000;
   do{
    while(pending.size&&Date.now()<deadline)await page.waitForTimeout(25);
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
   }while(pending.size&&Date.now()<deadline);
   if(pending.size)throw new Error("Initial page API reads did not finish");
   ms=await page.evaluate(()=>performance.now());
   // Verify the finished content after stopping the clock: inspection must not
   // charge its own layout, feature-query or locator-polling time to the reader.
   assert.ok(!/BASEMAP UNAVAILABLE|couldn't load state boundaries/i.test(await page.locator("body").innerText()),"The complete page must have its basemap and boundaries");
   if(surface==="home"||surface==="map")assert.ok(await page.evaluate(()=>{
    const map=(window as unknown as {__wtpMap?:{queryRenderedFeatures:()=>unknown[]}}).__wtpMap;
    return Boolean(map?.queryRenderedFeatures().length);
   }),"The finished map must already have rendered geography");
   if(built&&(surface==="home"||surface==="map"))assert.ok(await page.evaluate(()=>{
    const map=(window as unknown as {__wtpMap?:{getStyle:()=>{layers:{id:string}[]};project:(point:number[])=>{x:number;y:number};queryRenderedFeatures:(point:{x:number;y:number},options:{layers:string[]})=>unknown[]}}).__wtpMap;
    const point=window.__readerStart?.value as {lat:number;lng:number}|undefined;
    if(!map||!point)return false;
    const layers=map.getStyle().layers.filter(layer=>/^district-.+-fill$/.test(layer.id)).map(layer=>layer.id);
    return Boolean(map.queryRenderedFeatures(map.project([point.lng,point.lat]),{layers}).length);
   }),"The transparent district interiors must remain available to a tap at the ZIP point");
   if(built&&surface!=="ballot")assert.ok(rasterResponses>0,"The software basemap must actually receive its raster tiles");
   if(built&&surface!=="ballot")assert.equal(archiveRanges.filter(range=>range==="bytes=0-16383").length,1,"The early archive header must be consumed without a duplicate read");
   if(built)assert.deepEqual(ballotPrefetches,[],"An unopened ballot must not spend production reads or first-page work");
  }catch(error){note=error instanceof Error?error.message.split("\n")[0]:String(error);}
  const snapshot=await page.evaluate(()=>({raster:document.documentElement.dataset.raster,text:document.body.innerText.slice(0,1400),stages:(window as unknown as {__rs03Stages?:unknown}).__rs03Stages,nav:performance.getEntriesByType("navigation").map(entry=>entry.toJSON()),
   resources:performance.getEntriesByType("resource").map(entry=>{const r=entry as PerformanceResourceTiming;return{name:r.name,start:r.startTime,duration:r.duration,transfer:r.transferSize,decoded:r.decodedBodySize};})})).catch(()=>null);
  const row={zip,profile,surface,ms,usableMs,note,bytes,errors,archiveRanges,ballotPrefetches,pending:[...pending].map(request=>request.url()),requests,snapshot};
  if(profiler){const measured=await profiler.send("Profiler.stop");await writeFile(`${output}/${zip}-${profile}-${surface}.cpuprofile`,JSON.stringify(measured.profile));}
  if(tracer){
   const complete=new Promise<{stream?:string}>(resolve=>tracer.once("Tracing.tracingComplete",resolve));await tracer.send("Tracing.end");
   const {stream}=await complete,parts:Buffer[]=[];
   assert.ok(stream,"The browser trace must return its requested stream");
   for(;;){const chunk=await tracer.send("IO.read",{handle:stream});parts.push(Buffer.from(chunk.data,chunk.base64Encoded?"base64":"utf8"));if(chunk.eof)break;}
   await tracer.send("IO.close",{handle:stream});await writeFile(`${output}/${zip}-${profile}-${surface}.trace.json`,Buffer.concat(parts));
  }
  rows.push(row);await save();await page.screenshot({path:`${output}/${zip}-${profile}-${surface}.png`,timeout:5000}).catch(()=>{});
  console.log(JSON.stringify({zip,profile,surface,ms,usableMs,note,bytes,errors,pending:row.pending}));await context.close();
 }
}finally{
 await browser.close();
 if(relay)await new Promise<void>(resolve=>{relay!.close(()=>resolve());for(const session of relaySessions)session.destroy();});
 if(certDirectory)await rm(certDirectory,{recursive:true,force:true});
 if(server&&server.exitCode===null&&server.signalCode===null){const stopped=once(server,"close");server.kill("SIGTERM");const timer=setTimeout(()=>server!.kill("SIGKILL"),2000);await stopped;clearTimeout(timer);}
 if(built){
  const reports=new Map<string,number>();for(const line of serverLog.split("\n"))if(line.startsWith("vital-signs-bytes ")){
   const report=JSON.parse(line.slice("vital-signs-bytes ".length));reports.set(`${report.pid}:${report.hour}`,report.bytes.reader);
  }
  assert.ok(reports.size,"The built server must report production bytes");serverReadBytes=[...reports.values()].reduce((sum,value)=>sum+value,0);
  const connection=process.env.WTP_PRODUCTION_DATABASE_URL_READONLY!;await writeFile(`${output}/server.log`,serverLog.split(connection).join("[production readonly connection]"));
 }
 await save();
}
const failures=rows.filter(row=>row.ms===null||row.note||Number(row.ms)>=3000||(row.errors as string[]).length);
console.log(JSON.stringify({run:browser.runId,rows:rows.length,failures:failures.map(({zip,profile,surface,ms,note})=>({zip,profile,surface,ms,note})),productionReadBytes:built?directReadBytes+serverReadBytes:null,browserResponseBytes:rows.reduce((sum,row)=>sum+Number(row.bytes),0)}));
assert.equal(rows.length,zips.length*profiles.length*surfaces.length);assert.deepEqual(failures.map(({zip,profile,surface,ms,note})=>({zip,profile,surface,ms,note})),[]);
