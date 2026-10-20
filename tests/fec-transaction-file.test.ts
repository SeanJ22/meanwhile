import assert from "node:assert/strict";
import test from "node:test";
import { collectFecOrganizationReceipts } from "../lib/funding/fec-transaction-file.ts";
import { fecOrganizationRows, projectFecDiscovery } from "../lib/funding/fec-collector.ts";
import { readFecPages, type FecReadPage, type FecRow } from "../lib/funding/fec-api.ts";
import { fecRegistration, type FecDiscovery } from "../lib/funding/fec-discovery.ts";

const committee = "C00000001", at = "2026-10-20T00:00:00Z";
const receipt = (id: string, amount: number): FecRow => ({ sub_id: id, file_number: "1", transaction_id: `T${id}`, report_year: 2026,
  report_type: "Q1", committee_id: committee, entity_type: "PAC", contributor_name: `Organization ${id}`, contribution_receipt_amount: amount, line_number: "11C" });
function pages(rows: readonly FecRow[], size = 3): FecReadPage {
  let index = 0;
  return async (_path, params) => {
    if (index) assert.equal(params.last_index, String(index));
    const results = rows.slice(index, index + size); index += results.length;
    return { results, sourceObservedAt: at, pagination: { count: rows.length,
      ...(index < rows.length ? { last_indexes: { last_index: String(index), last_contribution_receipt_amount: 0 } } : {}) } };
  };
}

test("disk receipt reconciliation preserves the native collector's complete values and stable equal-amount order", async () => {
  const source = [receipt("10", 40), receipt("2", 40), receipt("1", 40), receipt("3", 40), receipt("4", 40), receipt("5", 40),
    receipt("6", 90), { ...receipt("7", 20), original_sub_id: "6", file_number: "2" },
    { ...receipt("8", 500), memoed_subtotal: true }, { ...receipt("9", 600), is_deleted: true },
    { ...receipt("11", 1000), entity_type: "IND", contributor_name: "Private Canary" },
    { ...receipt("12", 30), transaction_id: "shared" }, { ...receipt("13", 35), transaction_id: "shared", report_type: "Q2" }];
  const original = fecOrganizationRows(await readFecPages(pages(source), "/schedules/schedule_a/", {}, true), committee)
    .sort((a, b) => b.amount - a.amount).slice(0, 5);
  const actual = await collectFecOrganizationReceipts(pages(source), committee, 2026, row => fecOrganizationRows([row], committee));
  assert.deepEqual(actual, original);
  assert.deepEqual(actual.map(row => row.filingId), ["10", "2", "1", "3", "4"]);
  assert.ok(!JSON.stringify(actual).includes("Private Canary"));
});

test("a native-ID-only Congress roster preserves every projected person link and filed total", () => {
  const discovery: FecDiscovery = { registrations: [fecRegistration({ candidate_id: "H6OR02001", name: "Source name", state: "OR", office: "H", district: "02", election_years: [2026] }, 2026, at)],
    totals: [{ candidate_id: "H6OR02001", cycle: 2026, receipts: 100, disbursements: 20, coverage_end_date: "2026-09-30" }], route: "api" };
  const source = { officeholders: [{ id: "congress:A000001", name: "Directory name", contact: "Unneeded contact", nativeIds: { fec: ["H6OR02001"] } }] };
  const narrow = { officeholders: [{ id: "congress:A000001", fecCandidateIds: ["H6OR02001"] }] };
  const expected = projectFecDiscovery(discovery, 2026, source);
  const actual = projectFecDiscovery(discovery, 2026, narrow);
  assert.deepEqual(actual, expected);
  assert.deepEqual(actual[0].targetKeys, ["fec:H6OR02001", "congress:A000001"]);
  assert.equal(actual[0].totals.receipts, 100);
  assert.doesNotMatch(JSON.stringify(narrow), /Directory name|Unneeded contact/);
});

test("all receipt pages remain eligible for a later downward amendment with only five output records", async () => {
  const count = 10_001;
  let seen = 0, calls = 0;
  const read: FecReadPage = async () => {
    calls++;
    const results: FecRow[] = [];
    while (results.length < 100 && seen < count) {
      seen++;
      results.push(seen === count ? { ...receipt(String(seen), 1), original_sub_id: "10000", file_number: "2" } : receipt(String(seen), seen));
    }
    return { results, pagination: { count, ...(seen < count ? { last_indexes: { last_index: String(seen), last_contribution_receipt_amount: 0 } } : {}) } };
  };
  const result = await collectFecOrganizationReceipts(read, committee, 2026, row => fecOrganizationRows([row], committee));
  assert.equal(calls, 101);
  assert.deepEqual(result.map(row => row.amount), [9999, 9998, 9997, 9996, 9995]);
});

test("disk receipt pagination keeps invalid identity, denominator, truncation and amendment checks", async () => {
  for (const source of [[receipt("1", 10), receipt("1", 11)], [{ ...receipt("1", 10), committee_id: "C00000002" }]]) {
    await assert.rejects(collectFecOrganizationReceipts(pages(source), committee, 2026, row => fecOrganizationRows([row], committee)), /IDENTITY/);
  }
  const unresolved = [receipt("1", 10), receipt("2", 11)].map(row => ({ ...row, report_type: null, transaction_id: "shared" }));
  await assert.rejects(collectFecOrganizationReceipts(pages(unresolved), committee, 2026, row => fecOrganizationRows([row], committee)), /SCOPE_UNRESOLVED/);
  let call = 0;
  await assert.rejects(collectFecOrganizationReceipts(async () => ({ results: [receipt(String(++call), 10)],
    pagination: { count: call === 1 ? 2 : 3, last_indexes: { last_index: String(call), last_contribution_receipt_amount: 0 } } }), committee, 2026,
  row => fecOrganizationRows([row], committee)), /COUNT_INVALID/);
  await assert.rejects(collectFecOrganizationReceipts(async () => ({ results: [], pagination: { count: 1 } }), committee, 2026,
    row => fecOrganizationRows([row], committee)), /CURSOR_INVALID/);
});
