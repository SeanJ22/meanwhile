/** V94's bounded visual proof: two themes, two zooms, four captures. Local only. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Locator, Page } from "playwright";
import type { Map as MapLibreMap } from "maplibre-gl";
import { launchGuarded } from "./browser.mts";
import { GPU_ARGS, READ_RENDERER } from "../lib/ops/flyin-normalized.ts";
import { ASK_PILL_LABELS } from "../lib/routing/ask-pill-labels.ts";
import { directionalStateEdges, RELIEF_LAYERS, RELIEF_THEME } from "../lib/map/state-relief.ts";
import type { StateOutlines } from "../lib/map/state-focus.ts";
import { floored } from "../lib/ops/denominator-floor.ts";

const base = process.env.SHOOT_BASE_URL ?? "http://127.0.0.1:3244";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "V94 proof uses an isolated local server");
const out = resolve(process.env.TESTER_VISUAL_OUTPUT ?? ".scratch/tester-visual-9-4");
const viewport = { width: 1440, height: 1000 };
const exactHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const buildId = await readFile(".next/BUILD_ID", "utf8").then(value => value.trim()).catch(() => null);
const results: { id: string; row: string; pass: true; evidence: unknown }[] = [];
const screenshots: { path: string; theme: string; zoom: number; view: string }[] = [];
const basemapRequests: { theme: string; path: string; status?: number; error?: string }[] = [];
const browserErrors: { theme: string; kind: string; message: string }[] = [];
const canonical = JSON.parse(await readFile("public/geo/state-outlines.geojson", "utf8")) as StateOutlines;
const arizona = canonical.features.find(feature => feature.properties.ocdId === "ocd-division/country:us/state:az");
assert.ok(arizona, "the canonical Arizona denominator is nonempty");
await mkdir(out, { recursive: true });

async function surface(locator: Locator) {
  return locator.evaluate(element => {
    const style = getComputedStyle(element);
    const before = getComputedStyle(element, "::before");
    const after = getComputedStyle(element, "::after");
    const rect = element.getBoundingClientRect();
    return {
      text: element.textContent?.trim(), className: element.className,
      width: rect.width, height: rect.height, x: rect.x, y: rect.y, minHeight: style.minHeight,
      background: style.backgroundColor, image: style.backgroundImage,
      color: style.color, shadow: style.boxShadow, borderWidth: style.borderWidth,
      radius: style.borderRadius, transform: style.transform,
      duration: style.transitionDuration, curve: style.transitionTimingFunction,
      before: { content: before.content, background: before.backgroundColor, radius: before.borderRadius },
      after: { content: after.content, image: after.backgroundImage, shadow: after.boxShadow,
        height: after.height, width: after.width, left: after.left, bottom: after.bottom,
        opacity: Number(after.opacity), duration: after.transitionDuration, curve: after.transitionTimingFunction },
    };
  });
}

async function settledMap(page: Page) {
  await page.waitForFunction(() => {
    const map = (window as unknown as { __wtpMap?: MapLibreMap }).__wtpMap;
    return Boolean(map && !map.isMoving() && map.isStyleLoaded()
      && map.getLayer("state-relief-light")
      && map.getLayoutProperty("state-relief-light", "visibility") !== "none"
      && !document.querySelector("[data-governing-skeleton]"));
  }, null, { timeout: 90_000 });
}

async function jump(page: Page, center: [number, number], zoom: number) {
  await page.evaluate(({ center, zoom }) => {
    const map = (window as unknown as { __wtpMap: MapLibreMap }).__wtpMap;
    map.jumpTo({ center, zoom, bearing: 0, pitch: 0 });
  }, { center, zoom });
  await settledMap(page);
}

async function openDistrict(page: Page) {
  await jump(page, [-110.94, 32.20], 11);
  await page.waitForFunction(() => {
    const map = (window as unknown as { __wtpMap: MapLibreMap }).__wtpMap;
    return map.getStyle().layers.some(layer => layer.id.startsWith("district-")
      && map.getLayoutProperty(layer.id, "visibility") !== "none");
  }, null, { timeout: 60_000 });
  const point = await page.evaluate(() => {
    const map = (window as unknown as { __wtpMap: MapLibreMap }).__wtpMap;
    const point = map.project([-110.94, 32.20]);
    const rect = map.getCanvas().getBoundingClientRect();
    return { x: point.x + rect.x, y: point.y + rect.y };
  });
  await page.mouse.click(point.x, point.y);
  const choice = page.locator(".district-picker-row").filter({
    has: page.locator(".district-picker-type", { hasText: /^MUNICIPAL$/i }),
  });
  await choice.waitFor({ timeout: 60_000 });
  await choice.click();
  await page.locator(".popup-card").waitFor();
  assert.match(await page.locator(".popup-card").getAttribute("aria-label") ?? "", /Tucson/i);
}

function immediate(durations: string) {
  return durations.split(",").every(duration => {
    const value = Number.parseFloat(duration);
    return duration.trim().endsWith("ms") ? value <= 1 : value <= 0.001;
  });
}

function redacted(message: string) {
  return message.replace(/https?:\/\/[^\s"'<>]+/g, url => {
    try { const parsed = new URL(url); return parsed.origin + parsed.pathname; }
    catch { return "[URL redacted]"; }
  });
}

const browser = await launchGuarded({ label: "tester-visual-9-4", args: GPU_ARGS });
let failure: string | null = null;
try {
  // These two callers share the very PopupCard rendered below. This is a
  // structural class check; no invented official/meeting fixture is rendered.
  const callers = await Promise.all(["district-popup.tsx", "official-popup.tsx", "meeting-popup.tsx"]
    .map(file => readFile(join("components/map/popup", file), "utf8")));
  for (const caller of callers) {
    assert.match(caller, /from ["']\.\/popup-card["']/);
    assert.match(caller, /<PopupCard[\s>]/);
  }
  const sharedCard = await readFile("components/map/popup/popup-card.tsx", "utf8");
  assert.match(sharedCard, /lumenStyles\.card/);
  results.push({ id: "lumen-shared-class", row: "DSN-2", pass: true,
    evidence: { component: "PopupCard", callers: ["DistrictPopup", "OfficialPopup", "MeetingPopup"] } });

  for (const theme of ["dark", "light"] as const) {
    const context = await browser.context({ viewport, colorScheme: theme, reducedMotion: "no-preference" });
    try {
      await context.addInitScript(`sessionStorage.setItem('wtp.approximate_location',JSON.stringify({zip:'85701',savedAt:new Date().toISOString()}));localStorage.setItem('wtp.tutorial_seen','1');localStorage.setItem('wtp.theme',${JSON.stringify(theme)});`);
      await context.addInitScript(String.raw`(() => {
        const timer = setInterval(() => {
          const map = window.__wtpMap;
          const skeleton = document.querySelector('[data-governing-skeleton]');
          if (!map?.isMoving() || !skeleton) return;
          const style = map.getStyle();
          if (!style?.layers) return;
          const rect = skeleton.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          window.__testerVisualFlight = {
            moving: map.isMoving(), text: skeleton.textContent.trim(), busy: skeleton.getAttribute('aria-busy'),
            visible: getComputedStyle(skeleton).visibility !== 'hidden',
            placeholders: [...skeleton.querySelectorAll('span')].map(span => ({
              text: span.textContent, background: getComputedStyle(span).backgroundColor,
              width: span.getBoundingClientRect().width, height: span.getBoundingClientRect().height,
            })),
            layers: style.layers.filter(layer => /^(district-|state-relief-|voting-)/.test(layer.id))
              .map(layer => ({id: layer.id, visibility: map.getLayoutProperty(layer.id, 'visibility')})),
          };
          clearInterval(timer);
        }, 10);
        setTimeout(() => clearInterval(timer), 90000);
      })();`);
      const page = await context.newPage();
      page.on("console", message => {
        if (message.type() === "error") browserErrors.push({ theme, kind: "console", message: redacted(message.text()) });
      });
      page.on("pageerror", error => browserErrors.push({ theme, kind: "pageerror", message: redacted(error.message) }));
      page.on("response", response => {
        const url = new URL(response.url());
        if (url.hostname === "api.maptiler.com" && url.pathname.endsWith("style.json")) {
          basemapRequests.push({ theme, path: url.origin + url.pathname, status: response.status() });
        }
      });
      page.on("requestfailed", request => {
        const url = new URL(request.url());
        if (url.hostname === "api.maptiler.com") {
          basemapRequests.push({ theme, path: url.origin + url.pathname, error: request.failure()?.errorText });
        }
      });
      page.setDefaultTimeout(30_000);
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await page.waitForFunction("window.__testerVisualFlight?.moving", null, { timeout: 90_000 });
      const flight = await page.evaluate("window.__testerVisualFlight") as {
        moving: boolean; text: string; busy: string; visible: boolean;
        placeholders: { text: string; background: string; width: number; height: number }[];
        layers: { id: string; visibility: string }[];
      };
      assert.equal(flight.text, "Who governs here", "flight skeleton contains no jurisdiction or official data");
      assert.equal(flight.busy, "true");
      assert.equal(flight.visible, true);
      assert.equal(flight.placeholders.length, 4);
      assert.ok(flight.placeholders.every(block => block.text === "" && block.width > 0 && block.height > 0));
      for (const block of flight.placeholders) {
        const channels = block.background.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
        assert.equal(channels.length, 3);
        assert.ok(Math.max(...channels) - Math.min(...channels) <= 1, "skeleton blocks are neutral gray");
      }
      assert.ok(flight.layers.every(layer => layer.visibility === "none"), "all already-created application layers are held during motion");
      await settledMap(page);
      assert.equal(await page.locator("[data-governing-skeleton]").count(), 0);
      results.push({ id: `flight-skeleton-${theme}`, row: "PERF-1", pass: true, evidence: flight });
      const renderer = await page.evaluate(READ_RENDERER);
      assert.ok(typeof renderer === "string" && !/SwiftShader|NO WEBGL/i.test(renderer), "capture uses the real GPU path");

      // A fresh desktop starts in its existing sidebar placement. Capture
      // its actual neutral styling before moving that same instance to map.
      const hideSidebar = page.getByRole("button", { name: "Hide sidebar", exact: true });
      if (await hideSidebar.isVisible()) await hideSidebar.click();
      const minimizeWgh = page.getByRole("button", { name: "Minimize — the card stays one tap away", exact: true });
      if (await minimizeWgh.isVisible()) await minimizeWgh.click();
      const pearl = page.locator('[data-ask-pill="map"]');
      await pearl.waitFor();
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.mouse.move(720, 800);
      const rest = await surface(pearl);
      const previousFootprint = await pearl.evaluate(element => {
        const classes = element.getAttribute("class") ?? "";
        element.setAttribute("class", "ask-pill");
        const rect = element.getBoundingClientRect();
        const result = { width: rect.width, height: rect.height, minHeight: getComputedStyle(element).minHeight };
        element.setAttribute("class", classes);
        return result;
      });
      assert.equal(rest.text, ASK_PILL_LABELS.map.label, "Pearl keeps the exact existing text");
      assert.equal(rest.minHeight, "44px", "Pearl retains the existing 44px minimum");
      assert.equal(rest.height, previousFootprint.height, "Pearl keeps the exact pre-treatment rendered row height");
      assert.equal(rest.width, previousFootprint.width, "Pearl keeps the exact pre-treatment rendered width");
      assert.ok(rest.width > 100 && rest.width < 250, "the reference hero sizing did not enter the pill");
      assert.equal(rest.before.content, '""');
      assert.ok(Number.parseFloat(rest.before.radius) > 0, "the broad upper highlight is curved");
      assert.match(rest.after.image, /linear-gradient/);
      assert.match(rest.after.shadow, /inset/);
      assert.ok((rest.shadow.match(/inset/g) ?? []).length === 3, "the three Pearl inset layers exist");
      const box = await pearl.boundingBox(); assert.ok(box);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      let press: Awaited<ReturnType<typeof surface>>;
      try {
        await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-ask-pill="map"]')!).transform === "matrix(1, 0, 0, 1, 0, 2)");
        press = await surface(pearl);
        assert.equal(press.text, rest.text);
        assert.equal(press.width, rest.width);
        assert.equal(press.height, rest.height);
        assert.equal(press.y - rest.y, 2, "a real mouse press moves the pill down 2px");
        assert.notEqual(press.shadow, rest.shadow, "press also changes the tactile shadow");
      } finally { await page.mouse.up(); }
      if (await pearl.getAttribute("aria-expanded") === "true") await pearl.click();
      await page.emulateMedia({ reducedMotion: "reduce" });
      const reducedPearl = await surface(pearl);
      assert.ok(immediate(reducedPearl.duration) && immediate(reducedPearl.after.duration));
      results.push({ id: `pearl-${theme}`, row: "DSN-1", pass: true, evidence: { renderer, previousFootprint, rest, press, reducedPearl } });

      await page.getByRole("button", { name: "Open menu", exact: true }).click();
      const sidebarPill = page.locator('[data-ask-pill="sidebar"]');
      await sidebarPill.waitFor();
      const sidebar = await surface(sidebarPill);
      assert.equal(sidebar.text, ASK_PILL_LABELS.sidebar.label);
      assert.equal(sidebar.className, "ask-pill", "expanded sidebar has no Pearl module class");
      assert.equal(sidebar.before.content, "none");
      assert.equal(sidebar.after.content, "none");
      assert.equal(await page.locator('[data-ask-pill="map"]').count(), 0);
      await hideSidebar.click();
      await pearl.waitFor();
      results.push({ id: `pearl-scope-${theme}`, row: "DSN-1", pass: true, evidence: sidebar });

      await openDistrict(page);
      const popup = page.locator(".popup-card");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.mouse.move(720, 80);
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector(".popup-card")!, "::after").opacity) <= 0.181);
      const cardRest = await surface(popup);
      assert.match(cardRest.image, /radial-gradient/);
      assert.match(cardRest.image, /(?:50% 100%|center bottom|ellipse at bottom)/);
      assert.match(cardRest.image, /65%/);
      assert.equal(cardRest.borderWidth, "0px");
      assert.match(cardRest.shadow, /1px inset|inset[^,]*1px/);
      assert.ok((cardRest.shadow.match(/rgba?\(/g) ?? []).length === 3, "rim and both elevation shadows exist");
      assert.equal(cardRest.after.height, "1px");
      assert.ok(Math.abs(Number.parseFloat(cardRest.after.width) / cardRest.width - 0.7) < 0.002);
      assert.ok(Math.abs(Number.parseFloat(cardRest.after.left) / cardRest.width - 0.15) < 0.002);
      assert.equal(cardRest.after.opacity, 0.18);
      assert.equal(cardRest.after.duration, "1s");
      assert.equal(cardRest.after.curve, "cubic-bezier(0.15, 0.83, 0.66, 1)");
      await popup.hover();
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector(".popup-card")!, "::after").opacity) >= 0.999);
      const cardHover = await surface(popup);
      assert.equal(cardHover.background, cardRest.background);
      assert.equal(cardHover.image, cardRest.image, "illumination does not recolor the card");
      assert.equal(cardHover.transform, cardRest.transform, "popup cards do not inherit button lift");
      assert.notEqual(cardHover.shadow, cardRest.shadow, "interaction strengthens the inset rim");
      await page.emulateMedia({ reducedMotion: "reduce" });
      const reducedCard = await surface(popup);
      assert.ok(immediate(reducedCard.duration) && immediate(reducedCard.after.duration));
      results.push({ id: `lumen-${theme}`, row: "DSN-2", pass: true, evidence: {
        subject: await popup.getAttribute("aria-label"), rest: cardRest, hover: cardHover, reduced: reducedCard,
      } });

      // The desktop selection opens WGH as a reference. Its actual keyboard
      // minimize control preserves the district popup (outside pointer presses
      // dismiss popups), so the same capture can show Pearl and Lumen together.
      if (await minimizeWgh.isVisible()) {
        await minimizeWgh.focus();
        await page.keyboard.press("Enter");
      }
      await pearl.waitFor();
      await popup.waitFor();

      for (const [view, center, zoom] of [
        ["whole-arizona", [-111.9, 34.2], 5.4],
        ["colorado-river", [-114.19, 34.3], 7.5],
      ] as const) {
        await jump(page, [...center], zoom);
        await popup.waitFor();
        const relief = await page.evaluate(layerIds => {
          const map = (window as unknown as { __wtpMap: MapLibreMap }).__wtpMap;
          const style = map.getStyle();
          return {
            zoom: map.getZoom(), center: map.getCenter().toArray(), pitch: map.getPitch(),
            projection: style.projection ?? { type: "mercator" },
            basemap: {
              name: style.name,
              background: style.layers.filter(layer => layer.type === "background").map(layer => ({id: layer.id, paint: layer.paint})),
              tileSources: Object.entries(style.sources).filter(([, source]) => source.type === "vector" || source.type === "raster")
                .map(([id, source]) => ({ id, type: source.type, loaded: map.isSourceLoaded(id) })),
            },
            source: style.sources["state-relief"], edges: style.sources["state-relief-edges"],
            layers: layerIds.map(id => ({ layer: style.layers.find(layer => layer.id === id), visibility: map.getLayoutProperty(id, "visibility") ?? "visible" })),
            askPlacements: [...document.querySelectorAll("[data-ask-pill]")].map(element => element.getAttribute("data-ask-pill")),
            svgFollowers: document.querySelectorAll(".state-focus-layer, svg[data-state-focus], [data-state-focus-overlay]").length,
          };
        }, [...RELIEF_LAYERS]);
        assert.equal(relief.zoom, zoom);
        assert.equal(relief.pitch, 0);
        assert.ok(relief.basemap.tileSources.length > 0, `Cannot certify ${theme} MAP-6 over the empty fallback ground`);
        assert.ok(relief.basemap.background.some(layer => layer.id !== "ground"), "actual themed basemap background is present");
        assert.ok(!JSON.stringify(relief.projection).includes("globe"));
        assert.equal(relief.svgFollowers, 0, "raised state has no DOM/SVG map follower");
        assert.ok(relief.source?.type === "geojson" && relief.edges?.type === "geojson");
        assert.equal(relief.source.tolerance, 0);
        assert.equal(relief.edges.tolerance, 0);
        assert.deepEqual(relief.source.data, arizona, "style uses the exact canonical state outline");
        assert.deepEqual(relief.edges.data, directionalStateEdges(arizona), "directional segments retain canonical coordinates");
        assert.ok(relief.layers.every(entry => entry.layer && entry.visibility === "visible"));
        const tone = RELIEF_THEME[theme];
        const layers = relief.layers.map(entry => entry.layer as { type: string; source?: string; paint?: Record<string, unknown> });
        assert.equal(layers[0].type, "fill");
        assert.deepEqual(layers[0].paint?.["fill-translate"], [4, 6]);
        assert.equal(layers[1].paint?.["line-blur"], 12);
        assert.equal(layers[2].paint?.["fill-color"], tone.surface);
        assert.equal(layers[3].paint?.["line-color"], tone.light);
        assert.equal(layers[4].paint?.["line-color"], tone.shade);
        assert.equal(layers[3].source, "state-relief-edges");
        assert.equal(layers[4].source, "state-relief-edges");
        const source = relief.source;
        const edges = relief.edges;
        const geometrySummary = {
          canonicalState: arizona.properties.ocdId,
          rings: arizona.geometry.coordinates.length,
          canonicalVertices: arizona.geometry.coordinates.reduce((sum, ring) => sum + ring.length, 0),
          derivedSegments: directionalStateEdges(arizona).features.length,
          sourceTolerance: source.tolerance, edgeTolerance: edges.tolerance,
          exactSource: true, exactDerivedEdges: true,
        };
        results.push({ id: `relief-${theme}-${zoom}`, row: "MAP-6", pass: true, evidence: {
          ...geometrySummary, zoom: relief.zoom, center: relief.center, projection: relief.projection,
          basemap: relief.basemap, layers: relief.layers, svgFollowers: relief.svgFollowers, askPlacements: relief.askPlacements,
        } });
        await page.mouse.move(720, 80);
        const path = join(out, `V94-${theme}-${view}-${zoom}.png`);
        await page.screenshot({ path });
        screenshots.push({ path, theme, zoom, view });
      }
    } finally { await context.close(); }
  }
  assert.equal(results.length, 13, "the frozen script denominator is 13 cases");
  floored("V94 visual observations", "the frozen 13-case local visual proof", 13, results.length);
  assert.equal(screenshots.length, 4, "the representative set is exactly four captures");
  assert.deepEqual(browserErrors.filter(error => error.kind === "pageerror"), [], "no script or product runtime error may invalidate the browser proof");
} catch (error) {
  failure = error instanceof Error ? error.stack ?? error.message : String(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  const report = { pass: failure === null, base, runId: browser.runId, exactHead, buildId, expectedCases: 13,
    results, cases: results, screenshots, basemapRequests, browserErrors, screenshotsReviewed: 0, failures: failure ? [failure] : [], error: failure };
  await writeFile(join(out, "results.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ pass: report.pass, cases: results.length, screenshots, out, error: failure }, null, 2));
}
