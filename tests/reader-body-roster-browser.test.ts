import assert from "node:assert/strict";
import test from "node:test";
import {createServer} from "node:http";
import {build} from "esbuild";
import {createRequire} from "node:module";
import tailwindcss from "@tailwindcss/postcss";
import {mkdirSync,readFileSync} from "node:fs";
import {launchGuarded} from "../scripts/browser.mts";
import {GET} from "../app/api/reader/roster/route.ts";
import {installFactReader} from "../lib/facts/db.ts";
import {readerRosterKey} from "../lib/reader/body-roster.ts";
import {shareReaderValues} from "../lib/reader/shared.ts";
import type {CoveredBody} from "../lib/registry/coverage.ts";

test("opening a body loads all members and photos once, including a second body sharing its roster",async()=>{
  const roster={members:Array.from({length:38},(_,index)=>({id:`fixture:member-${index}`,name:`Member ${index+1}`,officeTitle:"Director",
    photoUrl:`/portrait.png?member=${index}`,provenance:{sourceUrl:"https://example.gov/board",sourceOrg:"Board",collectedAt:"2026-10-26",verifiedAt:null}})),
    gaps:[],officePhone:null} as unknown as NonNullable<CoveredBody["readerRoster"]>;
  const hash=readerRosterKey(roster);
  const body={bodyId:"ocd-division/country:us/state:az/place:fixture#one",name:"Example Board",ocdId:null,divisionLabel:"Example Government",
    divisionType:null,lsad:null,schoolDependency:"UNCLASSIFIED",bodyClass:"GOVERNING",coverageStatus:"LIVE",homepageUrl:null,agendaSourceRef:null,
    lookedAt:false,tier:"local",rosterRef:hash};
  const bundle=await build({stdin:{resolveDir:process.cwd(),sourcefile:"roster-browser.tsx",loader:"tsx",contents:`
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {bodySubject} from './components/map/map-entry.tsx';
    import {EntityModal} from './components/map/popup/entity-modal.tsx';
    import {DataProvider} from './lib/state/data.tsx';
    import {DoorOverlay} from './components/map/door-overlay.tsx';
    const body=${JSON.stringify(body)};
    function Reader(){const [subject,setSubject]=useState(null);return <><DoorOverlay door="officials" coverage={{bodies:[body],seats:[],senators:[],statewideExecutives:[]}}
      onOpenBody={row=>setSubject(bodySubject(row))} onOpenOfficial={()=>{}} onClose={()=>{}} drawnDistricts={[]} districtOverlayOn={false} atAddress={false} onShowDistricts={()=>{}} embedded/>
      <button onClick={()=>setSubject(bodySubject({...body,bodyId:body.bodyId.replace('#one','#two')}))}>Open second</button>
      {subject&&<DataProvider value={{allMeetings:[],meetings:[],venues:[],result:null,location:null,drawnDistricts:[],dropped:0,searchFailed:false,atAddress:false,governing:null,zipPartial:null,basis:'ZIP'}}><EntityModal subject={subject} onClose={()=>setSubject(null)}/></DataProvider>}</>}
    createRoot(document.getElementById('root')).render(<Reader/>);`},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",
    outfile:"work/zs-01/roster-browser.js",define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"},logLevel:"silent"});
  const postcss=createRequire(import.meta.resolve("@tailwindcss/postcss"))("postcss");
  const stylesheet=readFileSync("app/globals.css","utf8").replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components";');
  const css=(await postcss([tailwindcss()]).process(stylesheet,{from:"app/globals.css"})).css
    +readFileSync("app/reader.css","utf8")+(bundle.outputFiles.find(file=>file.path.endsWith(".css"))?.text??"");
  let requests=0;
  installFactReader(async(text,params)=>{assert.equal(text,"SELECT payload FROM reader_body_roster WHERE hash=$1");assert.deepEqual(params,[hash]);return [{payload:shareReaderValues(roster)}];});
  const server=createServer(async(request,response)=>{
    if(request.url==="/app.js")return void response.writeHead(200,{"content-type":"application/javascript"}).end(bundle.outputFiles.find(file=>file.path.endsWith(".js"))!.text);
    if(request.url?.startsWith("/api/reader/roster")) {
      requests++;const answer=await GET(new Request(`http://localhost${request.url}`));
      return void response.writeHead(answer.status,Object.fromEntries(answer.headers)).end(await answer.text());
    }
    if(request.url?.startsWith("/portrait.png"))return void response.writeHead(200,{"content-type":"image/svg+xml"}).end('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#52667b"/><circle cx="32" cy="23" r="11" fill="#dfc2a2"/><path d="M9 64V54a23 23 0 0 1 46 0v10" fill="#a4b8c9"/></svg>');
    if(request.url?.startsWith("/api/"))return void response.writeHead(503,{"content-type":"application/json"}).end("{}");
    if(request.url==="/style.css")return void response.writeHead(200,{"content-type":"text/css"}).end(css);
    response.writeHead(200,{"content-type":"text/html"}).end('<link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();assert.ok(address&&typeof address!=="string");
  const browser=await launchGuarded({label:"zs-01-roster"});
  try {
    for(const width of [1100,390]) {
      const context=await browser.context({viewport:{width,height:900}}),page=await context.newPage();
      const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
      await page.goto(`http://127.0.0.1:${address.port}`);const before=requests;
      assert.equal(await page.locator('[data-roster-holder]').count(),0);assert.equal(requests,before);
      await page.getByRole("button",{name:"Example Board →",exact:true}).click();
      await page.getByRole("button",{name:/Who sits on it/}).click();
      await page.locator('[data-roster-holder]').last().waitFor();
      assert.equal(await page.locator('[data-roster-holder]').count(),38);
      assert.deepEqual(await page.locator('[data-roster-holder]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-roster-holder'))),roster.members.map(member=>member.id));
      const portraits=page.locator('[data-roster-holder] img');assert.equal(await portraits.count(),38);
      for(const portrait of await portraits.all()) {await portrait.scrollIntoViewIfNeeded();await portrait.evaluate(img=>(img as HTMLImageElement).decode());}
      assert.equal(await portraits.evaluateAll(images=>images.filter(img=>(img as HTMLImageElement).naturalWidth>0).length),38);
      assert.equal(requests,before+1);
      mkdirSync('work/zs-01',{recursive:true});await page.screenshot({path:`work/zs-01/body-${width}.png`,fullPage:true});
      await page.getByRole("dialog",{name:"Example Board",exact:true}).getByRole("button",{name:"Close",exact:true}).click();await page.getByRole("button",{name:"Open second",exact:true}).click();
      await page.getByRole("button",{name:/Who sits on it/}).click();await page.locator('[data-roster-holder]').last().waitFor();
      assert.equal(await page.locator('[data-roster-holder]').count(),38);assert.equal(requests,before+1);assert.deepEqual(errors,[]);
      await context.close();
    }
  } finally {await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));installFactReader(undefined);}
});
