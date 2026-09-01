/**
 * `pnpm measure:flyin` — WHAT THE FLY-IN COSTS, MEASURED BEFORE IT IS CHANGED.
 *
 * ## Its relationship to `pnpm measure:fly`, which is NOT the same instrument
 *
 * `scripts/measure-fly.mts` answers **how fast the page arrives and how
 * smoothly it flies** — first paint, largest paint, map ready, and a
 * descriptive count of slow frames. It is a scoreboard, and it stays the
 * scoreboard.
 *
 * This answers a different question: **WHY.** It attributes the flight's cost
 * to named causes — map events, `queryRenderedFeatures` calls and their
 * main-thread milliseconds, React commits into the overlay, overlay vertex
 * counts, network requests — and it can subtract one suspect at a time
 * (`--isolate`) or hand back a CPU profile (`--profile`). A scoreboard cannot
 * name a cause, and an attribution tool has no business being the scoreboard.
 *
 * ## It inherits `measure-fly`'s ruling about thresholds, and that matters
 *
 * That file used to assert a 32 ms frame budget. The author RETIRED it, in as
 * many words: the absolute *"was invented rather than measured"*, it was missed
 * before and after a real fix, *"on a software-rasterized CI runner whose
 * numbers are not a reader's"*, and **"a check asserting against a made-up
 * threshold is worse than no check — it teaches everyone that red means
 * nothing."**
 *
 * Everything below obeys that. Frame rates here are measured, printed, and
 * compared against a control taken seconds earlier on the same host — never
 * asserted against a number somebody chose. The permanent check this work adds
 * to `pnpm walk:all` gates on a COUNT for the same reason.
 *
 * ## What this exists to answer
 *
 * Entering a zip flies the camera from the continent to the reader's town:
 * `map.flyTo({ ..., duration: 2600, curve: 1.5 })` in
 * `components/map/map-canvas.tsx`. This instrument answers four questions about
 * those 2.6 seconds, and it answers them with numbers rather than with an
 * impression:
 *
 * 1. **Frames per second, sustained** — not the mean. A mean of 58 with one
 *    400 ms stall reads as a smooth flight and is not one, so the headline is
 *    the fps implied by the 95th-percentile frame interval: the rate 95% of
 *    frames beat.
 * 2. **Overlay vertex counts at flight start** — every GeoJSON source the map
 *    holds, plus the SVG the state-focus overlay has drawn.
 * 3. **Network requests during the flight**, split into basemap tiles, overlay
 *    geometry and everything else.
 * 4. **React commits into the overlay subtree during the flight**, counted off
 *    a `MutationObserver`: a React render that changes nothing is invisible and
 *    also free, and a render that rewrites a multi-thousand-point `d` attribute
 *    on every frame is exactly what this is looking for.
 *
 * ## Two walls, named rather than absorbed
 *
 * **NO `NEXT_PUBLIC_MAPTILER_KEY` HERE.** `resolveBasemap` returns null, the
 * map falls through to `FALLBACK_STYLE` — plain ground colour — and the reader
 * is told "Basemap unavailable". So **the basemap-tile count is structurally
 * zero on this machine and proves nothing about a keyed deploy**, and the
 * per-frame GPU load is LOWER than a reader's. Every fps number this prints is
 * therefore an UPPER BOUND on the same build with a basemap under it. It is
 * still the right instrument for what is being fixed: the cost this measures is
 * the overlay's projection pass and its React commit, which are the same work
 * whether or not tiles are drawing beneath them.
 *
 * **HEADLESS CHROMIUM RASTERISES WEBGL IN SOFTWARE.** So the control run below
 * is not decoration: it measures the same frame clock on the same page with the
 * camera standing still, which is what makes a flight number readable at all.
 * A control that is not itself near 60 fps means the harness cannot see 60 fps
 * and the flight number must be read against the control rather than against
 * 60.
 *
 * ## Why the flight is issued to the live map rather than typed as a zip
 *
 * `window.__wtpMap` is the component's own instance, and the options below are
 * copied from the call site character for character. Typing a zip would also
 * fire the meetings fetch and the sidebar's own renders, which belong to a
 * different question; this isolates the camera animation and the overlays that
 * follow it. Both walks start from `CONUS_BOUNDS`, which is where a reader with
 * no remembered camera actually starts.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "playwright";

import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { launchGuarded, type GuardedBrowser } from "./browser.mts";

const BASE = process.env.SHOOT_BASE_URL ?? "http://127.0.0.1:3000";
const ZIP = process.env.FLYIN_ZIP ?? "85701";

/**
 * **PLAYWRIGHT'S DEFAULT CHROMIUM CANNOT SEE 60 FPS, AND THAT WAS MEASURED
 * BEFORE ANY PRODUCT CODE WAS TOUCHED.**
 *
 * The first isolation pass flew the camera with every district layer removed,
 * every marker removed and the whole state-focus layer hidden — a MapLibre map
 * drawing one flat ground colour and nothing else — and it still sustained
 * 8.1 fps with a 23.9 fps median. Nothing was left in that page to blame.
 * `WEBGL_debug_renderer_info` named the culprit outright:
 *
 * ```
 * ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)
 * ```
 *
 * Playwright launches with `--enable-unsafe-swiftshader`, so every WebGL pixel
 * was being rasterised on the CPU. A 1280x900 canvas repainting on every frame
 * of a fly-to is more than that can do, and an fps number taken through it is a
 * fact about SwiftShader rather than about this product.
 *
 * **A HEADED WINDOW IS NOT THE WAY PAST IT HERE.** `headless: false` fails with
 * `spawn UNKNOWN` in this environment — there is no interactive desktop session
 * for the run to open a window on. That is a wall and it is named rather than
 * worked around by lowering the question.
 *
 * The way through is these flags, which keep the run headless and put it on the
 * real adapter. Verified, not assumed — the renderer string is read back on
 * every run and printed, so a run that silently fell back to SwiftShader says
 * so instead of reporting its numbers as if they meant the same thing:
 *
 * ```
 * ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)
 * ```
 */
