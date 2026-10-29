import { blockerCauseKeySql } from "../admin-view/blocker-causes.ts";
import { US_STATES } from "../readiness/catalog.ts";
import type { Sql } from "./pg-store.ts";

/** These are stateOfRow/placeKeyOfRow's exact stored-field classifications, applied only when a row changes. */
export function stuckStateKeySql(): string {
  const codes=US_STATES.map(s=>`'${s.code}'`).join(',');
  const candidate=(pattern:string,first=false)=>first
    ?`(SELECT m[1] FROM (SELECT regexp_match(lower(id)||' ', '${pattern}') m) matches WHERE m[1] IN (${codes}))`
    :`(SELECT m[1] FROM regexp_matches(lower(id)||' ', '${pattern}','g') WITH ORDINALITY AS matches(m,n) WHERE m[1] IN (${codes}) ORDER BY n LIMIT 1)`;
  return `CASE WHEN state_code ~* '^[a-z]{2}$' THEN lower(state_code) ELSE coalesce(
    ${candidate('(?:\\y(?:state|district|territory)[:-]|(?:^|:)government:us-)([a-z]{2})(?![a-z])',true)},
    ${candidate('(?:^|[:/ ])([a-z]{2})(?=[:/ ]|$)')},
    ${candidate('(?:^|[:/ ])ballot-([a-z]{2})(?=[-:/ ]|$)',true)},
    ${candidate('^([a-z]{2})[-:_]',true)}) END`;
}
export function stuckPlaceKeySql(): string {
  return `coalesce((SELECT 'geo:'||lower(state_code)||'.'||CASE WHEN k ~ '^zcta:' THEN 'zcta' ELSE 'county' END||'.'||split_part(k,'/',2)
    FROM jsonb_array_elements_text(coalesce(assignment_keys,'[]'::jsonb)) WITH ORDINALITY AS keys(k,n)
    WHERE coalesce(state_code,'')<>'' AND k ~ '^(zcta|county):\\d{4}/\\d{5}$' ORDER BY n LIMIT 1),
    CASE WHEN state_code ~* '^[a-z]{2}$' THEN 'st:'||lower(state_code) ELSE 'us' END)`;
}

const STUCK_FIELDS = `x->>'id' AS id, x->>'state' AS state, x->>'lane' AS lane, x->>'owner' AS owner,
  left(x->>'blocker',400) AS blocker,left(x->>'label',200) AS label,left(x->>'subjectName',160) AS subject_name,
  x->>'stateCode' AS state_code,(x->>'overdue')::boolean AS overdue,(x->>'band')::integer AS band,
  x->>'waitingSince' AS waiting_since,x->>'eligibleAt' AS eligible_at,x->>'lastActivityAt' AS last_activity_at,
  left(x->>'nextAction',240) AS next_action,x->'assignmentKeys' AS assignment_keys,
  coalesce((x->>'from')::timestamptz,'-infinity'::timestamptz) AS from_at,
  coalesce((x->>'until')::timestamptz,'infinity'::timestamptz) AS until_at`;
const STUCK_TEST = `(x->>'state' IN ('FAILED','BLOCKED','UNKNOWN') OR (x->>'state'='WAITING' AND x->>'overdue'='true'))`;
const SAFE_TIME = (field:string) => `CASE WHEN pg_input_is_valid(${field},'timestamp with time zone') THEN ${field}::timestamptz END`;
const SELECT_STUCK = `SELECT owner_id,slot,storage_state,id,state,lane,owner,blocker,label,subject_name,state_code,overdue,band,
  waiting_since,eligible_at,last_activity_at,next_action,assignment_keys,from_at,until_at,
  coalesce(${stuckStateKeySql()},'') AS st,${stuckPlaceKeySql()} AS place,${blockerCauseKeySql('blocker','state')} AS cause_key,
  least(${SAFE_TIME('waiting_since')},${SAFE_TIME('eligible_at')},${SAFE_TIME('last_activity_at')}) AS age_at,
  (CASE WHEN overdue THEN 3 WHEN state IN ('BLOCKED','FAILED') THEN 2 ELSE 1 END)*100+coalesce((4-band)*30,0) AS base_score FROM source`;
