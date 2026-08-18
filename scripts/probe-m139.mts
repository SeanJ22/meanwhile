/**
 * M139 sub-item 1 — the half-load, instrumented before it is fixed.
 *
 *   pnpm probe:m139
 *   SHOOT_BASE_URL=http://localhost:3000 pnpm probe:m139
 *   M139_ZIP=03255 M139_RUNS=6 pnpm probe:m139
 *
 * ## The report this is chasing
 *
 * "Arriving from an NH zip, or returning from the ballot page, the sidebar
 * sometimes renders BLANK and WGH sometimes half." Recorded across three
 * sessions and never diagnosed, with two suspects on the row: a race between
 * zip resolution and panel mount, and state retained across navigation. g12
 * added a third — a hydration mismatch, having found one of exactly that
 * class in the pick control.
 *
 * ## Why "sometimes" is the thing to measure
 *
 * Same shape as R47: a surface that is empty for a few hundred milliseconds
 * and then fills reads as "sometimes blank" to anyone who looks once. So this
 * does not look once. It samples the four stat tiles, the coverage line and
 * the who-governs card every 100 ms through both of the reported entrances —
 * a cold arrival at the zip, and a return from the ballot page — and reports
 * the FLOOR each surface reached and how long it stayed there.
 *
 * A blank that lasts 300 ms and a blank that lasts forever are different
 * defects. Naming which one this is decides whether the fix is a carry or a
 * mount ordering.
 *
 * ## Probe rows
 *
 * Declared SYNTHETIC. The count is printed and named against the base it hit.
 */
import { type Page } from "playwright";

import { makeRunId, syntheticRunHeaders } from "../lib/db/run-marker.ts";
import { launchGuarded, type GuardedBrowser } from "./browser.mts";

const BASE = (process.env.SHOOT_BASE_URL ?? "https://sparkwtp.netlify.app").replace(
  /\/$/,
  "",
);

const RUN_ID =
  process.env.WTP_RUN_ID ?? makeRunId("g14-m139-probe", new Date().toISOString());
const RUN_HEADERS = syntheticRunHeaders({ ...process.env, WTP_RUN_ID: RUN_ID });

const ZIP = process.env.M139_ZIP ?? "03255";
const RUNS = Number(process.env.M139_RUNS ?? 3);
const SAMPLE_MS = 100;
const WATCH_MS = Number(process.env.M139_WATCH_MS ?? 9000);

const DESKTOP = { width: 1280, height: 800 };

let probeRows = 0;

interface Shot {
  t: number;
  /** The four stat tiles' numeric values, in render order. */
  tiles: number[];
  /** Whether the "Coverage: …" line is on screen. */
  coverage: boolean;
  /** Characters of text in the who-governs card, 0 when it is not rendered. */
  wghChars: number;
  /** The card's own admission that it is showing a stale answer. */
  refreshing: boolean;
}

async function sample(page: Page): Promise<Shot> {
  // Expression-shaped throughout: no inner named functions, which `tsx`
  // compiles into a call to esbuild's `__name` helper the page does not have.
  const raw = (await page.evaluate(() => {
    // `data-stat` is the tile's own name (item 1d) and `.num` is its number,
    // so this reads the four counts without depending on their visible labels.
    const tiles: number[] = [];
    for (const el of document.querySelectorAll(".stats-bar [data-stat]")) {
      const n = Number((el.querySelector(".num")?.textContent ?? "").replace(/[^0-9]/g, ""));
      tiles.push(Number.isFinite(n) ? n : -1);
    }
    const bar = document.querySelector(".stats-bar");
    const wgh = document.querySelector("[data-refreshing], .coverage-notice, .wgh-card");
    return {
      tiles,
      coverage: /Coverage:/.test(bar?.textContent ?? ""),
      wghChars: (wgh?.textContent ?? "").trim().length,
      refreshing: Boolean(document.querySelector("[data-refreshing='true']")),
    };
  })) as Omit<Shot, "t">;
  return { ...raw, t: 0 };
}

async function watch(page: Page, ms: number, t0: number): Promise<Shot[]> {
  const shots: Shot[] = [];
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const s = await sample(page);
    shots.push({ ...s, t: Date.now() - t0 });
    await page.waitForTimeout(SAMPLE_MS);
  }
  return shots;
}

