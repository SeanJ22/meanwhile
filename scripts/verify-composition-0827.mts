/**
 * `pnpm verify:composition` — WHAT THE READER ACTUALLY GETS, on the bodies the
 * author's 2026-08-27 visual review caught.
 *
 * ## Why this exists as a command rather than as a one-off capture
 *
 * The composition repair (Red Controls 2 and 3) is a claim about the LAST of
 * the four layers — what reaches a reader — and the first three can all agree
 * while that one is wrong. `tests/body-composition.test.ts` proves the resolver;
 * this proves the page. They are different facts, and RULING 125 says the
 * verification target is the LOCAL PRODUCTION BUILD, so this drives `next start`
 * and never `next dev`.
 *
 * It reports what it observed and does not decide whether that is acceptable —
 * the expected roster comes from each body's own publication, quoted in
 * `lib/registry/body-membership.ts`, and is restated here so a reader of the
 * output can check the comparison rather than trust it.
 *
 * Usage:
 *   pnpm verify:composition                      # against http://localhost:3100
 *   SHOOT_BASE_URL=http://localhost:3100 pnpm verify:composition
 */

import { floored, floorLine } from "../lib/ops/denominator-floor.ts";

import { launchGuarded, seedZip } from "./browser.mts";

const BASE = (process.env.SHOOT_BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) {
  /*
   * RULING 125's other half. This walk OPENS BODY CARDS, and every
   * `/api/meetings` GET writes a search-log row; pointing it at production
   * would put synthetic rows in the store that is sold. The run is declared
   * either way (`launchGuarded`), and refusing a non-local target as well is
   * belt and braces on the one mistake that cannot be undone.
   */
  console.error(`verify:composition targets a LOCAL production build. Refusing ${BASE}.`);
  process.exit(2);
}

/** What each body's own publisher says, and what the app used to show instead. */
const SUBJECTS = [
  {
    zip: "85701",
    name: "Central Arizona Water Conservation District Board of Directors",
    expectation:
      "15 popularly elected members (10 Maricopa, 4 Pima, 1 Pinal), president Terry Goddard — " +
      "https://www.cap-az.com/board/board-members/ read 2026-08-27",
    mustNotShow: ["Rex Scott", "Matt Heinz", "Jennifer Allen", "Steve Christy", "Andrés Cano"],
    /*
     * **THE POSITIVE HALF, ADDED 2026-08-27 WHEN THE ROSTER WAS WIRED.**
     *
     * This was empty, and correctly so: the repair had removed five wrong
     * people and the right fifteen were not yet collected, so there was
     * nothing true to require. A check that only ever asserts an ABSENCE
     * passes just as happily when a body renders nobody at all — which is
     * exactly the state CAWCD was in, and exactly the state it must not
     * silently return to.
     *
     * The three officers are named because their roles are published on the
     * district's own pages and are the part most likely to drift: a board
     * re-elects its officers annually.
     */
    mustShow: ["Terry Goddard", "Alexandra Arboleda", "Karen Cesare"] as string[],
    wasShowing: "the five Pima County Supervisors, with 'Jennifer Allen — Presides'",
  },
  {
    zip: "85701",
    name: "Public Housing Authority Board of Commissioners",
    expectation:
      "the Mayor and Council AND a Resident Appointee (Trystan Hawkins) — City of Tucson agenda " +
      "2026-02-18 and the City's HCD newsroom, both read 2026-08-27",
    mustNotShow: [],
    mustShow: ["Regina Romero", "Trystan Hawkins", "Resident Appointee"],
    wasShowing: "seven Mayor/Council members reached through the division fallback, no resident seat",
  },
  {
    zip: "85701",
    name: "Planning Commission (PC)",
    expectation: "an appointed citizen commission; this repository has not sourced its membership",
    mustNotShow: ["Regina Romero", "Lane Santa Cruz", "Paul Cunningham", "Kevin Dahl"],
    mustShow: [] as string[],
    wasShowing: "the Mayor and the six Council Members, as did 57 other Tucson boards",
  },
];

const browser = await launchGuarded({ label: "verify-composition-0827", headless: true });
console.log(`run id ${browser.runId}  ·  base ${BASE}\n`);

/*
 * **THREE OUTCOMES, COUNTED SEPARATELY.**
 *
 * The first version of this script collapsed NOT_REACHED into the failure
 * count and printed "3 still showing inherited members" over three cards it
 * had never opened. That is the reporting defect this whole session is about,
 * committed by the instrument built to catch it: an operation that can return
 * nothing must be asked what it returned, and "I could not find the card" is
 * not "the card is wrong".
 */
const results: { subject: string; outcome: "CLEAN" | "DEFECT" | "NOT_REACHED"; detail: string }[] = [];