const COLUMNS = `owner_id,slot,storage_state,id,state,lane,owner,blocker,label,subject_name,state_code,overdue,band,waiting_since,
  eligible_at,last_activity_at,next_action,assignment_keys,from_at,until_at,st,place,cause_key,age_at,base_score`;

export const OWNER_STUCK_COUNTS_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS cp_owner_stuck_rows (
    owner_id text NOT NULL,slot integer NOT NULL,storage_state text NOT NULL,id text NOT NULL,state text NOT NULL,lane text,owner text,
    blocker text,label text,subject_name text,state_code text,overdue boolean,band integer,waiting_since text,eligible_at text,last_activity_at text,
    next_action text,assignment_keys jsonb,from_at timestamptz NOT NULL,until_at timestamptz NOT NULL,st text NOT NULL,place text NOT NULL,cause_key text NOT NULL,
    age_at timestamptz,base_score integer NOT NULL,PRIMARY KEY(owner_id,slot));`,
  `CREATE INDEX IF NOT EXISTS cp_owner_stuck_scope ON cp_owner_stuck_rows(storage_state,cause_key,from_at,until_at);`,
  `CREATE INDEX IF NOT EXISTS cp_owner_stuck_cause ON cp_owner_stuck_rows(cause_key,from_at,until_at);`,
  `CREATE INDEX IF NOT EXISTS cp_owner_stuck_rank ON cp_owner_stuck_rows(base_score DESC,age_at,id);`,
  `CREATE TABLE IF NOT EXISTS cp_owner_stuck_counts (
    storage_state text NOT NULL,st text NOT NULL,place text NOT NULL,cause_key text NOT NULL,from_at timestamptz NOT NULL,until_at timestamptz NOT NULL,
    n bigint NOT NULL CHECK(n>=0),PRIMARY KEY(storage_state,st,place,cause_key,from_at,until_at));`,
  `CREATE INDEX IF NOT EXISTS cp_owner_stuck_counts_clock ON cp_owner_stuck_counts(from_at,until_at);`,
  `CREATE TABLE IF NOT EXISTS cp_owner_stuck_ready(id boolean PRIMARY KEY CHECK(id));`,
  `CREATE OR REPLACE FUNCTION cp_fold_stuck_row() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF TG_OP='INSERT' THEN
      INSERT INTO cp_owner_stuck_counts VALUES(NEW.storage_state,NEW.st,NEW.place,NEW.cause_key,NEW.from_at,NEW.until_at,1)
        ON CONFLICT(storage_state,st,place,cause_key,from_at,until_at) DO UPDATE SET n=cp_owner_stuck_counts.n+1;
      RETURN NEW;
    END IF;
    UPDATE cp_owner_stuck_counts SET n=n-1 WHERE storage_state=OLD.storage_state AND st=OLD.st AND place=OLD.place
      AND cause_key=OLD.cause_key AND from_at=OLD.from_at AND until_at=OLD.until_at;
    DELETE FROM cp_owner_stuck_counts WHERE storage_state=OLD.storage_state AND st=OLD.st AND place=OLD.place
      AND cause_key=OLD.cause_key AND from_at=OLD.from_at AND until_at=OLD.until_at AND n=0;
    RETURN OLD;
  END $$;`,
  `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='cp_stuck_row_count' AND tgrelid='cp_owner_stuck_rows'::regclass) THEN
    CREATE TRIGGER cp_stuck_row_count AFTER INSERT OR DELETE ON cp_owner_stuck_rows FOR EACH ROW EXECUTE FUNCTION cp_fold_stuck_row();
  END IF; END $$;`,
  `CREATE OR REPLACE FUNCTION cp_project_owner_stuck() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF TG_OP='UPDATE' AND OLD.index_segments IS NOT DISTINCT FROM NEW.index_segments AND OLD.state_code=NEW.state_code THEN RETURN NEW; END IF;
    IF TG_OP<>'INSERT' THEN DELETE FROM cp_owner_stuck_rows WHERE owner_id=OLD.id; END IF;
    IF TG_OP<>'DELETE' THEN
      INSERT INTO cp_owner_stuck_rows(${COLUMNS}) WITH source AS (
        SELECT NEW.id AS owner_id,ordinality::integer AS slot,NEW.state_code AS storage_state,${STUCK_FIELDS}
        FROM jsonb_array_elements(NEW.index_segments) WITH ORDINALITY AS segments(x,ordinality) WHERE ${STUCK_TEST}
      ) ${SELECT_STUCK};
      RETURN NEW;
    END IF;
    RETURN OLD;
  END $$;`,
  `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='cp_owner_stuck_projection' AND tgrelid='cp_owner_assignment_rows'::regclass) THEN
    CREATE TRIGGER cp_owner_stuck_projection AFTER INSERT OR UPDATE OR DELETE ON cp_owner_assignment_rows FOR EACH ROW EXECUTE FUNCTION cp_project_owner_stuck();
  END IF; END $$;`,
];

/** One server-local conversion; no assignment or source document is downloaded by a migration. */
export const OWNER_STUCK_COUNTS_BACKFILL_DDL = `DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM cp_owner_stuck_ready WHERE id=true) THEN
    LOCK TABLE cp_owner_assignment_rows IN SHARE ROW EXCLUSIVE MODE;
    DELETE FROM cp_owner_stuck_rows;
    INSERT INTO cp_owner_stuck_rows(${COLUMNS}) WITH source AS (
      SELECT s.id AS owner_id,ordinality::integer AS slot,s.state_code AS storage_state,${STUCK_FIELDS}
      FROM cp_owner_assignment_rows s CROSS JOIN LATERAL jsonb_array_elements(s.index_segments) WITH ORDINALITY AS segments(x,ordinality)
      WHERE s.state_code IS NOT NULL AND ${STUCK_TEST}
    ) ${SELECT_STUCK};
    INSERT INTO cp_owner_stuck_ready VALUES(true);
  END IF;
