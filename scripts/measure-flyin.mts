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
import {
  busyPct,
  cpuTicks,
  frameGaps,
  GPU_ARGS,
  hostCondition,
  judgeNormalized,
  LONG_FRAME_MS,
  NORMALIZED_FLOOR,
  READ_RENDERER,
  summariseArm,
  type ArmSummary,
} from "../lib/ops/flyin-normalized.ts";
import { launchGuarded, type GuardedBrowser } from "./browser.mts";

const BASE = process.env.SHOOT_BASE_URL ?? "http://127.0.0.1:3000";
const ZIP = process.env.FLYIN_ZIP ?? "85701";

/**
 * **PLAYWRIGHT'S DEFAULT CHROMIUM CANNOT SEE 60 FPS, AND THAT WAS MEASURED
 * BEFORE ANY PRODUCT CODE WAS TOUCHED.**
 *
 * The first isolation pass flew the camera with every district layer removed,
 * every marker removed and the whole state-focus layer hidden — or so it
 * believed; see the `bare` ablation's own note, because on 2026-08-31 that
 * ablation was found to be healing mid-flight and the district layers were in
 * fact still there. **The CONCLUSION below survives that anyway, and this is
 * why it is worth keeping**: it does not rest on the ablation at all. The
 * renderer string is read directly out of the live context, so it is a fact
 * about the rasteriser no matter what was drawn through it. The 8.1 fps and
 * 23.9 fps figures in this paragraph are the part that is withdrawn.
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
 * The way through is `GPU_ARGS`, which keeps the run headless and puts it on
 * the real adapter. Verified, not assumed — `READ_RENDERER` reads the string
 * back on every run and prints it, so a run that silently fell back to
 * SwiftShader says so instead of reporting its numbers as if they meant the
 * same thing:
 *
 * ```
 * ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)
 * ```
 *
 * Both now live in `lib/ops/flyin-normalized.ts`, because the permanent check
 * in `scripts/walk-all.mts` has to request the SAME adapter — measured on
 * 2026-08-31, the rasteriser is the difference between this product holding
 * 99.7% of a bare map and holding 25.8% of it.
 */
