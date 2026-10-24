import { readFileSync } from "node:fs";
import { join } from "node:path";
import { postalRow } from "./postal.ts";
import { serverReaderValue } from "../reader/memory.ts";
import {
  isWellFormedZip,
  lookupIn,
  resolveIn,
  type CentroidTable,
  type ZctaCentroid,
  type ZipResolution,
} from "./zcta-core.ts";

/**
 * Zip → map coordinate, synchronously, with the whole table in the module.
 * Server and scripts only. Typed/restored browser ZIPs use `../reader/zip.ts`;
 * Exact point entry reads the place map without inferring a ZIP.
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
  const zip = input.trim(), row = postalRow(zip);
  return lookupIn(CENTROIDS, input, row ? {[zip]:row} : {});
}

export function resolveZip(input: string): ZipResolution {
  const zip = input.trim(), row = postalRow(zip);
  return resolveIn(CENTROIDS, input, row ? {[zip]:row} : {});
}
