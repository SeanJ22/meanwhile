import { OWNER_LEASE_CHANGES_DDL } from "../owner-lease-changes.ts";
import { OWNER_COST_REFS_DDL, OWNER_COST_REFS_SEED_DDL } from "../owner-cost-refs.ts";
import { OWNER_STUCK_COUNTS_DDL, OWNER_STUCK_COUNTS_BACKFILL_DDL } from "../owner-stuck-counts.ts";
import { ASSIGNMENT_STATES } from "../../assignment-view.ts";
import { ASK_GAP_CODES } from "../../../ask/gap-codes.ts";
import { ADMIN_ASK_MEMBERSHIP_DDL, CONTROL_COUNTS_DDL, CONTROL_COUNTS_INITIALIZE_DDL } from "../control-counts.ts";
import { OWNER_ASSIGNMENT_ROWS_DDL } from "../owner-assignment-rows.ts";
import { DOOR_READS_DDL } from "../../../doors/read-changes.ts";
import { LOSS_STUDY_COUNTS_DDL } from "../../../method/loss-study-counts.ts";
import type { Sql } from "../pg-store.ts";

export const CP01_COUNTS_DECLARATIONS = [
  "lib/control-plane/repository/owner-cost-refs.ts", "lib/control-plane/repository/owner-lease-changes.ts",
  "lib/control-plane/owner-snapshot-initialize.ts", "lib/control-plane/owner-snapshot-totals.ts",
  "lib/control-plane/repository/owner-stuck-counts.ts", "lib/control-plane/admin-view/blocker-causes.ts",
  "lib/control-plane/repository/control-counts.ts", "lib/control-plane/repository/owner-assignment-rows.ts",
  "lib/doors/read-changes.ts", "lib/doors/record-fields.ts", "lib/method/loss-study-counts.ts", "lib/control-plane/assignment-view.ts",
] as const;

/** Existing state records are split in PostgreSQL; source records never leave the database. */
export const SPLIT_OWNER_ROWS_SQL = `WITH state_totals AS MATERIALIZED (
  SELECT substring(s.id from '^totals:(.+)$') AS state,s.value->>'builtAt' AS built_at,
    coalesce(s.value->'groups','{}'::jsonb) AS groups,coalesce(s.value->'lists','{}'::jsonb) AS lists
  FROM cp_owner_snapshots s WHERE s.id LIKE 'totals:%'
), state_indexes AS MATERIALIZED (
  SELECT substring(s.id from '^current:(.+)$') AS state,
    coalesce(s.value->'allRowsIndex','[]'::jsonb) AS segments,coalesce(s.value->'bodyAttempts','[]'::jsonb) AS bodies
  FROM cp_owner_snapshots s WHERE s.id LIKE 'current:%'
), groups AS MATERIALIZED (
  SELECT s.state,s.built_at,g.key AS id,g.value AS group_value
  FROM state_totals s CROSS JOIN LATERAL jsonb_each(s.groups) g
), lists AS MATERIALIZED (
  SELECT s.state,l.key AS id,l.value AS list_value FROM state_totals s CROSS JOIN LATERAL jsonb_each(s.lists) l
), segments AS MATERIALIZED (
  SELECT s.state,r->>'id' AS id,jsonb_agg(r ORDER BY r->>'from' NULLS FIRST) AS items
  FROM state_indexes s CROSS JOIN LATERAL jsonb_array_elements(s.segments) r GROUP BY 1,2
), members AS MATERIALIZED (
  SELECT g.state,g.id,m.member FROM groups g CROSS JOIN LATERAL jsonb_array_elements_text(g.group_value->'members') m(member)
), body_rows AS MATERIALIZED (
  SELECT s.state,b AS body FROM state_indexes s CROSS JOIN LATERAL jsonb_array_elements(s.bodies) b
), bodies AS (
  SELECT m.state,m.id,jsonb_agg(b.body ORDER BY b.body->>'at' DESC,b.body->>'workItemId') AS items
  FROM members m JOIN body_rows b ON b.state=m.state AND b.body->>'workItemId'=m.member GROUP BY 1,2
)
INSERT INTO cp_owner_assignment_rows(id,state_code,value)
SELECT g.id,g.state,jsonb_build_object('id',g.id,'state',g.state,'builtAt',g.built_at,'group',g.group_value,
  'indexSegments',s.items,'list',l.list_value,'bodyAttempts',coalesce(b.items,'[]'::jsonb),
  'nextAt',(SELECT min(r->>'until') FROM jsonb_array_elements(s.items) r WHERE r->>'until'>g.built_at))
FROM groups g JOIN segments s USING(state,id) LEFT JOIN lists l USING(state,id) LEFT JOIN bodies b USING(state,id)
ON CONFLICT(id) DO UPDATE SET state_code=excluded.state_code,value=excluded.value
WHERE (cp_owner_assignment_rows.value-'part') IS DISTINCT FROM excluded.value`;

