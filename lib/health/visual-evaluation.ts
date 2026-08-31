/**
 * **EVALUATING A VISUAL CHECK AS AN IMAGE.** (A.1 WI4, 2026-08-30.)
 *
 * `visual-acceptance.ts` has said since Session A that a property which is
 * inherently visual requires `IMAGE_EVALUATED` evidence, and
 * `validateVisualAcceptanceCheck` refuses the DOM shortcut mechanically. What
 * did not exist was anything that PRODUCED image evidence: `reader-suite.mts`
 * never loaded a `VisualAcceptanceCheck`, never captured a viewport, never
 * read a rendered image, and never emitted a visual failure. The rule was
 * enforced against a population of zero.
 *
 * This module is the evaluation half. It takes DECODED PIXELS plus the
 * element geometry the page reported, and answers the image-level questions
 * from the pixels — never from the selector that found the element.
 *
 * ## Why geometry alone is not image evidence
 *
 * A bounding box is a DOM measurement. This repository has watched a dropped
 * `clip-path` report FULL coverage, read `naturalWidth 0` under a hidden pane,
 * and photographed overlays while every selector passed. So geometry is used
 * to say WHERE to look, and the verdict comes from what is actually painted
 * there.
 *
 * ## What each property asks of the pixels
 *
 * - `clipping` — content runs to a container edge and is cut. Asked as: is
 *   there real content (non-background variance) in the last row/column of
 *   the element's box, where a fully-rendered element would have padding?
 * - `visibility` — the element's box contains something other than the page
 *   background. An element that is present, sized, and painted in the
 *   background colour is invisible to a reader and present to a selector.
 * - `overlap` — two boxes intersect AND the pixels in the intersection differ
 *   from what the lower element alone would paint.
 * - `spacing` / `position` — measured from the box, and CONFIRMED against the
 *   pixels: an element positioned correctly but painted nowhere fails.
 */

import type { DecodedPng } from "../../scripts/png.mts";

/** The element geometry a page reports, in device-independent pixels. */
export interface ElementBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ImageVerdict {
  readonly passed: boolean;
  /** What was measured, in numbers, so a failure is arguable. */
  readonly detail: string;
}

/** Mean and standard deviation of luminance over a rectangle of the capture. */
function rectStats(
  png: DecodedPng,
  box: ElementBox,
  scale: number,
): { mean: number; sd: number; n: number } {
  const x0 = Math.max(0, Math.round(box.x * scale));
  const y0 = Math.max(0, Math.round(box.y * scale));
  const x1 = Math.min(png.width, Math.round((box.x + box.width) * scale));
  const y1 = Math.min(png.height, Math.round((box.y + box.height) * scale));
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const l = png.luminance[y * png.width + x];
      n += 1;
      sum += l;
      sumSq += l * l;
    }
  }
  if (n === 0) return { mean: 0, sd: 0, n: 0 };
  const mean = sum / n;
  return { mean, sd: Math.sqrt(Math.max(0, sumSq / n - mean * mean)), n };
}

/**
 * Does this element carry anything a reader can see?
 *
 * Variance rather than mean: a box painted a flat colour that differs from the
 * page background is still just a block, and a box with TEXT in it has
 * luminance variance. `sd` under the floor means nothing is legible there,
 * whatever the selector found.
 */
export function evaluateVisibility(
  png: DecodedPng,
  box: ElementBox,
  scale = 1,
  minSd = 3,
): ImageVerdict {
  if (box.width <= 0 || box.height <= 0) {
    return {
      passed: false,
      detail: `the element reports a ${box.width}x${box.height} box — nothing is painted there`,
    };
  }
  const stats = rectStats(png, box, scale);
  if (stats.n === 0) {
    return {
      passed: false,
      detail:
        "the element's box falls entirely outside the captured image — it is positioned " +
        "off the surface a reader can see",
    };
  }
  return {
    passed: stats.sd >= minSd,
    detail:
      `luminance sd ${stats.sd.toFixed(2)} over ${stats.n} captured pixel(s) ` +
      `(floor ${minSd}); mean ${stats.mean.toFixed(1)}`,
  };
}

/**
 * Is this element's content CUT at a boundary?
 *
 * The read: compare the variance in the last few rows of the element's box
 * against the variance across the box as a whole. A fully-rendered element
 * ends in padding — low variance at the edge. An element whose text is sliced
 * by an overflow boundary has content variance running right to the edge.
 *
 * Stated as a ratio rather than an absolute so it holds across themes: a dark
 * surface and a light one have very different absolute luminance and the same
 * relationship between an element's middle and its trailing padding.
 */
