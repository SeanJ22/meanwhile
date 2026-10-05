import assert from "node:assert/strict";
import test from "node:test";
import { startMap } from "../lib/map/start-map.ts";

test("map construction failures and partial maps leave the page usable", () => {
  assert.equal(startMap(() => { throw new Error("WebGL disabled"); }), null);
  let removed = false;
  assert.equal(startMap(() => ({
    getCanvas: () => { throw new Error("No canvas"); },
    remove: () => { removed = true; },
  })), null);
  assert.ok(removed);
});

test("a complete map starts and rotation is disabled", () => {
  let disabled = false;
  const map = {
    touchZoomRotate: { disableRotation: () => { disabled = true; } },
    getCanvas: () => ({} as HTMLCanvasElement),
    remove: () => {},
  };
  assert.equal(startMap(() => map), map);
  assert.ok(disabled);
});
