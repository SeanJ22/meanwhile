import { LEAD_GOVERNMENT_DDL } from "../../../core/work.ts";
import type { Sql } from "../pg-store.ts";

export const leadGovernmentMigrationDefinition = (): string => JSON.stringify({ statements: LEAD_GOVERNMENT_DDL });

/** Expand: a government's walk can take the links filed under it without walking the other governments' links. */
export async function addLeadGovernmentIndex(sql: Sql): Promise<string> {
  for (const statement of LEAD_GOVERNMENT_DDL) await sql.query(statement);
  return "links can be claimed by government";
}
