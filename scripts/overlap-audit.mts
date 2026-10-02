/**
 * Does anything fixed sit on top of anything readable, at 390px?
 *
 *   pnpm overlaps            # every state below
 *   pnpm overlaps --zip 03255
 *
 * Item 5, 2026-08-15 — this audits all of them rather than fixing the one
 * that was seen, and the reason is in the finding itself: the reported
 * collision was "the sidebar footer under the map legend", but the footer is
 * not special. The legend is `position: fixed` above the drawer, so it lands
 * on whatever the reader has scrolled to. One screenshot names one victim; a
 * walk names the mechanism.
 *
 * So this enumerates the FIXED/STICKY chrome and the READABLE surfaces, in
 * several real states, and reports every rectangle intersection. It is the
 * sibling of `pnpm contrast`: a design rule nobody can check is a design rule
 * that lasts until the next commit.
 *
 * Two traps this deliberately avoids, both learned the expensive way:
 *
 * - **`getBoundingClientRect` is layout, not paint.** An element scrolled out
 *   of view inside a card still reports a rect at real coordinates, so a naive
 *   check reports collisions no reader can see. Anything outside its nearest
 *   scrolling ancestor's box is skipped.
 * - **Zero-size and hidden elements** are skipped rather than counted, because
 *   a `display: none` legend intersecting everything at (0,0) would bury the
 *   real findings.
 */

import { type Page } from "playwright";
import { makeRunId, syntheticRunHeaders } from "../lib/db/run-marker.ts";

/**
 * C05 (2026-08-17): this run declares itself so the rows it writes to
 * production's search log are never counted as a reader's. The runner cannot
 * mark the row — the route writes it — so it says who it is in a header.
 */
const RUN_HEADERS = syntheticRunHeaders({
  WTP_RUN_ID:
    process.env.WTP_RUN_ID?.trim() ||
    makeRunId("overlap-audit", new Date().toISOString()),
});

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchGuarded } from "./browser.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
void root;
const BASE_URL = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const ZIP = arg("zip", "85701");
const WIDTH = Number(arg("width", "390"));
const HEIGHT = Number(arg("height", "844"));

/** Chrome that floats. Anything here may never cover anything below. */
const FLOATING = [
  ".legend",
  ".sidebar-toggle",
  ".maplibregl-ctrl-top-right",
  ".maplibregl-ctrl-top-left",
  ".maplibregl-ctrl-bottom-left",
  ".map-floaters",
  ".count-badge",
  ".notice-fab",
];

/** Surfaces a reader reads. */
const READABLE = [
  ".coverage-notice",
  ".sidebar-scroll",
  ".sidebar-header",
  ".popup-card",
  ".bottom-sheet",
  ".zip-switcher",
  ".map-floaters",
  ".count-badge",
  // The sidebar-count doors. Added after this walk found the legend painting
  // over one of them: they were at z-40 under z-1100 chrome.
  ".door-panel",
];

interface Finding {
  state: string;
  over: string;
  under: string;
  box: string;
}

