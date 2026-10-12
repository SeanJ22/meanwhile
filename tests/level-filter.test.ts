import assert from "node:assert/strict";
import test from "node:test";

import { DISTRICT_TYPES } from "../lib/map/districts.ts";
import {
  DISTRICT_TYPE_TIER,
  districtTypeInTiers,
} from "../lib/ocd/district-tiers.ts";
import { TIERS, type Tier } from "../lib/ocd/tiers.ts";
import { deriveActiveDistrictTypes } from "../lib/state/district-intent.ts";
import type { DistrictType } from "../lib/state/types.ts";

const ALL = [...DISTRICT_TYPES] as DistrictType[];
const draw = (tiers: readonly Tier[]) =>
  deriveActiveDistrictTypes(true, false, ALL, tiers);

test("MAP-5: every overlay type has a level, so none can be silently unfiltered", () => {
  for (const type of ALL) {
    assert.ok(
      TIERS.includes(DISTRICT_TYPE_TIER[type]),
      `${type} has no level; it would ignore the filter`,
    );
  }
  assert.deepEqual(
    [...ALL].sort(),
    Object.keys(DISTRICT_TYPE_TIER).sort(),
  );
});

test("MAP-5: Local off hides local civic overlays and keeps state and federal", () => {
  const drawn = draw(["state", "national"]);

  for (const gone of [
    "school-unified",
    "school-elementary",
    "school-secondary",
    "county",
    "municipal",
  ] as DistrictType[]) {
    assert.ok(!drawn.includes(gone), `${gone} must not be drawn with Local off`);
  }

  assert.ok(drawn.includes("state-house"));
  assert.ok(drawn.includes("state-senate"));
  assert.ok(drawn.includes("congressional"));
});

test("MAP-5: State off hides only the state chambers", () => {
  const drawn = draw(["local", "national"]);
  assert.ok(!drawn.includes("state-house"));
  assert.ok(!drawn.includes("state-senate"));
  assert.ok(drawn.includes("congressional"));
  assert.ok(drawn.includes("county"));
  assert.ok(drawn.includes("school-unified"));
});

test("MAP-5: Federal off hides only the congressional overlay", () => {
  const drawn = draw(["local", "state"]);
  assert.ok(!drawn.includes("congressional"));
  assert.ok(drawn.includes("state-house"));
  assert.ok(drawn.includes("county"));
});

test("MAP-5: all three on draws the full civic overlay set", () => {
  assert.deepEqual(draw(TIERS), ALL);
});

test("MAP-5: all three off draws nothing, and says so rather than reverting", () => {
  assert.deepEqual(draw([]), []);
});

test("MAP-5: re-selecting a level restores exactly what it removed", () => {
  const before = draw(TIERS);
  const withoutLocal = draw(["state", "national"]);
  const restored = draw(TIERS);
  assert.notDeepEqual(withoutLocal, before);
  assert.deepEqual(restored, before);
});

test("MAP-5: a hidden level is not clickable, because both read one list", () => {
  // `map-canvas` hit-tests with the same array it draws from, so the two sets must agree.
  for (const tiers of [
    [],
    ["local"],
    ["state"],
    ["national"],
    ["local", "state"],
    ["state", "national"],
    TIERS,
  ] as Tier[][]) {
    const drawn = deriveActiveDistrictTypes(true, false, ALL, tiers);
    for (const type of ALL) {
      assert.equal(
        drawn.includes(type),
        districtTypeInTiers(type, tiers),
        `${type} drawn/hit-testable disagreed at [${tiers.join(",")}]`,
      );
    }
  }
});

test("MAP-5: the level filter is display-only and composes with the master toggle", () => {
  // The master toggle wins whatever the levels say.
  assert.deepEqual(deriveActiveDistrictTypes(false, false, ALL, TIERS), []);
  assert.deepEqual(deriveActiveDistrictTypes(true, true, ALL, TIERS), []);

  const narrow = deriveActiveDistrictTypes(true, false, ["county"], TIERS);
  assert.deepEqual(narrow, ["county"]);
});
