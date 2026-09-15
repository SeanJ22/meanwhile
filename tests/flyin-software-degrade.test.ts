/** Renderer classification and normalized performance floors remain valid.
 * The motion hold is scoped BACK to a positively-identified software
 * rasteriser (reversing V94's every-renderer hold, which blanked the district
 * lines, the pins and the who-governs card for every reader on a GPU); and the
 * data layer never waits for the camera. Runtime frame evidence is recorded
 * separately. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  SOFTWARE_RENDERER_NAMES,
  classifyRenderer,
} from "../components/map/raster-capability.ts";
import {
  judgeSoftware,
  SOFTWARE_JANK_CEILING,
  SOFTWARE_NORMALIZED_FLOOR,
  summariseArm,
  type ArmSummary,
} from "../lib/ops/flyin-normalized.ts";

const ROOT = join(import.meta.dirname, "..");
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

const PRESENTATION = readFileSync(join(ROOT, "lib", "map", "flight-presentation.ts"), "utf8");
const MAP_ENTRY = readFileSync(join(ROOT, "components", "map", "map-entry.tsx"), "utf8");

test("the motion hold is scoped to a software rasteriser, not every renderer", () => {
  /*
   * B (2026-09-14): V94 (8f37c059) made the motion hold unconditional on every
   * renderer, which blanked the overlays on a wheel-zoom for readers on a GPU.
   * The 2026-09-01 scoping (db727666) is restored: the hold runs ONLY on a
   * positively-identified CPU rasteriser. Hardware and unknown hide nothing.
   */
  assert.match(CANVAS, /const degradeInMotion = detectRaster\(\)\.kind === "software";/);
  const enter = CANVAS.slice(
    CANVAS.indexOf("const enterMotionDegrade"),
    CANVAS.indexOf("const onPresentationIdle"),
  );
  assert.match(enter, /if \(!degradeInMotion\) return;/, "enterMotionDegrade must no-op off a software rasteriser");
  /*
   * The mount-time hold and its first-idle reveal stay UNCONDITIONAL, so every
   * renderer still reveals its overlays once the first style has drawn — the
   * scoping is on the motion re-hold, never on the one-time reveal.
   */
  assert.match(CANVAS, /map\.on\("idle", onPresentationIdle\);/);
  const idle = CANVAS.slice(CANVAS.indexOf("const onPresentationIdle"), CANVAS.indexOf('map.on("idle", onPresentationIdle)'));
  assert.match(idle, /map\.isMoving\(\) \|\| !mapPresentationHeld\(map\)/);
  assert.match(idle, /releaseMapPresentation\(map\)/);
  assert.match(idle, /ensureDistricts\(\)/);
  const end = CANVAS.slice(CANVAS.indexOf("const onMoveEnd"), CANVAS.indexOf('map.on("movestart", onMoveStart)'));
  assert.ok(!end.includes("releaseMapPresentation(") && !end.includes("setPresentationVisible("));
});

test("the data layer never waits for the camera: the meetings fetch is not gated on map readiness", () => {
  /*
   * A (2026-09-14): the meetings request fires the moment a `view` is known and
   * is torn down only by a view/retry change — never by the map's first `idle`
   * or by a motion that flips presentation readiness. Chaining it behind the
   * camera is what sat the panel at "0 Meetings / — Bodies / — Officials".
   */
  assert.ok(MAP_ENTRY.includes("/api/meetings"), "map-entry owns the meetings fetch");
  // The fetch effect's only early return is on a missing view.
  assert.match(MAP_ENTRY, /if \(!view\) return;\n\n    const controller = new AbortController\(\);/);
  // Its dependency array is the view and the retry nonce — no readiness flag.
  assert.ok(MAP_ENTRY.includes("}, [view, retryNonce]);"), "fetch deps are [view, retryNonce]");
  // The stale-closure readiness ref that used to gate the answer is gone.
  assert.ok(!MAP_ENTRY.includes("mapPresentationReadyRef"), "no readiness ref gates the fetch");
});

