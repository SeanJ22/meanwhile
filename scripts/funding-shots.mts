/**
 * The D34 gate driver: the Funding section live on Ciscomani's card (the
 * official large popup, reached the reader's way) and on ballot candidate
 * cards across three zips — with printed counts, because a screenshot of
 * one card says nothing about how many rendered.
 *
 * `pnpm tsx scripts/funding-shots.mts`
 */

import { chromium } from "playwright";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "screenshots");
const BASE_URL = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";

const browser = await chromium.launch();
let failures = 0;

// ── 1. Ballot cards, three zips ──────────────────────────────────────────
for (const zip of ["85641", "07866", "03255"]) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${BASE_URL}/ballot?zip=${zip}`, { waitUntil: "networkidle" });
  const sections = await page.locator("text=Campaign money · FEC").count();
  const contributors = await page.locator("text=Largest reported contributions").count();
  const totalReactions = await page
    .locator("text=Would you vote for someone whose campaign is funded this way?")
    .count();
  const contribReactions = await page
    .locator("text=Would you vote for someone with these contributors?")
    .count();
  const stateNotes = await page
    .locator("text=state campaign-finance systems")
    .count();
  console.log(
    `${zip}: funding sections=${sections}, contributor lists=${contributors}, ` +
      `total-reactions=${totalReactions}, contributor-reactions=${contribReactions}, state notes=${stateNotes}`,
  );
  if (sections === 0) {
    console.error(`  FAIL — no funding section rendered at ${zip}`);
    failures += 1;
  }
  // Frame the first funding section in view for the shot.
  const first = page.locator("text=Campaign money · FEC").first();
  await first.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(OUT, `funding-ballot-${zip}.png`) });
  await page.close();
}

// ── 2. Ciscomani's official large popup, the reader's path ───────────────
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  reducedMotion: "reduce",
});
await context.addInitScript(() => {
  try {
    localStorage.setItem(
      "wtp.approximate_location",
      JSON.stringify({ zip: "85641", savedAt: new Date().toISOString() }),
    );
    localStorage.setItem("wtp.show_districts", "0");
  } catch {}
});
const page = await context.newPage();
await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(8000);

// Decline the narrowing modal — the stranger's default.
const noThanks = page.getByRole("button", { name: /No thanks|show me everything/i });
if (await noThanks.isVisible().catch(() => false)) {
  await noThanks.click();
  await page.waitForTimeout(1200);
}

const fab = page.locator(".notice-fab");
if ((await fab.count()) > 0) {
  await fab.click();
  await page.waitForTimeout(500);
}
const ciscomani = page
  .locator("div.panel", { hasText: /governs/i })
  .locator("button.text-paper", { hasText: /Ciscomani/ });
if ((await ciscomani.count()) === 0) {
  console.error("FAIL — Ciscomani not offered in who-governs at 85641");
  failures += 1;
} else {
  await ciscomani.first().click();
  await page.waitForTimeout(600);
  await page
    .locator(".popup-card")
    .last()
    .getByRole("button", { name: /^More/ })
    .click();
  await page.waitForSelector("text=Campaign money · FEC", { timeout: 15000 });
  const modalText =
    (await page.locator(".account-modal").textContent()) ?? "";
  const hasTotals = /raised .* in the 2025–26 election cycle/.test(modalText);
  const hasContributors = modalText.includes("Largest reported contributions");
  const hasReaction = modalText.includes(
    "Would you vote for someone whose campaign is funded this way?",
  );
  console.log(
    `ciscomani modal: totals-sentence=${hasTotals}, contributors=${hasContributors}, reaction=${hasReaction}`,
  );
  if (!hasTotals || !hasContributors || !hasReaction) failures += 1;
  await page
    .locator("text=Campaign money · FEC")
    .first()
    .scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, "funding-ciscomani-modal.png") });
}

await browser.close();
if (failures > 0) {
  console.error(`funding gate NOT met — ${failures} failure(s)`);
  process.exit(1);
}
console.log("funding gate met — shots in screenshots/funding-*.png");
