/**
 * Item 1, verified on the CARD THE AUTHOR REPORTED.
 *
 * The defect was the district battlecard's Sources tab saying "Nothing on
 * this card came from an external record" on Tucson Unified District. The
 * person card is a different card class and proving that one says nothing
 * about this one — so this drives the district card specifically, on
 * whichever origin is given.
 *
 *   SHOOT_BASE_URL=https://… pnpm tsx scripts/verify-sources-tab.mts
 */


import { makeRunId, syntheticRunHeaders } from "../lib/db/run-marker.ts";

/**
 * C05 (2026-08-17): this run declares itself so the rows it writes to
 * production's search log are never counted as a reader's. The runner cannot
 * mark the row — the route writes it — so it says who it is in a header.
 */
const RUN_HEADERS = syntheticRunHeaders({
  WTP_RUN_ID:
    process.env.WTP_RUN_ID?.trim() ||
    makeRunId("verify-sources-tab", new Date().toISOString()),
});

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchGuarded } from "./browser.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";
const TAG = process.env.SHOOT_BASE_URL ? "prod" : "after";

const FALSE_SENTENCE = "Nothing on this card came from an external record";

const browser = await launchGuarded({ label: "verify-sources-tab" });
const context = await browser.context({
    // C05: this run is ours, declared at write time.
    extraHTTPHeaders: RUN_HEADERS,
  viewport: { width: 1440, height: 950 },
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
  } catch {}
});
const page = await context.newPage();
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(8000);

/*
 * The district battlecard is reached from the MAP: click inside a district
 * boundary, the compact district card opens, "More" opens the battlecard.
 *
 * NOT from the districts door — that door lists the PEOPLE who represent the
 * districts in view and offers no affordance for the district itself, which
 * is precisely the half of M92 that did not ship this session. Recorded here
 * because discovering it while verifying is how it stops being invisible.
 */
let opened = false;
const points: [number, number][] = [
  [1050, 520],
  [1250, 700],
  [900, 400],
  [1400, 850],
  [1150, 300],
];
for (const [x, y] of points) {
  await page.mouse.click(x, y);
  await page.waitForTimeout(1400);
  const more = page.locator(".popup-card button", { hasText: "More" }).first();
  if ((await more.count()) === 0) continue;
  const label = ((await page.locator(".popup-card h3").first().textContent()) ?? "").trim();
  await more.click();
  await page.waitForTimeout(1400);
  if ((await page.locator(".account-modal-tab").count()) > 0) {
    console.log("opened from map at", x, y, "→", JSON.stringify(label));
    opened = true;
    break;
  }
}

if (!opened) {
  console.log("!! could not open a district battlecard — VERIFICATION FAILED");
  await browser.close();
  process.exit(1);
}

const title = await page.locator(".account-modal-title").first().textContent();
console.log("card:", (title ?? "").trim());

/*
 * The cross-check that matters more than the count itself: if the card
 * RENDERS people or meetings, its Sources tab has to name where they came
 * from. A tab that states "1" while the Representation tab lists a senator
 * is a smaller version of the same lie.
 */
for (const name of ["Representation", "Meetings"]) {
  const t = page.locator(".account-modal-tab", { hasText: name }).first();
  await t.click();
  await page.waitForTimeout(500);
  const n = await page.evaluate(
    () =>
      document.querySelector(".account-modal-body")?.querySelectorAll(".account-modal-person")
        .length ?? 0,
  );
  console.log(`${name} rows:`.padEnd(16), n);
}

const tab = page.locator('.account-modal-tab', { hasText: "Sources" }).first();
const tabText = ((await tab.textContent()) ?? "").trim();
await tab.click();
await page.waitForTimeout(600);

const result = await page.evaluate(() => {
  const body = document.querySelector(".account-modal-body");
  return {
    rows: body?.querySelectorAll(".account-modal-person").length ?? 0,
    text: (body?.textContent ?? "").slice(0, 400),
  };
});

const statedN = tabText.replace(/[^\d]/g, "");
const carriesFalseSentence = result.text.includes(FALSE_SENTENCE);

console.log("tab label:      ", JSON.stringify(tabText));
console.log("stated N:       ", statedN || "(none)");
console.log("rendered rows:  ", result.rows);
console.log("false sentence: ", carriesFalseSentence ? "PRESENT — STILL BROKEN" : "absent");
console.log("first 400 chars:", JSON.stringify(result.text));

await page.screenshot({ path: join(root, "screenshots", `${TAG}-0816-14-district-sources.png`) });
await browser.close();

const ok =
  !carriesFalseSentence && result.rows > 0 && statedN === String(result.rows);
console.log(
  ok
    ? "\nOK — the tab states its count, the count equals the rendered rows, and the false sentence is gone."
    : "\nFAILED — see above.",
);
if (!ok) process.exitCode = 1;