/** Set to `1` to measure through the software rasteriser on purpose. */
const SOFTWARE = process.env.FLYIN_SOFTWARE === "1";

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
  const gaps = frameGaps(times);
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
  /**
   * THE FRAME INTERVALS THEMSELVES, kept rather than only summarised.
   *
   * The host-normalized criterion (below) needs a frame-time DISTRIBUTION per
   * arm, not one number per run, and a distribution cannot be reconstructed
   * from a median after the fact. Keeping the gaps is also what lets a later
   * session re-derive any statistic from the recorded evidence instead of
   * re-running the measurement on a different day's host.
   */
  gaps: number[];
  commits: number;
  records: number;
  events: Record<string, number>;
  qrf: { calls: number; ms: number };
  longTasks: { count: number; ms: number };
  requests: Requests;
  vertices: unknown;
  /** What the host's own CPU counters said across this run's window. */
  hostBusyPct: number | null;
  /**
   * **WHAT WAS ACTUALLY ON THE MAP WHEN THE CAMERA LANDED.**
   *
   * Read on EVERY run, not only the bare one. `--normalized` reads it for the
   * bare arm because a healed bare arm invalidates the ratio; the isolation
   * pass needs it for every row, because a healed `no-districts` row is a fully
   * loaded flight filed under the district layers' name — and the ablation
   * returns a truthful count of things it removed either way. A row that says
   * "24 district layers at landing" cannot be read as that component's cost.
   */
  landingState: {
    districtLayers: number;
    districtSources: number;
    markers: number;
    scrimHidden: boolean;
  };
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
  /**
   * Every district fill, line and label, and the GeoJSON sources behind them.
   *
   * **IT BLOCKS THE RE-ADD BEFORE REMOVING ANYTHING, FOR THE REASON `bare`
   * DOES** (Session C, 2026-09-01). This ablation shipped without that order
   * and therefore carried the identical defect the `bare` note documents at
   * length: `syncDistrictLayer` is idempotent, a removal PROVOKES the next sync
   * pass, and the pass puts every layer and source straight back. The removal
   * never throws and the ablation returns a large truthful count of things it
   * removed, so the failure is invisible — and the row it produces is a fully
   * loaded map wearing the district ablation's name.
   *
   * That matters more here than anywhere else in this list, because "do the
   * district layers dominate?" is one of the questions the isolation pass
   * exists to answer, and a healed ablation answers it with a confident NO.
   */
  "no-districts": `(() => {
    const map = window.__wtpMap;
    if (!map) return false;
    /* THE ORDER IS THE FIX: block first, so the sync pass the removals below
       provoke is a no-op rather than a repair. */
    const realAddSource = map.addSource.bind(map);
    const realAddLayer = map.addLayer.bind(map);
    map.addSource = function (id, spec) {
      if (typeof id === "string" && id.indexOf("district-") === 0) return map;
      return realAddSource(id, spec);
    };
    map.addLayer = function (spec, before) {
      if (spec && typeof spec.id === "string" && spec.id.indexOf("district-") === 0) return map;
      return realAddLayer(spec, before);
    };
    let removed = 0;
    const style = map.getStyle() || {};
    for (const layer of (style.layers || []).slice()) {
      if (layer.id.indexOf("district-") !== 0) continue;
      try { map.removeLayer(layer.id); removed += 1; } catch (e) { void e; }
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
  /**
   * **THE PROPOSED REPAIR, MEASURED BEFORE IT WAS WRITTEN** (Session C,
   * 2026-09-01).
   *
   * Not an ablation of a component — a simulation of the DEGRADATION the
   * software-rasteriser path applies while the camera is moving: the scrim's
   * `backdrop-filter` dropped, and the district fill, line and label layers set
   * to `visibility: none`. Everything else stays: the SVG mute rect, both rise
   * silhouettes, the markers, and every district SOURCE with its geometry still
   * attached, so the layers can come back on `moveend` without re-tiling.
   *
   * It exists because "which component costs most" and "does removing the
   * expensive ones actually clear the bar" are different questions, and the
   * second one is answerable in ten minutes with a page script instead of an
   * afternoon with a component. Kept afterwards as the repair's predicted
   * ceiling: a shipped build measuring materially below this row has a defect
   * in the WIRING rather than in the choice of what to degrade.
   *
   * `visibility` rather than `removeLayer`, deliberately and for the same
   * reason the product does it that way: removing a layer provokes
   * `syncDistrictLayer` to put it back, and removing a SOURCE throws away tiled
   * geometry that then has to be rebuilt at exactly the moment the camera
   * stops.
   */
  "motion-degrade": `(() => {
    const map = window.__wtpMap;
    if (!map) return false;
    const el = document.querySelector(".state-focus-scrim");
    if (el) {
      el.style.backdropFilter = "none";
      el.style.webkitBackdropFilter = "none";
    }
    let hidden = 0;
    const style = map.getStyle() || {};
    for (const layer of (style.layers || []).slice()) {
      if (layer.id.indexOf("district-") !== 0) continue;
      try { map.setLayoutProperty(layer.id, "visibility", "none"); hidden += 1; } catch (e) { void e; }
    }
    return hidden > 0;
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
   *
   * ## **THIS ABLATION USED TO UNDO ITSELF, AND IT SAID NOTHING** (2026-08-31)
   *
   * The version this replaces removed the district layers and sources and then
   * let the application put every one of them straight back. Measured, on a
   * live page, rather than reasoned about:
   *
   * ```
   * BEFORE ablation:   24 district layers, 8 sources, 12 markers
   * stripped:          45 things removed
   * IMMEDIATELY after: 24 district layers, 8 sources, 0 markers
   * ```
   *
   * `syncDistrictLayer` in `lib/map/districts.ts` is deliberately idempotent —
   * `if (!map.getSource(source)) map.addSource(...)`, and the same guard per
   * layer — so removing a source is an INVITATION to the next sync pass to
   * rebuild it, and removing one is what triggers the pass. The removal never
   * failed and never threw; the page simply healed. The markers and the scrim
   * stayed removed, which is precisely why the failure was invisible: the
   * ablation returned a large truthful count of things it had removed.
   *
   * **Everything measured through the old `bare` was a fully-loaded map with
   * its markers and scrim hidden** — including the 41.3 fps "bare floor" that
   * the absolute 55 fps criterion was argued against. That number is withdrawn.
   *
   * The fix is to BLOCK THE RE-ADD BEFORE REMOVING ANYTHING, so a sync pass
   * racing the removal is a no-op rather than a repair. Verified across three
   * consecutive fly-ins on one page: 0 layers, 0 sources, 0 markers throughout.
   * `bareIntact` below is the readback that keeps it honest — an ablation that
   * silently stops working must never again be able to report a ratio.
   */
  bare: `(() => {
    const map = window.__wtpMap;
    if (!map) return false;
    /* THE ORDER IS THE FIX. Blocking first means the application's own sync
       pass — which the removals below are what provokes — cannot win the race. */
    const realAddSource = map.addSource.bind(map);
    const realAddLayer = map.addLayer.bind(map);
    map.addSource = function (id, spec) {
      if (typeof id === "string" && id.indexOf("district-") === 0) return map;
      return realAddSource(id, spec);
    };
    map.addLayer = function (spec, before) {
      if (spec && typeof spec.id === "string" && spec.id.indexOf("district-") === 0) return map;
      return realAddLayer(spec, before);
    };
    let removed = 0;
    const style = map.getStyle() || {};
    for (const layer of (style.layers || []).slice()) {
      if (layer.id.indexOf("district-") !== 0) continue;
      try { map.removeLayer(layer.id); removed += 1; } catch (e) { void e; }
    }
    for (const id of Object.keys(style.sources || {})) {
      if (id.indexOf("district-") !== 0) continue;
      try { map.removeSource(id); removed += 1; } catch (e) { void e; }
    }
    const el = document.querySelector(".state-focus-layer");
    if (el) { el.style.display = "none"; removed += 1; }
    for (const pin of Array.from(document.querySelectorAll(".maplibregl-marker"))) {
      pin.remove();
      removed += 1;
    }
    return removed > 0;
  })()`,
};

/**
 * **IS THE BARE MAP STILL BARE?** Read at the END of every bare flight.
 *
 * The ablation above returns whether it removed anything, and that is exactly
 * the claim that was true while the experiment was invalid. So the state is
 * read back AFTER the camera lands, and a bare arm that healed during its own
 * flight is refused rather than averaged in. No regex, no backtick.
 */
const BARE_INTACT = `(() => {
  const map = window.__wtpMap;
  if (!map) return { ok: false, layers: -1, sources: -1, markers: -1, scrimHidden: false };
  const style = map.getStyle() || {};
  const layers = (style.layers || []).filter((l) => l.id.indexOf("district-") === 0).length;
  const sources = Object.keys(style.sources || {}).filter((id) => id.indexOf("district-") === 0).length;
  const markers = document.querySelectorAll(".maplibregl-marker").length;
  const el = document.querySelector(".state-focus-layer");
  const scrimHidden = el ? el.style.display === "none" : true;
  return {
    ok: layers === 0 && sources === 0 && markers === 0 && scrimHidden,
    layers: layers,
    sources: sources,
    markers: markers,
    scrimHidden: scrimHidden,
  };
})()`;

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
  const ticksBefore = cpuTicks();
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
  const hostBusyPct = busyPct(ticksBefore, cpuTicks());

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

  const landing = (await page.evaluate(BARE_INTACT)) as {
    layers: number;
    sources: number;
    markers: number;
    scrimHidden: boolean;
  };

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
    gaps: frameGaps(raw.frames),
    commits: raw.commits,
    records: raw.records,
    events: raw.events,
    qrf: raw.qrf,
    longTasks: raw.longTasks,
    requests,
    vertices,
    hostBusyPct,
    landingState: {
      districtLayers: landing.layers,
      districtSources: landing.sources,
      markers: landing.markers,
      scrimHidden: landing.scrimHidden,
    },
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
  /* AT LANDING, not at start: an ablation that healed mid-flight looks correct
     at start and is a different experiment by the time the camera stops. */
  console.log(
    `  AT LANDING: ${run.landingState.districtLayers} district layers, ` +
      `${run.landingState.districtSources} district sources, ` +
      `${run.landingState.markers} markers, ` +
      `state-focus layer ${run.landingState.scrimHidden ? "hidden" : "VISIBLE"}`,
  );
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

/* ═══════════════════════════════════════════════════════════════════════════
   `--normalized` — THE AUTHOR'S AMENDED CRITERION, MEASURED
   ═══════════════════════════════════════════════════════════════════════════

   The statistics and the verdict live in `lib/ops/flyin-normalized.ts`, which
   `scripts/walk-all.mts` imports too. What lives HERE is the experimental
   design, which is the half that decides whether the numbers mean anything.

   ## HOST LOAD IS THE CONFOUND, AND IT IS CONTROLLED BY INTERLEAVING

   Six or seven worktree lanes install, build and test on this machine at once.
   Load is not constant and it is not random — it ARRIVES and it LEAVES, in
   bursts lasting minutes. Measuring arm (a) as one block and arm (b) as a
   second block hands the whole of any load change to whichever arm was running
   when it happened, and the ratio then reports another agent's `pnpm build` as
   a performance regression in this product.

   So the arms are INTERLEAVED at the individual flight, never blocked:

       pair 1:  app,  bare
       pair 2:  bare, app
       pair 3:  app,  bare
       ...

   Two separate controls, and both are needed:

   1. **Alternating ARMS within a pair** means a load burst spanning one pair
      lands on one run of each arm rather than on two runs of one arm.
   2. **Alternating ORDER between pairs** means a systematic within-pair
      position effect — the second flight of a pair running on a warmer cache,
      a browser that has already JITed the animation — cannot accumulate onto
      one arm either. Over an even number of pairs each arm runs first exactly
      as often as it runs second.

   Neither of those makes the host quiet. They make it IMPOSSIBLE for the host
   to be quiet for one arm and busy for the other, which is the only property
   the ratio actually needs. The absolute numbers still move with the load, and
   that is why the absolute is not what is asserted.

   ## A FRESH PAGE PER FLIGHT, WHICH IS NOT OPTIONAL HERE

   The `bare` ablation REMOVES sources and layers, and `removeSource` has no
   inverse. Re-using one page would make every later flight cumulatively
   ablated and every number after the first meaningless. Each flight therefore
   gets its own context, loaded and settled from scratch — which also means the
   two arms differ in exactly one thing: whether the ablation ran. */

/** One flight of one arm, with the host condition it ran under. */
interface Interleaved {
  arm: "app" | "bare";
  pair: number;
  positionInPair: 1 | 2;
  run: Run;
}

async function normalizedPass(
  browser: GuardedBrowser,
  pairs: number,
): Promise<{ app: ArmSummary; bare: ArmSummary; order: Interleaved[] }> {
  const taken: Interleaved[] = [];
  for (let pair = 1; pair <= pairs; pair += 1) {
    /* Odd pairs run the application first, even pairs run the bare map first.
       See the block comment above: this is control (2), and without it the
       second-position advantage would be a constant bias on one arm. */
    const order: ("app" | "bare")[] = pair % 2 === 1 ? ["app", "bare"] : ["bare", "app"];
    for (const [index, arm] of order.entries()) {
      const page = await settledPage(browser);
      if (!page) {
        console.log(
          `  ??  pair ${pair} ${arm} COULD NOT RUN — no __wtpMap on a fresh page. ` +
            "This flight is absent from the denominator rather than counted as slow.",
        );
        continue;
      }
      const label = `pair ${pair} · ${arm}`;
      try {
        const run = await measure(page, label, true, arm === "bare" ? "bare" : "none");
        if (arm === "bare") {
          /*
           * **THE BARE ARM PROVES IT WAS BARE, OR ITS FLIGHT IS DISCARDED.**
           *
           * This is not defensive coding; it is the specific failure that
           * invalidated the previous measurement of this exact criterion. An
           * ablation that quietly stops working turns the ratio into the
           * application compared against itself, which reads as a flawless
           * 100% and asserts nothing. A dropped flight lowers the denominator,
           * which is visible; a healed flight does not, which is not.
           */
          const intact = (await page.evaluate(BARE_INTACT)) as {
            ok: boolean;
            layers: number;
            sources: number;
            markers: number;
            scrimHidden: boolean;
          };
          if (!intact.ok) {
            console.log(
              `  ??  pair ${pair} bare DISCARDED — the map healed during its own flight: ` +
                `${intact.layers} district layers, ${intact.sources} sources, ${intact.markers} ` +
                `markers, scrim ${intact.scrimHidden ? "hidden" : "VISIBLE"} at landing. ` +
                "A bare arm that is not bare would report a meaningless ratio.",
            );
            continue;
          }
        }
        taken.push({ arm, pair, positionInPair: index === 0 ? 1 : 2, run });
        console.log(
          `  ${arm === "app" ? "app " : "bare"} pair ${pair} pos ${index + 1}: ` +
            `median ${run.frames.medianFps.toFixed(1)} fps, ` +
            `mean ${run.frames.meanFps.toFixed(1)}, ` +
            `p95-sustained ${run.frames.sustainedFps.toFixed(1)}, ` +
            `${run.frames.longFrames}/${run.frames.frames} frames over ${LONG_FRAME_MS}ms, ` +
            `host ${run.hostBusyPct === null ? "load UNREAD" : `${run.hostBusyPct.toFixed(0)}% busy`}`,
        );
      } finally {
        await page.context().close();
      }
    }
  }

  const forArm = (arm: "app" | "bare") =>
    taken
      .filter((t) => t.arm === arm)
      .map((t) => ({ gaps: t.run.gaps, hostBusyPct: t.run.hostBusyPct }));

  return {
    app: summariseArm("application", forArm("app")),
    bare: summariseArm("bare MapLibre", forArm("bare")),
    order: taken,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   `--rotate` — THE ABLATION TABLE, WITH THE LOAD CONTROL `--isolate` LACKS
   ═══════════════════════════════════════════════════════════════════════════

   ## The measurement that made this necessary, stated before the fix

   `--isolate --repeat=3` ran on 2026-09-01 and produced a table that could not
   be read. Every row is a BLOCK — three consecutive flights of one ablation,
   then three of the next — and the host's own CPU counters, recorded per run,
   say what that cost:

   ```
   none (FULL APPLICATION)   17.9 fps    host busy 66%, 64%, 71%
   no-scrim                  25.6 fps    host busy 100%, 100%, 100%
   no-districts              11.8 fps    host busy 100%, 100%, 100%
   no-markers                16.3 fps    host busy 62%, 64%, 65%
   ```

   `no-districts` came back SLOWER than the fully loaded application — removing
   work made the flight worse — and the only honest reading of that is that the
   row is measuring a load burst rather than a component. Six other worktree
   lanes were building on this machine; the burst arrived during three rows and
   left before three others, and a block design hands the whole of it to
   whichever rows it spanned.

   ## The control, which is the same one `--normalized` already uses

   Arms are ROTATED rather than blocked. Round 1 flies the arms in their listed
   order; round 2 starts one position later; round 3 one later again. Over R
   rounds each arm occupies each position in the rotation as evenly as R allows,
   so a burst lasting part of a round lands on a DIFFERENT arm each round
   instead of on the same one every time.

   That does not make the host quiet — nothing here can — and it does not remove
   variance. It removes the systematic part: the property the table actually
   needs is that no arm is measured under reliably worse conditions than
   another, and rotation is what buys that. The per-run spread and the per-run
   host-busy figures are still printed on every row, because a delta smaller
   than its own spread names nothing and the reader has to be able to see that.

   ## A fresh page per flight, for the reason `--normalized` gives

   `removeSource` has no inverse, so a re-used page would make every later
   flight cumulatively ablated. Each flight loads and settles from scratch and
   differs from the `none` arm in exactly one thing: which ablation ran. */

/**
 * The arms, in rotation order.
 *
 * `legacy-sourcedata` is deliberately ABSENT: it ADDS a mechanism back rather
 * than subtracting one, so it is not an ablation and it does not belong in a
 * table whose whole meaning is "what does removing this buy". It stays
 * available under `--isolate`, where it is a paired control for one removed
 * subscription and is read as such.
 */
const ROTATION_ARMS = [
  "none",
  "no-scrim",
  "no-backdrop",
  "no-svg-art",
  "no-districts",
  "no-markers",
  "bare",
] as const;

/**
 * Which arms make a claim about the map's contents that a readback can check.
 *
 * `no-scrim` and `bare` hide the state-focus layer; `no-districts` and `bare`
 * remove the district layers and sources. A flight whose landing state
 * contradicts its own ablation is DISCARDED rather than averaged in — the
 * healed-`bare` defect of 2026-08-31 is the reason this exists, and
 * `no-districts` carried the identical defect until 2026-09-01.
 *
 * `no-backdrop`, `no-svg-art` and `no-markers` are style mutations on elements
 * that stay in the DOM, so there is nothing here for a landing readback to
 * check; their ablation function returning false is what reports a miss, and
 * `measure` already prints that.
 */
const ROTATION_READBACK: Record<string, (s: Run["landingState"]) => string | null> = {
  "no-scrim": (s) => (s.scrimHidden ? null : "the state-focus layer was VISIBLE at landing"),
  "no-districts": (s) =>
    s.districtLayers === 0 && s.districtSources === 0
      ? null
      : `${s.districtLayers} district layers and ${s.districtSources} sources were back at landing`,
  bare: (s) =>
    s.districtLayers === 0 && s.districtSources === 0 && s.markers === 0 && s.scrimHidden
      ? null
      : `${s.districtLayers} district layers, ${s.districtSources} sources, ${s.markers} markers, ` +
        `state-focus layer ${s.scrimHidden ? "hidden" : "VISIBLE"} at landing`,
};

async function rotatedPass(
  browser: GuardedBrowser,
  rounds: number,
  arms: readonly string[],
): Promise<{ name: string; summary: ArmSummary; runs: Run[] }[]> {
  const taken = new Map<string, Run[]>();
  for (const arm of arms) taken.set(arm, []);
  for (let round = 0; round < rounds; round += 1) {
    const order = arms.map((_, i) => arms[(i + round) % arms.length]);
    for (const arm of order) {
      const page = await settledPage(browser);
      if (!page) {
        console.log(
          `  ??  round ${round + 1} ${arm} COULD NOT RUN — no __wtpMap on a fresh page. ` +
            "Absent from this arm's denominator rather than counted as slow.",
        );
        continue;
      }
      try {
        const run = await measure(page, `round ${round + 1} · ${arm}`, true, arm);
        const complaint = ROTATION_READBACK[arm]?.(run.landingState) ?? null;
        if (complaint !== null) {
          console.log(
            `  ??  round ${round + 1} ${arm} DISCARDED — ${complaint}. An ablation that ` +
              "healed during its own flight would file a fully loaded flight under its name.",
          );
          continue;
        }
        taken.get(arm)?.push(run);
        console.log(
          `  ${arm.padEnd(14)} round ${round + 1}: median ${run.frames.medianFps.toFixed(1)} fps, ` +
            `p95-sustained ${run.frames.sustainedFps.toFixed(1)}, ` +
            `${run.frames.longFrames}/${run.frames.frames} over ${LONG_FRAME_MS}ms, ` +
            `host ${run.hostBusyPct === null ? "load UNREAD" : `${run.hostBusyPct.toFixed(0)}% busy`}`,
        );
      } finally {
        await page.context().close();
      }
    }
  }
  const out: { name: string; summary: ArmSummary; runs: Run[] }[] = [];
  for (const arm of arms) {
    const runs = taken.get(arm) ?? [];
    if (runs.length === 0) {
      console.log(`  ??  arm "${arm}" completed ZERO flights — absent from the table entirely`);
      continue;
    }
    out.push({
      name: arm,
      summary: summariseArm(
        arm,
        runs.map((r) => ({ gaps: r.gaps, hostBusyPct: r.hostBusyPct })),
      ),
      runs,
    });
  }
  return out;
}

/** The table both `--rotate` and `--isolate` print, so the two cannot drift. */
function ablationTable(
  summaries: { name: string; summary: ArmSummary; runs: Run[] }[],
  fullName: string,
): void {
  const full = summaries.find((s) => s.name === fullName)?.summary;
  const bare = summaries.find((s) => s.name === "bare")?.summary;
  if (!full) {
    console.log(
      `  ??  NO "${fullName}" ROW — the 'delta vs full app' column cannot be computed and is ` +
        "printed as UNMEAS rather than as zero.",
    );
  }
  if (!bare) {
    console.log(
      "  ??  NO BARE ROW — the 'delta vs bare' column cannot be computed and is printed as " +
        "UNMEAS rather than as zero.",
    );
  }
  console.log(
    `\n  ${"ablation".padEnd(24)}${"medFps".padStart(8)}${"sustFps".padStart(9)}` +
      `${"p50ms".padStart(8)}${"p95ms".padStart(8)}${"long/frames".padStart(14)}` +
      `${"vs full".padStart(10)}${"vs bare".padStart(10)}`,
  );
  for (const { name, summary } of summaries) {
    const vsFull = full ? (summary.medianFps - full.medianFps).toFixed(1) : "UNMEAS";
    const vsBare = bare ? (summary.medianFps - bare.medianFps).toFixed(1) : "UNMEAS";
    console.log(
      `  ${name.padEnd(24)}${summary.medianFps.toFixed(1).padStart(8)}` +
        `${summary.sustainedFps.toFixed(1).padStart(9)}` +
        `${summary.frameMs.p50.toFixed(1).padStart(8)}` +
        `${summary.frameMs.p95.toFixed(1).padStart(8)}` +
        `${`${summary.longFrames}/${summary.framesMeasured}`.padStart(14)}` +
        `${vsFull.padStart(10)}${vsBare.padStart(10)}`,
    );
  }
  for (const { name, summary } of summaries) {
    console.log(
      `  ${name}: per-run medians ${summary.medianFpsPerRun.map((v) => v.toFixed(1)).join(", ")} fps ` +
        `(spread ${(Math.max(...summary.medianFpsPerRun) - Math.min(...summary.medianFpsPerRun)).toFixed(1)} fps), ` +
        `host busy ${summary.hostBusyPct.map((v) => (v === null ? "UNREAD" : `${v.toFixed(0)}%`)).join(", ")}`,
    );
  }
}

/** The evidence record, written identically by both ablation modes. */
function writeAblationEvidence(
  file: string,
  body: Record<string, unknown>,
  summaries: { name: string; summary: ArmSummary; runs: Run[] }[],
  fullName: string,
): void {
  const full = summaries.find((s) => s.name === fullName)?.summary;
  const bare = summaries.find((s) => s.name === "bare")?.summary;
  writeFileSync(
    join(process.cwd(), "docs", "evidence", file),
    `${JSON.stringify(
      {
        ...body,
        rows: summaries.map(({ name, summary, runs }) => ({
          name,
          /* The readback that keeps each row honest — see `Run.landingState`. */
          landingStates: runs.map((r) => r.landingState),
          medianFps: summary.medianFps,
          sustainedFps: summary.sustainedFps,
          meanFps: summary.meanFps,
          frameMs: summary.frameMs,
          longFrames: summary.longFrames,
          framesMeasured: summary.framesMeasured,
          medianFpsPerRun: summary.medianFpsPerRun,
          hostBusyPct: summary.hostBusyPct,
          deltaVsFullApp: full ? summary.medianFps - full.medianFps : null,
          deltaVsBare: bare ? summary.medianFps - bare.medianFps : null,
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function reportArm(summary: ArmSummary): void {
  console.log(`\n── ${summary.arm} — ${summary.runs} runs ────────────────────`);
  console.log(
    `  MEDIAN ${summary.medianFps.toFixed(1)} fps   ` +
      `mean ${summary.meanFps.toFixed(1)} fps   ` +
      `p95-sustained ${summary.sustainedFps.toFixed(1)} fps`,
  );
  console.log(
    `  frame time (pooled, ${summary.framesMeasured} frames): ` +
      `p50 ${summary.frameMs.p50.toFixed(1)}ms  ` +
      `p95 ${summary.frameMs.p95.toFixed(1)}ms  ` +
      `p99 ${summary.frameMs.p99.toFixed(1)}ms  ` +
      `max ${summary.frameMs.max.toFixed(1)}ms`,
  );
  console.log(
    `  ${floorLine(
      floored(
        `frames slower than ${LONG_FRAME_MS}ms (JANK)`,
        `${summary.runs} pooled flight windows`,
        summary.framesMeasured,
        summary.longFrames,
      ),
    )}`,
  );
  console.log(`  per-run medians: ${summary.medianFpsPerRun.map((v) => v.toFixed(1)).join(", ")} fps`);
}

/**
 * **A CPU PROFILE, BECAUSE ABLATION STOPPED CONVERGING.**
 *
 * With seven lanes on the host, the ablation medians disagreed with each other:
 * `bare` — the flight with everything of ours supposedly removed — scored 46.9
 * while the fully loaded flight scored 41.3 and `no-svg-art` scored 48.1. Those
 * gaps are inside the noise, so no further subtraction was going to name the
 * residual.
 *
 * **AND THE SECOND REASON, FOUND ON 2026-08-31: `bare` WAS NOT BARE.** It was
 * healing mid-flight — see the ablation's own note — so `bare` and the fully
 * loaded flight were measuring very nearly the same page, which is exactly what
 * "gaps inside the noise" looks like from the outside. Every ablation number in
 * this paragraph predates that fix and none of them should be cited.
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
  const normalized = process.argv.includes("--normalized");
  const rotate = process.argv.includes("--rotate");
  const repeatArg = process.argv.find((a) => a.startsWith("--repeat="));
  const REPEATS = Math.max(1, Number(repeatArg?.split("=")[1] ?? 1) || 1);
  const browser = await launchGuarded({
    label: "measure-flyin",
    args: SOFTWARE ? [] : GPU_ARGS,
  });
  console.log(`run ${browser.runId} against ${BASE} at ${ZIP}`);

  if (rotate) {
    try {
      const probe = await settledPage(browser);
      const renderer = probe ? String(await probe.evaluate(READ_RENDERER)) : "NOT READ";
      if (probe) await probe.context().close();
      console.log(`  webgl renderer: ${renderer}`);

      const roundArg = process.argv.find((a) => a.startsWith("--rounds="));
      const ROUNDS = Math.max(1, Number(roundArg?.split("=")[1] ?? 3) || 3);
      /*
       * `--only` picks from EVERY ablation, not only the default rotation.
       * It filtered against `ROTATION_ARMS` first, which silently dropped any
       * name outside the default list and then ran a table with a missing arm
       * — the shape of failure this file refuses everywhere else. An
       * unrecognised name now REFUSES rather than being quietly omitted.
       */
      const onlyArg = process.argv.find((a) => a.startsWith("--only="));
      const asked = onlyArg ? onlyArg.split("=")[1].split(",").filter(Boolean) : null;
      const unknown = (asked ?? []).filter((a) => !(a in ABLATIONS));
      if (unknown.length > 0) {
        throw new Error(
          `measure-flyin: --only names ${unknown.join(", ")}, which no ablation defines. ` +
            `Known ablations: ${Object.keys(ABLATIONS).join(", ")}. Running the table with the ` +
            "unrecognised arm silently omitted would report a table nobody asked for.",
        );
      }
      const arms = asked ?? [...ROTATION_ARMS];
      console.log(
        `\nROTATED ABLATION TABLE — ${ROUNDS} rounds over ${arms.length} arms ` +
          `(${ROUNDS * arms.length} flights), rotation order changes every round so no arm is ` +
          "measured under reliably worse host load than another\n",
      );
      const summaries = await rotatedPass(browser, ROUNDS, arms);
      console.log(`\n══ THE ABLATION TABLE (ROTATED) ════════════════════════════`);
      ablationTable(summaries, "none");
      writeAblationEvidence(
        SOFTWARE ? "flyin-rotation-software.json" : "flyin-rotation.json",
        {
          base: BASE,
          zip: ZIP,
          renderer,
          rounds: ROUNDS,
          arms,
          design:
            "ROTATED — every arm flown once per round, rotation order advanced each round, " +
            "fresh page per flight",
          machineLoadCaveat:
            "Other worktree lanes were building and testing on this host concurrently, so " +
            "variance is elevated and the ABSOLUTE fps figures are not portable to a quiet " +
            "machine. Rotation controls the SYSTEMATIC part — no arm is measured under " +
            "reliably worse load than another — and does not remove variance. Every row " +
            "carries its per-run medians, the spread across them, and the host CPU busy " +
            "percentage measured across each flight's own window. A delta smaller than the " +
            "spread beside it names nothing.",
        },
        summaries,
        "none",
      );
    } finally {
      await browser.close();
    }
    return;
  }

  if (normalized) {
    /*
     * `--normalized` is its own instrument and it does not share `main`'s body.
     * The descriptive pass below takes a CONTROL with the camera standing
     * still, which answers "can this harness see 60 fps at all"; the author's
     * criterion answers a different question — "what does the application cost
     * against a bare map on THIS host" — and mixing the two passes would put
     * two unrelated sets of flights on one contended machine and make each
     * one's numbers a little worse for no gain.
     */
    try {
      const probe = await settledPage(browser);
      const renderer = probe ? String(await probe.evaluate(READ_RENDERER)) : "NOT READ";
      if (probe) await probe.context().close();
      console.log(`  webgl renderer: ${renderer}`);

      const pairArg = process.argv.find((a) => a.startsWith("--pairs="));
      const PAIRS = Math.max(1, Number(pairArg?.split("=")[1] ?? 6) || 6);
      console.log(
        `\nHOST-NORMALIZED CRITERION — ${PAIRS} interleaved pairs, ` +
          `${PAIRS} flights per arm, identical camera path\n`,
      );
      const { app, bare, order } = await normalizedPass(browser, PAIRS);
      reportArm(bare);
      reportArm(app);

      const verdict = judgeNormalized(app, bare);
      console.log(`\n══ THE CRITERION ═══════════════════════════════════════════`);
      console.log(
        `  application ${app.medianFps.toFixed(1)} fps median / ` +
          `bare map ${bare.medianFps.toFixed(1)} fps median = ` +
          `RATIO ${verdict.ratio.toFixed(4)} (${(verdict.ratio * 100).toFixed(1)}%)`,
      );
      console.log(
        `  ${verdict.pass ? "PASS" : "FAIL"} against the ${(NORMALIZED_FLOOR * 100).toFixed(0)}% floor ` +
          `— denominators ${app.runs} application flights and ${bare.runs} bare flights`,
      );
      console.log(`  HOST CONDITION: ${hostCondition(verdict)}`);
      if (verdict.hostBelowSmoothMotion) {
        console.log(
          `  HOST LIMIT, STATED NUMERICALLY: the bare map — every district layer, every ` +
            `marker and the whole state-focus layer removed — held only ` +
            `${bare.medianFps.toFixed(1)} fps median and ${bare.sustainedFps.toFixed(1)} fps ` +
            `p95-sustained, with ${bare.longFrames} of ${bare.framesMeasured} frames over ` +
            `${LONG_FRAME_MS}ms. That is this machine's ceiling for this animation. It does ` +
            `NOT waive the relative requirement above.`,
        );
      }

      /*
       * **THE TWO RASTERISERS GET TWO FILES, NEVER ONE FILE TWICE.**
       *
       * `FLYIN_SOFTWARE=1` measures the same criterion through the CPU
       * rasteriser on purpose, and that reading is worth keeping — it is what
       * a reader with no GPU acceleration gets. Writing it over the hardware
       * reading would silently replace the number the permanent check is
       * calibrated against with a number from a different machine class, and
       * nothing in the file would say which one it held.
       */
      writeFileSync(
        join(
          process.cwd(),
          "docs",
          "evidence",
          SOFTWARE ? "flyin-normalized-software.json" : "flyin-normalized.json",
        ),
        `${JSON.stringify(
          {
            criterion:
              "application median fps >= 90% of bare-map median fps on this host (2026-08-31)",
            base: BASE,
            zip: ZIP,
            renderer,
            pairs: PAIRS,
            design: "interleaved app/bare, alternating within-pair order, fresh page per flight",
            /*
             * **THE CAVEAT TRAVELS WITH THE NUMBERS, RATHER THAN WITH WHOEVER
             * HAPPENED TO RUN THEM.** (Session C, 2026-09-01.)
             *
             * This file is read months later by a session that was not here and
             * cannot ask what the machine was doing. `hostBusyPct` is recorded
             * per flight and always was; what was missing is the sentence that
             * says what those percentages MEAN for the two kinds of number in
             * this file — that the ratio survives contention by construction
             * and the absolute rates do not. Without it a future session reads
             * "49.9 fps" as a property of the build.
             */
            machineLoadCaveat:
              "Other worktree lanes were building and testing on this host while these flights " +
              "ran, and the per-flight hostBusyPct figures below record it. The interleaved " +
              "design is what makes the RATIO readable anyway: a load burst spanning a pair " +
              "lands on one flight of each arm, and the alternating within-pair order stops a " +
              "second-position advantage accumulating on one arm. Variance is still elevated, " +
              "so read medianFpsPerRun for the spread. THE ABSOLUTE fps FIGURES ARE FACTS ABOUT " +
              "THIS HOST ON THIS DAY AND ARE NOT PORTABLE; only the ratio is a statement about " +
              "the build.",
            app,
            bare,
            ratio: verdict.ratio,
            pass: verdict.pass,
            hostCeilingFps: verdict.hostCeilingFps,
            hostBelowSmoothMotion: verdict.hostBelowSmoothMotion,
            hostCondition: hostCondition(verdict),
            runOrder: order.map((t) => ({
              pair: t.pair,
              arm: t.arm,
              positionInPair: t.positionInPair,
              medianFps: t.run.frames.medianFps,
              meanFps: t.run.frames.meanFps,
              sustainedFps: t.run.frames.sustainedFps,
              longFrames: t.run.frames.longFrames,
              frames: t.run.frames.frames,
              worstFrameMs: t.run.frames.worstFrameMs,
              qrfCalls: t.run.qrf.calls,
              sourcedata: t.run.events.sourcedata,
              hostBusyPct: t.run.hostBusyPct,
            })),
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    } finally {
      await browser.close();
    }
    return;
  }

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
    /**
     * **THE ABLATION TABLE, WITH THE SAME FIVE STATISTICS FOR EVERY ARM.**
     *
     * `report()` above prints one median RUN, which is the right shape for a
     * descriptive pass and the wrong shape for an attribution: a median run
     * carries one run's frame-time distribution, and "which component costs
     * what" is a question about a POPULATION of flights. So each ablation is
     * reduced through `summariseArm` — the identical reduction the normalized
     * criterion uses, so the ablation table and the criterion can never come to
     * mean two different things by "median fps".
     *
     * The two deltas are BOTH reported, deliberately, because they answer
     * different questions. Against the full application: how much of the
     * deficit does removing this one component buy back. Against bare: how much
     * of the deficit is still there once it is gone. A component can look large
     * on the first and leave the flight nowhere near bare on the second, which
     * is exactly the case where naming it as THE culprit would be wrong.
     */
    const summaries: { name: string; summary: ArmSummary; runs: Run[] }[] = [];
    if (isolate) {
      const onlyArg = process.argv.find((a) => a.startsWith("--only="));
      const only = onlyArg ? onlyArg.split("=")[1].split(",") : null;
      summaries.push({
        name: "none (FULL APPLICATION)",
        summary: summariseArm(
          "none (FULL APPLICATION)",
          flights.map((r) => ({ gaps: r.gaps, hostBusyPct: r.hostBusyPct })),
        ),
        runs: flights,
      });
      for (const name of Object.keys(ABLATIONS)) {
        if (name === "none") continue;
        if (only && !only.includes(name)) continue;
        const runs = await repeated(browser, `FLIGHT with ${name}`, true, name, REPEATS);
        if (runs.length === 0) {
          console.log(`  ??  ablation "${name}" completed ZERO flights — absent from the table`);
          continue;
        }
        const med = medianRun(runs);
        report({ ...med, label: `FLIGHT with ${name} — median of ${runs.length}` });
        ablated.push(med);
        summaries.push({
          name,
          summary: summariseArm(
            name,
            runs.map((r) => ({ gaps: r.gaps, hostBusyPct: r.hostBusyPct })),
          ),
          runs,
        });
      }

      console.log(`\n══ THE ABLATION TABLE (BLOCKED — read the caveat) ══════════`);
      console.log(
        "  Each row is ONE suspect removed and the identical camera path re-flown. " +
          `${REPEATS} flight(s) per row; per-run medians printed so the SPREAD is visible ` +
          "rather than implied. **THESE ROWS ARE BLOCKS, NOT INTERLEAVED** — a load burst " +
          "spanning one row lands entirely on that row. `--rotate` is the load-controlled " +
          "version of this same table and is what a delta should be read from.",
      );
      ablationTable(summaries, "none (FULL APPLICATION)");
      writeAblationEvidence(
        SOFTWARE ? "flyin-ablation-software.json" : "flyin-ablation.json",
        {
          base: BASE,
          zip: ZIP,
          renderer,
          repeats: REPEATS,
          design: "BLOCKED — each ablation measured as consecutive runs, arms not interleaved",
          /*
           * **THE CAVEAT TRAVELS WITH THE NUMBERS.** Other worktree lanes
           * compile on this host while these run, and unlike `--normalized`
           * and `--rotate` this pass is NOT interleaved — each row is a block.
           * The per-row host-busy percentages and the per-run spread are
           * recorded for exactly that reason; a row whose spread is wide, or
           * whose host-busy figure differs from its neighbours', is a row whose
           * delta must not be read as a component's cost.
           */
          machineLoadCaveat:
            "Ablation rows are measured as BLOCKS, not interleaved, so a load burst arriving " +
            "during one row lands entirely on that row. Other worktree lanes were building and " +
            "testing on this host concurrently. Read every delta against the per-run spread and " +
            "the per-run hostBusyPct recorded beside it; a delta smaller than the spread names " +
            "nothing. Prefer the rotated pass in flyin-rotation-*.json.",
        },
        summaries,
        "none (FULL APPLICATION)",
      );
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
