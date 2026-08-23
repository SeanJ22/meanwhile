/**
 * `pnpm shoot:visual` — captures for the 2026-08-23 visual session.
 *
 * **Which claims this script serves** (RULING 76 — a session-dated script
 * stays in the tree, carries its technique, and names the claim it was
 * written for):
 *
 * - **JUR-2 / `PU04`** — the meeting card no longer reads "Governs your area"
 *   off a zip. The list rows and the venue panel are captured so the badge can
 *   be READ AS AN IMAGE rather than asserted from the DOM.
 * - **MTG-1** — the jurisdiction pill overlapped the meeting date in every row
 *   of the 48-meetings list. A flex row with a gap is the fix, and only a
 *   picture proves a paint.
 * - **MTG-2** — the doubled label: the body name on one line and the same body
 *   name reordered on the next, twenty rows deep.
 * - **MTG-5** — "Make your voice heard" ran to five paragraphs, expanded, on
 *   every card.
 * - **LBL-2 / `VF03`** — the Morris County role string, measured against its
 *   container at the widths the author's captures were taken at.
 *
 * **The technique, which is the reusable half:**
 *
 * 1. The zip is seeded into `sessionStorage`, never `?zip=` — the map entry
 *    renders the welcome overlay over a query parameter and the capture is of
 *    the overlay. `wtp.tutorial_seen` is seeded for the same reason.
 * 2. Every browser comes through `launchGuarded`, so the synthetic-run marker
 *    rides on our origin and is stripped before it reaches MapTiler — whose
 *    CORS preflight refuses it, which is what made every capture in this
 *    repo's history show *Basemap unavailable* (`VF02`, RULING 101).
 * 3. Elements are scrolled into view and measured with `getBoundingClientRect`
 *    BEFORE the shot, and the measurements are printed. A capture that shows a
 *    clipped string is evidence; a capture plus the numbers is a diagnosis.
 * 4. Clips are explicit. A full-page ballot capture reaches 68,000px and is
 *    unreadable, and an unread capture is not evidence (RULING 2).
 *
 * Run: `pnpm shoot:visual [--base http://localhost:3177] [--zip 07866]`
 */

import { makeRunId, syntheticRunHeaders } from "../lib/db/run-marker.ts";

const RUN_HEADERS = syntheticRunHeaders({
  WTP_RUN_ID:
    process.env.WTP_RUN_ID?.trim() || makeRunId("visual-0823", new Date().toISOString()),
});

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { launchGuarded } from "./browser.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "screenshots", "visual-0823");

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const BASE = arg("base", process.env.SHOOT_BASE_URL ?? "http://localhost:3177");
const ZIP = arg("zip", "07866");
const PHONE = { width: 430, height: 932 };
const DESKTOP = { width: 1440, height: 900 };

await mkdir(OUT, { recursive: true });

const browser = await launchGuarded({ label: "visual-0823" });

async function open(viewport: { width: number; height: number }, zip = ZIP) {
  const context = await browser.context({
    extraHTTPHeaders: RUN_HEADERS,
    viewport,
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
        localStorage.setItem("wtp.recent_zips", JSON.stringify([zip]));
        localStorage.setItem("wtp.tutorial_seen", "1");
      } catch {
        /* the shot just starts from defaults */
      }
    },
    { zip },
  );
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  /*
   * **Wait for the ANSWER, not for a duration.** A fixed sleep is a race, and
   * this script lost it twice: the meetings had not arrived, the count badge
   * read zero, the group heads did not exist, and the capture was of an empty
   * list — which the run reported as `[]` rather than as a failure. That is
   * the empty-success shape this repo keeps finding, in the instrument this
   * time.
   */
  /*
   * `polling: 500` rather than the default `raf`. requestAnimationFrame is not
   * guaranteed to be delivered to a page a browser considers occluded, and a
   * poll that never fires reads exactly like a condition that is never true —
   * the instrument reporting an empty result about itself.
   */
  await page
    .waitForFunction(
      `(document.querySelector(".count-badge .cb-num")?.textContent ?? "0") !== "0"`,
      { timeout: 60000, polling: 500 },
    )
    .catch(async () => {
      const badge = await page.evaluate(
        `(document.querySelector(".count-badge")?.textContent ?? "<no badge>")`,
      );
      throw new Error(
        `the count badge never reported a meeting — nothing to capture. It reads: ${String(badge)}`,
      );
    });
  await page.waitForTimeout(4000);
  return { context, page };
}

/** Open the list overlay and expand every group, or fail loudly. */
async function openList(page: { evaluate: (s: string) => Promise<unknown>; waitForTimeout: (n: number) => Promise<void>; waitForSelector: (s: string, o?: object) => Promise<unknown> }) {
  await page.evaluate(`document.querySelector(".count-badge").click()`);
  await page.waitForSelector(".al-overlay", { timeout: 15000 });
  /*
   * The list groups start CLOSED (g4 item 11), so a capture taken straight
   * after opening the overlay is of headings and no rows — which is exactly
   * what the first run of this script photographed. The author's 8/22 capture
   * shows MORRIS COUNTY open, because he had clicked it.
   */
  await page.evaluate(`document.querySelectorAll(".al-group-head").forEach((b) => b.click())`);
  await page.waitForSelector(".al-row", { timeout: 15000 });
  await page.waitForTimeout(600);
}

