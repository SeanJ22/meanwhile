/**
 * M139 sub-item 2 — the ballot pill, before and after, in one image.
 *
 *   SHOOT_BASE_URL=http://localhost:3000 pnpm shoot:pill
 *
 * The reported defect: "the zip's outline is SQUARE inside a rounded pill; it
 * must be one clean rounded element." Measured rather than eyeballed first —
 * `.ballot-pill-zip` had `border-radius: 0` and a contrasting
 * `1px solid var(--signal)` border inside a `.ballot-pill` at `999px` with
 * `overflow: hidden`, so its corners were cut off mid-line by the clip
 * instead of following the curve.
 *
 * This shoots the pill twice in the same page — once as it ships now, and
 * once with the two radii forced back to 0 — so the pair is a genuine
 * before/after against one build rather than two screenshots taken hours
 * apart. Both themes, because a border only reads as wrong against the
 * background it sits on.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";



import { makeRunId, syntheticRunHeaders } from "../lib/db/run-marker.ts";
import { launchGuarded } from "./browser.mts";

const BASE = (process.env.SHOOT_BASE_URL ?? "https://sparkwtp.netlify.app").replace(
  /\/$/,
  "",
);
const RUN_ID =
  process.env.WTP_RUN_ID ?? makeRunId("g14-m139-pill", new Date().toISOString());
const OUT = join(process.cwd(), "docs", "evidence");
const ZIP = process.env.M139_ZIP ?? "85701";

mkdirSync(OUT, { recursive: true });

const browser = await launchGuarded({ label: "shoot-ballot-pill" });

for (const theme of ["dark", "light"] as const) {
  const context = await browser.context({
    extraHTTPHeaders: syntheticRunHeaders({ ...process.env, WTP_RUN_ID: RUN_ID }),
    viewport: { width: 900, height: 700 },
    deviceScaleFactor: 3,
    reducedMotion: "reduce",
    colorScheme: theme,
  });
  await context.addInitScript(
    ({ zip, theme }) => {
      try {
        sessionStorage.setItem(
          "wtp.approximate_location",
          JSON.stringify({ zip, savedAt: new Date().toISOString() }),
        );
        localStorage.setItem("wtp.tutorial_seen", "1");
        /*
          THE THEME IS OURS, not the OS's. `app/layout.tsx` sets
          `data-theme="light"` from `localStorage["wtp.theme"]`; Playwright's
          `colorScheme` drives `prefers-color-scheme`, which this app does not
          key off. The first version of this script passed colorScheme alone
          and produced two IDENTICAL dark images while reporting "both
          themes" — a claim about coverage that the files themselves
          disproved.
        */
        localStorage.setItem("wtp.theme", theme);
      } catch {
        // Defaults are fine.
      }
    },
    { zip: ZIP, theme },
  );
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector(".ballot-pill", { timeout: 30_000 });
  await page.waitForTimeout(2500);

  const pill = page.locator(".ballot-pill").first();
  await pill.screenshot({ path: join(OUT, `m139-pill-after-${theme}.png`) });

  // The BEFORE, reconstructed on the same build by removing exactly the two
  // declarations this fix added — nothing else is touched, so the pair
  // isolates the change rather than the day it was taken.
  await page.addStyleTag({
    content: ".ballot-pill-main{border-radius:0!important}.ballot-pill-zip{border-radius:0!important}",
  });
  await page.waitForTimeout(300);
  await pill.screenshot({ path: join(OUT, `m139-pill-before-${theme}.png`) });

  console.log(`${theme}: wrote m139-pill-before-${theme}.png and m139-pill-after-${theme}.png`);
  await context.close();
}

await browser.close();
console.log(`\nrun id (SYNTHETIC): ${RUN_ID}`);
console.log(`base: ${BASE}`);
