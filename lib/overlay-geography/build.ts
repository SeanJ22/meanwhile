import polygonClipping from "polygon-clipping";
import type { GeographyGeometry, GeographyVersion } from "../census-geography/contract.ts";
import type { BuiltGrouping, BuiltOverlap, BuiltScope } from "../census-geography/dataset.ts";
import { WHOLE_THRESHOLD, parseTab20Header, resolveTab20Columns } from "../census-geography/build.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import { normalizeTown, type DistrictTownAssignment } from "./document.ts";
import { geometryArea, geometryPolygons } from "./geometry.ts";
import { overlayDistrictCode, overlayDistrictIdentity, type OverlaySource } from "./reference.ts";

export interface OverlayBoundary { readonly code: string; readonly geometry: GeographyGeometry }
export interface TownBoundary { readonly geoid: string; readonly countyFips: string; readonly name: string; readonly geometry: GeographyGeometry }
export interface SourceDiscrepancy {
  readonly sourceId: string;
  readonly code: string;
  readonly label: string;
  readonly geometryOnly: readonly string[];
  readonly documentOnly: readonly string[];
  readonly partialTowns: readonly string[];
  readonly sourceUrls: readonly string[];
  readonly reason: string;
}
export interface VerifiedOverlay extends OverlayBoundary { readonly townGeoids: readonly string[]; readonly overlapGeoids?: readonly string[] }

/** Match the official town/ward lists to Census's base-district identities.
 * Cartographic coastlines do not affect the exact Census land-area measure. */
export function overlayDocumentMembers(code: string, partition: readonly { readonly geoid: string; readonly code?: string }[], assignments: readonly DistrictTownAssignment[]): { geoids: string[]; partial: string[]; uncovered: string[] } {
  const districtTowns = new Map(assignments.map((row) => [row.code, new Set(row.towns.map(normalizeTown))]));
  const overlayTowns = districtTowns.get(code) ?? new Set<string>();
  const covered = new Set<string>(), geoids: string[] = [], partial: string[] = [];
  for (const district of partition) {
    const towns = district.code ? districtTowns.get(district.code) : undefined;
    if (!towns?.size) continue;
    const shared = [...towns].filter((town) => overlayTowns.has(town));
    if (!shared.length) continue;
    if (shared.length !== towns.size) { partial.push(district.geoid); continue; }
    geoids.push(district.geoid);
    shared.forEach((town) => covered.add(town));
  }
  return { geoids: geoids.sort(), partial: partial.sort(), uncovered: [...overlayTowns].filter((town) => !covered.has(town)).sort() };
}

/** A small cartographic boundary sliver does not establish representation for part of a town. */
const TOWN_BOUNDARY_TOLERANCE = 0.00001;

/** Millimetre-scale rounding stabilizes coincident reprojected source edges.
 * Source/reader polygons retain full precision; Census land parts are unchanged. */
function comparisonBoundary(geometry: GeographyGeometry) {
  const polygons = geometryPolygons(geometry).map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [Math.round(x * 1e8) / 1e8, Math.round(y * 1e8) / 1e8] as [number, number])));
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const polygon of polygons) for (const [x, y] of polygon[0]) {
    bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
    bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y);
  }
  return { polygons, bounds, area: geometryArea(polygons) };
}

function boundsOverlap(a: readonly number[], b: readonly number[]): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

