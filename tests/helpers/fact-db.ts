import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { FactDb, Query } from "../../lib/facts/publish.ts";

const migrationDir = join(import.meta.dirname, "..", "..", "lib", "db", "migrations");
const MIGRATIONS = ["0035_r1_fact_store.sql", "0037_r1_fact_scale.sql", ...["_audit_flags.sql","_audit_flags_target.sql"].map(suffix=>readdirSync(migrationDir).find(file=>file.endsWith(suffix))!)].map(file => join(migrationDir, file));

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

const migration = (suffix: string) => {
  const dir = join(import.meta.dirname, "..", "..", "lib", "db", "migrations");
  return readFileSync(join(dir, readdirSync(dir).find(file => file.endsWith(suffix))!), "utf8");
};

/** The fact store beside the promotion, candidate and confirmation rows the reader edge reads its changes from. */
export async function edgeChangesDb() {
  const facts = await factDb();
  await facts.pg.exec(`CREATE TABLE civic_data_promotions (key text PRIMARY KEY, record_class text NOT NULL, scope text NOT NULL, current_version_id text NOT NULL, promoted_at timestamptz NOT NULL);
    CREATE TABLE civic_data_candidates (id text PRIMARY KEY, record_class text NOT NULL, scope text NOT NULL);
    CREATE TABLE civic_data_candidate_events (candidate_id text NOT NULL, at timestamptz NOT NULL, detail text NOT NULL)`);
  for (const sql of [migration("_r1_edge_changes.sql"), migration("_confirmation_times.sql")]) await facts.pg.exec(sql);
  const promote = async (recordClass: string, scope: string, at: string, versionId = `${recordClass}:${scope}@${at}`) => {
    await facts.query("INSERT INTO civic_data_candidates VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [versionId, recordClass, scope]);
    await facts.query(`INSERT INTO civic_data_promotions VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (key) DO UPDATE SET current_version_id = EXCLUDED.current_version_id, promoted_at = EXCLUDED.promoted_at`, [`${recordClass}:${scope}`, recordClass, scope, versionId, at]);
    return versionId;
  };
  const confirm = (versionId: string, at: string) => facts.query("INSERT INTO civic_data_candidate_events VALUES ($1, $2, $3)", [versionId, at, `UNCHANGED_CONFIRMATION_V1 {}`]);
  return { ...facts, promote, confirm };
}
