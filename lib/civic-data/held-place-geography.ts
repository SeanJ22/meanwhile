import type { Division } from "../registry/types.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import type { BuiltGrouping, BuiltScope } from "../census-geography/dataset.ts";
import { censusWorkDivision } from "../census-geography/division-id.ts";
import { CENSUS_GEO_RECORD_CLASS, censusGeographyScope } from "../census-geography/publication.ts";
import type { HeldPlaceCapture } from "./held-place-capture.ts";
import { readerQuery } from "./promoted-reader-query.ts";
import { readCensusGeographyIndex, type ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { readCensusDistrictState } from "../census-geography/district-edge.ts";
import { resolveReaderArtifactStore, type ReaderArtifactReadStore } from "../meetings/edge-store.ts";

export interface HeldGeographyRow {
  readonly meta: Omit<BuiltScope, "groupings">;
  readonly grouping: Omit<BuiltGrouping, "overlaps">;
}
const types: Record<string, string> = { cd: "congressional_district", sldu: "state_leg_upper", sldl: "state_leg_lower",
  county: "county", place: "place", county_subdivision: "county_subdivision" };
const cache = new Map<string, { version: string; capture: HeldPlaceCapture }>();
const injectedCaches = new WeakMap<ReadOnlyQuery, typeof cache>();

export function geographyKeys(ids: readonly string[], divisions: readonly Division[]): Map<string, string[]> {
  const wanted = new Set(ids), keys = new Map<string, string[]>();
  const add = (key: string, id: string) => keys.set(key, [...new Set([...(keys.get(key) ?? []), id])]);
  for (const d of divisions) if (wanted.has(d.ocdId) && d.geoid && types[d.divisionType]) add(`${types[d.divisionType]}:${d.geoid}`, d.ocdId);
  for (const id of ids) {
    const state = /\/(state|district|territory):([a-z]{2})(?:\/|$)/i.exec(id);
    const fips = state && Object.entries(FIPS_TO_STATE).find(([, row]) => row.prefix === state[1] && row.postal.toLowerCase() === state[2])?.[0];
    const district = /\/(cd|sldu|sldl):(\d+)$/.exec(id);
    if (fips && district) add(`${types[district[1]]}:${fips}${district[2].padStart(district[1] === "cd" ? 2 : 3, "0")}`, id);
  }
  return keys;
}

/** A URL alone never fills boundary provenance; source vintage and effective use come from the published scope. */
export function projectHeldGeography(ids: readonly string[], divisions: readonly Division[], rows: readonly HeldGeographyRow[]): HeldPlaceCapture {
  const wanted = new Set(ids), keys = geographyKeys(ids, divisions);
  const subjects = new Map<string, HeldPlaceCapture["subjects"][number]>();
  const held = new Map<string, HeldPlaceCapture["held"][number]>();
  for (const { meta, grouping } of rows) {
    const version = meta.versionMeta;
    const sourceUrl = version?.provenance?.sourceUrls?.[0];
    const checkedAt = version?.provenance?.computedAt;
    const checked = Date.parse(checkedAt ?? "");
    if (!sourceUrl || !version.key?.trim() || !version.effectiveFor?.trim() || !Number.isFinite(checked)) continue;
    const divisionId = censusWorkDivision({ ...grouping, type: meta.type, version: meta.version });
    const matches = new Set([...(divisionId && wanted.has(divisionId) ? [divisionId] : []),
      ...(keys.get(`${meta.type}:${grouping.geoid}`) ?? [])]);
    for (const id of matches) {
      subjects.set(id, { id, kind: "division", divisionIds: [id], label: grouping.label });
      // Reference geography uses the same century window as its existing Reader.
      const field = { subjectId: id, checklistId: "GEO-03", state: "published" as const, sourceUrl, checkedAt,
        freshUntil: new Date(checked + 100 * 365 * 24 * 3_600_000).toISOString(), value: {
          divisionId: id, geoid: grouping.geoid, sourceDataset: version.provenance.sourceDataset,
          version: version.key, plan: version.plan, effectiveFor: version.effectiveFor,
        } };
      const key = `${id}:${version.key}`;
      const prior = held.get(key);
      if (!prior || Date.parse(prior.checkedAt) < checked) held.set(key, field);
    }
  }
  return { subjects: [...subjects.values()], held: [...held.values()] };
}

export async function readHeldPlaceGeography(ids: readonly string[], divisions: readonly Division[], injected?: ReadOnlyQuery,
  artifactStore: ReaderArtifactReadStore | null = resolveReaderArtifactStore()): Promise<HeldPlaceCapture> {
  if (!ids.length) return { subjects: [], held: [] };
  const states = [...new Set(ids.flatMap(id =>
    /\/(?:state|district|territory):([a-z]{2})(?:\/|$)/i.exec(id)?.[1].toUpperCase() ?? []))].sort();
  if (!states.length) return { subjects: [], held: [] };
  const query = injected ?? readerQuery();
  if (!query) throw new Error("HELD_GEOGRAPHY_READ_FAILED:STORE_UNCONFIGURED");
  const keys = geographyKeys(ids, divisions);
  const selectedCache = injected ? injectedCaches.get(injected) ?? new Map<string, { version: string; capture: HeldPlaceCapture }>() : cache;
  if (injected) injectedCaches.set(injected, selectedCache);
  const cacheKey = JSON.stringify([injected ? "injected" : process.env.DATABASE_URL, [...ids].sort(), [...keys].sort()]);
  const [pointers] = await query([{ text: "SELECT scope,current_version_id FROM civic_data_promotions WHERE record_class=$1 AND scope=ANY($2::text[])",
    params: [CENSUS_GEO_RECORD_CLASS, states.map(censusGeographyScope)] }]);
  const versions = new Map(pointers.flatMap(row => typeof row.scope === "string" && typeof row.current_version_id === "string"
    ? [[row.scope, row.current_version_id] as const] : []));
  if (!versions.size) return { subjects: [], held: [] };
  const version = states.map(state => `${state}:${versions.get(censusGeographyScope(state)) ?? "NOT_PUBLISHED"}`).join("|");
  const cached = selectedCache.get(cacheKey);
  if (cached?.version === version) return cached.capture;
  if (!artifactStore) throw new Error("HELD_GEOGRAPHY_READ_FAILED:ARTIFACT_STORE_UNCONFIGURED");
  const rows: HeldGeographyRow[] = [];
  for (const state of states) {
    const expected = versions.get(censusGeographyScope(state));
    if (!expected) continue;
    const index = await readCensusGeographyIndex(query, state);
    if (index.kind !== "HELD") throw new Error(`HELD_GEOGRAPHY_READ_FAILED:${index.kind}`);
    if (index.versionId !== expected) throw new Error("CIVIC_POINTER_CHANGED_DURING_READ");
    const artifact = await readCensusDistrictState(index.value, state, artifactStore);
    if (!artifact) throw new Error("HELD_GEOGRAPHY_READ_FAILED:STATE_ARTIFACT_UNAVAILABLE");
    for (const row of artifact.containers) {
      const meta = artifact.scopeDetails.find(scope => scope.type === row.ref.type && scope.version === row.ref.version);
      if (!meta) continue;
      const division = censusWorkDivision(row.ref);
      if (!(division && ids.includes(division)) && !keys.has(`${meta.type}:${row.ref.geoid}`)) continue;
      const { type: _type, version: _version, ...grouping } = row.ref;
      rows.push({ meta, grouping });
    }
  }
  const capture = projectHeldGeography(ids, divisions, rows);
  if (selectedCache.size >= 64) selectedCache.delete(selectedCache.keys().next().value!);
  selectedCache.set(cacheKey, { version, capture });
  return capture;
}
