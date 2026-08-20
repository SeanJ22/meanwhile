/**
 * Item 7.4 — the four pilot zips at 430x932, captured so the capture can be
 * READ (2026-08-20).
 *
 * RULING 2: a full-page screenshot is evidence only once it has been read as
 * an image, and a DOM assertion plus a live walk does not substitute. The
 * defects this exists to catch are the ones the DOM is happy about — an
 * element present and painted behind another, a control below the fold, a
 * colour that renders a gap as a finding.
 *
 * THE READABILITY PROBLEM, AND F22'S ANSWER TO IT. These ballot pages run from
 * 19,000 to 68,000 pixels tall at 430x932. Downscaled far enough to view, a
 * paragraph is sub-pixel and the capture cannot carry any claim about it —
 * reporting "screenshotted" off such a file would be exactly the unread
 * evidence the ruling forbids. `scripts/f22-pill-map.mts` solved this by
 * shrinking the PAGE rather than the image and giving the target a
 * full-width high-contrast band, so what survives the reduction is countable.
 * This uses that same technique, stated here rather than reinvented.
 *
 * TWO CAPTURES PER ZIP, because they answer different questions:
 *
 *   1. `note-<zip>.png` — the coverage note at FULL SIZE, clipped to the
 *      element. This is the one where the WORDS have to be legible, because
 *      item 7.1 is about what the sentence says to a reader.
 *   2. `map-<zip>.png` — the whole page shrunk, with the coverage note and
 *      every equal-depth decision banded. This is the one that proves the
 *      note is actually on the page once, in the right place, and that no
 *      contest anywhere down the page renders cards at unequal depth.
 *
 * Run:  corepack pnpm shoot:promptb
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { launchGuarded } from "./browser.mts";

const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3100";
const OUT = join(process.cwd(), ".promptb", "shots");
const ZIPS = ["85701", "85641", "07866", "03255"];

const browser = await launchGuarded({ label: "promptB-item7" });
console.log("run id:", browser.runId);
console.log("base:", BASE);
mkdirSync(OUT, { recursive: true });

const page = await browser.page({ viewport: { width: 430, height: 932 } });

for (const zip of ZIPS) {
  await page.goto(`${BASE}/ballot?zip=${zip}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  const facts = (await page.evaluate(
    "(() => {" +
      " const note = document.querySelector('[data-coverage-note]');" +
      " const rendered = document.querySelectorAll('[data-equal-depth=\"rendered\"]').length;" +
      " const withheld = document.querySelectorAll('[data-equal-depth=\"withheld\"]').length;" +
      " const reasons = document.querySelectorAll('[data-equal-depth-reason]').length;" +
      " return {" +
      "  tier: note ? note.getAttribute('data-coverage-note') : null," +
      "  stampedAt: note ? note.getAttribute('data-coverage-stamped-at') : null," +
      "  text: note ? (note.textContent || '').replace(/\\s+/g, ' ').trim() : null," +
      "  notes: document.querySelectorAll('[data-coverage-note]').length," +
      "  rendered, withheld, reasons," +
      "  height: document.documentElement.scrollHeight" +
      " }; })()",
  )) as {
    tier: string | null;
    stampedAt: string | null;
    text: string | null;
    notes: number;
    rendered: number;
    withheld: number;
    reasons: number;
    height: number;
  };

  console.log(`\n${zip}: page is ${facts.height}px tall at 430x932`);
  console.log(`  coverage note: ${facts.notes} on the page, tier ${facts.tier}, stamped ${facts.stampedAt}`);
  console.log(`  equal depth: ${facts.rendered} rendered, ${facts.withheld} withheld, ${facts.reasons} with a stated reason`);
  console.log(`  note text: ${facts.text?.slice(0, 200)}`);

  // 1. The note itself, full size, so the WORDS are legible in the image.
  const note = page.locator("[data-coverage-note]").first();
  if (await note.count()) {
    await note.screenshot({ path: join(OUT, `note-${zip}.png`) });
  } else {
    console.log(`  *** no coverage note to capture at ${zip}`);
  }

  // 2. The whole page, shrunk, with both markers banded. Markers go on FIRST,
  // at real scale, so they are drawn against the real layout.
  await page.addStyleTag({
    content: `
      [data-coverage-note]{
        outline:6px solid #00d0ff !important;
        box-shadow:0 0 0 100vw rgba(0,208,255,.30) !important;
      }
      [data-equal-depth="withheld"]{
        outline:6px solid #ff2200 !important;
        box-shadow:0 0 0 100vw rgba(255,34,0,.30) !important;
      }
      [data-equal-depth="rendered"]{
        outline:4px solid #22cc55 !important;
      }
      html{zoom:.2}
    `,
  });
  await page.waitForTimeout(400);

  // The zoom shrinks the CONTENT and not the capture canvas, so a fullPage
  // shot would land the page in a corner of a mostly-empty image.
  const box = (await page.evaluate(
    "(() => { const r = document.documentElement.getBoundingClientRect();" +
      " return { w: Math.ceil(r.width), h: Math.ceil(document.documentElement.scrollHeight) }; })()",
  )) as { w: number; h: number };
  await page.screenshot({
    path: join(OUT, `map-${zip}.png`),
    fullPage: true,
    clip: { x: 0, y: 0, width: box.w, height: box.h },
  });
  console.log(`  wrote note-${zip}.png and map-${zip}.png (${box.w}x${box.h} after shrink)`);
}

await browser.close();
console.log(`\nwrote ${ZIPS.length * 2} captures to ${OUT}`);
console.log("Every one of these must now be OPENED AND READ AS AN IMAGE.");
console.log("A capture that cannot be read makes item 7 a boundary stop, not a finish.");
