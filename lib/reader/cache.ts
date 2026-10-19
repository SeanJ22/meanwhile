import { createHash } from "node:crypto";
import { registryJurisdictions } from "../civic-data/state-scopes.ts";
export interface ReaderCachePurgeResult {
  readonly purged: boolean;
  readonly detail?: string;
}

export type ReaderCachePurger = (tags: readonly string[]) => Promise<ReaderCachePurgeResult>;

/** The same tag purge is used by publication jobs and deployed reader functions. */
export async function purgeReaderCacheTags(tags: readonly string[]): Promise<ReaderCachePurgeResult> {
  const siteID = process.env.NETLIFY_SITE_ID?.trim() || process.env.NETLIFY_BLOBS_SITE_ID?.trim();
  const token = process.env.NETLIFY_API_TOKEN?.trim() || process.env.NETLIFY_BLOBS_TOKEN?.trim();
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
}

export const READER_NATIONAL_CACHE_TAG = "reader-national";
export const READER_CACHE_SECONDS = 60;

export function readerCacheTags(scope: ReaderCacheScope): string[] {
  const states = [...new Set((scope.states ?? []).flatMap(state => registryJurisdictions(state)))].sort();
  const places = [...new Set((scope.places ?? []).map(place => place.split("#")[0]!.trim().toLowerCase()).filter(Boolean))].sort();
  return [
    ...(scope.national ? [READER_NATIONAL_CACHE_TAG] : []),
    ...states.map(state => `reader-state:${state}`),
    ...places.map(place => `reader-place:${createHash("sha256").update(place).digest("hex")}`),
  ];
}

/** Browser revalidation stays on; a failed purge can leave an edge answer old for at most one minute. */
export function readerCacheHeaders(scope: ReaderCacheScope): Record<string, string> {
  return {
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Netlify-CDN-Cache-Control": `public, durable, max-age=${READER_CACHE_SECONDS}, must-revalidate`,
    "Netlify-Cache-Tag": [...readerCacheTags({ ...scope, national: true }), "reader-settings"].join(","),
  };
}

/** Canonical source scopes name a state directly or contain an encoded body division. */
export function readerCacheScopeForPublication(scope: string): ReaderCacheScope {
  let decoded = scope;
  try { decoded = decodeURIComponent(scope); } catch { /* An unrecognized scope invalidates national data. */ }
  const states = registryJurisdictions(decoded);
  const family = /^source:derived:family:([a-z]{2})(?=:|$)/i.exec(decoded)?.[1];
  if (!states.length && family) states.push(...registryJurisdictions(family));
  return states.length ? { states } : { national: true };
}

/** Run after the database commit. Purge failure is visible without hiding the newly published fact. */
export async function invalidateReaderCache(scope: ReaderCacheScope, purge: ReaderCachePurger = purgeReaderCacheTags): Promise<ReaderCachePurgeResult> {
  return invalidateReaderCacheTags(readerCacheTags(scope), purge);
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
