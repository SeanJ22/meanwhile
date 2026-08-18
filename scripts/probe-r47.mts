/**
 * R47 — the instrument, written BEFORE the fix.
 *
 *   pnpm probe:r47                                  # against production
 *   SHOOT_BASE_URL=http://localhost:3000 pnpm probe:r47
 *   R47_RUNS=20 R47_VIEWPORT=both R47_THEME=both pnpm probe:r47
 *
 * ## Why an instrument and not just the walk check
 *
 * `pnpm walk:all` asserts "zooming out never removes pins" by sampling the
 * pin count at three zoom levels with a fixed wait between them. It reported
 * `11 → 12 → 0` on one run and `11 → 12 → 12` on the next, same build,
 * minutes apart. A check that samples ONCE per zoom cannot tell a pool that
 * was WIPED from a pool that is momentarily EMPTY while its replacement is in
 * flight — and those are different defects with different fixes. The row says
 * so in its own words: do not close this on a green walk.
 *
 * So this samples continuously instead. Through the whole zoom-out it records,
 * every 100 ms:
 *
 *   - `__wtpPinCount()`, the map's own answer for how many pins it holds
 *   - whether an `/api/meetings` request is IN FLIGHT, counted off Playwright's
 *     own request/response events rather than off anything in the product
 *   - the who-governs card's `data-refreshing` attribute, which is the app's
 *     OWN signal that it is holding a stale answer
 *
 * Line those three up and the shape is no longer ambiguous. If the pin count
 * drops to zero at the same instant a request goes in flight and returns when
 * it lands, the pool is being emptied by the re-query and refilled by its
 * answer — a flash, on a timer, which a single-sample check catches only when
 * it happens to look during the gap.
 *
 * ## What it prints
 *
 * Per run: the pin count trace, the zoom trace, and — the number that matters
 * — the GAP: how many consecutive milliseconds the map held zero pins after
 * having held some. Across runs: how many runs flashed, out of how many. That
 * rate is the before-and-after measurement the row requires.
 *
 * ## Probe rows
 *
 * Every page load and every settle writes a search-log row. The run declares
 * itself SYNTHETIC through `syntheticRunHeaders()` so those rows are never
 * counted as reader signal, and the total is printed at the end.
 */
import { chromium, type Browser, type Page } from "playwright";

import { makeRunId, syntheticRunHeaders } from "../lib/db/run-marker.ts";

const BASE = (process.env.SHOOT_BASE_URL ?? "https://sparkwtp.netlify.app").replace(
  /\/$/,
  "",
);

const RUN_ID =
  process.env.WTP_RUN_ID ?? makeRunId("g14-r47-probe", new Date().toISOString());
const RUN_HEADERS = syntheticRunHeaders({ ...process.env, WTP_RUN_ID: RUN_ID });

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

const ZIP = process.env.R47_ZIP ?? "85701";
const RUNS = Number(process.env.R47_RUNS ?? 6);
const SAMPLE_MS = 100;
/** Long enough to cover the 650 ms settle debounce plus a slow answer. */
const WATCH_MS = Number(process.env.R47_WATCH_MS ?? 12_000);

type Viewport = "phone" | "desktop";
type Theme = "light" | "dark";

const VIEWPORTS: Viewport[] =
  process.env.R47_VIEWPORT === "both"
    ? ["phone", "desktop"]
    : process.env.R47_VIEWPORT === "desktop"
      ? ["desktop"]
      : ["phone"];

const THEMES: Theme[] =
  process.env.R47_THEME === "both"
    ? ["light", "dark"]
    : process.env.R47_THEME === "dark"
      ? ["dark"]
      : ["light"];

let probeRows = 0;
function countProbe(url: string): void {
  if (url.includes("/api/meetings")) probeRows += 1;
}

type Sample = {
  t: number;
  pins: number;
  zoom: number;
  inFlight: number;
  refreshing: boolean;
};

type RunResult = {
  label: string;
  samples: Sample[];
  /** Longest run of consecutive zero-pin samples that FOLLOWED a non-zero one. */
  gapMs: number;
  /** True when the pool emptied after having been full. */
  flashed: boolean;
  peak: number;
  final: number;
  zoomMoved: boolean;
  reached: boolean;
};

