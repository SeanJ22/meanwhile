/**
 * Screenshot the running app.
 *
 * `pnpm shoot <name> [--zip 85701] [--theme dark|light] [--districts]
 *                    [--viewport 1440x900] [--path /] [--wait 6000]`
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
  ({ zip, theme, districts }) => {
    try {
      if (theme === "light") localStorage.setItem("wtp.theme", "light");
      else localStorage.removeItem("wtp.theme");

      if (zip) {
        localStorage.setItem(
          "wtp.approximate_location",
          JSON.stringify({ zip, savedAt: new Date().toISOString() }),
        );
      } else {
        localStorage.removeItem("wtp.approximate_location");
      }

      localStorage.setItem("wtp.show_districts", districts ? "1" : "0");
    } catch {
      // Nothing to do; the shot just starts from defaults.
    }
  },
  { zip, theme, districts: flag("districts") },
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

// Escape hatch for any other affordance worth showing in a shot.
const clicked = arg("click");
if (clicked) {
  await page.click(clicked);
  await page.waitForTimeout(500);
}

if (flag("list")) {
  await page.click(".count-badge");
  await page.waitForTimeout(400);
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
