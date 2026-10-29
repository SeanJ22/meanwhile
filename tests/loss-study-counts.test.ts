import assert from "node:assert/strict";
import test, { after } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { LOSS_STUDY_COUNTS_DDL, readLossObligationStudies } from "../lib/method/loss-study-counts.ts";
import { absenceReadings, placeTraitsFrom, type ObligationLike } from "../lib/method/loss-readings.ts";
import { lossStudyLessons, studyAllLosses } from "../lib/method/study-all-losses.ts";
import type { Sql } from "../lib/control-plane/repository/pg-store.ts";

const db = new PGlite();
after(async () => { await db.close(); });
const NOW = "2026-10-28T12:00:00.000Z", BEFORE = "2026-10-28T11:00:00.000Z", AFTER = "2026-10-28T13:00:00.000Z";
const place = (state: string, name: string) => `ocd-division/country:us/state:${state}/county:${name}`;
async function fixture() {
  await db.exec(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
    CREATE TABLE cp_obligations (id text PRIMARY KEY, value jsonb NOT NULL);
    CREATE TABLE cp_doors (id text PRIMARY KEY, value jsonb NOT NULL, changed_at timestamptz NOT NULL DEFAULT '2000-01-01');
    CREATE TABLE cp_work_items_history (id text PRIMARY KEY, value jsonb NOT NULL, changed_at timestamptz NOT NULL DEFAULT '2000-01-01');`);
  const values = [
    { recordClass: "MEETING", subjectId: place("az", "a"), lastWorkedAt: BEFORE, absentUntil: AFTER },
    { recordClass: "MEETING", subjectId: place("az", "a"), lastWorkedAt: BEFORE, absentUntil: null },
    { recordClass: "MEETING", subjectId: place("nh", "b"), lastWorkedAt: null, absentUntil: AFTER },
    { recordClass: "MEETING", subjectId: place("az", "c"), lastWorkedAt: BEFORE, absentUntil: null },
    { recordClass: "UNTRIED", subjectId: place("az", "d"), lastWorkedAt: null },
  ];
  const doors = values.slice(0, 4).map((value, index) => ({ kind: index < 3 ? "civicplus" : "legistar", ocdId: value.subjectId, holds: ["meetings"], status: "OPEN" as const, updatedAt: BEFORE }));
  for (const [index, value] of values.entries()) await db.query("INSERT INTO cp_obligations VALUES ($1,$2::jsonb)", [String(index), JSON.stringify({ ...value, autonomousPlan: { huge: "x".repeat(100_000) } })]);
  for (const [index, value] of doors.entries()) await db.query("INSERT INTO cp_doors (id,value) VALUES ($1,$2::jsonb)", [String(index), JSON.stringify(value)]);
  for (const ddl of LOSS_STUDY_COUNTS_DDL) await db.exec(ddl);
  const statements: string[] = [];
  const sql: Sql = { query: async (text, params = []) => { statements.push(text); return (await db.query(text, [...params])).rows; } };
  return { sql, statements, values, doors };
}

test("running obligation counts produce exactly the population lesson without reading obligations", async () => {
  const { sql, statements, values, doors } = await fixture();
  const expected = studyAllLosses(absenceReadings(values, NOW), placeTraitsFrom({ doors, items: [], places: values.map(value => value.subjectId) }), NOW);
  const read = await readLossObligationStudies(sql, null, NOW);
  assert.deepEqual(lossStudyLessons(read.studies, NOW), expected);
  assert.equal(read.studies[0].failures, 2, "several obligations at one place count that place once");
  assert.equal(read.studies[0].works, 1);
  assert.equal(read.failures, absenceReadings(values, NOW).filter(row => row.failed).length, "the summary still counts each source obligation loss");
  assert.equal(read.readings, absenceReadings(values, NOW).length);
  assert.ok(statements.every(statement => !/FROM cp_obligations\b|SELECT (?:\w+\.)?value(?:,|\s+FROM)/.test(statement)), "only count rows and exact trait fields leave Postgres");
  assert.ok(JSON.stringify(read).length < 1000, "large plans add no response bytes");
  for (const ddl of LOSS_STUDY_COUNTS_DDL) await db.exec(ddl);
  assert.deepEqual(lossStudyLessons((await readLossObligationStudies(sql, null, NOW)).studies, NOW), expected, "reapplying setup never adds the population twice");
});

test("updates and deletes adjust counts, and unchanged cohorts are skipped", async () => {
  const { sql, values, doors } = await fixture();
  await db.exec("UPDATE cp_loss_obligation_heads SET changed_at='2000-01-01'");
  assert.deepEqual((await readLossObligationStudies(sql, BEFORE, NOW)).studies, []);
  const next = { ...values[2], lastWorkedAt: NOW, absentUntil: null };
  await db.query("UPDATE cp_obligations SET value=$2::jsonb WHERE id=$1", ["2", JSON.stringify(next)]);
  const read = await readLossObligationStudies(sql, BEFORE, NOW);
  assert.deepEqual(lossStudyLessons(read.studies, NOW), studyAllLosses(absenceReadings(values.map((value, index) => index === 2 ? next : value), NOW), placeTraitsFrom({ doors, items: [], places: [] }), NOW));
  assert.deepEqual(read.studies, [], "the class now has only one failing place");
  await db.query("DELETE FROM cp_obligations WHERE id=$1", ["2"]);
  const remaining = await db.query<{ worked: number; absent: number }>("SELECT worked,absent FROM cp_loss_obligation_counts WHERE place_id=$1", [values[2].subjectId]);
  assert.deepEqual(remaining.rows, [], "deletion leaves no stale contribution");
});

test("an absence expiring across the cursor is reconsidered without an obligation write", async () => {
  const { sql, values, doors } = await fixture();
  await db.exec("UPDATE cp_loss_obligation_heads SET changed_at='2000-01-01'");
  const read = await readLossObligationStudies(sql, BEFORE, "2026-10-28T14:00:00.000Z");
  assert.deepEqual(lossStudyLessons(read.studies, NOW), [], "expired absences count as worked or untried, just like the direct reading");
  const expected = studyAllLosses(absenceReadings(values as ObligationLike[], "2026-10-28T14:00:00.000Z"), placeTraitsFrom({ doors, items: [], places: [] }), NOW);
  assert.deepEqual(lossStudyLessons(read.studies, NOW), expected);
});

test("a removed door invalidates the trait population even when obligations did not change", async () => {
  const { sql } = await fixture();
  await db.exec("UPDATE cp_loss_obligation_heads SET changed_at='2000-01-01'");
  await db.exec("DELETE FROM cp_doors WHERE id='2'");
  const read = await readLossObligationStudies(sql, BEFORE, NOW);
  assert.equal(read.studies.length, 1, "the class is reconsidered after a trait deletion");
  assert.deepEqual(lossStudyLessons(read.studies, NOW), [], "an unknown platform on a failing place cannot claim a shared platform");
});
