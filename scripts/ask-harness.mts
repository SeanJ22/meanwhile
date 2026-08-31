/**
 * **ASKING THE QUESTION THE WAY A READER ASKS IT.** (A.1 WI1, 2026-08-30.)
 *
 * One implementation, shared by `scripts/reader-suite.mts` and
 * `scripts/control-set.mts` (RULING 103: the shared code path, never two
 * copies). Both harnesses need the SAME thing — seed a ZIP, open the product,
 * type a question into the real input, press the real button, wait for a
 * rendered answer, and read it — and the control harness needs it to be
 * SHAPE-IDENTICAL to the reader path or the controls measure a different
 * pipeline than the one they are grading (RULING 211).
 *
 * ## What "the product's own Ask interaction" means, precisely
 *
 * `[data-ask-box]` is the input a reader types in. `Enter` is what a reader
 * presses. `[data-ask-grounded]` is the block the panel renders its answer
 * into. Nothing here posts to `/api/ask/grounded` directly, and that is the
 * whole point: PR #212 shipped a correct grounded engine that the map surface
 * did not call, and every API-level test passed while readers met a different
 * engine. A harness that talks to the route cannot see that class of defect.
 *
 * ## Waiting on a CONDITION, never a clock
 *
 * `walk-ask-0828.mts` waits `25_000`ms after every submission because the
 * panel holds a drawn 2.4–3.1s presentation beat and the engine takes as long
 * as it takes. A fixed sleep is wrong in both directions: it wastes twenty
 * seconds on a fast answer and truncates a slow one into a false RED.
 *
 * So this waits for the ANSWER to settle — the grounded block present, and
 * its rendered text unchanged across two consecutive polls — with a ceiling
 * that is a WALL, not a verdict. A timeout returns `panelAbsent` or the
 * partial read with the mode it actually saw, and the evaluator classifies it.
 * A wall is reported as a wall.
 */

import type { Page } from "playwright";

import type { RenderedAnswer } from "../lib/health/ask-evaluation.ts";

import { seedZip, type GuardedBrowser } from "./browser.mts";

/** The ceiling on one answer. A wall, never a verdict — see the header. */
export const ANSWER_CEILING_MS = 45_000;

/** How long the rendered answer must stay unchanged before it counts as settled. */
const SETTLE_MS = 900;
const POLL_MS = 250;

/**
 * The read, expressed as one page-side expression.
 *
 * Expression-shaped on purpose: `tsx`'s esbuild transform wraps named
 * functions in a `__name` helper the page does not have, and a harness that
 * throws inside `evaluate` reports as a product failure.
 */
const READ_ANSWER = `(function () {
  var g = document.querySelector("[data-ask-grounded]");
  if (!g) {
    return {
      mode: null, subjectId: null, subjectName: null, answerText: null,
      recordTexts: [], gapAttributions: [], gapStatements: [],
      sourceCount: 0, panelAbsent: true
    };
  }
  var paragraphs = Array.prototype.slice.call(g.querySelectorAll(":scope > p"));
  var stateEls = Array.prototype.slice.call(g.querySelectorAll("[data-ask-grounded-state], [data-ask-state]"));
  var gapEls = Array.prototype.slice.call(g.querySelectorAll("[data-ask-gap]"));
  var sourceEl = g.querySelector("[data-ask-sources]");
  var subjectEl = g.querySelector(":scope > p.font-semibold");
  var records = Array.prototype.slice.call(g.querySelectorAll(":scope > ul > li")).map(function (li) {
    return (li.innerText || "").trim();
  });
  /* The validated sentence is the one top-level paragraph that is neither the
     subject line, nor a mode statement, nor a gap, nor the source line. Read
     structurally rather than by index: a new paragraph added above it would
     silently shift a positional read onto the wrong text. */
  var excluded = stateEls.concat(gapEls);
  if (sourceEl) excluded.push(sourceEl);
  if (subjectEl) excluded.push(subjectEl);
  var answerText = null;
  for (var i = 0; i < paragraphs.length; i++) {
    if (excluded.indexOf(paragraphs[i]) === -1) {
      var t = (paragraphs[i].innerText || "").trim();
      if (t) { answerText = t; break; }
    }
  }
  return {
    mode: g.getAttribute("data-ask-grounded-mode"),
    subjectId: g.getAttribute("data-ask-grounded-subject"),
    subjectName: subjectEl ? (subjectEl.innerText || "").trim() : null,
    answerText: answerText,
    recordTexts: records,
    gapAttributions: gapEls.map(function (e) { return e.getAttribute("data-ask-gap"); }),
    gapStatements: gapEls.map(function (e) { return (e.innerText || "").trim(); }),
    sourceCount: sourceEl ? Number(sourceEl.getAttribute("data-ask-sources")) || 0 : 0,
    panelAbsent: false
  };
})()`;

