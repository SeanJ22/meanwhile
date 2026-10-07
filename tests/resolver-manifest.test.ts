import { geometryFiles } from "../lib/holdings/discovery.ts";
/**
 * The resolver reads a manifest rather than listing `public/geo`, and every `.geojson` there must appear on
 * one of the manifest's two lists; a file on neither fails the build.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { US_JURISDICTIONS } from "../lib/coverage/states.ts";
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

test("every .geojson is either read or excluded WITH A REASON", () => {
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

test("national holdings remain available when state derivatives cover only some divisions", () => {
  assert.ok(manifest.files.includes("public/geo/cd119.geojson"));
  const national = JSON.parse(readFileSync(join(ROOT, "public/geo/cd119.geojson"), "utf8"));
  assert.ok(national.features.some((feature: GeoFeature) => feature.properties.ocdId?.includes("/state:wi/")));
  assert.ok(national.features.some((feature: GeoFeature) => feature.properties.ocdId?.includes("/district:dc/")));
  for (const row of manifest.excluded.filter(row => /cd119-\d{2}\.geojson$/.test(row.file))) assert.match(row.reason, /national file/);
  assert.ok(US_JURISDICTIONS.filter(state => state.prefix !== "territory").every(state => manifest.coveredStateFips.includes(state.fips)));
});

test("the state outline is still excluded, for the reason it always was", () => {
  const row = manifest.excluded.find((e) => e.file === "public/geo/state-outlines.geojson");
  assert.ok(row, "a generalized outline is back in the resolver");
  assert.match(row.reason, /never a governance boundary/);
});

test("the server reads the manifest and no longer lists a directory", () => {
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
test("a point inside a feature is inside its bounding box", () => {
  const features: GeoFeature[] = JSON.parse(
    readFileSync(join(ROOT, "data/states/nh/geo/cousub-33.geojson"), "utf8"),
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

test("the box is a PREFILTER, never the answer", () => {
  // A point inside the box and outside the polygon must still resolve to
  // nothing. This is the case a box-only implementation would get wrong.
  const features: GeoFeature[] = JSON.parse(
    readFileSync(join(ROOT, "data/states/nh/geo/cousub-33.geojson"), "utf8"),
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
