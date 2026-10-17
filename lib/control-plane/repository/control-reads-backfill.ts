import { BANK_WRITE_HEALTH_ID } from "../bank-write-health.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { copyFieldManualPage } from "../field-manual-copy.ts";
import { newFieldManualEntry, normalizeEntry, type FieldManualEntry, type FieldManualRepos } from "../field-manual.ts";
import { ADMIN_SECTIONS } from "./admin-config.ts";
import { cacheTotals } from "./model-charges.ts";
import { pricedModelCharge, type PricedCharge } from "../fleet-safety.ts";
import { costRecordId } from "../spend-window.ts";
import { SCOUT_PREWARM_ROUTE_ID } from "../scheduler/research-policy.ts";
import type { CostEntry } from "../cost.ts";
import type { Sql } from "./pg-store.ts";

export interface ControlReadsBackfill {
  runState(state: string): Promise<{ readonly copied: number; readonly archived: number; readonly complete: boolean }>;
  finish(states:readonly string[]): Promise<void>;
  finished(): Promise<boolean>;
}

export const CONTROL_READS_BACKFILL_DDL = [
  `CREATE OR REPLACE FUNCTION cp_control_state(record jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
    DECLARE candidate text;
    BEGIN
    candidate:=lower(coalesce(
      substring(coalesce(record->>'subjectId',record->>'subject',record->>'jurisdictionId',record->>'ocdId',record->>'bodyId',record->>'obligationId',record->>'jurisdiction',record #>> '{metered,jurisdiction}',record->>'key',record->>'id','') from '/(?:state|district|territory):([a-zA-Z]{2})(?:/|#|$)'),
      substring(coalesce(record->>'subjectId',record->>'obligationId',record->>'jurisdiction','') from '(?i)(?:^|:)government:US-([a-zA-Z]{2}):'),
      record #>> '{geography,stateAbbr}', CASE WHEN record->>'stateCode' ~ '^[a-zA-Z]{2}$' THEN record->>'stateCode' END,
      CASE WHEN record->>'state' ~ '^[a-zA-Z]{2}$' THEN record->>'state' END,
      substring(coalesce(record->>'key',record->>'placeKey',record->>'jurisdiction',record->>'subjectId',record->>'scope',record->>'partitionScope','') from '^(?:geo:|st:|US-)?([a-zA-Z]{2})(?:[.:-]|$)'),
      'system'));
    RETURN CASE WHEN candidate=ANY(ARRAY[${Object.values(FIPS_TO_STATE).map(state=>`'${state.postal.toLowerCase()}'`).join(",")}]) THEN candidate ELSE 'system' END;
    END
  $$`,
  `CREATE TABLE IF NOT EXISTS cp_control_backfill_jobs (
    state text NOT NULL, kind text NOT NULL, cursor jsonb, completed boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(state,kind))`,
  "CREATE INDEX IF NOT EXISTS cp_work_items_state ON cp_work_items (cp_control_state(value),id)",
  "CREATE INDEX IF NOT EXISTS cp_work_items_archive_state ON cp_work_items_archive (cp_control_state(value),id)",
  "CREATE INDEX IF NOT EXISTS cp_obligations_state_active ON cp_obligations (cp_control_state(value),id) WHERE value->>'active'='true'",
  "CREATE INDEX IF NOT EXISTS cp_log_research_intents_action_time ON cp_log_research_intents ((record->>'action'),(record->>'requestedAt') DESC,position DESC) WHERE record->>'kind'='INTENT'",
  "CREATE INDEX IF NOT EXISTS cp_log_research_intents_honors ON cp_log_research_intents ((record->>'honors'))",
  "CREATE INDEX IF NOT EXISTS cp_log_research_intents_cancel ON cp_log_research_intents ((record->>'note')) WHERE record->>'action'='CANCEL_DISPATCH' AND record->>'kind'='INTENT'",
  "CREATE INDEX IF NOT EXISTS cp_obligations_state ON cp_obligations (cp_control_state(value),id)",
  "CREATE INDEX IF NOT EXISTS cp_obligations_state_materialized ON cp_obligations (cp_control_state(value),(value->>'materializedBy'),id)",
  "CREATE INDEX IF NOT EXISTS cp_occurrences_state_open ON cp_occurrences (cp_control_state(value),id) WHERE value->>'closedAt' IS NULL",
  "CREATE INDEX IF NOT EXISTS cp_occurrences_state_closed ON cp_occurrences (cp_control_state(value),id) WHERE value->>'closedAt' IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS cp_log_costs_state ON cp_log_costs (cp_control_state(record),log_key,position)",
  ...["cp_debts","cp_ask_gap_observations","cp_doors"].map(table=>`CREATE INDEX IF NOT EXISTS ${table}_planning_state ON ${table} (cp_control_state(value),id)`),
  "CREATE INDEX IF NOT EXISTS cp_log_scout_results_state ON cp_log_scout_results (cp_control_state(record),(record->>'recordedAt'),log_key,position)",
];

