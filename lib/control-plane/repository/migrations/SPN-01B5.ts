import { ORDER_HUNT_DDL } from "../../../core/work.ts";
import type { Sql } from "../pg-store.ts";

export const orderHuntMigrationDefinition = (): string => JSON.stringify({ statements: ORDER_HUNT_DDL });

/** Expand: the hunts Sean's money points at are found by state without walking the rest of the work list. */
export async function addOrderHuntIndex(sql: Sql): Promise<string> {
  for (const statement of ORDER_HUNT_DDL) await sql.query(statement);
  return "funded hunts can be found by state";
}
