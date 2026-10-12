import { createHash } from "node:crypto";
import { readBoundaryZip, readZip } from "../geo/shapefile.ts";
import { politeGetBytes } from "../sources/http.ts";
import { censusGeographyUserAgent } from "../census-geography/http.ts";
import type { BuiltScope } from "../census-geography/dataset.ts";
import type { GeographyVersion } from "../census-geography/contract.ts";
import { districtDocumentLines, parseDistrictTownAssignments } from "./document.ts";
import { shapesToGeometry } from "./geometry.ts";
import { buildOverlayScope, OverlayOverlapAccumulator, overlayDocumentMembers, overlayPartitionMembers, verifyOverlayTowns, type OverlayBoundary, type SourceDiscrepancy, type TownBoundary } from "./build.ts";
import { overlayDistrictCode, overlaySources, type OverlaySource } from "./reference.ts";

export interface OverlayAcquireOptions {
  readonly states?: ReadonlySet<string>;
  readonly sources?: readonly OverlaySource[];
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}
export interface OverlayAcquisition {
  readonly scopes: readonly BuiltScope[];
  readonly reports: readonly SourceDiscrepancy[];
  readonly failures: readonly OverlayAcquisitionFailure[];
}
export interface OverlayAcquisitionFailure {
  readonly sourceId: string;
  readonly version: string;
  readonly type: "overlay_district";
  readonly sourceUrls: readonly string[];
  readonly reason: string;
}

interface SourceBytes { readonly bytes: Buffer; readonly sha256: string; readonly url: string }
async function sourceBytes(url: string, options: OverlayAcquireOptions): Promise<SourceBytes> {
  let bytes: Buffer;
  if (options.fetchImpl) {
    const response = await options.fetchImpl(url, { headers: { "user-agent": censusGeographyUserAgent() }, signal: options.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
    bytes = Buffer.from(await response.arrayBuffer());
  } else {
    bytes = Buffer.from((await politeGetBytes(url, { signal: options.signal, maxBytes: 128 * 1024 * 1024 })).bytes);
  }
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), url };
}

