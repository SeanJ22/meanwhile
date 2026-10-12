import { zipDivisionEntry } from "../geo/zip-division-index.ts";
import type { GeographySelection } from "../census-geography/selection.ts";

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
  selection?: GeographySelection,
): Promise<string[]> {
  const out = new Set(pointDivisionIds);
  if (!zip || !/^\d{5}$/.test(zip)) return [...out];
  const entry = await zipDivisionEntry(zip, selection);
  // A qualified area family supersedes stale centroid assignments for that
  // family. The centroid remains orientation data for unrelated local layers.
  for (const family of ["cd", "sldu", "sldl"]) {
    const pattern = new RegExp(`/${family}:[^/]+$`);
    for (const id of out) if (pattern.test(id)) out.delete(id);
  }
  for (const id of entry?.ids ?? []) out.add(id);
  return [...out];
}
