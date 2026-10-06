/**
 * **WARM A NEW DEPLOY BEFORE ITS FIRST READER DOES.** (C21, 2026-09-25.)
 *
 * A deploy starts every server instance cold and empties the CDN for the
 * production context, and the first readers after it paid for both: on
 * production, 2026-09-25, `/api/meetings?zip=85701` from a fresh deploy took a
 * median 3.8 s, five of ten over the 3 s bar (docs/rulings.md §6). The five-
 * minute keep-warm pinger reaches a new deploy up to five minutes late.
 *
 * So when Netlify reports a production deploy succeeded
 * (`netlify/functions/deploy-succeeded.mts`), this waits until `/api/build`
 * serves that commit, then at once makes the pinger's fourteen marked warm
 * calls (each loads the reader edge, resolves one place per published state
 * and loads the Ask route's code and sources on its instance,
 * app/api/warm/route.ts) and asks `/api/meetings` for
 * each pilot ZIP exactly as the map asks, so the CDN holds those answers
 * before a reader arrives. It then asks each pilot once more and records
 * whether the CDN answered: the evidence, in the function log, that the fill
 * took.
 *
 * Everything here is pure or takes its fetch and clock as arguments, so
 * tests/post-deploy-warm.test.ts proves the plan without a network.
 */
import { PUBLIC_SITE_ORIGIN } from "./origins.ts";
import type { WarmPlace } from "./warm-places.ts";

/** The marker every request here carries, so no log can count it as a reader. */
export const POST_DEPLOY_WARM_MARKER = "post-deploy-warm";

export type { WarmPlace } from "./warm-places.ts";

/** The most places one deploy fills; the rest wait for the next deploy or the CDN's own fills. */
export const MAX_WARM_PLACES = 300;
/** How many place requests are in flight at once. */
export const WARM_CONCURRENCY = 24;

/**
 * The map's request for a typed ZIP, byte for byte: `components/map/map-entry.tsx`
 * builds `/api/meetings?lat=${lat}&lng=${lng}${zipParam}${radiusParam}`, and a
 * typed ZIP's view carries no radius.
 */
export function readerMeetingsPath(point: WarmPlace): string {
  return `/api/meetings?lat=${point.lat}&lng=${point.lng}&zip=${point.zip}`;
}

export interface DeployToWarm {
  readonly commit: string;
  readonly deployId: string;
}

/**
 * The production deploy an event names, or null for anything else: a branch
 * deploy, a preview, or a payload without a commit. Reads the legacy
 * `deploy-succeeded` body (`{ payload: { context, commit_ref, id } }`) and the
 * typed-handler shape (`{ deploy: { context, commitRef, id } }`).
 */
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
  /** The per-request cap on every warm and fill request. */
  readonly requestTimeoutMs?: number;
  /** The fourteen marked warm calls (`netlify/functions/keep-warm.mts`). */
  readonly warmCalls: (fetchImpl: typeof fetch) => Promise<{ answered: number; ms: number }>;
  /** The places to fill; by default one per published county, read from the live site (`/api/warm?places=1`). */
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
  | {
      readonly outcome: "WARMED";
      readonly commit: string;
      readonly waitedMs: number;
      readonly warm: { readonly answered: number; readonly ms: number };
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

/** Wait for the deploy to serve, then warm its instances and fill the CDN with the pilot answers. */
export async function warmAfterDeploy(deploy: DeployToWarm, options: PostDeployWarmOptions): Promise<PostDeployWarmResult> {
  const origin = options.origin ?? PUBLIC_SITE_ORIGIN;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  // Inside Netlify's 60 s synchronous limit: at most ~25 s waiting (each poll
  // capped at 5 s), then the warm calls beside the fills (≤12 s each), then the
  // rereads (≤12 s, CDN hits when the fill took).
  const deadline = options.serveDeadlineMs ?? 25_000;
  const pollMs = options.pollMs ?? 2_000;
  const timeoutMs = options.requestTimeoutMs ?? 12_000;

  const started = now();
  for (;;) {
    if ((await servedCommit(origin, fetchImpl, Math.min(timeoutMs, 5_000))) === deploy.commit) break;
    if (now() - started + pollMs > deadline) return { outcome: "NOT_SERVED", commit: deploy.commit, waitedMs: Math.round(now() - started) };
    await sleep(pollMs);
  }
  const waitedMs = Math.round(now() - started);

  const placesOf = options.places ?? ((f: typeof fetch) => publishedPlaces(origin, f, timeoutMs));
  const budgetMs = options.fillBudgetMs ?? 25_000;
  const [warm, places] = await Promise.all([options.warmCalls(fetchImpl), placesOf(fetchImpl).catch(() => [] as readonly WarmPlace[])]);
  const wanted = places.slice(0, MAX_WARM_PLACES);
  const fillDeadline = now() + budgetMs * 0.6;
  const fills = await readAll(origin, wanted, fetchImpl, now, timeoutMs, fillDeadline);
  const rereads = await readAll(origin, wanted, fetchImpl, now, timeoutMs, now() + budgetMs * 0.4);
  return { outcome: "WARMED", commit: deploy.commit, waitedMs, warm, places: wanted.length, fills, rereads };
}

/** One place per published county, from the live site's own reader edge manifest. */
export async function publishedPlaces(origin: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<readonly WarmPlace[]> {
  const response = await fetchImpl(`${origin}/api/warm?places=1`, {
    headers: { "x-wtp-synthetic-run": "keep-warm", accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) return [];
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
      out[i] = now() > deadline
        ? { zip: places[i].zip, status: "SKIPPED", ms: 0, cacheStatus: null }
        : await readPilot(origin, places[i], fetchImpl, now, timeoutMs);
    }
  };
  await Promise.all(Array.from({ length: Math.min(WARM_CONCURRENCY, places.length) }, worker));
  return out;
}
