import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { launchGuarded } from "../scripts/browser.mts";

const screenshotDir = process.argv.find(arg => arg.startsWith("--screenshots="))?.slice("--screenshots=".length) ?? ".scratch/ci";
const insideDivision = "ocd-division/country:us/state:oh/cd:3";
const outsideDivision = "ocd-division/country:us/state:oh/cd:15";
const holder = (name: string) => ({ id: `fixture:${name}`, name, officeTitle: "U.S. Representative", partyLabel: null,
  photoUrl: null, termEnd: null, birthDate: null });
const coverage = {
  state: "UNMAPPED", bodies: [], stateLegislatorAuthorities: [],
  seats: [{ ocdId: outsideDivision, label: "Fixture House District 15", divisionType: "cd", tier: "national",
    representatives: [holder("Fixture District Fifteen Member")] }],
  divisions: [{ ocdId: outsideDivision, label: "Fixture House District 15", divisionType: "cd", tier: "national" }],
  senators: [], statewideExecutives: [], unincorporated: false,
  counts: { total: 0, withSource: 0, withoutSource: 0, lookedAt: 0, governing: { total: 0, withSource: 0 } },
  seatCounts: { total: 1, named: 1 },
};

const output = await build({ stdin: { contents: `
  import React from "react";
  import {createRoot} from "react-dom/client";
  import {AppRouterContext} from "next/dist/shared/lib/app-router-context.shared-runtime";
  import {AddressPrompt} from "./components/address/address-prompt.tsx";
  import {BallotNarrowing} from "./components/ballot/ballot-narrowing.tsx";
  import {MyPicks} from "./components/ballot/my-picks.tsx";
  import {PickControl} from "./components/ballot/pick-control.tsx";
  import {ReactionControl} from "./components/reactions/reaction-control.tsx";
  import {CoverageNotice} from "./components/map/coverage-notice.tsx";
  import {DataProvider} from "./lib/state/data.tsx";
  import {BallotAsk} from "./components/ask/ballot-ask.tsx";
  import {DemandPill} from "./components/demand/demand-pill.tsx";
  const zip = new URL(location.href).searchParams.get("zip") ?? "43215";
  const pickable = [
    {contestId:"fixture:inside", contestTitle:"Fixture House District 3", voteFor:1,
      options:[{id:"fixture:ada", label:"Ada Fixture", reactionTargetId:"fixture:ada"}]},
    {contestId:"fixture:outside", contestTitle:"Fixture House District 15", voteFor:1,
      options:[{id:"fixture:bea", label:"Bea Fixture", reactionTargetId:"fixture:bea"}]},
  ];
  const router = {push:url=>location.assign(url), replace:url=>location.replace(url),
    back:()=>history.back(), forward:()=>history.forward(), refresh:()=>location.reload(), prefetch:()=>{}};
  const data = {result:null, allMeetings:[], meetings:[], venues:[], location:null, drawnDistricts:[],
    dropped:0, searchFailed:false, atAddress:false, governing:null, zipPartial:null, basis:"ZIP"};
  createRoot(document.getElementById("root")).render(
    <AppRouterContext.Provider value={router}><DataProvider value={data}>
      <header><h1>Reader plan — local fixture</h1><p>Synthetic districts, people and answers. No production data or writes.</p></header>
      <main>
        <section className="fixture-card" id="address-entry"><h2>Address lookup</h2><AddressPrompt zip={zip} startOpen /></section>
        <section className="fixture-card" id="ballot"><h2>Ballot for {zip}</h2><BallotNarrowing zip={zip}/>
          {pickable.map(contest=><section key={contest.contestId} id={contest.contestId.split(":")[1]}
              data-contest-id={contest.contestId} data-could-govern="true">
            <h3>{contest.contestTitle}</h3>
            {contest.contestId==="fixture:inside" && <ReactionControl targetType="CANDIDATE" targetId="fixture:ada"
              prompt="Would you vote for Ada Fixture?" context={null}/>}
            <PickControl {...contest}/>
          </section>)}
          <div id="my-picks"><MyPicks zip={zip} pickable={pickable}/></div>
        </section>
        <section className="fixture-card" id="officials"><CoverageNotice tier="exact" zip={zip}
          radiusKm={25} requestedRadiusKm={25} count={0} coverage={${JSON.stringify(coverage)}} embedded/></section>
        <section className="fixture-card" id="saving"><BallotAsk zip={zip} ocdIds={[]} activeSubjects={[]}/>
          <div id="demand"><DemandPill subjectType="BODY" subjectId="fixture:body"/></div>
        </section>
      </main>
    </DataProvider></AppRouterContext.Provider>
  );`, resolveDir: process.cwd(), sourcefile: "reader-plan-fixture.tsx", loader: "tsx" },
  bundle: true, write: false, outfile: ".scratch/reader-plan-fixture.js", platform: "browser", format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, logLevel: "silent" });
