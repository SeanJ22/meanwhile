import { WORK_DDL } from "../../../core/work.ts";
import type { Sql } from "../pg-store.ts";

/** Sources of the work table's definition, so the journal hash follows them. */
export const WORK_MIGRATION_DECLARATIONS = ["lib/core/work.ts"] as const;

// The old list's stock is taken out of the hourly counts and the new list's put in, so each row is counted once.
const STOCK_OF = (table: string, index: string, sign: 1 | -1) => `INSERT INTO count_hour(state,hour,step,n)
  SELECT state,effective_at,'v1:'||jsonb_build_array(family,stage,CASE WHEN sum(delta)>0 THEN 'stock in' ELSE 'stock out' END)::text,abs(sum(delta)) FROM (
    SELECT d.from_at AS effective_at,d.state,d.family,d.stage,${sign} AS delta FROM ${table} w
      CROSS JOIN LATERAL count_work_segments(${index},'current:'||w.state,statement_timestamp()) d
    UNION ALL SELECT d.until_at,d.state,d.family,d.stage,${-sign} FROM ${table} w
      CROSS JOIN LATERAL count_work_segments(${index},'current:'||w.state,statement_timestamp()) d WHERE d.until_at IS NOT NULL
  ) changes GROUP BY effective_at,state,family,stage HAVING sum(delta)<>0
  ON CONFLICT(state,hour,step) DO UPDATE SET n=count_hour.n+excluded.n`;

const COUNT_WORK_INDEX = `CREATE OR REPLACE FUNCTION count_work_index(w work,at timestamptz) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('allRowsIndex',CASE
    WHEN w.id IS NULL THEN '[]'::jsonb
    WHEN w.status='done' THEN jsonb_build_array(base||jsonb_build_object('state','DONE'))
    WHEN w.status='refused' THEN jsonb_build_array(base||jsonb_build_object('state','REFUSED'))
    WHEN w.status='taken' AND w.lease_until>at THEN jsonb_build_array(
      base||jsonb_build_object('state','LEASED','until',w.lease_until),
      base||jsonb_build_object('state','EXPIRED','from',w.lease_until,'waitingSince',w.lease_until))
    WHEN w.status='taken' THEN jsonb_build_array(base||jsonb_build_object('state','EXPIRED','waitingSince',w.lease_until))
    WHEN w.due_at>at THEN jsonb_build_array(
      base||jsonb_build_object('state','SCHEDULED','until',w.due_at),
      base||jsonb_build_object('state','WAITING','from',w.due_at))
    ELSE jsonb_build_array(base||jsonb_build_object('state','WAITING')) END)
  FROM (SELECT jsonb_build_object('id',w.id,'stateCode',w.state,'family',w.kind,'owner','FLEET','waitingSince',w.due_at) AS base) defaults
$$`;

/** Hourly work-list stock, by state and kind, for the line keeper. */
const COUNT_WORK_STOCK = `CREATE OR REPLACE FUNCTION count_work_stock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND OLD.status='done' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND (OLD.state,OLD.kind,OLD.status,OLD.lease_until,OLD.due_at) IS NOT DISTINCT FROM (NEW.state,NEW.kind,NEW.status,NEW.lease_until,NEW.due_at)
    THEN RETURN NEW; END IF;
  PERFORM count_work_index_change(
    CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE count_work_index(OLD,statement_timestamp()) END,
    CASE WHEN TG_OP='DELETE' THEN '{}'::jsonb ELSE count_work_index(NEW,statement_timestamp()) END,
    'current:'||coalesce(NEW.state,OLD.state),statement_timestamp());
  RETURN coalesce(NEW,OLD);
END $$`;

