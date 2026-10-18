import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CHAMBER_DIRECTORY_URLS, parseChamberDirectory, withChamberDirectories } from "../lib/officials/chamber-directory.ts";
import { normalizeCongressDirectory } from "../lib/officials/congress-normalize.ts";
import { federalDirectoryCandidate } from "../lib/officials/federal-directory-data-plane.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { federalDirectoryEdge } from "./helpers/promoted-fixtures.ts";
import { GET } from "../app/api/directory/route.ts";
import { DirectoryRecordsContent } from "../components/officials/member-directory.tsx";
import { representationNoteFor } from "../lib/registry/representation.ts";
import { Representation } from "../components/map/popup/entity-modal.tsx";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { launchGuarded } from "../scripts/browser.mts";

// Selected source fields captured read-only on October 18; no invented office addresses.
const at = "2026-10-18T03:15:00.000Z", sha = "a".repeat(40);
const captures = ["house", "senate"].map(chamber => ({ finalUrl: CHAMBER_DIRECTORY_URLS[chamber as "house" | "senate"],
  body: readFileSync(new URL(`./fixtures/sh-01-${chamber}-contacts.xml`, import.meta.url), "utf8"), retrievedAt: at }));
function roster(state: string, id: string, type = "rep") {
  return normalizeCongressDirectory({ "legislators-current": [{ id: { bioguide: id }, name: { first: "Source", last: "Member" },
    terms: [{ type, state, district: 1, start: "2025-01-03", end: "2027-01-03" }] }] }, sha, at);
}

test("free chamber feeds carry all four missing Capitol offices, joined by state and Bioguide identity", () => {
  for (const [state, id, chamber] of [["CA", "G000607", 0], ["CA", "W000832", 0], ["GA", "B001328", 0], ["SC", "G000608", 1]] as const) {
    const parsed = parseChamberDirectory(captures[chamber], state);
    assert.ok(parsed.offices.get(`congress:${id}`)?.address);
    assert.ok(parsed.offices.get(`congress:${id}`)?.phone);
    assert.equal(parseChamberDirectory(captures[chamber], "AZ").offices.has(`congress:${id}`), false);
  }
  assert.throws(() => parseChamberDirectory({ ...captures[0], finalUrl: "https://example.org/MemberData.xml" }, "CA"), /SOURCE_INVALID/);
  assert.throws(() => parseChamberDirectory({ ...captures[0], body: "<html>unavailable</html>" }, "CA"), /XML_INVALID/);
});

test("only the Clerk's explicit vacancy statement labels FL-20 and TX-23 vacant", () => {
  for (const [state, district] of [["FL", "20"], ["TX", "23"]]) {
    const vacancies = parseChamberDirectory(captures[0], state).vacancies;
    assert.equal(vacancies.length, 1);
    assert.equal(vacancies[0].ocdId, `ocd-division/country:us/state:${state.toLowerCase()}/cd:${district}`);
    assert.match(vacancies[0].reason, /^Vacancy due to the resignation/);
    assert.equal(representationNoteFor("federal", "gap", vacancies[0]), "This seat is vacant.");
    assert.match(renderToStaticMarkup(createElement(Representation, { holders: [], vacancy: vacancies[0], note: "This seat is vacant." })), /This seat is vacant\./);
  }
  assert.deepEqual(parseChamberDirectory(captures[0], "CA").vacancies, []);
  assert.deepEqual(parseChamberDirectory({ ...captures[0], body: '<MemberData><member><statedistrict>FL20</statedistrict></member></MemberData>' }, "FL").vacancies, []);
  const prior = withChamberDirectories(roster("FL", "A000001"), "FL", captures);
  const incomplete = { ...captures[0], body: '<MemberData><member><statedistrict>FL20</statedistrict></member></MemberData>' };
  assert.deepEqual(withChamberDirectories(prior, "FL", [incomplete], prior).vacancies, prior.vacancies, "an omitted seat cannot erase an explicit vacancy we hold");
  const filled = { ...captures[0], body: '<MemberData><member><statedistrict>FL20</statedistrict><bioguideID>A000001</bioguideID><official-name>New Member</official-name></member></MemberData>' };
  assert.deepEqual(withChamberDirectories(prior, "FL", [filled], prior).vacancies, [], "a named current occupant ends a prior vacancy");
  assert.equal(representationNoteFor("federal"), "No sourced officeholder for this division yet.");
});