async function audit(page: Page, state: string): Promise<Finding[]> {
  return page.evaluate(
    ({ floating, readable, state }) => {
      const out: {
        state: string;
        over: string;
        under: string;
        box: string;
      }[] = [];

      /*
       * NO INNER NAMED FUNCTIONS IN HERE. `tsx` compiles this file with
       * esbuild, which rewrites `const fn = () => {}` into a call to its
       * `__name` helper — a helper that does not exist in the page. The
       * result is `ReferenceError: __name is not defined` on the first
       * evaluate, which is why the measuring below is written as flat loops
       * over a precomputed table instead of the three small helpers it
       * obviously wants to be.
       */

      // One pass: every candidate's on-screen rectangle and stacking level,
      // clipped to its scrolling ancestors.
      const measured: {
        sel: string;
        el: Element;
        top: number;
        left: number;
        right: number;
        bottom: number;
        z: number;
      }[] = [];

      const all = floating.concat(readable);
      const seen: string[] = [];
      for (const sel of all) {
        if (seen.indexOf(sel) !== -1) continue;
        seen.push(sel);
        const el = document.querySelector(sel);
        if (!el) continue;
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        if (Number(style.opacity) === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;

        let top = r.top;
        let left = r.left;
        let right = r.right;
        let bottom = r.bottom;
        let parent = el.parentElement;
        while (parent) {
          const ps = getComputedStyle(parent);
          if (ps.overflow !== "visible" || ps.overflowY !== "visible") {
            const pr = parent.getBoundingClientRect();
            top = Math.max(top, pr.top);
            left = Math.max(left, pr.left);
            right = Math.min(right, pr.right);
            bottom = Math.min(bottom, pr.bottom);
          }
          parent = parent.parentElement;
        }
        if (right - left < 1 || bottom - top < 1) continue;

        let level = 0;
        let node: Element | null = el;
        while (node) {
          const v = Number(getComputedStyle(node).zIndex);
          if (Number.isFinite(v) && v !== 0) {
            level = v;
            break;
          }
          node = node.parentElement;
        }

        measured.push({ sel, el, top, left, right, bottom, z: level });
      }

      for (const a of measured) {
        if (floating.indexOf(a.sel) === -1) continue;
        for (const b of measured) {
          if (a.sel === b.sel) continue;
          if (readable.indexOf(b.sel) === -1) continue;
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const overlapW = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const overlapH = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          // A hairline touch is a shared edge, not a collision.
          if (overlapW <= 2 || overlapH <= 2) continue;
          // Only report when the floating thing is actually ON TOP.
          if (a.z < b.z) continue;
          out.push({
            state,
            over: a.sel,
            under: b.sel,
            box: `${Math.round(overlapW)}×${Math.round(overlapH)} at (${Math.round(
              Math.max(a.left, b.left),
            )},${Math.round(Math.max(a.top, b.top))})`,
          });
        }
      }
      return out;
    },
    { floating: FLOATING, readable: READABLE, state },
  );
}

const browser = await launchGuarded({ label: "overlap-audit" });
const context = await browser.context({
    // C05: this run is ours, declared at write time.
    extraHTTPHeaders: RUN_HEADERS,
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 2,
  reducedMotion: "reduce",
});
await context.addInitScript(
  ({ zip }) => {
    try {
      sessionStorage.setItem(
        "wtp.approximate_location",
        JSON.stringify({ zip, savedAt: new Date().toISOString() }),
      );
      localStorage.setItem("wtp.tutorial_seen", "1");
      localStorage.setItem("wtp.recent_zips", JSON.stringify([zip, "03255"]));
    } catch {
      // Defaults are fine; the walk just starts from the welcome card.
    }
  },
  { zip: ZIP },
);

const page = await context.newPage();
await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(8000);

const findings: Finding[] = [];
const states: { name: string; before?: () => Promise<void> }[] = [
  { name: "card open" },
  {
    name: "drawer open",
    before: async () => {
      await page.locator(".sidebar-toggle").click();
      await page.waitForTimeout(700);
    },
  },
  {
    name: "drawer open, scrolled to the foot",
    before: async () => {
      await page.locator(".sidebar-scroll").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await page.waitForTimeout(400);
    },
  },
  {
    // The drawer's own hide control, NOT the backdrop. At 390px the drawer is
    // 86vw, so the backdrop's centre point is INSIDE it — a forced click
    // there landed on a stat card and opened a door, and the walk then spent
    // two states measuring a screen it thought was the map. Aim at the
    // control, never at a coordinate you have not checked is empty.
    name: "drawer closed again",
    before: async () => {
      await page
        .locator('.sidebar button[aria-label="Hide sidebar"]')
        .click({ timeout: 8000 });
      await page.waitForTimeout(700);
    },
  },
  {
    name: "a sidebar door open",
    before: async () => {
      await page.locator(".sidebar-toggle").click({ timeout: 8000 });
      await page.waitForTimeout(600);
            // NOT .first(): the Meetings tile opens the LIST overlay, not a door.
      await page.locator(".stat-card").nth(1).click({ timeout: 8000 });
      await page.waitForTimeout(600);
    },
  },
  {
    name: "door closed",
    before: async () => {
      await page
        .locator('.door-overlay button[aria-label="Close"]')
        .click({ timeout: 8000 });
      await page.waitForTimeout(600);
    },
  },
  {
    // Opening the drawer is a press outside the card, so item 1's dismissal
    // has ALREADY minimized it by now — which is the behaviour working, and
    // which broke the first version of this walk when it went looking for a
    // minimize button that was no longer on screen.
    name: "card minimized",
    before: async () => {
      const fab = page.locator(".notice-fab");
      if ((await fab.count()) === 0) {
        await page
          .locator('.coverage-notice button[aria-label^="Minimize"]')
          .click({ timeout: 8000 });
      }
      await page.waitForTimeout(500);
    },
  },
  {
    name: "card reopened from the bubble",
    before: async () => {
      await page.locator(".notice-fab").click({ timeout: 8000 });
      await page.waitForTimeout(500);
    },
  },
  {
    name: "zip switcher open",
    before: async () => {
      await page.locator(".ballot-pill-zip").click({ timeout: 8000 });
      await page.waitForTimeout(500);
    },
  },
];

/*
 * A state that could not be reached is a FAILURE, not a skip. The first
 * version printed "skipped" and then reported zero overlaps across six
 * states, two of which it had never actually looked at — a clean bill of
 * health for work it did not do, which is the exact shape this repo keeps
 * finding.
 */
const unreached: string[] = [];
for (const state of states) {
  if (state.before) {
    try {
      await state.before();
    } catch (error) {
      unreached.push(
        `${state.name}: ${(error as Error).message.split("\n")[0]}`,
      );
      continue;
    }
  }
  findings.push(...(await audit(page, state.name)));
}

await browser.close();

const walked = states.length - unreached.length;
console.log(`Overlap audit — ${WIDTH}×${HEIGHT}, zip ${ZIP}`);
for (const f of findings) {
  console.log(`  FAIL [${f.state}] ${f.over} over ${f.under} — ${f.box}`);
}
for (const u of unreached) {
  console.log(`  UNREACHED ${u}`);
}
// The denominator, always: "0 overlaps" means nothing without the number of
// states it is 0 across.
console.log(
  `\n${findings.length} overlap(s) across ${walked}/${states.length} state(s) walked` +
    (findings.length === 0 && unreached.length === 0
      ? " — no floating element covers a readable surface in any of them"
      : ""),
);
if (findings.length > 0 || unreached.length > 0) process.exit(1);
