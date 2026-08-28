/**
 * **ASK04 — proving Ask actually WORKS on the ballot, on a real production
 * build, at desktop and mobile widths.** (2026-08-27.)
 *
 * This is a reader-output check and not a DOM check. PR #211's lesson was that
 * a correct data attribute beside a false sentence is still a false product, so
 * this drives the real control, waits for the real reply, and PRINTS THE
 * SENTENCE A READER WOULD SEE at both widths for a human to read.
 *
 *   pnpm exec tsx scripts/shoot-ballot-ask-0827.mts [baseUrl]
 *
 * Opened through `launchGuarded`, which is the only permitted way to open a
 * browser here: every request carries `x-wtp-synthetic-run` and `sendBeacon`
 * is disabled, so a walk of our own cannot land ORGANIC rows in a sold store.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { launchGuarded } from "./browser.mts";

const BASE = process.argv[2] ?? "http://127.0.0.1:3111";
/* A GITIGNORED capture directory, per the convention in .gitignore: a
   screenshot is EVIDENCE A HUMAN READS, and committing it would trip the
   asset-store guard (RULING 20) — which is that guard working, because a PNG
   is a binary and binaries do not go in git. */
const OUT = join(process.cwd(), ".askshots");
const QUESTION = "What does this office control?";

const WIDTHS = [
  { name: "desktop", width: 1280, height: 1400 },
  { name: "mobile", width: 390, height: 1400 },
] as const;

mkdirSync(OUT, { recursive: true });

const guarded = await launchGuarded({ label: "ballot-ask-0827" });
console.log(`run id: ${guarded.runId}`);

for (const size of WIDTHS) {
  const page = await guarded.page({ viewport: { width: size.width, height: size.height } });
  await page.goto(`${BASE}/ballot?zip=85641`, { waitUntil: "domcontentloaded" });

  // BAL-26 (2026-08-28): the panel unmounts while the pill is collapsed.
  await page.click("[data-ballot-ask-pill]");
  await page.waitForSelector("[data-ballot-ask]", { timeout: 15_000 });

  const panel = page.locator("[data-ballot-ask]");
  const present = await panel.count();
  console.log(`\n=== ${size.name} (${size.width}x${size.height}) ===`);
  console.log(`ask panel present: ${present === 1}`);
  if (present !== 1) {
    await page.close();
    continue;
  }

  /*
   * **SCROLL FIRST, THEN MEASURE.** The first version of this script asserted
   * visibility before scrolling and reported the desktop panel INVISIBLE with a
   * null box. It was not: this ballot page is ~20,000px tall at 1280 and
   * ~25,000px at 390, and an element that far below the fold measures 0x0 until
   * it is scrolled to. The pre-existing [data-collection-note] measured 0x0 in
   * exactly the same way, which is what proved the check wrong rather than the
   * product. A false-first instrument is still a false instrument.
   */
  await panel.first().scrollIntoViewIfNeeded();
  console.log(`ask panel visible: ${await panel.first().isVisible()}`);
  const box = await panel.first().boundingBox();
  console.log(`ask panel box    : ${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "none"}`);
  /* It must not push the page sideways at 390px. */
  const overflow = await page.evaluate(
    "document.documentElement.scrollWidth - document.documentElement.clientWidth",
  );
  console.log(`horizontal overflow: ${overflow}px`);

  await page.locator("[data-ask-input]").fill(QUESTION);
  await page.locator("[data-ask-submit]").click();

  await page
    .locator("[data-ask-mode]")
    .first()
    .waitFor({ state: "attached", timeout: 90_000 })
    .catch(() => console.log("!! no reply arrived within 90s"));

  const mode = await page.locator("[data-ask-mode]").first().getAttribute("data-ask-mode");
  console.log(`answer mode      : ${mode}`);

  const rendered = (await panel.first().innerText()).trim();
  console.log("--- WHAT THE READER SEES ---");
  console.log(rendered.split("\n").map((l) => `  ${l}`).join("\n"));

  await panel.first().screenshot({ path: join(OUT, `${size.name}.png`) });
  console.log(`shot: .askshots/${size.name}.png`);
  await page.close();
}

await guarded.close();
