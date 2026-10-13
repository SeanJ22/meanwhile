import { setTimeout as delay } from "node:timers/promises";
import { FEDERAL_SOURCES, type FederalSourceId } from "./targets.ts";
import { object, rows, string } from "./normalize.ts";
import type { FederalCapture } from "./types.ts";
import { PUBLIC_SITE_ORIGIN } from "../../ops/origins.ts";

export function publicFederalUrl(value: string): string {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) if (/^(api_key|api-key|key|token|access_token)$/i.test(key)) url.searchParams.delete(key);
  return url.href;
}
export function sourceUrlAllowed(source: FederalSourceId, value: string): boolean {
  const url = new URL(value);
  const hosts = source === "govinfo" ? ["api.govinfo.gov", "www.govinfo.gov"] : source === "senate-lda" ? ["lda.gov", "lda.senate.gov"] : [new URL(FEDERAL_SOURCES[source].url).hostname];
  return url.protocol === "https:" && !url.username && !url.password && hosts.includes(url.hostname);
}
export interface FederalClientOptions {
  source: FederalSourceId;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<unknown>;
  now?: () => string;
}

/** Provider quotas alone pace national APIs. No local-government request cap applies. */
export function federalClient(options: FederalClientOptions) {
  const config = FEDERAL_SOURCES[options.source], env = options.env ?? process.env;
  const key = config.key ? env[config.key] : undefined;
  const sleep = options.sleep ?? delay;
  const clock = options.now ?? (() => new Date().toISOString());
  let nextAt = 0, pace: number = options.source === "senate-lda" && !key ? 4000 : config.paceMs;
  async function get(urlValue: string, kind: FederalCapture["kind"], context?: FederalCapture["context"]): Promise<FederalCapture> {
    const url = publicFederalUrl(urlValue);
    if (!sourceUrlAllowed(options.source, url)) throw new Error(`Refused a page outside ${config.publisher}: ${url}`);
    if (config.key && !key && options.source !== "senate-lda") throw new Error(`${config.key} is unavailable in this workspace.`);
    const headers = new Headers({ Accept: kind === "bill-text" ? "text/plain, text/html" : "application/json", "User-Agent": `Meanwhile/1.0 (+${PUBLIC_SITE_ORIGIN})` });
    if (key) headers.set(options.source === "senate-lda" ? "Authorization" : "X-Api-Key", options.source === "senate-lda" ? `Token ${key}` : key);
    for (let attempt = 0; ; attempt++) {
      const wait = nextAt - Date.parse(clock());
      if (wait > 0) await sleep(wait);
      const response = await (options.fetchImpl ?? fetch)(url, { headers, signal: AbortSignal.timeout(30_000), redirect: "manual" });
      nextAt = Date.parse(clock()) + pace;
      const limit = Number(response.headers.get("x-ratelimit-limit"));
      if (limit > 0 && Number.isFinite(limit) && options.source !== "senate-lda") pace = 3_600_000 / limit;
      if (response.status === 429 || response.status >= 500) {
        const retry = response.headers.get("retry-after"), seconds = retry === null ? NaN : Number(retry);
        const waitMs = Number.isFinite(seconds) ? seconds * 1000 : retry ? Date.parse(retry) - Date.parse(clock()) : 1000 * 2 ** attempt;
        if (attempt >= 2) throw new Error(`${url} answered HTTP ${response.status}; Retry-After: ${retry ?? "not supplied"}.`);
        await response.body?.cancel();
        nextAt = Date.parse(clock()) + Math.max(pace, waitMs);
        continue;
      }
      if (!response.ok) {
        let diagnostic = await response.text();
        if (key) diagnostic = diagnostic.split(key).join("[redacted]");
        throw new Error(`${url} answered HTTP ${response.status}: ${diagnostic.slice(0, 1000)}`);
      }
      let body = await response.text();
      // Request metadata may echo a key. Saved evidence excludes only those secret values.
      if (key) body = body.split(key).join("[redacted]");
      if (!body.trim()) throw new Error(`${url} returned an empty source document.`);
      return { source: options.source, kind, url, body, retrievedAt: clock(), ...(context ? { context } : {}) };
    }
  }
  return { get };
}

