import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { officialIdsForCandidacy, resolvedCandidacyForOfficial } from "../lib/funding/campaign-money.ts";
import { partyConflictCardForFiling, partyConflictFilingForCard, reconciledCandidacyIdForCard } from "../lib/identity/az-2026.ts";
import { readerPersonKeys } from "../lib/identity/reader-person.ts";
import { getRegistryRuntimeReadModel } from "../lib/registry/runtime-read-model.ts";
import { bindNamedEntity, type BindableEntity } from "../lib/routing/named-entity.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";

/**
 * **ONE PERSON HELD TWICE IS ONE SUBJECT TO ASK.** (2026-09-25.)
 *
 * Ask answered "which one did you mean?" and listed two identical names for
 * a person held as two records with no committed bridge between them, even
 * for a reader in that person's own district. These tests pin the committed
 * joins that remove the false clarification, and bind the reader's words over
 * the two entities exactly as `app/api/ask/grounded/route.ts` builds them
 * (an officeholder's id is replaced by the ballot id its committed candidacy
 * maps to), with the unjoined pair as the control that proves the join is
 * what binds.
 */

await installRegistryRuntimeFirstSeeds();

const person = (id: string, name: string): BindableEntity => ({ id, name, nameClass: "person", divisionType: "person" });

/** The route's aliasing: an officeholder whose committed candidacy is on the ballot takes the ballot id. */
function aliased(officials: readonly BindableEntity[], ballot: readonly { entity: BindableEntity; candidacyId: string }[]): BindableEntity[] {
  const officialToBallot = new Map<string, string>();
  for (const candidate of ballot) for (const officialId of officialIdsForCandidacy(candidate.candidacyId)) officialToBallot.set(officialId, candidate.entity.id);
  return [...officials.map((entity) => ({ ...entity, id: officialToBallot.get(entity.id) ?? entity.id })), ...ballot.map(({ entity }) => entity)];
}

test("Amalia DUARTE: the Mendham Township Committee roster row and her 2026 Township Committee candidacy are one committed person", () => {
  const officialId = "roster:nj-morris-mendham_township#2";
  const candidacyId = "ballot-nj-morris:mendham-township-member-of-the-township-committee-place-mendham-township:duarte-amalia";
  assert.deepEqual(resolvedCandidacyForOfficial(officialId), {
    candidacyId,
    contestId: "ballot-nj-morris:mendham-township-member-of-the-township-committee-place-mendham-township",
  });
  assert.deepEqual(officialIdsForCandidacy(candidacyId), [officialId]);
  assert.deepEqual(readerPersonKeys(officialId).keys, [candidacyId, officialId]);

  // Both records keep their own provenance: the body's own roster page and the county clerk's candidate list.
  const row = getRegistryRuntimeReadModel().officialCandidacies.rows.find((candidate) => candidate.holder.id === officialId)!;
  assert.equal(row.holder.sourceUrl, "https://www.mendhamtownship.org/266/Township-Committee");
  const filing = (JSON.parse(readFileSync(new URL("../data/states/nj/ballot/nj-morris-2026.json", import.meta.url), "utf8")) as {
    candidacies: { id: string; provenance: { sourceUrl: string } }[];
  }).candidacies.find((candidate) => candidate.id === candidacyId)!;
  assert.equal(row.candidacy?.sourceUrl, filing.provenance.sourceUrl);
  const reviewed = (JSON.parse(readFileSync(new URL("../lib/registry/fixtures/official-person-candidacy-links-v1.json", import.meta.url), "utf8")) as {
    rows: { officialId: string; holderName: string; candidacyId: string; holderSourceUrl: string }[];
  }).rows.find((link) => link.officialId === officialId);
  assert.deepEqual(reviewed && { holderName: reviewed.holderName, candidacyId: reviewed.candidacyId, holderSourceUrl: reviewed.holderSourceUrl }, {
    holderName: row.holder.name, candidacyId, holderSourceUrl: row.holder.sourceUrl,
  });

  const question = "How much has Amalia DUARTE raised?";
  const official = person(officialId, "Amalia Duarte, Member");
  const ballot = [{ entity: person(candidacyId, "Amalia DUARTE"), candidacyId }];
  assert.equal(bindNamedEntity(question, [official, ...ballot.map(({ entity }) => entity)]).kind, "AMBIGUOUS", "control: unjoined, the two records are two candidates");
  const binding = bindNamedEntity(question, aliased([official], ballot));
  assert.equal(binding.kind, "BOUND");
  assert.equal(binding.kind === "BOUND" && binding.entity.id, candidacyId);
});

test("Teri Ann Hourihan: the certified card and her filing are the committed party-conflict pair, one subject with both parties and sources", () => {
  const card = "ballot-az-pima:governor|Teri Ann Hourihan";
  const filingId = "ballot-az-pima:governor:hourihan-teri-ann";
  const pair = partyConflictFilingForCard(card);
  assert.deepEqual(pair, {
    cardKey: card,
    contestId: "ballot-az-pima:governor",
    filingCandidacyId: filingId,
    name: "Teri Ann Hourihan",
    canvassParty: "No Labels",
    canvassSourceUrl: "https://apps.azsos.gov/election/2026/canvass/20260806_Primary_Canvass.pdf",
    filingParty: "Arizona Independent Party",
    filingSourceUrl: "https://azsos.gov/sites/default/files/docs/2026-Candidate-Nominations-and-Petitions-Filed-0330.pdf",
    readerGapSentence: "Arizona's certified canvass and the Secretary of State's candidate-filing list state different parties for the only matching name, so we have not established that they are the same candidacy.",
  });
  assert.deepEqual(partyConflictCardForFiling(filingId), pair);
  // The honest conflict stands: the card never acquires the filing as its candidacy.
  assert.equal(reconciledCandidacyIdForCard(card), null);
  assert.deepEqual(readerPersonKeys(card).keys, [card]);
  // Only the conflicting pair is returned; a reconciled card or an unrelated filing is not.
  assert.equal(partyConflictFilingForCard("ballot-az-pima:governor|Katie Hobbs"), null);
  assert.equal(partyConflictCardForFiling("ballot-az-pima:governor:hobbs-katie"), null);

  const question = "How much has Teri Ann Hourihan raised?";
  const entities = [person(card, "Teri Ann Hourihan"), person(filingId, "Teri Ann Hourihan")];
  assert.equal(bindNamedEntity(question, entities).kind, "AMBIGUOUS", "control: unpaired, the two rows are two candidates");
  const paired = entities.map((entity) => ({ ...entity, id: partyConflictCardForFiling(entity.id)?.cardKey ?? entity.id }));
  const binding = bindNamedEntity(question, paired);
  assert.equal(binding.kind, "BOUND");
  assert.equal(binding.kind === "BOUND" && binding.entity.id, card);
});
