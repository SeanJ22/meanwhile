/**
 * **THE PR #241 BEHAVIOUR, STILL TRUE ON PRODUCTION.**
 * (Part A remainder of `WGH-22`, 2026-08-31.)
 *
 * PR #241 moved the session-address store's listener set to the store boundary
 * so both writers publish, and taught the resolver to ASK for a house number
 * rather than declaring a high-numbered rural street unplaceable. The Part A
 * remainder refactors that store onto a shared helper, and a refactor of a
 * repaired store has exactly one obligation: **prove the repair is still
 * repaired, on the deployed thing, before touching anything else.**
 *
 * ## What this drives, and what it supplies
 *
 * The reader's own interaction, in ONE tab: click the pill, type the street,
 * answer the house-number question the product asks, read the panel. **Nothing
 * is seeded and no event is dispatched.** The synthetic `storage` event a
 * harness can fire is the one notification a browser never sends to the tab
 * that wrote, and firing it is how the 8/31 walk passed over this exact defect
 * while the owner was watching it fail.
 *
 * The ZIP IS seeded, in `sessionStorage` under `wtp.approximate_location` —
 * `?zip=` does not seed the app, the map entry renders its welcome overlay, and
 * a capture behind that overlay is a photograph of the overlay. That is INPUT,
 * not the signal under test.
 *
 * ## What it writes
 *
 * Every request declares itself synthetic through `launchGuarded`, which also
 * kills `sendBeacon` — a live beacon carries `extraHTTPHeaders` and leaks on
 * unload, and a leaked row is our own robot counted as a reader in the store
 * this business sells. `/api/meetings` writes a search-log row on EVERY GET, so
 * the count of same-origin requests this probe made is PRINTED rather than
 * estimated.
 *
 * ```
 * pnpm exec tsx scripts/probe-parta-production.mts
 * ```
 */

import { launchGuarded } from "./browser.mts";

const BASE = (process.env.SHOOT_BASE_URL ?? "https://sparkwtp.netlify.app").replace(/\/$/, "");
const ZIP = "85641";
const STREET = "South Bear Table Tank Drive";
const HOUSE_NUMBER = "10723";

const SEED_ZIP = `(() => {
  try {
    sessionStorage.setItem(
      "wtp.approximate_location",
      JSON.stringify({ zip: ${JSON.stringify(ZIP)}, savedAt: new Date().toISOString() }),
    );
    localStorage.setItem("wtp.tutorial_seen", "1");
  } catch {}
})()`;

/** The panel's rows, read off the DOM and nothing else. Expression-shaped. */
const PANEL_READ = `(() => {
  const rows = [...document.querySelectorAll('[data-seat-standing]')];
  return rows.map((el) => ({
    standing: el.getAttribute('data-seat-standing') || '',
    label: (el.querySelector('.text-label') ? el.querySelector('.text-label').textContent : '').trim(),
  }));
})()`;

interface Row {
  standing: string;
  label: string;
}

const state = (rows: Row[]): string =>
  rows.length === 0
    ? "no rows"
    : rows
        .map((r) => `${r.label || "(unnamed)"}:${r.standing}`)
        .sort()
        .join(" · ");

