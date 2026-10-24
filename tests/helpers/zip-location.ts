import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lookupIn, resolveIn, type CentroidTable } from "../../lib/geo/zcta-core.ts";
import type { PostalTable } from "../../lib/geo/postal-core.ts";

let held: {centroids:CentroidTable;postal:PostalTable} | undefined;
function source() {
  return held ??= {centroids:JSON.parse(readFileSync(join(import.meta.dirname,"../../lib/geo/zcta-centroids.json"),"utf8")).centroids,
    postal:JSON.parse(readFileSync(join(import.meta.dirname,"../../lib/geo/postal-zips.json"),"utf8")).zips};
}

/** Captured source coordinates for test setup; application readers query the map. */
export const fixtureZipLocation = (zip:string) => lookupIn(source().centroids,zip,source().postal);
export const fixtureZipResolution = (zip:string) => resolveIn(source().centroids,zip,source().postal);
