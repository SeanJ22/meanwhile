import { geometryFiles } from "../lib/holdings/files.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveZip } from "../lib/geo/zcta.ts";
import { summarizeCoverage } from "../lib/registry/coverage.ts";
import { divisionsAt, sweepsRun, type GeoFeature } from "../lib/registry/resolve.ts";
import { GET as meetingsGET } from "../app/api/meetings/route.ts";
import type { Division, Registry } from "../lib/registry/types.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";

await installRegistryRuntimeFirstSeeds();

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
const HOLDINGS_ROOT = join(here, "..");

async function loadFeatures(): Promise<GeoFeature[]> {
  const names = geometryFiles(HOLDINGS_ROOT);
  const all: GeoFeature[] = [];
  for (const name of names) {
    const parsed = JSON.parse(await readFile(join(HOLDINGS_ROOT, name), "utf8"));
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

/* -- the count itself, which is the only thing that can see a second sweep -- */

/**
 * AUD-04's DONE CONDITION, built a session late (g17, 2026-08-18).
 *
 * The change shipped with an equivalence proof and a hazard guard, and both are
 * above. Neither can see the defect come back. A second sweep over the same
 * polygons returns the same divisions, so the responses stay byte-identical and
 * the empty-set guard stays green while the route quietly pays twice again —
 * which is precisely the state the row existed to end. The property is a COUNT,
 * and only a count can assert it.
 *
 * `sweepsRun()` in lib/registry/resolve.ts is the instrument: one integer
 * increment inside `divisionsAt`, the function that walks every committed
 * polygon. Deltas, never totals — the module is process-wide and other tests in
 * the same run move it.
 */

test("one /api/meetings request runs exactly one point-in-polygon sweep", async () => {
  const before = sweepsRun();
  const response = await meetingsGET(
    new Request("https://example.test/api/meetings?zip=85701&lat=32.21696&lng=-110.971"),
  );
  const swept = sweepsRun() - before;

  assert.equal(response.status, 200, "the probe request did not succeed");
  const body = (await response.json()) as { meetings: unknown[]; coverage: unknown };
  assert.ok(Array.isArray(body.meetings), "no meetings array — the request did not do the work");
  assert.ok(body.coverage, "no coverage block — the second consumer of the geometry never ran");

  assert.equal(
    swept,
    1,
    `the request ran ${swept} point-in-polygon sweep(s) over the committed geometry.\n` +
      "  Exactly one is the AUD-04 condition: the route resolves the point for its\n" +
      "  online-meeting filter and hands that same answer to coverageAt. Two means a\n" +
      "  caller stopped passing its resolved divisions and is paying for the identical\n" +
      "  sweep again; zero means this request answered without consulting the geometry\n" +
      "  at all, which is a different and worse defect.",
  );
});

test("the counter can read two, so a one is a measurement and not a constant", () => {
  /*
   * The control. An assertion of "exactly 1" is worthless if the instrument
   * cannot produce anything else — a counter stuck at one is indistinguishable
   * from a route that resolves once, and this repo has already shipped a guard
   * that was green because it could not fail (the source-level synthetic-run
   * check, green through two live leaks).
   *
   * So the pre-AUD-04 shape is reproduced deliberately: resolve the point, then
   * ask summarizeCoverage to resolve it AGAIN by withholding the pre-resolved
   * set. That is exactly what /api/meetings used to do, and the counter reads
   * the 2 it used to cost.
   */
  const resolved = resolveZip("85701");
  assert.ok(resolved.ok);
  const point: [number, number] = [resolved.centroid.lng, resolved.centroid.lat];

  const before = sweepsRun();
  divisionsAt(point, features, byId);
  summarizeCoverage(point, features, byId, registry.bodies, 3);
  assert.equal(
    sweepsRun() - before,
    2,
    "the pre-AUD-04 call shape no longer costs two sweeps — the counter is not measuring",
  );

  const withPre = sweepsRun();
  const pre = divisionsAt(point, features, byId);
  summarizeCoverage(point, features, byId, registry.bodies, 3, new Map(), pre);
  assert.equal(
    sweepsRun() - withPre,
    1,
    "handing the divisions in still costs two sweeps — the reuse is not happening",
  );
});
