import assert from "node:assert/strict";
import test from "node:test";

import { INITIAL_STATE } from "../lib/state/defaults.ts";
import { uiReducer as reducer } from "../lib/state/reducer.ts";
import {
  activeControlCount,
  NON_CONTROL_FIELDS,
  RESETTABLE_CONTROLS,
  resetAllControls,
} from "../lib/state/reset.ts";
import type { UiState } from "../lib/state/types.ts";

/**
 * The registry guard behind "Reset all does not work" (M24).
 *
 * The defect's mechanism: controls accreted around a reset handler that
 * only knew about `filters`, and an active-count that treated the default
 * district-type view as an active filter — so the badge read 1 on a fresh
 * page and Reset all visibly did nothing. These tests make both structural:
 * a new UiState field must register a reset or declare why it is not a
 * control, and "no controls active" must be exactly the default state.
 */

test("every UiState field is either a registered control or declared non-control", () => {
  const owned = new Set<string>(
    RESETTABLE_CONTROLS.flatMap((c) => c.owns as string[]),
  );
  const declared = new Set(Object.keys(NON_CONTROL_FIELDS));

  for (const key of Object.keys(INITIAL_STATE)) {
    const isOwned = owned.has(key);
    const isDeclared = declared.has(key);
    assert.ok(
      isOwned || isDeclared,
      `UiState.${key} is neither owned by a resettable control nor declared ` +
        `non-control — decide its reset in lib/state/reset.ts before shipping it`,
    );
    assert.ok(
      !(isOwned && isDeclared),
      `UiState.${key} is both a control and a non-control — pick one`,
    );
  }

  // And nothing stale: every claimed key must still exist.
  for (const key of [...owned, ...declared]) {
    assert.ok(
      key in INITIAL_STATE,
      `${key} is registered but no longer exists on UiState`,
    );
  }
});

test("the default state has zero active controls, and reset returns to it", () => {
  // The badge must read 0 on a fresh page — the old count read 1 because the
  // default district-type view was misdefined as active.
  assert.equal(activeControlCount(INITIAL_STATE), 0);

  // Distort every control, then reset; every control must go quiet.
  const distorted: UiState = {
    ...INITIAL_STATE,
    tiers: ["local"],
    jurisdiction: "ocd-division/country:us/state:az/place:tucson",
    body: "ocd-division/country:us/state:az/place:tucson|Planning Commission",
    filters: {
      bodyTypes: ["council"],
      statuses: ["SCHEDULED"],
      districtTypes: [],
      daysAhead: 10,
      daysBack: 5,
      hideUncovered: false,
    },
    search: { query: "water", open: true, highlighted: 0 },
    radiusKm: 150,
    radiusOverridden: true,
    nearMeEnabled: true,
    nearMe: { lat: 32, lng: -110 },
  };
  assert.ok(activeControlCount(distorted) >= 9, "the distortion should trip every control");

  const reset = resetAllControls(distorted);
  assert.equal(activeControlCount(reset), 0);
  assert.deepEqual(reset.tiers, INITIAL_STATE.tiers);
  assert.equal(reset.jurisdiction, null);
  assert.deepEqual(reset.filters, INITIAL_STATE.filters);
  assert.equal(reset.radiusOverridden, false);
  assert.equal(reset.nearMeEnabled, false);

  // Reset is about controls, not selections: what the reader was looking at
  // stays open.
  const withSelection = { ...distorted, selectedVenueKey: "v1" };
  assert.equal(resetAllControls(withSelection).selectedVenueKey, "v1");
});

test("the reducer's filter/reset applies the registry", () => {
  const distorted: UiState = {
    ...INITIAL_STATE,
    tiers: ["state"],
    radiusOverridden: true,
    filters: { ...INITIAL_STATE.filters, districtTypes: [] },
  };
  const next = reducer(distorted, { type: "filter/reset" });
  assert.equal(activeControlCount(next), 0);
  assert.deepEqual(next.filters.districtTypes, INITIAL_STATE.filters.districtTypes);
  assert.deepEqual(next.tiers, INITIAL_STATE.tiers);
});

test("select all and clear set the district types outright, in canonical order", () => {
  const all = reducer(INITIAL_STATE, {
    type: "filter/districtTypesSet",
    value: [
      "municipal",
      // M12 (2026-08-17): deliberately shuffled, and deliberately naming all
      // three school types — canonical order is what this test asserts, and
      // it has to survive the split rather than be re-derived from it.
      "school-elementary",
      "school-secondary",
      "school-unified",
      "county",
      "state-house",
      "state-senate",
      "congressional",
    ],
  });
  assert.deepEqual(all.filters.districtTypes, [
    "congressional",
    "state-senate",
    "state-house",
    "county",
    "school-unified",
    "school-elementary",
    "school-secondary",
    "municipal",
  ]);

  const none = reducer(all, { type: "filter/districtTypesSet", value: [] });
  assert.deepEqual(none.filters.districtTypes, []);

  // All-on IS the default now (session item 2, 2026-08-14 second session:
  // every layer defaults on so a counted body is always reachable), so
  // all-on must NOT read as an active control — the M24 badge counted the
  // default view as active once already. Clearing every type is not the
  // default and does read active.
  assert.equal(activeControlCount(all), 0);
  assert.ok(activeControlCount(none) > 0);
  const reset = reducer(none, { type: "filter/reset" });
  assert.deepEqual(reset.filters.districtTypes, INITIAL_STATE.filters.districtTypes);
});
