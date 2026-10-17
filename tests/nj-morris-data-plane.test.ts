import assert from "node:assert/strict";
import test from "node:test";
import { candidateContactForCandidacy } from "../lib/ballot/candidate-contacts.ts";
import { ballotElectionKey, readGenericBallotProjection, type GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import type { CivicDataReadStore } from "../lib/civic-data/read-model.ts";
import { manualEdgeEntry } from "./helpers/promoted-edge-entry.ts";

import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import type { Contest } from "../lib/ballot/types.ts";
import type { CandidacyRemoval } from "../lib/ballot/types.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import type { ReaderAuthorityEdgeBundle } from "../lib/registry/runtime-edge.ts";
import { currentReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";









function promotedFixtureBundle(extra: ReaderAuthorityEdgeBundle = {}): ReaderAuthorityEdgeBundle {
  const current: ReaderAuthorityEdgeBundle = currentReaderAuthorityEdge() ?? {};
  return { stateAuthorities: current.stateAuthorities,
    ...(current.stateLegislators ? { stateLegislators: current.stateLegislators } : {}),
    ...extra, promoted: new Map([...(current.promoted ?? []), ...(extra.promoted ?? [])]) };
}

const TEST_BALLOT_PROVENANCE = { sourceUrl: "https://example.test/ballot", sourceOrg: "Synthetic test ballot", collectedAt: "2026-09-25", verifiedAt: null };

function rawBallot(state: string, races: readonly TestRace[]): BallotSet {
  const electionId = `${state.toLowerCase()}-2026-general-test`;
  return {
    election: { id: electionId, date: "2026-11-03", name: "2026 General Election (test)", state },
    contests: races.map((race) => ({
      id: race.id, electionId, ocdId: race.ocdId, divisionVintage: "2026", title: race.title, type: race.type ?? (race.measure ? "MEASURE" : "CANDIDACY"),
      voteFor: 1, termYears: race.measure ? null : 4, scopeNote: null, provenance: TEST_BALLOT_PROVENANCE,
    })),
    candidacies: races.flatMap((race) => (race.candidacies ?? []).map((row) => ({
      id: row.id, contestId: race.id, givenName: row.givenName, familyName: row.familyName, partyLabel: row.partyLabel ?? null,
      slogan: null, incumbent: null, websiteUrl: null, provenance: TEST_BALLOT_PROVENANCE,
    }))),
    measures: races.flatMap((race) => race.measure ? [{
      id: `${race.id}#measure`, contestId: race.id, ...(race.measure.officialNumber ? { officialNumber: race.measure.officialNumber } : {}),
      questionText: race.measure.questionText, officialStatement: null, provenance: TEST_BALLOT_PROVENANCE,
    }] : []),
    absences: [],
  };
}

interface TestRace {
  readonly id: string;
  readonly title: string;
  readonly ocdId: string;
  readonly type?: Contest["type"];
  readonly candidacies?: readonly { readonly id: string; readonly givenName: string; readonly familyName: string; readonly partyLabel?: string | null }[];
  readonly measure?: { readonly questionText: string; readonly officialNumber?: string };
}

function njMorrisFiling(races: readonly TestRace[], extra: {
  readonly removals?: readonly CandidacyRemoval[];
  readonly contacts?: readonly (NonNullable<BallotSet["contacts"]>[number] & { readonly filedAddress?: string })[];
} = {}): BallotSet {
  return {
    ...rawBallot("NJ", races), removals: [...(extra.removals ?? [])],
    contacts: extra.contacts ?? [],
  };
}



const ballot = njMorrisFiling([{
  id: "contest:county", title: "County Commissioner", ocdId: "ocd-division/country:us/state:nj/county:morris",
  candidacies: [{ id: "candidacy:a", familyName: "ALPHA", givenName: "Ann" }],
}], { contacts: [{ candidacyId: "candidacy:a", email: "a@example.test",
  sourceUrl: "https://www.morriscountyclerk.org/Elections/Current-Election-Candidates",
  sourceOrg: "County Clerk", collectedAt: "2026-09-08" }] });
const projection: GenericBallotProjection = { kind: "ballot-contests", ballots: { [ballotElectionKey(ballot)]: ballot } };

test("a missing state ballot pointer is NOT_RECORDED and reads only the exact state's scope", async () => {
  const noPointer: CivicDataReadStore = {
    readPromotion: async (recordClass, scope) => { assert.equal(recordClass, "BALLOT_CANDIDACY"); assert.equal(scope, "US-NJ:state-election-ballots"); return null; },
    readCandidate: async () => null,
  };
  assert.equal((await readGenericBallotProjection("NJ", { store: noPointer })).kind, "NOT_RECORDED");
});

test("Morris ballot and contacts use one state artifact and no foreign state", async () => {
  const entry = manualEdgeEntry("ballot-contests:NJ", projection, "nj-state-ballot-1");
  const reads: string[] = [];
  const bundle = promotedFixtureBundle({ stateAuthorities: { states: { "ballot-contests": new Set(["NJ"]) }, load: async (family, state) => {
    reads.push(`${family}:${state}`);
    assert.equal(family, "ballot-contests"); assert.equal(state, "NJ");
    return { kind: "PROMOTED_POINTERS", entries: [entry] };
  } } });
  await withReaderAuthorityEdge(bundle, async () => {
    const result = await readGenericBallotProjection("NJ");
    assert.equal(result.kind, "PROMOTED");
    assert.equal(result.metadata.versionId, "nj-state-ballot-1");
    assert.deepEqual(result.value, projection);
    assert.deepEqual(ballot.contacts!.map(row => candidateContactForCandidacy("NJ", row.candidacyId)), ballot.contacts);
    assert.equal((await readGenericBallotProjection("NJ")), result);
  });
  assert.deepEqual(reads, ["ballot-contests:NJ"]);
});

test("a failed state read cannot reuse contacts from an earlier request", async () => {
  await withReaderAuthorityEdge(promotedFixtureBundle({ stateAuthorities: { states: { "ballot-contests": new Set(["NJ"]) }, load: async () => ({ kind: "PROMOTED_POINTERS", entries: [
    { kind: "NOT_RECORDED", recordClass: "BALLOT_CANDIDACY", scope: "US-NJ:state-election-ballots" },
  ] }) } }), async () => {
    assert.equal((await readGenericBallotProjection("NJ")).kind, "NOT_RECORDED");
    assert.throws(() => candidateContactForCandidacy("NJ", "candidacy:a"), /NJ is NOT_RECORDED/);
  });
});
