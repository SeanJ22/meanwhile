import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveZip } from "../lib/geo/zcta.ts";
import { RADIUS_LADDER_KM, searchMeetings } from "../lib/meetings/query.ts";
import { applyFilters } from "../lib/state/derive.ts";
import { INITIAL_STATE, uiReducer } from "../lib/state/reducer.ts";

/**
 * What a reader actually ends up looking at, from a real zip.
 *
 * `cascade.test.ts` covers the server's rungs from bare coordinates. Nothing
 * covered the whole path — zip → centroid → cascade → the client-side filter
 * every surface reads — which is why 85641 could return fourteen meetings on
 * the server and render an empty map without a test noticing.
 */

/** Resolve a target zip, failing loudly rather than silently skipping. */
function centroidFor(zip: string) {
  const resolved = resolveZip(zip);
  assert.ok(resolved.ok, `${zip} must resolve to a centroid`);
  return resolved.centroid;
}

/** The list the map, stats, legend and list overlay all render from. */
function visible(
  meetings: Awaited<ReturnType<typeof searchMeetings>>["meetings"],
  ui = INITIAL_STATE,
  center: { lat: number; lng: number } | null = null,
) {
  return applyFilters({ meetings, ui, center });
}

test("85641 lands on the widened rung and returns meetings", async () => {
  const { lat, lng } = centroidFor("85641");
  const result = await searchMeetings(lat, lng);

  // Vail's nearest fixture venue is ~37 km away, so the first rung can never
  // answer this zip. It must widen rather than report an empty map.
  assert.equal(result.tier, "widened");
  assert.ok(
    result.radiusKm > RADIUS_LADDER_KM[0],
    "a widened result must report a radius past the first rung",
  );
  assert.ok(result.meetings.length > 0, "expected meetings for 85641");
});

test("every target zip survives the client filter with default state", async () => {
  for (const zip of ["85701", "85641", "07866", "03255"]) {
    const { lat, lng } = centroidFor(zip);
    const result = await searchMeetings(lat, lng);

    assert.ok(result.meetings.length > 0, `${zip}: cascade returned nothing`);
    assert.equal(
      visible(result.meetings).length,
      result.meetings.length,
      `${zip}: the default filter state dropped meetings the cascade found`,
    );
  }
});

test("enabling the radius limiter keeps the widened results on screen", async () => {
  const { lat, lng } = centroidFor("85641");
  const result = await searchMeetings(lat, lng);

  // The control seeds itself from the rung the visible results came from.
  // Seeding the untouched default instead emptied the map the instant a
  // reader touched the toggle, which is the 85641 defect.
  const enabled = uiReducer(INITIAL_STATE, {
    type: "radius/set",
    km: result.radiusKm,
  });

  assert.equal(enabled.radiusOverridden, true);
  assert.ok(
    visible(result.meetings, enabled, { lat, lng }).length > 0,
    "turning on the radius limiter must not blank a widened result",
  );
});

test("clearing the radius limiter actually turns it off", () => {
  const enabled = uiReducer(INITIAL_STATE, { type: "radius/set", km: 25 });
  const cleared = uiReducer(enabled, { type: "radius/clear" });

  assert.equal(cleared.radiusOverridden, false);
  assert.equal(cleared.radiusKm, RADIUS_LADDER_KM[0]);
});

test("clearing the radius limiter leaves unrelated filters alone", () => {
  // It used to dispatch `filter/reset`, so switching off one toggle wiped the
  // body-type chips, the status chips, the date window and the district types.
  const withFilters = uiReducer(INITIAL_STATE, {
    type: "filter/toggleBodyType",
    value: "school-board",
  });
  const enabled = uiReducer(withFilters, { type: "radius/set", km: 25 });
  const cleared = uiReducer(enabled, { type: "radius/clear" });

  assert.deepEqual(cleared.filters.bodyTypes, ["school-board"]);
});
