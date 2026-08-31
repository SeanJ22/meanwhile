/**
 * **THE SEEDED FAILURES FOR THE VISUAL EVALUATORS.** (Session B WI1.7.)
 *
 * `visual_prominence` and `image_level` were dispatched to
 * `evaluateVisibility` — the same luminance-variance test — so a check
 * asserting that an element is PROMINENT was answered by "something is painted
 * in its box", which is true of every element the product renders. Visible is
 * not prominent, and an instrument that cannot tell them apart certifies the
 * one when asked about the other.
 *
 * `overlap`, `position`, `spacing` and `responsive_hierarchy` had no evaluator
 * at all and fell to a default the suite scored RED, which files a diagnostic
 * against product code for a gap in the harness.
 *
 * These tests drive the evaluators over SYNTHETIC pixel fields rather than
 * captures, because the question each one answers is arithmetic over luminance
 * and a hand-built field is the only way to state the case exactly. The
 * browser half — that the boxes come from `getBoundingClientRect` and the
 * pixels from a real screenshot — is `scripts/visual-suite.mts`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { DecodedPng } from "../scripts/png.mts";
import {
  evaluateOverlap,
  evaluatePosition,
  evaluateProminence,
  evaluateReadingOrder,
  evaluateSpacing,
  evaluateVisibility,
  type ElementBox,
} from "../lib/health/visual-evaluation.ts";

/**
 * A canvas, painted by a function of (x, y) returning luminance 0-255.
 *
 * `pixels` and `channels` are filled so the shape is a real `DecodedPng`; the
 * evaluators read `luminance`, and a partial object typed through `as` would
 * hide a later evaluator that starts reading the samples.
 */
function canvas(
  width: number,
  height: number,
  paint: (x: number, y: number) => number,
): DecodedPng {
  const luminance = new Float32Array(width * height);
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const l = paint(x, y);
      luminance[y * width + x] = l;
      const p = (y * width + x) * 4;
      pixels[p] = pixels[p + 1] = pixels[p + 2] = Math.max(0, Math.min(255, Math.round(l)));
      pixels[p + 3] = 255;
    }
  }
  return { width, height, luminance, pixels, channels: 4 };
}

const inside = (b: ElementBox, x: number, y: number): boolean =>
  x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;

/** Busy: alternating rows, so luminance VARIANCE is high — text-like. */
const busy = (y: number): number => (y % 2 === 0 ? 30 : 220);

/* ==========================================================================
 * WI1.7 — prominence is not visibility
 * ======================================================================= */

test("SEEDED WI1.7: an element that is VISIBLE but not PROMINENT fails a prominence check", () => {
  /*
   * The exact case. The element is dense with content — `evaluateVisibility`
   * passes it, correctly, because a reader can see it. But everything around
   * it is equally dense and at the same luminance, so nothing separates it
   * from its neighbourhood: it is one card in a wall of identical cards.
   *
   * Under A.1 this went GREEN on a prominence check, because prominence WAS
   * the visibility test.
   */
  const box: ElementBox = { x: 100, y: 100, width: 80, height: 40 };
  const uniformlyBusy = canvas(300, 300, (_x, y) => busy(y));

  assert.equal(
    evaluateVisibility(uniformlyBusy, box).passed,
    true,
    "the element is genuinely visible — that reading was never wrong",
  );

  const prominence = evaluateProminence(uniformlyBusy, box);
  assert.equal(prominence.passed, false, "and it is NOT prominent");
  assert.match(prominence.detail, /visible, and not prominent/);
});

test("WI1.7: an element that DOES separate from its surroundings passes prominence", () => {
  /* The repair must leave prominence provable, or it has replaced a check that
     always passed with one that never does. Here the element is a dark filled
     block on a light, quiet field — the shape of a real prominent pill. */
  const box: ElementBox = { x: 100, y: 100, width: 80, height: 40 };
  const png = canvas(300, 300, (x, y) => (inside(box, x, y) ? 20 : 240));
  const prominence = evaluateProminence(png, box);
  assert.equal(prominence.passed, true);
  assert.match(prominence.detail, /separates from its surroundings/);
});

test("WI1.7: prominence with no surrounding band inside the capture is refused, not passed", () => {
  /* An element filling the whole capture has nothing to be compared with.
     Prominence is a relationship; with no second term there is no verdict. */
  const box: ElementBox = { x: 0, y: 0, width: 40, height: 40 };
  const png = canvas(40, 40, (_x, y) => busy(y));
  const verdict = evaluateProminence(png, box, 1, 24);
  assert.equal(verdict.passed, false);
  assert.match(verdict.detail, /nothing to relate it to/);
});

/* ==========================================================================
 * WI1.7 — position, spacing, overlap, reading order
 * ======================================================================= */

test("WI1.7: an element at the right coordinates that paints NOTHING fails position", () => {
  /* Geometry alone is the lie this repository has already shipped: the box is
     exactly where it belongs and the reader sees an empty column. */
  const box: ElementBox = { x: 20, y: 20, width: 60, height: 30 };
  const flat = canvas(200, 200, () => 255);
  const verdict = evaluatePosition(flat, box, { x: 20, y: 20, width: 60, height: 30 });
  assert.equal(verdict.passed, false);
  assert.match(verdict.detail, /painting nothing/);
});

