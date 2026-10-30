import assert from "node:assert/strict";
import test from "node:test";
import { autonomousCycleAllowed } from "../lib/control-plane/workers/coordinator.ts";

test("filtered and explicitly paused cycles cannot start either autonomous slice", () => {
  const active = { dry: false, canary: false, only: null, ids: null, runnerPaused: false };
  assert.equal(autonomousCycleAllowed(active), true);
  for (const blocked of [{ only: "roster" }, { ids: new Set(["wi-1"]) }, { runnerPaused: true },
    { dry: true }, { canary: true }]) {
    assert.equal(autonomousCycleAllowed({ ...active, ...blocked }), false);
  }
});

