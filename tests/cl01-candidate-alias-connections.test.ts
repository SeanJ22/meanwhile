import assert from "node:assert/strict";
import test from "node:test";
import { ballotAskInventory, ballotRecordsFor } from "../lib/ask/ballot-inventory.ts";
import { resolveSubjectRef } from "../lib/ask/subject.ts";
import { resolveInterpretation } from "../lib/ask/resolve.ts";
import { unavailableInterpretation } from "../lib/ask/intent.ts";
import { loadBallotForDivisions } from "../lib/ask/server-sources.ts";
import { getCandidateTargetIds } from "../lib/ballot/candidate-targets.ts";
import { getSingleCandidateTargetIds } from "../lib/ballot/uncontested.ts";
import { withCandidateTickets } from "../lib/ballot/tickets.ts";
import { displayFor } from "../lib/questionnaire/candidacy-display.ts";
import { stateBallotContractId } from "../lib/civic-data/state-scopes.ts";
import { currentBallotPeopleProjection, currentGenericBallotProjection, readGenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { installManualValue } from "./helpers/promoted-fixtures.ts";
import type { BallotSet, Candidacy, Contest } from "../lib/ballot/types.ts";
import { getStoredReaction } from "../lib/reactions/client.ts";
import { getPick } from "../lib/ballot/picks.ts";
import { resolveWithSuppression, tallyPicks, type PickableContest } from "../lib/ballot/pick-tally.ts";

const division = "ocd-division/country:us/state:az";
const provenance = { sourceUrl: "https://elections.example.gov/candidates", sourceOrg: "Election authority",
  collectedAt: "2026-10-24T00:00:00Z", verifiedAt: null, quote: "Governor and Lieutenant Governor: Katie Hobbs / John Giles" };
const contest = (id: string, title: string): Contest => ({ id, title, electionId: "general", ocdId: division,
  type: "CANDIDACY", divisionVintage: "2026", voteFor: 1, termYears: 4, scopeNote: null, candidateListComplete: true, provenance });
const candidate = (id: string, contestId: string, givenName: string, familyName: string): Candidacy => ({ id, contestId,
  givenName, familyName, partyLabel: "Democratic", slogan: null, incumbent: null, websiteUrl: null, provenance });
const oldLead = "ballot-az-pima:governor|Katie Hobbs";
const oldJoint = "ballot-az-pima:governor|Katie Hobbs / John Giles";
const mateId = "ballot-az-pima:lieutenant-governor:giles-john";
const lead = candidate("ballot-az-pima:governor:hobbs-katie", "ballot-az-pima:governor", "Katie", "Hobbs");
const mate = candidate(mateId, "ballot-az-pima:lieutenant-governor", "John", "Giles");
const ballot: BallotSet = { election: { id: "general", date: "2026-11-03", state: "AZ", name: "General election" },
  contests: [contest(lead.contestId, "Governor"), contest(mate.contestId, "Lieutenant Governor")],
  candidacies: [lead, { ...lead, id: "second-source:hobbs" }, mate], measures: [], absences: [],
  candidateTickets: [{ id: "hobbs-giles", leadCandidacyId: lead.id, runningMate: mate, provenance }],
  generalLineup: { curatedAt: provenance.collectedAt, note: "", canvass: { title: "Candidates", url: provenance.sourceUrl,
    issuedBy: provenance.sourceOrg, reportDate: "2026-10-24", readAt: provenance.collectedAt, readNote: "" },
    contests: [{ contestId: lead.contestId, nominees: [
      { name: "Katie Hobbs / John Giles", partyLabel: "Democratic", note: null, provenance },
      { name: "Katie Hobbs", partyLabel: "Democratic", note: null, provenance },
    ] }] },
};

const view = withCandidateTickets(ballot);

test("the published source holding stays intact while the person view resolves duplicate source aliases", async () => {
  const source = { kind: "ballot-contests" as const, ballots: { "AZ:general": ballot } };
  installManualValue(stateBallotContractId("ballot-contests", "AZ"), source, "test:cl01-source-and-person-views");
  const read = await readGenericBallotProjection("AZ");
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") throw new Error("The published ballot fixture was not read.");
  assert.deepEqual(read.value, source);
  assert.deepEqual(currentGenericBallotProjection("AZ"), source, "current and asynchronous reads expose the same exact source holding");
  const people = currentBallotPeopleProjection("AZ");
  assert.equal(people.ballots["AZ:general"].candidacies.length, 1);
  const choice = people.ballots["AZ:general"].candidacies[0];
  for (const alias of [oldLead, oldJoint, "second-source:hobbs"]) assert.ok(choice.aliases?.includes(alias));
  assert.equal(choice.ticket?.runningMate.id, mateId);
  assert.equal(currentBallotPeopleProjection("AZ"), people, "repeated person reads reuse the same derived view");
  assert.deepEqual(currentGenericBallotProjection("AZ"), source, "projecting people never mutates the published source holding");
});

test("legacy Ask subjects resolve to their own person and running mates retain separate evidence", () => {
  const inventory = ballotAskInventory(view, view.contests, id => view.generalLineup?.contests.find(row => row.contestId === id)?.nominees ?? []);
  const people = new Map(inventory.entities.filter(row => row.nameClass === "person").map(row => [row.id, row]));
  assert.equal(people.size, 2);
  for (const id of [oldLead, oldJoint, "second-source:hobbs", lead.id]) {
    const entity = resolveSubjectRef({ id, name: "Katie Hobbs", kind: "PERSON" }, inventory.entities);
    assert.equal(entity?.id, lead.id, id);
    const resolution = resolveInterpretation(unavailableInterpretation(), "What has she done?", inventory.entities,
      { priorSubjects: [{ id, name: "Katie Hobbs", kind: "PERSON" }] });
    assert.equal(resolution.binding.kind, "BOUND");
    if (resolution.binding.kind === "BOUND") assert.equal(resolution.binding.entity.id, lead.id);
  }
  assert.equal(resolveSubjectRef({ id: mateId, name: "John Giles", kind: "PERSON" }, inventory.entities)?.id, mateId);
  const member = inventory.subjects.get(mateId)!;
  const records = ballotRecordsFor(member, { set: view, contests: view.contests, absences: [] }).records;
  assert.equal(records.filter(row => row.kind === "CANDIDACY").length, 1);
  assert.match(records.find(row => row.kind === "CANDIDACY")!.text, /John Giles/);
  assert.doesNotMatch(records.find(row => row.kind === "CANDIDACY")!.text, /Katie Hobbs/);
});

test("existing reaction, demand and questionnaire targets survive source deduplication", async () => {
  installManualValue(stateBallotContractId("ballot-contests", "AZ"), { kind: "ballot-contests", ballots: { "AZ:general": ballot } }, "test:cl01-aliases");
  const divisions = [division];
  for (const id of [oldLead, oldJoint, "second-source:hobbs", lead.id, mateId]) {
    assert.equal((await getCandidateTargetIds(divisions, id)).has(id), true, id);
  }
  for (const id of [oldLead, oldJoint, "second-source:hobbs", lead.id]) {
    assert.equal((await getSingleCandidateTargetIds(divisions, id)).has(id), true, id);
    assert.equal((await displayFor("AZ", id))?.name, "Katie Hobbs", id);
  }
  assert.deepEqual(await displayFor("AZ", mateId), { name: "John Giles", officeTitle: "Lieutenant Governor" });
  const read = await loadBallotForDivisions(divisions);
  for (const id of [oldLead, oldJoint, "second-source:hobbs", lead.id, mateId]) assert.equal(read.setForTarget(id)?.election.id, "general", id);
});

test("a reader's saved reaction and pick remain selected after the ticket's aliases merge", () => {
  const choices: PickableContest = { contestId: lead.contestId, aliases: ["second-source:governor"], contestTitle: "Governor / Lieutenant Governor", voteFor: 1,
    options: [{ id: lead.id, label: "Katie Hobbs / John Giles", aliases: ["Katie Hobbs", oldLead, oldJoint], reactionTargetId: lead.id,
      reactionTargetAliases: [oldLead, oldJoint] }] };
  const stored = { contestId: "second-source:governor", contestTitle: "Governor", choiceIds: ["Katie Hobbs"], labels: { "Katie Hobbs": "Katie Hobbs" } };
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map([
    ["wtp.reactions", JSON.stringify({ [`CANDIDATE:${oldLead}`]: "YES" })],
    ["wtp.ballot_picks", JSON.stringify({ version: 2, picks: { [stored.contestId]: stored }, suppressedDerived: {} })],
  ]);
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => values.get(key) ?? null } } });
  try {
    assert.equal(getStoredReaction("CANDIDATE", lead.id, [oldLead, oldJoint]), "YES");
    assert.deepEqual(getPick(lead.contestId, choices.aliases), stored);
    const resolution = resolveWithSuppression(stored, [lead.id], 1, undefined, choices.options);
    assert.deepEqual(resolution.chosen, [lead.id]);
    assert.deepEqual(resolution.conflicting, []);
    const tally = tallyPicks([choices], [stored], new Set([oldLead]), {});
    assert.equal(tally.picked, 1);
    assert.deepEqual(tally.foreign, []);
    assert.deepEqual(tally.rows[0].chosen, ["Katie Hobbs / John Giles"]);
    assert.equal(resolveWithSuppression(null, [lead.id], 1, ["Katie Hobbs"], choices.options).basis, "NONE");
    values.set("wtp.reactions", JSON.stringify({ [`CANDIDATE:${oldLead}`]: "YES", [`CANDIDATE:${lead.id}`]: "NO" }));
    assert.equal(getStoredReaction("CANDIDATE", lead.id, [oldLead]), "NO", "a newer answer on the canonical card takes precedence");
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window");
  }
});
