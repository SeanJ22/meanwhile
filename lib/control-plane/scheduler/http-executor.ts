/**
 * **A REAL EXECUTOR: it fetches a publisher's own surface and records what it got.**
 * (Session B resume, W3.F, 2026-08-31.)
 *
 * The shadow runner's executor was `async () => ({ ok: true })`. It performed
 * no retrieval, and under the old seam that `ok: true` read as WORKED and
 * cleared the obligation's freshness debt. Eight dispatches were reported as
 * having worked routes that were never opened.
 *
 * This one opens them. It is deliberately the DETERMINISTIC lane — an HTTP GET
 * against a URL the project already holds provenance for — because that is
 * what the meetings obligations need and because a model worker is the wrong
 * first proof: it would put variance between the scheduler and the thing being
 * proven, and the question here is whether the LIFECYCLE runs, not whether a
 * model can find a route.
 *
 * ## The disposition mapping is the whole of the honesty
 *
 * ```
 *   2xx with bytes      INGESTED          an artifact exists, hashed
 *   2xx with no bytes   ABORTED           a zero-byte read is a FAILED read
 *   401 403 429 challenge  BLOCKED_CURRENTLY   a wall, named as a wall
 *   4xx other           BLOCKED_CURRENTLY  still a fact about the route
 *   5xx / transport     ABORTED           their side, or the wire, broke
 * ```
 *
 * **There is no branch that produces `WALKED_NO_YIELD` from a failure**, and
 * that absence is the point. `WALKED_NO_YIELD` asserts that the route was
 * REACHED and the publisher genuinely had nothing — a claim about a
 * government. Nothing this module can observe from a non-2xx response
 * justifies it, so nothing here can write it. A 404 is a fact about a URL; the
 * record it was supposed to serve is still owed.
 *
 * Equally, a zero-byte 200 does not become an empty document. That is the
 * cross-cutting rule — a zero-row extraction is a FAILED extraction — and it
 * is the shape this repository has paid for more than once.
 */

import { createHash } from "node:crypto";

import { assertPublicUrl } from "../../hunt/egress.ts";
import { ZERO_COST, type AttemptCost } from "../attempt.ts";

import type { RunWork, WorkOutcome } from "./dispatch.ts";

/** How long one route may take before the attempt is abandoned. */
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

/**
 * Between requests to ONE host. A freshness sweep across a publisher's bodies
 * is dozens of requests at the same origin, and a scheduler that fired them
 * with no spacing is a load test wearing a refresh's name.
 */
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

/** The seam a test replaces. Nothing else in this module touches the network. */
export type FetchOne = (url: string, timeoutMs: number) => Promise<FetchOutcome>;

