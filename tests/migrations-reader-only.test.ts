import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as schema from "../lib/control-plane/repository/pg-schema.ts";
import { declaredPhase } from "../lib/db/migration-phases.ts";

const MIGRATIONS = join(import.meta.dirname, "..", "lib", "db", "migrations");

/** Every table the control-plane bootstrap creates: the aggregate and log tables and each named DDL statement. */
function controlPlaneTables(): Set<string> {
  const tables = new Set<string>();
  const collect = (value: unknown): void => {
    if (typeof value === "string") {
      for (const match of value.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(cp_[a-z0-9_]+)/gi)) tables.add(match[1]!.toLowerCase());
    } else if (Array.isArray(value)) value.forEach(collect);
  };
  Object.values(schema).forEach(collect);
  return tables;
}

const withoutComments = (sql: string): string => sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

test("the control-plane bootstrap's tables are found, so the guard below cannot pass by finding none", () => {
  const tables = controlPlaneTables();
  for (const table of ["cp_field_manual_entries", "cp_budget", "cp_log_artifacts", "cp_spend_holds", "cp_vital_signs"]) assert.ok(tables.has(table), `${table} is created by pg-schema.ts`);
  assert.ok(tables.size > 40, `${tables.size} control-plane tables found`);
});

test("no reader-database migration names a control-plane table", () => {
  const tables = controlPlaneTables();
  const offenders: string[] = [];
  for (const file of readdirSync(MIGRATIONS).filter(name => name.endsWith(".sql")).sort()) {
    if (declaredPhase(file.slice(0, -4))?.database === "control-plane") continue;
    const sql = withoutComments(readFileSync(join(MIGRATIONS, file), "utf8"));
    for (const name of new Set([...sql.matchAll(/\bcp_[a-z0-9_]+/gi)].map(match => match[0].toLowerCase()))) {
      if (tables.has(name) || name.startsWith("cp_")) offenders.push(`${file} references ${name}`);
    }
  }
  assert.deepEqual(offenders, [], "a reader-database migration cannot read or write a control-plane table");
});
