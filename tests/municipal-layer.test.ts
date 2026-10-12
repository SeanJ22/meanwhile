import { geometryFiles } from "../lib/holdings/discovery.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  DISTRICT_LAYERS,
  GOVERNING_FUNCSTAT,
  keepFeature,
  type DistrictFeature,
} from "../lib/map/districts.ts";

/**
 * County subdivisions render in the municipal layer without double-counting, deduplicated on FUNCSTAT. These run
 * the map's own merge-and-filter against the committed boundary files.
 */

const geo = (path: string): DistrictFeature[] =>
  (
    JSON.parse(
      readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
    ) as { features: DistrictFeature[] }
  ).features;

function mergedMunicipal(): DistrictFeature[] {
  const spec = DISTRICT_LAYERS.municipal;
  return geometryFiles(process.cwd()).filter(f => /\/(?:place|cousub)-\d{2}\.geojson$/.test(f))
    .flatMap((f) => geo(f))
    .filter((f) => keepFeature(spec, f));
}

test("the map's FUNCSTAT rule is the registry's FUNCSTAT rule", () => {
  // derive.ts owns the authoritative rule; the map keeps a literal copy because the map bundle must not import
  // registry code. If either side changes alone, this is the tripwire.
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
  const az = geo(geometryFiles(process.cwd()).find((f) => f.endsWith("/cousub-04.geojson"))!);
  assert.ok(az.length > 0, "the AZ cousub file is present and populated");
  const kept = az.filter((f) => keepFeature(spec, f));
  assert.deepEqual(
    kept.map((f) => f.properties.label),
    [],
    "every AZ county subdivision is a CCD and must be filtered",
  );
});
