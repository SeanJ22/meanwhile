import type { Sql } from "../pg-store.ts";
import { migrateLinkingPages } from "./DB-03A.ts";

const READ_HASH = "md5(coalesce(value#>>'{config,votingSource}','')||chr(31)||coalesce(value#>>'{config,votingMappings}',''))";

/**
 * Runs that read voting doors before DB-03A moved their pages wrote the pages back on Oct 25, 10:11:58–10:12:21 UTC (283 doors,
 * 72 MB). On 213 of them the page sits beside the newer reference discovery saved since, which stays; DB-03A moves the rest.
 */
export async function moveRetiredDoorPages(control: Sql, reader: Sql): Promise<string> {
  const keep = (source: Record<string, unknown>) => { const { officialLinkingPage: _retired, ...rest } = source; return source.linkingPage ? rest : source; };
  let kept = 0;
  for (let after = ""; ;) {
    const rows = await control.query(`SELECT id,value#>>'{config,votingSource}' AS source,value#>>'{config,votingMappings}' AS mappings,${READ_HASH} AS read_hash
      FROM cp_doors WHERE id>$1 AND value#>>'{config,votingSource}' IS NOT NULL AND value->>'config' LIKE '%officialLinkingPage%' ORDER BY id LIMIT 20`, [after]) as
      { id: string; source: string; mappings: string | null; read_hash: string }[];
    if (!rows.length) break;
    for (const row of rows) {
      const source = JSON.stringify(keep(JSON.parse(row.source))), mappings = row.mappings && JSON.stringify(JSON.parse(row.mappings).map(keep));
      if (source === row.source && mappings === row.mappings) continue;
      // A door written since it was read is left to DB-03A, which reads it again under its lock.
      kept += (await control.query(`UPDATE cp_doors SET value=jsonb_set(value,'{config}',(value->'config')||jsonb_build_object('votingSource',$2::text)||
        CASE WHEN $3::text IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('votingMappings',$3::text) END),revision=revision+1,updated_at=now()
        WHERE id=$1 AND ${READ_HASH}=$4 RETURNING id`, [row.id, source, mappings, row.read_hash]) as unknown[]).length;
    }
    after = rows.at(-1)!.id;
  }
  return `${kept} voting doors kept their newer reference; ${await migrateLinkingPages(control, reader)}`;
}
