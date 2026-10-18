import { geometryFiles } from "../lib/holdings/discovery.ts";
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
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";
import { recordedMeetingsSnapshot } from "./helpers/reader-fixtures.ts";
import { publishRecordedEdge } from "./helpers/reader-edge-meetings.ts";

await installRegistryAuthority();
{
  const recorded = recordedMeetingsSnapshot();
  await publishRecordedEdge(recorded.meetings, recorded.agendaDocuments);
}

/**
 * `/api/meetings` resolves the governing geography once per request and hands the resolved divisions to
 * `coverageAt`, instead of sweeping the same polygons twice.
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

/** Test ZIPs, plus a point outside coverage. */
const PROBES = ["85701", "85641", "07866", "03255", "06716"] as const;

test("pre-resolving the divisions produces the identical coverage answer", () => {
  // Passing the pre-resolved divisions yields the same coverage object.
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
  // Passing `[]` would empty coverage and render a lookup failure as "no body governs here", so `undefined`
  // (resolve again) and `[]` must not be the same call.
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
  // The route must hand `undefined`, never `[]`, when its own lookup failed.
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
 * Only a count can see a second sweep: `sweepsRun()` in lib/registry/resolve.ts increments inside
 * `divisionsAt`. Deltas, never totals; the counter is process-wide.
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
      "  Exactly one is the condition: the route resolves the point for its\n" +
      "  online-meeting filter and hands that same answer to coverageAt. Two means a\n" +
      "  caller stopped passing its resolved divisions and is paying for the identical\n" +
      "  sweep again; zero means this request answered without consulting the geometry\n" +
      "  at all, which is a different and worse defect.",
  );
});

test("the counter can read two, so a one is a measurement and not a constant", () => {
  // Control: withholding the pre-resolved set makes summarizeCoverage resolve again, and the counter reads 2.
  const resolved = resolveZip("85701");
  assert.ok(resolved.ok);
  const point: [number, number] = [resolved.centroid.lng, resolved.centroid.lat];

  const before = sweepsRun();
  divisionsAt(point, features, byId);
  summarizeCoverage(point, features, byId, registry.bodies, 3);
  assert.equal(
    sweepsRun() - before,
    2,
    "the old call shape no longer costs two sweeps — the counter is not measuring",
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
