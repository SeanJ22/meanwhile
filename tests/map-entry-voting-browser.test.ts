import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import tailwindcss from "@tailwindcss/postcss";
import type { Map as MapLibreMap } from "maplibre-gl";
import { launchGuarded, seedZip } from "../scripts/browser.mts";
import { lookupZcta } from "../lib/geo/zcta.ts";
import type { VotingSitesAnswer } from "../lib/ballot/voting-sites.ts";
import type { CoverageSummary } from "../lib/registry/coverage.ts";

// Protocol responses test map wiring, not the existence of real polling places.
const places = [
  { state: "AZ", zip: "85701", address: "255 W Alameda St, Tucson, AZ 85701", lat: 32.223, lng: -110.974 },
  { state: "NH", zip: "03060", address: "229 Main St, Nashua, NH 03060", lat: 42.757, lng: -71.464 },
  { state: "NJ", zip: "07866", address: "1 E Main St, Rockaway, NJ 07866", lat: 40.901, lng: -74.513 },
];
const coverage: CoverageSummary = {
  state: "UNMAPPED", bodies: [], seats: [], divisions: [], stateLegislatorAuthorities: [],
  unincorporated: false, senators: [], statewideExecutives: [],
  counts: { total: 0, withSource: 0, withoutSource: 0, lookedAt: 0, governing: { total: 0, withSource: 0 } },
  seatCounts: { total: 0, named: 0 },
};
type MapWindow = Window & { __wtpMap: MapLibreMap; __wtpMapProbe: () => { focusOcdId: string } };

