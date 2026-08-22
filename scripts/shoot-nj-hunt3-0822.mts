/**
 * **RULING 71 AND RULING 74, VERIFIED ON THE LIVE PRODUCT.**
 * (NJ Hunt 3 item 3.9 and 9.7, 2026-08-22.)
 *
 * RULING 2: a screenshot is evidence only once it has been READ AS AN IMAGE. A
 * ballot page at 430×932 runs to tens of thousands of pixels and a whole-page
 * capture downscaled far enough to view has an unreadable contest heading — so
 * the PAGE is shrunk rather than the image, and the claim's subject is marked
 * before the capture so what survives the reduction is the thing being claimed.
 *
 * Every capture prints the DOM facts it was taken against BEFORE the image is
 * opened, so the report can say what the picture should show and then be held
 * to it. A DOM assertion passing while the picture shows a different page is
 * exactly why RULING 2 exists.
 *
 * Six captures:
 *   1. 07866 ballot, whole page shrunk, every pilled contest outlined.
 *   2. 07866, one AMBIGUOUS contest at full size — the pill readable.
 *   3. 07866, one CERTAIN contest at full size — no pill, which is the half of
 *      the claim a picture of a pill cannot make.
 *   4. 07866 after an address is given — the pill gone on the confirmed
 *      contest, and the narrowing banner rather than a second prompt.
 *   5. 03255 whole page — Newbury is certain and carries no pill anywhere.
 *   6. 07866 map entry, welcome overlay dismissed.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { launchGuarded } from "./browser.mts";

const BASE = process.env.SHOOT_BASE_URL ?? "https://sparkwtp.netlify.app";
const OUT = join(process.cwd(), ".njhunt3", "shots");
mkdirSync(OUT, { recursive: true });

type PillFacts = {
  contests: number;
  cards: number;
  pilled: number;
  pillText: string[];
  pilledTitles: string[];
  certainTitles: string[];
  pageHeight: number;
};
type Box = { found: true; top: number; height: number; heading: string } | { found: false };
type Counts = { cards: number; contests: number; pilled: number; height: number };
type MapFacts = { welcomeStillUp: boolean; canvases: number; firstWords: string };

const browser = await launchGuarded({ label: "NJ-hunt3-0822" });
console.log("run id:", browser.runId);
const page = await browser.page({ viewport: { width: 430, height: 932 } });

/* ── 1–3: 07866, the pill on the ambiguous bodies and on no others ────────── */

