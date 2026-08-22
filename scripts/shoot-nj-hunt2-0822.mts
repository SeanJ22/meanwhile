/**
 * `NJ01` verified on the live product — NJ Hunt 2, 2026-08-22.
 *
 * RULING 2: a full-page screenshot is evidence only once it has been READ AS AN
 * IMAGE. A ballot page at 430×932 runs to tens of thousands of pixels, and
 * downscaled far enough to view, a contest heading is unreadable — so the PAGE
 * is shrunk rather than the image, and the two Rockaway contests are marked
 * before the capture so what survives the reduction is legible.
 *
 * Four captures:
 *   1. 07866 ballot, whole page shrunk, both Rockaway municipalities marked.
 *   2. 07866 ballot, the Borough council contest at full size — the four
 *      candidates readable by name, which is the claim `NJ01` actually makes.
 *   3. 03255 ballot, unmarked — Newbury must not have changed.
 *   4. 07866 map entry, so the headline surface is seen too.
 *
 * Every capture prints the DOM facts it was taken against, so the report can
 * say what the image should show BEFORE the image is opened. A DOM assertion
 * passing while the picture shows a different page is why this rule exists.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { launchGuarded } from "./browser.mts";

/*
 * `page.evaluate` given a STRING page-function has no return type to infer
 * from, so Playwright hands back `unknown` and `strict` refuses every property
 * read off it — five of them, which is how this file put `main` red after the
 * gates had already run. The shapes are declared here rather than asserted at
 * each site: an `as any` would silence the same five errors while leaving the
 * next typo to be discovered by a reader looking at a wrong screenshot.
 */
type BallotFacts = {
  cards: number;
  contests: number;
  borough: string[];
  hasBurnside: boolean;
  hasMcdonald: boolean;
  hasDawkins: boolean;
  hasNatale: boolean;
  pageHeight: number;
};
type ContestBox =
  | { found: true; top: number; height: number; heading: string }
  | { found: false };
type PageCounts = { cards: number; contests: number; height: number };
type MapFacts = { welcomeStillUp: boolean; canvases: number; firstWords: string };

const BASE = process.env.SHOOT_BASE_URL ?? "https://sparkwtp.netlify.app";
const OUT = join(process.cwd(), ".njhunt2", "shots");
mkdirSync(OUT, { recursive: true });

const browser = await launchGuarded({ label: "NJ-hunt2-0822" });
console.log("run id:", browser.runId);
const page = await browser.page({ viewport: { width: 430, height: 932 } });

/* ── 1 + 2: 07866, the Borough ───────────────────────────────────────────── */

