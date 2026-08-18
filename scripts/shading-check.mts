/**
 * 3f diagnosis: does click-to-select still shade a district, and does the
 * same gesture deselect? Desktop viewport (the sidebar and its district
 * toggle are visible), overlay on, one click → screenshot + DOM state, same
 * click again → screenshot. The screenshots are the evidence — this prints
 * what happened, it does not decide.
 */

import { join } from "node:path";
import { launchGuarded } from "./browser.mts";

const OUT = "C:/Users/seanj/dev/we-the-people/screenshots";
const zip = process.argv[2] ?? "85701";

const browser = await launchGuarded({ label: "shading-check" });
const context = await browser.context({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
});
const page = await context.newPage();
await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
await page.evaluate((z) => {
  window.localStorage.setItem("wtp.approximate_location", JSON.stringify({ zip: z }));
  window.localStorage.setItem("wtp.show_districts", "1");
}, zip);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(10000);

const noThanks = page.getByRole("button", { name: /No thanks/i });
if (await noThanks.isVisible().catch(() => false)) {
  await noThanks.click();
  await page.waitForTimeout(800);
}

// Click well inside the map, away from the sidebar (340px) and cards.
const point = { x: 900, y: 380 };
await page.mouse.click(point.x, point.y);
await page.waitForTimeout(1500);

const pickerVisible = await page.locator(".district-picker").isVisible().catch(() => false);
console.log("picker after first click:", pickerVisible);
if (pickerVisible) {
  const rows = await page.locator(".district-picker-row").count();
  console.log("picker rows:", rows);
  await page.locator(".district-picker-row").first().click();
  await page.waitForTimeout(1500);
}
await page.screenshot({ path: join(OUT, `shading-1-selected.png`) });
const popupText = await page.locator("body").innerText();
console.log("district popup open:", /District|County|AZ-\d/.test(popupText));

// The same gesture again — 6d says this deselects.
await page.mouse.click(point.x, point.y);
await page.waitForTimeout(1500);
const pickerAgain = await page.locator(".district-picker").isVisible().catch(() => false);
console.log("picker after second click:", pickerAgain);
if (pickerAgain) {
  // Choose the SELECTED row — the ✓ one — to exercise the 3f toggle-off.
  const sel = page.locator(".district-picker-row[aria-pressed='true']");
  if (await sel.count()) await sel.first().click();
  else await page.locator(".district-picker-row").first().click();
  await page.waitForTimeout(1500);
}
await page.screenshot({ path: join(OUT, `shading-2-after-second-click.png`) });

await browser.close();
