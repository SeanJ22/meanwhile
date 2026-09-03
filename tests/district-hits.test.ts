import { geometryFiles, geometryPath } from "../lib/holdings/files.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { tierForOcdId } from "../lib/ocd/tiers.ts";

/**
 * District disambiguation.
 *
 * A point is not in *a* district, it is in a set of them, and the three cases
 * below are the ones where assuming otherwise breaks. None of them were covered
 * before. They are asserted against the committed boundary files rather than
 * mocked, because the thing that can break is the data as much as the query.
 *
 * These use ZCTA centroids, which is the same orientation-only point the map
 * flies to — not a claim about where anyone lives.
 */

const here = dirname(fileURLToPath(import.meta.url));
const HOLDINGS_ROOT = join(here, "..");

type Ring = [number, number][];
type Polygon = Ring[];

interface Feature {
  properties: { ocdId: string; state: string; district: string; label: string };
  geometry:
    | { type: "Polygon"; coordinates: Ring[] }
    | { type: "MultiPolygon"; coordinates: Ring[][] };
}

function inRing(point: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function inPolygon(point: [number, number], poly: Polygon): boolean {
  if (!inRing(point, poly[0])) return false;
  for (let h = 1; h < poly.length; h++) if (inRing(point, poly[h])) return false;
  return true;
}

function contains(point: [number, number], feature: Feature): boolean {
  const polys =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  return polys.some((poly) => inPolygon(point, poly as Polygon));
}

/** Layer key from a filename: `sldl-33.geojson` -> `sldl`. */
function layerOf(file: string): string {
  return basename(file).replace(/\.geojson$/, "").replace(/-(?:us|\d{2})$/, "");
}

interface Hit {
  layer: string;
  ocdId: string;
  label: string;
}

/**
 * Centroids are read off disk rather than through lib/geo/zcta.ts.
 *
 * That module imports its JSON with a plain specifier, which Next resolves and
 * `node --test` does not without an import attribute. Reading the file here
 * keeps the test honest about the same data without changing a module the port
 * is explicitly not allowed to disturb.
 */
let centroids: Record<string, [number, number]> | null = null;

async function centroidFor(zip: string): Promise<[number, number]> {
  if (!centroids) {
    const raw = await readFile(
      join(here, "..", "lib", "geo", "zcta-centroids.json"),
      "utf8",
    );
    centroids = JSON.parse(raw).centroids as Record<string, [number, number]>;
  }

  const point = centroids[zip];
  assert.ok(point, `${zip} should resolve to a ZCTA centroid`);
  // Stored [lat, lng]; GeoJSON wants [lng, lat].
  return [point[1], point[0]];
}

let cache: { file: string; features: Feature[] }[] | null = null;

async function allLayers() {
  if (cache) return cache;
  const files = geometryFiles(HOLDINGS_ROOT);
  cache = await Promise.all(
    files.map(async (file) => ({
      file,
      features: JSON.parse(await readFile(join(HOLDINGS_ROOT, file), "utf8"))
        .features as Feature[],
    })),
  );
  return cache;
}

async function hitsFor(zip: string): Promise<Hit[]> {
  const point = await centroidFor(zip);
  const hits: Hit[] = [];

  for (const { file, features } of await allLayers()) {
    for (const feature of features) {
      if (!contains(point, feature)) continue;
      hits.push({
        layer: layerOf(file),
        ocdId: feature.properties.ocdId,
        label: feature.properties.label,
      });
    }
  }

  return hits;
}

const countByLayer = (hits: Hit[], layer: string) =>
  hits.filter((h) => h.layer === layer).length;

/* ------------------------------------------------ the three hard cases --- */

test("Rockaway 07866 sits in two school districts at once", async () => {
  // A K-8 elementary district and a regional high school district cover the
  // same ground. Anything that assumes one school district per point returns
  // the wrong one here, half the time, with no way to tell which.
  const hits = await hitsFor("07866");
  const schools = hits.filter(
    (h) => h.layer === "unsd" || h.layer === "elsd" || h.layer === "scsd",
  );

  assert.ok(
    schools.length >= 2,
    `expected 2+ school districts, got ${schools.length}: ${JSON.stringify(schools)}`,
  );

  // And they must be distinct divisions, not the same one from two files.
  const distinct = new Set(schools.map((s) => s.ocdId));
  assert.ok(
    distinct.size >= 2,
    `expected 2+ distinct school OCD-IDs, got ${[...distinct].join(", ")}`,
  );

  /*
   * M12 (2026-08-17, the author's disposition "Split and be clear"): the two
   * districts must come from DIFFERENT source layers, and therefore now draw
   * as different map types with their own dash, weight and checkbox.
   *
   * This is the payoff of the split stated as a test. Before it, both hits
   * mapped to the single `school` type and the map drew them identically —
   * the picker could tell them apart and the map could not, which is the
   * defect the row named. If a future change ever merges them back, this
   * fails here rather than being noticed by a reader in Rockaway.
   */
  const sourceLayers = new Set(schools.map((s) => s.layer));
  assert.ok(
    sourceLayers.size >= 2,
    `Rockaway's two school districts must come from different source layers ` +
      `(unsd/elsd/scsd), got only ${[...sourceLayers].join(", ")}`,
  );

  const { DISTRICT_LAYERS } = await import("../lib/map/districts.ts");
  const drawnTypes = new Set<string>();
  for (const [type, spec] of Object.entries(DISTRICT_LAYERS)) {
    for (const layer of sourceLayers) {
      if (spec.files.some((f) => f.startsWith(`${layer}-`))) drawnTypes.add(type);
    }
  }
  assert.ok(
    drawnTypes.size >= 2,
    `the overlapping districts must render as ${drawnTypes.size >= 2 ? "" : "at least "}` +
      `two distinct map types, got ${[...drawnTypes].join(", ") || "none"}`,
  );

  // Distinct types are not enough — they must be VISUALLY distinct, which is
  // what a reader actually uses to tell them apart.
  const dashes = new Set(
    [...drawnTypes].map((t) =>
      DISTRICT_LAYERS[t as keyof typeof DISTRICT_LAYERS].dash.join(","),
    ),
  );
  assert.equal(
    dashes.size,
    drawnTypes.size,
    `the overlapping school types must not share a dash pattern: ${[...dashes].join(" | ")}`,
  );
});

/*
 * Newbury 03255 and New Hampshire's floterial districts.
 *
 * A New Hampshire voter elects representatives from a base House district *and*
 * from a floterial district drawn across several towns, so Newbury genuinely
 * sits in two at once. This port cannot show the second one, and the reason is
 * the source rather than the query:
 *
 * Census state legislative district files are defined as a complete,
 * non-overlapping partition of the state. Overlapping floterials cannot be
 * expressed in that model, and measurably are not — see the partition test
 * below, which finds no point anywhere in the file covered by two districts.
 *
 * So the assertion here is deliberately what is *true today*, paired with a
 * test that pins the reason. Getting floterials means adding a New Hampshire
 * source (the General Court publishes district composition by town), which is
 * an external-source decision, not a bug fix. Until then the layer is honestly
 * incomplete rather than quietly wrong.
 */
test("Newbury 03255 finds its base House district; floterials are a known gap", async () => {
  const hits = await hitsFor("03255");
  const house = hits.filter((h) => h.layer === "sldl");

  assert.equal(
    house.length,
    1,
    `expected exactly the base district from Census data, got ${JSON.stringify(house)}`,
  );
  assert.match(house[0].ocdId, /\/sldl:/);
});

test("Census SLDL is a partition, which is why floterials are missing", async () => {
  // The evidence for the note above, kept as a test so the claim cannot rot.
  // If a future source adds floterials this fails, and the Newbury assertion
  // above should be tightened to 2 in the same change.
  const nh = (await allLayers()).find((l) => l.file === geometryPath("sldl-33.geojson"));
  assert.ok(nh, "sldl-33.geojson should exist");

  let overlapping = 0;
  const sample = 40;

  let minX = 180;
  let minY = 90;
  let maxX = -180;
  let maxY = -90;
  for (const feature of nh.features) {
    const polys =
      feature.geometry.type === "Polygon"
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    for (const poly of polys) {
      for (const [x, y] of poly[0]) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  for (let i = 0; i < sample; i++) {
    for (let j = 0; j < sample; j++) {
      const point: [number, number] = [
        minX + ((maxX - minX) * i) / (sample - 1),
        minY + ((maxY - minY) * j) / (sample - 1),
      ];
      const n = nh.features.filter((f) => contains(point, f)).length;
      if (n > 1) overlapping++;
    }
  }

  assert.equal(
    overlapping,
    0,
    `Census SLDL now has overlapping districts — floterials may have arrived. ` +
      `Revisit the Newbury assertion above.`,
  );
});

test("Vail 85641 is unincorporated — no municipal government to find", async () => {
  // The absence is the point. Vail has no city or town, so a UI that assumes
  // every point has a municipality shows an empty panel where it should show
  // "county governs here".
  const hits = await hitsFor("85641");

  assert.equal(
    countByLayer(hits, "place"),
    0,
    `Vail should fall in no incorporated place, got ${JSON.stringify(
      hits.filter((h) => h.layer === "place"),
    )}`,
  );

  // It is still governed: the county covers it.
  assert.ok(
    countByLayer(hits, "county") >= 1,
    "Vail should still fall inside a county",
  );
});

/* ------------------------------------------------------- general shape --- */

test("every target zip resolves to a set of districts, never exactly one", async () => {
  for (const zip of ["85701", "85641", "07866", "03255"]) {
    const hits = await hitsFor(zip);
    assert.ok(
      hits.length > 1,
      `${zip} returned ${hits.length} district(s); a point is always in a set`,
    );
  }
});

test("every hit carries a tier, so nothing renders as unknown government", async () => {
  for (const zip of ["85701", "85641", "07866", "03255"]) {
    for (const hit of await hitsFor(zip)) {
      assert.ok(
        tierForOcdId(hit.ocdId) !== null,
        `${hit.ocdId} (${hit.layer}) has no tier — the segment table is missing a type`,
      );
    }
  }
});
