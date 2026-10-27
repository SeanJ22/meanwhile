import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";

/** The actual keyed projection migration, beside the same payload decoder used in production. */
export async function installKeyedRows(pg: Pick<PGlite, "query" | "exec">): Promise<void> {
  if ((await pg.query("SELECT to_regclass('civic_data_candidates') AS table_name")).rows[0]?.table_name) {
    await pg.exec("ALTER TABLE civic_data_candidates ADD COLUMN IF NOT EXISTS read_model_fingerprint text; ALTER TABLE civic_data_promotions ADD COLUMN IF NOT EXISTS payload_fingerprint text");
  }
  await pg.exec("CREATE TABLE IF NOT EXISTS civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb)");
  const exists = (await pg.query("SELECT to_regprocedure('reader_payload_node(jsonb)') AS decoder")).rows[0] as { decoder: unknown };
  if (!exists.decoder) {
    for (const statement of readFileSync(new URL("../../lib/db/migrations/0036_ne01.sql", import.meta.url), "utf8").split("--> statement-breakpoint"))
      if (/CREATE FUNCTION reader_payload_(?:node|value|members)\(/.test(statement)) await pg.exec(statement);
  }
  await pg.exec(readFileSync(new URL("../../lib/db/migrations/DB-05_keyed_rows.sql", import.meta.url), "utf8").replaceAll("--> statement-breakpoint", ""));
}