test("VS-03: cross-state address and ZIP voting answers move the real map, keep every pin and leave the meeting view alone", async () => {
  const out = process.env.VS03_EVIDENCE_DIR ?? ".scratch/ci/vs03";
  mkdirSync(out, { recursive: true });
  const bundle = await build({
    stdin: { contents: `import React from "react"; import {createRoot} from "react-dom/client";
      import {MapEntry} from "./components/map/map-entry.tsx";
      createRoot(document.getElementById("root")).render(<MapEntry/>);`,
    resolveDir: process.cwd(), sourcefile: "map-entry-voting.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "esm", splitting: true,
    outdir: ".scratch/ci/vs03-bundle", entryNames: "entry", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  });
  const scripts = new Map(bundle.outputFiles.map(file => [`/${basename(file.path)}`, file.contents]));
  const require = createRequire(import.meta.url);
  const worker = await build({
    entryPoints: [join(dirname(require.resolve("maplibre-gl/package.json")), "dist/maplibre-gl-worker.mjs")],
    bundle: true, write: false, format: "esm", platform: "browser", minify: true, logLevel: "silent",
  });
  const postcss = createRequire(import.meta.resolve("@tailwindcss/postcss"))("postcss");
  const globalStyles = await postcss([tailwindcss()]).process(readFileSync("app/globals.css", "utf8"), { from: "app/globals.css" });
  const stylesheet = globalStyles.css + readFileSync("app/reader.css", "utf8");
  const requests: string[] = [], inputs: string[] = [];
  const answers = new Map<string, VotingSitesAnswer>();
  for (const place of places) {
    for (const input of [place.address, place.zip]) {
      const isZip = input === place.zip;
      answers.set(input, {
        match: true, precision: isZip ? "ZIP" : "ADDRESS", point: isZip ? null : { lat: place.lat, lng: place.lng },
        outsideCoverage: false, pollingPlaceLinks: [], jurisdictions: [{
          state: place.state, ocdId: `ocd-division/country:us/state:${place.state.toLowerCase()}`,
          name: `${place.state} protocol fixture`, model: "VOTE_CENTER", election: "Protocol election",
          modelSentence: "Controlled map regression response.", narrowing: { kind: "NOT_NEEDED", sentence: "Protocol response." },
          sourceOrg: isZip ? "Held records (protocol fixture)" : "Google (protocol fixture)",
          sourceUrl: "https://example.gov/protocol", collectedAt: "2026-10-20", refusal: null, refusalLine: null,
          sites: [0, 1].map(index => ({
            id: `${place.state}-${index}`, name: `${place.state} protocol pin ${index + 1}`, address: "Protocol location",
            lat: place.lat + index * 0.02, lng: place.lng + index * 0.02,
            room: null, kind: "VOTE_CENTER", election: "Protocol election", hours: "Protocol hours", serves: null,
          })),
        }],
      });
    }
  }
  const stateAnswer = { state: "CA", version: "protocol", coverage, zipPlaces: {}, directory: null };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, "http://localhost");
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/geo/reader-zips/")) requests.push(url.pathname + url.search);
    const json = (value: unknown, status = 200) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
    if (scripts.has(url.pathname)) response.writeHead(200, { "content-type": url.pathname.endsWith(".css") ? "text/css" : "application/javascript" }).end(scripts.get(url.pathname));
    else if (url.pathname === "/styles.css") response.writeHead(200, { "content-type": "text/css" }).end(stylesheet);
    else if (url.pathname === "/maplibre-gl-worker.mjs") response.writeHead(200, { "content-type": "application/javascript" }).end(worker.outputFiles[0].contents);
    else if (url.pathname === "/geo/state-outlines.geojson") json(JSON.parse(readFileSync("public/geo/state-outlines.geojson", "utf8")));
    else if (url.pathname.startsWith("/geo/reader-zips/")) {
      const prefix = /(\d{2})\.json$/.exec(url.pathname)?.[1] ?? "";
      json({ locations: Object.fromEntries(["95814"].filter(zip => zip.startsWith(prefix)).map(zip => [zip, lookupZcta(zip)])) });
    } else if (url.pathname === "/api/reader/state") json(stateAnswer);
    else if (url.pathname === "/api/meetings") json({ meetings: [], coverage, tier: "none", radiusKm: 40, center: { lat: 38.58, lng: -121.49 }, stateResponse: { status: 200, headers: [], value: stateAnswer } });
    else if (url.pathname === "/api/voting-sites") {
      let body = ""; for await (const chunk of request) body += chunk;
      const { address } = JSON.parse(body); inputs.push(address);
      json(answers.get(address) ?? { match: false, point: null, jurisdictions: [], outsideCoverage: true, pollingPlaceLinks: [] });
    } else if (url.pathname === "/api/reader-copy") json({});
    else if (url.pathname === "/") response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/entry.css"></head><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>`);
    else json({});
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const bound = server.address(); assert.ok(bound && typeof bound !== "string");
  const origin = `http://127.0.0.1:${bound.port}`;
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  const timings: { viewport: number; state: string; input: string; ms: number; pins: number }[] = [];
  try {
    browser = await launchGuarded({ label: "vs-03-map-entry", blockWrites: true });
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.context({ viewport, reducedMotion: "no-preference" });
      const external: string[] = [], errors: string[] = [];
      await context.route("**/*", route => {
        if (new URL(route.request().url()).origin === origin) return route.continue();
        external.push(route.request().url()); return route.abort();
      });
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await seedZip(page, "95814");
      await page.addInitScript(() => localStorage.setItem("wtp.show_districts", "0"));
      await page.goto(origin);
      await page.waitForFunction(() => (window as unknown as MapWindow).__wtpMapProbe?.().focusOcdId === "ocd-division/country:us/state:ca");
      await page.getByRole("button", { name: "Where can I vote?", exact: true }).filter({ visible: true }).first().click();
      await page.getByLabel("Your street address or ZIP").waitFor();
      const readsBefore = requests.filter(url => /\/api\/(meetings|reader\/state)|\/geo\/reader-zips\//.test(url));
      for (const place of places) {
        for (const input of [place.address, place.zip]) {
          await page.getByLabel("Your street address or ZIP").fill(input);
          const started = performance.now();
          await page.getByRole("button", { name: "Show me", exact: true }).click();
          await page.waitForFunction(({ lat, lng, state }) => {
            const map = (window as unknown as MapWindow).__wtpMap;
            if (!map || map.isMoving()) return false;
            const center = map.getCenter();
            const pins = [...document.querySelectorAll<HTMLElement>(".wtp-vote-pin")];
            return Math.abs(center.lat - lat) < 0.00001 && Math.abs(center.lng - lng) < 0.00001
              && pins.length === 2 && pins.every(pin => pin.dataset.siteId?.startsWith(state) && getComputedStyle(pin).visibility !== "hidden");
          }, place, { timeout: 3000 });
          const ms = Math.round(performance.now() - started);
          timings.push({ viewport: viewport.width, state: place.state, input, ms, pins: await page.locator(".wtp-vote-pin").count() });
          assert.ok(ms < 3000, `${place.state} ${input} must finish within three seconds (${ms}ms)`);
          assert.equal(await page.locator("[data-voting-site]").count(), 2);
          assert.equal(await page.evaluate(() => (window as unknown as MapWindow).__wtpMapProbe().focusOcdId), "ocd-division/country:us/state:ca");
          assert.equal(await page.evaluate(() => !!(window as unknown as MapWindow).__wtpMap.getSource("voting-address-ring")), input !== place.zip);
          await page.screenshot({ path: `${out}/${place.state.toLowerCase()}-${input === place.zip ? "zip" : "address"}-${viewport.width}.png` });
          const wasSelected = await page.locator(`.wtp-vote-pin[data-site-id="${place.state}-1"]`).getAttribute("data-selected") === "true";
          await page.locator(`[data-voting-site="${place.state}-1"] .voting-site-head`).click();
          await page.waitForFunction(({ id, selected }) => document.querySelector<HTMLElement>(`.wtp-vote-pin[data-site-id="${id}"]`)?.dataset.selected === String(selected), { id: `${place.state}-1`, selected: !wasSelected });
        }
      }
      assert.deepEqual(requests.filter(url => /\/api\/(meetings|reader\/state)|\/geo\/reader-zips\//.test(url)), readsBefore, "voting answers must not reload the meeting or ZIP view");
      const centerBefore = await page.evaluate(() => (window as unknown as MapWindow).__wtpMap.getCenter().toArray());
      await page.getByLabel("Your street address or ZIP").fill("Unmatched protocol lookup");
      await page.getByRole("button", { name: "Show me", exact: true }).click();
      await page.locator("[data-voting-coverage-gap]").waitFor();
      assert.equal(await page.locator(".wtp-vote-pin").count(), 0);
      assert.equal(await page.evaluate(() => !!(window as unknown as MapWindow).__wtpMap.getSource("voting-address-ring")), false);
      const centerAfter = await page.evaluate(() => (window as unknown as MapWindow).__wtpMap.getCenter().toArray());
      assert.ok(centerAfter.every((coordinate, index) => Math.abs(coordinate - centerBefore[index]!) < 1e-9), "an unmatched lookup must leave the map center unchanged");
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      await context.close();
    }
    assert.equal(inputs.length, 14);
  } finally {
    writeFileSync(`${out}/timings.json`, JSON.stringify({ controlledResponses: true, realMap: true, timings }, null, 2) + "\n");
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
