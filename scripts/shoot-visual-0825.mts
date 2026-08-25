/**
 * **THE 8/25 ONE-SESSION BRIEF'S VERIFICATION SHOOTER.**
 *
 * Committed under RULING 76: a session-dated script stays in the tree, carries
 * a header saying which session and which claim it served, and type-checks
 * under `strict` like every other file.
 *
 * **Runs against a LOCAL PRODUCTION BUILD** (RULING 125). Not production:
 * every `/api/meetings` GET writes a search-log row, and the search log is a
 * store this product sells.
 *
 * **RULING 153 — every check below states the READER'S ROUTE and walks it.**
 * That ruling was earned this session by six DONEs that were disproved the
 * next morning, and the mechanism in every case was a verification that
 * exercised the code path the fix introduced rather than the path a reader
 * takes. So the WGH swap is checked by CLICKING the pill, not by setting
 * state; and the one-of-two invariant is checked at three moments — first
 * paint, after opening WGH, after opening the rail again — because first paint
 * is exactly where it was broken and no handler runs there.
 *
 * Which claims it serves, from the 08:53:15 annotated spec:
 *
 *   LAY-7  · the rail reaches the foot of the column
 *   LAY-8  · the collects/feedback block sits at the foot, not mid-rail
 *   LAY-9  · the collapsed rail does not scroll inside itself
 *   LAY-10 · the Near-Me control reads "Near Me" and nothing else
 *   WGH-8  · exactly one of rail / who-governs, never both; no sideways scroll
 *   WGH-9  · the two map pills agree on width, height, font and border
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Page } from "playwright";

import { launchGuarded, seedZip } from "./browser.mts";

/** One elements measured box, as the page hands it back. */
type Box = null | {
  x: number;
  y: number;
  w: number;
  h: number;
  bottom: number;
  visible: boolean;
  fontSize: string;
  fontFamily: string;
  borderTopWidth: string;
  borderRadius: string;
  textTransform: string;
  letterSpacing: string;
  overflowX: number;
  overflowY: number;
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "screenshots", "visual-0825");
const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";

mkdirSync(OUT, { recursive: true });

interface Finding {
  id: string;
  what: string;
  value: string;
}

const findings: Finding[] = [];
const record = (id: string, what: string, value: unknown): void => {
  findings.push({ id, what, value: String(value) });
  console.log(`  ${id.padEnd(14)} ${what}: ${String(value)}`);
};

