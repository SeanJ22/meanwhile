// The import attribute lets this module load under `node --test` as well as the bundler.
import centroidFile from "./zcta-centroids.json" with { type: "json" };
import postalFile from "./postal-zips.json" with { type: "json" };
import type { PostalTable } from "./postal-core.ts";
import {
  isWellFormedZip,
  lookupIn,
  nearestIn,
  resolveIn,
  type CentroidTable,
  type ZctaCentroid,
  type ZipResolution,
} from "./zcta-core.ts";

/**
 * Zip → map coordinate, synchronously, with the whole table in the module.
 * For the server and scripts only; client components use `./zcta-table.ts`.
 *
 * Orientation only: a ZCTA crosses city, county, school district and
 * legislative lines. Anything that needs actual districts asks for a street
 * address.
 */

export type { ZctaCentroid, ZipResolution };
export { isWellFormedZip };

// JSON arrays widen to number[]; the file's contract is a pair per zip.
const CENTROIDS = centroidFile.centroids as unknown as CentroidTable;
const POSTAL = postalFile.zips as unknown as PostalTable;

/**
 * Whether every Census ZCTA is held. This does not establish USPS completeness.
 */
export const COVERAGE_IS_COMPLETE: boolean = centroidFile.complete === true;

export const CENTROID_SOURCE = {
  url: centroidFile.source,
  org: centroidFile.sourceOrg,
  vintage: centroidFile.vintage,
};

export function lookupZcta(input: string): ZctaCentroid | null {
  return lookupIn(CENTROIDS, input, POSTAL);
}

export function nearestZcta(lat: number, lng: number): ZctaCentroid | null {
  return nearestIn(CENTROIDS, lat, lng);
}

export function resolveZip(input: string): ZipResolution {
  return resolveIn(CENTROIDS, input, POSTAL);
}
