import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { launchGuarded } from "../scripts/browser.mts";

test("Show more reveals added meetings inside closed groups across ZIPs and grouping modes", async () => {
  // Synthetic meetings stay on this local server; providers, frame, rows and controls are production code.
  const output = await build({
    stdin: {
      contents: `import React from "react"; import {createRoot} from "react-dom/client";
        import {ListOverlay} from "./components/map/list-overlay.tsx";
        import {ReaderCard} from "./components/shell/reader-card.tsx";
        import {UiProvider} from "./lib/state/provider.tsx";
        import {DataProvider} from "./lib/state/data.tsx";
        const params=new URLSearchParams(location.search);
        const zip=params.get("zip"),state=params.get("state"),group=params.get("group");
        const count=zip==="85701"?243:443;
        const meetings=Array.from({length:count},(_,i)=>({
          id:"synthetic:"+zip+":"+i,bodyId:"synthetic:"+state+":"+(i%4),
          ocdId:"ocd-division/country:us/state:"+state+(i%2?"/place:synthetic":""),
          title:"Synthetic meeting "+i,bodyName:["School Board","City Council","County Board","Advisory Committee"][i%4],
          jurisdiction:"Synthetic jurisdiction "+(i%4)+", "+state.toUpperCase(),
          startsAt:"2099-01-"+String(1+i%4).padStart(2,"0")+"T12:00:00Z",
          timeZone:"UTC",status:"SCHEDULED",location:null,agendaUrl:null,
          provenance:{sourceUrl:"https://example.test/"+zip+"/"+i,sourceOrg:"Synthetic fixture",collectedAt:"2026-10-17",verifiedAt:null}
        }));
        const data={meetings,allMeetings:meetings,venues:[],result:null,
          location:{zip,lat:0,lng:0},drawnDistricts:[],dropped:0,searchFailed:false,
          atAddress:false,governing:null,zipPartial:null,basis:"ZIP"};
        createRoot(document.getElementById("root")).render(<UiProvider initial={{listOverlayOpen:true,listGroupBy:group}}>
          <DataProvider value={data}><ReaderCard viewKey="list" kicker="Meetings" zip={zip} backLabel={null} onBack={()=>{}} onClose={()=>{}}>
            <ListOverlay embedded onPickMeeting={()=>{}} />
          </ReaderCard></DataProvider></UiProvider>);`,
      resolveDir: process.cwd(), sourcefile: "reader-meeting-expansion-fixture.tsx", loader: "tsx",
    },
    bundle: true, write: false, outfile: ".scratch/reader-meeting-expansion.js",
    platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, logLevel: "silent",
  });
  const javascript = output.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const css = ["app/globals.css", "app/reader.css"].map(file => readFileSync(file, "utf8").replace(/^@import.*;$/gm, "")).join("\n");
  const server = createServer((request, response) => {
    if (request.url === "/fixture.js") response.writeHead(200, { "content-type": "application/javascript" }).end(javascript);
    else if (request.url === "/fixture.css") response.writeHead(200, { "content-type": "text/css" }).end(css);
    else response.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const browser = await launchGuarded({ label: "reader-meeting-expansion", blockWrites: true });
  try {
    for (const [zip, state] of [["85701", "az"], ["05401", "vt"], ["99501", "ak"]]) {
      const page = await browser.page({ viewport: zip === "05401" ? { width: 375, height: 800 } : { width: 1440, height: 1000 } });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      for (const group of ["jurisdiction", "body-type", "district", "date", "none"]) {
        await page.goto(`http://127.0.0.1:${address.port}/?zip=${zip}&state=${state}&group=${group}`);
        await page.locator(".al-more").waitFor({ state: "visible" });
        const rowIds = () => page.locator(".al-row [data-meeting-id]").evaluateAll(rows => rows.map(row => row.getAttribute("data-meeting-id")));
        // Open every group to record the first page, then close them to reproduce the reported view.
        const heads = page.locator(".al-group-head");
        for (const head of await heads.all()) await head.click();
        assert.equal((await rowIds()).length, 200, `${zip}/${group}: initial page`);
        const initialIds = new Set(await rowIds());
        for (const head of await heads.all()) await head.click();
        if (group !== "none") assert.equal(await page.locator(".al-row").count(), 0);
        const start = Date.now();
        await page.locator(".al-more").click();
        await page.waitForFunction(initial => [...document.querySelectorAll(".al-row [data-meeting-id]")].some(row => !initial.includes(row.getAttribute("data-meeting-id")!)), [...initialIds], { timeout: 3000 });
        assert.ok(Date.now() - start < 3000, `${zip}/${group}: expansion is usable within three seconds`);
        const addedIds = (await rowIds()).filter(id => !initialIds.has(id));
        assert.equal(addedIds.length, zip === "85701" ? 43 : 200, `${zip}/${group}: all newly added meetings are visible`);
        // Every opened group still collapses and reopens, including with the keyboard.
        for (const head of await heads.all()) {
          const rows = head.locator("..").locator(".al-row");
          if (await head.getAttribute("aria-expanded") === "false") await head.click();
          const count = await rows.count();
          assert.ok(count > 0);
          await head.focus();
          await head.press("Enter");
          assert.equal(await rows.count(), 0);
          await head.press("Space");
          assert.equal(await rows.count(), count);
        }
        if (zip !== "85701") await page.locator(".al-more").click();
        assert.equal(await page.locator(".al-more").count(), 0);
        assert.equal((await rowIds()).length, zip === "85701" ? 243 : 443);
        const sources = page.locator("[data-card-sources] button").first();
        await sources.click();
        assert.equal(await sources.getAttribute("aria-expanded"), "true");
        assert.ok(await page.locator('[data-card-sources] a[href^="https://example.test/"]').first().isVisible());
        await sources.click();
        assert.equal(await sources.getAttribute("aria-expanded"), "false");
        assert.deepEqual(errors, [], `${zip}/${group}: browser errors`);
      }
      await page.context().close();
    }
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
