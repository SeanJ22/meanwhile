/**
 * **THE SEEDED FAILURES FOR THE CONTROL AND VISUAL HALVES.** (A.1 WI4.)
 *
 * The audit findings:
 *
 * 1. The control runner scored a SIMULATED result set. With real owner
 *    controls it reported "no audit has produced observations yet" and
 *    `score: null` — so the truth contract had a validated answer key and no
 *    measurement of anything.
 * 2. Nothing loaded a `VisualAcceptanceCheck`, captured a viewport, read an
 *    image, or emitted a visual failure. The evidence-kind rule was enforced
 *    against a population of zero.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { RenderedAnswer } from "../lib/health/ask-evaluation.ts";
import {
  scoreControls,
  type ControlFact,
} from "../lib/health/control-fact.ts";
import { controlQuestion, observeControl, salientTerms } from "../lib/health/control-observation.ts";
import {
  requiredEvidenceKind,
  validateVisualAcceptanceCheck,
  type VisualAcceptanceCheck,
} from "../lib/health/visual-acceptance.ts";
import { evaluateClipping, evaluateVisibility } from "../lib/health/visual-evaluation.ts";
import type { DecodedPng } from "../scripts/png.mts";

function answer(over: Partial<RenderedAnswer> = {}): RenderedAnswer {
  return {
    mode: "GROUNDED_CLAUDE",
    subjectId: "body/x",
    subjectName: "A Body",
    answerText: null,
    recordTexts: [],
    gapAttributions: [],
    gapStatements: [],
    sourceCount: 1,
    panelAbsent: false,
    ...over,
  };
}

const KNOWN_ABSENCE: ControlFact = {
  statement: "No independent-expenditure reports are on file for that race.",
  expected_truth: {
    kind: "proposition",
    proposition: "No independent-expenditure reports exist for the Vail school-board race",
  },
  fact_class: "known_absence",
  verification_source: "https://www.pima.gov/elections",
  verified_by: "owner",
  verified_date: "2026-08-30",
  authority: "Pima County Elections",
  period: "2026",
  verified_through: "https://www.pima.gov/elections",
};

const KNOWN_PRESENT: ControlFact = {
  statement: "The board has 5 members.",
  expected_truth: { kind: "value", subject: "board member count", value: 5 },
  fact_class: "known_present",
  verification_source: "https://www.pima.gov/2317",
  verified_by: "owner",
  verified_date: "2026-08-30",
};

/* ====================================================================== *
 * CONTROLS THROUGH THE REAL PATH
 * ====================================================================== */

test("SEEDED: a known-absence control run through the real path produces an observation and a scored result, never score: null", () => {
  /*
   * The surface asserts the absence, sourced. That is the CORRECT behaviour on
   * a known-absence control, and the point of the test is that a real
   * observation comes back at all — the old runner produced none.
   */
  const observed = observeControl(
    KNOWN_ABSENCE,
    answer({ answerText: "None on file with Pima County Elections for that race." }),
  );
  assert.equal(observed.observation.observed, "ABSENCE_ASSERTED");

  const score = scoreControls([KNOWN_ABSENCE, KNOWN_PRESENT], [
    observed.observation,
    { statement: KNOWN_PRESENT.statement, observed: "FACT_STATED" },
  ]);
  assert.notEqual(score, null, "a run through the real path always produces a score");
  assert.equal(score.knownAbsenceCount, 1);
  assert.equal(score.falsePresences, 0, "asserting a verified absence is correct, not a defect");
  assert.equal(score.unobserved, 0, "every loaded control was observed");
  assert.equal(score.recall, 1);
});

test("SEEDED: asserting a fact where absence is verified scores as a FALSE PRESENCE", () => {
  /* The dangerous direction: a false claim about a government. */
  const observed = observeControl(
    KNOWN_ABSENCE,
    answer({
      answerText:
        "Independent-expenditure reports exist for the Vail school-board race: no recall " +
        "election filing exists for the synthetic body.",
    }),
  );
  /* The salient terms of the absence proposition appear, so the surface has
     STATED the thing the owner verified does not exist. */
  assert.equal(observed.observation.observed, "FACT_STATED");
  const score = scoreControls([KNOWN_ABSENCE], [observed.observation]);
  assert.equal(score.falsePresences, 1);
  assert.equal(score.falsePresenceRate, 1);
});

test("a gap attributed OURS is never read as the surface asserting an absence", () => {
  const observed = observeControl(
    KNOWN_ABSENCE,
    answer({
      gapAttributions: ["OURS"],
      gapStatements: ["We haven't recorded any independent-expenditure reports yet."],
      answerText: "We hold that race, but nothing recorded that answers that.",
    }),
  );
  assert.equal(
    observed.observation.observed,
    "GAP_NAMED",
    "our silence is a fact about us and can never score as a claim about their records",
  );
});

