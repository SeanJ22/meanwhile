import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readBoundaryZip, type Feature } from "../lib/geo/shapefile.ts";
import { buildTigerOverlapGroups, tigerDistrictPlan } from "../lib/census-geography/tiger-overlap.ts";
import { SourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-error.ts";
import { censusWorkDivision } from "../lib/census-geography/division-id.ts";
import { designationFromLabel, indexDivisions } from "../lib/sources/plural/index.ts";

const fixture = (name: string) => readBoundaryZip(readFileSync(join(import.meta.dirname, "fixtures/census-tiger", name))).features;
const url = (name: string) => `https://www2.census.gov/geo/tiger/TIGER2026/${name}`;
const zctas = fixture("tl_2020_us_zcta520.zip");
async function* stream(features: readonly Feature[]): AsyncIterable<Feature> { yield* features; }
const classified = (error: unknown) => error instanceof SourceAcquisitionFailure && error.code === "PUBLISHER_DOCUMENT_INVALID";

test("committed binary ZIPs preserve active SHP/DBF record pairing across null and deleted records", () => {
  assert.deepEqual(zctas.map(feature => feature.properties.ZCTA5CE20), ["90001", "90002", "90003", "90004", "90005", "90006", "90007", "90008"]);
  assert.equal(zctas[4]!.rings.length, 2, "the multipolygon's rings belong to the correct active DBF row");
});

test("Congress is derived from the DBF session column and checked against filename and CDSESSN", () => {
  const features = fixture("tl_2026_04_cd120.zip");
  const plan = tigerDistrictPlan(features, "cd", url("tl_2026_04_cd120.zip"));
  assert.equal(plan?.version, "cd:120");
  assert.equal(plan?.column, "CD120FP");
  assert.equal(plan?.plan, "120th Congress");
  assert.equal(tigerDistrictPlan(fixture("tl_2028_04_cd121.zip"), "cd", url("tl_2028_04_cd121.zip"))?.version, "cd:121");
  assert.throws(() => tigerDistrictPlan(features, "cd", url("tl_2026_04_cd119.zip")), classified);
  assert.throws(() => tigerDistrictPlan(features.map(feature => ({ ...feature, properties: { ...feature.properties, CDSESSN: "119" } })), "cd", url("tl_2026_04_cd120.zip")), classified);
  assert.throws(() => tigerDistrictPlan(features.map(feature => ({ ...feature, properties: { ...feature.properties, CD119FP: "01" } })), "cd", url("tl_2026_04_cd120.zip")), classified);
});

test("legislative plan years come from assigned rows' LSY, including a newly published plan and a different release year", () => {
  assert.equal(tigerDistrictPlan(fixture("tl_2025_04_sldu.zip"), "sldu", url("tl_2025_04_sldu.zip"))?.version, "sldu:2024");
  assert.equal(tigerDistrictPlan(fixture("tl_2026_04_sldu.zip"), "sldu", url("tl_2026_04_sldu.zip"))?.version, "sldu:2026");
  assert.equal(tigerDistrictPlan(fixture("tl_2028_04_sldu.zip"), "sldu", url("tl_2028_04_sldu.zip"))?.version, "sldu:2028");
  assert.equal(tigerDistrictPlan(fixture("tl_2028_04_sldl.zip"), "sldl", url("tl_2028_04_sldl.zip"))?.version, "sldl:2028");
  const features = fixture("tl_2026_04_sldu.zip");
  assert.throws(() => tigerDistrictPlan(features.map((feature, index) => index === 0 ? { ...feature, properties: { ...feature.properties, LSY: "2028" } } : feature), "sldu", url("tl_2026_04_sldu.zip")), classified);
  assert.throws(() => tigerDistrictPlan(features.map(feature => ({ ...feature, properties: { ...feature.properties, LSY: "" } })), "sldu", url("tl_2026_04_sldu.zip")), classified);
});

test("an empty district family or all-unassigned legislative file establishes no office plan", () => {
  assert.equal(tigerDistrictPlan([], "sldl", url("tl_2026_31_sldl.zip")), null);
  assert.equal(tigerDistrictPlan(fixture("tl_2026_31_sldl.zip"), "sldl", url("tl_2026_31_sldl.zip")), null);
});

for (const family of ["cd", "sldu", "sldl"] as const) {
  test(`${family} polygon joins retain tiny split slivers, holes, boundary contacts and disconnected whole ZCTAs`, async () => {
    const name = `tl_2026_04_${family === "cd" ? "cd120" : family}.zip`;
    const districts = fixture(name), plan = tigerDistrictPlan(districts, family, url(name));
    assert.ok(plan);
    let consumed = 0;
    const input = (async function* () { for (const feature of zctas) { consumed++; yield feature; } })();
    const groups = await buildTigerOverlapGroups(districts, input, plan, "04");
    assert.equal(consumed, zctas.length, "the input stream was consumed exactly once");
    assert.equal(groups.length, 2, "ZZZ/999 rows do not become reader districts");
    const first = groups.find(group => group.geoid === (family === "cd" ? "0401" : "04001"))!;
    const second = groups.find(group => group.geoid === (family === "cd" ? "0402" : family === "sldu" ? "04A01" : "04002"))!;
    assert.deepEqual(first.overlaps, [
      { zcta5: "90001", whole: true, fraction: null },
      { zcta5: "90002", whole: false, fraction: null },
      { zcta5: "90004", whole: true, fraction: null },
      { zcta5: "90006", whole: false, fraction: null },
    ]);
    assert.deepEqual(second.overlaps, [
      { zcta5: "90002", whole: false, fraction: null },
      { zcta5: "90005", whole: true, fraction: null },
    ]);
    assert.ok(groups.every(group => group.stateAbbr === "AZ" && group.memberStates.join() === "AZ"));
    if (family === "sldu") assert.match(second.label, /State Senate District A01/);
  });
}

test("ring order and winding do not turn holes into filled districts", async () => {
  const districts = fixture("tl_2026_04_cd120.zip");
  const plan = tigerDistrictPlan(districts, "cd", url("tl_2026_04_cd120.zip"));
  assert.ok(plan);
  const changed = districts.map(feature => ({ ...feature, rings: feature.rings.map(ring => [...ring].reverse()).reverse() }));
  assert.deepEqual(await buildTigerOverlapGroups(changed, stream(zctas), plan, "04"), await buildTigerOverlapGroups(districts, stream(zctas), plan, "04"));
});

test("separate records of one district are unioned before exact whole containment is decided", async () => {
  const districts = fixture("tl_2026_04_cd120.zip");
  const plan = tigerDistrictPlan(districts, "cd", url("tl_2026_04_cd120.zip"));
  assert.ok(plan);
  const splitSecond = districts[1]!.rings.map(ring => ({ ...districts[1]!, rings: [ring], bbox: [
    Math.min(...ring.map(point => point[0])), Math.min(...ring.map(point => point[1])),
    Math.max(...ring.map(point => point[0])), Math.max(...ring.map(point => point[1])),
  ] as Feature["bbox"] }));
  const groups = await buildTigerOverlapGroups([districts[0]!, ...splitSecond], stream(zctas), plan, "04");
  assert.deepEqual(groups.find(group => group.geoid === "0402")?.overlaps.find(overlap => overlap.zcta5 === "90005"), { zcta5: "90005", whole: true, fraction: null });
});

test("a named House district retains its official county designation and its Census division identity", async () => {
  // Fictional geometry isolates the real Census naming convention: House608
  // is named Merrimack08, so rebuilding its label from608 would lose meaning.
  const source = fixture("tl_2026_04_sldl.zip")[0]!;
  const named: Feature = { ...source, properties: { ...source.properties, STATEFP: "33", SLDLST: "608", GEOID: "33608",
    NAMELSAD: "  State House District Merrimack 08  ", NAME: "Merrimack 08",
  } };
  const plan = tigerDistrictPlan([named], "sldl", url("tl_2026_33_sldl.zip"));
  assert.ok(plan);
  const [group] = await buildTigerOverlapGroups([named], stream([zctas[0]!]), plan, "33");
  assert.ok(group);
  assert.equal(group.label, "State House District Merrimack 08");
  const ocdId = censusWorkDivision({ ...group, type: plan.type, version: plan.version });
  assert.equal(ocdId, "ocd-division/country:us/state:nh/sldl:608");
  assert.equal(designationFromLabel(group.label), "MERRIMACK 8");
  assert.equal(indexDivisions([{ ocdId: ocdId!, label: group.label, divisionType: "sldl" }]).get("nh|lower|MERRIMACK 8"), ocdId);
  const nameOnly = { ...named, properties: { ...named.properties, NAMELSAD: "" } };
  const [fallback] = await buildTigerOverlapGroups([nameOnly], stream([zctas[0]!]), plan, "33");
  assert.equal(fallback?.label, "Merrimack 08");
});

test("duplicate district records retain identical official names and reject conflicting source names", async () => {
  const source = fixture("tl_2026_04_sldl.zip")[0]!;
  const named = { ...source, properties: { ...source.properties, NAMELSAD: "State House District 1" } };
  const plan = tigerDistrictPlan([named], "sldl", url("tl_2026_04_sldl.zip"));
  assert.ok(plan);
  const [same] = await buildTigerOverlapGroups([named, named], stream([zctas[0]!]), plan, "04");
  assert.equal(same?.label, "State House District 1");
  const conflicting = { ...named, properties: { ...named.properties, NAMELSAD: "State House District Other 1" } };
  await assert.rejects(buildTigerOverlapGroups([named, conflicting], stream([zctas[0]!]), plan, "04"), classified);
});

test("malformed coordinates, state identities and ZCTA identifiers fail with a classified publisher error", async () => {
  const districts = fixture("tl_2026_04_cd120.zip"), plan = tigerDistrictPlan(districts, "cd", url("tl_2026_04_cd120.zip"));
  assert.ok(plan);
  await assert.rejects(buildTigerOverlapGroups(districts, stream(zctas), plan, "48"), classified);
  const badRing = { ...districts[0]!, rings: [[...districts[0]!.rings[0]!.slice(0, -1), [Number.NaN, 30] as [number, number]]] };
  await assert.rejects(buildTigerOverlapGroups([badRing], stream(zctas), plan, "04"), classified);
  const badZip = { ...zctas[0]!, properties: { ...zctas[0]!.properties, ZCTA5CE20: "9000" } };
  await assert.rejects(buildTigerOverlapGroups(districts, stream([badZip]), plan, "04"), classified);
});

test("aborting the streamed join closes its iterator and returns no partial publication", async () => {
  const districts = fixture("tl_2026_04_cd120.zip"), plan = tigerDistrictPlan(districts, "cd", url("tl_2026_04_cd120.zip"));
  assert.ok(plan);
  const controller = new AbortController(), reason = new Error("fixture acquisition aborted");
  let closed = false;
  const input = (async function* () {
    try { yield zctas[0]!; controller.abort(reason); yield zctas[1]!; }
    finally { closed = true; }
  })();
  await assert.rejects(buildTigerOverlapGroups(districts, input, plan, "04", controller.signal), error => error === reason);
  assert.ok(closed);
});