/** What the harness observed, plus the wall when one stopped it. */
export interface AskObservation {
  readonly answer: RenderedAnswer;
  /** Milliseconds from submit to a settled answer. */
  readonly elapsedMs: number;
  /** The wall, named, when the ceiling was reached. Null on a settled read. */
  readonly wall: string | null;
}

const ABSENT: RenderedAnswer = {
  mode: null,
  subjectId: null,
  subjectName: null,
  answerText: null,
  recordTexts: [],
  gapAttributions: [],
  gapStatements: [],
  sourceCount: 0,
  panelAbsent: true,
};

/**
 * Open the product at a ZIP with the Ask panel reachable.
 *
 * The panel lives behind a pill on the map shell, exactly as `walk-all.mts`
 * and `walk-ask-0828.mts` reach it. A harness that could not find the input
 * would be measuring its own selector rather than the product, so a missing
 * input is reported as a wall by the caller rather than swallowed here.
 */
export async function openAskAt(browser: GuardedBrowser, base: string, zip: string): Promise<Page> {
  const page = await browser.page();
  await seedZip(page, zip);
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90_000 });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if ((await page.locator("[data-ask-box]").count()) > 0) return page;
    const pill = page.locator("[data-ask-pill]").first();
    if ((await pill.count()) > 0) {
      await pill.click().catch(() => {
        /* A pill that is present but not yet interactive is a timing fact, not
           a failure: the loop re-reads it on the next pass. */
      });
    }
    await page.waitForTimeout(POLL_MS);
  }
  return page;
}

/**
 * Submit one question through the product and read the answer it renders.
 *
 * The previous answer's text is captured BEFORE submitting so a second
 * question on the same page cannot read the first question's answer and call
 * it settled — the failure mode that makes a batch of questions all agree.
 */
export async function askAndRead(page: Page, questionText: string): Promise<AskObservation> {
  const input = page.locator("[data-ask-box]").first();
  if ((await input.count()) === 0) {
    return {
      answer: ABSENT,
      elapsedMs: 0,
      wall: "the Ask input [data-ask-box] never rendered — the panel could not be reached",
    };
  }

  const before = (await page.evaluate(READ_ANSWER)) as RenderedAnswer;
  const beforeKey = JSON.stringify([before.answerText, before.recordTexts, before.mode]);

  await input.click();
  await input.fill(questionText);
  await input.press("Enter");

  const startedAt = Date.now();
  const deadline = startedAt + ANSWER_CEILING_MS;
  let stableSince: number | null = null;
  let stableKey: string | null = null;
  let latest: RenderedAnswer = ABSENT;

  while (Date.now() < deadline) {
    await page.waitForTimeout(POLL_MS);
    latest = (await page.evaluate(READ_ANSWER)) as RenderedAnswer;
    const key = JSON.stringify([latest.answerText, latest.recordTexts, latest.mode]);
    /* Still showing the previous question's answer, or nothing yet. Neither is
       a settled state, and treating either as one is how a batch of questions
       comes back with one answer repeated. */
    if (latest.panelAbsent || key === beforeKey) {
      stableSince = null;
      stableKey = null;
      continue;
    }
    if (key !== stableKey) {
      stableKey = key;
      stableSince = Date.now();
      continue;
    }
    if (stableSince !== null && Date.now() - stableSince >= SETTLE_MS) {
      return { answer: latest, elapsedMs: Date.now() - startedAt, wall: null };
    }
  }

  return {
    answer: latest,
    elapsedMs: Date.now() - startedAt,
    wall:
      `no settled answer within ${ANSWER_CEILING_MS}ms of submitting the question. This is a ` +
      "failed observation with the wall named — never an empty answer, and never a green.",
  };
}