await page.goto(`${BASE}/ballot?zip=07866`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

const facts = await page.evaluate<PillFacts>(`(() => {
  const sections = [...document.querySelectorAll("[data-contest-id]")];
  const titleOf = (el) => {
    const h = el.querySelector("h2, h3");
    return (h && h.textContent || "").replace(/\\s+/g, " ").trim();
  };
  const pilled = sections.filter((s) => s.dataset.couldGovern === "true");
  return {
    contests: sections.length,
    cards: document.querySelectorAll(".candidate-row").length,
    pilled: pilled.length,
    pillText: [...new Set([...document.querySelectorAll(".could-govern-pill")].map((p) => (p.textContent || "").replace(/\\s+/g, " ").trim()))],
    pilledTitles: [...new Set(pilled.map(titleOf))].slice(0, 12),
    certainTitles: [...new Set(sections.filter((s) => s.dataset.couldGovern !== "true").map(titleOf))].slice(0, 12),
    pageHeight: document.documentElement.scrollHeight,
  };
})()`);
console.log("07866 DOM:", JSON.stringify(facts, null, 1));

// Mark through the DOM: `:has(:text-matches())` is a Playwright locator form,
// not CSS, and the match here is ours to make anyway.
await page.evaluate(`(() => {
  for (const el of document.querySelectorAll("[data-contest-id]")) {
    if (el.dataset.couldGovern === "true") {
      el.style.outline = "5px solid #00b3ff";
      el.style.background = "rgba(0,179,255,.08)";
    } else {
      el.style.outline = "3px dashed #48d597";
    }
  }
})()`);

const shrink = Math.min(1, 12000 / facts.pageHeight);
await page.evaluate(`document.documentElement.style.zoom = "${shrink}"`);
await page.waitForTimeout(700);
await page.screenshot({ path: join(OUT, "1-ballot-07866-pills.png"), fullPage: true });
console.log(`1 · whole page at zoom ${shrink.toFixed(3)} (page was ${facts.pageHeight}px)`);

await page.evaluate(`document.documentElement.style.zoom = "1"`);
await page.waitForTimeout(400);

/** Scroll one contest into view by predicate and return its box. */
const boxFor = async (wantPill: boolean): Promise<Box> =>
  page.evaluate<Box>(`(() => {
    for (const el of document.querySelectorAll("[data-contest-id]")) {
      const isPilled = el.dataset.couldGovern === "true";
      if (isPilled !== ${wantPill}) continue;
      el.scrollIntoView({ block: "start" });
      const r = el.getBoundingClientRect();
      const h = el.querySelector("h2, h3");
      return { found: true, top: window.scrollY + r.top, height: r.height, heading: ((h && h.textContent) || "").replace(/\\s+/g, " ").trim() };
    }
    return { found: false };
  })()`);

const ambiguous = await boxFor(true);
console.log("ambiguous contest:", JSON.stringify(ambiguous));
if (ambiguous.found) {
  await page.waitForTimeout(400);
  await page.screenshot({
    path: join(OUT, "2-07866-ambiguous-has-pill.png"),
    clip: { x: 0, y: 0, width: 430, height: Math.min(1400, Math.ceil(ambiguous.height) + 100) },
  });
  console.log("2 · an AMBIGUOUS contest, full size — the pill should be readable");
}

const certain = await boxFor(false);
console.log("certain contest:", JSON.stringify(certain));
if (certain.found) {
  await page.waitForTimeout(400);
  await page.screenshot({
    path: join(OUT, "3-07866-certain-no-pill.png"),
    clip: { x: 0, y: 0, width: 430, height: Math.min(1400, Math.ceil(certain.height) + 100) },
  });
  console.log("3 · a CERTAIN contest, full size — there should be NO pill on it");
}

/* ── 4: RULING 74 — an address settles it, and nothing asks again ─────────── */

/*
 * The session scope is seeded directly rather than typed into the form. The
 * form's own path is guarded in the suite; what this capture is evidence FOR is
 * the RULING 74 half — that a scope the session already holds is read by the
 * surface rather than re-prompted for. Seeding is the honest way to photograph
 * that, and the seeded value is exactly what the form writes.
 */
const confirmed = await page.evaluate<string[]>(`(() => {
  const pilled = [...document.querySelectorAll("[data-contest-id]")].filter((s) => s.dataset.couldGovern === "true");
  return pilled.slice(0, 3).map((s) => s.dataset.contestId);
})()`);
console.log("seeding a session address that confirms:", JSON.stringify(confirmed));

const addressed = await browser.page({ viewport: { width: 430, height: 932 } });
await addressed.addInitScript(
  ({ ids }) => {
    try {
      sessionStorage.setItem(
        "wtp.session_address_scope",
        JSON.stringify({
          zip: "07866",
          contestIds: ids,
          streetLabel: "Main Street",
          resolvedAt: "2026-08-22T00:00:00.000Z",
        }),
      );
    } catch {
      /* Then the capture is honestly reported as NOT SHOWING the resolved state. */
    }
  },
  { ids: confirmed },
);
await addressed.goto(`${BASE}/ballot?zip=07866`, { waitUntil: "networkidle" });
await addressed.waitForTimeout(3000);

const after = await addressed.evaluate<{
  pilledNow: number;
  parked: number;
  scopedOut: number;
  bannerText: string;
  promptStillShowing: boolean;
}>(`(() => {
  const sections = [...document.querySelectorAll("[data-contest-id]")];
  const banner = document.querySelector(".ballot-narrowed");
  return {
    pilledNow: sections.filter((s) => s.dataset.couldGovern === "true").length,
    parked: sections.filter((s) => s.dataset.couldGovernParked === "true").length,
    scopedOut: sections.filter((s) => s.dataset.scopedOut === "true").length,
    bannerText: banner ? (banner.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 160) : "(no banner)",
    promptStillShowing: !!document.querySelector(".ballot-narrow-link, .ballot-narrow-form"),
  };
})()`);
console.log("07866 WITH a session address:", JSON.stringify(after, null, 1));

await addressed.evaluate(`(() => {
  const b = document.querySelector(".ballot-narrowed");
  if (b) { b.style.outline = "5px solid #48d597"; b.scrollIntoView({ block: "center" }); }
})()`);
await addressed.waitForTimeout(500);
await addressed.screenshot({ path: join(OUT, "4-07866-address-resolved.png") });
console.log("4 · 07866 with a session address — banner, no second prompt");

/* ── 5: 03255 must carry no pill at all ──────────────────────────────────── */

await page.goto(`${BASE}/ballot?zip=03255`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const nh = await page.evaluate<Counts>(`(() => ({
  cards: document.querySelectorAll(".candidate-row").length,
  contests: document.querySelectorAll("[data-contest-id]").length,
  pilled: [...document.querySelectorAll("[data-contest-id]")].filter((s) => s.dataset.couldGovern === "true").length,
  height: document.documentElement.scrollHeight,
}))()`);
console.log("03255 DOM:", JSON.stringify(nh));
const nhShrink = Math.min(1, 12000 / nh.height);
await page.evaluate(`document.documentElement.style.zoom = "${nhShrink}"`);
await page.waitForTimeout(700);
await page.screenshot({ path: join(OUT, "5-ballot-03255.png"), fullPage: true });
console.log(`5 · 03255 whole page at zoom ${nhShrink.toFixed(3)} — pilled contests: ${nh.pilled}`);

/* ── 6: the map entry, welcome overlay dismissed ─────────────────────────── */

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
    /* Then the capture is honestly reported as NOT showing the map. */
  }
}, { zip: "07866" });
await mapPage.goto(`${BASE}/`, { waitUntil: "networkidle" });
await mapPage.waitForTimeout(4500);
const mapFacts = await mapPage.evaluate<MapFacts>(`(() => ({
  welcomeStillUp: /Meanwhile/.test(document.body.innerText),
  canvases: document.querySelectorAll("canvas").length,
  firstWords: document.body.innerText.slice(0, 90).replace(/\\s+/g, " "),
}))()`);
console.log("map DOM:", JSON.stringify(mapFacts));
await mapPage.screenshot({ path: join(OUT, "6-map-07866.png") });
console.log("6 · map at 07866");

await browser.close();
console.log(`\nwritten to ${OUT}`);
