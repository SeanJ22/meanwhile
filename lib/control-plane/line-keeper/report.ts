import type { Sql } from '../repository/pg-store.ts';
import { boundedQuery } from '../repository/request-bounds.ts';
import { LINE_KEEPER_ID, type LineState } from './model.ts';
/** Admin reads two reports, without the observer's inventories, replay cache or browser runtime. */
export async function readLineReport(sql:Sql):Promise<LineState|null> {
  const [row]=await boundedQuery(sql,{operation:'line-keeper.admin-report',callClass:'POINT'},`SELECT jsonb_build_object(
    'version',value->'version','checkedAt',value->'checkedAt','seededAt',value->'seededAt',
    'hours',coalesce((SELECT jsonb_agg(h - 'pageProofs' - 'problems') FROM
      jsonb_array_elements(coalesce(value->'hours','[]'::jsonb)) WITH ORDINALITY a(h,n) WHERE n<=2),'[]'::jsonb),
    'posting',value->'posting') AS value FROM cp_owner_snapshots WHERE id=$1`,[LINE_KEEPER_ID]) as {value:LineState}[];
  return row?.value??null;
}
