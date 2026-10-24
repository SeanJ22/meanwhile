import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ballotAskInventory, ballotRecordsFor } from "../lib/ask/ballot-inventory.ts";
import { composeOfficeField, contestsOfOffice } from "../lib/ask/ballot-summary.ts";
import { resolveSubjectRef } from "../lib/ask/subject.ts";
import { withCandidateTickets } from "../lib/ballot/tickets.ts";
import { readGenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import type { BallotSet, Candidacy, Contest } from "../lib/ballot/types.ts";
import { stateBallotContractId, stateRegistryRuntimeContractId } from "../lib/civic-data/state-scopes.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { currentReaderSelection, withReaderSelection } from "../lib/db/reader-route.ts";
import { fundingHoldingReaders, settleFundingHoldingAnswer } from "../lib/funding/holding-answer.ts";
import type { FundingCandidate, FundingSnapshot } from "../lib/funding/types.ts";
import { tierForOffice } from "../lib/ocd/tiers.ts";
import { readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { installManualValue, installPromotedValue, registryTransferImport } from "./helpers/promoted-fixtures.ts";

// The same chamber wording appears on the held Virginia congressional list and on state ballots.
// Its sourced electoral division decides which office, funding authority and reader tier applies.
const virginia = Object.values((JSON.parse(readFileSync("data/ballot/2026-general/va.json", "utf8")) as { ballots: Record<string, BallotSet> }).ballots)[0];
const federalContest = virginia.contests.find(row => row.id === "va-sbe-2026-us-house-1")!;
const legacyFederalSource = "context-fixture:old-federal-candidate-source";
const federalCandidate = { ...virginia.candidacies.find(row => row.contestId === federalContest.id)!, aliases: [legacyFederalSource] };
const legacyFederal = `${federalContest.id}|${federalCandidate.givenName} ${federalCandidate.familyName}`;
const stateContest: Contest = { ...federalContest, id: "context-fixture:state-house-1", ocdId: "ocd-division/country:us/state:va/sldl:1",
  provenance: { ...federalContest.provenance, sourceUrl: "https://elections.example.gov/state-house" } };
const stateCandidate: Candidacy = { ...federalCandidate, id: "context-fixture:state-house-1:alex-example",
  contestId: stateContest.id, givenName: "Alex", familyName: "Example", provenance: stateContest.provenance };
const legacyState = `${stateContest.id}|Alex Example`;
const ticketContest: Contest = { ...stateContest, id: "context-fixture:governor-ticket", title: "Governor / Lieutenant Governor",
  ocdId: "ocd-division/country:us/state:va" };
const mate: Candidacy & { office: string } = { ...stateCandidate, id: "context-fixture:lieutenant-source:jordan-example",
  contestId: "context-fixture:former-lieutenant-contest", givenName: "Jordan", familyName: "Example", office: "Lieutenant Governor",
  aliases: ["context-fixture:former-lieutenant-contest|Jordan Example", "context-fixture:former-running-mate-source"] };
const ticket: Candidacy = { ...stateCandidate, id: "context-fixture:governor-source:riley-example", contestId: ticketContest.id,
  givenName: "Riley", familyName: "Example", ticket: { id: "context-fixture:ticket", runningMate: mate,
    provenance: { ...stateContest.provenance, quote: "Riley Example / Jordan Example" } } };
const ballot: BallotSet = { election: virginia.election, contests: [federalContest, stateContest, ticketContest],
  candidacies: [federalCandidate, stateCandidate, ticket], measures: [], absences: [] };
const view = withCandidateTickets(ballot);

const money: FundingCandidate = {
  dataClass: "FEC_COMMITTEE", fecCandidateId: "H6VA01999", name: `${federalCandidate.givenName} ${federalCandidate.familyName}`,
  state: "VA", office: "H", district: "01", targetKeys: [federalCandidate.id, legacyFederal, legacyFederalSource], matchRoutes: ["SYNTHETIC_TEST_FIXTURE"],
  principalCommitteeId: "C00999999", cycle: 2026, totals: { receipts: 123456, disbursements: 100000, cashOnHand: 23456,
    individualItemized: 100000, individualUnitemized: 23456, smallDonorShare: null, coverageEndDate: "2026-09-30" },
  topContributions: [], provenance: { sourceUrl: "https://www.fec.gov/data/committee/C00999999/", sourceOrg: "Synthetic FEC test fixture",
    collectedAt: "2026-10-24T00:00:00Z", verifiedAt: null },
};
const funding: FundingSnapshot = { formatVersion: 1, cycle: 2026, fetchedAt: money.provenance.collectedAt,
  matchReport: { rosterMatched: 0, rosterTotal: 0, ballotMatched: 1, ballotTotal: 1 }, candidates: [money], absences: [] };

async function withContextualHoldings(run: () => Promise<void>) {
  const base = registryTransferImport().projection.payload;
  const registry = { ...base, registry: { ...base.registry, divisions: [], bodies: [] }, bodyRosters: [],
    statewideExecutives: [], officialPhotos: { photos: [] }, rosterPhotos: {}, rosterReaderDispositions: [],
    officialCandidacies: { ...base.officialCandidacies, rows: [] } };
  installManualValue(stateRegistryRuntimeContractId("VA"), registry, "test:cl01-contextual-registry");
  installManualValue(stateBallotContractId("ballot-contests", "VA"), { kind: "ballot-contests",
    ballots: { [`VA:${ballot.election.id}`]: ballot } }, "test:cl01-contextual-ballot");
  const contract = requiredRoutineContract("fec-funding");
  installPromotedValue({ recordClass: contract.recordClass, scope: contract.scope, sourceId: contract.sourceId,
    value: funding, versionId: "test:cl01-contextual-funding" });
  await withReaderSelection({ states: ["VA"], keys: new Set([federalContest.ocdId, stateContest.ocdId]) }, async () => {
    await readRegistryRuntimeProjection(["VA"]);
    await readGenericBallotProjection("VA");
    await run();
  });
}

test("an ambiguous House label reaches the correct Ask race, own candidate evidence and card tier", () => {
  assert.equal(federalContest.title, "Member, House of Representatives — 1st District");
  assert.deepEqual(contestsOfOffice(view.contests, "us_representative").map(row => row.id), [federalContest.id]);
  assert.deepEqual(contestsOfOffice(view.contests, "state_lower_house").map(row => row.id), [stateContest.id]);
  for (const [key, chosen, candidate, legacy, tier] of [
    ["us_representative", federalContest, federalCandidate, legacyFederal, "national"],
    ["state_lower_house", stateContest, stateCandidate, legacyState, "state"],
  ] as const) {
    const answer = composeOfficeField({ key, contests: view.contests, election: view.election,
      nominees: () => [], candidacies: view.candidacies, removedCandidacyIds: new Set() });
    assert.ok(answer);
    assert.deepEqual(answer.records.filter(row => row.kind === "CONTEST").map(row => row.id), [chosen.id]);
    const people = answer.records.filter(row => row.kind === "CANDIDACY");
    assert.equal(people.length, 1);
    assert.equal(people[0].sourceUrl, candidate.provenance.sourceUrl);
    assert.ok(people[0].text.includes(`${candidate.givenName} ${candidate.familyName}`));
    assert.equal(tierForOffice(chosen.title, chosen.ocdId), tier);
    const inventory = ballotAskInventory(view, view.contests);
    const subject = resolveSubjectRef({ id: legacy, name: `${candidate.givenName} ${candidate.familyName}`, kind: "PERSON" }, inventory.entities);
    assert.equal(subject?.id, candidate.id, "the old card id resolves to the same person");
    const record = inventory.subjects.get(subject!.id)!;
    const held = ballotRecordsFor(record, { set: view, contests: view.contests, absences: [] }).records.filter(row => row.kind === "CANDIDACY");
    assert.equal(held.length, 1);
    assert.equal(held[0].id, candidate.id);
    assert.equal(held[0].sourceUrl, candidate.provenance.sourceUrl);
  }
  const inventory = ballotAskInventory(view, view.contests);
  assert.ok(inventory.entities.some(row => row.id === federalContest.id && row.name === "U.S. House District 1"),
    "Ask offers the congressional district name readers use for the source's ambiguous office label");
  assert.ok(!inventory.entities.some(row => row.id === stateContest.id && row.name === "U.S. House District 1"));
});

test("the contextual federal office loads its FEC holding through canonical and legacy candidate targets", async () => {
  await withContextualHoldings(async () => {
    for (const target of [federalCandidate.id, legacyFederal, legacyFederalSource]) {
      const readers = fundingHoldingReaders([federalContest.ocdId, stateContest.ocdId]);
      const plan = await readers.identityPlan(target);
      assert.deepEqual(plan, { contestId: federalContest.id, federal: true, state: null, ballotIdentity: target !== federalCandidate.id }, target);
      assert.ok(currentReaderSelection()?.keys.has(federalCandidate.id), "the legacy request selects the person's canonical holdings too");
      let federalReads = 0;
      const result = await settleFundingHoldingAnswer(target, { ...readers, federal: async () => { federalReads++; return readers.federal(); } });
      assert.equal(federalReads, 1, "the card actually reads the FEC holding");
      assert.equal(result.kind, "ANSWER");
      if (result.kind !== "ANSWER") throw new Error("The candidate's FEC holding was unavailable.");
      assert.deepEqual(result.unavailableAuthorities, []);
      assert.equal(result.answer.kind, "funding", target);
      if (result.answer.kind === "funding") {
        assert.equal(result.answer.data.fecCandidateId, money.fecCandidateId);
        assert.equal(result.answer.data.totals?.receipts, money.totals.receipts);
        assert.equal(result.answer.data.sourceUrl, money.provenance.sourceUrl);
      }
    }
    for (const target of [stateCandidate.id, legacyState]) {
      const readers = fundingHoldingReaders([federalContest.ocdId, stateContest.ocdId]);
      assert.deepEqual(await readers.identityPlan(target), { contestId: stateContest.id, federal: false, state: "VA", ballotIdentity: target.includes("|") }, target);
      let federalReads = 0;
      const result = await settleFundingHoldingAnswer(target, { ...readers, federal: async () => { federalReads++; throw new Error("A state candidate cannot read the federal holding."); } });
      assert.equal(federalReads, 0);
      assert.equal(result.kind, "ANSWER");
      if (result.kind === "ANSWER") {
        assert.equal(result.answer.kind, "none", "the other office cannot inherit the congressional candidate's money");
        assert.deepEqual(result.unavailableAuthorities, []);
      }
    }
    const readers = fundingHoldingReaders([federalContest.ocdId, stateContest.ocdId, ticketContest.ocdId]);
    assert.ok(!currentReaderSelection()?.keys.has(ticket.id));
    for (const target of [mate.id, ...mate.aliases!]) {
      assert.deepEqual(await readers.identityPlan(target), { contestId: ticketContest.id, federal: false, state: "VA", ballotIdentity: target !== mate.id },
        "a running mate's old separate-office key resolves through the current joint contest");
      assert.ok(currentReaderSelection()?.keys.has(mate.id));
      assert.ok(!currentReaderSelection()?.keys.has(ticket.id), "the running mate does not select the lead's person holdings");
    }
  });
});
