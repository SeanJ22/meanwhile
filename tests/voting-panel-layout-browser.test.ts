import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import tailwindcss from "@tailwindcss/postcss";
import { launchGuarded } from "../scripts/browser.mts";
import { parseVotingCapture, votingRowsToSites } from "../lib/ballot/voting-source-readers.ts";
import { projectVotingJurisdiction } from "../lib/ballot/voting-answer.ts";
import type { VotingReaderPlace } from "../lib/ballot/voting-answer.ts";
import type { VotingJurisdiction, VotingSitesAnswer } from "../lib/ballot/voting-sites.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";

test("VS-01 native voting facts and one shared footer stay in the reader card scroll flow on desktop and mobile", async () => {
  mkdirSync(".scratch/ci", { recursive: true });
  const doors = JSON.parse(readFileSync("data/reference/voting-source-doors.json", "utf8")) as VotingSourceDoor[];
  const door = doors.find(row => row.id === "nd-statewide-general-2026")!;
  const source = { publisher: door.publisher, url: door.url, title: door.title, checkedAt: "2026-10-13" };
  const bytes = readFileSync("tests/fixtures/voting-sources/nd-2026-native.html");
  const parsed = votingRowsToSites(await parseVotingCapture({ url: door.url, bytes, contentType: "text/html" }, door), door, source);
  const cases = [
    { path: "/adams", county: "Adams", zip: "58639", embedded: false },
    { path: "/burleigh", county: "Burleigh", zip: "58504", embedded: true },
  ];
  const answers = new Map<string, VotingSitesAnswer>();
  for (const item of cases) {
    const jurisdiction: VotingJurisdiction = { ...door.scope, model: "UNKNOWN", election: "November 3, 2026", electionDate: door.electionDate,
      sites: parsed.sites, rules: door.rules, sourceUrl: door.url, sourceOrg: door.publisher, collectedAt: source.checkedAt, refusal: null };
    const place: VotingReaderPlace = { precision: "ZIP", point: null, divisionIds: [door.scope.ocdId], states: [door.scope.state], countyFips: [], countyNames: [item.county], countySubdivisionGeoids: [], towns: [], wards: [], aiannhGeoids: [], precincts: [] };
    const answer: VotingSitesAnswer = { match: true, point: null, jurisdictions: [projectVotingJurisdiction(jurisdiction, place)], outsideCoverage: false, pollingPlaceLinks: [] };
    assert.ok(answer.jurisdictions[0].sites.length > 0);
    answers.set(item.zip, answer);
  }
  const output = await build({
    stdin: { contents: `
      import React from "react"; import {createRoot} from "react-dom/client";
      import {ReaderCard} from "./components/shell/reader-card.tsx";
      import {VotingSitesPanel} from "./components/map/voting-sites-panel.tsx";
      const embedded=location.pathname==="/burleigh"; const noop=()=>{};
      const panel=<VotingSitesPanel embedded={embedded} selectedSiteId={null} onSites={noop} onSelectSite={noop} onClose={noop}/>;
      createRoot(document.getElementById("root")).render(embedded ? <ReaderCard viewKey="where-to-vote" kicker="Where can I vote?" backLabel={null} onBack={noop} onClose={noop}>{panel}</ReaderCard> : panel);
    `, resolveDir: process.cwd(), sourcefile: "vs01-voting-visual.tsx", loader: "tsx" },
    bundle: true, write: false, outfile: ".scratch/ci/vs01-layout.js", platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, logLevel: "silent",
  });
  const javascript = output.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const postcss = createRequire(import.meta.resolve("@tailwindcss/postcss"))("postcss");
  const globalStyles = await postcss([tailwindcss()]).process(readFileSync("app/globals.css", "utf8"), { from: "app/globals.css" });
  const stylesheet = globalStyles.css + readFileSync("app/reader.css", "utf8") + (output.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "");
  const received: Record<string, unknown>[] = [];
  let finishStalled: (() => void) | undefined;
  const server = createServer(async (request, response) => {
    if (request.url === "/fixture.js") response.writeHead(200, { "content-type": "application/javascript" }).end(javascript);
    else if (request.url === "/fixture.css") response.writeHead(200, { "content-type": "text/css" }).end(stylesheet);
    else if (request.url === "/api/voting-sites") {
      let body = ""; for await (const chunk of request) body += chunk;
      const data = JSON.parse(body); received.push(data);
      if (data.address === "Server failure") {
        response.writeHead(503, { "content-type": "application/json" }).end("{}"); return;
      }
      if (data.address === "Stalled request") {
        response.writeHead(200, { "content-type": "application/x-ndjson" });
        response.write('{"pending":true}\n');
        finishStalled = () => response.end(JSON.stringify({ answer: { ...answers.get(cases[0].zip), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() } }) + "\n");
        return;
      }
      const answer = answers.get(data.address); assert.ok(answer);
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answer));
    } else if (cases.some(item => item.path === request.url)) response.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body class="mw-reader"><main id="root"></main><script src="/fixture.js"></script></body></html>');
    else response.writeHead(503, { "content-type": "application/json" }).end("{}");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  try {
    browser = await launchGuarded({ label: "vs01-release25-voting-card" });
    for (const viewport of [{ width: 1100, height: 1000, name: "desktop" }, { width: 390, height: 844, name: "mobile" }]) {
      const context = await browser.context({ viewport: { width: viewport.width, height: viewport.height } });
      const external: string[] = [];
      await context.route("**/*", route => { if (new URL(route.request().url()).origin === origin) return route.continue(); external.push(route.request().url()); return route.abort(); });
      const page = await context.newPage();
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      const diagnostics: string[] = []; page.on("console", message => { if (message.type() === "error") diagnostics.push(message.text()); });
      for (const item of cases) {
        await page.goto(`${origin}${item.path}`);
        await page.getByLabel("Your street address or ZIP").fill(item.zip);
        await page.getByRole("button", { name: "Show me", exact: true }).click();
        const card = page.locator(item.embedded ? "[data-reader-card]" : ".voting-panel > .reader-card");
        await card.locator("[data-card-gap]").waitFor({ state: "visible" });
        assert.equal(await card.locator("[data-card-gap]").count(), 1);
        assert.equal(await card.locator("[data-card-sources]").count(), 1);
        assert.equal(await card.getByRole("button", { name: /^Sources/ }).count(), 1);
        assert.equal(await card.locator("[data-card-footer]").evaluate(footer => footer === footer.parentElement?.lastElementChild), true);
        assert.equal(await card.locator("[data-card-sources]").evaluate(section => section === section.parentElement?.lastElementChild), true);
        const text = await card.innerText();
        assert.doesNotMatch(text, /working on getting this info|Want us to get this info sooner|Want us to get this sooner/i);
        assert.equal(await card.locator("[data-voting-site] [data-card-gap], [data-voting-site] [data-card-sources], [data-voting-site] .voting-site-gap").count(), 0);
        assert.match(text, /Polling locations do not accept absentee ballots on Election Day/);
        if (item.county === "Adams") {
          assert.match(text, /Adams County Courthouse/); assert.match(text, /9:00AM-7:00PM/);
          assert.match(text, /Available 24 hours per day/); assert.match(text, /7:00 p\.m\. November 3rd, 2026/);
          assert.match(text, /\(701\) 567-4363/);
        } else {
          assert.match(text, /Bismarck Event Center/); assert.match(text, /Oct 22 2026 12:00PM/);
          assert.match(text, /Nov 2 2026 5:00PM/); assert.match(text, /Door A1 \(west side\)/);
        }
        const base = `.scratch/ci/vs01-layout-${item.county.toLowerCase()}-${viewport.name}`;
        await card.getByRole("button", { name: /^Sources/ }).click();
        assert.match(await card.locator("[data-card-sources]").innerText(), /Voting locations|2026 General Election/);
        const links = await card.locator("[data-card-sources] a[href]").evaluateAll(elements => elements.map(element => element.getAttribute("href")));
        assert.equal(links.length, new Set(links).size);
        assert.ok(links.includes(door.url));
        if (item.embedded) {
          const geometry = await card.evaluate(element => {
            const panel = element.querySelector<HTMLElement>(".mw-voting-panel")!;
            const innerBody = panel.querySelector<HTMLElement>(".reader-card-body")!;
            const outerBody = element.querySelector<HTMLElement>(".mw-card-body")!;
            const footer = outerBody.querySelector<HTMLElement>("[data-card-footer]")!;
            const sites = [...panel.querySelectorAll<HTMLElement>("[data-voting-site]")];
            return {
              panelHiddenHeight: panel.scrollHeight - panel.clientHeight,
              innerHiddenHeight: innerBody.scrollHeight - innerBody.clientHeight,
              outerScrollHeight: outerBody.scrollHeight - outerBody.clientHeight,
              footerTop: footer.getBoundingClientRect().top,
              finalSiteBottom: sites.at(-1)!.getBoundingClientRect().bottom,
            };
          });
          assert.ok(geometry.panelHiddenHeight <= 1, "voting facts must not be squeezed into a nested scrolling panel");
          assert.ok(geometry.innerHiddenHeight <= 1, "the embedded card body must not hide voting facts in another scroller");
          assert.ok(geometry.outerScrollHeight > 0, "the ReaderCard owns scrolling of long voting answers");
          assert.ok(geometry.footerTop >= geometry.finalSiteBottom, "the shared footer must follow the last visible voting fact");
        }
        await card.locator("[data-voting-site]").first().scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${base}-sites.png` });
        await card.locator("[data-card-footer]").scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${base}-footer.png` });
        await page.getByLabel("Your street address or ZIP").scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${base}-top.png` });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflow, false, "no viewport horizontal overflow");
      }
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      // Protocol failures assert no civic facts and use no database or invented SQL schema.
      await page.goto(`${origin}/adams`);
      for (const input of ["Server failure", "Stalled request"]) {
        if (input === "Stalled request") await page.clock.install();
        await page.getByLabel("Your street address or ZIP").fill(input);
        await page.evaluate(() => {
          const state = { started: 0, elapsed: 0 };
          Object.assign(window, { lookupTiming: state });
          document.querySelector("form")!.addEventListener("submit", () => { state.started = performance.now(); }, { once: true, capture: true });
          const observer = new MutationObserver(() => {
            if (state.started && document.querySelector("[data-voting-coverage-gap], [role=status]")) {
              state.elapsed = performance.now() - state.started; observer.disconnect();
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
        });
        await page.getByRole("button", { name: "Show me", exact: true }).click();
        if (input === "Stalled request") {
          const pending = page.getByRole("status");
          await pending.waitFor({ state: "visible", timeout: 2500 });
          assert.match(await pending.innerText(), /working on getting this info/i);
          const initial = await pending.locator("[aria-hidden]").textContent();
          await page.waitForFunction(text => document.querySelector("[role=status] [aria-hidden]")?.textContent !== text, initial);
          // Cross the old request timeout, then prove the same request still delivers its answer.
          await page.waitForTimeout(3100);
          assert.equal(await page.locator("[data-voting-site]").count(), 0);
          finishStalled!();
          await page.locator("[data-voting-site]").first().waitFor({ state: "visible", timeout: 1000 });
          assert.equal(await pending.count(), 0);
          await page.clock.fastForward(24 * 60 * 60 * 1000 + 1000);
          assert.equal(await page.locator("[data-voting-site]").count(), 0, "an open panel must discard Google answers within 24 hours");
          continue;
        }
        const gap = page.locator("[data-voting-coverage-gap]");
        await gap.waitFor({ state: "visible", timeout: 5000 });
        const elapsed = await page.evaluate(() => (window as unknown as { lookupTiming: { elapsed: number } }).lookupTiming.elapsed);
        console.log(`VS-01 ${viewport.name} ${input}: ${Math.round(elapsed)} ms`);
        assert.ok(elapsed > 0 && elapsed < 3000, `${input}: usable answer took ${elapsed} ms`);
        assert.match(await gap.innerText(), /working on getting this info/i);
        assert.equal(await gap.getByRole("link", { name: "Want us to get this sooner?" }).count(), 1);
        assert.doesNotMatch(await page.locator(".voting-panel").innerText(), /Something went wrong/i);
      }
      assert.ok(diagnostics.some(line => line.includes('"stage":"reader-response"')));
      assert.ok(!diagnostics.some(line => line.includes('"stage":"reader-request"')), "the slow stream must not be aborted by the panel");
      assert.deepEqual(errors, []);
      await context.close();
    }
    assert.equal(received.length, 8); assert.ok(received.every(row => row.googleFallback === undefined));
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
