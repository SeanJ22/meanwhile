import { readFileSync, readdirSync } from "node:fs";
import type { Sql } from "../pg-store.ts";

const migrationDirectory=new URL("../../../db/migrations/",import.meta.url);
const sharedMarker="-- RB-A8 shared schema ends here.";
const schemaName=readdirSync(migrationDirectory).find(name=>name.endsWith(".sql")&&readFileSync(new URL(name,migrationDirectory),"utf8").includes(sharedMarker));
if(!schemaName)throw Error("The hourly count schema is missing");
// River numbers the reader migration; the shared definition and its hash survive that rename.
export const COUNT_SCHEMA_SOURCE = `lib/db/migrations/${schemaName}`;
export const CONTROL_COUNT_SQL = `
CREATE FUNCTION count_control_dimensions(v jsonb,kind text) RETURNS TABLE(state text,family text,stage text) LANGUAGE sql IMMUTABLE AS $$
  SELECT count_state(CASE WHEN cp_control_state(v)<>'system' THEN cp_control_state(v) ELSE coalesce(v#>>'{config,scope}',v#>>'{config,ocdId}',v#>>'{autonomousPlan,jurisdiction}',v->>'subject',v->>'subjectId',v->>'doorId',v->>'id') END),
    coalesce(nullif(family_name,''),v#>>'{fact,recordClass}',v#>>'{autonomousPlan,contract,recordClass}',v#>>'{autonomousPlan,publication,recordClass}',v->>'kind','Other facts'),
    kind||':'||coalesce(v->>'state',v->>'status','unknown')
  FROM jsonb_array_elements_text(CASE WHEN kind='door' AND jsonb_array_length(coalesce(v->'holds','[]'::jsonb))>0
    THEN v->'holds' ELSE '[null]'::jsonb END) f(family_name)
$$;
CREATE FUNCTION count_control_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d record; kind text:=TG_ARGV[0]; before_key jsonb; after_key jsonb;
BEGIN
  IF TG_OP='UPDATE' AND OLD.value IS NOT DISTINCT FROM NEW.value THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.state,x.family,x.stage) INTO before_key FROM count_control_dimensions(OLD.value,kind) x;
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.state,x.family,x.stage) INTO after_key FROM count_control_dimensions(NEW.value,kind) x;
    IF before_key IS NOT DISTINCT FROM after_key THEN
      FOR d IN SELECT * FROM count_control_dimensions(NEW.value,kind) LOOP
        PERFORM count_hour_add(d.state,d.family,d.stage,0,0,
          CASE WHEN kind='door' AND NEW.value->>'lastSuccessAt' IS DISTINCT FROM OLD.value->>'lastSuccessAt' THEN 1 ELSE 0 END,1);
      END LOOP;
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    FOR d IN SELECT * FROM count_control_dimensions(OLD.value,kind) LOOP
      PERFORM count_hour_add(d.state,d.family,d.stage,-1,0,1);
    END LOOP;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    FOR d IN SELECT * FROM count_control_dimensions(NEW.value,kind) LOOP
      PERFORM count_hour_add(d.state,d.family,d.stage,1,1,0);
    END LOOP;
  END IF;
  RETURN coalesce(NEW,OLD);
END $$;
CREATE FUNCTION cp_retire_line_inventory() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.id='line-keeper:current' THEN RETURN OLD; END IF;
  RAISE EXCEPTION '% on % is refused: only the retired line-keeper inventory may be deleted',TG_OP,TG_TABLE_NAME
    USING ERRCODE='restrict_violation';
END $$;
CREATE OR REPLACE TRIGGER cp_owner_snapshots_no_rewrite BEFORE DELETE ON cp_owner_snapshots
  FOR EACH ROW EXECUTE FUNCTION cp_retire_line_inventory();
CREATE FUNCTION count_work_segments(v jsonb,scope text,at timestamptz) RETURNS TABLE(
  id text,state text,family text,stage text,from_at timestamptz,until_at timestamptz,oldest_at timestamptz,owner text
) LANGUAGE sql STABLE AS $$
  SELECT r->>'id',count_state(coalesce(r->>'stateCode',substring(scope FROM '^current:(.+)$'))),
    coalesce(r->>'family',r->>'lane','Other work'),'work list:'||coalesce(r->>'state','UNKNOWN'),
    greatest(coalesce((r->>'from')::timestamptz,at),at),(r->>'until')::timestamptz,
    greatest((r->>'waitingSince')::timestamptz,(r->>'eligibleAt')::timestamptz),
    CASE r->>'owner' WHEN 'OWNER' THEN 'Sean' WHEN 'FLEET' THEN 'diggers' ELSE 'the runner' END
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v->'allRowsIndex')='array' THEN v->'allRowsIndex' ELSE '[]'::jsonb END) r
  WHERE r->>'until' IS NULL OR (r->>'until')::timestamptz > at
$$;
CREATE FUNCTION count_work_list_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE at timestamptz:=statement_timestamp();
BEGIN
  IF NEW.id NOT LIKE 'current:%' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.value->'allRowsIndex' IS NOT DISTINCT FROM NEW.value->'allRowsIndex' THEN RETURN NEW; END IF;
  END IF;
  INSERT INTO count_hour(hour,state,family,stage,delta)
  SELECT effective_at,state,family,stage,sum(delta) FROM (
    SELECT d.from_at AS effective_at,d.state,d.family,d.stage,1 AS delta FROM count_work_segments(NEW.value,NEW.id,at) d
    UNION ALL SELECT d.until_at,d.state,d.family,d.stage,-1 FROM count_work_segments(NEW.value,NEW.id,at) d WHERE d.until_at IS NOT NULL
    UNION ALL SELECT d.from_at,d.state,d.family,d.stage,-1 FROM count_work_segments(CASE WHEN TG_OP='UPDATE' THEN OLD.value ELSE '{}'::jsonb END,NEW.id,at) d
    UNION ALL SELECT d.until_at,d.state,d.family,d.stage,1 FROM count_work_segments(CASE WHEN TG_OP='UPDATE' THEN OLD.value ELSE '{}'::jsonb END,NEW.id,at) d WHERE d.until_at IS NOT NULL
  ) changes GROUP BY effective_at,state,family,stage HAVING sum(delta)<>0
  ON CONFLICT(hour,state,family,stage) DO UPDATE SET delta=count_hour.delta+excluded.delta;
  WITH before_rows AS MATERIALIZED (
    SELECT * FROM count_work_segments(CASE WHEN TG_OP='UPDATE' THEN OLD.value ELSE '{}'::jsonb END,NEW.id,at) WHERE from_at<=at
  ), after_rows AS MATERIALIZED (
    SELECT * FROM count_work_segments(NEW.value,NEW.id,at) WHERE from_at<=at
  ), movement AS (
    SELECT b.state,b.family,b.stage,0 AS n_in,1 AS n_out FROM before_rows b LEFT JOIN after_rows a
      ON (b.id,b.state,b.family,b.stage)=(a.id,a.state,a.family,a.stage) WHERE a.id IS NULL
    UNION ALL SELECT a.state,a.family,a.stage,1,0 FROM after_rows a LEFT JOIN before_rows b
      ON (b.id,b.state,b.family,b.stage)=(a.id,a.state,a.family,a.stage) WHERE b.id IS NULL
  ) INSERT INTO count_hour(hour,state,family,stage,delta,incoming,outgoing)
    SELECT date_trunc('hour',at),state,family,stage,0,sum(n_in),sum(n_out) FROM movement GROUP BY state,family,stage
    ON CONFLICT(hour,state,family,stage) DO UPDATE SET incoming=count_hour.incoming+excluded.incoming,outgoing=count_hour.outgoing+excluded.outgoing;
  RETURN NEW;
END $$;
CREATE TRIGGER count_hour_work_list AFTER INSERT OR UPDATE ON cp_owner_snapshots
  FOR EACH ROW EXECUTE FUNCTION count_work_list_write();
INSERT INTO count_hour(hour,state,family,stage,delta)
SELECT effective_at,state,family,stage,sum(delta) FROM (
  SELECT d.from_at AS effective_at,d.state,d.family,d.stage,1 AS delta FROM cp_owner_snapshots s,
    LATERAL count_work_segments(s.value,s.id,statement_timestamp()) d WHERE s.id LIKE 'current:%'
  UNION ALL SELECT d.until_at,d.state,d.family,d.stage,-1 FROM cp_owner_snapshots s,
    LATERAL count_work_segments(s.value,s.id,statement_timestamp()) d WHERE s.id LIKE 'current:%' AND d.until_at IS NOT NULL
) changes GROUP BY effective_at,state,family,stage HAVING sum(delta)<>0
ON CONFLICT(hour,state,family,stage) DO UPDATE SET delta=count_hour.delta+excluded.delta;
CREATE FUNCTION count_oldest_waiting(at timestamptz) RETURNS TABLE(
  state text,family text,stage text,count bigint,oldest_at timestamptz,owner text
) LANGUAGE sql STABLE AS $$
WITH waiting AS (
 SELECT d.state,d.family,d.stage,d.oldest_at AS since,d.owner
 FROM cp_owner_snapshots s CROSS JOIN LATERAL count_work_segments(s.value,s.id,at) d
 WHERE s.id LIKE 'current:%' AND d.from_at<=at AND d.stage IN ('work list:WAITING','work list:FAILED','work list:BLOCKED','work list:UNKNOWN')
 AND (d.oldest_at IS NULL OR d.oldest_at<=at)
 UNION ALL
 SELECT d.state,d.family,d.stage,coalesce(b.value#>>'{origins,0,recordedAt}',b.updated_at::text)::timestamptz,'diggers'
 FROM cp_box_findings b CROSS JOIN LATERAL count_control_dimensions(b.value,'box') d
 WHERE b.value->>'state' IN ('waiting','taken','refused')
 UNION ALL
 SELECT d.state,d.family,d.stage,
   coalesce(nullif(w.value->>'lastSuccessAt',''),w.value->>'updatedAt',w.updated_at::text)::timestamptz,'diggers'
 FROM cp_doors w CROSS JOIN LATERAL count_control_dimensions(w.value,'door') d
 WHERE w.value->>'status'='OPEN' AND
   coalesce(nullif(w.value->>'lastSuccessAt',''),w.value->>'updatedAt',w.updated_at::text)::timestamptz +
   make_interval(mins=>coalesce(nullif(w.value->>'checkEveryMinutes','')::integer,60)) <= at
)
SELECT state,family,stage,count(*)::bigint AS count,min(since) AS oldest_at,owner FROM waiting GROUP BY state,family,stage,owner
$$;
`;
const tables = [["cp_doors","door"],["cp_work_items","work"],["cp_work_items_archive","work"],["cp_box_findings","box"]] as const;
export function countHourMigrationDefinition(): string {
  const definition=readFileSync(new URL(schemaName!,migrationDirectory), "utf8").split(sharedMarker)[0]
    + CONTROL_COUNT_SQL + tables.map(([table,kind]) => `
CREATE TRIGGER count_hour_${table} AFTER INSERT OR UPDATE OR DELETE ON ${table}
  FOR EACH ROW EXECUTE FUNCTION count_control_write('${kind}');
INSERT INTO count_hour(hour,state,family,stage,delta)
 SELECT date_trunc('hour',statement_timestamp()),d.state,d.family,d.stage,count(*)
 FROM ${table} w CROSS JOIN LATERAL count_control_dimensions(w.value,'${kind}') d GROUP BY 2,3,4
 ON CONFLICT(hour,state,family,stage) DO UPDATE SET delta=count_hour.delta+excluded.delta;`).join("\n") + `
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='wtp_cp_release_readonly') THEN
  GRANT EXECUTE ON FUNCTION count_oldest_waiting(timestamptz) TO wtp_cp_release_readonly;
END IF; END $$;`;
  return definition.replace(/(\$\$;|;(?=\n+(?:CREATE|INSERT|DO)))/g,"$1\n--> statement-breakpoint\n");
}
export async function installHourlyCounts(sql: Sql): Promise<void> {
  await sql.query("BEGIN");
  try {
    // Seed and attach under the same locks; a writer cannot disappear between them.
    await sql.query(`LOCK TABLE ${tables.map(([table])=>table).join(",")} IN SHARE ROW EXCLUSIVE MODE`);
    for(const statement of countHourMigrationDefinition().split("--> statement-breakpoint").map(s=>s.trim()).filter(Boolean)) await sql.query(statement);
    await sql.query("COMMIT");
  } catch (error) { await sql.query("ROLLBACK"); throw error; }
}
