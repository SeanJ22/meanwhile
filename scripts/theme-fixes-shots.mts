/**
 * The theme fixes (DS-02) on a running build, in both themes and at both sidebar widths (368px at 1280 wide,
 * 332px at 900 wide). Writes screenshots and measurements to docs/design/theme-fixes/<label>/.
 *
 * District labels need boundary tiles and a basemap that carries glyphs. Locally there is neither, so the build is
 * made with a placeholder MapTiler key and a local boundary URL, and this run answers both:
 *   NEXT_PUBLIC_MAPTILER_KEY=local-check NEXT_PUBLIC_BOUNDARY_PMTILES_URL=/local-boundaries.pmtiles pnpm build
 *   pnpm start &
 *   THEME_SHOTS_LABEL=after THEME_SHOTS_ARCHIVE=<tucson.pmtiles> pnpm exec tsx scripts/theme-fixes-shots.mts
 * The MapTiler style is answered with a stand-in (a background and one place label using MapLibre's demo glyphs);
 * the archive holds Tucson-area districts cut from the repo's committed geometry, in the production layer shape.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Page } from "playwright";

import { launchGuarded, seedZip } from "./browser.mts";

const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";
const LABEL = process.env.THEME_SHOTS_LABEL ?? "after";
const ARCHIVE = process.env.THEME_SHOTS_ARCHIVE;
if (!ARCHIVE) throw new Error("THEME_SHOTS_ARCHIVE names the local boundary archive");
const OUT = `docs/design/theme-fixes/${LABEL}`;
mkdirSync(OUT, { recursive: true });

const archive = readFileSync(ARCHIVE);
const recorded = JSON.parse(readFileSync("tests/fixtures/reader-upcoming-meetings-85701.json", "utf8")) as {
  recordedAt: string; listingIdentity: unknown; coverage: { bodies: unknown[] }; meetings: unknown[];
};
const meetings = {
  meetings: recorded.meetings, listingIdentity: recorded.listingIdentity, tier: "exact", radiusKm: 8,
  center: { lat: 32.21696, lng: -110.971 }, governingOcdIds: null, partialOcdIds: null,
  coverage: { state: "MEETINGS", bodies: recorded.coverage.bodies, seats: [], senators: [], statewideExecutives: [], stateLegislatorAuthorities: [],
    divisions: [], unincorporated: false, counts: { total: 0, withSource: 0, withoutSource: 0, lookedAt: 0, governing: { total: 0, withSource: 0 } },
    seatCounts: { total: 0, named: 0 } },
};

/** A stand-in for the MapTiler style: real glyphs, so district labels draw, and one basemap place label. */
function standInStyle(theme: "light" | "dark") {
  return {
    version: 8, name: `stand-in ${theme}`,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: { place: { type: "geojson", data: { type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "Tucson" }, geometry: { type: "Point", coordinates: [-110.93, 32.25] } }] } } },
    layers: [
      { id: "background", type: "background", paint: { "background-color": theme === "light" ? "#ece8df" : "#1b1f24" } },
      { id: "place-label", type: "symbol", source: "place", layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 14 },
        paint: { "text-color": theme === "light" ? "#3b3b3b" : "#d6d6d6", "text-halo-color": theme === "light" ? "#ece8df" : "#1b1f24", "text-halo-width": 1 } },
    ],
  };
}

async function prepare(page: Page) {
  await page.route("**/api/meetings?**", route => route.fulfill({ json: meetings }));
  await page.route("https://api.maptiler.com/maps/**", route => {
    const dark = new URL(route.request().url()).pathname.includes("-dark");
    return route.fulfill({ json: standInStyle(dark ? "dark" : "light") });
  });
  await page.route("**/local-boundaries.pmtiles", route => {
    const range = /bytes=(\d+)-(\d+)?/.exec(route.request().headers().range ?? "");
    if (!range) return route.fulfill({ status: 200, body: archive, headers: { "content-type": "application/octet-stream", "accept-ranges": "bytes" } });
    const start = Number(range[1]);
    const end = Math.min(range[2] ? Number(range[2]) : archive.length - 1, archive.length - 1);
    return route.fulfill({ status: 206, body: archive.subarray(start, end + 1), headers: {
      "content-type": "application/octet-stream", "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${archive.length}`,
    } });
  });
  await page.clock.install({ time: new Date(recorded.recordedAt) });
  await seedZip(page, "85701");
  await page.addInitScript(() => { try { localStorage.setItem("wtp.show_districts", "1"); localStorage.setItem("wtp.theme", "dark"); } catch { /* storage refused still renders */ } });
}

