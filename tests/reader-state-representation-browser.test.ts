import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { build } from "esbuild";
import { launchGuarded } from "../scripts/browser.mts";
import type { CoverageSummary } from "../lib/registry/coverage.ts";
import type { SeatHolder } from "../lib/officials/lookup.ts";

const root = "ocd-division/country:us/state:az";
const own = `${root}/cd:7`, outside = `${root}/cd:6`, empty = `${root}/sldu:20`, unrecorded = `${root}/sldl:21`, local = `${root}/county:pima`;
const person = (id: string, name: string): SeatHolder => ({ id, name, officeTitle: "Representative", partyLabel: null, termEnd: null, birthDate: null,
  websiteUrl: null, sourceUrl: "https://example.gov/people", provenance: null, email: null, phone: null, contactFormUrl: null, photoUrl: null, campaignUrl: null });
const coverage: CoverageSummary = { state: "UNMAPPED", bodies: [], seats: [
  { ocdId: own, label: "Seventh district", divisionType: "cd", tier: "national", representatives: [person("congress:G000606", "Own representative")] },
  { ocdId: outside, label: "Sixth district", divisionType: "cd", tier: "national", representatives: [person("congress:X000001", "Other representative")] },
  { ocdId: empty, label: "Twentieth senate district", divisionType: "sldu", tier: "state", representatives: [] },
], stateLegislatorAuthorities: [], divisions: [], unincorporated: false,
  senators: [person("congress:K000377", "State senator")], statewideExecutives: [person("statewide:az:governor", "Governor")],
  counts: { total: 0, withSource: 0, withoutSource: 0, lookedAt: 0, governing: { total: 0, withSource: 0 } }, seatCounts: { total: 3, named: 2 } };

test("map and confirmed district hooks reuse the pending and complete state instead of refetching every district", async () => {
  const output = await build({ stdin: { contents: `
    import React,{useEffect,useState} from "react"; import {createRoot} from "react-dom/client";
    import {loadReaderState} from "./lib/reader/client.ts";
    import {useDivisionsRepresentation} from "./hooks/use-division-representation.ts";
    import {useConfirmedDivisions} from "./hooks/use-confirmed-divisions.ts";
    const coverage=${JSON.stringify(coverage)};
    const scoped={...coverage,seats:coverage.seats.filter(seat=>seat.ocdId===${JSON.stringify(own)})};
    const ids=${JSON.stringify([own, outside, empty, unrecorded, root, local])};
    const loading=loadReaderState("AZ");
    const location={certainty:"ADDRESS_RESOLVED",zip:"85701",confirmedDivisionIds:ids,splitLevels:[]};
    function App(){
      const [phase,setPhase]=useState("pending");
      useEffect(()=>{void loading.then(()=>setPhase("ready"));},[]);
      const drawn=useDivisionsRepresentation(scoped,ids);
      const confirmed=useConfirmedDivisions(scoped,location,["cd","sldu","sldl","state","county"]);
      return <pre id="answer">{JSON.stringify({phase,drawn,confirmed})}</pre>;
    }
    createRoot(document.getElementById("root")).render(<App/>);`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, outfile: ".scratch/rs01-representation.js", platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, logLevel: "silent" });
  const js = output.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const requested: string[] = [];
  let release = () => {};
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const server = createServer(async (request, response) => {
    if (request.url === "/app.js") response.writeHead(200, { "content-type": "application/javascript" }).end(js);
    else if (request.url === "/api/reader/state?state=AZ") {
      await waiting;
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ state: "AZ", version: "held", coverage, zipPlaces: {}, directory: null, boundaryUrl: "/tiles.pmtiles" }));
    } else if (request.url?.startsWith("/api/representation/")) {
      const id = request.url.slice("/api/representation/".length).split("/").map(decodeURIComponent).join("/");
      requested.push(id);
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ocdId: id, label: "Pima County", divisionType: "county", tier: "local", holders: [person("roster:pima:1", "Supervisor")] }));
    } else response.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  try {
    browser = await launchGuarded({ label: "rs-01-state-representation", blockWrites: true });
    const context = await browser.context(); const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.waitForFunction(local => JSON.parse(document.querySelector("#answer")!.textContent!).drawn[local]?.status === "resolved", local);
    let answer = JSON.parse(await page.locator("#answer").innerText());
    assert.equal(answer.phase, "pending");
    assert.equal(answer.drawn[outside].status, "looking");
    assert.deepEqual(requested, [local, local], "pending state requests suppress district fan-out while both hooks independently resolve local divisions");
    release();
    await page.waitForFunction(() => JSON.parse(document.querySelector("#answer")!.textContent!).phase === "ready");
    answer = JSON.parse(await page.locator("#answer").innerText());
    assert.equal(answer.drawn[outside].holders[0].name, "Other representative");
    assert.equal(answer.drawn[empty].status, "unsourced");
    assert.equal(answer.drawn[unrecorded].status, "unsourced");
    assert.deepEqual(answer.drawn[root].holders.map((holder: SeatHolder) => holder.name), ["State senator", "Governor"]);
    assert.equal(answer.confirmed.find((row: { ocdId: string }) => row.ocdId === outside).label, "Sixth district");
    assert.equal(answer.confirmed.find((row: { ocdId: string }) => row.ocdId === empty).status, "unsourced");
    assert.equal(answer.confirmed.find((row: { ocdId: string }) => row.ocdId === unrecorded).status, "unsourced");
    assert.deepEqual(requested, [local, local], "complete state data suppresses requests for sourced and unsourced state seats");
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    release(); await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
