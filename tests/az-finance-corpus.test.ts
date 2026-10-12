import assert from "node:assert/strict";
import test from "node:test";
import { collectAzFinance } from "../scripts/state-money-az.mts";
import type { StateFinanceIO } from "../scripts/lib/state-money-runner.mts";
import { readFileSync } from "node:fs";
import type { SummaryRow } from "../lib/sources/az-seethemoney/index.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { STATE_CAMPAIGN_FINANCE_SOURCES, stateCampaignFinanceCandidate } from "../lib/funding/data-plane.ts";
import { upsertStateMoney } from "../lib/funding/state-native.ts";
import type { StateMoneySnapshot } from "../lib/funding/state-money.ts";
const fixture = JSON.parse(readFileSync("tests/fixtures/campaign-finance/azsos-seethemoney-summary-2026.json", "utf8")) as { data: SummaryRow[] };

test("AZ official native summaries publish without optional ballot, FTP or ledger reads", async () => {
  const calls: string[] = [];
  const io: StateFinanceIO = { year: 2028, signal: new AbortController().signal, prior: null, gaps: [], attempts: {}, cursors: {}, read: async (url, opts) => {
    calls.push(url); assert.match(opts?.body ?? "", /columns/);
    const text = JSON.stringify({ data: [null, ...fixture.data], recordsTotal: fixture.data.length + 1, recordsFiltered: fixture.data.length + 1 });
    opts?.validate?.(text);
    return { text, receipt: { sourceObservedAt: "2028-10-01T00:00:00Z" } as never };
  } };
  const result = await collectAzFinance(io);
  assert.equal(calls.length, 3); assert.ok(calls.every(url => url.includes("startYear=2027") && url.includes("endYear=2028")));
  assert.ok(result.records.length); assert.ok(result.records.every(row => row.targetKeys[0].startsWith("state-finance:AZ:") && row.electionYear === 2028));
  assert.ok(result.records.some(row => row.totals.receipts !== null));
  assert.ok(io.gaps.some(gap => gap.code === "AZ_NATIVE_PARTITION_UNRESOLVED"), "one malformed row does not suppress other committees");
  assert.equal(result.period, 2028);
});

test("an AZ filter failure retains independently completed filters and never claims absence", async () => {
  const io: StateFinanceIO = { year: 2026, signal: new AbortController().signal, prior: null, gaps: [], attempts: {}, cursors: {}, read: async url => {
    if (url.includes("ShowOfficeHolder=true")) throw new Error("503");
    return { text: JSON.stringify({ data: fixture.data, recordsTotal: fixture.data.length, recordsFiltered: fixture.data.length }),
      receipt: { sourceObservedAt: "2026-10-01T00:00:00Z" } as never };
  } };
  const result = await collectAzFinance(io);
  assert.equal(result.complete, false); assert.ok(result.records.length); assert.ok(io.gaps.length);
  assert.ok(result.records.every(row => row.filingState !== "NO_REPORTS_ON_FILE"));
});

test("an AZ activity transition and other complete committees reach readers while incomplete partitions retain older evidence", async () => {
  const oldAt = "2026-09-28T12:00:00.000Z", checkedAt = "2026-10-09T19:32:00.000Z";
  const sourceUrl = "https://seethemoney.az.gov/Reporting/GetNEWTableData/";
  const raw = JSON.stringify({ data: [null, ...fixture.data], recordsTotal: fixture.data.length + 1, recordsFiltered: fixture.data.length + 1 });
  const io: StateFinanceIO = { year: 2026, signal: new AbortController().signal, prior: null, gaps: [], attempts: {}, cursors: {},
    read: async (_url, options) => {
      options?.validate?.(raw);
      return { text: raw, receipt: { sourceObservedAt: checkedAt } as never };
    } };
  const acquired = await collectAzFinance(io);
  const activity = acquired.records.find(row => row.filingState === "FILED")!;
  assert.ok(activity);
  assert.equal(acquired.complete, false);
  const priorRecord = { ...activity, filingState: "REGISTERED_NO_ACTIVITY_REPORTED" as const,
    totals: { ...activity.totals, receipts: null, expenditures: null, cashOnHand: null }, checkedAt: oldAt.slice(0, 10),
    provenance: { ...activity.provenance, collectedAt: oldAt, verifiedAt: oldAt } };
  const retained = { ...priorRecord, committeeId: "retained-committee", targetKeys: ["state-finance:AZ:retained-committee:2026"] };
  const prior = upsertStateMoney(null, [priorRecord, retained], { state: "AZ", year: 2026, observedAt: oldAt,
    refreshAttempts: {}, acquisitionCursors: {} });
  const makeCandidate = (model: StateMoneySnapshot, at: string) => stateCampaignFinanceCandidate({ jurisdiction: "AZ", snapshot: model,
    rawBodies: [at === oldAt ? JSON.stringify(prior) : raw], requestedUrl: sourceUrl, finalUrl: sourceUrl,
    retrievedAt: at, query: acquired.query, paginationComplete: false, excludedFacts: at === oldAt ? [] : io.gaps });
  const store = new MemoryRoutineDataStore(), contract = STATE_CAMPAIGN_FINANCE_SOURCES.AZ;
  const historical = makeCandidate(prior, oldAt);
  const first = await processRegisteredManualCandidate(store, contract.contractId, historical, oldAt);
  assert.equal(first.candidate.state, "PROMOTED", first.candidate.failureDetail ?? "");
  const next = upsertStateMoney(prior, acquired.records, { state: "AZ", year: acquired.period!, observedAt: checkedAt });
  const value = makeCandidate(next, checkedAt);
  const outcome = await processRegisteredManualCandidate(store, contract.contractId, value, checkedAt);
  assert.equal(outcome.candidate.state, "PROMOTED", outcome.candidate.failureDetail ?? "");
  assert.equal(outcome.candidate.candidate.changeSet?.removed.length, 0);
  const published = (await store.readPromotion<StateMoneySnapshot>(value.recordClass, value.scope))!.payload;
  assert.equal(published.records.length, acquired.records.length + 1);
  assert.equal(published.records.find(row => row.committeeId === activity.committeeId)?.filingState, "FILED");
  assert.deepEqual(published.records.find(row => row.committeeId === retained.committeeId), retained);
  assert.deepEqual((await store.readCandidate(historical.id))?.candidate.readModel, prior);
  assert.ok(outcome.candidate.candidate.excludedFacts?.some(gap => gap.code === "AZ_NATIVE_PARTITION_UNRESOLVED"));
  assert.equal(outcome.readerReadback?.status, "PASS", outcome.readerReadback?.detail);
});
