import type { Sql } from "../pg-store.ts";

export const JOB_BREAKER_DDL = `CREATE TABLE IF NOT EXISTS cp_job_transfer_breaker (
  id text PRIMARY KEY,
  checked_at timestamptz NOT NULL,
  hour timestamptz NOT NULL,
  action text NOT NULL CHECK (action IN ('PAUSE','RESUME','CHECK')),
  job text,
  gb numeric NOT NULL,
  top_table text,
  bytes_per_request numeric,
  state jsonb,
  detail jsonb NOT NULL,
  CHECK ((action='CHECK') = (job IS NULL))
);
CREATE INDEX IF NOT EXISTS cp_job_transfer_breaker_latest
  ON cp_job_transfer_breaker(job,checked_at DESC,id DESC) WHERE action IN ('PAUSE','RESUME');
CREATE INDEX IF NOT EXISTS cp_job_transfer_breaker_checks ON cp_job_transfer_breaker(checked_at DESC);`;
export const jobBreakerMigrationDefinition = () => JOB_BREAKER_DDL;
export async function installJobBreaker(sql: Sql): Promise<string> {
  for (const statement of JOB_BREAKER_DDL.split(";").map(part=>part.trim()).filter(Boolean)) await sql.query(statement);
  return "job transfer breaker control log";
}
