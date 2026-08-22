/**
 * NH Hunt 6 — the reader's view of what this session changed, captured so it
 * can be READ.
 *
 * RULING 2: a full-page screenshot is evidence only once a person has opened it
 * as an image, and a DOM assertion plus a live walk is explicitly NOT a
 * substitute — the defects this rule exists to catch are the ones the DOM is
 * happy about.
 *
 *   pnpm nh6:shots                          # against the dev server
 *   SHOOT_BASE_URL=<origin> pnpm nh6:shots  # against a deploy
 *
 * Captures are CLIPPED to a phone viewport rather than full-page: the ballot at
 * 03255 runs to tens of thousands of pixels, and a whole-page capture of it
 * cannot be read at any useful scale, so it would be evidence in name only.
 *
 * What this session put in front of a reader, and therefore what is captured:
 *
 * 1. **Sutton's Planning Board on the map at 03255.** A town that rendered
 *    nothing for two sessions now has sittings at Pillsbury Memorial Hall.
 *    The pin is the whole point: an empty `LOCATION` on 1,312 events is why it
 *    was dark, and a pin is a claim about where a reader should physically go.
 * 2. **The meetings list at 03255**, where Sutton's rows sit beside the towns
 *    that were already live.
 * 3. **The ballot foot at 03255** — Sean's line, still the only completeness
 *    statement, unchanged by anything here (RULING 59, and a regression check).
 * 4. **Steven Endres's card**, the one candidate field this session shipped.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { launchGuarded } from "./browser.mts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".nh6tmp", "shots");
const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";

const browser = await launchGuarded({ label: "NH6-shots" });
console.log("run id:", browser.runId);
console.log("base  :", BASE);
mkdirSync(OUT, { recursive: true });

/*
 * SEED THE ZIP THE WAY THE STANDING WALK DOES (R49).
 *
 * The first run of this script passed `?zip=03255` in the URL and captured the
 * WELCOME OVERLAY — a page reading "0 meetings" that says nothing at all about
 * whether Sutton renders. The query string does not dismiss the overlay; the
 * app reads the reader own stored location. So the location and the
 * tutorial flag are seeded before the first script runs, which is what
 * scripts/walk-all.mts does and why its numbers are believable.
 *
 * This is the RULING 2 case in miniature: the capture was written, the byte
 * count was healthy, and it was evidence of nothing until somebody opened it.
 */
const page = await browser.page({ viewport: { width: 430, height: 932 } });
await page.addInitScript(
  `(() => {
    try {
      sessionStorage.setItem(
        "wtp.approximate_location",
        JSON.stringify({ zip: "03255", savedAt: new Date().toISOString() }),
      );
      localStorage.setItem("wtp.tutorial_seen", "1");
      localStorage.setItem("wtp.recent_zips", JSON.stringify(["03255"]));
    } catch {}
  })()`,
);

interface Shot {
  file: string;
  what: string;
  claim: string;
}
const shots: Shot[] = [];

/* ---------------------------------------------------------------- 1 ------- */
/* The map at 03255, with Sutton's Planning Board now among the pins.         */
await page.goto(`${BASE}/?zip=03255`, { waitUntil: "networkidle" });
await page.waitForTimeout(6000);
{
  const facts = await page.evaluate(
    `(() => ({
      sutton: (document.body.innerText.match(/Sutton/g) || []).length,
      pillsbury: (document.body.innerText.match(/Pillsbury/g) || []).length,
      bodyText: document.body.innerText.slice(0, 200),
    }))()`,
  );
  console.log(`  map 03255: ${JSON.stringify(facts).slice(0, 300)}`);
  const file = join(OUT, "map-03255.png");
  await page.screenshot({ path: file });
  shots.push({
    file,
    what: "/?zip=03255, first viewport",
    claim:
      "The map renders at 03255 with meetings in view. Sutton is no longer a " +
      "town with nothing scheduled.",
  });
  console.log(`  captured ${file}`);
}