export const ARCHIVE_STATE_SQL=`SELECT cp_archive_occurrences(ARRAY(
  SELECT o.id FROM cp_work_items w CROSS JOIN LATERAL (
    SELECT o.id FROM cp_occurrences o WHERE o.value #>> '{workItemId}'=w.id
      AND o.value->>'closedAt' IS NOT NULL LIMIT 100 FOR UPDATE OF o SKIP LOCKED
  ) o WHERE cp_control_state(w.value)=$1 LIMIT 100)) AS moved`;

const CHARGE_COLUMNS = "id,charged_at,job_id,route_task_id,obligation_id,jurisdiction,attempt_id,usd,known_usd,measured,bounded,assignment_refs,is_scout,scout_usd,cache";
async function insertCharges(sql: Sql, charges: readonly PricedCharge[]): Promise<void> {
  if (!charges.length) return;
  await sql.query(`INSERT INTO cp_model_charges (${CHARGE_COLUMNS}) SELECT
    charge->>'id',(charge->>'at')::timestamptz,charge->>'jobId',charge->>'routeTaskId',charge->>'obligationId',
    charge->>'jurisdiction',charge->'metered'->>'attemptId',(charge->>'usd')::double precision,
    (charge->>'knownUsd')::double precision,(charge->>'measured')::boolean,(charge->>'bounded')::boolean,
    nullif(charge->'assignmentRefs','null'::jsonb),is_scout,(charge->'metered'->'cost'->>'usd')::double precision,cache
    FROM jsonb_to_recordset($1::jsonb) AS entries(charge jsonb,is_scout boolean,cache jsonb) ON CONFLICT(id) DO NOTHING`,
  [JSON.stringify(charges.map(charge => ({ charge, is_scout: charge.metered.role === "SCOUT" && charge.metered.routeId !== SCOUT_PREWARM_ROUTE_ID, cache: cacheTotals(charge) })))]);
}

