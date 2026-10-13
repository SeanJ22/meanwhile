import polygonClipping, { type MultiPolygon } from "polygon-clipping";
import type { Feature, Ring } from "../geo/shapefile.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import { sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import type { BuiltGrouping, BuiltOverlap } from "./dataset.ts";
import type { GeographyType } from "./contract.ts";

export interface TigerDistrictPlan {
  readonly type: GeographyType;
  readonly version: string;
  readonly plan: string;
  readonly effectiveFor: string;
  readonly labelSuffix: string;
  readonly districtNoun: string;
  readonly column: string;
  readonly districtWidth: number;
}

const invalid = (detail: string): never => { throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `TIGER: ${detail}`); };
const unassigned = (code: string): boolean => code === "" || /^Z+$/i.test(code) || code === "999";
function property(feature: Feature, name: string): string {
  return (feature.properties[name] ?? "").trim();
}
function ordinal(number: number): string {
  const last = number % 100;
  return `${number}${last >= 11 && last <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[number % 10] ?? "th"}`;
}

/** The DBF establishes the plan. A TIGER release directory is a publication
 * year, and does not establish a legislative plan year. */
export function tigerDistrictPlan(features: readonly Feature[], family: "cd" | "sldu" | "sldl", sourceUrl: string): TigerDistrictPlan | null {
  if (!features.length) return null;
  if (family === "cd") {
    const columns = new Set(features.flatMap(feature => Object.keys(feature.properties).filter(key => /^CD\d+FP$/.test(key))));
    if (columns.size !== 1) return invalid("district DBF does not establish one CD session column");
    const column = [...columns][0]!;
    const session = Number(/^CD(\d+)FP$/.exec(column)![1]);
    const fileSession = /_cd(\d+)\.zip$/i.exec(sourceUrl.split(/[?#]/)[0]!)?.[1];
    if (!Number.isInteger(session) || session < 100 || session > 999 || fileSession && Number(fileSession) !== session ||
        features.some(feature => !Object.hasOwn(feature.properties, column) || property(feature, "CDSESSN") !== "" && Number(property(feature, "CDSESSN")) !== session)) {
      return invalid("Congress metadata disagrees with its DBF or source filename");
    }
    if (features.every(feature => unassigned(property(feature, column)))) return null;
    const plan = `${ordinal(session)} Congress`;
    return { type: "congressional_district", version: `cd:${session}`, plan, effectiveFor: `${1786 + 2 * session} general election (${plan})`,
      labelSuffix: `(${plan})`, districtNoun: "Congressional District", column, districtWidth: 2 };
  }
  const column = family === "sldu" ? "SLDUST" : "SLDLST";
  if (features.some(feature => !Object.hasOwn(feature.properties, column))) return invalid(`district DBF is missing ${column}`);
  const assigned = features.filter(feature => !unassigned(property(feature, column)));
  if (!assigned.length) return null;
  const years = new Set(assigned.map(feature => property(feature, "LSY")));
  if (years.size !== 1 || !/^2\d{3}$/.test([...years][0] ?? "")) return invalid("district DBF does not establish one legislative plan year (LSY)");
  const year = [...years][0]!;
  const upper = family === "sldu";
  return { type: upper ? "state_leg_upper" : "state_leg_lower", version: `${family}:${year}`,
    plan: `${year} state ${upper ? "upper" : "lower"}-chamber plan`, effectiveFor: `${year} state legislative district plan`,
    labelSuffix: `(${year} plan)`, districtNoun: upper ? "State Senate District" : "State House District", column, districtWidth: 3 };
}

/** Translation before summation avoids losing a narrow positive sliver when
 * longitude/latitude coordinates are much larger than the sliver's width. */
function ringArea(ring: Ring): number {
  const [x, y] = ring[0]!;
  let twiceArea = 0;
  for (let i = 1; i < ring.length - 1; i++) {
    twiceArea += (ring[i]![0] - x) * (ring[i + 1]![1] - y) - (ring[i + 1]![0] - x) * (ring[i]![1] - y);
  }
  return Math.abs(twiceArea / 2);
}
function geometryArea(geometry: MultiPolygon): number {
  return geometry.reduce((area, polygon) => area + ringArea(polygon[0]!) - polygon.slice(1).reduce((holes, ring) => holes + ringArea(ring), 0), 0);
}
function bounds(feature: Feature): Feature["bbox"] {
  const box = feature.bbox;
  if (!box.every(Number.isFinite) || box[0] > box[2] || box[1] > box[3]) return invalid("polygon has an invalid bounding box");
  return box;
}
function intersects(a: Feature["bbox"], b: Feature["bbox"]): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}
function clip(operation: () => MultiPolygon): MultiPolygon {
  try { return operation(); }
  catch (error) { return invalid(`polygon topology could not be joined (${error instanceof Error ? error.message : "unknown error"})`); }
}

/** Shapefile rings are flattened. Even-odd fill restores holes and disjoint
 * polygon parts without relying on ring ordering or winding direction. */
function geometry(feature: Feature): MultiPolygon {
  const box = bounds(feature);
  if (!feature.rings.length) return invalid("polygon has no rings");
  for (const ring of feature.rings) {
    if (ring.length < 4 || ring.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y) || x < -180 || x > 180 || y < -90 || y > 90 ||
        x < box[0] || x > box[2] || y < box[1] || y > box[3]) ||
        ring[0]![0] !== ring.at(-1)![0] || ring[0]![1] !== ring.at(-1)![1] || ringArea(ring) === 0) {
      return invalid("polygon has an open, degenerate or invalid coordinate ring");
    }
  }
  // Bounded batches keep even unusually fragmented polygons below the JS
  // argument limit; only this feature's rings are held while ZCTAs stream.
  let out: MultiPolygon = [];
  for (let offset = 0; offset < feature.rings.length; offset += 64) {
    const polygons = feature.rings.slice(offset, offset + 64).map(ring => [ring]);
    out = clip(() => polygonClipping.xor(out, ...polygons));
  }
  if (geometryArea(out) <= 0) return invalid("polygon has no filled area");
  return out;
}

