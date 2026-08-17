/**
 * HOW FAST THE MAP ARRIVES, AND HOW SMOOTHLY IT FLIES — g5 item 1.
 *
 * `SHOOT_BASE_URL=… pnpm measure:fly`
 *
 * Three numbers, all measured cold with the cache disabled, because the
 * budget in the brief is stated absolutely and a warm reload would report a
 * number no first-time reader will ever see:
 *
 * - **First contentful paint** and **largest contentful paint**, from the
 *   browser's own paint timeline.
 * - **Map ready** — the first moment the live map answers a camera probe.
 *   This is the honest "time to interactive" for this page: the map is the
 *   product's entry surface, and until it answers there is nothing to pan.
 * - **Frame timing during the fly-in.** An animation-frame recorder runs from
 *   before navigation, sampling the camera each frame; the fly is the span
 *   where the camera is actually moving, and the report is the worst frame
 *   and the count over 32 ms (a 30 fps floor) inside that span.
 *
 * The budget: no frame over 32 ms, first meaningful paint within 3.0 s. Both
 * are printed either way. A missed target is reported with its measurement,
 * never smoothed into a pass.
 */
import { chromium } from "playwright";

const BASE = (process.env.SHOOT_BASE_URL ?? "https://sparkwtp.netlify.app").replace(
  /\/$/,
  "",
);
const ZIP = process.env.FLY_ZIP ?? "85701";
const RUNS = Number(process.env.FLY_RUNS ?? 3);

const FRAME_BUDGET_MS = 32;
const PAINT_BUDGET_MS = 3000;

interface Run {
  fcp: number;
  lcp: number;
  mapReady: number;
  flyFrames: number;
  flyMs: number;
  worstFrame: number;
  overBudget: number;
  medianFrame: number;
}

const browser = await chromium.launch();
const runs: Run[] = [];

