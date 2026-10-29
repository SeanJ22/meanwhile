import { MODEL_CHARGE_KIND_DDL } from "../model-charges.ts";
import type { Sql } from "../pg-store.ts";

export const workKindMigrationDefinition = (): string => JSON.stringify({ statements: MODEL_CHARGE_KIND_DDL });

/** Expand: each model charge can name the work row its hunt ran from. Older charges keep it empty. */
export async function addChargeWorkKind(sql: Sql): Promise<string> {
  for (const statement of MODEL_CHARGE_KIND_DDL) await sql.query(statement);
  return "charges can name the work row they ran from";
}
