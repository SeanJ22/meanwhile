import type { Sql } from "./pg-store.ts";
import { DOOR_HEADER_FIELDS, doorFieldsSql } from "../../doors/record-fields.ts";

export interface ControlCount { readonly bucket: string; readonly count: number; readonly generation: string; readonly changedAt: string }

/** Exact transactional counters; no source record is read to answer a count. */
export async function controlCounts(sql: Sql, table: string, buckets: readonly string[] = ["*"]): Promise<readonly ControlCount[]> {
  const rows = await sql.query(`SELECT bucket,n::text AS count,generation::text,changed_at FROM cp_control_counts
    WHERE table_name=$1 AND bucket=ANY($2::text[]) ORDER BY bucket`, [table, buckets]) as {bucket:string;count:string;generation:string;changed_at:string}[];
  return rows.map(row => ({bucket:row.bucket,count:Number(row.count),generation:row.generation,changedAt:new Date(row.changed_at).toISOString()}));
}

const validDoor = `r->'formatVersion'='1'::jsonb AND jsonb_typeof(r->'doorId')='string' AND jsonb_typeof(r->'kind')='string'
  AND jsonb_typeof(r->'bodyIds')='array' AND jsonb_typeof(r->'hosts')='array'
  AND r->>'status' IN ('OPEN','SHUT','SUSPENDED') AND jsonb_typeof(r->'updatedAt')='string'`;

export const CONTROL_COUNTS_DDL = [
  `CREATE TABLE IF NOT EXISTS cp_control_counts(table_name text NOT NULL,bucket text NOT NULL,n bigint NOT NULL,
    generation bigint NOT NULL DEFAULT 0,changed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(table_name,bucket))`,
  `CREATE OR REPLACE FUNCTION cp_door_count_bucket(r jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN (${validDoor}) IS TRUE THEN r->>'status' ELSE 'UNREADABLE' END $$`,
  `CREATE OR REPLACE FUNCTION cp_touch_control_counts() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE old_bucket text; new_bucket text; delta integer;
  BEGIN
    delta := CASE WHEN TG_OP='INSERT' THEN 1 WHEN TG_OP='DELETE' THEN -1 ELSE 0 END;
    INSERT INTO cp_control_counts(table_name,bucket,n,generation,changed_at) VALUES(TG_TABLE_NAME,'*',delta,1,clock_timestamp())
      ON CONFLICT(table_name,bucket) DO UPDATE SET n=cp_control_counts.n+delta,generation=cp_control_counts.generation+1,changed_at=excluded.changed_at;
    IF TG_TABLE_NAME='cp_doors' THEN
      IF TG_OP<>'INSERT' THEN old_bucket:=cp_door_count_bucket(${doorFieldsSql("OLD.value", DOOR_HEADER_FIELDS)}); END IF;
      IF TG_OP<>'DELETE' THEN new_bucket:=cp_door_count_bucket(${doorFieldsSql("NEW.value", DOOR_HEADER_FIELDS)}); END IF;
      IF old_bucket IS DISTINCT FROM new_bucket THEN
        IF old_bucket IS NOT NULL THEN INSERT INTO cp_control_counts(table_name,bucket,n,generation) VALUES(TG_TABLE_NAME,old_bucket,-1,1)
          ON CONFLICT(table_name,bucket) DO UPDATE SET n=cp_control_counts.n-1,generation=cp_control_counts.generation+1,changed_at=clock_timestamp(); END IF;
        IF new_bucket IS NOT NULL THEN INSERT INTO cp_control_counts(table_name,bucket,n,generation) VALUES(TG_TABLE_NAME,new_bucket,1,1)
          ON CONFLICT(table_name,bucket) DO UPDATE SET n=cp_control_counts.n+1,generation=cp_control_counts.generation+1,changed_at=clock_timestamp(); END IF;
      END IF;
    END IF;
    RETURN coalesce(NEW,OLD);
  END $$`,
] as const;

export const CONTROL_COUNT_TABLES = ["cp_doors", "cp_obligations", "cp_leases", "cp_log_artifacts", "cp_work_items", "cp_route_tasks", "cp_attempts", "cp_occurrences", "cp_debts"] as const;

/** A single transaction attaches counters while the initial stock is stable. */
export const CONTROL_COUNTS_INITIALIZE_DDL = `DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY[${CONTROL_COUNT_TABLES.map(table => `'${table}'`).join(",")}] LOOP
    IF NOT EXISTS(SELECT 1 FROM cp_control_counts WHERE table_name=t AND bucket='*') THEN
      EXECUTE format('LOCK TABLE %I IN SHARE ROW EXCLUSIVE MODE',t);
      EXECUTE format('INSERT INTO cp_control_counts(table_name,bucket,n) SELECT %L,''*'',count(*) FROM %I ON CONFLICT DO NOTHING',t,t);
      IF t='cp_doors' THEN
        INSERT INTO cp_control_counts(table_name,bucket,n)
          SELECT 'cp_doors',cp_door_count_bucket(${doorFieldsSql("value", DOOR_HEADER_FIELDS)}),count(*) FROM cp_doors
          GROUP BY cp_door_count_bucket(${doorFieldsSql("value", DOOR_HEADER_FIELDS)}) ON CONFLICT DO NOTHING;
        INSERT INTO cp_control_counts(table_name,bucket,n)
          SELECT 'cp_doors',bucket,0 FROM unnest(ARRAY['OPEN','SHUT','SUSPENDED','UNREADABLE']) bucket ON CONFLICT DO NOTHING;
      END IF;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='a_cp_control_counts' AND tgrelid=to_regclass(t)) THEN
      EXECUTE format('CREATE TRIGGER a_cp_control_counts AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION cp_touch_control_counts()',t);
    END IF;
  END LOOP;
END $$`;
