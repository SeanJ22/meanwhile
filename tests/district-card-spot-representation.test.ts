import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { districtSubject, spotDivisionsFor } from "../components/map/district-subject.tsx";
import type { DivisionRepresentation } from "../hooks/use-division-representation.ts";
import type { DistrictHit } from "../lib/map/districts.ts";
import { seatHoldersForDivision } from "../lib/registry/server.ts";
import { statePeopleSourcePointers } from "../lib/officials/people-identity.ts";
import { GET } from "../app/api/representation/[...division]/route.ts";
import { launchGuarded } from "../scripts/browser.mts";
import { installAbsent, installFederalDirectory } from "./helpers/promoted-fixtures.ts";
import { recordedPointHits, recordedSpotFederalDirectory } from "./helpers/map-representation-fixtures.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { registryTransferImport } from "./helpers/promoted-fixtures.ts";
import { registryJurisdictions } from "../lib/civic-data/state-scopes.ts";
import { installPromotedValue } from "./helpers/promoted-fixtures.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { rosterFactReader } from "./helpers/roster-fact-reader.ts";
import type { CivicDataReadResult } from "../lib/civic-data/read-model.ts";
import { readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";


function served<T>(read: CivicDataReadResult<T>, what: string): T {
  if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") throw new Error(`${what} fixture did not install: ${read.kind} ${"detail" in read ? read.detail : ""}`);
  return read.value as T;
}

function registryFixtureForState(state: string, value: RegistryRuntimeReadModel = registryTransferImport().projection.payload): RegistryRuntimeReadModel {
  const own = (id: string | null) => registryJurisdictions(id).includes(state.toUpperCase());
  const bodies = value.registry.bodies.filter(row => own(row.id) || own(row.ocdId) || row.alsoServesOcdIds?.some(own));
  const bodyIds = new Set(bodies.map(row => row.id));
  const bodyRosters = value.bodyRosters.filter(row => bodyIds.has(row.bodyId));
  const statewideExecutives = value.statewideExecutives.filter(row => own(row.stateOcdId));
  const bridge = value.officialCandidacies.rows.filter(row => row.holder.divisions.some(own));
  const holders = new Set([...bodyRosters.flatMap(row => row.members.map(member => member.id)),
    ...statewideExecutives.map(row => row.holder.id), ...bridge.map(row => row.holder.id)]);
  return { ...value, registry: { ...value.registry, bodies,
    divisions: value.registry.divisions.filter(row => row.ocdId === "ocd-division/country:us" || own(row.ocdId)) },
    bodyRosters, statewideExecutives, officialCandidacies: { ...value.officialCandidacies, rows: bridge },
    officialPhotos: { photos: value.officialPhotos.photos.filter(row => holders.has(row.officeholderId)) },
    rosterPhotos: Object.fromEntries(Object.entries(value.rosterPhotos).filter(([id]) => holders.has(id) || own(id))),
    rosterReaderDispositions: value.rosterReaderDispositions.filter(row => own(row.sourceId) || holders.has(row.sourceId) || (row.canonicalId !== null && holders.has(row.canonicalId)) ||
      [...holders].some(id => id.startsWith("roster:") && id.split("#")[0] === row.sourceId.split("#")[0])) };
}

async function installRegistryRuntime(states?: readonly string[]): Promise<{ readonly value: RegistryRuntimeReadModel; readonly versionId: string }> {
  const { projection } = registryTransferImport();
  const selected = states ?? [...new Set(projection.payload.registry.divisions.flatMap(row => registryJurisdictions(row.ocdId)))];
  for (const state of selected) installPromotedValue({ recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope(state),
    sourceId: projection.sourceId, versionId: `${projection.versionId}:${state}`, value: registryFixtureForState(state) });
  installFactReader(rosterFactReader(projection.payload.bodyRosters));
  const value = served(await readRegistryRuntimeProjection(selected), "Registry runtime");
  return { value, versionId: selected.map(state => `${projection.versionId}:${state}`).join("|") };
}


await installRegistryRuntime();
await installFederalDirectory(recordedSpotFederalDirectory());
// These source families are explicitly absent in this federal/local fixture.
for (const state of ["TX", "IA", "AZ"]) {
  // Every independent people source for the state, not only the original two: each is absent here.
  for (const pointer of statePeopleSourcePointers(`US-${state}`)) installAbsent(pointer.recordClass, pointer.scope);
}
const houston = recordedPointHits("houston");
const desMoines = recordedPointHits("des-moines");
const pima: DistrictHit = { type: "county", tier: "local", typeLabel: "County", state: "AZ",
  ocdId: "ocd-division/country:us/state:az/county:pima", label: "Pima County" };

async function answersFor(hits: DistrictHit[]): Promise<Record<string, DivisionRepresentation>> {
  const ids = [...new Set(hits.flatMap(hit => [hit.ocdId, ...spotDivisionsFor(hit, hits).map(row => row.ocdId)]))];
  return Object.fromEntries(await Promise.all(ids.map(async id => {
    const holders = await seatHoldersForDivision(id);
    return [id, { holders, status: holders.length ? "resolved" : "unsourced" } satisfies DivisionRepresentation];
  })));
}

test("Houston county, city and TX-7 cards keep their own roster and show the spot's House member and senators", async () => {
  const answers = await answersFor(houston);
  assert.deepEqual(houston.map(hit => hit.ocdId.split("/").at(-1)).sort(), ["cd:7", "county:harris", "place:houston", "sldl:147", "sldu:15"]);
  for (const segment of ["county:harris", "place:houston", "cd:7"]) {
    const hit = houston.find(hit => hit.ocdId.endsWith(segment))!;
    const card = districtSubject(hit, [], null, answers, houston);
    assert.deepEqual(card.representation.map(holder => holder.name), segment === "cd:7" ? ["Lizzie Fletcher"] : []);
    const spot = card.spotRepresentation!;
    assert.deepEqual(spot.map(row => row.label), ["TX-7", "State Senate District 15", "State House District 147", "TX statewide"]);
    assert.deepEqual(spot.flatMap(row => row.holders.map(holder => holder.name)).sort(), ["John Cornyn", "Lizzie Fletcher", "Ted Cruz"]);
    for (const holder of spot.flatMap(row => row.holders)) {
      assert.ok(card.sources.some(source => source.provenance.sourceUrl === holder.sourceUrl), `${holder.name}: the spot's source is missing`);
    }
  }
});

test("Des Moines county and IA-3 cards show IA-3 and both Iowa senators", async () => {
  const answers = await answersFor(desMoines);
  for (const segment of ["county:polk", "cd:3"]) {
    const hit = desMoines.find(hit => hit.ocdId.endsWith(segment))!;
    const card = districtSubject(hit, [], null, answers, desMoines);
    assert.deepEqual(card.representation.map(holder => holder.name), segment === "cd:3" ? ["Zachary Nunn"] : []);
    assert.deepEqual(card.spotRepresentation!.flatMap(row => row.holders.map(holder => holder.name)).sort(), ["Chuck Grassley", "Joni Ernst", "Zachary Nunn"]);
    assert.equal(card.spotRepresentation![0].label, "IA-3");
  }
});

test("Pima County retains its five supervisors as its own roster", async () => {
  const answers = await answersFor([pima]);
  const card = districtSubject(pima, [], null, answers, [pima]);
  assert.equal(card.representation.length, 5);
  assert.ok(card.representation.every(holder => /supervisor/i.test(holder.officeTitle)));
  assert.deepEqual(card.representation.map(holder => holder.id), answers[pima.ocdId].holders.map(holder => holder.id));
});

test("point divisions are deduplicated, respect the state boundary, and use only hits from this click", () => {
  const county = houston.find(hit => hit.type === "county")!;
  const divisions = spotDivisionsFor(county, [...houston, ...houston, ...desMoines]);
  assert.equal(divisions.length, 4);
  assert.ok(divisions.every(row => row.ocdId.startsWith("ocd-division/country:us/state:tx")));
  assert.deepEqual(spotDivisionsFor(county, []), [{ ocdId: "ocd-division/country:us/state:tx", label: "TX statewide", tier: "state" }]);
});

test("the actual card resolves divisions concurrently on first use, isolates failures, and replaces the clicked spot", async () => {
  const output = await build({ stdin: { contents: `
    import React, {useState} from "react"; import {createRoot} from "react-dom/client";
    import {useDivisionsRepresentation} from "./hooks/use-division-representation.ts";
    import {districtSubject,spotDivisionsFor} from "./components/map/district-subject.tsx";
    import {EntityModal} from "./components/map/popup/entity-modal.tsx";
    import {UiProvider} from "./lib/state/provider.tsx";
    import {DataProvider} from "./lib/state/data.tsx";
    const points=${JSON.stringify({ houston, desMoines, pima: [pima] })};
    function App() {
      const [place,setPlace]=useState("houston"); const [selected,setSelected]=useState(0);
      const hits=points[place]; const district=hits[selected];
      const answers=useDivisionsRepresentation(null,hits.flatMap(hit=>[hit.ocdId,...spotDivisionsFor(hit,hits).map(row=>row.ocdId)]));
      return <DataProvider value={{allMeetings:[],meetings:[],venues:[],result:null,location:null,drawnDistricts:[],dropped:0,searchFailed:false,atAddress:false,governing:null,zipPartial:null,basis:"ZIP"}}><UiProvider><nav>{Object.keys(points).map(name=><button key={name} onClick={()=>{setPlace(name);setSelected(0);}}>{name}</button>)}</nav>
        {hits.map((hit,index)=><button key={hit.ocdId} onClick={()=>setSelected(index)}>{hit.label}</button>)}
        <pre id="statuses">{JSON.stringify(Object.fromEntries(Object.entries(answers).map(([id,answer])=>[id,answer.status])))}</pre>
        <EntityModal embedded subject={districtSubject(district,[],null,answers,hits)} onClose={()=>{}} onOpenHolder={holder=>{document.getElementById("opened").textContent=holder.name;}}/>
        <output id="opened"/></UiProvider></DataProvider>;
    }
    createRoot(document.getElementById("root")).render(<App/>);`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, outfile: ".scratch/mr-01-card.js", platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, logLevel: "silent" });
  const js = output.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const requested = new Set<string>();
  const expected = new Set(houston.flatMap(hit => [hit.ocdId, ...spotDivisionsFor(hit, houston).map(row => row.ocdId)]));
  let announceStarted = () => {};
  const allStarted = new Promise<void>(resolve => { announceStarted = resolve; });
  let release = () => {};
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const server = createServer(async (request, response) => {
    if (request.url === "/card.js") response.writeHead(200, { "content-type": "application/javascript" }).end(js);
    else if (request.url?.startsWith("/api/representation/")) {
      const division = request.url.slice("/api/representation/".length).split("/").map(decodeURIComponent);
      const id = division.join("/");
      requested.add(id);
      if ([...expected].every(id => requested.has(id))) announceStarted();
      if (id.includes("state:tx")) await waiting;
      // One failed district must not suppress the independent federal answers.
      if (id.endsWith("/sldu:15")) response.writeHead(503).end();
      // An answer naming another division must never be shown under this one.
      else if (id.endsWith("/sldl:147")) response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ocdId: "ocd-division/country:us/state:ia/cd:3", holders: [] }));
      else {
        const route = await GET(new Request(`http://example.test${request.url}`), { params: Promise.resolve({ division }) });
        response.writeHead(route.status, { "content-type": "application/json" }).end(await route.text());
      }
    } else if (request.url === "/") response.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><div id="root"></div><script src="/card.js"></script>');
    else response.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  try {
    browser = await launchGuarded({ label: "mr-01-map-representation", blockWrites: true });
    const context = await browser.context({ viewport: { width: 1000, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.getByRole("button", { name: "Who represents this spot", exact: true }).waitFor({ timeout: 5_000 }).catch(error => {
      throw new Error(`${error.message}; browser errors: ${errors.join("; ")}`);
    });
    assert.match(await page.locator("#statuses").innerText(), /looking/);
    // All six division requests start before any of them can answer.
    let requestTimeout: ReturnType<typeof setTimeout>;
    await Promise.race([allStarted, new Promise<void>((_, reject) => {
      requestTimeout = setTimeout(() => reject(new Error("Not all point lookups started while responses were blocked")), 5_000);
    })]).finally(() => clearTimeout(requestTimeout));
    assert.deepEqual([...requested].sort(), [...expected].sort());
    release();
    await page.getByRole("button", { name: "Harris County", exact: true }).click();
    await page.locator('[data-spot-division$="/cd:7"]').getByRole("button", { name: "Lizzie Fletcher", exact: true }).waitFor();
    const texas = page.locator('[data-spot-division="ocd-division/country:us/state:tx"]');
    await texas.getByRole("button", { name: "John Cornyn", exact: true }).waitFor();
    await texas.getByRole("button", { name: "Ted Cruz", exact: true }).waitFor();
    await page.waitForFunction(() => !Object.values(JSON.parse(document.querySelector("#statuses")!.textContent!)).includes("looking"));
    const statuses = JSON.parse(await page.locator("#statuses").innerText());
    assert.equal(statuses["ocd-division/country:us/state:tx/county:harris"], "unsourced");
    assert.equal(statuses["ocd-division/country:us/state:tx/sldu:15"], "unavailable");
    assert.equal(statuses["ocd-division/country:us/state:tx/sldl:147"], "unavailable");
    await texas.getByRole("button", { name: "Ted Cruz", exact: true }).click();
    assert.equal(await page.locator("#opened").innerText(), "Ted Cruz");
    await page.getByRole("button", { name: "TX-7", exact: true }).click();
    await texas.getByRole("button", { name: "John Cornyn", exact: true }).waitFor();
    await mkdir(".scratch/ci", { recursive: true });
    await page.screenshot({ path: ".scratch/ci/mr-01-houston-card.png", fullPage: true });
    await page.getByRole("button", { name: "desMoines", exact: true }).click();
    const iowa = page.locator('[data-spot-division="ocd-division/country:us/state:ia"]');
    await iowa.getByRole("button", { name: "Chuck Grassley", exact: true }).waitFor();
    await iowa.getByRole("button", { name: "Joni Ernst", exact: true }).waitFor();
    assert.equal(await page.getByText("John Cornyn", { exact: true }).count(), 0);
    assert.equal(await page.locator('[data-spot-division$="/cd:3"]').getByRole("button", { name: "Zachary Nunn", exact: true }).count(), 1);
    await page.screenshot({ path: ".scratch/ci/mr-01-des-moines-card.png", fullPage: true });
    await page.getByRole("button", { name: "pima", exact: true }).click();
    await page.getByRole("button", { name: "Representation", exact: true }).click();
    const ownRoster = page.getByRole("button", { name: "Representation", exact: true }).locator("..").locator('[data-roster-holder]');
    await ownRoster.first().waitFor();
    assert.equal(await ownRoster.count(), 5);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    release();
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
