/**
 * WHAT THE STATE EFFECT COVERS — g5 item 1's permanent measurement.
 *
 * `SHOOT_BASE_URL=… pnpm measure:focus`
 *
 * ## Why this exists next to `pnpm measure:extrusion`
 *
 * The extrusion measurement asks how SMOOTHLY the effect's edge falls off. It
 * passed, at full marks, on a build whose mute covered the entire map at city
 * zoom — including the state the reader was standing in. A perfectly smooth
 * gradient over the wrong area is still the wrong area, and a measurement that
 * cannot tell correct coverage from incorrect coverage is not a correctness
 * test no matter how many numbers it prints.
 *
 * So this one asks the other question, and it is the one the author's report
 * was about: WHAT is affected. Every assertion below is anchored to a
 * lng/lat — a real place inside or outside the active state — projected
 * through the live map's own projection, so the check follows the geometry
 * exactly as the mask is supposed to.
 *
 * ## The five families
 *
 * 1. **Interior.** Points spread across the active state's visible interior,
 *    deliberately including places far from the entered zip (north Tucson and
 *    Drexel Heights at city zoom; the corners of the state further out). Each
 *    must render identically to the effect-disabled frame.
 * 2. **Effect-off equivalence.** Where the viewport is wholly inside the
 *    active state, the whole sampled frame must match the effect-disabled
 *    render within `INTERIOR_TOLERANCE`. Sample points are held at least
 *    `borderExclusionPx(zoom)` inside the border, measured in screen pixels
 *    against the projected outline: the raised edge legitimately differs from
 *    an effect-off render, and a check that ignored that would either fail a
 *    correct build or have its tolerance loosened until it proved nothing.
 * 3. **Exterior.** Points inside a neighbouring state must be measurably
 *    changed by the effect — `EXTERIOR_MARGIN` luminance units — and the
 *    comparison is each point against ITSELF with the effect off, never
 *    against an interior point somewhere else on the map. Terrain varies; the
 *    effect is the only thing that may differ between the two frames.
 * 4. **Data scoping.** With one state active, no other state's district
 *    layers, sources or geometry requests exist. Read off the map and off the
 *    network log, not inferred.
 * 5. **No active state.** No zip, and an uncovered zip: the frame must match
 *    the effect-disabled render everywhere. Nothing muted, nothing raised.
 *
 * Twelve frames minimum — three zooms x two zips x two themes — plus the two
 * with no active state. Every one prints its numbers whether it passes or
 * fails, because a threshold with no measurement behind it is a threshold
 * nobody can re-rule on.
 */
import { type Page } from "playwright";
import { makeRunId, syntheticRunHeaders } from "../lib/db/run-marker.ts";

/**
 * C05 (2026-08-17): this run declares itself so the rows it writes to
 * production's search log are never counted as a reader's. The runner cannot
 * mark the row — the route writes it — so it says who it is in a header.
 */
const RUN_HEADERS = syntheticRunHeaders({
  WTP_RUN_ID:
    process.env.WTP_RUN_ID?.trim() ||
    makeRunId("measure-focus", new Date().toISOString()),
});

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { COVERED_FIPS } from "../lib/coverage/artifacts.ts";
import { resolveZipGeography } from "../lib/geo/zip-geography.ts";
import { extrusionSpecForZoom } from "../lib/map/state-focus.ts";
import { decodePng, patchStats, type DecodedPng } from "./png.mts";
import { launchGuarded } from "./browser.mts";

import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";

const BASE = (process.env.SHOOT_BASE_URL ?? PUBLIC_SITE_ORIGIN).replace(
  /\/$/,
  "",
);
const OUT = join(process.cwd(), "screenshots", "focus-coverage");
mkdirSync(OUT, { recursive: true });

