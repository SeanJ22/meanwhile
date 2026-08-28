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

/**
 * MAP-5 — ONE LEVEL SELECTION, EVERY CIVIC CONSUMER.
 *
 * The reported regression: at 85641 the reader deselected Local, the meeting
 * list emptied, and Vail Unified, Tucson Unified, Sahuarita Unified and the
 * county outline stayed drawn. The control owned the meetings query and not
 * the civic overlays.
 *
 * These assert the PREDICATE, which is what `components/map/map-canvas.tsx`
 * consumes for all three of: which layers it draws, the app-owned labels on
 * them, and `districtsAt(...)` hit-testing. Asserting the button's CSS would
 * have passed against the defect, since the defect screenshot already showed
 * the buttons toggling correctly.
 */

const ALL = [...DISTRICT_TYPES] as DistrictType[];
const draw = (tiers: readonly Tier[]) =>
  deriveActiveDistrictTypes(true, false, ALL, tiers);

/* ------------------------------------------------------- the taxonomy --- */

test("MAP-5: every overlay type has a level, so none can be silently unfiltered", () => {
  for (const type of ALL) {
    assert.ok(
      TIERS.includes(DISTRICT_TYPE_TIER[type]),
      `${type} has no level; it would ignore the filter`,
    );
  }
  // The table and the overlay registry describe the same set — a new overlay
  // cannot be added without answering which level it belongs to.
  assert.deepEqual(
    [...ALL].sort(),
    Object.keys(DISTRICT_TYPE_TIER).sort(),
  );
});

/* --------------------------------------- the reported 85641 regression --- */

test("MAP-5: Local off hides local civic overlays and keeps state and federal", () => {
  const drawn = draw(["state", "national"]);

  // The named regression: these four are exactly what stayed on the map.
  for (const gone of [
    "school-unified",
    "school-elementary",
    "school-secondary",
    "county",
    "municipal",
  ] as DistrictType[]) {
    assert.ok(!drawn.includes(gone), `${gone} must not be drawn with Local off`);
  }

  // ...and the other two levels are untouched. Hiding one level is not a
  // reason to lose the rest of the map.
  assert.ok(drawn.includes("state-house"));
  assert.ok(drawn.includes("state-senate"));
  assert.ok(drawn.includes("congressional"));
});

/* ------------------- the unnamed controls: the other two levels, and all --- */

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
  // A filter that undoes itself is how a reader ends up trusting a wrong
  // answer — the same rule the tier toggle already states for meetings.
  assert.deepEqual(draw([]), []);
});

test("MAP-5: re-selecting a level restores exactly what it removed", () => {
  const before = draw(TIERS);
  const withoutLocal = draw(["state", "national"]);
  const restored = draw(TIERS);
  assert.notDeepEqual(withoutLocal, before);
  assert.deepEqual(restored, before);
});

/* ------------------------------------------------ hit-testing follows --- */

test("MAP-5: a hidden level is not clickable, because both read one list", () => {
  /*
   * `map-canvas` calls `districtsAt(map, event.point, districtTypesRef.current)`
   * with the SAME array it draws from, so a type absent from the derivation
   * cannot be hit-tested. This asserts the property that guarantees it: for
   * every level selection, the drawn set and the hit-testable set are the
   * same set, by construction rather than by a second predicate.
   */
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

/* ------------------------------- the display/truth boundary, asserted --- */

test("MAP-5: the level filter is display-only and composes with the master toggle", () => {
  // Master toggle off still wins, whatever the levels say — the filter can
  // only ever subtract from what the reader already asked to see.
  assert.deepEqual(deriveActiveDistrictTypes(false, false, ALL, TIERS), []);
  assert.deepEqual(deriveActiveDistrictTypes(true, true, ALL, TIERS), []);

  // And it never invents an overlay the reader did not select: the level
  // filter narrows the checkbox selection, never widens it.
  const narrow = deriveActiveDistrictTypes(true, false, ["county"], TIERS);
  assert.deepEqual(narrow, ["county"]);
});