async function main(): Promise<void> {
  const browser = await launchGuarded({ label: "probe-parta-production" });
  const context = await browser.context({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(SEED_ZIP);
  const lines: string[] = [`base: ${BASE}`, `run id: ${browser.runId}`];
  let sameOrigin = 0;
  let ok = false;

  try {
    const page = await context.newPage();
    page.on("request", (r) => {
      if (r.url().startsWith(BASE)) sameOrigin += 1;
    });
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });

    /*
     * The card is reached the way a reader reaches it — and the FAB is WAITED
     * FOR before it is clicked. Probing for it the instant `domcontentloaded`
     * fires reads an empty page and calls it a missing panel: the first run of
     * this probe reported "the card rendered no seat rows" against a production
     * page whose FAB was present twenty seconds later.
     */
    const fab = page.locator(".notice-fab").first();
    const fabThere = await page
      .waitForSelector(".notice-fab", { timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    if (fabThere && (await fab.isVisible().catch(() => false))) await fab.click();
    const mounted = await page
      .waitForSelector("[data-seat-standing]", { timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    if (!mounted) {
      lines.push("CANNOT RUN: the who-governs card rendered no seat rows to read");
      process.exitCode = 1;
      return;
    }
    const before = (await page.evaluate(PANEL_READ)) as Row[];
    lines.push(`before: ${state(before)}`);

    const pill = page.locator(".could-govern-notice-pill").first();
    if (await pill.isVisible().catch(() => false)) await pill.click();
    const street = page.locator('input[aria-label="Street"]').first();
    if (!(await street.isVisible().catch(() => false))) {
      lines.push("CANNOT RUN: the address prompt offered no street field");
      process.exitCode = 1;
      return;
    }
    await street.fill(STREET);
    await page.locator(".address-prompt-fields button").first().click();

    /*
     * **THE PR #241 RESOLVER FIX, ASSERTED DIRECTLY.** With no house number the
     * resolver probes 1, 50, 200 and 800 against the Census range; this road is
     * numbered 10701-10899, so every probe misses. Before #241 the product
     * declared the street unplaceable — an absence asserted from our own empty
     * result — and offered no field. It must ASK.
     */
    const asked = await page
      .waitForSelector('input[aria-label="House number"]', { timeout: 45_000 })
      .then(() => true)
      .catch(() => false);
    lines.push(
      asked
        ? "the product ASKED for a house number rather than declaring the street unplaceable"
        : "the product did NOT ask for a house number — PR #241's resolver fix is not live",
    );
    if (!asked) {
      process.exitCode = 1;
      return;
    }
    await page.locator('input[aria-label="House number"]').first().fill(HOUSE_NUMBER);
    await page.locator(".address-prompt-fields button").first().click();

    /*
     * **THE PR #241 PUBLISH FIX.** Same tab, no reload, nothing dispatched. The
     * poll is in Node rather than `waitForFunction`, whose default `raf`
     * polling never runs in a page that is not the front tab.
     */
    const startedAt = Date.now();
    let after: Row[] = before;
    /*
     * The wait runs until the rows are CONFIRMED **and named**. `Looking up
     * your district…` is the honest named gap while the roster request is in
     * flight — correct to render, and useless as evidence, because a report
     * saying "every row CONFIRMED" over three placeholders has not shown that
     * the reader can read their district. The ceiling still expires rather than
     * hanging, and whatever the panel held is printed either way.
     */
    const LOOKING = "Looking up your district";
    while (Date.now() - startedAt < 45_000) {
      after = (await page.evaluate(PANEL_READ)) as Row[];
      const confirmed = after.length > 0 && after.every((r) => r.standing === "CONFIRMED");
      const named = after.every((r) => r.label.length > 0 && !r.label.startsWith(LOOKING));
      if (confirmed && named) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    lines.push(`after:  ${state(after)}`);
    const moved = state(before) !== state(after);
    const allConfirmed = after.length > 0 && after.every((r) => r.standing === "CONFIRMED");
    ok = moved && allConfirmed;
    lines.push(
      ok
        ? `PASS  the panel moved in the SAME TAB with nothing supplied, ${Date.now() - startedAt}ms ` +
          `after the answer, and every row is CONFIRMED`
        : `FAIL  moved: ${moved}; all CONFIRMED: ${allConfirmed}`,
    );
    if (!ok) process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
    lines.push("");
    lines.push(
      `same-origin requests this probe made: ${sameOrigin} (every one declared synthetic; ` +
        "/api/meetings writes a search-log row on each GET)",
    );
    process.stdout.write(`${lines.join("\n")}\n`);
  }
}

await main();
