import { createHash } from "node:crypto";
import { readBoundaryZip, readZip } from "../geo/shapefile.ts";
import { politeGetBytes } from "../sources/http.ts";
import { censusGeographyUserAgent } from "../census-geography/http.ts";
import type { BuiltScope } from "../census-geography/dataset.ts";
import type { GeographyVersion } from "../census-geography/contract.ts";
import { districtDocumentLines, parseDistrictTownAssignments } from "./document.ts";
import { shapesToGeometry } from "./geometry.ts";
import { buildOverlayScope, OverlayOverlapAccumulator, overlayPartitionMembers, verifyOverlayTowns, type OverlayBoundary, type SourceDiscrepancy, type TownBoundary } from "./build.ts";
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

interface SourceBytes { readonly bytes: Buffer; readonly sha256: string }
async function sourceBytes(url: string, options: OverlayAcquireOptions): Promise<SourceBytes> {
  let bytes: Buffer;
  if (options.fetchImpl) {
    const response = await options.fetchImpl(url, { headers: { "user-agent": censusGeographyUserAgent() }, signal: options.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
    bytes = Buffer.from(await response.arrayBuffer());
  } else {
    bytes = Buffer.from((await politeGetBytes(url, { signal: options.signal, maxBytes: 128 * 1024 * 1024 })).bytes);
  }
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
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
  return readBoundaryZip(bytes).features.filter((feature) => !feature.properties.STATEFP || feature.properties.STATEFP === source.stateFips).map((feature) => {
    const row = feature.properties;
    if (!row[fields.geoid] || !row[fields.name] || !row[fields.county]) throw new Error("Town boundary source lacks reference-declared identity fields");
    const county = row[fields.county], countyFips = /^\d+$/.test(county) ? county.padStart(3, "0") : Object.values(source.codePrefixes).find((prefix) => prefix.name.toLowerCase() === county.toLowerCase())?.countyFips;
    if (!countyFips) throw new Error(`Town boundary has unknown county ${county}`);
    const ward = fields.ward ? row[fields.ward] : "";
    const name = ward && /ward\s*\d+/i.test(ward) ? `${row[fields.name]} ${/ward\s*\d+/i.exec(ward)![0]}` : row[fields.name];
    return { geoid: row[fields.geoid] + (ward && /ward\s*\d+/i.test(ward) ? `:${/\d+/.exec(ward)![0]}` : ""), countyFips, name, geometry: shapesToGeometry(feature.rings, projection) };
  });
}

function parsePartitionBoundaries(bytes: Buffer): { geoid: string; geometry: ReturnType<typeof shapesToGeometry> }[] {
  const projection = readZip(bytes).find((entry) => entry.name.toLowerCase().endsWith(".prj"))?.data.toString("utf8");
  if (!projection) throw new Error("Census partition source has no projection definition");
  return readBoundaryZip(bytes).features.filter((feature) => feature.properties.GEOID && !/Z{2,}/i.test(feature.properties.GEOID)).map((feature) => ({ geoid: feature.properties.GEOID, geometry: shapesToGeometry(feature.rings, projection) }));
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
      const document = await sourceBytes(source.townDocumentUrl, options);
      const towns = await sourceBytes(source.townBoundaryUrl, options);
      const boundaries = parseOverlayBoundaryZip(source, boundary.bytes);
      const townBoundaries = parseTownBoundaries(source, towns.bytes);
      const assignments = parseDistrictTownAssignments(source, await districtDocumentLines(document.bytes), townBoundaries.map((town) => town.name));
      const checked = verifyOverlayTowns(source, boundaries, townBoundaries, assignments);
      reports.push(...checked.reports);
      if (!checked.verified.length) continue;
      let verified = checked.verified;
      const sourceUrls = [source.fileUrl, source.townDocumentUrl, source.townBoundaryUrl];
      const checksums = [boundary.sha256, document.sha256, towns.sha256];
      if (source.partitionBoundaryUrl) {
        const partition = await sourceBytes(source.partitionBoundaryUrl, options);
        sourceUrls.push(source.partitionBoundaryUrl); checksums.push(partition.sha256);
        const partitionBoundaries = parsePartitionBoundaries(partition.bytes);
        verified = verified.flatMap((overlay) => {
          const members = overlayPartitionMembers(overlay.geometry, partitionBoundaries);
          if (!members.geoids.length || members.partial.length || members.uncovered > 0.00001) {
            reports.push({ sourceId: source.id, code: overlay.code, label: overlay.code, geometryOnly: [], documentOnly: [], partialTowns: [], sourceUrls: [source.fileUrl, source.partitionBoundaryUrl!], reason: `Overlay is not a union of complete Census base districts (${members.partial.length} partial districts; uncovered area share ${members.uncovered})` });
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
      scopes.push(buildOverlayScope(source, verified, overlaps, versionMeta));
    } catch (error) {
      if (options.signal?.aborted) throw error;
      // Preserve the error class and precise source error: unrelated verified
      // sources continue, while a failed source never becomes an empty scope.
      failures.push({
        sourceId: source.id, version: `overlay:${source.id}`, type: "overlay_district",
        sourceUrls: [source.fileUrl, source.townDocumentUrl, source.townBoundaryUrl, ...(source.partitionBoundaryUrl ? [source.partitionBoundaryUrl] : []), source.partitionRelationshipUrl ?? source.townRelationshipUrl],
        reason: error instanceof Error ? `${error.name}: ${error.message}` : `Non-Error acquisition failure: ${String(error)}`,
      });
    }
  }
  return { scopes, reports, failures };
}
