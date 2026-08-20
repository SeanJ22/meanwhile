/**
 * PROMPT C's evidence — the equal-depth gate as a reader sees it (item 2,
 * 2026-08-20).
 *
 * RULING 2: a full-page screenshot is evidence only once it has been READ AS
 * AN IMAGE, and a DOM assertion plus a live walk does not substitute. The
 * defects this catches are the ones the DOM is happy about — an element
 * present and painted behind another, a control below the fold, a colour that
 * renders a gap as a finding.
 *
 * A ballot page at 430×932 runs to tens of thousands of pixels, and downscaled
 * far enough to view, a withheld block is a smear. So the PAGE is shrunk
 * rather than the image (`html{zoom}`), and every equal-depth block is given a
 * high-contrast full-width marker before the capture — WITHHELD in one colour,
 * RENDERED in another. What survives the reduction is a countable stripe, and
 * a reader of the image can count both kinds top to bottom without trusting a
 * DOM query to have looked everywhere.
 *
 * Two captures per zip:
 *   promptc-gate-<zip>.png    the whole page, shrunk, both kinds marked
 *   promptc-detail-<zip>.png  the first withheld block at full size, so the
 *                             per-candidate "still looking for" list is legible
 *
 * Run:  SHOOT_BASE_URL=http://localhost:3111 pnpm shoot:promptc
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { launchGuarded } from "./browser.mts";

const BASE = process.env.SHOOT_BASE_URL ?? "https://sparkwtp.netlify.app";
const OUT = join(process.cwd(), ".promptc", "shots");
const ZIPS = ["03255", "07866", "85641", "85701"];

const browser = await launchGuarded({ label: "promptC-gate" });
console.log("run id:", browser.runId);
mkdirSync(OUT, { recursive: true });

const page = await browser.page({ viewport: { width: 430, height: 932 } });

for (const zip of ZIPS) {
  await page.goto(`${BASE}/ballot?zip=${zip}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  const withheld = await page.locator('[data-equal-depth="withheld"]').count();
  const rendered = await page.locator('[data-equal-depth="rendered"]').count();

  /* ---- the detail shot, before anything is shrunk ------------------------ */

  if (withheld > 0) {
    const first = page.locator('[data-equal-depth="withheld"]').first();
    await first.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await first.screenshot({ path: join(OUT, `promptc-detail-${zip}.png`) });
  }

  /* ---- the whole-page map ------------------------------------------------ */

  await page.addStyleTag({
    content: `
      [data-equal-depth="withheld"]{
        outline:6px solid #ff00aa !important;
        box-shadow:0 0 0 100vw rgba(255,0,170,.22) !important;
      }
      [data-equal-depth="rendered"]{
        outline:6px solid #00d0ff !important;
        box-shadow:0 0 0 100vw rgba(0,208,255,.22) !important;
      }
      html{zoom:.2}
    `,
  });
  await page.waitForTimeout(400);

  const box = (await page.evaluate(
    "(() => { const r = document.documentElement.getBoundingClientRect();" +
      " return { w: Math.ceil(r.width), h: Math.ceil(document.documentElement.scrollHeight) }; })()",
  )) as { w: number; h: number };

  await page.screenshot({
    path: join(OUT, `promptc-gate-${zip}.png`),
    fullPage: true,
    clip: { x: 0, y: 0, width: box.w, height: box.h },
  });

  console.log(
    `${zip}: DOM says ${withheld} withheld (pink) and ${rendered} rendered (blue) — ` +
      `the image must show the same numbers of bands`,
  );
}

await browser.close();
console.log(`\nwrote captures for ${ZIPS.length} zip(s) to ${OUT}`);
