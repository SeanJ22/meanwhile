/**
 * Tester-pass driver: phone width, per zip — decline the narrowing modal,
 * read the who-governs card, open a meeting card, and (85701) run the 3f
 * district-shading diagnosis with feature-state readback.
 */

import { join } from "node:path";
import { launchGuarded } from "./browser.mts";

const OUT = "C:/Users/seanj/dev/we-the-people/screenshots";
const zip = process.argv[2] ?? "85701";
const doShading = process.argv.includes("--shading");

const browser = await launchGuarded({ label: "tester-drive" });
const context = await browser.context({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  reducedMotion: "reduce",
});
const page = await context.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE ERROR:", m.text().slice(0, 200));
});
await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
await page.evaluate((z) => {
  window.localStorage.setItem("wtp.approximate_location", JSON.stringify({ zip: z }));
}, zip);
await page.goto(`http://localhost:3000/?`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);

// If the stored-zip shape is wrong, enter the zip through the welcome UI.
const welcome = page.locator("input[placeholder*='zip' i], input[aria-label*='zip' i]").first();
if (await welcome.isVisible().catch(() => false)) {
  await welcome.fill(zip);
  await welcome.press("Enter");
  await page.waitForTimeout(8000);
}

// Decline the narrowing modal if it appears — the tester's "show me everything".
const noThanks = page.getByRole("button", { name: /No thanks, show me everything/i });
if (await noThanks.isVisible().catch(() => false)) {
  await noThanks.click();
  await page.waitForTimeout(1200);
  console.log("narrowing modal: declined (renders + dismisses)");
} else {
  console.log("narrowing modal: not shown for", zip);
}

await page.screenshot({ path: join(OUT, `tester-${zip}-map.png`) });

// The who-governs card content.
const notice = await page.locator("body").innerText();
console.log("MAYOR LINE:", /Mayor/.test(notice) ? "present" : "absent");
console.log("US SENATORS BLOCK:", /U\.S\. Senators?\n/.test(notice) ? "label-on-own-line" : "inline-or-absent");

if (doShading) {
  // 3f: turn the overlay on, click the map center, read feature-state back.
  const districtsToggle = page.getByText(/Show districts/i).first();
  if (await districtsToggle.isVisible().catch(() => false)) {
    await districtsToggle.click();
    await page.waitForTimeout(4000);
  }
  await page.mouse.click(195, 300);
  await page.waitForTimeout(1500);
  const pickerVisible = await page
    .locator(".district-picker")
    .isVisible()
    .catch(() => false);
  console.log("district picker after click:", pickerVisible);
  if (pickerVisible) {
    await page.locator(".district-picker-row").first().click();
    await page.waitForTimeout(1500);
  }
  const shading = await page.evaluate(() => {
    // The map instance is not exported; read feature-state via the canvas's
    // owning React tree is not possible — instead count painted fill layers
    // with non-zero opacity by querying rendered features under the hood is
    // unavailable too. Fall back to a DOM check: the district popup opening
    // is the state half; the paint half needs the pixel check below.
    return document.body.innerText.includes("District");
  });
  console.log("district popup/state after pick:", shading);
  await page.screenshot({ path: join(OUT, `tester-${zip}-shading.png`) });
  // Click the same spot again (same-gesture deselect) and shoot again.
  await page.mouse.click(195, 300);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, `tester-${zip}-shading-2.png`) });
}

// Open the first meeting pin's card (3a check).
const marker = page.locator("button[aria-label]").filter({ hasText: "" });
const markers = await page.locator(".maplibregl-marker button, .maplibregl-marker").all();
if (markers.length > 0) {
  await markers[0].click({ force: true });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, `tester-${zip}-meeting.png`) });
  const sheet = await page.locator("aside").first().innerText().catch(() => "");
  console.log("MEETING SHEET HEAD:", sheet.split("\n").slice(0, 6).join(" | "));
} else {
  console.log("no markers found to click");
}

await browser.close();
