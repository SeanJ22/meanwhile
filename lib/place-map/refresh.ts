import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FactDb, Query } from "../facts/publish.ts";
import { loadRegistrationReference } from "../registration/reference.ts";
import { readCensusGovernmentFacts } from "../registration/jurisdictions.ts";
import { legacyZipEntry, type LegacyZipShard } from "./legacy.ts";
import type { PlaceEntry } from "./reader.ts";
import { acquireDataset } from "../census-geography/acquire.ts";
import type { BuiltDataset } from "../census-geography/dataset.ts";
import type { CensusSourceOptions } from "../census-geography/source-release.ts";
import { acquireStateBoundaries } from "./acquire.ts";
import { acquireBoundaryOverlaps } from "./overlap.ts";
import { buildStatePlaceMap } from "./build.ts";
import { loadStatePlaceMap, type StatePlaceMap } from "./load.ts";
import { geographicSpecialDistricts, heldSpecialDistrictBoundaries } from "./special-districts.ts";
import { statePostalLinks } from "./postal-links.ts";
import { isTownOrCountyDivision } from "../geo/postal-core.ts";
import { stateZipLocations } from "./location-import.ts";
import { currentGrfPlaceEdges } from "./grf-edges.ts";

/** Read only the legacy shards touching this state. Their source is explicitly
 * Census ZCTAs; the independent Census universe confirms each ZCTA row. */
export async function readLegacyStateMemberships(root: string, state: string): Promise<Map<string, PlaceEntry>> {
  const manifest = JSON.parse(await readFile(join(root, "data/derived/zip-divisions/index.json"), "utf8")) as { statesToShards: Record<string, string[]> };
  const result = new Map<string, PlaceEntry>();
  for (const shard of manifest.statesToShards[state] ?? []) {
    if (!/^\d{2}$/.test(shard)) throw new Error("Invalid ZIP shard");
    const data = JSON.parse(await readFile(join(root, "data/derived/zip-divisions", `${shard}.json`), "utf8")) as LegacyZipShard;
    for (const zip of Object.keys(data.zips)) {
      const entry = legacyZipEntry(data, zip)!;
      if ([...entry.ids, ...entry.fringe ?? []].some(id => id.includes(`:${state.toLowerCase()}/`) || id.endsWith(`:${state.toLowerCase()}`))) result.set(zip, entry);
    }
  }
  return result;
}

/** ZIP identity is independent of the states touched by its older sampled
 * map. Read only prefixes requested by this state's Census source rows. */
export async function knownPostalZips(root: string, requested: ReadonlySet<string>): Promise<Set<string>> {
  const prefixes = new Map<string, string[]>(), result = new Set<string>();
  for (const code of requested) {
    if (!/^\d{5}$/.test(code)) throw new Error("Invalid source ZCTA code");
    const prefix = code.slice(0, 2), codes = prefixes.get(prefix) ?? []; codes.push(code); prefixes.set(prefix, codes);
  }
  for (const [prefix, codes] of prefixes) {
    let shard: LegacyZipShard;
    try { shard = JSON.parse(await readFile(join(root, "data/derived/zip-divisions", `${prefix}.json`), "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    for (const code of codes) if (Object.hasOwn(shard.zips, code)) result.add(code);
  }
  return result;
}

/** Only one state's held Census payload crosses the database connection. */
export async function heldStateDataset(query: Query, state: string): Promise<BuiltDataset | undefined> {
  const [row] = await query(`WITH held AS (
      SELECT reader_payload_node(payload) AS root FROM civic_data_promotions
      WHERE record_class='CENSUS_GEOGRAPHY' AND scope='US:zcta-geography-overlaps'
    ) SELECT jsonb_build_object('formatVersion',1,'builtAt',h.root->>'builtAt','coverage',$1::text,
    'zctaUniverse','[]'::jsonb,'scopes',coalesce(jsonb_agg(s.scope),'[]'::jsonb)) AS dataset
    FROM held h CROSS JOIN LATERAL (
      SELECT reader_payload_value(reader_payload_node(held_scope.item) - 'groupings') || jsonb_build_object('groupings',
        (SELECT coalesce(jsonb_agg(reader_payload_value(g.item)),'[]'::jsonb)
          FROM reader_payload_members(reader_payload_node(held_scope.item)->'groupings') g
          WHERE reader_payload_node(g.item)->>'stateAbbr'=$1)) AS scope
      FROM reader_payload_members(h.root->'scopes') held_scope WHERE reader_payload_node(held_scope.item)->>'type'<>'cbsa'
    ) s GROUP BY h.root->>'builtAt'`, [state]);
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
  const boundaries = [...shapes.boundaries, ...await heldSpecialDistrictBoundaries(root, registration)];
  const legacyZctas = new Set(dataset.zctaUniverse);
  // The source index and the Census tabulation are distinct from postal aliases.
  const zctas = new Set([...legacyZctas, ...dataset.scopes.flatMap(s => s.groupings.flatMap(g => g.overlaps.map(o => o.zcta5)))]);
  const knownZips = await knownPostalZips(root, zctas);
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
    postalLinks, knownZips,
    crossStateZctas,
    sourceCounties: new Map(sources.sources.map(source => [source.id, source.countyFips])), checkedAt: dataset.builtAt });
  return { map:{...map,zipLocations:await stateZipLocations(root,state,dataset.builtAt)}, dataset };
}

/** The standing Census job uses this same import on every scheduled refresh. */
export async function refreshStatePlaceMap(db: FactDb & { readonly query: Query }, root: string, state: string,
  options: CensusSourceOptions = {}): Promise<{ map: StatePlaceMap; dataset: BuiltDataset }> {
  const prepared = await prepareStatePlaceMap(db.query, root, state, options);
  await loadStatePlaceMap(db, prepared.map);
  return prepared;
}
