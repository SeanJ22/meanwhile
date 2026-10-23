import { lookupIn, type CentroidTable, type ZctaCentroid } from "./zcta-core.ts";
import type { PostalTable } from "./postal-core.ts";

/** The same held lookup values, projected once at build time into regional browser assets. */
export function readerZipStarts(centroids: CentroidTable, postal: PostalTable) {
  const shards = Array.from({ length: 100 }, () => ({ locations: {} as Record<string, ZctaCentroid> }));
  for (const zip of new Set([...Object.keys(centroids), ...Object.keys(postal)])) {
    const point = lookupIn(centroids, zip, postal);
    if (point) shards[Number(zip.slice(0, 2))].locations[zip] = point;
  }
  return shards;
}
