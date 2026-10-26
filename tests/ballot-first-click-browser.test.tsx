import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { renderToString } from "react-dom/server";
import { CandidateBattlecard } from "../components/ballot/candidate-battlecard.tsx";
import { IncumbentNameLink } from "../components/ballot/incumbent-record-link.tsx";
import { Card } from "../components/ui/card.tsx";
import { CardSourcesContribution } from "../components/ui/card-sources-contribution.tsx";
import type { SeatHolder } from "../lib/officials/lookup.ts";
import { launchGuarded } from "../scripts/browser.mts";

const person: SeatHolder = { id: "fixture:governor-person", name: "Casey Fixture", officeTitle: "Governor",
  partyLabel: null, photoUrl: null, birthDate: null, termEnd: null, email: null, phone: null,
  campaignUrl: null, contactFormUrl: null, websiteUrl: "https://state.example.gov/governor",
  sourceUrl: "https://state.example.gov/governor", provenance: { sourceUrl: "https://state.example.gov/governor",
    sourceOrg: "Fixture governor's office", collectedAt: "2026-10-24", verifiedAt: null } };
const filing = { sourceUrl: "https://elections.example.gov/candidates", sourceOrg: "Fixture election authority",
  collectedAt: "2026-10-24", verifiedAt: null };
function Hydrated() { return null; }
function Fixture() {
  return <><Card title="Governor" sources={[]}>
    <div data-first-click-case="battlecard"><CandidateBattlecard name={person.name} subjectId="fixture:candidate"
      contactHolder={person} sections={{ sources: <CardSourcesContribution id="fixture-filing"
        sources={[{ what: "Candidate filing", provenance: filing }]} /> }} /></div>
    <div data-first-click-case="person"><IncumbentNameLink holder={person} name={person.name} context={null} /></div>
  </Card><Hydrated /></>;
}

