import { polygonContains, type Ring } from "../geo/polygon.ts";
import { jurisdictionFromOcdId } from "../coverage/states.ts";

export type DistrictGeometry = { readonly type: "Polygon"; readonly coordinates: Ring[] } |
  { readonly type: "MultiPolygon"; readonly coordinates: Ring[][] };
export interface SpecialDistrictBoundary extends Readonly<Record<string, unknown>> {
  readonly id: string; readonly kind: "SPECIAL_DISTRICT_BOUNDARY";
  /** Publication partition, not the district's territorial extent. */
  readonly ocdId: string; readonly bodyId: string; readonly districtOcdId: string | null;
  readonly districtKind: string; readonly sourceGovernmentId: string; readonly name: string;
  readonly geometry: DistrictGeometry; readonly sourceUrl: string; readonly sourceHash: string; readonly capturedAt: string;
}
const ringValid = (ring: unknown): ring is Ring => Array.isArray(ring) && ring.length >= 4 &&
  ring.every(point => Array.isArray(point) && point.length >= 2 &&
    typeof point[0] === "number" && Number.isFinite(point[0]) && Math.abs(point[0]) <= 180 &&
    typeof point[1] === "number" && Number.isFinite(point[1]) && Math.abs(point[1]) <= 90 &&
    point.every(value => typeof value === "number" && Number.isFinite(value))) &&
  ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1];
const polygonValid = (value: unknown) => Array.isArray(value) && value.length > 0 && value.every(ringValid);
export function districtGeometryValid(value: unknown): value is DistrictGeometry {
  if (!value || typeof value !== "object") return false;
  const geometry = value as DistrictGeometry;
  return geometry.type === "Polygon" ? polygonValid(geometry.coordinates) : geometry.type === "MultiPolygon" &&
    Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0 && geometry.coordinates.every(polygonValid);
}
export function specialDistrictBoundaryIssue(value: unknown): string | null {
  const row = value as Partial<SpecialDistrictBoundary> | null;
  if (!row || row.kind !== "SPECIAL_DISTRICT_BOUNDARY" || [row.id, row.bodyId, row.name, row.sourceGovernmentId, row.districtKind].some(value => typeof value !== "string" || !value.trim()))
    return "Special district boundary lacks its held government identity.";
  if (!jurisdictionFromOcdId(row.ocdId ?? "") || row.districtOcdId !== null && !jurisdictionFromOcdId(row.districtOcdId ?? ""))
    return "Special district boundary lacks its exact registered jurisdiction.";
  if (!districtGeometryValid(row.geometry)) return "Special district boundary lacks a closed geographic Polygon or MultiPolygon.";
  if (!/^https:\/\//.test(row.sourceUrl ?? "") || !/^[a-f0-9]{64}$/.test(row.sourceHash ?? "") || !Number.isFinite(Date.parse(row.capturedAt ?? "")))
    return "Special district boundary lacks its original source identity.";
  return null;
}
/** Same exterior/holes geometry semantics as the address registry; union the
 * polygons rather than letting overlapping polygons cancel each other. */
export function districtBoundaryContains(row: SpecialDistrictBoundary, point: readonly [number, number]): boolean {
  if (specialDistrictBoundaryIssue(row) || !Number.isFinite(point[0]) || Math.abs(point[0]) > 180 || !Number.isFinite(point[1]) || Math.abs(point[1]) > 90) return false;
  return (row.geometry.type === "Polygon" ? [row.geometry.coordinates] : row.geometry.coordinates).some(poly => polygonContains(point, poly));
}
export function specialDistrictsAt(point: readonly [number, number], records: readonly SpecialDistrictBoundary[]) {
  const inside = records.filter(row => districtBoundaryContains(row, point));
  return { bodyIds: [...new Set(inside.map(row => row.bodyId))], ocdIds: [...new Set(inside.flatMap(row => row.districtOcdId ? [row.districtOcdId] : []))] };
}
/** County membership says only that a district serves part of it. It supplies
 * no polygon, address membership or invented OCD identity. */
export function countySpecialDistricts(countyOcdId: string,
  districts: readonly { bodyId: string; countyOcdId: string; name: string }[], records: readonly SpecialDistrictBoundary[]) {
  return districts.filter(row => row.countyOcdId === countyOcdId).map(row => {
    const boundaryHeld = records.some(boundary => boundary.ocdId === countyOcdId && boundary.bodyId === row.bodyId && !specialDistrictBoundaryIssue(boundary));
    return { ...row, serves: boundaryHeld ? null : "part of the county", boundaryHeld };
  });
}