export function pgControlReadsBackfill(sql: Sql, manual?:()=>FieldManualRepos): ControlReadsBackfill {
  return {
    async finished() {
      const rows=await sql.query("SELECT completed FROM cp_control_backfill_jobs WHERE state='system' AND kind='complete'") as {completed:boolean}[];
      return rows[0]?.completed===true;
    },
    async finish(states) {
      const pending=await sql.query(`SELECT count(*)::integer AS n FROM unnest($1::text[]) AS states(state_key) CROSS JOIN unnest($2::text[]) AS kinds(kind_key)
        WHERE NOT EXISTS(SELECT 1 FROM cp_control_backfill_jobs j WHERE j.state=states.state_key AND j.kind=kinds.kind_key AND j.completed)`,
      [states,[...Object.keys(ADMIN_SECTIONS),"spend-window","costs",...(manual?["manual"]:[])]]) as {n:number}[];
      if(Number(pending[0].n)>0) throw new Error("Scoped control backfills remain pending");
      await sql.query(`UPDATE cp_admin_config SET value=value-ARRAY[${Object.keys(ADMIN_SECTIONS).map(key=>`'${key}'`).join(",")}],revision=revision+1
        WHERE value ?| ARRAY[${Object.keys(ADMIN_SECTIONS).map(key=>`'${key}'`).join(",")}]`);
      await sql.query("DROP TABLE IF EXISTS cp_spend_window");
      if(manual) await sql.query("DROP TABLE IF EXISTS cp_field_manual");
      if(manual) await sql.query("ANALYZE cp_field_manual_entries");
      await sql.query("INSERT INTO cp_control_backfill_jobs(state,kind,completed) VALUES('system','complete',true) ON CONFLICT(state,kind) DO UPDATE SET completed=true,updated_at=now()");
    },
    async runState(state) {
    if (!/^(?:[a-z]{2}|system)$/.test(state)) throw new Error("A backfill needs one state");
    let copied = 0, complete = true;
    const job = async (kind: string) => (await sql.query("SELECT cursor,completed FROM cp_control_backfill_jobs WHERE state=$1 AND kind=$2", [state,kind]) as { cursor: unknown; completed: boolean }[])[0];
    const save = async (kind: string,cursor: unknown,done: boolean) => {
      await sql.query(`INSERT INTO cp_control_backfill_jobs(state,kind,cursor,completed) VALUES($1,$2,$3::jsonb,$4)
        ON CONFLICT(state,kind) DO UPDATE SET cursor=EXCLUDED.cursor,completed=EXCLUDED.completed,updated_at=now()`,[state,kind,JSON.stringify(cursor??null),done]);
      complete &&= done;
    };
    for (const [section,name] of Object.entries(ADMIN_SECTIONS)) {
      const held = await job(section); if (held?.completed) continue;
      const id = section === "methodStandings" ? "methodId" : section === "placeTargets" || section === "expansionScopes" ? "key" : "id";
      const stopped=section==="expansionScopes"?`AND NOT EXISTS(SELECT 1 FROM cp_hunt_orders o
          WHERE o.value->>'state'=ANY(ARRAY[$1]||ARRAY(SELECT lower(state_key) FROM jsonb_array_elements_text(coalesce(item->'planningStates','[]'::jsonb)) state_key))
            AND (o.value->>'scopeKey' IS NULL OR o.value->>'scopeKey'=item->>'key')
            AND o.value->>'requestedAt'>=coalesce(item->>'decidedAt',''))`:"";
      const rows = await sql.query(`WITH batch AS MATERIALIZED (
        SELECT c.id AS config_id,c.updated_at,item AS value,item->>'${id}' AS id FROM cp_admin_config c
        CROSS JOIN LATERAL jsonb_array_elements(coalesce(nullif(c.value->'${section}','null'::jsonb),'[]'::jsonb)) item
        WHERE cp_control_state(item)=$1 AND item->>'${id}'>$2 ${stopped} ORDER BY item->>'${id}' LIMIT 100
      ), saved AS (INSERT INTO cp_admin_${name}(config_id,id,updated_at,value)
        SELECT config_id,id,updated_at,value FROM batch ON CONFLICT(config_id,id) DO NOTHING RETURNING id)
        SELECT (SELECT count(*)::integer FROM saved) AS copied,count(*)::integer AS size,max(id) AS cursor FROM batch`,[state,held?.cursor ?? ""]) as { copied: number; size: number; cursor: string | null }[];
      copied += Number(rows[0].copied); await save(section,rows[0].cursor ?? held?.cursor ?? "",Number(rows[0].size)<100);
    }
    const oldTable = await sql.query("SELECT to_regclass('cp_spend_window') AS name") as { name: string | null }[];
    const window = await job("spend-window");
    if (!window?.completed) {
      const rows = oldTable[0]?.name ? await sql.query(`SELECT charge FROM cp_spend_window w
        CROSS JOIN LATERAL jsonb_array_elements(w.value->'charges') charge
        WHERE cp_control_state(charge)=$1 AND charge->>'id'>$2 ORDER BY charge->>'id' LIMIT 100`,[state,window?.cursor ?? ""]) as { charge: PricedCharge }[] : [];
      await insertCharges(sql,rows.map(row=>row.charge)); copied += rows.length;
      await save("spend-window",rows.at(-1)?.charge.id ?? window?.cursor ?? "",rows.length<100);
    }
    const costs = await job("costs");
    if (!costs?.completed) {
      const cursor = costs?.cursor as { key: string; position: number } | null;
      const rows = await sql.query(`SELECT log_key,position,record FROM cp_log_costs WHERE cp_control_state(record)=$1
        AND (log_key,position)>($2,$3::bigint) ORDER BY log_key,position LIMIT 100`,[state,cursor?.key ?? "",cursor?.position ?? -1]) as { log_key: string; position: number; record: CostEntry }[];
      await insertCharges(sql,rows.flatMap(row=>pricedModelCharge(row.record,costRecordId(row.record)) ?? [])); copied += rows.length;
      const last=rows.at(-1); await save("costs",last?{key:last.log_key,position:Number(last.position)}:cursor,rows.length<100);
    }
    if(manual) {
      const held=await job("manual");
      if(!held?.completed) {
        const oldManual=await sql.query("SELECT to_regclass('cp_field_manual') AS name") as {name:string|null}[];
        const rows=oldManual[0]?.name?await sql.query(`SELECT entry,f.updated_at FROM cp_field_manual f CROSS JOIN LATERAL
          jsonb_array_elements(coalesce(f.value->'entries','[]'::jsonb)) entry
          WHERE f.id='live' AND entry->>'id'>$2 AND cp_control_state(jsonb_build_object('subjectId',
            coalesce(entry #>> '{ocdIds,0}',entry #>> '{bodyIds,0}',entry #>> '{reach,places,0}'),
            'state',entry #>> '{reach,states,0}'))=$1 ORDER BY entry->>'id' LIMIT 100`,[state,held?.cursor??""]) as {entry:FieldManualEntry;updated_at:string}[]:[];
        copied+=await copyFieldManualPage(manual(),rows.map(row=>row.entry),rows.length?new Date(rows[0].updated_at).toISOString():new Date().toISOString());await save("manual",rows.at(-1)?.entry.id??held?.cursor??"",rows.length<100);
      }
    }
    if(manual && state==="system" && ((await sql.query("SELECT to_regclass('cp_field_manual') AS name")) as {name:string|null}[])[0]?.name) {
      const entry=normalizeEntry(newFieldManualEntry("bank-health","write-errors",{role:"SHARED",kind:"WRITE_HEALTH",
        title:"Bank write errors",summary:"Write failures after retries",outcome:"REFERENCE",observedAt:new Date().toISOString(),portable:true,payload:{count:0}}));
      await sql.query(`WITH source AS MATERIALIZED (
        SELECT revision,greatest(0,coalesce((value #>> '{entries,0,payload,count}')::bigint,0)) AS count
          FROM cp_field_manual WHERE id='write-errors' AND jsonb_array_length(coalesce(value->'entries','[]'::jsonb))>0 FOR UPDATE
      ), saved AS (INSERT INTO cp_field_manual_entries(id,revision,updated_at,value)
        SELECT $1,1,now(),jsonb_set($2::jsonb,'{payload,count}',to_jsonb(count)) FROM source
        ON CONFLICT(id) DO UPDATE SET revision=cp_field_manual_entries.revision+1,updated_at=now(),
          value=jsonb_set(cp_field_manual_entries.value,'{payload,count}',to_jsonb(
            coalesce((cp_field_manual_entries.value #>> '{payload,count}')::bigint,0)+(EXCLUDED.value #>> '{payload,count}')::bigint))
        RETURNING id)
        UPDATE cp_field_manual f SET value=jsonb_set(f.value,'{entries}','[]'::jsonb),revision=f.revision+1,updated_at=now() FROM source WHERE f.id='write-errors' AND f.revision=source.revision AND EXISTS(SELECT 1 FROM saved)`,
        [BANK_WRITE_HEALTH_ID,JSON.stringify(entry)]);
    }
    const archived = await sql.query(ARCHIVE_STATE_SQL,[state]) as { moved: number }[];
    complete &&= Number(archived[0].moved)<100;
    return { copied, archived: Number(archived[0].moved), complete };
  } };
}
