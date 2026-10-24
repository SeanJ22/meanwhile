import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FactDb, Query } from "../facts/publish.ts";
import { loadRegistrationReference } from "../registration/reference.ts";
import { readCensusGovernmentFacts } from "../registration/jurisdictions.ts";
import { shardEntry, type ZipDivisionEntry, type ZipDivisionShard } from "../geo/zip-division-index.ts";
import { acquireDataset } from "../census-geography/acquire.ts";
import type { BuiltDataset } from "../census-geography/dataset.ts";
import type { CensusSourceOptions } from "../census-geography/source-release.ts";
import type { GeoFeature } from "../registry/resolve.ts";
import type { PlaceBoundary } from "./types.ts";
import { acquireStateBoundaries } from "./acquire.ts";
import { acquireBoundaryOverlaps } from "./overlap.ts";
import { buildStatePlaceMap } from "./build.ts";
import { loadStatePlaceMap, type StatePlaceMap } from "./load.ts";
import { geographicSpecialDistricts } from "./special-districts.ts";
import { statePostalLinks } from "./postal-links.ts";
import { isTownOrCountyDivision } from "../geo/postal-core.ts";
import { currentGrfPlaceEdges } from "./grf-edges.ts";

/** Read only the legacy shards touching this state. Their source is explicitly
 * Census ZCTAs; the independent Census universe confirms each ZCTA row. */
export async function readLegacyStateMemberships(root: string, state: string): Promise<Map<string, ZipDivisionEntry>> {
  const manifest = JSON.parse(await readFile(join(root, "data/derived/zip-divisions/index.json"), "utf8")) as { statesToShards: Record<string, string[]> };
  const result = new Map<string, ZipDivisionEntry>();
  for (const shard of manifest.statesToShards[state] ?? []) {
    if (!/^\d{2}$/.test(shard)) throw new Error("Invalid ZIP shard");
    const data = JSON.parse(await readFile(join(root, "data/derived/zip-divisions", `${shard}.json`), "utf8")) as ZipDivisionShard;
    for (const zip of Object.keys(data.zips)) {
      const entry = shardEntry(data, zip)!;
      if ([...entry.ids, ...entry.fringe ?? []].some(id => id.includes(`:${state.toLowerCase()}/`) || id.endsWith(`:${state.toLowerCase()}`))) result.set(zip, entry);
    }
  }
  return result;
}

/** Only one state's held Census payload crosses the database connection. */
async function heldStateDataset(query: Query, state: string): Promise<BuiltDataset | undefined> {
  const [row] = await query(`SELECT jsonb_build_object('formatVersion',1,'builtAt',p.payload->>'builtAt','coverage',$1::text,
    'zctaUniverse','[]'::jsonb,'scopes',coalesce(jsonb_agg(s.scope),'[]'::jsonb)) AS dataset
    FROM civic_data_promotions p CROSS JOIN LATERAL (
      SELECT (held.value - 'groupings') || jsonb_build_object('groupings',
        (SELECT coalesce(jsonb_agg(g),'[]'::jsonb) FROM jsonb_array_elements(held.value->'groupings') g WHERE g->>'stateAbbr'=$1)) AS scope
      FROM jsonb_array_elements(p.payload->'scopes') AS held(value) WHERE held.value->>'type'<>'cbsa'
    ) s WHERE p.record_class='CENSUS_GEOGRAPHY' AND p.scope='US:zcta-geography-overlaps' GROUP BY p.payload->>'builtAt'`, [state]);
  return row?.dataset as BuiltDataset | undefined;
}