const script = output.outputFiles.find(file => file.path.endsWith(".js"))!.text;
const css = (await readFile("app/globals.css", "utf8")).replace('@import "tailwindcss";', "") +
  await readFile("app/reader.css", "utf8") + `
  body { margin:0; padding:20px; font:16px/1.5 system-ui,sans-serif; background:var(--bg); color:var(--text); }
  header,main { max-width:1050px; margin:auto; } h1 { font-size:24px; } h2 { font-size:20px; } h3 { font-size:17px; }
  main { display:grid; grid-template-columns:1fr 1fr; gap:18px; align-items:start; }
  .fixture-card { min-width:0; padding:18px; border:1px solid var(--panel-border); border-radius:10px; background:var(--panel); }
  .fixture-card>h2:first-child { margin-top:0; } #address-entry { grid-column:1/-1; }
  button,input { font:inherit; } button { cursor:pointer; } input { max-width:100%; box-sizing:border-box; color:var(--text); }
  #saving input { width:100%; } #saving button { margin:6px 0; } #demand { margin-top:20px; }
  #inside,#outside { margin-top:18px; } .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); }
  @media(max-width:650px) { body { padding:12px; } main { grid-template-columns:1fr; } .fixture-card { padding:14px; } }
`;

for (const [device, viewport] of [
  ["desktop", { width: 1280, height: 1000 }],
  ["mobile", { width: 390, height: 844 }],
] as const) test(`rendered ${device}: address updates ballot, picks and officials; Undo, uncertainty and save failures stay honest`, async () => {
  const requests: { path: string; body: Record<string, unknown> | null }[] = [];
  const unexpected: string[] = [];
  let demandCalls = 0, askCalls = 0;
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://fixture.test").pathname;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown> : null;
    requests.push({ path, body });
    const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers }).end(JSON.stringify(value));
    if (path === "/fixture.js") response.writeHead(200, { "content-type": "application/javascript" }).end(script);
    else if (path === "/fixture.css") response.writeHead(200, { "content-type": "text/css" }).end(css);
    else if (path === "/" || path === "/ballot") response.writeHead(200, { "content-type": "text/html" }).end(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
    else if (path === "/api/address/resolve") {
      const street = String(body?.street ?? "");
      if (street === "Capitol Sq" && !body?.houseNumber) json({ ok: true, basis: "STREET_SAMPLE",
        resolution: { status: "FAILED", reason: "NOT_FOUND" }, point: { lat: 39.961, lng: -83.001 }, contestIds: [], excludedContestIds: [] });
      else if (street === "123 Missing Way") json({ ok: true, basis: "EXACT_ADDRESS", resolution: { status: "FAILED", reason: "NOT_FOUND" } });
      else if (street === "123 Other Way") json({ ok: true, basis: "EXACT_ADDRESS", resolution: { status: "FAILED", reason: "NOT_FOUND", resolvesInZip: "43216" } });
      else if (street === "123 Capitol Sq" || (street === "Capitol Sq" && body?.houseNumber === "123")) json({ ok: true, basis: "EXACT_ADDRESS",
        resolution: { status: "RESOLVED", basis: "EXACT_ADDRESS", levels: [{ level: "cd", label: "your U.S. House district",
          divisionIds: [insideDivision], divisionLabels: ["Fixture House District 3"], certain: true, candidates: [] }], unheld: ["sldl"] },
        contestIds: ["fixture:inside"], excludedContestIds: ["fixture:outside"] });
      else { unexpected.push(`address: ${JSON.stringify(body)}`); json({ error: "Unexpected fixture address" }, 400); }
    } else if (decodeURIComponent(path) === `/api/representation/${insideDivision}`) json({
      ocdId: insideDivision, label: "Fixture House District 3", divisionType: "cd", tier: "national",
      holders: [holder("Fixture District Three Member")],
    });
    else if (path === "/api/reader/settings") json({ available: true, values: {} });
    else if (path === "/api/demand-signal") { demandCalls += 1; response.writeHead(demandCalls === 1 ? 202 : 204).end(); }
    else if (path === "/api/ask/grounded") { askCalls += 1; json({ mode: "STRUCTURED_GROUNDED",
      answer: "The fixture council adopts a budget at public meetings.", records: [], gaps: [], contacts: [], meetings: [] },
    200, { "x-wtp-ask-save-status": askCalls === 1 ? "FAILED" : "SAVED" }); }
    else if (["/api/reactions", "/api/events", "/favicon.ico"].includes(path)) response.writeHead(204).end();
    else { unexpected.push(path); json({ error: "Unexpected fixture endpoint" }, 404); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  try {
    browser = await launchGuarded({ label: `reader-plan-${device}` });
    const context = await browser.context({ viewport, serviceWorkers: "block" });
    const outsideRequests: string[] = [];
    await context.route("**/*", async route => {
      if (new URL(route.request().url()).origin === origin) await route.fallback();
      else { outsideRequests.push(route.request().url()); await route.abort("blockedbyclient"); }
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(5000);
    await mkdir(screenshotDir, { recursive: true });
    try {
      await page.goto(origin);
      await page.locator("#officials").getByText("Fixture District Fifteen Member", { exact: true }).waitFor();
      await page.getByRole("group", { name: "Would you vote for Ada Fixture?" }).getByRole("button", { name: "Yes", exact: true }).click();
      await page.locator("#my-picks [data-pick-tally][data-picked='1']").waitFor();
      await page.locator("#outside").getByRole("button", { name: "Bea Fixture", exact: true }).click();
      await page.locator("#my-picks [data-picked='2'][data-pickable='2']").waitFor();
      await page.locator("#inside").getByRole("button", { name: "not sure", exact: true }).click();
      await page.locator("#my-picks [data-picked='1'][data-pickable='2']").waitFor();
      assert.equal(await page.locator("#my-picks").getByText("Ada Fixture", { exact: false }).count(), 0);
      assert.equal(await page.locator("#inside").getByRole("button", { name: "not sure yet ✓", exact: true }).getAttribute("aria-pressed"), "true");
      assert.match(await page.evaluate(() => localStorage.getItem("wtp.reactions") ?? ""), /fixture:ada.*YES/);
      await page.locator("#inside").getByRole("button", { name: "Ada Fixture", exact: true }).click();
      await page.locator("#my-picks [data-picked='2']").waitFor();

      await page.locator("#address-entry").getByRole("textbox", { name: "Street", exact: true }).fill("Capitol Sq");
      await page.locator("#address-entry").getByRole("button", { name: "Show mine", exact: true }).click();
      await page.locator("#address-entry").getByRole("textbox", { name: "House number", exact: true }).waitFor();
      assert.equal(await page.locator("#outside").isVisible(), true);
      assert.equal(await page.locator("#my-picks [data-pickable='2']").count(), 1);
      await page.locator("#address-entry").getByRole("textbox", { name: "House number", exact: true }).fill("123");
      await page.locator("#address-entry").getByRole("button", { name: "Use it", exact: true }).click();
      await page.locator("#outside").waitFor({ state: "hidden" });
      await page.locator("#my-picks [data-picked='1'][data-pickable='1']").waitFor();
      await page.locator("#officials").getByText("Fixture District Three Member", { exact: true }).waitFor();
      assert.equal(await page.locator("#officials").getByText("Fixture District Fifteen Member", { exact: true }).count(), 0);
      assert.equal(await page.locator("#inside").getAttribute("data-could-govern"), null);
      assert.match(await page.locator("#address-entry").innerText(), /could not check your state assembly district/);
      const savedScope = await page.evaluate(() => sessionStorage.getItem("wtp.session_address_scope"));
      assert.ok(savedScope);
      assert.doesNotMatch(savedScope, /Capitol|123|lat|lng|coordinates/);
      assert.deepEqual(JSON.parse(savedScope).excludedContestIds, ["fixture:outside"]);
      await page.screenshot({ path: join(screenshotDir, `reader-plan-${device}-narrowed.png`), fullPage: true });

      await page.locator("#address-entry").getByRole("button", { name: "Show the whole area again", exact: true }).click();
      await page.locator("#outside").waitFor({ state: "visible" });
      await page.locator("#my-picks [data-picked='2'][data-pickable='2']").waitFor();
      await page.locator("#officials").getByText("Fixture District Fifteen Member", { exact: true }).waitFor();
      assert.equal(await page.locator("#officials").getByText("Fixture District Three Member", { exact: true }).count(), 0);
      assert.equal(await page.locator("#inside").getAttribute("data-could-govern"), "true");
      assert.equal(await page.evaluate(() => sessionStorage.getItem("wtp.session_address_scope")), null);

      await page.locator("#saving").getByRole("textbox", { name: "Ask a question about this ballot", exact: true }).fill("What does the fixture council do?");
      await page.locator("#saving").getByRole("button", { name: "Ask", exact: true }).click();
      await page.locator("[data-ask-save-notice]").waitFor();
      assert.match(await page.locator("[data-ask-save-notice]").innerText(), /couldn't confirm that this question was saved/);
      await page.getByText("The fixture council adopts a budget at public meetings.", { exact: true }).waitFor();
      await page.locator("#demand").getByRole("button").click();
      await page.locator("#demand [data-demand-state='FAILED']").waitFor();
      assert.match(await page.locator("#demand").innerText(), /couldn't confirm that was noted/);
      assert.doesNotMatch(await page.locator("#demand").innerText(), /Thanks/);
      await page.screenshot({ path: join(screenshotDir, `reader-plan-${device}-save-failure.png`), fullPage: true });
      await page.locator("#saving").getByRole("button", { name: "Ask", exact: true }).click();
      await page.locator("[data-ask-save-notice]").waitFor({ state: "detached" });
      await page.getByText("The fixture council adopts a budget at public meetings.", { exact: true }).waitFor();
      await page.locator("#demand").getByRole("button").click();
      await page.locator("#demand [data-demand-state='NOTED']").waitFor();

      await page.locator("#address-entry").getByRole("button", { name: "Add your address", exact: false }).click();
      await page.locator("#address-entry").getByRole("textbox", { name: "Street", exact: true }).fill("123 Missing Way");
      await page.locator("#address-entry").getByRole("button", { name: "Show mine", exact: true }).click();
      await page.locator("#address-entry").getByText("We couldn't place that address in 43215. Everything stays listed.", { exact: true }).waitFor();
      assert.equal(await page.locator("#address-entry").getByRole("textbox", { name: "House number", exact: true }).count(), 0);
      assert.equal(await page.locator("#address-entry").getByRole("textbox", { name: "Street", exact: true }).inputValue(), "Missing Way");
      assert.equal(await page.locator("#outside").isVisible(), true);

      await page.locator("#ballot").getByRole("button", { name: "Narrow this to where you live", exact: false }).click();
      await page.locator("#ballot").getByRole("textbox", { name: "Street", exact: true }).fill("123 Other Way");
      await page.locator("#ballot").getByRole("button", { name: "Show mine", exact: true }).click();
      const switchZip = page.locator("#ballot").getByRole("button", { name: "Show the 43216 ballot instead", exact: true });
      await switchZip.waitFor();
      assert.equal(new URL(page.url()).searchParams.get("zip"), null);
      assert.equal(await page.evaluate(() => sessionStorage.getItem("wtp.session_address_scope")), null);
      assert.equal(await page.locator("#ballot").getByRole("textbox", { name: "Street", exact: true }).inputValue(), "Other Way");
      await page.screenshot({ path: join(screenshotDir, `reader-plan-${device}-address-recovery.png`), fullPage: true });
      await switchZip.click();
      await page.waitForURL("**/ballot?zip=43216");
      await page.getByRole("heading", { name: "Ballot for 43216", exact: true }).waitFor();
      assert.equal(requests.filter(row => row.path === "/api/address/resolve").length, 4);
      assert.ok(requests.some(row => decodeURIComponent(row.path) === `/api/representation/${insideDivision}`));
      assert.equal(askCalls, 2);
      assert.equal(demandCalls, 2);
      assert.deepEqual(errors, []);
      assert.deepEqual(outsideRequests, []);
      assert.deepEqual(unexpected, []);
    } catch (error) {
      console.error({ device, browserErrors: errors, outsideRequests, unexpected });
      await page.screenshot({ path: join(screenshotDir, `reader-plan-${device}-failure.png`), fullPage: true });
      throw error;
    } finally { await context.close(); }
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
