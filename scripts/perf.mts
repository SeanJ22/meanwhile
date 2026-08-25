/**
 * `pnpm perf` — THE AUTHOR'S BASELINE, from the author's own hardware.
 *
 *   pnpm perf                    # against production, in your real Chrome
 *   pnpm perf --headless         # the CI-shaped run, for comparison only
 *   SHOOT_BASE_URL=… pnpm perf   # against anything else
 *
 * ## Why this exists (item 8b, 2026-08-17, the author's ruling)
 *
 * `pnpm measure:fly` asserts a **32 ms frame budget**. That number was set as
 * an absolute because no baseline existed. It was missed before g5's fix and
 * missed after it, with no cause ever named, on a **software-rasterized CI
 * runner whose numbers are not a reader's**. A budget nothing can pass is not
 * a budget; it is a permanently red light everyone has learned to walk past.
 *
 * The author's ruling: retire the absolute number and set a real one from his
 * own hardware. **This command asserts nothing.** It measures, prints, and
 * writes a file. The author reads it and rules; the number he picks becomes
 * the budget, and until he picks one there is no budget — a check asserting
 * against a made-up threshold is worse than no check.
 *
 * ## Why it opens your real browser
 *
 * A baseline taken in a headless bundled Chromium is a baseline for headless
 * bundled Chromium. This launches the Chrome already installed on this
 * machine, visibly, so the numbers come from the GPU, the display and the
 * driver stack a reader would actually have. Do not touch the window while it
 * runs — a pointer move repaints, and that is measurable.
 *
 * ## The acceleration statement is not decoration
 *
 * Every run reads `chrome://gpu`'s own feature status. **A run without
 * hardware acceleration is not a baseline** and this says so in the first
 * line of the report rather than in a footnote, because that single fact is
 * the difference between "the map is slow" and "the runner has no GPU" — and
 * confusing the two is exactly how the 32 ms number survived this long.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { makeRunId, syntheticRunHeaders } from "../lib/db/run-marker.ts";
import { launchGuarded, type GuardedBrowser } from "./browser.mts";

const BASE = (process.env.SHOOT_BASE_URL ?? "https://sparkwtp.netlify.app").replace(/\/$/, "");
const ZIP = process.env.PERF_ZIP ?? "85701";
const RUNS = Number(process.env.PERF_RUNS ?? 3);
const HEADLESS = process.argv.includes("--headless");
const OUT = join(process.cwd(), "docs", "perf-baseline.md");

/** C05: these are our rows, declared at write time. */
const RUN_HEADERS = syntheticRunHeaders({
  WTP_RUN_ID: process.env.WTP_RUN_ID?.trim() || makeRunId("perf", new Date().toISOString()),
});

interface Run {
  fcp: number;
  lcp: number;
  mapReady: number;
  flyFrames: number;
  flyMs: number;
  worstFrame: number;
  medianFrame: number;
  dropped: number;
}

/**
 * Launch the machine's real Chrome, and say plainly if we could not.
 *
 * Falling back to bundled Chromium WITHOUT saying so would produce a file
 * labelled "the author's baseline" measured on a browser he does not use.
 */
async function launch(): Promise<{ browser: GuardedBrowser; what: string }> {
  if (HEADLESS) {
    return { browser: await launchGuarded({ label: "perf" }), what: "bundled Chromium, headless (NOT a baseline)" };
  }
  try {
    const browser = await launchGuarded({ label: "perf", channel: "chrome", headless: false  });
    return { browser, what: "the Chrome installed on this machine, visible" };
  } catch {
    const browser = await launchGuarded({ label: "perf", headless: false  });
    return {
      browser,
      what: "bundled Chromium, visible — REAL CHROME NOT FOUND, so this is not the author's browser",
    };
  }
}

