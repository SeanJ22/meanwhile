import { createHash } from "node:crypto";

import { readBoundaryZip, readZip, type Feature } from "../geo/shapefile.ts";
import { TRIBAL_SEAT_REFERENCES, type TribalSeatReference } from "../officials/tribal-seats.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import { shapesToGeometry, geometryPolygons } from "../overlay-geography/geometry.ts";
import { WHOLE_THRESHOLD, parseTab20Header } from "./build.ts";
import type { GeographyGeometry, GeographyVersion } from "./contract.ts";
import type { BuiltGrouping, BuiltOverlap, BuiltScope } from "./dataset.ts";
import { censusWorkDivision } from "./division-id.ts";
import { censusGeographyUserAgent } from "./http.ts";

/** Keep the boundary and land-overlap vintages aligned. A newer boundary
 * alone cannot establish new ZIP land shares from the older relationship. */
export const CENSUS_AIANNH = {
  year: 2020,
  version: "aiannh:2020",
  url: "https://www2.census.gov/geo/tiger/TIGER2020/AIANNH/tl_2020_us_aiannh.zip",
  blockAssignmentBase: "https://www2.census.gov/geo/docs/maps-data/data/baf2020",
  zctaBlockUrl: "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tabblock20_natl.txt",
} as const;

export interface AcquireAiannhOptions {
  readonly fetchImpl?: typeof fetch;
  readonly states?: ReadonlySet<string>;
  readonly signal?: AbortSignal;
  readonly references?: readonly TribalSeatReference[];
}

function areaCode(componentId: string): string {
  if (!/^\d{4}[RT]?$/.test(componentId)) throw new Error(`Invalid Census AIANNH component id ${componentId}`);
  return componentId.slice(0, 4);
}

/** Census's documented BAF20 AIANNH member is BLOCKID|AIANNHCE|COMPTYPE.
 * Keep only blocks of referenced areas; preserve Census block IDs verbatim. */
export function aiannhBlockAssignments(text: string, areaCodes: ReadonlySet<string>): Map<string, string> {
  const [header, ...lines] = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (!header) throw new Error("Census AIANNH block assignment has no header");
  const fields = parseTab20Header(header);
  const at = (name: string): number => {
    const index = fields.indexOf(name);
    if (index < 0) throw new Error(`Census AIANNH block assignment is missing column ${name}`);
    return index;
  };
  const columns = { block: at("BLOCKID"), area: at("AIANNHCE"), component: at("COMPTYPE") };
  const assignments = new Map<string, string>();
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = line.replace(/^\uFEFF/, "").split("|");
    const geoid = row[columns.area]?.trim() ?? "";
    if (!areaCodes.has(geoid)) continue;
    const block = row[columns.block]?.trim() ?? "";
    const component = row[columns.component]?.trim() ?? "";
    if (!/^\d{15}$/.test(block) || !/^[RT]$/.test(component)) throw new Error("Census AIANNH assignment has an invalid block or component");
    if (assignments.has(block) && assignments.get(block) !== geoid) throw new Error(`Conflicting Census AIANNH assignments for block ${block}`);
    assignments.set(block, geoid);
  }
  return assignments;
}

/** Stream Census's national 2020 ZCTA↔block land table. The block assignment
 * map is bounded to referenced areas; the source provides each full ZCTA's
 * denominator, including its land on either side of a state line. */
export class AiannhLandAccumulator {
  private readonly byArea = new Map<string, Map<string, number>>();
  private readonly zctaLand = new Map<string, number>();
  private readonly assignments: ReadonlyMap<string, string>;
  private columns: { zcta: number; land: number; block: number; total: number } | null = null;

  constructor(assignments: ReadonlyMap<string, string>) { this.assignments = assignments; }

