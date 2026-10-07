/**
 * National territory resolution: which governments govern which zip.
 *
 * A ZCTA that straddles two counties maps to BOTH. Every government whose
 * boundary contains any sampled point of the ZCTA becomes an edge, with no
 * minimum overlap (a reader in the sliver is still governed by it); the
 * sample count is carried on every edge so a sliver is distinguishable.
 *
 * Each ZCTA is sampled on a 0.01-degree lattice of interior points (about
 * 1.1 km north-south), plus a representative interior point for any ZCTA too
 * small to catch a lattice node, and each point is tested against every
 * government layer (`lib/geo/point-in-polygon.ts`). Sampling approximates
 * areal intersection: an overlap thinner than the lattice can be missed, and
 * the fallback count is reported.
 *
 * This resolves TERRITORY, not a body count. The boundary files are fetched by
 * `corepack pnpm tiger:fetch` into `.cache/tiger`; this script never fetches.
 *
 * Run:  corepack pnpm zipgov:build
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildGrid, candidatesAt, containsPoint, indexPolygon } from "../lib/geo/point-in-polygon.ts";
import type { IndexedPolygon } from "../lib/geo/point-in-polygon.ts";
import { readBoundaryZip } from "../lib/geo/shapefile.ts";
import type { Feature } from "../lib/geo/shapefile.ts";

const CACHE = join(process.cwd(), ".cache", "tiger");
const OUT_DIR = join(process.cwd(), "data", "derived");

/** The sampling lattice, in degrees. Stated because the method depends on it. */
const SAMPLE_RES = 0.01;

type LayerSpec = {
  key: string;
  file: string;
  /** How a feature names itself in the output. */
  id: (p: Record<string, string>) => string;
  name: (p: Record<string, string>) => string;
  /** The Census government type this layer stands for, for reconciliation. */
  censusType: string;
};

const LAYERS: LayerSpec[] = [
  {
    key: "county",
    file: "cb_2023_us_county_500k.zip",
    id: (p) => p.GEOID ?? "",
    name: (p) => p.NAMELSAD ?? p.NAME ?? "",
    censusType: "COUNTY",
  },
  {
    key: "place",
    file: "cb_2023_us_place_500k.zip",
    id: (p) => p.GEOID ?? "",
    name: (p) => p.NAMELSAD ?? p.NAME ?? "",
    censusType: "MUNICIPAL",
  },
  {
    key: "cousub",
    file: "cb_2023_us_cousub_500k.zip",
    id: (p) => p.GEOID ?? "",
    name: (p) => p.NAMELSAD ?? p.NAME ?? "",
    censusType: "TOWNSHIP",
  },
  {
    key: "unsd",
    file: "cb_2023_us_unsd_500k.zip",
    id: (p) => p.GEOID ?? "",
    name: (p) => p.NAME ?? "",
    censusType: "SCHOOL DISTRICT",
  },
  {
    key: "elsd",
    file: "cb_2023_us_elsd_500k.zip",
    id: (p) => p.GEOID ?? "",
    name: (p) => p.NAME ?? "",
    censusType: "SCHOOL DISTRICT",
  },
  {
    key: "scsd",
    file: "cb_2023_us_scsd_500k.zip",
    id: (p) => p.GEOID ?? "",
    name: (p) => p.NAME ?? "",
    censusType: "SCHOOL DISTRICT",
  },
];

const ZCTA_FILE = "cb_2020_us_zcta520_500k.zip";

/**
 * TIGER pseudo-entities are not governments: territory no school district
 * covers is filled with placeholder features using reserved local codes 99997
 * ("not defined"), 99998 ("water") and 99999 ("unorganized territory"). They
 * are dropped at the join and named in the run's output.
 */
const PSEUDO_LOCAL_CODES = new Set(["99997", "99998", "99999"]);

function isPseudoEntity(geoid: string, name: string): boolean {
  if (PSEUDO_LOCAL_CODES.has(geoid.slice(-5))) return true;
  return /\b(not defined|unorganized|county subdivisions not defined)\b/i.test(name);
}

/**
 * Not everything in a TIGER layer is a government. A census-designated place
 * (CDP) or census county division (CCD) is statistical geography with no
 * council, budget or officials.
 *
 * The classification never asserts:
 *   STATISTICAL   — positively identified as a Census statistical entity.
 *   GOVERNMENT    — positively identified as a general-purpose government.
 *   UNCLASSIFIED  — everything else, carrying its LSAD code. Gores, grants,
 *                   plantations, locations and purchases vary by state and
 *                   entity, so they land here; an unclassified row is a work
 *                   item, never a claim.
 *
 * LSAD codes are the Census Bureau's own Legal/Statistical Area Description list.
 */
