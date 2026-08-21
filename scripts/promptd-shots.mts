/**
 * **PROMPT D ITEM 1f — THE PRODUCT RENDERING AGAIN, AS A READER SEES IT.**
 *
 * Run:  corepack pnpm shoot:promptd
 *       SHOOT_BASE_URL=http://localhost:3100 corepack pnpm shoot:promptd
 *
 * RULING 2: a full-page capture is evidence only once it has been READ AS AN
 * IMAGE, and a capture that cannot be read makes its item a boundary stop. The
 * four ballot pages run to tens of thousands of pixels at 430x932, so a
 * straight full-page shot downscales into a smear. The technique is the one
 * `scripts/f22-pill-map.mts` established: shrink the PAGE (`html{zoom}`), not
 * the image, band what is being counted at real scale first, and clip the
 * capture to what the document actually occupies afterwards.
 *
 * TWO CAPTURES PER ZIP, answering different questions:
 *
 *   1. `card-<zip>.png`  — the first contest at FULL SIZE, so the words on the
 *      cards are legible and the asterisk-and-footnote annotation can be read
 *      rather than inferred.
 *   2. `page-<zip>.png`  — the whole page shrunk, every candidate card banded
 *      green and every contest footnote banded amber, so the reader of the
 *      image can COUNT cards top to bottom without trusting a DOM query to
 *      have looked everywhere.
 *
 * The DOM counts are printed beside each capture so the image and the number
 * can be reconciled — the pair rule applied to the instrument itself.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { launchGuarded } from "./browser.mts";

const BASE = process.env.SHOOT_BASE_URL ?? "https://sparkwtp.netlify.app";
const OUT = join(process.cwd(), ".promptd", "shots");
// The standing zip order (docs/rulings.md): NH -> NJ -> AZ -> AZ.
const ZIPS = ["03255", "07866", "85641", "85701"];

const browser = await launchGuarded({ label: "promptD-item1f" });
console.log("run id:", browser.runId);
console.log("base:  ", BASE);
mkdirSync(OUT, { recursive: true });

const page = await browser.page({ viewport: { width: 430, height: 932 } });

for (const zip of ZIPS) {
  await page.goto(`${BASE}/ballot?zip=${zip}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  const facts = (await page.evaluate(
    "(() => ({" +
      " contests: document.querySelectorAll('[data-contest-id]').length," +
      " cards: document.querySelectorAll('.candidate-row').length," +
      " markers: document.querySelectorAll('[data-incumbency-marker]').length," +
      " footnotes: document.querySelectorAll('[data-incumbency-footnote]').length," +
      " height: document.documentElement.scrollHeight" +
      " }))()",
  )) as {
    contests: number;
    cards: number;
    markers: number;
    footnotes: number;
    height: number;
  };

  console.log(`\n${zip}: page is ${facts.height}px tall at 430x932`);
  console.log(
    `  contests ${facts.contests} · candidate cards ${facts.cards} · ` +
      `heading markers ${facts.markers} · contest footnotes ${facts.footnotes}`,
  );
  if (facts.markers !== facts.footnotes) {
    console.error("  *** MARKERS AND FOOTNOTES DISAGREE — every asterisk owes a note");
    process.exitCode = 1;
  }

  // 1. The first contest, full size, so the words are legible.
  const first = page.locator("[data-contest-id]").first();
  if (await first.count()) {
    await first.screenshot({ path: join(OUT, `card-${zip}.png`) });
  } else {
    console.log(`  *** no contest to capture at ${zip}`);
  }

  // 2. The whole page. Bands go on FIRST, at real scale, against the real
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
    `  wrote card-${zip}.png and page-${zip}.png (${box.w}x${box.h} after shrink)`,
  );
}

await browser.close();
console.log(`\nwrote ${ZIPS.length * 2} captures to ${OUT}`);
console.log("RULING 2: every one of these must be OPENED AND READ AS AN IMAGE.");
console.log("A capture that cannot be read makes item 1f a boundary stop, not a finish.");