const COUNT_WORK_LEGISTAR = `CREATE OR REPLACE FUNCTION count_work_legistar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF starts_with(NEW.subject_id,'legistar-members:') THEN
    IF TG_OP='INSERT' THEN PERFORM count_hour_add(NEW.state,'Legistar members','rows in',0,1,0); END IF;
    IF TG_OP='UPDATE' THEN
      IF cardinality(NEW.done_times)>cardinality(OLD.done_times) THEN PERFORM count_hour_add(NEW.state,'Legistar members','done',0,1,1); END IF;
      IF cardinality(NEW.refused_times)>cardinality(OLD.refused_times) THEN PERFORM count_hour_add(NEW.state,'Legistar members','refused',0,1,1); END IF;
      IF NEW.content_version<>OLD.content_version THEN PERFORM count_hour_add(NEW.state,'Legistar members','rows in',0,1,0); END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$`;

/** The waiting piles the line keeper ages, from the new list. Everything else in this function is unchanged from RB-A8. */
const COUNT_OLDEST_WAITING = `CREATE OR REPLACE FUNCTION count_oldest_waiting(at timestamptz) RETURNS TABLE(
  state text,family text,stage text,count bigint,oldest_at timestamptz,owner text
) LANGUAGE sql STABLE AS $$
WITH waiting AS (
 SELECT d.state,d.family,d.stage,d.oldest_at AS since,d.owner,1::bigint AS n
 FROM cp_owner_snapshots s CROSS JOIN LATERAL count_work_segments(s.value,s.id,at) d
 WHERE s.id LIKE 'current:%' AND d.from_at<=at AND d.stage IN ('work list:WAITING','work list:FAILED','work list:BLOCKED','work list:UNKNOWN')
 AND (d.oldest_at IS NULL OR d.oldest_at<=at)
 UNION ALL
 SELECT count_state(w.state::text),w.kind,'work list:WAITING',min(w.due_at),'diggers',count(*) FROM work w
 WHERE w.status='waiting' AND w.due_at<=at GROUP BY w.state,w.kind
 UNION ALL
 SELECT count_state(w.state::text),w.kind,'work list:EXPIRED',min(w.lease_until),'diggers',count(*) FROM work w
 WHERE w.status='taken' AND w.lease_until<=at GROUP BY w.state,w.kind
 UNION ALL
 SELECT count_state(w.state::text),w.kind,'work list:REFUSED',min(w.due_at),'diggers',count(*) FROM work w
 WHERE w.status='refused' GROUP BY w.state,w.kind
 UNION ALL
 SELECT d.state,d.family,d.stage,coalesce(b.value#>>'{origins,0,recordedAt}',b.updated_at::text)::timestamptz,'diggers',1
 FROM cp_box_findings b CROSS JOIN LATERAL count_control_dimensions(b.value,'box') d
 WHERE b.value->>'state' IN ('waiting','taken','refused')
 UNION ALL
 SELECT d.state,d.family,d.stage,
   coalesce(nullif(w.value->>'lastSuccessAt',''),w.value->>'updatedAt',w.updated_at::text)::timestamptz,'diggers',1
 FROM cp_doors w CROSS JOIN LATERAL count_control_dimensions(w.value,'door') d
 WHERE w.value->>'status'='OPEN' AND d.stage='door:OPEN' AND
   coalesce(nullif(w.value->>'lastSuccessAt',''),w.value->>'updatedAt',w.updated_at::text)::timestamptz +
   make_interval(mins=>coalesce(nullif(w.value->>'checkEveryMinutes','')::integer,60)) <= at
)
SELECT state,family,stage,sum(n)::bigint AS count,
 CASE WHEN count(*) FILTER(WHERE since IS NULL)>0 THEN NULL ELSE min(since) END AS oldest_at,
 owner FROM waiting GROUP BY state,family,stage,owner
$$`;

const OLD_INDEX = "count_work_row_index(to_jsonb(w),statement_timestamp())";
const NEW_INDEX = "count_work_index(w,statement_timestamp())";

