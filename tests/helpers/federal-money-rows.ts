import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { installKeyedRows } from "./keyed-rows.ts";

/** Actual transactional row projection on the minimal federal lookup fixture. */
export async function installFederalMoneyRows(pg: PGlite): Promise<void> {
  await pg.exec("ALTER TABLE civic_data_promotions ADD COLUMN IF NOT EXISTS current_version_id text DEFAULT 'fixture-version'; ALTER TABLE civic_data_promotions ADD COLUMN IF NOT EXISTS promoted_at timestamptz DEFAULT now()");
  await installKeyedRows(pg);
  await pg.exec(readFileSync(new URL("../../lib/db/migrations/DB-05_federal_money_rows.sql",import.meta.url),"utf8").replaceAll("--> statement-breakpoint",""));
}
