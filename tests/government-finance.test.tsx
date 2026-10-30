import assert from "node:assert/strict";
import test from "node:test";
import { governmentFinanceChecklistEvidence, governmentFinanceFact } from "../lib/civic-data/government-finance.ts";

const now = "2026-10-05T22:00:00Z";
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

