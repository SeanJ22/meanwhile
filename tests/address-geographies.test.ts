import assert from "node:assert/strict";
import test from "node:test";
import { addressDivisions, lookupAddressGeographies } from "../lib/geo/address-geographies.ts";
import { ballotScopeAtAddress } from "../lib/geo/address-ballot-scope.ts";
import { resolveAddress, confirmedDivisionIds } from "../lib/geo/address-resolution.ts";
import type { CodeSlice, Slice } from "../lib/control-plane/admin-view/promoted-slices.ts";
import type { BallotSet } from "../lib/ballot/types.ts";

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
  assert.deepEqual(addressDivisions(geographies, held, { purpose: "election", asOf: "2026-10-12", electionDate: "2028-11-07" }), []);
});

test("a missing election layer, ambiguous applicability or unmapped feature never borrows another plan", () => {
  const election = { purpose: "election" as const, asOf: "2026-10-12", electionDate: "2026-11-03" };
  assert.deepEqual(addressDivisions({ "119th Congressional Districts": geographies["119th Congressional Districts"] }, held, election), []);
  assert.deepEqual(addressDivisions({ "120th Congressional Districts": [{ GEOID: "3999" }] }, held, election), []);
  assert.ok(held.kind === "HELD");
  const conflict = { ...held, value: { ...held.value, scopes: [...held.value.scopes,
    { ...held.value.scopes[1], version: "cd:121" }] } };
  assert.deepEqual(addressDivisions(geographies, conflict, election), []);
});

test("ballot exclusions require matching election date, level and source plan; all other contests stay visible", () => {
  const contest = (id: string, district: string, divisionVintage = "cd:120") => ({ id, electionId: "election", ocdId: `ocd-division/country:us/state:oh/${district}`, divisionVintage });
  const ballot = { election: { id: "election", date: "2026-11-03" }, contests: [contest("inside", "cd:15"), contest("outside", "cd:3"),
    contest("unknown-vintage", "cd:3", "2023"), contest("state-unknown", "sldu:1"), contest("local-unknown", "county:franklin")],
  } as BallotSet;
  assert.deepEqual(ballotScopeAtAddress(geographies, held, [ballot], "2026-10-12"), { contestIds: ["inside"], excludedContestIds: ["outside"] });
  assert.deepEqual(ballotScopeAtAddress(geographies, held, [{ ...ballot, election: { ...ballot.election, date: "2028-11-07" } }], "2026-10-12"), { contestIds: [], excludedContestIds: [] });
});

test("agreement among street samples never confirms the reader's home district", () => {
  const sample = [{ ocdId: "ocd-division/country:us/state:oh/cd:3", divisionType: "cd" as const, label: "District 3" }];
  assert.deepEqual(confirmedDivisionIds(resolveAddress([sample, sample], "STREET_SAMPLE")), []);
  assert.equal(resolveAddress([[]], "EXACT_ADDRESS").status, "FAILED");
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
