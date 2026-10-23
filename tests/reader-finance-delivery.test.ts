import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { isRenderable } from "../lib/funding/state-money-reader.ts";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { campaignMoneyApiAnswer, campaignMoneyForTarget, currentOfficialIdentity, resolvedCandidacyForOfficial, officialFinanceIdentityMatches } from "../lib/funding/campaign-money.ts";
import { ROSTER_READER_DISPOSITIONS } from "./fixtures/held-body-rosters.ts";
import { fundingAnswerForTarget } from "../lib/funding/display.ts";
import { getFundingSnapshot, refreshFundingFromPromoted } from "../lib/funding/snapshot.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { type StateMoneyRecord } from "../lib/funding/state-money.ts";
import { resetStateMoneyCache, stateMoneyReadState } from "../lib/funding/state-snapshot.ts";
import { readGenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { getRegistryRuntimeReadModel } from "../lib/registry/runtime-read-model.ts";
import type { StateCampaignFinanceJurisdiction } from "../lib/funding/data-plane.ts";
import { installRegistryAuthority, installStateMoney, stateMoneyFixture, syntheticFiledStateMoneyRecord } from "./helpers/promoted-fixtures.ts";
import type { ReaderAuthorityEdgeBundle } from "../lib/registry/runtime-edge.ts";
import { currentReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";


import type { BallotSet } from "../lib/ballot/types.ts";
import type { GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import type { Contest } from "../lib/ballot/types.ts";
import type { LineupOutcome } from "../lib/identity/types.ts";
import { readFileSync } from "node:fs";
import { requireBallotState } from "../lib/civic-data/state-scopes.ts";
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







function promotedFixtureBundle(extra: ReaderAuthorityEdgeBundle = {}): ReaderAuthorityEdgeBundle {
  const current: ReaderAuthorityEdgeBundle = currentReaderAuthorityEdge() ?? {};
  return { stateAuthorities: current.stateAuthorities,
    ...(current.stateLegislators ? { stateLegislators: current.stateLegislators } : {}),
    ...extra, promoted: new Map([...(current.promoted ?? []), ...(extra.promoted ?? [])]) };
}


await installRegistryAuthority();

const HOBBS_RECEIPTS = 2_000_000;
function filed(state: StateCampaignFinanceJurisdiction, key: string, office: string, receipts = 1000): StateMoneyRecord {
  const record = syntheticFiledStateMoneyRecord(state, key, receipts);
  return { ...record, officeSought: office, match: { ...record.match, officeAsFiled: office, officeOnBallot: office } };
}
function withRecords(state: StateCampaignFinanceJurisdiction, records: StateMoneyRecord[]) {
  const fixture = stateMoneyFixture(state);
  return { ...fixture, records: [...fixture.records, ...records] };
}
await installBallots(syntheticAzBallot([
  {
    id: "ballot-az-pima:governor",
    title: "Governor",
    candidacies: [
      { id: "ballot-az-pima:governor:hobbs-katie", givenName: "Katie", familyName: "Hobbs" },
      { id: "ballot-az-pima:governor:biggs-andy", givenName: "Andy", familyName: "Biggs" },
      { id: "ballot-az-pima:governor:schweikert-david", givenName: "David", familyName: "Schweikert" },
    ],
    lineup: [{ name: "Katie Hobbs", partyLabel: "Democratic", outcome: "RECONCILED", candidacyId: "ballot-az-pima:governor:hobbs-katie" }],
  },
  {
    id: "ballot-az-pima:superintendent",
    title: "Superintendent of Public Instruction",
    candidacies: [{ id: "ballot-az-pima:superintendent:yee-kimberly", givenName: "Kimberly", familyName: "Yee" }],
  },
]));
await installStateMoney("AZ", withRecords("AZ", [
  filed("AZ", "ballot-az-pima:governor:hobbs-katie", "Governor", HOBBS_RECEIPTS),
  filed("AZ", "ballot-az-pima:governor:biggs-andy", "Governor"),
  filed("AZ", "ballot-az-pima:governor:schweikert-david", "Governor"),
  filed("AZ", "ballot-az-pima:superintendent:yee-kimberly", "Superintendent of Public Instruction"),
]));
await installStateMoney("NH", withRecords("NH", [filed("NH", "ballot-nh-merrimack:governor:ayotte-kelly", "Governor")]));
await installStateMoney("NJ");
await refreshFundingFromPromoted({ store: new MemoryRoutineDataStore() });
const bridge = getRegistryRuntimeReadModel().officialCandidacies;

const hobbsKey = "ballot-az-pima:governor:hobbs-katie";
const hobbs = filed("AZ", hobbsKey, "Governor", HOBBS_RECEIPTS);

test("official finance identity bridge is carried by the canonical registry projection", () => {
  assert.equal(bridge.formatVersion, 1);
  assert.equal(bridge.rule, "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE");
  assert.ok(bridge.rows.length > 800);
  assert.ok(bridge.rows.every((row) => !('sourcePath' in row.holder)));
});

test("exact duplicate roster aliases preserve the canonical finance answer and requested identity", () => {
  const aliases = ROSTER_READER_DISPOSITIONS.filter(row => row.state === "EXACT_DUPLICATE");
  assert.ok(aliases.length > 0);
  for (const row of aliases) {
    assert.ok(row.canonicalId);
    const actual = campaignMoneyForTarget(row.sourceId);
    const expected = campaignMoneyForTarget(row.canonicalId);
    assert.equal(actual.requestedTargetKey, row.sourceId);
    assert.deepEqual({ ...actual, requestedTargetKey: row.canonicalId }, expected);
    assert.deepEqual(campaignMoneyApiAnswer(row.sourceId), campaignMoneyApiAnswer(row.canonicalId));
    assert.deepEqual(currentOfficialIdentity(row.sourceId), currentOfficialIdentity(row.canonicalId));
    assert.deepEqual(resolvedCandidacyForOfficial(row.sourceId), resolvedCandidacyForOfficial(row.canonicalId));
  }
});

test("a reused officeholder slot, changed office, or changed jurisdiction fails the committed identity", () => {
  const row = bridge.rows.find(row => row.holder.id === "statewide:az/governor")!;
  assert.equal(officialFinanceIdentityMatches(row, row.holder), true);
  assert.equal(officialFinanceIdentityMatches(row, { ...row.holder, name: "Another Person" }), false);
  assert.equal(officialFinanceIdentityMatches(row, { ...row.holder, officeTitle: "Treasurer" }), false);
  assert.equal(officialFinanceIdentityMatches(row, { ...row.holder, divisions: ["ocd-division/country:us/state:nj"] }), false);
  assert.equal(officialFinanceIdentityMatches(row, null), false);
});

test("unverified extraction PASS and Auditor INCONCLUSIVE do not promote money", () => {
  const acquisition = { ...hobbs, provenance: { ...hobbs.provenance, verifiedAt: null }, validationStatus: "PASS", auditResult: "INCONCLUSIVE" };
  assert.equal(isRenderable(acquisition), false);
  assert.equal(isRenderable({ ...hobbs, match: { ...hobbs.match, allThreeAgree: false } }), false);
  assert.equal(isRenderable({ ...hobbs, filingState: "LEAD" }), false);
  assert.equal(isRenderable({ ...hobbs, dataClass: "ACQUISITION" } as unknown as StateMoneyRecord), false);
  assert.equal(isRenderable({ ...hobbs, filingState: "OURS_GAP", ourGap: { whatIsMissing: "Unresolved identity", nextDue: null, nextDueName: null } }), false);
});

test("federal finance answer remains identical for every existing FEC target", () => {
  for (const row of getFundingSnapshot().candidates) for (const key of row.targetKeys) {
    assert.deepEqual(campaignMoneyForTarget(key).federal, fundingAnswerForTarget(key), key);
  }
});

test("staged evidence cannot substitute for a missing promoted source holding", () => {
  const root = process.cwd();
  const isolated = mkdtempSync(join(tmpdir(), "reader-finance-trace-"));
  try {
    mkdirSync(join(isolated, "data", "states", "az", "candidates"), { recursive: true });
    writeFileSync(join(isolated, "data", "states", "az", "candidates", "staged.json"), JSON.stringify({ records: [hobbs] }));
    process.chdir(isolated);
    resetStateMoneyCache();
    const read = stateMoneyReadState("AZ");
    assert.equal(read.kind, "STORE_UNREACHABLE");
    assert.equal(read.value, null);
  } finally {
    process.chdir(root);
    resetStateMoneyCache();
    rmSync(isolated, { recursive: true, force: true });
  }
});

test("a missing canonical ballot identity projection cannot become a display-key funding absence", async () => {
  await installStateMoney("AZ", withRecords("AZ", [filed("AZ", hobbsKey, "Governor", HOBBS_RECEIPTS)]));
  const base = promotedFixtureBundle();
  const edge = { ...base, stateAuthorities: { families: base.stateAuthorities!.families,
    load: async (family: Parameters<NonNullable<typeof base.stateAuthorities>["load"]>[0], state: string) => {
      if (family === "ballot-contests" && state === "AZ") return null;
      return base.stateAuthorities!.load(family, state);
    } } };
  const previous = neonConfig.fetchFunction;
  neonConfig.fetchFunction = async () => { throw new Error("Planted canonical database failure"); };
  try {
    await withReaderAuthorityEdge(edge, async () => {
      assert.equal((await readGenericBallotProjection("AZ")).kind, "STORE_UNREACHABLE");

    });
  } finally { neonConfig.fetchFunction = previous; }
});
