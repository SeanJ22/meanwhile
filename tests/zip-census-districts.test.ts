import assert from "node:assert/strict";
import { test } from "node:test";
import { POINT_GEOMETRY_PLANS, divisionIdsForZipArea, unestablishedDistrictOffices } from "../lib/ballot/zip-divisions.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import { createCensusDistrictReaderEdge, type CensusDistrictReaderEdge } from "../lib/census-geography/district-edge.ts";
import type { BuiltDataset } from "../lib/census-geography/dataset.ts";
import { selectGeographyVersion } from "../lib/census-geography/selection.ts";
import { withCensusDistricts } from "../lib/geo/zip-census-districts.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { contestsForDivisions } from "../lib/sources/ballot-nj-morris/index.ts";
import { azBallot, azDistricts, azDistrictSlice, azDistrictDataset, districtFixtureStore, publishDistrictFixture, electionSelection } from "./helpers/ballot-district-fixtures.ts";

const districtIds = (ids: readonly string[]) => ids.filter(id => /\/(?:cd|sldu|sldl):/.test(id)).sort();
const withDistricts = <T>(edge: CensusDistrictReaderEdge, read: () => T): T => withReaderAuthorityEdge({ censusDistricts: edge }, read);

for (const [zip, expected] of [
  ["85701", ["state-senate-20", "state-house-20", "us-house-7"]],
  ["85641", ["state-senate-17", "state-senate-19", "state-house-17", "state-house-19", "us-house-6"]],
] as const) {
  test(`${zip} matches its 2026 district contests from held Census rows and the committed Pima ballot`, async () => {
    const ids = await withDistricts(azDistricts, () => divisionIdsForZipArea(zip, [], electionSelection, POINT_GEOMETRY_PLANS));
    const contests = contestsForDivisions(azBallot, ids).contests.filter(contest => /\/(?:cd|sldu|sldl):/.test(contest.ocdId));
    assert.deepEqual(contests.map(contest => contest.id.split(":").at(-1)).sort(), [...expected].sort());
    assert.deepEqual(unestablishedDistrictOffices(azBallot, ids), []);
    const future = await withDistricts(azDistricts, () => divisionIdsForZipArea(zip, [], { purpose: "representation", asOf: "2027-03-01" }, POINT_GEOMETRY_PLANS));
    assert.deepEqual(districtIds(future), districtIds(ids), "an unchanged held plan keeps serving after the next term starts");
  });
}

test("published ZIP rows replace only their state and family, and retain independent local uncertainty", async () => {
  const local = "ocd-division/country:us/state:az/place:tucson";
  const texas = "ocd-division/country:us/state:tx/cd:7";
  const old = { ids: [local, texas, "ocd-division/country:us/state:az/cd:6", "ocd-division/country:us/state:az/sldu:1"], partial: [local, texas], samples: 19 };
  const joined = withCensusDistricts(old, await azDistrictSlice("85701"), "85701", electionSelection);
  assert.deepEqual(districtIds(joined.ids), ["ocd-division/country:us/state:az/cd:7", "ocd-division/country:us/state:az/sldl:20", "ocd-division/country:us/state:az/sldu:20", texas].sort());
  assert.deepEqual(joined.partial, old.partial);
  assert.deepEqual([...joined.qualifiedDistricts ?? []].sort(), ["az/cd", "az/sldl", "az/sldu"]);
});

test("failed reads, missing ZIP rows and ambiguous plans retain the existing entry without claiming qualification", async () => {
  const old = { ids: ["ocd-division/country:us/state:az/cd:6"], partial: [], samples: 19 };
  const source = await azDistrictSlice("85701");
  assert.deepEqual(withCensusDistricts(old, { kind: "UNREAD", detail: "source failed" }, "85701", electionSelection), old);
  assert.deepEqual(districtIds(withCensusDistricts(old, await azDistrictSlice("99999"), "99999", electionSelection).ids), old.ids);
  const conflict = { ...source, value: { ...source.value, scopes: [...source.value.scopes, {
    type: "congressional_district" as const, version: "cd:unresolved", plan: "Unresolved contemporaneous plan",
    applicability: [{ purpose: "election" as const, from: "2024-11-05" }],
  }] } };
  const joined = withCensusDistricts(old, conflict, "85701", electionSelection);
  assert.deepEqual(districtIds(joined.ids).filter(id => id.includes("/cd:")), old.ids);
  assert.ok(!joined.qualifiedDistricts?.includes("az/cd"));
  const partial = { ...source, value: { ...source.value, containers: source.value.containers.map(container => ({ ...container,
    overlaps: [{ zcta5: "85701", whole: false, fraction: 0.4 }],
  })) } };
  assert.ok(withCensusDistricts(old, partial, "85701", electionSelection).partial.includes("ocd-division/country:us/state:az/cd:7"));
});

test("a stored stale state-legislative interval still establishes Arizona's 2026 ballot and next-term representation", async () => {
  const source = await azDistrictSlice("85701");
  const stale = { ...source, value: { ...source.value, scopes: source.value.scopes.map(scope => ({ ...scope,
    applicability: [{ purpose: "representation" as const, from: "2025-01-01", through: "2027-01-01" }],
  })) } };
  for (const selection of [electionSelection, { purpose: "representation" as const, asOf: "2027-03-01" }]) {
    const ids = withCensusDistricts({ ids: [], partial: [], samples: 0 }, stale, "85701", selection).ids;
    assert.ok(ids.includes("ocd-division/country:us/state:az/sldu:20"));
    assert.ok(ids.includes("ocd-division/country:us/state:az/sldl:20"));
  }
});

