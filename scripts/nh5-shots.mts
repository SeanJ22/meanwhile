/**
 * NH Hunt 5 — the reader's view of RULING 59 and the twigs, captured so it can
 * be READ.
 *
 * RULING 2: a full-page screenshot is evidence only once a person has opened it
 * as an image, and a DOM assertion plus a live walk is explicitly NOT a
 * substitute — the defects this rule exists to catch are the ones the DOM is
 * happy about. NH Hunt 4's stale coverage note is the case in point: every
 * automated check was green while the page contradicted itself, and a human
 * reading a capture is what found it.
 *
 *   pnpm nh5:shots                          # against the dev server
 *   SHOOT_BASE_URL=<origin> pnpm nh5:shots  # against a deploy
 *
 * ## Why these captures are CLIPPED rather than full-page
 *
 * The ballot page at 03255 runs to tens of thousands of pixels. A whole-page
 * capture of it cannot be read as an image at any useful scale, so it would be
 * evidence in name only. Each shot below is either a viewport-sized region or a
 * named element, which is the thing the claim is actually about.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { launchGuarded } from "./browser.mts";

const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";
const OUT = join(process.cwd(), ".nh5tmp");

const browser = await launchGuarded({ label: "NH5-shots" });
console.log("run id:", browser.runId);
mkdirSync(OUT, { recursive: true });

const page = await browser.page({ viewport: { width: 430, height: 932 } });

interface Shot {
  file: string;
  what: string;
  /** Printed beside the capture so the reader of the log knows what to look for. */
  claim: string;
}
const shots: Shot[] = [];

/* ---------------------------------------------------------------- 1 ------- */
/* The foot of the ballot at 03255: Sean's line present, no coverage note.    */
for (const zip of ["03255", "07866", "85641", "85701"]) {
  await page.goto(`${BASE}/ballot?zip=${zip}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  // The DOM facts, printed so the image and the assertion can be read against
  // each other. Neither stands alone: the DOM says what is in the tree, the
  // image says what a reader sees.
  const facts = await page.evaluate(
    `(() => ({
      coverageNotes: document.querySelectorAll('[data-coverage-note]').length,
      collectionNote: (document.body.innerText.match(/What we have found, we are displaying here\\./g) || []).length,
      bannedCoverage: (document.body.innerText.match(/we have not worked out which|Coverage today|Not covered yet|still working out/gi) || []),
      cards: document.querySelectorAll('.candidate-row').length,
    }))()`,
  );
  console.log(`  ${zip}: ${JSON.stringify(facts)}`);

  const note = page.getByText("What we have found, we are displaying here.").first();
  const n = await note.count();
  if (n === 0) {
    console.log(`  MISS: no collection note found at ${zip}`);
    continue;
  }
  await note.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const file = join(OUT, `ballot-foot-${zip}.png`);
  await page.screenshot({ path: file });
  shots.push({
    file,
    what: `/ballot?zip=${zip}, scrolled to the collection note`,
    claim:
      "Sean's line is the ONLY completeness statement on the page, and no " +
      "coverage note renders anywhere near it (RULING 59).",
  });
  console.log(`  captured ${file}`);
}

/* ---------------------------------------------------------------- 2 ------- */
/* about-area at 03255: the coverage note and the state list are both gone.   */
await page.goto(`${BASE}/about-area?zip=03255`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
{
  const facts = await page.evaluate(
    `(() => ({
      coverageNotes: document.querySelectorAll('[data-coverage-note]').length,
      bannedCoverage: (document.body.innerText.match(/Coverage today|Not covered yet|we have not worked/gi) || []),
      heading: (document.querySelector('h1') || {}).innerText || null,
    }))()`,
  );
  console.log(`  about-area: ${JSON.stringify(facts)}`);
  const file = join(OUT, "about-area-03255.png");
  await page.screenshot({ path: file });
  shots.push({
    file,
    what: "/about-area?zip=03255, first viewport",
    claim:
      "No coverage note, no 'Coverage today: New Jersey, New Hampshire, and " +
      "Arizona', no 'Not covered yet' section (RULING 59).",
  });
  console.log(`  captured ${file}`);
}

/* ---------------------------------------------------------------- 3 ------- */
/* The welcome overlay: the ranked-coverage fine print is gone.               */
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
{
  const facts = await page.evaluate(
    `(() => ({
      fineprint: (document.querySelector('.welcome-fineprint') || {}).innerText || null,
      divider: (document.querySelector('.welcome-divider') || {}).innerText || null,
      bannedCoverage: (document.body.innerText.match(/deepest coverage|cover well|can't see yet/gi) || []),
    }))()`,
  );
  console.log(`  welcome: ${JSON.stringify(facts)}`);
  const file = join(OUT, "welcome-overlay.png");
  await page.screenshot({ path: file });
  shots.push({
    file,
    what: "/ — the welcome overlay",
    claim:
      "The fine print reads 'Any U.S. zip works.' and nothing ranks the four " +
      "areas by coverage depth (RULING 59).",
  });
  console.log(`  captured ${file}`);
}

console.log(`\ncaptured ${shots.length} shot(s):`);
for (const s of shots) {
  console.log(`  ${s.file}`);
  console.log(`    ${s.what}`);
  console.log(`    LOOK FOR: ${s.claim}`);
}

await browser.close();

// A capture run that captured nothing is an error state, not a clean board.
if (shots.length === 0) {
  console.error("captured ZERO shots — nothing here is evidence of anything.");
  process.exit(1);
}
