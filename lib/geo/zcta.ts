// The import attribute is what lets this module load under `node --test` as
// well as under the bundler. Without it Node refuses the JSON outright, which
// kept every zip-level test out of the suite.
import centroidFile from "./zcta-centroids.json" with { type: "json" };
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
 * Zip → map coordinate, SYNCHRONOUSLY, with the whole table in the module.
 *
 * Orientation only. A ZCTA is a statistical shape derived from mail delivery
 * routes; it crosses city, county, school district, and legislative lines. It
 * tells the map where to look and nothing else. Anything that needs actual
 * districts asks for a street address, and says why at the point of asking.
 *
 * ## THIS MODULE IS FOR THE SERVER AND FOR SCRIPTS — P-002, 2026-08-24.
 *
 * The static import above pulls 960,770 bytes into whatever graph reaches it.
 * On a server or in a script that is free. In the browser it was 32.5% of the
 * landing page's initial JavaScript — more than MapLibre — for a table no
 * reader can use until they type a zip.
 *
 * So the three client components that used to import this now use
 * `./zcta-table.ts`, which loads the same file with a dynamic `import()`.
 * `tests/zcta-async.test.ts` fails the build if a client component imports
 * this one again, because nothing else would notice: the page would work
 * perfectly and simply be a megabyte heavier.
 *
 * The logic lives in `./zcta-core.ts` and is called by both, so there is one
 * implementation of "which zip is nearest" rather than a copy per module
 * (RULING 103).
 */

export type { ZctaCentroid, ZipResolution };
export { isWellFormedZip };

// JSON arrays widen to number[]; the file's contract is a pair per zip.
const CENTROIDS = centroidFile.centroids as unknown as CentroidTable;

/**
 * Whether the centroid table covers the whole country.
 *
 * False while the committed stub is in place. It changes what an unrecognized
 * zip means: with a partial table we can't claim a zip doesn't exist, only that
 * we don't have it yet — and the UI has to say the honest one.
 */
export const COVERAGE_IS_COMPLETE: boolean = centroidFile.complete === true;

export const CENTROID_SOURCE = {
  url: centroidFile.source,
  org: centroidFile.sourceOrg,
  vintage: centroidFile.vintage,
};

export function lookupZcta(input: string): ZctaCentroid | null {
  return lookupIn(CENTROIDS, input);
}

export function nearestZcta(lat: number, lng: number): ZctaCentroid | null {
  return nearestIn(CENTROIDS, lat, lng);
}

export function resolveZip(input: string): ZipResolution {
  return resolveIn(CENTROIDS, COVERAGE_IS_COMPLETE, input);
}