async function districtDocument(source: OverlaySource, options: OverlayAcquireOptions): Promise<SourceBytes> {
  const failures: string[] = [];
  for (const url of [source.townDocumentUrl, ...(source.townDocumentMirrors ?? [])]) {
    try { return await sourceBytes(url, options); }
    catch (error) {
      if (options.signal?.aborted) throw error;
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`District town document unavailable from its official locations: ${failures.join("; ")}`);
}

/** Read the source's exact shapefile, including the no-district polygon without publishing it. */
export function parseOverlayBoundaryZip(source: OverlaySource, bytes: Buffer): OverlayBoundary[] {
  const entries = readZip(bytes);
  const shape = entries.find((entry) => entry.name.toLowerCase().endsWith(".shp"));
  if (shape?.name.split("/").at(-1)?.toLowerCase() !== source.shapeFile.toLowerCase()) throw new Error(`Overlay source does not contain expected shapefile ${source.shapeFile}`);
  const projection = entries.find((entry) => entry.name.toLowerCase().endsWith(".prj"))?.data.toString("utf8");
  if (!projection) throw new Error("Overlay source has no projection definition; coordinate units cannot be inferred");
  const { features } = readBoundaryZip(bytes);
  if (features.length !== source.expectedFeatures) throw new Error(`Overlay source returned ${features.length} boundary features; reference expects ${source.expectedFeatures}`);
  const codes = new Set<string>();
  return features.flatMap((feature) => {
    const rawCode = feature.properties[source.codeField];
    if (rawCode === undefined) throw new Error(`Overlay source lacks code field ${source.codeField}`);
    if (!rawCode.trim() || /^null$/i.test(rawCode)) return [];
    const code = overlayDistrictCode(source, rawCode);
    if (!code) throw new Error(`Overlay source has unknown district code ${rawCode}`);
    if (codes.has(code)) throw new Error(`Overlay source repeats district code ${code}`);
    codes.add(code);
    return [{ code, geometry: shapesToGeometry(feature.rings, projection) }];
  });
}

function parseTownBoundaries(source: OverlaySource, bytes: Buffer): TownBoundary[] {
  const projection = readZip(bytes).find((entry) => entry.name.toLowerCase().endsWith(".prj"))?.data.toString("utf8");
  if (!projection) throw new Error("Town source has no projection definition");
  const fields = source.townFields ?? { name: "NAME", county: "COUNTYFP", geoid: "GEOID", ward: undefined };
  const features = readBoundaryZip(bytes).features.filter((feature) => !feature.properties.STATEFP || feature.properties.STATEFP === source.stateFips);
  // Some official files contain both a whole-city polygon and its ward polygons.
  // Ward identities supply the legislative membership; counting the city too
  // would turn a valid ward assignment into a false partial-town difference.
  const wardCities = new Set(features.flatMap((feature) => fields.ward && /ward\s*\d+/i.test(feature.properties[fields.ward]) ? [feature.properties[fields.geoid]] : []));
  return features.filter((feature) => !wardCities.has(feature.properties[fields.geoid]) || (fields.ward && /ward\s*\d+/i.test(feature.properties[fields.ward]))).map((feature) => {
    const row = feature.properties;
    if (!row[fields.geoid] || !row[fields.name] || !row[fields.county]) throw new Error("Town boundary source lacks reference-declared identity fields");
    const county = row[fields.county], countyFips = /^\d+$/.test(county) ? county.padStart(3, "0") : Object.values(source.codePrefixes).find((prefix) => prefix.name.toLowerCase() === county.toLowerCase())?.countyFips;
    if (!countyFips) throw new Error(`Town boundary has unknown county ${county}`);
    const ward = fields.ward ? row[fields.ward] : "";
    const name = ward && /ward\s*\d+/i.test(ward) ? `${row[fields.name]} ${/ward\s*\d+/i.exec(ward)![0]}` : row[fields.name];
    return { geoid: row[fields.geoid] + (ward && /ward\s*\d+/i.test(ward) ? `:${/\d+/.exec(ward)![0]}` : ""), countyFips, name, geometry: shapesToGeometry(feature.rings, projection) };
  });
}

function parsePartitionBoundaries(bytes: Buffer, source: OverlaySource): { geoid: string; code?: string; geometry: ReturnType<typeof shapesToGeometry> }[] {
  const projection = readZip(bytes).find((entry) => entry.name.toLowerCase().endsWith(".prj"))?.data.toString("utf8");
  if (!projection) throw new Error("Census partition source has no projection definition");
  return readBoundaryZip(bytes).features.filter((feature) => feature.properties.GEOID && !/Z{2,}/i.test(feature.properties.GEOID)).map((feature) => {
    const designation = source.partitionDistrictField && source.partitionDesignationPattern ? new RegExp(source.partitionDesignationPattern).exec(feature.properties[source.partitionDistrictField])?.groups?.designation : undefined;
    const code = designation ? overlayDistrictCode(source, designation) : undefined;
    if (source.partitionDistrictField && !code) throw new Error(`Census partition district has no reference-matched designation: ${feature.properties[source.partitionDistrictField]}`);
    return { geoid: feature.properties.GEOID, code: code ?? undefined, geometry: shapesToGeometry(feature.rings, projection) };
  });
}

async function streamTownOverlaps(url: string, accumulator: OverlayOverlapAccumulator, options: OverlayAcquireOptions): Promise<string> {
  const response = await (options.fetchImpl ?? globalThis.fetch)(url, { headers: { "user-agent": censusGeographyUserAgent() }, signal: options.signal });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} fetching ${url}`);
  const hash = createHash("sha256"), decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    hash.update(chunk);
    pending += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = pending.indexOf("\n")) >= 0) {
      accumulator.add(pending.slice(0, newline).replace(/\r$/, ""));
      pending = pending.slice(newline + 1);
    }
  }
  pending += decoder.decode();
  if (pending) accumulator.add(pending.replace(/\r$/, ""));
  return hash.digest("hex");
}

export async function acquireOverlayScopes(options: OverlayAcquireOptions = {}): Promise<OverlayAcquisition> {
  const sources = (options.sources ?? overlaySources()).filter((source) => !options.states || options.states.has(source.stateFips));
  const scopes: BuiltScope[] = [], reports: SourceDiscrepancy[] = [], failures: OverlayAcquisitionFailure[] = [];
  for (const source of sources) {
    try {
      // Requests to the same official publisher remain sequential.
      const boundary = await sourceBytes(source.fileUrl, options);
      const document = await districtDocument(source, options);
      const attributedSource = { ...source, townDocumentUrl: document.url };
      const towns = await sourceBytes(source.townBoundaryUrl, options);
      const boundaries = parseOverlayBoundaryZip(source, boundary.bytes);
      const townBoundaries = parseTownBoundaries(source, towns.bytes);
      const partition = source.partitionBoundaryUrl ? await sourceBytes(source.partitionBoundaryUrl, options) : undefined;
      const partitionBoundaries = partition ? parsePartitionBoundaries(partition.bytes, source) : [];
      const assignments = parseDistrictTownAssignments(source, await districtDocumentLines(document.bytes, source.documentLayout), townBoundaries.map((town) => town.name), [...boundaries.map((boundary) => boundary.code), ...partitionBoundaries.flatMap((district) => district.code ? [district.code] : [])]);
      const overlayCodes = new Set(boundaries.map((boundary) => boundary.code));
      const checked = verifyOverlayTowns(attributedSource, boundaries, townBoundaries, assignments.filter((assignment) => assignment.overlay || overlayCodes.has(assignment.code)));
      reports.push(...checked.reports);
      if (!checked.verified.length) continue;
      let verified = checked.verified;
      const sourceUrls = [source.fileUrl, document.url, source.townBoundaryUrl];
      const checksums = [boundary.sha256, document.sha256, towns.sha256];
      if (partition && source.partitionBoundaryUrl) {
        sourceUrls.push(source.partitionBoundaryUrl); checksums.push(partition.sha256);
        verified = verified.flatMap((overlay) => {
          const members = source.partitionDistrictField ? overlayDocumentMembers(overlay.code, partitionBoundaries, assignments) : overlayPartitionMembers(overlay.geometry, partitionBoundaries);
          const uncovered = Array.isArray(members.uncovered) ? members.uncovered.length : members.uncovered;
          if (!members.geoids.length || members.partial.length || uncovered > 0.00001) {
            reports.push({ sourceId: source.id, code: overlay.code, label: overlay.code, geometryOnly: [], documentOnly: Array.isArray(members.uncovered) ? members.uncovered : [], partialTowns: [], sourceUrls: [source.fileUrl, document.url, source.partitionBoundaryUrl!], reason: `Overlay is not a union of complete Census base districts (${members.partial.length} partial districts; uncovered ${Array.isArray(members.uncovered) ? "town/ward count" : "area share"} ${uncovered})` });
            return [];
          }
          return [{ ...overlay, overlapGeoids: members.geoids }];
        });
      }
      if (!verified.length) continue;
      const overlaps = new OverlayOverlapAccumulator(verified, source.partitionGeoTag);
      const relationshipUrl = source.partitionRelationshipUrl ?? source.townRelationshipUrl;
      const relationshipSha = await streamTownOverlaps(relationshipUrl, overlaps, options);
      sourceUrls.push(relationshipUrl); checksums.push(relationshipSha);
      const versionMeta: GeographyVersion = {
        key: `overlay:${source.id}`, type: "overlay_district", stateFips: source.stateFips, chamber: source.chamber, plan: `${source.planStart}–${source.planEnd} ${source.chamber}-chamber overlay plan`, zctaTabulation: "2020",
        effectiveFor: `current representation under the ${source.planStart}–${source.planEnd} plan`, applicability: [{ purpose: "representation", from: `${source.planStart}-01-01`, through: `${Number(source.planEnd) + 1}-01-01` }, { purpose: "election", from: `${source.planStart}-01-01`, through: `${Number(source.planEnd) + 1}-01-01` }], retrievalComplete: true,
        provenance: { sourceUrls, sourceDataset: "OFFICIAL_LEGISLATIVE_OVERLAY+CENSUS_TAB20_REL2020", sourceFiles: sourceUrls.map((url) => decodeURIComponent(new URL(url).pathname.split("/").at(-1)!)), sourceChecksums: checksums, method: "Official overlay shapefile reprojected from its .prj definition to WGS84. Polygon town/ward membership cross-checked against the election authority district/town document; only agreeing districts publish with both sources. ZCTA area share = Σ the verified complete Census partition members' AREALAND_PART / AREALAND_ZCTA5_20 (the same land-area measure as Census district overlaps).", computedAt: new Date().toISOString() },
      };
      scopes.push(buildOverlayScope(attributedSource, verified, overlaps, versionMeta));
    } catch (error) {
      if (options.signal?.aborted) throw error;
      // Preserve the error class and precise source error: unrelated verified
      // sources continue, while a failed source never becomes an empty scope.
      failures.push({
        sourceId: source.id, version: `overlay:${source.id}`, type: "overlay_district",
        sourceUrls: [source.fileUrl, source.townDocumentUrl, ...(source.townDocumentMirrors ?? []), source.townBoundaryUrl, ...(source.partitionBoundaryUrl ? [source.partitionBoundaryUrl] : []), source.partitionRelationshipUrl ?? source.townRelationshipUrl],
        reason: error instanceof Error ? `${error.name}: ${error.message}` : `Non-Error acquisition failure: ${String(error)}`,
      });
    }
  }
  return { scopes, reports, failures };
}