const LSAD_STATISTICAL = new Set([
  "57", // CDP — census designated place
  "22", // CCD — census county division
  "23", // census subarea (Alaska)
  "46", // UT — unorganized territory
  "00", // no legal or statistical description
]);

const LSAD_GOVERNMENT = new Set([
  "21", // borough
  "25", // city
  "43", // town
  "44", // township
  "45", // township (numbered)
  "47", // village
  "49", // charter township
  "53", // city and borough
  "37", // municipality
  "39", // plantation
  "UG", // unified government
  "UC", // urban county
  "CG", // consolidated government
  "MG", // metropolitan government
  "CN", // corporation
]);

type EntityClass = "STATISTICAL" | "GOVERNMENT" | "UNCLASSIFIED";

function classify(props: Record<string, string>, layerKey: string): EntityClass {
  // The school-district and county layers hold governments outright: a county
  // is a government in every state, and a school district in these three
  // layers is an operating LEA with a board.
  if (layerKey === "county" || layerKey === "unsd" || layerKey === "elsd" || layerKey === "scsd") {
    return "GOVERNMENT";
  }
  const lsad = props.LSAD ?? "";
  if (LSAD_STATISTICAL.has(lsad)) return "STATISTICAL";
  if (LSAD_GOVERNMENT.has(lsad)) return "GOVERNMENT";
  return "UNCLASSIFIED";
}

/* -------------------------------------------------------------------------- */

function loadLayer(file: string): Feature[] {
  const path = join(CACHE, file);
  if (!existsSync(path)) {
    throw new Error(
      `${file} is not in .cache/tiger. Run: corepack pnpm tiger:fetch — this script ` +
        "never fetches, so a missing input is a stated failure and never an empty result.",
    );
  }
  return readBoundaryZip(readFileSync(path)).features;
}

type Indexed = {
  spec: LayerSpec;
  features: Feature[];
  polys: IndexedPolygon[];
  grid: ReturnType<typeof buildGrid>;
};

console.log("NATIONAL TERRITORY RESOLUTION");
console.log(`sampling lattice: ${SAMPLE_RES} degrees (about 1.1 km north-south)\n`);

console.log("LAYERS (vintage, row count):");
const layers: Indexed[] = [];
for (const spec of LAYERS) {
  const features = loadLayer(spec.file);
  const vintage = /cb_(\d{4})_/.exec(spec.file)?.[1] ?? "unknown";
  const polys = features.map((f) => indexPolygon(f.rings, f.bbox));
  const grid = buildGrid(features.map((f) => f.bbox));
  layers.push({ spec, features, polys, grid });
  console.log(`  ${spec.key.padEnd(8)} ${spec.file.padEnd(34)} vintage ${vintage}  ${features.length} rows`);
}

const zctaFeatures = loadLayer(ZCTA_FILE);
console.log(
  `  ${"zcta".padEnd(8)} ${ZCTA_FILE.padEnd(34)} vintage 2020  ${zctaFeatures.length} rows\n`,
);

/* -------------------------------------------------------------------------- */
/* The join                                                                   */
/* -------------------------------------------------------------------------- */

type Edge = {
  layer: string;
  id: string;
  name: string;
  samples: number;
  /** GOVERNMENT, STATISTICAL or UNCLASSIFIED. Never inferred downstream. */
  entity: EntityClass;
  /** The Census LSAD the classification was made from, carried so an
   *  UNCLASSIFIED row can be ruled on without re-deriving it. */
  lsad: string;
};

const zipToGovernments = new Map<string, Edge[]>();
let fallbackPointUsed = 0;
let totalSamplePoints = 0;
let zipsWithNoGovernment = 0;
const pseudoSkipped = new Set<string>();

const started = Date.now();