await page.goto(`${BASE}/ballot?zip=07866`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

const facts = await page.evaluate<BallotFacts>(`(() => {
  const text = document.body.innerText;
  const headings = [...document.querySelectorAll("h2, h3")].map((h) => h.textContent.trim());
  return {
    cards: document.querySelectorAll("[data-candidate-battlecard]").length,
    contests: document.querySelectorAll("[data-contest-id]").length,
    borough: headings.filter((h) => /Borough/i.test(h)),
    hasBurnside: text.includes("Burnside") || text.includes("BURNSIDE"),
    hasMcdonald: text.includes("McDonald") || text.includes("MCDONALD"),
    hasDawkins: text.includes("Dawkins") || text.includes("DAWKINS"),
    hasNatale: text.includes("Natale") || text.includes("NATALE"),
    pageHeight: document.documentElement.scrollHeight,
  };
})()`);
console.log("07866 DOM:", JSON.stringify(facts, null, 1));

/*
 * The marker is applied at full page scale so it lands on the real layout, and
 * the shrink comes afterwards — the F22 recipe, which is the only way a
 * whole-page claim about a very tall page survives being made readable.
 */
await page.addStyleTag({
  content: `
    [data-contest-id]:has(h2:is(:text-matches("Borough Council","i"))) {
      outline: 6px solid #00b3ff !important;
      box-shadow: 0 0 0 100vw rgba(0,179,255,.10) !important;
    }
  `,
});
// `:has(:text-matches())` is Playwright-only in locators, not in CSS — so the
// mark is applied through the DOM instead, where the match is ours to make.
await page.evaluate(`(() => {
  for (const el of document.querySelectorAll("[data-contest-id]")) {
    const h = el.querySelector("h2, h3");
    const t = (h && h.textContent) || "";
    if (/Borough Council/i.test(t)) { el.style.outline = "6px solid #00b3ff"; el.style.background = "rgba(0,179,255,.10)"; }
    if (/Board of Education/i.test(t)) { el.style.outline = "4px dashed #ff00aa"; }
  }
})()`);

const shrink = Math.min(1, 12000 / facts.pageHeight);
await page.evaluate(`document.documentElement.style.zoom = "${shrink}"`);
await page.waitForTimeout(600);
await page.screenshot({ path: join(OUT, "1-ballot-07866-whole-page.png"), fullPage: true });
console.log(`1 · whole page at zoom ${shrink.toFixed(3)} (page was ${facts.pageHeight}px)`);

await page.evaluate(`document.documentElement.style.zoom = "1"`);
await page.waitForTimeout(400);
const council = await page.evaluate<ContestBox>(`(() => {
  for (const el of document.querySelectorAll("[data-contest-id]")) {
    const h = el.querySelector("h2, h3");
    if (h && /Borough Council/i.test(h.textContent || "")) {
      el.scrollIntoView({ block: "start" });
      const r = el.getBoundingClientRect();
      return { found: true, top: window.scrollY + r.top, height: r.height, heading: h.textContent.trim() };
    }
  }
  return { found: false };
})()`);
console.log("borough council contest:", JSON.stringify(council));
if (council.found) {
  await page.waitForTimeout(400);
  await page.screenshot({
    path: join(OUT, "2-ballot-07866-borough-council.png"),
    clip: { x: 0, y: 0, width: 430, height: Math.min(1800, Math.ceil(council.height) + 120) },
  });
  console.log("2 · borough council contest, full size");
}

/* ── 3: 03255 must not have changed ──────────────────────────────────────── */

await page.goto(`${BASE}/ballot?zip=03255`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
const nh = await page.evaluate<PageCounts>(`(() => ({
  cards: document.querySelectorAll("[data-candidate-battlecard]").length,
  contests: document.querySelectorAll("[data-contest-id]").length,
  height: document.documentElement.scrollHeight,
}))()`);
console.log("03255 DOM:", JSON.stringify(nh));
const nhShrink = Math.min(1, 12000 / nh.height);
await page.evaluate(`document.documentElement.style.zoom = "${nhShrink}"`);
await page.waitForTimeout(600);
await page.screenshot({ path: join(OUT, "3-ballot-03255-whole-page.png"), fullPage: true });
console.log(`3 · 03255 whole page at zoom ${nhShrink.toFixed(3)}`);

/* ── 4: the map entry at 07866 ───────────────────────────────────────────── */

await page.evaluate(`document.documentElement.style.zoom = "1"`);
/*
 * `?zip=` does not seed the map — the entry renders its welcome overlay. The
 * session storage key is what `walk:all` seeds, and seeding it is the only way
 * a capture of the map shows the map rather than the overlay.
 */
/*
 * The keys are the ones `walk:all` seeds, read out of that script rather than
 * guessed — the first attempt invented `wtp.zip` and `wtp.welcomeSeen`, the
 * overlay stayed up, and the capture showed the welcome panel while claiming to
 * show the map. That is precisely the unread-evidence failure RULING 2 exists
 * to catch, and it was caught by opening the image.
 *
 * They are set in an INIT SCRIPT so they exist before the app's first render.
 * Setting them after a navigation is too late: the overlay has already decided.
 */
const mapPage = await browser.page({ viewport: { width: 430, height: 932 } });
await mapPage.addInitScript(({ zip }) => {
  try {
    sessionStorage.setItem(
      "wtp.approximate_location",
      JSON.stringify({ zip, savedAt: new Date().toISOString() }),
    );
    localStorage.setItem("wtp.tutorial_seen", "1");
    localStorage.setItem("wtp.recent_zips", JSON.stringify([zip, "03255"]));
  } catch {
    /* Defaults are fine; the capture is then honestly reported as NOT VISIBLE. */
  }
}, { zip: "07866" });
await mapPage.goto(`${BASE}/`, { waitUntil: "networkidle" });
await mapPage.waitForTimeout(4000);
const mapFacts = await mapPage.evaluate<MapFacts>(`(() => ({
  welcomeStillUp: /Meanwhile/.test(document.body.innerText),
  canvases: document.querySelectorAll("canvas").length,
  firstWords: document.body.innerText.slice(0, 90).replace(/\\s+/g, " "),
}))()`);
console.log("map DOM:", JSON.stringify(mapFacts));
await mapPage.screenshot({ path: join(OUT, "4-map-07866.png") });
console.log("4 · map at 07866");

await browser.close();
console.log(`\nwritten to ${OUT}`);
