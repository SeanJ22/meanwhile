/**
 * The state-extrusion screenshot pair — g3 item 10 (M91).
 *
 * `SHOOT_BASE_URL=… pnpm shoot:focus`
 *
 * The author rules on these against his neumorphism reference, so the pass
 * shoots exactly what his test names: a zip's own neighbourhood scale AND
 * fully zoomed out, in BOTH themes. The zoomed-out frame is the one that
 * matters most — the whole claim is that the effect holds at every zoom, and
 * a pass that only shot neighbourhood scale would be shooting the easy case.
 *
 * It also PRINTS what it measured, because a screenshot proves the pixels and
 * not the mechanism: whether the scrim element exists, whether both edge
 * layers are on the map, and what the camera's zoom actually was. A pretty
 * frame with no scrim in it is a frame of a broken feature.
 */
import { chromium } from "playwright";
import { makeRunId, syntheticRunHeaders } from "../lib/db/run-marker.ts";

/**
 * C05 (2026-08-17): this run declares itself so the rows it writes to
 * production's search log are never counted as a reader's. The runner cannot
 * mark the row — the route writes it — so it says who it is in a header.
 */
const RUN_HEADERS = syntheticRunHeaders({
  WTP_RUN_ID:
    process.env.WTP_RUN_ID?.trim() ||
    makeRunId("shoot-state-focus", new Date().toISOString()),
});

import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.env.SHOOT_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const OUT = join(process.cwd(), "screenshots", "state-focus");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

for (const theme of ["dark", "light"] as const) {
  const context = await browser.newContext({
    // C05: this run is ours, declared at write time.
    extraHTTPHeaders: RUN_HEADERS,
    viewport: { width: 900, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
    colorScheme: theme,
  });
  await context.addInitScript(
    ({ theme }) => {
      try {
        sessionStorage.setItem(
          "wtp.approximate_location",
          JSON.stringify({ zip: "85701", savedAt: new Date().toISOString() }),
        );
        localStorage.setItem("wtp.tutorial_seen", "1");
        localStorage.setItem("wtp.theme", theme);
      } catch {
        // The pass still runs; the theme just comes from the media query.
      }
    },
    { theme },
  );
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(10_000);

  // Minimize the who-governs card so the map itself is what is photographed.
  // Aimed at the MAP, not the sidebar: at 900 wide the sidebar owns the left
  // ~680px, and the first version clicked into it and photographed a
  // half-collapsed panel.
  await page.mouse.click(800, 300);
  await page.waitForTimeout(900);

  let lastZoomOut = 0;
  for (const [label, zoomOut] of [
    // `near` is inside the state at every pixel, which is the spec working:
    // inside the border nothing is touched. `mid` is the frame that shows
    // the RAISED EDGE — the border is on screen with muted land beyond it.
    // `far` is the author's own test, fully zoomed out.
    ["near", 0],
    ["mid", 5],
    ["far", 9],
  ] as const) {
    if (zoomOut > 0) {
      // Cumulative: each frame steps DOWN from the previous one, so the
      // deltas are 5 then 4 rather than 5 then 9.
      await page.evaluate(
        (by) =>
          (window as unknown as { __wtpZoomOut?: (n?: number) => void }).__wtpZoomOut?.(by),
        zoomOut - lastZoomOut,
      );
      lastZoomOut = zoomOut;
      await page.waitForTimeout(4000);
    }

    /*
     * Minimize the who-governs card BEFORE EACH FRAME, not once at the top.
     * A zoom-out that resolves a new area re-expands it (that is the card
     * working), and the first three-frame pass photographed the card sitting
     * over the very border the frame exists to show.
     */
    const minimize = page.locator('.coverage-notice button[aria-label^="Minimize"]');
    if (await minimize.count()) {
      await minimize.first().click();
      await page.waitForTimeout(700);
    }

    const state = await page.evaluate(() => {
      const w = window as unknown as { __wtpZoom?: () => number };
      const scrim = document.querySelector(".state-focus-scrim");
      const clip = document.querySelector(".state-focus-defs path");
      return {
        zoom: w.__wtpZoom?.() ?? Number.NaN,
        scrim: Boolean(scrim),
        filter: scrim ? getComputedStyle(scrim).backdropFilter : "none",
        clipPoints: (clip?.getAttribute("d") ?? "").split("L").length,
      };
    });

    const file = join(OUT, `focus-${theme}-${label}.png`);
    await page.screenshot({ path: file });
    console.log(
      `${theme}/${label}: zoom ${state.zoom.toFixed(1)}, scrim ${
        state.scrim ? "present" : "MISSING"
      }, backdrop-filter "${state.filter}", clip path ${state.clipPoints} segment(s) → ${file}`,
    );
  }

  await context.close();
}

await browser.close();