END $$;`;

const ACTIVE = "from_at<=$2::timestamptz AND until_at>$2::timestamptz";
const STORAGE = "($3::text IS NULL OR storage_state=$3)";
const SCOPE = "($1='us' OR $1=place OR (left($1,3)='st:' AND st=substring($1 FROM 4)) OR (left($1,4)='geo:' AND st=substring($1 FROM 5 FOR 2)))";
const SCORE = "base_score+least(60,greatest(0,coalesce(floor(extract(epoch FROM ($2::timestamptz-age_at))/86400),0)))";
const ROW_JSON = (alias:string) => `jsonb_build_object('id',${alias}.id,'state',${alias}.state,'lane',${alias}.lane,'owner',${alias}.owner,'blocker',${alias}.blocker,
  'label',${alias}.label,'subject_name',${alias}.subject_name,'state_code',${alias}.state_code,'overdue',${alias}.overdue,'band',${alias}.band,
  'waiting_since',${alias}.waiting_since,'eligible_at',${alias}.eligible_at,'last_activity_at',${alias}.last_activity_at,
  'next_action',${alias}.next_action,'assignment_keys',${alias}.assignment_keys)`;

export function ownerStuckSummarySql(limit:number): string {
  if(!Number.isSafeInteger(limit)||limit<0||limit>300)throw Error('Stuck rows limit must be between 0 and 300');
  return `WITH current_counts AS MATERIALIZED(SELECT st,place,cause_key,n FROM cp_owner_stuck_counts WHERE ${ACTIVE} AND ${STORAGE}),
    scoped_counts AS MATERIALIZED(SELECT st,place,cause_key,n FROM current_counts WHERE ${SCOPE}),
    grouped AS (SELECT cause_key,sum(n)::bigint AS n,array_agg(DISTINCT st) FILTER(WHERE st<>'') AS states FROM scoped_counts GROUP BY cause_key),
    shown AS MATERIALIZED(SELECT id,state,lane,owner,blocker,label,subject_name,state_code,overdue,band,waiting_since,eligible_at,last_activity_at,next_action,assignment_keys,${SCORE} AS score FROM cp_owner_stuck_rows WHERE ${ACTIVE} AND ${STORAGE} AND ${SCOPE} ORDER BY score DESC,id LIMIT ${limit}),
    samples AS (SELECT g.cause_key,g.n,g.states,p.sample FROM grouped g CROSS JOIN LATERAL (
      SELECT jsonb_build_object('id',id,'state',state,'owner',owner,'blocker',blocker,'overdue',overdue) AS sample FROM cp_owner_stuck_rows r
      WHERE r.cause_key=g.cause_key AND ${ACTIVE} AND ${STORAGE} AND ${SCOPE} ORDER BY ${SCORE} DESC,id LIMIT 1) p)
    SELECT coalesce((SELECT sum(n) FROM scoped_counts),0)::integer AS total,
      (SELECT updated_at FROM cp_owner_snapshots WHERE id='current') AS published_at,
      coalesce((SELECT jsonb_agg(${ROW_JSON('shown')} ORDER BY score DESC,id) FROM shown),'[]'::jsonb) AS rows,
      coalesce((SELECT jsonb_agg(jsonb_build_object('sample',sample,'count',n,'states',coalesce(states,ARRAY[]::text[])) ORDER BY n DESC,cause_key) FROM samples),'[]'::jsonb) AS groups,
      coalesce((SELECT jsonb_object_agg(st,n) FROM (SELECT st,sum(n)::integer AS n FROM current_counts WHERE st<>'' GROUP BY st) s),'{}'::jsonb) AS states,
      coalesce((SELECT jsonb_object_agg(place,n) FROM (SELECT place,sum(n)::integer AS n FROM current_counts GROUP BY place) p),'{}'::jsonb) AS places`;
}

export async function readOwnerStuckSummary(sql:Sql,limit:number,scope:string,nowIso=new Date().toISOString()):Promise<Record<string,unknown>> {
  const state=/^(?:st:|geo:)([a-z]{2})(?:[.:]|$)/.exec(scope)?.[1]??null;
  const [row]=await sql.query(ownerStuckSummarySql(limit),[scope,nowIso,state]) as Record<string,unknown>[];
  return row;
}

/** The same bounded work rows without counts or cause samples that a decision strip never displays. */
export async function readOwnerStuckRows(sql:Sql,limit:number,scope:string,nowIso=new Date().toISOString()):Promise<readonly Record<string,unknown>[]> {
  if(!Number.isSafeInteger(limit)||limit<0||limit>300)throw Error('Stuck rows limit must be between 0 and 300');
  const state=/^(?:st:|geo:)([a-z]{2})(?:[.:]|$)/.exec(scope)?.[1]??null;
  const [row]=await sql.query(`WITH shown AS MATERIALIZED(
    SELECT id,state,lane,owner,blocker,label,subject_name,state_code,overdue,band,waiting_since,eligible_at,last_activity_at,next_action,assignment_keys,${SCORE} AS score
    FROM cp_owner_stuck_rows WHERE ${ACTIVE} AND ${STORAGE} AND ${SCOPE} ORDER BY score DESC,id LIMIT ${limit})
    SELECT coalesce(jsonb_agg(${ROW_JSON('shown')} ORDER BY score DESC,id),'[]'::jsonb) AS rows FROM shown`,[scope,nowIso,state]) as {rows:Record<string,unknown>[]}[];
  return row.rows;
}

export async function readOwnerDistrictStuckCounts(sql:Sql,districts:readonly {readonly state:string;readonly placeKey:string;readonly zips:readonly string[]}[],nowIso=new Date().toISOString()):Promise<ReadonlyMap<string,number>> {
  if(!districts.length)return new Map();
  const state=districts[0].state;
  if(!/^[a-z]{2}$/.test(state)||districts.some(d=>d.state!==state))throw Error('Districts must share one state');
  const mapping=Object.fromEntries(districts.map(d=>[d.placeKey,d.zips]));
  const rows=await sql.query(`SELECT key,coalesce(sum(c.n),0)::integer AS n FROM jsonb_each($1::jsonb) districts(key,zips)
    LEFT JOIN cp_owner_stuck_counts c ON c.storage_state=$2 AND c.st=$2 AND c.place LIKE 'geo:'||$2||'.zcta.%'
      AND zips ? substring(c.place FROM 13) AND c.from_at<=$3::timestamptz AND c.until_at>$3::timestamptz GROUP BY key`,[JSON.stringify(mapping),state,nowIso]) as {key:string;n:number}[];
  return new Map(rows.map(row=>[row.key,Number(row.n)]));
}
