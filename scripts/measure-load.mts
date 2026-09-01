/**
 * M139 sub-item 4 — the load budget, measured rather than asserted.
 *
 *   pnpm measure:load                                  # against production
 *   SHOOT_BASE_URL=http://localhost:3000 pnpm measure:load
 *   LOAD_RUNS=5 LOAD_ZIP=85701 pnpm measure:load
 *
 * ## The budget, from the row
 *
 *   ballot interactive        under 2.5s
 *   map first meaningful paint under 3.0s
 *
 * ## The method, stated so a later session can compare rather than guess
 *
 * Every run is a FRESH Playwright context, which carries an empty HTTP cache
 * and empty storage — that is the "cold cache" the row asks for, and it is
 * why the numbers are worse than a reload and should be. The reader's zip is
 * seeded into `sessionStorage` before first paint so the measurement covers
 * the app doing its work, not a human typing.
 *
 * The two numbers are defined against the reader's question, not against a
 * convenient event:
 *
 *   BALLOT INTERACTIVE — from `navigationStart` until the ballot page has
 *   both rendered its content and become able to answer a click. Taken as the
 *   later of `domInteractive` and the moment a real ballot control is present
 *   in the DOM. `domInteractive` alone would pass on an empty shell; the
 *   element alone would pass on a page that has painted but is still parsing.
 *
 *   MAP FIRST MEANINGFUL PAINT — from `navigationStart` until the map has
 *   painted something that MEANS anything: the canvas existing is not it, and
 *   neither is the shell. Taken as the moment the first pin is in the marker
 *   pool, because a map of the reader's area with no pins on it has not yet
 *   answered the question they came with. Reported alongside the browser's
 *   own `first-contentful-paint` so the gap between "something appeared" and
 *   "the answer appeared" is visible rather than hidden inside one number.
 *
 * Profile: Chromium headless, desktop 1280x800 and phone 390x844, no CPU or
 * network throttling, run from the author's machine. Throttling is
 * deliberately NOT applied — an unthrottled number is reproducible across
 * machines in a way a "4x CPU slowdown" is not, and the budget was written
 * without one. A session that adds throttling must say so and must not
 * compare its numbers to these.
 *
 * ## What it prints
 *
 * Per run and per surface: the measurement, the budget, and PASS or the
 * MEASURED GAP. Never a silent pass — a run that could not reach its subject
 * prints NOT REACHED and is excluded from the median rather than counted as
 * a success.
 */

import { makeRunId, syntheticRunHeaders } from "../lib/db/run-marker.ts";
import { launchGuarded, type GuardedBrowser } from "./browser.mts";

import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";

const BASE = (process.env.SHOOT_BASE_URL ?? PUBLIC_SITE_ORIGIN).replace(
  /\/$/,
  "",
);
const RUN_ID =
  process.env.WTP_RUN_ID ?? makeRunId("g14-m139-load", new Date().toISOString());
const RUN_HEADERS = syntheticRunHeaders({ ...process.env, WTP_RUN_ID: RUN_ID });

const ZIP = process.env.LOAD_ZIP ?? "85701";
const RUNS = Number(process.env.LOAD_RUNS ?? 5);

const BALLOT_BUDGET_MS = 2500;
const MAP_FMP_BUDGET_MS = 3000;

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
} as const;

type Surface = "ballot" | "map";
type Which = keyof typeof VIEWPORTS;

let probeRows = 0;

interface Measurement {
  surface: Surface;
  viewport: Which;
  /** null when the run could not reach its subject. */
  ms: number | null;
  fcp: number | null;
  note: string;
}

