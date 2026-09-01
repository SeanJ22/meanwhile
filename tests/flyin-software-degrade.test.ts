/**
 * **THE SOFTWARE-RASTERISER FLY-IN DEGRADATION.** (Session C, 2026-09-01.)
 *
 * W6 H3 is PASS on hardware and is not reopened here. This guards the ADJACENT
 * finding: measured through the CPU rasteriser on the same host in the same
 * minutes, the zip fly-in held 28.8% of a bare MapLibre map — 17.2 fps median
 * against 59.9, with 189 of 194 frames over 33.4 ms — while the BARE map
 * reached 60 fps on that same rasteriser. The deficit was ours.
 *
 * The repair stands two treatments down while the camera is moving, and only
 * when the rasteriser NAMES itself as software: the scrim's `backdrop-filter`
 * and the state-focus SVG art in CSS, and the district fill/line/label layers
 * through `setLayoutProperty`. Post-repair, same instrument, six interleaved
 * pairs per arm: software 49.9/54.2 = **92.0%** with 20 of 771 frames over
 * 33.4 ms, hardware 59.6/60.1 = **99.3%** with 24 of 954.
 *
 * ## What each test here can and cannot prove
 *
 * The frame rates are measured by `pnpm measure:flyin` and asserted by the
 * `[W6H3]` check in `pnpm walk:all`, which flies a real browser on both
 * rasterisers. **Nothing in this file measures a frame.** What it guards is the
 * WIRING — the classification, the two CSS rules, and the fact that the restore
 * is synchronous on `moveend` — because every one of those is a silent failure:
 * the mechanism goes dead, the page looks identical in a screenshot, and only a
 * frame-rate run notices. Two of the three were caught here as real defects
 * before they shipped, and the notes below name them.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  SOFTWARE_RENDERER_NAMES,
  classifyRenderer,
} from "../components/map/raster-capability.ts";

const ROOT = join(import.meta.dirname, "..");
const CSS = readFileSync(join(ROOT, "app", "globals.css"), "utf8");
const CANVAS = readFileSync(join(ROOT, "components", "map", "map-canvas.tsx"), "utf8");

/* ---------------------------------------------------- 1: the classification --- */

test("the renderer strings this was measured through classify as software", () => {
  /* The exact string `WEBGL_debug_renderer_info` returned on the host every
     number in this file was taken on. Not a paraphrase — a paraphrase that
     stopped matching would leave the degradation dead on the one machine class
     it exists for. */
  assert.equal(
    classifyRenderer(
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
    ),
    "software",
  );
  for (const name of SOFTWARE_RENDERER_NAMES) {
    assert.equal(classifyRenderer(`ANGLE (Vendor, ${name} thing, driver)`), "software", name);
  }
});

test("a real GPU classifies as hardware and is therefore left alone", () => {
  /* Also the exact string from the hardware arm of the same measurement. */
  assert.equal(
    classifyRenderer("ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)"),
    "hardware",
  );
  assert.equal(classifyRenderer("Apple M2"), "hardware");
  assert.equal(classifyRenderer("NVIDIA GeForce RTX 4070/PCIe/SSE2"), "hardware");
});

test("an unreadable renderer is unknown, and unknown is NOT software", () => {
  /*
   * The asymmetry is the point and it is deliberate. A browser that withholds
   * `WEBGL_debug_renderer_info` for fingerprinting reasons is overwhelmingly on
   * a GPU, and degrading the author's design for everyone whose browser
   * declines to identify itself would take it from readers who can afford it.
   * The degradation requires a POSITIVE identification — never an inference
   * from silence. Same rule the product applies to its own data: a failure to
   * read something is a fact about the read.
   */
  for (const value of [null, undefined, "", "   "]) {
    assert.equal(classifyRenderer(value), "unknown", JSON.stringify(value));
  }
  assert.notEqual(classifyRenderer(null), "software");
});

test("the decision is an equality against software, never an inequality", () => {
  /*
   * `raster.kind !== "hardware"` would read identically at a glance and would
   * degrade every `unknown` reader — the exact inversion the test above exists
   * to forbid. Guarded in the call site's own text because that is where the
   * inversion would be written.
   */
  assert.match(
    CANVAS,
    /const degradeInMotion = raster\.kind === "software";/,
    "map-canvas no longer gates the degradation on a positive software identification",
  );
});

/* ------------------------------------------------------- 2: the CSS rules --- */

/** The rule body for one selector, or null. No regex — see the note below. */
function ruleFor(selector: string): string | null {
  /*
   * A string scan rather than a pattern. The selectors here carry `[`, `]`,
   * `"` and `=`, and a regex built out of them is one escape away from matching
   * something adjacent instead — which is how a guard reports a rule present
   * that is not the rule it was looking for.
   */
  const at = CSS.indexOf(selector);
  if (at === -1) return null;
  const open = CSS.indexOf("{", at);
  const close = CSS.indexOf("}", open);
  return open === -1 || close === -1 ? null : CSS.slice(open + 1, close);
}

const MOTION = '[data-wtp-raster="software"][data-camera-moving="1"]';

test("the scrim's backdrop-filter stands down under the two motion attributes", () => {
  const body = ruleFor(`${MOTION} .state-focus-scrim`);
  assert.ok(body !== null, "the software-rasteriser scrim rule is gone from app/globals.css");
  assert.match(body, /backdrop-filter:\s*none/);
});

