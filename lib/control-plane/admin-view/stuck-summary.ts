import { blockerCauseKeySql, type StuckRowLike } from "./blocker-causes.ts";
import { US_STATES } from "../readiness/catalog.ts";
import type { Sql } from "../repository/pg-store.ts";

export interface StuckCounts { readonly states: Readonly<Record<string,number>>; readonly places: Readonly<Record<string,number>> }
export interface StuckGroup { readonly sample: StuckRowLike; readonly count: number; readonly states: readonly string[] }
export interface StuckSummary { readonly total:number; readonly groups:readonly StuckGroup[]; readonly counts:StuckCounts }

/** State/place identities follow stateOfRow and placeKeyOfRow, using the same stored fields. */
function stateSql() {
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

export function stuckSummarySql(indexSql:string,limit:number):string {
  return `WITH candidates AS MATERIALIZED (${indexSql}),
    located AS MATERIALIZED (SELECT *,${stateSql()} AS st,
      coalesce((SELECT 'geo:'||lower(state_code)||'.'||CASE WHEN k ~ '^zcta:' THEN 'zcta' ELSE 'county' END||'.'||split_part(k,'/',2)
        FROM jsonb_array_elements_text(coalesce(assignment_keys,'[]'::jsonb)) WITH ORDINALITY AS keys(k,n)
        WHERE coalesce(state_code,'')<>'' AND k ~ '^(zcta|county):\\d{4}/\\d{5}$' ORDER BY n LIMIT 1),
        CASE WHEN state_code ~* '^[a-z]{2}$' THEN 'st:'||lower(state_code) ELSE 'us' END) AS place
      FROM candidates),
    scoped AS MATERIALIZED (SELECT * FROM located WHERE $1='us' OR $1=place OR
      (left($1,3)='st:' AND st=substring($1 FROM 4)) OR (left($1,4)='geo:' AND st=substring($1 FROM 5 FOR 2))),
    ranked AS MATERIALIZED (SELECT *,${blockerCauseKeySql('blocker','state')} AS cause_key,
      (CASE WHEN overdue THEN 3 WHEN state IN ('BLOCKED','FAILED') THEN 2 ELSE 1 END)*100 + coalesce((4-band)*30,0) +
      least(60,greatest(0,coalesce(floor(extract(epoch FROM (now()-least(
        CASE WHEN pg_input_is_valid(waiting_since,'timestamp with time zone') THEN waiting_since::timestamptz END,
        CASE WHEN pg_input_is_valid(eligible_at,'timestamp with time zone') THEN eligible_at::timestamptz END,
        CASE WHEN pg_input_is_valid(last_activity_at,'timestamp with time zone') THEN last_activity_at::timestamptz END)))/86400),0))) AS score FROM scoped),
    shown AS MATERIALIZED (SELECT * FROM ranked ORDER BY score DESC,id LIMIT ${limit}),
    grouped AS (SELECT cause_key,count(*)::int AS n,array_agg(DISTINCT st) FILTER(WHERE st IS NOT NULL) AS states FROM ranked GROUP BY cause_key),
    samples AS (SELECT DISTINCT ON(cause_key) cause_key,jsonb_build_object('id',id,'state',state,'owner',owner,'blocker',blocker,'overdue',overdue) AS sample
      FROM ranked ORDER BY cause_key,score DESC,id)
    SELECT (SELECT count(*)::int FROM ranked) AS total,
      (SELECT updated_at FROM cp_owner_snapshots WHERE id='current') AS published_at,
      coalesce((SELECT jsonb_agg(to_jsonb(shown)-'score'-'cause_key'-'st'-'place' ORDER BY score DESC,id) FROM shown),'[]'::jsonb) AS rows,
      coalesce((SELECT jsonb_agg(jsonb_build_object('sample',sample,'count',n,'states',coalesce(states,ARRAY[]::text[])) ORDER BY n DESC,cause_key)
        FROM grouped JOIN samples USING(cause_key)),'[]'::jsonb) AS groups,
      coalesce((SELECT jsonb_object_agg(st,n) FROM (SELECT st,count(DISTINCT id)::int AS n FROM located WHERE st IS NOT NULL GROUP BY st) s),'{}'::jsonb) AS states,
      coalesce((SELECT jsonb_object_agg(place,n) FROM (SELECT place,count(DISTINCT id)::int AS n FROM located GROUP BY place) p),'{}'::jsonb) AS places`;
}

export async function readStuckSummary(sql:Sql,indexSql:string,limit:number,scope:string) {
  const [row]=await sql.query(stuckSummarySql(indexSql,limit),[scope]) as Record<string,unknown>[];
  return row;
}

/** Districts may share ZIPs: count distinct work IDs inside each district in PostgreSQL. */
export async function readDistrictStuckCounts(sql:Sql,indexSql:string,districts:readonly import('./v6-national-geography.ts').DistrictInfo[]):Promise<ReadonlyMap<string,number>> {
  if(!districts.length)return new Map();
  const state=districts[0].state;
  if(!/^[a-z]{2}$/.test(state)||districts.some(d=>d.state!==state))throw Error('Districts must share one state');
  const index=indexSql.replace("s.id LIKE 'current:%'",`s.id = 'current:${state}'`);
  const mapping=Object.fromEntries(districts.map(d=>[d.placeKey,d.zips]));
  const rows=await sql.query(`WITH candidates AS MATERIALIZED (${index}),located AS (
    SELECT id,(SELECT split_part(k,'/',2) FROM jsonb_array_elements_text(coalesce(assignment_keys,'[]'::jsonb)) WITH ORDINALITY AS keys(k,n)
      WHERE k ~ '^(zcta|county):\\d{4}/\\d{5}$' ORDER BY n LIMIT 1) AS zip,
      (SELECT k FROM jsonb_array_elements_text(coalesce(assignment_keys,'[]'::jsonb)) WITH ORDINALITY AS keys(k,n)
      WHERE k ~ '^(zcta|county):\\d{4}/\\d{5}$' ORDER BY n LIMIT 1) AS assignment FROM candidates WHERE lower(state_code)=$2)
    SELECT key,count(DISTINCT id)::int AS n FROM jsonb_each($1::jsonb) districts(key,zips)
      LEFT JOIN located ON assignment LIKE 'zcta:%' AND zips ? zip GROUP BY key`,[JSON.stringify(mapping),state]) as {key:string;n:number}[];
  return new Map(rows.map(row=>[row.key,Number(row.n)]));
}