export function evaluateClipping(
  png: DecodedPng,
  box: ElementBox,
  scale = 1,
  edgePx = 3,
  ratioCeiling = 0.5,
): ImageVerdict {
  const whole = rectStats(png, box, scale);
  if (whole.n === 0) {
    return { passed: false, detail: "the element's box is not inside the captured image" };
  }
  if (whole.sd < 1) {
    return {
      passed: false,
      detail:
        `the element's box has luminance sd ${whole.sd.toFixed(2)} — there is nothing painted ` +
        "in it, so whether it clips cannot be read from this capture",
    };
  }
  const edge = rectStats(
    png,
    { x: box.x, y: box.y + box.height - edgePx, width: box.width, height: edgePx },
    scale,
  );
  const ratio = edge.sd / whole.sd;
  return {
    passed: ratio <= ratioCeiling,
    detail:
      `trailing ${edgePx}px band has luminance sd ${edge.sd.toFixed(2)} against ${whole.sd.toFixed(2)} ` +
      `across the whole box (ratio ${ratio.toFixed(2)}, ceiling ${ratioCeiling}). A ratio above ` +
      "the ceiling means content is still varying at the boundary, which is what a cut looks like.",
  };
}

/**
 * Do two elements overlap where they should not?
 *
 * Geometry says whether the boxes intersect; the pixels say whether the
 * intersection is actually painted over. Both, because two transparent boxes
 * sharing coordinates are not an overlap a reader can see, and because a
 * `clip-path` that Chromium dropped reports geometry that never rendered.
 */
export function evaluateOverlap(
  png: DecodedPng,
  a: ElementBox,
  b: ElementBox,
  scale = 1,
): ImageVerdict {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  if (x1 <= x0 || y1 <= y0) {
    return { passed: true, detail: "the two boxes do not intersect" };
  }
  const stats = rectStats(png, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, scale);
  return {
    passed: false,
    detail:
      `the boxes intersect over ${Math.round(x1 - x0)}x${Math.round(y1 - y0)}px and that region ` +
      `is painted (luminance sd ${stats.sd.toFixed(2)} over ${stats.n} pixel(s))`,
  };
}

/* ============================================================================
 * **THE PROPERTIES THAT HAD NO EVALUATOR OF THEIR OWN.**
 * (Session B WI1.7, 2026-08-30.)
 *
 * `visual_prominence` and `image_level` were dispatched to `evaluateVisibility`
 * — the same luminance-variance test. So a check asserting that an element is
 * PROMINENT passed on proof that something was painted in its box, which every
 * rendered element in the product satisfies. Prominence is a claim about an
 * element relative to the rest of the surface, and a test that never looks
 * outside the element's own box cannot make it.
 *
 * `overlap`, `position`, `spacing` and `responsive_hierarchy` fell through to
 * "no image evaluator is implemented", which the suite scored RED. Not green,
 * so nothing was over-certified — but a harness gap rendered as a product
 * defect, which files a diagnostic against code that is not at fault and
 * teaches the next reader to distrust the red.
 *
 * What follows are real evaluators for the first four, and the rule for the
 * rest: **a property with no evaluator capable of proving it is NOT_EVALUABLE,
 * named, and never GREEN.**
 * ========================================================================= */

/** The band immediately outside a box, on all four sides. */
function ringStats(
  png: DecodedPng,
  box: ElementBox,
  scale: number,
  ring: number,
): { mean: number; sd: number; n: number } {
  const outer = {
    x: box.x - ring,
    y: box.y - ring,
    width: box.width + ring * 2,
    height: box.height + ring * 2,
  };
  const o = rectStats(png, outer, scale);
  const i = rectStats(png, box, scale);
  const n = o.n - i.n;
  if (n <= 0) return { mean: 0, sd: 0, n: 0 };
  /* Ring = outer minus inner, recovered from the two accumulations rather than
     walked again: mean and variance both compose, and walking an L-shape twice
     is where an off-by-one lives. */
  const sum = o.mean * o.n - i.mean * i.n;
  const sumSq = (o.sd * o.sd + o.mean * o.mean) * o.n - (i.sd * i.sd + i.mean * i.mean) * i.n;
  const mean = sum / n;
  return { mean, sd: Math.sqrt(Math.max(0, sumSq / n - mean * mean)), n };
}