const ZERO_STATES=JSON.stringify(Object.fromEntries(ASSIGNMENT_STATES.map(state=>[state,0])));
const oneState=(state:string)=>`('${ZERO_STATES}'::jsonb || jsonb_build_object(${state},1))`;

/** The same scalar contribution as assignmentPartOf([entry]); all projection work stays beside its source row. */
export const OWNER_ASSIGNMENT_PARTS_SQL = `WITH selected AS MATERIALIZED (
 SELECT r.id,r.value->>'builtAt' AS at,r.value #> '{group,usd}' AS usd,r.value #> '{group,obligation}' AS obligation,j.row,
   regexp_match(r.id,'^freshness:ask-gap:(.+)#(${ASK_GAP_CODES.join("|")})$') AS ask
 FROM cp_owner_assignment_rows r CROSS JOIN LATERAL (
   SELECT j.row FROM jsonb_array_elements(r.index_segments) j(row)
   WHERE (j.row->>'from' IS NULL OR j.row->>'from'<=r.value->>'builtAt')
     AND (j.row->>'until' IS NULL OR j.row->>'until'>r.value->>'builtAt') LIMIT 1
 ) j WHERE NOT(r.value ? 'part')
), parts AS (
 SELECT id,jsonb_build_object('total',1,'groups',jsonb_build_object((row->>'state')||'|'||(row->>'lane'),1),
  'geographic',jsonb_build_object(coalesce(row->>'stateCode',''),${oneState("row->>'state'")}),
  'instruction',coalesce((SELECT jsonb_object_agg(k,${oneState("row->>'state'")}) FROM jsonb_array_elements_text(coalesce(row->'assignmentKeys','[]'::jsonb)) k),'{}'::jsonb),
  'instructionByReceipt',coalesce((SELECT jsonb_object_agg(k,${oneState("v #>> '{}'")}) FROM jsonb_each(coalesce(row->'instructionStates','{}'::jsonb)) i(k,v)),'{}'::jsonb),
  'clocks',jsonb_build_object('active',CASE WHEN obligation->>'active'='true' THEN 1 ELSE 0 END,
    'backoff',CASE WHEN obligation->>'active'='true' AND obligation->>'backoff'='true' THEN 1 ELSE 0 END,
    'eligible',CASE WHEN obligation->>'active'='true' AND obligation->>'eligibleAt' IS NOT NULL THEN 1 ELSE 0 END,
    'overdue',CASE WHEN obligation->>'active'='true' AND obligation->>'eligibleAt' IS NOT NULL AND
      CASE WHEN pg_input_is_valid(obligation->>'eligibleAt','timestamptz') THEN (obligation->>'eligibleAt')::timestamptz <= at::timestamptz ELSE false END THEN 1 ELSE 0 END),
  'askGaps',jsonb_build_object('rows',CASE WHEN obligation IS NOT NULL AND obligation<>'null'::jsonb AND ask IS NOT NULL THEN 1 ELSE 0 END,
    'open',CASE WHEN obligation->>'active'='true' AND ask IS NOT NULL THEN jsonb_build_array(jsonb_build_object('bodyId',ask[1],'code',ask[2])) ELSE '[]'::jsonb END),
  'usd',usd,'candidates',jsonb_build_array(jsonb_build_object('id',row->'id','state',row->'state','lane',row->'lane','band',row->'band',
    'waitingSince',row->'waitingSince','lastActivityAt',row->'lastActivityAt'))) AS part FROM selected
), changed AS (
 UPDATE cp_owner_assignment_rows r SET value=jsonb_set(r.value,'{part}',p.part) FROM parts p WHERE r.id=p.id RETURNING r.id
) SELECT count(*)::text AS n FROM changed`;