const GPU_ARGS = [
  "--use-angle=d3d11",
  "--ignore-gpu-blocklist",
  "--enable-gpu-rasterization",
  // SwiftShader arrives through the Vulkan path in this Chromium; without this
  // the ANGLE request above is honoured and then overridden.
  "--disable-features=Vulkan",
];
/** Set to `1` to measure through the software rasteriser on purpose. */
const SOFTWARE = process.env.FLYIN_SOFTWARE === "1";

/** Read the live WebGL renderer back, so no run has to be trusted about it. */
const READ_RENDERER = `(() => {
  const c = document.createElement("canvas");
  const gl = c.getContext("webgl2") || c.getContext("webgl");
  if (!gl) return "NO WEBGL";
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  return dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "UNKNOWN";
})()`;

/** The fly-in's own parameters, copied from `components/map/map-canvas.tsx`. */
export const FLIGHT = {
  /** Downtown Tucson, the 85701 centroid the app flies to. */
  center: [-110.9747, 32.2226] as [number, number],
  /** `initialZoomForZip("85701")` is `METRO_ZOOM`. */
  zoom: 11,
  durationMs: 2600,
  curve: 1.5,
};

/** Where the reader with no remembered camera starts: the continent. */
const CONUS = { center: [-98.5, 39.5] as [number, number], zoom: 3.2 };

/**
 * The page-side probe, as a STRING.
 *
 * A string rather than a function for the reason `scripts/browser.mts` gives
 * for its own init scripts: tsx's esbuild transform rewrites named functions
 * through a `__name` helper the page does not have, and the evaluate throws.
 * There is no regex anywhere in here either — a regex written inside a template
 * loses its escapes, still matches, and shifts its capture groups, which is how
 * a probe comes back reporting nothing found.
 */