for (const surface of ["battlecard", "person"] as const) test(`the ${surface} opens on its first enabled click after delayed hydration`, async () => {
  const rendered = renderToString(<Fixture />);
  const bundle = await build({ stdin: { contents: `
    import React,{useEffect} from "react";import {hydrateRoot} from "react-dom/client";
    import {CandidateBattlecard} from "./components/ballot/candidate-battlecard.tsx";
    import {IncumbentNameLink} from "./components/ballot/incumbent-record-link.tsx";
    import {Card} from "./components/ui/card.tsx";
    import {CardSourcesContribution} from "./components/ui/card-sources-contribution.tsx";
    const person=${JSON.stringify(person)},filing=${JSON.stringify(filing)};
    function Hydrated(){useEffect(()=>{window.fixtureHydrated=true;},[]);return null;}
    hydrateRoot(document.getElementById("root"),<><Card title="Governor" sources={[]}>
      <div data-first-click-case="battlecard"><CandidateBattlecard name={person.name} subjectId="fixture:candidate"
        contactHolder={person} sections={{sources:<CardSourcesContribution id="fixture-filing" sources={[{what:"Candidate filing",provenance:filing}]}/>}} /></div>
      <div data-first-click-case="person"><IncumbentNameLink holder={person} name={person.name} context={null}/></div>
    </Card><Hydrated/></>,{onRecoverableError:error=>{window.fixtureHydrationErrors??=[];window.fixtureHydrationErrors.push(error.message);}});
    `, resolveDir: process.cwd(), sourcefile: "ballot-first-click-fixture.tsx", loader: "tsx" }, bundle: true,
    write: false, outfile: ".scratch/ci/ballot-first-click-fixture.js", platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  const javascript = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const css = readFileSync("app/globals.css", "utf8") + readFileSync("app/reader.css", "utf8");
  const server = createServer((request, response) => {
    if (request.url === "/fixture.js") response.writeHead(200, { "content-type": "application/javascript" }).end(javascript);
    else if (request.url === "/fixture.css") response.writeHead(200, { "content-type": "text/css" }).end(css);
    else if (request.url?.startsWith("/api/")) response.writeHead(503, { "content-type": "application/json" }).end("{}");
    else response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html><html lang="en"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><body class="mw-reader"><main id="root">${rendered}</main><script defer src="/fixture.js"></script></body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();assert.ok(address && typeof address !== "string");
  let release!: () => void;const heldScript = new Promise<void>(resolve => { release = resolve; });
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  const artifact = ".scratch/ci/ballot-first-click";mkdirSync(artifact, { recursive: true });
  try {
    browser = await launchGuarded({ label: `CL-01-${surface}-first-enabled-click`, blockWrites: true,
      headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const page = await browser.page({ viewport: { width: 1100, height: 800 } });
    const errors: string[] = [];page.on("pageerror", error => errors.push(error.message));
    await page.route("**/fixture.js", async route => { await heldScript; await route.continue(); });
    const started = performance.now();
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "commit" });
    const button = page.locator(`[data-first-click-case="${surface}"]`).getByRole("button", { exact: true,
      name: surface === "battlecard" ? "View Battlecard" : person.name });
    await button.waitFor({ state: "visible" });
    const serverReadyMs = performance.now() - started;
    const beforeEnabled = await button.isEnabled();
    if (beforeEnabled) await button.click();
    const variant = beforeEnabled ? "before-repair" : "verified";
    await page.screenshot({ path: `${artifact}/${surface}-${variant}-server.png` });
    const releasedAt = performance.now();
    release();
    await page.waitForFunction(() => (window as unknown as { fixtureHydrated?: boolean }).fixtureHydrated === true);
    const afterPrematureClick = await page.getByRole("dialog", { name: person.name, exact: true }).count();
    writeFileSync(`${artifact}/${surface}-${variant}.json`, JSON.stringify({ surface, beforeEnabled, afterPrematureClick }, null, 2));
    assert.equal(beforeEnabled, false, "server HTML must not offer an enabled click before the component has its handler");
    await page.waitForFunction(selector => !(document.querySelector<HTMLButtonElement>(selector)?.disabled ?? true),
      `[data-first-click-case="${surface}"] button`);
    // Navigation and natural script/hydration time count; the screenshot and
    // deliberate refusal to deliver JavaScript are controlled test work.
    const readyMs = Math.round(serverReadyMs + performance.now() - releasedAt);
    writeFileSync(`${artifact}/${surface}-${variant}.json`, JSON.stringify({ surface, beforeEnabled, afterPrematureClick, readyMs }, null, 2));
    assert.ok(readyMs < 3000, "the control becomes usable on its first visit within three seconds");
    const clicked = performance.now();
    await button.click();
    const dialog = page.getByRole("dialog", { name: person.name, exact: true });
    await dialog.waitFor({ state: "visible" });
    const openMs = Math.round(performance.now() - clicked);
    assert.ok(openMs < 3000, "the first enabled click opens the usable card within three seconds");
    if (surface === "person") {
      await dialog.getByText("State", { exact: true }).first().waitFor({ state: "visible" });
      assert.equal(await dialog.getByText("Federal", { exact: true }).count(), 0, "the held governor's record must not be labelled Federal");
    }
    await dialog.getByRole("button", { name: /^Sources/ }).click();
    const url = surface === "battlecard" ? filing.sourceUrl : person.sourceUrl!;
    await dialog.locator(`[data-source-list] a[href="${url}"]`).waitFor({ state: "visible" });
    const sourcesMs = Math.round(performance.now() - clicked);
    assert.ok(sourcesMs < 3000, "the card's held Sources are usable within three seconds of the first enabled click");
    writeFileSync(`${artifact}/${surface}-${variant}.json`, JSON.stringify({ surface, beforeEnabled, afterPrematureClick, readyMs, openMs, sourcesMs }, null, 2));
    await page.screenshot({ path: `${artifact}/${surface}-verified-dialog.png` });
    assert.deepEqual(await page.evaluate(() => (window as unknown as { fixtureHydrationErrors?: string[] }).fixtureHydrationErrors ?? []), []);
    assert.deepEqual(errors, []);
  } finally {
    release();await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