const OWNER_COUNTER_TRIGGER_DDL = `DROP TRIGGER IF EXISTS count_hour_work_list ON cp_owner_snapshots;
DROP FUNCTION IF EXISTS count_work_list_write();
CREATE OR REPLACE FUNCTION cp_count_assignment_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.index_segments IS NOT DISTINCT FROM NEW.index_segments THEN RETURN NEW; END IF;
  PERFORM count_work_index_change(
    jsonb_build_object('allRowsIndex',CASE WHEN TG_OP='INSERT' THEN '[]'::jsonb ELSE OLD.index_segments END),
    jsonb_build_object('allRowsIndex',CASE WHEN TG_OP='DELETE' THEN '[]'::jsonb ELSE NEW.index_segments END),
    'current:'||coalesce(NEW.state_code,OLD.state_code),statement_timestamp());
  RETURN coalesce(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS count_hour_owner_assignment ON cp_owner_assignment_rows;
CREATE TRIGGER count_hour_owner_assignment AFTER INSERT OR UPDATE OR DELETE ON cp_owner_assignment_rows
  FOR EACH ROW EXECUTE FUNCTION cp_count_assignment_row();`;

export function controlCountsMigrationDefinition(): string {
  return JSON.stringify({ statements: [...OWNER_LEASE_CHANGES_DDL, OWNER_COST_REFS_DDL, OWNER_COST_REFS_SEED_DDL, ...OWNER_ASSIGNMENT_ROWS_DDL, ...OWNER_STUCK_COUNTS_DDL, ...CONTROL_COUNTS_DDL, CONTROL_COUNTS_INITIALIZE_DDL,
    ...DOOR_READS_DDL, ...LOSS_STUDY_COUNTS_DDL, ...ADMIN_ASK_MEMBERSHIP_DDL], backfill: OWNER_STUCK_COUNTS_BACKFILL_DDL, split: SPLIT_OWNER_ROWS_SQL, parts: OWNER_ASSIGNMENT_PARTS_SQL, counters: OWNER_COUNTER_TRIGGER_DDL });
}

export async function expandControlCounts(sql: Sql): Promise<string> {
  for (const statement of [...OWNER_LEASE_CHANGES_DDL, OWNER_COST_REFS_DDL, OWNER_COST_REFS_SEED_DDL, ...OWNER_ASSIGNMENT_ROWS_DDL, ...OWNER_STUCK_COUNTS_DDL, ...CONTROL_COUNTS_DDL, CONTROL_COUNTS_INITIALIZE_DDL,
    ...DOOR_READS_DDL, ...LOSS_STUDY_COUNTS_DDL, ...ADMIN_ASK_MEMBERSHIP_DDL]) await sql.query(statement);
  return migrateOwnerRows(sql, false);
}

export const contractControlCountsMigrationDefinition = () => controlCountsMigrationDefinition() + "retire owner state copies after deployed runner follows";

export class OwnerSnapshotInitializationPending extends Error {
  readonly code="CP01_OWNER_INITIALIZATION_PENDING";
  constructor(){super("CP01_OWNER_INITIALIZATION_PENDING: durable owner work-list initialization will continue in the next cleanup attempt");}
}