const INSTALL_PROBE = `(() => {
  const w = window;
  const probe = {
    frames: [],
    commits: 0,
    records: 0,
    running: false,
  };
  w.__flyProbe = probe;

  /*
   * THE HOT SPOTS, TIMED RATHER THAN SUSPECTED.
   *
   * The first GPU run said the median frame was 59.9 fps and the flight still
   * sustained 18 — so the damage is a small number of long STALLS, not a
   * uniformly slow frame. A stall has a cause with a name, and these wrappers
   * are how the name is obtained instead of argued: every call is counted and
   * timed on the main thread, where the stall is.
   *
   * queryRenderedFeatures is the specific suspect. It is a full-viewport
   * rasterised query across eight district line layers, and
   * components/map/map-canvas.tsx runs it from a sourcedata handler — an event
   * a GeoJSON source fires repeatedly while a fly-to crosses eight zoom levels.
   *
   * NO BACKTICKS BELOW THIS LINE. This whole probe is one template literal, and
   * a backtick in a prose comment inside it closes the template — which is how
   * the first version of this block died in esbuild rather than in the browser.
   */
  const map = w.__wtpMap;
  probe.events = { sourcedata: 0, idle: 0, move: 0, render: 0 };
  probe.qrf = { calls: 0, ms: 0 };
  probe.longTasks = { count: 0, ms: 0 };
  if (map) {
    for (const name of ["sourcedata", "idle", "move", "render"]) {
      map.on(name, () => {
        if (probe.running) probe.events[name] += 1;
      });
    }
    const realQrf = map.queryRenderedFeatures.bind(map);
    map.queryRenderedFeatures = function (...args) {
      if (!probe.running) return realQrf(...args);
      const t0 = performance.now();
      const out = realQrf(...args);
      probe.qrf.calls += 1;
      probe.qrf.ms += performance.now() - t0;
      return out;
    };
  }
  try {
    const po = new PerformanceObserver((list) => {
      if (!probe.running) return;
      for (const entry of list.getEntries()) {
        probe.longTasks.count += 1;
        probe.longTasks.ms += entry.duration;
      }
    });
    po.observe({ entryTypes: ["longtask"] });
  } catch (e) {
    // No longtask support is a gap in the report, not a reason to stop.
    void e;
  }

  const layer = document.querySelector(".state-focus-layer");
  if (layer) {
    const observer = new MutationObserver((list) => {
      if (!probe.running) return;
      probe.commits += 1;
      probe.records += list.length;
    });
    observer.observe(layer, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    probe.observer = observer;
  }

  const tick = () => {
    if (!probe.running) return;
    probe.frames.push(performance.now());
    w.requestAnimationFrame(tick);
  };
  probe.start = () => {
    probe.frames = [];
    probe.commits = 0;
    probe.records = 0;
    probe.events = { sourcedata: 0, idle: 0, move: 0, render: 0 };
    probe.qrf = { calls: 0, ms: 0 };
    probe.longTasks = { count: 0, ms: 0 };
    probe.running = true;
    w.requestAnimationFrame(tick);
  };
  probe.stop = () => {
    probe.running = false;
  };
  return true;
})()`;

/**
 * Vertex counts, read off the live map and the live SVG.
 *
 * The map's answer, not a file's: what matters is the geometry the renderer is
 * actually holding at the moment the camera starts to move, which is a
 * different number from what is on disk once a source has been filtered,
 * swapped or never attached at all.
 */
const READ_VERTICES = `(() => {
  const w = window;
  const countCoords = (node) => {
    if (!Array.isArray(node)) return 0;
    if (node.length > 0 && typeof node[0] === "number") return 1;
    let total = 0;
    for (const child of node) total += countCoords(child);
    return total;
  };

  const sources = [];
  const map = w.__wtpMap;
  if (map && map.getStyle) {
    const style = map.getStyle() || {};
    const entries = Object.entries(style.sources || {});
    for (const [id, source] of entries) {
      if (!source || source.type !== "geojson") continue;
      const data = source.data;
      if (!data || typeof data === "string") {
        sources.push({ id, vertices: null, note: "data is a url, not inline" });
        continue;
      }
      let vertices = 0;
      let features = 0;
      if (data.type === "FeatureCollection") {
        features = (data.features || []).length;
        for (const f of data.features || []) {
          vertices += countCoords((f.geometry || {}).coordinates);
        }
      } else if (data.type === "Feature") {
        features = 1;
        vertices = countCoords((data.geometry || {}).coordinates);
      } else {
        vertices = countCoords(data.coordinates);
      }
      sources.push({ id, features, vertices });
    }
  }

  const paths = [];
  const art = document.querySelector(".state-focus-art");
  if (art) {
    for (const p of Array.from(art.querySelectorAll("path"))) {
      const d = p.getAttribute("d") || "";
      paths.push({ chars: d.length, vertices: d.split(",").length - 1 });
    }
  }

  return {
    sources,
    svgPaths: paths,
    svgVertices: paths.reduce((sum, p) => sum + p.vertices, 0),
    hasOverlay: Boolean(art),
    markers: document.querySelectorAll(".maplibregl-marker").length,
  };
})()`;

export interface FrameStats {
  frames: number;
  windowMs: number;
  meanFps: number;
  /** The rate 95% of frames beat. THE HEADLINE — see the file header. */
  sustainedFps: number;
  medianFps: number;
  worstFrameMs: number;
  longFrames: number;
}

/**
 * Turn a list of frame timestamps into the numbers a reader can act on.
 *
 * **A WINDOW THAT CAPTURED NO FRAMES REFUSES; IT DOES NOT REPORT ZERO.**
 * This returned a zero-filled record, and `0.0 fps sustained` is the single
 * most alarming line this instrument can print — indistinguishable from a
 * genuinely frozen fly-in, and in fact meaning the recorder never started.
 * That is RULING 159's shape applied to a rate: a measurement with no
 * population is not a measurement of zero.
 */
