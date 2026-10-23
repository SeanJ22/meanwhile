import { createHash } from "node:crypto";
import { REGISTRY_STATES, registryJurisdictions } from "../civic-data/state-scopes.ts";
export interface ReaderCachePurgeResult {
  readonly purged: boolean;
  readonly detail?: string;
}

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

/** Canonical source scopes name a state directly or contain an encoded body division. */
export function readerCacheScopeForPublication(scope: string): ReaderCacheScope {
  let decoded = scope;
  try { decoded = decodeURIComponent(scope); } catch { /* Retain the literal scope. */ }
  // These feed and vote publications have no reader response cache.
  if (/(?:^|:)(?:govinfo|congress-api|regulations-gov)(?=:|$)/i.test(decoded)
      || /roll-?calls?(?=:|$)/i.test(decoded)) return {};
  if (decoded === "federal-supported" || /^US:people:/i.test(decoded)
      || /^US:(?:current-congress-directory|state-legislator-member-offices)$/i.test(decoded)) return { nationalPeople: true };
  const states = [...new Set(decoded.split("+").flatMap(part => registryJurisdictions(part)))];
  const fema = /^openfema:([a-z]{2})(?=:|$)/i.exec(decoded)?.[1];
  if (!states.length && fema) states.push(...registryJurisdictions(fema));
  const family = /^source:derived:family:([a-z]{2})(?=:|$)/i.exec(decoded)?.[1];
  if (!states.length && family) states.push(...registryJurisdictions(family));
  // Shared curated facts can affect every state without sharing the raw-feed tag.
  return states.length ? { states } : { states: [...REGISTRY_STATES] };
}

/** Run after the database commit. Purge failure is visible without hiding the newly published fact. */
export async function invalidateReaderCache(scope: ReaderCacheScope, purge: ReaderCachePurger = purgeReaderCacheTags): Promise<ReaderCachePurgeResult> {
  // Explicit global owner actions and outcomes without a known place still clear place answers.
  return invalidateReaderCacheTags(readerCacheTags(scope.national ? { ...scope, nationalPeople: true } : scope), purge);
}

async function invalidateReaderCacheTags(tags: readonly string[], purge: ReaderCachePurger = purgeReaderCacheTags): Promise<ReaderCachePurgeResult> {
  if (!tags.length) return { purged: false, detail: "no reader cache scope" };
  let result: ReaderCachePurgeResult;
  try { result = await purge(tags); }
  catch (error) { result = { purged: false, detail: error instanceof Error ? error.message : String(error) }; }
  if (!result.purged) console.error("Reader cache invalidation failed after publication", { tags, detail: result.detail ?? "purge refused" });
  return result;
}

/** A bulk publication clears each affected tag once, including facts committed before a later field failed. */
export async function withBatchedReaderInvalidation<T>(write: (collect: ReaderCachePurger) => Promise<T>, purge?: ReaderCachePurger): Promise<T> {
  const changed = new Set<string>();
  try {
    return await write(async tags => {
      for (const tag of tags) changed.add(tag);
      return { purged: true };
    });
  } finally {
    if (changed.size) await invalidateReaderCacheTags([...changed].sort(), purge);
  }
}

/** A state's tag covers every cached place answer in that state, including a person's several offices. */
export async function readerCacheScopeForEntity(
  query: (text: string, params?: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>,
  entityId: string,
): Promise<ReaderCacheScope> {
  const states = registryJurisdictions(entityId);
  if (states.length) return { states };
  const [entity] = await query("SELECT state FROM entity WHERE id = $1", [entityId]);
  return readerCacheScopeForPublication(String(entity?.state ?? "US"));
}