/**
 * How far from the border a sample has to sit, in screen pixels — READ OFF
 * THE SHIPPED SPEC for the zoom being measured, never a constant.
 *
 * The rise is a silhouette displaced by `offsetPx` and blurred at `blurPx`,
 * so it reaches `offsetPx + 3σ` from the border and no further; the mask's
 * own feather reaches `3 × featherPx`. A point closer than that may
 * legitimately differ from an effect-off frame, and including one would be
 * measuring the edge while claiming to measure the interior.
 *
 * Taking it from `extrusionSpecForZoom` rather than pinning a number is what
 * keeps the exclusion honest as the spec is tuned. The distance used is
 * printed on every frame.
 *
 * **The numbers, corrected 2026-08-17 (item 8a).** This comment used to say
 * "64 px at neighbourhood zoom falls to 35 px at continental zoom". Those are
 * the `offsetPx + 3·blurPx` values — the exclusion is what comes out AFTER the
 * `max` and the `+ 6` slack, so it is **70 px at neighbourhood zoom (10+) and
 * 41 px at continental (3–4)**, via 51 px at zoom 6 and 61 px at zoom 8. The
 * code was always right; the sentence describing it was off by the slack it
 * adds, and g5's report named no exclusion at all — which is how a tolerance
 * gets loosened until it proves nothing.
 */
function borderExclusionPx(zoom: number): number {
  const spec = extrusionSpecForZoom(zoom);
  return Math.ceil(
    Math.max(spec.offsetPx + 3 * spec.blurPx, 3 * spec.featherPx) + 6,
  );
}

/**
 * How close an interior sample must be to the effect-off frame.
 *
 * In luminance units, over a 17 × 17 patch. Not zero: the basemap re-rasters
 * labels between two screenshots and antialiasing moves by a fraction of a
 * unit. Anything the mute does is an order of magnitude larger — the dark
 * theme's scrim alone moves a mid-grey by about ten.
 */
const INTERIOR_TOLERANCE = 2.5;

/** How much the effect must move an exterior sample, in luminance units. */
const EXTERIOR_MARGIN = 4;

/**
 * The same requirement in CHROMA units, for the theme whose mute is chromatic
 * (G10 item 8a, 2026-08-18).
 *
 * ## The instrument was measuring the wrong quantity, and only in one theme
 *
 * This check asked whether the effect moved an exterior sample's LUMINANCE by
 * `EXTERIOR_MARGIN`. In light theme it does, enormously — Δ46.78 at every
 * sampled point. In dark theme it barely moves luminance at all (Δ2.01) while
 * dropping CHROMA from 13.0 to 7.0, which is the same desaturation light theme
 * performs (13.0 → 8.0). The mute is doing its job in both; the ruler only had
 * markings for one of them.
 *
 * So every dark-theme exterior check failed — four of them, at 85701/state,
 * 85701/regional, 03255/state and 03255/regional — against a build whose map
 * effect the author has ACCEPTED and which this row explicitly does not change.
 * The failures were the instrument's, and they had never been seen before
 * because g5's report contained no themes at all, which is the omission item 8a
 * exists to correct. A measurement that cannot pass on a correct build is the
 * thing that gets its tolerance loosened until it proves nothing; the script's
 * own header says so about the interior family. The fix is to measure the other
 * axis, not to lower the bar on this one.
 *
 * A sample must now move measurably in luminance OR in chroma. Both thresholds
 * stay where they were — nothing is loosened — and a point the effect does not
 * touch still fails, because it moves in neither.
 */
const EXTERIOR_CHROMA_MARGIN = 4;

/**
 * Places, not pixels.
 *
 * Every sample is a real lng/lat run through the live map's own projection,
 * so the check moves with the camera and asks about the same GROUND at every
 * zoom. The interior lists deliberately lead with somewhere far from the
 * entered zip: the shipped defect was invisible to any check that sampled
 * near the centre, because near the centre there is nothing to compare.
 */
interface Place {
  name: string;
  lng: number;
  lat: number;
}

