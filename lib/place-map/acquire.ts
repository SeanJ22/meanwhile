import type { RegistrationReference } from "../registration/reference.ts";
import type { MapPlace } from "./load.ts";
import type { PlaceBoundary } from "./types.ts";
import { censusDirectoryFiles, type CensusSourceOptions } from "../census-geography/source-release.ts";
import { censusTigerArchive } from "../census-geography/tiger-source.ts";
import { tigerFeatures } from "../census-geography/tiger-shapefile.ts";
import { tigerDistrictPlan, tigerGeometry } from "../census-geography/tiger-overlap.ts";
import { stateBase, countyIdentity, placeIdentity, schoolIdentity, subdivisionIdentity } from "../ocd/divisions.ts";
import { districtIdentity } from "../ocd/fips.ts";
import { legislativeIdentity } from "../ocd/divisions.ts";
import { boundaryYear } from "./build.ts";
import type { Feature } from "../geo/shapefile.ts";

/** Acquire one state's source polygons, keeping district plan metadata from
 * the DBF. National archive records stream; only this state's shapes are held. */
export async function acquireStateBoundaries(reg: RegistrationReference, options: CensusSourceOptions = {}): Promise<{
  places: MapPlace[]; boundaries: PlaceBoundary[];
}> {
  const fips = reg.divisions.find(d => d[1] === "state")?.[2];
  if (!fips) throw new Error(`State FIPS is missing: ${reg.state}`);
  const byGeoid = new Map(reg.divisions.map(d => [`${d[1]}:${d[2]}`, d[0]]));
  const byId = new Map(reg.divisions.map(d => [d[0], d]));
  const countyNames = new Map(reg.divisions.filter(d => d[1] === "county").map(d => [d[2], d[3]]));
  const places = new Map<string, MapPlace>(), boundaries = new Map<string, PlaceBoundary>();
  const sourceFiles = [
    ...["state", "county", "cousub", "place", "unsd", "elsd", "scsd"].map(layer => ({ layer, release: 2026 })),
    ...[2025, 2026].flatMap(release => ["cd", "sldu", "sldl"].map(layer => ({ layer, release }))),
  ];
  for (const { layer, release } of sourceFiles) {
    options.signal?.throwIfAborted();
    const folder = `https://www2.census.gov/geo/tiger/TIGER${release}/${layer.toUpperCase()}/`;
    const name = `tl_${release}_${["state", "county"].includes(layer) ? "us" : fips}_${layer === "cd" ? `cd${release === 2025 ? 119 : 120}` : layer}.zip`;
    const url = folder + name;
    const listing = await censusDirectoryFiles(folder, options);
    if (!listing.includes(url)) continue;
    let features: Feature[] = [];
    const archive = await censusTigerArchive(url, options, async path => {
      features = [];
      for await (const feature of tigerFeatures(path, undefined, options.signal)) if (feature.properties.STATEFP === fips) features.push(feature);
      if (!features.length && ["state", "county"].includes(layer)) throw new Error(`No ${reg.state} polygons in ${url}`);
    });
    try {
      const plan = ["cd", "sldu", "sldl"].includes(layer) ? tigerDistrictPlan(features, layer as "cd" | "sldu" | "sldl", url) : null;
      if (["cd", "sldu", "sldl"].includes(layer) && !plan) continue;
      const version = plan?.version ?? `${layer}:${release}`, year = boundaryYear(version);
      for (const feature of features) {
        const p = feature.properties, geoid = p.GEOID ?? p.GEOID20, name = p.NAMELSAD ?? p.NAME ?? geoid;
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
          ...(["unsd", "elsd", "scsd"].includes(layer) ? [{ scheme: "nces", value: geoid }] : [])];
        places.set(id, { id, name, state: reg.state, aliases: [...new Map(aliases.map(a => [`${a.scheme}:${a.value}`, a])).values()] });
        byGeoid.set(`${layer}:${geoid}`, id);
        const geometry = { type: "MultiPolygon" as const, coordinates: tigerGeometry(feature) };
        const previousBoundary = boundaries.get(`${id}|${year}`);
        const coordinates = previousBoundary?.geometry ? [...(previousBoundary.geometry.type === "Polygon" ? [previousBoundary.geometry.coordinates] : previousBoundary.geometry.coordinates), ...geometry.coordinates] : geometry.coordinates;
        boundaries.set(`${id}|${year}`, { placeId: id, layer, boundaryYear: year, version,
          geometry: { type: "MultiPolygon", coordinates }, hostCountyId: null, countyAttachment: false,
          sourceUrls: [...new Set([...(previousBoundary?.sourceUrls ?? []), url])], checkedAt: new Date().toISOString() });
      }
    } finally { await archive.dispose(); }
  }
  return { places: [...places.values()], boundaries: [...boundaries.values()] };
}
