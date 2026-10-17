import assert from "node:assert/strict";
import { stateBallotContractId } from "../lib/civic-data/state-scopes.ts";
import test from "node:test";
import { createHash } from "node:crypto";
import { addressDivisions, addressStateFips, lookupAddressGeographies } from "../lib/geo/address-geographies.ts";
import { ballotScopeAtAddress } from "../lib/geo/address-ballot-scope.ts";
import { resolveAddress, confirmedDivisionIds } from "../lib/geo/address-resolution.ts";
import type { CodeSlice, Slice } from "../lib/control-plane/admin-view/promoted-slices.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import { workerBallotContestsPackage } from "../lib/civic-data/worker-ballot-contests.ts";
import { parseCivicRecords } from "../lib/control-plane/workers/parser.ts";
import type { GeneralizedCivicExtractionContract, WorkerEvidence, WorkerResultRecord } from "../lib/control-plane/workers/types.ts";
import type { AutonomousWorkPlan } from "../lib/control-plane/workers/autonomous-plan.ts";
import type { RegistryRuntimePrior } from "../lib/registry/runtime-data-plane.ts";
import type { GenericBallotProjection } from "../lib/ballot/generic-projection.ts";

// Deliberately synthetic service shapes: these test purpose/date handling, not real district coverage.
const held: Slice<CodeSlice> = { kind: "HELD", versionId: "fixture", value: { known: true,
  scopes: [
    { type: "congressional_district", version: "cd:119", plan: "119", applicability: [{ purpose: "representation", from: "2025-01-03", through: "2027-01-03" }] },
    { type: "congressional_district", version: "cd:120", plan: "120", applicability: [{ purpose: "election", from: "2026-11-03", through: "2026-11-04" }] },
  ],
  containers: [
    { ref: { type: "congressional_district", version: "cd:119", geoid: "3903", ocdId: "ocd-division/country:us/state:oh/cd:3", label: "Current district", stateFips: "39", stateAbbr: "OH", memberStates: ["OH"] }, plan: "119", overlaps: [] },
    { ref: { type: "congressional_district", version: "cd:120", geoid: "3915", ocdId: "ocd-division/country:us/state:oh/cd:15", label: "Election district", stateFips: "39", stateAbbr: "OH", memberStates: ["OH"] }, plan: "120", overlaps: [] },
  ],
} };
const geographies = { "119th Congressional Districts": [{ GEOID: "3903" }], "120th Congressional Districts": [{ GEOID: "3915" }],
  "121st Congressional Districts": [{ GEOID: "3999" }] };

test("an exact address uses the qualified current plan and a separate election plan", () => {
  const representation = addressDivisions(geographies, held, { purpose: "representation", asOf: "2026-10-12" });
  assert.deepEqual(representation.map(row => row.ocdId), ["ocd-division/country:us/state:oh/cd:3"]);
  const election = addressDivisions(geographies, held, { purpose: "election", asOf: "2026-10-12", electionDate: "2026-11-03" });
  assert.deepEqual(election.map(row => row.ocdId), ["ocd-division/country:us/state:oh/cd:15"]);
  assert.deepEqual(addressDivisions(geographies, held, { purpose: "election", asOf: "2026-10-12", electionDate: "2020-11-03" }), []);
});

test("a missing election layer, ambiguous applicability or unmapped feature never borrows another plan", () => {
  const election = { purpose: "election" as const, asOf: "2026-10-12", electionDate: "2026-11-03" };
  assert.deepEqual(addressDivisions({ "119th Congressional Districts": geographies["119th Congressional Districts"] }, held, election), []);
  assert.deepEqual(addressDivisions({ "120th Congressional Districts": [{ GEOID: "3999" }] }, held, election), []);
  assert.ok(held.kind === "HELD");
  const conflict = { ...held, value: { ...held.value, scopes: [...held.value.scopes,
    { ...held.value.scopes[1], version: "cd:121" }], containers: [...held.value.containers,
      { ...held.value.containers[1], ref: { ...held.value.containers[1].ref, version: "cd:121", geoid: "3999" } }] } };
  assert.deepEqual(addressDivisions(geographies, conflict, election), []);
});

