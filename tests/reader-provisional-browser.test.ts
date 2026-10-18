import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { build } from "esbuild";
import { launchGuarded } from "../scripts/browser.mts";

test("state-first officials stay usable while local counts wait for the independent place read", async () => {
  const output = await build({ stdin: { contents: `
    import React,{useEffect,useState} from "react";import {createRoot} from "react-dom/client";
    import {flushSync} from "react-dom";
    import {DataProvider} from "./lib/state/data.tsx";import {UiProvider} from "./lib/state/provider.tsx";
    import {StatsBar} from "./components/shell/stats-bar.tsx";import {CountBadge} from "./components/map/count-badge.tsx";
    import {ListOverlay} from "./components/map/list-overlay.tsx";
    import {CoverageNotice} from "./components/map/coverage-notice.tsx";
    import {loadStateAndPlace} from "./lib/reader/client.ts";
    const coverage={state:"UNMAPPED",bodies:[],seats:[],stateLegislatorAuthorities:[],divisions:[],unincorporated:false,senators:[{id:"congress:A000001",name:"State-first senator",officeTitle:"U.S. Senator",state:"AZ"}],statewideExecutives:[],counts:{total:0,withSource:0,withoutSource:0,lookedAt:0,governing:{total:0,withSource:0}},seatCounts:{total:0,named:0}};
    const meetings=[{id:"one"},{id:"two"}];
    const body={bodyId:"fixture:council",ocdId:"ocd-division/country:us/state:az/place:tucson",name:"Held City Council",divisionLabel:"Tucson",divisionType:"place",lsad:null,schoolDependency:"UNCLASSIFIED",bodyClass:"GOVERNING",coverageStatus:"WIRED",homepageUrl:null,agendaSourceRef:null,lookedAt:false,tier:"local",readerRoster:{members:[],gaps:[],officePhone:null}};
    const final={meetings,tier:"exact",coverage:{...coverage,state:"MEETINGS",bodies:[body],counts:{total:1,withSource:1,withoutSource:0,lookedAt:0,governing:{total:1,withSource:1}}},center:{lat:32,lng:-110},radiusKm:25};
    function App(){
      const [result,setResult]=useState(null);
      useEffect(()=>{const controller=new AbortController();void loadStateAndPlace({state:()=>Promise.resolve({coverage}),place:()=>new Promise(resolve=>{window.releasePlace=()=>resolve(final)}),signal:controller.signal,onState:state=>setResult({...final,meetings:[],tier:"none",coverage:state.coverage,localPending:true}),onPlace:place=>{flushSync(()=>setResult({...place,localPending:false}));window.committedOnPublication=document.querySelector('[data-stat="meetings"] .num')?.textContent==="2"}});return()=>controller.abort()},[]);
      const rows=result?.meetings??[];
      const data={allMeetings:rows,meetings:rows,venues:[],result,location:{zip:"85701"},drawnDistricts:[],dropped:0,searchFailed:false,atAddress:false,governing:null,zipPartial:null,basis:"ZIP"};
      return <DataProvider value={data}><UiProvider initial={{listOverlayOpen:true}}><StatsBar/><CountBadge/>{result&&<CoverageNotice tier={result.tier} coverage={result.coverage} localPending={result.localPending} zip="85701" onOpenOfficial={holder=>{window.opened=holder.name}}/>}{result?.localPending&&<ListOverlay embedded onPickMeeting={()=>{}}/>}<button onClick={()=>window.releasePlace()}>Finish local</button></UiProvider></DataProvider>;
    }
    createRoot(document.getElementById("root")).render(<App/>);`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, logLevel: "silent" });
  const server = createServer((request, response) => {
    if (request.url === "/app.js") response.writeHead(200, { "content-type": "application/javascript" }).end(output.outputFiles[0].text);
    else if (request.url?.startsWith("/api/")) response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ records: [], unavailable: [], nextOffset: null, checkedAt: {} }));
    else response.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  try {
    browser = await launchGuarded({ label: "rs-01-provisional", blockWrites: true });
    const page = await (await browser.context()).newPage();
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.getByRole("button", { name: "State-first senator", exact: true }).waitFor();
    assert.equal(await page.locator('[data-stat="officials"] .num').innerText(), "1");
    assert.equal(await page.locator('[data-stat="meetings"] .num').innerText(), "…");
    assert.equal(await page.locator('[data-stat="bodies here"] .num').innerText(), "…");
    assert.equal(await page.locator(".count-badge .cb-num").innerText(), "…");
    assert.doesNotMatch(await page.locator("body").innerText(), /don't have this place|don’t have this place|Coverage gap|Not mapped yet|0 venues|Nothing matches the current filters/);
    assert.equal(await page.locator(".al-empty").innerText(), "Loading meetings…");
    await page.getByRole("button", { name: "State-first senator", exact: true }).click();
    assert.equal(await page.evaluate(() => (window as unknown as {opened:string}).opened), "State-first senator");
    await page.getByRole("button", { name: "Finish local", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-stat="meetings"] .num')?.textContent === "2");
    assert.equal(await page.evaluate(() => (window as unknown as {committedOnPublication:boolean}).committedOnPublication), true, "the async final publication commits the ready counts before returning");
    assert.equal(await page.locator('[data-stat="bodies here"] .num').innerText(), "1");
    assert.equal(await page.locator('[data-stat="officials"] .num').innerText(), "1");
    assert.equal(await page.locator(".count-badge .cb-num").innerText(), "2");
    assert.match(await page.locator("body").innerText(), /Held City Council/);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
