import type { Sql } from "../pg-store.ts";
import { BOOTSTRAP_VERSION, CONTROL_READS_EXPAND_DDL } from "../pg-schema.ts";

export const CP01_DECLARATION_SOURCES = [
  "lib/control-plane/repository/pg-schema.ts", "lib/control-plane/repository/admin-config.ts",
  "lib/control-plane/repository/model-charges.ts", "lib/control-plane/repository/dispatch-state.ts",
  "lib/control-plane/repository/control-reads-backfill.ts", "lib/method/fix-map.ts",
  "lib/control-plane/hunt-orders.ts", "lib/control-plane/scheduler/state-planning.ts",
] as const;

export function controlReadsMigrationDefinition(): string {
  return JSON.stringify({ statements: CONTROL_READS_EXPAND_DDL, version: BOOTSTRAP_VERSION });
}

export async function expandControlReads(sql: Sql): Promise<void> {
  for (const statement of CONTROL_READS_EXPAND_DDL) await sql.query(statement);
  await sql.query(`INSERT INTO cp_schema_version(singleton,version,applied_at) VALUES (true,$1,now())
    ON CONFLICT(singleton) DO UPDATE SET version=EXCLUDED.version,applied_at=EXCLUDED.applied_at`,[BOOTSTRAP_VERSION]);
}
