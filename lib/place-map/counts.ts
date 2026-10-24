import type { Query } from "../facts/publish.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";

export interface PlaceMapCounts {
  readonly state: string;
  readonly places: number;
  readonly zips: number;
  readonly zctas: number;
  readonly countyAttachments: number;
}

export async function placeMapCounts(query: Query): Promise<PlaceMapCounts[]> {
  const states = Object.values(FIPS_TO_STATE).map(s => s.postal).sort();
  const rows = await query("SELECT state,places,zips,zctas,county_attachments FROM place_map_counts");
  const byState = new Map(rows.map(row => [String(row.state), row]));
  return states.map(state => {
    const row = byState.get(state);
    return { state, places: Number(row?.places ?? 0), zips: Number(row?.zips ?? 0), zctas: Number(row?.zctas ?? 0), countyAttachments: Number(row?.county_attachments ?? 0) };
  });
}