test("the actual reader panel visibly labels both Clerk-confirmed vacancies with their source", async () => {
  const vacancies = ["FL", "TX"].flatMap(state => parseChamberDirectory(captures[0], state).vacancies);
  const output = await build({ stdin: { contents: `
    import React from "react"; import {createRoot} from "react-dom/client";
    import {CoverageNotice} from "./components/map/coverage-notice.tsx";
    import {UiProvider} from "./lib/state/provider.tsx"; import {DataProvider} from "./lib/state/data.tsx";
    const vacancies=${JSON.stringify(vacancies)};
    const data={allMeetings:[],meetings:[],venues:[],result:null,location:null,drawnDistricts:[],dropped:0,searchFailed:false,atAddress:false,governing:null,zipPartial:null,basis:"ZIP"};
    function App(){return <DataProvider value={data}><UiProvider>{vacancies.map((vacancy,index)=>{
      const coverage={state:"UNMAPPED",bodies:[],seats:[{ocdId:vacancy.ocdId,label:index?"Texas Congressional District 23":"Florida Congressional District 20",divisionType:"cd",tier:"national",representatives:[],vacancy}],divisions:[],senators:[],statewideExecutives:[],unincorporated:false,stateLegislatorAuthorities:[],counts:{total:0,withSource:0,withoutSource:0,lookedAt:0,governing:{total:0,withSource:0}},seatCounts:{total:1,named:0}};
      return <section key={vacancy.ocdId}><CoverageNotice tier="exact" zip={index?"78840":"33311"} listingCount={0} coverage={coverage}/></section>;
    })}</UiProvider></DataProvider>};createRoot(document.getElementById("root")).render(<App/>);
  `, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, logLevel: "silent" });
  const server = createServer((request, response) => {
    if (request.url === "/panel.js") response.writeHead(200, { "content-type": "application/javascript" }).end(output.outputFiles[0].text);
    else if (request.url === "/") response.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><div id="root"></div><script src="/panel.js"></script>');
    else response.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser: Awaited<ReturnType<typeof launchGuarded>> | undefined;
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    browser = await launchGuarded({ label: "sh-01-vacancies", blockWrites: true });
    const page = await (await browser.context({ viewport: { width: 1000, height: 1000 } })).newPage();
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.getByText("Seat vacant", { exact: false }).first().waitFor({ timeout: 5000 });
    assert.equal(await page.getByText("Seat vacant", { exact: false }).count(), 2);
    assert.equal(await page.getByRole("link", { name: "House Clerk", exact: true }).count(), 2);
    assert.equal(await page.getByRole("link", { name: "House Clerk", exact: true }).first().getAttribute("href"), CHAMBER_DIRECTORY_URLS.house);
    assert.deepEqual(errors, []);
    await mkdir(".scratch/ci", { recursive: true });
    await page.screenshot({ path: ".scratch/ci/sh-01-vacancies.png", fullPage: true });
  } finally { await browser?.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("official Capitol contacts publish independently and reach the actual directory and office card", async () => {
  const core = roster("CA", "G000607"), value = withChamberDirectories(core, "CA", captures);
  const coreUrl = `https://raw.githubusercontent.com/unitedstates/congress-legislators/${sha}/legislators-current.yaml`;
  const candidate = await federalDirectoryCandidate({ state: "CA", projection: value, retrievedAt: at, vault: new MemoryEvidenceStore(),
    acquisitions: [{ requestedUrl: coreUrl, finalUrl: coreUrl, httpStatus: 200, body: "held membership" },
      ...captures.map(capture => ({ ...capture, requestedUrl: capture.finalUrl, httpStatus: 200 }))] });
  const outcome = await processRegisteredManualCandidate(new MemoryRoutineDataStore(), "congress-bulk-roster:CA", candidate, at);
  assert.equal(outcome.candidate.state, "PROMOTED", outcome.candidate.failureDetail ?? "");
  await withReaderAuthorityEdge({ edgeOnly: true, ...federalDirectoryEdge(value) }, async () => {
    const response = await GET(new Request("https://meanwhile.example/api/directory?member=congress:G000607&state=CA"));
    assert.equal(response.status, 200);
    const directory = await response.json();
    assert.equal(directory.officeDetails[0].officeKind, "CAPITOL");
    assert.equal(directory.officeDetails[0].official, true);
    assert.equal(directory.officeDetails[0].sourceUrl, CHAMBER_DIRECTORY_URLS.house);
    const markup = renderToStaticMarkup(createElement(DirectoryRecordsContent, { holderId: "congress:G000607", state: "CA", only: "offices", directory, failed: false }));
    assert.match(markup, /408 Cannon House Office Building/);
    assert.match(markup, /Capitol office/);
  });
  const afterFailedOptionalFeed = withChamberDirectories(core, "CA", [], value);
  assert.deepEqual(afterFailedOptionalFeed.roster.officeholders[0].offices, value.roster.officeholders[0].offices);
});
