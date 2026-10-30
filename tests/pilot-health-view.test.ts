import assert from "node:assert/strict";
import test from "node:test";

import { contractHealthLevel } from "../lib/control-plane/owner-surface.ts";

/**
 * The pilot-health view is a pure projection: `overall` follows `pilotGreen` exactly, and the view only adds the
 * failing-vs-stale distinction (RED vs AMBER) the contract states already carry.
 */

test("the level mapping is exactly the four states", () => {
  assert.equal(contractHealthLevel("GREEN"), "GREEN");
  assert.equal(contractHealthLevel("RED"), "RED");
  assert.equal(contractHealthLevel("NOT_READY"), "AMBER");
  assert.equal(contractHealthLevel("AWAITING_OWNER_DATA"), "AMBER");
  assert.equal(contractHealthLevel("nonsense"), "UNKNOWN");
});