test("when Census ZIP rows are unavailable, Arizona's declared point plan answers the ballot and an undeclared point plan does not", async () => {
  const local = "ocd-division/country:us/state:az/place:tucson";
  const point = [local, "ocd-division/country:us/state:az/cd:7", "ocd-division/country:us/state:az/sldu:20", "ocd-division/country:us/state:az/sldl:20"];
  const unavailable = <T>(read: () => T): T => withReaderAuthorityEdge({}, read);
  const declared = await unavailable(() => divisionIdsForZipArea("85701", point, electionSelection, POINT_GEOMETRY_PLANS));
  assert.ok(point.every(id => declared.includes(id)));
  assert.deepEqual(unestablishedDistrictOffices(azBallot, declared), []);
  const undeclared = await unavailable(() => divisionIdsForZipArea("85701", point, electionSelection));
  assert.ok(undeclared.includes(local));
  assert.deepEqual(districtIds(undeclared), []);
  assert.deepEqual([...unestablishedDistrictOffices(azBallot, undeclared)].sort(), ["State House", "State Senate", "U.S. House"]);
});

function stateDataset(state: "TX" | "MI", zip: string): BuiltDataset {
  const stateFips = state === "TX" ? "48" : "26";
  return { ...azDistrictDataset, zctaUniverse: [zip], scopes: azDistrictDataset.scopes.map(scope => {
    const groupings = scope.groupings.filter(group => group.overlaps.some(overlap => overlap.zcta5 === "85701")).map(group => ({ ...group,
      stateAbbr: state, stateFips, memberStates: [state], geoid: stateFips + group.geoid.slice(2),
      ocdId: group.ocdId?.replace("/state:az/", `/state:${state.toLowerCase()}/`) ?? null,
      label: `${state} test district`, overlaps: [{ zcta5: zip, whole: true, fraction: 1 }],
    }));
    return { ...scope, groupings, instanceCount: groupings.length, zctaEdgeCount: groupings.length,
      versionMeta: { ...scope.versionMeta, states: [state] } };
  }).filter(scope => scope.groupings.length) };
}
async function stateEdge(dataset: BuiltDataset, version: string): Promise<CensusDistrictReaderEdge> {
  return createCensusDistrictReaderEdge(await publishDistrictFixture(districtFixtureStore, version, dataset), districtFixtureStore);
}
function stateBallot(state: "TX" | "MI"): BallotSet {
  return { ...azBallot, election: { ...azBallot.election, state }, contests: azBallot.contests.filter(contest => /\/(?:cd|sldu|sldl):/.test(contest.ocdId))
    .map(contest => ({ ...contest, ocdId: contest.ocdId.replace("/state:az/", `/state:${state.toLowerCase()}/`) })) };
}

test("Texas's old House plan is excluded for its 2026 election until a complete cd:120 plan is held", async () => {
  const dataset = stateDataset("TX", "77002");
  const old = await stateEdge(dataset, "state-plan-fixture:TX");
  const versions = dataset.scopes.map(scope => scope.versionMeta);
  assert.equal(selectGeographyVersion(versions, "congressional_district", electionSelection, "TX"), null);
  const point = ["ocd-division/country:us/state:tx/cd:7"];
  const ids = await withDistricts(old, () => divisionIdsForZipArea("77002", point, electionSelection, POINT_GEOMETRY_PLANS));
  assert.ok(!ids.some(id => /\/state:tx\/cd:/.test(id)));
  assert.deepEqual(unestablishedDistrictOffices(stateBallot("TX"), ids), ["U.S. House"]);
  const scope = dataset.scopes.find(scope => scope.type === "congressional_district")!;
  const group = scope.groupings[0];
  const nextDataset: BuiltDataset = { ...dataset, scopes: [...dataset.scopes, { ...scope, version: "cd:120",
    versionMeta: { ...scope.versionMeta, key: "cd:120", retrievalComplete: true },
    groupings: [{ ...group, geoid: "4838", ocdId: "ocd-division/country:us/state:tx/cd:38" }],
  }] };
  const next = await stateEdge(nextDataset, "state-plan-fixture:TX:120");
  const current = await withDistricts(next, () => divisionIdsForZipArea("77002", point, electionSelection, POINT_GEOMETRY_PLANS));
  assert.ok(current.includes("ocd-division/country:us/state:tx/cd:38"));
  assert.ok(!current.includes(point[0]));
  assert.deepEqual(unestablishedDistrictOffices(stateBallot("TX"), current), []);
});

test("Michigan's 2024 Senate plan is excluded for 2026 while its unchanged House plan answers", async () => {
  const edge = await stateEdge(stateDataset("MI", "48104"), "state-plan-fixture:MI");
  const ids = await withDistricts(edge, () => divisionIdsForZipArea("48104", ["ocd-division/country:us/state:mi/sldu:20"], electionSelection, POINT_GEOMETRY_PLANS));
  assert.ok(!ids.some(id => /\/state:mi\/sldu:/.test(id)));
  assert.ok(ids.includes("ocd-division/country:us/state:mi/sldl:20"));
  assert.deepEqual(unestablishedDistrictOffices(stateBallot("MI"), ids), ["State Senate"]);
});
