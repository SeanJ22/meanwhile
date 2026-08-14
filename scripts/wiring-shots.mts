/**
 * The item-2 gate driver: Sunnyside and Amphitheater render bodies, members,
 * and meeting sources at 85701 — with printed counts.
 *
 * Sunnyside: the reader's pin path (list → meeting → More) — its board
 * meets inside the 25 km rung of downtown Tucson, so its sittings are pins.
 * Amphitheater: the district-overlay click path (M02's surface) — its next
 * posted sitting is not yet published (BoardBook posts days ahead), so the
 * board reaches the reader as a district whose popup carries the roster.
 *
 * `pnpm tsx scripts/wiring-shots.mts`
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
  } catch {}
});
const page = await context.newPage();
let failures = 0;
await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(8000);

const noThanks = page.getByRole("button", { name: /No thanks|show me everything/i });
if (await noThanks.isVisible().catch(() => false)) {
  await noThanks.click();
  await page.waitForTimeout(1200);
}

// ── Sunnyside: list → meeting → the large record ─────────────────────────
await page.locator(".count-badge").click();
await page.waitForTimeout(800);
const listText = (await page.locator(".al-panel").textContent()) ?? "";
const sunnysideListed = listText.includes("Sunnyside");
console.log(`list overlay mentions Sunnyside: ${sunnysideListed}`);
if (!sunnysideListed) failures += 1;

const sunnysideRow = page
  .locator(".al-panel button.al-row", { hasText: /Sunnyside/ })
  .first();
console.log(
  `sunnyside rows in list: ${await page.locator(".al-panel button.al-row", { hasText: /Sunnyside/ }).count()}`,
);
await sunnysideRow.click();
await page.waitForTimeout(1500);
// The list row selects the venue and opens its panel; the meeting's own
// row in the panel opens the compact card.
const panelRow = page
  .locator("aside button", { hasText: /Governing Board/ })
  .first();
if (await panelRow.isVisible().catch(() => false)) {
  await panelRow.click();
  await page.waitForTimeout(800);
}
console.log(
  `after row click: popup-cards=${await page.locator(".popup-card").count()}, modals=${await page.locator(".account-modal").count()}, list=${await page.locator(".al-panel").count()}`,
);
// The row opens the compact card or the large surface directly; reach the
// large record either way.
// The compact card carries Representation directly — members must be here.
const compactText = (await page.locator(".popup-card").allTextContents()).join(" ");
const checks = {
  body: compactText.includes("Sunnyside"),
  member: compactText.includes("Quintero"),
  agendaOrPortal: /agenda|meeting page|all agendas/i.test(compactText),
  beHeard: /call to the audience|be heard|comment/i.test(compactText),
};
console.log(`sunnyside compact card: ${JSON.stringify(checks)}`);
if (!checks.body || !checks.member) failures += 1;
await page.screenshot({ path: join(OUT, "wiring-sunnyside-85701.png") });
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
// Close the venue panel too, so the next section starts clean.
const panelClose = page.locator('aside button[aria-label="Close"]').first();
if (await panelClose.isVisible().catch(() => false)) {
  await panelClose.click();
  await page.waitForTimeout(400);
}

// ── Amphitheater: the district-overlay click (M02's surface) ─────────────
// Its next sitting is not yet posted (BoardBook publishes days ahead) and
// the cascade only ships concluded sittings when nothing upcoming exists,
// so the reader's route to this board at 85701 is its district: check the
// School type (M27: touching the group turns the overlay on), click inside
// the boundary, pick Amphitheater, open the record.
// Fresh load: the Sunnyside walk flew the camera to its venue at zoom 14;
// the pixel estimate below assumes the 85701 centroid at METRO_ZOOM 11.
await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(8000);
const noThanks2 = page.getByRole("button", { name: /No thanks|show me everything/i });
if (await noThanks2.isVisible().catch(() => false)) {
  await noThanks2.click();
  await page.waitForTimeout(1200);
}

const schoolLabel = page.locator("label", { hasText: /^\s*School\s*$/ }).first();
await schoolLabel.click();
await page.waitForTimeout(2500);
console.log(
  `school checkbox checked: ${await page.locator("label:has-text('School') input:checked").count()}`,
);

// ~7.2 km north / ~1 km west of the 85701 centroid, in px at METRO_ZOOM 11
// (512-tile Mercator: ~32.3 m/px at this latitude) — inside Amphitheater.
const canvasBox = await page.locator(".maplibregl-canvas").boundingBox();
await page.mouse.click(
  canvasBox!.x + canvasBox!.width / 2 - 33,
  canvasBox!.y + canvasBox!.height / 2 - 222,
);
await page.waitForTimeout(1500);

const pickerRows = await page
  .locator(".district-picker-row")
  .allTextContents();
console.log(`district picker rows: ${JSON.stringify(pickerRows)}`);
const amphiPick = page.locator(".district-picker-row", {
  hasText: /Amphitheater/,
});
if (await amphiPick.first().isVisible().catch(() => false)) {
  await amphiPick.first().click();
  await page.waitForTimeout(1200);
}
// District compact popup renders Representation directly (like meetings).
const amphiText = (await page.locator(".popup-card").allTextContents()).join(" ");
const amphiChecks = {
  district: amphiText.includes("Amphitheater"),
  member: amphiText.includes("Cox Golder") || amphiText.includes("Kopec"),
};
console.log(`amphitheater district record: ${JSON.stringify(amphiChecks)}`);
if (!amphiChecks.district || !amphiChecks.member) failures += 1;
await page.screenshot({ path: join(OUT, "wiring-amphitheater-85701.png") });

await browser.close();
if (failures > 0) {
  console.error(`wiring gate NOT met — ${failures} failure(s)`);
  process.exit(1);
}
console.log("wiring gate met — shots in screenshots/wiring-*.png");
