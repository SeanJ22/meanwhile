import type { LiveFactCatalog } from "../control-plane/workers/live-audit.ts";
import { readPassCursor, writePassCursor } from "./db.ts";
import type { Query } from "./publish.ts";

/** Rotate over live scalar facts, reading only one state's next sample pool. */
export function factAuditCatalog(query: Query): LiveFactCatalog {
  return {
    areas: async () => (await query(`SELECT DISTINCT coalesce(e.state,'US') AS state FROM entity e
      WHERE EXISTS(SELECT 1 FROM fact f WHERE f.entity_id=e.id AND f.status='live' AND f.source_copy_id IS NOT NULL) ORDER BY state`)).map(row=>`facts:${row.state}`),
    factsInArea: async (area,limit) => {
      if (!area.startsWith("facts:")) return [];
      const name = `audit:${area}`;
      const cursor = Number(await readPassCursor(query,name) ?? 0);
      const read = (after:number) => query(`SELECT f.id,f.field,f.value_text,f.checked_at,s.url,e.state
        FROM fact f JOIN entity e ON e.id=f.entity_id JOIN source_copy s ON s.id=f.source_copy_id
        WHERE f.status='live' AND coalesce(e.state,'US')=$1 AND f.id>$2 ORDER BY f.id LIMIT $3`,[area.slice(6),after,limit]);
      let rows = await read(cursor);
      if (!rows.length && cursor) rows = await read(0);
      if (rows.length) await writePassCursor(query,name,String(rows.at(-1)!.id));
      return rows.map(row=>({id:`fact-store:${row.id}`,family:"fact-store",area,sourceUrl:String(row.url),
        record:{id:String(row.id),[String(row.field)]:row.value_text},verifiedAt:new Date(row.checked_at as string).toISOString()}));
    },
  };
}