export async function prepareStatePlaceMap(query: Query, root: string, state: string,
  options: CensusSourceOptions = {}): Promise<{ map: StatePlaceMap; dataset: BuiltDataset }> {
  if (!/^[A-Z]{2}$/.test(state)) throw new Error("A state abbreviation is required");
  options = { ...options, releases: options.releases ?? new Map() };
  const { reference: registration } = loadRegistrationReference(root, state);
  const fips = registration.divisions.find(d => d[1] === "state")?.[2];
  if (!fips) throw new Error(`No state FIPS for ${state}`);
  const legacyZips = await readLegacyStateMemberships(root, state);
  const postalLinks = await statePostalLinks(root, state);
  for (const link of postalLinks) {
    const base = legacyZips.get(link.zcta);
    if (!base) continue;
    if (link.addressRequired) {
      const ids = base.ids.filter(isTownOrCountyDivision);
      legacyZips.set(link.zip, { ids, partial: ids.filter(id => id.split("/").length > 3), samples: 0 });
    } else if (!legacyZips.has(link.zip)) legacyZips.set(link.zip, base);
  }
  const previousDataset = await heldStateDataset(query, state);
  const acquired = await acquireDataset({ ...options, previousDataset, states: new Set([fips]), discoverPlans: false,
    only: ["county", "place", "cousub", "cd119", "sldu", "sldl", "cd120", "sldu2026", "sldl2026"] });
  // A state can have no lower chamber or incorporated places. The shared
  // acquisition retains that evidence; this publication contains present maps.
  const dataset = { ...acquired, scopes: acquired.scopes.filter(scope => scope.instanceCount > 0) };
  const stateLandShares = new Map<string, number>();
  for (const scope of dataset.scopes) if (scope.type === "county" && scope.version === "county:2020") {
    for (const group of scope.groupings) for (const edge of group.overlaps) if (edge.fraction !== null) stateLandShares.set(edge.zcta5, (stateLandShares.get(edge.zcta5) ?? 0) + edge.fraction);
  }
  const crossStateZctas = new Set([...stateLandShares].filter(([, share]) => share > 0 && share < 1 - 1e-8).map(([code]) => code));
  const shapes = await acquireStateBoundaries(registration, options, [...legacyZips.values()].flatMap(entry => [...entry.ids, ...entry.fringe ?? []]));
  const boundaries: PlaceBoundary[] = [...shapes.boundaries];
  const territory = join(root, "data/states", state.toLowerCase(), "geo", `territory-${fips}.geojson`);
  const special = new Map(registration.divisions.filter(d => d[1] === "district").map(d => [d[0], d]));
  let features: GeoFeature[] = [];
  try { features = (JSON.parse(await readFile(territory, "utf8")) as { features: GeoFeature[] }).features; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  for (const feature of features) {
    const division = special.get(feature.properties.ocdId);
    if (!division) continue;
    const source = registration.boundarySources?.[division[2].split("#")[0]];
    if (!source) throw new Error(`District source missing for ${division[0]}`);
    boundaries.push({ placeId: division[0], boundaryYear: 2022, layer: "district", version: "district:2022", geometry: feature.geometry,
      countyAttachment: false, hostCountyId: null, sourceUrls: [source.url], checkedAt: source.readAt });
  }
  const legacyZctas = new Set(dataset.zctaUniverse);
  // The source index and the Census tabulation are distinct from postal aliases.
  const zctas = new Set([...legacyZctas, ...dataset.scopes.flatMap(s => s.groupings.flatMap(g => g.overlaps.map(o => o.zcta5)))]);
  const acquiredEdges = await currentGrfPlaceEdges(fips, shapes.places, options);
  const specialShapes = boundaries.filter(boundary => boundary.layer === "district" && boundary.geometry);
  if (specialShapes.length) acquiredEdges.push(...await acquireBoundaryOverlaps(specialShapes, zctas, options));
  const sources = JSON.parse(await readFile(join(root, "data/reference/district-boundary-sources.json"), "utf8")) as { sources: { id: string; countyFips: string | null }[] };
  const geographicDistricts = await geographicSpecialDistricts(root, fips);
  const governmentIds = new Map((await query("SELECT value,entity_id FROM entity_external_id WHERE scheme='census-pid6' AND value=ANY($1::text[])",
    [geographicDistricts.map(d => d.pid)])).map(row => [String(row.value), String(row.entity_id)]));
  const map = buildStatePlaceMap({ registration, scopes: dataset.scopes, legacyZips, legacyZctas, boundaries, acquiredEdges,
    additionalPlaces: shapes.places, censusFacts: readCensusGovernmentFacts(root, [state]).byPid,
    geographicDistricts: geographicDistricts.map(d => ({ ...d, governmentId: governmentIds.get(d.pid) })),
    postalLinks,
    crossStateZctas,
    sourceCounties: new Map(sources.sources.map(source => [source.id, source.countyFips])), checkedAt: dataset.builtAt });
  return { map, dataset };
}

/** The standing Census job uses this same import on every scheduled refresh. */
export async function refreshStatePlaceMap(db: FactDb & { readonly query: Query }, root: string, state: string,
  options: CensusSourceOptions = {}): Promise<{ map: StatePlaceMap; dataset: BuiltDataset }> {
  const prepared = await prepareStatePlaceMap(db.query, root, state, options);
  await loadStatePlaceMap(db, prepared.map);
  return prepared;
}
