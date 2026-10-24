import { isWellFormedZip, type ZctaCentroid, type ZipResolution } from "../geo/zcta-core.ts";
import { placeMapQuery } from "./reader.ts";
import type { PostalArea } from "../geo/postal-core.ts";
import type { Query } from "../facts/publish.ts";

/** Coordinates and postal metadata share the same indexed source rows. */
async function records(zips: readonly string[], query?: Query) {
  const codes = [...new Set(zips.filter(isWellFormedZip).map(zip => zip.trim()))];
  if (!codes.length) return [];
  return (query??placeMapQuery())(`SELECT DISTINCT ON(zip) zip,lat,lng,postal FROM zip_location
    WHERE zip=ANY($1::text[]) ORDER BY zip,boundary_year DESC`, [codes]);
}

/** Display points come from the imported map, independently of governing memberships. */
export async function readZipLocations(zips: readonly string[]): Promise<ReadonlyMap<string, ZctaCentroid>> {
  return new Map((await records(zips)).filter(row=>row.lat!==null&&row.lng!==null).map(row => [String(row.zip), {zip:String(row.zip),lat:Number(row.lat),lng:Number(row.lng),
    ...(row.postal ? {postal:row.postal as NonNullable<ZctaCentroid["postal"]>} : {})}]));
}

/** Known postal destinations can retain metadata without a display point. */
export async function readZipPostalAreas(zips: readonly string[], query?: Query): Promise<ReadonlyMap<string, PostalArea>> {
  return new Map((await records(zips,query)).flatMap(row=>row.postal ? [[String(row.zip),row.postal as PostalArea] as const] : []));
}

export async function readZipLocation(input: string): Promise<ZctaCentroid | null> {
  return (await readZipLocations([input])).get(input.trim()) ?? null;
}

export async function resolveZipLocation(input: string): Promise<ZipResolution> {
  if (!isWellFormedZip(input)) return {ok:false,reason:"malformed"};
  const centroid = await readZipLocation(input);
  return centroid ? {ok:true,centroid} : {ok:false,reason:"uncovered"};
}
