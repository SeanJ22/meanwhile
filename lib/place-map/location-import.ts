import { join } from "node:path";
import { isWellFormedZip, type CentroidTable, type ZctaCentroid } from "../geo/zcta-core.ts";
import { postalAreaIn, type PostalRow, type PostalTable } from "../geo/postal-core.ts";
import type { MapZipLocation } from "./load.ts";
import { zipSourceRows, type ZipSourceMetadata } from "./source-rows.ts";

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
  const postal: PostalTable = {}, centroids: CentroidTable = {};
  const postalMetadata: ZipSourceMetadata = {}, censusMetadata: ZipSourceMetadata = {};
  for await (const [zip,value] of zipSourceRows(join(root,"lib/geo/postal-zips.json"),postalMetadata)) {
    const row = value as PostalRow;
    if (row[5] === state) postal[zip] = row;
  }
  for await (const [zip,value] of zipSourceRows(join(root,"lib/geo/zcta-centroids.json"),censusMetadata)) {
    if (Object.hasOwn(postal,zip)) centroids[zip] = value as [number,number];
  }
  const {source:postalSource,typeSource} = postalMetadata, {source:censusSource,vintage} = censusMetadata;
  if (!postalSource || !typeSource || !censusSource || !vintage) throw new Error("Acquired ZIP source metadata is incomplete");
  return Object.keys(postal).map(zip => {
    const point = sourceZipLocation(centroids,zip,postal);
    return {...point,zip,lat:point?.lat??null,lng:point?.lng??null,postal:postalAreaIn(postal,zip)!,
      boundaryYear:Number(vintage),checkedAt,
      sourceUrls:[centroids[zip] ? censusSource : postalSource,typeSource]};
  });
}
