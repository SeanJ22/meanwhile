/**
 * PANELS PAINT WITHOUT BEING TOUCHED — g5 item 2's permanent measurement.
 *
 * `SHOOT_BASE_URL=… pnpm measure:panels`
 *
 * ## What it is guarding
 *
 * The author opened the meetings panel at 85701 and got a header reading "86
 * meetings" above an empty box. Moving the mouse over it made the rows
 * appear. A phone has no hover: a mobile reader taps meetings, sees a count
 * above nothing, and concludes we hold nothing — which is a stated-N versus
 * rendered-rows violation produced by a paint bug rather than by a data one.
 *
 * ## Why this measures pixels and not the DOM
 *
 * Because the DOM was never wrong. Every reproduction of the defect found the
 * panel's group headers present, at real coordinates, with counts summing to
 * the header's own number — and none of them on screen. `getBoundingClientRect`
 * is layout, not paint, and a guard that asked the DOM whether the rows were
 * there would have passed on every broken build.
 *
 * ## The rules of the pass
 *
 * **The mouse never moves.** Not once, at any viewport. Playwright's own
 * `click()` moves the pointer, so every open here is a DOM `click()` issued
 * from inside the page. Hovering is the thing that repairs the defect, so a
 * harness that hovers is a harness that cannot see it.
 *
 * **Repeated.** The failure is a compositing race and answers differently on
 * identical inputs — the first A/B of it looked decisive and was not, because
 * the control arm happened to paint on its second run. Every assertion is
 * made `REPS` times and reported as a rate, so an intermittent regression
 * reads as one instead of as a coin toss.
 *
 * Three assertions, in the brief's own order, plus the audit of every other
 * surface that carries counted rows over the map.
 */
import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { decodePng, patchStats } from "./png.mts";

const BASE = (process.env.SHOOT_BASE_URL ?? "https://sparkwtp.netlify.app").replace(/\/$/, "");
const OUT = join(process.cwd(), "screenshots", "panels");
mkdirSync(OUT, { recursive: true });

const ZIPS = ["85701", "03255", "08540", "06716"];
const REPS = Number(process.env.PANEL_REPS ?? 2);

/**
 * How much local variation a patch of real content carries.
 *
 * A painted panel is text on a ground: luminance moves from pixel to pixel.
 * An unpainted one is whatever was behind it, seen through a flat 60% black
 * backdrop, which is nearly uniform. One luminance unit of standard deviation
 * over a 41 x 41 patch separates them with room to spare — the measured
 * readings were 0.0 unpainted against 2.4–20 painted.
 */
const PAINTED_DETAIL = 1;

let checks = 0;
let failures = 0;
const notes: string[] = [];

