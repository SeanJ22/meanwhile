import { setTimeout as delay } from "node:timers/promises";
import { acquireKnownRelease,knownReleaseSourceCheck, type KnownReleaseOptions } from "../known-release.ts";
import { requestPublisher } from "../../civic-data/source-acquisition-error.ts";
import { SOCRATA_CATALOG, OPEN_DATA_PARSER, OPEN_DATA_CLOCKS } from "./model.ts";
import { object } from "./normalize.ts";

/** National providers have no local-government pacing cap. Retry-After is authoritative. */
export async function openDataFetch(url: string | URL | Request, init?: RequestInit, fetchImpl: typeof fetch = fetch): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await requestPublisher("SRC-SO", () => fetchImpl(url, init));
    if (attempt >= 3 || response.status !== 429 && response.status < 500) return response;
    const header = response.headers.get("retry-after");
    const seconds = header && /^\d+$/.test(header) ? Number(header) * 1000 : header ? Date.parse(header) - Date.now() : NaN;
    const wait = Number.isFinite(seconds) ? Math.max(0,seconds) : 1000 * 2 ** attempt;
    await response.body?.cancel();
    await delay(wait, undefined, { signal:init?.signal ?? undefined });
  }
}
export interface CatalogPage {
  readonly rows: readonly Record<string, unknown>[];
  readonly total: number;
  readonly body: string;
  readonly url: string;
  readonly retrievedAt: string;
  readonly sha256: string;
  readonly sourceCheck: import("../../civic-data/types.ts").SourceCheckEvidence;
}
export function parseCatalogPage(body: string) {
  const root = object(JSON.parse(body));
  if (!Array.isArray(root.results) || !Number.isSafeInteger(root.resultSetSize) || (root.resultSetSize as number) < 0 ||
      root.results.some(row=>!row || typeof row !== "object" || Array.isArray(row)) ||
      Array.isArray(root.warnings) && root.warnings.length) throw Error("Socrata did not return a complete catalog page.");
  return {rows:root.results as Record<string,unknown>[],total:root.resultSetSize as number};
}
/** All public catalog entries, without a tag, state, government-size or dataset-category filter. */
export async function* socrataPages(options: {
  signal: AbortSignal; token?: string; acquire?: typeof acquireKnownRelease;
  releaseOptions?: Pick<KnownReleaseOptions,"store"|"locks"|"fetchImpl"|"now">;
}): AsyncGenerator<CatalogPage> {
  let cursor="";
  const seen = new Set<string>();
  do {
    // The provider caps offset+limit at 10,000. Native deep scrolling has no offset or order parameter.
    const url = new URL(SOCRATA_CATALOG); url.searchParams.set("limit","1000"); url.searchParams.set("scroll_id",cursor);
    const release = await (options.acquire ?? acquireKnownRelease)({sourceId:"socrata-discovery",releaseId:`catalog-scroll-${cursor || "start"}`,url:url.href,
      parserVersion:OPEN_DATA_PARSER,maxBytes:32*1024*1024,checkAfterMs:OPEN_DATA_CLOCKS["socrata-discovery"],signal:options.signal,
      headers:{accept:"application/json",...(options.token ? {"X-App-Token":options.token} : {})},allowedHosts:["api.us.socrata.com"],
      ...options.releaseOptions,fetchImpl:(url,init)=>openDataFetch(url,init,options.releaseOptions?.fetchImpl), validate:bytes=>{parseCatalogPage(new TextDecoder().decode(bytes));}});
    const body = new TextDecoder("utf-8",{fatal:true}).decode(release.bytes), page=parseCatalogPage(body);
    for (const row of page.rows) {
      const key=`${object(row.metadata).domain}:${object(row.resource).id}`;
      if (seen.has(key)) throw Error("Socrata repeated a resource while paging; completeness remains unresolved.");
      seen.add(key);
    }
    yield {...page,body,url:release.finalUrl,retrievedAt:release.retrievedAt,sha256:release.sha256,sourceCheck:knownReleaseSourceCheck(release)};
    if(!page.rows.length)break;
    const next=String(object(page.rows.at(-1)!.resource).id ?? "");
    if(!/^[a-z0-9]{4}-[a-z0-9]{4}$/.test(next)||next===cursor)throw Error("Socrata deep-scroll cursor did not advance.");
    cursor=next;
  } while (true);
}
