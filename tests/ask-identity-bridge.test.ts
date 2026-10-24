import assert from "node:assert/strict";
import test from "node:test";

import { officialIdsForCandidacy, resolvedCandidacyForOfficial } from "../lib/funding/campaign-money.ts";
import { partyConflictCardForFiling, reconciledCandidacyIdForCard } from "../lib/identity/az-2026.ts";
import { readerPersonKeys } from "../lib/identity/reader-person.ts";
import { getRegistryRuntimeReadModel } from "../lib/registry/runtime-read-model.ts";
import { officialCandidacySeatMatches } from "../lib/registry/runtime-data-plane.ts";
import { bindNamedEntity, type BindableEntity } from "../lib/routing/named-entity.ts";
import { AZ_TEST_CANVASS_URL, AZ_TEST_FILINGS_URL, installRegistryAuthority } from "./helpers/promoted-fixtures.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import type { GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import type { Contest } from "../lib/ballot/types.ts";
import type { LineupOutcome } from "../lib/identity/types.ts";
import { readFileSync } from "node:fs";
import { requireBallotState } from "../lib/civic-data/state-scopes.ts";
import { currentReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";

import { stateBallotScope } from "../lib/civic-data/state-scopes.ts";
import { ballotElectionKey } from "../lib/ballot/generic-projection.ts";
import { installManualValue } from "./helpers/promoted-fixtures.ts";
import { stateBallotContractId } from "../lib/civic-data/state-scopes.ts";
import type { CivicDataReadResult } from "../lib/civic-data/read-model.ts";
import { readGenericBallotProjection } from "../lib/ballot/generic-projection.ts";

function served<T>(read: CivicDataReadResult<T>, what: string): T {
  if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") throw new Error(`${what} fixture did not install: ${read.kind} ${"detail" in read ? read.detail : ""}`);
  return read.value as T;
}



interface SyntheticLineupNominee {
  readonly name: string;
  readonly partyLabel: string;
  readonly outcome: LineupOutcome;
  readonly candidacyId?: string;
  readonly filingParty?: string;
}

interface SyntheticContest {
  readonly id: string;
  readonly title: string;
  readonly ocdId?: string;
  readonly type?: Contest["type"];
  readonly candidacies?: readonly { readonly id: string; readonly givenName: string; readonly familyName: string; readonly partyLabel?: string | null }[];
  readonly lineup?: readonly SyntheticLineupNominee[];
}

function syntheticAzBallot(contests?: readonly SyntheticContest[]): BallotSet {
  const fixtures = JSON.parse(readFileSync(new URL("./fixtures/synthetic-az-ballots.json", import.meta.url), "utf8")) as Record<string, BallotSet>;
  const ballot = fixtures[JSON.stringify(contests ?? null)];
  if (!ballot) throw new Error("The synthetic Arizona ballot input has no recorded fixture");
  return ballot;
}

async function installBallots(...ballots: BallotSet[]): Promise<GenericBallotProjection> {
  const installed: GenericBallotProjection = { kind: "ballot-contests", ballots: {} };
  for (const ballot of ballots.length ? ballots : [syntheticAzBallot()]) {
    const state = requireBallotState(ballot.election.state);
    const previous = currentReaderAuthorityEdge()?.promoted?.get(`BALLOT_CANDIDACY:${stateBallotScope("ballot-contests", state)}`);
    const current = previous?.kind === "PROMOTED" ? previous.projection.payload as GenericBallotProjection : null;
    const value: GenericBallotProjection = { kind: "ballot-contests", ballots: {
      ...(current?.ballots ?? {}), [ballotElectionKey(ballot)]: ballot,
    } };
    installManualValue(stateBallotContractId("ballot-contests", state), value, `test:ballot-contests:${state}`);
    served(await readGenericBallotProjection(state), `${state} ballot`);
    Object.assign(installed.ballots, value.ballots);
  }
  return installed;
}


await installRegistryAuthority();

const person = (id: string, name: string): BindableEntity => ({ id, name, nameClass: "person", divisionType: "person" });

/** The route's aliasing: an officeholder whose committed candidacy is on the ballot takes the ballot id. */
function aliased(officials: readonly BindableEntity[], ballot: readonly { entity: BindableEntity; candidacyId: string }[]): BindableEntity[] {
  const officialToBallot = new Map<string, string>();
  for (const candidate of ballot) for (const officialId of officialIdsForCandidacy(candidate.candidacyId)) officialToBallot.set(officialId, candidate.entity.id);
  return [...officials.map((entity) => ({ ...entity, id: officialToBallot.get(entity.id) ?? entity.id })), ...ballot.map(({ entity }) => entity)];
}

const committed = getRegistryRuntimeReadModel().officialCandidacies.rows
  .find((row) => officialCandidacySeatMatches(row) && row.holder.authority === "REGISTRY_BODY_ROSTER" && row.candidacy)!;

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
  await installBallots(syntheticAzBallot([{
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
  const pair = partyConflictCardForFiling(filingId);
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
  assert.equal(partyConflictCardForFiling(`${contestId}:example-casey`), null);

  const question = "How much has Jordan Sample raised?";
  const entities = [person(card, "Jordan Sample"), person(filingId, "Jordan Sample")];
  assert.equal(bindNamedEntity(question, entities).kind, "AMBIGUOUS", "control: unpaired, the two rows are two candidates");
  const paired = entities.map((entity) => ({ ...entity, id: partyConflictCardForFiling(entity.id)?.cardKey ?? entity.id }));
  const binding = bindNamedEntity(question, paired);
  assert.equal(binding.kind, "BOUND");
  assert.equal(binding.kind === "BOUND" && binding.entity.id, card);
});