/*
 * **THE ASK BOX, WHICH IS HOW A READER REACHES A BODY CARD.**
 *
 * The first attempt clicked the body's name wherever it appeared in the DOM and
 * reported all three subjects unreachable. They were all present — as
 * `<option>` elements inside the `.scope-select` meeting filter, 0×0 and never
 * visible. A walk that matches text anywhere will eventually match something
 * that is not the thing, and then it reports confidently about a control the
 * reader never sees. `scripts/walk-all.mts` already proved the real route
 * (g15/M135), and this uses the same selectors rather than a fourth guess.
 */
const AC_ROW = ".search-ac-item";

async function openBodyCard(
  page: Awaited<ReturnType<typeof browser.page>>,
  bodyName: string,
): Promise<{ opened: boolean; why: string }> {
  const minimize = page.locator(".coverage-notice button[aria-label^='Minimize']").first();
  if ((await minimize.count()) > 0) {
    await minimize.click().catch(() => {});
    await page.locator(".coverage-notice").waitFor({ state: "detached", timeout: 6000 }).catch(() => {});
  }
  if ((await page.locator("[data-ask-panel]").count()) === 0) {
    await page.locator("[data-ask-pill]").first().click().catch(() => {});
    await page.locator("[data-ask-panel]").first().waitFor({ state: "visible", timeout: 6000 }).catch(() => {});
  }

  const input = page.locator("[data-ask-box]").first();
  if ((await input.count()) === 0) return { opened: false, why: "no ask box on this surface" };

  /* Type enough of the name to narrow, then match the row by its own label. */
  /* TWO words, not three. "Planning Commission (PC)" sliced to three words
   * still carries the parenthesised abbreviation, which the index does not
   * hold, and the autocomplete correctly offered nothing — a query defect
   * reported as an absent body. */
  await input.fill(bodyName.split(" ").slice(0, 2).join(" "));
  await page.locator(AC_ROW).first().waitFor({ state: "visible", timeout: 12_000 }).catch(() => {});
  await page.waitForTimeout(800);

  const rows = page.locator(AC_ROW, { has: page.locator(".search-ac-type", { hasText: /^Body$/ }) });
  const n = await rows.count();
  if (n === 0) return { opened: false, why: "the autocomplete offered no Body row for this name" };

  for (let i = 0; i < n; i += 1) {
    const label = (await rows.nth(i).locator(".search-ac-name").innerText().catch(() => "")).trim();
    /*
     * The registry name and the card label are not always the same string.
     * The registry holds "Planning Commission (PC)" — the abbreviation is part
     * of the Tucson City Clerk's own directory entry — and the card renders
     * "Planning Commission". Matching on the parenthesised form found nothing
     * and the walk reported the body unreachable, which is a claim about the
     * app made by a defect in the query.
     */
    const key = bodyName.toLowerCase().replace(/\s*\([^)]*\)/g, "").trim();
    if (!label.toLowerCase().includes(key.slice(0, 20))) continue;
    await rows.nth(i).click();
    const card = page.locator(".account-modal").first();
    const ok = await card.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
    return ok ? { opened: true, why: "" } : { opened: false, why: `row "${label}" opened no card` };
  }
  const labels: string[] = [];
  for (let i = 0; i < n; i += 1) labels.push((await rows.nth(i).locator(".search-ac-name").innerText().catch(() => "?")).trim());
  /* NAME what WAS offered. "no match" with no list is an unfalsifiable report. */
  return { opened: false, why: `${n} Body row(s) offered, none matching: ${labels.join(" | ")}` };
}

/**
 * The second route to a body card: the sidebar's **Bodies here** door.
 *
 * The ask box does not offer every body — CAWCD is absent from its
 * autocomplete at both Pima zips and IS listed in this door, which the first
 * version of this script had no way to discover and therefore reported as
 * "not reached" over a card sitting one click away. **One failed route is not
 * an absence** (RULING 184), and the correct response to a route that did not
 * answer is another route, not a verdict.
 */