/** Waits for the map to settle after a style change. */
async function settled(page: Page) {
  await page.waitForFunction(() => {
    const map = (window as unknown as { __wtpMap?: { loaded(): boolean; isStyleLoaded(): boolean } }).__wtpMap;
    return Boolean(map && map.isStyleLoaded() && map.loaded());
  }, undefined, { timeout: 20_000 });
  await page.waitForTimeout(1200);
}

/** Every district label's halo against the current `--bg`, and whether the selected district is still selected. */
async function labelState(page: Page, selected: string | null) {
  return page.evaluate((selectedId) => {
    type M = { getStyle(): { layers: { id: string; type: string }[] }; getPaintProperty(id: string, p: string): unknown;
      getFeatureState(f: { source: string; sourceLayer: string; id: string }): Record<string, unknown> };
    const map = (window as unknown as { __wtpMap: M }).__wtpMap;
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim().toLowerCase();
    const labels = map.getStyle().layers.filter(layer => /^district-.+-label$/.test(layer.id));
    return {
      theme: document.documentElement.getAttribute("data-theme") ?? "dark",
      bg,
      labels: labels.map(layer => ({ id: layer.id, halo: String(map.getPaintProperty(layer.id, "text-halo-color")).toLowerCase(),
        width: map.getPaintProperty(layer.id, "text-halo-width"), blur: map.getPaintProperty(layer.id, "text-halo-blur") ?? null })),
      selectedStillSelected: selectedId
        ? Boolean(map.getFeatureState({ source: "national-boundaries", sourceLayer: "districts", id: selectedId }).selected)
        : null,
    };
  }, selected);
}

/** The sidebar header: the two controls, the wordmark, and the theme glyph. */
async function header(page: Page) {
  return page.evaluate(() => {
    const rect = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left * 10) / 10, right: Math.round(r.right * 10) / 10, top: Math.round(r.top), width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 };
    };
    const brand = document.querySelector(".sidebar-header .brand");
    const theme = brand?.querySelector(".theme-toggle-btn") ?? null;
    const collapse = brand?.querySelector(".mw-collapse-btn") ?? null;
    const logo = brand?.querySelector(".wtp-logo") ?? null;
    const t = rect(theme), c = rect(collapse), l = rect(logo);
    const glyph = (root: Element | null) => {
      if (!root) return null;
      const sun = root.querySelector(".mw-theme-sun"), moon = root.querySelector(".mw-theme-moon");
      if (!sun || !moon) return { kind: "half-circle" };
      return { kind: "sun-moon", sunOpacity: getComputedStyle(sun).opacity, moonOpacity: getComputedStyle(moon).opacity,
        size: `${Math.round(sun.getBoundingClientRect().width)}x${Math.round(sun.getBoundingClientRect().height)}`, label: root.getAttribute("aria-label") };
    };
    return {
      sidebarWidth: rect(document.querySelector(".mw-reader .sidebar, aside.sidebar"))?.width ?? null,
      sidebarVar: getComputedStyle(document.documentElement).getPropertyValue("--sidebar-w").trim(),
      theme: t, collapse: c,
      controlsOverlapPx: t && c ? Math.max(0, Math.round((t.right - c.left) * 10) / 10) : null,
      controlsGapPx: t && c ? Math.round((c.left - t.right) * 10) / 10 : null,
      logo: l, logoFontSize: logo ? getComputedStyle(logo).fontSize : null,
      logoGapToControlsPx: l && t ? Math.round((t.left - l.right) * 10) / 10 : null,
      logoLines: logo?.querySelector(".wtp-logo-word")?.getClientRects().length ?? null,
      sidebarGlyph: glyph(theme),
    };
  });
}

async function toggleTheme(page: Page) {
  await page.locator(".sidebar-header .theme-toggle-btn").click();
  await settled(page);
}

async function selectDistrict(page: Page): Promise<string | null> {
  const point = await page.evaluate(() => {
    const map = (window as unknown as { __wtpMap: { project(p: [number, number]): { x: number; y: number }; getCanvas(): HTMLCanvasElement } }).__wtpMap;
    // Inside State House District 18, clear of every meeting pin.
    const p = map.project([-110.86, 32.27]);
    const box = map.getCanvas().getBoundingClientRect();
    return { x: box.left + p.x, y: box.top + p.y };
  });
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(800);
  const row = page.locator(".district-picker-row").first();
  if (await row.count()) { await row.click(); await page.waitForTimeout(800); }
  // The district's card opens; "Show the whole boundary on the map" parks it and keeps the selection.
  const park = page.locator("[data-reader-card] button", { hasText: "Show the whole boundary on the map" }).first();
  if (await park.count()) { await park.click(); await settled(page); }
  return page.evaluate(() => {
    type M = { queryRenderedFeatures(o?: unknown): { id?: string | number; layer: { id: string } }[];
      getFeatureState(f: { source: string; sourceLayer: string; id: string | number }): Record<string, unknown> };
    const map = (window as unknown as { __wtpMap: M }).__wtpMap;
    for (const feature of map.queryRenderedFeatures()) {
      if (!feature.layer.id.startsWith("district-") || feature.id === undefined) continue;
      if (map.getFeatureState({ source: "national-boundaries", sourceLayer: "districts", id: feature.id }).selected) return String(feature.id);
    }
    return null;
  });
}

