/**
 * DOM VERIFICATION for ASK-20, ASK-22 and ASK-24.
 * (Session B closure, 2026-08-31.)
 *
 * ```
 *   ASK-20  an answer naming a meeting date carries Add to calendar
 *   ASK-24  a day with two sittings carries a control for BOTH
 *   ASK-22  the Meetings pill opens the list FOCUSED on the answer's body,
 *           and the focus is visible and clearable
 * ```
 *
 * Driven through `launchGuarded` so the run declares itself and the walk's rows
 * do not land in the sold store as reader signal.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { launchGuarded, seedZip } from "./browser.mts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

const BASE = (process.env.SHOOT_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const OUT = join(process.cwd(), "data", "health", "ask-controls-walk");
/*
 * Phrased to hit BOTH halves at once: it names the body, so the grounded
 * engine binds a subject and resolves its sittings (ASK-20/24), and it carries
 * "next meeting", which is a curated phrase for the meetings destination whose
 * action is LIST_OPEN (ASK-22). A question that produced no destination pill
 * could not exercise the routing at all.
 */
const QUESTION = "When is the next meeting of the Pima County Board of Supervisors?";

const guarded = await launchGuarded({ label: "ask-controls" });
const checks: { id: string; claim: string; passed: boolean; detail: string }[] = [];
const check = (id: string, claim: string, passed: boolean, detail: string): void => {
  checks.push({ id, claim, passed, detail });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${id}  ${claim}`);
  console.log(`        ${detail}`);
};

try {
  const context = await guarded.context();
  const page = await context.newPage();
  await seedZip(page, "85701");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);

  /* The Ask box is behind a pill on the map entry; it is not on the page at
     load. A walk that typed without opening it would time out on a selector
     and prove nothing about the controls. */
  const opener = page.locator("[data-ask-pill]").first();
  if ((await opener.count()) > 0) {
    await opener.click();
    await page.waitForTimeout(1200);
  }
  const box = page.locator("[data-ask-box]").first();
  await box.fill(QUESTION);
  await box.press("Enter");
  /* The grounded engine calls a model; this is a real wait, not a paint wait. */
  await page.waitForSelector("[data-ask-grounded-mode]", { timeout: 120_000 });
  await page.waitForTimeout(2500);

  const mode = await page.getAttribute("[data-ask-grounded-mode]", "data-ask-grounded-mode");
  const subject = await page.getAttribute("[data-ask-grounded-subject]", "data-ask-grounded-subject");

  /* ---------------------------------------------------------- ASK-20/24 --- */
  const calendarBlocks = await page.locator("[data-ask-calendar]").count();
  const addToCalendar = await page
    .locator('[data-ask-calendar] a, [data-ask-calendar] button, [data-ask-calendar] details')
    .count();

  check(
    "ASK-20",
    "an Ask answer naming a meeting carries the Add to calendar control",
    calendarBlocks > 0 && addToCalendar > 0,
    `mode ${mode}, subject ${subject}; ${calendarBlocks} calendar block(s) with ` +
      `${addToCalendar} control element(s). Before this the answer described the meeting and ` +
      "offered nothing to do with it, while the map card beside it offered both.",
  );

  const calendarText = await page.locator("[data-ask-calendar]").innerText().catch(() => "");
  const sittingsOffered = (calendarText.match(/calendar/gi) ?? []).length;
  check(
    "ASK-24",
    "a day with two sittings offers a control for BOTH",
    sittingsOffered >= 2,
    `${sittingsOffered} calendar offer(s) rendered. The Board sits at 1 p.m. and again at ` +
      "5 p.m.; a reader given one entry for a two-sitting day gets the wrong afternoon half " +
      "the time.",
  );

  /* ------------------------------------------------------------- ASK-22 --- */
  const pill = page.locator("[data-ask-destination-go]").first();
  const pillPresent = (await pill.count()) > 0;
  let focusChip = 0;
  let focusText = "";
  if (pillPresent) {
    await pill.click();
    await page.waitForTimeout(2000);
    focusChip = await page.locator("[data-list-focus-clear]").count();
    focusText = await page
      .locator("[data-list-focus-clear]")
      .innerText()
      .catch(() => "");
  }
  check(
    "ASK-22",
    "the Meetings pill opens the list FOCUSED on the answer's body, visibly and clearably",
    pillPresent && focusChip > 0,
    pillPresent
      ? `focus chip: ${JSON.stringify(focusText)}. The pill used to dispatch a generic open ` +
        "with no subject, so a reader answered about one body got every meeting in the ZIP."
      : "no destination pill rendered for this answer, so the routing could not be exercised",
  );

  /* ------------------------------------------------------------- ASK-23 --- */
  /*
   * The owner reported ASK-22 and ASK-23 as one root: no subject reached the
   * surface the pill opened, so it sorted by date across every body. With the
   * focus applied the list holds that body's sittings, upcoming-first — so the
   * FIRST row is that body's next meeting. Checked rather than assumed,
   * because "one fix serves both" is a claim about behaviour.
   */
  /*
   * The overlay opens with every group COLLAPSED (g4 item 11), so `.al-row` is
   * empty until they are expanded. A count taken before this reads 0 rows and
   * would fail — or, worse, pass a "nothing from another body" assertion over
   * nothing at all.
   */
  const heads = page.locator(".al-group-head");
  const groupCount = await heads.count();
  for (let i = 0; i < groupCount; i += 1) {
    await heads.nth(i).click().catch(() => undefined);
  }
  await page.waitForTimeout(1200);

  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".al-row")).map((r) => (r.textContent ?? "").trim()),
  );
  const offBody = rows.filter((t) => !/Board of Supervisors|Supervisors/i.test(t));
  check(
    "ASK-23",
    "the focused list leads with that body and holds nothing else",
    rows.length > 0 && offBody.length === 0,
    `${rows.length} row(s) rendered; ${offBody.length} name another body. Unfocused this sorted ` +
      "by date across all 149 meetings in the ZIP, so the answer's own body sat wherever the " +
      "calendar put it." +
      (offBody.length > 0 ? ` First stray: ${JSON.stringify(offBody[0].slice(0, 80))}` : ""),
  );

  await context.close();
} finally {
  await guarded.close();
}

const passed = checks.filter((c) => c.passed).length;
console.log(
  `\n  ${floorLine(
    floored("check(s) PASSED", "the checks this walk ran", checks.length, passed, undefined),
  )}`,
);

mkdirSync(OUT, { recursive: true });
const path = join(OUT, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(
  path,
  `${JSON.stringify({ at: new Date().toISOString(), base: BASE, question: QUESTION, checks }, null, 2)}\n`,
  "utf8",
);
console.log(`  record: ${path}`);
if (passed !== checks.length) process.exit(1);
