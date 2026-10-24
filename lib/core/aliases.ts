import type { Query } from "../facts/publish.ts";
import { stateName } from "../facts/entity-read.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";

export interface AliasCount { readonly state: string; readonly label: string; readonly n: number }
export const ALIAS_STATES = [...new Set(Object.values(FIPS_TO_STATE).map(row => row.postal)), "US"].sort();

/** Aggregate on the server; Admin receives counts, including zero for every state and territory. */
export async function readAliasCounts(query: Query): Promise<readonly AliasCount[]> {
  const rows = await query(`WITH counts AS (
    SELECT coalesce(e.state,'US') AS state,count(*)::int AS n
    FROM entity_external_id x JOIN entity e ON e.id=x.entity_id GROUP BY 1
  ) SELECT state,coalesce(n,0) AS n FROM unnest($1::text[]) state LEFT JOIN counts USING(state) ORDER BY state`, [ALIAS_STATES]);
  return rows.map(row => ({ state: String(row.state), label: stateName(String(row.state)) ?? "National", n: Number(row.n) }));
}