  addLine(line: string): void {
    if (!line.trim()) return;
    const row = line.replace(/^\uFEFF/, "").split("|");
    if (!this.columns || row.includes("GEOID_ZCTA5_20")) {
      const at = (name: string): number => {
        const index = row.indexOf(name);
        if (index < 0) throw new Error(`Census ZCTA↔block header is missing column ${name}`);
        return index;
      };
      this.columns = { zcta: at("GEOID_ZCTA5_20"), land: at("AREALAND_PART"), block: at("GEOID_TABBLOCK_20"), total: at("AREALAND_ZCTA5_20") };
      return;
    }
    const geoid = this.assignments.get(row[this.columns.block]?.trim() ?? "");
    const zcta5 = row[this.columns.zcta]?.trim() ?? "";
    if (!geoid || !zcta5) return;
    const land = Number(row[this.columns.land]);
    const total = Number(row[this.columns.total]);
    if (!/^\d{5}$/.test(zcta5) || !Number.isFinite(land) || land < 0 || !Number.isFinite(total) || total < 0) throw new Error("Census ZCTA↔block relationship has an invalid ZCTA or land area");
    if (this.zctaLand.has(zcta5) && this.zctaLand.get(zcta5) !== total) throw new Error(`Inconsistent Census ZCTA land area for ${zcta5}`);
    this.zctaLand.set(zcta5, total);
    if (land === 0) return;
    let zctas = this.byArea.get(geoid);
    if (!zctas) { zctas = new Map(); this.byArea.set(geoid, zctas); }
    zctas.set(zcta5, land + (zctas.get(zcta5) ?? 0));
  }

  finish(): Map<string, BuiltOverlap[]> {
    if (!this.columns) throw new Error("Census ZCTA↔block source has no header");
    return new Map([...this.byArea].map(([geoid, zctas]) => [geoid, [...zctas].sort(([a], [b]) => a.localeCompare(b)).map(([zcta5, part]) => {
      const total = this.zctaLand.get(zcta5);
      if (total === undefined) throw new Error(`Census land denominator is missing for ZCTA ${zcta5}`);
      const fraction = total > 0 ? Math.min(1, part / total) : null;
      return { zcta5, fraction, whole: fraction !== null && fraction >= WHOLE_THRESHOLD };
    })]));
  }
}

/** A reference establishes the state/seat association; geographic proximity
 * never establishes membership in a nation. Only referenced seat areas are
 * published in this scope, and its provenance states that bounded coverage. */
export function buildAiannhScope(
  features: readonly Feature[],
  overlaps: ReadonlyMap<string, readonly BuiltOverlap[]>,
  references: readonly TribalSeatReference[],
  versionMeta: GeographyVersion,
): BuiltScope {
  const referencedComponents = new Set(references.flatMap(row => [...row.aiannhAreaIds]));
  const components = new Map(features.map(feature => [feature.properties.GEOID, feature]));
  for (const id of referencedComponents) {
    areaCode(id);
    if (!components.has(id)) throw new Error(`Referenced Census AIANNH component ${id} is missing from the boundary file`);
  }
  const groupings: BuiltGrouping[] = [];
  const codes = new Set([...referencedComponents].map(areaCode));
  for (const geoid of [...codes].sort()) {
    const seats = references.filter(row => row.aiannhAreaIds.some(id => areaCode(id) === geoid));
    const states = [...new Set(seats.map(row => row.state))].sort();
    const chambers = [...new Set(seats.map(row => row.chamber))];
    if (states.length !== 1 || chambers.length !== 1 || !["upper", "lower"].includes(chambers[0])) throw new Error(`Ambiguous legislative association for AIANNH ${geoid}`);
    const parts = features.filter(feature => areaCode(feature.properties.GEOID) === geoid);
    const geometries = parts.map(feature => shapesToGeometry(feature.rings, "EPSG:4269"));
    const geometry: GeographyGeometry = { type: "MultiPolygon", coordinates: geometries.flatMap(shape => geometryPolygons(shape)) };
    const base = {
      geoid,
      ocdId: null,
      label: parts[0].properties.NAME,
      stateFips: seats[0].stateFips,
      stateAbbr: states[0],
      memberStates: states,
      chamber: chambers[0] as "upper" | "lower",
      representation: "tribal" as const,
      geometry,
      sourceUrls: [...versionMeta.provenance.sourceUrls],
      sourceOrg: "U.S. Census Bureau",
      overlaps: overlaps.get(geoid) ?? [],
    };
    groupings.push({ ...base, ocdId: censusWorkDivision({ ...base, type: "aiannh", version: versionMeta.key }) });
  }
  return {
    type: "aiannh",
    version: versionMeta.key,
    versionMeta,
    fractionBasis: "area",
    groupings,
    instanceCount: groupings.length,
    zctaEdgeCount: groupings.reduce((count, row) => count + row.overlaps.length, 0),
  };
}