test("holding keeps sources cached, hides application layers, and removes the DOM state art from the map", () => {
  assert.match(PRESENTATION, /setLayoutProperty\(layer.id, "visibility", visible \? "visible" : "none"\)/);
  assert.ok(!PRESENTATION.includes("removeLayer") && !PRESENTATION.includes("removeSource"));
  assert.ok(!CANVAS.includes("<StateFocusOverlay"));
  assert.match(CANVAS, /if \(!map \|\| mapPresentationHeld\(map\)/);
  assert.match(CANVAS, /shellRef\.current\?\.setAttribute\("data-camera-moving", "1"\)/);
  assert.match(CANVAS, /shellRef\.current\?\.removeAttribute\("data-camera-moving"\)/);
});

/* ------------------------------------------- 4: the software verdict --- */

/**
 * An arm built from one repeated frame interval, so the fps and the jank share
 * are both exactly what the caller asked for.
 *
 * Built through `summariseArm` rather than by hand: the verdict has to be
 * tested against the same reduction the walk and the instrument both use, or
 * this file would be asserting about a shape nothing produces.
 */
function armAt(fps: number, longFrames: number, frames: number): ArmSummary {
  const fast = 1000 / fps;
  /* The long frames sit at the front and are always a minority here, so they
     never move the median — which is the whole property being demonstrated. */
  const gaps = Array.from({ length: frames }, (_, i) => (i < longFrames ? 400 : fast));
  return summariseArm("test", [{ gaps, hostBusyPct: null }]);
}

test("the software floor and the jank ceiling are the stated numbers", () => {
  /*
   * Asserted rather than merely used. A later session lowering the floor to
   * turn a red run green would otherwise change the criterion silently, which
   * is what the retired absolute 55 fps target was retired for.
   */
  assert.equal(SOFTWARE_NORMALIZED_FLOOR, 0.75);
  assert.equal(SOFTWARE_JANK_CEILING, 0.2);
});

test("the software verdict requires BOTH the ratio and the jank share", () => {
  const bare = armAt(60, 0, 200);

  /* Roughly the shipped state: over the ratio, well under the jank ceiling. */
  const good = judgeSoftware(armAt(50, 5, 200), bare);
  assert.equal(good.ratioPass, true);
  assert.equal(good.jankPass, true);
  assert.equal(good.pass, true);

  /*
   * **THE CASE THE CEILING EXISTS FOR, AND IT IS NOT HYPOTHETICAL.** A build
   * measured at 89% of bare with 57 of 231 frames past 33.4 ms — a ratio that
   * clears the floor comfortably over a flight with a quarter of its frames
   * visibly late. The ratio alone calls that finished.
   */
  const janky = judgeSoftware(armAt(53, 50, 200), bare);
  assert.equal(janky.ratioPass, true);
  assert.equal(janky.jankPass, false);
  assert.equal(janky.pass, false, "a ratio that clears the floor must not carry a janky flight");

  /* The mirror: smooth frames at a rate far below a bare map is still a
     failure. Neither condition may stand in for the other. */
  const slow = judgeSoftware(armAt(30, 0, 200), bare);
  assert.equal(slow.ratioPass, false);
  assert.equal(slow.jankPass, true);
  assert.equal(slow.pass, false);
});

test("the software verdict refuses an arm that measured nothing", () => {
  /*
   * A ratio taken against a zero-rate bare arm is infinite, and an infinite
   * ratio is a green check for a measurement that never happened — the worst
   * result available here. `summariseArm` refuses an empty population first,
   * which is the same rule one layer up.
   */
  assert.throws(() => summariseArm("empty", []), /completed ZERO runs/);
  assert.throws(
    () => judgeSoftware(armAt(50, 0, 200), { ...armAt(60, 0, 200), medianFps: 0 }),
    /refusing/,
  );
  assert.throws(
    () => judgeSoftware({ ...armAt(50, 0, 200), framesMeasured: 0 }, armAt(60, 0, 200)),
    /ZERO frames/,
  );
});
