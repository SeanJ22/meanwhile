import { LEAD_DDL } from "../../../core/work.ts";
import type { Sql } from "../pg-store.ts";

export const leadClaimMigrationDefinition = (): string => JSON.stringify({ statements: LEAD_DDL });

/** Expand: each kind of website's links can be claimed in tier order, newest first, without walking the other kinds' links. */
export async function addLeadClaimIndex(sql: Sql): Promise<string> {
  for (const statement of LEAD_DDL) await sql.query(statement);
  return "links can be claimed by kind of website";
}
