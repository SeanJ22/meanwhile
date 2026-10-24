import type { Query } from "../facts/publish.ts";
import { contains, type GeoFeature } from "../registry/resolve.ts";
import { selectGeographyVersion, currentRepresentationSelection, type GeographySelection } from "../census-geography/selection.ts";
import type { GeographyType } from "../census-geography/contract.ts";
import type { PlaceMapResult, PlaceMembership } from "./types.ts";

const districtTypes: Readonly<Record<string, GeographyType>> = {
  cd: "congressional_district", sldu: "state_leg_upper", sldl: "state_leg_lower",
};
const fields = `e.id AS place_id, e.name, e.state, b.layer, b.boundary_year, b.version,
  b.county_attachment, b.host_county_id`;

/** Choose the current local boundary before testing membership. Older shapes
 * remain held, but cannot return a place the newer boundary no longer covers. */
export const CURRENT_LOCAL_BOUNDARY_SQL = `(b.layer IN ('cd','sldu','sldl') OR b.boundary_year=(
  SELECT max(current.boundary_year) FROM place_boundary current WHERE current.place_id=b.place_id))`;

function membership(row: Record<string, unknown>): PlaceMembership {
  return { placeId: String(row.place_id), name: String(row.name), state: row.state == null ? null : String(row.state),
    layer: String(row.layer), boundaryYear: Number(row.boundary_year), version: String(row.version),
    share: row.share == null ? null : Number(row.share), shareBasis: String(row.share_basis ?? "unknown"),
    partial: row.partial !== false, fringe: row.fringe === true,
    countyAttachment: row.county_attachment === true, hostCountyId: row.host_county_id == null ? null : String(row.host_county_id) };
}

/** Select only the requested district plan. Entity ids and older memberships stay held. */
function selected(rows: readonly PlaceMembership[], selection: GeographySelection): PlaceMembership[] {
  const versions = [...new Map(rows.filter(row => districtTypes[row.layer]).map(row =>
    [`${row.state}/${row.version}`, { key: row.version, type: districtTypes[row.layer], states: row.state ? [row.state] : [] }])).values()];
  const latest = new Map<string, number>();
  for (const row of rows) if (!districtTypes[row.layer]) latest.set(row.placeId, Math.max(latest.get(row.placeId) ?? 0, row.boundaryYear));
  return rows.filter(row => districtTypes[row.layer]
    ? selectGeographyVersion(versions, districtTypes[row.layer], selection, row.state ?? undefined)?.key === row.version
    : latest.get(row.placeId) === row.boundaryYear);
}

/** Shared by single-code reads and bounded state enumeration. */
export const CODE_MEMBERSHIP_SQL = `jsonb_build_object(
      'placeId',e.id,'name',e.name,'state',e.state,'layer',b.layer,'boundaryYear',b.boundary_year,'version',b.version,
      'share',m.share,'shareBasis',m.share_basis,'partial',m.partial,'fringe',m.fringe,
      'countyAttachment',b.county_attachment,'hostCountyId',b.host_county_id
    )`;

/** RB-A10's ZIP and ZCTA entry point. Each call performs one indexed table lookup. */
export async function placesForCode(query: Query, kind: "zip" | "zcta", code: string,
  selection: GeographySelection = currentRepresentationSelection()): Promise<PlaceMapResult> {
  if (!/^\d{5}$/.test(code)) throw new Error("A five-digit ZIP or ZCTA is required");
  const table = kind === "zip" ? "zip_place" : "zcta_place";
  const [row] = await query(`SELECT coalesce(jsonb_agg(${CODE_MEMBERSHIP_SQL} ORDER BY e.id,b.boundary_year),'[]'::jsonb) AS memberships
    FROM ${table} m JOIN entity e ON e.id=m.place_id
    JOIN place_boundary b ON b.place_id=m.place_id AND b.boundary_year=m.boundary_year
    WHERE m.${kind}=$1 AND ${CURRENT_LOCAL_BOUNDARY_SQL}`, [code]);
  if (!Array.isArray(row?.memberships)) throw new Error("The place map lookup could not be read");
  const memberships = selected(row.memberships as PlaceMembership[], selection);
  return { memberships, states: [...new Set(memberships.filter(row => row.layer === "state").flatMap(row => row.state ? [row.state] : []))].sort() };
}

/** One GiST query, then the registry's exact polygon test. County attachments
 * are labeled as such and included only after their host county contains the point. */
export async function placesAtPoint(query: Query, point: [number, number],
  selection: GeographySelection = currentRepresentationSelection()): Promise<PlaceMapResult> {
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw new Error("A geographic map point is required");
  const rows = await query(`WITH candidates AS MATERIALIZED (
      SELECT b.* FROM place_boundary b WHERE b.bounds @> point($1::float8, $2::float8) AND ${CURRENT_LOCAL_BOUNDARY_SQL}
    ) SELECT ${fields}, b.geometry, false AS partial FROM candidates b JOIN entity e ON e.id=b.place_id
    UNION ALL SELECT ${fields}, NULL AS geometry, true AS partial FROM place_boundary b
      JOIN entity e ON e.id=b.place_id WHERE b.county_attachment AND ${CURRENT_LOCAL_BOUNDARY_SQL}
      AND b.host_county_id IN (SELECT place_id FROM candidates WHERE layer='county')`, point);
  const exact = rows.filter(row => row.geometry && contains(point, {
    properties: { ocdId: String(row.place_id), label: String(row.name) }, geometry: row.geometry as GeoFeature["geometry"],
  }));
  const states = new Set(exact.filter(row => row.layer === "state").map(row => String(row.state)));
  const counties = new Set(exact.filter(row => row.layer === "county" && states.has(String(row.state))).map(row => String(row.place_id)));
  const memberships = selected([...exact, ...rows.filter(row => row.county_attachment && counties.has(String(row.host_county_id)))]
    .filter(row => row.state == null || String(row.place_id).startsWith("ocd-division/country:us/aiannh:") || states.has(String(row.state))).map(membership), selection);
  return { memberships, states: [...states].sort() };
}
