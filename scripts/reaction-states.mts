/**
 * Capture the reaction control's states for the P03 gate: untapped, selected,
 * changed, and the why-we-ask disclosure. Modeled on shoot.mts (headless so
 * MapLibre keeps painting) and prints what it found — a screenshot is
 * evidence, not confirmation.
 *
 * `pnpm tsx scripts/reaction-states.mts`
 */

import { chromium } from "playwright";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "screenshots");
const BASE_URL = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  reducedMotion: "reduce",
});

await context.addInitScript(() => {
  try {
    localStorage.setItem(
      "wtp.approximate_location",
      JSON.stringify({ zip: "85701", savedAt: new Date().toISOString() }),
    );
    localStorage.setItem("wtp.show_districts", "0");
    // A clean slate: no continuity key, no remembered answers — state one
    // must be the untouched control.
    localStorage.removeItem("wtp.reaction_key");
    localStorage.removeItem("wtp.reactions");
  } catch {}
});
await context.addInitScript({
  content: `document.addEventListener("DOMContentLoaded",function(){
    var s=document.createElement("style");
    s.textContent="nextjs-portal{display:none !important}";
    document.head.appendChild(s);
  })`,
});

const page = await context.newPage();
await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(7000);

// Open the rep surface from the who-governs card: the compact card first,
// then its "More" into the large tier, where the record and its reaction
// rows live (3: glance → more → full).
const holderButton = page.locator("button.text-paper").first();
const holderName = (await holderButton.textContent())?.trim();
await holderButton.click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: /^More/ }).first().click();
await page.waitForSelector("text=Recent votes");
await page.waitForTimeout(1500);

const popup = page.locator(".account-modal").last();
const controls = popup.locator('button[aria-pressed]');
const controlCount = await controls.count();
const promptCount = await popup.locator("text=Do you like this vote?").count();
console.log(
  `popup for ${holderName}: ${promptCount} vote prompts, ${controlCount} reaction buttons`,
);
if (promptCount === 0) {
  console.error("NO REACTION PROMPTS RENDERED — the gate is not met");
  process.exit(1);
}

const firstControl = popup.locator("text=Do you like this vote?").first();
await firstControl.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);

await popup.screenshot({ path: join(OUT, "reaction-1-untapped.png") });

// State 2: tap Yes — instant selection.
await popup.getByRole("button", { name: "Yes", exact: true }).first().click();
await page.waitForTimeout(400);
await popup.screenshot({ path: join(OUT, "reaction-2-selected-yes.png") });

// State 3: change the answer — Unsure overwrites Yes.
await popup.getByRole("button", { name: "Unsure", exact: true }).first().click();
await page.waitForTimeout(400);
await popup.screenshot({ path: join(OUT, "reaction-3-changed-unsure.png") });

// State 4: the why-we-ask disclosure, expanded.
await popup.getByRole("button", { name: "why we ask" }).first().click();
await page.waitForTimeout(300);
await popup.screenshot({ path: join(OUT, "reaction-4-why-we-ask.png") });

// Ask the page what the device remembers — the changeable contract.
const remembered = await page.evaluate(() => localStorage.getItem("wtp.reactions"));
const key = await page.evaluate(() => localStorage.getItem("wtp.reaction_key"));
console.log(`device remembers: ${remembered}`);
console.log(`continuity key minted: ${key ? `yes (${key.length} chars)` : "NO"}`);

const pressed = await popup
  .locator('button[aria-pressed="true"]')
  .allTextContents();
console.log(`selected now: ${JSON.stringify(pressed)}`);

await browser.close();
console.log("four shots written to screenshots/reaction-*.png");
