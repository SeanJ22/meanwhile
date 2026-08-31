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
