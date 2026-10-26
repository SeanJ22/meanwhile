import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RoutineDataStore } from "../civic-data/store.ts";
import { confirmCensusProbe, censusSourceDependencies, censusSourceProbe, recheckCensusProbe, validCensusSourceProbe, verifyCensusScopeSources } from "../census-geography/source-probe.ts";
import { CENSUS_GEO_PARSER_VERSION } from "../census-geography/publication.ts";
import type { FactDb, Query } from "../facts/publish.ts";
import { loadRegistrationReference } from "../registration/reference.ts";
import { readCensusGovernmentFacts } from "../registration/jurisdictions.ts";
import { shardEntry, type ZipDivisionEntry, type ZipDivisionShard } from "../geo/zip-division-index.ts";
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

/** ZIP identity is independent of the states touched by its older sampled
 * map. Read only prefixes requested by this state's Census source rows. */
export async function knownPostalZips(root: string, requested: ReadonlySet<string>): Promise<Set<string>> {
  const prefixes = new Map<string, string[]>(), result = new Set<string>();
  for (const code of requested) {
    if (!/^\d{5}$/.test(code)) throw new Error("Invalid source ZCTA code");
    const prefix = code.slice(0, 2), codes = prefixes.get(prefix) ?? []; codes.push(code); prefixes.set(prefix, codes);
  }
  for (const [prefix, codes] of prefixes) {
    let shard: ZipDivisionShard;
    try { shard = JSON.parse(await readFile(join(root, "data/derived/zip-divisions", `${prefix}.json`), "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    for (const code of codes) if (Object.hasOwn(shard.zips, code)) result.add(code);
  }
  return result;
}

export async function prepareStatePlaceMap(query: Query, root: string, state: string,
  options: CensusSourceOptions = {}): Promise<{ map: StatePlaceMap; dataset: BuiltDataset; postalPrefixes: readonly string[]; nativeBindingsHash: string }> {
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
  const acquired = await acquireDataset({ ...options, states: new Set([fips]), discoverPlans: false,
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
  const bindings = await query(`WITH rows AS MATERIALIZED (
      SELECT value,entity_id FROM entity_external_id WHERE scheme='census-pid6' AND value=ANY($1::text[])
    ) SELECT value,entity_id,(SELECT md5(coalesce(jsonb_agg(jsonb_build_array(value,entity_id) ORDER BY value,entity_id)::text,'[]')) FROM rows) AS hash FROM rows`,
    [geographicDistricts.map(d => d.pid)]);
  const governmentIds = new Map(bindings.map(row => [String(row.value), String(row.entity_id)]));
  const nativeBindingsHash = bindings[0]?.hash ?? createHash("md5").update("[]").digest("hex");
  if (typeof nativeBindingsHash !== "string") throw new Error("PLACE_MAP_NATIVE_BINDINGS_UNREADABLE");
  const map = buildStatePlaceMap({ registration, scopes: dataset.scopes, legacyZips, legacyZctas, boundaries, acquiredEdges,
    additionalPlaces: shapes.places, censusFacts: readCensusGovernmentFacts(root, [state]).byPid,
    geographicDistricts: geographicDistricts.map(d => ({ ...d, governmentId: governmentIds.get(d.pid) })),
    postalLinks, knownZips,
    crossStateZctas,
    sourceCounties: new Map(sources.sources.map(source => [source.id, source.countyFips])), checkedAt: dataset.builtAt });
  return { map, dataset, postalPrefixes: [...new Set([...zctas].map(code => code.slice(0, 2)))].sort(), nativeBindingsHash };
}

/** All non-provider inputs that can change native identity, ZIP aliases or boundary normalization. */
export async function placeMapDependencyHash(query: Query, root: string, state: string, postalPrefixes: readonly string[], expectedBindings?: string): Promise<string> {
  const { reference: registration } = loadRegistrationReference(root, state);
  const fips = registration.divisions.find(d => d[1] === "state")?.[2];
  if (!fips) throw new Error(`No state FIPS for ${state}`);
  if (postalPrefixes.some(prefix => !/^\d{2}$/.test(prefix))) throw new Error("Invalid Census source postal prefix");
  const districts = await geographicSpecialDistricts(root, fips);
  const [binding] = await query(`SELECT md5(coalesce(jsonb_agg(jsonb_build_array(value,entity_id) ORDER BY value,entity_id)::text,'[]')) AS hash
    FROM entity_external_id WHERE scheme='census-pid6' AND value=ANY($1::text[])`, [districts.map(row => row.pid)]);
  if (typeof binding?.hash !== "string") throw new Error("PLACE_MAP_NATIVE_BINDINGS_UNREADABLE");
  if (expectedBindings !== undefined && expectedBindings !== binding.hash) throw new Error("PLACE_MAP_NATIVE_BINDINGS_MOVED");
  const postalCodes = await Promise.all([...new Set(postalPrefixes)].sort().map(async prefix => {
    try { const shard = JSON.parse(await readFile(join(root, "data/derived/zip-divisions", `${prefix}.json`), "utf8")) as ZipDivisionShard;
      return [prefix, Object.keys(shard.zips).sort()] as const; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return [prefix, null] as const; throw error; }
  }));
  const parser = createHash("sha256");
  for (const file of ["./refresh.ts", "./build.ts", "./acquire.ts", "./grf-edges.ts", "./overlap.ts", "./postal-links.ts", "./special-districts.ts"])
    parser.update(await readFile(new URL(file, import.meta.url)));
  return censusSourceDependencies({ kind: "STATE_PLACE_MAP", state, parser: parser.digest("hex"), registration,
    legacy: [...await readLegacyStateMemberships(root, state)], postalLinks: await statePostalLinks(root, state),
    boundaries: await heldSpecialDistrictBoundaries(root, registration), districts, bindings: binding.hash,
    censusFacts: [...readCensusGovernmentFacts(root, [state]).byPid], postalCodes,
    sourceCatalog: JSON.parse(await readFile(join(root, "data/reference/district-boundary-sources.json"), "utf8")) });
}

/** A current source head never requires the held state dataset just to learn that nothing changed. */
export async function refreshStatePlaceMap(db: FactDb & { readonly query: Query }, root: string, state: string,
  store: RoutineDataStore, options: CensusSourceOptions = {}) {
  if (!/^[A-Z]{2}$/.test(state)) throw new Error("A state abbreviation is required");
  options = { ...options, releases: new Map(), sourceCaptures: new Map() };
  const scope = `US-${state}:place-map`, head = await store.readSourceHead("CENSUS_GEOGRAPHY", scope);
  const saved = head?.rawHashBasis === "SOURCE_CONTENT_V1" && head.parserVersion === CENSUS_GEO_PARSER_VERSION
    ? await store.readCandidatePath(head.versionId, ["normalizedPayload", "sourceProbe"]) : null;
  const prefixes = (saved as { postalPrefixes?: unknown } | null)?.postalPrefixes;
  if (validCensusSourceProbe(saved) && Array.isArray(prefixes) && prefixes.every(prefix => typeof prefix === "string" && /^\d{2}$/.test(prefix))) {
    await recheckCensusProbe(saved, options);
    const dependencies = await placeMapDependencyHash(db.query, root, state, prefixes);
    const probe = censusSourceProbe(options, dependencies, saved.complete);
    const confirmed = await confirmCensusProbe(store, scope, probe, new Date().toISOString());
    if (confirmed) return { confirmed, map: null, dataset: null, sourceProbe: null, baseVersionId: head!.versionId };
  }
  const prepared = await prepareStatePlaceMap(db.query, root, state, options);
  await verifyCensusScopeSources(prepared.dataset.scopes, options);
  const dependencies = await placeMapDependencyHash(db.query, root, state, prepared.postalPrefixes, prepared.nativeBindingsHash);
  const sourceProbe = { ...censusSourceProbe(options, dependencies, true), postalPrefixes: prepared.postalPrefixes };
  // Completion of these writes precedes the source-head publication, so a cut-off pass still owes the old head.
  await loadStatePlaceMap(db, prepared.map);
  return { ...prepared, dataset: { ...prepared.dataset, builtAt: new Date().toISOString() }, confirmed: null, sourceProbe, baseVersionId: head?.versionId ?? null };
}
