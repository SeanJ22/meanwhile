import assert from "node:assert/strict";
import test from "node:test";

import { AUTOMATIC_REFRESH_TASKS } from "../lib/civic-data/automatic-refresh.ts";
import { candidateChangeSet, civicRecordsFor } from "../lib/civic-data/changes.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { routineTaskDue } from "../lib/civic-data/runner.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import { validateRoutineCandidate } from "../lib/civic-data/validate.ts";
import {
  STATE_CAMPAIGN_FINANCE_SOURCES,
  stateCampaignFinanceCandidate,
  stateCampaignFinanceMembers,
  type StateCampaignFinanceJurisdiction,
} from "../lib/funding/data-plane.ts";
import { nativeStateMoneyRecord, upsertStateMoney } from "../lib/funding/state-native.ts";
import { stateMoneyRecordKey, type StateMoneyRecord, type StateMoneySnapshot } from "../lib/funding/state-money.ts";

const T0 = "2026-10-09T12:00:00.000Z", T1 = "2026-10-09T13:00:00.000Z";
const URLS = {
  AZ: "https://seethemoney.az.gov/Reporting/GetNEWTableData/",
  NH: "https://cfsapi.sos.nh.gov/api/PublicFilerDetails/GetFilingEntityDetails",
  NJ: "https://www.njelecefilesearch.com/SearchEntityByLocation",
};

function native(state: StateCampaignFinanceJurisdiction, filed = true): StateMoneyRecord {
  return nativeStateMoneyRecord({ state, committeeId: "102250", name: "Example Committee", candidateName: "Example Candidate",
    office: "State Representative", year: 2026, receipts: filed ? 100 : null, spent: filed ? 20 : null,
    filingState: filed ? "FILED" : "REGISTERED_NO_ACTIVITY_REPORTED", period: "2025-01-01 through 2026-12-31",
    sourceUrl: URLS[state], agency: "Official filing authority", observedAt: filed ? T1 : T0 });
}

function snapshot(state: StateCampaignFinanceJurisdiction, rows: readonly StateMoneyRecord[], at = T1): StateMoneySnapshot {
  return upsertStateMoney(null, rows, { state, year: 2026, observedAt: at, refreshAttempts: {}, acquisitionCursors: {} });
}

function candidate(state: StateCampaignFinanceJurisdiction, model: StateMoneySnapshot, at = T1): RoutineCandidate {
  return stateCampaignFinanceCandidate({ jurisdiction: state, snapshot: model, rawBodies: [JSON.stringify(model)],
    requestedUrl: URLS[state], finalUrl: URLS[state], retrievedAt: at,
    query: "Official native committee and period projection", paginationComplete: false,
    excludedFacts: [{ code: "AZ_NATIVE_PARTITION_UNRESOLVED", detail: "An unrelated malformed native partition remains withheld." }] });
}

async function seedHistorical(store: MemoryRoutineDataStore, baseline: RoutineCandidate, parser: string): Promise<RoutineCandidate> {
  const model = baseline.readModel as StateMoneySnapshot;
  const historical: RoutineCandidate = { ...baseline, id: `${baseline.id}-historical`,
    normalization: { ...baseline.normalization, parserVersion: parser },
    civicRecords: model.records.map((record, index) => ({
      // Saved /2 and /3 evidence retains its original status-bearing keys.
      key: `${stateMoneyRecordKey(record, index)}:${record.filingState}`, record,
    })) };
  const validation = validateRoutineCandidate({ ...baseline, changeSet: candidateChangeSet(baseline, null) }, null, T0);
  assert.equal(validation.state, "VALIDATED", JSON.stringify(validation.receipt.checks.filter(check => check.verdict !== "PASS")));
  const receipt = { ...validation.receipt, candidateId: historical.id };
  await store.create({ candidate: historical, state: "FETCHED", acquisitionSucceeded: true, receipt: null,
    promotedVersion: null, lastKnownGoodVersion: null, failureCode: null, failureDetail: null },
  { candidateId: historical.id, sequence: 1, state: "FETCHED", at: T0, detail: "Historical official source capture." });
  await store.transition(historical.id, "NORMALIZED", T0, "Historical normalization.");
  await store.transition(historical.id, "VALIDATED", T0, "Historical GOOD receipt.", receipt);
  await store.promote(historical.id, receipt, T0);
  return historical;
}

test("native finance identity keeps filing state mutable and keeps jurisdictions, periods and unresolved targets distinct", () => {
  const row = native("AZ"), prior = native("AZ", false);
  assert.equal(stateMoneyRecordKey(row, 0), "state-money:AZ:2026:102250");
  assert.equal(stateMoneyRecordKey(prior, 0), stateMoneyRecordKey(row, 0));
  const otherPeriod = { ...row, electionYear: 2024 };
  const otherJurisdiction = { ...row, jurisdiction: "NH" };
  const otherCommittee = { ...row, committeeId: "102251" };
  const gap = { ...prior, committeeId: null, filingState: "OURS_GAP" as const, targetKeys: ["candidate:a", "candidate:b"] };
  const otherGap = { ...gap, targetKeys: ["candidate:c"] };
  const rows = [row, otherPeriod, otherJurisdiction, otherCommittee, gap, otherGap];
  const model = { ...snapshot("AZ", []), records: rows };
  const members = stateCampaignFinanceMembers(model);
  assert.equal(new Set(members.map(member => member.key)).size, rows.length);
  assert.equal(stateMoneyRecordKey(gap, 0), "state-money:AZ:2026:candidate:a+candidate:b:OURS_GAP");
  assert.equal(stateMoneyRecordKey({ ...gap, targetKeys: gap.targetKeys.toReversed() }, 2), stateMoneyRecordKey(gap, 0));
  assert.deepEqual(civicRecordsFor("STATE_CAMPAIGN_FINANCE", model), members);
});