export async function acquireAiannhScope(options: AcquireAiannhOptions = {}): Promise<BuiltScope | null> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const references = (options.references ?? TRIBAL_SEAT_REFERENCES).filter(row => !options.states || options.states.has(row.stateFips));
  if (references.length === 0) return null;
  const fetchSource = async (url: string): Promise<Buffer> => {
    const response = await fetchImpl(url, { headers: { "user-agent": censusGeographyUserAgent() }, signal: options.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
    return Buffer.from(await response.arrayBuffer());
  };
  const boundaries = await fetchSource(CENSUS_AIANNH.url);
  const areaCodes = new Set(references.flatMap(row => row.aiannhAreaIds.map(areaCode)));
  const assignments = new Map<string, string>();
  const sourceUrls: string[] = [CENSUS_AIANNH.url];
  const sourceChecksums = [createHash("sha256").update(boundaries).digest("hex")];
  for (const state of [...new Set(references.map(row => row.stateFips))].sort()) {
    const postal = FIPS_TO_STATE[state]?.postal;
    if (!postal) throw new Error(`Census AIANNH reference has an unknown state FIPS ${state}`);
    const url = `${CENSUS_AIANNH.blockAssignmentBase}/BlockAssign_ST${state}_${postal}.zip`;
    const archive = await fetchSource(url);
    const members = readZip(archive).filter(entry => /(?:^|\/)BlockAssign_ST\d{2}_[A-Z]{2}_AIANNH\.txt$/i.test(entry.name));
    if (members.length !== 1) throw new Error(`Census block assignment archive must contain one AIANNH member: ${url}`);
    for (const [block, geoid] of aiannhBlockAssignments(members[0].data.toString("utf8"), areaCodes)) {
      if (block.slice(0, 2) !== state) throw new Error(`Census block assignment is outside its state file: ${block}`);
      if (assignments.has(block) && assignments.get(block) !== geoid) throw new Error(`Conflicting Census AIANNH assignments for block ${block}`);
      assignments.set(block, geoid);
    }
    sourceUrls.push(url);
    sourceChecksums.push(createHash("sha256").update(archive).digest("hex"));
  }
  const assignedAreas = new Set(assignments.values());
  for (const geoid of areaCodes) if (!assignedAreas.has(geoid)) throw new Error(`Referenced AIANNH ${geoid} has no blocks in the Census assignment files`);
  const accumulator = new AiannhLandAccumulator(assignments);
  const response = await fetchImpl(CENSUS_AIANNH.zctaBlockUrl, { headers: { "user-agent": censusGeographyUserAgent() }, signal: options.signal });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} fetching ${CENSUS_AIANNH.zctaBlockUrl}`);
  const hash = createHash("sha256");
  const decoder = new TextDecoder("utf8");
  const reader = response.body.getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      accumulator.addLine(buffer.slice(0, newline).replace(/\r$/, ""));
      buffer = buffer.slice(newline + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer.length) accumulator.addLine(buffer.replace(/\r$/, ""));
  sourceUrls.push(CENSUS_AIANNH.zctaBlockUrl);
  sourceChecksums.push(hash.digest("hex"));
  const versionMeta: GeographyVersion = {
    key: CENSUS_AIANNH.version,
    type: "aiannh",
    plan: "2020 Census AIANNH boundaries for referenced legislative seats",
    zctaTabulation: "2020",
    effectiveFor: "Referenced tribal legislative seats; reservation and off-reservation trust land combined by Census area code",
    applicability: [{ purpose: "representation", from: "2020-01-01" }],
    retrievalComplete: true,
    provenance: {
      sourceUrls,
      sourceDataset: "CENSUS_TIGER_AIANNH2020+CENSUS_BAF2020+CENSUS_TAB20_REL2020",
      sourceFiles: sourceUrls.map(url => url.split("/").pop()!),
      sourceChecksums,
      method: "Bounded to AIANNH areas named by legislative-seat reference data. TIGER/Line 2020 reservation and off-reservation trust-land polygons are reprojected from NAD83 to WGS84 and combined by the four-digit AIANNHCE. Census BAF20 AIANNH assigns BLOCKID to AIANNHCE and COMPTYPE. Those blocks join the national Census 2020 ZCTA↔tabulation-block relationship: ZIP area share = Σ AREALAND_PART for the area's blocks / AREALAND_ZCTA5_20. The full Census ZCTA denominator includes both sides of cross-state ZCTAs; no population weight is used. A point in that geometry locates the seat; it does not establish tribal membership.",
      computedAt: new Date().toISOString(),
    },
  };
  return buildAiannhScope(readBoundaryZip(boundaries).features, accumulator.finish(), references, versionMeta);
}
