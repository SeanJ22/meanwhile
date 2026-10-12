import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { acquireAiannhScope, AiannhLandAccumulator, buildAiannhScope, aiannhBlockAssignments, CENSUS_AIANNH } from "../lib/census-geography/aiannh.ts";
import type { GeographyVersion } from "../lib/census-geography/contract.ts";
import type { GeographySlice } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { DEFAULT_SCOPES } from "../lib/census-geography/acquire.ts";
import { readBoundaryZip, readZip } from "../lib/geo/shapefile.ts";
import { containsPoint } from "../lib/geo/polygon.ts";
import { representationDivisionsAt } from "../lib/geo/representation-geography.ts";
import { TRIBAL_SEAT_REFERENCES } from "../lib/officials/tribal-seats.ts";

const ASSIGNMENTS = "BLOCKID|AIANNHCE|COMPTYP\n230030001001000|1530|R\n230030001001001|1530|T\n230030001001002|1530|T\n230030001001003|1530|T\n230030001001004|9999|\n";
const BLOCKS = "GEOID_ZCTA5_20|AREALAND_ZCTA5_20|GEOID_TABBLOCK_20|AREALAND_TABBLOCK_20|AREALAND_PART\n04730|1000|230030001001000|200|200\n04730|1000|230030001001001|50|50\n04730|1000|230030001001002|0|0\n|0|230030001001003|50|50\n04730|1000|230030001001004|650|650\n04730|1000|330010001001000|100|100\n";
function fixtureOverlaps() {
  const accumulator = new AiannhLandAccumulator(aiannhBlockAssignments(ASSIGNMENTS, new Set(["1530"])));
  for (const line of BLOCKS.split("\n")) accumulator.addLine(line);
  return accumulator.finish();
}
const META: GeographyVersion = {
  key: "aiannh:2020", type: "aiannh", plan: "Real TIGER/Line 2020 fixture", zctaTabulation: "2020",
  effectiveFor: "Referenced legislative areas", applicability: [{ purpose: "representation", from: "2020-01-01" }], retrievalComplete: true,
  provenance: { sourceUrls: [CENSUS_AIANNH.url], sourceDataset: "CENSUS_TIGER_AIANNH2020_FIXTURE", sourceFiles: [], sourceChecksums: [], method: "Original selected Census polygon and DBF records", computedAt: "2026-10-12" },
};

const BOUNDARY_ZIP = readFileSync(new URL("./fixtures/geography/aiannh2020-tribal-components.zip", import.meta.url));
const ASSIGNMENT_ZIP = readFileSync(new URL("./fixtures/geography/aiannh2020-blockassign-referenced.zip", import.meta.url));
const REAL_ASSIGNMENTS = readZip(ASSIGNMENT_ZIP)[0].data.toString("utf8");
const REAL_BLOCKS = readFileSync(new URL("./fixtures/geography/aiannh2020-zcta-block-referenced.txt", import.meta.url), "utf8");
const BOUNDARIES = readBoundaryZip(BOUNDARY_ZIP).features;
const REFERENCE = TRIBAL_SEAT_REFERENCES.find(row => row.district === "Houlton Band of Maliseet Indians")!;
function realOverlaps() {
  const codes = new Set(TRIBAL_SEAT_REFERENCES.flatMap(row => row.aiannhAreaIds.map(id => id.slice(0, 4))));
  const accumulator = new AiannhLandAccumulator(aiannhBlockAssignments(REAL_ASSIGNMENTS, codes));
  for (const line of REAL_BLOCKS.split("\n")) accumulator.addLine(line);
  return accumulator.finish();
}

test("AIANNH is its own routine scope with boundary and block vintages aligned", () => {
  assert.ok(DEFAULT_SCOPES.includes("aiannh"));
  assert.match(CENSUS_AIANNH.url, /TIGER2020\/AIANNH\/tl_2020_us_aiannh\.zip$/);
  assert.match(CENSUS_AIANNH.blockAssignmentBase, /baf2020$/);
  assert.match(CENSUS_AIANNH.zctaBlockUrl, /rel2020\/zcta520\/tab20_zcta520_tabblock20_natl\.txt$/);
});

test("AIANNH ZIP area shares sum reservation and trust land once with the full cross-state ZCTA denominator", () => {
  const overlaps = fixtureOverlaps();
  assert.deepEqual(overlaps.get("1530"), [{ zcta5: "04730", fraction: 0.25, whole: false }]);
  const accumulator = new AiannhLandAccumulator(aiannhBlockAssignments(ASSIGNMENTS, new Set(["1530"])));
  for (const line of BLOCKS.split("\n")) accumulator.addLine(line);
  assert.throws(() => accumulator.addLine("04730|999|230030001001001|1|1"), /Inconsistent Census ZCTA land area/);
});

