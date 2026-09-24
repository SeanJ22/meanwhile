import { geometryFiles } from "../lib/holdings/files.ts";
/**
 * `pnpm resolver:identity` — P-003's NON-NEGOTIABLE CORRECTNESS GATE.
 *
 * A geometry change that speeds up a lookup and alters one answer is a wrong
 * answer that arrived faster. So before and after are compared on the only
 * thing that matters: **which divisions each supported zip resolves to.**
 *
 * Three resolvers are run against every zip:
 *
 *   old    the unfiltered canonical geometry universe — every `.geojson` except the
 *          state outlines, every feature given an exact polygon test.
 *   files  the manifest's file list, exact test on every feature. Isolates the
 *          effect of DROPPING the redundant national congressional file.
 *   new    the manifest's file list plus the bounding-box prefilter. What
 *          ships.
 *
 * Isolating the two halves is deliberate. If the sets ever differ, the two
 * columns say immediately whether the geometry selection or the prefilter is
 * responsible, and a single before/after would not.
 *
 * **Sets, compared exactly.** Not counts: two different divisions is the same
 * count as two identical ones, and a count would call that a pass.
 *
 * It also reports `candidateFeaturesTested` per zip, which is the P-003 figure
 * the close-out quotes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { readAllZipDivisions } from "../lib/geo/zip-division-index.ts";
import {
  boundingBoxOf,
  contains,
  type GeoFeature,
} from "../lib/registry/resolve.ts";

const ROOT = process.cwd();

function load(files: string[]): GeoFeature[] {
  const out: GeoFeature[] = [];
  for (const name of files) {
    const parsed = JSON.parse(readFileSync(join(ROOT, name), "utf8")) as {
      features: GeoFeature[];
    };
    out.push(...parsed.features);
  }
  return out;
}

/** The pre-P-003 discovery, reproduced here rather than described. */
const OLD_FILES = geometryFiles(ROOT)
  .filter((n) => !n.endsWith("/state-outlines.geojson"))
  .sort();

const manifest = JSON.parse(
  readFileSync(join(ROOT, "data", "derived", "resolver-geometry.json"), "utf8"),
) as { files: string[] };

const oldFeatures = load(OLD_FILES);
const newFeatures = load(manifest.files);
const newBoxes = newFeatures.map(boundingBoxOf);

/** Exact test on every feature — the old behaviour, and the `files` column. */
function exhaustive(point: [number, number], features: GeoFeature[]): Set<string> {
  const hits = new Set<string>();
  for (const feature of features) {
    if (contains(point, feature)) hits.add(feature.properties.ocdId);
  }
  return hits;
}

/** Box first, exact second. Returns the set and what it cost. */
function prefiltered(point: [number, number]): { hits: Set<string>; tested: number } {
  const hits = new Set<string>();
  let tested = 0;
  for (const [i, feature] of newFeatures.entries()) {
    const [w, s, e, n] = newBoxes[i];
    if (point[0] < w || point[0] > e || point[1] < s || point[1] > n) continue;
    tested += 1;
    if (contains(point, feature)) hits.add(feature.properties.ocdId);
  }
  return { hits, tested };
}

/**
 * **EVERY ZIP THIS PRODUCT SUPPORTS**, not a sample of four.
 *
 * The national ZIP index (`lib/geo/zip-division-index.ts`) names every
 * division whose territory reaches each ZIP code in the country; the zips this
 * gate checks are every one of them that reaches a division the committed
 * resolver geometry holds — the zips where the resolver has anything to say.
 * Checking the four pilot zips would have been a sample, and a sample cannot
 * support the sentence this gate exists to say.
 *
 * `--zips` adds more on top; it never narrows the set.
 */
const extra = (() => {
  const i = process.argv.indexOf("--zips");
  return i === -1 ? [] : (process.argv[i + 1] ?? "").split(",").filter(Boolean);
})();

const resolverIds = new Set([...oldFeatures, ...newFeatures].map((f) => f.properties.ocdId));
const SUPPORTED_ZIPS = [...readAllZipDivisions(ROOT)].filter(([, entry]) => entry.ids.some((id) => resolverIds.has(id))).map(([zip]) => zip);

const centroids = JSON.parse(
  readFileSync(join(ROOT, "lib", "geo", "zcta-centroids.json"), "utf8"),
) as { centroids: Record<string, [number, number]> };

const zips = [...new Set([...SUPPORTED_ZIPS, ...extra])].sort();

console.log(`\nP-003 · resolver identity across ${zips.length} zip(s)\n`);
console.log(`  old   ${OLD_FILES.length} file(s), ${oldFeatures.length} feature(s)`);
console.log(`  new   ${manifest.files.length} file(s), ${newFeatures.length} feature(s)\n`);
console.log(
  `  ${"zip".padEnd(7)} ${"divisions".padStart(9)} ${"exact tests old".padStart(16)} ${"new".padStart(6)}  verdict`,
);

let mismatches = 0;
let testedOldTotal = 0;
let testedNewTotal = 0;

for (const zip of zips) {
  const point = centroids.centroids[zip];
  if (!point) {
    console.log(`  ${zip.padEnd(7)} ${"—".padStart(9)} ${"".padStart(16)} ${"".padStart(6)}  NO CENTROID — not checked`);
    mismatches += 1;
    continue;
  }
  const at: [number, number] = [point[1], point[0]];

  const oldHits = exhaustive(at, oldFeatures);
  const filesHits = exhaustive(at, newFeatures);
  const { hits: newHits, tested } = prefiltered(at);

  testedOldTotal += oldFeatures.length;
  testedNewTotal += tested;

  const same = (a: Set<string>, b: Set<string>) =>
    a.size === b.size && [...a].every((x) => b.has(x));

  const filesOk = same(oldHits, filesHits);
  const newOk = same(oldHits, newHits);
  const verdict = filesOk && newOk ? "IDENTICAL" : filesOk ? "PREFILTER DIFFERS" : "FILES DIFFER";
  if (!filesOk || !newOk) {
    mismatches += 1;
    const missing = [...oldHits].filter((x) => !newHits.has(x));
    const added = [...newHits].filter((x) => !oldHits.has(x));
    console.log(
      `  ${zip.padEnd(7)} ${String(oldHits.size).padStart(9)} ${String(oldFeatures.length).padStart(16)} ${String(tested).padStart(6)}  ${verdict}`,
    );
    if (missing.length) console.log(`          missing: ${missing.join(", ")}`);
    if (added.length) console.log(`          added:   ${added.join(", ")}`);
  } else {
    console.log(
      `  ${zip.padEnd(7)} ${String(oldHits.size).padStart(9)} ${String(oldFeatures.length).padStart(16)} ${String(tested).padStart(6)}  ${verdict}`,
    );
  }
}

console.log(
  `\n  exact polygon tests: ${testedOldTotal.toLocaleString()} → ${testedNewTotal.toLocaleString()}` +
    ` (${(100 - (testedNewTotal / testedOldTotal) * 100).toFixed(1)}% fewer)`,
);
console.log(
  `  average per lookup:  ${Math.round(testedOldTotal / zips.length)} → ${Math.round(testedNewTotal / zips.length)}\n`,
);

if (mismatches > 0) {
  console.error(`  ${mismatches} zip(s) did not resolve identically. P-003 does not ship.\n`);
  process.exit(1);
}
console.log(`  every zip resolves to the identical set of divisions.\n`);