async function openAt(
  browser: Browser,
  viewport: Viewport,
  theme: Theme,
): Promise<{ page: Page; inFlight: () => number }> {
  const context = await browser.newContext({
    extraHTTPHeaders: RUN_HEADERS,
    viewport: viewport === "phone" ? PHONE : DESKTOP,
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
    colorScheme: theme,
  });
  // C05: sendBeacon ignores extraHTTPHeaders, so anything leaving by that
  // path is recorded ORGANIC — our own run counted as a reader in the store
  // we sell. Removing it forces the fetch fallback, which carries the header.
  await context.addInitScript(() => {
    try {
      // @ts-expect-error — removing a DOM method on purpose, in a test context
      delete navigator.sendBeacon;
    } catch {
      // Still declared on every fetch if it cannot be removed.
    }
  });
  await context.addInitScript(
    ({ zip }) => {
      try {
        sessionStorage.setItem(
          "wtp.approximate_location",
          JSON.stringify({ zip, savedAt: new Date().toISOString() }),
        );
        localStorage.setItem("wtp.tutorial_seen", "1");
      } catch {
        // Defaults are fine.
      }
    },
    { zip: ZIP },
  );

  // In-flight counted from OUTSIDE the product: request and response events on
  // the page, so nothing had to be added to the app to see this. A request
  // that fails still resolves through requestfinished/requestfailed, so the
  // counter cannot leak upward and read as a permanent gap.
  let open = 0;
  const page = await context.newPage();
  page.on("request", (r) => {
    if (r.url().includes("/api/meetings")) open += 1;
  });
  page.on("requestfinished", (r) => {
    if (r.url().includes("/api/meetings")) open -= 1;
  });
  page.on("requestfailed", (r) => {
    if (r.url().includes("/api/meetings")) open -= 1;
  });
  page.on("response", (r) => countProbe(r.url()));

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(9000);
  return { page, inFlight: () => open };
}

async function sampleOnce(page: Page): Promise<{
  pins: number;
  zoom: number;
  refreshing: boolean;
}> {
  // Expression-shaped: `tsx` compiles a named inner function into a call to
  // esbuild's `__name` helper, which does not exist in the page.
  return (await page.evaluate(() => {
    const w = window as unknown as {
      __wtpPinCount?: () => number;
      __wtpZoom?: () => number;
    };
    return {
      pins: typeof w.__wtpPinCount === "function" ? w.__wtpPinCount() : -1,
      zoom: typeof w.__wtpZoom === "function" ? w.__wtpZoom() : Number.NaN,
      refreshing: Boolean(document.querySelector("[data-refreshing='true']")),
    };
  })) as { pins: number; zoom: number; refreshing: boolean };
}

async function runOnce(
  browser: Browser,
  viewport: Viewport,
  theme: Theme,
  index: number,
): Promise<RunResult> {
  const label = `${viewport}/${theme}/run${index + 1}`;
  const { page, inFlight } = await openAt(browser, viewport, theme);
  const samples: Sample[] = [];

  try {
    const before = await sampleOnce(page);
    if (before.pins <= 0) {
      // The experiment never started: no pins to lose. Reported as
      // NOT REACHED rather than as a pass — a check that could not run must
      // never print like a check that ran.
      await page.context().close();
      return {
        label,
        samples,
        gapMs: 0,
        flashed: false,
        peak: before.pins,
        final: before.pins,
        zoomMoved: false,
        reached: false,
      };
    }

    const startZoom = before.zoom;
    // The same gesture the walk uses: a camera move carrying an originalEvent,
    // so it takes the settle path a reader's wheel does.
    await page.evaluate(() =>
      (window as unknown as { __wtpZoomOut?: (by?: number) => void }).__wtpZoomOut?.(4),
    );

    const t0 = Date.now();
    while (Date.now() - t0 < WATCH_MS) {
      const s = await sampleOnce(page);
      samples.push({
        t: Date.now() - t0,
        pins: s.pins,
        zoom: s.zoom,
        inFlight: inFlight(),
        refreshing: s.refreshing,
      });
      await page.waitForTimeout(SAMPLE_MS);
    }

    // The gap: the longest stretch of zero-pin samples that came AFTER a
    // non-zero one. Leading zeros would be a page that never loaded pins,
    // which is a different thing and is excluded by construction.
    let gapMs = 0;
    let current = 0;
    let seenNonZero = false;
    for (const s of samples) {
      if (s.pins > 0) {
        seenNonZero = true;
        current = 0;
        continue;
      }
      if (!seenNonZero) continue;
      current += SAMPLE_MS;
      if (current > gapMs) gapMs = current;
    }

    const peak = Math.max(...samples.map((s) => s.pins), before.pins);
    const final = samples.length > 0 ? samples[samples.length - 1].pins : before.pins;
    const endZoom = samples.length > 0 ? samples[samples.length - 1].zoom : startZoom;

    return {
      label,
      samples,
      gapMs,
      flashed: gapMs > 0,
      peak,
      final,
      zoomMoved: Math.abs(endZoom - startZoom) > 0.5,
      reached: true,
    };
  } finally {
    await page.context().close();
  }
}

