import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { FactDb, Query } from "../../lib/facts/publish.ts";
import { readerIdentityMigration } from "./reader-identity-db.ts";

const MIGRATIONS = ["0035_r1_fact_store.sql", "0037_r1_fact_scale.sql", "0044_rs01_retire_copies.sql", "0048_r3_legistar_members.sql", "0049_r3_legistar_members_retire_index.sql", "0046_ck01_audit_flags.sql", "0047_ck01_flag_target.sql", "RB-A3_expand.sql"].map(file => join(import.meta.dirname, "..", "..", "lib", "db", "migrations", file));
/** The retirement migration also edits meeting tables this store does not have; only its fact trigger and queue drop apply here. */
const factStatement = (migration: string, statement: string) => !migration.includes("0044_") || /fact_changed|rebuild_queue/.test(statement);

// Reuse the WASM engine, not the database: repeated engine teardown can crash V8's JIT allocator.
const engines = new Set<PGlite>();
const idle: PGlite[] = [];
if (process.env.NODE_TEST_CONTEXT) after(async () => { for (const pg of engines) await pg.close(); });

function leasedEngine(): PGlite {
  const engine = idle.pop() ?? new PGlite();
  engines.add(engine);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await engine.exec("DISCARD ALL");
    const { rows } = await engine.query<{ nspname: string }>("SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema') AND nspname NOT LIKE 'pg_%'");
    for (const { nspname } of rows) await engine.exec(`DROP SCHEMA "${nspname.replaceAll('"', '""')}" CASCADE`);
    // Rebind the path to the recreated namespace; PGlite otherwise retains its old namespace OID.
    await engine.exec("CREATE SCHEMA public; SET search_path TO public");
    idle.push(engine);
  };
  return new Proxy(engine, {
    get(target, key) {
      if (key === "close" || key === Symbol.asyncDispose) return close;
      if (key === "closed") return closed;
      if (key === "ready") return !closed && target.ready;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? (...args: unknown[]) => {
        if (closed) throw new Error("The fact database fixture is closed");
        return Reflect.apply(value, target, args);
      } : value;
    },
  });
}

/** A real Postgres with the fact store migration applied. */
export async function factDb(options: { readonly withResolver?: boolean } = {}): Promise<FactDb & { readonly query: Query; readonly pg: PGlite }> {
  const pg = process.env.NODE_TEST_CONTEXT ? leasedEngine() : new PGlite();
  for (const migration of MIGRATIONS) for (const statement of readFileSync(migration, "utf8").split("--> statement-breakpoint")) if (factStatement(migration, statement)) await pg.exec(statement);
  // Standalone fact-store tests need the real resolver, without the unrelated event-reconciliation tables.
  if (options.withResolver !== false) {
    const resolve = readerIdentityMigration().split("--> statement-breakpoint").find(statement => /CREATE FUNCTION reader_resolve_id\(/.test(statement));
    await pg.exec(resolve!);
  }
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
