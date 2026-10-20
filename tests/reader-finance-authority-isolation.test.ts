import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { readFundingSnapshot } from "../lib/funding/snapshot.ts";
import { refreshStateMoneyProjectionFromPromoted, stateMoneyReadState } from "../lib/funding/state-snapshot.ts";
import { readGenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { campaignMoneyEvidenceFor } from "../lib/ask/campaign-money.ts";
import { lineupForContest } from "../lib/ballot/general-lineup.ts";
import { analysisForContest } from "../lib/ballot/analyses.ts";
import { lineupBridgeCovers, lineupRowForCard, reconciledCandidacyIdForCard } from "../lib/identity/az-2026.ts";
import { installRegistryAuthority, installStateMoney, stateMoneyFixture, syntheticFiledStateMoneyRecord } from "./helpers/promoted-fixtures.ts";
import type { StateCampaignFinanceJurisdiction } from "../lib/funding/data-plane.ts";
import { readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
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


/** A state's recorded finance projection plus one synthetic FILED committee for `targetKey`. */
function stateMoneyWith(state: StateCampaignFinanceJurisdiction, targetKey: string) {
  const fixture = stateMoneyFixture(state);
  return { ...fixture, records: [...fixture.records, syntheticFiledStateMoneyRecord(state, targetKey)] };
}

/** The registry bridge, an Arizona ballot, and each state's finance holding with a filing for the governor or commissioner the cases name. */
async function installFinanceAuthorities(): Promise<void> {
  await installRegistryAuthority();
  await installBallots();
  await installStateMoney("AZ", stateMoneyWith("AZ", "ballot-az-pima:governor:hobbs-katie"));
  await installStateMoney("NH", stateMoneyWith("NH", "ballot-nh-merrimack:governor:ayotte-kelly"));
  await installStateMoney("NJ");
  await readFundingSnapshot({ store: new MemoryRoutineDataStore(), bypassCache: true });
}

const failedStore = {
  async readPromotion() { throw new Error("planted independent authority failure"); },
  async readCandidate() { throw new Error("a failed pointer must not read a candidate"); },
};

test("Ask retains exact state finance records when only the unrelated FEC reader fails", async () => {
  await installFinanceAuthorities();
  const cases = [
    ["NH", "ballot-nh-merrimack:governor:ayotte-kelly", "Kelly Ayotte"],
    ["NJ", "ballot-nj-morris:county-commissioner:selen", "Tayfun Selen"],
    ["AZ", "ballot-az-pima:governor:hobbs-katie", "Katie Hobbs"],
  ] as const;
  const before = cases.map(([state, id, name]) => ({
    stateRead: stateMoneyReadState(state),
    answer: campaignMoneyEvidenceFor({ kind: "PERSON", id, name }, id),
  }));
  assert.ok(before.every(({ answer }) => answer.records.some(record => record.kind === "FINANCE_SUMMARY")));
  const env = process.env as Record<string, string | undefined>;
  const previous = env.NODE_ENV;
  env.NODE_ENV = "production";
  try {
  assert.equal((await readFundingSnapshot({ store: failedStore, bypassCache: true })).kind, "STORE_UNREACHABLE");
  assert.equal((await readRegistryRuntimeProjection(["AZ", "NH", "NJ"], { store: failedStore, bypassCache: true })).kind, "STORE_UNREACHABLE");
  for (const [index, [state, id, name]] of cases.entries()) {
    assert.deepEqual(stateMoneyReadState(state), before[index]!.stateRead);
    const answer = campaignMoneyEvidenceFor({ kind: "PERSON", id, name }, id);
    assert.deepEqual(answer, before[index]!.answer, `${state}: an unrelated FEC failure must not erase or misattribute held finance`);
    assert.ok(answer.records.every(record => record.canonicalSubjectId === id && record.sourceUrl));
  }
  const slot = campaignMoneyEvidenceFor({ kind: "PERSON", id: "statewide:nh/governor", name: "Kelly Ayotte" }, "statewide:nh/governor");
  assert.equal(slot.records.length, 0, "An unreadable officeholder bridge must not guess a candidacy from a reusable slot");
  assert.equal(slot.denominators.financeLoaderFailures, 1);
  } finally {
    if (previous === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previous;
  }
});

test("lineup and measure lookups answer null when the ballot projection is unreadable", async () => {
  const env = process.env as Record<string, string | undefined>;
  const previous = env.NODE_ENV;
  env.NODE_ENV = "production";
  try {
    assert.equal((await readGenericBallotProjection("AZ", { store: failedStore, bypassCache: true })).kind, "STORE_UNREACHABLE");
    for (const id of ["ballot-nh-merrimack:governor", "ballot-nj-morris:county-commissioner"]) {
      assert.equal(lineupForContest("AZ", id), null, `${id}: the AZ canvass has no authority over this contest`);
      assert.equal(analysisForContest("AZ", id), null, `${id}: AZ measure analyses have no authority over this contest`);
    }
    assert.equal(lineupForContest("AZ", "ballot-az-pima:governor"), null);
    assert.equal(analysisForContest("AZ", "ballot-az-pima:prop-139"), null);
  } finally {
    if (previous === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previous;
  }
});

test("foreign contest and card keys do not initialize the AZ identity bridge", async () => {
  const env = process.env as Record<string, string | undefined>;
  const previous = env.NODE_ENV;
  env.NODE_ENV = "production";
  try {
    await readGenericBallotProjection("AZ", { store: failedStore, bypassCache: true });
    for (const id of ["ballot-nh-merrimack:governor", "ballot-nj-morris:county-commissioner"]) {
      assert.equal(lineupBridgeCovers(id), false);
      assert.equal(lineupRowForCard(`${id}|Public test nominee`), null);
      assert.equal(reconciledCandidacyIdForCard(`${id}|Public test nominee`), null);
    }
    assert.throws(() => lineupBridgeCovers("ballot-az-pima:governor"), /Ballot for AZ is UNREAD/);
  } finally {
    if (previous === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previous;
  }
});

test("an unavailable NH finance holding remains explicit while NJ finance still renders", async () => {
  await installFinanceAuthorities();
  await refreshStateMoneyProjectionFromPromoted("NH", { store: failedStore, bypassCache: true });
  const missing = campaignMoneyEvidenceFor({ kind: "PERSON", id: "ballot-nh-merrimack:governor:ayotte-kelly", name: "Kelly Ayotte" }, "ballot-nh-merrimack:governor:ayotte-kelly");
  assert.equal(missing.records.length, 0);
  assert.equal(missing.denominators.financeLoaderFailures, 1);
  assert.match(missing.gaps[0]!.statement, /could not be read/);
  const held = campaignMoneyEvidenceFor({ kind: "PERSON", id: "ballot-nj-morris:county-commissioner:selen", name: "Tayfun Selen" }, "ballot-nj-morris:county-commissioner:selen");
  assert.ok(held.records.some(record => record.kind === "FINANCE_SUMMARY" && record.sourceUrl));
});

test("state officeholder finance also survives an unrelated FEC failure through the verified bridge", async () => {
  await installFinanceAuthorities();
  const subjects = [
    { kind: "PERSON", id: "statewide:nh/governor", name: "Kelly Ayotte" },
    { kind: "PERSON", id: "statewide:az/governor", name: "Katie Hobbs" },
    { kind: "PERSON", id: "roster:morris#6", name: "Tayfun Selen" },
  ] as const;
  const before = subjects.map(subject => campaignMoneyEvidenceFor(subject, subject.id));
  assert.ok(before.every(answer => answer.records.some(record => record.kind === "FINANCE_SUMMARY")));
  await readFundingSnapshot({ store: failedStore, bypassCache: true });
  for (const [index, subject] of subjects.entries()) {
    assert.deepEqual(campaignMoneyEvidenceFor(subject, subject.id), before[index], subject.id);
  }
});
