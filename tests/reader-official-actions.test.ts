import assert from "node:assert/strict";
import { test } from "node:test";
import { actionText, executiveActionStore } from "../lib/officials/executive-actions.ts";
import { officialActionsForTarget } from "../lib/officials/reader-actions.ts";
import { currentStatewideExecutives } from "../lib/registry/runtime-read-model.ts";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";
import { installExecutiveActions, syntheticExecutiveActions } from "./helpers/reader-fixtures.ts";
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
// The registry's current Arizona governor, a certified lineup card reconciled to that candidacy, and a held action store for the seat.
const governor = currentStatewideExecutives().find(row => row.holder.id === "statewide:az/governor")!.holder;
await installBallots(syntheticAzBallot([{
  id: "ballot-az-pima:governor",
  title: "Governor",
  candidacies: [
    { id: "ballot-az-pima:governor:hobbs-katie", givenName: "Katie", familyName: "Hobbs" },
    { id: "ballot-az-pima:governor:biggs-andy", givenName: "Andy", familyName: "Biggs" },
  ],
  lineup: [
    { name: "Katie Hobbs", partyLabel: "Democratic", outcome: "RECONCILED", candidacyId: "ballot-az-pima:governor:hobbs-katie" },
    { name: "Unresolved Person", partyLabel: "Independent", outcome: "NO_CANDIDATE_MATCH" },
  ],
}]));
const installed = await installExecutiveActions(syntheticExecutiveActions(governor.name));

test("every held official action reaches map and canonical ballot projection with Ask parity", () => {
  const held = executiveActionStore()!.actions;
  assert.equal(held.length, installed.actions.length);
  const map = officialActionsForTarget("statewide:az/governor");
  const ballot = officialActionsForTarget("ballot-az-pima:governor:hobbs-katie");
  assert.equal(map.count, held.length);
  assert.equal(map.status, "RESOLVED");
  assert.deepEqual(ballot.records, map.records);
  const certified = officialActionsForTarget("ballot-az-pima:governor|Katie Hobbs");
  assert.equal(certified.resolvedTargetId, "ballot-az-pima:governor:hobbs-katie");
  assert.deepEqual(certified.records, map.records);
  for (const action of held) {
    const projected = map.records.find(row => row.id === action.id)!;
    assert.equal(projected.text, actionText(action));
    assert.equal(projected.sourceUrl, action.sourceUrl);
    assert.equal(projected.documentUrl, action.documentUrl);
    assert.equal(projected.officialId, action.officeholderId);
  }
  assert.match(map.records.find(row => row.kind === "BILL_LETTER_UNREAD")!.text, /have not read it yet/);
});

test("unresolved certified identity is explicit and never becomes an absence", () => {
  const result = officialActionsForTarget("ballot-az-pima:governor|Unresolved Person");
  assert.equal(result.status, "IDENTITY_UNRESOLVED");
  assert.equal(result.resolvedTargetId, null);
  assert.equal(result.count, 0);
  assert.equal(officialActionsForTarget("statewide:nh/governor").status, "NOT_HELD");
  assert.equal(officialActionsForTarget("Unknown Person").status, "NO_APPLICABLE_OFFICIAL");
});

test("official actions never attach by display name, wrong candidacy, or another governor", () => {
  for (const subject of ["Katie Hobbs", "ballot-az-pima:governor:biggs-andy", "statewide:nh/governor", "statewide:nj/governor", "statewide:az/attorney-general", "ballot-nh-merrimack:governor:ayotte-kelly"]) {
    assert.equal(officialActionsForTarget(subject).count, 0, subject);
  }
});

test("a reused officeholder slot preserves unresolved identity on both official and candidacy surfaces", () => {
  const holder = currentStatewideExecutives().find(row => row.holder.id === "statewide:az/governor")!.holder;
  const originalName = holder.name;
  try {
    holder.name = "A Different Officeholder";
    for (const subject of ["statewide:az/governor", "ballot-az-pima:governor:hobbs-katie"]) {
      const answer = officialActionsForTarget(subject);
      assert.equal(answer.status, "IDENTITY_UNRESOLVED");
      assert.equal(answer.count, 0);
    }
  } finally { holder.name = originalName; }
});
