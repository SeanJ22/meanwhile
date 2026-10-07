import assert from "node:assert/strict";
import { test } from "node:test";

import { anchorInViewport } from "../lib/map/anchor-in-viewport.ts";

/**
 * A popup opens whole, wherever the reader clicked: a header stating five rows must show five.
 */

const VIEWPORT = { containerWidth: 1440, containerHeight: 900 };
const BOX = { width: 280, height: 320 };

test("F01 9.1: a click with room keeps the old offset, so nothing common moves", () => {
  const at = anchorInViewport({ x: 400, y: 300, ...BOX, ...VIEWPORT });
  assert.equal(at.left, 412, "the +12 nudge away from the cursor is preserved");
  assert.equal(at.top, 288, "the -12 nudge is preserved");
});

test("F01 9.1: a click near the bottom edge places the box ENTIRELY on screen", () => {
  // 60px from the bottom of a 900px viewport.
  const at = anchorInViewport({ x: 700, y: 840, ...BOX, ...VIEWPORT });
  assert.ok(at.top + BOX.height <= VIEWPORT.containerHeight, "the box runs off the bottom");
  assert.equal(at.top, 900 - 320 - 12);
});

test("F01 9.1: a click near the right edge places the box ENTIRELY on screen", () => {
  const at = anchorInViewport({ x: 1430, y: 300, ...BOX, ...VIEWPORT });
  assert.ok(at.left + BOX.width <= VIEWPORT.containerWidth, "the box runs off the right");
  assert.equal(at.left, 1440 - 280 - 12);
});

test("F01 9.1: a click at the very top-left never places the box off the top or left", () => {
  const at = anchorInViewport({ x: 0, y: 0, ...BOX, ...VIEWPORT });
  assert.equal(at.left, 12);
  // y + offsetY would be -12; the margin floor catches it.
  assert.equal(at.top, 12);
});

test("F01 9.1: a box taller than the viewport is capped and scrolls, never clipped off-screen", () => {
  const at = anchorInViewport({
    x: 200,
    y: 400,
    width: 280,
    height: 2000,
    containerWidth: 400,
    containerHeight: 600,
  });
  assert.equal(at.maxHeight, 600 - 24, "the box must fit between the margins");
  assert.equal(at.top, 12);
  assert.ok(at.top + at.maxHeight <= 600);
});

test("F01 9.1: a box wider than the viewport still starts inside the left margin", () => {
  const at = anchorInViewport({
    x: 300,
    y: 100,
    width: 900,
    height: 200,
    containerWidth: 390,
    containerHeight: 800,
  });
  assert.equal(at.left, 12, "a too-wide box pins to the left margin rather than off-screen");
});

test("F01 9.1: a phone-sized viewport still places a full picker whole", () => {
  // 390x844, a five-district picker at its CSS cap.
  const at = anchorInViewport({
    x: 200,
    y: 700,
    width: 280,
    height: 340,
    containerWidth: 390,
    containerHeight: 844,
  });
  assert.ok(at.left >= 12 && at.left + 280 <= 390 - 12 + 0.001);
  assert.ok(at.top >= 12 && at.top + 340 <= 844 - 12 + 0.001);
});
