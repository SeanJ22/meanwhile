/**
 * **COMPLIANT SEARCH-INDEX POINTERS FOR THE SCOUT LANE.** (2026-09-19.)
 *
 * Scouts hit NO_PROGRESS not because a candidate has no site but because every
 * general web-search route they could reach was robots-disallowed or
 * captcha-walled (DuckDuckGo, Mojeek, Marginalia, TAPinto). A live test against
 * real scout misses showed Brave and Exa surface the candidate's own campaign
 * site at #1 for races the scouts gave up on (Rogers, Hagaman, Rubino), while
 * still finding nothing for the genuinely siteless (Bradstreet, Fitting) — so
 * this recovers the reachable-but-blocked and leaves the true absences to the
 * durable-absence clock.
 *
 * **The compliance boundary is exact.** These are APIs we hold a key for, so the
 * lookup is authorized access, not a crawl, and does not pass the robots gate.
 * But the lookup returns POINTERS ONLY — a URL and its title. No provider is
 * asked for page content (Exa's `contents` object is omitted; Brave's default
 * pointer response carries none to strip), and neither `outputSchema` nor an
 * `/answer` endpoint is used, because a synthesized claim has no verifiable path
 * back to a source. The model must then open each pointer with fetch_public or
 * browse, and THOSE enforce robots and vault with provenance. Nothing here is
 * vaulted and nothing is evidence.
 */

import type { ScoutSearch, SearchHit, SearchProvidersResult } from "./scout-contract.ts";

/** The runtime fetch seam. Tests inject a fake; the runtime passes global fetch. */
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

export interface ScoutSearchOptions {
  readonly braveKey?: string | null;
  readonly exaKey?: string | null;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  /** Results requested from each provider before dedupe. */
  readonly perProvider?: number;
  /** The combined pointer list handed to the model, after dedupe. */
  readonly maxHits?: number;
}

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const EXA_ENDPOINT = "https://api.exa.ai/search";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_PER_PROVIDER = 5;
const DEFAULT_MAX_HITS = 8;

/** Lowercase host + path without a trailing slash or fragment, for dedupe across providers. */
function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`.toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

async function withTimeout<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Brave web search — pointers by default. Returns hits and the response byte length. */
export async function braveSearch(
  query: string,
  key: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  count: number,
): Promise<{ readonly hits: SearchHit[]; readonly bytes: number }> {
  const u = new URL(BRAVE_ENDPOINT);
  u.searchParams.set("q", query);
  u.searchParams.set("count", String(count));
  const res = await withTimeout(timeoutMs, (signal) =>
    fetchImpl(u.toString(), {
      method: "GET",
      headers: { Accept: "application/json", "X-Subscription-Token": key },
      signal,
    }),
  );
  const body = await res.text();
  if (!res.ok) throw new Error(`brave HTTP ${res.status}: ${body.slice(0, 160)}`);
  const json = JSON.parse(body) as { web?: { results?: { title?: string; url?: string }[] } };
  const results = json.web?.results ?? [];
  const hits: SearchHit[] = results
    .filter((r): r is { title?: string; url: string } => typeof r.url === "string" && r.url.length > 0)
    .map((r) => ({ url: r.url, title: (r.title ?? "").slice(0, 200), provider: "brave" as const }));
  return { hits, bytes: body.length };
}

/** Exa neural/keyword search — URL-only (no `contents`, no synthesis). */
export async function exaSearch(
  query: string,
  key: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  numResults: number,
  includeDomains?: readonly string[],
): Promise<{ readonly hits: SearchHit[]; readonly bytes: number }> {
  // URL-only: NO `contents` object, NO outputSchema, NOT the /answer endpoint. type "fast": a URL, not reasoning.
  const payload: Record<string, unknown> = { query, type: "fast", numResults };
  if (includeDomains && includeDomains.length > 0) payload.includeDomains = [...includeDomains];
  const res = await withTimeout(timeoutMs, (signal) =>
    fetchImpl(EXA_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal,
    }),
  );
  const body = await res.text();
  if (!res.ok) throw new Error(`exa HTTP ${res.status}: ${body.slice(0, 160)}`);
  const json = JSON.parse(body) as { results?: { title?: string; url?: string }[] };
  const results = json.results ?? [];
  const hits: SearchHit[] = results
    .filter((r): r is { title?: string; url: string } => typeof r.url === "string" && r.url.length > 0)
    .map((r) => ({ url: r.url, title: (r.title ?? "").slice(0, 200), provider: "exa" as const }));
  return { hits, bytes: body.length };
}

/**
 * Build the search seam, or null when no provider key is configured (the caller
 * then leaves the `search` tool out of the toolkit entirely — inert, never
 * offered). Both providers are queried when both keys are present; they are
 * complementary (Brave keyword-strong, Exa neural catches different sites), and
 * one erroring never fails the call — its error is named and the other's hits
 * still return.
 */
export function makeScoutSearch(options: ScoutSearchOptions): ScoutSearch | null {
  const braveKey = options.braveKey?.trim() || null;
  const exaKey = options.exaKey?.trim() || null;
  if (!braveKey && !exaKey) return null;
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const perProvider = options.perProvider ?? DEFAULT_PER_PROVIDER;
  const maxHits = options.maxHits ?? DEFAULT_MAX_HITS;

  return async (input): Promise<SearchProvidersResult> => {
    const query = input.query.trim();
    if (query === "") {
      return { hits: [], requestCount: 0, bytesFetched: 0, providersUsed: [], errors: ["empty query"] };
    }
    const jobs: { name: string; run: Promise<{ hits: SearchHit[]; bytes: number }> }[] = [];
    if (braveKey) jobs.push({ name: "brave", run: braveSearch(query, braveKey, fetchImpl, timeoutMs, perProvider) });
    if (exaKey) jobs.push({ name: "exa", run: exaSearch(query, exaKey, fetchImpl, timeoutMs, perProvider, input.includeDomains) });

    const settled = await Promise.allSettled(jobs.map((j) => j.run));
    const providersUsed: string[] = [];
    const errors: string[] = [];
    let bytesFetched = 0;
    let requestCount = 0;
    // Interleave provider results so neither dominates the head of the list before dedupe.
    const lists: SearchHit[][] = [];
    settled.forEach((s, i) => {
      requestCount += 1;
      if (s.status === "fulfilled") {
        providersUsed.push(jobs[i].name);
        bytesFetched += s.value.bytes;
        lists.push(s.value.hits);
      } else {
        errors.push(`${jobs[i].name}: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`.slice(0, 200));
      }
    });

    const seen = new Set<string>();
    const hits: SearchHit[] = [];
    for (let rank = 0; hits.length < maxHits; rank += 1) {
      let advanced = false;
      for (const list of lists) {
        if (rank < list.length) {
          advanced = true;
          const hit = list[rank];
          const norm = normalizeUrl(hit.url);
          if (!seen.has(norm)) {
            seen.add(norm);
            hits.push(hit);
            if (hits.length >= maxHits) break;
          }
        }
      }
      if (!advanced) break;
    }

    return { hits, requestCount, bytesFetched, providersUsed, errors };
  };
}
