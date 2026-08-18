/**
 * The popup-architecture gate (3): the two tiers on screen, with printed
 * counts. Captures the compact meeting card (More + close both visible),
 * the meeting large popup (what-first header, agenda content, how to be
 * heard), the compact official card, the official large popup (votes and
 * reactions), and the centered list popup — and asserts the one-at-a-time
 * rule by checking only one large surface ever exists.
 *
 * `pnpm tsx scripts/popup-states.mts`
 */


import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchGuarded } from "./browser.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "screenshots");
const BASE_URL = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";

const browser = await launchGuarded({ label: "popup-states" });
const context = await browser.context({
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
await context.addInitScript({
  content: `document.addEventListener("DOMContentLoaded",function(){
    var s=document.createElement("style");
    s.textContent="nextjs-portal{display:none !important}";
    document.head.appendChild(s);
  })`,
});

const page = await context.newPage();
await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(8000);

const largeCount = () => page.locator(".account-modal, .al-panel").count();

// 1. A pin → the venue panel → a meeting's compact card.
const pin = page.locator(".wtp-pin").first();
await pin.click({ force: true });
await page.waitForTimeout(800);
const meetingRow = page
  .locator("aside button.text-left, aside h3 button")
  .first();
await meetingRow.click();
await page.waitForTimeout(600);

const compact = page.locator(".popup-card").last();
const compactText = (await compact.textContent()) ?? "";
console.log(
  `compact meeting card: More=${compactText.includes("More")}, close=${
    (await compact.locator('button[aria-label="Close"]').count()) > 0
  }`,
);
await compact.screenshot({ path: join(OUT, "popup-1-compact-meeting.png") });

// 2. More → the large tier. The compact card must be subsumed.
await compact.getByRole("button", { name: /^More/ }).click();
await page.waitForTimeout(1500);
console.log(
  `large surfaces open: ${await largeCount()} (must be 1); compact cards: ${await page
    .locator(".popup-card")
    .count()} (must be 0 — subsumed)`,
);
if ((await largeCount()) !== 1 || (await page.locator(".popup-card").count()) !== 0) {
  console.error("SUBSUME RULE NOT MET");
  process.exit(1);
}
const modal = page.locator(".account-modal");
const modalText = (await modal.textContent()) ?? "";
console.log(
  `meeting modal: agenda-section=${modalText.includes("What this meeting is about")}, ` +
    `to-be-heard=${modalText.includes("Make your voice heard") || modalText.includes("comment")}, ` +
    `close=${(await modal.locator('button[aria-label="Close"]').count()) > 0}`,
);
await page.screenshot({ path: join(OUT, "popup-2-meeting-modal.png") });
await modal.locator('button[aria-label="Close"]').click();
await page.waitForTimeout(400);

// 3. Official: compact card, then More → the large record.
// The venue engagement collapsed the who-governs card — bring it back
// through its bubble (the exact reader path), then open a holder.
// Close the venue panel so only the who-governs card offers holders.
await page.locator('aside button[aria-label="Close"]').first().click();
await page.waitForTimeout(400);
const fab = page.locator(".notice-fab");
if ((await fab.count()) > 0) {
  await fab.click();
  await page.waitForTimeout(500);
}
// The last holder in the who-governs card is a U.S. senator — a federal
// member, whose large card carries the roll-call record and reaction rows.
const holderButton = page
  .locator("div.panel", { hasText: /governs/i })
  .locator("button.text-paper")
  .last();
await holderButton.click();
await page.waitForTimeout(600);
const officialCompact = page.locator(".popup-card").last();
console.log(
  `official compact open: ${await page.locator(".popup-card").count()} card(s)`,
);
await officialCompact.screenshot({
  path: join(OUT, "popup-3-compact-official.png"),
});
await officialCompact.getByRole("button", { name: /^More/ }).click();
await page.waitForSelector("text=Recent votes");
await page.waitForTimeout(1500);
console.log(
  `official modal open: large=${await largeCount()} (must be 1); ` +
    `reactions present=${(await page.locator("text=Do you like this vote?").count()) > 0}`,
);
await page.screenshot({ path: join(OUT, "popup-4-official-modal.png") });

// 4. The list is a centered large surface under the same one-at-a-time
// rule. (The modal's backdrop already blocks reaching the badge without
// closing it — the rule enforced by geometry; Escape is the keyboard out.)
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
await page.locator(".count-badge").click();
await page.waitForTimeout(600);
const largeAfterList = await page.locator(".account-modal").count();
const listOpen = await page.locator(".al-panel").count();
console.log(
  `after list open: account-modal=${largeAfterList} (must be 0), list=${listOpen} (must be 1)`,
);
if (largeAfterList !== 0 || listOpen !== 1) {
  console.error("ONE-AT-A-TIME RULE NOT MET FOR THE LIST");
  process.exit(1);
}
await page.screenshot({ path: join(OUT, "popup-5-list-centered.png") });

await browser.close();
console.log("popup gate met — five shots in screenshots/popup-*.png");
