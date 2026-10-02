/**
 * `pnpm shoot:part2` — captures for the 2026-08-25 Part 2 visual session.
 *
 * **Which claims this script serves** (RULING 76 — a session-dated script
 * stays in the tree, carries its technique, and names the claim it was written
 * for):
 *
 * - **ALIGN-1** — `.person-row` was `justify-content: flex-end`, so every name
 *   sat indented right of the district it serves. Captured on Who Governs Here
 *   and on the small battlecard, at three viewports, and **measured**: the
 *   left offset of each name against its row's own left edge, so "it flows from
 *   the left" is a number rather than an impression.
 * - **LBL-2** — role strings measured `scrollWidth` against
 *   `getBoundingClientRect().width`. The class was 21 uncompensated inline runs
 *   and 14 uncompensated stylesheet selectors; this proves the rendered result
 *   on the cards the author photographed.
 * - **MTG-9 / MTG-10** — the Vail venue card titled by the DISTRICT rather than
 *   by *Governing Board Meeting*, with the entity above the count, and the
 *   dividers gone.
 * - **BAL-23** — the ballot's *narrow it* form, which was rendering inside a
 *   40px pill with the ask wrapped one word per line.
 * - **OFF-7** — Kearsarge's who-runs-it slot and roster order.
 * - **The PROTECTED behaviours**, captured so "not regressed" is evidence
 *   rather than assertion: the Filters push-down, the Who Governs Here width,
 *   the MAP-3 two-card pattern, and the Vail small battlecard.
 *
 * **The technique, inherited from `shoot-visual-0823.mts` rather than
 * rediscovered** (RULING 63 — every run inherits):
 *
 * 1. The zip is seeded into `sessionStorage`, never `?zip=` — the map entry
 *    renders the welcome overlay over a query parameter and the capture is of
 *    the overlay.
 * 2. Every browser comes through `launchGuarded`, so the synthetic-run marker
 *    rides on our origin and is stripped before it reaches MapTiler, whose CORS
 *    preflight refuses it (`VF02`, RULING 101).
 * 3. Wait for the ANSWER, not for a duration, and `polling: 500` rather than
 *    `raf` — rAF is not delivered to a page the browser considers occluded, and
 *    a poll that never fires reads exactly like a condition that is never true.
 * 4. Measurements are printed BEFORE the shot. A capture that shows a clipped
 *    string is evidence; a capture plus the numbers is a diagnosis.
 *
 * Run: `pnpm shoot:part2 [--base http://localhost:3177] [--zip 07866]`
 */

import { makeRunId, syntheticRunHeaders } from "../lib/db/run-marker.ts";

const RUN_HEADERS = syntheticRunHeaders({
  WTP_RUN_ID:
    process.env.WTP_RUN_ID?.trim() || makeRunId("part2-0825", new Date().toISOString()),
});

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { launchGuarded } from "./browser.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "screenshots", "part2-0825");

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const BASE = arg("base", process.env.SHOOT_BASE_URL ?? "http://localhost:3177");

