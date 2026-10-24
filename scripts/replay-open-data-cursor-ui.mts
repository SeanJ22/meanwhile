/** Actual map component and open-data GET over the already accepted local national EPA replay. */
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {createServer} from "node:http";
import {resolve,dirname} from "node:path";
import {build} from "esbuild";
import {launchGuarded} from "./browser.mts";
import {localPostgresReader} from "./lib/local-postgres-reader.mts";
import {installOpenDataReplayVault} from "./lib/open-data-replay-reader.mts";
import {createEpaReplayVault} from "./lib/epa-held-spool.mts";
import {installReaderDatabaseQuery} from "../lib/reader/database.ts";
import {GET} from "../app/api/open-data/route.ts";
import {openDataFactIssue,type OpenDataFact} from "../lib/sources/open-data/model.ts";

const args=process.argv.slice(2),arg=(name:string,fallback:string)=>args.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const output=resolve(arg("output","docs/measurements/src-01/open-data-cursor-ui.json"));
const manifestFile=resolve(arg("manifest",".scratch/src01-epa/four-writer-compact-manifest.json"));
const database=resolve(arg("database",".scratch/src01-epa/reader-native-final"));
const zip=arg("zip","90001"),division=arg("division","")||null;
const manifestBytes=await readFile(manifestFile,"utf8"),manifest=JSON.parse(manifestBytes) as {vaultRoots:[string,string];vaultEncoding:"raw"|"gzip-level1";capture:{rawHash:string;retrievedAt:string}};
const native=await localPostgresReader(database,arg("native-postgres-file","/workspace/src01-scratch/src01-native-postgres-url"));
installReaderDatabaseQuery(native.query);
const transport=installOpenDataReplayVault(createEpaReplayVault(manifest.vaultRoots,manifest.vaultEncoding));
const outputBundle=await build({stdin:{contents:`import React from"react";import{createRoot}from"react-dom/client";
  import{PlaceOpenData}from"./components/map/open-data.tsx";import{Card}from"./components/ui/card.tsx";
  createRoot(document.getElementById("root")).render(<Card title="Open data and regulated facilities" sources={[]}><PlaceOpenData zip={${JSON.stringify(zip)}} divisionId={${JSON.stringify(division)}}/></Card>);`,
  resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
const pages:{elapsedMs:number;status:number;rows:number;ids:string[];nextCursor:boolean;requestedCursor:boolean;checkedAt:Record<string,string>}[]=[];
const server=createServer(async(request,response)=>{
  const url=new URL(request.url??"/","http://readonly-replay.local");
  if(url.pathname==="/app.js"){response.writeHead(200,{"content-type":"application/javascript"}).end(outputBundle.outputFiles[0].text);return;}
  if(url.pathname!=="/api/open-data"){response.writeHead(200,{"content-type":"text/html"}).end('<!doctype html><meta name="viewport" content="width=device-width"><div id="root"></div><script src="/app.js"></script>');return;}
  const started=performance.now();
  try{
    assert.equal(url.searchParams.get("division"),division);assert.equal(url.searchParams.get("zip"),zip);assert.equal(url.searchParams.get("offset"),null);
    const result=await GET(new Request(url.href));
    const value=await result.json() as {records:OpenDataFact[];unavailable:string[];checkedAt:Record<string,string>;nextCursor:string|null};
    assert.equal(result.status,200);assert.deepEqual(value.unavailable,[]);assert.equal(value.records.length,50);assert.ok(value.records.every(row=>!openDataFactIssue(row)));
    pages.push({elapsedMs:Math.round(performance.now()-started),status:result.status,rows:value.records.length,ids:value.records.map(row=>row.id),nextCursor:value.nextCursor!==null,requestedCursor:url.searchParams.has("cursor"),checkedAt:value.checkedAt});
    response.writeHead(result.status,{"content-type":"application/json"}).end(JSON.stringify(value));
  }catch(error){response.writeHead(503,{"content-type":"application/json"}).end(JSON.stringify({error:error instanceof Error?error.message:String(error)}));}
});
await new Promise<void>(resolveListen=>server.listen(0,"127.0.0.1",resolveListen));
const address=server.address();assert.ok(address&&typeof address!=="string");
let browser:Awaited<ReturnType<typeof launchGuarded>>|undefined;
try{
  browser=await launchGuarded({label:"src01-open-data-real-cursor-ui",blockWrites:true});
  const context=await browser.context({viewport:{width:1000,height:900}}),view=await context.newPage(),errors:string[]=[];
  view.on("pageerror",error=>errors.push(error.message));
  const firstStarted=performance.now();await view.goto(`http://127.0.0.1:${address.port}/`);
  await view.waitForFunction(()=>document.querySelectorAll("[data-open-data-record]").length===50);const firstPageMs=Math.round(performance.now()-firstStarted);
  assert.equal(pages.length,1);assert.equal(new Set(pages[0].ids).size,50);assert.equal(pages[0].requestedCursor,false);
  await mkdir(dirname(output),{recursive:true});const firstScreenshot=resolve(dirname(output),"open-data-cursor-first.png");await view.screenshot({path:firstScreenshot});
  const more=view.getByRole("button",{name:"Show more",exact:true}),moreStarted=performance.now();await more.click();
  await view.waitForFunction(()=>document.querySelectorAll("[data-open-data-record]").length===100);const showMoreMs=Math.round(performance.now()-moreStarted);
  assert.equal(pages.length,2);assert.equal(pages[1].requestedCursor,true);assert.equal(new Set(pages.flatMap(page=>page.ids)).size,100);
  const ids=await view.locator("[data-open-data-record]").evaluateAll(rows=>rows.map(row=>row.getAttribute("data-open-data-record")));
  assert.deepEqual(ids,pages.flatMap(page=>page.ids));assert.deepEqual(errors,[]);assert.equal(await more.count(),1);
  await more.scrollIntoViewIfNeeded();const moreScreenshot=resolve(dirname(output),"open-data-cursor-more.png");await view.screenshot({path:moreScreenshot});
  const files=await Promise.all(["components/map/open-data.tsx","lib/sources/open-data/reader.ts","app/api/open-data/route.ts"].map(async path=>({path,sha256:createHash("sha256").update(await readFile(path)).digest("hex")})));
  const proof={status:firstPageMs<3000&&showMoreMs<3000?"PASS":"SLOW",productionWrites:0,sourceRequests:0,scope:"Actual PlaceOpenData/Card → local HTTP → actual GET readerRoute → existing accepted national native PostgreSQL publication → Netlify SDK local held artifacts; first50 then100records",division,zip,
    clock:"Actual current clock; existing initial publication only, no new promotion or synthetic dates",sourceCapture:manifest.capture,sourceManifestSha256:createHash("sha256").update(manifestBytes).digest("hex"),implementation:files,
    firstPageMs,showMoreMs,rowsAfterFirst:50,rowsAfterMore:100,distinctRows:100,furtherRecordsReachable:true,pages:pages.map(({ids,...page})=>({...page,idSha256:createHash("sha256").update(JSON.stringify(ids)).digest("hex")})),
    browser:"/usr/bin/chromium substituted for missing pinned1234",runId:browser.runId,screenshots:[firstScreenshot,moreScreenshot],limitations:"Local read-only PostgreSQL and artifact transport substitute for production network latency. This is an unstyled real component, not a deployed production page. Accepted-version409 UI behavior is separately verified against the frozen API contract; actual API changed-publication regression belongs to the source owner."};
  await writeFile(output,JSON.stringify(proof,null,2));console.log(JSON.stringify({status:proof.status,firstPageMs,showMoreMs,rowsAfterMore:100}));await context.close();
}finally{await browser?.close();await new Promise<void>((resolveClose,reject)=>server.close(error=>error?reject(error):resolveClose()));transport.restore();installReaderDatabaseQuery(undefined);await native.close();}
