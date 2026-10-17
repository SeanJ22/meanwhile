import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fecFundingCandidate } from "../lib/civic-data/candidate-builders.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredManualCandidate, processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { STATE_CAMPAIGN_FINANCE_SOURCES, stateCampaignFinanceCandidate } from "../lib/funding/data-plane.ts";
import { nativeStateMoneyRecord, upsertStateMoney } from "../lib/funding/state-native.ts";
import type { FundingSnapshot } from "../lib/funding/types.ts";
import type { StateMoneySnapshot } from "../lib/funding/state-money.ts";

const T0 = "2026-10-09T00:00:00.000Z", T1 = "2026-10-10T00:00:00.000Z", T2 = "2026-10-11T00:00:00.000Z";
const hash = "a".repeat(64);

test("FEC publishes attempts and second-hop-only changes, and the next pass reads them with unchanged candidate totals", async () => {
  const store = new MemoryRoutineDataStore();
  const snapshot = JSON.parse(readFileSync("data/fec/fec-2026.json", "utf8")) as FundingSnapshot;
  const url = "https://api.open.fec.gov/v1/candidate/H6OR02001/totals/?cycle=2026";
  const build = (value: FundingSnapshot, checkedAt: string) => fecFundingCandidate({ snapshot: value,
    rawBodies: [], rawHashes: [hash], finalUrl: url, retrievedAt: T0, excludedFacts: [],
    sourceCheck: { requestedUrl: url, finalUrl: url, httpStatus: 304, rawHash: hash, checkedAt } });
  const initial = build(snapshot, T0);
  assert.ok((await processRegisteredRoutineCandidate(store, "fec-funding", initial, T0)).promoted);
  const read = async () => JSON.parse(JSON.stringify((await store.readPromotion<FundingSnapshot>("FEC_FUNDING", initial.scope))!.payload)) as FundingSnapshot;
  const next = { ...await read(), refreshAttempts: { H6OR02001: T1 } };
  const progressed = await processRegisteredRoutineCandidate(store, "fec-funding", build(next, T1), T1);
  assert.ok(progressed.promoted); assert.equal(progressed.confirmed, undefined);
  assert.deepEqual((await read()).refreshAttempts, next.refreshAttempts);
  const secondHop = { dataClass: "FEC_CONTRIBUTOR" as const, committeeId: "C00000001", cycle: 2026,
    name: "Example Organization Committee", committeeType: null, organizationType: null, designation: null,
    topContributions: [], receipts: 100, provenance: { sourceUrl: url, sourceOrg: "Federal Election Commission", collectedAt: T0, verifiedAt: null } };
  const held = (await read()).secondHop ?? [];
  const third = { ...await read(), secondHop: [...held, secondHop] };
  const published = await processRegisteredRoutineCandidate(store, "fec-funding", build(third, T2), T2);
  assert.ok(published.promoted); assert.equal(published.confirmed, undefined);
  assert.deepEqual((await read()).secondHop, [...held, secondHop]);
  assert.deepEqual((await read()).candidates, snapshot.candidates);
  assert.equal((await read()).fetchedAt, snapshot.fetchedAt);
  const unchanged = await processRegisteredRoutineCandidate(store, "fec-funding", build(await read(), T2), T2);
  assert.ok(unchanged.confirmed, "no progress and no fact change still use the efficient confirmation path");
});

test("state finance saves page cursors and fairness attempts between passes without new amounts", async () => {
  const store = new MemoryRoutineDataStore();
  const url = "https://cfsapi.sos.nh.gov/api/PublicFilerDetails/GetFilingEntityDetails";
  const record = nativeStateMoneyRecord({ state: "NH", committeeId: "1", name: "Example Committee", candidateName: "Alice Adams",
    office: "State Senator", year: 2026, receipts: 100, spent: 20, period: "2026 cycle", sourceUrl: url, agency: "NH Secretary of State", observedAt: T0 });
  const contract = STATE_CAMPAIGN_FINANCE_SOURCES.NH;
  const build = (snapshot: StateMoneySnapshot, checkedAt: string) => stateCampaignFinanceCandidate({ jurisdiction: "NH", snapshot,
    rawBodies: [], rawHashes: [hash], requestedUrl: url, finalUrl: url, retrievedAt: T0,
    sourceCheck: { requestedUrl: url, finalUrl: url, httpStatus: 304, rawHash: hash, checkedAt }, query: "Native filer pages", paginationComplete: false });
  const first = upsertStateMoney(null, [record], { state: "NH", year: 2026, observedAt: T0 });
  assert.ok((await processRegisteredManualCandidate(store, contract.contractId, build(first, T0), T0)).promoted);
  for (const [page, at] of [[2, T1], [3, T2]] as const) {
    // Each invocation reconstructs its input solely from the published store, just like the real runner.
    const prior = JSON.parse(JSON.stringify((await store.readPromotion<StateMoneySnapshot>("STATE_CAMPAIGN_FINANCE", contract.scope))!.payload)) as StateMoneySnapshot;
    if (page === 3) assert.equal(prior.acquisitionCursors?.["nh:next-page"], 2);
    const next = upsertStateMoney(prior, [record], { state: "NH", year: 2026, observedAt: T0,
      acquisitionCursors: { "nh:next-page": page }, refreshAttempts: { "location:1:2026": at } });
    const outcome = await processRegisteredManualCandidate(store, contract.contractId, build(next, at), at);
    assert.ok(outcome.promoted); assert.equal(outcome.confirmed, undefined);
    const saved = (await store.readPromotion<StateMoneySnapshot>("STATE_CAMPAIGN_FINANCE", contract.scope))!.payload;
    assert.deepEqual(saved.records, [record]); assert.deepEqual(saved.acquisitionCursors, next.acquisitionCursors);
    assert.deepEqual(saved.refreshAttempts, next.refreshAttempts);
    assert.equal(saved.records[0].provenance.collectedAt, T0);
  }
});
