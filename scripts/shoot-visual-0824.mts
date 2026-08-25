/**
 * **THE 8/24 VISUAL SESSION'S VERIFICATION SHOOTER.**
 *
 * Committed under RULING 76: a session-dated script stays in the tree, carries
 * a header saying which session and which claim it served, and type-checks
 * under `strict` like every other file. The technique in it is a rung — the
 * `sessionStorage` seeding that stops the welcome overlay swallowing every
 * capture is the same recipe `walk-all` uses, and re-deriving it is what this
 * file exists to prevent.
 *
 * **Runs against a LOCAL PRODUCTION BUILD** (RULING 125). Not production: every
 * `/api/meetings` GET writes a search-log row, and the search log is a store
 * this product sells. *Organic by construction* is a stronger claim than
 * *organic after filtering*, and it costs nothing.
 *
 * Which claims it serves, one capture per item of the 8/24 brief:
 *
 *   LAY-3/4/5/6 · the rail column at three viewports
 *   MTG-6/7/8   · a venue meeting card titled by its body
 *   SRC-1/2/3   · the credit line where the asterisks were
 *   BC-11       · Speak Your Mind, closed and open
 *   BAL-2/3/4/7/8 · the ballot page
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Page } from "playwright";

import { launchGuarded } from "./browser.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "screenshots", "visual-0824");
const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";

mkdirSync(OUT, { recursive: true });

interface Finding {
  id: string;
  what: string;
  value: string;
}

const findings: Finding[] = [];
const record = (id: string, what: string, value: unknown) => {
  findings.push({ id, what, value: String(value) });
  console.log(`  ${id.padEnd(12)} ${what}: ${String(value)}`);
};

/**
 * `?zip=` does NOT seed the app — the map entry renders its welcome overlay and
 * every capture behind it is of the overlay. The zip lives in `sessionStorage`
 * under the shape `use-stored-zip` writes, so it is seeded before the first
 * paint, exactly as `walk-all` does it.
 */
