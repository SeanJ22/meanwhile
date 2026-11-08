import assert from "node:assert/strict";
import test from "node:test";
import { assertIsolatedCopy, nationalResultCounts } from "../scripts/election-results-national-check.mts";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import type { ElectionResult } from "../lib/election-results/types.ts";

const provenance = { sourceUrl: "https://example.gov/ballot", sourceOrg: "Election office", collectedAt: "2026-11-07T00:00:00Z", verifiedAt: null };
const contest = { id: "statewide-contest", electionId: "general", ocdId: "ocd-division/country:us/state:az", divisionVintage: "2026", title: "Governor",
  type: "CANDIDACY" as const, voteFor: 1, termYears: 4, scopeNote: null, provenance };
const ballot: BallotSet = { election: { id: "general", state: "AZ", date: "2026-11-03", name: "General election" }, contests: [contest], candidacies: [
  { id: "choice-a", contestId: contest.id, givenName: "Alice", familyName: "Quinn", partyLabel: null, incumbent: null, slogan: null, websiteUrl: null, provenance },
], measures: [], absences: [] };
const race: ElectionResult = { state: "AZ", electionDate: "2026-11-03", office: "governor", officeName: "Governor", sourceId: "multistate", sourceName: "MultiState",
  sourceUrl: "https://example.gov/result", sourceRaceId: "result-1", creditedSources: [], status: "called", candidates: [{ name: "Alice Quinn", won: true }, { name: "Bob Reed" }],
  checkedAt: "2026-11-07T00:00:00Z", quote: "" };
const copy = (): Parameters<typeof nationalResultCounts>[0] => ({
  states: Object.values(FIPS_TO_STATE).filter(row => row.prefix === "state").map(row => row.postal), ballots: [ballot],
});
const source = { races: [race], sourceErrors: [], catalogErrors: [] };

test("national count separates missing candidates from a race with no contest", () => {
  const found = nationalResultCounts(copy(), { ...source, races: [race, { ...race, sourceRaceId: "missing", office: "us_senate", officeName: "U.S. Senate" }] });
  assert.ok(found.complete);
  assert.equal(found.matchedRaces, 1);
  assert.equal(found.noContestFixRows, 1);
  assert.equal(found.candidateFixRows, 1);
  assert.equal(found.nationalFixRows, 2);
  assert.deepEqual(found.work.map(row => row.reason), ["Candidate missing from served ballot", "No served contest matches this race"]);
});

test("a subset of state authorities cannot establish a national unmatched count", () => {
  const value = copy();
  const found = nationalResultCounts({ ...value, states: value.states.filter(state => state !== "AZ") }, source);
  assert.equal(found.complete, false);
  assert.equal(found.nationalFixRows, null);
  assert.deepEqual(found.incompleteStates, ["AZ"]);
});

test("failed source acquisition cannot establish a national unmatched count", () => {
  assert.equal(nationalResultCounts(copy(), { ...source, sourceErrors: ["source unavailable"] }).nationalFixRows, null);
  assert.equal(nationalResultCounts(copy(), { ...source, catalogErrors: ["catalog unavailable"] }).nationalFixRows, null);
});

test("the full-authority audit rejects a production, default, expired, or mismatched connection target", () => {
  const metadata = { branchId: "br-copy", parentBranchId: "br-parent", host: "copy.invalid", primary: false, default: false,
    snapshotAt: "2026-11-07T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z" };
  assert.doesNotThrow(() => assertIsolatedCopy("postgresql://test@copy.invalid/test", metadata));
  for (const changed of [{ primary: true }, { default: true }, { branchId: "br-parent" }, { expiresAt: "2000-01-01T00:00:00Z" }])
    assert.throws(() => assertIsolatedCopy("postgresql://test@copy.invalid/test", { ...metadata, ...changed }), /isolated database copy/);
  assert.throws(() => assertIsolatedCopy("postgresql://test@production.invalid/test", metadata), /isolated database copy/);
});