/*
 * `seedZip` lived here, and in two other shooters written the same evening.
 * `pnpm dupes` caught the three copies (RULING 103) and it is consolidated
 * into `scripts/browser.mts` — the better home anyway, because the recipe is
 * a rung rather than one script's detail. Its reasoning went with it.
 */

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  captured ${name}.png`);
}

/**
 * Everything the page can tell us about the two surfaces, in one pass.
 *
 * No named function inside `evaluate`: tsx compiles a named helper through
 * esbuild, which wraps it in a `__name` call the PAGE does not have, and the
 * callback dies with `ReferenceError: __name is not defined` — which reads as
 * a broken selector rather than as a build artifact.
 */
async function readSurfaces(page: Page) {
  return page.evaluate(() => {
    /*
     * **NOTHING IN HERE IS A NAMED OR CONST-BOUND FUNCTION**, and the first
     * version of this file broke on exactly that after its own doc comment
     * warned about it. esbuild names an arrow assigned to a `const` too, so
     * `const box = (s) => …` gets the same `__name` wrapper a `function` does,
     * and the callback dies in the page with `ReferenceError: __name is not
     * defined` — which reads as a broken selector rather than a build
     * artifact. Inline arrows in argument position are safe; bound ones are
     * not.
     */
    const boxes = Object.fromEntries(
      [
        ["column", ".rail-column"],
        ["sidebar", ".sidebar"],
        ["scroll", ".sidebar-scroll"],
        ["wghCard", ".coverage-notice"],
        ["wghPill", ".notice-fab"],
        ["countPill", ".count-badge"],
        ["footnote", ".site-footnote"],
      ].map(([key, selector]) => {
        const el = document.querySelector(selector);
        if (!el) return [key, null];
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return [
          key,
          {
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
            bottom: Math.round(r.bottom),
            /*
             * **A HIDDEN RAIL STILL HAS A BOUNDING BOX**, and the first run of
             * this script reported "both surfaces up at FIRST PAINT: true"
             * because of it. `main[data-sidebar="closed"] .sidebar` hides the
             * rail with `transform: translateX(-100%)` and
             * `visibility: hidden` — never `display: none` — so
             * getBoundingClientRect returns a full-size box sitting off the
             * left edge, and a display-only test reads it as on screen.
             *
             * That is the exact defect class this session was convened to fix,
             * committed by the instrument measuring it. Visible means: painted,
             * not visibility-hidden, and actually intersecting the viewport.
             */
            visible:
              cs.display !== "none" &&
              cs.visibility !== "hidden" &&
              r.width > 0 &&
              r.height > 0 &&
              r.right > 0 &&
              r.left < window.innerWidth,
            fontSize: cs.fontSize,
            fontFamily: cs.fontFamily,
            borderTopWidth: cs.borderTopWidth,
            borderRadius: cs.borderTopLeftRadius,
            textTransform: cs.textTransform,
            letterSpacing: cs.letterSpacing,
            overflowX: el.scrollWidth - el.clientWidth,
            overflowY: el.scrollHeight - el.clientHeight,
          },
        ];
      }),
    ) as Record<string, null | Record<string, number | string | boolean>>;

    return {
      column: boxes.column as Box,
      sidebar: boxes.sidebar as Box,
      scroll: boxes.scroll as Box,
      wghCard: boxes.wghCard as Box,
      wghPill: boxes.wghPill as Box,
      countPill: boxes.countPill as Box,
      footnote: boxes.footnote as Box,
      // LAY-10: the standing explanation under the Near-Me switch.
      proxNotes: document.querySelectorAll(".prox-note").length,
      proxLabel: document.querySelector(".prox-label")?.textContent ?? "(none)",
      // LAY-8: the block must not be inside the rail any more.
      collectsInRail: document.querySelectorAll(
        '.sidebar a[href="/transparency"]',
      ).length,
      collectsInFootnote: document.querySelectorAll(
        '.site-footnote a[href="/transparency"]',
      ).length,
      welcomeUp: document.querySelectorAll(".welcome-card").length,
      viewportH: window.innerHeight,
    };
  });
}

async function main(): Promise<void> {
  const browser = await launchGuarded({ label: "shoot-visual-0825" });
  console.log(`run id: ${browser.runId}`);
  try {
    for (const [label, width, height] of [
      ["desktop-1440", 1440, 900],
      ["laptop-1280", 1280, 800],
      ["phone-430", 430, 932],
    ] as const) {
      console.log(`\n--- ${label} ---`);
      const page = await browser.page({ viewport: { width, height } });
      await seedZip(page, "85701");
      await page.goto(BASE, { waitUntil: "networkidle" });
      await page.waitForTimeout(2600);

      /* ------------------------------------ FIRST PAINT — where it broke --- */
      const first = await readSurfaces(page);
      record(
        label,
        "seeded past the welcome overlay (welcome cards painted)",
        first.welcomeUp === 0,
      );
      await shoot(page, `${label}-1-first-paint`);

      const bothUp =
        Boolean(first.sidebar?.visible) && Boolean(first.wghCard?.visible);
      record(label, "WGH-8 both surfaces up at FIRST PAINT (must be false)", bothUp);
      record(
        label,
        "LAY-10 standing prox-note count (must be 0)",
        first.proxNotes,
      );
      record(label, "LAY-10 the control's label", first.proxLabel);
      record(
        label,
        "LAY-8 transparency link in rail / in footnote",
        `${first.collectsInRail} / ${first.collectsInFootnote}`,
      );

      if (first.sidebar?.visible && first.column) {
        // LAY-7: his red rectangle runs the rail down to the foot of the
        // column. A few pixels of slack for the column's own padding.
        const shortBy = first.column.bottom - first.sidebar.bottom;
        record(label, "LAY-7 rail falls short of the column foot by (px)", shortBy);
        record(
          label,
          "LAY-9 collapsed rail scrolls internally by (px, must be <= 0)",
          first.scroll?.overflowY ?? "(no scroller)",
        );
      }

      /* WGH-9: the two pills, measured rather than eyeballed. */
      if (first.wghPill && first.countPill) {
        record(
          label,
          "WGH-9 pill widths (wgh / count)",
          `${first.wghPill.w} / ${first.countPill.w}`,
        );
        record(
          label,
          "WGH-9 pill heights (wgh / count)",
          `${first.wghPill.h} / ${first.countPill.h}`,
        );
        record(
          label,
          "WGH-9 font-size (wgh / count)",
          `${first.wghPill.fontSize} / ${first.countPill.fontSize}`,
        );
        record(
          label,
          "WGH-9 radius (wgh / count)",
          `${first.wghPill.borderRadius} / ${first.countPill.borderRadius}`,
        );
        record(
          label,
          "WGH-9 text-transform (wgh / count)",
          `${first.wghPill.textTransform} / ${first.countPill.textTransform}`,
        );
      } else {
        record(label, "WGH-9 pills present (wgh / count)", `${Boolean(first.wghPill)} / ${Boolean(first.countPill)}`);
      }

      /* --------------------- THE READER'S ROUTE: click the pill (RULING 153) --- */
      const pill = page.locator(".notice-fab").first();
      if (await pill.isVisible().catch(() => false)) {
        await pill.click();
        await page.waitForTimeout(900);
        const opened = await readSurfaces(page);
        await shoot(page, `${label}-2-wgh-open`);

        record(
          label,
          "WGH-8 both up AFTER clicking the pill (must be false)",
          Boolean(opened.sidebar?.visible) && Boolean(opened.wghCard?.visible),
        );
        record(
          label,
          "WGH-8 the card is up",
          Boolean(opened.wghCard?.visible),
        );
        record(
          label,
          "WGH-8 card scrolls SIDEWAYS by (px, must be <= 0)",
          opened.wghCard?.overflowX ?? "(no card)",
        );
        if (opened.wghCard && opened.column) {
          /*
           * **BOTH EDGES, and the first version measured only the bottom.**
           * The card bottom sat 105px above the column foot — the reserved
           * legend gutter, exactly right — while the card was 180px tall and
           * clipped mid-sentence, because it was bottom-anchored at content
           * height. A bottom edge alone cannot see that; a HEIGHT can.
           */
          record(
            label,
            "WGH-8 card falls short of the column foot by (px)",
            opened.column.bottom - opened.wghCard.bottom,
          );
          record(
            label,
            "WGH-8 card height / column height (the card must fill it)",
            `${opened.wghCard.h} / ${opened.column.h}`,
          );
          record(
            label,
            "WGH-8 card width / column width",
            `${opened.wghCard.w} / ${opened.column.w}`,
          );
        }

        /* And back again — the swap has to work in both directions. */
        const toggle = page.locator(".sidebar-toggle").first();
        if (await toggle.isVisible().catch(() => false)) {
          await toggle.click();
          await page.waitForTimeout(900);
          const back = await readSurfaces(page);
          await shoot(page, `${label}-3-rail-back`);
          record(
            label,
            "WGH-8 both up AFTER re-opening the rail (must be false)",
            Boolean(back.sidebar?.visible) && Boolean(back.wghCard?.visible),
          );
          record(label, "WGH-8 the rail is back up", Boolean(back.sidebar?.visible));
        } else {
          record(label, "WGH-8 rail toggle reachable", false);
        }
      } else {
        record(label, "the WGH pill was reachable to click", false);
      }

      await page.close();
    }

    writeFileSync(
      join(OUT, "findings.json"),
      `${JSON.stringify(findings, null, 2)}\n`,
      "utf8",
    );
    console.log(`\nwrote ${findings.length} finding(s) to screenshots/visual-0825/findings.json`);
  } finally {
    await browser.close();
  }
}

await main();
