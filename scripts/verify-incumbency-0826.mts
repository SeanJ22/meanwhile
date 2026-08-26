/**
 * THE READER'S ROUTE TO KAREN EBEL'S CARD, WALKED. (2026-08-26, Items 10-15.)
 *
 * RULING 153 — a verification states the reader's route and walks it. An
 * assertion over stored state is not a verification of a rendered outcome, and
 * this repo has already shipped a fix whose only evidence was that the code the
 * fix introduced did what the code did.
 *
 * **THE ROUTE, IN WORDS:** open the ballot page for `03255` against a LOCAL
 * PRODUCTION BUILD (RULING 125 — no synthetic row reaches the sold search log),
 * find the contest `State Representative, Merrimack County District 7`, and read
 * the chip on Karen Elizabeth Ebel's card.
 *
 * **THE CASE THE FIX WAS NOT DERIVED FROM** (RULING 157) is read in the same
 * pass and named separately: **Gregory M. Sargent**, on the same card, and
 * **Daniel E. Innis** in State Senator District 7. Both are sitting members
 * whose serving names differ from their filed names, and the first version of
 * the matcher labelled both `Challenger`.
 *
 * Usage:  pnpm verify:incumbency            # against http://localhost:3000
 *         pnpm verify:incumbency --base <url>
 */

import { floored } from "../lib/ops/denominator-floor.ts";
import { launchGuarded, seedZip } from "./browser.mts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const BASE = arg("base") ?? "http://localhost:3000";

/** Who we expect to read what, and why each one is in this list. */
const EXPECTED = [
  { name: "Karen Elizabeth Ebel", chip: "Incumbent", why: "the reported instance" },
  { name: "Gregory M. Sargent", chip: "Incumbent", why: "DERIVED CASE — Greg/Gregory, a sitting member the first matcher got wrong" },
  { name: "Daniel E. Innis", chip: "Incumbent", why: "DERIVED CASE — Dan/Daniel, in a different contest" },
] as const;

const browser = await launchGuarded({ label: "verify-incumbency-0826" });
try {
  const page = await browser.page();
  // `?zip=` does NOT seed the app — the map entry renders its welcome overlay
  // and every read behind it is a read of the overlay. `seedZip` writes what
  // `use-stored-zip` reads, before the first paint.
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await seedZip(page, "03255");
  await page.goto(`${BASE}/ballot?zip=03255`, { waitUntil: "networkidle" });

  const rowCount = Number(
    await page.evaluate("document.querySelectorAll('.candidate-row').length"),
  );
  if (rowCount === 0) {
    // RULING 159 — a selector that matched nothing is an ERROR naming the
    // selector, never a clean pass.
    throw new Error(
      "verify:incumbency: the selector `.candidate-row` matched NOTHING on /ballot?zip=03255. " +
        "That is a page that never rendered, not a page with no incumbents on it.",
    );
  }

  // RULING 159 — the floor is asserted BEFORE anything is reported. A page with
  // no candidate rows is a page that never rendered.
  void floored("verify:incumbency", "candidate rows on /ballot?zip=03255", rowCount, EXPECTED.length);

  console.log(`verify:incumbency · ${BASE}/ballot?zip=03255 · ${rowCount} candidate row(s) rendered`);
  console.log("");

  /*
   * **THE CHIP IS INSIDE THE BATTLECARD, WHICH THE READER HAS TO OPEN.**
   *
   * The first version of this walk read `.candidate-row` and reported that
   * Ebel's row said neither `Incumbent` nor `Challenger` — 0 of 47 rows carried
   * either word. That reading was correct and the CONCLUSION would have been
   * wrong: since item 12 of 2026-08-19 the long sections and the identity chips
   * live in the card behind the pill, not on the row. A verification that
   * stopped there would have reported a defect that is not there, having walked
   * a route the reader does not walk.
   *
   * So the walk clicks the pill, exactly as a reader does.
   */
  /**
   * Open a candidate's card and read THE CHIPS, as separate strings.
   *
   * **Two readings were wrong before this one, and both are recorded because
   * each is a way a verification lies to itself.**
   *
   * 1. Reading `.candidate-row` found no chip at all and would have reported a
   *    defect that is not there. The chips have lived in the card behind the
   *    pill since item 12 of 2026-08-19; the row is not the reader's route to
   *    them.
   * 2. Reading the modal's `textContent` and testing `/\bIncumbent\b/` also
   *    found nothing — because `textContent` concatenates elements with no
   *    separator, so the card reads `…EbelDemocraticIncumbentWhat…` and there
   *    is no word boundary anywhere near the word. A false negative produced by
   *    the ASSERTION rather than by the page.
   *
   * So the chips are read as chips: `.id-chip` inside the open card, each its
   * own string. That is also stricter than a substring test, which would match
   * the word "incumbent" appearing in prose somewhere else on the card.
   */
  const openAndReadChips = async (name: string): Promise<string[] | null> => {
    const pill = page
      .locator(".candidate-row", { hasText: name })
      .locator("[data-battlecard-pill]")
      .first();
    if ((await pill.count()) === 0) return null;
    await pill.click();
    const card = page.locator("[data-candidate-battlecard]").first();
    await card.waitFor({ state: "visible", timeout: 15_000 });
    const chips = await card.locator(".id-chip").allTextContents();
    await page.keyboard.press("Escape");
    await card.waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
    return chips;
  };

  let failures = 0;
  const seen: { incumbent: number; challenger: number; unsourced: number } = {
    incumbent: 0,
    challenger: 0,
    unsourced: 0,
  };

  for (const e of EXPECTED) {
    const chips = await openAndReadChips(e.name);
    if (chips === null) {
      console.log(`  MISSING  ${e.name} — no row on the page carries this name  (${e.why})`);
      failures += 1;
      continue;
    }
    if (chips.length === 0) {
      // RULING 159 again: a card with no chips at all is a selector that found
      // nothing, not a card making no claim.
      console.log(`  NO CHIPS ${e.name} — the card rendered and carries no .id-chip at all  (${e.why})`);
      failures += 1;
      continue;
    }
    const saysIncumbent = chips.some((c) => c.trim() === "Incumbent");
    const saysChallenger = chips.some((c) => c.trim() === "Challenger");
    const saysUnsourced = chips.some((c) => /haven't sourced who holds this seat/i.test(c));
    if (saysIncumbent) seen.incumbent += 1;
    if (saysChallenger) seen.challenger += 1;
    if (saysUnsourced) seen.unsourced += 1;

    const ok = e.chip === "Incumbent" ? saysIncumbent && !saysChallenger : saysChallenger && !saysIncumbent;
    console.log(
      `  ${ok ? "OK      " : "WRONG   "} ${e.name} — the card chips are [${chips.join(" · ")}], reading ${
        saysIncumbent ? "Incumbent" : saysChallenger ? "Challenger" : saysUnsourced ? "not yet sourced" : "neither"
      }, expected ${e.chip}  (${e.why})`,
    );
    if (!ok) failures += 1;
  }

  console.log("");
  console.log(
    `  of the ${EXPECTED.length} cards opened: ${seen.incumbent} Incumbent · ${seen.challenger} Challenger · ` +
      `${seen.unsourced} not yet sourced`,
  );
  console.log("  (before this session every one of these read Challenger, including the incumbents)");

  if (failures > 0) process.exitCode = 1;
} finally {
  await browser.close();
}
