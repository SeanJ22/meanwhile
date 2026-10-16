import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { FactDb, Query } from "../../lib/facts/publish.ts";

const MIGRATIONS = ["0035_r1_fact_store.sql", "0037_r1_fact_scale.sql", "R3-LEGISTAR-MEMBERS.sql"].map(file => join(import.meta.dirname, "..", "..", "lib", "db", "migrations", file));

/** A real Postgres with the fact store migration applied. */
export async function factDb(): Promise<FactDb & { readonly query: Query; readonly pg: PGlite }> {
  const pg = new PGlite();
  for (const migration of MIGRATIONS) for (const statement of readFileSync(migration, "utf8").split("--> statement-breakpoint")) await pg.exec(statement);
  const query: Query = async (text, params = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows;
  return {
    pg, query,
    transaction: (work) => pg.transaction((tx) => work(async (text, params = []) => (await tx.query<Record<string, unknown>>(text, [...params])).rows)),
  };
}
