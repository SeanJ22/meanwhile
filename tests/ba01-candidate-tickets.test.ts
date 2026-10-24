import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ballotForDivisions } from "../lib/ballot/contests.ts";
import { ballotCandidateDisplayName } from "../lib/ballot/name-case.ts";
import { ballotCandidateAliases, ballotCandidatePeople, withCandidateTickets, type BallotWithTickets } from "../lib/ballot/tickets.ts";
import type { Candidacy, Contest } from "../lib/ballot/types.ts";
import { officeIdentity } from "../lib/officials/office-identity.ts";
import { sameSeatDiscriminators } from "../lib/officials/office-seat.ts";

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
    [["lead", "A Lead / B Mate", "DEM"]]);
  assert.equal(view.candidacies[0].ticket!.runningMate.partyLabel, "PND");
  assert.equal(view.candidacies[0].ticket!.provenance, raw.candidateTickets![0].provenance);
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
  assert.deepEqual(withCandidateTickets(differentDivision).candidacies.map(row => row.id), differentDivision.candidacies.map(row => row.id));
  assert.ok(withCandidateTickets(differentDivision).candidacies.every(row => !row.ticket));
  const ambiguous = fixture();
  ambiguous.candidateTickets = [...ambiguous.candidateTickets!, { ...ambiguous.candidateTickets![0], id: "another-pair" }];
  assert.ok(withCandidateTickets(ambiguous).candidacies.every(row => !row.ticket));
  const noPairs = fixture();
  delete noPairs.candidateTickets;
  assert.ok(withCandidateTickets(noPairs).candidacies.every(row => !row.ticket), "matching parties alone cannot create a ticket");
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
      assert.equal(lead.ticket!.provenance.sourceUrl, ticket.provenance.sourceUrl);
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

test("duplicate ballot sources and nominee labels retain all person aliases and endorsements", () => {
  const raw = fixture();
  raw.candidacies.push({ ...raw.candidacies[0], id: "another-source", partyLabel: "Working Families", websiteUrl: "https://lead.example.org" });
  raw.generalLineup = { curatedAt: "2026-10-20", note: "", canvass: { url: provenance.sourceUrl, title: "Official list",
    issuedBy: provenance.sourceOrg, reportDate: "2026-10-20", readAt: provenance.collectedAt, readNote: "" },
    contests: [{ contestId: "governor", nominees: [
      { name: "A Lead / B Mate", partyLabel: "DEM / PND", note: null },
      { name: "A Lead", partyLabel: "DEM", note: null },
    ] }] };
  const view = withCandidateTickets(raw), choice = view.candidacies[0];
  assert.equal(view.candidacies.length, 1);
  assert.equal(view.generalLineup!.contests[0].nominees.length, 1);
  assert.deepEqual(ballotCandidatePeople(choice).map(ballotCandidateDisplayName), ["A Lead", "B Mate"]);
  assert.ok(choice.partyLabel!.includes("Working Families"));
  assert.equal(choice.websiteUrl, "https://lead.example.org");
  for (const key of ["lead", "another-source", "governor|A Lead", "governor|A Lead / B Mate"])
    assert.ok(ballotCandidateAliases(choice).includes(key), key);
  assert.ok(!ballotCandidateAliases(choice).includes("mate"));
  assert.deepEqual(withCandidateTickets(view), view);
});

test("joint name cells produce two people without copying the lead's identity or campaign to the mate", () => {
  const raw = fixture();
  raw.contests = [contest("governor", "Governor and Lieutenant Governor")];
  raw.candidacies = [{ ...candidate("joint", "governor", "A Lead and B Mate", "DEM / IND"),
    personId: "held:lead", websiteUrl: "https://lead.example.org" }];
  delete raw.candidateTickets;
  const choice = withCandidateTickets(raw).candidacies[0];
  assert.equal(ballotCandidateDisplayName(choice), "A Lead / B Mate");
  assert.equal(choice.ticket!.runningMate.personId, undefined);
  assert.equal(choice.ticket!.runningMate.websiteUrl, null);
  assert.equal(choice.ticket!.runningMate.partyLabel, "IND");
  assert.deepEqual(withCandidateTickets(withCandidateTickets(raw)), withCandidateTickets(raw));
});

test("official newline and surname-only ticket cells keep each published person without inventing given names", () => {
  for (const [state, count] of [["hi", 2], ["ia", 2], ["il", 3], ["ma", 3]] as const) {
    const file = JSON.parse(readFileSync(`data/ballot/2026-general/${state}.json`, "utf8"));
    const view = withCandidateTickets(Object.values(file.ballots)[0] as BallotWithTickets);
    const tickets = view.candidacies.filter(row => row.ticket);
    assert.equal(tickets.length, count, state);
    assert.ok(tickets.every(row => ballotCandidatePeople(row).every(person => !ballotCandidateDisplayName(person).includes("\n"))));
    assert.deepEqual(withCandidateTickets(view), view, state);
    if (state === "ma") assert.ok(tickets.some(row => ballotCandidateDisplayName(row) === "Healey / Driscoll"));
    if (state === "hi") assert.ok(tickets.some(row => ballotCandidateDisplayName(row) === "Josh Green / Derek S.K. Kawakami"));
  }
  assert.equal(officeIdentity("U.S. REPRESENTATIVE, DIST I"), "us_representative");
  assert.equal(sameSeatDiscriminators("U.S. REPRESENTATIVE, DIST I", "U.S. Representative, District 1", "ocd-division/country:us/state:hi/cd:1"), true);
  assert.equal(sameSeatDiscriminators("State Representative, Dist. 2", "State Representative, District 1", "ocd-division/country:us/state:hi/sldl:1"), false);
});
