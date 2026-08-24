#!/usr/bin/env tsx
/**
 * **THE CAMPAIGN MONEY SECTION, FOR A NON-FEDERAL CANDIDATE.**
 * Item 7 evidence, 2026-08-24 state-campaign-money session. RULING 125: this
 * runs against the LOCAL production build, never Netlify.
 *
 * Committed per RULING 76 — the capture recipe is a rung.
 *
 * ## The recipe, and why each step is here
 *
 * A 07866 ballot page is tens of thousands of pixels tall, so a full-page
 * capture is unreadable as an image and therefore is not evidence at all
 * (the screenshot rule: a capture is evidence only once it has been READ).
 * So the target is found, scrolled to, and clipped — a small image of the
 * actual thing claimed, rather than a large image of everything.
 *
 * The card's sections are collapsed until opened, which is the whole point of
 * the surface — so the capture OPENS the money section first. A screenshot of
 * a closed accordion would show a heading and prove nothing.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { launchGuarded } from "./browser.mts";

const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";
const OUT = join(import.meta.dirname, "..", "screenshots");
mkdirSync(OUT, { recursive: true });

const browser = await launchGuarded({ label: "state-money-shots-0824" });
const page = await browser.page({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });

await page.goto(`${BASE}/ballot?zip=07866`, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForTimeout(6000);

/*
 * Open the first candidate card, then its Campaign money section. Both are
 * clicks a reader makes, and a capture of an unopened surface is a capture of
 * nothing.
 */
/*
 * TARGET A NON-FEDERAL CANDIDATE BY NAME.
 *
 * The first version clicked the first card on the page and opened CORY BOOKER
 * — a US Senate candidate, whose money comes from the FEC and always did. A
 * capture of that card would have shown the surface working and proved nothing
 * whatever about the gap this session closed.
 *
 * Tayfun Selen is a Morris County commissioner candidate: he files with NJ
 * ELEC, his card could not fill before today, and ELEC holds $225,026 across
 * 14 reports for him.
 */
const TARGET_RE = process.env.SHOOT_CANDIDATE ?? "Selen";
/*
 * The card is opened by its own "View Battlecard" button, NOT by clicking the
 * candidate's name — the name button expands the inline row. Clicking the name
 * left the modal closed and the section unreachable, which the first run
 * reported as a boundary stop rather than claiming a finish.
 */
const openedCard = await page.evaluate(`(() => {
  const rows = [...document.querySelectorAll(".candidate-row")];
  const row = rows.find((r) => /${TARGET_RE}/i.test(r.textContent || ""));
  if (!row) return null;
  const btn = [...row.querySelectorAll("button")].find((x) => /battlecard/i.test(x.textContent || ""));
  if (!btn) return "row found, but no View Battlecard button in it";
  btn.click();
  return (row.textContent || "").trim().slice(0, 70);
})()`);
console.log(`opened card: ${openedCard ?? "(none found)"}`);
await page.waitForTimeout(2500);

await page.waitForTimeout(2000);
const openedSection = await page.evaluate(`(() => {
  const heads = [...document.querySelectorAll("button, summary, [role='button'], h3, h4")];
  const money = heads.find((h) => /campaign money/i.test(h.textContent || ""));
  if (!money) return null;
  if (typeof money.click === "function") money.click();
  return (money.textContent || "").trim().slice(0, 80);
})()`);
console.log(`opened section: ${openedSection ?? "(none found)"}`);
await page.waitForTimeout(2000);

/*
 * Find the SMALLEST element naming the agency — the first version took the
 * first match with fewer than twelve children and got `<body>`, whose text
 * contains everything on the page including an inline script.
 */
const box = await page.evaluate(`(() => {
  const all = [...document.querySelectorAll("div, section, dl, p")];
  const naming = all.filter((n) => /Election Law Enforcement Commission/.test(n.textContent || ""));
  const el = naming.length ? naming[naming.length - 1].closest("div") : null;
  if (!el) return null;
  el.scrollIntoView({ block: "center" });
  const r = el.getBoundingClientRect();
  return { x: Math.max(0, r.x - 16), y: Math.max(0, r.y - 90), w: Math.min(430, r.width + 32), h: Math.min(700, r.height + 190), text: (el.textContent || "").trim().slice(0, 220) };
})()`) as { x: number; y: number; w: number; h: number; text: string } | null;

if (!box) {
  console.error(
    "CANNOT CAPTURE — no element naming the agency was found on the page.\n" +
      "That is a BOUNDARY STOP, not a finish: the item is not claimed as verified.",
  );
  await browser.close();
  process.exit(2);
}

console.log(`found the section: "${box.text.slice(0, 140)}"`);
await page.waitForTimeout(800);
const file = join(OUT, process.env.SHOOT_OUT ?? "state-money-07866-card.png");
await page.screenshot({
  path: file,
  clip: { x: box.x, y: box.y, width: Math.max(200, box.w), height: Math.max(200, box.h) },
});
console.log(`wrote ${file}`);

await browser.close();