/** Chrome's own answer to "is the GPU doing the work?", read from chrome://gpu. */
async function accelerationStatus(browser: GuardedBrowser): Promise<{ on: boolean; detail: string }> {
  try {
    const page = await browser.page();
    await page.goto("chrome://gpu", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2_500);
    /*
     * **`chrome://gpu` LIVES IN A SHADOW DOM, AND READING PAST IT IS THE WHOLE
     * MEASUREMENT.** (Fixed 2026-08-24, the NJ depth session, closing the
     * diagnosis half of `P-005`.)
     *
     * This read `document.body.innerText` and got **zero characters** — the
     * page's content is inside an `<info-view>` custom element's shadow root,
     * which `innerText` on the host document does not cross. So `webgl` was
     * always the empty string, `on` was always false, and every run this
     * project has ever taken printed **"hardware acceleration: OFF or
     * UNKNOWN — chrome://gpu gave no feature lines"**.
     *
     * Measured on this machine the day it was fixed: `WebGL: Hardware
     * accelerated`, `Canvas: Hardware accelerated`, `Rasterization: Hardware
     * accelerated`. **Acceleration was ON the entire time.**
     *
     * This is RULING 113's second failure exactly — a message that names the
     * wrong half. *"No feature lines"* about a page holding 96,674 characters
     * of them sends every reader to the graphics stack, which was working, and
     * `P-005` sat open on the strength of it. An absence that can name what it
     * DID see points at the reader instead of the writer, and the fallback
     * string below now says how many characters were found.
     */
    const text = (await page.evaluate(`(() => {
      const out = [];
      const walk = (root) => {
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
        if (root.textContent) out.push(root.textContent);
      };
      walk(document);
      return out.join('\\n');
    })()`)) as string;
    await page.close();
    /*
     * ONE feature, not the whole line. `chrome://gpu` renders its feature
     * statuses without newlines between them, and the shadow-root walk visits
     * each nesting level, so a greedy `[^\n]*` returned the entire status block
     * three times over — a 900-character "detail" saying the same thing about
     * every feature. The value wanted here is this feature's own verdict.
     */
    const line = (label: string) => {
      const m = new RegExp(`${label}\\s*([A-Za-z][A-Za-z0-9 ,/-]{0,60})`, "i").exec(text);
      return m ? `${label} ${m[1].replace(/\s+/g, " ").trim()}` : "";
    };
    const canvas = line("Canvas:");
    const webgl = line("WebGL:");
    const raster = line("Rasterization:");
    // "Software only, hardware acceleration unavailable" is the phrase that
    // matters; anything containing "Hardware accelerated" on WebGL is the
    // stack MapLibre actually rides on.
    const on = /hardware accelerated/i.test(webgl) && !/software only/i.test(webgl);
    return {
      on,
      detail:
        [webgl, canvas, raster].filter(Boolean).join(" · ") ||
        `chrome://gpu yielded ${text.length} character(s) and none of them named WebGL, Canvas or ` +
          "Rasterization — this is a READER failure to investigate, not a verdict about the GPU",
    };
  } catch (error) {
    return { on: false, detail: `could not read chrome://gpu — ${(error as Error).message}` };
  }
}

const { browser, what } = await launch();
const gpu = HEADLESS ? { on: false, detail: "headless run, not asked" } : await accelerationStatus(browser);

console.log(`pnpm perf — ${BASE}, zip ${ZIP}, ${RUNS} cold run(s)`);
console.log(`  browser: ${what}`);
console.log(
  gpu.on
    ? `  hardware acceleration: ON — ${gpu.detail}`
    : `  hardware acceleration: OFF or UNKNOWN — ${gpu.detail}\n  ** A run without acceleration is NOT a baseline. **`,
);