zctaFeatures.forEach((zcta, zi) => {
  const zip = zcta.properties.ZCTA5CE20 ?? zcta.properties.GEOID20 ?? "";
  const [minX, minY, maxX, maxY] = zcta.bbox;
  const zctaPoly = indexPolygon(zcta.rings, zcta.bbox);

  // The interior lattice.
  const points: Array<[number, number]> = [];
  for (let y = Math.ceil(minY / SAMPLE_RES) * SAMPLE_RES; y <= maxY; y += SAMPLE_RES) {
    for (let x = Math.ceil(minX / SAMPLE_RES) * SAMPLE_RES; x <= maxX; x += SAMPLE_RES) {
      if (containsPoint(zctaPoly, x, y)) points.push([x, y]);
    }
  }

  // A ZCTA smaller than the lattice catches no node; it gets one
  // representative interior point, and the count is reported.
  if (points.length === 0) {
    fallbackPointUsed += 1;
    const ring = zcta.rings[0] ?? [];
    let placed = false;
    // Walk the ring's own edge midpoints nudged toward the centroid; the first
    // that lands inside is used. A vertex itself is never used: a vertex sits
    // ON the boundary, where a containment answer is a coin flip.
    let cx = 0;
    let cy = 0;
    for (const [x, y] of ring) {
      cx += x;
      cy += y;
    }
    cx /= Math.max(1, ring.length);
    cy /= Math.max(1, ring.length);
    if (containsPoint(zctaPoly, cx, cy)) {
      points.push([cx, cy]);
      placed = true;
    } else {
      for (const [x, y] of ring) {
        const px = x + (cx - x) * 0.01;
        const py = y + (cy - y) * 0.01;
        if (containsPoint(zctaPoly, px, py)) {
          points.push([px, py]);
          placed = true;
          break;
        }
      }
    }
    if (!placed && ring.length) points.push([cx, cy]);
  }

  totalSamplePoints += points.length;

  const hits = new Map<string, Edge>();
  for (const layer of layers) {
    for (const [x, y] of points) {
      for (const ci of candidatesAt(layer.grid, x, y)) {
        // Containment is tested every time; the sample count is evidence.
        if (!containsPoint(layer.polys[ci]!, x, y)) continue;
        const props = layer.features[ci]!.properties;
        if (isPseudoEntity(layer.spec.id(props), layer.spec.name(props))) {
          pseudoSkipped.add(`${layer.spec.key}:${layer.spec.id(props)}`);
          continue;
        }
        const k = `${layer.spec.key}:${layer.spec.id(props)}`;
        const existing = hits.get(k);
        if (existing) {
          existing.samples += 1;
          continue;
        }
        hits.set(k, {
          layer: layer.spec.key,
          id: layer.spec.id(props),
          name: layer.spec.name(props),
          samples: 1,
          entity: classify(props, layer.spec.key),
          lsad: props.LSAD ?? "",
        });
      }
    }
  }

  if (hits.size === 0) zipsWithNoGovernment += 1;
  zipToGovernments.set(zip, [...hits.values()]);

  if (zi % 2000 === 0) {
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    console.log(`  ...${zi} of ${zctaFeatures.length} ZCTAs (${secs}s)`);
  }
});

console.log(`\nforward pass finished in ${((Date.now() - started) / 1000).toFixed(0)}s`);

/* -------------------------------------------------------------------------- */
/* The reverse pass — governments smaller than the lattice                    */
/*                                                                            */
/* A government smaller than the 0.01-degree lattice can sit between sample    */
/* points. Every government the forward pass did not reach is asked from its   */
/* own side: a representative interior point and the ZCTA containing it. The   */
/* count recovered this way is reported separately, as weaker evidence.        */
/* -------------------------------------------------------------------------- */

const zctaPolys = zctaFeatures.map((f) => indexPolygon(f.rings, f.bbox));
const zctaGrid = buildGrid(zctaFeatures.map((f) => f.bbox));

/** A point inside this polygon: the vertex average when it lands inside,
 *  otherwise a vertex nudged 1% toward it. Never a bare vertex — a vertex is
 *  ON the boundary, where containment is a coin flip. */
function interiorPoint(f: Feature, poly: IndexedPolygon): [number, number] | null {
  const ring = f.rings[0];
  if (!ring?.length) return null;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of ring) {
    cx += x;
    cy += y;
  }
  cx /= ring.length;
  cy /= ring.length;
  if (containsPoint(poly, cx, cy)) return [cx, cy];
  for (const [x, y] of ring) {
    const px = x + (cx - x) * 0.01;
    const py = y + (cy - y) * 0.01;
    if (containsPoint(poly, px, py)) return [px, py];
  }
  return null;
}

const reverseStarted = Date.now();
const recoveredByLayer = new Map<string, number>();
let unreachedAfterReverse = 0;