export async function contractControlCounts(sql:Sql,env:NodeJS.ProcessEnv=process.env,
  dependencies:unknown={}):Promise<string>{
  const deps=typeof dependencies==="object"&&dependencies!==null?dependencies as {readonly initialize?:()=>Promise<boolean>}:{};
  const [prior]=await sql.query("SELECT value->>'formatVersion' AS format,value->>'ownerWorkListReady' AS ready,value->>'initializing' AS initializing FROM cp_owner_snapshots WHERE id='totals'") as {format:string;ready:string;initializing:string}[];
  const message=prior?.format==="4"?"keyed owner work rows already installed":await migrateOwnerRows(sql,true);
  if(prior?.ready==="true")return message;
  // This guard and the structural conversion commit together; ordinary publication cannot race catchup.
  await sql.query("UPDATE cp_owner_snapshots SET value=value || '{\"initializing\":true}'::jsonb,revision=revision+1,updated_at=now() WHERE id='totals' AND NOT(value @> '{\"initializing\":true}'::jsonb)");
  const complete=await(deps.initialize??(async()=>{
    const [{createPgRepositories},{initializeOwnerSnapshot},{passDeadlineFromEnv}]=await Promise.all([
      import("../pg-store.ts"),import("../../owner-snapshot-initialize.ts"),import("../../../ops/independent-runtime-pass.ts")]);
    const repos=await createPgRepositories(env.WTP_CONTROL_PLANE_DATABASE_URL??"",new Date().toISOString(),{skipBootstrap:true});
    return initializeOwnerSnapshot(repos,{deadline:passDeadlineFromEnv(env),log:console.log});
  }))();
  if(!complete)throw new OwnerSnapshotInitializationPending();
  return message+"; owner work-list initialization complete";
}