async function measure(
  browser: GuardedBrowser,
  surface: Surface,
  viewport: Which,
): Promise<Measurement> {
  const context = await browser.context({
    extraHTTPHeaders: RUN_HEADERS,
    viewport: VIEWPORTS[viewport],
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
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
  const page = await context.newPage();
  page.on("response", (r) => {
    if (r.url().includes("/api/meetings")) probeRows += 1;
  });

  try {
    const url = surface === "ballot" ? `${BASE}/ballot` : BASE;
    await page.goto(url, { waitUntil: "commit", timeout: 90_000 });

    /*
     * The ballot page's own h1, not `.ballot-pill` — that pill lives on the
     * MAP and is absent here, so the first version of this script reported
     * "NOT REACHED" six times against a perfectly healthy page. A probe that
     * cannot find its subject prints an instrument failure, and reading one
     * as a product finding is the mistake this whole file exists to avoid.
     */
    const selector =
      surface === "ballot" ? "main h1" : ".map-pin, .maplibregl-marker";

    let reached = true;
    try {
      await page.waitForSelector(selector, { timeout: 30_000, state: "attached" });
    } catch {
      reached = false;
    }

    if (!reached) {
      return {
        surface,
        viewport,
        ms: null,
        fcp: null,
        note: `NOT REACHED — no ${surface === "ballot" ? "ballot control" : "pin"} within 30s`,
      };
    }

    // Read the clock the BROWSER kept, not the wall clock this script kept:
    // `performance.now()` is measured from navigationStart inside the page, so
    // it excludes Playwright's own dispatch latency.
    const timing = (await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      const paint = performance
        .getEntriesByType("paint")
        .find((p) => p.name === "first-contentful-paint");
      return {
        now: performance.now(),
        domInteractive: nav ? nav.domInteractive : null,
        fcp: paint ? paint.startTime : null,
      };
    })) as { now: number; domInteractive: number | null; fcp: number | null };

    // The ballot number is the LATER of the two signals, for the reason in the
    // header: either one alone passes on a page that is not actually usable.
    const ms =
      surface === "ballot"
        ? Math.max(timing.now, timing.domInteractive ?? 0)
        : timing.now;

    return { surface, viewport, ms, fcp: timing.fcp, note: "" };
  } finally {
    await context.close();
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const browser = await launchGuarded({ label: "measure-load" });

console.log(`\nM139 load budget — ${BASE}, zip ${ZIP}, run id ${RUN_ID}`);
console.log(
  `${RUNS} cold run(s) per surface per viewport. Fresh context each run ` +
    `(empty cache and storage). Chromium headless, no throttling.\n`,
);

const all: Measurement[] = [];
try {
  for (const viewport of Object.keys(VIEWPORTS) as Which[]) {
    for (const surface of ["ballot", "map"] as Surface[]) {
      for (let i = 0; i < RUNS; i++) {
        const m = await measure(browser, surface, viewport);
        all.push(m);
        const shown =
          m.ms === null
            ? m.note
            : `${(m.ms / 1000).toFixed(2)}s` +
              (m.fcp !== null ? ` (FCP ${(m.fcp / 1000).toFixed(2)}s)` : "");
        console.log(`  ${viewport.padEnd(7)} ${surface.padEnd(6)} run${i + 1}  ${shown}`);
      }
    }
  }
} finally {
  await browser.close();
}

console.log("\n────────────────────────────────────────");
let anyOver = false;
for (const viewport of Object.keys(VIEWPORTS) as Which[]) {
  for (const surface of ["ballot", "map"] as Surface[]) {
    const budget = surface === "ballot" ? BALLOT_BUDGET_MS : MAP_FMP_BUDGET_MS;
    const rows = all.filter((m) => m.surface === surface && m.viewport === viewport);
    const got = rows.filter((m) => m.ms !== null).map((m) => m.ms as number);
    const missed = rows.length - got.length;

    const label =
      `${viewport} ${surface === "ballot" ? "interactive" : "first meaningful paint"}`.padEnd(
        36,
      );

    if (got.length === 0) {
      console.log(`${label} COULD NOT RUN — ${rows.length} of ${rows.length} never reached`);
      continue;
    }

    const med = median(got);
    const worst = Math.max(...got);
    const verdict =
      med <= budget
        ? `PASS (budget ${(budget / 1000).toFixed(1)}s)`
        : `OVER by ${((med - budget) / 1000).toFixed(2)}s (budget ${(budget / 1000).toFixed(1)}s)`;
    if (med > budget) anyOver = true;

    console.log(
      `${label} median ${(med / 1000).toFixed(2)}s, worst ${(worst / 1000).toFixed(2)}s` +
        `${missed > 0 ? `, ${missed} not reached` : ""}  — ${verdict}`,
    );
  }
}

console.log(
  `\n/api/meetings responses at ${BASE}: ${probeRows}` +
    (BASE.includes("localhost")
      ? " — LOCAL, no production rows written"
      : " — production search-log rows, declared SYNTHETIC"),
);
console.log(`run id (SYNTHETIC): ${RUN_ID}`);
if (anyOver) {
  console.log(
    "\nAt least one surface is over budget. The row records the measured gap; " +
      "it is not a silent pass.",
  );
}