test("an unanswered panel is our gap, not a claim about a government", () => {
  const observed = observeControl(KNOWN_PRESENT, answer({ panelAbsent: true }));
  assert.equal(observed.observation.observed, "GAP_NAMED");
  assert.equal(observed.basis, "NO_ASSERTION");
});

test("the control question is derived mechanically, strips [DRAFT], and does not lead the subject", () => {
  const q = controlQuestion({ ...KNOWN_PRESENT, statement: "[DRAFT] The board has 5 members." });
  assert.ok(!q.includes("[DRAFT]"), "a confirmed row does not carry the draft marker into a question");
  assert.ok(!/^is |^did |^does /i.test(q), "an open question, never a yes/no one that invites agreement");
  assert.match(q, /on record/);
});

test("salient terms are the parts that carry the claim, not the grammar", () => {
  const terms = salientTerms("The Pima County Board of Supervisors has 5 members.");
  assert.ok(terms.includes("pima"));
  assert.ok(terms.includes("5"));
  assert.ok(!terms.includes("the"), "function words match everything and carry nothing");
  assert.ok(!terms.includes("has"));
});

/* ====================================================================== *
 * THE VISUAL HALF
 * ====================================================================== */

function check(over: Partial<VisualAcceptanceCheck> = {}): VisualAcceptanceCheck {
  return {
    id: "vac:example",
    surface: "/ballot",
    zip: "85701",
    viewport: { width: 390, height: 844 },
    window: { notBefore: null, notAfter: null },
    status: { state: "ACTIVE" },
    expectation: { kind: "WRITTEN_EXPECTATION", text: "the card is not cut off" },
    property: "clipping",
    evidenceKind: "IMAGE_EVALUATED",
    ...over,
  };
}

test("SEEDED: a check asserting a visual property refuses DOM-only evidence", () => {
  const domOnly = check({ evidenceKind: "DOM_EVALUATED" });
  const problems = validateVisualAcceptanceCheck(domOnly);
  assert.ok(problems.length > 0);
  assert.match(problems[0], /inherently visual/);
  assert.equal(requiredEvidenceKind("clipping"), "IMAGE_EVALUATED");
  /* And the DOM-certifiable properties are still allowed their own evidence. */
  assert.equal(requiredEvidenceKind("element_count"), "DOM_EVALUATED");
});

/** A synthetic capture: a light page with a dark band wherever content sits. */
function png(paint: (x: number, y: number) => number, width = 60, height = 60): DecodedPng {
  const luminance = new Float32Array(width * height);
  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const l = paint(x, y);
      luminance[y * width + x] = l;
      const at = (y * width + x) * 3;
      pixels[at] = pixels[at + 1] = pixels[at + 2] = l;
    }
  }
  return { width, height, luminance, pixels, channels: 3 };
}

test("SEEDED: a planted clipped element goes RED on the image", () => {
  /*
   * A CUT element: high-contrast text-like rows running all the way to the
   * bottom of the box, with no trailing padding. That is what a slice looks
   * like in pixels, and the DOM would report a perfectly ordinary box.
   */
  const clipped = png((x, y) => (y % 4 < 2 ? 20 : 240));
  const verdict = evaluateClipping(clipped, { x: 0, y: 0, width: 60, height: 60 });
  assert.equal(verdict.passed, false, "content still varying at the boundary is a cut");
  assert.match(verdict.detail, /ratio/);
});

test("an element that ends in padding passes the clipping check", () => {
  /* Text-like rows in the top two thirds, flat padding in the last third. */
  const padded = png((x, y) => (y >= 40 ? 240 : y % 4 < 2 ? 20 : 240));
  const verdict = evaluateClipping(padded, { x: 0, y: 0, width: 60, height: 60 });
  assert.equal(verdict.passed, true, verdict.detail);
});

test("an element painted in the page background is INVISIBLE, whatever the selector found", () => {
  const blank = png(() => 240);
  const verdict = evaluateVisibility(blank, { x: 0, y: 0, width: 60, height: 60 });
  assert.equal(verdict.passed, false, "a flat box carries nothing a reader can read");
  assert.match(verdict.detail, /luminance sd/);
});

test("a zero-sized box is not evaluable as visible, and says so", () => {
  const any = png(() => 128);
  const verdict = evaluateVisibility(any, { x: 0, y: 0, width: 0, height: 0 });
  assert.equal(verdict.passed, false);
  assert.match(verdict.detail, /nothing is painted there/);
});

test("an element positioned entirely off the captured surface fails rather than passing empty", () => {
  const any = png(() => 128);
  const verdict = evaluateVisibility(any, { x: 500, y: 500, width: 20, height: 20 });
  assert.equal(verdict.passed, false);
  assert.match(verdict.detail, /outside the captured image/);
});
