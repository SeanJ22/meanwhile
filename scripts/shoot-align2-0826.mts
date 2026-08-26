/**
 * `pnpm shoot:align2` — captures for the 2026-08-26 all-open-board session.
 *
 * **Which claims this script serves** (RULING 76 — a session-dated script stays
 * in the tree, carries its technique, and names the claim it was written for):
 *
 * - **ALIGN-2** — Sean's 8/26 walkthrough REVERSED `ALIGN-1`. The heading sits
 *   at the margin and the names step in beneath it, and repeated seat labels
 *   collapse to one heading with a list under it. Captured on Who Governs Here
 *   at three viewports and **measured**: the left offset of each holder block
 *   against its row's own left edge, and the number of `U.S. Senator` headings
 *   on the card, so "it indents" and "there is one heading" are numbers rather
 *   than impressions.
 * - **The PROTECTED behaviour**, captured so "not regressed" is evidence rather
 *   than assertion: the Who Governs Here card's own width, unchanged.
 *
 * **The technique is INHERITED from `shoot-part2-0825.mts` rather than
 * rediscovered** (RULING 63 — every run inherits, and a session that rebuilds
 * an existing branch has committed a defect):
 *
 * 1. The zip is seeded into `sessionStorage`, never `?zip=` — the map entry
 *    renders the welcome overlay over a query parameter, and the capture is
 *    then of the overlay.
 * 2. Every browser comes through `launchGuarded`, so the synthetic-run marker
 *    rides on our origin and is stripped before it reaches MapTiler, whose CORS
 *    preflight refuses it (`VF02`, RULING 101).
 * 3. Wait for the ANSWER, not for a duration, with `polling: 500` rather than
 *    `raf` — rAF is not delivered to a page the browser considers occluded.
 * 4. Measurements are printed BEFORE the shot. A capture is evidence; a capture
 *    plus the numbers is a diagnosis.
 *
 * **RULING 159 — the denominator has a floor.** A selector that matches nothing
 * is an ERROR naming the selector and the surface, never a clean `0 offenders`.
 * That is the exact failure this script's predecessor committed, and it is why
 * every measurement below asserts its population before reporting a count.
 *
 * Run: `pnpm shoot:align2 [--base http://localhost:3177] [--zip 85701]`
 */

import { makeRunId, syntheticRunHeaders } from "../lib/db/run-marker.ts";

const RUN_HEADERS = syntheticRunHeaders({
  WTP_RUN_ID:
    process.env.WTP_RUN_ID?.trim() ||
    makeRunId("align2-0826", new Date().toISOString()),
});

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { launchGuarded } from "./browser.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "screenshots", "align2-0826");

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const BASE = arg("base", process.env.SHOOT_BASE_URL ?? "http://localhost:3177");
const ZIP = arg("zip", "85701");