const runs: Run[] = [];
for (let i = 0; i < RUNS; i += 1) {
  const context = await browser.context({
    extraHTTPHeaders: RUN_HEADERS,
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    // NOT reducedMotion: the fly-in is the thing being measured.
  });
  /*
   * **THE INIT SCRIPT IS A STRING, AND THAT IS THE WHOLE FIX FOR `P-005`'s NaN.**
   * (2026-08-24, the NJ depth session.)
   *
   * This was a FUNCTION, and Playwright serialises a function to source and
   * evaluates it in the page. `tsx` transpiles this file with esbuild, and
   * esbuild's name-keeping wraps a named arrow — `const tick = () => …` — as
   * `__name(() => …, "tick")`. **`__name` does not exist in the page**, so the
   * init script threw `ReferenceError: __name is not defined` before reaching
   * `requestAnimationFrame(tick)`.
   *
   * The frame recorder therefore never started. `store.t.length > 2` was false
   * on every run, and the report printed `NaN` for the median frame, the worst
   * frame and LCP — which is precisely the output `P-005` sat open on, read as
   * *"the instrument does not work on this hardware"*. It works. It was never
   * running.
   *
   * Proven before it was fixed: a minimal reproduction against the same local
   * build recorded `window.__perf` with **0 frames** and exactly one page
   * error, `ReferenceError: __name is not defined`.
   *
   * A string cannot be transpiled, so the page gets what is written here.
   */
  await context.addInitScript({
    content: `(() => {
      try {
        sessionStorage.setItem(
          "wtp.approximate_location",
          JSON.stringify({ zip: ${JSON.stringify(ZIP)}, savedAt: new Date().toISOString() })
        );
        localStorage.setItem("wtp.tutorial_seen", "1");
        localStorage.setItem("wtp.theme", "dark");
      } catch (e) {}
      /* The frame recorder starts BEFORE navigation, so the fly-in cannot
         begin before the instrument is watching it. */
      window.__perf = { t: [], lcp: NaN };
      requestAnimationFrame(function tick() {
        window.__perf.t.push(performance.now());
        requestAnimationFrame(tick);
      });
      /* LCP is NOT retrievable with getEntriesByType after the fact — the entry
         type is only delivered to a registered observer. Reading it the other
         way is what printed "largest contentful paint: not measured" on every
         run, which is a fact about the reader rather than about the page. */
      try {
        new PerformanceObserver(function (list) {
          var entries = list.getEntries();
          if (entries.length) window.__perf.lcp = entries[entries.length - 1].startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
      } catch (e) {}
    })();`,
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(14_000);

  const result = (await page.evaluate(`(() => {
    const out = { fcp: NaN, lcp: NaN, mapReady: NaN, flyFrames: 0, flyMs: 0, worstFrame: NaN, medianFrame: NaN, dropped: 0 };
    for (const e of performance.getEntriesByType("paint")) {
      if (e.name === "first-contentful-paint") out.fcp = e.startTime;
    }
    /* Read from the OBSERVER installed before navigation, never from
       getEntriesByType — that entry type is only delivered to a registered
       observer, and reading it the other way is what printed "largest
       contentful paint: not measured" on every run this project has taken. */
    if (window.__perf && Number.isFinite(window.__perf.lcp)) out.lcp = window.__perf.lcp;

    const store = window.__perf;
    if (store && store.t.length > 2) {
      const deltas = [];
      for (let i = 1; i < store.t.length; i++) deltas.push(store.t[i] - store.t[i - 1]);
      const sorted = deltas.slice().sort((a, b) => a - b);
      out.flyFrames = deltas.length;
      out.flyMs = store.t[store.t.length - 1] - store.t[0];
      out.worstFrame = sorted[sorted.length - 1];
      out.medianFrame = sorted[Math.floor(sorted.length / 2)];
      // A "dropped" frame is one whose gap is at least two refresh intervals,
      // measured against THIS display's own median rather than an assumed
      // 60 Hz — a 120 Hz laptop would otherwise report every frame as good
      // and a 30 Hz remote session would report every frame as dropped.
      const cadence = sorted[Math.floor(sorted.length / 2)];
      out.dropped = deltas.filter((d) => d > cadence * 1.8).length;
    }
    return out;
  })()`)) as Run;

  runs.push(result);
  console.log(
    `  run ${i + 1}: FCP ${result.fcp.toFixed(0)}ms, LCP ${result.lcp.toFixed(0)}ms, ` +
      `median frame ${result.medianFrame.toFixed(1)}ms, worst ${result.worstFrame.toFixed(1)}ms, ` +
      `${result.dropped} dropped of ${result.flyFrames}`,
  );
  await context.close();
}
await browser.close();

const median = (v: number[]) => {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : Number.NaN;
};
const fcp = median(runs.map((r) => r.fcp));
const lcp = median(runs.map((r) => r.lcp));
const medFrame = median(runs.map((r) => r.medianFrame));
const worst = Math.max(...runs.map((r) => r.worstFrame));
const dropped = Math.max(...runs.map((r) => r.dropped));
const frames = runs.reduce((a, r) => a + r.flyFrames, 0);

const n = (x: number, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : "not measured");

console.log(`\n  time to first meaningful paint  ${n(fcp)} ms`);
console.log(`  largest contentful paint        ${n(lcp)} ms`);
console.log(`  median frame during the fly-in  ${n(medFrame, 1)} ms`);
console.log(`  worst frame                     ${n(worst, 1)} ms`);
console.log(`  dropped frames (worst run)      ${dropped} of ${frames} sampled`);
console.log(`\n  NO BUDGET IS ASSERTED. These numbers are for the author to rule on.`);
console.log(`  written to ${OUT}`);

/**
 * **The measurement day, in America/Phoenix — never the UTC instant.**
 * (Fixed 2026-08-24, caught by the pre-commit date gate on the first baseline
 * this project ever tried to commit.)
 *
 * This was `new Date().toISOString()`, which stamped `2026-08-25T05:27:36Z` on
 * a run made on the evening of 2026-08-24. `CLAUDE.md` names that exact bug: *a
 * UTC read after 5pm local is a day ahead, and that is the same bug wearing a
 * smaller hat.* A baseline dated tomorrow is a baseline nobody can line up
 * against the change that produced it.
 *
 * @freshness-reads-here — the clock stamps in the path that PERFORMED the
 * measurement, which is the declared carve-out in RULING 107, not a restamp.
 */
const stamp = `${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix" }).format(new Date())} (America/Phoenix)`;
writeFileSync(
  OUT,
  `# Performance baseline

Written by \`pnpm perf\`. **This file asserts nothing.** It is the measurement
the author rules on; the frame budget is UNSET until he picks one, and
\`pnpm measure:fly\` no longer asserts the retired 32 ms absolute.

- Measured: ${stamp}
- Target: ${BASE}, zip ${ZIP}, ${RUNS} cold run(s)
- Browser: ${what}
- **Hardware acceleration: ${gpu.on ? "ON" : "OFF or UNKNOWN"}** — ${gpu.detail}
${gpu.on ? "" : "\n> A run without hardware acceleration is NOT a baseline. Re-run on a machine\n> where Chrome reports WebGL as hardware accelerated before ruling on these\n> numbers.\n"}
| Measurement | Value |
|---|---|
| Time to first meaningful paint | ${n(fcp)} ms |
| Largest contentful paint | ${n(lcp)} ms |
| Median frame during the fly-in | ${n(medFrame, 1)} ms |
| Worst frame | ${n(worst, 1)} ms |
| Dropped frames (worst run) | ${dropped} of ${frames} sampled |

A frame counts as dropped when its gap exceeds 1.8x this display's own median
frame interval — measured, not assumed, so a 120 Hz laptop and a 30 Hz remote
session are both judged against themselves.

## Per run

| Run | FCP ms | LCP ms | Median frame ms | Worst frame ms | Dropped | Frames |
|---|---|---|---|---|---|---|
${runs
  .map(
    (r, i) =>
      `| ${i + 1} | ${n(r.fcp)} | ${n(r.lcp)} | ${n(r.medianFrame, 1)} | ${n(r.worstFrame, 1)} | ${r.dropped} | ${r.flyFrames} |`,
  )
  .join("\n")}
`,
  "utf8",
);
