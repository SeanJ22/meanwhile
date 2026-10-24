import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { lookupIn, type CentroidTable } from "../geo/zcta-core.ts";
import type { PostalTable } from "../geo/postal-core.ts";
import type { MapZipLocation } from "./load.ts";

/** Acquired source bytes enter the map during import, never during a reader request. */
export async function stateZipLocations(root: string, state: string, checkedAt: string): Promise<MapZipLocation[]> {
  const [census, postal] = await Promise.all([
    readFile(join(root,"lib/geo/zcta-centroids.json"),"utf8").then(JSON.parse) as Promise<{centroids:CentroidTable;vintage:string;source:string}>,
    readFile(join(root,"lib/geo/postal-zips.json"),"utf8").then(JSON.parse) as Promise<{zips:PostalTable;source:string;typeSource:string}>,
  ]);
  return Object.keys(postal.zips).flatMap(zip => {
    if (postal.zips[zip][5] !== state) return [];
    const point = lookupIn(census.centroids,zip,postal.zips);
    return point ? [{...point,boundaryYear:Number(census.vintage),checkedAt,
      sourceUrls:[...(census.centroids[zip] ? [census.source] : [postal.source]),postal.typeSource]}] : [];
  });
}
