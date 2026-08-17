/**
 * Screenshot the running app.
 *
 * `pnpm shoot <name> [--zip 85701] [--theme dark|light] [--districts]
 *                    [--viewport 1440x900] [--path /] [--wait 6000] [--zoom 14]`
 *
 * Why this exists: MapLibre renders on requestAnimationFrame, which browsers
 * stop delivering to a tab that is occluded or backgrounded. Capturing through
 * an attached browser therefore yields stale or empty frames whenever the
 * window happens to be covered — the map is fine, the capture is not. Playwright
 * drives a headless Chromium that is never occluded, so a shot is reproducible
 * regardless of what is on screen.
 *
 * Waits for the map's own idea of readiness rather than a fixed sleep: tiles
 * parsed and the first paint done. Note that `map.loaded()` is deliberately not
 * used — the MapTiler styles ship an attribution-only source that never reports
 * loaded, so `loaded()` is false forever. See map-canvas.tsx.
 */

import { chromium } from "playwright";
import { makeRunId, syntheticRunHeaders } from "../lib/db/run-marker.ts";

/**
 * C05 (2026-08-17): this run declares itself so the rows it writes to
 * production's search log are never counted as a reader's. The runner cannot
 * mark the row — the route writes it — so it says who it is in a header.
 */
const RUN_HEADERS = syntheticRunHeaders({
  WTP_RUN_ID:
    process.env.WTP_RUN_ID?.trim() ||
    makeRunId("shoot", new Date().toISOString()),
});

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(root, "screenshots");

const BASE_URL = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const name = process.argv[2]?.startsWith("--") ? undefined : process.argv[2];
if (!name) {
  console.error(
    "usage: pnpm shoot <name> [--zip 85701] [--theme light] [--districts] [--viewport 1440x900] [--path /]",
  );
  process.exit(1);
}

const [width, height] = (arg("viewport", "1440x900") as string)
  .split("x")
  .map(Number);

const zip = arg("zip");
const theme = arg("theme", "dark");
const path = arg("path", "/") as string;
const settle = Number(arg("wait", "9000"));

const browser = await chromium.launch();
const context = await browser.newContext({
    // C05: this run is ours, declared at write time.
    extraHTTPHeaders: RUN_HEADERS,
  viewport: { width, height },
  deviceScaleFactor: 2,
  // The app reads prefers-reduced-motion to decide between flyTo and jumpTo.
  // Reduced motion makes the camera land immediately, which is what a
  // deterministic screenshot wants.
  reducedMotion: "reduce",
});

// Seed localStorage before the app's first paint, so the run starts in the
// state we want rather than clicking through to it.
await context.addInitScript(
  ({ zip, theme, districts, tutorial }) => {
    try {
      if (theme === "light") localStorage.setItem("wtp.theme", "light");
      else localStorage.removeItem("wtp.theme");

      // SESSION storage since 2026-08-15 (6f): the reader's location no
      // longer survives a tab closing, so seeding localStorage would seed
      // nothing and every shot would be of the welcome overlay. The recents
      // list is the localStorage half and is seeded with it, so the zip
      // switcher has something to show.
      if (zip) {
        sessionStorage.setItem(
          "wtp.approximate_location",
          JSON.stringify({ zip, savedAt: new Date().toISOString() }),
        );
        localStorage.setItem("wtp.recent_zips", JSON.stringify([zip]));
      } else {
        sessionStorage.removeItem("wtp.approximate_location");
      }

      localStorage.setItem("wtp.show_districts", districts ? "1" : "0");

      // The first-run tour covers the surfaces most shots are of. Seeded
      // seen unless the shot is OF the tour (--tutorial).
      if (tutorial) localStorage.removeItem("wtp.tutorial_seen");
      else localStorage.setItem("wtp.tutorial_seen", "1");
    } catch {
      // Nothing to do; the shot just starts from defaults.
    }
  },
  { zip, theme, districts: flag("districts"), tutorial: flag("tutorial") },
);

// The Next dev-mode indicator floats over the corner of the app in development
// only. It is not part of the UI and must not appear in a shot someone is
// reviewing as one.
// Passed as a string, not a function: tsx compiles this file with esbuild,
// which rewrites named inner functions to reference a `__name` helper that
// does not exist in the page — the script then throws on every navigation.
await context.addInitScript({
  content: `document.addEventListener("DOMContentLoaded",function(){
    var s=document.createElement("style");
    s.textContent="nextjs-portal{display:none !important}";
    document.head.appendChild(s);
  })`,
});