/** Measure a rendered string against its own box, and print the numbers. */
const MEASURE = `(selector) => {
  const out = [];
  for (const el of document.querySelectorAll(selector)) {
    const box = el.getBoundingClientRect();
    out.push({
      text: (el.textContent || "").trim(),
      width: Math.round(box.width),
      scrollWidth: el.scrollWidth,
      clipped: el.scrollWidth > Math.ceil(box.width) + 1,
      overflow: getComputedStyle(el).overflow,
      textOverflow: getComputedStyle(el).textOverflow,
      whiteSpace: getComputedStyle(el).whiteSpace,
    });
  }
  return out;
}`;

/* ------------------------------------------------- the meetings list --- */
{
  const { context, page } = await open(PHONE);
  await openList(page);

  const rows = await page.evaluate(
    `(() => {
      const out = [];
      for (const row of Array.from(document.querySelectorAll(".al-row")).slice(0, 6)) {
        const meta = row.querySelector(".al-row-meta");
        const badge = row.querySelector(".jurisdiction-badge");
        const titleEl = row.querySelector(".al-row-title");
        const sub = row.querySelector(".al-row-sub");
        const badgeBox = badge ? badge.getBoundingClientRect() : null;
        // The MTG-1 test: does anything in the meta line overlap anything else?
        let overlaps = false;
        if (meta) {
          const kids = Array.from(meta.childNodes)
            .filter((n) => n.nodeType === 1)
            .map((n) => n.getBoundingClientRect());
          for (let i = 0; i < kids.length; i += 1) {
            for (let j = i + 1; j < kids.length; j += 1) {
              const a = kids[i], b = kids[j];
              if (a.right > b.left + 1 && b.right > a.left + 1 && a.bottom > b.top + 1 && b.bottom > a.top + 1) {
                overlaps = true;
              }
            }
          }
        }
        out.push({
          title: (row.querySelector(".al-row-title") || row).textContent.trim().slice(0, 90),
          sub: sub ? sub.textContent.trim() : null,
          badge: badge ? badge.textContent.trim() : null,
          badgeIsButton: badge ? badge.tagName === "BUTTON" : null,
          badgeState: badge ? badge.getAttribute("data-badge") : null,
          metaOverlaps: overlaps,
          metaWidth: meta ? Math.round(meta.getBoundingClientRect().width) : null,
          titleClipped: titleEl ? titleEl.scrollWidth > Math.ceil(titleEl.getBoundingClientRect().width) + 1 : null,
        });
      }
      return out;
    })()`,
  );
  console.log("\n=== MTG-1 + MTG-2 + JUR-2 · the meetings list, first six rows ===");
  console.log(JSON.stringify(rows, null, 2));

  await page.screenshot({ path: join(OUT, "list-07866-phone.png") });
  await context.close();
}

/* ------------------------------------------------ the meeting battlecard --- */
{
  const { context, page } = await open(DESKTOP);
  await openList(page);
  await page.evaluate(`document.querySelector(".al-row").click()`);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(OUT, "meeting-card-desktop.png") });

  const card = await page.evaluate(
    `(() => {
      const modal = document.querySelector(".account-modal");
      const popups = document.querySelectorAll(".popup-card");
      return {
        modalOpen: Boolean(modal),
        stackedPopups: popups.length,
        jurisdictionBadge: (() => {
          const b = document.querySelector(".jurisdiction-badge");
          return b ? { text: b.textContent.trim(), tag: b.tagName, state: b.getAttribute("data-badge") } : null;
        })(),
        calendarLinks: document.querySelectorAll("[data-calendar-link], .calendar-links a").length,
        directions: Array.from(document.querySelectorAll("a")).filter((a) => /directions|maps\\.|google\\.com\\/maps/i.test(a.textContent + " " + a.href)).length,
        howToBeHeardCollapsed: (() => {
          const d = document.querySelector("details.how-to-be-heard");
          return d ? !d.open : null;
        })(),
      };
    })()`,
  );
  console.log("\n=== MTG-2 single surface + MTG-3 + MTG-5 · the meeting battlecard ===");
  console.log(JSON.stringify(card, null, 2));
  await context.close();
}

/* ------------------------------------------- LBL-2: the role string --- */
for (const viewport of [PHONE, DESKTOP]) {
  const { context, page } = await open(viewport);
  const measured = await page.evaluate(
    MEASURE,
    ".person-row-office, .id-person-office, .account-modal-person-office, .person-office",
  );
  console.log(
    `\n=== LBL-2 · role strings measured at ${viewport.width}x${viewport.height} ===`,
  );
  console.log(JSON.stringify(measured, null, 2));
  await context.close();
}

await browser.close();
console.log(`\nwritten to ${OUT}`);
