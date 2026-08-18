import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveZip } from "../lib/geo/zcta.ts";
import { summarizeCoverage } from "../lib/registry/coverage.ts";
import { divisionsAt, type GeoFeature } from "../lib/registry/resolve.ts";
import type { Division, Registry } from "../lib/registry/types.ts";

/**
 * AUD-04 — the governing geography is resolved ONCE per request (2026-08-18).
 *
 * `/api/meetings` ran the same point-in-polygon sweep twice: once as
 * `divisionsAt`, for the filter that keeps an online meeting visible, and again
 * inside `coverageAt` → `summarizeCoverage` → `bodiesAt` → `divisionsAt`. Two
 * identical sweeps over identical features to answer two questions about one
 * location. MEASURED with a counter on the resolver: 2 sweeps per request
 * before, 1 after.
 *
 * The route now keeps its resolved divisions and hands them to `coverageAt`.
 * This does not touch the stores-never-join rule — one geometry answer reused
 * inside one request joins nothing and is stored nowhere.
 *
 * Two properties are worth guarding, and the second is the dangerous one.
 */

const here = dirname(fileURLToPath(import.meta.url));
const GEO_DIR = join(here, "..", "public", "geo");

async function loadFeatures(): Promise<GeoFeature[]> {
  const names = (await readdir(GEO_DIR)).filter((n) => n.endsWith(".geojson"));
  const all: GeoFeature[] = [];
  for (const name of names) {
    const parsed = JSON.parse(await readFile(join(GEO_DIR, name), "utf8"));
    all.push(...(parsed.features as GeoFeature[]));
  }
  return all;
}

const features = await loadFeatures();
const registry = JSON.parse(
  await readFile(join(here, "..", "lib", "registry", "registry.json"), "utf8"),
) as Registry;
const byId = new Map<string, Division>(registry.divisions.map((d) => [d.ocdId, d]));

/** The four pilot zips, plus a point outside coverage. */
const PROBES = ["85701", "85641", "07866", "03255", "06716"] as const;

test("pre-resolving the divisions produces the identical coverage answer", () => {
  // The equivalence the whole change rests on, asserted on the object rather
  // than on a claim about it. `scripts/equivalence-meetings.mts` proves the
  // same thing end to end at the HTTP body level; this proves it at the seam
  // that was actually changed, so a break names the layer.
  let checked = 0;
  for (const zip of PROBES) {
    const resolved = resolveZip(zip);
    if (!resolved.ok) continue;
    const point: [number, number] = [resolved.centroid.lng, resolved.centroid.lat];

    const without = summarizeCoverage(point, features, byId, registry.bodies, 3);
    const pre = divisionsAt(point, features, byId);
    const with_ = summarizeCoverage(point, features, byId, registry.bodies, 3, new Map(), pre);

    assert.deepEqual(
      with_,
      without,
      `${zip}: coverage differs when the divisions are handed in pre-resolved`,
    );
    checked += 1;
  }

  assert.equal(checked, PROBES.length, "every probe zip resolved to a centroid");
  console.log(`resolve-once: ${checked} probe point(s) identical either way`);
});

test("an EMPTY pre-resolved set is not silently treated as an answer", () => {
  /*
   * THE HAZARD, and it is not hypothetical — it was planted and observed.
   *
   * The route resolves divisions inside a try/catch that degrades to an empty
   * result, because a failed lookup must not fail the whole request. If that
   * empty result were passed through as though it were an answer, coverage
   * would come back `bodies: [], seats: [], divisions: []` — and a retrieval
   * failure would render as "no body governs here", which is a failed fetch
   * written into the data as an absence.
   *
   * Planting exactly that (`resolvedDivisions ?? []`) moved all five probe
   * points off byte-identity in the equivalence run, with Tucson's coverage
   * collapsing to empty. So the difference between passing `undefined` and
   * passing `[]` is the difference between a de-duplication and a false claim
   * about a government, and this asserts they are NOT the same call.
   */
  const resolved = resolveZip("85701");
  assert.ok(resolved.ok);
  const point: [number, number] = [resolved.centroid.lng, resolved.centroid.lat];

  const real = summarizeCoverage(point, features, byId, registry.bodies, 3);
  const empty = summarizeCoverage(
    point,
    features,
    byId,
    registry.bodies,
    3,
    new Map(),
    [],
  );

  assert.ok(real.bodies.length > 0, "85701 really is governed by somebody");
  assert.equal(empty.bodies.length, 0, "an empty set genuinely empties the answer");
  assert.notDeepEqual(
    empty,
    real,
    "empty and absent must not be the same input — one is an answer, one is a failure",
  );
});

test("the route passes its divisions only when the lookup succeeded", () => {
  /*
   * The source half of the rule above. The behavioural test proves `[]` empties
   * coverage; this proves the route never hands `[]` over. A later edit
   * replacing `?? undefined` with `?? []` — the tidier-looking of the two —
   * turns a lookup failure into a confident claim that nothing governs the
   * reader's address.
   */
  const source = readFileSync(
    join(here, "..", "app", "api", "meetings", "route.ts"),
    "utf8",
  );

  assert.match(
    source,
    /resolvedDivisions\s*\?\?\s*undefined/,
    "a failed lookup falls back to resolving inside coverageAt, never to an empty answer",
  );
  assert.ok(
    !/resolvedDivisions\s*\?\?\s*\[\]/.test(source),
    "an empty array must never stand in for a failed division lookup",
  );
  assert.match(
    source,
    /let resolvedDivisions: Division\[\] \| null = null/,
    "the failed state is representable — null means resolve it yourself",
  );
});
