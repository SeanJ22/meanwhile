import { isPlaceHistory, type PlaceHistoryPoint } from "../../coverage/place-history.ts";
import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import { versionedRowsFor } from "../../db/versioned-rows.ts";

export const PLACE_HISTORY_SQL = "value->'placeHistory'->$3::text";

export async function readPlaceHistory(sql: Sql, placeKey: string): Promise<readonly PlaceHistoryPoint[]> {
  const row = await versionedRowsFor(sql).one(async(text,params)=>await boundedQuery(sql,
    {operation:"cp_owner_snapshots.place_history",callClass:"POINT"},text,params),"cp_owner_snapshots","current",PLACE_HISTORY_SQL,undefined,[placeKey]);
  const points = row?.value;
  return isPlaceHistory(points) ? points : [];
}
