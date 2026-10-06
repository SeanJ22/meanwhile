import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { databaseTransferFetch } from "../lib/db/transfer.ts";
import {
  flushQueryBytes, printQueryBytesWindow, queryCallerTag, recordQueryBytes, resetQueryBytes, startQueryBytesLog,
  stopQueryBytesLog, withQueryCaller,
} from "../lib/db/query-bytes.ts";
import { pgSpendHoldRepository } from "../lib/control-plane/repository/pg-store.ts";
import { VITAL_SIGNS_TABLE_DDL, BOOTSTRAP_DDL, DECLARED_TABLES } from "../lib/control-plane/repository/pg-schema.ts";
import { readVitalSigns, upsertVitalSigns, vitalSignsHour } from "../lib/control-plane/repository/vital-signs.ts";

beforeEach(() => { resetQueryBytes(); stopQueryBytesLog(); });

const answer = (n: number) => async () => new Response("x".repeat(n), { status: 200 });
const withConnection = { headers: { "neon-connection-string": "postgres://test" } };

test("the counter attributes the bytes a query receives to the caller that tagged it", async () => {
  const fetchA = databaseTransferFetch(answer(1000), () => undefined);
  await withQueryCaller("cp_work_items.list @ a.ts:1", () => fetchA("https://db.test", withConnection));
  await withQueryCaller("cp_obligations.list @ b.ts:2", () => fetchA("https://db.test", withConnection));
  await withQueryCaller("cp_work_items.list @ a.ts:1", () => fetchA("https://db.test", withConnection));
  const flush = flushQueryBytes();
  assert.equal(flush.totalBytes, 3000);
  assert.deepEqual(flush.byCaller, [
    { caller: "cp_work_items.list @ a.ts:1", bytes: 2000, queries: 2 },
    { caller: "cp_obligations.list @ b.ts:2", bytes: 1000, queries: 1 },
  ]);
});

test("the bounded runner tags each store call with its table, operation and calling code", async () => {
  const sql = { query: async () => { recordQueryBytes(4096); return []; } };
  const holds = pgSpendHoldRepository(sql as never);
  await holds.liveAll("2026-10-06T00:00:00.000Z");
  const [row] = flushQueryBytes().byCaller;
  assert.ok(row, "bytes were counted");
  assert.match(row.caller, /^cp_spend_holds\.liveAll @ .*query-bytes\.test\.ts:\d+$/, "names the table, the operation and this test as the caller");
  assert.equal(row.bytes, 4096);
});

test("a query that did not come through the bounded runner is keyed by its calling code", () => {
  recordQueryBytes(10);
  const [row] = flushQueryBytes().byCaller;
  assert.match(row!.caller, /^driver @ .*query-bytes\.test\.ts:\d+$/);
});

test("flushing returns the counts and resets them", () => {
  withQueryCaller(queryCallerTag("t.op"), async () => recordQueryBytes(500));
  recordQueryBytes(1);
  assert.equal(flushQueryBytes().totalQueries, 2);
  const again = flushQueryBytes();
  assert.equal(again.totalBytes, 0);
  assert.deepEqual(again.byCaller, []);
});

test("the top twenty callers are kept apart and the rest add up as other", () => {
  for (let i = 0; i < 25; i++) withQueryCaller(`caller${String(i).padStart(2, "0")}`, async () => recordQueryBytes(100 + i));
  const flush = flushQueryBytes();
  assert.equal(flush.byCaller.length, 21);
  assert.equal(flush.byCaller[0]!.caller, "caller24");
  const other = flush.byCaller[20]!;
  assert.equal(other.caller, "other");
  assert.equal(other.queries, 5);
  assert.equal(other.bytes, 100 + 101 + 102 + 103 + 104);
});

test("the ten-minute line names the top caller first, one line each, and starts only when asked", () => {
  assert.equal(startQueryBytesLog({}, () => undefined), false, "off unless WTP_QUERY_BYTES_LOG=1");
  withQueryCaller("small.op @ s.ts:1", async () => recordQueryBytes(1_000));
  withQueryCaller("big.op @ big.ts:9", async () => recordQueryBytes(9_000_000));
  const lines: string[] = [];
  printQueryBytesWindow(line => lines.push(line));
  assert.equal(lines.length, 3);
  assert.match(lines[0]!, /total 9\.00 MB in 2 queries/);
  assert.match(lines[1]!, /9\.00 MB 1q big\.op @ big\.ts:9/);
  const more: string[] = [];
  printQueryBytesWindow(line => more.push(line));
  assert.deepEqual(more, [], "the window resets after printing");
  assert.equal(flushQueryBytes().totalBytes, 9_001_000, "printing does not disturb the hour's counts");
});

