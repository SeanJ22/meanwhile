/**
 * Does an autocomplete body row open a card? A probe, not a check.
 *
 * Written while appending the standing walk check for g15's M135 conversion
 * (g16, 2026-08-18): the first draft of that check scoped the ask box to
 * `[data-ask-panel] [data-ask-box]` and reported COULD NOT RUN at both zips —
 * honest, and useless. This finds the selector that works and prints what a
 * body row actually does, so the check is written against the DOM rather than
 * against a guess about it.
 *
 *   SHOOT_BASE_URL=… corepack pnpm tsx scripts/probe-m135.mts
 */
import { launchGuarded } from "./browser.mts";

const BASE = (process.env.SHOOT_BASE_URL ?? "https://sparkwtp.netlify.app").replace(/\/$/, "");
const PHONE = { width: 390, height: 844 };

const browser = await launchGuarded({ label: "probe-m135" });
console.log(`probe-m135 — ${BASE}, run ${browser.runId}`);

for (const zip of ["85701", "85641"]) {
  const context = await browser.context({ viewport: PHONE, deviceScaleFactor: 2 });
  await context.addInitScript(
    `(() => { try {
        sessionStorage.setItem("wtp.approximate_location", JSON.stringify({ zip: "${zip}", savedAt: new Date().toISOString() }));
        localStorage.setItem("wtp.tutorial_seen", "1");
      } catch {} })()`,
  );
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);

  const present = await page.evaluate(`({
    askBox: document.querySelectorAll("[data-ask-box]").length,
    scoped: document.querySelectorAll("[data-ask-panel] [data-ask-box]").length,
    panel: document.querySelectorAll("[data-ask-panel]").length,
  })`);
  console.log(`  ${zip}: ${JSON.stringify(present)}`);

  // The ask panel is not on the page at rest: the who-governs card is, and the
  // rail is behind it. Minimize, then open the ask pill — the same two steps
  // walk-all's own M119 and A02 checks take.
  const minimize = page.locator(".coverage-notice button[aria-label^='Minimize']").first();
  if ((await minimize.count()) > 0) {
    await minimize.click();
    await page.waitForTimeout(900);
  }
  if ((await page.locator("[data-ask-panel]").count()) === 0) {
    await page.locator("[data-ask-pill]").first().click();
    await page.waitForTimeout(700);
  }

  const input = page.locator("[data-ask-box]").first();
  if ((await input.count()) === 0) {
    console.log(`  ${zip}: no ask box even after opening the rail`);
    await context.close();
    continue;
  }
  await input.fill("a");
  await page.waitForTimeout(1200);
  const rows = await page.evaluate(`
    Array.from(document.querySelectorAll(".search-ac-item")).slice(0, 12).map((el) => ({
      type: el.querySelector(".search-ac-type")?.textContent?.trim() ?? "",
      name: el.querySelector(".search-ac-name")?.textContent?.trim() ?? "",
    }))
  `);
  console.log(`  ${zip}: ${JSON.stringify(rows)}`);

  const bodyRows = page.locator(".search-ac-item", {
    has: page.locator(".search-ac-type", { hasText: /^Body$/ }),
  });
  const n = await bodyRows.count();
  console.log(`  ${zip}: ${n} body row(s)`);
  if (n > 0) {
    const label = (await bodyRows.first().locator(".search-ac-name").innerText()).trim();
    await bodyRows.first().click();
    await page.waitForTimeout(2500);
    const opened = await page.evaluate(`({
      accountModal: document.querySelectorAll(".account-modal").length,
      dialog: document.querySelectorAll("[role=dialog]").length,
    })`);
    console.log(`  ${zip}: clicked ${JSON.stringify(label)} -> ${JSON.stringify(opened)}`);
  }
  await context.close();
}

await browser.close();
