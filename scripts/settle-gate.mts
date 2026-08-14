/**
 * The 2a gate, both halves:
 *
 * 1. Pan from 85641 into central Tucson with no zip change — Tucson's
 *    meetings appear via the settle path.
 * 2. Kill the fetch artificially — every surface says couldn't-check,
 *    never a confident 0.
 *
 * Keyboard gestures, not mouse drags: Playwright's mouse-drag never ends
 * MapLibre's drag in headless (state.md §12 — harness artifact), while
 * arrow/zoom keys carry originalEvent through the same moveend path the
 * settle logic keys on.
 *
 * Prints what actually rendered — the script fails loudly if the settle
 * fetch produced nothing, per the count invariant.
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
      JSON.stringify({ zip: "85641", savedAt: new Date().toISOString() }),
    );
    localStorage.setItem("wtp.show_districts", "1");
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

const meetingRequests: string[] = [];
page.on("request", (r) => {
  if (r.url().includes("/api/meetings")) meetingRequests.push(r.url());
});

await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(8000);

const statValues = () =>
  page.$$eval(".stat-card", (cards) =>
    cards.map((c) => ({
      label: c.querySelector(".label")?.textContent?.trim(),
      value: c.querySelector(".num")?.textContent?.trim(),
    })),
  );

console.log("at 85641:", JSON.stringify(await statValues()));

// ── Half 1: pan into central Tucson by keyboard gesture ──────────────────
await page.locator("canvas").first().click({ position: { x: 720, y: 450 } });
// Zoom out two steps so each 100px arrow pan covers real ground.
for (const key of ["-", "-"]) {
  await page.keyboard.press(key);
  await page.waitForTimeout(350);
}
// Northwest toward Tucson: west (map center moves west on ArrowLeft) and north.
for (let i = 0; i < 6; i++) {
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(250);
}
for (let i = 0; i < 4; i++) {
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(250);
}
// Settle debounce is 650 ms; the refetch and render need a beat beyond.
await page.waitForTimeout(4000);

const afterPan = await statValues();
const settleRequests = meetingRequests.filter((u) => !u.includes("zip="));
console.log("after pan:", JSON.stringify(afterPan));
console.log(
  `meetings requests: ${meetingRequests.length} total, ${settleRequests.length} settle-shaped (no zip)`,
);

const meetingsAfterPan = Number(
  afterPan.find((s) => s.label === "Meetings")?.value ?? "0",
);
if (settleRequests.length === 0) {
  console.error("NO SETTLE-SHAPED REQUEST FIRED — the pan did not settle");
  process.exit(1);
}
if (!Number.isFinite(meetingsAfterPan) || meetingsAfterPan < 5) {
  console.error(
    `EXPECTED TUCSON'S MEETINGS AFTER THE PAN, got ${afterPan.find((s) => s.label === "Meetings")?.value}`,
  );
  process.exit(1);
}
await page.screenshot({ path: join(OUT, "settle-1-tucson-meetings.png") });

// ── Half 2: kill the fetch; every surface must say couldn't-check ────────
await page.route("**/api/meetings*", (route) => route.abort());
// Another gesture to trigger a fresh settle fetch, which will now die.
await page.keyboard.press("ArrowUp");
await page.waitForTimeout(3500);

const failedStats = await statValues();
console.log("after killed fetch:", JSON.stringify(failedStats));

const bodyText = await page.textContent("body");
const failures: string[] = [];
for (const s of failedStats) {
  if (["Meetings", "Bodies", "Officials"].includes(s.label ?? "") && s.value === "0") {
    failures.push(`stat ${s.label} reads 0 beside a failed fetch`);
  }
}
if (!bodyText?.includes("Search failed")) failures.push("no failure card rendered");
if (!bodyText?.includes("couldn't check") && !bodyText?.includes("Couldn't check"))
  failures.push("no couldn't-check language anywhere");
if (!bodyText?.includes("Try again")) failures.push("no retry affordance");

if (failures.length > 0) {
  console.error("FAILED-STATE GATE NOT MET:\n  " + failures.join("\n  "));
  process.exit(1);
}
await page.screenshot({ path: join(OUT, "settle-2-failed-honest.png") });

// ── The retry actually retries: restore the network, click Try again ─────
await page.unroute("**/api/meetings*");
await page.getByRole("button", { name: "Try again" }).click();
await page.waitForTimeout(3000);
const afterRetry = await statValues();
console.log("after retry:", JSON.stringify(afterRetry));
const meetingsAfterRetry = Number(
  afterRetry.find((s) => s.label === "Meetings")?.value ?? "0",
);
if (!Number.isFinite(meetingsAfterRetry) || meetingsAfterRetry < 1) {
  console.error("RETRY DID NOT RECOVER — meetings still absent");
  process.exit(1);
}
await page.screenshot({ path: join(OUT, "settle-3-retry-recovered.png") });

await browser.close();
console.log("gate met: settle serves Tucson, failure is honest, retry recovers");
