/**
 * The reader-facing evidence for F01-continued session 2 — items 12, 14, 15
 * and 17, 2026-08-19.
 *
 * `pnpm shoot:f01c2 [--base=…] [--tag=before|after] [--zip=07866]`
 *
 * A DOM assertion is not a screenshot. Where this brief asks for a picture
 * the picture is taken, read as an image, and named in the report; where only
 * a DOM assertion was possible that is said instead of counted. This script
 * takes the pictures and prints, beside each, the DOM facts that say what is
 * in it — so a green number and a rendered page are checked against each
 * other rather than one standing in for the other.
 *
 * Every context declares itself (`scripts/browser.mts`), so the rows this
 * writes are attributable and excluded from anything sold.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { launchGuarded } from "./browser.mts";

const PHONE = { width: 430, height: 932 };

const arg = (name: string, fallback: string) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

const BASE = arg("base", "http://localhost:3000");
const TAG = arg("tag", "after");
const ZIPS = arg("zip", "07866").split(",");
const OUT = join(process.cwd(), "screenshots");

await mkdir(OUT, { recursive: true });

const browser = await launchGuarded({ label: `shoot-f01c-s2-${TAG}` });
console.log(`run id: ${browser.runId}\nbase: ${BASE}\ntag: ${TAG}\n`);

const shots: string[] = [];

for (const zip of ZIPS) {
  const page = await browser.page({ viewport: PHONE });
  try {
    await page.goto(`${BASE}/ballot?zip=${zip}`, {
      waitUntil: "networkidle",
      timeout: 90_000,
    });
    await page
      .locator(".candidate-row")
      .first()
      .waitFor({ timeout: 30_000 })
      .catch(() => {});

    const facts = (await page.evaluate(
      `(() => ({
         height: document.documentElement.scrollHeight,
         rows: document.querySelectorAll('.candidate-row').length,
         pills: document.querySelectorAll('[data-battlecard-pill]').length,
         inlinePositions: document.querySelectorAll('[data-candidate-positions]').length,
         inlineFunding: document.querySelectorAll('[data-candidate-funding]').length,
         enumerations: Array.from(document.querySelectorAll('[data-gap-enumeration]')).length,
         annotations: Array.from(document.querySelectorAll('[data-gap-annotation]')).length,
       }))()`,
    )) as Record<string, number>;

    const top = join(OUT, `f01c2-ballot-${zip}-${TAG}-top.png`);
    await page.screenshot({ path: top });
    shots.push(top);

    // The whole page, so "it is shorter" is visible rather than only counted.
    const full = join(OUT, `f01c2-ballot-${zip}-${TAG}-full.png`);
    await page.screenshot({ path: full, fullPage: true });
    shots.push(full);

    console.log(
      `${zip} (${TAG})\n` +
        `  scrollHeight ${facts.height} px  (${(facts.height / PHONE.height).toFixed(1)} screens)\n` +
        `  candidate rows ${facts.rows} · pills ${facts.pills}\n` +
        `  inline positions ${facts.inlinePositions} · inline funding ${facts.inlineFunding}\n` +
        `  gap enumerations ${facts.enumerations} · gap annotations ${facts.annotations}`,
    );

    // The opened battlecard, which is the other half of the claim: the
    // sections did not vanish, they moved.
    const pill = page.locator("[data-battlecard-pill]").first();
    if ((await pill.count()) > 0) {
      await pill.scrollIntoViewIfNeeded();
      await pill.click();
      await page
        .locator("[data-candidate-battlecard]")
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
      const inside = (await page.evaluate(
        `(() => {
           const card = document.querySelector('[data-candidate-battlecard]');
           if (!card) return null;
           return {
             positions: card.querySelectorAll('[data-candidate-positions]').length,
             funding: card.querySelectorAll('[data-candidate-funding]').length,
             enumerations: card.querySelectorAll('[data-gap-enumeration]').length,
             text: (card.textContent || '').slice(0, 200),
           };
         })()`,
      )) as { positions: number; funding: number; enumerations: number; text: string } | null;

      const open = join(OUT, `f01c2-battlecard-${zip}-${TAG}.png`);
      await page.screenshot({ path: open });
      shots.push(open);
      console.log(
        inside
          ? `  OPENED battlecard — positions ${inside.positions}, funding ${inside.funding}, ` +
              `enumerations ${inside.enumerations}`
          : "  OPENED battlecard — NOT FOUND (this is a failure to open, not an empty card)",
      );
    } else {
      console.log("  no battlecard pill on this page");
    }
    console.log("");
  } finally {
    await page.context().close();
  }
}

await browser.close();
console.log(`${shots.length} screenshot(s):`);
for (const s of shots) console.log(`  ${s}`);