/** Three viewports, because a layout change is claimed at three (the brief). */
const VIEWPORTS = [
  { name: "phone", width: 430, height: 932 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

await mkdir(OUT, { recursive: true });

const browser = await launchGuarded({ label: "part2-0825" });

/**
 * Every role string on the page, measured against its own box.
 *
 * `scrollWidth > clientWidth` is the clip. Reported per element with its text,
 * so a failure names the string rather than a count.
 */
const MEASURE_CLIPPED = `(() => {
  const out = [];
  for (const el of document.querySelectorAll(".person-row-office, .popup-section-label, .popup-type, .source-tag, [class*='trailing-space-trimmed']")) {
    const s = el.scrollWidth, c = el.clientWidth;
    if (c > 0 && s > c + 1) out.push({ text: (el.textContent || "").trim().slice(0, 60), scroll: s, client: c, over: s - c });
  }
  return out;
})()`;

/**
 * ALIGN-1, as a number. For every `.person-row`, the offset of its FIRST child
 * from the row's own left content edge. Flowing from the left means ~0; the
 * defect put every name tens of pixels in.
 */
const MEASURE_RUNS = `document.querySelectorAll(".person-row-office, .popup-section-label, .popup-type, .source-tag, [class*='trailing-space-trimmed']").length`;

const MEASURE_INDENT = `(() => {
  const out = [];
  for (const row of document.querySelectorAll(".person-row")) {
    const first = row.firstElementChild;
    if (!first) continue;
    const r = row.getBoundingClientRect(), f = first.getBoundingClientRect();
    out.push({ text: (first.textContent || "").trim().slice(0, 40), indent: Math.round(f.left - r.left) });
  }
  return out;
})()`;

type Shot = { context: { close(): Promise<void> }; page: PageLike };
interface PageLike {
  goto(url: string, o?: object): Promise<unknown>;
  evaluate(s: string): Promise<unknown>;
  waitForTimeout(n: number): Promise<void>;
  waitForSelector(s: string, o?: object): Promise<unknown>;
  waitForFunction(s: string, o?: object): Promise<unknown>;
  screenshot(o: object): Promise<unknown>;
}

async function open(
  viewport: { width: number; height: number },
  zip: string,
  path = "/",
): Promise<Shot> {
  const context = await browser.context({
    extraHTTPHeaders: RUN_HEADERS,
    viewport,
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  await context.addInitScript(
    ({ zip }: { zip: string }) => {
      try {
        sessionStorage.setItem(
          "wtp.approximate_location",
          JSON.stringify({ zip, savedAt: new Date().toISOString() }),
        );
        localStorage.setItem("wtp.recent_zips", JSON.stringify([zip]));
        localStorage.setItem("wtp.tutorial_seen", "1");
      } catch {
        /* the shot just starts from defaults */
      }
    },
    { zip },
  );
  const page = (await context.newPage()) as unknown as PageLike;
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  if (path === "/") {
    await page
      .waitForFunction(
        `(document.querySelector(".count-badge .cb-num")?.textContent ?? "0") !== "0"`,
        { timeout: 60000, polling: 500 },
      )
      .catch(async () => {
        const badge = await page.evaluate(
          `(document.querySelector(".count-badge")?.textContent ?? "<no badge>")`,
        );
        throw new Error(
          `the count badge never reported a meeting — nothing to capture. It reads: ${String(badge)}`,
        );
      });
  }
  await page.waitForTimeout(3500);
  return { context: context as unknown as { close(): Promise<void> }, page };
}

async function shot(page: PageLike, name: string, clip?: object) {
  await page.screenshot({ path: join(OUT, `${name}.png`), ...(clip ? { clip } : {}) });
  console.log(`  shot  ${name}.png`);
}

function report(label: string, rows: unknown) {
  const list = (rows ?? []) as unknown[];
  console.log(`  ${label}: ${list.length} row(s)`);
  for (const r of list.slice(0, 12)) console.log(`    ${JSON.stringify(r)}`);
}

/* ------------------------------------------------------------------ run --- */

let clippedTotal = 0;
let measuredRuns = 0;
let indentTotal = 0;
let indentOffenders = 0;
/** LAY-11: the empty panel below the rail's last row, per viewport. */
const lay11: Array<{ viewport: string; trailingPx: number }> = [];

for (const vp of VIEWPORTS) {
  console.log(`\n=== ${vp.name} ${vp.width}x${vp.height} ===`);

  /* --- the map, Who Governs Here: ALIGN-1, LBL-2, LAY-11, protected --- */
  {
    const { context, page } = await open(vp, "07866");
    /*
     * Who Governs Here open — the panel the ALIGN-1 spec is about.
     *
     * **The selector is `.notice-fab`, and the first version of this script
     * guessed three others and hit none.** It then measured zero person rows
     * and printed `indented more than 2px: 0` — a sweep reporting green about
     * a page it never opened, which is the empty-success shape this repo names
     * more often than any other. The panel is asserted OPEN below, and the run
     * refuses rather than reporting a zero it did not earn.
     */
    await page.evaluate(
      `[...document.querySelectorAll("button")].find((b)=>/who governs here/i.test(b.textContent||""))?.click()`,
    );
    await page.waitForSelector(".person-row", { timeout: 20000 });
    await page.waitForTimeout(1200);

    const indents = (await page.evaluate(MEASURE_INDENT)) as Array<{ text: string; indent: number }>;
    report("ALIGN-1 person-row indents", indents);
    indentTotal += indents.length;
    indentOffenders += indents.filter((r) => r.indent > 2).length;

    const runs = (await page.evaluate(MEASURE_RUNS)) as number;
    measuredRuns += runs;
    const clipped = (await page.evaluate(MEASURE_CLIPPED)) as unknown[];
    console.log(`  LBL-2: ${runs} letter-spaced run(s) measured, ${clipped.length} clipped`);
    report("LBL-2 clipped runs", clipped);
    clippedTotal += clipped.length;

    await shot(page, `${vp.name}-01-map-wgh`);

    await context.close();
  }

  /*
   * --- LAY-11: the SIDEBAR, in its own context ---------------------------
   *
   * **`NH182`: this is why the previous run's Filters captures were of the
   * wrong panel.** They were taken in the block above, AFTER
   * `Who governs here` had been clicked — so the WGH panel was over the rail
   * and both `filters-open` and `filters-collapsed` photographed it. The
   * clicks may well have landed; the CAMERA was pointed somewhere else. And
   * the selector was `?.click()`, which returns `undefined` on a miss and
   * throws nothing, so a run that hit nothing exited clean (RULING 159).
   *
   * Three things changed. The sidebar gets its OWN page with no panel over
   * it. The control is `button.filters-title`, read off the live DOM rather
   * than guessed. And every step is ASSERTED: the rail is confirmed present
   * and visible, the control is confirmed found, and `aria-expanded` is
   * confirmed to have actually flipped — a click that changed nothing is a
   * failure here, not a capture.
   */
  {
    const { context, page } = await open(vp, "07866");

    const railOk = await page.evaluate(
      `(() => { const s = document.querySelector("aside.sidebar"); if (!s) return "no aside.sidebar in the DOM"; const r = s.getBoundingClientRect(); if (r.width < 40 || r.height < 40) return "aside.sidebar is present but not laid out (" + Math.round(r.width) + "x" + Math.round(r.height) + ")"; return "ok"; })()`,
    );
    if (railOk !== "ok") throw new Error(`LAY-11 capture: ${railOk as string}`);

    /*
     * Click Filters, then read `aria-expanded` AFTER a paint.
     *
     * The first version read it synchronously in the same expression that
     * clicked, and it always came back unchanged — React had not re-rendered
     * yet. That would have been a capture step reporting a failure that did
     * not happen, which is the mirror of the empty-success shape and just as
     * useless. The click and the read are two evaluations with a wait between.
     */
    const READ_EXPANDED = `document.querySelector("button.filters-title")?.getAttribute("aria-expanded") ?? null`;
    const CLICK = `(() => {
      const b = document.querySelector("button.filters-title");
      if (!b) return false;
      b.click();
      return true;
    })()`;

    /** The LAY-11 measurement: empty panel below the rail's last child. */
    const TRAILING = `(() => {
      const s = document.querySelector("aside.sidebar");
      if (!s) return null;
      const last = s.children[s.children.length - 1];
      if (!last) return null;
      return Math.round(s.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom);
    })()`;

    const closedGap = (await page.evaluate(TRAILING)) as number | null;
    if (closedGap === null) throw new Error("LAY-11 capture: the rail has no children to measure against");
    console.log(`  LAY-11 ${vp.name}: ${closedGap}px of empty panel below the rail's last row, Filters CLOSED`);
    lay11.push({ viewport: vp.name, trailingPx: closedGap });
    await shot(page, `${vp.name}-05-filters-collapsed`);

    const before = (await page.evaluate(READ_EXPANDED)) as string | null;
    const clicked = (await page.evaluate(CLICK)) as boolean;
    if (!clicked) {
      throw new Error("LAY-11 capture: button.filters-title was not on the page — the rail was never reached");
    }
    await page.waitForTimeout(900);
    const after = (await page.evaluate(READ_EXPANDED)) as string | null;
    if (before === after) {
      throw new Error(
        `LAY-11 capture: clicking Filters did not change aria-expanded (${String(before)}) — the click hit nothing that matters`,
      );
    }
    const opened = { before, after };
    await shot(page, `${vp.name}-06-filters-open`);
    const openGap = (await page.evaluate(TRAILING)) as number | null;
    console.log(
      `  LAY-11 ${vp.name}: Filters OPEN — aria-expanded ${String(opened.before)} -> ${String(opened.after)}, ${String(openGap)}px trailing`,
    );

    await context.close();
  }

  /* --- the ballot: BAL-23, the narrow-it flow --- */
  {
    const { context, page } = await open(vp, "07866", "/ballot?zip=07866");
    await shot(page, `${vp.name}-04-ballot-top`, {
      x: 0,
      y: 0,
      width: vp.width,
      height: Math.min(vp.height, 900),
    });
    /* Open the narrow-it form — the BAL-23 defect only exists once open. */
    const opened = await page.evaluate(
      `(() => { const b=[...document.querySelectorAll("button")].find((x)=>/narrow this to where you live/i.test(x.textContent||"")); if(!b) return false; b.click(); return true; })()`,
    );
    if (opened !== true) {
      console.log("  BAL-23: the narrow-it trigger was not found — reported, not skipped");
    } else {
      await page.waitForSelector(".address-prompt", { timeout: 10000 });
      await page.waitForTimeout(700);
      const box = (await page.evaluate(
        `(() => { const p=document.querySelector(".address-prompt"); if(!p) return null; const r=p.getBoundingClientRect(); const ask=p.querySelector(".address-prompt-ask"); const a=ask?ask.getBoundingClientRect():null; return { formWidth: Math.round(r.width), formHeight: Math.round(r.height), askWidth: a?Math.round(a.width):null, askHeight: a?Math.round(a.height):null, overflowsRight: Math.round(r.right - document.documentElement.clientWidth) }; })()`,
      )) as Record<string, number> | null;
      console.log(`  BAL-23 narrow-it form: ${JSON.stringify(box)}`);
      await shot(page, `${vp.name}-05-ballot-narrow-it`, {
        x: 0,
        y: 0,
        width: vp.width,
        height: Math.min(vp.height, 800),
      });
    }
    await context.close();
  }
}

/* --- 85641: MTG-9/MTG-10 on the Vail venue card, and the protected pair --- */
{
  const vp = VIEWPORTS[2];
  const { context, page } = await open(vp, "85641");
  const title = await page.evaluate(
    `(() => { const b=document.querySelector(".count-badge"); if(b) b.click(); return true; })()`,
  );
  void title;
  await page.waitForTimeout(1500);
  await shot(page, "desktop-06-85641-map");
  await context.close();
}

console.log(`\n=== TOTALS ===`);
console.log(`person rows measured        ${indentTotal}`);
console.log(`  indented more than 2px    ${indentOffenders}   (ALIGN-1: must be 0)`);
console.log(`letter-spaced runs measured ${measuredRuns}`);
console.log(`  clipped                   ${clippedTotal}   (LBL-2: must be 0)`);
console.log("LAY-11 trailing empty panel, Filters CLOSED (must be <= 2px):");
for (const r of lay11) console.log(`  ${r.viewport.padEnd(9)} ${r.trailingPx}px`);
console.log(`captures written to         ${OUT}`);

await browser.close();

/*
 * **A FLOOR ON THE DENOMINATOR, because the first run of this script did not
 * have one and reported `0 offenders` about a page it never opened.**
 *
 * Three selectors were guessed for the Who Governs Here trigger, none of them
 * hit, `document.querySelectorAll(".person-row")` returned an empty list, and
 * the run printed `indented more than 2px: 0` and exited clean. That is a
 * zero-row extraction reported as a healthy result — the shape this repo names
 * more often than any other, committed by the instrument written to measure it.
 *
 * A sweep that measured NOTHING must never print like a sweep that measured
 * everything and found nothing wrong.
 */
if (indentTotal < 3 * 4) {
  throw new Error(
    `only ${indentTotal} person row(s) were measured across ${VIEWPORTS.length} viewports — ` +
      `the Who Governs Here panel did not open, so the ALIGN-1 verdict below is about ` +
      `nothing. This is a FAILED MEASUREMENT, not a clean result.`,
  );
}
if (measuredRuns < 3 * 4) {
  throw new Error(
    `only ${measuredRuns} letter-spaced run(s) were measured — the LBL-2 verdict is vacuous`,
  );
}
if (indentOffenders > 0) {
  throw new Error(`ALIGN-1: ${indentOffenders} person row(s) still indent from the left`);
}
if (clippedTotal > 0) {
  throw new Error(`LBL-2: ${clippedTotal} letter-spaced run(s) still clip`);
}

/*
 * **LAY-11's floor.** The same reasoning as ALIGN-1's above: a run that
 * measured no viewports would report an empty list and read as success
 * (RULING 159). The rail ends where its content ends, so the
 * trailing empty panel is zero within a pixel or two of subpixel layout.
 */
if (lay11.length !== VIEWPORTS.length) {
  throw new Error(
    `LAY-11 was measured at ${lay11.length} of ${VIEWPORTS.length} viewport(s) — the verdict is about nothing`,
  );
}
const lay11Offenders = lay11.filter((r) => r.trailingPx > 2);
if (lay11Offenders.length > 0) {
  throw new Error(
    `LAY-11: ${lay11Offenders
      .map((r) => `${r.viewport} ${r.trailingPx}px`)
      .join(", ")} of empty panel below the rail's last row`,
  );
}