function summarise(label: string, shots: Shot[]): string {
  if (shots.length === 0) return `${label}: NO SAMPLES`;

  const tileSum = (s: Shot) => s.tiles.reduce((a, b) => a + Math.max(b, 0), 0);
  const peak = Math.max(...shots.map(tileSum));
  const zeroShots = shots.filter((s) => tileSum(s) === 0);
  const noCoverage = shots.filter((s) => !s.coverage);
  const noWgh = shots.filter((s) => s.wghChars === 0);

  const trace = shots
    .filter((_, i) => i % 5 === 0)
    .map((s) => `${(s.t / 1000).toFixed(1)}s:[${s.tiles.join(",")}]${s.coverage ? "" : "!"}`)
    .join(" ");

  return (
    `${label}\n` +
    `    tiles peak ${peak}; all-zero in ${zeroShots.length}/${shots.length} samples ` +
    `(${zeroShots.length * SAMPLE_MS}ms)\n` +
    `    coverage line absent in ${noCoverage.length}/${shots.length} (${noCoverage.length * SAMPLE_MS}ms); ` +
    `who-governs empty in ${noWgh.length}/${shots.length} (${noWgh.length * SAMPLE_MS}ms)\n` +
    `    ${trace}`
  );
}

async function runOnce(browser: GuardedBrowser): Promise<{
  arrival: Shot[];
  ret: Shot[];
}> {
  const context = await browser.context({
    extraHTTPHeaders: RUN_HEADERS,
    viewport: DESKTOP,
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
    /*
     * ENTRANCE 1 — a cold arrival at the zip.
     *
     * Sampling starts the instant the document is parsed, with NO settling
     * wait, because the mount is the window this is trying to see. The first
     * draft waited four seconds first and reported a perfectly healthy rail
     * every time: it was measuring the state AFTER the thing it was looking
     * for had finished.
     *
     * At DESKTOP width, and that is not a detail. The first draft ran at
     * 390px and opened the drawer to reach the stats — but rule 4c makes the
     * rail and the who-governs card mutually exclusive, so opening one closed
     * the other, and the probe reported the card empty in 74 of 74 samples.
     * That was the instrument closing the card it had come to measure, not a
     * finding. At 1280 both surfaces are on screen at once and neither has to
     * be opened.
     */
    const t0 = Date.now();
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
    const arrival = await watch(page, WATCH_MS, t0);

    // ENTRANCE 2 — out to the ballot page and back, the other reported route.
    await page.goto(`${BASE}/ballot`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(4000);
    const t1 = Date.now();
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 90_000 });
    const ret = await watch(page, WATCH_MS, t1);

    return { arrival, ret };
  } finally {
    await context.close();
  }
}

const browser = await launchGuarded({ label: "probe-m139" });

console.log(`\nM139 half-load probe — ${BASE}, zip ${ZIP}, run id ${RUN_ID}`);
console.log(`${RUNS} run(s), sampling every ${SAMPLE_MS}ms for ${WATCH_MS}ms per entrance\n`);

const all: { arrival: Shot[]; ret: Shot[] }[] = [];
try {
  for (let i = 0; i < RUNS; i++) {
    const r = await runOnce(browser);
    all.push(r);
    console.log(summarise(`run${i + 1} ARRIVAL (cold, ${ZIP})`, r.arrival));
    console.log(summarise(`run${i + 1} RETURN  (back from /ballot)`, r.ret));
    console.log("");
  }
} finally {
  await browser.close();
}

const tileSum = (s: Shot) => s.tiles.reduce((a, b) => a + Math.max(b, 0), 0);
const arrivalBlank = all.filter((r) => r.arrival.some((s) => tileSum(s) === 0)).length;
const returnBlank = all.filter((r) => r.ret.some((s) => tileSum(s) === 0)).length;
const arrivalHalf = all.filter((r) =>
  r.arrival.some((s) => tileSum(s) > 0 && !s.coverage),
).length;
const returnHalf = all.filter((r) => r.ret.some((s) => tileSum(s) > 0 && !s.coverage)).length;

console.log("────────────────────────────────────────");
console.log(`runs                                  ${all.length}`);
console.log(`arrival showed an all-zero rail        ${arrivalBlank} of ${all.length}`);
console.log(`return  showed an all-zero rail        ${returnBlank} of ${all.length}`);
console.log(`arrival showed tiles without coverage  ${arrivalHalf} of ${all.length}`);
console.log(`return  showed tiles without coverage  ${returnHalf} of ${all.length}`);
console.log(
  `\n/api/meetings responses at ${BASE}: ${probeRows}` +
    (BASE.includes("localhost")
      ? " — LOCAL, no production rows written"
      : " — production search-log rows, declared SYNTHETIC"),
);
console.log(`run id (SYNTHETIC): ${RUN_ID}`);
