import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ballotForDivisions } from "../lib/ballot/contests.ts";
import { ballotCandidateDisplayName } from "../lib/ballot/name-case.ts";
import { withCandidateTickets, type BallotWithTickets } from "../lib/ballot/tickets.ts";
import type { Candidacy, Contest } from "../lib/ballot/types.ts";

const state = "ocd-division/country:us/state:az";
const provenance = { sourceUrl: "https://elections.example.gov/general.pdf", sourceOrg: "Election authority",
  collectedAt: "2026-10-20T00:00:00Z", verifiedAt: null, quote: "Governor and Lieutenant Governor: A Lead / B Mate" };
const contest = (id: string, title: string): Contest => ({ id, electionId: "general", title, ocdId: state,
  divisionVintage: "2026", type: "CANDIDACY", voteFor: 1, termYears: 4, scopeNote: null, provenance });
const candidate = (id: string, contestId: string, familyName: string, partyLabel: string | null): Candidacy => ({
  id, contestId, familyName, givenName: "", partyLabel, slogan: null, incumbent: null, websiteUrl: null, provenance,
});
function fixture(): BallotWithTickets {
  const lead = candidate("lead", "governor", "A Lead", "DEM"), mate = candidate("mate", "lieutenant", "B Mate", "PND");
  return { election: { id: "general", date: "2026-11-03", name: "General election", state: "AZ" },
    contests: [contest("governor", "Governor"), contest("lieutenant", "Lieutenant Governor")],
    candidacies: [lead, mate], measures: [], absences: [],
    candidateTickets: [{ id: "ticket", leadCandidacyId: lead.id, runningMate: mate, provenance }] };
}

test("an explicitly paired ticket displays both people and parties as one choice without changing saved records", () => {
  const raw = fixture(), before = structuredClone(raw);
  const view = ballotForDivisions(raw, [state]);
  assert.deepEqual(view.contests.map(row => [row.id, row.title]), [["governor", "Governor / Lieutenant Governor"]]);
  assert.deepEqual(view.candidacies.map(row => [row.id, ballotCandidateDisplayName(row), row.partyLabel]),
    [["lead", "A Lead / B Mate", "DEM / PND"]]);
  assert.equal(view.candidacies[0].provenance, raw.candidateTickets![0].provenance);
  assert.deepEqual(raw, before);
  assert.deepEqual(withCandidateTickets(view), view, "projection is idempotent");
  assert.equal(ballotForDivisions(raw, ["ocd-division/country:us/state:tx"]).contests.length, 0);
});

test("unpaired candidates, ambiguous pairings and different divisions never disappear", () => {
  const partial = fixture();
  partial.candidacies.push(candidate("unpaired", "lieutenant", "C Person", "DEM"));
  assert.equal(withCandidateTickets(partial).contests.length, 2);
  assert.ok(withCandidateTickets(partial).candidacies.some(row => row.id === "unpaired"));
  const differentDivision = fixture();
  differentDivision.contests[1].ocdId = `${state}/county:pima`;
  assert.deepEqual(withCandidateTickets(differentDivision), differentDivision);
  const ambiguous = fixture();
  ambiguous.candidateTickets = [...ambiguous.candidateTickets!, { ...ambiguous.candidateTickets![0], id: "another-pair" }];
  assert.deepEqual(withCandidateTickets(ambiguous), ambiguous);
  const noPairs = fixture();
  delete noPairs.candidateTickets;
  assert.deepEqual(withCandidateTickets(noPairs), noPairs, "matching parties alone cannot create a ticket");
});

test("Arizona, Colorado and Wisconsin official ticket records reach the division-filtered reader", () => {
  for (const name of ["az", "co", "wi"]) {
    const file = JSON.parse(readFileSync(`data/ballot/2026-general/${name}.json`, "utf8"));
    const raw = Object.values(file.ballots)[0] as BallotWithTickets;
    const before = JSON.stringify(raw), view = ballotForDivisions(raw, [`ocd-division/country:us/state:${name}`]);
    assert.equal(raw.candidateTickets?.length, name === "az" ? 4 : name === "co" ? 7 : 2);
    for (const ticket of raw.candidateTickets!) {
      const lead = view.candidacies.find(row => row.id === ticket.leadCandidacyId);
      assert.ok(lead);
      assert.ok(ballotCandidateDisplayName(lead).includes(ballotCandidateDisplayName(ticket.runningMate)));
      assert.equal(lead.provenance.sourceUrl, ticket.provenance.sourceUrl);
    }
    assert.equal(JSON.stringify(raw), before);
    if (name !== "az") assert.equal(view.contests.filter(row => /Governor/.test(row.title)).length, 1);
    if (name === "az") {
      const governor = view.generalLineup!.contests.find(row => row.contestId === raw.candidacies.find(c => c.id === raw.candidateTickets![0].leadCandidacyId)!.contestId)!;
      assert.ok(governor.nominees.some(row => row.name === "Katie Hobbs / John Giles"));
      assert.ok(governor.nominees.some(row => row.name === "Gertritrude Gonzalez"), "unpaired write-ins remain visible");
    }
  }
});
