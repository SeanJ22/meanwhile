import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ballotForDivisions } from "../lib/ballot/contests.ts";
import type { BallotSet, CandidacyRemoval } from "../lib/ballot/types.ts";

test("a documented withdrawal remains sourced as a filing change without being a current choice", () => {
  const division = "ocd-division/country:us/state:oh";
  const provenance = { sourceUrl: "https://elections.example.gov/filing.pdf", sourceOrg: "Election authority",
    collectedAt: "2026-10-14T00:00:00Z", verifiedAt: null };
  const candidate = { id: "withdrawn", contestId: "governor", familyName: "Earlier ticket", givenName: "",
    partyLabel: null, slogan: null, incumbent: null, websiteUrl: null, provenance };
  const change: CandidacyRemoval = { ...candidate, status: "REMOVED_FROM_FILING", lastListed: provenance,
    absentFrom: { ...provenance, sourceUrl: "https://elections.example.gov/withdrawal.pdf", collectedAt: "2026-10-20T00:00:00Z",
      quote: "The earlier ticket withdrew." }, firstAbsentOn: "2026-10-20", statement: "The earlier ticket withdrew." };
  const raw: BallotSet = { election: { id: "general", date: "2026-11-03", name: "General", state: "OH" },
    contests: [{ id: "governor", electionId: "general", ocdId: division, divisionVintage: "2026", title: "Governor",
      type: "CANDIDACY", voteFor: 1, termYears: 4, scopeNote: null, provenance }],
    candidacies: [candidate, { ...candidate, id: "current", familyName: "Current ticket" }],
    measures: [], absences: [], removals: [change] };
  const before = structuredClone(raw), reader = ballotForDivisions(raw, [division]);
  assert.deepEqual(reader.candidacies.map(row => row.id), ["current"]);
  assert.deepEqual(reader.filingCandidacies, [candidate]);
  assert.deepEqual(reader.removals, [change]);
  assert.deepEqual(raw, before);
  assert.deepEqual(ballotForDivisions(reader, [division]), reader);
  const reinstated = structuredClone(raw);
  reinstated.candidacies[0].provenance.collectedAt = "2026-10-21T00:00:00Z";
  assert.equal(ballotForDivisions(reinstated, [division]).candidacies.length, 2);
});

test("Ohio's explicit October 15 withdrawal retains both names and the earlier filing in the reader", () => {
  const file = JSON.parse(readFileSync("data/ballot/2026-general/oh.json", "utf8"));
  const ballot = Object.values(file.ballots)[0] as BallotSet;
  const change = ballot.removals!.find(row => row.id === "oh-sos-2026-general-governor-and-lieutenant-governor-c36be62900f6")!;
  assert.ok(change);
  assert.match(change.absentFrom.quote!, /Withdrawn 10\/15\/2026/);
  assert.match(change.statement, /Ron Ula.*Michael C\. Lehnerd/);
  const reader = ballotForDivisions(ballot, ["ocd-division/country:us/state:oh"]);
  assert.ok(!reader.candidacies.some(row => row.id === change.id));
  assert.ok(reader.filingCandidacies!.some(row => row.id === change.id));
  assert.ok(reader.removals!.some(row => row.id === change.id));
  assert.ok(ballot.candidacies.some(row => row.id === change.id), "the saved record and its old provenance remain intact");
});
