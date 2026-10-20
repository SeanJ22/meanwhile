/** Fill a new production deploy's CDN with the same meeting answers readers request. */
import { PUBLIC_SITE_ORIGIN } from "./origins.ts";
import type { WarmPlace } from "./warm-places.ts";

/** The marker every request here carries, so no log can count it as a reader. */
export const POST_DEPLOY_WARM_MARKER = "post-deploy-warm";

export type { WarmPlace } from "./warm-places.ts";

/** The most places one deploy fills; the rest wait for the next deploy or the CDN's own fills. */
export const MAX_WARM_PLACES = 300;
/** How many place requests are in flight at once. */
export const WARM_CONCURRENCY = 24;

/** The arriving page starts this ZIP request before hydration; fill that exact CDN key. */
export function readerMeetingsPath(point: WarmPlace): string {
  return `/api/meetings?zip=${point.zip}`;
}

export interface DeployToWarm {
  readonly commit: string;
  readonly deployId: string;
}

/** The production deploy an event names, or null; reads both the legacy and typed-handler payload shapes. */
export function deployToWarm(body: unknown): DeployToWarm | null {
  const record = (value: unknown): Record<string, unknown> | null =>
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  const outer = record(body);
  const deploy = record(outer?.payload) ?? record(outer?.deploy);
  if (!deploy || deploy.context !== "production") return null;
  const commit = deploy.commit_ref ?? deploy.commitRef;
  const deployId = deploy.id;
  if (typeof commit !== "string" || !/^[0-9a-f]{7,40}$/.test(commit)) return null;
  return { commit, deployId: typeof deployId === "string" ? deployId : "unknown" };
}

export interface PostDeployWarmOptions {
  readonly origin?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** How long to wait for `/api/build` to serve the commit. */
  readonly serveDeadlineMs?: number;
  readonly pollMs?: number;
  /** The per-request cap on every fill request. */
  readonly requestTimeoutMs?: number;
  /** The places to fill; by default one per published county, read from `/api/reader/places`. */
  readonly places?: (fetchImpl: typeof fetch) => Promise<readonly WarmPlace[]>;
  /** Total time for the fills and the rereads together; places not reached are counted, not read. */
  readonly fillBudgetMs?: number;
}

export interface PilotRead {
  readonly zip: string;
  readonly status: number | "ERROR" | "SKIPPED";
  readonly ms: number;
  /** Netlify's `Cache-Status` header, which says whether the CDN answered. */
  readonly cacheStatus: string | null;
}

export type PostDeployWarmResult =
  | { readonly outcome: "NOT_SERVED"; readonly commit: string; readonly waitedMs: number }
  | { readonly outcome: "PLACES_UNAVAILABLE"; readonly commit: string; readonly waitedMs: number }
  | {
      readonly outcome: "WARMED";
      readonly commit: string;
      readonly waitedMs: number;
      /** Places asked for, and how many of them the fills reached within the budget. */
      readonly places: number;
      readonly fills: readonly PilotRead[];
      readonly rereads: readonly PilotRead[];
    };

const HEADERS = { "x-wtp-synthetic-run": POST_DEPLOY_WARM_MARKER, accept: "application/json" } as const;

async function servedCommit(origin: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<string | null> {
  try {
    const response = await fetchImpl(`${origin}/api/build`, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const body = (await response.json()) as { commit?: unknown };
    return typeof body.commit === "string" ? body.commit : null;
  } catch {
    return null;
  }
}

async function readPilot(origin: string, point: WarmPlace, fetchImpl: typeof fetch, now: () => number, timeoutMs: number): Promise<PilotRead> {
  const started = now();
  try {
    const response = await fetchImpl(`${origin}${readerMeetingsPath(point)}`, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    await response.arrayBuffer();
    return { zip: point.zip, status: response.status, ms: Math.round(now() - started), cacheStatus: response.headers.get("cache-status") };
  } catch {
    return { zip: point.zip, status: "ERROR", ms: Math.round(now() - started), cacheStatus: null };
  }
}

/** Wait for the deploy to serve, then fill the CDN with the places' answers. */
export async function warmAfterDeploy(deploy: DeployToWarm, options: PostDeployWarmOptions = {}): Promise<PostDeployWarmResult> {
  const origin = options.origin ?? PUBLIC_SITE_ORIGIN;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  // Every request shares the 55 s total deadline, inside Netlify's 60 s limit.
  const deadline = options.serveDeadlineMs ?? 25_000;
  const pollMs = options.pollMs ?? 2_000;
  const timeoutMs = options.requestTimeoutMs ?? 12_000;

  const started = now();
  const totalDeadline = started + 55_000;
  for (;;) {
    if ((await servedCommit(origin, fetchImpl, Math.min(timeoutMs, 5_000))) === deploy.commit) break;
    if (now() - started + pollMs > deadline) return { outcome: "NOT_SERVED", commit: deploy.commit, waitedMs: Math.round(now() - started) };
    await sleep(pollMs);
  }
  const waitedMs = Math.round(now() - started);

  const placesOf = options.places ?? ((f: typeof fetch) => publishedPlaces(origin, f, timeoutMs));
  const budgetMs = options.fillBudgetMs ?? 25_000;
  let places: readonly WarmPlace[];
  try { places = await placesOf(fetchImpl); }
  catch { return { outcome: "PLACES_UNAVAILABLE", commit: deploy.commit, waitedMs }; }
  const wanted = places.slice(0, MAX_WARM_PLACES);
  const fillDeadline = Math.min(totalDeadline, now() + budgetMs * 0.6);
  const fills = await readAll(origin, wanted, fetchImpl, now, timeoutMs, fillDeadline);
  const rereads = await readAll(origin, wanted, fetchImpl, now, timeoutMs, Math.min(totalDeadline, now() + budgetMs * 0.4));
  return { outcome: "WARMED", commit: deploy.commit, waitedMs, places: wanted.length, fills, rereads };
}

/** One place per published county, from the live site's own reader edge manifest. */
export async function publishedPlaces(origin: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<readonly WarmPlace[]> {
  const response = await fetchImpl(`${origin}/api/reader/places`, {
    headers: HEADERS, signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Published places HTTP ${response.status}`);
  const body = (await response.json()) as { places?: unknown };
  return Array.isArray(body.places) ? body.places.filter((p): p is WarmPlace =>
    typeof p?.zip === "string" && typeof p.lat === "number" && typeof p.lng === "number") : [];
}

/** Read every place with bounded concurrency; a place not started by the deadline is marked SKIPPED, never read. */
async function readAll(origin: string, places: readonly WarmPlace[], fetchImpl: typeof fetch, now: () => number, timeoutMs: number, deadline: number): Promise<PilotRead[]> {
  const out: PilotRead[] = new Array(places.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= places.length) return;
      const remainingMs = Math.floor(deadline - now());
      out[i] = remainingMs <= 0
        ? { zip: places[i].zip, status: "SKIPPED", ms: 0, cacheStatus: null }
        : await readPilot(origin, places[i], fetchImpl, now, Math.min(timeoutMs, remainingMs));
    }
  };
  await Promise.all(Array.from({ length: Math.min(WARM_CONCURRENCY, places.length) }, worker));
  return out;
}