async function seedZip(page: Page, zip: string): Promise<void> {
  /*
   * **THE KEY IS `wtp.approximate_location`, and the first version of this
   * script got it wrong — which is exactly the failure a capture can hide.**
   *
   * With the wrong key the app is in its FIRST-RUN state: the welcome overlay
   * covers the page. Every DOM assertion behind it still passed, because the
   * rail is rendered under the overlay and the selectors found it — so the run
   * reported LAY-3, LAY-4, LAY-5 and LAY-6 all correct while every capture was
   * a photograph of the welcome card. A capture whose claim does not match its
   * contents may never ship, and only READING the image caught it.
   *
   * The tutorial flag is seeded too: the first-run tour is its own check, not a
   * thing every other capture has to dismiss.
   */
  await page.addInitScript(
    ({ zip: z }: { zip: string }) => {
      try {
        sessionStorage.setItem(
          "wtp.approximate_location",
          JSON.stringify({ zip: z, savedAt: new Date().toISOString() }),
        );
        localStorage.setItem("wtp.tutorial_seen", "1");
      } catch {
        // A browser refusing storage still renders; the capture will show the
        // overlay and the reader of this report will see that it did.
      }
    },
    { zip },
  );
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  captured ${name}.png`);
}

async function main(): Promise<void> {
  const browser = await launchGuarded({ label: "shoot-visual-0824" });
  console.log(`run id: ${browser.runId}`);
  try {
    /* ---------------------------------------------- LAY, three viewports --- */
    for (const [label, width, height] of [
      ["desktop-1440", 1440, 900],
      ["laptop-1280", 1280, 800],
      ["phone-430", 430, 932],
    ] as const) {
      const page = await browser.page({ viewport: { width, height } });
      await seedZip(page, "85701");
      await page.goto(BASE, { waitUntil: "networkidle" });
      await page.waitForTimeout(2500);

      /*
       * **THE OVERLAY GATE.** A capture taken over the welcome card is a
       * photograph of the welcome card whatever the DOM behind it says, so the
       * run states plainly whether the app was seeded. Recorded rather than
       * thrown: an unseeded capture is a CANNOT RUN for its item, and a report
       * that can tell that from a FAILURE is worth more than one that stops.
       */
      // VISIBILITY, not presence: the element is in the DOM either way, so a
      // count check reported "not seeded" over a perfectly seeded page. A gate
      // that is wrong in the safe direction still teaches a reader to ignore it.
      const seeded = !(await page.locator(".welcome-card").first().isVisible().catch(() => false));
      record(label, "seeded past the welcome overlay", seeded);

      /*
       * **NO NAMED FUNCTION INSIDE `evaluate`, and this is a rung rather than
       * a style note.** tsx compiles a named helper through esbuild, which
       * wraps it in a `__name` call the PAGE does not have — the callback dies
       * in the browser with `ReferenceError: __name is not defined`, which
       * reads as a broken selector rather than as a build artifact. Everything
       * here is expression-shaped for that reason, and real logic belongs in
       * Node rather than in the page.
       */
      const geometry = await page.evaluate(() => {
        const boxes = [".sidebar", ".rail-floaters"].map((selector) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom };
        });
        return {
          sidebar: boxes[0],
          floaters: boxes[1],
          filtersOpen: document.querySelector(".filters-area[data-open]") !== null,
          caret: document.querySelector(".filters-caret") !== null,
          // LAY-5: all THREE treatments, not only the literal class. The
          // filters panel and the Near-me control take the tile chrome through
          // their own selectors, so counting one class would understate it.
          sections:
            document.querySelectorAll(".sidebar-scroll .rail-section").length +
            document.querySelectorAll(".sidebar-scroll > .prox-control").length +
            document.querySelectorAll(".sidebar-scroll .filters-area").length,
          // LAY-1 must not exist as built.
          sidebarWgh: document.querySelectorAll(".sidebar-wgh").length,
          sidebarWghPill: document.querySelectorAll(".sidebar-wgh-pill").length,
          statsCollapsed: document.querySelectorAll(".stats-collapsed").length,
          railScrolls: (() => {
            const el = document.querySelector(".sidebar-scroll");
            return el ? el.scrollHeight - el.clientHeight : -1;
          })(),
        };
      });

      record(label, "rail-floaters present", geometry.floaters !== null);
      record(label, "LAY-1 .sidebar-wgh count (must be 0)", geometry.sidebarWgh);
      record(label, "LAY-1 .sidebar-wgh-pill count (must be 0)", geometry.sidebarWghPill);
      record(label, "LAY-1 .stats-collapsed count (must be 0)", geometry.statsCollapsed);
      record(label, "LAY-6 filters closed on arrival", !geometry.filtersOpen);
      record(label, "LAY-6 caret present", geometry.caret);
      record(label, "LAY-5 rail sections styled", geometry.sections);
      if (geometry.sidebar && geometry.floaters) {
        record(label, "rail height / floaters height / column", `${Math.round(geometry.sidebar.h)} / ${Math.round(geometry.floaters.h)} / ${height - 24}`);
        record(label, "rail content overflows its box", geometry.railScrolls);
      }

      /*
       * **LAY-3, measured rather than eyeballed.** The rail and the floaters
       * are flex children of one column, so overlap is impossible by
       * construction — this measures it anyway, because "impossible by
       * construction" is a claim about code and this is a claim about pixels.
       */
      if (geometry.sidebar && geometry.floaters) {
        const overlap =
          geometry.sidebar.bottom > geometry.floaters.y &&
          geometry.floaters.h > 0 &&
          geometry.sidebar.h > 0;
        record(label, "LAY-3 rail/floaters overlap", overlap ? "OVERLAP" : "none");
        record(
          label,
          "LAY-4 floaters below the rail",
          geometry.floaters.y >= geometry.sidebar.bottom,
        );
        record(
          label,
          "LAY-4 floaters share the rail's left edge",
          Math.abs(geometry.floaters.x - geometry.sidebar.x) < 2,
        );
      }

      await shoot(page, `lay-${label}`);
      await page.close();
    }

    /* ------------------------------------------------ MTG + SRC + BC-11 --- */
    {
      const page = await browser.page({ viewport: { width: 1440, height: 900 } });
      await seedZip(page, "85701");
      await page.goto(BASE, { waitUntil: "networkidle" });
      await page.waitForTimeout(3000);

      /*
       * A REAL click, through Playwright, not a synthetic . MapLibre
       * markers listen for pointer events; a programmatic click dispatches no
       * pointerdown, so the first version of this found the element and opened
       * nothing — a step that reported success with its product unchecked
       * (RULING 113, in a shooter).
       */
      const markers = page.locator(".maplibregl-marker");
      const markerCount = await markers.count();
      record("MTG", "markers on the map", markerCount);
      if (markerCount > 0) {
        /*
         * **TWICE, and the first one is not wasted.** The who-governs card
         * dismisses on any press outside it, so the first click on the map
         * closes THAT and never reaches the marker — proven by capturing the
         * failure and reading it: the card had collapsed to its pill and no
         * venue panel existed. The second click is the one that opens a venue.
         *
         * The first click is also the LAY-4 minimize check, so it is recorded
         * rather than treated as setup: the pill must land in the under-rail
         * region and never inside the rail.
         */
        await markers.first().click({ force: true });
        await page.waitForTimeout(900);
        const pill = await page.evaluate(() => {
          const el = document.querySelector(".notice-fab");
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const rail = document.querySelector(".sidebar");
          const railBottom = rail ? rail.getBoundingClientRect().bottom : 0;
          return { y: r.y, belowRail: r.y >= railBottom, insideRail: rail !== null && rail.contains(el) };
        });
        record("LAY-4", "minimize pill below the rail", pill ? pill.belowRail : "no pill");
        record("LAY-4", "minimize pill INSIDE the rail (must be false)", pill ? pill.insideRail : "no pill");
        /*
         * A REAL MOUSE at the marker's own centre. 
         * put the pointer at the element box's centre and MapLibre routed it
         * to the district layer underneath — the capture showed the district
         * picker opening, which is how this was diagnosed rather than guessed.
         * The marker is a small circle inside a larger box, so the press has to
         * land on the circle.
         */
        /*
         * **TRY EVERY MARKER UNTIL ONE OPENS A VENUE, and stop at the first.**
         *
         * A single click on the first marker was landing on the DISTRICT layer
         * underneath and opening the district picker — diagnosed by capturing
         * the failure and reading it, twice. The markers at this zoom overlap:
         * the Tucson centre carries a cluster badge reading 13, so the first
         * one in DOM order is not necessarily one whose circle is on top.
         *
         * So the loop asks the product rather than reasoning about z-order,
         * and it reports HOW MANY it had to try — a number that would go up if
         * marker hit-testing regressed, where a single try would just start
         * failing.
         */
        let tried = 0;
        for (let i = 0; i < markerCount; i += 1) {
          tried = i + 1;
          const box = await markers.nth(i).boundingBox();
          if (!box) continue;
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForTimeout(900);
          const open = await page.locator('[aria-label^="Meetings at"]').count();
          if (open > 0) break;
          // Close whatever DID open, so the next try starts clean.
          await page.keyboard.press("Escape");
          await page.waitForTimeout(250);
        }
        record("MTG", "markers tried before a venue opened", tried);
      }

      const card = await page.evaluate(() => {
        const panel = document.querySelector('[aria-label^="Meetings at"]');
        if (!panel) return null;
        const text = panel.textContent ?? "";
        return {
          title: panel.querySelector("h2")?.textContent?.trim() ?? "",
          sub: panel.querySelector("h2 + p")?.textContent?.trim() ?? "",
          // SRC-1: no bare footnote markers anywhere in the card.
          asterisks: (text.match(/[*†‡§]/g) ?? []).length,
          creditLine: /sourced from|sourced this information/.test(text),
        };
      });
      if (card) {
        record("MTG-6", "card title", card.title);
        record("MTG-6", "gray line beneath", card.sub);
        record("SRC-1", "footnote markers in the card (must be 0)", card.asterisks);
        record("SRC-2", "one credit sentence present", card.creditLine);
        await shoot(page, "mtg-venue-card");
      } else {
        record("MTG", "venue panel", "NOT OPENED — capture is a CANNOT RUN");
        // Captured ANYWAY. A step that reports a failure with its product
        // unseen is the shape RULING 113 names: the picture is what says
        // whether the click landed on an overlay, missed, or opened something
        // this selector does not know about.
        await shoot(page, "mtg-venue-card-CANNOT-RUN");
      }
      await page.close();
    }

    /* ------------------------------------------------------------- BC-11 --- */
    {
      const page = await browser.page({ viewport: { width: 1440, height: 1000 } });
      await seedZip(page, "85701");
      await page.goto(BASE, { waitUntil: "networkidle" });
      await page.waitForTimeout(3000);

      /*
       * Into a BODY battlecard the way a reader gets there: the who-governs
       * card lists the bodies, and a body row opens its card. Driven through
       * the product rather than by a URL, so the capture proves the door works
       * as well as proving what is behind it.
       */
      const row = page.locator(".coverage-body-name, .coverage-notice li button").first();
      const rows = await row.count();
      record("BC-11", "who-governs body rows reachable", rows);
      if (rows > 0) {
        await row.click();
        await page.waitForTimeout(1200);
        /*
         * NO "More" STEP. A who-governs body row opens the LARGE card
         * directly — that is the click grammar settled on 2026-08-16 — so a
         * follow-up click was intercepted by the modal that had already
         * opened, and the run died on a timeout rather than reporting a
         * finding. The overlay is the proof the row worked.
         */
        const modal = await page.locator(".account-modal-overlay").count();
        record("BC-11", "a battlecard opened from the row", modal > 0);
      }

      const pill = page.locator("[data-speak-pill]");
      const pillCount = await pill.count();
      record("BC-11", "Speak Your Mind pill on the battlecard", pillCount);
      if (pillCount > 0) {
        await shoot(page, "bc11-pill-closed");
        await pill.first().click();
        await page.waitForTimeout(600);
        const open = await page.evaluate(() => {
          const box = document.querySelector("[data-speak-open]");
          if (!box) return null;
          const input = box.querySelector("textarea");
          return {
            framing: box.querySelector(".speak-framing")?.textContent?.trim() ?? "",
            placeholder: input ? input.getAttribute("placeholder") : null,
            disclosures: box.querySelectorAll(".speak-disclosure").length,
            firstDisclosure: box.querySelector(".speak-disclosure")?.textContent?.trim() ?? "",
          };
        });
        if (open) {
          record("BC-11", "framing", open.framing);
          record("BC-11", "placeholder", open.placeholder);
          record("BC-11", "disclosure lines at the box", open.disclosures);
          record("BC-11", "disclosure as shipped", open.firstDisclosure);
        } else {
          record("BC-11", "open box", "NOT OPENED — capture is a CANNOT RUN");
        }
        await shoot(page, "bc11-box-open");
      } else {
        await shoot(page, "bc11-CANNOT-RUN");
      }
      await page.close();
    }

    /* -------------------------------------------------------- the ballot --- */
    {
      const page = await browser.page({ viewport: { width: 1440, height: 1200 } });
      await page.goto(`${BASE}/ballot?zip=85701`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);

      const ballot = await page.evaluate(() => {
        /*
         * **`document.body.textContent` IS NOT WHAT A READER SEES, and reading
         * it produced two false positives before this was fixed.**
         *
         * Next serialises the whole RSC flight payload into `<script>` tags in
         * the body. That payload carries every prop the server passed, so it
         * still contains `polls.note` — the licence prompt BAL-3 stopped
         * RENDERING but deliberately did not delete from the data — and every
         * `title` and `aria-label`, including the leaving warning BAL-4 moved
         * onto the registration pill on purpose.
         *
         * So the first run of this shooter reported BAL-3 and BAL-4 as
         * unfixed while the page was correct. `innerText` reads what is
         * actually laid out and skips script content, which is the question
         * being asked: what does a reader see.
         */
        const text = (document.body as HTMLElement).innerText ?? "";
        return {
          bal2: /own tool/.test(text),
          bal3: /driver's licence number|driver's license number/.test(text),
          bal4Sos: /is the only place this can be checked/.test(text),
          bal7Gap: /gap on our side/.test(text),
          bal7Prompt: /Want to narrow it/.test(text),
          bal8Collapsed: document.querySelectorAll("[data-provisions]").length,
          bal8Open: document.querySelectorAll("[data-provisions][open]").length,
          // BC-12: no mm/dd/yyyy anywhere the reader can see.
          slashDates: (text.match(/\b\d{2}\/\d{2}\/\d{4}\b/g) ?? []).length,
          spelledDates: (text.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th),\s+\d{4}/g) ?? []).length,
        };
      });
      record("BAL-2", "'own tool' present (must be false)", ballot.bal2);
      record("BAL-3", "licence prompt present (must be false)", ballot.bal3);
      record("BAL-4", "SoS paragraph present (must be false)", ballot.bal4Sos);
      record("BAL-7", "'gap on our side' present (must be false)", ballot.bal7Gap);
      record("BAL-7", "address prompt ends the block", ballot.bal7Prompt);
      record("BAL-8", "collapsible provision blocks", ballot.bal8Collapsed);
      record("BAL-8", "open on arrival (must be 0)", ballot.bal8Open);
      record("BC-12", "mm/dd/yyyy dates (must be 0)", ballot.slashDates);
      record("BC-12", "spelled-out dates", ballot.spelledDates);

      await page.evaluate(() => window.scrollTo(0, 0));
      await shoot(page, "ballot-top");
      await page.close();
    }

    writeFileSync(
      join(OUT, "findings.json"),
      `${JSON.stringify(findings, null, 2)}\n`,
      "utf8",
    );
    console.log(`\n${findings.length} findings recorded → ${OUT}`);
  } finally {
    await browser.close();
  }
}

await main();
