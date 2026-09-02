/**
 * The fourth-08-14-session production walk (T08's gate, reader half):
 * production at 390×844 as a stranger. A human-paced reaction tap must
 * pass the one-time disclosure, land in Neon (verified separately by SQL),
 * and render the earned success state — solid selection, no not-counted
 * line. The ask box must still answer and log. The protections must be
 * invisible at human speed: that absence-of-friction IS this walk's
 * assertion, and the burst refusal (the other direction) is proven by
 * scripts run beside this walk, not by it.
 *
 * `pnpm exec tsx scripts/tester-walk-0814d.mts`
 *
 * NOTE: the COUNTED tap is a REAL write to the production store, stamped
 * at the run's wall-clock time on the first ballot candidate at 85701 —
 * the session report names it so the tester-activity delta can exclude it.
 */
import { type Page } from "playwright";
import { join } from "node:path";
import { launchGuarded } from "./browser.mts";

import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";

const OUT = "C:/Users/seanj/dev/we-the-people/screenshots";
const BASE = process.env.WALK_BASE_URL ?? PUBLIC_SITE_ORIGIN;

const results: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await launchGuarded({ label: "tester-walk-0814d" });
const context = await browser.context({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  reducedMotion: "reduce",
});
const page: Page = await context.newPage();
const consoleErrors: string[] = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160));
});

// ── The map, cold entry — a stranger with a zip ────────────────────────
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const zipInput = page.locator(".welcome-overlay input").first();
if (await zipInput.isVisible().catch(() => false)) {
  await zipInput.click();
  await page.keyboard.type("85701", { delay: 60 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(8000);
}
// The stranger's first visit surfaces the quick tour (6c) — skip it the
// way a hurried reader would.
const tour = page.getByRole("dialog", { name: "Quick tour" });
if (await tour.isVisible().catch(() => false)) {
  await tour.getByRole("button", { name: "Skip the tour" }).click();
  await page.waitForTimeout(800);
}
const noThanks = page.getByRole("button", { name: /No thanks|show me everything/i });
if (await noThanks.isVisible().catch(() => false)) {
  await noThanks.click();
  await page.waitForTimeout(1200);
}
check("map renders for the stranger", /govern|meeting/i.test(await page.locator("body").innerText()));

// ── The ask box still answers, at human typing speed ───────────────────
const ask = page.locator("input[data-ask-box]:visible").first();
if (await ask.isVisible().catch(() => false)) {
  await ask.click();
  await page.keyboard.type("who fixes potholes", { delay: 70 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(4500);
  const askContainer = page
    .locator('div[class*="border-dashed"]')
    .filter({ has: page.locator("input[data-ask-box]:visible") })
    .first();
  const answer = await askContainer.innerText().catch(() => "");
  check("ask box answers after the beat", /Streets|roads|Transportation/i.test(answer), answer.slice(0, 80));
  await page.screenshot({ path: join(OUT, "walk0814d-ask-answers.png") });
} else {
  check("ask box answers after the beat", false, "ask box not found on the map view");
}

// ── The reaction tap: disclosure → acknowledge → counted ───────────────
await page.goto(`${BASE}/ballot?zip=85701`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
const yes = page.getByRole("button", { name: "Yes", exact: true }).first();
check("a reaction control renders on the ballot", await yes.isVisible().catch(() => false));
await yes.click();
await page.waitForTimeout(800);

// The stranger's first-ever tap parks behind the one-time notice.
const bodyText = await page.locator("body").innerText();
check(
  "first tap parks behind the one-time notice (friction exception 1/3, working)",
  /Your answer joins anonymous local totals/.test(bodyText),
);
await page.screenshot({ path: join(OUT, "walk0814d-disclosure.png") });
const okButton = page.getByRole("button", { name: /OK — record my answer/ });
if (await okButton.isVisible().catch(() => false)) {
  await okButton.click();
  await page.waitForTimeout(3500);
}
const afterTap = await page.locator("body").innerText();
check(
  "the tap lands and renders EARNED success — no honest-failure line",
  !/Couldn't reach the totals/.test(afterTap),
);
const pressed = await page
  .getByRole("button", { name: "Yes", exact: true })
  .first()
  .getAttribute("aria-pressed");
check("the choice renders selected", pressed === "true");
await page.screenshot({ path: join(OUT, "walk0814d-tap-counted.png") });

// A second tap — changing the answer at human pace — must also pass.
const unsure = page.getByRole("button", { name: "Unsure", exact: true }).first();
await unsure.click();
await page.waitForTimeout(3000);
check(
  "changing the answer at human pace also lands",
  !/Couldn't reach the totals/.test(await page.locator("body").innerText()),
);

check("no console errors on the walk", consoleErrors.length === 0, consoleErrors.join(" | "));

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failed}/${results.length} checks green (${BASE})`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
