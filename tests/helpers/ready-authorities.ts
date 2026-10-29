import type {PGlite} from '@electric-sql/pglite';
import {buildCanonicalStatement} from '../../lib/reader/place-builder.ts';
import {authorityPageId} from '../../lib/reader/page-authorities.ts';
import {CivicPayloadParts} from '../../lib/civic-data/payload-parts.ts';

/** Test publication: expand the real builder's selected source rows, then save the ready page. */
export async function writeReadyAuthorities(pg:PGlite,keys:readonly string[],pageId?:string) {
  const statement=buildCanonicalStatement(keys);
  const loaded=(await pg.query<Record<string,unknown>>(statement.text,[...statement.params])).rows;
  const parts=new CivicPayloadParts({existing:async()=>[],write:async()=>{},read:async()=>{throw Error('BUILDER_PART_MISSING');}});
  const rows=await parts.loadOwned(loaded.filter(row=>row.row_kind==='promotion'),Object.fromEntries(loaded.filter(row=>row.row_kind==='part')
    .map(row=>[String(row.part_hash),row.part_payload]))) as Record<string,unknown>[];
  const pages=new Map<string,Record<string,unknown>>();
  for(const row of rows){const id=pageId??authorityPageId(String(row.key)),page=pages.get(id)??{};page[String(row.key)]=row;pages.set(id,page);}
  for(const [id,authorities] of pages){
    await pg.query("INSERT INTO entity(id,kind,name) VALUES($1,'place',$1) ON CONFLICT DO NOTHING",[id]);
    await pg.query(`INSERT INTO place_page(place_id,version,built_at,body,history_body,context) VALUES($1,1,clock_timestamp(),'{}','{}',$2)
      ON CONFLICT(place_id) DO UPDATE SET version=place_page.version+1,context=place_page.context||excluded.context`,
      [id,JSON.stringify({authorityFormat:1,authorities})]);
  }
}

/** Read-boundary mocks accept a keyed page section or a native keyed-fact source list. */
export function canonicalStatementKeys(value:unknown):string[] {
  if(Array.isArray(value))return value as string[];
  if(typeof value==='string'&&value.startsWith('['))return (JSON.parse(value) as {key:string}[]).map(row=>row.key);
  return [String(value)];
}