test("a newly filed native committee promotes from historical status keys despite unrelated incomplete source partitions", async () => {
  const readbacks: { status?: string; detail?: string }[] = [];
  for (const state of ["AZ", "NH", "NJ"] as const) {
    for (const version of [2, 3]) {
      const store = new MemoryRoutineDataStore(), contract = STATE_CAMPAIGN_FINANCE_SOURCES[state];
      const prior = snapshot(state, [native(state, false)], T0);
      const historical = await seedHistorical(store, candidate(state, prior, T0), `${state.toLowerCase()}-campaign-finance/${version}`);
      const before = await store.readCandidate(historical.id);
      const newCommittee = { ...native(state), committeeId: "102251", targetKeys: [`state-finance:${state}:102251:2026`] };
      const next = upsertStateMoney(prior, [native(state), newCommittee], { state, year: 2026, observedAt: T1 });
      const value = candidate(state, next);
      const outcome = await processRegisteredManualCandidate(store, contract.contractId, value, T1);
      assert.equal(outcome.candidate.state, "PROMOTED", outcome.candidate.failureDetail ?? "");
      readbacks.push(outcome.readerReadback ?? {});
      assert.equal(outcome.candidate.candidate.changeSet?.removed.length, 0);
      assert.deepEqual(outcome.candidate.candidate.changeSet?.changed.map(row => row.key), [`state-money:${state}:2026:102250`]);
      assert.equal(outcome.candidate.candidate.changeSet?.added.length, 1);
      assert.equal((await store.readPromotion<StateMoneySnapshot>(value.recordClass, value.scope))?.payload.records.length, 2);
      assert.deepEqual(await store.readCandidate(historical.id), before, "prior immutable evidence stays intact");
      assert.deepEqual(outcome.candidate.candidate.excludedFacts, value.excludedFacts);
    }
  }
  for (const readback of readbacks) assert.equal(readback.status, "PASS", readback.detail);
});

test("an incomplete native projection still refuses an actually missing committee or period", async () => {
  for (const change of ["committee", "period"] as const) {
    const store = new MemoryRoutineDataStore();
    const prior = snapshot("AZ", [native("AZ", false)], T0);
    const historical = await seedHistorical(store, candidate("AZ", prior, T0), "az-campaign-finance/3");
    const nextRecord = change === "committee" ? { ...native("AZ"), committeeId: "102251" }
      : { ...native("AZ"), electionYear: 2028 };
    const value = candidate("AZ", snapshot("AZ", [nextRecord]));
    const outcome = await processRegisteredManualCandidate(store, STATE_CAMPAIGN_FINANCE_SOURCES.AZ.contractId, value, T1);
    assert.equal(outcome.candidate.state, "HORIZON_UNRESOLVED");
    assert.ok(outcome.candidate.receipt?.checks.some(check => check.code === "INCOMPLETE_HORIZON_REMOVAL_UNEXPLAINED" && check.verdict !== "PASS"));
    assert.equal((await store.readPromotion(value.recordClass, value.scope))?.versionId, historical.id);
  }
});

test("conflicting statuses for one native committee-period cannot appear as two valid records", () => {
  const model = { ...snapshot("AZ", []), records: [native("AZ"), native("AZ", false)] };
  const value = candidate("AZ", model);
  assert.equal(value.normalization.succeeded, false);
  assert.match(value.normalization.failureDetail ?? "", /unique stable identities/);
  assert.notEqual(validateRoutineCandidate(value, null, T1).receipt.decision, "GOOD");
  const previous = snapshot("AZ", [native("AZ")]);
  const correction = candidate("AZ", snapshot("AZ", [native("AZ", false)]));
  const changes = candidateChangeSet(correction, previous);
  assert.equal(changes.removed.length, 0);
  assert.equal(changes.added.length, 0);
  assert.equal(changes.changed.length, 1, "a source correction to no reported activity is also a fact change");
});

test("the existing automatic tasks immediately reparse older finance identities and keep their cadence and retry", async () => {
  for (const state of ["AZ", "NH", "NJ"] as const) {
    const store = new MemoryRoutineDataStore(), contract = STATE_CAMPAIGN_FINANCE_SOURCES[state];
    await seedHistorical(store, candidate(state, snapshot(state, [native(state, false)], T0), T0), `${state.toLowerCase()}-campaign-finance/3`);
    const task = AUTOMATIC_REFRESH_TASKS.find(row => row.id === contract.contractId)!;
    assert.equal(task.parserVersion, `${state.toLowerCase()}-campaign-finance/4`);
    const clock = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
    assert.equal(clock.lastAttemptedAt, undefined);
    assert.equal(routineTaskDue(task, clock, Date.parse(T0) + 1), true);
    assert.equal(task.cadenceMs, 86_400_000);
    assert.equal(task.retryMs, 3_600_000);
    assert.equal(routineTaskDue(task, { ...clock, lastAttemptedAt: T0 }, Date.parse(T0) + 1), false);
  }
});
