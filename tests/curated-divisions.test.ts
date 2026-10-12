import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CURATED_PREFIX,
  divisionKeyFor,
  isCurated,
  mintCuratedDivision,
  proposedOcdId,
  slugFor,
} from "../lib/ocd/curated.ts";
import { resolveVenue, venueScope, VENUE_CACHE } from "../lib/meetings/venue-cache.ts";

/**
 * Identifiers for governments the Census does not enumerate stay distinguishable from opencivicdata's, and the venue
 * key does not collapse when a body has no division.
 */

const PIMA = "ocd-division/country:us/state:az/county:pima";

test("a curated identifier says it is ours in its first characters", () => {
  // An OCD path opencivicdata does not carry, written in its namespace, would be indistinguishable from a real one.
  const id = mintCuratedDivision(PIMA, "water", "Ajo Domestic Water Improvement District");
  assert.ok(id.startsWith(CURATED_PREFIX));
  assert.ok(isCurated(id));
  assert.equal(
    id,
    `${CURATED_PREFIX}${PIMA}/water:ajo_domestic_water_improvement_district`,
  );
});

test("stripping the prefix leaves the identifier we would propose upstream", () => {
  const id = mintCuratedDivision(PIMA, "water", "Ajo Domestic Water Improvement District");
  const proposed = proposedOcdId(id);
  assert.equal(proposed, `${PIMA}/water:ajo_domestic_water_improvement_district`);
  // The shape is opencivicdata's own, observed in its list: a function
  // segment under the containing county, slugged from the published name.
  assert.match(proposed!, /^ocd-division\/country:us\/state:az\/county:pima\/water:[a-z0-9_]+$/);
  assert.equal(proposedOcdId(PIMA), null, "a canonical id proposes nothing");
});

test("the slug rule matches the canonical list's own slugs", () => {
  assert.equal(slugFor("Castaic Lake Water Agency"), "castaic_lake_water_agency");
  assert.equal(slugFor("Harkers Island"), "harkers_island");
  assert.equal(slugFor("Rocking K South Community Facilities District"), "rocking_k_south_community_facilities_district");
});

test("a malformed mint throws rather than returning a wrong key", () => {
  // An identifier is a join key, so a silently wrong one must be checkable.
  assert.throws(() => mintCuratedDivision("state:az", "water", "Something"), /OCD parent/);
  assert.throws(() => mintCuratedDivision(PIMA, "Water District", "Something"), /snake_case/);
  assert.throws(() => mintCuratedDivision(PIMA, "water", "!!!"), /empty slug/);
});

test("two division-less bodies on one source do not share a venue scope", () => {
  // `bodyOcdId` is null for every division-less body, and null === null, so the key must not rely on it alone.
  assert.notEqual(venueScope(null, "pcc"), venueScope(null, "some-other-district"));
  assert.equal(venueScope(null, "pcc"), venueScope(null, "pcc"));
});

test("a body WITH a division still keys on its division", () => {
  // The fix must not change the common case: a division is already unique.
  assert.equal(venueScope(PIMA, "anything"), PIMA);
  assert.equal(venueScope(PIMA, null), PIMA);
});

test("the division-less venue rows resolve for their own tenant and nobody else's", () => {
  const rows = VENUE_CACHE.filter((v) => v.bodyOcdId === null);
  assert.ok(rows.length > 0, "the fixture for this case must still exist");
  for (const row of rows) {
    assert.ok(row.tenant, `${row.match} has no division and no tenant — its key collapses`);
    assert.ok(
      resolveVenue(row.sourceId, null, row.match, row.tenant!),
      `${row.match} should resolve for its own tenant`,
    );
    assert.equal(
      resolveVenue(row.sourceId, null, row.match, "a-different-tenant"),
      undefined,
      `${row.match} must not resolve for another division-less body on the same source`,
    );
  }
});

test("a body's own id is the last resort for a division key", () => {
  // Used where no tenant is available. It is unique by construction, so the
  // key still cannot collapse.
  assert.equal(
    divisionKeyFor({ id: "curated:az/pima-community-college#governing", ocdId: null }),
    `${CURATED_PREFIX}body/curated:az/pima-community-college#governing`,
  );
  assert.equal(divisionKeyFor({ id: "anything", ocdId: PIMA }), PIMA);
});
