/** Search excerpts remain leads until verified against the official source. */

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

/** Admits one paid provider request, or says why not; `done` returns the slot. Shares the discovery walk's `SearchBudget` shape. */
export interface ScoutSearchBudget {
  take(host: string): Promise<string | null>;
  done(host: string): Promise<void>;
}

export interface ScoutSearchOptions {
  readonly braveKey?: string | null;
  readonly exaKey?: string | null;
  /** Required: every paid provider request is admitted by the owner's paid-search budget first; a refused or unreadable budget sends nothing. */
  readonly budget: ScoutSearchBudget;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  /** Results requested from each provider before dedupe. */
  readonly perProvider?: number;
  /** The combined pointer list handed to the model, after dedupe. */
  readonly maxHits?: number;
}

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const EXA_ENDPOINT = "https://api.exa.ai/search";
/** The budget's host keys; the same hosts the discovery walk's per-day cap is kept under (`SEARCH_HOSTS`). */
export const SCOUT_SEARCH_HOSTS = { brave: new URL(BRAVE_ENDPOINT).host, exa: new URL(EXA_ENDPOINT).host } as const;
const DEFAULT_TIMEOUT_MS = 8_000;
/** Covers the bounded HTTP call and delayed budget release after a crashed process. */
export const SEARCH_REQUEST_LIFETIME_MS = 120_000;
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
  u.searchParams.set("extra_snippets", "true");
  const res = await withTimeout(timeoutMs, (signal) =>
    fetchImpl(u.toString(), {
      method: "GET",
      headers: { Accept: "application/json", "X-Subscription-Token": key },
      signal,
    }),
  );
  const body = await res.text();
  if (!res.ok) throw new Error(`brave HTTP ${res.status}: ${body.split(key).join("[REDACTED]").slice(0, 160)}`);
  const json = JSON.parse(body) as { web?: { results?: { title?: string; url?: string; description?: string; text?: string; extra_snippets?: string[] }[] } };
  const results = json.web?.results ?? [];
  const hits: SearchHit[] = results
    .filter(r => typeof r.url === "string" && r.url.length > 0)
    .map((r) => ({ url: r.url!, title: (r.title ?? "").slice(0, 200), provider: "brave" as const, text: [r.description, ...(r.extra_snippets ?? [])].filter(Boolean).join("\n").slice(0, 6000) }));
  return { hits, bytes: body.length };
}

/** Exa neural/keyword search with source excerpts and no synthesis. */
export async function exaSearch(
  query: string,
  key: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  numResults: number,
  includeDomains?: readonly string[],
): Promise<{ readonly hits: SearchHit[]; readonly bytes: number }> {
  // Source text, never synthesized answers; the existing paid-search budget admits each call.
  const payload: Record<string, unknown> = { query, type: "fast", numResults, contents: {text: {maxCharacters:6000}} };
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
  if (!res.ok) throw new Error(`exa HTTP ${res.status}: ${body.split(key).join("[REDACTED]").slice(0, 160)}`);
  const json = JSON.parse(body) as { results?: { title?: string; url?: string; description?: string; text?: string; extra_snippets?: string[] }[] };
  const results = json.results ?? [];
  const hits: SearchHit[] = results
    .filter(r => typeof r.url === "string" && r.url.length > 0)
    .map((r) => ({ url: r.url!, title: (r.title ?? "").slice(0, 200), provider: "exa" as const, text: (r.text ?? "").slice(0, 6000) }));
  return { hits, bytes: body.length };
}

/** Build the search seam, or null when no provider key is configured. Both providers are queried when both keys are present; one erroring never fails the call. */
export function makeScoutSearch(options: ScoutSearchOptions): ScoutSearch | null {
  const braveKey = options.braveKey?.trim() || null;
  const exaKey = options.exaKey?.trim() || null;
  if (!braveKey && !exaKey) return null;
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>);
  const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, SEARCH_REQUEST_LIFETIME_MS / 2);
  const perProvider = options.perProvider ?? DEFAULT_PER_PROVIDER;
  const maxHits = options.maxHits ?? DEFAULT_MAX_HITS;

  return async (input): Promise<SearchProvidersResult> => {
    const query = input.query.trim();
    if (query === "") {
      return { hits: [], requestCount: 0, bytesFetched: 0, providersUsed: [], errors: ["empty query"] };
    }
    const candidates: { name: string; host: string; run: () => Promise<{ hits: SearchHit[]; bytes: number }> }[] = [];
    if (braveKey) candidates.push({ name: "brave", host: SCOUT_SEARCH_HOSTS.brave, run: () => braveSearch(query, braveKey, fetchImpl, timeoutMs, perProvider) });
    if (exaKey) candidates.push({ name: "exa", host: SCOUT_SEARCH_HOSTS.exa, run: () => exaSearch(query, exaKey, fetchImpl, timeoutMs, perProvider, input.includeDomains) });

    const providersUsed: string[] = [];
    const errors: string[] = [];
    // Admission is taken one provider at a time so two requests cannot both pass the last unit of the cap; a budget that throws is a refusal.
    const jobs: (typeof candidates[number] & { pending: Promise<PromiseSettledResult<{ hits: SearchHit[]; bytes: number }>> })[] = [];
    for (const candidate of candidates) {
      let refused: string | null;
      try {
        refused = await options.budget.take(candidate.host);
      } catch (error) {
        refused = `the paid-search budget could not be read (${error instanceof Error ? error.message : String(error)})`;
      }
      if (refused === null) jobs.push({ ...candidate, pending: candidate.run().then(
        value => ({ status: 'fulfilled' as const, value }), reason => ({ status: 'rejected' as const, reason }),
      ) });
      else errors.push(`${candidate.name}: not sent, ${refused}`.slice(0, 200));
    }

    let settled: PromiseSettledResult<{ hits: SearchHit[]; bytes: number }>[];
    try {
      settled = await Promise.all(jobs.map(j => j.pending));
    } finally {
      // Both slots live in one durable budget row. Release serially so our own
      // writes cannot conflict, and still release the second if the first fails.
      for(const job of jobs) {
        try { await options.budget.done(job.host); }
        catch { errors.push(`${job.name}: budget slot release failed; acquisition ended but shared capacity needs recovery`); }
      }
    }
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
