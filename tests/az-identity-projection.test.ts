import assert from "node:assert/strict";
import test from "node:test";

import { stateMoneyForCard } from "../lib/funding/nominee-money.ts";
import { isRenderable } from "../lib/funding/state-money.ts";
import { installStateMoney } from "./helpers/promoted-fixtures.ts";
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


await installBallots(syntheticAzBallot([
  {
    id: "ballot-az-pima:attorney-general",
    title: "Attorney General",
    candidacies: [{ id: "ballot-az-pima:attorney-general:glassman-rodney", givenName: "Rodney", familyName: "Glassman" }],
    lineup: [{ name: "Rodney Glassman", partyLabel: "Party A", outcome: "RECONCILED", candidacyId: "ballot-az-pima:attorney-general:glassman-rodney" }],
  },
  {
    id: "ballot-az-pima:mine-inspector",
    title: "State Mine Inspector",
    candidacies: [{ id: "ballot-az-pima:mine-inspector:presmyk-walter", givenName: "Walter", familyName: "Presmyk" }],
    lineup: [{ name: 'Walter "Les" Presmyk', partyLabel: "Party A", outcome: "RECONCILED", candidacyId: "ballot-az-pima:mine-inspector:presmyk-walter" }],
  },
  {
    id: "ballot-az-test:synthetic-office",
    title: "Synthetic Office",
    candidacies: [{ id: "ballot-az-test:synthetic-office:sample-jordan", givenName: "Jordan", familyName: "Sample", partyLabel: "Party B" }],
    lineup: [
      { name: "Jordan Sample", partyLabel: "Party A", outcome: "PARTY_CONFLICT", candidacyId: "ballot-az-test:synthetic-office:sample-jordan", filingParty: "Party B" },
      { name: "Robin Nomatch", partyLabel: "Party A", outcome: "NO_CANDIDATE_MATCH" },
    ],
  },
]));
await installStateMoney("AZ");
await installStateMoney("NH");

test("a reconciled nominee's card is answered with the CANDIDACY id, not the name", () => {
  const key = "ballot-az-pima:attorney-general|Rodney Glassman";
  const out = stateMoneyForCard(key, "ballot-az-pima:attorney-general");
  assert.equal(out.resolution, "RECONCILED_NOMINEE");
  assert.equal(out.resolvedTargetKey, "ballot-az-pima:attorney-general:glassman-rodney");
  assert.notEqual(out.resolvedTargetKey, key);
  const filed = out.records.filter((r) => r.filingState === "FILED");
  assert.equal(filed.length, 1);
  assert.equal(filed[0].totals.receipts, 3775589.91);
});

test("the nickname control resolves too, and it resolves to an OURS gap with no figure", () => {
  const out = stateMoneyForCard(
    'ballot-az-pima:mine-inspector|Walter "Les" Presmyk',
    "ballot-az-pima:mine-inspector",
  );
  assert.equal(out.resolution, "RECONCILED_NOMINEE");
  assert.equal(out.resolvedTargetKey, "ballot-az-pima:mine-inspector:presmyk-walter");
  assert.equal(out.records.length, 1);
  assert.equal(out.records[0].filingState, "OURS_GAP");
  assert.equal(out.records[0].totals.receipts, null);
  assert.equal(out.records[0].totals.expenditures, null);
});

test("an unresolved nominee renders an OURS gap rather than silence", () => {
  for (const [key, contestId] of [
    ["ballot-az-test:synthetic-office|Jordan Sample", "ballot-az-test:synthetic-office"],
    ["ballot-az-test:synthetic-office|Robin Nomatch", "ballot-az-test:synthetic-office"],
  ] as const) {
    const out = stateMoneyForCard(key, contestId);
    assert.equal(out.resolution, "UNRECONCILED_NOMINEE", key);
    assert.equal(out.resolvedTargetKey, null, key);
    assert.equal(out.records.length, 1, key);
    const record = out.records[0];
    assert.equal(record.filingState, "OURS_GAP", key);
    assert.ok(isRenderable(record), `${key} produced a record that does not render`);
    assert.ok(record.ourGap && record.ourGap.whatIsMissing.length > 0, key);
    /* A read stamp, carried from the corpus that took it. Never invented. */
    assert.match(record.checkedAt, /^\d{4}-\d{2}-\d{2}$/, key);
  }
});

test("an OURS gap carries no money of any kind — the prohibition, asserted", () => {
  const out = stateMoneyForCard("ballot-az-test:synthetic-office|Jordan Sample", "ballot-az-test:synthetic-office");
  const record = out.records[0];
  assert.equal(record.totals.receipts, null);
  assert.equal(record.totals.expenditures, null);
  assert.equal(record.totals.cashOnHand, null);
  assert.equal(record.committeeId, null);
  assert.equal(record.registeredName, "");
  /* And it names OUR gap, not a fact about the candidate. */
  assert.match(record.ourGap!.whatIsMissing, /we have not established/i);
});

test("a card keyed on a candidacy id passes straight through, unchanged", () => {
  const out = stateMoneyForCard(
    "ballot-az-pima:attorney-general:glassman-rodney",
    "ballot-az-pima:attorney-general",
  );
  assert.equal(out.resolution, "DIRECT_CANDIDACY_KEY");
  assert.equal(out.resolvedTargetKey, "ballot-az-pima:attorney-general:glassman-rodney");
  assert.equal(out.records.filter((r) => r.filingState === "FILED").length, 1);
});

test("a contest the bridge does not speak for is untouched", () => {
  /* The bridge answers for the Arizona certified lineup and nothing else. */
  const out = stateMoneyForCard("ballot-nh-grafton:state-house-1", "ballot-nh-grafton:state-house-1");
  assert.equal(out.resolution, "DIRECT_CANDIDACY_KEY");
  assert.equal(out.resolvedTargetKey, "ballot-nh-grafton:state-house-1");
});