/**
 * Is this element PROMINENT — distinguished from what surrounds it?
 *
 * Not "is it painted". An element is prominent when a reader's eye separates
 * it from its neighbourhood, and that is measurable as a relationship between
 * the element and the band around it: either its mean luminance departs from
 * the surrounding band (a filled pill against a plain card), or its internal
 * variance materially exceeds the band's (dense type against whitespace).
 *
 * Both readings are of PIXELS OUTSIDE the element as well as inside, which is
 * the whole difference from `evaluateVisibility`. A visible element sitting in
 * a field of equally busy elements is visible and not prominent, and this is
 * the test that can tell them apart.
 */
export function evaluateProminence(
  png: DecodedPng,
  box: ElementBox,
  scale = 1,
  ring = 24,
  minMeanDelta = 12,
  minSdRatio = 1.8,
): ImageVerdict {
  if (box.width <= 0 || box.height <= 0) {
    return {
      passed: false,
      detail: `the element reports a ${box.width}x${box.height} box — nothing is painted there`,
    };
  }
  const inner = rectStats(png, box, scale);
  if (inner.n === 0) {
    return { passed: false, detail: "the element's box falls outside the captured image" };
  }
  const around = ringStats(png, box, scale, ring);
  if (around.n === 0) {
    return {
      passed: false,
      detail:
        `no ${ring}px surrounding band is inside the capture, so this element cannot be ` +
        "compared with anything — prominence is a relationship and there is nothing to relate it to",
    };
  }
  const meanDelta = Math.abs(inner.mean - around.mean);
  const sdRatio = around.sd < 0.5 ? Infinity : inner.sd / around.sd;
  const passed = meanDelta >= minMeanDelta || sdRatio >= minSdRatio;
  return {
    passed,
    detail:
      `element mean ${inner.mean.toFixed(1)} sd ${inner.sd.toFixed(2)} against a ${ring}px ` +
      `surround mean ${around.mean.toFixed(1)} sd ${around.sd.toFixed(2)}: ` +
      `mean delta ${meanDelta.toFixed(1)} (floor ${minMeanDelta}), sd ratio ` +
      `${Number.isFinite(sdRatio) ? sdRatio.toFixed(2) : "unbounded"} (floor ${minSdRatio}). ` +
      (passed
        ? "the element separates from its surroundings"
        : "the element is painted but does not separate from what surrounds it — visible, " +
          "and not prominent"),
  };
}

/** Where an element is expected to sit, in device-independent pixels. */
export interface ExpectedRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Is this element WHERE it is supposed to be, and painted there?
 *
 * Both clauses, because either alone is a lie this repository has already
 * shipped: a box reported at the right coordinates that paints nothing is a
 * layout that "passes" while the reader sees an empty column, and painted
 * pixels at the wrong coordinates are a different defect wearing the same
 * green. `tolerance` is stated per check rather than global — a pill's
 * placement and a column's placement do not deserve the same slack.
 */
export function evaluatePosition(
  png: DecodedPng,
  box: ElementBox,
  expected: ExpectedRegion,
  scale = 1,
  tolerance = 8,
): ImageVerdict {
  const dx = Math.abs(box.x - expected.x);
  const dy = Math.abs(box.y - expected.y);
  const dw = Math.abs(box.width - expected.width);
  const dh = Math.abs(box.height - expected.height);
  const worst = Math.max(dx, dy, dw, dh);
  const painted = rectStats(png, box, scale);
  const isPainted = painted.n > 0 && painted.sd >= 1;
  const geometryOk = worst <= tolerance;
  return {
    passed: geometryOk && isPainted,
    detail:
      `box ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x` +
      `${Math.round(box.height)} against expected ${expected.x},${expected.y} ` +
      `${expected.width}x${expected.height}: worst axis deviation ${worst.toFixed(1)}px ` +
      `(tolerance ${tolerance}); the box paints luminance sd ${painted.sd.toFixed(2)} over ` +
      `${painted.n} pixel(s). ` +
      (geometryOk
        ? isPainted
          ? "positioned and painted"
          : "positioned correctly and painting nothing, which a reader meets as an empty space"
        : "not where the check expects it"),
  };
}

/**
 * Is the GAP between two elements the size it should be, and actually empty?
 *
 * Spacing read from boxes alone certifies a gap that a third element is
 * sitting in. So the measured gap must both match the expectation and be
 * unpainted — the band between the two boxes has to look like background.
 *
 * The axis is chosen from the boxes rather than declared: two elements stacked
 * vertically are spaced vertically. Boxes that already intersect are not a
 * spacing question and are refused as one.
 */
