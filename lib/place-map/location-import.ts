import { join } from "node:path";
import { isWellFormedZip, type CentroidTable, type ZctaCentroid } from "../geo/zcta-core.ts";
import { postalAreaIn, type PostalRow, type PostalTable } from "../geo/postal-core.ts";
import { writeZipLocations, type MapZipLocation } from "./load.ts";
import type { Query } from "../facts/publish.ts";
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
  return (await acquiredZipLocations(root, value => value === state, checkedAt)).rows;
}

/** One read of the acquired files; `keep` selects postal states. Without a time, rows carry the files' acquisition time. */
async function acquiredZipLocations(root: string, keep: (state: string) => boolean, checkedAt?: string): Promise<{ rows: MapZipLocation[] }> {
  const postal: PostalTable = {}, centroids: CentroidTable = {};
  const postalMetadata: ZipSourceMetadata = {}, censusMetadata: ZipSourceMetadata = {};
  for await (const [zip,value] of zipSourceRows(join(root,"lib/geo/postal-zips.json"),postalMetadata)) {
    const row = value as PostalRow;
    if (keep(row[5])) postal[zip] = row;
  }
  for await (const [zip,value] of zipSourceRows(join(root,"lib/geo/zcta-centroids.json"),censusMetadata)) {
    if (Object.hasOwn(postal,zip)) centroids[zip] = value as [number,number];
  }
  const {source:postalSource,typeSource,generatedAt} = postalMetadata, {source:censusSource,vintage} = censusMetadata;
  if (!postalSource || !typeSource || !censusSource || !vintage || checkedAt === undefined && !generatedAt) throw new Error("Acquired ZIP source metadata is incomplete");
  return { rows: Object.keys(postal).map(zip => {
    const point = sourceZipLocation(centroids,zip,postal);
    return {...point,zip,lat:point?.lat??null,lng:point?.lng??null,postal:postalAreaIn(postal,zip)!,
      boundaryYear:Number(vintage),checkedAt:(checkedAt ?? generatedAt)!,
      sourceUrls:[centroids[zip] ? censusSource : postalSource,typeSource]};
  }) };
}

/** A deploy serves typed ZIPs before each state's next map import. Only a postal state holding fewer rows than its
 * acquired files is written, and a held row is never replaced: the state's map import updates changed points. */
export async function fillMissingZipLocations(query: Query, root: string): Promise<number> {
  const held = new Map((await query("SELECT postal->>'state' AS state,count(*)::int AS n FROM zip_location GROUP BY 1"))
    .map(row => [String(row.state), Number(row.n)]));
  const counts = new Map<string, number>();
  for await (const [,value] of zipSourceRows(join(root,"lib/geo/postal-zips.json"))) {
    const state = (value as PostalRow)[5];
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  const owed = new Set([...counts].filter(([state, n]) => (held.get(state) ?? 0) < n).map(([state]) => state));
  if (!owed.size) return 0;
  const { rows } = await acquiredZipLocations(root, state => owed.has(state));
  for (let at = 0; at < rows.length; at += 500) await writeZipLocations(query, rows.slice(at, at + 500), false);
  return rows.length;
}
