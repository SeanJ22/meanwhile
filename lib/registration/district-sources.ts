/**
 * The boundary layers that give special districts their own territory. Each row is data: adding a state's or a
 * county's layer to data/reference/geography/district-boundary-sources.json needs no code, and
 * scripts/district-territories.mts reads every row.
 */

export const DISTRICT_SOURCES_FILE = "data/reference/geography/district-boundary-sources.json";

export type DistrictKind =
  | "fire" | "water" | "sewer" | "library" | "park" | "hospital" | "cemetery" | "irrigation" | "drainage"
  | "transit" | "conservation" | "facilities" | "mosquito" | "airport" | "housing" | "other";

export interface DistrictBoundarySource {
  readonly id: string;
  /** Postal code of the state whose districts the layer draws. */
  readonly state: string;
  /** A county layer's county; a feature only names a Census special district in that county. */
  readonly countyFips?: string | null;
  readonly kinds: readonly DistrictKind[];
  readonly title: string;
  readonly publisher: string;
  /** The government page linking the layer, when the layer's own host is not .gov. */
  readonly officialPage?: string | null;
  /** An ArcGIS layer (its REST URL, ending in the layer number) or a GeoJSON file. */
  readonly format: "arcgis" | "geojson";
  readonly url: string;
  readonly nameField: string;
  /** When the layer names a district only by number, its full name from the feature's fields: "Douglas County Sanitary and Improvement District {sid}". */
  readonly nameTemplate?: string | null;
  readonly idField?: string | null;
  /** A layer holding several kinds names each feature's kind in this field. */
  readonly kindField?: string | null;
  readonly kindValues?: Readonly<Record<string, DistrictKind>> | null;
  readonly where?: string | null;
  /**
   * "list": a feature naming no Census special district is still a district the official layer draws, listed by
   * the layer's own name. "skip": the layer also draws other providers (a city's or a company's water system), so
   * only features naming a Census special district are used.
   */
  readonly unmatched: "list" | "skip";
}

export interface DistrictBoundarySources {
  readonly formatVersion: 1;
  readonly sources: readonly DistrictBoundarySource[];
}

const GENERIC = new Set(["THE", "OF", "AND", "DISTRICT", "DIST", "DISTRICTS", "NO", "NUMBER", "NUM", "COUNTY", "CO", "SPECIAL", "AUTHORITY", "AUTH", "BOARD", "INC"]);
const KIND_WORDS: Readonly<Record<DistrictKind, readonly string[]>> = {
  fire: ["FIRE", "PROTECTION", "FPD", "FD", "RURAL", "DEPARTMENT", "DEPT", "RESCUE", "EMERGENCY", "SERVICES", "SERVICE", "ESD", "VOLUNTEER", "VFD", "MEDICAL", "EMS", "FIRST", "RESPONDER", "RESPONSE"],
  water: ["WATER", "MUNICIPAL", "UTILITY", "UTILITIES", "MUD", "SUPPLY", "CONSERVANCY", "IMPROVEMENT", "WCID", "CONTROL", "WSD", "PUD", "PUBLIC"],
  sewer: ["SEWER", "SEWERAGE", "SEWAGE", "SANITARY", "SANITATION", "WASTEWATER", "RECLAMATION", "TREATMENT", "UTILITIES", "UTILITY", "MUNICIPAL"],
  library: ["LIBRARY", "PUBLIC", "FREE", "MEMORIAL"],
  park: ["PARK", "PARKS", "RECREATION", "REC", "RECREATIONAL", "FOREST", "PRESERVE"],
  hospital: ["HOSPITAL", "HEALTH", "HEALTHCARE", "CARE", "MEDICAL", "PUBLIC"],
  cemetery: ["CEMETERY", "CEMETERIES", "MEMORIAL"],
  irrigation: ["IRRIGATION", "DITCH", "CANAL", "WATER", "RESERVOIR"],
  drainage: ["DRAINAGE", "LEVEE", "FLOOD", "CONTROL", "STORMWATER"],
  transit: ["TRANSIT", "TRANSPORTATION", "REGIONAL", "AREA"],
  conservation: ["CONSERVATION", "SOIL", "NATURAL", "RESOURCES", "RESOURCE", "WATERSHED"],
  facilities: ["COMMUNITY", "FACILITIES", "FACILITY", "CFD", "IMPROVEMENT", "METROPOLITAN", "METRO", "TAXING"],
  mosquito: ["MOSQUITO", "VECTOR", "CONTROL", "ABATEMENT"],
  airport: ["AIRPORT", "PORT"],
  housing: ["HOUSING"],
  other: [],
};
const SPELLED: Readonly<Record<string, string>> = { MT: "MOUNT", FT: "FORT", PT: "POINT", HTS: "HEIGHTS", VLY: "VALLEY", TWP: "TOWNSHIP", N: "NORTH", S: "SOUTH", E: "EAST", W: "WEST" };

/** The words of a district name that tell districts of one kind apart, run together: the kind and the generic words removed. */
export function districtNameKey(name: string, kind: DistrictKind | string): string {
  const drop = new Set([...GENERIC, ...(KIND_WORDS[kind as DistrictKind] ?? [])]);
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, " ").trim()
    .split(" ").map(word => SPELLED[word] ?? word).map(word => word.replace(/^0+(?=\d)/, "")).filter(word => word && !drop.has(word)).join("");
}
