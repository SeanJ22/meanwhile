/**
 * Asks a question the way a reader does: types into `[data-ask-box]`, presses
 * Enter, and reads the answer rendered in `[data-ask-grounded]`. It never posts
 * to `/api/ask/grounded`, so it sees what the map surface actually calls.
 *
 * It waits for the rendered answer to settle rather than for a fixed time; the
 * ceiling is reported as a wall, never as a verdict.
 */

import type { Page } from "playwright";

import { seedZip, type GuardedBrowser } from "./browser.mts";

export interface RenderedAnswer {
  readonly mode: string | null;
  readonly subjectId: string | null;
  readonly subjectName: string | null;
  readonly answerText: string | null;
  readonly recordTexts: readonly string[];
  readonly gapAttributions: readonly string[];
  readonly gapStatements: readonly string[];
  readonly sourceCount: number;
  /** No grounded block rendered at all, as opposed to one that says nothing is held. */
  readonly panelAbsent: boolean;
}

export const ANSWER_CEILING_MS = 45_000;

/** How long the rendered answer must stay unchanged before it counts as settled. */
const SETTLE_MS = 900;
const POLL_MS = 250;

/* An expression, not a named function: tsx wraps named functions in a
   `__name` helper the page does not have. */
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
  /* The answer is the top-level paragraph that is not the subject, a state,
     a gap or the source line; read structurally, not by index. */
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

/** Opens the product at a ZIP and clicks the Ask pill until the input renders. */
export async function openAskAt(browser: GuardedBrowser, base: string, zip: string): Promise<Page> {
  const page = await browser.page();
  await seedZip(page, zip);
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90_000 });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if ((await page.locator("[data-ask-box]").count()) > 0) return page;
    const pill = page.locator("[data-ask-pill]").first();
    if ((await pill.count()) > 0) {
      await pill.click().catch(() => {});
    }
    await page.waitForTimeout(POLL_MS);
  }
  return page;
}

/**
 * Submits one question and reads the settled answer. The previous answer is
 * captured first so a second question cannot read the first one's answer.
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
