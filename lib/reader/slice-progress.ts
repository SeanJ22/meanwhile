import type { Query } from "../facts/publish.ts";

/** How many places have their slices. Two counts; no slice is opened. A place is built once its first card is, since the five are built together. */
export async function sliceProgress(query: Query): Promise<{ readonly built: number; readonly places: number }> {
  const [row] = await query(`SELECT (SELECT count(*) FROM place_slice WHERE card='governs')::text AS built,(SELECT count(*) FROM entity WHERE kind='place')::text AS places`);
  return { built: Number(row?.built ?? 0), places: Number(row?.places ?? 0) };
}
