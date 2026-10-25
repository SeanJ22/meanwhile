import { readFileSync } from "node:fs";
import type { Sql } from "../pg-store.ts";

export const WORK_MIGRATION_SOURCE = "lib/control-plane/repository/migrations/RB-A5.sql";

export function workMigrationDefinition(): string {
  return readFileSync(new URL("./RB-A5.sql", import.meta.url), "utf8");
}

export async function expandWorkList(sql: Sql): Promise<string> {
  await sql.query("BEGIN");
  try {
    for (const statement of workMigrationDefinition().split("--> statement-breakpoint")) await sql.query(statement);
    await sql.query("COMMIT");
  } catch (error) { await sql.query("ROLLBACK"); throw error; }
  return "leased work and hourly counts";
}
