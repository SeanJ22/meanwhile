import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { build } from "esbuild";
import { launchGuarded } from "../scripts/browser.mts";

test("equivalent state and place records reuse office work, while changed records update pins", async () => {
  const output = await build({ stdin: { contents: `
    import React,{useEffect,useState} from "react";import {createRoot} from "react-dom/client";
    import {useOfficePins} from "./hooks/use-office-pins.ts";
    import {useBodyOfficeLocations} from "./hooks/use-body-office-locations.ts";
    import {primeStateMemberDirectories} from "./hooks/use-member-directory.ts";
    const provenance={sourceUrl:"https://example.gov/offices",sourceOrg:"Official office",collectedAt:"2026-10-01"};
    primeStateMemberDirectories([{ids:["congress:A000001"],directory:{committees:[],districtOffices:[{address:"100 Example Street",city:"Tucson",state:"AZ",zip:"85701",lat:32.2,lng:-110.9}],officeDetails:[{...provenance,officeKind:"DISTRICT",official:true}]}}],"AZ");
    const initial={seats:[{ocdId:"ocd-division/country:us/state:az/cd:7",divisionType:"cd",label:"District 7",representatives:[{id:"congress:A000001",name:"First name",state:"AZ"}]}],senators:[],bodies:[{bodyId:"body:one",name:"Board",officeContact:{address:"200 Example Street",provenance}}]};
    const meetings=[{bodyId:"body:one",location:null,online:{url:"https://example.gov/watch"}}],venues=[];
    function App(){
      const [coverage,setCoverage]=useState(initial),[version,setVersion]=useState(0);
      const pins=useOfficePins(coverage,{bounds:null,venues});
      const locations=useBodyOfficeLocations(coverage.bodies,meetings);
      useEffect(()=>{window.officePublications=(window.officePublications||0)+1},[pins,locations]);
      return <><button onClick={()=>{setCoverage(JSON.parse(JSON.stringify(coverage)));setVersion(v=>v+1)}}>Equivalent</button><button onClick={()=>{setCoverage({...coverage,seats:[{...coverage.seats[0],representatives:[{...coverage.seats[0].representatives[0],name:"Updated name"}]}]});setVersion(v=>v+1)}}>Change</button><pre id="answer">{JSON.stringify({version,pins,locations})}</pre></>;
    }
    createRoot(document.getElementById("root")).render(<App/>);`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  const requests: string[] = [];
  const server = createServer(async (request, response) => {
    if (request.url === "/app.js") response.writeHead(200, { "content-type": "application/javascript" }).end(output.outputFiles[0].text);
    else if (request.url === "/api/geocode") {
      let body = ""; for await (const chunk of request) body += chunk;
      const { address } = JSON.parse(body); requests.push(address);
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ match: true, lat: 32.2, lng: -110.9 }));
    } else response.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  try {
    browser = await launchGuarded({ label: "rs-01-office-work", blockWrites: true });
    const page = await (await browser.context()).newPage();
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.waitForFunction(() => { const value = JSON.parse(document.querySelector("#answer")!.textContent!); return value.pins.pins.length === 1 && value.locations.length === 1; });
    const publications = await page.evaluate(() => (window as unknown as {officePublications:number}).officePublications);
    // The representative's office arrives with the point saved at publication; only the board's office is located here.
    assert.equal(requests.length, 1);
    await page.getByRole("button", { name: "Equivalent" }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector("#answer")!.textContent!).version === 1);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(requests.length, 1, "equivalent data does not repeat the completed geocode");
    assert.equal(await page.evaluate(() => (window as unknown as {officePublications:number}).officePublications), publications, "unchanged office results keep their references and do not republish");
    await page.getByRole("button", { name: "Change", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector("#answer")!.textContent!).pins.pins[0]?.name === "Updated name");
    assert.equal(requests.length, 1, "a changed owner publishes its current name while reusing its saved office point");
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
