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

/** ZIPs each state's production map holds, from the same small count table; a state with no map is absent. */
export async function placeMapHeldZips(query: Query, states?: readonly string[]): Promise<Map<string, number>> {
  const rows = states === undefined ? await query("SELECT state,zips FROM place_map_counts")
    : await query("SELECT state,zips FROM place_map_counts WHERE state=ANY($1::text[])", [states]);
  return new Map(rows.map(row => [String(row.state).trim(), Number(row.zips ?? 0)]));
}
