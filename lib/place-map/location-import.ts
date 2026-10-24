import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isWellFormedZip, type CentroidTable, type ZctaCentroid } from "../geo/zcta-core.ts";
import { postalAreaIn, type PostalTable } from "../geo/postal-core.ts";
import type { MapZipLocation } from "./load.ts";

/** Decode acquired coordinate evidence for import; application lookups read zip_location. */
export function sourceZipLocation(centroids: CentroidTable, input: string, postal: PostalTable): ZctaCentroid | null {
  const zip = input.trim();
  if (!isWellFormedZip(zip)) return null;
  const row = postal[zip];
  const point = centroids[zip] ?? (row && row[0] !== null && row[1] !== null ? [row[0], row[1]] : null);
  if (!point) return null;
  const area = postalAreaIn(postal, zip);
  return { zip, lat: point[0], lng: point[1], ...(area ? { postal: area } : {}) };
}

/** Acquired source bytes enter the map during import, never during a reader request. */
export async function stateZipLocations(root: string, state: string, checkedAt: string): Promise<MapZipLocation[]> {
  const [census, postal] = await Promise.all([
    readFile(join(root,"lib/geo/zcta-centroids.json"),"utf8").then(JSON.parse) as Promise<{centroids:CentroidTable;vintage:string;source:string}>,
    readFile(join(root,"lib/geo/postal-zips.json"),"utf8").then(JSON.parse) as Promise<{zips:PostalTable;source:string;typeSource:string}>,
  ]);
  return Object.keys(postal.zips).flatMap(zip => {
    if (postal.zips[zip][5] !== state) return [];
    const point = sourceZipLocation(census.centroids,zip,postal.zips);
    return [{...point,zip,lat:point?.lat??null,lng:point?.lng??null,postal:postalAreaIn(postal.zips,zip)!,
      boundaryYear:Number(census.vintage),checkedAt,
      sourceUrls:[...(census.centroids[zip] ? [census.source] : [postal.source]),postal.typeSource]}];
  });
}