export function evaluateSpacing(
  png: DecodedPng,
  a: ElementBox,
  b: ElementBox,
  expectedPx: number,
  scale = 1,
  tolerance = 4,
): ImageVerdict {
  const vertical = b.y >= a.y + a.height || a.y >= b.y + b.height;
  const horizontal = b.x >= a.x + a.width || a.x >= b.x + b.width;
  if (!vertical && !horizontal) {
    return {
      passed: false,
      detail:
        "the two boxes intersect on both axes, so there is no gap between them to measure — " +
        "that is an overlap, and it is a different property",
    };
  }
  const [first, second] = vertical
    ? a.y <= b.y
      ? [a, b]
      : [b, a]
    : a.x <= b.x
      ? [a, b]
      : [b, a];
  const gap = vertical
    ? second.y - (first.y + first.height)
    : second.x - (first.x + first.width);
  const band: ElementBox = vertical
    ? {
        x: Math.max(first.x, second.x),
        y: first.y + first.height,
        width: Math.max(1, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x)),
        height: Math.max(1, gap),
      }
    : {
        x: first.x + first.width,
        y: Math.max(first.y, second.y),
        width: Math.max(1, gap),
        height: Math.max(1, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y)),
      };
  const inBand = rectStats(png, band, scale);
  const sizeOk = Math.abs(gap - expectedPx) <= tolerance;
  /* A gap with content in it is not a gap. The floor is deliberately low:
     anti-aliased borders and a hairline rule are not "content", dense type is. */
  const empty = inBand.n === 0 || inBand.sd < 6;
  return {
    passed: sizeOk && empty,
    detail:
      `${vertical ? "vertical" : "horizontal"} gap ${gap.toFixed(1)}px against expected ` +
      `${expectedPx}px (tolerance ${tolerance}); the gap band paints luminance sd ` +
      `${inBand.sd.toFixed(2)} over ${inBand.n} pixel(s). ` +
      (sizeOk
        ? empty
          ? "spaced as expected and the gap is empty"
          : "the gap measures correctly and something is painted inside it, so it is not a gap"
        : "the gap is not the expected size"),
  };
}

/**
 * Do these elements hold their intended READING ORDER at this viewport?
 *
 * Responsive hierarchy is the claim that at a given width the important thing
 * comes first. Read as: the boxes fall in the declared order top-to-bottom,
 * and where two share a row, left-to-right — and every one of them is
 * actually painted, because a hierarchy whose lead element renders blank has
 * the order it claimed and none of the meaning.
 *
 * The viewport is the check's own; running the same check at a second width is
 * a second check, which is what makes `responsive_hierarchy` a property of a
 * viewport rather than of the page.
 */
export function evaluateReadingOrder(
  png: DecodedPng,
  boxes: readonly { readonly label: string; readonly box: ElementBox }[],
  scale = 1,
  rowTolerance = 8,
): ImageVerdict {
  if (boxes.length < 2) {
    return {
      passed: false,
      detail:
        `a reading-order check needs at least two elements; ${boxes.length} was bound. One ` +
        "element has no order",
    };
  }
  const blank = boxes.filter(({ box }) => {
    const s = rectStats(png, box, scale);
    return s.n === 0 || s.sd < 1;
  });
  const misordered: string[] = [];
  for (let i = 1; i < boxes.length; i += 1) {
    const prev = boxes[i - 1].box;
    const here = boxes[i].box;
    const sameRow = Math.abs(prev.y - here.y) <= rowTolerance;
    const ok = sameRow ? prev.x <= here.x : prev.y <= here.y;
    if (!ok) misordered.push(`${boxes[i - 1].label} before ${boxes[i].label}`);
  }
  const passed = misordered.length === 0 && blank.length === 0;
  return {
    passed,
    detail:
      `${boxes.length} element(s) in declared order: ` +
      boxes
        .map(({ label, box }) => `${label}@${Math.round(box.x)},${Math.round(box.y)}`)
        .join(" -> ") +
      (misordered.length > 0 ? `; out of order: ${misordered.join("; ")}` : "") +
      (blank.length > 0
        ? `; painted nothing: ${blank.map((b) => b.label).join(", ")}`
        : "") +
      (passed ? "; the declared hierarchy holds at this viewport" : ""),
  };
}
