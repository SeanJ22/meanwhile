import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { launchGuarded } from "../../scripts/browser.mts";

test("both lanes stay visible, unmeasured lanes stay unknown and never hide known fact counts", async () => {
  const base={hour:"2026-10-24T20:00:00Z",state:"AZ",family:"Government bodies",stage:"fact:live",total:10,closedTotal:8,incoming:3,outgoing:1,changed:0};
  const data={at:"2026-10-24T21:05:00Z",status:"Counting",states:["AZ"],hours:[{
    from:base.hour,through:"2026-10-24T21:00:00Z",measuredAt:"2026-10-24T21:05:00Z",counts:[base],waiting:[],
  }]};
  const entry=`import React,{useState} from "react";import {createRoot} from "react-dom/client";
    import {HourlyCounts} from "./app/(admin)/_mw/admin-v6/scoreboard-hourly-counts.tsx";
    function App(){const [data,setData]=useState(${JSON.stringify(data)});window.setCountData=setData;return <HourlyCounts data={data}/>;}
    createRoot(document.getElementById("root")).render(<App/>);`;
  const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:"scoreboard-lanes.tsx",loader:"tsx"},
    bundle:true,platform:"browser",format:"iife",outfile:"scoreboard-lanes.js",write:false,jsx:"automatic",loader:{".css":"empty"}});
  const browser=await launchGuarded({label:"scoreboard-lanes",headless:true});
  try {
    const page=await browser.page();
    await page.route("http://admin.local/harness",route=>route.fulfill({status:200,contentType:"text/html",body:"<div id='root'></div>"}));
    await page.goto("http://admin.local/harness");await page.addScriptTag({content:bundle.outputFiles[0]!.text});
    const step=page.getByRole("combobox",{name:"Count step"});await step.waitFor();
    const cells=()=>page.getByRole("row").filter({has:page.getByRole("rowheader",{name:"AZ",exact:true})}).getByRole("cell").allTextContents();
    for(const lane of ["official","checked"]){
      await step.selectOption(`publication:${lane}`);
      assert.deepEqual((await cells()).slice(0,5),["—","—","—","—","—"]);
    }
    await page.evaluate(next=>(window as unknown as {setCountData(value:unknown):void}).setCountData(next),{
      ...data,hours:[{...data.hours[0],counts:[base,{...base,stage:"publication:official",total:1,closedTotal:null,incoming:null,outgoing:null,changed:null}]}],
    });
    await step.selectOption("fact:live");assert.deepEqual((await cells()).slice(0,5),["10","8","3","1","0"]);
    await step.selectOption("publication:official");assert.deepEqual((await cells()).slice(0,3),["1","—","—"]);
    await step.selectOption("publication:checked");assert.deepEqual((await cells()).slice(0,3),["0","—","—"]);
  } finally {await browser.close();}
});