/** Exact surface intersection supplies membership, not tabulated land shares.
 * Fractions stay unknown, including for a wholly contained ZCTA: TIGER ALAND
 * excludes water, while the clipped boundary includes the polygon's surface. */
export async function buildTigerOverlapGroups(
  districts: readonly Feature[],
  zctas: AsyncIterable<Feature>,
  target: TigerDistrictPlan,
  stateFips: string,
  signal?: AbortSignal,
): Promise<readonly BuiltGrouping[]> {
  const state = FIPS_TO_STATE[stateFips];
  if (!state) return invalid(`district state FIPS is invalid: ${stateFips}`);
  const joined = new Map<string, { geometry: MultiPolygon; bbox: Feature["bbox"]; name: string; overlaps: Map<string, BuiltOverlap> }>();
  for (const feature of districts) {
    signal?.throwIfAborted();
    if (property(feature, "STATEFP") !== stateFips) return invalid("district record belongs to a different state or lacks STATEFP");
    const raw = property(feature, target.column);
    if (unassigned(raw)) continue;
    if (!(target.type === "congressional_district" ? /^\d{1,2}$/ : /^[A-Z0-9]{1,3}$/i).test(raw)) return invalid(`invalid district code ${raw}`);
    const code = raw.toUpperCase().padStart(target.districtWidth, "0");
    const geoid = stateFips + code;
    if (property(feature, "GEOID") && property(feature, "GEOID") !== geoid) return invalid("district GEOID disagrees with its state and district code");
    const name = property(feature, "NAMELSAD") || property(feature, "NAME");
    const shape = geometry(feature), box = bounds(feature), old = joined.get(geoid);
    if (old) {
      if (old.name && name && old.name !== name) return invalid(`district ${geoid} has conflicting official names`);
      if (!old.name) old.name = name;
      old.geometry = clip(() => polygonClipping.union(old.geometry, shape));
      old.bbox = [Math.min(old.bbox[0], box[0]), Math.min(old.bbox[1], box[1]), Math.max(old.bbox[2], box[2]), Math.max(old.bbox[3], box[3])];
    } else joined.set(geoid, { geometry: shape, bbox: box, name, overlaps: new Map() });
  }
  if (!joined.size) return [];
  for await (const feature of zctas) {
    signal?.throwIfAborted();
    const box = bounds(feature);
    const candidates = [...joined.values()].filter(district => intersects(district.bbox, box));
    if (!candidates.length) continue;
    const zcta5 = property(feature, "ZCTA5CE20");
    if (!/^\d{5}$/.test(zcta5) || property(feature, "GEOID20") && property(feature, "GEOID20") !== zcta5) return invalid("ZCTA lacks its exact 2020 five-digit identifier");
    const shape = geometry(feature);
    for (const district of candidates) {
      signal?.throwIfAborted();
      if (geometryArea(clip(() => polygonClipping.intersection(shape, district.geometry))) <= 0) continue;
      if (district.overlaps.has(zcta5)) return invalid(`ZCTA ${zcta5} occurs more than once in the source`);
      const whole = clip(() => polygonClipping.difference(shape, district.geometry)).length === 0;
      district.overlaps.set(zcta5, { zcta5, whole, fraction: null });
    }
  }
  return [...joined].sort(([a], [b]) => a.localeCompare(b)).map(([geoid, district]) => {
    const raw = geoid.slice(2), code = raw === "00" ? "(At Large)" : /^\d+$/.test(raw) ? raw.replace(/^0+/, "") || "0" : raw;
    return { geoid, ocdId: null, stateFips, stateAbbr: state.postal, memberStates: [state.postal],
      label: district.name || `${state.postal} ${target.districtNoun} ${code} ${target.labelSuffix}`,
      overlaps: [...district.overlaps.values()].sort((a, b) => a.zcta5.localeCompare(b.zcta5)),
    };
  });
}
