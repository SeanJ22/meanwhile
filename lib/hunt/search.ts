/**
 * Web search for hunters and discovery. A hunter's query goes to one provider: Brave LLM Context first, which returns
 * page text with its results, and Exa search with highlights only when Brave returns nothing. The text is handed to
 * the model to read and is never stored.
 */

export type FetchLike = (url: string, init: {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
}>;

/** One search result: a page, its title and the provider's text about it. */
export interface SearchHit {
  readonly url: string;
  readonly title: string;
  readonly provider: "brave" | "exa";
  readonly text?: string;
}

/** Admits one paid provider request, or says why not; `done` returns the slot. */
export interface SearchBudget {
  take(host: string): Promise<string | null>;
  done(host: string): Promise<void>;
}

const BRAVE_WEB = "https://api.search.brave.com/res/v1/web/search";
const BRAVE_LLM_CONTEXT = "https://api.search.brave.com/res/v1/llm/context";
const EXA_SEARCH = "https://api.exa.ai/search";
export const SEARCH_HOSTS = { brave: new URL(BRAVE_WEB).host, exa: new URL(EXA_SEARCH).host } as const;
/** Covers the bounded HTTP call and delayed budget release after a crashed process. */
export const SEARCH_REQUEST_LIFETIME_MS = 120_000;
/** List prices per request: Brave Search plan, Exa search with contents (Exa reports its own charge when it can). */
export const SEARCH_PRICE_USD = { brave: 0.005, exa: 0.007 } as const;

const DEFAULT_TIMEOUT_MS = 12_000;
const HUNT_RESULTS = 6;
const HIT_TEXT_CHARS = 1_500;
const BRAVE_CONTEXT_TOKENS = 2_500;
const EXA_HIGHLIGHT_CHARS = 1_200;

async function withTimeout<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await run(controller.signal); } finally { clearTimeout(timer); }
}

