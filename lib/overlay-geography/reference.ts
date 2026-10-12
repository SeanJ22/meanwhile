import referenceRows from "../../data/reference/geography/overlay-district-sources.json" with { type: "json" };
import { legislativeIdentity, type DivisionIdentity } from "../ocd/divisions.ts";

export interface OverlayCodePrefix { readonly name: string; readonly countyFips: string }
export interface OverlaySource {
  readonly id: string;
  readonly stateFips: string;
  readonly chamber: "upper" | "lower";
  readonly fileUrl: string;
  readonly shapeFile: string;
  readonly codeField: string;
  readonly codePrefixes: Readonly<Record<string, OverlayCodePrefix>>;
  readonly planStart: string;
  readonly planEnd: string;
  readonly producedAt: string;
  readonly sourceOrg: string;
  readonly districtLabel?: string;
  readonly officialLinkUrl: string;
  readonly townDocumentUrl: string;
  readonly townDocumentMirrors?: readonly string[];
  readonly documentLayout?: { readonly columns: readonly number[]; readonly contentTop: number };
  readonly townBoundaryUrl: string;
  readonly townRelationshipUrl: string;
  readonly townFields?: { readonly name: string; readonly county: string; readonly geoid: string; readonly ward?: string };
  readonly townBoundaryTolerance?: number;
  readonly partitionBoundaryUrl?: string;
  readonly partitionRelationshipUrl?: string;
  readonly partitionGeoTag?: string;
  readonly partitionDistrictField?: string;
  readonly partitionDesignationPattern?: string;
  readonly expectedFeatures: number;
  readonly countyHeadingPattern: string;
  readonly districtRowPattern: string;
}

/** Every source-specific identifier, name, URL and parsing rule lives in reference data. */
export function overlaySources(): OverlaySource[] {
  return referenceRows.map((row) => {
    if (row.chamber !== "upper" && row.chamber !== "lower") throw new Error(`Invalid overlay chamber in ${row.id}`);
    if (!/^\d{2}$/.test(row.stateFips) || !row.id || !row.fileUrl || !Object.keys(row.codePrefixes).length) throw new Error("Invalid overlay source reference row");
    return { ...row, chamber: row.chamber };
  });
}

export const overlaySourceRows = overlaySources();

/** The same code used by the boundary DBF, recoverable from a source designation. */
export function overlayDistrictCode(source: OverlaySource, designation: string): string | null {
  const text = designation.trim();
  for (const [prefix, { name }] of Object.entries(source.codePrefixes)) {
    const match = new RegExp(`^(?:${escapeRegExp(prefix)}|${escapeRegExp(name)}\\s+)([0-9]+)$`, "i").exec(text);
    if (match && Number(match[1]) > 0) return `${prefix}${Number(match[1])}`;
  }
  return null;
}

export function overlayDistrictIdentity(source: OverlaySource, code: string): DivisionIdentity | null {
  const normalized = overlayDistrictCode(source, code);
  if (!normalized) return null;
  const prefix = Object.keys(source.codePrefixes).find((p) => normalized.startsWith(p));
  if (!prefix) return null;
  const label = `${source.codePrefixes[prefix].name} ${Number(normalized.slice(prefix.length))}`;
  return legislativeIdentity(source.stateFips, source.chamber === "upper" ? "sldu" : "sldl", normalized, label);
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