/** Use complete members of the Census partition, including ward-based districts. */
export function overlayPartitionMembers(geometry: GeographyGeometry, partition: readonly { readonly geoid: string; readonly geometry: GeographyGeometry }[]): { geoids: string[]; partial: string[]; uncovered: number } {
  const boundary = comparisonBoundary(geometry), { polygons } = boundary, members: string[] = [], partial: string[] = [];
  const intersections: ReturnType<typeof polygonClipping.intersection>[] = [];
  for (const district of partition) {
    const districtBoundary = comparisonBoundary(district.geometry);
    if (!boundsOverlap(boundary.bounds, districtBoundary.bounds)) continue;
    const districtPolygons = districtBoundary.polygons;
    const intersection = polygonClipping.intersection(polygons, districtPolygons);
    const area = geometryArea(intersection);
    if (area <= 0) continue;
    const share = area / districtBoundary.area;
    if (share >= 1 - TOWN_BOUNDARY_TOLERANCE) { members.push(district.geoid); intersections.push(intersection); }
    else if (share > TOWN_BOUNDARY_TOLERANCE) partial.push(district.geoid);
  }
  const covered = intersections.length ? polygonClipping.union(...intersections as [ReturnType<typeof polygonClipping.intersection>, ...ReturnType<typeof polygonClipping.intersection>[]]) : [];
  const uncovered = geometryArea(polygonClipping.difference(polygons, covered)) / geometryArea(polygons);
  return { geoids: members.sort(), partial: partial.sort(), uncovered };
}

export function verifyOverlayTowns(source: OverlaySource, boundaries: readonly OverlayBoundary[], towns: readonly TownBoundary[], assignments: readonly DistrictTownAssignment[]): { verified: VerifiedOverlay[]; reports: SourceDiscrepancy[] } {
  const tolerance = source.townBoundaryTolerance ?? TOWN_BOUNDARY_TOLERANCE;
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance >= 0.01) throw new Error("Invalid town-boundary comparison tolerance");
  const official = new Map(assignments.map((row) => [row.code, row.towns.map(normalizeTown)]));
  const verified: VerifiedOverlay[] = [];
  const reports: SourceDiscrepancy[] = [];
  const townBoundaries = towns.map((town) => ({ ...town, comparison: comparisonBoundary(town.geometry) }));
  for (const boundary of boundaries) {
    const identity = overlayDistrictIdentity(source, boundary.code);
    if (!identity) throw new Error(`Unknown overlay district code ${boundary.code}`);
    const code = overlayDistrictCode(source, boundary.code)!;
    const prefix = Object.keys(source.codePrefixes).find((p) => code.startsWith(p))!;
    const countyFips = source.codePrefixes[prefix].countyFips;
    const members: TownBoundary[] = [], partialTowns: string[] = [];
    const comparison = comparisonBoundary(boundary.geometry), { polygons } = comparison;
    for (const town of townBoundaries) {
      if (town.countyFips !== countyFips) continue;
      if (!boundsOverlap(comparison.bounds, town.comparison.bounds)) continue;
      const townPolygons = town.comparison.polygons;
      const area = town.comparison.area;
      if (area <= 0) throw new Error(`Town boundary ${town.geoid} has no area`);
      const intersection = polygonClipping.intersection(polygons, townPolygons);
      const share = geometryArea(intersection) / area;
      if (share >= 1 - tolerance) members.push(town);
      else if (share > tolerance) partialTowns.push(town.name);
    }
    const geometryNames = new Set(members.map((town) => normalizeTown(town.name)));
    const documentNames = new Set(official.get(code) ?? []);
    const geometryOnly = [...geometryNames].filter((town) => !documentNames.has(town)).sort();
    const documentOnly = [...documentNames].filter((town) => !geometryNames.has(town)).sort();
    if (!documentNames.size || geometryOnly.length || documentOnly.length || partialTowns.length) {
      reports.push({ sourceId: source.id, code, label: identity.label, geometryOnly, documentOnly, partialTowns: partialTowns.sort(), sourceUrls: [source.fileUrl, source.townDocumentUrl], reason: !documentNames.size ? "No parsed town assignment for this district in the election authority document" : partialTowns.length ? "District covers part of a town; whole-town Census overlaps cannot establish its ZIP share" : "District towns differ between the boundary file and election authority document" });
    } else verified.push({ ...boundary, code, townGeoids: members.map((town) => town.geoid).sort() });
  }
  // Document districts without geometry also remain explicit, rather than silently dropping a seat.
  const codes = new Set(boundaries.map((boundary) => overlayDistrictCode(source, boundary.code)));
  for (const assignment of assignments) if (!codes.has(assignment.code)) reports.push({ sourceId: source.id, code: assignment.code, label: overlayDistrictIdentity(source, assignment.code)?.label ?? assignment.code, geometryOnly: [], documentOnly: assignment.towns, partialTowns: [], sourceUrls: [source.fileUrl, source.townDocumentUrl], reason: "Election authority overlay district is absent from the boundary file" });
  return { verified, reports };
}