test("ballot exclusions use the date-qualified address plan; dataset labels never identify a plan", () => {
  const contest = (id: string, district: string, divisionVintage = "TIGER_GENZ2025") => ({ id, electionId: "election", ocdId: `ocd-division/country:us/state:oh/${district}`, divisionVintage });
  const ballot = { election: { id: "election", date: "2026-11-03" }, contests: [contest("inside", "cd:15"), contest("outside", "cd:3"),
    contest("other-dataset", "cd:3", "CENSUS_RELATIONSHIPS"), contest("state-unknown", "sldu:1"), contest("local-unknown", "county:franklin"),
    { ...contest("other-state", "cd:3"), ocdId: "ocd-division/country:us/state:in/cd:3" }],
  } as BallotSet;
  assert.deepEqual(ballotScopeAtAddress(geographies, held, [ballot], "2026-10-12"), { contestIds: ["inside"], excludedContestIds: ["outside", "other-dataset"] });
  assert.deepEqual(ballotScopeAtAddress(geographies, held, [{ ...ballot, election: { ...ballot.election, date: "2020-11-03" } }], "2026-10-12"), { contestIds: [], excludedContestIds: [] });
});

test("empty exact-address geography establishes no home district", () => {
  const sample = [{ ocdId: "ocd-division/country:us/state:oh/cd:3", divisionType: "cd" as const, label: "District 3" }];
  assert.deepEqual(confirmedDivisionIds(resolveAddress([sample])), [sample[0].ocdId]);
  assert.equal(resolveAddress([[]]).status, "FAILED");
});

test("address GEOIDs qualify plan selection by state and never borrow a bordering state's plan", () => {
  assert.equal(addressStateFips(geographies), "39");
  assert.equal(addressStateFips({ "2024 State Legislative Districts - Upper": [{ GEOID: "04014" }] }), "04");
  assert.equal(addressStateFips({ Counties: [{ GEOID: "39049" }] }), null);
  assert.equal(addressStateFips({ ...geographies, "2024 State Legislative Districts - Upper": [{ GEOID: "04014" }] }), null);
  assert.ok(held.kind === "HELD");
  const bordering = { ...held, value: { ...held.value, scopes: [...held.value.scopes,
    { ...held.value.scopes[1], version: "cd:121" }], containers: [...held.value.containers,
      { ...held.value.containers[1], ref: { ...held.value.containers[1].ref, version: "cd:121", geoid: "1803", stateFips: "18", stateAbbr: "IN", memberStates: ["IN"] } }] } };
  assert.deepEqual(addressDivisions(geographies, bordering, { purpose: "election", asOf: "2026-10-12", electionDate: "2026-11-03", stateFips: "39" })
    .map(row => row.ocdId), ["ocd-division/country:us/state:oh/cd:15"]);
});