const WIDTHS = [
  { name: "sidebar-368", viewport: { width: 1280, height: 800 } },
  { name: "sidebar-332", viewport: { width: 900, height: 800 } },
] as const;

const results: Record<string, unknown> = {};
const browser = await launchGuarded({ label: `theme-fixes-${LABEL}` });
try {
  for (const width of WIDTHS) {
    const context = await browser.context({ viewport: width.viewport, deviceScaleFactor: 2 });
    await context.addInitScript({ content: "window.__name = (fn) => fn;" });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await prepare(page);
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".sidebar-header .theme-toggle-btn", { timeout: 20_000 });
    await settled(page);
    await page.evaluate(() => (window as unknown as { __wtpMap: { jumpTo(o: unknown): void } }).__wtpMap.jumpTo({ center: [-110.97, 32.22], zoom: 10.5 }));
    await settled(page);
    const selected = await selectDistrict(page);
    const row: Record<string, unknown> = { selected, passes: [] as unknown[] };
    const shoot = async (name: string) => {
      await page.screenshot({ path: `${OUT}/${width.name}-${name}.png` });
      await page.locator(".sidebar-header").screenshot({ path: `${OUT}/${width.name}-${name}-header.png` });
    };
    // Dark, then light, dark, light, dark: several switches in a row.
    for (let pass = 0; pass < 5; pass += 1) {
      if (pass > 0) await toggleTheme(page);
      const state = { labels: await labelState(page, selected), header: await header(page) };
      (row.passes as unknown[]).push(state);
      if (pass <= 2) await shoot(`${pass}-${state.labels.theme}`);
    }
    // The map header's toggle, with the sidebar collapsed.
    await page.locator(".mw-collapse-btn").click();
    await page.waitForTimeout(600);
    row.mapHeader = await page.evaluate(() => {
      const button = document.querySelector(".mw-header-theme");
      const logo = document.querySelector(".mw-header-logo .wtp-logo");
      const sun = button?.querySelector(".mw-theme-sun"), moon = button?.querySelector(".mw-theme-moon");
      return { logoFontSize: logo ? getComputedStyle(logo).fontSize : null, logoWidth: logo ? Math.round(logo.getBoundingClientRect().width) : null,
        glyph: sun && moon ? { sunOpacity: getComputedStyle(sun).opacity, moonOpacity: getComputedStyle(moon).opacity } : "half-circle",
        theme: document.documentElement.getAttribute("data-theme") ?? "dark" };
    });
    await page.locator(".mw-header").screenshot({ path: `${OUT}/${width.name}-map-header.png` });
    row.errors = errors;
    results[width.name] = row;
    console.log(width.name, JSON.stringify(row).slice(0, 1500));
    await context.close();
  }
  // A phone has no sidebar header: the map header carries the wordmark and the toggle.
  const phone = await browser.context({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.addInitScript({ content: "window.__name = (fn) => fn;" });
  const page = await phone.newPage();
  await prepare(page);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".mw-header .mw-header-theme", { timeout: 20_000 });
  await settled(page);
  const phoneHeader = async () => page.evaluate(() => {
    const logo = document.querySelector(".mw-header-logo .wtp-logo")!.getBoundingClientRect();
    const theme = document.querySelector(".mw-header-theme")!.getBoundingClientRect();
    const word = document.querySelector(".mw-header-logo .wtp-logo-word");
    return { theme: document.documentElement.getAttribute("data-theme") ?? "dark", logoWidth: Math.round(logo.width), logoRight: Math.round(logo.right),
      toggleLeft: Math.round(theme.left), gapPx: Math.round(theme.left - logo.right), lines: word?.getClientRects().length ?? null };
  });
  const phoneRows = [await phoneHeader()];
  await page.locator(".mw-header").screenshot({ path: `${OUT}/phone-390-map-header-dark.png` });
  await page.locator(".mw-header .mw-header-theme").click();
  await settled(page);
  phoneRows.push(await phoneHeader());
  await page.locator(".mw-header").screenshot({ path: `${OUT}/phone-390-map-header-light.png` });
  results["phone-390"] = phoneRows;
  console.log("phone-390", JSON.stringify(phoneRows));
  await phone.close();
} finally {
  writeFileSync(`${OUT}/results.json`, `${JSON.stringify(results, null, 2)}\n`);
  await browser.close();
}