for (let i = 0; i < RUNS; i += 1) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    // NOT reducedMotion: the fly-in is the thing being measured, and a
    // context that asks the app to skip animation would measure nothing.
  });
  await context.addInitScript(
    ({ zip }) => {
      try {
        sessionStorage.setItem(
          "wtp.approximate_location",
          JSON.stringify({ zip, savedAt: new Date().toISOString() }),
        );
        localStorage.setItem("wtp.tutorial_seen", "1");
        localStorage.setItem("wtp.theme", "dark");
      } catch {
        /* the run still happens */
      }
    },
    { zip: ZIP },
  );

  /*
   * The recorder, passed as SOURCE TEXT rather than as a function.
   *
   * `tsx` compiles this file with esbuild's name-keeping on, which wraps any
   * named function — including `const tick = () => {}` — in a call to an
   * `__name` helper that does not exist in a browser. A recorder that throws
   * on its first line reports a perfectly smooth zero-frame fly-in, which is
   * how the first run of this script came back claiming the map never moved.
   * A string is compiled by nobody.
   *
   * `__wtpCamera` is g5's own probe; the fallback to `__wtpZoom` is what lets
   * this measure a build that predates it, which is the entire point of a
   * before-and-after.
   */
  await context.addInitScript({
    content: `
      (function () {
        var store = { t: [], zoom: [], lat: [], lng: [], ready: -1 };
        window.__wtpFrames = store;
        window.__wtpTick = function () {
          var camera = window.__wtpCamera ? window.__wtpCamera() : null;
          if (!camera && window.__wtpZoom) {
            camera = { zoom: window.__wtpZoom(), lat: NaN, lng: NaN };
          }
          store.t.push(performance.now());
          store.zoom.push(camera ? camera.zoom : NaN);
          store.lat.push(camera ? camera.lat : NaN);
          store.lng.push(camera ? camera.lng : NaN);
          if (camera && store.ready < 0) store.ready = performance.now();
          requestAnimationFrame(window.__wtpTick);
        };
        requestAnimationFrame(window.__wtpTick);
        // LCP is only readable through an observer; getEntriesByType returns
        // nothing for it, which is why the first run printed NaN.
        window.__wtpLcp = NaN;
        try {
          new PerformanceObserver(function (list) {
            var entries = list.getEntries();
            window.__wtpLcp = entries[entries.length - 1].startTime;
          }).observe({ type: "largest-contentful-paint", buffered: true });
        } catch (e) {
          /* the rest of the run still reports */
        }
      })();
    `,
  });

  /*
   * ATTRIBUTION ARM (FLY_NO_EFFECT=1): the same run with the state effect
   * never painted.
   *
   * The brief allows suspending the blur for the duration of the fly-in if it
   * cannot hold frame rate. Whether that would help is a measurement, not a
   * guess: a cold fly-in is also decoding and uploading map tiles, and if the
   * frames are the same with the effect gone then suspending it buys nothing
   * and shipping the suspension would be a change with a false reason
   * attached.
   */
  if (process.env.FLY_NO_EFFECT === "1") {
    await context.addInitScript({
      content: `
        (function () {
          var style = document.createElement("style");
          style.textContent = ".state-focus-layer { display: none !important; }";
          (document.head || document.documentElement).appendChild(style);
        })();
      `,
    });
  }

  const page = await context.newPage();
  // Cold: no HTTP cache, no service worker warmth.
  const client = await context.newCDPSession(page);
  await client.send("Network.setCacheDisabled", { cacheDisabled: true });

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(20_000);

  const result = await page.evaluate(
    ({ budget }) => {
      const store = (
        window as unknown as {
          __wtpFrames?: {
            t: number[];
            zoom: number[];
            lat: number[];
            lng: number[];
            ready: number;
          };
        }
      ).__wtpFrames;
      const paints = performance.getEntriesByType("paint");
      const fcpEntry = paints.find((p) => p.name === "first-contentful-paint");

      const out = {
        fcp: fcpEntry ? fcpEntry.startTime : Number.NaN,
        lcp: (window as unknown as { __wtpLcp?: number }).__wtpLcp ?? Number.NaN,
        mapReady: store ? store.ready : Number.NaN,
        flyFrames: 0,
        flyMs: 0,
        worstFrame: 0,
        overBudget: 0,
        medianFrame: 0,
      };
      if (!store || store.t.length < 4) return out;

      // The fly is the span where the camera actually moves. Found rather
      // than assumed: a fixed window would report whatever happened to be in
      // it, and a fly that never ran would then measure as perfectly smooth.
      let first = -1;
      let last = -1;
      for (let i = 1; i < store.t.length; i += 1) {
        const moved =
          Math.abs(store.zoom[i] - store.zoom[i - 1]) > 1e-6 ||
          Math.abs(store.lat[i] - store.lat[i - 1]) > 1e-9 ||
          Math.abs(store.lng[i] - store.lng[i - 1]) > 1e-9;
        if (moved) {
          if (first < 0) first = i - 1;
          last = i;
        }
      }
      if (first < 0 || last <= first) return out;

      const deltas: number[] = [];
      for (let i = first + 1; i <= last; i += 1) deltas.push(store.t[i] - store.t[i - 1]);
      deltas.sort((a, b) => a - b);
      out.flyFrames = deltas.length;
      out.flyMs = store.t[last] - store.t[first];
      out.worstFrame = deltas[deltas.length - 1];
      out.medianFrame = deltas[Math.floor(deltas.length / 2)];
      out.overBudget = deltas.filter((d) => d > budget).length;
      return out;
    },
    { budget: FRAME_BUDGET_MS },
  );

  runs.push(result);
  console.log(
    `run ${i + 1}: FCP ${result.fcp.toFixed(0)}ms, LCP ${result.lcp.toFixed(0)}ms, ` +
      `map ready ${result.mapReady.toFixed(0)}ms, fly ${result.flyMs.toFixed(0)}ms over ` +
      `${result.flyFrames} frames, median ${result.medianFrame.toFixed(1)}ms, ` +
      `worst ${result.worstFrame.toFixed(1)}ms, ${result.overBudget} over ${FRAME_BUDGET_MS}ms`,
  );
  await context.close();
}

await browser.close();

const median = (values: number[]) => {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : Number.NaN;
};

const fcp = median(runs.map((r) => r.fcp));
const lcp = median(runs.map((r) => r.lcp));
const ready = median(runs.map((r) => r.mapReady));
const worst = Math.max(...runs.map((r) => r.worstFrame));
const over = Math.max(...runs.map((r) => r.overBudget));

console.log(`\nmeasure:fly — ${BASE}, zip ${ZIP}, ${RUNS} cold run(s)`);
console.log(`  first contentful paint   ${fcp.toFixed(0)} ms   (budget ${PAINT_BUDGET_MS} ms) ${fcp <= PAINT_BUDGET_MS ? "OK" : "OVER"}`);
console.log(`  largest contentful paint ${lcp.toFixed(0)} ms`);
console.log(`  map ready (interactive)  ${ready.toFixed(0)} ms`);
console.log(`  worst fly-in frame       ${worst.toFixed(1)} ms  (budget ${FRAME_BUDGET_MS} ms) ${worst <= FRAME_BUDGET_MS ? "OK" : "OVER"}`);
console.log(`  frames over budget       ${over} (worst run)`);
