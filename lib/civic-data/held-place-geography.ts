import type { Division } from "../registry/types.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import type { BuiltGrouping, BuiltScope } from "../census-geography/dataset.ts";
import { censusWorkDivision } from "../census-geography/division-id.ts";
import { CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE, censusGeographyScope } from "../census-geography/publication.ts";
import type { HeldPlaceCapture } from "./held-place-capture.ts";
import { readerQuery } from "./promoted-reader-query.ts";
import { CivicPayloadParts } from "./payload-parts.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";

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

/** Follow stored payload parts in SQL; only selected identities and their scope provenance cross the wire. */
export async function readHeldPlaceGeography(ids: readonly string[], divisions: readonly Division[], injected?: ReadOnlyQuery): Promise<HeldPlaceCapture> {
  if (!ids.length) return { subjects: [], held: [] };
  const query = injected ?? readerQuery();
  if (!query) throw new Error("HELD_GEOGRAPHY_READ_FAILED:STORE_UNCONFIGURED");
  const keys = geographyKeys(ids, divisions);
  const states = [...new Set(ids.flatMap(id=>/\/(?:state|district|territory):([a-z]{2})(?:\/|$)/i.exec(id)?.[1]?.toUpperCase() ?? []))];
  if (states.length > 1) throw new Error("HELD_GEOGRAPHY_EXACT_STATE_REQUIRED");
  const scope = states.length ? censusGeographyScope(states[0]) : CENSUS_GEO_SCOPE;
  const source = `SELECT payload,current_version_id FROM civic_data_promotions WHERE record_class=$1
    AND scope IN ($2,'${CENSUS_GEO_SCOPE}') ORDER BY (scope=$2) DESC LIMIT 1`;
  const selectedCache = injected ? injectedCaches.get(injected) ?? new Map<string, { version: string; capture: HeldPlaceCapture }>() : cache;
  if (injected) injectedCaches.set(injected, selectedCache);
  const cacheKey = JSON.stringify([injected ? "injected" : process.env.DATABASE_URL, [...ids].sort(), [...keys].sort()]);
  const [pointer] = await query([{ text: `SELECT current_version_id FROM (${source}) source`,
    params: [CENSUS_GEO_RECORD_CLASS, scope] }]);
  const version = pointer[0]?.current_version_id;
  if (typeof version !== "string") return { subjects: [], held: [] };
  const cached = selectedCache.get(cacheKey);
  if (cached?.version === version) return cached.capture;
  const [rows] = await query([{ params: [CENSUS_GEO_RECORD_CLASS, scope, [...ids], [...keys.keys()]], text: `
    WITH RECURSIVE source AS MATERIALIZED (${source}), walk(step,node,meta) AS (
      SELECT 0,payload,'{}'::jsonb FROM source
      UNION ALL
      SELECT n.step,n.node,n.meta FROM walk w
      LEFT JOIN civic_data_payload_parts p ON p.hash=w.node->>'$civicPayloadPart'
      CROSS JOIN LATERAL (SELECT CASE WHEN p.hash IS NULL THEN w.node
        WHEN p.payload->>'kind'='object' THEN p.payload->'value'
        WHEN p.payload->>'kind'='array' THEN p.payload->'groups' ELSE p.payload END node) r
      CROSS JOIN LATERAL (
        SELECT w.step+1 step,r.node->(CASE w.step WHEN 0 THEN 'scopes' ELSE 'groupings' END) node,
          CASE WHEN w.step=1 THEN r.node - 'groupings' ELSE w.meta END meta
          WHERE w.step<2 AND jsonb_typeof(r.node)='object' AND NOT r.node ? '$civicPayloadPart'
        UNION ALL
        SELECT w.step,e.node,w.meta FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.node)='array' THEN r.node ELSE '[]'::jsonb END) e(node)
        UNION ALL
        SELECT w.step,r.node,w.meta WHERE w.step=2 AND p.hash IS NOT NULL AND jsonb_typeof(r.node)='object'
      ) n WHERE n.node IS NOT NULL
    ) SELECT DISTINCT meta,node - 'overlaps' grouping FROM walk WHERE step=2 AND NOT node ? '$civicPayloadPart'
      AND (node->>'ocdId'=ANY($3::text[]) OR ((meta->>'type')||':'||(node->>'geoid'))=ANY($4::text[]))
    UNION ALL
    SELECT '{}'::jsonb,jsonb_build_object('$missing',true) FROM walk WHERE node ? '$civicPayloadPart'
      AND NOT EXISTS (SELECT 1 FROM civic_data_payload_parts p WHERE p.hash=node->>'$civicPayloadPart')
    UNION ALL
    SELECT '{}'::jsonb,jsonb_build_object('$version',current_version_id) FROM source` }]);
  if ((rows.find(row => (row.grouping as { $version?: string }).$version)?.grouping as { $version?: string } | undefined)?.$version !== version) {
    throw new Error("CIVIC_POINTER_CHANGED_DURING_READ");
  }
  if (rows.some(row => (row.grouping as { $missing?: boolean }).$missing)) throw new Error("CIVIC_PAYLOAD_PART_MISSING");
  const parts = new CivicPayloadParts({ existing: async () => [], write: async () => { throw new Error("READ_ONLY"); },
    read: async hashes => {
      const [found] = await query([{ text: "SELECT hash,payload FROM civic_data_payload_parts WHERE hash=ANY($1::text[])", params: [[...hashes]] }]);
      return found as unknown as { hash: string; payload: unknown }[];
    } });
  const capture = projectHeldGeography(ids, divisions, await parts.load(rows.filter(row => !(row.grouping as { $version?: string }).$version)) as HeldGeographyRow[]);
  if (selectedCache.size >= 64) selectedCache.delete(selectedCache.keys().next().value!);
  selectedCache.set(cacheKey, { version, capture });
  return capture;
}