test("real reservation and trust-land polygons yield one area and the referenced seat", () => {
  const scope = buildAiannhScope(BOUNDARIES, realOverlaps(), [REFERENCE], META);
  assert.equal(scope.groupings.length, 1);
  const group = scope.groupings[0];
  assert.equal(group.geoid, "1530");
  assert.equal(group.ocdId, "ocd-division/country:us/state:me/aiannh:1530");
  assert.equal(group.representation, "tribal");
  assert.deepEqual(group.overlaps, [
    { zcta5: "04730", fraction: 4280041 / 633579881, whole: false },
    { zcta5: "04760", fraction: 936212 / 199056953, whole: false },
  ]);
  const trust = BOUNDARIES.find(feature => feature.properties.GEOID === "1530T")!;
  const point: [number, number] = [Number(trust.properties.INTPTLON), Number(trust.properties.INTPTLAT)];
  assert.deepEqual(point, [-67.8072179, 46.1888323]);
  assert.equal(containsPoint(point, group.geometry!), true);
  const slice: GeographySlice = { scopes: [{ type: scope.type, version: scope.version, plan: META.plan, applicability: META.applicability, retrievalComplete: true, sourceUrls: META.provenance.sourceUrls, observedAt: META.provenance.computedAt }], containers: [{ ref: { ...group, type: scope.type, version: scope.version }, plan: META.plan, overlaps: null }] };
  const hits = representationDivisionsAt(point, slice, { purpose: "representation", asOf: "2026-10-12" });
  assert.deepEqual(hits.map(hit => hit.nation), [REFERENCE.nation]);
  assert.deepEqual(representationDivisionsAt([-70.2568, 43.6591], slice, { purpose: "representation", asOf: "2026-10-12" }), []);
});

test("real Census source members acquire all referenced areas through the routine path", async () => {
  const seen: string[] = [];
  const scope = await acquireAiannhScope({ states: new Set(["23"]), fetchImpl: (async input => {
    const url = String(input);
    seen.push(url);
    if (url === CENSUS_AIANNH.url) return new Response(BOUNDARY_ZIP);
    if (url.endsWith("BlockAssign_ST23_ME.zip")) return new Response(ASSIGNMENT_ZIP);
    if (url === CENSUS_AIANNH.zctaBlockUrl) return new Response(REAL_BLOCKS);
    throw new Error(`Unexpected source ${url}`);
  }) as typeof fetch });
  assert.ok(scope);
  assert.deepEqual(scope.groupings.map(group => group.geoid), ["1530", "1575", "2695", "2760", "2850"]);
  assert.equal(scope.instanceCount, 5);
  assert.equal(scope.zctaEdgeCount, 24);
  assert.equal(seen.length, 3);
  assert.match(scope.versionMeta.provenance.method, /COMPTYP/);
  assert.deepEqual(scope.groupings.find(group => group.geoid === "1530")!.overlaps, realOverlaps().get("1530"));
  const slice: GeographySlice = {
    scopes: [{ type: scope.type, version: scope.version, plan: scope.versionMeta.plan, applicability: scope.versionMeta.applicability, retrievalComplete: true, sourceUrls: scope.versionMeta.provenance.sourceUrls, observedAt: scope.versionMeta.provenance.computedAt }],
    containers: scope.groupings.map(group => ({ ref: { ...group, type: scope.type, version: scope.version }, plan: scope.versionMeta.plan, overlaps: null })),
  };
  assert.deepEqual(representationDivisionsAt([-67.8072179, 46.1888323], slice).map(hit => hit.nation), [REFERENCE.nation]);
  assert.deepEqual(representationDivisionsAt([-70.2568, 43.6591], slice), []);
});

test("reference filtering retains exact Census polygon records without decoding other areas", () => {
  const bounded = readBoundaryZip(BOUNDARY_ZIP, properties => REFERENCE.aiannhAreaIds.includes(properties.GEOID));
  assert.equal(bounded.counts, "7 geometries, 7 attribute rows, paired");
  assert.deepEqual(bounded.features, BOUNDARIES.filter(feature => REFERENCE.aiannhAreaIds.includes(feature.properties.GEOID)));
});

test("missing referenced trust-land components fail instead of publishing a smaller area", () => {
  assert.throws(() => buildAiannhScope(BOUNDARIES.filter(feature => feature.properties.GEOID !== "1530T"), fixtureOverlaps(), [REFERENCE], META), /component 1530T is missing/);
});

test("an unreferenced state skips this bounded scope without fetching", async () => {
  const scope = await acquireAiannhScope({ states: new Set(["33"]), fetchImpl: (async () => { throw new Error("Unexpected fetch"); }) as typeof fetch });
  assert.equal(scope, null);
});

test("a source failure rejects acquisition before any geography can publish", async () => {
  await assert.rejects(acquireAiannhScope({ references: [REFERENCE], fetchImpl: (async () => new Response("Unavailable", { status: 403 })) as typeof fetch }), /HTTP 403 fetching .*tl_2020_us_aiannh\.zip/);
});

test("the official BAF20 layout preserves block identities and rejects conflicting assignments", () => {
  assert.deepEqual([...aiannhBlockAssignments(ASSIGNMENTS, new Set(["1530"])).values()], ["1530", "1530", "1530", "1530"]);
  assert.equal(aiannhBlockAssignments(REAL_ASSIGNMENTS, new Set(["1530"])).size, 23);
  assert.throws(() => aiannhBlockAssignments(ASSIGNMENTS.replace("COMPTYP", "changed"), new Set(["1530"])), /missing column COMPTYP/);
  assert.throws(() => aiannhBlockAssignments(ASSIGNMENTS + "230030001001000|2760|R\n", new Set(["1530", "2760"])), /Conflicting Census AIANNH assignments/);
});
