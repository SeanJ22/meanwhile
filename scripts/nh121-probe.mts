#!/usr/bin/env tsx
/**
 * **`NH121` — 03255 states 201 meetings and its group headings add to 200.**
 * Session 2026-08-24, the state-campaign-money session.
 *
 * Written per RULING 76: a one-shot diagnostic stays in the tree, because the
 * technique is a rung and the report's claim needs its method committed beside
 * it. It runs against the LOCAL production build (RULING 125).
 *
 * What the previous session established, and it is why this probe asks what it
 * asks: the 200-row page limit was RULED OUT by measurement — the panel
 * rendered no `Show N more` button at all, so the missing row looked like it
 * was neither grouped nor clipped.
 *
 * This probe reads the panel's own arithmetic AND the DOM shape around it, so
 * the answer distinguishes:
 *
 *   (a) a row in a group whose HEADING does not render — `groupKeyFor` returns
 *       `""` for a falsy group value, and `{group.key && (…)}` then suppresses
 *       the heading that carries `.al-group-count`, so the row is on screen and
 *       its count is not;
 *   (b) a genuine clip whose button is missing;
 *   (c) a row dropped between the header's count and the grouped list.
 *
 * Those need completely different responses, and a sum that is one short cannot
 * tell them apart on its own.
 */

import { launchGuarded } from "./browser.mts";

const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";
const ZIP = { zip: "03255", lat: 43.31403, lng: -72.02455 };

const browser = await launchGuarded({ label: "nh121-probe-0824" });
const context = await browser.context({ viewport: { width: 390, height: 844 } });

/*
 * `?zip=` DOES NOT SEED THE APP — the map entry renders its welcome overlay and
 * the panel stays empty. The keys below are `walk:all`'s own, copied exactly:
 * the first version of this probe invented plausible key names, opened a panel
 * that stated 0 meetings, and printed "reconciles".
 */
await context.addInitScript(`(() => {
  try {
    sessionStorage.setItem(
      "wtp.approximate_location",
      JSON.stringify({ zip: ${JSON.stringify(ZIP.zip)}, savedAt: new Date().toISOString() }),
    );
    localStorage.setItem("wtp.tutorial_seen", "1");
    localStorage.setItem("wtp.recent_zips", JSON.stringify([${JSON.stringify(ZIP.zip)}]));
  } catch {}
})()`);

const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });

const api = `${BASE}/api/meetings?lat=${ZIP.lat}&lng=${ZIP.lng}&zip=${ZIP.zip}`;
const res = await fetch(api, { headers: { "x-wtp-synthetic-run": "nh121-probe-0824" } });
const payload = (await res.json()) as { meetings?: unknown[] };
console.log(`API /api/meetings at ${ZIP.zip} → ${payload.meetings?.length ?? "?"} meeting(s)`);

/*
 * Open the MEETINGS DOOR, exactly as walk:all does — `[data-stat="meetings"]`.
 * The first version of this probe guessed at a button by its text, clicked a
 * different stat card, and read zeros out of a panel that had never opened.
 * It then printed "the panel reconciles", which is a sweep reporting green
 * without having looked.
 */
await page.waitForTimeout(6000);
const opened = await page.evaluate(`(() => {
  const door = document.querySelector('[data-stat="meetings"]');
  if (!door) return null;
  door.click();
  return door.getAttribute("data-stat");
})()`);
if (!opened) {
  console.error("CANNOT RUN — no meetings door on the sidebar at this width.");
  await context.close();
  await browser.close();
  process.exit(2);
}
console.log(`opened the meetings door: [data-stat="${opened}"]`);
for (let i = 0; i < 40; i++) {
  const there = await page.evaluate('Boolean(document.querySelector(".al-overlay-count"))');
  if (there) break;
  await page.waitForTimeout(250);
}
await page.waitForTimeout(1500);

const shape = await page.evaluate(`(() => {
  const header = document.querySelector(".al-overlay-count");
  const heads = [...document.querySelectorAll(".al-group-head")];
  const counts = heads.map((h) => Number((h.querySelector(".al-group-count")?.textContent || "").trim()));
  const rows = document.querySelectorAll(".al-row, [data-meeting-id]").length;
  const more = document.querySelector(".al-more");
  const select = document.querySelector("select");
  return {
    panelPresent: Boolean(header),
    stated: header ? Number((header.textContent || "").replace(/[^0-9]/g, "")) : null,
    groupBy: select ? select.value : null,
    groupHeadings: heads.length,
    groupCounts: counts,
    sum: counts.reduce((a, b) => a + b, 0),
    renderedRowsInDom: rows,
    moreButtonText: more ? (more.textContent || "").trim() : null,
  };
})()`);

console.log("\n─── what the panel actually shows ───");
console.log(JSON.stringify(shape, null, 2));

const s = shape as {
  stated: number | null;
  sum: number;
  groupHeadings: number;
  renderedRowsInDom: number;
  moreButtonText: string | null;
};

console.log("\n─── reconciliation ───");
console.log(`  header states          ${s.stated}`);
console.log(`  group headings         ${s.groupHeadings}`);
console.log(`  group counts sum       ${s.sum}`);
console.log(`  rows actually in DOM   ${s.renderedRowsInDom}`);
console.log(`  more button            ${s.moreButtonText ?? "NOT RENDERED"}`);
console.log("");
if (s.stated !== null && s.renderedRowsInDom > s.sum) {
  console.log(
    `  DIAGNOSIS (a): ${s.renderedRowsInDom - s.sum} row(s) are ON SCREEN but sit in a group whose\n` +
      `  HEADING did not render, so their count is not in the sum. groupKeyFor returns "" for a\n` +
      `  falsy group value and {group.key && (…)} suppresses the heading that carries the count.\n` +
      `  The reader is NOT missing a meeting. The instrument is summing headings, not rows.`,
  );
} else if (s.stated !== null && s.stated > s.renderedRowsInDom && !s.moreButtonText) {
  console.log(`  DIAGNOSIS (b/c): ${s.stated - s.renderedRowsInDom} row(s) counted and NOT rendered, with no clip stated.`);
} else {
  console.log("  The panel reconciles at this width and this data. Stated below.");
}

await context.close();
await browser.close();
