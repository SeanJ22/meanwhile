import { isWellFormedZip, type ZctaCentroid, type ZipResolution } from "../geo/zcta-core.ts";
import { placeMapQuery } from "./reader.ts";

/** Display points come from the imported map, independently of governing memberships. */
export async function readZipLocations(zips: readonly string[]): Promise<ReadonlyMap<string, ZctaCentroid>> {
  const codes = [...new Set(zips.filter(isWellFormedZip).map(zip => zip.trim()))];
  if (!codes.length) return new Map();
  const rows = await placeMapQuery()(`SELECT DISTINCT ON(zip) zip,lat,lng,postal FROM zip_location
    WHERE zip=ANY($1::text[]) ORDER BY zip,boundary_year DESC`, [codes]);
  return new Map(rows.map(row => [String(row.zip), {zip:String(row.zip),lat:Number(row.lat),lng:Number(row.lng),
    ...(row.postal ? {postal:row.postal as NonNullable<ZctaCentroid["postal"]>} : {})}]));
}

export async function readZipLocation(input: string): Promise<ZctaCentroid | null> {
  return (await readZipLocations([input])).get(input.trim()) ?? null;
}

export async function resolveZipLocation(input: string): Promise<ZipResolution> {
  if (!isWellFormedZip(input)) return {ok:false,reason:"malformed"};
  const centroid = await readZipLocation(input);
  return centroid ? {ok:true,centroid} : {ok:false,reason:"uncovered"};
}
