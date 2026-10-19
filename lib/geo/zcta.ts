import { readFileSync } from "node:fs";
import { join } from "node:path";
import { postalTable } from "./postal.ts";
import { serverReaderValue } from "../reader/memory.ts";
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
 * Server and scripts only. Typed/restored browser ZIPs use `../reader/zip.ts`;
 * `./zcta-table.ts` loads lazily for explicit nearest-ZIP location actions.
 *
 * Orientation only: a ZCTA crosses city, county, school district and
 * legislative lines. Anything that needs actual districts asks for a street
 * address.
 */

export type { ZctaCentroid, ZipResolution };
export { isWellFormedZip };

const centroidFile = serverReaderValue("zcta-centroids", () => JSON.parse(
  readFileSync(join(process.cwd(), "lib/geo/zcta-centroids.json"), "utf8"),
) as { centroids: CentroidTable; complete: boolean; source: string; sourceOrg: string; vintage: string });
const CENTROIDS = centroidFile.centroids;
const POSTAL = postalTable();

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
