import { neon } from "@neondatabase/serverless";
import { controlPlaneUrlFromEnv, type Sql } from "./repository/pg-store.ts";
import type { ControlPlaneRepositories, Persisted } from "./repository/types.ts";
import { boundedQuery } from "./repository/request-bounds.ts";
import type { OwnerSnapshotTotals } from "./owner-snapshot-totals.ts";
import type { ServedReaderReadback } from "./served-reader.ts";

export const readbackStateId=(state:string)=>`readback:${state.toLowerCase()}`;
const query=():Sql|null=>{const url=controlPlaneUrlFromEnv();return url?neon(url):null;};

/** Strip the replaced country publication array in PostgreSQL before a legacy totals row crosses the connection. */
export async function readOwnerTotals(repos:ControlPlaneRepositories,sql:Sql|null=query()):Promise<Persisted<OwnerSnapshotTotals>|null>{
  if(!sql)return repos.ownerSnapshotTotals.read("totals");
  const rows=await boundedQuery(sql,{operation:"cp_owner_snapshots.ownerTotals",callClass:"POINT"},`SELECT id,revision,updated_at,
    CASE WHEN jsonb_typeof(value->'assignments'->'states')='object' THEN jsonb_set(value,'{assignments,states}',
      (SELECT coalesce(jsonb_object_agg(s.key,(s.value-'publications') || CASE WHEN jsonb_typeof(s.value->'publications')='array'
        THEN jsonb_build_object('publicationIds',(SELECT coalesce(jsonb_agg(p->'id'),'[]'::jsonb) FROM jsonb_array_elements(s.value->'publications') p)) ELSE '{}'::jsonb END),'{}'::jsonb)
        FROM jsonb_each(value->'assignments'->'states') s)) ELSE value END AS value
    FROM cp_owner_snapshots WHERE id='totals'`,[]) as readonly {id:string;revision:number;updated_at:string;value:OwnerSnapshotTotals}[];
  const row=rows[0];return row?{...row,updatedAt:row.updated_at}:null;
}

/** A state's witnesses, preferring its shard. Old national witnesses are filtered in PostgreSQL by exact work identity or state-bearing reader identity. */
export async function readOwnerStateReadback(repos:ControlPlaneRepositories,state:string,sql:Sql|null=query()):Promise<ServedReaderReadback|null>{
  const own=await repos.ownerSnapshotStateTotals.readNarrowed(readbackStateId(state),{servedReader:true});
  const held=(own?.value as {servedReader?:ServedReaderReadback}|undefined)?.servedReader;
  if(held)return held;
  if(!sql)return null;
  const code=state.toLowerCase();
  const rows=await boundedQuery(sql,{operation:"cp_owner_snapshots.stateReadback",callClass:"POINT"},`SELECT snapshot.value->'servedReaderReadback'->>'checkedAt' AS checked_at,
    coalesce(jsonb_agg(witness) FILTER(WHERE witness IS NOT NULL),'[]'::jsonb) AS witnesses
    FROM cp_owner_snapshots snapshot LEFT JOIN LATERAL (
      SELECT w AS witness FROM jsonb_array_elements(CASE WHEN jsonb_typeof(snapshot.value->'servedReaderReadback'->'witnesses')='array' THEN snapshot.value->'servedReaderReadback'->'witnesses' ELSE '[]'::jsonb END) w
      WHERE lower(w->>'stateCode')=$1 OR lower(coalesce(w->>'readerKey','')) ~ $2
        OR EXISTS(SELECT 1 FROM cp_work_items item WHERE item.id=w->>'itemId' AND
          (lower(item.value->'autonomousPlan'->>'jurisdiction')=$1 OR lower(coalesce(item.value->>'subject','')) ~ $2))
        OR EXISTS(SELECT 1 FROM cp_owner_snapshots totals,jsonb_each(totals.value->'groups') g,
          jsonb_array_elements(CASE WHEN jsonb_typeof(g.value->'publications')='array' THEN g.value->'publications' ELSE '[]'::jsonb END) p
          WHERE totals.id=$3 AND p->>'id'=w->>'itemId')
    ) selected ON true WHERE snapshot.id='current' GROUP BY snapshot.value->'servedReaderReadback'->>'checkedAt'`,
    [code,`(^|[:/ ])${code}([:/ ]|$)|state[:/-]${code}([:/ -]|$)|(^|[:/ ])ballot-${code}-`,`totals:${code}`]) as readonly {checked_at:string|null;witnesses:ServedReaderReadback["witnesses"]}[];
  return rows[0]?.checked_at?{checkedAt:rows[0].checked_at,witnesses:rows[0].witnesses,errors:[]}:null;
}
export async function writeOwnerStateReadback(repos:ControlPlaneRepositories,state:string,read:ServedReaderReadback,now:string):Promise<void>{
  const id=readbackStateId(state),prior=await repos.ownerSnapshotStateTotals.read(id);
  const value={builtAt:now,groups:{},places:{},lists:{},servedReader:read};
  if(prior)await repos.ownerSnapshotStateTotals.compareAndSet(id,prior.revision,value,now);
  else await repos.ownerSnapshotStateTotals.put(id,value,now);
}