test("WI1.7: an element painted at the WRONG coordinates fails position", () => {
  const box: ElementBox = { x: 120, y: 20, width: 60, height: 30 };
  const png = canvas(300, 200, (x, y) => (inside(box, x, y) ? busy(y) : 250));
  const verdict = evaluatePosition(png, box, { x: 20, y: 20, width: 60, height: 30 });
  assert.equal(verdict.passed, false);
  assert.match(verdict.detail, /not where the check expects it/);
});

test("WI1.7: a gap of the right SIZE with content painted in it is not a gap", () => {
  /* Spacing read from boxes alone certifies a gap a third element is sitting
     in. The band has to actually look like background. */
  const a: ElementBox = { x: 20, y: 20, width: 100, height: 30 };
  const b: ElementBox = { x: 20, y: 70, width: 100, height: 30 };
  const intruder: ElementBox = { x: 20, y: 52, width: 100, height: 16 };
  const png = canvas(200, 200, (x, y) =>
    inside(a, x, y) || inside(b, x, y) || inside(intruder, x, y) ? busy(y) : 250,
  );
  const verdict = evaluateSpacing(png, a, b, 20);
  assert.equal(verdict.passed, false);
  assert.match(verdict.detail, /not a gap/);
});

test("WI1.7: a correctly sized EMPTY gap passes spacing", () => {
  const a: ElementBox = { x: 20, y: 20, width: 100, height: 30 };
  const b: ElementBox = { x: 20, y: 70, width: 100, height: 30 };
  const png = canvas(200, 200, (x, y) => (inside(a, x, y) || inside(b, x, y) ? busy(y) : 250));
  assert.equal(evaluateSpacing(png, a, b, 20).passed, true);
});

test("WI1.7: two boxes intersecting on both axes are refused as a spacing question", () => {
  const a: ElementBox = { x: 20, y: 20, width: 100, height: 40 };
  const b: ElementBox = { x: 60, y: 40, width: 100, height: 40 };
  const png = canvas(200, 200, () => 250);
  const verdict = evaluateSpacing(png, a, b, 10);
  assert.equal(verdict.passed, false);
  assert.match(verdict.detail, /that is an overlap/);
});

test("WI1.7: overlapping painted boxes fail overlap; disjoint boxes pass", () => {
  const a: ElementBox = { x: 20, y: 20, width: 60, height: 40 };
  const b: ElementBox = { x: 50, y: 40, width: 60, height: 40 };
  const png = canvas(200, 200, (x, y) => (inside(a, x, y) || inside(b, x, y) ? busy(y) : 250));
  assert.equal(evaluateOverlap(png, a, b).passed, false);
  assert.equal(
    evaluateOverlap(png, a, { x: 150, y: 150, width: 20, height: 20 }).passed,
    true,
  );
});

test("WI1.7: a hierarchy whose declared lead renders BELOW the follower fails reading order", () => {
  const lead: ElementBox = { x: 20, y: 120, width: 100, height: 30 };
  const follower: ElementBox = { x: 20, y: 20, width: 100, height: 30 };
  const png = canvas(200, 200, (x, y) =>
    inside(lead, x, y) || inside(follower, x, y) ? busy(y) : 250,
  );
  const verdict = evaluateReadingOrder(png, [
    { label: "lead", box: lead },
    { label: "follower", box: follower },
  ]);
  assert.equal(verdict.passed, false);
  assert.match(verdict.detail, /out of order/);
});

test("WI1.7: a hierarchy in the right order whose lead paints nothing still fails", () => {
  /* The order it claimed, and none of the meaning. */
  const lead: ElementBox = { x: 20, y: 20, width: 100, height: 30 };
  const follower: ElementBox = { x: 20, y: 120, width: 100, height: 30 };
  const png = canvas(200, 200, (x, y) => (inside(follower, x, y) ? busy(y) : 250));
  const verdict = evaluateReadingOrder(png, [
    { label: "lead", box: lead },
    { label: "follower", box: follower },
  ]);
  assert.equal(verdict.passed, false);
  assert.match(verdict.detail, /painted nothing: lead/);
});

test("WI1.7: a painted hierarchy in the declared order passes", () => {
  const lead: ElementBox = { x: 20, y: 20, width: 100, height: 30 };
  const follower: ElementBox = { x: 20, y: 120, width: 100, height: 30 };
  const png = canvas(200, 200, (x, y) =>
    inside(lead, x, y) || inside(follower, x, y) ? busy(y) : 250,
  );
  const verdict = evaluateReadingOrder(png, [
    { label: "lead", box: lead },
    { label: "follower", box: follower },
  ]);
  assert.equal(verdict.passed, true);
});

test("WI1.7: one element is not a hierarchy", () => {
  const png = canvas(50, 50, () => 250);
  const verdict = evaluateReadingOrder(png, [
    { label: "only", box: { x: 0, y: 0, width: 10, height: 10 } },
  ]);
  assert.equal(verdict.passed, false);
  assert.match(verdict.detail, /One element has no order/);
});
