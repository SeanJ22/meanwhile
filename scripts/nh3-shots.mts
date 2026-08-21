/**
 * NH Hunt 3 — the reader's view of RULING 54, captured so it can be READ.
 *
 * RULING 2: a full-page screenshot is evidence only once it has been read as an
 * image, and a DOM assertion plus a live walk is explicitly not a substitute —
 * the defects this rule exists to catch are the ones the DOM is happy about.
 *
 * The ballot page at 03255 is tens of thousands of pixels tall, so a whole-page
 * capture cannot carry a claim about one line of text on one card. This scrolls
 * each named candidate's card into view and captures THAT ELEMENT, which is the
 * thing the claim is about: a person who had no way to be reached now has one.
 *
 *   pnpm nh3:shots                         # against the dev server
 *   SHOOT_BASE_URL=<origin> pnpm nh3:shots # against a deploy
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { launchGuarded } from "./browser.mts";

const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";
const OUT = join(process.cwd(), ".nh3tmp");

/** The two RULING 54 names by hand, plus one card that already had contacts. */
const WANTED = ["Kathleen Donnelly", "Cynthia Rusis", "Karen Elizabeth Ebel"];

const browser = await launchGuarded({ label: "NH3-shots" });
console.log("run id:", browser.runId);
mkdirSync(OUT, { recursive: true });

const page = await browser.page({ viewport: { width: 430, height: 932 } });
await page.goto(`${BASE}/ballot?zip=03255`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

let captured = 0;
for (const name of WANTED) {
  /*
   * `.candidate-row` is the card itself. The first version of this used
   * `li,article,div` filtered by the name and captured the contest's PILL BAR —
   * a strip of candidate-name buttons with no address on it at all. Read as an
   * image, it showed two names and nothing else, and had it been reported
   * without being opened it would have been exactly the unread-evidence claim
   * RULING 2 forbids. The DOM query was happy; the picture was not.
   */
  const card = page.locator(".candidate-row").filter({ hasText: name }).first();

  const count = await card.count();
  if (count === 0) {
    // An operation that can return nothing is asked what it returned. A card
    // that could not be found is reported, never silently skipped.
    console.log(`  MISS: no card found for ${name}`);
    continue;
  }

  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const slug = name.toLowerCase().replace(/[^a-z]+/g, "-");
  const file = join(OUT, `card-${slug}.png`);
  await card.screenshot({ path: file });

  const text = (await card.innerText()).replace(/\s+/g, " ").slice(0, 300);
  console.log(`  captured ${file}`);
  console.log(`    text: ${text}`);
  captured += 1;
}

console.log(`\ncaptured ${captured} of ${WANTED.length} card(s)`);
await browser.close();
if (captured < WANTED.length) process.exit(1);