function check(name: string, ok: boolean, evidence: string) {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}\n          ${evidence}`);
}

/** Open a page at a zip with the tutorial and theme settled. No pointer use. */
async function openAt(page: Page, zip: string, phone: boolean) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(11_000);
  if (phone) {
    const menu = page.locator('button[aria-label="Open menu"]');
    if (await menu.count()) {
      await menu.first().evaluate((el: HTMLElement) => el.click());
      await page.waitForTimeout(800);
    }
  }
}

/** Click a stat card by its label, from inside the page. Never the mouse. */
async function openDoor(page: Page, label: RegExp): Promise<boolean> {
  return page.evaluate((source) => {
    const pattern = new RegExp(source, "i");
    const cards = Array.from(document.querySelectorAll("button, [role=button]"));
    for (const c of cards) {
      const text = c.textContent ?? "";
      if (pattern.test(text) && /\d/.test(text)) {
        (c as HTMLElement).click();
        return true;
      }
    }
    return false;
  }, label.source);
}

const browser = await chromium.launch();

for (const [viewport, width, height] of [
  ["phone", 390, 844],
  ["desktop", 1280, 900],
] as const) {
  for (const zip of ZIPS) {
    let paintedRuns = 0;
    let sumMatchRuns = 0;
    let expandRuns = 0;
    let ranRuns = 0;
    const readings: string[] = [];

    for (let rep = 0; rep < REPS; rep += 1) {
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
        colorScheme: "dark",
        hasTouch: width < 500,
        isMobile: width < 500,
      });
      await context.addInitScript(
        ({ zip }) => {
          try {
            sessionStorage.setItem(
              "wtp.approximate_location",
              JSON.stringify({ zip, savedAt: new Date().toISOString() }),
            );
            localStorage.setItem("wtp.tutorial_seen", "1");
            localStorage.setItem("wtp.theme", "dark");
          } catch {
            /* the pass still runs */
          }
        },
        { zip },
      );
      const page = await context.newPage();
      await openAt(page, zip, width < 500);

      if (!(await openDoor(page, /meetings/))) {
        await context.close();
        continue;
      }
      await page.waitForTimeout(1500);
      ranRuns += 1;

      /* --- 1: the body is NOT EMPTY on first paint --- */
      const shape = await page.evaluate(() => {
        const header = document.querySelector(".al-overlay-count");
        const body = document.querySelector(".al-overlay-body") as HTMLElement | null;
        const heads = Array.from(document.querySelectorAll(".al-group-head"));
        const counts: number[] = [];
        for (const h of heads) {
          const n = Number((h.querySelector(".al-group-count")?.textContent ?? "").trim());
          if (Number.isFinite(n)) counts.push(n);
        }
        const stated = Number((header?.textContent ?? "").replace(/[^\d]/g, ""));
        return {
          stated: Number.isFinite(stated) ? stated : -1,
          groups: heads.length,
          counts,
          sum: counts.reduce((a, b) => a + b, 0),
          bodyRect: body ? body.getBoundingClientRect().toJSON() : null,
          headRect: heads[0] ? heads[0].getBoundingClientRect().toJSON() : null,
          firstKey: heads[0]?.textContent?.replace(/[▸▾]/g, "").trim() ?? null,
        };
      });

      const shot = await page.screenshot({
        path: join(OUT, `${viewport}-${zip}-${rep}-open.png`),
      });
      const png = decodePng(shot);
      let detail = 0;
      if (shape.headRect && shape.headRect.width > 8) {
        detail = patchStats(
          png,
          Math.round(shape.headRect.x + shape.headRect.width / 2),
          Math.round(shape.headRect.y + shape.headRect.height / 2),
          Math.round(Math.min(20, shape.headRect.width / 3)),
        ).detail;
      }
      /*
       * A ZIP WE DO NOT COVER HAS NO GROUPS, AND THAT IS CORRECT.
       *
       * 06716 renders the honest empty note instead of group headers. A check
       * that demanded headers there would fail a correct build, and the fix
       * for such a check is always to loosen it until it proves nothing. So
       * the empty state is measured on its own terms: the note has to PAINT,
       * which is the same claim about the same compositor.
       */
      const emptyState = shape.stated === 0 || shape.groups === 0;
      if (emptyState) {
        const note = await page.evaluate(() => {
          const el = document.querySelector(".al-empty") as HTMLElement | null;
          return el ? el.getBoundingClientRect().toJSON() : null;
        });
        let noteDetail = 0;
        if (note && note.width > 8 && note.height > 8) {
          noteDetail = patchStats(
            png,
            Math.round(note.x + note.width / 2),
            Math.round(note.y + Math.min(note.height / 2, 24)),
            Math.round(Math.min(20, note.width / 3)),
          ).detail;
        }
        const ok = Boolean(note) && noteDetail >= PAINTED_DETAIL;
        if (ok) {
          paintedRuns += 1;
          sumMatchRuns += 1;
          expandRuns += 1;
        }
        readings.push(
          `${ok ? "y" : "n"}(empty note, stated ${shape.stated}, detail ${noteDetail.toFixed(1)})`,
        );
        await context.close();
        continue;
      }

      const painted = shape.groups > 0 && detail >= PAINTED_DETAIL;
      if (painted) paintedRuns += 1;

      /* --- 2: the group counts sum to the header count --- */
      if (shape.stated > 0 && shape.sum === shape.stated) sumMatchRuns += 1;

      /* --- 3: expanding one group paints its rows immediately --- */
      let expanded = { rows: 0, want: 0, detail: 0 };
      if (shape.groups > 0) {
        const want = await page.evaluate(() => {
          const head = document.querySelector(".al-group-head") as HTMLElement | null;
          if (!head) return 0;
          const n = Number((head.querySelector(".al-group-count")?.textContent ?? "").trim());
          head.click();
          return Number.isFinite(n) ? n : 0;
        });
        await page.waitForTimeout(700);
        const after = await page.evaluate(() => {
          const group = document.querySelector(".al-group-head")?.parentElement;
          const body = document.querySelector(".al-overlay-body");
          if (!group || !body) return { rows: 0, rect: null };
          const rows = Array.from(group.children).filter(
            (el) => !el.classList.contains("al-group-head"),
          );
          /*
           * The first row THE READER CAN SEE, not the first row in the DOM.
           *
           * The body scrolls, and a row below the fold still reports a rect at
           * real page coordinates — layout, not paint. Sampling one of those
           * measures whatever is painted at that spot outside the panel and
           * reports detail 0.0 on a perfectly good build, which is exactly
           * how a correct build fails a careless guard.
           */
          const view = body.getBoundingClientRect();
          let rect: { x: number; y: number; width: number; height: number } | null = null;
          for (const row of rows) {
            const r = row.getBoundingClientRect();
            // Clipped to what the reader can see, rather than skipped: with a
            // sticky group header over it the first row is often part-covered,
            // and demanding a wholly-visible row finds none at all.
            const top = Math.max(r.top, view.top);
            const bottom = Math.min(r.bottom, view.bottom);
            if (bottom - top >= 18 && r.width > 8) {
              rect = { x: r.x, y: top, width: r.width, height: bottom - top };
              break;
            }
          }
          return { rows: rows.length, rect };
        });
        const shot2 = await page.screenshot({
          path: join(OUT, `${viewport}-${zip}-${rep}-expanded.png`),
        });
        const png2 = decodePng(shot2);
        let rowDetail = 0;
        if (after.rect && after.rect.width > 8 && after.rect.height > 4) {
          // The patch never leaves the row's own VISIBLE band. Sampling a
          // fixed radius around a row that is only part-visible reads the
          // panel's padding instead of its text, which is how a correct
          // build reported detail 0.0 at 1280px.
          rowDetail = patchStats(
            png2,
            Math.round(after.rect.x + after.rect.width / 2),
            Math.round(after.rect.y + after.rect.height / 2),
            Math.max(4, Math.floor(Math.min(after.rect.height / 2 - 1, after.rect.width / 3))),
          ).detail;
        }
        expanded = { rows: after.rows, want, detail: rowDetail };
        // The brief is explicit: do NOT assert that every meeting renders on
        // open. Groups are collapsed by design (g4 item 11), so the claim is
        // that ONE expanded group paints exactly its own stated count.
        if (want > 0 && after.rows === want && rowDetail >= PAINTED_DETAIL) expandRuns += 1;
      }

      readings.push(
        `${painted ? "y" : "n"}(${shape.groups}g detail ${detail.toFixed(1)}, ` +
          `${shape.sum}/${shape.stated}, expand ${expanded.rows}/${expanded.want} ` +
          `detail ${expanded.detail.toFixed(1)})`,
      );
      await context.close();
    }

    if (ranRuns === 0) {
      notes.push(`${viewport}/${zip}: the meetings door never opened`);
      console.log(`  ....  ${viewport}/${zip} — could not run (no meetings door)`);
      continue;
    }
    check(
      `${viewport}/${zip}: the meetings panel body paints on first render, no pointer`,
      paintedRuns === ranRuns,
      `${paintedRuns}/${ranRuns} run(s); ${readings.join(" ")}`,
    );
    check(
      `${viewport}/${zip}: the group counts sum to the stated count`,
      sumMatchRuns === ranRuns,
      `${sumMatchRuns}/${ranRuns} run(s)`,
    );
    check(
      `${viewport}/${zip}: expanding a group paints exactly its stated rows`,
      expandRuns === ranRuns,
      `${expandRuns}/${ranRuns} run(s)`,
    );
  }
}

/* ------------------------------------------------------------- audit --- */

/**
 * Every other surface that opens over the map with counted rows in it.
 *
 * The meetings panel was the one the author hit; the cause was a compositing
 * one and nothing about it is specific to that panel, so each of these is
 * opened the same way — from inside the page, mouse untouched — and its first
 * paint is measured rather than its DOM read.
 */
const DOORS: [string, RegExp, string][] = [
  ["bodies door", /bodies/i, ".door-panel"],
  ["districts door", /districts/i, ".door-panel"],
  ["officials door", /officials/i, ".door-panel"],
];

let audited = 0;
let affected = 0;
for (const [name, label, selector] of DOORS) {
  for (const [viewport, width, height] of [
    ["phone", 390, 844],
    ["desktop", 1280, 900],
  ] as const) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      colorScheme: "dark",
      hasTouch: width < 500,
      isMobile: width < 500,
    });
    await context.addInitScript(() => {
      try {
        sessionStorage.setItem(
          "wtp.approximate_location",
          JSON.stringify({ zip: "85701", savedAt: new Date().toISOString() }),
        );
        localStorage.setItem("wtp.tutorial_seen", "1");
        localStorage.setItem("wtp.theme", "dark");
      } catch {
        /* the pass still runs */
      }
    });
    const page = await context.newPage();
    await openAt(page, "85701", width < 500);
    const opened = await openDoor(page, label);
    if (!opened) {
      notes.push(`${viewport}/${name}: never opened`);
      await context.close();
      continue;
    }
    await page.waitForTimeout(1400);
    audited += 1;
    const rect = await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      return el ? el.getBoundingClientRect().toJSON() : null;
    }, selector);
    const shot = await page.screenshot({
      path: join(OUT, `audit-${viewport}-${name.replace(/\s+/g, "-")}.png`),
    });
    const png = decodePng(shot);
    let detail = 0;
    if (rect && rect.width > 8 && rect.height > 8) {
      detail = patchStats(
        png,
        Math.round(rect.x + rect.width / 2),
        Math.round(rect.y + Math.min(rect.height / 2, 60)),
        Math.round(Math.min(24, rect.width / 3)),
      ).detail;
    }
    const ok = Boolean(rect) && detail >= PAINTED_DETAIL;
    if (!ok) affected += 1;
    check(
      `${viewport}/${name}: paints on first render, no pointer`,
      ok,
      rect ? `detail ${detail.toFixed(1)} over ${Math.round(rect.width)}x${Math.round(rect.height)}` : "no panel",
    );
    await context.close();
  }
}

await browser.close();

console.log(
  `\nmeasure:panels — ${BASE}\n${checks} check(s), ${failures} failure(s); ` +
    `${audited} other surface(s) audited, ${affected} affected`,
);
for (const note of notes) console.log(`  note: ${note}`);
console.log(`frames → ${OUT}`);
process.exit(failures > 0 ? 1 : 0);
