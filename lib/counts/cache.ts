import { assertWriteAllowed } from "../db/write-guard.ts";
import { CIVIC_DATA_PROMOTION_OPERATION } from "../civic-data/production-write.ts";
import { neon } from "@neondatabase/serverless";
import type { ReaderCacheScope } from "../reader/cache.ts";
/** Publication already committed. A measurement failure is visible and cannot withhold that fact. */
export async function countReaderInvalidation(scope:ReaderCacheScope,purged:boolean) {
  const url=process.env.DATABASE_URL;
  if(!url)return;
  const states=scope.national||scope.nationalPeople?["US"]:scope.states??[];
  if(!states.length)return;
  try {
    assertWriteAllowed(CIVIC_DATA_PROMOTION_OPERATION);
    await neon(url).query(`SELECT count_hour_add(state,'Reader cache','cache',0,1,$2::bigint)
      FROM unnest($1::text[]) AS s(state)`,[[...new Set(states)],purged?1:0]);
  } catch(error) {
    console.warn("Hourly reader publication counts could not be saved",{detail:error instanceof Error?error.message:String(error)});
  }
}
