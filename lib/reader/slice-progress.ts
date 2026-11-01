import type { Query } from "../facts/publish.ts";
import { LAST_CARD } from "./slices.ts";

/** How many places have their slices. Two counts; no slice is opened. A place is built once its last card is, since the cards are built together. */
export async function sliceProgress(query: Query): Promise<{ readonly built: number; readonly places: number }> {
  const [row] = await query(`SELECT (SELECT count(*) FROM place_slice s JOIN entity e ON e.id=s.place_id AND e.kind='place' WHERE s.card=$1)::text AS built,(SELECT count(*) FROM entity WHERE kind='place')::text AS places`, [LAST_CARD]);
  return { built: Number(row?.built ?? 0), places: Number(row?.places ?? 0) };
}