export function frameStats(times: number[]): FrameStats {
  if (times.length < 3) {
    throw new Error(
      `measure-flyin: the frame recorder captured ${times.length} timestamp(s), which is ` +
        "not enough to compute an interval. This is a fact about the recorder, not about " +
        "the fly-in — refusing to report a frame rate rather than printing 0 fps.",
    );
  }
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i += 1) gaps.push(times[i] - times[i - 1]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  const windowMs = times[times.length - 1] - times[0];
  return {
    frames: times.length,
    windowMs,
    meanFps: (gaps.length / windowMs) * 1000,
    sustainedFps: 1000 / at(0.95),
    medianFps: 1000 / at(0.5),
    worstFrameMs: sorted[sorted.length - 1],
    // A frame that took longer than two 60 Hz frames is one a reader can see.
    longFrames: gaps.filter((g) => g > 33.4).length,
  };
}

export interface Requests {
  tiles: number;
  geometry: number;
  other: number;
  hosts: string[];
}

/** Bucket a url the way the report reads it. Exported so a test can walk it. */
export function bucketRequest(url: string): keyof Omit<Requests, "hosts"> {
  const lower = url.toLowerCase();
  if (lower.includes(".pbf") || lower.includes(".mvt") || lower.includes("/tiles/")) return "tiles";
  if (lower.includes("maptiler") || lower.includes("openmaptiles")) return "tiles";
  if (lower.includes(".geojson")) return "geometry";
  return "other";
}

async function openForFlight(browser: GuardedBrowser, zip: string): Promise<Page> {
  /*
   * NO `reducedMotion: "reduce"` — and that is the whole reason this cannot
   * reuse `walk-all`'s `openWideAt`. `prefersReducedMotion()` short-circuits
   * the fly-in to `map.jumpTo`, so a reduced-motion context measures a fly-in
   * that never happens and reports a perfect score for it.
   */
  const context = await browser.context({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
  });
  await context.addInitScript(
    ({ zip: z }: { zip: string }) => {
      try {
        sessionStorage.setItem(
          "wtp.approximate_location",
          JSON.stringify({ zip: z, savedAt: new Date().toISOString() }),
        );
        localStorage.setItem("wtp.tutorial_seen", "1");
      } catch {
        // A browser refusing storage still renders; the read below will say so.
      }
    },
    { zip },
  );
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  return page;
}