test("the state-focus SVG art stands down under the same two attributes", () => {
  /*
   * Added because the MEDIAN said the repair was finished and the JANK said it
   * was not: with only the blur and the district layers stood down the fly-in
   * reached 89% of bare and still dropped 57 of 231 frames past 33.4 ms, at a
   * p95 frame time of 97.3 ms. Hiding this one element took that to 12 of 369
   * and 29.2 ms. Three `feGaussianBlur` regions rasterised over a
   * viewport-sized box on every frame, on a CPU.
   */
  const body = ruleFor(`${MOTION} .state-focus-art`);
  assert.ok(body !== null, "the software-rasteriser SVG-art rule is gone from app/globals.css");
  assert.match(body, /display:\s*none/);
});

test("neither motion rule writes an explicit -webkit- prefix beside the standard property", () => {
  /*
   * **A REAL DEFECT, CAUGHT IN THE BUILT CHUNK RATHER THAN IN THE SOURCE.**
   *
   * The first version of the scrim rule wrote `backdrop-filter: none` followed
   * by `-webkit-backdrop-filter: none`. Lightning CSS treats the two as one
   * property and normalises prefix order, so it emitted the `-webkit-` line
   * ALONE and dropped the standard one. Chromium then honoured the unprefixed
   * declaration from the rule above, the blur stayed on through an entire
   * measured flight, and the source read as if it had been turned off — a
   * measured 27.4% reported against a repair that was not in the build.
   *
   * Every other rule in this file writes the property unprefixed and lets the
   * build add the prefix. This is the guard that keeps the next session from
   * re-adding the "safe" second line.
   */
  for (const selector of [`${MOTION} .state-focus-scrim`, `${MOTION} .state-focus-art`]) {
    const body = ruleFor(selector);
    assert.ok(body !== null, selector);
    assert.ok(
      !body.includes("-webkit-"),
      `${selector} writes an explicit vendor prefix; the minifier then drops the standard ` +
        "property and the rule silently stops applying",
    );
  }
});

/* ------------------------------------------- 3: the wiring in map-canvas --- */

test("the degradation is entered on movestart and left on moveend", () => {
  /*
   * POSITIONS rather than a windowed pattern. The first version bounded the
   * `onMoveEnd` match to 400 characters and failed on a build with nothing
   * wrong with it: that handler opens with a long note, so the window closed
   * before the call it was looking for. A guard whose window is a guess reports
   * "the wiring is gone" when what is actually gone is the guess.
   */
  const startAt = CANVAS.indexOf("const onMoveStart");
  const endAt = CANVAS.indexOf("const onMoveEnd");
  const enterAt = CANVAS.indexOf("enterMotionDegrade();", startAt);
  const leaveAt = CANVAS.indexOf("leaveMotionDegrade();", endAt);
  assert.ok(startAt !== -1 && endAt !== -1, "the camera-move handlers are gone");
  assert.ok(enterAt > startAt && enterAt < endAt, "movestart no longer enters the degradation");
  assert.ok(leaveAt > endAt, "moveend no longer leaves the degradation");
  /* Both handlers are still subscribed to the map, not merely defined. */
  assert.match(CANVAS, /map\.on\("movestart", onMoveStart\);/);
  assert.match(CANVAS, /map\.on\("moveend", onMoveEnd\);/);
});

test("the restore runs BEFORE the debounced settle, not inside it", () => {
  /*
   * The settle timer is debounced by 650 ms. A restore inside it would leave a
   * reader looking at a landed map with no district boundaries for two thirds
   * of a second — trading a slow fly-in for a map that arrives wrong. So the
   * restore has to appear ahead of the `setTimeout` in the same handler, and
   * this asserts that ORDER rather than merely that both exist.
   */
  const restore = CANVAS.indexOf("leaveMotionDegrade();");
  const settle = CANVAS.indexOf("settleTimer = window.setTimeout");
  assert.ok(restore !== -1 && settle !== -1);
  assert.ok(
    restore < settle,
    "the motion restore now runs inside or after the 650ms settle timer",
  );
});

test("the district layers are hidden by visibility, never removed", () => {
  /*
   * `removeLayer` would provoke `syncDistrictLayer` into re-adding every layer
   * mid-flight — the exact heal-during-its-own-flight defect that invalidated
   * the `bare` ablation on 2026-08-31 — and removing a SOURCE would throw away
   * tiled geometry that then has to be rebuilt at the moment the camera stops.
   */
  assert.match(CANVAS, /setLayoutProperty\(id, "visibility", visibility\)/);
  assert.ok(
    !CANVAS.includes("removeLayer(id)"),
    "the motion degradation removes layers instead of hiding them",
  );
});

test("both attributes are written to one element, which is the CSS's own requirement", () => {
  /* The selector above requires `data-wtp-raster` and `data-camera-moving` on
     the SAME element and the scrim inside it. Split across two elements the
     rule matches nothing and fails silently. */
  assert.match(CANVAS, /shellRef\.current\.dataset\.wtpRaster = raster\.kind/);
  assert.match(CANVAS, /shellRef\.current\?\.setAttribute\("data-camera-moving", "1"\)/);
  assert.match(CANVAS, /shellRef\.current\?\.removeAttribute\("data-camera-moving"\)/);
  assert.match(CANVAS, /<div ref=\{shellRef\}/);
});
