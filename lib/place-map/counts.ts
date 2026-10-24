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
  const rows = await query(`WITH places AS (
      SELECT e.state,count(DISTINCT b.place_id)::int AS places,
        count(DISTINCT b.place_id) FILTER(WHERE b.county_attachment)::int AS county_attachments
      FROM entity e JOIN place_boundary b ON b.place_id=e.id WHERE e.kind='place' AND e.state IS NOT NULL GROUP BY e.state
    ), zips AS (SELECT e.state,count(DISTINCT m.zip)::int AS n FROM zip_place m JOIN entity e ON e.id=m.place_id
      JOIN place_boundary b ON b.place_id=m.place_id AND b.boundary_year=m.boundary_year WHERE b.layer<>'aiannh' GROUP BY e.state),
    zctas AS (SELECT e.state,count(DISTINCT m.zcta)::int AS n FROM zcta_place m JOIN entity e ON e.id=m.place_id
      JOIN place_boundary b ON b.place_id=m.place_id AND b.boundary_year=m.boundary_year WHERE b.layer<>'aiannh' GROUP BY e.state)
    SELECT p.*,coalesce(zips.n,0)::int AS zips,coalesce(zctas.n,0)::int AS zctas FROM places p
    LEFT JOIN zips ON zips.state=p.state LEFT JOIN zctas ON zctas.state=p.state`);
  const byState = new Map(rows.map(row => [String(row.state), row]));
  return Object.values(FIPS_TO_STATE).map(s => s.postal).sort().map(state => {
    const row = byState.get(state);
    return { state, places: Number(row?.places ?? 0), zips: Number(row?.zips ?? 0), zctas: Number(row?.zctas ?? 0), countyAttachments: Number(row?.county_attachments ?? 0) };
  });
}
