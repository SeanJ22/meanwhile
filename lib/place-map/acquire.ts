import type { RegistrationReference } from "../registration/reference.ts";
import type { MapPlace } from "./load.ts";
import type { PlaceBoundary } from "./types.ts";
import { censusDirectoryFiles, censusSourceRelease, censusTextLines, type CensusSourceOptions } from "../census-geography/source-release.ts";
import { parseGrfHeader } from "../census-geography/grf.ts";
import { censusTigerArchive } from "../census-geography/tiger-source.ts";
import { tigerFeatures } from "../census-geography/tiger-shapefile.ts";
import { tigerDistrictPlan, tigerGeometry } from "../census-geography/tiger-overlap.ts";
import { stateBase, countyIdentity, placeIdentity, schoolIdentity, subdivisionIdentity } from "../ocd/divisions.ts";
import { districtIdentity } from "../ocd/fips.ts";
import { legislativeIdentity } from "../ocd/divisions.ts";
import { boundaryYear, registeredPlaceIds } from "./build.ts";
import type { Feature } from "../geo/shapefile.ts";

/** Acquire one state's source polygons, keeping district plan metadata from
 * the DBF. National archive records stream; only this state's shapes are held. */
export async function acquireStateBoundaries(reg: RegistrationReference, options: CensusSourceOptions & { readonly onlyLayers?: ReadonlySet<string> } = {}, legacyIds: readonly string[] = []): Promise<{
  places: MapPlace[]; boundaries: PlaceBoundary[];
}> {
  const fips = reg.divisions.find(d => d[1] === "state")?.[2];
  if (!fips) throw new Error(`State FIPS is missing: ${reg.state}`);
  const byGeoid = registeredPlaceIds(reg);
  for (const id of legacyIds) { const code = /\/aiannh:(\d{4})$/.exec(id)?.[1]; if (code) byGeoid.set(`aiannh:${code}`, id); }
  if (!options.onlyLayers || options.onlyLayers.has("aiannh")) {
    const release = await censusSourceRelease(`https://www2.census.gov/geo/docs/maps-data/data/grf/2026/public_grfc_cur26_${fips}.txt`, options);
    const lines = censusTextLines(release.bytes), column = parseGrfHeader(lines.next().value ?? "").indexOf("AIANNHCE");
    if (column < 0) throw new Error("Census GRF is missing AIANNHCE");
    for (const line of lines) {
      const code = line.split("|")[column];
      if (code && !/^(0+|9+)$/.test(code) && !byGeoid.has(`aiannh:${code}`)) byGeoid.set(`aiannh:${code}`, `ocd-division/country:us/aiannh:${code}`);
    }
  }
  const byId = new Map(reg.divisions.map(d => [d[0], d]));
  const countyNames = new Map(reg.divisions.filter(d => d[1] === "county").map(d => [d[2], d[3]]));
  const places = new Map<string, MapPlace>(), boundaries = new Map<string, PlaceBoundary>();
  const sourceFiles = [
    ...["state", "county", "cousub", "place", "unsd", "elsd", "scsd", "aiannh"].map(layer => ({ layer, release: 2026 })),
    ...[2025, 2026].flatMap(release => ["cd", "sldu", "sldl"].map(layer => ({ layer, release }))),
  ];
  for (const { layer, release } of sourceFiles) {
    if (options.onlyLayers && !options.onlyLayers.has(layer)) continue;
    options.signal?.throwIfAborted();
    const folder = `https://www2.census.gov/geo/tiger/TIGER${release}/${layer.toUpperCase()}/`;
    const name = `tl_${release}_${["state", "county", "aiannh"].includes(layer) ? "us" : fips}_${layer === "cd" ? `cd${release === 2025 ? 119 : 120}` : layer}.zip`;
    const url = folder + name;
    const listing = await censusDirectoryFiles(folder, options);
    if (!listing.includes(url)) continue;
    let features: Feature[] = [];
    const archive = await censusTigerArchive(url, options, async path => {
      features = [];
      for await (const feature of tigerFeatures(path, undefined, options.signal, properties => layer === "aiannh"
        ? byGeoid.has(`aiannh:${properties.AIANNHCE}`) : properties.STATEFP === fips)) features.push(feature);
      if (!features.length && ["state", "county"].includes(layer)) throw new Error(`No ${reg.state} polygons in ${url}`);
    });
    try {
      const plan = ["cd", "sldu", "sldl"].includes(layer) ? tigerDistrictPlan(features, layer as "cd" | "sldu" | "sldl", url) : null;
      if (["cd", "sldu", "sldl"].includes(layer) && !plan) continue;
      const version = plan?.version ?? `${layer}:${release}`, year = boundaryYear(version);
      for (const feature of features) {
        const p = feature.properties, geoid = layer === "aiannh" ? p.AIANNHCE : p.GEOID ?? p.GEOID20, name = p.NAMELSAD ?? p.NAME ?? geoid;
        if (!geoid) throw new Error(`Missing GEOID in ${url}`);
        const districtCode = plan ? p[plan.column] : "";
        if (plan && (!districtCode || /^Z+$/.test(districtCode) || districtCode === "999")) continue;
        const inferred = layer === "state" ? stateBase(fips)?.base
          : layer === "county" ? countyIdentity(fips, name)?.ocdId
          : layer === "place" ? placeIdentity(fips, name)?.ocdId
          : layer === "cousub" ? subdivisionIdentity(fips, countyNames.get(geoid.slice(0, 5)) ?? "", name)?.ocdId
          : ["unsd", "elsd", "scsd"].includes(layer) ? schoolIdentity(fips, name)?.ocdId
          : layer === "cd" ? districtIdentity(fips, districtCode)?.ocdId
          : legislativeIdentity(fips, layer as "sldu" | "sldl", districtCode, name)?.ocdId;
        let id = byGeoid.get(`${layer}:${geoid}`) ?? inferred;
        if (!id) throw new Error(`No place identity for ${layer}:${geoid}`);
        if (!byGeoid.has(`${layer}:${geoid}`) && byId.has(id) && byId.get(id)?.[2] !== geoid) id = `${id}_${geoid}`;
        const previous = places.get(id);
        const aliases = [...previous?.aliases ?? [], { scheme: `census-geoid:${layer}`, value: geoid },
          ...(layer === "aiannh" && p.GEOID && p.GEOID !== geoid ? [{ scheme: "census-geoid:aiannh", value: p.GEOID }] : []),
          ...(["unsd", "elsd", "scsd"].includes(layer) ? [{ scheme: "nces", value: geoid }] : [])];
        places.set(id, { id, name, state: reg.state.toUpperCase(), aliases: [...new Map(aliases.map(a => [`${a.scheme}:${a.value}`, a])).values()] });
        byGeoid.set(`${layer}:${geoid}`, id);
        const geometry = { type: "MultiPolygon" as const, coordinates: tigerGeometry(feature) };
        const heldBoundary = boundaries.get(`${id}|${year}`);
        // Different release files can describe the same legislative plan.
        // Keep the newest release's shape; merge only parts in that same file.
        const previousBoundary = heldBoundary?.sourceUrls.includes(url) ? heldBoundary : undefined;
        const coordinates = previousBoundary?.geometry ? [...(previousBoundary.geometry.type === "Polygon" ? [previousBoundary.geometry.coordinates] : previousBoundary.geometry.coordinates), ...geometry.coordinates] : geometry.coordinates;
        boundaries.set(`${id}|${year}`, { placeId: id, layer, boundaryYear: year, version,
          geometry: { type: "MultiPolygon", coordinates }, hostCountyId: null, countyAttachment: false,
          sourceUrls: [...new Set([...(previousBoundary?.sourceUrls ?? []), url])], checkedAt: new Date().toISOString() });
      }
    } finally { await archive.dispose(); }
  }
  return { places: [...places.values()], boundaries: [...boundaries.values()] };
}