const page = await context.newPage();

const problems: string[] = [];
page.on("console", (m) => {
  if (m.type() === "error") problems.push(m.text());
});
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });

// Give the map time to fetch and parse tiles. networkidle covers the document,
// not the worker's tile traffic.
await page.waitForTimeout(settle);

// Optional interactions, so a shot can show a state that only exists after
// input — an open autocomplete, the list overlay — without a human driving it.
const typed = arg("search");
if (typed) {
  await page.fill(".search-input", typed);
  await page.waitForTimeout(400);
}

// Type into the welcome card's zip field and submit with Enter, which is the
// only way to reach the malformed-input message — the button is disabled until
// five digits are in.
const typedZip = arg("typezip");
if (typedZip) {
  await page.fill(".welcome-card input[type=text]", typedZip);
  await page.press(".welcome-card input[type=text]", "Enter");
  await page.waitForTimeout(500);
}

// Type a question into the ask box and submit it. --ask captures the
// ANSWER (waits out the ~3s beat); --askbeat captures the BEAT itself
// (shoots mid-beat). Presentation-only driving; nothing new is logged
// beyond what a real ask logs.
const askQuestion = arg("ask") ?? arg("askbeat");
if (askQuestion) {
  // Two instances can mount (card and rail) — prefer the who-governs
  // card's, whose answer stays in the viewport; fall back to any visible.
  const inCard = page.locator(".coverage-notice [data-ask-box]:visible");
  const box = (await inCard.count())
    ? inCard.first()
    : page.locator("[data-ask-box]:visible").first();
  await box.fill(askQuestion);
  await box.press("Enter");
  await page.waitForTimeout(process.argv.includes("--askbeat") ? 900 : 3600);
}

// Click a labelled control — a district-type checkbox, a filter chip —
// matched on its visible text. Exists because the per-type checkboxes live in
// the store rather than localStorage, so no seed can turn them on.
const clickLabel = arg("clicklabel");
if (clickLabel) {
  await page
    .locator(`label:has-text("${clickLabel}")`)
    .first()
    .click({ force: true });
  await page.waitForTimeout(1200);
}

// Drag the map with a real mouse gesture, so movestart carries an
// originalEvent — the signal scroll-and-settle (2i) keys on. Programmatic
// panBy would not exercise it. Format: --drag x1,y1,x2,y2
const dragArg = arg("drag");
if (dragArg) {
  const [x1, y1, x2, y2] = dragArg.split(",").map(Number);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  // Several steps so MapLibre treats it as a pan, not a jump.
  await page.mouse.move(x2, y2, { steps: 12 });
  await page.mouse.up();
  // The settle debounce is 650 ms; the refetch needs a beat beyond that.
  await page.waitForTimeout(2600);
}

// Click the map itself, in viewport coordinates. Used to exercise
// click-to-select, which has no selector to aim at.
const clickAt = arg("clickxy");
if (clickAt) {
  const [x, y] = clickAt.split(",").map(Number);
  await page.mouse.click(x, y);
  await page.waitForTimeout(700);
}

// Escape hatch for any other affordance worth showing in a shot.
const clicked = arg("click");
if (clicked) {
  await page.click(clicked);
  await page.waitForTimeout(500);
}

// Fill any input: --fill "selector|value". Runs before --clicks so a
// sequence can act on what the fill revealed (e.g. a street match).
const fillArg = arg("fill");
if (fillArg) {
  const [selector, ...rest] = fillArg.split("|");
  await page.locator(selector.trim()).first().fill(rest.join("|"));
  await page.waitForTimeout(600);
}

// A sequence of clicks, for states that only exist several steps in — a popup
// reached through a marker and a panel row, or a modal tab reached through
// both plus the expand button. Pipe-separated rather than comma, because
// Playwright selectors contain commas far more often than pipes.
const clickSeq = arg("clicks");
if (clickSeq) {
  for (const selector of clickSeq.split("|")) {
    const trimmed = selector.trim();
    if (!trimmed) continue;
    // Fail loudly. A missing step used to leave the shot on an earlier state,
    // which looks exactly like a successful capture of the wrong thing — the
    // no-op-reports-success shape this project keeps rediscovering.
    await page.click(trimmed, { timeout: 5000 });
    await page.waitForTimeout(450);
  }
}

// Scroll an element into view before shooting — for page sections below
// the fold (the funding block, the measures). Playwright selector.
const scrollTo = arg("scrollto");
if (scrollTo) {
  await page.locator(scrollTo).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
}

