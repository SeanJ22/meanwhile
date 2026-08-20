/**
 * F22 item 3.2, the WHOLE-PAGE half — a readable instrument for a claim about
 * a 68,000-pixel page.
 *
 * RULING 3 (2026-08-20) says a full-page screenshot is evidence only once it
 * has been read as an image. The four ballot pages are 19,218 to 68,304 pixels
 * tall at 430x932; downscaled far enough to view, a pill is sub-pixel, so the
 * capture cannot carry the claim and saying otherwise would be exactly the
 * unread-evidence report the ruling forbids.
 *
 * So the page is shrunk rather than the image, and every polling-place pill is
 * given a high-contrast full-width marker before the capture. What survives
 * the reduction is a countable stripe. The reader of the image can then COUNT
 * the pills on the whole page — top to bottom, not just above the fold —
 * without trusting a DOM query to have looked everywhere.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { launchGuarded } from "./browser.mts";

const BASE = process.env.SHOOT_BASE_URL ?? "https://sparkwtp.netlify.app";
const OUT = join(process.cwd(), ".f22tmp", "shots");
const ZIPS = ["85701", "85641", "07866", "03255"];

const browser = await launchGuarded({ label: "F22-pill-map" });
console.log("run id:", browser.runId);
mkdirSync(OUT, { recursive: true });

const page = await browser.page({ viewport: { width: 430, height: 932 } });

for (const zip of ZIPS) {
  await page.goto(`${BASE}/ballot?zip=${zip}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  const count = await page.locator("[data-where-to-vote-pill]").count();

  // The marker goes on FIRST, at full page scale, so it is drawn against the
  // real layout; the shrink is applied afterwards to the whole document.
  await page.addStyleTag({
    content: `
      [data-where-to-vote-pill]{
        outline:8px solid #ff00aa !important;
        background:#ff00aa !important;
        box-shadow:0 0 0 100vw rgba(255,0,170,.28) !important;
      }
      html{zoom:.2}
    `,
  });
  await page.waitForTimeout(400);

  // The zoom shrinks the CONTENT but not the capture canvas, so a fullPage
  // screenshot lands the page in a corner of a mostly-empty image. Clip to
  // what the document actually occupies after the shrink.
  const box = (await page.evaluate(
    "(() => { const r = document.documentElement.getBoundingClientRect();" +
      " return { w: Math.ceil(r.width), h: Math.ceil(document.documentElement.scrollHeight) }; })()",
  )) as { w: number; h: number };
  await page.screenshot({
    path: join(OUT, `pillmap-${zip}.png`),
    fullPage: true,
    clip: { x: 0, y: 0, width: box.w, height: box.h },
  });
  console.log(`${zip}: DOM says ${count} pill(s) — the image must show the same number of bands`);
}

await browser.close();
console.log(`\nwrote ${ZIPS.length} pill map(s) to ${OUT}`);
