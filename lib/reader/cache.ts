import { countReaderInvalidation } from "../counts/cache.ts";
import { createHash } from "node:crypto";
import { REGISTRY_STATES, registryJurisdictions } from "../civic-data/state-scopes.ts";
import {FIPS_TO_STATE} from "../ocd/fips.ts";
import type { Query } from "../facts/publish.ts";
import { readerFactDb } from "../facts/db.ts";
export interface ReaderCachePurgeResult {
  readonly purged: boolean;
  readonly detail?: string;
}

const batchedPurgers=new WeakSet<ReaderCachePurger>();

export type ReaderCachePurger = (tags: readonly string[]) => Promise<ReaderCachePurgeResult>;

/** The same tag purge is used by publication jobs and deployed reader functions. */
export async function purgeReaderCacheTags(tags: readonly string[]): Promise<ReaderCachePurgeResult> {
  const siteID = process.env.NETLIFY_SITE_ID?.trim() || process.env.NETLIFY_BLOBS_SITE_ID?.trim() || process.env.WTP_BLOBS_SITE_ID?.trim();
  const token = process.env.NETLIFY_API_TOKEN?.trim() || process.env.NETLIFY_AUTH_TOKEN?.trim() || process.env.NETLIFY_TOKEN?.trim()
    || process.env.WTP_BLOBS_TOKEN?.trim() || process.env.NETLIFY_BLOBS_TOKEN?.trim();
  if (!siteID || !token || tags.length === 0) return { purged: false, detail: "no purge credentials or tags" };
  try {
    const response = await fetch("https://api.netlify.com/api/v1/purge", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ site_id: siteID, cache_tags: [...tags] }),
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok ? { purged: true } : { purged: false, detail: `purge HTTP ${response.status}` };
  } catch (error) {
    return { purged: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export interface ReaderCacheScope {
  readonly states?: readonly string[];
  readonly places?: readonly string[];
  readonly national?: boolean;
  readonly nationalPeople?: boolean;
  readonly entities?: readonly string[];
}

export const READER_NATIONAL_CACHE_TAG = "reader-national";
export const READER_NATIONAL_PEOPLE_CACHE_TAG = "reader-national-people";
export const READER_CACHE_SECONDS = 15 * 60;

export function readerCacheTags(scope: ReaderCacheScope): string[] {
  const states = [...new Set((scope.states ?? []).flatMap(state => registryJurisdictions(state)))].sort();
  const places = [...new Set((scope.places ?? []).map(place => place.split("#")[0]!.trim().toLowerCase()).filter(Boolean))].sort();
  return [
    ...(scope.national ? [READER_NATIONAL_CACHE_TAG] : []),
    ...(scope.nationalPeople ? [READER_NATIONAL_PEOPLE_CACHE_TAG] : []),
    ...states.map(state => `reader-state:${state}`),
    ...places.map(place => `reader-place:${createHash("sha256").update(place).digest("hex")}`),
  ];
}

/** Published changes purge their tags; unchanged checks keep the saved answer. */
export function readerCacheHeaders(scope: ReaderCacheScope): Record<string, string> {
  return {
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Netlify-CDN-Cache-Control": `public, durable, max-age=${READER_CACHE_SECONDS}, stale-while-revalidate=${READER_CACHE_SECONDS}`,
    "Netlify-Cache-Tag": [...readerCacheTags({ ...scope, nationalPeople: true }), "reader-settings"].join(","),
  };
}

/** Ready place answers are cleared only after their own replacement is committed. */
export function readerPlaceCacheHeaders(places:readonly string[]):Record<string,string> {
  return {...readerCacheHeaders({places}),
    "Netlify-Cache-Tag":[...readerCacheTags({places}),"reader-settings"].join(",")};
}

/** Geography is read from typed fields, never from an incidental two-letter word in source text. */
function publicationStates(models: readonly unknown[]): string[] {
  const states = new Set<string>();
  const visit = (value: unknown, key = "") => {
    if (Array.isArray(value)) { for (const item of value) visit(item, key); }
    else if (value && typeof value === "object") { for (const [name, item] of Object.entries(value)) visit(item, name); }
    else if (typeof value === "string" && /^(?:officeholderId|personId)$/.test(key)) {
      const state = /^(?:plural:([a-z]{2}):|([a-z]{2})-(?:legislature|general-court):)/i.exec(value);
      for (const found of registryJurisdictions(state?.[1] ?? state?.[2])) states.add(found);
    }
    else if (typeof value === "string" && /^(?:states?|stateFips|state_fips|statefp|jurisdiction|ocdId|bodyId|divisionId|ocdDivisionId|placeId|scope)$/.test(key)) {
      if (value === "ocd-division/country:us") for (const state of REGISTRY_STATES) states.add(state);
      else if (/^(?:state|stateFips|state_fips|statefp)$/.test(key)&&/^\d{2}$/.test(value)&&FIPS_TO_STATE[value]) states.add(FIPS_TO_STATE[value].postal);
      else for (const part of value.split("+")) for (const state of registryJurisdictions(part)) states.add(state);
    }
  };
  for (const model of models) visit(model);
  return [...states].sort();
}

function namedPublicationScope(scope: string, recordClass?: string): ReaderCacheScope | null {
  let decoded = scope;
  try { decoded = decodeURIComponent(scope); } catch { /* Retain the literal scope. */ }
  // These feed and vote publications have no reader response cache.
  if (/(?:^|:)(?:govinfo|congress-api|regulations-gov|federal-register|senate-lda)(?=:|$)/i.test(decoded)
      || /roll-?calls?(?=:|$)/i.test(decoded)
      || /^(?:STATE_ROLL_CALL|STATE_LEGISLATOR_VOTES|FEDERAL_ROLL_CALL|FEDERAL_KEY_VOTE|DOTGOV_REFERENCE|OPERATIONAL_REFERENCE)$/.test(recordClass ?? "")
      || /:(?:legiscan|openstates)-votes(?=:|$)/i.test(decoded)
      || /^(?:federal-supported|campaign-money:hourly|US:reviewed-key-vote-selection:v1|US:reader-registry-runtime-bindings)$/.test(decoded)) return {};
  if (/^US:people:/i.test(decoded)
      || /^US:current-congress-directory$/i.test(decoded)) return { nationalPeople: true };
  const states = [...new Set(decoded.split("+").flatMap(part => {
    const direct = registryJurisdictions(part);
    if (direct.length) return direct;
    const money = /^(?:openfema|usaspending|federal-audit-clearinghouse|sam-gov-entities):([a-z]{2})(?=:|$)/i.exec(part)?.[1];
    const family = /^source:derived:family:(?:US-)?([a-z]{2})(?=:|$)/i.exec(part)?.[1];
    return registryJurisdictions(money ?? family);
  }))];
  if (states.length) return { states };
  return null;
}

export function readerPublicationNeedsGeography(scope: string, recordClass?: string): boolean {
  return namedPublicationScope(scope, recordClass) === null;
}

/** Only publications consumed by a saved reader answer invalidate that answer. */
export function readerCacheScopeForPublication(scope: string, context: {
  readonly recordClass?: string;
  readonly readModels?: readonly unknown[];
} = {}): ReaderCacheScope {
  const named = namedPublicationScope(scope, context.recordClass);
  if (named !== null) return named;
  // A shared curated shelf may contain only a few states. Include its previous payload
  // as well, so removing its last record for a state still invalidates that state's copy.
  const footprint = publicationStates(context.readModels ?? []);
  return footprint.length ? { states: footprint } : {};
}

/** Run after the database commit. Purge failure is visible without hiding the newly published fact. */
export async function invalidateReaderCache(scope: ReaderCacheScope, purge: ReaderCachePurger = purgeReaderCacheTags,
  query?: Query | null): Promise<ReaderCachePurgeResult> {
  if (query !== null && (query || process.env.DATABASE_URL)) await enqueueReaderPlaces(scope, query ?? readerFactDb().query);
  // Explicit global owner actions and outcomes without a known place still clear place answers.
  return invalidateReaderCacheTags(readerCacheTags(scope.national ? { ...scope, nationalPeople: true } : scope), purge);
}

/** Queue inside a writer's transaction; a newer arrival survives an in-flight rebuild. */
export async function enqueueReaderPlaces(scope: ReaderCacheScope, query: Query): Promise<void> {
  const states = [...new Set((scope.states ?? []).flatMap(registryJurisdictions))];
  const places = [...new Set((scope.places ?? []).map(id => id.split("#")[0]!.trim().toLowerCase()).filter(Boolean))];
  const entities = [...new Set(scope.entities ?? [])];
  const broad = places.length === 0 && entities.length === 0;
  if (!states.length && !places.length && !entities.length && !scope.national && !scope.nationalPeople) return;
  await query(`WITH RECURSIVE subjects AS (
    SELECT id,kind,state,parent_id,ARRAY[id] AS path FROM entity WHERE id=ANY($3::text[])
    UNION ALL SELECT e.id,e.kind,e.state,e.parent_id,s.path||e.id FROM entity e JOIN subjects s ON e.id=s.parent_id
      WHERE NOT e.id=ANY(s.path)
  ), service_places AS (
    SELECT ep.place_id AS id FROM entity_place ep JOIN subjects s ON s.id=ep.entity_id
    UNION SELECT id FROM subjects WHERE kind='place'
      AND id !~ '^ocd-division/country:us(/(state|territory|district):[a-z]{2})?$'
  ), affected AS (
    SELECT id FROM entity WHERE kind IN ('place','body') AND ($4::boolean OR state=ANY($1::text[]) OR id=ANY($2::text[]))
    UNION SELECT id FROM subjects WHERE kind IN ('place','body')
    UNION SELECT ep.place_id FROM entity_place ep JOIN subjects s ON s.id=ep.entity_id
    UNION SELECT d.page_id FROM place_page_dependency d WHERE d.entity_id=ANY($3::text[]) OR d.entity_id=ANY($2::text[])
      OR d.entity_id IN (SELECT id FROM service_places)
    UNION SELECT e.id FROM entity e WHERE e.kind='place' AND e.id=ANY($2::text[])
  ) INSERT INTO rebuild_queue(place_id,queued_at)
    SELECT id,clock_timestamp() FROM affected ORDER BY id
    ON CONFLICT(place_id) DO UPDATE SET generation=rebuild_queue.generation+1`,
  [broad ? states : [],places,entities,broad && (scope.national === true || scope.nationalPeople === true)]);
}

async function invalidateReaderCacheTags(tags: readonly string[], purge: ReaderCachePurger = purgeReaderCacheTags): Promise<ReaderCachePurgeResult> {
  if (!tags.length) return { purged: false, detail: "no reader cache scope" };
  let result: ReaderCachePurgeResult;
  try { result = await purge(tags); }
  catch (error) { result = { purged: false, detail: error instanceof Error ? error.message : String(error) }; }
  if(!batchedPurgers.has(purge))await countReaderInvalidation({
    national:tags.includes(READER_NATIONAL_CACHE_TAG),nationalPeople:tags.includes(READER_NATIONAL_PEOPLE_CACHE_TAG),
    states:tags.filter(tag=>tag.startsWith("reader-state:")).map(tag=>tag.slice("reader-state:".length)),
  },result.purged);
  if (!result.purged) console.error("Reader cache invalidation failed after publication", { tags, detail: result.detail ?? "purge refused" });
  return result;
}

/** A bulk publication clears each affected tag once, including facts committed before a later field failed. */
export async function withBatchedReaderInvalidation<T>(write: (collect: ReaderCachePurger) => Promise<T>, purge?: ReaderCachePurger): Promise<T> {
  const changed = new Set<string>();
  const collect:ReaderCachePurger=async tags=>{
    for(const tag of tags)changed.add(tag);
    return {purged:true};
  };
  batchedPurgers.add(collect);
  try {
    return await write(collect);
  } finally {
    batchedPurgers.delete(collect);
    if (changed.size) await invalidateReaderCacheTags([...changed].sort(), purge);
  }
}

/** A state's tag covers every cached place answer in that state, including a person's several offices. */
export async function readerCacheScopeForEntity(
  query: (text: string, params?: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>,
  entityId: string,
): Promise<ReaderCacheScope> {
  const states = registryJurisdictions(entityId);
  if (states.length) return { states, entities: [entityId] };
  const [entity] = await query("SELECT state FROM entity WHERE id = $1", [entityId]);
  return entity?.state === "US" ? { nationalPeople: true, entities: [entityId] }
    : { ...readerCacheScopeForPublication(String(entity?.state ?? "")), entities: [entityId] };
}
