/**
 * **THE 8/22 BUILD, CAPTURED AND MEASURED ON A LOCAL PRODUCTION BUILD.**
 * (2026-08-23, the Discovery Conduct session, Part 2.)
 *
 * Committed under RULING 76. The recipe is the rung: seeding `sessionStorage`
 * so the map entry does not open on its welcome overlay, marking the target
 * before shrinking the page, and reading every capture as an image afterwards
 * (RULING 2 — capturing a screenshot is not looking at one).
 *
 * It runs against a LOCAL production build (RULING 77). Only a deploy-SHA
 * confirmation needs the live site, and nothing here is that.
 *
 * ```
 * corepack pnpm exec next start -p 3111
 * pnpm exec tsx scripts/shoot-conduct-0823.mts --base http://localhost:3111
 * ```
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { launchGuarded } from "./browser.mts";

const BASE = process.argv.includes("--base")
  ? (process.argv[process.argv.indexOf("--base") + 1] ?? "http://localhost:3111")
  : "http://localhost:3111";
/*
 * `/screenshots` is gitignored, and that is where captures belong: they are
 * EVIDENCE A HUMAN READS, and RULING 20 keeps binaries out of git because git
 * retains every version forever. The first version of this script wrote to
 * `data/audit/`, which IS tracked, and `tests/no-new-binaries.test.ts` refused
 * the commit — correctly.
 */
const OUT = join(process.cwd(), "screenshots", "conduct-0823");
mkdirSync(OUT, { recursive: true });

const PHONE = { width: 430, height: 932 };

const browser = await launchGuarded({ label: "shoot-conduct-0823" });
console.log(`run id ${browser.runId} — every row this run writes lands SYNTHETIC`);

interface Shot {
  file: string;
  /** What the capture CLAIMS to show. Read against the image, never assumed. */
  claim: string;
}
const shots: Shot[] = [];

try {
  /* ---------------------------------------------------- the ballot page --- */
  {
    const page = await browser.page({ viewport: PHONE });
    await page.goto(`${BASE}/ballot?zip=07866`, { waitUntil: "networkidle", timeout: 90_000 });

    // The battlecard, open, showing the fixed seven. Veronica Fernandez is the
    // card the author named as having no way in at all, so it is the one shot.
    const pills = page.locator("[data-battlecard-pill]");
    const count = await pills.count();
    let opened = false;
    for (let i = 0; i < count; i++) {
      await pills.nth(i).click();
      await page.waitForTimeout(400);
      const name = await page.evaluate(
        `(() => {
          const modal = document.querySelector('[data-candidate-battlecard]');
          return modal ? (modal.querySelector('p.truncate')?.textContent || '').trim() : '';
        })()`,
      );
      if (typeof name === "string" && /fernandez/i.test(name)) {
        opened = true;
        break;
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
    }
    if (opened) {
      await page.screenshot({ path: join(OUT, "battlecard-fernandez.png") });
      shots.push({
        file: "battlecard-fernandez.png",
        claim:
          "Veronica Fernandez's battlecard, open, carrying the same seven drop-downs every card carries",
      });
    } else {
      console.log("  Fernandez's card was not found — REPORTED, not assumed");
    }
    await page.close();
  }

  /* ------------------------------------------------ the who-governs card --- */
  {
    const page = await browser.page({ viewport: PHONE });
    /*
     * `?zip=` does NOT seed the map entry — it renders the welcome overlay and
     * a capture taken there shows the overlay rather than the card. The entry
     * reads `sessionStorage`, so it is seeded before the first paint, exactly
     * as `walk:all` does.
     */
    await page.addInitScript(
      `try {
        sessionStorage.setItem("wtp.approximate_location", JSON.stringify({ zip: "07866", savedAt: new Date().toISOString() }));
        localStorage.setItem("wtp.tutorial_seen", "1");
      } catch {}`,
    );
    await page.goto(`${BASE}/?zip=07866`, { waitUntil: "networkidle", timeout: 90_000 });
    await page.waitForTimeout(2500);

    const measured = await page.evaluate(
      `(() => ({
        marks: document.querySelectorAll('.could-govern-mark').length,
        notices: document.querySelectorAll('.could-govern-notice-pill').length,
        oldPills: document.querySelectorAll('.could-govern-pill').length,
        rows: document.querySelectorAll('li').length,
      }))()`,
    );
    const m = measured as { marks: number; notices: number; oldPills: number; rows: number };
    console.log(`\n  who-governs at 07866, local production build`);
    console.log(`    row marks (the asterisk)     ${m.marks}`);
    console.log(`    the ONE notice pill          ${m.notices}`);
    console.log(`    old per-row sentences        ${m.oldPills}`);

    await page.screenshot({ path: join(OUT, "who-governs-07866.png") });
    shots.push({
      file: "who-governs-07866.png",
      claim: `the who-governs card at 07866, with ${m.marks} row mark(s) and ${m.notices} notice pill`,
    });
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(`\n  ${shots.length} capture(s) written to data/audit/conduct-0823:`);
for (const s of shots) console.log(`    ${s.file} — CLAIMS: ${s.claim}`);
console.log(`\n  RULING 2: each of these is evidence only once it has been READ AS AN IMAGE.`);
