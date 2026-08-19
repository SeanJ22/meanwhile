/**
 * AUD-03's behavioural check: the deferred surfaces still arrive (g17, 2026-08-18).
 *
 * Eight surfaces moved behind `next/dynamic` boundaries with `ssr: false`. The
 * byte saving is measured by the build; what a build cannot tell anyone is
 * whether the reader still SEES them. A chunk that fails to load renders
 * nothing at all, and nothing at all is exactly what a correctly-hidden overlay
 * also renders — so this drives a real browser and asks the DOM.
 *
 * The welcome overlay is the dangerous one: it is the first thing a reader
 * meets, and it is now behind an async boundary. If it does not arrive, the
 * product opens on a map with no way in.
 *
 * Local only, against `pnpm dev` on port 3000. It goes through
 * `scripts/browser.mts` like every other browser in this repo, so its requests
 * declare themselves — a local dev server writes to the LOCAL branch, but the
 * declaration is not conditional on where the rows land.
 */

import { launchGuarded } from "./browser.mts";

const BASE = process.env.AUD03_BASE_URL ?? "http://localhost:3000";
const ZIP = "85701";

const results: { name: string; ok: boolean; detail: string }[] = [];

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

const browser = await launchGuarded({ label: "verify-aud03", headless: true });
console.log(`run id: ${browser.runId}`);
const page = await browser.page({ viewport: { width: 1280, height: 900 } });

try {
  const failedChunks: string[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/_next/static/chunks/") && r.status() >= 400) {
      failedChunks.push(`${r.status()} ${r.url()}`);
    }
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await page.goto(BASE, { waitUntil: "domcontentloaded" });

  /* 1. The welcome overlay — the entry surface, now async. */
  const zipInput = page.locator('input[inputmode="numeric"], input[name="zip"]').first();
  await zipInput.waitFor({ state: "visible", timeout: 30_000 });
  record(
    "WelcomeOverlay arrives after its async boundary",
    true,
    "the zip input is visible on a cold load",
  );

  /* 2. It still works: a zip resolves and the map answers. */
  await zipInput.fill(ZIP);
  await zipInput.press("Enter");
  await page.waitForResponse(
    (r) => r.url().includes("/api/meetings") && r.status() === 200,
    { timeout: 45_000 },
  );
  await page.waitForTimeout(2_500);
  record("the welcome overlay's zip still searches", true, `${ZIP} returned 200`);

  /* 3. The tutorial overlay — also async, and it proves itself by being in the
        way: it opens over the map after the zip resolves, so it has to be
        dismissed before anything else can be clicked. */
  const tour = page.getByRole("dialog", { name: /quick tour/i });
  const tourUp = await tour.isVisible().catch(() => false);
  record(
    "TutorialOverlay arrives after its async boundary",
    tourUp,
    tourUp ? "the quick tour opened over the map" : "no tour dialog appeared",
  );
  if (tourUp) {
    const skip = tour.getByRole("button", { name: /skip|close|done|got it/i }).first();
    if ((await skip.count()) > 0) await skip.click();
    else await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
  }

  /* 4. The list overlay — the one candidate that is always mounted. */
  const listButton = page
    .getByRole("button", { name: /list|what.s on the map/i })
    .first();
  const hasList = await listButton.count();
  if (hasList > 0) {
    await listButton.click();
    const rows = page.locator('[data-testid="list-overlay"], [role="dialog"]');
    await page.waitForTimeout(1_500);
    const visible = await rows.first().isVisible().catch(() => false);
    record(
      "ListOverlay arrives after its async boundary",
      visible,
      visible ? "the list panel rendered on click" : "the list panel did not render",
    );
  } else {
    record("ListOverlay button found", false, "no list control on the page");
  }

  record(
    "no chunk 404s",
    failedChunks.length === 0,
    failedChunks.length === 0 ? "every referenced chunk loaded" : failedChunks.join("; "),
  );
  record(
    "no page errors",
    pageErrors.length === 0,
    pageErrors.length === 0 ? "console clean" : pageErrors.join("; "),
  );
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\nverify-aud03: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exit(1);