async function openViaBodiesDoor(
  page: Awaited<ReturnType<typeof browser.page>>,
  bodyName: string,
): Promise<{ opened: boolean; why: string }> {
  const door = page.locator("button", { hasText: /Bodies here/ }).first();
  if ((await door.count()) === 0) return { opened: false, why: "no Bodies door on this surface" };
  await door.click({ timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const key = bodyName.toLowerCase().replace(/\s*\([^)]*\)/g, "").trim().slice(0, 20);
  const row = page.locator(".door-panel li").filter({ hasText: new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).first();
  if ((await row.count()) === 0) return { opened: false, why: "the Bodies door lists no row for this name" };
  await row.click({ timeout: 10_000 }).catch(() => {});
  const card = page.locator(".account-modal").first();
  const ok = await card.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  return ok ? { opened: true, why: "" } : { opened: false, why: "the Bodies door row opened no card" };
}

for (const subject of SUBJECTS) {
  const page = await browser.page({ viewport: { width: 1280, height: 900 } });
  await seedZip(page, subject.zip);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(6000);

  console.log(`SUBJECT  ${subject.name}   (zip ${subject.zip})`);
  console.log(`  expected   ${subject.expectation}`);
  console.log(`  was        ${subject.wasShowing}`);

  let { opened, why } = await openBodyCard(page, subject.name);
  if (!opened) {
    /* Second route, before any verdict. */
    const door = await openViaBodiesDoor(page, subject.name);
    if (door.opened) { opened = true; why = ""; }
    else why = `ask box: ${why}; bodies door: ${door.why}`;
  }

  if (!opened) {
    console.log(`  NOT REACHED  ${why}.`);
    console.log("               A finding about this WALK. It is not evidence about the body.\n");
    results.push({ subject: subject.name, outcome: "NOT_REACHED", detail: why });
    await page.context().close();
    continue;
  }

  /* **EXPAND "Who sits on it" FIRST.** The card ships its sections collapsed,
   * so the modal's innerText holds the section HEADINGS and none of the names.
   * The first run of this script read the collapsed card and reported the Mayor
   * ABSENT from a board she sits on — a false negative produced by not opening
   * the drawer, which would have been a fabricated finding either way. */
  const drawer = page.locator(".account-modal").getByText("Who sits on it", { exact: false }).first();
  if ((await drawer.count()) > 0) {
    await drawer.scrollIntoViewIfNeeded().catch(() => {});
    await drawer.click({ timeout: 10_000 }).catch(() => {});
  }
  await page.waitForTimeout(1800);
  /* Read the CARD, not the page: the body name also appears in the meeting
   * scope filter, and reading document.body would let the filter satisfy a
   * check about the card. */
  const text = await page.locator(".account-modal").first().innerText();

  /* Case-insensitive: the card renders an office title in small caps, so the
   * DOM carries "Resident Appointee" while a case-sensitive check on the
   * rendered string can miss it. A styling difference is not a missing seat. */
  const haystack = text.toLowerCase();
  const missing = (subject.mustShow ?? []).filter((n) => !haystack.includes(n.toLowerCase()));
  if (missing.length > 0) console.log(`  MISSING    ${missing.join(", ")}  <- expected on the card and absent`);
  const wrongly = [...subject.mustNotShow.filter((n) => text.includes(n)), ...missing.map((m) => `(missing) ${m}`)];
  if (wrongly.length > 0) {
    console.log(`  RENDERED   ${wrongly.join(", ")}  <- INTEGRITY DEFECT, still present`);
    results.push({ subject: subject.name, outcome: "DEFECT", detail: wrongly.join(", ") });
  } else {
    /*
     * **SAY WHAT WAS FOUND, NOT ONLY WHAT WAS ABSENT** (2026-08-27).
     *
     * This printed "none of the inherited names" and stopped, which describes
     * only the negative half — and a body rendering NOBODY passes that
     * sentence exactly as well as a body rendering the right people. CAWCD was
     * in precisely that state for part of today, so the distinction is not
     * hypothetical. Where a subject names people it must show, the count is
     * stated; where it names none, the line says so rather than implying a
     * positive that was never checked.
     */
    const required = subject.mustShow ?? [];
    console.log(
      required.length > 0
        ? `  rendered   none of the inherited names, and all ${required.length} required name(s) present: ${required.join(", ")}`
        : `  rendered   none of the inherited names (no required names are declared for this subject, so nothing positive was checked)`,
    );
    results.push({ subject: subject.name, outcome: "CLEAN", detail: "" });
  }
  console.log("");

  await page.context().close();
}

await browser.close();

const by = (o: string) => results.filter((r) => r.outcome === o);
const opened = results.length - by("NOT_REACHED").length;

/*
 * **RULING 159 — every count against its own denominator.**
 *
 * "2 clean" answers nothing on its own: two of how many, and how many of the
 * rest were never opened at all? The three ratios below are the three
 * questions this walk can actually answer, and the third is the one a summary
 * line most wants to drop. A subject the walk could not reach is not evidence
 * either way, and folding it into a pass count is exactly the reporting defect
 * this session exists to remove.
 */
console.log("");
for (const line of [
  floored("opened by the reader route", "the subjects walked", results.length, opened),
  opened > 0
    ? floored("free of inherited members", "the cards actually opened", opened, by("CLEAN").length)
    : floored(
        "free of inherited members",
        "the cards actually opened",
        0,
        0,
        "no card was opened, so nothing was observed about any of them",
      ),
  floored("NOT REACHED by this route", "the subjects walked", results.length, by("NOT_REACHED").length),
]) {
  console.log(`  ${floorLine(line)}`);
}

for (const r of by("DEFECT")) console.log(`  DEFECT       ${r.subject} — ${r.detail}`);
for (const r of by("NOT_REACHED")) console.log(`  NOT REACHED  ${r.subject} — ${r.detail}`);

/* A defect fails. A card the walk could not reach fails too — but as an
 * unfinished verification, which the lines above name, never as a clean pass. */
process.exit(by("DEFECT").length + by("NOT_REACHED").length === 0 ? 0 : 1);
