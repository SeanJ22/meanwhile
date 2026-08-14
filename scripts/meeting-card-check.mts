/**
 * 3a on-screen check: open the Vail meeting card from the list overlay at
 * phone width and read its header — the WHAT must lead, the address render
 * once. Also: the ballot page's first-tap one-time notice (3c/3d).
 */
import { chromium } from "playwright";
import { join } from "node:path";

const OUT = "C:/Users/seanj/dev/we-the-people/screenshots";
const zip = process.argv[2] ?? "85641";

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  reducedMotion: "reduce",
});
const page = await context.newPage();
await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
await page.evaluate((z) => {
  window.localStorage.setItem("wtp.approximate_location", JSON.stringify({ zip: z }));
}, zip);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);

const noThanks = page.getByRole("button", { name: /No thanks/i });
if (await noThanks.isVisible().catch(() => false)) {
  await noThanks.click();
  await page.waitForTimeout(800);
}

// The count badge opens the list overlay.
const badge = page.getByText(/meetings\s*·/).first();
if (await badge.isVisible().catch(() => false)) {
  await badge.click();
  await page.waitForTimeout(1200);
}
await page.screenshot({ path: join(OUT, `tester-${zip}-list.png`) });
const listText = await page.locator("body").innerText();
const lines = listText.split("\n").filter((l) => /Vail|Governing Board|Rockaway|Board/.test(l));
console.log("LIST LINES:", lines.slice(0, 8).join(" | "));

// Tap the first meeting row.
const row = page.getByText(/Governing Board|Board of|Council/).first();
if (await row.isVisible().catch(() => false)) {
  await row.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, `tester-${zip}-meeting-card.png`) });
}

// Ballot page: the first-ever reaction tap must surface the one-time notice.
await page.goto(`http://localhost:3000/ballot?zip=${zip}`, {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(2500);
const yes = page.getByRole("button", { name: "Yes", exact: true }).first();
await yes.click();
await page.waitForTimeout(600);
const noticeVisible = await page
  .getByText(/Your answer joins anonymous local totals/)
  .isVisible()
  .catch(() => false);
console.log("one-time notice on first tap:", noticeVisible);
await page.screenshot({ path: join(OUT, `tester-${zip}-ballot-notice.png`) });
if (noticeVisible) {
  await page.getByRole("button", { name: /OK — record my answer/ }).click();
  await page.waitForTimeout(600);
  const gone = await page
    .getByText(/Your answer joins anonymous local totals/)
    .isVisible()
    .catch(() => false);
  console.log("notice gone after OK:", !gone);
  // A second tap elsewhere must not resurface it.
  const buttons = await page.getByRole("button", { name: "No", exact: true }).all();
  if (buttons[1]) {
    await buttons[1].click();
    await page.waitForTimeout(600);
    const again = await page
      .getByText(/Your answer joins anonymous local totals/)
      .isVisible()
      .catch(() => false);
    console.log("notice stayed gone on second tap:", !again);
  }
}

await browser.close();
