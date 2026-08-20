/**
 * F22 item 3.2 — the F21 ruling, verified at 430x932 on all four pilot zips.
 *
 * RULING 3 (2026-08-20) makes this a capture that must be READ AS AN IMAGE,
 * not a DOM count with a file written beside it. So this writes one PNG per
 * zip plus a contact sheet, and prints the pill count it measured so the
 * number and the picture can be held against each other.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { launchGuarded } from "./browser.mts";

const BASE = process.env.SHOOT_BASE_URL ?? "https://sparkwtp.netlify.app";
const OUT = join(process.cwd(), ".f22tmp", "shots");
const ZIPS = ["85701", "85641", "07866", "03255"];
const VIEWPORT = { width: 430, height: 932 };

const browser = await launchGuarded({ label: "F22-shots" });
console.log("run id:", browser.runId);
mkdirSync(OUT, { recursive: true });

const page = await browser.page({ viewport: VIEWPORT, deviceScaleFactor: 2 });
const rows: string[] = [];

for (const zip of ZIPS) {
  await page.goto(`${BASE}/ballot?zip=${zip}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  const pills = await page.locator("[data-where-to-vote-pill]").count();
  // Where the one pill sits, so the picture can be checked against the claim
  // that it lives in the dates header rather than merely existing somewhere.
  const y =
    pills > 0
      ? ((await page.locator("[data-where-to-vote-pill]").first().boundingBox())?.y ?? -1)
      : -1;

  await page.screenshot({ path: join(OUT, `ballot-${zip}.png`), fullPage: true });
  await page.screenshot({ path: join(OUT, `ballot-${zip}-fold.png`) });

  rows.push(`${zip}: ${pills} pill(s), first at y=${Math.round(y)}`);
  console.log(rows[rows.length - 1]);
}

// A contact sheet so four full-page captures can be read in one look.
const sheet = `<!doctype html><meta charset="utf-8">
<style>
 body{margin:0;background:#111;color:#eee;font:13px system-ui;display:flex;gap:12px;padding:12px}
 figure{margin:0}img{width:430px;border:1px solid #444;display:block}
 figcaption{padding:6px 0}
</style>
${ZIPS.map((z) => `<figure><figcaption>${z}</figcaption><img src="ballot-${z}.png"></figure>`).join("")}`;
writeFileSync(join(OUT, "contact-sheet.html"), sheet, "utf8");

await browser.close();
console.log("\n" + rows.join("\n"));
console.log(`\nwrote ${ZIPS.length * 2} capture(s) to ${OUT}`);