test("real worker-ballot-contests output hides only outside contests in the address's state", () => {
  const now = "2026-10-12T07:00:00.000Z";
  const fields = ["election", "office", "jurisdictionName", "candidateName", "electionDate"];
  const text = fields.join(",") + "\n" + [
    "2026 General Election,U.S. Representative,Election district,Alice Adams,2026-11-03",
    "2026 General Election,U.S. Representative,Current district,Bob Baker,2026-11-03",
  ].join("\n");
  const evidence: WorkerEvidence = { artifactId: "candidate-list", contentHash: `sha256-${createHash("sha256").update(text).digest("hex")}`,
    text, acquiredByAttemptId: "acquired", canonicalUrl: "https://elections.example.gov/candidates", retrievedAt: now,
    sourceId: "Fixture election authority", methodRouteId: "list" };
  const contract: GeneralizedCivicExtractionContract = { schemaVersion: 2, recordClass: "BALLOT_CONTEST", subjectId: "fixture:oh",
    jurisdiction: { country: "US", state: "OH", canonicalId: "fixture:oh" }, identity: { namespace: "fixture-ballot", keyFields: ["election", "office", "candidateName"] },
    sourceScope: { sourceId: evidence.sourceId, publisher: evidence.sourceId, routeIds: ["list"], canonicalUrls: [evidence.canonicalUrl], observationArtifactIds: [evidence.artifactId] },
    methodVersion: 1, requiredFields: ["election", "office", "candidateName"], completenessScope: "Every candidate on this fixture list", expectedSourceDate: null,
    extraction: { format: "DELIMITED_TEXT", delimiter: ",", headerRows: 1, fields: Object.fromEntries(fields.map((field, index) => [field, { source: index, type: "STRING" as const }])) },
    verification: { required: false, authorities: [] } };
  const result = parseCivicRecords({ attemptId: "parsed", worker: { role: "PARSER", instance: "fixture", provider: "deterministic", version: "2" }, evidence, contract });
  assert.equal(result.verdict, "EXTRACTED");
  assert.ok(held.kind === "HELD");
  const registry = { payload: { registry: { divisions: held.value.containers.map(({ ref }) => ({ state: "OH", label: ref.label,
    ocdId: ref.ocdId, sourceDataset: "TIGER_GENZ2025" })) } } } as RegistryRuntimePrior;
  const checked = workerBallotContestsPackage({
    plan: { contract, publication: { contractId: stateBallotContractId("ballot-contests", "OH"), bodyId: "fixture-body" } } as AutonomousWorkPlan,
    parser: { id: "parsed", workItemId: "ballot", endedAt: now, result } as WorkerResultRecord, registry, now,
    captures: [{ evidence, observedAt: now, transport: "REACHABLE", partial: false, httpStatus: 200 }],
  });
  const ballot = Object.values((checked.package.payload as GenericBallotProjection).ballots)[0];
  assert.ok(ballot.contests.every(contest => contest.divisionVintage === "TIGER_GENZ2025"));
  assert.deepEqual(checked.heldContests, []);
  const inside = ballot.contests.find(contest => contest.ocdId.endsWith("/cd:15"))!;
  const outside = ballot.contests.find(contest => contest.ocdId.endsWith("/cd:3"))!;
  assert.deepEqual(ballotScopeAtAddress(geographies, held, [ballot], "2026-10-12"), {
    contestIds: [inside.id], excludedContestIds: [outside.id],
  });
});

test("Census lookup validates one match and ZIP, returns no point, uses no cache, and fails without logging request details", async () => {
  const match = { coordinates: { x: -83.000739, y: 39.961232 }, addressComponents: { zip: "43215" }, geographies };
  let init: RequestInit | undefined;
  const fetchImpl = (async (_url, options) => { init = options; return Response.json({ result: { addressMatches: [match] } }); }) as typeof fetch;
  const result = await lookupAddressGeographies("1 Capitol Sq, 43215", "43215", { fetchImpl });
  assert.deepEqual(result, { kind: "MATCHED", geographies });
  assert.doesNotMatch(JSON.stringify(result), /coordinates|39\.961232|-83\.000739/);
  assert.equal(init?.cache, "no-store");
  assert.equal(await lookupAddressGeographies("1 Capitol Sq, 43215", "43215", { fetchImpl: (async () => Response.json({ result: { addressMatches: [match, match] } })) as typeof fetch }), null);
  assert.deepEqual(await lookupAddressGeographies("1 Capitol Sq, 99999", "99999", { fetchImpl }), { kind: "OTHER_ZIP", zip: "43215" });
});

test("a known address without geography coverage is distinguished from a missing match", async () => {
  const match = { coordinates: { x: -83.000739, y: 39.961232 }, addressComponents: { zip: "43215" } };
  assert.deepEqual(await lookupAddressGeographies("1 Capitol Sq, 43215", "43215", {
    fetchImpl: (async () => Response.json({ result: { addressMatches: [match] } })) as typeof fetch,
  }), { kind: "MATCHED", geographies: null });
  assert.equal(await lookupAddressGeographies("1 Capitol Sq, 43215", "43215", {
    fetchImpl: (async () => Response.json({ result: { addressMatches: [] } })) as typeof fetch,
  }), null);
});
