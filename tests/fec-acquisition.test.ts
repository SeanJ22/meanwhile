import assert from "node:assert/strict";
import test from "node:test";
import { collectFecCandidate, fecOrganizationRows, fecTotalsForPeriod } from "../lib/funding/fec-collector.ts";
import { fecCycle, parseFecPage, readFecPages, type FecPage, type FecReadPage } from "../lib/funding/fec-api.ts";
import type { FecTarget } from "../lib/funding/fec-targets.ts";
const id = "H6OR02001", committee = "C00000001";
const target: FecTarget = { targetKey: "congress:A000001", displayName: "Alice Adams", state: "OR", office: "H", district: "02",
  route: "roster", knownFecCandidateId: id };
const page = (results: Record<string, unknown>[]): FecPage => ({ results, pagination: { count: results.length, pages: 1 } });
const receipt = (sub: string, amount: number, file = "1", transaction = "T1") => ({ sub_id: sub, transaction_id: transaction, file_number: file,
  report_year: 2026, report_type: "Q1",
  committee_id: committee, contributor_name: "Filed Organization", entity_type: "PAC", contribution_receipt_amount: amount, line_number: "11C" });

test("FEC preserves large native cursors and reads the second page before declaring completion", async () => {
  const first = parseFecPage('{"results":[{"sub_id":4123456789012345678}],"pagination":{"count":2,"last_indexes":{"last_index":4123456789012345678,"last_contribution_receipt_amount":5}}}');
  assert.equal(first.results[0].sub_id, "4123456789012345678");
  let calls = 0;
  const rows = await readFecPages(async (_path, params) => {
    if (!calls++) return first;
    assert.equal(params.last_index, "4123456789012345678");
    return { results: [{ sub_id: "4123456789012345679" }], pagination: { count: 2 } };
  }, "/schedules/schedule_a/", {}, true);
  assert.equal(calls, 2); assert.equal(rows.length, 2);
  await assert.rejects(readFecPages(async () => first, "/schedules/schedule_a/", {}, true), /CURSOR|OVERFLOW/);
});

test("FEC amendments replace native transactions and never serialize personal or memo receipts", () => {
  const rows = fecOrganizationRows([receipt("1", 100), receipt("2", 75, "2"),
    { ...receipt("3", 500, "2", "private"), entity_type: "IND", contributor_name: "Private Canary" },
    { ...receipt("4", 1000, "2", "memo"), memoed_subtotal: true }], committee);
  assert.equal(rows.length, 1); assert.equal(rows[0].amount, 75); assert.equal(rows[0].filingId, "2");
  assert.doesNotMatch(JSON.stringify(rows), /Private Canary/);
  assert.throws(() => fecOrganizationRows([{ ...receipt("5", 30), committee_id: "C00000002" }], committee), /IDENTITY/);
  const differentReports = fecOrganizationRows([receipt("6", 30), { ...receipt("7", 40), report_type: "Q2" }], committee);
  assert.equal(differentReports.length, 2, "a reused software transaction id in another report is independent money");
  assert.throws(() => fecOrganizationRows([{ ...receipt("8", 30), report_type: null }, { ...receipt("9", 40), report_type: null }], committee), /SCOPE_UNRESOLVED/);
  const nativeLinked = fecOrganizationRows([{ ...receipt("10", 30), report_type: null },
    { ...receipt("11", 40, "2", "corrected-native-transaction"), report_type: null, original_sub_id: "10" }], committee);
  assert.equal(nativeLinked.length, 1); assert.equal(nativeLinked[0].amount, 40);
});

test("native candidate totals and all authorized committees publish independently of optional missing totals", async () => {
  const calls: string[] = [];
  const read: FecReadPage = async (path, params) => {
    calls.push(`${path}:${params.committee_id ?? ""}`);
    if (path.endsWith("/totals/")) return { ...page([{ candidate_id: id, cycle: 2028, receipts: 300, disbursements: null,
      individual_itemized_contributions: 100, individual_unitemized_contributions: 200, coverage_end_date: "2028-09-30" }]), sourceObservedAt: "2028-10-01T00:00:00Z" };
    if (path.endsWith("/committees/")) return page([{ committee_id: committee, candidate_ids: [id], designation: "P" }, { committee_id: "C00000002", candidate_ids: [id], designation: "A" }]);
    return page([{ ...receipt(params.committee_id === committee ? "11" : "12", 100), committee_id: params.committee_id }]);
  };
  const result = await collectFecCandidate({ candidateId: id, cycle: 2028, targets: [target], read, observedAt: () => "2028-10-09T00:00:00Z" });
  assert.ok(result.candidate);
  assert.deepEqual(result.candidate.principalCommitteeIds, [committee, "C00000002"]);
  assert.equal(result.candidate.principalCommitteeId, null);
  assert.equal(result.candidate.topContributions.length, 2);
  assert.equal(result.candidate.totals.disbursements, null); assert.equal(result.candidate.totals.cashOnHand, null);
  assert.equal(result.candidate.provenance.collectedAt, "2028-10-01T00:00:00Z");
  assert.equal(calls.filter(call => call.startsWith("/schedules")).length, 2);
});

test("a candidate's optional failure retains its own receipts without blocking its verified totals", async () => {
  const read: FecReadPage = async path => path.endsWith("/totals/") ? page([{ candidate_id: id, cycle: 2026, receipts: 10 }]) : Promise.reject(new Error("503"));
  const first = await collectFecCandidate({ candidateId: id, cycle: 2026, targets: [target], read, observedAt: () => "2026-10-09" });
  assert.equal(first.candidate?.totals.receipts, 10); assert.equal(first.candidate?.acquisition?.contributionsComplete, false);
  const held = first.candidate!; held.topContributions = fecOrganizationRows([receipt("1", 50)], committee);
  held.provenance.collectedAt = "2026-10-01";
  const next = await collectFecCandidate({ candidateId: id, cycle: 2026, targets: [target], previous: held, read, observedAt: () => "2026-10-09" });
  assert.deepEqual(next.candidate?.topContributions, held.topContributions.map(row => ({ ...row, sourceObservedAt: "2026-10-01" })));
  assert.equal(next.candidate?.totals.receipts, 10);
});

test("periods are explicit and conflicting latest candidate totals never get summed", () => {
  assert.equal(fecCycle(new Date("2027-01-01")), 2028);
  assert.equal(fecCycle(new Date("2026-01-01"), "2024"), 2024);
  assert.throws(() => fecCycle(new Date(), "2025"), /CYCLE_INVALID/);
  assert.equal(fecTotalsForPeriod([{ candidate_id: id, cycle: 2024, receipts: 100 }], id, 2026), null);
  assert.throws(() => fecTotalsForPeriod([{ cycle: 2026, receipts: 1, coverage_end_date: "2026-01-01" },
    { cycle: 2026, receipts: 2, coverage_end_date: "2026-01-01" }], id, 2026), /AMBIGUOUS/);
});