test("the timer prints on its interval when WTP_QUERY_BYTES_LOG=1", async () => {
  const lines: string[] = [];
  assert.equal(startQueryBytesLog({ WTP_QUERY_BYTES_LOG: "1" }, line => lines.push(line), 20), true);
  withQueryCaller("x.op @ x.ts:1", async () => recordQueryBytes(2_000_000));
  await new Promise(resolve => setTimeout(resolve, 80));
  stopQueryBytesLog();
  assert.ok(lines.some(line => line.includes("x.op @ x.ts:1")));
});

test("cp_vital_signs is in the bootstrap and the declared tables, one row per hour", () => {
  assert.ok(BOOTSTRAP_DDL.includes(VITAL_SIGNS_TABLE_DDL));
  assert.ok(DECLARED_TABLES.includes("cp_vital_signs"));
  assert.match(VITAL_SIGNS_TABLE_DDL, /hour\s+timestamptz PRIMARY KEY/);
  for (const column of ["facts_live", "neon_bytes_read", "neon_bytes_by_caller", "paid_jobs_ended_empty", "release_sha", "neon_project_bytes"]) {
    assert.ok(VITAL_SIGNS_TABLE_DDL.includes(column), column);
  }
});

/** A one-table stand-in that applies the two statements the way Postgres does: insert, or set only the named columns. */
function fakeVitalSignsTable() {
  const table = new Map<string, Record<string, unknown>>();
  const statements: string[] = [];
  return {
    table, statements,
    query: async (text: string, params: readonly unknown[] = []) => {
      statements.push(text);
      if (text.startsWith("INSERT INTO cp_vital_signs")) {
        const columns = /\(hour((?:, \w+)*)\)/.exec(text)![1]!.split(", ").filter(Boolean);
        const prior = table.get(params[0] as string) ?? { hour: params[0] };
        columns.forEach((c, i) => { prior[c] = c === "neon_bytes_by_caller" ? JSON.parse(params[i + 1] as string) : params[i + 1]; });
        prior.written_at = "2026-10-06T08:30:00.000Z";
        table.set(params[0] as string, prior);
        return [];
      }
      return [...table.values()].sort((a, b) => String(b.hour).localeCompare(String(a.hour))).slice(0, Number(params[0]));
    },
  };
}

test("one vital-signs row round-trips, and a second writer's columns do not overwrite the first's", async () => {
  const sql = fakeVitalSignsTable();
  const hour = vitalSignsHour("2026-10-06T07:43:12.000Z");
  assert.equal(hour, "2026-10-06T07:00:00.000Z");
  withQueryCaller("cp_work_items.list @ a.ts:1", async () => recordQueryBytes(1234));
  const flush = flushQueryBytes();
  await upsertVitalSigns(sql, hour, { neonBytesRead: flush.totalBytes, neonBytesByCaller: flush.byCaller, releaseSha: "abc1234" });
  await upsertVitalSigns(sql, hour, { factsLive: 12, spendUsd: 3.5 });
  const [row, none] = [...await readVitalSigns(sql, 24), undefined];
  assert.equal(none, undefined);
  assert.equal(row!.hour, hour);
  assert.equal(row!.neonBytesRead, 1234);
  assert.deepEqual(row!.neonBytesByCaller, [{ caller: "cp_work_items.list @ a.ts:1", bytes: 1234, queries: 1 }]);
  assert.equal(row!.factsLive, 12);
  assert.equal(row!.spendUsd, 3.5);
  assert.equal(row!.releaseSha, "abc1234");
  assert.equal(row!.costPerFactUsd, null, "a number nobody recorded stays null, shown as a dash");
  assert.ok(sql.statements.every(s => !/\bFROM cp_vital_signs\b(?![\s\S]*LIMIT)/.test(s)), "never an unbounded read");
});
