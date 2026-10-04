import { isPlaceHistory, type PlaceHistoryPoint } from "../../coverage/place-history.ts";
import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";

/** One place's daily points from the published owner snapshot, selected in Postgres so only that place crosses the wire. */
export const PLACE_HISTORY_SQL = `SELECT s.value->'placeHistory'->$1 AS points FROM cp_owner_snapshots s WHERE s.id = 'current'`;

export async function readPlaceHistory(sql: Sql, placeKey: string): Promise<readonly PlaceHistoryPoint[]> {
  const rows = await boundedQuery(sql, { operation: "cp_owner_snapshots.place_history", callClass: "POINT" }, PLACE_HISTORY_SQL, [placeKey]) as readonly { readonly points?: unknown }[];
  const points = rows[0]?.points;
  return isPlaceHistory(points) ? points : [];
}
