import { WORK_RUN_DDL } from "../../../core/work.ts";
import type { Sql } from "../pg-store.ts";

export const workRunMigrationDefinition = (): string => JSON.stringify({ statements: WORK_RUN_DDL });

/** Expand: a work row can keep the work item, task, lease and attempts of the hunt it ran. Existing rows start empty. */
export async function addWorkRun(sql: Sql): Promise<string> {
  for (const statement of WORK_RUN_DDL) await sql.query(statement);
  return "work rows can keep their hunt";
}
