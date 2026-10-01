import { geometryPath, geometryFiles } from "../lib/holdings/files.ts";
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
      readFileSync(new URL(`../${geometryPath(name)}`, import.meta.url), "utf8"),
    ) as { features: DistrictFeature[] }
  ).features;

function mergedMunicipal(): DistrictFeature[] {
  const spec = DISTRICT_LAYERS.municipal;
  return geometryFiles(process.cwd()).filter(f => /\/(?:place|cousub)-\d{2}\.geojson$/.test(f))
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

/**
 * **DRAWN + UNDRAWABLE = HELD, AND ALL THREE NUMBERS ARE STATED.**
 * (Was an equality; became a reconciling pair in NH Hunt 5, 2026-08-21.)
 *
 * This asserted `drawn === municipal bodies`, which was the strongest form of
 * the no-double-counting claim for as long as every municipal government this
 * registry held also had a polygon in `public/geo`.
 *
 * NH Hunt 5 broke that, on purpose and visibly. Six New Hampshire towns —
 * Acworth, Croydon, Lempster, Newport, Grantham and Windsor — are inside
 * 03255's first-rung circle, publish full boards indexes, and were entered
 * with their boards. The committed TIGER geometry is clipped to one county per
 * state and carries none of them (`lib/registry/curated-divisions.ts`).
 *
 * The honest shape is not a looser equality. **Where collection and rendering
 * can diverge, BOTH numbers are reported as a pair and made to reconcile** —
 * so: how many are DRAWN, how many are held but UNDRAWABLE, and the fact that
 * the two add up to what is held. The standing figure is what is HELD; drawn
 * is a rendering fact about our geometry, not a fact about New Hampshire.
 *
 * What this still holds shut, which is the original claim, is DOUBLE-COUNTING:
 * a shape drawn twice, or a body with no government behind it, still fails,
 * because the undrawable set is not a free allowance — every member of it must
 * be a curated division that says in its own provenance why it has no polygon.
 */
test("the map's municipal shapes reconcile against the registry's municipal bodies", () => {
  const kept = mergedMunicipal();
  // Derived governing bodies only: the map draws municipal governments, and
  // a division's curated boards and commissions (D29) share its shape rather
  // than adding one.
  const municipalBodies = registryFile.bodies.filter(
    (b: { ocdId: string | null; bodyOrigin: string }) =>
      b.ocdId != null &&
      /\/place:/.test(b.ocdId) &&
      b.bodyOrigin === "DERIVED_FROM_DIVISION_TYPE",
  );

  // The municipal divisions this registry holds with NO committed geometry.
  // Identified by their own recorded reason, never by subtracting one count
  // from the other — a shortfall explained by arithmetic is not explained.
  const undrawable = registryFile.divisions.filter(
    (d: {
      ocdId: string;
      divisionType: string;
      provenance?: { sourceOrg?: string };
    }) =>
      d.divisionType === "place" &&
      /no committed geometry:/.test(d.provenance?.sourceOrg ?? ""),
  );

  /*
   * **RULING 80 TURNED THE EQUALITY INTO A CONTAINMENT, AND THE PAIR STAYS.**
   * (NJ Hunt 4 item 4, 2026-08-22.)
   *
   * The clip widened from one county per state to that county plus every county
   * adjacent to it, measured. The map therefore now draws municipalities this
   * registry holds no body for — 470 municipal shapes against 127 municipal
   * bodies — and that is the ruling working rather than a defect: a unit this
   * product names is a unit the map can draw, and drawing a town's outline
   * claims nothing about it beyond where it is.
   *
   * The claim that must survive is the one this test was written for, and it
   * survives INTACT: **no municipal government the registry holds is missing
   * from the map.** Stated as a containment plus its stated pair, rather than
   * as an equality that could only ever hold while the two sets were the same
   * size by coincidence of the clip.
   */
  const drawnIds = new Set(kept.map((f) => f.properties.ocdId));
  const undrawableIds = new Set(undrawable.map((d: { ocdId: string }) => d.ocdId));
  const lost = municipalBodies.filter(
    (b: { ocdId: string | null }) => !drawnIds.has(b.ocdId!) && !undrawableIds.has(b.ocdId!),
  );

  assert.deepEqual(
    lost.map((b: { ocdId: string | null }) => b.ocdId),
    [],
    "these municipal governments are in the registry, are not drawn, and no curated " +
      "division states why they have no polygon — either a shape was lost or an id drifted",
  );

  // No shape drawn twice. The other half of the original equality.
  assert.equal(
    drawnIds.size,
    kept.length,
    `${kept.length - drawnIds.size} municipal shape(s) are drawn more than once`,
  );

  /*
   * THE PAIR, STATED. Collection and rendering diverge here by construction, so
   * both numbers are printed and reconciled rather than one standing in for the
   * other. The standing figure is what is HELD.
   */
  const heldAndDrawn = municipalBodies.filter((b: { ocdId: string | null }) =>
    drawnIds.has(b.ocdId!),
  ).length;
  console.log(
    `municipal layer: ${kept.length} drawn · ${municipalBodies.length} held · ` +
      `${heldAndDrawn} both · ${undrawable.length} held without geometry · ` +
      `${kept.length - heldAndDrawn} drawn with no body here yet (RULING 80 extent)`,
  );

  // Every undrawable one is NAMED, so the limit is legible rather than a
  // number. RULING 57: a count is not a name.
  for (const d of undrawable) {
    assert.match(
      d.provenance?.sourceOrg ?? "",
      /clipped to|outside that clip|clip counties/,
      `${d.ocdId} is held without geometry and does not say why`,
    );
  }
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
