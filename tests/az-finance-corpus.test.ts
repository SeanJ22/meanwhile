import assert from "node:assert/strict";
import test from "node:test";
import { collectAzFinance } from "../scripts/state-money-az.mts";
import type { StateFinanceIO } from "../scripts/lib/state-money-runner.mts";
import { readFileSync } from "node:fs";
import type { SummaryRow } from "../lib/sources/az-seethemoney/index.ts";
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
