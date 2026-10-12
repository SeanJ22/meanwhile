import assert from "node:assert/strict";
import test from "node:test";

import { officialIdsForCandidacy, resolvedCandidacyForOfficial } from "../lib/funding/campaign-money.ts";
import { partyConflictCardForFiling, partyConflictFilingForCard, reconciledCandidacyIdForCard } from "../lib/identity/az-2026.ts";
import { readerPersonKeys } from "../lib/identity/reader-person.ts";
import { getRegistryRuntimeReadModel } from "../lib/registry/runtime-read-model.ts";
import { bindNamedEntity, type BindableEntity } from "../lib/routing/named-entity.ts";
import { AZ_TEST_CANVASS_URL, AZ_TEST_FILINGS_URL, installAzBallot, installRegistryAuthority, syntheticAzBallot } from "./helpers/promoted-fixtures.ts";

await installRegistryAuthority();

const person = (id: string, name: string): BindableEntity => ({ id, name, nameClass: "person", divisionType: "person" });

/** The route's aliasing: an officeholder whose committed candidacy is on the ballot takes the ballot id. */
function aliased(officials: readonly BindableEntity[], ballot: readonly { entity: BindableEntity; candidacyId: string }[]): BindableEntity[] {
  const officialToBallot = new Map<string, string>();
  for (const candidate of ballot) for (const officialId of officialIdsForCandidacy(candidate.candidacyId)) officialToBallot.set(officialId, candidate.entity.id);
  return [...officials.map((entity) => ({ ...entity, id: officialToBallot.get(entity.id) ?? entity.id })), ...ballot.map(({ entity }) => entity)];
}

/* A committed roster-to-candidacy row the held registry carries (the first RESOLVED body-roster row). */
const committed = getRegistryRuntimeReadModel().officialCandidacies.rows
  .find((row) => row.status === "RESOLVED" && row.holder.authority === "REGISTRY_BODY_ROSTER" && row.candidacy)!;

test("a body-roster row and its committed candidacy are one person: the reverse join, the person keys, and the binding", () => {
  assert.ok(committed, "the held registry carries a committed body-roster candidacy");
  const officialId = committed.holder.id;
  const { candidacyId, contestId } = committed.candidacy!;
  assert.deepEqual(resolvedCandidacyForOfficial(officialId), { candidacyId, contestId });
  assert.deepEqual(officialIdsForCandidacy(candidacyId), [officialId]);
  assert.deepEqual(readerPersonKeys(officialId).keys, [candidacyId, officialId]);

  const row = getRegistryRuntimeReadModel().officialCandidacies.rows.find((candidate) => candidate.holder.id === officialId)!;
  assert.equal(row.holder.sourceUrl, committed.holder.sourceUrl);

  const question = `How much has ${committed.holder.name} raised?`;
  const official = person(officialId, committed.holder.name);
  // The ballot row under the same name the question uses, as a second record of the same person.
  const ballot = [{ entity: person(candidacyId, committed.holder.name), candidacyId }];
  assert.equal(bindNamedEntity(question, [official, ...ballot.map(({ entity }) => entity)]).kind, "AMBIGUOUS", "control: unjoined, the two records are two candidates");
  const binding = bindNamedEntity(question, aliased([official], ballot));
  assert.equal(binding.kind, "BOUND");
  assert.equal(binding.kind === "BOUND" && binding.entity.id, candidacyId);
});

test("a party-conflict card and its filing are the committed pair, one subject with both parties and sources", async () => {
  const contestId = "ballot-az-test:synthetic-office";
  const filingId = `${contestId}:sample-jordan`;
  await installAzBallot(syntheticAzBallot([{
    id: contestId,
    title: "Synthetic Office",
    candidacies: [
      { id: filingId, givenName: "Jordan", familyName: "Sample", partyLabel: "Party B" },
      { id: `${contestId}:example-casey`, givenName: "Casey", familyName: "Example", partyLabel: "Party A" },
    ],
    lineup: [
      { name: "Jordan Sample", partyLabel: "Party A", outcome: "PARTY_CONFLICT", candidacyId: filingId, filingParty: "Party B" },
      { name: "Casey Example", partyLabel: "Party A", outcome: "RECONCILED", candidacyId: `${contestId}:example-casey` },
    ],
  }]));
  const card = `${contestId}|Jordan Sample`;
  const pair = partyConflictFilingForCard(card);
  assert.deepEqual(pair, {
    cardKey: card,
    contestId,
    filingCandidacyId: filingId,
    name: "Jordan Sample",
    canvassParty: "Party A",
    canvassSourceUrl: AZ_TEST_CANVASS_URL,
    filingParty: "Party B",
    filingSourceUrl: AZ_TEST_FILINGS_URL,
    readerGapSentence: "We have not established that this nominee is the same candidacy as a filing.",
  });
  assert.deepEqual(partyConflictCardForFiling(filingId), pair);
  // The honest conflict stands: the card never acquires the filing as its candidacy.
  assert.equal(reconciledCandidacyIdForCard(card), null);
  assert.deepEqual(readerPersonKeys(card).keys, [card]);
  // Only the conflicting pair is returned; a reconciled card or an unrelated filing is not.
  assert.equal(partyConflictFilingForCard(`${contestId}|Casey Example`), null);
  assert.equal(partyConflictCardForFiling(`${contestId}:example-casey`), null);

  const question = "How much has Jordan Sample raised?";
  const entities = [person(card, "Jordan Sample"), person(filingId, "Jordan Sample")];
  assert.equal(bindNamedEntity(question, entities).kind, "AMBIGUOUS", "control: unpaired, the two rows are two candidates");
  const paired = entities.map((entity) => ({ ...entity, id: partyConflictCardForFiling(entity.id)?.cardKey ?? entity.id }));
  const binding = bindNamedEntity(question, paired);
  assert.equal(binding.kind, "BOUND");
  assert.equal(binding.kind === "BOUND" && binding.entity.id, card);
});
