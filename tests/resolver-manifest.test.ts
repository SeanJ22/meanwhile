import { geometryFiles, geometryPath } from "../lib/holdings/files.ts";
/**
 * **P-003 · THE RESOLVER READS A MANIFEST, AND THE MANIFEST ACCOUNTS FOR
 * EVERY FILE.** (Performance audit of `336a3eb`, remediated 2026-08-24.)
 *
 * `lib/registry/server.ts` used to discover its geometry with `readdir` over
 * `public/geo`. That directory is what the CLIENT downloads, plus the INPUTS to
 * the scripts that build it, and a directory listing cannot tell an input from
 * a product — so the resolver loaded `cd119.geojson`, the 1.63 MB national
 * congressional file, alongside its own per-state derivatives.
 *
 * The old comment's worry was the right one and is preserved here: an
 * allow-list rots the other way, with a new district type silently absent. So
 * the manifest's rule is SUPERSESSION, and every `.geojson` in the directory
 * must appear on one of its two lists. A file on neither is the silent-skip
 * shape, and it fails the build.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { COVERED_STATES } from "../lib/coverage/states.ts";
import { boundingBoxOf, contains, type GeoFeature } from "../lib/registry/resolve.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const manifest = JSON.parse(
  readFileSync(join(ROOT, "data", "derived", "resolver-geometry.json"), "utf8"),
) as {
  files: string[];
  excluded: { file: string; reason: string }[];
  totals: { features: number; coordinates: number };
  coveredStateFips: string[];
};

const onDisk = geometryFiles(ROOT);

test("P-003 · every .geojson is either read or excluded WITH A REASON", () => {
  assert.ok(onDisk.length >= 20, `only ${onDisk.length} geometry files — this would pass blind`);

  const accounted = new Set([...manifest.files, ...manifest.excluded.map((e) => e.file)]);
  const unaccounted = onDisk.filter((f) => !accounted.has(f));
  assert.deepEqual(
    unaccounted,
    [],
    "a geometry file is on neither list — run pnpm resolver:manifest",
  );

  const phantom = [...accounted].filter((f) => !onDisk.includes(f));
  assert.deepEqual(phantom, [], "the manifest names a file that is not there");

  for (const row of manifest.excluded) {
    assert.ok(row.reason.length > 30, `${row.file} is excluded with no reason worth reading`);
  }
});

test("P-003 · the national congressional file is excluded, and its splits are all present", () => {
  const excluded = manifest.excluded.map((e) => e.file);
  assert.ok(excluded.includes(geometryPath("cd119.geojson")), "the 1.63 MB national file is being loaded again");

  // The whole justification for excluding it: every covered state has its own.
  for (const state of COVERED_STATES) {
    assert.ok(
      manifest.files.includes(geometryPath(`cd119-${state.fips}.geojson`)),
      `cd119-${state.fips}.geojson is missing, so dropping the national file LOSES ${state.usps}`,
    );
  }
  assert.deepEqual(
    manifest.coveredStateFips,
    COVERED_STATES.map((s) => s.fips),
    "the manifest was generated against a different set of covered states",
  );
});

test("P-003 · the state outline is still excluded, for the reason it always was", () => {
  const row = manifest.excluded.find((e) => e.file === geometryPath("state-outlines.geojson"));
  assert.ok(row, "a generalized outline is back in the resolver");
  assert.match(row.reason, /never a governance boundary/);
});

test("P-003 · the server reads the manifest and no longer lists a directory", () => {
  const source = readFileSync(join(ROOT, "lib", "registry", "server.ts"), "utf8");
  assert.match(source, /resolver-geometry\.json/, "the server is not reading the manifest");
  assert.doesNotMatch(
    source,
    /readdir\(/,
    "the server lists the geometry directory again — that is how the national file got in",
  );
});

/* ==================================================================== *
 *  THE PREFILTER CANNOT CHANGE AN ANSWER
 * ==================================================================== */

/**
 * A bounding box has no false negatives in the direction that matters: a point
 * outside the box is outside the polygon. `polygonContains` remains the only
 * thing that ever says YES.
 *
 * The full 279-zip identity check is `pnpm resolver:identity`, which is too
 * slow for the unit suite. This holds the PROPERTY the check depends on, plus
 * the case that would break it.
 */
test("P-003 · a point inside a feature is inside its bounding box", () => {
  const features: GeoFeature[] = JSON.parse(
    readFileSync(join(ROOT, geometryPath("cousub-33.geojson")), "utf8"),
  ).features;
  assert.ok(features.length > 50, `only ${features.length} features read`);

  let checked = 0;
  for (const feature of features) {
    const box = boundingBoxOf(feature);
    const polys =
      feature.geometry.type === "Polygon"
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    // Every vertex of every ring is by definition inside the feature's box.
    for (const poly of polys) {
      for (const ring of poly as [number, number][][]) {
        for (const [x, y] of ring) {
          assert.ok(
            x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3],
            `a vertex of ${feature.properties.ocdId} lies outside its own bounding box`,
          );
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 1000, `only ${checked} vertices checked`);
});

test("P-003 · the box is a PREFILTER, never the answer", () => {
  // A point inside the box and outside the polygon must still resolve to
  // nothing. This is the case a box-only implementation would get wrong.
  const features: GeoFeature[] = JSON.parse(
    readFileSync(join(ROOT, geometryPath("cousub-33.geojson")), "utf8"),
  ).features;

  // An L-shaped-enough town: find one whose box area is much larger than the
  // town, then a corner of that box.
  const feature = features.find((f) => {
    const [w, s, e, n] = boundingBoxOf(f);
    return e - w > 0.1 && n - s > 0.1;
  });
  assert.ok(feature, "no feature with a box big enough to test the corner of");

  const [w, s] = boundingBoxOf(feature);
  const corner: [number, number] = [w + 1e-9, s + 1e-9];
  assert.equal(
    contains(corner, feature),
    false,
    "the south-west corner of a bounding box is inside the shape — pick another feature",
  );
});