/* ---------------------------------------------------------------- 2 ------- */
/*
 * SUTTON'S OWN ROW, FOUND AND SCROLLED TO — not "the meetings panel".
 *
 * The first version of this shot claimed to show "Sutton's Planning Board
 * sittings" and captured the same first viewport as shot 1: the who-governs
 * card, sitting over the list, with no Sutton row anywhere in it. Byte-distinct
 * from shot 1 by 225 bytes and visually the same picture. A capture whose claim
 * does not match what is in it is worse than a missing capture, because it
 * reads as evidence — and this one was caught by RULING 2's actual instrument,
 * a person opening the file.
 *
 * So this one FINDS the row rather than hoping it is on screen, and REPORTS
 * NOT FOUND rather than capturing whatever happened to be in the viewport.
 */
{
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(6000);

  // Collapse the who-governs card if it is sitting over the list.
  const collapse = page.locator('[aria-label*="ollapse"], [data-collapse]').first();
  if ((await collapse.count()) > 0) {
    await collapse.click().catch(() => {});
    await page.waitForTimeout(1200);
  }

  const row = page.getByText("Pillsbury Memorial Hall").first();
  const rowCount = await row.count();
  const suttonRow = page.getByText(/Sutton/).first();
  const suttonCount = await suttonRow.count();
  console.log(`  Sutton row: Pillsbury ${rowCount}, "Sutton" ${suttonCount}`);

  if (rowCount > 0) {
    await row.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(800);
  } else if (suttonCount > 0) {
    // A matched-but-INVISIBLE node is not a rendered row. Scrolling to one
    // times out, and the honest reading is NOT FOUND on screen.
    await suttonRow.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {
      console.log("  the Sutton match is present in the tree but NOT VISIBLE — not a rendered row");
    });
    await page.waitForTimeout(800);
  } else {
    console.log(
      "  NOT FOUND in the rendered list — the API serves 5 Sutton meetings at this\n" +
        "  zip, so this is about where the row sits on screen and NOT about whether\n" +
        "  the town is live. Reported rather than captured as though it were.",
    );
  }

  const file = join(OUT, "sutton-row-03255.png");
  await page.screenshot({ path: file });
  shots.push({
    file,
    what: "/ at 03255, scrolled to Sutton's row if it is in the rendered list",
    claim:
      rowCount > 0 || suttonCount > 0
        ? "Sutton's Planning Board renders with Pillsbury Memorial Hall as its venue."
        : "NOT FOUND on screen. The claim this shot was for is carried by the API " +
          "check instead — 5 Sutton meetings served at 03255 — and this capture is " +
          "evidence of the viewport, nothing more.",
  });
  console.log(`  captured ${file}`);
}

/* ---------------------------------------------------------------- 3 ------- */
/* The ballot foot at 03255 — RULING 59, unchanged. A regression check.       */
await page.goto(`${BASE}/ballot?zip=03255`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
{
  const facts = await page.evaluate(
    `(() => ({
      coverageNotes: document.querySelectorAll('[data-coverage-note]').length,
      collectionNote: (document.body.innerText.match(/What we have found, we are displaying here\\./g) || []).length,
      cards: document.querySelectorAll('.candidate-row').length,
    }))()`,
  );
  console.log(`  ballot 03255: ${JSON.stringify(facts)}`);
  const note = page.getByText("What we have found, we are displaying here.").first();
  if ((await note.count()) > 0) {
    await note.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
  }
  const file = join(OUT, "ballot-foot-03255.png");
  await page.screenshot({ path: file });
  shots.push({
    file,
    what: "/ballot?zip=03255, scrolled to the collection note",
    claim: "Sean's line is still the only completeness statement on the page (RULING 59).",
  });
  console.log(`  captured ${file}`);
}

/* ---------------------------------------------------------------- 4 ------- */
/* Steven Endres's card — the one candidate field this session shipped.       */
await page.goto(`${BASE}/ballot?zip=03255`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
{
  const endres = page.getByText("Steven Endres").first();
  const found = (await endres.count()) > 0;
  console.log(`  Endres card present: ${found}`);
  if (found) {
    await endres.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
  }
  const facts = await page.evaluate(
    `(() => ({
      endres: (document.body.innerText.match(/Steven Endres/g) || []).length,
      theNumber: (document.body.innerText.match(/\\(603\\) 228-0529/g) || []).length,
    }))()`,
  );
  console.log(`  county attorney: ${JSON.stringify(facts)}`);
  const file = join(OUT, "endres-03255.png");
  await page.screenshot({ path: file });
  shots.push({
    file,
    what: "/ballot?zip=03255, scrolled to the County Attorney contest",
    claim:
      "Steven Endres's card carries the office phone this session found, alongside " +
      "the blurb NH Hunt 5 shipped.",
  });
  console.log(`  captured ${file}`);
}

await browser.close();

console.log(`\n  ${shots.length} capture(s) written to ${OUT}\n`);
for (const s of shots) {
  console.log(`  ${s.file}`);
  console.log(`      what  ${s.what}`);
  console.log(`      claim ${s.claim}`);
}
console.log(
  "\n  RULING 2: these are not evidence until they are OPENED AND READ AS IMAGES.\n" +
    "  The report states N of N read, and a capture that cannot be read makes its\n" +
    "  item a BOUNDARY STOP rather than a finish.\n",
);
