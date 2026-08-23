/**
 * **NJ HUNT 4's EVIDENCE, SHOT AGAINST A LOCAL PRODUCTION BUILD.**
 * (2026-08-22. RULING 77, RULING 2, RULING 76.)
 *
 * ```
 * pnpm start                 # a LOCAL production build, in another shell
 * pnpm nj4:shots
 * ```
 *
 * RULING 77 is why this points at `localhost:3000` rather than at production:
 * verify locally, confirm it works, then ship. Screenshots at 430×932, the
 * ballot page, the who-governs card and the body-row card are all the same bytes
 * locally as they are on the server, and finding a defect after the deploy means
 * readers found it first.
 *
 * RULING 2 is why every capture here is small enough to READ: a 68,000-pixel
 * full-page ballot capture is a file, not evidence. Each shot is clipped to the
 * thing it is evidence FOR, and the report says what each one shows.
 *
 * The browser goes through `launchGuarded`, so every request this makes declares
 * itself — nothing here can land in the sold store as reader signal.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { launchGuarded } from "./browser.mts";
import { today } from "./doc-dates.mjs";

const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";
const OUT = join(process.cwd(), "screenshots");
const AS_OF = today();
const PHONE = { width: 430, height: 932 };

mkdirSync(OUT, { recursive: true });

const guarded = await launchGuarded({ label: "nj-hunt4-shots" });
const shots: { file: string; shows: string }[] = [];

/** Seed the map's own zip state, exactly as `walk:all` does — `?zip=` does not. */
async function openAt(zip: string) {
  const page = await guarded.page({ viewport: PHONE });
  /*
   * **THE EXACT KEYS `walk:all` USES, AND THE FIRST DRAFT GUESSED THEM.**
   *
   * `?zip=` does not seed the app: the map entry renders its welcome overlay
   * and waits to be typed into. A first version wrote `wtp:zip` and `wtp.zip`,
   * neither of which exists, and produced three captions saying "the
   * who-governs surface at 07866" over three screenshots of the welcome
   * overlay. A capture whose claim does not match its contents is worse than no
   * capture, so the keys are read off `scripts/walk-all.mts` rather than
   * remembered.
   */
  await page.addInitScript((z: string) => {
    try {
      sessionStorage.setItem(
        "wtp.approximate_location",
        JSON.stringify({ zip: z, savedAt: new Date().toISOString() }),
      );
      localStorage.setItem("wtp.tutorial_seen", "1");
      localStorage.setItem("wtp.recent_zips", JSON.stringify([z, "03255"]));
    } catch {
      /* a storage refusal is not a reason to fail the shot */
    }
  }, zip);
  await page.goto(`${BASE}/?zip=${zip}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  return page;
}

/* ── 1. the ballot page at 07866, clipped to the first contests ──────────── */
for (const zip of ["07866", "03255"]) {
  const page = await guarded.page({ viewport: PHONE });
  await page.goto(`${BASE}/ballot?zip=${zip}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForSelector(".candidate-row", { timeout: 20_000 }).catch(() => {});

  const counts = await page.evaluate(() => ({
    cards: document.querySelectorAll(".candidate-row").length,
    contests: document.querySelectorAll("[data-contest-id]").length,
    photos: document.querySelectorAll(".candidate-row img").length,
  }));
  console.log(
    `ballot ${zip}: ${counts.cards} candidate row(s), ${counts.contests} contest(s), ${counts.photos} portrait(s) rendered`,
  );

  /*
   * THE PAGE IS SHRUNK RATHER THAN SHOT WHOLE. A full-page ballot capture runs
   * to tens of thousands of pixels and cannot be read, and a capture that
   * cannot be read is not evidence (RULING 2).
   */
  await page.evaluate(() => {
    document.documentElement.style.zoom = "0.34";
  });
  await page.waitForTimeout(400);
  const file = join(OUT, `nj4-ballot-${zip}.png`);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 430, height: 3200 } });
  shots.push({
    file,
    shows: `the ballot page at ${zip}, shrunk to 34% so the top ${counts.contests} contest(s) and ${counts.cards} candidate row(s) fit in one readable capture`,
  });
  await page.close();
}

/* ── 2. the who-governs card, and a body row opening its card (PU02) ─────── */
for (const zip of ["07866", "03255", "85701"]) {
  const page = await openAt(zip);
  const minimize = page.locator(".coverage-notice button[aria-label^='Minimize']").first();
  if ((await minimize.count()) > 0) await minimize.click().catch(() => {});
  await page.waitForTimeout(600);

  const card = join(OUT, `nj4-governs-${zip}.png`);
  await page.screenshot({ path: card });
  /*
   * **THE CAPTION SAYS WHAT THE CAPTURE SHOWS, AND THIS ONE HAD TO BE FIXED
   * TWICE.** (Corrected 2026-08-22, NJ Hunt 5.)
   *
   * NJ Hunt 4 found that three captures claimed "the who-governs surface" and
   * showed the map, because the shooter MINIMISES the card four lines above
   * this. It corrected the caption in `state.md` and left the string here
   * untouched — so the next run produced the same three wrong captions, and
   * NJ Hunt 5 read them as images and found the same defect.
   *
   * **A correction written into prose and not into the tool is a correction
   * that recurs.** The caption now describes the minimised state, which is what
   * this capture is actually of and is genuinely what it is for: the map with
   * the district geometry drawn and the pill collapsed.
   */
  shots.push({
    file: card,
    shows:
      `the MAP at ${zip} at 430×932, with the who-governs card MINIMISED to its ` +
      `pill — district geometry, meeting pins and the meetings/venues count visible`,
  });

  /* PU02: open the ask panel, type, and click the FIRST body row. */
  if ((await page.locator("[data-ask-panel]").count()) === 0) {
    await page.locator("[data-ask-pill]").first().click().catch(() => {});
    await page.locator("[data-ask-panel]").first().waitFor({ state: "visible", timeout: 6000 }).catch(() => {});
  }
  const input = page.locator("[data-ask-box]").first();
  if ((await input.count()) > 0) {
    await input.fill("a");
    await page.locator(".search-ac-item").first().waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    const bodyRows = page.locator(".search-ac-item", {
      has: page.locator(".search-ac-type", { hasText: /^Body$/ }),
    });
    const offered = await bodyRows.count();
    if (offered > 0) {
      const label = (await bodyRows.first().locator(".search-ac-name").innerText()).trim();
      await bodyRows.first().click();
      const opened = await page
        .locator(".account-modal")
        .first()
        .waitFor({ state: "visible", timeout: 6000 })
        .then(() => true)
        .catch(() => false);
      console.log(
        `PU02 ${zip}: ${offered} body row(s) offered, the FIRST is ${JSON.stringify(label)}, card opened: ${opened}`,
      );
      const shot = join(OUT, `nj4-pu02-${zip}.png`);
      await page.screenshot({ path: shot });
      shots.push({
        file: shot,
        shows: `PU02 at ${zip} — the FIRST body row (${label}) clicked; the large card ${opened ? "OPENED" : "did NOT open"}`,
      });
    } else {
      console.log(`PU02 ${zip}: the autocomplete offered no body row for "a" — CANNOT RUN`);
    }
  } else {
    console.log(`PU02 ${zip}: no ask box — CANNOT RUN`);
  }
  await page.close();
}

await guarded.close();

console.log(`\n${shots.length} capture(s), ${AS_OF}:`);
for (const s of shots) console.log(`  ${s.file}\n      shows: ${s.shows}`);
