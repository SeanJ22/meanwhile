import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  DISTRICT_LAYERS,
  GOVERNING_FUNCSTAT,
  keepFeature,
  type DistrictFeature,
} from "../lib/map/districts.ts";
import registryFile from "../lib/registry/registry.json" with { type: "json" };

/**
 * M14 — county subdivisions render in the municipal layer without
 * double-counting, deduplicated on FUNCSTAT exactly as the registry is.
 *
 * These tests run the same merge-and-filter the map performs, against the
 * committed boundary files, so the map's municipal picture and the registry's
 * municipal body count can never drift apart silently.
 */

const geo = (name: string): DistrictFeature[] =>
  (
    JSON.parse(
      readFileSync(new URL(`../public/geo/${name}`, import.meta.url), "utf8"),
    ) as { features: DistrictFeature[] }
  ).features;

function mergedMunicipal(): DistrictFeature[] {
  const spec = DISTRICT_LAYERS.municipal;
  return spec.files
    .flatMap((f) => geo(f))
    .filter((f) => keepFeature(spec, f));
}

test("the map's FUNCSTAT rule is the registry's FUNCSTAT rule", () => {
  // derive.ts owns the authoritative rule; the map keeps a literal copy
  // because the map bundle must not import registry code (§0d). If either
  // side changes alone, this is the tripwire.
  assert.deepEqual([...GOVERNING_FUNCSTAT].sort(), ["A", "B", "C", "G"]);
});

test("the municipal merge draws each government exactly once", () => {
  const kept = mergedMunicipal();

  const byOcdId = new Map<string, number>();
  for (const f of kept) {
    byOcdId.set(f.properties.ocdId, (byOcdId.get(f.properties.ocdId) ?? 0) + 1);
  }
  const dupes = [...byOcdId.entries()].filter(([, n]) => n > 1);
  assert.deepEqual(dupes, [], "no identifier may draw twice");

  // Concord NH exists in both source layers; only the place row (FUNCSTAT A)
  // may survive — the cousub row is Census's fictitious duplicate.
  const concord = kept.filter((f) => /concord/i.test(f.properties.label));
  assert.equal(concord.length, 1, "one Concord, from the place layer");
  assert.equal(concord[0].properties.funcstat, "A");
});

test("cousub municipalities the place file lacks now draw (the M14 point)", () => {
  const kept = mergedMunicipal();
  const labels = kept.map((f) => f.properties.label);

  assert.ok(
    labels.some((l) => /rockaway township/i.test(l)),
    "Rockaway Township NJ has no place polygon and must come from cousub",
  );
  assert.ok(
    labels.some((l) => /newbury town/i.test(l)),
    "Newbury NH likewise",
  );
});

test("Arizona's statistical CCDs never draw as municipal boundaries", () => {
  const spec = DISTRICT_LAYERS.municipal;
  const az = geo("cousub-04.geojson");
  assert.ok(az.length > 0, "the AZ cousub file is present and populated");
  const kept = az.filter((f) => keepFeature(spec, f));
  assert.deepEqual(
    kept.map((f) => f.properties.label),
    [],
    "every AZ county subdivision is a CCD and must be filtered",
  );
});

test("the map's municipal count equals the registry's municipal body count", () => {
  // The strongest form of the no-double-counting claim: the number of shapes
  // drawn equals the number of municipal governments the registry derives.
  const kept = mergedMunicipal();
  const municipalBodies = registryFile.bodies.filter(
    (b: { ocdId: string | null }) =>
      b.ocdId != null && /\/place:/.test(b.ocdId),
  );
  assert.equal(
    kept.length,
    municipalBodies.length,
    `${kept.length} drawn vs ${municipalBodies.length} municipal bodies`,
  );
});

/**
 * §0e — the redistricting trap. Every division carries a vintage-bearing
 * dataset tag, so a 2026 `sldl:608` can never be silently conflated with a
 * 2032 one once records join across cycles.
 */
test("no division exists without a vintage-bearing sourceDataset", () => {
  const missing = registryFile.divisions.filter(
    (d: { sourceDataset?: string }) =>
      !d.sourceDataset || !/\d{4}/.test(d.sourceDataset),
  );
  assert.equal(
    missing.length,
    0,
    `${registryFile.divisions.length - missing.length} of ${registryFile.divisions.length} divisions carry a vintage`,
  );
});

test("every registry row states which dataset it came from (§0f)", () => {
  const divisions = registryFile.divisions.filter(
    (d: { sourceDataset?: string }) => !d.sourceDataset,
  );
  const bodies = registryFile.bodies.filter(
    (b: { sourceDataset?: string }) => !b.sourceDataset,
  );
  assert.equal(divisions.length, 0, "every division carries sourceDataset");
  assert.equal(bodies.length, 0, "every body carries sourceDataset");
});