export interface FederalPage { capture: FederalCapture; items: Record<string, unknown>[]; next: string | null; total: number }
export async function* federalPages(client: ReturnType<typeof federalClient>, source: FederalSourceId, start: string, kind: FederalCapture["kind"], context?: FederalCapture["context"]): AsyncGenerator<FederalPage> {
  const seen = new Set<string>();
  let url: string | null = publicFederalUrl(start);
  while (url) {
    if (seen.has(url)) throw new Error(`Provider pagination repeated ${url}.`);
    seen.add(url);
    const capture = await client.get(url, kind, context), root = object(JSON.parse(capture.body));
    const field = source === "govinfo" ? "packages" : source === "regulations-gov" ? "data" : source === "senate-lda" || source === "federal-register" ? "results" : kind === "members" ? "members" : kind === "sponsored" ? "sponsoredLegislation" : kind === "committees" ? "committees" : kind === "text-versions" ? "textVersions" : "bills";
    if (!Array.isArray(root[field])) throw new Error(`${capture.url} is missing the provider's ${field} array.`);
    const items = rows(root[field]);
    let next = string(source === "govinfo" ? root.nextPage : source === "federal-register" ? root.next_page_url : source === "senate-lda" ? root.next : object(root.pagination).next) || null;
    const meta = object(root.meta);
    if (source === "regulations-gov" && meta.hasNextPage === true) {
      const u: URL = new URL(url), page: number = Number(u.searchParams.get("page[number]") ?? 1);
      if (page >= 20) throw new Error("Regulations.gov's 5,000-row query ceiling requires a narrower date partition.");
      u.searchParams.set("page[number]", String(page + 1)); next = u.href;
    }
    const total = Number(source === "regulations-gov" ? meta.totalElements : source === "govinfo" ? root.count : source === "federal-register" ? root.count : source === "senate-lda" ? root.count : object(root.pagination).count ?? (kind === "committees" ? items.length : undefined));
    if (!Number.isSafeInteger(total) || total < 0) throw new Error(`${url} has no valid provider pagination count.`);
    if (!items.length && (next || total > 0)) throw new Error(`${url} returned an empty page within a nonempty provider query.`);
    if (next) next = publicFederalUrl(new URL(next, url).href);
    yield { capture, items, next, total };
    url = next;
  }
}

/** Split document queries at the published 5,000-row limit; never clip page 20. */
export async function* regulationPages(client: ReturnType<typeof federalClient>, today: string, from = "1900-01-01", through = today): AsyncGenerator<FederalPage> {
  const u = new URL("https://api.regulations.gov/v4/documents");
  u.searchParams.set("page[size]", "250"); u.searchParams.set("page[number]", "1");
  u.searchParams.set("filter[documentType]", "Proposed Rule,Rule,Notice");
  u.searchParams.set("filter[commentEndDate][ge]", today); u.searchParams.set("filter[postedDate][ge]", from); u.searchParams.set("filter[postedDate][le]", through);
  u.searchParams.set("sort", "postedDate,documentId");
  const pages = federalPages(client, "regulations-gov", u.href, "rules");
  const first = await pages.next();
  if (first.done) return;
  if (first.value.total > 5000) {
    await pages.return(undefined);
    const lo = Date.parse(from), hi = Date.parse(through);
    if (lo >= hi) throw new Error(`Regulations.gov reports ${first.value.total} documents on ${from}; date partition cannot prove complete pagination.`);
    const middle = Math.floor((lo + hi) / 2 / 86_400_000) * 86_400_000;
    yield* regulationPages(client, today, from, new Date(middle).toISOString().slice(0, 10));
    yield* regulationPages(client, today, new Date(middle + 86_400_000).toISOString().slice(0, 10), through);
    return;
  }
  yield first.value;
  for await (const page of pages) yield page;
}
