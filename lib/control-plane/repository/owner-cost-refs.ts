import type { Sql } from "./pg-store.ts";
import type { AggregateRepository } from "./types.ts";

export type OwnerCostRefKind = "orphan" | "unassigned";
export interface OwnerCostRef { readonly kind: OwnerCostRefKind; readonly id: string }
export interface OwnerCostRefs {
  matching(kind: OwnerCostRefKind, ids: readonly string[]): Promise<readonly string[]>;
  add(orphans: readonly string[], unassigned: readonly string[]): Promise<void>;
  replace(orphans: readonly string[], unassigned: readonly string[]): Promise<void>;
}
export const OWNER_COST_REFS_DDL = `CREATE TABLE IF NOT EXISTS cp_owner_cost_refs (
  kind text NOT NULL CHECK(kind IN ('orphan','unassigned')),id text NOT NULL,PRIMARY KEY(kind,id))`;
export const OWNER_COST_REFS_SEED_DDL = `INSERT INTO cp_owner_cost_refs(kind,id)
  SELECT r.kind,ref.id FROM cp_owner_snapshots s CROSS JOIN LATERAL
    (VALUES ('orphan',s.value #> '{costs,orphans}'),('unassigned',s.value #> '{costs,unassigned}')) r(kind,refs)
  CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(r.refs,'[]'::jsonb)) ref(id)
  WHERE s.id='totals' ON CONFLICT DO NOTHING`;

export function pgOwnerCostRefs(sql: Sql): OwnerCostRefs {
  const add = async (orphans: readonly string[], unassigned: readonly string[]) => {
    for (const [kind,ids] of [["orphan",orphans],["unassigned",unassigned]] as const) if (ids.length) {
      await sql.query("INSERT INTO cp_owner_cost_refs(kind,id) SELECT $1,id FROM unnest($2::text[]) id ON CONFLICT DO NOTHING",[kind,ids]);
    }
  };
  return {
    async matching(kind,ids) { return ids.length ? (await sql.query("SELECT id FROM cp_owner_cost_refs WHERE kind=$1 AND id=ANY($2::text[]) ORDER BY id",[kind,ids]) as {id:string}[]).map(row=>row.id) : []; },
    add,
    async replace(orphans,unassigned) {
      const apply = async (connection: Sql) => {
        await connection.query("BEGIN");
        try {
          await connection.query("DELETE FROM cp_owner_cost_refs");
          for (const [kind,ids] of [["orphan",orphans],["unassigned",unassigned]] as const) if(ids.length)
            await connection.query("INSERT INTO cp_owner_cost_refs(kind,id) SELECT $1,id FROM unnest($2::text[]) id",[kind,ids]);
          await connection.query("COMMIT");
        } catch(error) { await connection.query("ROLLBACK");throw error; }
      };
      if(sql.withPinnedConnection) await sql.withPinnedConnection(apply); else await apply(sql);
    },
  };
}

/** Local stores keep the same keyed markers, with nulls as fixture tombstones. */
export function storedOwnerCostRefs(store: AggregateRepository<OwnerCostRef|null>): OwnerCostRefs {
  const key=(kind:OwnerCostRefKind,id:string)=>JSON.stringify([kind,id]);
  const add=async(orphans:readonly string[],unassigned:readonly string[])=>{
    for(const [kind,ids] of [["orphan",orphans],["unassigned",unassigned]] as const) for(const id of new Set(ids)){
      const marker=key(kind,id),prior=await store.read(marker),value={kind,id},now=new Date().toISOString();
      if(prior===null) await store.put(marker,value,now); else if(prior.value===null) await store.compareAndSet(marker,prior.revision,value,now);
    }
  };
  return {
    async matching(kind,ids){const rows=await Promise.all([...new Set(ids)].map(id=>store.read(key(kind,id))));return rows.flatMap(row=>row?.value?[row.value.id]:[]).sort();},
    add,
    async replace(orphans,unassigned){for(const row of await store.list()) if(row.value)await store.compareAndSet(row.id,row.revision,null,new Date().toISOString());await add(orphans,unassigned);},
  };
}
