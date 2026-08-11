import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { districtIdentity } from "../lib/ocd/fips.ts";

const here = dirname(fileURLToPath(import.meta.url));
const GEOJSON = join(here, "..", "public", "geo", "cd119.geojson");

/**
 * Seats in the 119th Congress: 435 voting districts, plus six non-voting
 * delegations that still occupy territory on a map — DC, American Samoa, Guam,
 * the Northern Mariana Islands, Puerto Rico, and the US Virgin Islands.
 *
 * Asserting the total is what catches a district silently vanishing during
 * simplification. A missing geometry does not throw; it just stops drawing.
 */
const EXPECTED_FEATURES = 441;

/* ------------------------------------------------- GEOID to OCD-ID ------- */

test("ordinary district builds a numbered OCD-ID", () => {
  const id = districtIdentity("04", "07");
  assert.deepEqual(id, {
    ocdId: "ocd-division/country:us/state:az/cd:7",
    state: "AZ",
    district: "7",
    label: "AZ-7",
  });
});

test("leading zeros are stripped rather than carried into the identifier", () => {
  assert.equal(
    districtIdentity("34", "11")?.ocdId,
    "ocd-division/country:us/state:nj/cd:11",
  );
  assert.equal(
    districtIdentity("33", "01")?.ocdId,
    "ocd-division/country:us/state:nh/cd:1",
  );
});

test("at-large state uses cd:at-large, not cd:1 and not the raw 00 code", () => {
  const id = districtIdentity("56", "00"); // Wyoming
  assert.equal(id?.ocdId, "ocd-division/country:us/state:wy/cd:at-large");
  assert.equal(id?.district, "AL");
  assert.equal(id?.label, "WY-AL");
  // The Census code must not leak through into the identifier.
  assert.ok(!id?.ocdId.includes("00"));
});

test("territory keeps the territory prefix and still carries a cd segment", () => {
  const pr = districtIdentity("72", "98"); // Puerto Rico
  assert.equal(pr?.ocdId, "ocd-division/country:us/territory:pr/cd:at-large");
  assert.equal(pr?.state, "PR");
  // Bare territory:pr names the jurisdiction, not the seat inside it.
  assert.notEqual(pr?.ocdId, "ocd-division/country:us/territory:pr");
});

test("DC uses the district prefix rather than being forced into state:", () => {
  const dc = districtIdentity("11", "98");
  assert.equal(dc?.ocdId, "ocd-division/country:us/district:dc/cd:at-large");
  assert.ok(!dc?.ocdId.includes("state:dc"));
});

test("water and unassigned codes are dropped", () => {
  assert.equal(districtIdentity("06", "ZZ"), null);
});

test("an unknown state FIPS is dropped rather than guessed at", () => {
  assert.equal(districtIdentity("99", "01"), null);
});

/* ------------------------------------------- the generated file ---------- */

interface DistrictFeature {
  type: string;
  properties: { ocdId: string; state: string; district: string; label: string };
  geometry: { type: string; coordinates: unknown[] };
}

async function loadFeatures(): Promise<DistrictFeature[]> {
  const raw = await readFile(GEOJSON, "utf8");
  const parsed = JSON.parse(raw) as { features: DistrictFeature[] };
  return parsed.features;
}

test("every feature carries a well-formed OCD-ID", async () => {
  const features = await loadFeatures();
  // Every seat is <jurisdiction>/cd:<number|at-large>. Verified against
  // opencivicdata/ocd-division-ids on 2026-08-11.
  const pattern =
    /^ocd-division\/country:us\/(state:[a-z]{2}|district:dc|territory:[a-z]{2})\/cd:(\d+|at-large)$/;

  for (const feature of features) {
    assert.match(
      feature.properties.ocdId,
      pattern,
      `bad ocdId: ${feature.properties.ocdId}`,
    );
  }
});

test("no two features share an OCD-ID", async () => {
  const features = await loadFeatures();
  const seen = new Map<string, number>();
  for (const feature of features) {
    seen.set(feature.properties.ocdId, (seen.get(feature.properties.ocdId) ?? 0) + 1);
  }
  const duplicates = [...seen].filter(([, n]) => n > 1);
  assert.deepEqual(duplicates, [], `duplicate ocdId(s): ${JSON.stringify(duplicates)}`);
});

test("feature count matches the 119th Congress after drops", async () => {
  const features = await loadFeatures();
  assert.equal(
    features.length,
    EXPECTED_FEATURES,
    `expected ${EXPECTED_FEATURES} features (435 districts + DC + 5 territories); ` +
      `got ${features.length}. A geometry may have been dropped during simplification.`,
  );
});

test("every feature keeps exactly the four properties the map needs", async () => {
  const features = await loadFeatures();
  for (const feature of features) {
    assert.deepEqual(
      Object.keys(feature.properties).sort(),
      ["district", "label", "ocdId", "state"],
      `unexpected properties on ${feature.properties.ocdId}`,
    );
  }
});

test("every feature has drawable polygon geometry", async () => {
  const features = await loadFeatures();
  for (const feature of features) {
    assert.ok(
      feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon",
      `${feature.properties.ocdId} has geometry type ${feature.geometry.type}`,
    );
    assert.ok(
      feature.geometry.coordinates.length > 0,
      `${feature.properties.ocdId} has empty coordinates`,
    );
  }
});