const INTERIOR: Record<string, Place[]> = {
  "85701": [
    { name: "north Tucson", lng: -110.98, lat: 32.3 },
    { name: "Drexel Heights", lng: -111.05, lat: 32.13 },
    { name: "Vail", lng: -110.71, lat: 32.05 },
    { name: "Marana", lng: -111.22, lat: 32.44 },
    { name: "Phoenix", lng: -112.07, lat: 33.45 },
    { name: "Flagstaff", lng: -111.65, lat: 35.2 },
    { name: "Yuma", lng: -114.62, lat: 32.69 },
    { name: "Page", lng: -111.46, lat: 36.91 },
    { name: "Douglas", lng: -109.55, lat: 31.35 },
    { name: "Show Low", lng: -110.03, lat: 34.25 },
  ],
  "03255": [
    { name: "Newbury", lng: -72.03, lat: 43.32 },
    { name: "New London", lng: -71.98, lat: 43.41 },
    { name: "Sunapee", lng: -72.09, lat: 43.39 },
    { name: "Bradford", lng: -71.96, lat: 43.27 },
    { name: "Warner", lng: -71.82, lat: 43.28 },
    { name: "Andover", lng: -71.81, lat: 43.44 },
    { name: "Concord", lng: -71.54, lat: 43.21 },
    { name: "Laconia", lng: -71.47, lat: 43.53 },
    { name: "Plymouth", lng: -71.69, lat: 43.76 },
    { name: "Nashua", lng: -71.47, lat: 42.76 },
    { name: "Berlin", lng: -71.19, lat: 44.47 },
    { name: "Colebrook", lng: -71.5, lat: 44.89 },
    { name: "Keene", lng: -72.28, lat: 42.93 },
    { name: "Portsmouth", lng: -70.76, lat: 43.07 },
  ],
};

/**
 * The state's own middle, for the frames where nothing can sit far enough
 * inside the border to be sampled as interior.
 *
 * New Hampshire is about 100 km across; at continental zoom that is fewer
 * screen pixels than the rise's own reach, so the whole state IS edge and
 * there is no interior to measure. Reporting "could not run" and stopping
 * would leave the small state unchecked at exactly the zooms where the
 * shipped defect was hardest to see, so those frames fall back to a claim
 * that IS measurable at any size: the state's middle must be far less changed
 * by the effect than the land outside it.
 */
const MIDDLE: Record<string, Place> = {
  "85701": { name: "middle of Arizona", lng: -111.7, lat: 34.3 },
  "03255": { name: "middle of New Hampshire", lng: -71.6, lat: 43.7 },
};

/**
 * Exterior places at several distances, deliberately.
 *
 * The exclusion is in SCREEN pixels, so which of these qualify changes with
 * zoom: a town just over the line is far enough out at neighbourhood zoom and
 * inside the rise's own reach at continental zoom. Listing near, middling and
 * distant places lets every frame find something to sample rather than
 * reporting that no neighbour was in view — which, at continental zoom over
 * New Hampshire, would have been false.
 */
const EXTERIOR: Record<string, Place[]> = {
  "85701": [
    { name: "Lordsburg NM", lng: -108.71, lat: 32.35 },
    { name: "Las Cruces NM", lng: -106.78, lat: 32.32 },
    { name: "El Centro CA", lng: -115.56, lat: 32.79 },
    { name: "St George UT", lng: -113.58, lat: 37.1 },
    { name: "Las Vegas NV", lng: -115.14, lat: 36.17 },
    { name: "Hermosillo MX", lng: -110.96, lat: 29.07 },
    { name: "Bakersfield CA", lng: -119.02, lat: 35.37 },
    { name: "Grand Junction CO", lng: -108.55, lat: 39.06 },
    { name: "Amarillo TX", lng: -101.83, lat: 35.22 },
  ],
  "03255": [
    { name: "Montpelier VT", lng: -72.58, lat: 44.26 },
    { name: "Rutland VT", lng: -72.97, lat: 43.61 },
    { name: "Lowell MA", lng: -71.32, lat: 42.63 },
    { name: "Portland ME", lng: -70.26, lat: 43.66 },
    { name: "Bethel ME", lng: -70.79, lat: 44.4 },
    { name: "Albany NY", lng: -73.75, lat: 42.65 },
    { name: "Syracuse NY", lng: -76.15, lat: 43.05 },
    { name: "Hartford CT", lng: -72.68, lat: 41.76 },
    { name: "Montreal QC", lng: -73.55, lat: 45.5 },
    { name: "Bangor ME", lng: -68.79, lat: 44.8 },
  ],
};

/* --------------------------------------------------------- the report --- */

let failures = 0;
let checks = 0;
const cannotRunNotes: string[] = [];

