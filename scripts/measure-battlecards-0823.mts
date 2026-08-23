/**
 * **BC-3, BC-4 AND JUR-4 — MEASURED, BEFORE AND AFTER.**
 * (2026-08-23, the Discovery Conduct session, Part 2 items 12 and 13.)
 *
 * Session-dated and COMMITTED, under RULING 76: a one-shot script written for
 * one session's evidence stays in the tree, because the technique is a rung and
 * deleting the script deletes the rung. It type-checks under `strict` like every
 * other file and it is never excluded from the check.
 *
 * ## What it answers, and why each number needs a denominator
 *
 * - **N of M people on the ballot page reachable** by clicking their name or
 *   their battlecard. The author's BC-3/BC-4: *"right now there is no way to
 *   see data about a candidate from the ballot page"*, and Veronica Fernandez —
 *   an independent with no voting history — had no way in at all.
 * - **The count of "could govern you" instances rendering.** JUR-4: he named
 *   the repetition the headline UX problem of the New Jersey pass. A count with
 *   no denominator is not a measurement, so the number of contests is stated
 *   beside it.
 *
 * It runs against a LOCAL production build, per RULING 77: verify locally, ship
 * once. Nothing here needs the live site.
 *
 * ```
 * corepack pnpm exec next start -p 3100
 * pnpm exec tsx scripts/measure-battlecards-0823.mts
 * ```
 */
import { launchGuarded } from "./browser.mts";

const BASE = process.argv.includes("--base")
  ? (process.argv[process.argv.indexOf("--base") + 1] ?? "http://localhost:3100")
  : "http://localhost:3100";
const ZIP = process.argv.includes("--zip")
  ? (process.argv[process.argv.indexOf("--zip") + 1] ?? "07866")
  : "07866";

const browser = await launchGuarded({ label: "measure-battlecards-0823" });
console.log(`run id ${browser.runId} — every row this run writes lands SYNTHETIC`);
try {
  const page = await browser.page({ viewport: { width: 430, height: 932 } });
  await page.goto(`${BASE}/ballot?zip=${ZIP}`, { waitUntil: "networkidle", timeout: 90_000 });

  /*
   * Counted from the DOM the reader actually gets, not from the source. The
   * selectors are the committed ones: `.candidate-row` counts cards and
   * `[data-contest-id]` counts contests — the `data-candidate-*` attributes
   * both return 0 and are a known trap.
   */
  const measured = await page.evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('.candidate-row'));
    const contests = document.querySelectorAll('[data-contest-id]').length;
    const pills = document.querySelectorAll('[data-battlecard-pill]').length;
    const nameDoors = document.querySelectorAll('[data-candidate-card]').length;
    const couldGovern = document.querySelectorAll('[data-could-govern="true"]').length;
    const reachable = rows.filter((row) =>
      row.querySelector('[data-battlecard-pill]') !== null ||
      row.querySelector('[data-candidate-card]') !== null
    ).length;
    return { people: rows.length, contests, pills, nameDoors, couldGovern, reachable };
  })()`);

  const m = measured as {
    people: number;
    contests: number;
    pills: number;
    nameDoors: number;
    couldGovern: number;
    reachable: number;
  };

  console.log(`\n/ballot?zip=${ZIP} at 430x932, local production build\n`);
  console.log(`  people on the page (M)          ${m.people}`);
  console.log(`  reachable by name or battlecard ${m.reachable} of ${m.people}`);
  console.log(`  battlecard pills                ${m.pills}`);
  console.log(`  name doors                      ${m.nameDoors}`);
  console.log(`  contests                        ${m.contests}`);
  console.log(`  "could govern you" instances    ${m.couldGovern} across ${m.contests} contest(s)`);

  /*
   * Open the FIRST battlecard and count its sections. BC-1 says the same seven
   * render on every card, always — so the number is checked rather than
   * described, and a card that opened with three would be the defect this item
   * exists to fix, still present.
   */
  const pills = page.locator("[data-battlecard-pill]");
  const cardsToOpen = Math.min(await pills.count(), 4);
  const perCard: { name: string; sections: string[] }[] = [];
  for (let i = 0; i < cardsToOpen; i++) {
    await pills.nth(i).click();
    await page.waitForTimeout(500);
    const shot = await page.evaluate(`(() => {
      const body = document.querySelector('[data-battlecard-body]');
      if (!body) return null;
      const modal = body.closest('[data-candidate-battlecard]');
      const name = modal ? (modal.querySelector('p.truncate')?.textContent || '').trim() : '';
      const sections = Array.from(body.querySelectorAll('button'))
        .map((b) => (b.textContent || '').replace(/\\s+/g, ' ').trim())
        .filter((t) => t.length > 0 && t.length < 40);
      return { name, sections };
    })()`);
    const got = shot as { name: string; sections: string[] } | null;
    perCard.push(got ?? { name: `card ${i + 1}`, sections: [] });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }

  console.log(`\n  sections per card — ${cardsToOpen} card(s) opened and read:`);
  for (const c of perCard) {
    console.log(`    ${c.sections.length} — ${c.name || "(unnamed)"} : ${c.sections.join(" | ")}`);
  }
} finally {
  await browser.close();
}
