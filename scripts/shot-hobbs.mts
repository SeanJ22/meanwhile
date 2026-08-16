/**
 * One card, one question: does an official-source read still say "not yet"?
 *
 * `SHOOT_BASE_URL=… pnpm tsx scripts/shot-hobbs.mts`
 *
 * The Governor of Arizona's card is the one the author found the defect on
 * (g3 item 5). This opens it the way a reader does — who-governs → the name →
 * More → Sources — and prints every Verified row it renders, so the claim is
 * read off the page rather than off the component.
 */
import { chromium } from "playwright";

const BASE = (process.env.SHOOT_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  reducedMotion: "reduce",
});
await context.addInitScript(() => {
  try {
    sessionStorage.setItem(
      "wtp.approximate_location",
      JSON.stringify({ zip: "85701", savedAt: new Date().toISOString() }),
    );
    localStorage.setItem("wtp.tutorial_seen", "1");
  } catch {
    // Typing the zip is the fallback; the walk does not depend on the seed.
  }
});
const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForTimeout(9000);

const row = page.locator('.coverage-notice button:has-text("Hobbs")').first();
if ((await row.count()) === 0) {
  console.error("no Hobbs row on the who-governs card — cannot run this check");
  process.exit(2);
}
await row.click();
await page.waitForTimeout(900);
const more = page.locator('.popup-card button:has-text("More")');
if (await more.count()) {
  await more.first().click();
  await page.waitForTimeout(1200);
}

// Open every collapsed section: Sources is one of them.
for (const header of await page.locator(".card-section-header").all()) {
  await header.click().catch(() => {});
  await page.waitForTimeout(200);
}
await page.waitForTimeout(600);

const rows = await page.evaluate(() => {
  const out: string[] = [];
  for (const el of document.querySelectorAll(".popup-row, .account-modal-person")) {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (/Verified/.test(text)) out.push(text);
  }
  return out;
});

console.log(`Verified rows on the Governor's card (${BASE}):`);
for (const r of rows) console.log(`  ${r}`);
const bad = rows.filter((r) => /not yet/i.test(r));
console.log(
  bad.length === 0
    ? `\nall ${rows.length} row(s) carry a real verification`
    : `\n${bad.length} of ${rows.length} row(s) still say "not yet"`,
);

await page.screenshot({ path: "screenshots/g3-hobbs-sources.png", fullPage: true });
await browser.close();
if (rows.length === 0) process.exit(2);
if (bad.length > 0) process.exit(1);