/** Stream the exact Census town/ZCTA land relationship, retaining only this source's towns. */
export class OverlayOverlapAccumulator {
  private readonly sourcesByTown = new Map<string, string[]>();
  private readonly parts = new Map<string, Map<string, { part: number; total: number }>>();
  private columns: ReturnType<typeof resolveTab20Columns> | null = null;
  private readonly geoTag: string;
  constructor(overlays: readonly VerifiedOverlay[], geoTag = "COUSUB_20") {
    this.geoTag = geoTag;
    for (const overlay of overlays) {
      this.parts.set(overlay.code, new Map());
      for (const geoid of overlay.overlapGeoids ?? overlay.townGeoids) {
        const codes = this.sourcesByTown.get(geoid) ?? [];
        codes.push(overlay.code);
        this.sourcesByTown.set(geoid, codes);
      }
    }
  }
  add(line: string): void {
    if (!line.trim()) return;
    if (!this.columns) { this.columns = resolveTab20Columns(parseTab20Header(line), this.geoTag); return; }
    const fields = line.split("|"), columns = this.columns;
    const codes = this.sourcesByTown.get(fields[columns.geoGeoid]);
    const zcta = fields[columns.zctaGeoid];
    if (!codes || !/^\d{5}$/.test(zcta)) return;
    const part = Number(fields[columns.areaLandPart]), total = Number(fields[columns.zctaAreaLand]);
    if (!Number.isFinite(part) || part < 0 || !Number.isFinite(total) || total < 0) throw new Error("Town/ZCTA relationship has invalid land area");
    if (part === 0) return;
    for (const code of codes) {
      const edge = this.parts.get(code)!.get(zcta) ?? { part: 0, total };
      if (edge.total !== total) throw new Error(`Town/ZCTA relationship has inconsistent land total for ${zcta}`);
      edge.part += part;
      this.parts.get(code)!.set(zcta, edge);
    }
  }
  overlaps(code: string): BuiltOverlap[] {
    return [...(this.parts.get(code) ?? [])].map(([zcta5, { part, total }]) => {
      const fraction = total > 0 ? Math.min(1, part / total) : null;
      return { zcta5, whole: fraction !== null && fraction >= WHOLE_THRESHOLD, fraction };
    }).sort((a, b) => a.zcta5.localeCompare(b.zcta5));
  }
}

export function buildOverlayScope(source: OverlaySource, verified: readonly VerifiedOverlay[], overlaps: OverlayOverlapAccumulator, versionMeta: GeographyVersion): BuiltScope {
  const stateAbbr = FIPS_TO_STATE[source.stateFips]?.postal;
  if (!stateAbbr) throw new Error(`Unknown overlay state FIPS ${source.stateFips}`);
  const groupings = verified.map<BuiltGrouping>((boundary) => {
    const identity = overlayDistrictIdentity(source, boundary.code)!;
    return { geoid: source.stateFips + boundary.code, ocdId: identity.ocdId, label: `${identity.label} (${source.districtLabel ?? "overlay district"})`, stateFips: source.stateFips, stateAbbr, memberStates: [stateAbbr], overlaps: overlaps.overlaps(boundary.code), geometry: boundary.geometry, chamber: source.chamber, representation: "overlay", sourceUrls: [source.fileUrl, source.townDocumentUrl], sourceOrg: source.sourceOrg };
  }).sort((a, b) => a.geoid.localeCompare(b.geoid));
  return { type: "overlay_district", version: versionMeta.key, versionMeta, fractionBasis: "area", groupings, instanceCount: groupings.length, zctaEdgeCount: groupings.reduce((n, grouping) => n + grouping.overlaps.length, 0) };
}