function check(name: string, ok: boolean, evidence: string) {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}\n          ${evidence}`);
}

/* ------------------------------------------------------- the sampling --- */

interface Sampled {
  name: string;
  /** Canvas pixels, which is what the screenshot is measured in. */
  x: number;
  y: number;
  onScreen: boolean;
  /** The top element at that page point is the map's own canvas. */
  unobscured: boolean;
  insideState: boolean;
  /** Screen-pixel distance to the nearest point on the active state's border. */
  borderDistance: number;
}

/**
 * Project every candidate place through the live map and report what is
 * actually sampleable: on screen, not under a card, and how far from the
 * border it sits.
 *
 * All of the geometry runs in the page because only the page has the
 * projection and the DOM. No inner named functions — `tsx` compiles those
 * into a call to esbuild's `__name` helper, which does not exist in a browser
 * and takes the whole evaluate with it.
 */
async function sampleGeometry(page: Page, places: Place[]): Promise<Sampled[]> {
  return page.evaluate(async (input: Place[]) => {
    const w = window as unknown as {
      __wtpProject?: (p: [number, number]) => { x: number; y: number };
      __wtpMapProbe?: () => { focusOcdId: string | null };
    };
    const project = w.__wtpProject;
    const probe = w.__wtpMapProbe?.();
    const canvas = document.querySelector("canvas.maplibregl-canvas") as HTMLCanvasElement | null;
    if (!project || !canvas) return [];
    const box = canvas.getBoundingClientRect();

    // The active state's rings, projected once for the whole batch.
    const rings: { x: number; y: number }[][] = [];
    if (probe?.focusOcdId) {
      const response = await fetch("/geo/state-outlines.geojson");
      const data = (await response.json()) as {
        features: {
          properties: { ocdId: string };
          geometry: { coordinates: number[][][] };
        }[];
      };
      const feature = data.features.find((f) => f.properties.ocdId === probe.focusOcdId);
      if (feature) {
        for (const ring of feature.geometry.coordinates) {
          const projected: { x: number; y: number }[] = [];
          for (const c of ring) projected.push(project([c[0], c[1]]));
          rings.push(projected);
        }
      }
    }

    const out: Sampled[] = [];
    for (const place of input) {
      const point = project([place.lng, place.lat]);
      const pageX = box.left + point.x;
      const pageY = box.top + point.y;
      const onScreen =
        point.x >= 12 && point.y >= 12 && point.x <= box.width - 12 && point.y <= box.height - 12;
      let unobscured = false;
      if (onScreen) {
        const top = document.elementFromPoint(pageX, pageY);
        unobscured = top instanceof HTMLCanvasElement && top.classList.contains("maplibregl-canvas");
      }

      // Even-odd ray casting over the projected rings, plus the distance to
      // the nearest segment. Both inline, both over screen coordinates.
      let inside = false;
      let best = Infinity;
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const a = ring[i];
          const b = ring[j];
          if (
            a.y > point.y !== b.y > point.y &&
            point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
          ) {
            inside = !inside;
          }
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const lengthSquared = dx * dx + dy * dy;
          let t = 0;
          if (lengthSquared > 0) {
            t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
          }
          const cx = a.x + t * dx;
          const cy = a.y + t * dy;
          const distance = Math.hypot(point.x - cx, point.y - cy);
          if (distance < best) best = distance;
        }
      }

      out.push({
        name: place.name,
        x: Math.round(point.x),
        y: Math.round(point.y),
        onScreen,
        unobscured,
        insideState: inside,
        borderDistance: best,
      });
    }
    return out;
  }, places);
}

/** The map canvas, with the effect on and with it disabled. */
async function framePair(
  page: Page,
  label: string,
): Promise<{ on: DecodedPng; off: DecodedPng }> {
  const canvas = page.locator("canvas.maplibregl-canvas");
  const on = decodePng(await canvas.screenshot({ path: join(OUT, `${label}-on.png`) }));
  await page.evaluate(() => {
    const el = document.querySelector(".state-focus-layer") as HTMLElement | null;
    if (el) el.style.visibility = "hidden";
  });
  await page.waitForTimeout(500);
  const off = decodePng(await canvas.screenshot({ path: join(OUT, `${label}-off.png`) }));
  await page.evaluate(() => {
    const el = document.querySelector(".state-focus-layer") as HTMLElement | null;
    if (el) el.style.visibility = "";
  });
  await page.waitForTimeout(400);
  return { on, off };
}

/* ------------------------------------------------------------ the run --- */

const browser = await launchGuarded({ label: "measure-focus" });
const ZOOMS: [string, number][] = [
  ["city", 0],
  ["state", 4],
  ["regional", 6],
];

const ONLY_THEMES = (process.env.FOCUS_THEMES ?? "dark,light").split(",");
const ONLY_ZIPS = (process.env.FOCUS_ZIPS ?? "85701,03255").split(",");
for (const theme of ["dark", "light"] as const) {
  if (!ONLY_THEMES.includes(theme)) continue;
  for (const zip of ["85701", "03255"] as const) {
    if (!ONLY_ZIPS.includes(zip)) continue;
    const context = await browser.context({
    // C05: this run is ours, declared at write time.
    extraHTTPHeaders: RUN_HEADERS,
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      colorScheme: theme,
    });
    /** Every geometry request the page makes, for the data-scoping family. */
    const requested: string[] = [];
    await context.addInitScript(
      ({ zip, theme }) => {
        try {
          sessionStorage.setItem(
            "wtp.approximate_location",
            JSON.stringify({ zip, savedAt: new Date().toISOString() }),
          );
          localStorage.setItem("wtp.tutorial_seen", "1");
          localStorage.setItem("wtp.theme", theme);
        } catch {
          /* the pass still runs; the theme falls back to the media query */
        }
      },
      { zip, theme },
    );
    /*
     * BYTES, not only request counts (G10 item 8a, 2026-08-18).
     *
     * The row asks for "bytes and layer counts held per active state", and the
     * data-scoping family was answering only the second half: it counted
     * geometry REQUESTS and asserted none of them named a foreign state. That
     * catches a wrong state's file being fetched; it says nothing about how
     * much geometry an active state actually costs, which is the number the
     * row wants and the one a later session would need to notice growth.
     *
     * Measured off the response, not the request, and summed per active state.
     * A response that never arrives contributes nothing rather than a guessed
     * size, and the count of unsized responses is printed beside the total so a
     * partial figure can never read as a complete one.
     */
    let geometryBytes = 0;
    let unsizedResponses = 0;
    const page = await context.newPage();
    page.on("request", (r) => {
      const url = r.url();
      if (/\.geojson(\?|$)/.test(url) || url.includes("/api/zcta/")) requested.push(url);
    });
    page.on("response", async (r) => {
      const url = r.url();
      if (!/\.geojson(\?|$)/.test(url) && !url.includes("/api/zcta/")) return;
      try {
        const header = r.headers()["content-length"];
        if (header) {
          geometryBytes += Number(header);
          return;
        }
        geometryBytes += (await r.body()).byteLength;
      } catch {
        // The body was gone by the time it was asked for — counted as unsized
        // rather than skipped silently, so the total states its own denominator.
        unsizedResponses += 1;
      }
    });
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(12_000);

    // Minimize the who-governs card so the map is what is sampled. Points
    // under a card are skipped anyway, but a minimized card leaves far more
    // of the state reachable.
    const minimize = page.locator('.coverage-notice button[aria-label^="Minimize"]');
    if (await minimize.count()) {
      await minimize.first().click().catch(() => {});
      await page.waitForTimeout(800);
    }

    let zoomedOut = 0;
    for (const [zoomLabel, zoomOut] of ZOOMS) {
      if (zoomOut !== zoomedOut) {
        await page.evaluate(
          (by) =>
            (window as unknown as { __wtpZoomOut?: (n?: number) => void }).__wtpZoomOut?.(by),
          zoomOut - zoomedOut,
        );
        zoomedOut = zoomOut;
        await page.waitForTimeout(4500);
      }
      // The card re-expands when a zoom-out resolves a new area.
      if (await minimize.count()) {
        await minimize.first().click().catch(() => {});
        await page.waitForTimeout(700);
      }

      const label = `${theme}-${zip}-${zoomLabel}`;
      const zoom = await page.evaluate(
        () => (window as unknown as { __wtpZoom?: () => number }).__wtpZoom?.() ?? Number.NaN,
      );
      const { on, off } = await framePair(page, label);

      const exclusion = borderExclusionPx(zoom);

      /* --- family 1 and 2: the interior, and equivalence with the effect off --- */
      const interior = await sampleGeometry(page, [...INTERIOR[zip], MIDDLE[zip]]);
      const usable = interior.filter(
        (s) => s.onScreen && s.unobscured && s.insideState && s.borderDistance >= exclusion,
      );
      if (usable.length === 0) {
        /*
         * No point in the state sits `exclusion` pixels inside its own border
         * — the state is smaller on screen than the rise reaches, so all of
         * it is edge. The interior claim is genuinely unmeasurable here, and
         * the fallback below is what IS measurable: the middle must be far
         * less changed than the outside.
         */
        // Whatever inside the state IS reachable, furthest from the border.
        // Not the nominal middle: at continental zoom the whole state can sit
        // under a card or a pin, and a sample taken on top of a card would
        // read Δ0 for the wrong reason and pass a broken build.
        const middle = interior
          .filter((s) => s.onScreen && s.unobscured && s.insideState)
          .sort((a, b) => b.borderDistance - a.borderDistance)[0];
        const away = (await sampleGeometry(page, EXTERIOR[zip])).filter(
          (s) => s.onScreen && s.unobscured && !s.insideState && s.borderDistance >= exclusion,
        );
        /*
         * The mask's OWN reach, which is the distance that decides whether a
         * point can be crisp at all: the feathered edge ramps over three
         * sigma from the border inward, and a sample inside that ramp is in
         * the transition by construction. A point closer than this is not
         * evidence of a muted interior — it is evidence that the state has no
         * interior at this zoom, which is a different sentence and must not
         * be reported as the first one.
         */
        const maskReach = Math.ceil(3 * extrusionSpecForZoom(zoom).featherPx);
        if (middle && middle.borderDistance < maskReach) {
          cannotRunNotes.push(
            `${label}: the most central reachable point (${middle.name}) is only ` +
              `${Math.round(middle.borderDistance)}px inside the border, within the mask's own ` +
              `${maskReach}px ramp — this state has no interior at this zoom`,
          );
          console.log(
            `  ....  ${label} interior — could not run (nothing outside the mask's ${maskReach}px ramp)`,
          );
          // The ZOOM loop moves on; the context stays open, because the
          // per-zip data-scoping checks below still have to run against it.
          // Closing it here killed the pass with "target page has been
          // closed" — a harness that reports a real finding and then crashes
          // before the rest of its checks is a harness that hides them.
        } else if (!middle || away.length === 0) {
          cannotRunNotes.push(
            `${label}: nothing ${exclusion}px inside the border and no exterior sample to contrast it against`,
          );
          console.log(`  ....  ${label} interior — could not run`);
        } else {
          const middleDelta = Math.abs(
            patchStats(on, middle.x, middle.y, 6).luma - patchStats(off, middle.x, middle.y, 6).luma,
          );
          let outsideDelta = Infinity;
          for (const s of away) {
            outsideDelta = Math.min(
              outsideDelta,
              Math.abs(patchStats(on, s.x, s.y, 8).luma - patchStats(off, s.x, s.y, 8).luma),
            );
          }
          check(
            `${label} @z${zoom.toFixed(1)}: the state is smaller than the rise reaches, and its middle is still the crisp part`,
            middleDelta * 2 < outsideDelta,
            `${middle.name} at ${Math.round(middle.borderDistance)}px inside: Δ${middleDelta.toFixed(2)} vs weakest outside Δ${outsideDelta.toFixed(2)} (mask ramp ${maskReach}px, exclusion ${exclusion}px)`,
          );
        }
      } else {
        let worst = 0;
        let worstName = "";
        const detail: string[] = [];
        for (const s of usable) {
          const a = patchStats(on, s.x, s.y, 8);
          const b = patchStats(off, s.x, s.y, 8);
          const delta = Math.abs(a.luma - b.luma);
          detail.push(`${s.name} Δ${delta.toFixed(2)} (${Math.round(s.borderDistance)}px in)`);
          if (delta > worst) {
            worst = delta;
            worstName = s.name;
          }
        }
        check(
          `${label} @z${zoom.toFixed(1)}: the active state's interior is untouched`,
          worst <= INTERIOR_TOLERANCE,
          `${usable.length} sample(s) ≥${exclusion}px inside, worst ${worstName} Δ${worst.toFixed(2)} ≤ ${INTERIOR_TOLERANCE}; ${detail.join(", ")}`,
        );
      }

      /* --- family 3: the exterior must actually be muted --- */
      const exterior = await sampleGeometry(page, EXTERIOR[zip]);
      const outside = exterior.filter(
        (s) => s.onScreen && s.unobscured && !s.insideState && s.borderDistance >= exclusion,
      );
      if (outside.length === 0) {
        console.log(
          `  ....  ${label} exterior — no neighbouring state in view at this zoom (not a failure)`,
        );
      } else {
        // The weakest sample is the one whose STRONGER axis is smallest: a
        // point the effect touched on either axis is a point it touched, and
        // the check is looking for one it missed entirely.
        let weakest = Infinity;
        let weakestName = "";
        let weakestAxis = "";
        const detail: string[] = [];
        for (const s of outside) {
          const a = patchStats(on, s.x, s.y, 8);
          const b = patchStats(off, s.x, s.y, 8);
          const dLuma = Math.abs(a.luma - b.luma);
          const dChroma = Math.abs(a.chroma - b.chroma);
          // Each axis scored against its own threshold, then the better of the
          // two taken — so neither margin is relaxed by the presence of the
          // other, and a 1.0 that has to clear 4 cannot be rescued by a 1.0
          // that has to clear 4 on the other axis.
          const lumaScore = dLuma / EXTERIOR_MARGIN;
          const chromaScore = dChroma / EXTERIOR_CHROMA_MARGIN;
          const best = Math.max(lumaScore, chromaScore);
          detail.push(
            `${s.name} Δluma ${dLuma.toFixed(2)} Δchroma ${dChroma.toFixed(2)} ` +
              `(chroma ${a.chroma.toFixed(1)}→ from ${b.chroma.toFixed(1)})`,
          );
          if (best < weakest) {
            weakest = best;
            weakestName = s.name;
            weakestAxis = lumaScore >= chromaScore ? "luminance" : "chroma";
          }
        }
        check(
          `${label} @z${zoom.toFixed(1)}: land outside the active state is muted`,
          weakest >= 1,
          `${outside.length} sample(s), weakest ${weakestName} at ${(weakest * 100).toFixed(0)}% ` +
            `of its ${weakestAxis} threshold (luma ≥${EXTERIOR_MARGIN}, chroma ≥${EXTERIOR_CHROMA_MARGIN}); ` +
            detail.join(", "),
        );
      }
    }

    /* --- family 4: only the active state's geometry is fetched or held --- */
    const probe = (await page.evaluate(
      () =>
        (
          window as unknown as {
            __wtpMapProbe?: () => {
              districtLayers: string[];
              districtFilterStates: (string | null)[];
              customSources: string[];
            };
          }
        ).__wtpMapProbe?.() ?? null,
    )) as {
      districtLayers: string[];
      districtFilterStates: (string | null)[];
      customSources: string[];
    } | null;

    /*
     * ── RULING 67: THE STATE COMES FROM THE ZIP, NOT FROM A DEFAULT ────────
     * (NJ Hunt 2, 2026-08-22.)
     *
     * This was `zip === "85701" ? "04" : "33"`. Every zip that is not Tucson
     * was New Hampshire — so run against 07866 the check "no other state's
     * geometry is fetched" would have treated New Jersey's own `-34` layers as
     * foreign and New Hampshire's as native, and reported a failure on a
     * correct map, or a pass on a wrong one.
     *
     * It is the same defect as `zip:universe` enumerating New Hampshire for a
     * New Jersey zip, one layer up: a geography assumption written as a default
     * rather than derived from the thing being measured. The resolver reads
     * TIGER's state outlines and is corroborated by the Department of
     * Education's LEA directory.
     */
    const geo = resolveZipGeography(zip);
    if (!geo.ok) {
      throw new Error(
        `${theme}/${zip}: the focus measurement cannot say which state's geometry is native here — ` +
          `${geo.reason}: ${geo.detail}`,
      );
    }
    const mine = geo.stateFips;
    const foreignFips = COVERED_FIPS.filter((f) => f !== mine);
    const foreignFiles = requested.filter((url) =>
      foreignFips.some((fips) => url.includes(`-${fips}.geojson`)),
    );
    check(
      `${theme}/${zip}: no other state's geometry is fetched`,
      foreignFiles.length === 0,
      foreignFiles.length === 0
        ? `${requested.length} geometry request(s), all national or -${mine}; ` +
          `${(geometryBytes / 1024).toFixed(1)} KB fetched` +
          (unsizedResponses > 0 ? ` (+${unsizedResponses} response(s) unsized)` : "")
        : foreignFiles.join(", "),
    );
    const wantAbbr = geo.stateAbbr;
    const foreignFilters = (probe?.districtFilterStates ?? []).filter(
      (abbr) => abbr !== null && abbr !== wantAbbr,
    );
    check(
      `${theme}/${zip}: no other state's district layers are on the map`,
      foreignFilters.length === 0,
      `${probe?.districtLayers.length ?? 0} layer(s), filters ${JSON.stringify(
        probe?.districtFilterStates ?? [],
      )}`,
    );
    check(
      `${theme}/${zip}: the zip draws nothing on the map`,
      !(probe?.customSources ?? []).some((id) => id.includes("zip-shade")) &&
        !requested.some((url) => url.includes("/api/zcta/")),
      `sources ${JSON.stringify(probe?.customSources ?? [])}`,
    );

    await context.close();
  }
}

