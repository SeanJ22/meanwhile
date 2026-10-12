import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { PgDialect } from "drizzle-orm/pg-core";
import { writeAlarm } from "../lib/db/schema.ts";
import { declaredPhase, phaseFromSql } from "../lib/db/migration-phases.ts";
import { planMigrationNumbers } from "../scripts/river.mjs";

const tag = "STEP3_write_alarm_stores";
const sql = readFileSync(`lib/db/migrations/${tag}.sql`, "utf8");
const stores = ["search_log", "reactions", "speak_your_mind", "demand_signals", "ask_interactions"];

test("the new alarm migration and current schema accept the same five stores without rewriting old SQL", () => {
  const check = getTableConfig(writeAlarm).checks.find(item => item.name === "write_alarm_store_known")!;
  const schemaSql = new PgDialect().sqlToQuery(check.value).sql;
  const values = (text: string) => [...text.matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(values(sql), stores);
  assert.deepEqual(values(schemaSql), stores);
  const original = readFileSync("lib/db/migrations/0015_fast_mojo.sql", "utf8");
  assert.deepEqual(values(original), ["search_log", "reactions"]);
  assert.equal(phaseFromSql(sql).phase, "expand");
  assert.equal(declaredPhase(tag)?.phase, "expand");
});

test("only the exact compatible widening gets expand ordering", () => {
  for (const changed of [sql.replace("'reactions', ", ""), sql.replace('"write_alarm"', '"other_store"'),
    sql.replace("'ask_interactions'", "'anything_else'"), `${sql}\n--> statement-breakpoint\nDROP TABLE \"write_alarm\";`]) {
    assert.equal(phaseFromSql(changed).phase, "contract");
  }
});

test("River can number the step-named proposal without changing any established journal entry", () => {
  const journal = JSON.parse(readFileSync("lib/db/migrations/meta/_journal.json", "utf8")).entries;
  const base = journal.filter((entry: { tag: string }) => entry.tag !== tag);
  const numbered = planMigrationNumbers({ added: [`${tag}.sql`], journal, baseCount: base.length });
  assert.equal(numbered.ok, true, JSON.stringify(numbered));
  assert.deepEqual(numbered.journal.slice(0, base.length), base);
  assert.equal(numbered.renames.length, 1);
  assert.equal(numbered.renames[0].idx, base.length);
  assert.match(numbered.renames[0].to, /^\d{4}_step3_write_alarm_stores\.sql$/);
});
