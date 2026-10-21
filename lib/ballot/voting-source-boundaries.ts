import { createHash } from "node:crypto";
import type { VotingBoundary, VotingJurisdiction, VotingSource } from "./voting-sites.ts";
import type { VotingDoorScope, VotingSourceBlank, VotingSourceDoor } from "./voting-source-types.ts";
import type { VotingFetchSession } from "./voting-source-fetch.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";

const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Public precinct polygons are acquired ahead of requests, in WGS84. */
export async function readVotingBoundaries(door: VotingSourceDoor, session: VotingFetchSession, source: VotingSource): Promise<VotingBoundary[]> {
  if (!isOfficialSource(door.url, door.officialLinkingPage)) throw new Error("Precinct boundaries lack an official publishing page");
  const base = door.url.replace(/\/query\/?(?:\?.*)?$/, "").replace(/\/$/, "");
  const arcgis = /(?:FeatureServer|MapServer)\/\d+$/i.test(base);
  const captures: { feature: unknown; source: VotingSource }[] = [];
  const captureSource = (capture: { url: string; bytes: Uint8Array }): VotingSource => ({ ...source,
    documentUrl: capture.url, documentHash: createHash("sha256").update(capture.bytes).digest("hex") });
  if (arcgis) {
    const query = async (parameters: Record<string, string>) => {
      const url = new URL(`${base}/query`);
      url.search = new URLSearchParams({ where: "1=1", f: "json", ...parameters }).toString();
      const capture = await session.get(url.href);
      const data = JSON.parse(new TextDecoder().decode(capture.bytes));
      if (data.error) throw new Error(`Precinct service: ${data.error.message ?? JSON.stringify(data.error)}`);
      return { ...data, captureSource: captureSource(capture) };
    };
    const ids = await query({ returnIdsOnly: "true" });
    if (!Array.isArray(ids.objectIds)) throw new Error("Precinct service did not return its complete object-ID list");
    const all = [...new Set(ids.objectIds as number[])];
    for (let at = 0; at < all.length; at += 250) {
      const batch = all.slice(at, at + 250);
      const data = await query({ f: "geojson", objectIds: batch.join(","), outFields: "*", outSR: "4326", returnGeometry: "true" });
      if (data.exceededTransferLimit || !Array.isArray(data.features) || data.features.length !== batch.length)
        throw new Error("Precinct service returned an incomplete polygon batch; retained boundaries must stay in use");
      captures.push(...data.features.map((feature: unknown) => ({ feature, source: data.captureSource })));
    }
  } else {
    const capture = await session.get(door.extraction?.dataUrl ?? door.url);
    const data = JSON.parse(new TextDecoder().decode(capture.bytes));
    if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) throw new Error("Precinct source is not a GeoJSON feature collection");
    captures.push(...data.features.map((feature: unknown) => ({ feature, source: captureSource(capture) })));
  }
  const value = (properties: Record<string, unknown>, field: "precinct" | "countyFips" | "ward") => {
    const configured = door.extraction?.columns?.[field];
    const aliases = field === "precinct" ? ["precinct", "precinctname", "precinctid", "precinctnumber", "pct", "vtdst", "vtdst20", "name"]
      : field === "countyFips" ? ["countyfips", "countygeoid"] : ["ward", "wardnumber"];
    const key = typeof configured === "string" ? configured : Object.keys(properties).find(key => aliases.includes(normalized(key)));
    return key && properties[key] != null ? String(properties[key]).trim() : "";
  };
  return captures.map((capture, index) => {
    const feature = capture.feature as { properties?: Record<string, unknown>; geometry?: VotingBoundary["geometry"] };
    const properties = feature.properties ?? {};
    const precinct = value(properties, "precinct"), geometry = feature.geometry;
    if (!precinct || !geometry || !["Polygon", "MultiPolygon"].includes(geometry.type) || !Array.isArray(geometry.coordinates))
      throw new Error(`Precinct feature ${index} lacks its published precinct name or polygon`);
    const rings = geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
    if (!rings.length || rings.some((ring: unknown) => !Array.isArray(ring) || ring.length < 4 || ring.some(point =>
      !Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90)))
      throw new Error(`Precinct feature ${index} has no valid longitude/latitude rings`);
    const countyFips = value(properties, "countyFips") || door.scope.countyFips;
    if (countyFips && !/^\d{5}$/.test(countyFips)) throw new Error(`Precinct feature ${index} has no valid five-digit county FIPS`);
    if (door.scope.countyFips && countyFips !== door.scope.countyFips) throw new Error(`Precinct feature ${index} belongs to another county`);
    return { precinct, kind: "OFFICIAL_PRECINCT" as const, geometry, source: capture.source,
      countyFips,
      ward: value(properties, "ward") || undefined };
  });
}

/** Boundary and assignment gaps join each place's existing standing source work. */
export function votingBoundaryBlanks(places: readonly VotingDoorScope[], jurisdictions: readonly VotingJurisdiction[], doors: readonly VotingSourceDoor[]): VotingSourceBlank[] {
  return places.flatMap(scope => {
    const held = jurisdictions.filter(jurisdiction => jurisdiction.ocdId === scope.ocdId ||
      jurisdiction.state === scope.state && scope.countyFips && jurisdiction.countyFips === scope.countyFips);
    const boundaries = held.flatMap(jurisdiction => jurisdiction.boundaries ?? []);
    const key = (value: string) => normalized(value.replace(/^(?:precinct|voting district)\s*/i, "")).replace(/^0+(?=\d)/, "");
    const assigned = new Set(held.flatMap(jurisdiction => jurisdiction.sites.flatMap(site => site.precincts ?? (site.precinct ? [site.precinct] : []))).map(key));
    const missing = boundaries.filter(boundary => !assigned.has(key(boundary.precinct)));
    if (boundaries.length && !missing.length) return [];
    return [{ id: `voting-precincts:${scope.ocdId}`, doorId: `voting-boundaries:${scope.ocdId}`, scope, status: "open" as const,
      reason: "missing-sites" as const, owed: boundaries.length ? `Election Day polling-place assignments for ${missing.length} published precincts` : "Current official precinct boundaries and each precinct's Election Day polling place",
      tried: doors.filter(door => door.scope.ocdId === scope.ocdId || scope.countyFips && door.scope.countyFips === scope.countyFips).map(door => door.url),
      next: ["Follow the county or town election office's official GIS, GeoJSON, and precinct-directory sources", "Match each published precinct name to its official polling-place assignment"] }];
  });
}