/* --- family 5: no active state means no treatment at all --- */
for (const [label, zip] of [
  ["no-zip", null],
  ["uncovered-06716", "06716"],
] as const) {
  const context = await browser.context({
    // C05: this run is ours, declared at write time.
    extraHTTPHeaders: RUN_HEADERS,
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: "dark",
  });
  await context.addInitScript(
    ({ zip }) => {
      try {
        localStorage.setItem("wtp.tutorial_seen", "1");
        localStorage.setItem("wtp.theme", "dark");
        if (zip) {
          sessionStorage.setItem(
            "wtp.approximate_location",
            JSON.stringify({ zip, savedAt: new Date().toISOString() }),
          );
        }
      } catch {
        /* the pass still runs */
      }
    },
    { zip },
  );
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(12_000);
  // With no zip the welcome overlay owns the screen; dismissing it is not
  // this check's business, so the map is sampled underneath it at points the
  // overlay does not cover. The canvas screenshot is the canvas alone.
  const { on, off } = await framePair(page, `noactive-${label}`);

  const grid: [number, number][] = [];
  for (let x = 60; x < on.width - 60; x += Math.floor((on.width - 120) / 6)) {
    for (let y = 60; y < on.height - 60; y += Math.floor((on.height - 120) / 5)) {
      grid.push([x, y]);
    }
  }
  let worst = 0;
  for (const [x, y] of grid) {
    const a = patchStats(on, x, y, 8);
    const b = patchStats(off, x, y, 8);
    worst = Math.max(worst, Math.abs(a.luma - b.luma));
  }
  const probe = await page.evaluate(
    () =>
      (window as unknown as { __wtpMapProbe?: () => { focusOcdId: string | null } }).__wtpMapProbe?.() ??
      null,
  );
  check(
    `${label}: no active state means nothing is muted, blurred or raised`,
    worst <= INTERIOR_TOLERANCE && !probe?.focusOcdId,
    `focus ${probe?.focusOcdId ?? "none"}, worst of ${grid.length} points Δ${worst.toFixed(2)} ≤ ${INTERIOR_TOLERANCE}`,
  );
  await context.close();
}

await browser.close();

console.log(
  `\nmeasure:focus — ${BASE}\n${checks} check(s), ${failures} failure(s), ${cannotRunNotes.length} could not run`,
);
for (const note of cannotRunNotes) console.log(`  could not run: ${note}`);
console.log(`frames → ${OUT}`);
process.exit(failures > 0 ? 1 : 0);
