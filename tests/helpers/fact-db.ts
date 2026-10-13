import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { FactDb, Query } from "../../lib/facts/publish.ts";

const MIGRATION = join(import.meta.dirname, "..", "..", "lib", "db", "migrations", "R1_fact_store.sql");

/** A real Postgres with the fact store migration applied. */
export async function factDb(): Promise<FactDb & { readonly query: Query; readonly pg: PGlite }> {
  const pg = new PGlite();
  for (const statement of readFileSync(MIGRATION, "utf8").split("--> statement-breakpoint")) await pg.exec(statement);
  const query: Query = async (text, params = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows;
  return {
    pg, query,
    transaction: (work) => pg.transaction((tx) => work(async (text, params = []) => (await tx.query<Record<string, unknown>>(text, [...params])).rows)),
  };
}
