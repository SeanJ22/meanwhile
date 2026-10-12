/** Arizona official cycle summary amounts, independently of ballot or optional ledgers. */
import { AGENCY, BASE, HEADERS, SUMMARY_COLUMNS, SUMMARY_PATH, aggregateEntities, dataTablesBody,
  parseTableResponse, summaryQuery, universeQueries, type SummaryRow } from "../lib/sources/az-seethemoney/index.ts";
import { nativeStateMoneyRecord } from "../lib/funding/state-native.ts";
import { runStateFinance, type StateFinanceIO, type StateFinanceCollected } from "./lib/state-money-runner.mts";
import type { StateMoneyRecord } from "../lib/funding/state-money.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";

export async function collectAzFinance(io: StateFinanceIO): Promise<StateFinanceCollected> {
  // The publisher's cycle is a two-year Jan–Dec window. Every query and record
  // carries that actual requested interval; a prior cycle keeps its own date.
  const cycle = Math.ceil(io.year / 2) * 2, records: StateMoneyRecord[] = [];
  const completeEntities = new Map<number, { rows: SummaryRow[]; observedAt: string }>();
  const conflicted = new Set<number>();
  let complete = true, count = 0;
  for (const query of universeQueries(cycle - 1, cycle)) {
    const rows: SummaryRow[] = []; let start = 0, expected: number | null = null, observedAt = "";
    try {
      for (;;) {
        const params = new URLSearchParams(summaryQuery({ ...query, length: 500 })); params.set("TablePage", String(start / 500 + 1));
        const result = await io.read(`${BASE}${SUMMARY_PATH}?${params}`, { headers: HEADERS,
          body: dataTablesBody(SUMMARY_COLUMNS, { start, length: 500 }), validate: raw => { parseTableResponse<SummaryRow>(raw, "Arizona summary"); } });
        const page = parseTableResponse<SummaryRow>(result.text, "Arizona summary");
        const total = Number.isSafeInteger(page.recordsFiltered) ? page.recordsFiltered : page.recordsTotal;
        if (!Number.isSafeInteger(total) || total < 0 || expected !== null && total !== expected) throw new Error("Arizona summary denominator changed");
        expected = total; observedAt = observedAt > result.receipt.sourceObservedAt ? observedAt : result.receipt.sourceObservedAt;
        rows.push(...page.data); start += page.data.length;
        if (start > expected) throw new Error("Arizona summary exceeded denominator");
        if (start === expected) break;
        if (!page.data.length) throw new Error("Arizona summary truncated");
      }
      // A complete filter can supply independent committee totals even when a
      // sibling filter fails. Overlapping filters must agree for the same ID.
      const groups = new Map<number, SummaryRow[]>();
      const partitions = new Set<string>();
      for (const row of rows) {
        const nativeId = row && typeof row === "object" && Number.isSafeInteger(row.EntityID) && row.EntityID > 0;
        const validNames = nativeId && [row.EntityLastName, row.CommitteeName, row.OfficeName, row.PartyName, row.EntityTypeName]
          .every(value => value === null || value === undefined || typeof value === "string");
        const partition = nativeId ? JSON.stringify([row.EntityID, row.OfficeID, row.PartyName]) : "";
        if (!validNames || partitions.has(partition)) {
          complete = false;
          if (nativeId) { conflicted.add(row.EntityID); completeEntities.delete(row.EntityID); }
          io.gaps.push({ code: "AZ_NATIVE_PARTITION_UNRESOLVED", detail: "An invalid or repeated native summary partition was withheld; other committees remain usable." });
          continue;
        }
        partitions.add(partition);
        const list = groups.get(row.EntityID) ?? []; list.push(row); groups.set(row.EntityID, list);
      }
      for (const [id, entityRows] of groups) {
        if (conflicted.has(id)) continue;
        const prior = completeEntities.get(id);
        const normalized = (values: SummaryRow[]) => values.map(row => JSON.stringify([row.OfficeID, row.PartyName, row.Income, row.Expense])).sort().join("\n");
        if (prior && normalized(prior.rows) !== normalized(entityRows)) {
          complete = false; completeEntities.delete(id); conflicted.add(id);
          io.gaps.push({ code: "AZ_SUMMARY_CONFLICT", detail: `Committee ${id} has conflicting official filter rows; previous facts retained.` });
          continue;
        }
        completeEntities.set(id, { rows: entityRows, observedAt });
      }
      count += rows.length;
    } catch {
      complete = false;
      io.gaps.push({ code: "AZ_FILTER_PARTIAL", detail: `Arizona filter ${query.isLessActive}/${query.showOfficeHolder} did not finish; other completed filters remain usable.` });
    }
  }
  for (const [id, acquired] of completeEntities) {
    const entity = aggregateEntities(acquired.rows).get(id);
    if (!entity || !Number.isSafeInteger(id) || id <= 0 || !entity.committeeName || !/^candidate\b/i.test(entity.entityTypeName ?? "")) continue;
    const allNumeric = (field: "Income" | "Expense") => acquired.rows.every(row => typeof row[field] === "number" && Number.isFinite(row[field]));
    const income = allNumeric("Income") ? entity.income : null, spent = allNumeric("Expense") ? entity.expense : null;
    const empty = income === 0 && spent === 0;
    records.push(nativeStateMoneyRecord({ state: "AZ", committeeId: String(id), name: entity.committeeName,
      candidateName: entity.candidateDisplay, office: entity.officeNames.length === 1 ? entity.officeNames[0] : null,
      year: cycle, receipts: empty ? null : income, spent: empty ? null : spent,
      filingState: empty ? "REGISTERED_NO_ACTIVITY_REPORTED" : income !== null || spent !== null ? "FILED" : "ROUTE_UNREAD",
      period: `${cycle - 1}-01-01 through ${cycle}-12-31`, sourceUrl: `${BASE}/Reporting/Explore?Name=1~${id}`,
      agency: AGENCY, observedAt: acquired.observedAt }));
  }
  return { records, complete, period: cycle, query: `Arizona ${cycle - 1}-${cycle} official active/less-active/officeholder filter union; ${count} completed source rows` };
}
if (import.meta.filename === process.argv[1]) {
  if (!process.argv.includes("--promote")) throw new Error("Invoke the registered state-finance adapter with --promote.");
  prepareProductionCivicDataWrite();
  await runStateFinance("AZ", `${BASE}${SUMMARY_PATH}`, collectAzFinance, new PostgresRoutineDataStore());
}
