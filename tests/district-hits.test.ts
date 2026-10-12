import { geometryFiles } from "../lib/holdings/discovery.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { tierForOcdId } from "../lib/ocd/tiers.ts";

/**
 * A point is not in *a* district, it is in a set of them. Asserted against the committed boundary files rather than
 * mocked, because the data can break as much as the query. ZCTA centroids are orientation-only points, not a claim
 * about where anyone lives.
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

/** Centroids are read off disk: lib/geo/zcta.ts imports its JSON with a plain specifier `node --test` cannot load. */
let centroids: Record<string, [number, number]> | null = null;

async function loadCentroids(): Promise<Record<string, [number, number]>> {
  if (!centroids) {
    const raw = await readFile(
      join(here, "..", "lib", "geo", "zcta-centroids.json"),
      "utf8",
    );
    centroids = JSON.parse(raw).centroids as Record<string, [number, number]>;
  }
  return centroids;
}

async function centroidFor(zip: string): Promise<[number, number]> {
  const point = (await loadCentroids())[zip];
  assert.ok(point, `${zip} should resolve to a ZCTA centroid`);
  // Stored [lat, lng]; GeoJSON wants [lng, lat].
  return [point[1], point[0]];
}

/** ZIPs spread evenly across the states in the national centroid file (territory ZIPs 006-009 and 969 excluded). */
async function nationalSample(count: number): Promise<string[]> {
  const zips = Object.keys(await loadCentroids()).filter((zip) => !/^(00[6-9]|969)/.test(zip)).sort();
  return Array.from({ length: count }, (_, i) => zips[Math.floor((i * zips.length) / count)]);
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

test("Rockaway 07866 sits in two school districts at once", async () => {
  // A K-8 elementary district and a regional high school district cover the same ground.
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

  /* The two districts come from different source layers, so they draw as different map types. */
  const sourceLayers = new Set(schools.map((s) => s.layer));
  assert.ok(
    sourceLayers.size >= 2,
    `the two school districts must come from different source layers ` +
      `(unsd/elsd/scsd), got only ${[...sourceLayers].join(", ")}`,
  );

  const { DISTRICT_LAYERS } = await import("../lib/map/districts.ts");
  const drawnTypes = new Set<string>();
  for (const [type, spec] of Object.entries(DISTRICT_LAYERS)) {
    for (const layer of sourceLayers) {
      if (spec.censusLayers.includes(layer)) drawnTypes.add(type);
    }
  }
  assert.ok(
    drawnTypes.size >= 2,
    `the overlapping districts must render as ${drawnTypes.size >= 2 ? "" : "at least "}` +
      `two distinct map types, got ${[...drawnTypes].join(", ") || "none"}`,
  );

  // Distinct types must also be visually distinct.
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

async function sourceOverlayHitsFor(zip: string): Promise<Hit[]> {
  const source = JSON.parse(await readFile(join(here, "fixtures/geography/overlay/floterials.geojson"), "utf8"));
  const point = await centroidFor(zip);
  return (source.features as Feature[]).filter((feature) => contains(point, feature)).map((feature) => ({ layer: "overlay_district", ocdId: feature.properties.ocdId, label: feature.properties.label }));
}

// The official election document assigns Newbury and New London to a two-seat
// base district and assigns neither town to a floterial. Exact Census ZIP land
// relationships also give 03255 no floterial edge (overlay-geography.test.ts).
test("Newbury 03255 finds its base House district without an invented floterial", async () => {
  const hits = await hitsFor("03255");
  const house = hits.filter((h) => h.layer === "sldl");

  assert.equal(
    house.length,
    1,
    `expected exactly the base district from Census data, got ${JSON.stringify(house)}`,
  );
  assert.match(house[0].ocdId, /\/sldl:/);
  assert.deepEqual(await sourceOverlayHitsFor("03255"), []);
});

test("Candia 03034 finds both its base House district and its source-backed floterial", async () => {
  const house = (await hitsFor("03034")).filter((hit) => hit.layer === "sldl");
  const overlays = await sourceOverlayHitsFor("03034");
  assert.equal(house.length, 1);
  assert.equal(overlays.length, 1);
  assert.equal(overlays[0].ocdId, "ocd-division/country:us/state:nh/sldl:ro31");
  assert.equal(overlays[0].label, "Rockingham 31");
  assert.notEqual(house[0].ocdId, overlays[0].ocdId);
});

test("Census base SLDL remains a partition beside the separate floterial layer", async () => {
  const nh = (await allLayers()).find((l) => l.file.endsWith("/sldl-33.geojson"));
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
    "Census base SLDL contains overlapping districts; verify its independent partition source.",
  );
});

test("Vail 85641 is unincorporated — no municipal government to find", async () => {
  // A UI that assumes every point has a municipality would show an empty panel where the county governs.
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

test("any ZIP resolves to its congressional district from national geometry", async () => {
  for (const zip of await nationalSample(25)) {
    const hits = await hitsFor(zip);
    assert.equal(
      countByLayer(hits, "cd119"),
      1,
      `${zip} returned ${JSON.stringify(hits)}; every point in a state is in exactly one congressional district`,
    );
  }
});

test("every hit carries a tier, so nothing renders as unknown government", async () => {
  for (const zip of await nationalSample(25)) {
    for (const hit of await hitsFor(zip)) {
      assert.ok(
        tierForOcdId(hit.ocdId) !== null,
        `${hit.ocdId} (${hit.layer}) has no tier — the segment table is missing a type`,
      );
    }
  }
});
