import { zipDivisionEntry } from "../geo/zip-division-index.ts";

/**
 * Every division whose territory reaches inside this zip, unioned with the
 * divisions containing the zip's centroid.
 *
 * @param zip Five digits. Anything else returns `pointDivisionIds` unchanged.
 * @param pointDivisionIds What the centroid resolved to. Always included.
 */
export async function divisionIdsForZipArea(
  zip: string | null,
  pointDivisionIds: readonly string[],
): Promise<string[]> {
  const out = new Set(pointDivisionIds);
  if (!zip || !/^\d{5}$/.test(zip)) return [...out];
  const entry = await zipDivisionEntry(zip);
  for (const id of entry?.ids ?? []) out.add(id);
  return [...out];
}
