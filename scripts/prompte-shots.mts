/**
 * **PROMPT E ITEM 3.6 — RULING 42 ON THE LIVE DEPLOY, AS A READER SEES IT.**
 *
 * Run:  corepack pnpm shoot:prompte
 *       SHOOT_BASE_URL=http://localhost:3100 corepack pnpm shoot:prompte
 *
 * Prompt D's `scripts/promptd-shots.mts` is the instrument and the technique is
 * unchanged (`scripts/f22-pill-map.mts`): shrink the PAGE rather than the
 * image, band what is being counted at real scale FIRST, and clip afterwards.
 * A ballot at 430×932 runs to tens of thousands of pixels and a straight
 * full-page capture downscales into a smear, which RULING 2 says is not
 * evidence at all.
 *
 * What this one adds is the pair RULING 42 turns on, banded so they can be
 * COUNTED in the image rather than trusted from a DOM query:
 *
 *   - the page-level disclosure, ONCE per page, in blue;
 *   - the per-card completeness marker, which must appear ZERO times — the
 *     exact sentence is searched for in the rendered text, so a reintroduction
 *     shows up as a number rather than as an absence nobody looked for.
 *
 * Three captures per zip:
 *   1. `card-<zip>.png`   the first contest at full size — the words legible.
 *   2. `foot-<zip>.png`   the foot of the page at full size — the disclosure
 *                         legible, in its real position under the neutral note.
 *   3. `page-<zip>.png`   the whole page shrunk, cards banded green, contest
 *                         footnotes amber, the disclosure blue.
 *
 * The DOM counts print beside each capture so the image and the number
 * reconcile — the pair rule applied to the instrument itself.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { launchGuarded } from "./browser.mts";

import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";

const BASE = process.env.SHOOT_BASE_URL ?? PUBLIC_SITE_ORIGIN;
const OUT = join(process.cwd(), ".prompte", "shots");
// The standing zip order (docs/rulings.md): NH -> NJ -> AZ -> AZ.
const ZIPS = ["03255", "07866", "85641", "85701"];

const browser = await launchGuarded({ label: "promptE-item3.6" });
console.log("run id:", browser.runId);
console.log("base:  ", BASE);
mkdirSync(OUT, { recursive: true });

const page = await browser.page({ viewport: { width: 430, height: 932 } });

let totalContests = 0;
let totalCards = 0;

for (const zip of ZIPS) {
  await page.goto(`${BASE}/ballot?zip=${zip}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  const facts = (await page.evaluate(
    "(() => ({" +
      " contests: document.querySelectorAll('[data-contest-id]').length," +
      " cards: document.querySelectorAll('.candidate-row').length," +
      " markers: document.querySelectorAll('[data-incumbency-marker]').length," +
      " footnotes: document.querySelectorAll('[data-incumbency-footnote]').length," +
      " disclosures: document.querySelectorAll('[data-collection-note]').length," +
      " thin: (document.body.innerText.match(/found much about this candidate/gi) || []).length," +
      " height: document.documentElement.scrollHeight" +
      " }))()",
  )) as {
    contests: number;
    cards: number;
    markers: number;
    footnotes: number;
    disclosures: number;
    thin: number;
    height: number;
  };

  totalContests += facts.contests;
  totalCards += facts.cards;

  console.log(`\n${zip}: page is ${facts.height}px tall at 430x932`);
  console.log(
    `  contests ${facts.contests} · candidate cards ${facts.cards} · ` +
      `heading markers ${facts.markers} · contest footnotes ${facts.footnotes}`,
  );
  console.log(
    `  RULING 42 · page-level disclosures ${facts.disclosures} (must be 1) · ` +
      `per-card completeness markers ${facts.thin} (must be 0)`,
  );
  if (facts.markers !== facts.footnotes) {
    console.error("  *** MARKERS AND FOOTNOTES DISAGREE — every asterisk owes a note");
    process.exitCode = 1;
  }
  if (facts.disclosures !== 1) {
    console.error("  *** THE PAGE-LEVEL DISCLOSURE IS NOT RENDERED EXACTLY ONCE");
    process.exitCode = 1;
  }
  if (facts.thin !== 0) {
    console.error("  *** A PER-CARD COMPLETENESS MARKER IS BACK ON THE BALLOT");
    process.exitCode = 1;
  }

  // 1. The first contest, full size, so the words on the cards are legible.
  const first = page.locator("[data-contest-id]").first();
  if (await first.count()) {
    await first.screenshot({ path: join(OUT, `card-${zip}.png`) });
  } else {
    console.log(`  *** no contest to capture at ${zip}`);
  }

  // 2. The foot of the page at full size — the disclosure has to be READ, not
  // counted. Scrolled to and captured through its own bounding box so the
  // surrounding text is in frame and its position is visible rather than
  // asserted.
  const note = page.locator("[data-collection-note]").first();
  if (await note.count()) {
    await note.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const box = await note.boundingBox();
    if (box) {
      await page.screenshot({
        path: join(OUT, `foot-${zip}.png`),
        clip: {
          x: 0,
          y: Math.max(0, box.y - 260),
          width: 430,
          height: Math.min(620, box.height + 320),
        },
      });
    }
  }

  // 3. The whole page. Bands go on FIRST, at real scale, against the real
  // layout; the shrink is applied to the whole document afterwards.
  await page.addStyleTag({
    content: `
      .candidate-row{
        outline:6px solid #22cc55 !important;
        box-shadow:0 0 0 100vw rgba(34,204,85,.16) !important;
      }
      [data-incumbency-footnote]{
        outline:8px solid #ffaa00 !important;
        background:#ffaa00 !important;
      }
      [data-collection-note]{
        outline:10px solid #2277ff !important;
        background:#2277ff !important;
      }
      html{zoom:.18}
    `,
  });
  await page.waitForTimeout(400);

  const box = (await page.evaluate(
    "(() => { const r = document.documentElement.getBoundingClientRect();" +
      " return { w: Math.ceil(r.width), h: Math.ceil(document.documentElement.scrollHeight) }; })()",
  )) as { w: number; h: number };
  await page.screenshot({
    path: join(OUT, `page-${zip}.png`),
    fullPage: true,
    clip: { x: 0, y: 0, width: box.w, height: box.h },
  });
  console.log(
    `  wrote card-${zip}.png, foot-${zip}.png and page-${zip}.png (${box.w}x${box.h} after shrink)`,
  );
}

await browser.close();
console.log(
  `\nTOTAL across the four zips: ${totalContests} contests · ${totalCards} candidate cards`,
);
console.log("Prompt D shipped 36 of 36 contests and 107 cards. Neither may go down.");
console.log(`\nwrote ${ZIPS.length * 3} captures to ${OUT}`);
console.log("RULING 2: every one of these must be OPENED AND READ AS AN IMAGE.");
console.log("A capture that cannot be read makes item 3.6 a boundary stop, not a finish.");
