/**
 * `pnpm dark1` — **DARK-1: three options for the dark map, captured side by
 * side.** (2026-08-25, Sean's walkthrough. PROPOSAL ONLY.)
 *
 * ## What this is and, more importantly, what it is NOT
 *
 * Sean: *"Map lines and yellow are overwhelming in dark view; the same
 * rendering reads fine in light."* He explicitly did NOT specify a fix and does
 * not want a rework. So **this ships no map colour change.** It renders the
 * live map at 07866 in dark mode four times — as it is today, and under three
 * candidate treatments — and writes the captures for him to react to.
 *
 * The treatments are applied at RUNTIME through MapLibre's own paint API, on a
 * page this script opened. Nothing in `lib/map/districts.ts` is touched, so
 * there is no change to revert if he picks none of them.
 *
 * ## Why the three options are these three
 *
 * The complaint has two parts — *lines* and *yellow* — and they are separable,
 * so each option changes ONE thing. A proposal that changed everything at once
 * would tell him only whether he likes the bundle.
 *
 * - **A — QUIETER, same colours.** Opacity 0.7 → 0.35 and the stroke thinned.
 *   The cheapest possible change: nothing about the palette moves, so the tier
 *   colours still mean what they mean and the legend is still true.
 * - **B — YELLOW ONLY, dimmed.** Local is the yellow he named and it is also
 *   the densest layer at a municipal zoom. This dims only that tier and leaves
 *   state and federal alone, which tests whether the problem is the COLOUR
 *   rather than the quantity.
 * - **C — FEWER LINES.** Everything stays exactly as it is, and the two
 *   school-district layers stop drawing below a zoom where they are unreadable
 *   anyway. This tests whether the problem is DENSITY rather than either.
 *
 * The recommendation is in `docs/dark1-proposal.md`, written from these
 * captures rather than from an opinion formed before them.
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { launchGuarded } from "./browser.mts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/*
 * **They land in `docs/`, not `screenshots/`** (RULING 108). `/screenshots/` is
 * gitignored, so a proposal written there is a proposal left where only this
 * machine can open it — which is the exact failure RULING 108 was adopted over,
 * and it would be committed by the item whose whole deliverable is *give Sean
 * something to react to*.
 */
const OUT = join(ROOT, "docs", "proposals", "dark1-2026-08-26");
const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3177";
const ZIP = "07866";

/** Every district line layer MapLibre currently holds. */
const LINE_LAYERS = `(() => {
  const m = window.__wtpMap;
  if (!m) return [];
  return m.getStyle().layers.filter((l) => /^district-.*-line$/.test(l.id)).map((l) => l.id);
})()`;

interface Option {
  name: string;
  label: string;
  /** Applied through the map's own paint API. */
  apply: string;
}

const OPTIONS: Option[] = [
  {
    name: "00-today",
    label: "As it renders today",
    apply: "true",
  },
  {
    name: "A-quieter",
    label: "A — quieter, same colours (opacity 0.7 → 0.35, stroke thinned)",
    apply: `(() => {
      const m = window.__wtpMap;
      for (const id of ${LINE_LAYERS}) {
        m.setPaintProperty(id, "line-opacity", 0.35);
        m.setPaintProperty(id, "line-width", 0.8);
      }
      return true;
    })()`,
  },
  {
    name: "B-yellow-only",
    label: "B — the yellow tier alone dimmed; state and federal untouched",
    apply: `(() => {
      const m = window.__wtpMap;
      for (const id of ${LINE_LAYERS}) {
        const local = /municipal|county|school/.test(id);
        m.setPaintProperty(id, "line-opacity", local ? 0.28 : 0.7);
      }
      return true;
    })()`,
  },
  {
    name: "C-fewer-lines",
    label: "C — same treatment, the two school layers stop drawing at this zoom",
    apply: `(() => {
      const m = window.__wtpMap;
      for (const id of ${LINE_LAYERS}) {
        if (/school-(elementary|secondary)/.test(id)) {
          m.setLayoutProperty(id, "visibility", "none");
        }
      }
      return true;
    })()`,
  },
];

await mkdir(OUT, { recursive: true });
const browser = await launchGuarded({ label: "dark1-proposal" });

let captured = 0;
for (const theme of ["dark", "light"] as const) {
  for (const option of OPTIONS) {
    // Light mode is the CONTROL and gets the untouched render only: Sean's
    // complaint is that light already reads fine, so three light variants
    // would be three answers to a question nobody asked.
    if (theme === "light" && option.name !== "00-today") continue;

    const context = await browser.context({
      viewport: { width: 1440, height: 900 },
      // 1x rather than 2x, and it is a size decision stated rather than
      // hidden: this is a judgement about COLOUR and DENSITY, which a 1440x900
      // image carries perfectly, and five 2x captures came to 9.3 MB against
      // the 4 MB one of Sean's whole walkthrough batches costs.
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      colorScheme: theme,
    });
    await context.addInitScript(
      ({ zip, theme }: { zip: string; theme: string }) => {
        try {
          sessionStorage.setItem(
            "wtp.approximate_location",
            JSON.stringify({ zip, savedAt: new Date().toISOString() }),
          );
          localStorage.setItem("wtp.recent_zips", JSON.stringify([zip]));
          localStorage.setItem("wtp.tutorial_seen", "1");
          localStorage.setItem("wtp.theme", theme);
          localStorage.setItem("wtp.show_districts", "1");
        } catch {
          /* the shot starts from defaults and the capture will show it */
        }
      },
      { zip: ZIP, theme },
    );
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(9000);

    const layers = (await page.evaluate(LINE_LAYERS)) as string[];
    /*
     * The floor (RULING 159). A capture taken with NO district layers on the
     * map would show a clean basemap and read as "the lines are fine now",
     * which is the most misleading possible answer to this question.
     */
    if (layers.length === 0) {
      throw new Error(
        `DARK-1 ${theme}/${option.name}: no district line layer is on the map — ` +
          `the capture would show an empty basemap and read as a fixed problem`,
      );
    }

    await page.evaluate(option.apply);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(OUT, `${theme}-${option.name}.png`) });
    captured += 1;
    console.log(`  shot  ${theme}-${option.name}.png   (${layers.length} line layer(s))  ${option.label}`);
    await context.close();
  }
}

await browser.close();

if (captured !== OPTIONS.length + 1) {
  throw new Error(`DARK-1: ${captured} capture(s) written, expected ${OPTIONS.length + 1}`);
}
console.log(`\n  ${captured} capture(s) in ${OUT}`);
console.log("  PROPOSAL ONLY — no map colour change ships from this script.");
