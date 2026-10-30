/** What one HTTP read returned, how a provider failure is told from a missing record, and the per-host spacer the runner supplies. */

/** How long one route may take before the attempt is abandoned. */
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

/** Spacing between requests to one host. */
export const PER_HOST_SPACING_MS = 1_500;

/** The statuses that mean "a wall", as distinct from "their side broke". */
export const WALL_STATUSES: readonly number[] = [401, 403, 405, 406, 429, 451];

export interface FetchOutcome {
  readonly status: number | null;
  readonly bytes: number;
  readonly contentType: string;
  readonly body: string;
  readonly durationMs: number;
  readonly transportError: string | null;
  /** Actual requests, including zero when an existing provider circuit deferred the call. */
  readonly requestCount?: number;
  readonly contentRange?: string | null;
}

/** A failed provider response is not evidence of a missing civic record. */
export function httpProviderFailure(url: string, got: FetchOutcome): string | null {
  if (got.transportError !== null) return `transport failed: ${got.transportError}`;
  if (got.status === 429 || (got.status !== null && got.status >= 500)) return `HTTP ${got.status}`;
  if (got.status === 206 || got.contentRange) return `partial HTTP ${got.status} response (${got.bytes} bytes)`;
  if (got.status === null || got.status < 200 || got.status >= 300) return null;
  if (got.bytes === 0) return 'ZERO BYTES: a zero-row extraction is a failed extraction, never an empty document';
  const parsed = new URL(url);
  const rows = parsed.hostname === 'api.wikimedia.org' && parsed.pathname.includes('/search/page') ? 'pages'
    : parsed.hostname === 'api.marginalia.nu' && parsed.pathname.includes('/search/') ? 'results' : null;
  if (rows === null) return null;
  let data: unknown;
  try { data = JSON.parse(got.body); }
  catch { return `malformed ${parsed.hostname} JSON (${got.bytes} bytes)`; }
  if (data === null || typeof data !== 'object' || !Array.isArray((data as Record<string, unknown>)[rows])) {
    return `${parsed.hostname} response lacks its ${rows} array (${got.bytes} bytes)`;
  }
  // A complete, well-formed empty search is a query miss, not a provider outage.
  // The route's existing yield contract still refuses to ingest it as a record.
  return null;
}

/** A spacer that genuinely waits, keyed per host. The runner supplies it. */
export function hostSpacer(spacingMs: number = PER_HOST_SPACING_MS): (host: string) => Promise<void> {
  const lastAt = new Map<string, number>();
  return async (host) => {
    const previous = lastAt.get(host);
    const now = Date.now();
    if (previous !== undefined) {
      const wait = previous + spacingMs - now;
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastAt.set(host, Date.now());
  };
}
