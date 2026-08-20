/**
 * **How long is the ballot?** — F01-continued session 2, item 12, 2026-08-19.
 *
 * `pnpm measure:ballot [--base=http://localhost:3000] [--zip=07866,85701]`
 *
 * The author's finding: *"the ballot is a forever scroll because every long
 * section renders inline on the ballot itself."* The fix moves those sections
 * into the large battlecard, which already has slots for them — and a fix to
 * a length complaint that does not MEASURE the length is an opinion.
 *
 * So the number is taken before and after, at the viewport the complaint was
 * made on (430×932, the author's phone), on the same two zips, by the same
 * instrument. `document.documentElement.scrollHeight` in CSS pixels, plus the
 * count of screens that is — because "18,000 pixels" means nothing to a
 * reader and "nineteen phone screens" means everything.
 *
 * Every context declares itself (`scripts/browser.mts`), so the rows this
 * writes are attributable and excluded from anything sold.
 */
import { launchGuarded } from "./browser.mts";

const PHONE = { width: 430, height: 932 };

const baseArg = process.argv.find((a) => a.startsWith("--base="));
const BASE = baseArg ? baseArg.slice("--base=".length) : "http://localhost:3000";
const zipArg = process.argv.find((a) => a.startsWith("--zip="));
const ZIPS = (zipArg ? zipArg.slice("--zip=".length) : "07866,85701").split(",");

const browser = await launchGuarded({ label: "measure-ballot-scroll" });
console.log(`run id: ${browser.runId}`);
console.log(`base:   ${BASE}`);
console.log(`viewport: ${PHONE.width}×${PHONE.height}\n`);

const results: { zip: string; height: number; screens: number; rows: number; pills: number }[] = [];

for (const zip of ZIPS) {
  const page = await browser.page({ viewport: PHONE });
  try {
    await page.goto(`${BASE}/ballot?zip=${zip}`, {
      waitUntil: "networkidle",
      timeout: 90_000,
    });
    // The page renders contests server-side; wait for at least one row rather
    // than for a fixed delay, so a slow build does not read as a short page.
    await page
      .locator(".candidate-row")
      .first()
      .waitFor({ timeout: 30_000 })
      .catch(() => {});

    const measured = (await page.evaluate(
      `(() => ({
         height: document.documentElement.scrollHeight,
         rows: document.querySelectorAll('.candidate-row').length,
         pills: document.querySelectorAll('[data-battlecard-pill]').length,
         positions: document.querySelectorAll('[data-candidate-positions]').length,
         funding: document.querySelectorAll('[data-candidate-funding]').length,
       }))()`,
    )) as {
      height: number;
      rows: number;
      pills: number;
      positions: number;
      funding: number;
    };

    const screens = measured.height / PHONE.height;
    results.push({
      zip,
      height: measured.height,
      screens,
      rows: measured.rows,
      pills: measured.pills,
    });
    console.log(
      `${zip}\n` +
        `  scrollHeight        ${measured.height} px\n` +
        `  = phone screens     ${screens.toFixed(1)}\n` +
        `  candidate rows      ${measured.rows}\n` +
        `  battlecard pills    ${measured.pills}\n` +
        `  inline positions    ${measured.positions}\n` +
        `  inline funding      ${measured.funding}\n`,
    );
  } finally {
    await page.context().close();
  }
}

await browser.close();

// The denominator, stated: a run that measured nothing must not read as a
// short page.
if (results.length !== ZIPS.length) {
  console.error(
    `measured ${results.length} of ${ZIPS.length} zips — the missing ones are ` +
      "NOT zero-length pages, they are pages this run could not read.",
  );
  process.exitCode = 1;
}
console.log(
  "SUMMARY  " +
    results.map((r) => `${r.zip}=${r.height}px (${r.screens.toFixed(1)} screens)`).join("  ·  "),
);
