/** Renderer classification and normalized performance floors; the motion hold is scoped to a positively identified software rasteriser, and the data layer never waits for the camera. */
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

test("the renderer strings this was measured through classify as software", () => {
  /* The exact `WEBGL_debug_renderer_info` string from a software-rendering host. */
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
  /* Degradation requires a positive identification, never an inference from silence. */
  for (const value of [null, undefined, "", "   "]) {
    assert.equal(classifyRenderer(value), "unknown", JSON.stringify(value));
  }
  assert.notEqual(classifyRenderer(null), "software");
});

const PRESENTATION = readFileSync(join(ROOT, "lib", "map", "flight-presentation.ts"), "utf8");
const MAP_ENTRY = readFileSync(join(ROOT, "components", "map", "map-entry.tsx"), "utf8");

test("the motion hold is scoped to a software rasteriser, not every renderer", () => {
  /* The motion hold runs only on a positively identified CPU rasteriser; hardware and unknown hide nothing. */
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
  /* The meetings request fires as soon as a `view` is known and is torn down only by a view or retry change. */
  assert.ok(MAP_ENTRY.includes("/api/meetings"), "map-entry owns the meetings fetch");
  // The fetch effect's only early return is on a missing view.
  assert.match(MAP_ENTRY, /if \(!view\) return;\n\n    const controller = new AbortController\(\);/);
  // Its dependency array is the view and the retry nonce — no readiness flag.
  assert.ok(MAP_ENTRY.includes("}, [view, retryNonce]);"), "fetch deps are [view, retryNonce]");
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

/** An arm built from one repeated frame interval, through the same `summariseArm` reduction the walk uses. */
function armAt(fps: number, longFrames: number, frames: number): ArmSummary {
  const fast = 1000 / fps;
  /* The long frames sit at the front and are always a minority here, so they
     never move the median — which is the whole property being demonstrated. */
  const gaps = Array.from({ length: frames }, (_, i) => (i < longFrames ? 400 : fast));
  return summariseArm("test", [{ gaps, hostBusyPct: null }]);
}

test("the software floor and the jank ceiling are the stated numbers", () => {
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

  /* A ratio over the floor with a quarter of its frames late still fails on the jank ceiling. */
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
  /* A ratio against a zero-rate bare arm is infinite; `summariseArm` refuses an empty population first. */
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