function describe(run: RunResult): string {
  if (!run.reached) return `${run.label}  NOT REACHED — no pins before the zoom`;

  const trace = run.samples
    .filter((_, i) => i % 5 === 0)
    .map((s) => `${(s.t / 1000).toFixed(1)}s:${s.pins}${s.inFlight > 0 ? "*" : ""}`)
    .join(" ");

  const verdict = run.flashed
    ? `FLASH ${run.gapMs}ms at zero`
    : "no flash — pins never emptied";

  // What was in flight, and what the app itself said, during the gap.
  const gapSamples = run.samples.filter((s) => s.pins === 0);
  const duringGap =
    gapSamples.length > 0
      ? ` | during the gap: inFlight ${Math.max(...gapSamples.map((s) => s.inFlight))}, ` +
        `data-refreshing ${gapSamples.some((s) => s.refreshing) ? "true" : "false"}`
      : "";

  return (
    `${run.label}  ${verdict}  (peak ${run.peak}, final ${run.final}, ` +
    `zoom moved ${run.zoomMoved})${duringGap}\n    ${trace}`
  );
}

const browser = await chromium.launch();
const results: RunResult[] = [];

console.log(`\nR47 probe — ${BASE}, zip ${ZIP}, run id ${RUN_ID}`);
console.log(
  `${RUNS} run(s) per combination, ${VIEWPORTS.join("+")} × ${THEMES.join("+")}, ` +
    `sampling every ${SAMPLE_MS}ms for ${WATCH_MS}ms\n`,
);

try {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      for (let i = 0; i < RUNS; i++) {
        const run = await runOnce(browser, viewport, theme, i);
        results.push(run);
        console.log(describe(run));
      }
    }
  }
} finally {
  await browser.close();
}

const reached = results.filter((r) => r.reached);
const flashed = reached.filter((r) => r.flashed);

console.log("\n────────────────────────────────────────");
console.log(`runs attempted     ${results.length}`);
console.log(`runs that reached  ${reached.length}  (a run with no pins to lose proves nothing)`);
console.log(
  `runs that flashed  ${flashed.length} of ${reached.length}` +
    (reached.length > 0
      ? `  — ${((flashed.length / reached.length) * 100).toFixed(0)}%`
      : ""),
);
if (flashed.length > 0) {
  const gaps = flashed.map((r) => r.gapMs);
  console.log(
    `gap at zero        min ${Math.min(...gaps)}ms, max ${Math.max(...gaps)}ms, ` +
      `median ${gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)]}ms`,
  );
}
// Named against the base it actually hit. Printing "production" while running
// at localhost would misreport where a session's rows landed, which is the
// probe-naming rule broken by the instrument that exists to honour it.
console.log(
  `\n/api/meetings responses at ${BASE}: ${probeRows}` +
    (BASE.includes("localhost")
      ? " — LOCAL, no production rows written"
      : " — production search-log rows, declared SYNTHETIC"),
);
console.log(`run id (SYNTHETIC): ${RUN_ID}`);

if (reached.length === 0) {
  console.log("\nCOULD NOT RUN — no run ever held a pin before its zoom.");
  process.exit(2);
}