/** The previous list's rows move across as they stand; a leased row is simply waiting again. */
const COPY_ROWS = `INSERT INTO work (id,kind,tier,priority,state,place_id,subject_id,field,url,sources,reports,value,quote,due_at,attempts,status,refusal,
  content_version,received_at,done_at,done_times,refused_times,origin,series)
SELECT id,CASE kind WHEN 'read' THEN 'lead' WHEN 'audit' THEN 'recheck' ELSE kind END,CASE kind WHEN 'load' THEN 'clock' ELSE 'coverage' END,
  priority,state,place_id,subject_id,field,url,sources,reports,value,quote,not_before,attempts,
  CASE status WHEN 'ready' THEN 'waiting' WHEN 'taken' THEN 'waiting' ELSE status END,refusal,content_version,received_at,
  CASE WHEN status='done' THEN done_times[cardinality(done_times)] END,done_times,refused_times,
  jsonb_build_object('from',CASE kind WHEN 'detect' THEN 'detective' ELSE 'loader' END),CASE kind WHEN 'load' THEN id END
FROM work_row ON CONFLICT DO NOTHING`;

const GRANTS = `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='wtp_cp_release_readonly') THEN
  GRANT SELECT ON work,work_waiting TO wtp_cp_release_readonly;
END IF; END $$`;

/** The Legistar member counts; a test database that has only the hourly counts applies these alone. */
export const LEGISTAR_COUNTS_DDL = [COUNT_WORK_LEGISTAR,
  `CREATE OR REPLACE TRIGGER count_legistar_work AFTER INSERT OR UPDATE ON work FOR EACH ROW EXECUTE FUNCTION count_work_legistar()`] as const;

/** Expand: the new list exists, holds the old list's rows, and is counted. The old list stays for the code still running on it. */
export const WORK_EXPAND = [
  ...WORK_DDL,
  `DROP TRIGGER IF EXISTS count_hour_work_row ON work_row`,
  `DROP TRIGGER IF EXISTS count_legistar_work ON work_row`,
  `DROP TRIGGER IF EXISTS work_row_counts ON work_row`,
  STOCK_OF("work_row", OLD_INDEX, -1),
  `ALTER TABLE work DISABLE TRIGGER work_counts_in`,
  COPY_ROWS,
  `ALTER TABLE work ENABLE TRIGGER work_counts_in`,
  COUNT_WORK_INDEX,
  COUNT_WORK_STOCK,
  STOCK_OF("work", NEW_INDEX, 1),
  `CREATE OR REPLACE TRIGGER count_hour_work AFTER INSERT OR UPDATE OR DELETE ON work FOR EACH ROW EXECUTE FUNCTION count_work_stock()`,
  ...LEGISTAR_COUNTS_DDL,
  COUNT_OLDEST_WAITING,
  GRANTS,
] as const;

/** Contract: once nothing runs on the old list, it and its counting functions go. */
export const WORK_CONTRACT = [
  `DROP TABLE IF EXISTS work_row`,
  `DROP FUNCTION IF EXISTS count_work_transition()`,
  `DROP FUNCTION IF EXISTS count_work_row_write()`,
  `DROP FUNCTION IF EXISTS count_work_row_index(jsonb,timestamptz)`,
  `DROP FUNCTION IF EXISTS count_legistar_work()`,
] as const;

export const oneWorkListDefinition = (): string => JSON.stringify({ statements: WORK_EXPAND });
export const oneWorkListContractDefinition = (): string => JSON.stringify({ statements: WORK_CONTRACT });

async function inTransaction(sql: Sql, lock: string, statements: readonly string[]): Promise<void> {
  await sql.query("BEGIN");
  try {
    // Taken first and held to the end: nothing writes the old list between its copy and its last statement.
    await sql.query(`LOCK TABLE ${lock} IN ACCESS EXCLUSIVE MODE`);
    for (const statement of statements) await sql.query(statement);
    await sql.query("COMMIT");
  } catch (error) { await sql.query("ROLLBACK"); throw error; }
}
export async function expandWork(sql: Sql): Promise<string> {
  await inTransaction(sql, "work_row", WORK_EXPAND);
  return "one work list";
}
export async function contractWork(sql: Sql): Promise<string> {
  await inTransaction(sql, "work_row", WORK_CONTRACT);
  return "the old work list removed";
}
