import type { Sql } from "../pg-store.ts";

/** Place and subject ids refer to the reader database, so they cannot have cross-database foreign keys. */
export const SHARED_WORK_DDL = [
  `CREATE TABLE IF NOT EXISTS work_row (
    id text PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('read','check','load','hunt','detect','audit')),
    state char(2) NOT NULL,
    place_id text,
    subject_id text,
    url text,
    sources jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sources)='array'),
    priority integer NOT NULL DEFAULT 0,
    not_before timestamptz NOT NULL DEFAULT now(),
    lease_until timestamptz,
    lease_owner text,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
    refusal text,
    CHECK ((lease_until IS NULL) = (lease_owner IS NULL))
  )`,
  `CREATE INDEX IF NOT EXISTS work_row_ready ON work_row (state,priority DESC,not_before,id)
    WHERE lease_until IS NULL AND refusal IS NULL`,
  `CREATE TABLE IF NOT EXISTS count_hour (
    state char(2) NOT NULL,
    hour timestamptz NOT NULL,
    step text NOT NULL,
    n bigint NOT NULL DEFAULT 0 CHECK (n>=0),
    PRIMARY KEY (state,hour,step)
  )`,
] as const;

export function sharedWorkMigrationDefinition(): string { return JSON.stringify({ statements: SHARED_WORK_DDL }); }
export async function expandSharedWork(sql: Sql): Promise<void> {
  await sql.query("BEGIN");
  try {
    for (const statement of SHARED_WORK_DDL) await sql.query(statement);
    await sql.query("COMMIT");
  } catch (error) { await sql.query("ROLLBACK"); throw error; }
}
