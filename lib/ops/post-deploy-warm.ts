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

/** The marker every request here carries, so no log can count it as a reader. */
export const POST_DEPLOY_WARM_MARKER = "post-deploy-warm";

/**
 * The pilot ZIPs, with the ZCTA centroid the map sends for each
 * (`lib/geo/zcta-centroids.json`; tests/post-deploy-warm.test.ts holds the
 * two equal). The CDN keys on the exact query, so a fill with any other
 * coordinates would fill an object no reader ever asks for.
 */
export const PILOT_ZIP_POINTS: readonly { readonly zip: string; readonly lat: number; readonly lng: number }[] = [
  { zip: "85701", lat: 32.21696, lng: -110.971 },
  { zip: "85201", lat: 33.43355, lng: -111.8504 },
  { zip: "07866", lat: 40.95499, lng: -74.48801 },
  { zip: "03255", lat: 43.31403, lng: -72.02455 },
  { zip: "86001", lat: 35.28766, lng: -111.6393 },
];

/**
 * The map's request for a typed ZIP, byte for byte: `components/map/map-entry.tsx`
 * builds `/api/meetings?lat=${lat}&lng=${lng}${zipParam}${radiusParam}`, and a
 * typed ZIP's view carries no radius.
 */
export function readerMeetingsPath(point: { readonly zip: string; readonly lat: number; readonly lng: number }): string {
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
}

export interface PilotRead {
  readonly zip: string;
  readonly status: number | "ERROR";
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

async function readPilot(origin: string, point: (typeof PILOT_ZIP_POINTS)[number], fetchImpl: typeof fetch, now: () => number, timeoutMs: number): Promise<PilotRead> {
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

  const [warm, fills] = await Promise.all([
    options.warmCalls(fetchImpl),
    Promise.all(PILOT_ZIP_POINTS.map((point) => readPilot(origin, point, fetchImpl, now, timeoutMs))),
  ]);
  const rereads = await Promise.all(PILOT_ZIP_POINTS.map((point) => readPilot(origin, point, fetchImpl, now, timeoutMs)));
  return { outcome: "WARMED", commit: deploy.commit, waitedMs, warm, fills, rereads };
}
