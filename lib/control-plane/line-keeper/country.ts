import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import { US_STATES } from "../readiness/catalog.ts";

export interface CountryScore { readonly state:string; readonly score:number|null; readonly measuredAt:string; readonly error:string|null;readonly freshness?:{readonly n:number;readonly of:number} }
const PREFIX="line-keeper:country:";
const ids=US_STATES.map(s=>PREFIX+s.code);
/** No civic records or score inputs are downloaded by the Admin reader. */
export const COUNTRY_SQL=`SELECT value - 'capture' - 'inputs' AS value FROM cp_owner_snapshots WHERE id=ANY($1::text[])`;
export async function readCountryScores(sql:Sql):Promise<readonly CountryScore[]> {
  const rows=await boundedQuery(sql,{operation:"line-keeper.country-scores",callClass:"PAGE"},COUNTRY_SQL,[ids]) as {value:CountryScore}[];
  return rows.map(r=>r.value);
}
