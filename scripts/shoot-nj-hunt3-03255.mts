/**
 * 03255 as READABLE clips rather than an unreadable whole page.
 *
 * The whole-page capture of the Newbury ballot is 933x21168 even after the page
 * is shrunk to a 12,000px budget, and downscaled far enough to view, every
 * contest heading is gone. RULING 2 says a capture that cannot be READ is not
 * evidence — so the claim is made by clips that can be.
 *
 * The claim: at 03255 the pill lands on the three sub-state district contests
 * resolved from a centroid, and on nothing else. Governor, US Senator and every
 * Merrimack County office are unmarked, because they govern everyone at that zip.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { launchGuarded } from "./browser.mts";

import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";

const BASE = PUBLIC_SITE_ORIGIN;
const OUT = join(process.cwd(), ".njhunt3", "shots");
mkdirSync(OUT, { recursive: true });

type Box = { found: true; height: number; heading: string } | { found: false };

const browser = await launchGuarded({ label: "NJ-hunt3-03255" });
const page = await browser.page({ viewport: { width: 430, height: 932 } });
await page.goto(`${BASE}/ballot?zip=03255`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

const facts = await page.evaluate<{ pilled: string[]; certain: string[] }>(`(() => {
  const clean = (s) => s.replace(/\\s+/g, " ").replace(/Could govern you.*$/, "").trim();
  const t = (el) => { const h = el.querySelector("h2,h3"); return clean((h && h.textContent) || ""); };
  const s = [...document.querySelectorAll("[data-contest-id]")];
  return {
    pilled: s.filter((x) => x.dataset.couldGovern === "true").map(t),
    certain: s.filter((x) => x.dataset.couldGovern !== "true").map(t),
  };
})()`);
console.log("03255 pilled :", JSON.stringify(facts.pilled));
console.log("03255 certain:", JSON.stringify(facts.certain));

async function shoot(wantPill: boolean, file: string, label: string) {
  const box = await page.evaluate<Box>(`(() => {
    for (const el of document.querySelectorAll("[data-contest-id]")) {
      if ((el.dataset.couldGovern === "true") !== ${wantPill}) continue;
      el.scrollIntoView({ block: "start" });
      const h = el.querySelector("h2,h3");
      return { found: true, height: el.getBoundingClientRect().height, heading: ((h && h.textContent) || "").replace(/\\s+/g, " ").trim() };
    }
    return { found: false };
  })()`);
  if (!box.found) {
    console.log(`${label}: no such contest at this zip`);
    return;
  }
  await page.waitForTimeout(400);
  await page.screenshot({
    path: join(OUT, file),
    clip: { x: 0, y: 0, width: 430, height: Math.min(1200, Math.ceil(box.height) + 80) },
  });
  console.log(`${label}: ${JSON.stringify(box.heading)}`);
}

await shoot(true, "5a-03255-pilled.png", "5a · a PILLED contest at 03255");
await shoot(false, "5b-03255-certain.png", "5b · a CERTAIN contest at 03255");

await browser.close();