if (flag("list")) {
  await page.click(".count-badge");
  await page.waitForTimeout(400);
}

// Switch every district type on. The default is one per tier; this is how the
// worst case gets captured — all three Local boundaries over the same ground.
if (flag("alltypes")) {
  const boxes = page.locator("label.filter-check input[type=checkbox]");
  for (let i = 0; i < (await boxes.count()); i++) {
    const box = boxes.nth(i);
    if (!(await box.isChecked())) await box.check();
  }
  await page.waitForTimeout(1500);
}

// Force a zoom level. District legibility is a function of zoom — five Local
// boundaries that read cleanly at z9 can be a solid mat at z14 — so verifying
// that work means capturing the same place at several zooms.
const zoomTo = arg("zoom");
if (zoomTo) {
  await page.evaluate((z) => {
    // Same fiber walk as the stats block below: the map instance is not on
    // window, so this is the only handle on it from the page.
    const el = document.querySelector(".maplibregl-map");
    if (!el) return;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    if (!key) return;

    let fiber = (el as unknown as Record<string, { memoizedState?: unknown; return?: unknown }>)[key];
    let depth = 0;
    while (fiber && depth < 40) {
      let hook = fiber.memoizedState as { memoizedState?: unknown; next?: unknown } | undefined;
      let i = 0;
      while (hook && i < 25) {
        const s = hook.memoizedState as { current?: { setZoom?: (z: number) => void; getStyle?: unknown } } | undefined;
        if (s && typeof s === "object" && s.current && typeof s.current.getStyle === "function") {
          s.current.setZoom?.(z);
          return;
        }
        hook = hook.next as typeof hook;
        i++;
      }
      fiber = fiber.return as typeof fiber;
      depth++;
    }
  }, Number(zoomTo));
  // Re-tiling at a new zoom is not instant, and a shot taken mid-fetch shows
  // fewer boundaries than the map actually draws.
  await page.waitForTimeout(4000);
}

await mkdir(OUT_DIR, { recursive: true });
const file = join(OUT_DIR, `${name}.png`);
await page.screenshot({ path: file, scale: "css" });

// Report what actually rendered, so a shot can never quietly be of an empty
// map. Counts come from MapLibre itself via the same fiber walk used during
// the Phase 0 diagnosis — the map instance is not exposed on window.
const stats = await page.evaluate(() => {
  const el = document.querySelector(".maplibregl-map");
  if (!el) return { error: "no map element" };

  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
  if (!key) return { error: "no react fiber" };

  let fiber = (el as unknown as Record<string, { memoizedState?: unknown; return?: unknown }>)[key];
  let map: unknown = null;
  let depth = 0;

  while (fiber && depth < 40 && !map) {
    let hook = fiber.memoizedState as { memoizedState?: unknown; next?: unknown } | undefined;
    let i = 0;
    while (hook && i < 25) {
      const s = hook.memoizedState as { current?: { getStyle?: unknown } } | undefined;
      if (s && typeof s === "object" && s.current && typeof s.current.getStyle === "function") {
        map = s.current;
        break;
      }
      hook = hook.next as typeof hook;
      i++;
    }
    fiber = fiber.return as typeof fiber;
    depth++;
  }

  if (!map) return { error: "map instance not found" };

  const m = map as {
    getStyle: () => { layers: { id: string }[]; sources: Record<string, unknown> };
    queryRenderedFeatures: (o?: unknown) => { layer: { id: string } }[];
    getZoom: () => number;
  };

  const style = m.getStyle();
  const features = m.queryRenderedFeatures();
  const districtLayers = style.layers
    .filter((l) => /cd119|district/i.test(l.id))
    .map((l) => l.id);

  return {
    zoom: Number(m.getZoom().toFixed(2)),
    styleLayers: style.layers.length,
    sources: Object.keys(style.sources),
    renderedFeatures: features.length,
    distinctLayersDrawn: new Set(features.map((f) => f.layer.id)).size,
    districtLayers,
    districtFeatures: districtLayers.length
      ? m.queryRenderedFeatures({ layers: districtLayers }).length
      : 0,
    theme: document.documentElement.getAttribute("data-theme") ?? "dark",
    markers: document.querySelectorAll(".wtp-pin").length,
  };
});

await browser.close();

console.log(`${name} → screenshots/${name}.png`);
console.log(JSON.stringify(stats, null, 2));
if (problems.length) {
  console.log(`console errors (${problems.length}):`);
  for (const p of problems.slice(0, 8)) console.log(`  ${p}`);
}