const redact = (body: string, key: string): string => body.split(key).join("[REDACTED]").slice(0, 160);
const defaultFetch: FetchLike = (url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>;
const clip = (text: string, chars: number): string => text.length > chars ? `${text.slice(0, chars - 1)}…` : text;

/** Brave web search: result pointers with their short descriptions. Used by meetings discovery. */
export async function braveSearch(query: string, key: string, fetchImpl: FetchLike, timeoutMs: number, count: number):
  Promise<{ readonly hits: SearchHit[]; readonly bytes: number }> {
  const u = new URL(BRAVE_WEB);
  u.searchParams.set("q", query);
  u.searchParams.set("count", String(count));
  u.searchParams.set("extra_snippets", "true");
  const res = await withTimeout(timeoutMs, signal => fetchImpl(u.toString(), { method: "GET",
    headers: { Accept: "application/json", "X-Subscription-Token": key }, signal }));
  const body = await res.text();
  if (!res.ok) throw new Error(`brave HTTP ${res.status}: ${redact(body, key)}`);
  const json = JSON.parse(body) as { web?: { results?: { title?: string; url?: string; description?: string; extra_snippets?: string[] }[] } };
  const hits = (json.web?.results ?? []).filter(r => typeof r.url === "string" && r.url.length > 0)
    .map(r => ({ url: r.url!, title: (r.title ?? "").slice(0, 200), provider: "brave" as const,
      text: [r.description, ...(r.extra_snippets ?? [])].filter(Boolean).join("\n").slice(0, 6000) }));
  return { hits, bytes: body.length };
}

/** Exa search with source text. Used by meetings discovery. */
export async function exaSearch(query: string, key: string, fetchImpl: FetchLike, timeoutMs: number, numResults: number,
  includeDomains?: readonly string[]): Promise<{ readonly hits: SearchHit[]; readonly bytes: number }> {
  const payload: Record<string, unknown> = { query, type: "fast", numResults, contents: { text: { maxCharacters: 6000 } } };
  if (includeDomains && includeDomains.length > 0) payload.includeDomains = [...includeDomains];
  const res = await withTimeout(timeoutMs, signal => fetchImpl(EXA_SEARCH, { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(payload), signal }));
  const body = await res.text();
  if (!res.ok) throw new Error(`exa HTTP ${res.status}: ${redact(body, key)}`);
  const json = JSON.parse(body) as { results?: { title?: string; url?: string; text?: string }[] };
  const hits = (json.results ?? []).filter(r => typeof r.url === "string" && r.url.length > 0)
    .map(r => ({ url: r.url!, title: (r.title ?? "").slice(0, 200), provider: "exa" as const, text: (r.text ?? "").slice(0, 6000) }));
  return { hits, bytes: body.length };
}

/** Brave LLM Context: ranked pages with the passages that answer the query. */
export async function braveLlmContext(query: string, key: string, fetchImpl: FetchLike, timeoutMs: number):
  Promise<{ readonly hits: SearchHit[]; readonly bytes: number }> {
  const u = new URL(BRAVE_LLM_CONTEXT);
  u.searchParams.set("q", query);
  u.searchParams.set("count", String(HUNT_RESULTS));
  u.searchParams.set("maximum_number_of_tokens", String(BRAVE_CONTEXT_TOKENS));
  u.searchParams.set("maximum_number_of_snippets_per_url", "3");
  const res = await withTimeout(timeoutMs, signal => fetchImpl(u.toString(), { method: "GET",
    headers: { Accept: "application/json", "X-Subscription-Token": key }, signal }));
  const body = await res.text();
  if (!res.ok) throw new Error(`brave HTTP ${res.status}: ${redact(body, key)}`);
  const json = JSON.parse(body) as { grounding?: { generic?: { url?: string; title?: string; snippets?: string[] }[] } };
  const hits = (json.grounding?.generic ?? []).filter(r => typeof r.url === "string" && r.url.length > 0)
    .map(r => ({ url: r.url!, title: (r.title ?? "").slice(0, 200), provider: "brave" as const,
      text: clip((r.snippets ?? []).join("\n"), HIT_TEXT_CHARS) }));
  return { hits, bytes: body.length };
}

/** Exa search returning query-matched highlights. `fresh` reads live pages; `deep` uses Exa's deep search. */
export async function exaHighlights(query: string, key: string, fetchImpl: FetchLike, timeoutMs: number,
  options: { readonly fresh: boolean; readonly deep: boolean; readonly includeDomains?: readonly string[] }):
  Promise<{ readonly hits: SearchHit[]; readonly bytes: number; readonly costUsd: number | null }> {
  const payload: Record<string, unknown> = { query, type: options.deep ? "deep" : "auto", numResults: HUNT_RESULTS,
    contents: { highlights: { maxCharacters: EXA_HIGHLIGHT_CHARS, query }, ...(options.fresh ? { maxAgeHours: 0 } : {}) } };
  if (options.includeDomains?.length) payload.includeDomains = [...options.includeDomains];
  const res = await withTimeout(options.deep ? timeoutMs * 4 : timeoutMs, signal => fetchImpl(EXA_SEARCH, { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(payload), signal }));
  const body = await res.text();
  if (!res.ok) throw new Error(`exa HTTP ${res.status}: ${redact(body, key)}`);
  const json = JSON.parse(body) as { results?: { title?: string; url?: string; highlights?: string[] }[]; costDollars?: { total?: number } };
  const hits = (json.results ?? []).filter(r => typeof r.url === "string" && r.url.length > 0)
    .map(r => ({ url: r.url!, title: (r.title ?? "").slice(0, 200), provider: "exa" as const,
      text: clip((r.highlights ?? []).join("\n"), HIT_TEXT_CHARS) }));
  const total = json.costDollars?.total;
  return { hits, bytes: body.length, costUsd: typeof total === "number" && Number.isFinite(total) ? total : null };
}

/** One priced provider request, for the cost ledger. */
export interface SearchCharge {
  readonly provider: "brave" | "exa";
  readonly host: string;
  readonly usd: number;
  readonly bytes: number;
  readonly deep: boolean;
}

export interface HuntSearchResult {
  /** The provider whose answer this is; null when none answered. */
  readonly provider: "brave" | "exa" | null;
  readonly hits: readonly SearchHit[];
  readonly charges: readonly SearchCharge[];
  readonly errors: readonly string[];
}

export type HuntSearch = (input: {
  readonly query: string;
  /** Live pages only, for facts that change (meeting dates, agendas, filings). */
  readonly fresh?: boolean;
  /** Exa deep search, when ordinary search has not found it. */
  readonly deep?: boolean;
  readonly includeDomains?: readonly string[];
}) => Promise<HuntSearchResult>;

export function makeHuntSearch(options: {
  readonly braveKey?: string | null;
  readonly exaKey?: string | null;
  readonly budget: SearchBudget;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  /** Each request is priced as it is answered, before the hits reach the model. */
  readonly onCharge?: (charge: SearchCharge) => Promise<void>;
}): HuntSearch | null {
  const braveKey = options.braveKey?.trim() || null;
  const exaKey = options.exaKey?.trim() || null;
  if (!braveKey && !exaKey) return null;
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, SEARCH_REQUEST_LIFETIME_MS / 8);
  const admitted = async <T>(errors: string[], host: string, name: string, run: () => Promise<T>): Promise<T | null> => {
    let refused: string | null;
    try { refused = await options.budget.take(host); }
    catch (error) { refused = `the paid-search budget could not be read (${error instanceof Error ? error.message : String(error)})`; }
    if (refused !== null) { errors.push(`${name}: not sent, ${refused}`.slice(0, 200)); return null; }
    try { return await run(); }
    catch (error) { errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200)); return null; }
    finally {
      try { await options.budget.done(host); }
      catch { errors.push(`${name}: budget slot release failed`); }
    }
  };
  return async input => {
    const errors: string[] = [];
    const query = input.query.trim();
    if (!query) return { provider: null, hits: [], charges: [], errors: ["empty query"] };
    const charges: SearchCharge[] = [];
    const charge = async (row: SearchCharge): Promise<void> => {
      charges.push(row);
      await options.onCharge?.(row).catch(error => { errors.push(`cost not recorded: ${error instanceof Error ? error.message : String(error)}`); });
    };
    const domains = input.includeDomains?.length ? input.includeDomains : null;
    if (braveKey && !input.deep) {
      const site = domains ? ` ${domains.map(d => `site:${d.replace(/^\*\./, "")}`).join(" OR ")}` : "";
      const got = await admitted(errors, SEARCH_HOSTS.brave, "brave", () => braveLlmContext(`${query}${site}`, braveKey, fetchImpl, timeoutMs));
      if (got !== null) await charge({ provider: "brave", host: SEARCH_HOSTS.brave, usd: SEARCH_PRICE_USD.brave, bytes: got.bytes, deep: false });
      if (got !== null && got.hits.length > 0) return { provider: "brave", hits: got.hits, charges, errors: [...errors] };
    }
    if (exaKey) {
      const got = await admitted(errors, SEARCH_HOSTS.exa, "exa", () => exaHighlights(query, exaKey, fetchImpl, timeoutMs,
        { fresh: input.fresh === true, deep: input.deep === true, ...(domains ? { includeDomains: domains } : {}) }));
      if (got !== null) {
        await charge({ provider: "exa", host: SEARCH_HOSTS.exa, usd: got.costUsd ?? SEARCH_PRICE_USD.exa, bytes: got.bytes, deep: input.deep === true });
        return { provider: "exa", hits: got.hits, charges, errors: [...errors] };
      }
    }
    return { provider: null, hits: [], charges, errors: [...errors] };
  };
}
