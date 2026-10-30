import { OWNER_LEASE_RENEWAL_DDL } from "../owner-lease-changes.ts";
import type { Sql } from "../pg-store.ts";

export const ownerLiveMigrationDefinition = (): string => OWNER_LEASE_RENEWAL_DDL;
export async function expandOwnerLive(sql: Sql): Promise<string> {
  await sql.query(OWNER_LEASE_RENEWAL_DDL);
  return "live lease renewals keep their small deadline checks";
}

const OWNER_CLOCK_SEED_SQL = `DO $$ BEGIN
  LOCK TABLE cp_owner_assignment_rows,cp_owner_snapshots IN SHARE ROW EXCLUSIVE MODE;
  WITH clocks AS (
    SELECT state_code,sum((value #>> '{part,clocks,active}')::bigint) AS active,
      sum((value #>> '{part,clocks,eligible}')::bigint) AS eligible,
      sum((value #>> '{part,clocks,overdue}')::bigint) AS overdue,
      sum((value #>> '{part,clocks,backoff}')::bigint) AS backoff
    FROM cp_owner_assignment_rows GROUP BY state_code
  ), expected AS (
    SELECT s.id,(s.value #> '{part,assignments,clocks}') || jsonb_build_object(
      'active',coalesce(c.active,0),'eligible',coalesce(c.eligible,0),
      'overdue',coalesce(c.overdue,0),'backoff',coalesce(c.backoff,0)) AS clocks
    FROM cp_owner_snapshots s LEFT JOIN clocks c ON s.id='totals:'||c.state_code
    WHERE s.id LIKE 'totals:%' AND s.value #> '{part,assignments,clocks}' IS NOT NULL
  ) UPDATE cp_owner_snapshots s SET value=jsonb_set(s.value,'{part,assignments,clocks}',e.clocks),
    revision=s.revision+1,updated_at=now() FROM expected e
    WHERE s.id=e.id AND s.value #> '{part,assignments,clocks}' IS DISTINCT FROM e.clocks;
END $$`;
export const ownerLiveContractMigrationDefinition = (): string => OWNER_CLOCK_SEED_SQL;
export async function contractOwnerLive(sql: Sql): Promise<string> {
  await sql.query(OWNER_CLOCK_SEED_SQL);
  return "state clocks reconciled with their normalized assignment contributions";
}
