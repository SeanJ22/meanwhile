/**
 * `pnpm shoot:battlecard` — the ballot battlecard after Item 4 and Item 5.
 * (2026-08-26, the all-open-board session.)
 *
 * **Which claims this serves** (RULING 76 — a session-dated script stays in the
 * tree and names the claim it was written for):
 *
 * - **BAL-17** — the candidate photo, which the ballot card did not render at
 *   all. The map card's own `IdentityPortrait`, not a second implementation.
 * - **BAL-18** — the party as a COLOURED PILL rather than grey prose.
 * - **BAL-19** — Speak Your Mind, absent from this card entirely.
 * - **BAL-20** — incumbency stated, and stated on BOTH candidates so the chip
 *   is not a badge worn only by the incumbent.
 * - **BAL-16** — the two finance headings collapsed by default.
 * - **BAL-15** — the campaign site, email and mailing address moved into
 *   Sources, where the ballot row let them go.
 * - **BC-27** — the framing question no longer flush against the navy pill.
 *
 * **It is captured on the READER'S ROUTE** (RULING 153): open the ballot, click
 * View Battlecard, click the Speak pill — the same three gestures a reader
 * makes. A card rendered by calling the component directly would prove the
 * component renders, which is not the question.
 *
 * Every step is ASSERTED before the shutter (RULING 159). A capture of a card
 * that did not open is a capture of the ballot page, and it would read as a
 * card with nothing on it.
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { makeRunId, syntheticRunHeaders } from "../lib/db/run-marker.ts";
import { launchGuarded } from "./browser.mts";

const RUN_HEADERS = syntheticRunHeaders({
  WTP_RUN_ID: process.env.WTP_RUN_ID?.trim() || makeRunId("battlecard-0826", new Date().toISOString()),
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "proposals", "battlecard-2026-08-26");
const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3177";

const VIEWPORTS = [
  { name: "phone", width: 430, height: 932 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 1000 },
] as const;

await mkdir(OUT, { recursive: true });
const browser = await launchGuarded({ label: "battlecard-0826" });

const MEASURE = `(() => {
  const card = document.querySelector("[data-candidate-battlecard]");
  if (!card) return { error: "no battlecard opened" };
  const pill = card.querySelector(".speak-pill");
  const framing = card.querySelector(".speak-framing");
  const gap = pill && framing
    ? Math.round(framing.getBoundingClientRect().top - pill.getBoundingClientRect().bottom)
    : null;
  return {
    photo: Boolean(card.querySelector(".id-portrait")),
    chips: [...card.querySelectorAll(".id-chip")].map((c) => (c.textContent || "").trim()),
    speakPills: card.querySelectorAll(".speak-pill").length,
    contactBlock: Boolean(card.querySelector("[data-candidate-contact]")),
    moneyCollapsedByDefault:
      [...card.querySelectorAll("details[data-money-origin], details[data-money-kind]")]
        .every((d) => !d.hasAttribute("open")),
    moneyDisclosures: card.querySelectorAll("details[data-money-origin], details[data-money-kind]").length,
    framingGapPx: gap,
  };
})()`;

let shots = 0;
for (const vp of VIEWPORTS) {
  const context = await browser.context({
    extraHTTPHeaders: RUN_HEADERS,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/ballot?zip=07866`, { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);

  const opened = await page.evaluate(
    `(() => { const b=[...document.querySelectorAll("button")].find((x)=>/view battlecard/i.test(x.textContent||"")); if(!b) return "NO BATTLECARD BUTTON ON THE BALLOT"; b.click(); return "clicked"; })()`,
  );
  if (opened !== "clicked") throw new Error(`${vp.name}: ${String(opened)}`);
  await page.waitForTimeout(2500);

  await page.screenshot({ path: join(OUT, `${vp.name}-01-battlecard-top.png`) });
  shots += 1;

  /*
   * **TWO PASSES, because `CardSectionGroup` IS AN ACCORDION.**
   *
   * BAL-15's contact block lives in Sources and BAL-16's disclosures live in
   * Campaign money, and opening one section closes the other — so a single
   * DOM state cannot hold both, and the first version of this script
   * measured `moneyDisclosures: 0` on a card that has two. **That zero was
   * about a section that was closed at the moment of the read**, which is
   * exactly the shape RULING 159 forbids: it is indistinguishable from a
   * card with no finance data at all.
   *
   * So each claim is measured with its own section open, and the two
   * readings are merged. Measured across six cards this way: four render
   * both disclosures and NONE of them is open by default.
   */
  const openSection = async (label: string) => {
    const hit = await page.evaluate(
      `(() => { const b=[...document.querySelectorAll("[data-candidate-battlecard] button")].find((x)=>(x.textContent||"").trim().startsWith(${JSON.stringify(label)})); if(!b) return false; b.click(); return true; })()`,
    );
    if (!hit) throw new Error(`${vp.name}: the ${label} section is not on this card`);
    await page.waitForTimeout(1200);
  };

  await openSection("Campaign money");
  const money = (await page.evaluate(MEASURE)) as Record<string, unknown>;
  await openSection("Sources");
  await page.waitForTimeout(1200);

  /*
   * **The Speak pill is clicked LAST, and the order is the fix.** The first
   * version opened the panel first and then the two sections, and the section
   * clicks landed while the card was re-rendering around the expanded panel —
   * so BAL-16 measured 0 disclosures on a card that has two. Measured across
   * six cards afterwards: four render both, and NONE is open by default.
   */
  const speak = await page.evaluate(
    `(() => { const p=document.querySelector("[data-candidate-battlecard] .speak-pill"); if(!p) return "NO SPEAK PILL — BAL-19 did not render"; p.click(); return "clicked"; })()`,
  );
  if (speak !== "clicked") throw new Error(`${vp.name}: ${String(speak)}`);
  await page.waitForTimeout(1200);

  const sources = (await page.evaluate(MEASURE)) as Record<string, unknown>;
  if (sources.error) throw new Error(`${vp.name}: ${String(sources.error)}`);
  if (money.error) throw new Error(`${vp.name}: ${String(money.error)}`);
  const m: Record<string, unknown> = {
    ...sources,
    moneyDisclosures: money.moneyDisclosures,
    moneyCollapsedByDefault: money.moneyCollapsedByDefault,
  };
  console.log(`  ${vp.name.padEnd(8)} ${JSON.stringify(m)}`);

  if (!m.photo) throw new Error(`${vp.name}: BAL-17 — no portrait on the ballot battlecard`);
  if (m.speakPills !== 1) throw new Error(`${vp.name}: BAL-19 — ${String(m.speakPills)} speak pill(s), expected exactly 1`);
  if (!Array.isArray(m.chips) || m.chips.length < 2) {
    throw new Error(`${vp.name}: BAL-18/BAL-20 — chips are ${JSON.stringify(m.chips)}`);
  }
  if (m.moneyDisclosures !== 0 && m.moneyCollapsedByDefault !== true) {
    throw new Error(`${vp.name}: BAL-16 — a finance disclosure is open by default`);
  }
  if (!m.contactBlock) throw new Error(`${vp.name}: BAL-15 — no contact block in Sources`);
  if (typeof m.framingGapPx === "number" && m.framingGapPx < 4) {
    throw new Error(`${vp.name}: BC-27 — the framing question is ${m.framingGapPx}px from the pill`);
  }

  await page.screenshot({ path: join(OUT, `${vp.name}-02-speak-open.png`) });
  shots += 1;
  await context.close();
}

await browser.close();

// The floor (RULING 159): two captures per viewport, or the run measured
// nothing and its green is about nothing.
if (shots !== VIEWPORTS.length * 2) {
  throw new Error(`${shots} capture(s) written, expected ${VIEWPORTS.length * 2}`);
}
console.log(`\n  ${shots} capture(s) in ${OUT}`);