/** Three viewports, because a layout change is claimed at three. */
const VIEWPORTS = [
  { name: "phone", width: 430, height: 932 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

await mkdir(OUT, { recursive: true });

const browser = await launchGuarded({ label: "align2-0826" });

/**
 * ALIGN-2, as a number.
 *
 * For every holder block, the offset of its left content edge from the heading
 * that sits above it. `ALIGN-1` removed the indent entirely and this restores a
 * SMALL one, so the right answer is a positive number in single digits — not
 * zero, and not the tens of pixels the pre-`ALIGN-1` right-alignment produced.
 */
const MEASURE_INDENT = `(() => {
  const blocks = document.querySelectorAll(".person-under-heading");
  if (blocks.length === 0) return { error: "no .person-under-heading on this surface" };
  const out = [];
  for (const block of blocks) {
    const li = block.closest("li");
    if (!li) continue;
    const heading = li.firstElementChild;
    const name = block.querySelector(".person-row-name");
    if (!heading || !name) continue;
    /*
     * Measure the NAME against the HEADING, which is what a reader sees.
     *
     * The first version of this measured the holder BLOCK against its <li> and
     * reported +0px at every viewport — and the CSS was fine. A block-level
     * span's border box already spans the full width, and \`padding-left\` moves
     * its CHILDREN, not its own left edge. That is an assertion satisfied by
     * the wrong box (RULING 153), and it would have read as a failed fix.
     */
    const h = heading.getBoundingClientRect(), n = name.getBoundingClientRect();
    out.push({
      heading: (heading.textContent || "").trim().slice(0, 40),
      indentPx: Math.round(n.left - h.left),
      paddingLeft: getComputedStyle(block).paddingLeft,
      names: [...block.querySelectorAll(".person-row-name")].map((x) => (x.textContent || "").trim()),
    });
  }
  return { blocks: blocks.length, out };
})()`;

/** How many times each seat heading is printed on the card. */
const MEASURE_HEADINGS = `(() => {
  const labels = [...document.querySelectorAll("li > .text-label")].map((e) => (e.textContent || "").trim());
  if (labels.length === 0) return { error: "no seat headings found on this surface" };
  const counts = {};
  for (const l of labels) counts[l] = (counts[l] || 0) + 1;
  const repeated = Object.entries(counts).filter(([, n]) => n > 1);
  return { headings: labels.length, repeated, labels };
})()`;

/** The PROTECTED behaviour: the card's own width, so a change is visible. */
const MEASURE_CARD = `(() => {
  const card = document.querySelector(".coverage-notice, [class*='coverage']");
  if (!card) return { error: "the Who Governs Here card was not on screen" };
  const r = card.getBoundingClientRect();
  return { widthPx: Math.round(r.width), heightPx: Math.round(r.height) };
})()`;

type Shot = { context: { close(): Promise<void> }; page: PageLike };
interface PageLike {
  goto(url: string, o?: object): Promise<unknown>;
  evaluate(s: string): Promise<unknown>;
  waitForTimeout(n: number): Promise<void>;
  waitForFunction(s: string, o?: object): Promise<unknown>;
  screenshot(o: object): Promise<unknown>;
}

async function open(viewport: { width: number; height: number }): Promise<Shot> {
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
    { zip: ZIP },
  );
  const page = (await context.newPage()) as unknown as PageLike;
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);

  /*
   * WGH-8 (2026-08-25): arriving at a zip NO LONGER opens this card — the rail
   * is up and Who Governs Here sits beneath it as a PILL, one click away. A
   * capture script that only navigated would photograph the rail and report
   * nothing found about a card it never opened, which is precisely the failure
   * RULING 159 was adopted over. So the pill is clicked, and the click is
   * ASSERTED rather than assumed.
   */
  const opened = await page.evaluate(`(() => {
    const pill = [...document.querySelectorAll("button")].find(
      (b) => /who governs here/i.test((b.textContent || "").trim()),
    );
    if (!pill) return "no Who governs here control on this page";
    pill.click();
    return "clicked";
  })()`);
  if (opened !== "clicked") {
    throw new Error(`could not open Who Governs Here: ${String(opened)}`);
  }
  await page.waitForTimeout(2000);

  await page
    .waitForFunction(
      `document.querySelectorAll(".person-under-heading").length > 0`,
      { timeout: 60000, polling: 500 },
    )
    .catch(() => {
      throw new Error(
        "no holder block ever rendered on Who Governs Here — there is nothing to " +
          "measure, and reporting a clean run here would be the `0 offenders` " +
          "failure RULING 159 was adopted over.",
      );
    });
  await page.waitForTimeout(2500);
  return { context: context as unknown as { close(): Promise<void> }, page };
}

let failures = 0;
for (const viewport of VIEWPORTS) {
  console.log(`\n== ${viewport.name} (${viewport.width}x${viewport.height}), zip ${ZIP} ==`);
  const { context, page } = await open(viewport);

  const indent = (await page.evaluate(MEASURE_INDENT)) as {
    error?: string;
    blocks?: number;
    out?: { heading: string; indentPx: number; paddingLeft: string; names: string[] }[];
  };
  if (indent.error) {
    console.log(`  INDENT  ERROR — ${indent.error}`);
    failures += 1;
  } else {
    console.log(`  INDENT  ${indent.blocks} holder block(s) measured`);
    for (const row of indent.out ?? []) {
      const ok = row.indentPx > 0 && row.indentPx < 24;
      if (!ok) failures += 1;
      console.log(
        `      ${ok ? "OK " : "BAD"}  +${row.indentPx}px (padding-left ${row.paddingLeft}) under "${row.heading}" -> ${row.names.join(", ")}`,
      );
    }
  }

  const headings = (await page.evaluate(MEASURE_HEADINGS)) as {
    error?: string;
    headings?: number;
    repeated?: [string, number][];
  };
  if (headings.error) {
    console.log(`  HEADING ERROR — ${headings.error}`);
    failures += 1;
  } else {
    const repeated = headings.repeated ?? [];
    if (repeated.length > 0) failures += 1;
    console.log(
      `  HEADING ${headings.headings} heading(s); repeated: ${
        repeated.length === 0 ? "none — ALIGN-2 holds" : JSON.stringify(repeated)
      }`,
    );
  }

  console.log(`  CARD    ${JSON.stringify(await page.evaluate(MEASURE_CARD))}`);

  await page.screenshot({ path: join(OUT, `who-governs-${viewport.name}.png`), fullPage: false });
  console.log(`  shot    who-governs-${viewport.name}.png`);
  await context.close();
}

await browser.close();

console.log(
  `\nalign2-0826 — ${VIEWPORTS.length} viewport(s), ${failures} measurement failure(s)`,
);
if (failures > 0) process.exitCode = 1;