async function migrateOwnerRows(sql: Sql, contract: boolean): Promise<string> {
  await sql.query("BEGIN");
  let count = 0;
  try {
    await sql.query("LOCK TABLE cp_owner_snapshots,cp_owner_assignment_rows IN SHARE ROW EXCLUSIVE MODE");
    if(contract)await sql.query(`WITH live AS MATERIALIZED (
      SELECT g.id FROM cp_owner_snapshots s CROSS JOIN LATERAL jsonb_object_keys(coalesce(s.value->'groups','{}'::jsonb)) g(id)
      WHERE s.id LIKE 'totals:%'
    ) DELETE FROM cp_owner_assignment_rows r WHERE EXISTS(SELECT 1 FROM cp_owner_snapshots WHERE id LIKE 'totals:%' AND value ? 'groups')
      AND NOT EXISTS(SELECT 1 FROM live WHERE live.id=r.id)`);
    await sql.query(SPLIT_OWNER_ROWS_SQL);
    await sql.query(OWNER_STUCK_COUNTS_BACKFILL_DDL);
    const unmatched = await sql.query(`SELECT s.id,count(*)::text AS n FROM cp_owner_snapshots s
      CROSS JOIN LATERAL jsonb_object_keys(coalesce(s.value->'groups','{}'::jsonb)) g(id)
      LEFT JOIN cp_owner_assignment_rows r ON r.id=g.id
      WHERE s.id LIKE 'totals:%' AND r.id IS NULL GROUP BY s.id`) as {id:string;n:string}[];
    if (unmatched.length) throw new Error(`Owner work rows are missing saved index segments: ${unmatched.map(row=>`${row.id} (${row.n})`).join(", ")}`);
    const [folded] = await sql.query(OWNER_ASSIGNMENT_PARTS_SQL) as {n:string}[];
    count=Number(folded.n);
    const [missingPart]=await sql.query("SELECT EXISTS(SELECT 1 FROM cp_owner_assignment_rows WHERE NOT(value ? 'part')) AS missing") as {missing:boolean}[];
    if(missingPart.missing)throw new Error("Owner work rows have no index segment at their saved clock");
    await sql.query(`UPDATE cp_owner_snapshots s SET value=s.value || jsonb_build_object('builtAt',s.value->'builtAt','places',coalesce(s.value->'places','{}'::jsonb),
      'part',(n.value #> ARRAY['assignments','states',substring(s.id from '^totals:(.+)$')]) || jsonb_build_object('usdRows',
        (SELECT count(*) FROM cp_owner_assignment_rows r WHERE r.state_code=substring(s.id from '^totals:(.+)$') AND r.value #> '{group,usd}' <> 'null'::jsonb))),
      revision=s.revision+1,updated_at=now() FROM cp_owner_snapshots n
      WHERE n.id='totals' AND s.id LIKE 'totals:%' AND s.value ? 'groups'`);
    if (contract) {
    await sql.query(OWNER_COST_REFS_SEED_DDL);
    await sql.query("UPDATE cp_owner_snapshots SET value=(value #- '{costs,orphans}') #- '{costs,unassigned}',revision=revision+1,updated_at=now() WHERE id='totals'");
    // The deployed publisher now uses the keyed work list; these old copies are discarded in the same migration.
    await sql.query("DROP TRIGGER IF EXISTS count_hour_work_list ON cp_owner_snapshots");
    await sql.query(`UPDATE cp_owner_snapshots SET value=value-'allRowsIndex'-'bodyAttempts',revision=revision+1,updated_at=now()
      WHERE id LIKE 'current:%' AND (value ? 'allRowsIndex' OR value ? 'bodyAttempts')`);
    await sql.query("UPDATE cp_owner_snapshots SET value=value-'groups'-'lists',revision=revision+1,updated_at=now() WHERE id LIKE 'totals:%' AND (value ? 'groups' OR value ? 'lists')");
    await sql.query(`UPDATE cp_owner_snapshots s SET value=jsonb_set(jsonb_set(s.value || '{"initializing":true}'::jsonb,'{formatVersion}','4'),'{assignments,states}',
      coalesce((SELECT jsonb_object_agg(substring(r.id from '^totals:(.+)$'),r.value->'part') FROM cp_owner_snapshots r WHERE r.id LIKE 'totals:%'),'{}'::jsonb)),
      revision=s.revision+1,updated_at=now() WHERE s.id='totals' AND s.value->>'formatVersion'='3'`);
    await sql.query(`UPDATE cp_owner_snapshots SET value=jsonb_set(value,'{part}',
      ((value->'part')-'publications'-'marks') || jsonb_build_object('assignments',
        (value #> '{part,assignments}') || jsonb_build_object('candidates','[]'::jsonb))),revision=revision+1,updated_at=now()
      WHERE id LIKE 'totals:%' AND value ? 'part'`);
    await sql.query(`UPDATE cp_owner_snapshots s SET value=jsonb_set(jsonb_set(s.value,'{assignments,lists}','{}'::jsonb),'{assignments,states}',
      coalesce((SELECT jsonb_object_agg(substring(r.id from '^totals:(.+)$'),r.value->'part') FROM cp_owner_snapshots r WHERE r.id LIKE 'totals:%'),'{}'::jsonb)),
      revision=s.revision+1,updated_at=now() WHERE s.id='totals'`);
    if ((await sql.query("SELECT to_regprocedure('count_work_index_change(jsonb,jsonb,text,timestamptz,boolean)') AS f") as {f:string|null}[])[0]?.f) {
      for (const statement of OWNER_COUNTER_TRIGGER_DDL.split(/;(?=\n(?:CREATE|DROP))/).filter(Boolean)) await sql.query(statement);
      // Reuse the same function body after replacing only its source relation.
      const definition = await sql.query("SELECT pg_get_functiondef('count_oldest_waiting(timestamptz)'::regprocedure) AS definition") as {definition:string}[];
      const replaced = definition[0].definition.replace(
        /FROM cp_owner_snapshots s CROSS JOIN LATERAL count_work_segments\(s\.value,s\.id,at\) d\s+WHERE s\.id LIKE 'current:%' AND/,
        "FROM cp_owner_assignment_rows s CROSS JOIN LATERAL count_work_segments(jsonb_build_object('allRowsIndex',s.index_segments),'current:'||s.state_code,at) d WHERE");
      if (replaced === definition[0].definition && !replaced.includes("FROM cp_owner_assignment_rows s")) throw new Error("The oldest-work count function has an unexpected source");
      await sql.query(replaced);
    }
    }
    await sql.query(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wtp_cp_release_readonly') THEN
      GRANT SELECT ON cp_control_counts,cp_owner_assignment_rows,cp_owner_cost_refs,cp_owner_stuck_rows,cp_owner_stuck_counts,cp_owner_stuck_ready,cp_door_changes,cp_loss_obligation_counts,cp_loss_obligation_heads TO wtp_cp_release_readonly;
    END IF; END $$`);
    await sql.query("COMMIT");
  } catch (error) { await sql.query("ROLLBACK"); throw error; }
  return `${count} assignments moved to keyed work rows; transactional control counts installed`;
}
