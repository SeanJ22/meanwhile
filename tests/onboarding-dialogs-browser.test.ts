import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import tailwindcss from "@tailwindcss/postcss";
import type { Page } from "playwright";
import { launchGuarded } from "../scripts/browser.mts";
import { lookupZcta } from "../lib/geo/zcta.ts";
import type { CoverageSummary } from "../lib/registry/coverage.ts";

// Empty protocol responses exercise the real shell's dialogs, not civic coverage.
const coverage: CoverageSummary = {
  state: "UNMAPPED", bodies: [], seats: [], divisions: [], stateLegislatorAuthorities: [],
  unincorporated: false, senators: [], statewideExecutives: [],
  counts: { total: 0, withSource: 0, withoutSource: 0, lookedAt: 0, governing: { total: 0, withSource: 0 } },
  seatCounts: { total: 0, named: 0 },
};

async function oneDialog(page: Page) {
  assert.equal(await page.locator('[role="dialog"]:visible, dialog[open]').count(), 1);
}

test("OB-01: first visit, ZIP entry and replay keep the real map's dialogs usable by mouse and keyboard", async () => {
  const bundle = await build({ stdin: { contents: `
    import React from "react"; import {createRoot} from "react-dom/client";
    import {MapEntry} from "./components/map/map-entry.tsx";
    createRoot(document.getElementById("root")).render(<MapEntry/>);`,
    resolveDir: process.cwd(), sourcefile: "onboarding-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "esm", splitting: true,
    outdir: "work/onboarding-bundle", entryNames: "entry", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } });
  const scripts = new Map(bundle.outputFiles.map(file => [`/${basename(file.path)}`, file.contents]));
  const postcss = createRequire(import.meta.resolve("@tailwindcss/postcss"))("postcss");
  const globals = await postcss([tailwindcss()]).process(readFileSync("app/globals.css", "utf8"), { from: "app/globals.css" });
  const css = globals.css + readFileSync("app/reader.css", "utf8");
  const state = { state: "NY", version: "protocol", coverage, zipPlaces: {}, directory: null };
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url!, "http://localhost");
    const path = requestUrl.pathname;
    const json = (value: unknown) => response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value));
    if (scripts.has(path)) response.writeHead(200, { "content-type": path.endsWith(".css") ? "text/css" : "application/javascript" }).end(scripts.get(path));
    else if (path === "/styles.css") response.writeHead(200, { "content-type": "text/css" }).end(css);
    else if (path === "/geo/state-outlines.geojson") response.writeHead(200, { "content-type": "application/json" }).end(readFileSync("public/geo/state-outlines.geojson"));
    else if (path.startsWith("/geo/reader-zips/")) json({ locations: { "10001": lookupZcta("10001") } });
    else if (path === "/api/reader/state") json(state);
    else if (path === "/api/meetings") json({ meetings: [], coverage, tier: "none", radiusKm: 40,
      center: { lat: 40.75, lng: -73.99 }, stateResponse: { status: 200, headers: [], value: state } });
    else if (path === "/") response.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/entry.css"><div id="root"></div><script type="module" src="/entry.js"></script>');
    else json({});
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  try {
    browser = await launchGuarded({ label: "ob-01-onboarding", blockWrites: true });
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.context({ viewport });
      // A graphics failure must never hold the tour's buttons hostage.
      await context.addInitScript(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string, options?: unknown) {
          if (id.startsWith("webgl")) return null;
          return getContext.call(this, id, options);
        } as typeof getContext;
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => { errors.push(error.message); console.error("Onboarding browser:", error.message); });
      await page.goto(origin);
      await page.getByRole("button", { name: "Skip, show me the map", exact: true }).click();
      let tour = page.locator("dialog[open]");
      await tour.getByRole("heading", { name: "Ask", exact: true }).waitFor();
      await oneDialog(page);
      await tour.getByRole("button", { name: "Next", exact: true }).click();
      await tour.getByRole("button", { name: "Next", exact: true }).focus();
      await page.keyboard.press("Enter");
      await tour.getByRole("heading", { name: "Local / State / Federal", exact: true }).waitFor();
      await tour.getByRole("button", { name: "Next", exact: true }).focus();
      await page.keyboard.press("Space");
      await tour.getByRole("heading", { name: "Boundary lines", exact: true }).waitFor();
      await tour.getByRole("button", { name: "Done", exact: true }).click();
      await tour.waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => localStorage.getItem("wtp.approximate_location")), null);
      const replay = () => page.getByRole("button", { name: "Replay quick tour", exact: true }).filter({ visible: true }).first();
      await replay().click();
      await tour.getByRole("heading", { name: "Ask", exact: true }).waitFor();
      await oneDialog(page);
      await tour.getByRole("button", { name: "Skip the tour", exact: true }).click();
      await tour.waitFor({ state: "hidden" });
      await replay().focus();
      await page.keyboard.press("Enter");
      await tour.getByRole("button", { name: "Skip", exact: true }).focus();
      await page.keyboard.press("Space");
      await tour.waitFor({ state: "hidden" });

      await page.goto(origin);
      await page.getByRole("dialog", { name: "Choose a location", exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("dialog", { name: "Choose a location", exact: true }).waitFor({ state: "hidden" });
      assert.equal(await page.locator('[role="dialog"]:visible, dialog[open]').count(), 0);

      // A new device: choose a ZIP and keep the pending place panel until the tour closes.
      await page.evaluate(() => localStorage.clear());
      await page.goto(origin);
      await page.getByRole("textbox", { name: /^zip code$/i }).fill("10001");
      await page.getByRole("button", { name: "Show meetings", exact: true }).click();
      tour = page.locator("dialog[open]");
      await tour.getByRole("heading", { name: "Ask", exact: true }).waitFor();
      await oneDialog(page);
      await tour.getByRole("button", { name: "Next", exact: true }).click();
      await tour.getByRole("button", { name: "Skip", exact: true }).click();
      const governs = page.locator('[data-reader-card="governs"]');
      await governs.waitFor();
      await oneDialog(page);
      await page.keyboard.press("Escape");
      await governs.waitFor({ state: "hidden" });
      await replay().click();
      await tour.getByRole("heading", { name: "Ask", exact: true }).waitFor();
      await oneDialog(page);
      await page.keyboard.press("Escape");
      await tour.waitFor({ state: "hidden" });
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await context.close();
    }
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("the quick tour opens on the map and stays closed on the ballot route", async () => {
  const bundle = await build({ stdin: { contents: `
    import React from "react"; import {createRoot} from "react-dom/client";
    import {PathnameContext} from "next/dist/shared/lib/hooks-client-context.shared-runtime";
    import {TutorialOverlay} from "./components/map/tutorial-overlay.tsx";
    createRoot(document.getElementById("root")).render(<PathnameContext.Provider value={location.pathname}><TutorialOverlay active /></PathnameContext.Provider>);`,
    resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, outfile: "work/tour-route.js", platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, logLevel: "silent" });
  const javascript = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const server = createServer((request, response) => {
    if (request.url === "/app.js") response.writeHead(200, { "content-type": "application/javascript" }).end(javascript);
    else response.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  try {
    browser = await launchGuarded({ label: "ob01-tour-home-route", blockWrites: true });
    const page = await browser.page();
    page.on("pageerror", error => console.error(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/ballot`);
    await page.locator('[data-tour-ready="true"]').waitFor({ state: "attached" });
    assert.equal(await page.locator("dialog[open]").count(), 0);
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.getByRole("heading", { name: "Ask", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("heading", { name: "Who Governs Here", exact: true }).waitFor({ state: "visible" });
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
