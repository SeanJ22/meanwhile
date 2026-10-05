import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { nationalGovernmentFinancePackage, publishNationalGovernmentFinance } from "../lib/civic-data/national-government-finance.ts";
import { governmentFinanceChecklistEvidence, governmentFinanceFact, type GovernmentFinanceFact } from "../lib/civic-data/government-finance.ts";
import { readGovernmentBudgets } from "../lib/civic-data/government-budgets.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { DoorRecord } from "../lib/doors/registry.ts";
import type { CapturedFinanceResponse } from "../lib/funding/campaign-finance.ts";
const now = "2026-10-05T22:00:00Z";
const map = { governmentId: "Government", governmentName: "Name", title: "Title", kindLabel: "Kind", amount: "Amount", units: "Units", fiscalPeriod: "Period", fundScope: "Fund" };
const saved = (text: string, url: string): CapturedFinanceResponse => {
  const bytes = Buffer.from(text);
  return { bytes, rawHash: createHash("sha256").update(bytes).digest("hex"), url, retrievedAt: now,
    complete: true, partial: false, httpStatus: 200, transport: "REACHABLE", publisher: new URL(url).hostname };
};
test("Census, FAC and USAspending saved rows publish to the exact scoped typed reader without models or foreign-government rows", async () => {
  for (const [state, kind, host, format] of [["OH", "government-finance-census", "www.census.gov", "csv"],
    ["MI", "government-finance-fac", "www.fac.gov", "json"], ["PR", "government-finance-usaspending", "api.usaspending.gov", "csv"]] as const) {
    const ocdId = `ocd-division/country:us/${state === "PR" ? "territory:pr" : `state:${state.toLowerCase()}`}/county:alder`;
    const government = { bodyId: `${ocdId}#governing`, ocdId, name: "Alder County", sourceGovernmentId: "001" };
    const rows = [{ Government: "001", Name: "Alder County", Title: "General revenue", Kind: "Revenue", Amount: 123.45, Units: "thousand dollars", Period: "FY2025", Fund: "General fund", MailingAddress: "99 Private Lane" },
      { Government: "002", Name: "Other County", Title: "Foreign government revenue", Kind: "Revenue", Amount: 999, Units: "dollars", Period: "FY2025", Fund: "Other fund" }];
    const text = format === "json" ? JSON.stringify({ results: rows }) :
      "Government,Name,Title,Kind,Amount,Units,Period,Fund,MailingAddress\n001,Alder County,General revenue,Revenue,123.45,thousand dollars,FY2025,General fund,99 Private Lane\n002,Other County,Foreign government revenue,Revenue,999,dollars,FY2025,Other fund,Other\n";
    const door = { doorId: `fixture:${state}`, kind, ocdId, hosts: [host], config: { format, rowsPath: "results", fieldMap: JSON.stringify(map) } } as unknown as DoorRecord;
    const response = saved(text, `https://${host}/government-finance`);
    const input = { door, government, responses: [response], now };
    const built = nationalGovernmentFinancePackage(input);
    assert.equal(built.payload.records.length, 1);
    assert.equal(built.sourceReceipt.sources[0].rawHash, response.rawHash);
    assert.doesNotMatch(JSON.stringify(built.payload), /Foreign government|99 Private Lane/);
    const store = new MemoryRoutineDataStore();
    const published = await publishNationalGovernmentFinance(store, input);
    assert.ok(published.promoted, published.candidate.failureDetail ?? "promotion held");
    assert.equal(published.readerReadback?.status, "PASS");
    const read = await readGovernmentBudgets(ocdId, { store, now, bypassCache: true });
    assert.equal(read.kind, "PROMOTED");
    if (read.kind !== "PROMOTED") throw new Error("Finance absent");
    const record = read.value.records[0] as GovernmentFinanceFact;
    assert.equal(record.category, "REVENUE");
    assert.equal(record.details.amount, 123.45, "source units are retained; dollars are not computed");
    assert.equal(record.details.units, "thousand dollars");
    assert.equal(record.sourceHash, response.rawHash);
    assert.equal(governmentFinanceChecklistEvidence([record], government.bodyId)["FIN-08"].length, 0, "unheld reconciliation stays owed");
    await assert.rejects(publishNationalGovernmentFinance(store, { ...input, responses: [{ ...response, partial: true }] }));
    assert.equal((await readGovernmentBudgets(ocdId, { store, now, bypassCache: true })).kind, "PROMOTED", "failed acquisition preserves GOOD");
  }
});

test("checklist finance categories distinguish budgets from spending and reconcile only source totals in the same report", () => {
  const common = { bodyId: "body", ocdId: "ocd-division/country:us/state:oh/county:alder", government: "Alder County",
    sourceUrl: "https://finance.example.gov/budget", sourceHash: "a".repeat(64), capturedAt: now, sourceSentence: "The adopted budget is version v1." };
  const revenue = (category: string, amount: number, period = "FY2025") => governmentFinanceFact({ ...common, title: category,
    detailKind: "REVENUE", details: { category, amount, publishedTotal: 0.3, units: "dollars", fundScope: "General", fiscalPeriod: period, identifier: "Annual report" } });
  const rows = [revenue("Taxes", 0.1), revenue("Fees", 0.2)];
  assert.equal(governmentFinanceChecklistEvidence(rows, "body")["FIN-08"].length, 2, "exact decimal source identity");
  assert.equal(governmentFinanceChecklistEvidence([rows[0], revenue("Fees", 0.2, "FY2024")], "body")["FIN-08"].length, 0);
  const operation = governmentFinanceFact({ ...common, title: "Operating budget", detailKind: "OPERATING_BUDGET",
    details: { amount: 100, units: "dollars", fundScope: "General", fiscalPeriod: "FY2025", budgetVersion: "v1" } });
  const capital = governmentFinanceFact({ ...common, title: "Capital budget", detailKind: "CAPITAL_BUDGET", details: operation.details });
  const spending = governmentFinanceFact({ ...common, title: "Actual spending", detailKind: "EXPENDITURE", details: operation.details });
  assert.deepEqual([operation.category, spending.category], ["BUDGET", "SPENDING"]);
  assert.equal(governmentFinanceChecklistEvidence([operation, capital, spending], "body")["FIN-06"].length, 2);
  assert.equal(governmentFinanceChecklistEvidence([{ ...operation, sourceSentence: "The proposed budget is version v1." }, capital], "body")["FIN-06"].length, 0);
  assert.equal(governmentFinanceChecklistEvidence([spending], "body")["FIN-10"].length, 0, "unheld payee and category stay blank");
});
