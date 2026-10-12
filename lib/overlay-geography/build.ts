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

/** A small cartographic boundary sliver does not establish representation for part of a town. */
const TOWN_BOUNDARY_TOLERANCE = 0.00001;

/** Use complete members of the Census partition, including ward-based districts. */
export function overlayPartitionMembers(geometry: GeographyGeometry, partition: readonly { readonly geoid: string; readonly geometry: GeographyGeometry }[]): { geoids: string[]; partial: string[]; uncovered: number } {
  const polygons = geometryPolygons(geometry), members: string[] = [], partial: string[] = [];
  const intersections: ReturnType<typeof polygonClipping.intersection>[] = [];
  for (const district of partition) {
    const districtPolygons = geometryPolygons(district.geometry);
    const intersection = polygonClipping.intersection(polygons, districtPolygons);
    const area = geometryArea(intersection);
    if (area <= 0) continue;
    const share = area / geometryArea(districtPolygons);
    if (share >= 1 - TOWN_BOUNDARY_TOLERANCE) { members.push(district.geoid); intersections.push(intersection); }
    else if (share > TOWN_BOUNDARY_TOLERANCE) partial.push(district.geoid);
  }
  const covered = intersections.length ? polygonClipping.union(...intersections as [ReturnType<typeof polygonClipping.intersection>, ...ReturnType<typeof polygonClipping.intersection>[]]) : [];
  const uncovered = geometryArea(polygonClipping.difference(polygons, covered)) / geometryArea(polygons);
  return { geoids: members.sort(), partial: partial.sort(), uncovered };
}

export function verifyOverlayTowns(source: OverlaySource, boundaries: readonly OverlayBoundary[], towns: readonly TownBoundary[], assignments: readonly DistrictTownAssignment[]): { verified: VerifiedOverlay[]; reports: SourceDiscrepancy[] } {
  const official = new Map(assignments.map((row) => [row.code, row.towns.map(normalizeTown)]));
  const verified: VerifiedOverlay[] = [];
  const reports: SourceDiscrepancy[] = [];
  for (const boundary of boundaries) {
    const identity = overlayDistrictIdentity(source, boundary.code);
    if (!identity) throw new Error(`Unknown overlay district code ${boundary.code}`);
    const code = overlayDistrictCode(source, boundary.code)!;
    const prefix = Object.keys(source.codePrefixes).find((p) => code.startsWith(p))!;
    const countyFips = source.codePrefixes[prefix].countyFips;
    const members: TownBoundary[] = [], partialTowns: string[] = [];
    const polygons = geometryPolygons(boundary.geometry);
    for (const town of towns) {
      if (town.countyFips !== countyFips) continue;
      const townPolygons = geometryPolygons(town.geometry);
      const area = geometryArea(townPolygons);
      if (area <= 0) throw new Error(`Town boundary ${town.geoid} has no area`);
      const intersection = polygonClipping.intersection(polygons, townPolygons);
      const share = geometryArea(intersection) / area;
      if (share >= 1 - TOWN_BOUNDARY_TOLERANCE) members.push(town);
      else if (share > TOWN_BOUNDARY_TOLERANCE) partialTowns.push(town.name);
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
