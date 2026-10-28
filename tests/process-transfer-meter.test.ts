import assert from "node:assert/strict";
import test, { after } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { processTransferStatements } from "../lib/db/process-transfer.ts";
import type { NeonBytesHour } from "../lib/db/transfer-by-caller.ts";

const db = new PGlite();
after(() => db.close());
const hour = "2026-10-25T07:00:00.000Z";
const base: NeonBytesHour = { hour, pid: 123, startedMs: 1, client: "runner", requests: 3,
  bytes: { reader: 1000, "control-plane": 0 }, sent: { reader: { requests: 3, bytes: 10 }, "control-plane": { requests: 0, bytes: 0 } },
  reads: { "reader\tchild\tcp_doors": [3, 10, 1000] }, byCaller: {}, processes: ["child#123"] };

async function setup() {
  await db.exec(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
    CREATE TABLE database_transfer_daily(day date,database_name text,client text,requests bigint,request_bytes bigint,response_bytes bigint,
      reads jsonb DEFAULT '{}',updated_at timestamptz DEFAULT now(),PRIMARY KEY(day,database_name,client));
    CREATE TABLE database_transfer_hourly(hour timestamptz,database_name text,requests bigint,request_bytes bigint,response_bytes bigint,
      reads jsonb DEFAULT '{}',PRIMARY KEY(hour,database_name));`);
  await db.exec(readFileSync("lib/db/migrations/DB-03_process_transfer.sql", "utf8").replaceAll("--> statement-breakpoint", ""));
}
async function apply(part: NeonBytesHour) {
  for (const table of ["hourly", "daily"] as const)
    for (const statement of processTransferStatements(part, table)) await db.query(statement.query, [...statement.params]);
}
async function totals() {
  return (await db.query<{ response_bytes: number; requests: number; reads: Record<string, number[]>; processes: unknown }>(
    "SELECT response_bytes::int,requests::int,reads,processes FROM database_transfer_hourly WHERE database_name='reader'")).rows[0];
}

test("the same meter retains legacy bytes and applies cumulative reports once across retries, reordering and collector restarts", async () => {
  await setup();
  await db.query("INSERT INTO database_transfer_hourly VALUES($1,'reader',2,4,100,$2::jsonb,'{}'::jsonb)", [hour, JSON.stringify({ "old\ttable": [2, 4, 100] })]);
  await apply(base); await apply(base);
  assert.equal((await totals()).response_bytes, 1100);
  const newer = { ...base, requests: 4, bytes: { reader: 1500, "control-plane": 0 },
    sent: { ...base.sent!, reader: { requests: 4, bytes: 15 } },
    reads: { ...base.reads, "reader\tchild\tnew_table": [1, 5, 500] as const } };
  await apply(newer); await apply(base); await apply(newer);
  const row = await totals();
  assert.equal(row.response_bytes, 1600); assert.equal(row.requests, 6);
  assert.deepEqual(row.reads, { "old\ttable": [2, 4, 100], "child\tcp_doors": [3, 10, 1000], "child\tnew_table": [1, 5, 500] });
  assert.deepEqual((await db.query("SELECT 1 FROM database_transfer_daily")).rows, [], "the runner's day is rebuilt from its hours, not stored");
  // A reused OS pid names a new process, so both processes' bytes survive.
  await apply({ ...base, startedMs: 2 });
  assert.equal((await totals()).response_bytes, 2600);
});

test("split caller details can arrive after totals without losing or double-counting their bytes", async () => {
  await setup();
  await apply({ ...base, reads: {} });
  await apply(base);
  assert.equal((await totals()).response_bytes, 1000);
  assert.deepEqual((await totals()).reads, { "child\tcp_doors": [3, 10, 1000] });
  await apply({ ...base, bytes: { reader: 900, "control-plane": 0 }, reads: {} });
  await apply(base);
  assert.equal((await totals()).response_bytes, 1000);
});

test("a reader function's daily row applies cumulative reports once and stays apart from its hour", async () => {
  await setup();
  const reader: NeonBytesHour = { ...base, client: "reader", pid: 9, startedMs: 77 };
  await apply(reader); await apply(reader);
  const newer = { ...reader, bytes: { reader: 1500, "control-plane": 0 }, sent: { ...reader.sent!, reader: { requests: 4, bytes: 15 } } };
  await apply(newer); await apply(reader); await apply(newer);
  const daily = (await db.query<{ day: string; client: string; n: number; requests: number }>(
    "SELECT day::text,client,response_bytes::int AS n,requests::int FROM database_transfer_daily")).rows;
  assert.deepEqual(daily, [{ day: "2026-10-25", client: "reader", n: 1500, requests: 4 }]);
  assert.equal((await totals()).response_bytes, 1500);
  for (const statement of processTransferStatements(reader, "hourly")) assert.doesNotMatch(statement.query, /database_transfer_daily/);
});