/** Wait for the map instance and its first settle. Returns whether it arrived. */
export async function untilMapReady(page: Page, ms = 30_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(
      () => Boolean((window as unknown as { __wtpMap?: unknown }).__wtpMap),
    );
    if (ready) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

interface Run {
  label: string;
  frames: FrameStats;
  commits: number;
  records: number;
  events: Record<string, number>;
  qrf: { calls: number; ms: number };
  longTasks: { count: number; ms: number };
  requests: Requests;
  vertices: unknown;
}

/**
 * ABLATIONS — how a cause is separated from a coincidence.
 *
 * The first run of this instrument said 5.6 fps and could not say WHY, and a
 * fix chosen from a single aggregate number is a guess with a measurement
 * stapled to it. Each ablation removes exactly one suspect from the page and
 * re-flies the identical camera path; what the frame rate does is the suspect's
 * share of the bill.
 *
 * They are DIAGNOSTIC and they run on a live page — nothing here is a fix, and
 * `none` is what the reported before/after numbers are measured under.
 */
const ABLATIONS: Record<string, string> = {
  none: `(() => true)()`,
  /**
   * **THE ONE THAT ADDS SOMETHING BACK: the pre-W6H3 subscription.**
   *
   * A before/after taken from two servers is not a paired measurement on a
   * contended host — and it cannot be retaken, because rebuilding this worktree
   * leaves the old server serving a stale `.next` that 500s its own chunks.
   * (It did exactly that: the old build's port came back with no `__wtpMap` at
   * all once the fix had been built over it.)
   *
   * So the old COST is reproduced on the current build, in the same browser,
   * minutes apart from the fixed one. This re-subscribes the full-viewport
   * query to raw `sourcedata` the way `map-canvas.tsx` used to, with the same
   * eight district line layers.
   *
   * **STATED PLAINLY: this SIMULATES the removed subscription; it does not run
   * the old bundle.** It reproduces the mechanism the measurement is about —
   * one full-viewport `queryRenderedFeatures` per `sourcedata` event — and
   * nothing else about the old build. Read it as a paired control for that one
   * mechanism, never as a rerun of the previous release.
   */
  "legacy-sourcedata": `(() => {
    const map = window.__wtpMap;
    if (!map) return false;
    const style = map.getStyle() || {};
    const layers = (style.layers || [])
      .map((l) => l.id)
      .filter((id) => id.indexOf("district-") === 0 && id.indexOf("-line") > 0);
    if (layers.length === 0) return false;
    map.on("sourcedata", () => {
      try { map.queryRenderedFeatures({ layers: layers }); } catch (e) { void e; }
    });
    return true;
  })()`,
  /** The DOM half of the state focus: the backdrop-filter scrim and its SVG. */
  "no-scrim": `(() => {
    const el = document.querySelector(".state-focus-layer");
    if (el) el.style.display = "none";
    return Boolean(el);
  })()`,
  /** Every district fill and line, and the GeoJSON sources behind them. */
  "no-districts": `(() => {
    const map = window.__wtpMap;
    if (!map) return false;
    const style = map.getStyle() || {};
    let removed = 0;
    for (const layer of (style.layers || []).slice()) {
      if (layer.id.indexOf("district-") !== 0) continue;
      map.removeLayer(layer.id);
      removed += 1;
    }
    for (const id of Object.keys(style.sources || {})) {
      if (id.indexOf("district-") !== 0) continue;
      try { map.removeSource(id); removed += 1; } catch (e) { void e; }
    }
    return removed > 0;
  })()`,
  /**
   * The scrim's `backdrop-filter` ONLY — its SVG art and its React redraw stay.
   *
   * `no-scrim` hides the whole state-focus layer and cannot say which half was
   * expensive. These two split it: this one leaves every path, every filter and
   * every commit in place and removes only the full-viewport backdrop blur.
   */
  "no-backdrop": `(() => {
    const el = document.querySelector(".state-focus-scrim");
    if (!el) return false;
    el.style.backdropFilter = "none";
    el.style.webkitBackdropFilter = "none";
    return true;
  })()`,
  /** The scrim's SVG art ONLY — the masked silhouettes and the mute rect. */
  "no-svg-art": `(() => {
    const el = document.querySelector(".state-focus-art");
    if (!el) return false;
    el.style.display = "none";
    return true;
  })()`,
  /** Every marker element the pin pool holds. */
  "no-markers": `(() => {
    const pins = Array.from(document.querySelectorAll(".maplibregl-marker"));
    for (const pin of pins) pin.style.display = "none";
    return pins.length > 0;
  })()`,
  /**
   * THE FLOOR: the map canvas flying with nothing of ours on top of it.
   *
   * Without this the other ablations cannot be read. A flight that is slow
   * because of a software rasteriser and a flight that is slow because of our
   * overlays produce the same aggregate number, and only the floor tells them
   * apart — if `bare` is still slow, the instrument is measuring the harness.
   */
  bare: `(() => {
    const el = document.querySelector(".state-focus-layer");
    if (el) el.style.display = "none";
    for (const pin of Array.from(document.querySelectorAll(".maplibregl-marker"))) {
      pin.remove();
    }
    const map = window.__wtpMap;
    if (map) {
      const style = map.getStyle() || {};
      for (const layer of (style.layers || []).slice()) {
        if (layer.id.indexOf("district-") !== 0) continue;
        map.removeLayer(layer.id);
      }
      for (const id of Object.keys(style.sources || {})) {
        if (id.indexOf("district-") !== 0) continue;
        try { map.removeSource(id); } catch (e) { void e; }
      }
    }
    return true;
  })()`,
};

async function measure(
  page: Page,
  label: string,
  fly: boolean,
  ablation = "none",
): Promise<Run> {
  const applied = await page.evaluate(ABLATIONS[ablation] ?? ABLATIONS.none);
  if (ablation !== "none" && !applied) {
    console.log(`  ??  ablation "${ablation}" found nothing to remove — the run below is NOT ablated`);
  }
  const seen: string[] = [];
  const onRequest = (r: { url: () => string }) => seen.push(r.url());
  page.on("request", onRequest);

  await page.evaluate(INSTALL_PROBE);
  const vertices = await page.evaluate(READ_VERTICES);

  // Park the camera at the continent, instantly, so both runs start where a
  // reader with no remembered camera starts.
  await page.evaluate(
    ([lng, lat, zoom]) => {
      const map = (window as unknown as { __wtpMap?: { jumpTo: (o: unknown) => void } }).__wtpMap;
      map?.jumpTo({ center: [lng, lat], zoom });
    },
    [CONUS.center[0], CONUS.center[1], CONUS.zoom] as [number, number, number],
  );
  await page.waitForTimeout(600);

  seen.length = 0;
  await page.evaluate(() =>
    (window as unknown as { __flyProbe: { start: () => void } }).__flyProbe.start(),
  );

  if (fly) {
    await page.evaluate(
      ([lng, lat, zoom, duration, curve]) => {
        const map = (window as unknown as { __wtpMap?: { flyTo: (o: unknown) => void } }).__wtpMap;
        map?.flyTo({ center: [lng, lat], zoom, duration, essential: true, curve });
      },
      [FLIGHT.center[0], FLIGHT.center[1], FLIGHT.zoom, FLIGHT.durationMs, FLIGHT.curve] as [
        number,
        number,
        number,
        number,
        number,
      ],
    );
  }

  /* A DURATION, DELIBERATELY: the subject IS a fixed-length animation, and the
   * question is what happened inside it. Waiting for `moveend` would measure a
   * window whose length depends on the very stalls being counted. */
  await page.waitForTimeout(FLIGHT.durationMs + 200);

  /*
   * **DID THE CAMERA ACTUALLY MOVE?** (RULING 159's shape, applied to a rate.)
   *
   * The g3 pin check learned this exact lesson: it reported "zooming out never
   * removes pins — 11 to 11 to 11" while its gesture was landing on an overlay
   * and the map had never moved. A fly-in measurement has the same failure
   * available to it, and it is worse, because a map that never flew renders a
   * beautiful 60 fps. So the zoom is read on both sides of the window and a
   * flight that did not happen REFUSES rather than reports.
   */
  const endZoom = Number(
    await page.evaluate(
      () => (window as unknown as { __wtpZoom?: () => number }).__wtpZoom?.() ?? Number.NaN,
    ),
  );
  const moved = Math.abs(endZoom - CONUS.zoom);
  if (fly && !(moved > 1)) {
    throw new Error(
      `measure-flyin: the camera did not fly. It started at zoom ${CONUS.zoom} and ` +
        `ended at ${endZoom} — every frame number from this window would be a fact ` +
        "about a stationary map.",
    );
  }

  const raw = await page.evaluate(() => {
    const p = (
      window as unknown as {
        __flyProbe: {
          stop: () => void;
          frames: number[];
          commits: number;
          records: number;
          events: Record<string, number>;
          qrf: { calls: number; ms: number };
          longTasks: { count: number; ms: number };
        };
      }
    ).__flyProbe;
    p.stop();
    return {
      frames: p.frames,
      commits: p.commits,
      records: p.records,
      events: p.events,
      qrf: p.qrf,
      longTasks: p.longTasks,
    };
  });
  page.off("request", onRequest);

  const requests: Requests = { tiles: 0, geometry: 0, other: 0, hosts: [] };
  const hosts = new Set<string>();
  for (const url of seen) {
    requests[bucketRequest(url)] += 1;
    try {
      hosts.add(new URL(url).host);
    } catch {
      hosts.add("unparseable");
    }
  }
  requests.hosts = [...hosts];

  return {
    label,
    frames: frameStats(raw.frames),
    commits: raw.commits,
    records: raw.records,
    events: raw.events,
    qrf: raw.qrf,
    longTasks: raw.longTasks,
    requests,
    vertices,
  };
}

function report(run: Run): void {
  const f = run.frames;
  console.log(`\n── ${run.label} ─────────────────────────────`);
  console.log(
    `  frames ${f.frames} over ${Math.round(f.windowMs)}ms — ` +
      `SUSTAINED ${f.sustainedFps.toFixed(1)} fps (p95 interval), ` +
      `median ${f.medianFps.toFixed(1)}, mean ${f.meanFps.toFixed(1)}`,
  );
  /*
   * FLOORED, because "3 slow frames" is not a result on its own (RULING 159).
   * Three slow frames out of 160 is a smooth flight with a hiccup; three out of
   * four is a slideshow, and the sentence is identical without the denominator.
   * `floored` also refuses outright when the window captured no frames at all,
   * which is exactly the case where a rate would otherwise be invented.
   */
  console.log(
    `  ${floorLine(
      floored("frames slower than 33.4ms", "the flight window", f.frames, f.longFrames),
    )} — worst ${f.worstFrameMs.toFixed(1)}ms`,
  );
  console.log(`  overlay React commits ${run.commits} (${run.records} mutation records)`);
  /*
   * THE LOAD-INVARIANT NUMBER, and the one the permanent check gates on.
   *
   * A count of sourcedata events that ran a full-viewport query does not move
   * when six other agents are compiling on the same host. An fps figure does.
   * The denominator is the events themselves, so the line says how much of the
   * burst was absorbed rather than how many calls happened to survive.
   */
  console.log(
    `  ${floorLine(
      floored(
        "sourcedata events that ran a full-viewport query",
        "the flight window",
        run.events.sourcedata,
        Math.min(run.qrf.calls, run.events.sourcedata),
        run.events.sourcedata === 0
          ? "the flight fired no sourcedata events — no source re-tiled"
          : undefined,
      ),
    )} — ${run.qrf.calls} calls costing ${run.qrf.ms.toFixed(0)}ms of main thread`,
  );
  console.log(
    `  requests: ${run.requests.tiles} tile, ${run.requests.geometry} geometry, ` +
      `${run.requests.other} other — hosts ${run.requests.hosts.join(", ") || "none"}`,
  );
  console.log(`  geometry at flight start: ${JSON.stringify(run.vertices)}`);
}

/**
 * One page, settled, with the map instance present.
 *
 * A fresh page per ablation rather than one page ablated repeatedly: removing
 * a source is not reversible, so re-using the page would silently make every
 * later ablation cumulative and every attribution wrong.
 */
async function settledPage(browser: GuardedBrowser): Promise<Page | null> {
  const page = await openForFlight(browser, ZIP);
  if (!(await untilMapReady(page))) {
    await page.context().close();
    return null;
  }
  /* R49 DURATION, DELIBERATE: the overlay draws on an animation frame after
   * its outlines land, and there is no event for "the scrim has drawn". */
  await page.waitForTimeout(2_500);
  return page;
}

/**
 * **ONE RUN OF THIS CANNOT SETTLE ANYTHING ON A BUSY HOST.**
 * (The integration owner's warning, 2026-08-31, and then the measurement that
 * proved it.)
 *
 * Seven worktree lanes were installing, building and testing on this machine
 * while the isolation pass ran, and the numbers say so plainly: `bare` — the
 * map flying with every district layer, every marker and the whole state-focus
 * layer removed — scored 31.7 fps sustained in the same pass where the FULLY
 * LOADED page scored 45.9. Nothing was wrong with either measurement. The p95
 * of ~150 frames is the eighth-worst frame, and one OS scheduling hiccup owns
 * it.
 *
 * Two things follow, and both are done rather than noted:
 *
 * 1. **Repeat and take the median across runs**, so a single hiccup cannot be
 *    the answer.
 * 2. **Read the flight against its own CONTROL, not against 60.** The control
 *    flies nothing, runs seconds before the flight on the same host under the
 *    same load, and so carries that load in its own number. The RATIO is what
 *    survives contention; the absolute fps is what does not.
 */
function medianRun(runs: Run[]): Run {
  const sorted = [...runs].sort((a, b) => a.frames.sustainedFps - b.frames.sustainedFps);
  return sorted[Math.floor(sorted.length / 2)];
}

async function repeated(
  browser: GuardedBrowser,
  label: string,
  fly: boolean,
  ablation: string,
  times: number,
): Promise<Run[]> {
  const runs: Run[] = [];
  for (let i = 0; i < times; i += 1) {
    const page = await settledPage(browser);
    if (!page) {
      console.log(`  ??  "${label}" run ${i + 1} COULD NOT RUN — no __wtpMap on a fresh page`);
      continue;
    }
    runs.push(await measure(page, `${label} (run ${i + 1}/${times})`, fly, ablation));
    await page.context().close();
  }
  return runs;
}

/**
 * **A CPU PROFILE, BECAUSE ABLATION STOPPED CONVERGING.**
 *
 * With seven lanes on the host, the ablation medians disagreed with each other:
 * `bare` — the flight with everything of ours removed — scored 46.9 while the
 * fully loaded flight scored 41.3 and `no-svg-art` scored 48.1. Those gaps are
 * inside the noise, so no further subtraction was going to name the residual.
 *
 * A sampling profile does not have that problem. It attributes MAIN-THREAD
 * TIME to named functions, and a function's share of the flight is a ratio
 * inside one run — a busy host stretches the whole profile rather than
 * reordering it.
 */
async function profileFlight(page: Page): Promise<[string, number][]> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await page.evaluate(
    ([lng, lat, zoom]) => {
      const map = (window as unknown as { __wtpMap?: { jumpTo: (o: unknown) => void } }).__wtpMap;
      map?.jumpTo({ center: [lng, lat], zoom });
    },
    [CONUS.center[0], CONUS.center[1], CONUS.zoom] as [number, number, number],
  );
  await page.waitForTimeout(500);
  await cdp.send("Profiler.start");
  await page.evaluate(
    ([lng, lat, zoom, duration, curve]) => {
      const map = (window as unknown as { __wtpMap?: { flyTo: (o: unknown) => void } }).__wtpMap;
      map?.flyTo({ center: [lng, lat], zoom, duration, essential: true, curve });
    },
    [FLIGHT.center[0], FLIGHT.center[1], FLIGHT.zoom, FLIGHT.durationMs, FLIGHT.curve] as [
      number,
      number,
      number,
      number,
      number,
    ],
  );
  await page.waitForTimeout(FLIGHT.durationMs + 200);
  const { profile } = (await cdp.send("Profiler.stop")) as {
    profile: {
      nodes: { id: number; callFrame: { functionName: string; url: string } }[];
      samples?: number[];
      timeDeltas?: number[];
    };
  };

  const byId = new Map(profile.nodes.map((n) => [n.id, n.callFrame]));
  const selfUs = new Map<string, number>();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  for (let i = 0; i < samples.length; i += 1) {
    const frame = byId.get(samples[i]);
    if (!frame) continue;
    const name = frame.functionName || "(anonymous)";
    const file = (frame.url || "").split("/").pop() ?? "";
    const key = `${name} — ${file}`;
    selfUs.set(key, (selfUs.get(key) ?? 0) + Math.max(0, deltas[i] ?? 0));
  }
  return [...selfUs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
}

async function main(): Promise<void> {
  const isolate = process.argv.includes("--isolate");
  const wantProfile = process.argv.includes("--profile");
  const repeatArg = process.argv.find((a) => a.startsWith("--repeat="));
  const REPEATS = Math.max(1, Number(repeatArg?.split("=")[1] ?? 1) || 1);
  const browser = await launchGuarded({
    label: "measure-flyin",
    args: SOFTWARE ? [] : GPU_ARGS,
  });
  console.log(`run ${browser.runId} against ${BASE} at ${ZIP}`);
  try {
    const page = await settledPage(browser);
    if (!page) {
      console.log("  ??  COULD NOT RUN — no __wtpMap on the page; nothing to fly.");
      return;
    }
    const renderer = String(await page.evaluate(READ_RENDERER));
    console.log(`  webgl renderer: ${renderer}`);
    if (renderer.toLowerCase().includes("swiftshader")) {
      console.log(
        "  ??  THIS RUN IS ON THE SOFTWARE RASTERISER. Every fps number below is a " +
          "fact about SwiftShader, not about this product — see the note on GPU_ARGS.",
      );
    }
    if (wantProfile) {
      console.log("\n── MAIN-THREAD SELF TIME THROUGH ONE FLIGHT (µs) ──────────");
      for (const [name, us] of await profileFlight(page)) {
        console.log(`  ${String(Math.round(us / 1000)).padStart(5)}ms  ${name}`);
      }
    }
    await page.context().close();

    const controls = await repeated(browser, "CONTROL — camera standing still", false, "none", REPEATS);
    const control = medianRun(controls);
    report({ ...control, label: `CONTROL — median of ${controls.length}` });

    const flights = await repeated(browser, "FLIGHT — the 2600ms fly-in", true, "none", REPEATS);
    const flight = medianRun(flights);
    report({ ...flight, label: `FLIGHT — median of ${flights.length}` });

    const held = (flight.frames.sustainedFps / (control.frames.sustainedFps || 1)) * 100;
    console.log(
      `\n  the flight held ${held.toFixed(0)}% of the control's sustained rate ` +
        `(${flight.frames.sustainedFps.toFixed(1)} of ${control.frames.sustainedFps.toFixed(1)} fps, ` +
        `medians of ${flights.length} and ${controls.length} runs on the same host)`,
    );
    console.log(
      `  flight spread across runs: ${flights
        .map((r) => r.frames.sustainedFps.toFixed(1))
        .sort((a, b) => Number(a) - Number(b))
        .join(", ")} fps sustained`,
    );

    const ablated: Run[] = [];
    if (isolate) {
      const onlyArg = process.argv.find((a) => a.startsWith("--only="));
      const only = onlyArg ? onlyArg.split("=")[1].split(",") : null;
      for (const name of Object.keys(ABLATIONS)) {
        if (name === "none") continue;
        if (only && !only.includes(name)) continue;
        const runs = await repeated(browser, `FLIGHT with ${name}`, true, name, REPEATS);
        if (runs.length === 0) continue;
        const med = medianRun(runs);
        report({ ...med, label: `FLIGHT with ${name} — median of ${runs.length}` });
        ablated.push(med);
      }
    }

    writeFileSync(
      join(process.cwd(), "docs", "evidence", "flyin-measurement.json"),
      `${JSON.stringify(
        { base: BASE, zip: ZIP, renderer, repeats: REPEATS, controls, flights, ablated },
        null,
        2,
      )}\n`,
      "utf8",
    );
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && process.argv[1].includes("measure-flyin")) {
  await main();
}
