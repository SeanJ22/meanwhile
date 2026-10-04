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

test("every feature keeps exactly the properties the map needs plus GEOID", async () => {
  // GEOID joined the retained set 2026-08-13: complete by construction and
  // exact (it matched 100% on every layer in the M17 TIGER join), it is what
  // lets the OCD convention be re-derived from an exact key if it ever has to
  // change, instead of being rebuilt from name fields and slug rules that
  // already produced 348 canonical-match misses. Cost across all files:
  // ~15.8 KB.
  const features = await loadFeatures();
  for (const feature of features) {
    assert.deepEqual(
      Object.keys(feature.properties).sort(),
      ["district", "geoid", "label", "ocdId", "state"],
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

test("item 6b: no Census placeholder name reaches a reader as a district's name", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { CENSUS_PLACEHOLDER_LABELS } = await import("../lib/registry/census-placeholders.ts");
  const { registryRuntimeFirstSeed } = await import("../lib/registry/runtime-read-model.ts");

  // The author's finding at the Tohono O'odham reservation area: the map
  // rendered a district called "School District Not Defined". Both halves
  // of his question were true — it IS a real gap geometry (Census GEOID
  // 0499997, land inside no unified school district, adjacent to Indian
  // Oasis-Baboquivari rather than on top of it), and it WAS a labeling
  // defect. The geometry stays because it is a true fact about the place;
  // the NAME becomes the fact.
  //
  // Every committed school-district boundary of every state, never a hand-kept
  // list. New Hampshire's placeholder (GEOID 3399997) stayed on its map until
  // 2026-09-23 through two holes: this guard read Arizona's boundary file only,
  // and its pattern, built with an unescaped `\s` (a literal `s`), could never
  // match the pretty-printed registry where New Hampshire's raw label sits.
  const pattern = (placeholder: string) => new RegExp(`"(?:label|name|NAME)"\\s*:\\s*"${placeholder}"`);
  assert.ok(pattern("School District Not Defined").test('{"NAME": "School District Not Defined"}'), "the guard's own pattern matches what it exists to catch");
  const states = join(process.cwd(), "data", "states");
  const files = readdirSync(states).flatMap((state) => {
    try {
      return readdirSync(join(states, state, "geo")).filter((f) => /^(unsd|elsd|scsd)-\d{2}\.geojson$/.test(f)).map((f) => join(states, state, "geo", f));
    } catch {
      return [];
    }
  });
  assert.ok(files.length >= 3, "every committed school-district boundary file is checked");
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const placeholder of Object.keys(CENSUS_PLACEHOLDER_LABELS)) {
      assert.ok(!pattern(placeholder).test(text), `${file} still labels a division "${placeholder}" — run scripts/normalize-census-placeholders.mts`);
    }
  }
  for (const [state, fips] of [["az", "04"], ["nh", "33"]]) {
    const text = readFileSync(join(states, state, "geo", `unsd-${fips}.geojson`), "utf8");
    assert.ok(text.includes("No unified school district here"), `${state} lost the honest label — the geometry must stay, only the name changes`);
  }

  // The registry as a reader gets it names no division by a placeholder. The
  // frozen first seed still carries New Hampshire's raw label; its composition
  // (and every registry promotion) translates it.
  const seed = registryRuntimeFirstSeed().value;
  for (const division of seed.registry.divisions) {
    assert.ok(!Object.hasOwn(CENSUS_PLACEHOLDER_LABELS, division.label), `${division.ocdId} is labelled "${division.label}" in the composed registry`);
  }

  // The slug stays: it is a join key, never rendered, and renaming it would
  // break every stored reference for a cosmetic reason.
  const registry = readFileSync(join(process.cwd(), "lib", "registry", "registry.json"), "utf8");
  assert.ok(
    registry.includes("school_district:school_district_not_defined"),
    "the ocdId must not have been rewritten — it is a join key",
  );
});

test("item 6b: every tool that counts the frozen registry's bodies leaves out the placeholder boards", async () => {
  const { readFileSync } = await import("node:fs");
  // The frozen first seed still holds the two boards once minted on Census
  // placeholders, and its bytes are proof-bound, so each tool that counts or
  // emits its bodies reads them through withoutPlaceholderBodies
  // (lib/registry/census-placeholders.ts). class-stamp-sweep takes its bodies
  // from body-forms.json, which stamp-body-forms writes through the same view.
  for (const tool of [
    "scripts/stamp-body-forms.mts",
    "scripts/stamp-coverage-tiers.mts",
    "scripts/denominator-reconcile.mts",
    "scripts/embedded-json-census.mts",
    "scripts/measure-definitions-0823.mts",
    "scripts/coverage-four-layer.mts",
    "scripts/census-who-governs.mts",
  ]) {
    assert.match(readFileSync(tool, "utf8"), /withoutPlaceholderBodies\(JSON\.parse\(/, `${tool} reads the frozen registry's bodies without the placeholder rule`);
  }
  for (const artifact of ["data/derived/body-forms.json", "data/derived/class-stamp-sweep.json"]) {
    assert.doesNotMatch(readFileSync(artifact, "utf8"), /school_district_not_defined#board/, `${artifact} still carries a placeholder board`);
  }
});