for (const layer of layers) {
  const seen = new Set<string>();
  for (const edges of zipToGovernments.values()) {
    for (const e of edges) if (e.layer === layer.spec.key) seen.add(e.id);
  }

  let recovered = 0;
  layer.features.forEach((f, i) => {
    const id = layer.spec.id(f.properties);
    if (seen.has(id)) return;
    if (isPseudoEntity(id, layer.spec.name(f.properties))) {
      pseudoSkipped.add(`${layer.spec.key}:${id}`);
      return;
    }

    const point = interiorPoint(f, layer.polys[i]!);
    if (!point) {
      unreachedAfterReverse += 1;
      return;
    }
    const [x, y] = point;

    let placed = false;
    for (const zi of candidatesAt(zctaGrid, x, y)) {
      if (!containsPoint(zctaPolys[zi]!, x, y)) continue;
      const zip = zctaFeatures[zi]!.properties.ZCTA5CE20 ?? "";
      const edges = zipToGovernments.get(zip);
      if (!edges) continue;
      edges.push({
        layer: layer.spec.key,
        id,
        name: layer.spec.name(f.properties),
        samples: 0,
        entity: classify(f.properties, layer.spec.key),
        lsad: f.properties.LSAD ?? "",
      });
      placed = true;
      recovered += 1;
      break;
    }
    // `samples: 0` is deliberate and load-bearing: it marks an edge recovered
    // from the government's side rather than sampled from the zip's, so the
    // two kinds of evidence never merge into one undifferentiated number.
    if (!placed) unreachedAfterReverse += 1;
  });

  recoveredByLayer.set(layer.spec.key, recovered);
}

console.log(
  `reverse pass finished in ${((Date.now() - reverseStarted) / 1000).toFixed(0)}s — ` +
    `${[...recoveredByLayer.entries()].map(([k, n]) => `${k} +${n}`).join(", ")}`,
);
console.log(
  `governments still resolving to no zip after both passes: ${unreachedAfterReverse}`,
);

/* -------------------------------------------------------------------------- */
/* Report                                                                     */
/* -------------------------------------------------------------------------- */

let edgeCount = 0;
const perLayer = new Map<string, Set<string>>();
for (const edges of zipToGovernments.values()) {
  edgeCount += edges.length;
  for (const e of edges) {
    const s = perLayer.get(e.layer) ?? new Set<string>();
    s.add(e.id);
    perLayer.set(e.layer, s);
  }
}

console.log(`\nZIPS (ZCTAs) MAPPED: ${zipToGovernments.size} of ${zctaFeatures.length}`);
console.log(`GOVERNMENT-TO-ZIP EDGES: ${edgeCount}`);
console.log(`sample points tested: ${totalSamplePoints}`);
console.log(
  `ZCTAs needing the fallback representative point (smaller than the lattice): ${fallbackPointUsed}`,
);
console.log(`ZCTAs resolving to NO government at all: ${zipsWithNoGovernment}`);
console.log(
  `TIGER pseudo-entities excluded — not governments, see isPseudoEntity: ${pseudoSkipped.size}`,
);
const byClass = new Map<string, number>();
const distinctByClass = new Map<string, Set<string>>();
for (const edges of zipToGovernments.values()) {
  for (const e of edges) {
    byClass.set(e.entity, (byClass.get(e.entity) ?? 0) + 1);
    const s = distinctByClass.get(e.entity) ?? new Set<string>();
    s.add(`${e.layer}:${e.id}`);
    distinctByClass.set(e.entity, s);
  }
}
console.log("\nEDGES BY ENTITY CLASS — a statistical entity is NOT a government:");
for (const k of ["GOVERNMENT", "STATISTICAL", "UNCLASSIFIED"]) {
  console.log(
    `  ${k.padEnd(14)} ${String(byClass.get(k) ?? 0).padStart(7)} edges, ` +
      `${String(distinctByClass.get(k)?.size ?? 0).padStart(6)} distinct entities`,
  );
}

console.log("\nDISTINCT GOVERNMENTS RESOLVED, BY LAYER:");
for (const layer of LAYERS) {
  const resolved = perLayer.get(layer.key)?.size ?? 0;
  const total = layers.find((l) => l.spec.key === layer.key)!.features.length;
  console.log(
    `  ${layer.key.padEnd(8)} ${String(resolved).padStart(6)} of ${String(total).padStart(6)} boundary rows resolved to >=1 zip`,
  );
}

mkdirSync(OUT_DIR, { recursive: true });
const payload = {
  generatedAt: new Date().toISOString(),
  method: {
    sampleLatticeDegrees: SAMPLE_RES,
    overlapRule:
      "every government containing any sampled point of the ZCTA is an edge; no minimum threshold",
    zctaVintage: "2020",
    governmentVintage: "2023",
  },
  totals: {
    zips: zipToGovernments.size,
    edges: edgeCount,
    samplePoints: totalSamplePoints,
    fallbackPointUsed,
    zipsWithNoGovernment,
    recoveredByReversePass: Object.fromEntries(recoveredByLayer),
    governmentsResolvingToNoZip: unreachedAfterReverse,
    pseudoEntitiesExcluded: pseudoSkipped.size,
  },
  zips: Object.fromEntries(zipToGovernments),
};
writeFileSync(join(OUT_DIR, "zip-governments.json"), `${JSON.stringify(payload)}\n`, "utf8");
console.log(`\nWROTE data/derived/zip-governments.json`);