export const realFetch: FetchOne = async (url, timeoutMs) => {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        /*
         * Named, not disguised. The transparency mandate permits persistence
         * and forbids residential-proxy spoofing; a User-Agent that says who
         * we are is the opposite of evasion, and it gives an administrator
         * someone to contact rather than a mystery to block.
         */
        "User-Agent":
          "we-the-people-freshness/1.0 (civic records refresh; public data; contact via repository)",
        Accept: "text/html,application/xhtml+xml,application/json,text/calendar,*/*",
      },
    });
    const body = await response.text();
    return {
      status: response.status,
      bytes: Buffer.byteLength(body, "utf8"),
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      body,
      durationMs: Date.now() - started,
      transportError: null,
      contentRange: response.headers.get("content-range"),
    };
  } catch (error) {
    return {
      status: null,
      bytes: 0,
      contentType: "",
      body: "",
      durationMs: Date.now() - started,
      transportError: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * **WHAT THIS MODULE ACTUALLY RUNS, on every path.**
 * (Session B closure, W3.E, 2026-08-31.)
 *
 * A deterministic HTTP GET. No model runs here, whatever `chooseExecutor`
 * decided — and it frequently decides otherwise, because nothing in the method
 * store joins a meetings publisher to a graduated route, so every meetings
 * obligation is classified ungraduated and routed to the bounded model lane.
 * The shadow runner then injects THIS walker regardless.
 *
 * That arrangement is fine. What was not fine is that the run record reported
 * the DECISION as the fact: the 2026-08-31 cycles recorded 10
 * BOUNDED_MODEL_WORKER Attempts for work no model touched, which invites a
 * reader of the cost ledger to attribute model spend and model variance to a
 * run that had neither.
 */
const RAN_AS = "DETERMINISTIC" as const;

function cost(outcome: FetchOutcome): AttemptCost {
  return {
    ...ZERO_COST,
    durationMs: outcome.durationMs,
    bytesFetched: outcome.bytes,
    requestCount: outcome.requestCount ?? 1,
  };
}

/**
 * Build the executor.
 *
 * `urlFor` is injected rather than read from the obligation, because an
 * obligation names a SUBJECT and a route class, not a URL — and a scheduler
 * that carried URLs on its obligations would be a route list with a clock,
 * which is the thing `VENDOR != RECORD` refuses.
 */
export function httpExecutor(input: {
  readonly urlFor: (obligationId: string) => string | null;
  readonly fetchOne?: FetchOne;
  readonly timeoutMs?: number;
  /** Injected so tests do not sleep. Returns immediately when omitted. */
  readonly spaceOut?: (hostKey: string) => Promise<void>;
}): RunWork {
  const fetchOne = input.fetchOne ?? realFetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

  return async ({ obligation, routeTaskId }): Promise<WorkOutcome> => {
    const obligationId = obligation.obligation.id;
    const raw = input.urlFor(obligationId);
    if (raw === null) {
      return {
              ranAs: RAN_AS,
              kind: "ABORTED",
        detail:
          `no source URL is held for ${obligationId}, so there is nothing to open. This is a ` +
          "gap in OUR provenance, not evidence about the publisher, and it stays owed.",
      };
    }

    let url: URL;
    try {
      url = assertPublicUrl(raw);
    } catch (error) {
      return {
              ranAs: RAN_AS,
              kind: "ABORTED",
        detail: `the held URL is not a public http(s) address: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    if (input.spaceOut) await input.spaceOut(url.host);
    const got = await fetchOne(url.toString(), timeoutMs);

    const providerFailure = httpProviderFailure(url.toString(), got);
    if (providerFailure !== null && got.status !== 429) return { ranAs: RAN_AS, kind: "ABORTED", cost: cost(got),
      detail: `Provider failure at ${url.host}: ${providerFailure}. The record remains owed; try another source.` };

    const status = got.status ?? 0;

    if (status >= 200 && status < 300) {
      const contentHash = `sha256-${createHash("sha256").update(got.body).digest("hex")}`;
      return {
              ranAs: RAN_AS,
              kind: "DISPOSED",
        disposition: {
          disposition: "INGESTED",
          observation: {
            rawCount: 1,
            normalizedCount: 1,
            routeOnlyCount: null,
            earliest: null,
            latest: null,
          },
          permission: "ALLOWED",
          transport: "REACHABLE",
          note: `HTTP ${status} from ${url.host}, ${got.bytes} bytes captured to the vault`,
        },
        artifacts: [
          {
            artifactId: `art-${contentHash.slice(7, 27)}-${routeTaskId.slice(3, 11)}`,
            tier: "RESTRICTED_RAW",
            contentHash,
            byteLength: got.bytes,
            contentType: got.contentType,
            canonicalUrl: url.toString(),
            partial: false,
            recordedAt: new Date().toISOString(),
          },
        ],
        cost: cost(got),
        detail: `HTTP ${status}, ${got.bytes} bytes`,
      };
    }

    if (WALL_STATUSES.includes(status)) {
      return {
              ranAs: RAN_AS,
              kind: "DISPOSED",
        disposition: {
          disposition: "BLOCKED_CURRENTLY",
          observation: null,
          /*
           * PERMISSION AND TRANSPORT ARE ORTHOGONAL (RULING 182). A 403 is a
           * refusal of THIS CLIENT and is not a reading of the host's rules, so
           * permission is CANNOT_TELL and fails safe rather than being written
           * down as DISALLOWED — which would retire a route on evidence that
           * never mentioned a rule.
           */
          permission: "CANNOT_TELL",
          transport: "CHALLENGED",
          note:
            `${url.host} answered HTTP ${status} to this client. That is a wall at this route, ` +
            "and it is not a fact about whether the record exists or about the host's policy.",
        },
        cost: cost(got),
        detail: `HTTP ${status} — a wall, named. The record remains owed.`,
      };
    }

    if (status >= 400 && status < 500) {
      return {
              ranAs: RAN_AS,
              kind: "DISPOSED",
        disposition: {
          disposition: "BLOCKED_CURRENTLY",
          observation: null,
          permission: "CANNOT_TELL",
          transport: "FAILED_AT_RUNG",
          note:
            `${url} answered HTTP ${status}. The URL did not serve the record; the record itself ` +
            "is not addressed by that, and another representation of it is owed.",
        },
        cost: cost(got),
        detail: `HTTP ${status} at this URL — a fact about the URL, not about the record.`,
      };
    }

    return {

          ranAs: RAN_AS,

          kind: "ABORTED",
      cost: cost(got),
      detail: `${url.host} answered HTTP ${status} — their side broke, and this retries.`,
    };
  };
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
