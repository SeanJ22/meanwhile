/**
 * The HTTP half of the Legistar adapter: paging, pacing, and backoff.
 *
 * Kept apart from normalize() so the transform stays pure and testable against
 * a recorded fixture, and so the retrieval discipline lives in exactly one
 * place rather than being re-decided per endpoint.
 *
 * The discipline is from the brief's §4.5.4 and it is engineering manners, not
 * hedging: identify yourself, go at a human pace, never parallelize against a
 * single tenant, and honour what the server tells you.
 */

/*
 * The User-Agent is `sourceUserAgent` from the shared HTTP module (RULING 103,
 * 2026-08-23). This file carried its own byte-identical copy, and so did the
 * Congress and Plural adapters — four implementations of "who is calling",
 * which is a claim `CLAUDE.md` makes law: an identified `User-Agent` with a
 * contact address. Four copies is four places for that claim to drift.
 *
 * The PACING is deliberately NOT shared. Legistar's spacing and retry budget
 * were measured against Legistar; folding them into the shared module would
 * silently re-tune a tenant's rate limit.
 */
import { sourceUserAgent } from "../http.ts";

const API_ROOT = "https://webapi.legistar.com/v1";

/** Legistar caps a reply at 1000 rows regardless of what `$top` asks for. */
const PAGE_SIZE = 1000;

/** Between requests to the same tenant. Serialized, never concurrent. */
const REQUEST_SPACING_MS = 350;

const MAX_RETRIES = 4;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class LegistarError extends Error {
  // Written out rather than declared as constructor parameter properties: node
  // runs this repo's TypeScript in strip-only mode, which does not support them.
  readonly status: number;
  readonly url: string;

  constructor(message: string, status: number, url: string) {
    super(message);
    this.name = "LegistarError";
    this.status = status;
    this.url = url;
  }
}

/**
 * What a status code from this API actually means.
 *
 * Measured across nine client slugs on 2026-08-12 and worth encoding, because a
 * bare 500 from an API that is demonstrably live reads as an outage and is not
 * one — it is the answer for a slug that is not a client.
 */
export function describeStatus(status: number): string {
  if (status === 403) {
    return "client requires an API token — many are issued free on request";
  }
  if (status === 500) {
    return "not a Legistar client under this slug (the API itself is fine)";
  }
  if (status === 404) return "endpoint not found";
  return `HTTP ${status}`;
}

interface RequestOptions {
  /** Overridden in tests so the suite never sleeps or touches the network. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

async function requestOnce(
  url: string,
  options: RequestOptions,
): Promise<Response> {
  const impl = options.fetchImpl ?? fetch;
  return impl(url, {
    headers: {
      "User-Agent": sourceUserAgent(),
      Accept: "application/json",
    },
    signal: options.signal,
  });
}

/**
 * One GET, with backoff on the codes worth retrying.
 *
 * 429 and 5xx back off; everything else fails immediately, because retrying a
 * 500 from a wrong slug just asks the same wrong question four more times.
 * `Retry-After` wins over our own schedule when the server sends one.
 */
async function getJson<T>(path: string, options: RequestOptions): Promise<T> {
  const url = `${API_ROOT}/${path}`;
  let lastStatus = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await requestOnce(url, options);
    lastStatus = response.status;

    if (response.ok) {
      return (await response.json()) as T;
    }

    const retryable = response.status === 429 || response.status >= 500;

    // A 500 here is "not a client", not a transient fault — see describeStatus.
    // Retrying it is pointless, so only 429 and genuine 5xx above 500 back off.
    if (!retryable || response.status === 500 || attempt === MAX_RETRIES) {
      throw new LegistarError(
        `${describeStatus(response.status)} for ${url}`,
        response.status,
        url,
      );
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : REQUEST_SPACING_MS * 2 ** attempt;

    await sleep(waitMs);
  }

  throw new LegistarError(
    `${describeStatus(lastStatus)} for ${url}`,
    lastStatus,
    url,
  );
}

/**
 * Page through a collection by ascending id.
 *
 * **Not `$skip`.** Offset paging drops rows when the underlying set changes
 * between requests, which on a busy client during a long query it does. Filtering
 * on `id gt <highest seen>` is stable under insertion, which is the documented
 * advice for exactly this reason.
 */
async function pageById<T>(
  path: string,
  idField: string,
  idOf: (row: T) => number,
  filter: string | undefined,
  options: RequestOptions,
): Promise<T[]> {
  const collected: T[] = [];
  let cursor = 0;
  let guard = 0;

  // 100 pages of 1000 is far past any real client-year; it is a runaway stop,
  // not a coverage limit.
  while (guard++ < 100) {
    const clauses = [`${idField} gt ${cursor}`];
    if (filter) clauses.push(filter);

    const query = [
      `$filter=${encodeURIComponent(clauses.join(" and "))}`,
      `$orderby=${idField}`,
      `$top=${PAGE_SIZE}`,
    ].join("&");

    const page = await getJson<T[]>(`${path}?${query}`, options);
    collected.push(...page);

    if (page.length < PAGE_SIZE) break;

    cursor = Math.max(...page.map(idOf));
    await sleep(REQUEST_SPACING_MS);
  }

  return collected;
}

/**
 * Upcoming and recently concluded events for one client.
 *
 * The date window is applied upstream rather than locally: an unfiltered
 * `/events` call on a long-running client returns every meeting it has ever
 * held, which is rude and slow for no benefit.
 */
export async function fetchEvents<T>(
  slug: string,
  window: { from: string; to: string },
  options: RequestOptions = {},
): Promise<T[]> {
  const filter =
    `EventDate ge datetime'${window.from}' and EventDate le datetime'${window.to}'`;

  return pageById<T>(
    `${slug}/events`,
    "EventId",
    (row) => (row as { EventId: number }).EventId,
    filter,
    options,
  );
}

/** Agenda items for one meeting. Read only for the 4.6.9 multi-body check. */
export async function fetchEventItems<T>(
  slug: string,
  eventId: number,
  options: RequestOptions = {},
): Promise<T[]> {
  return getJson<T[]>(
    `${slug}/events/${eventId}/eventitems?$top=${PAGE_SIZE}`,
    options,
  );
}

export { REQUEST_SPACING_MS, PAGE_SIZE, sourceUserAgent as userAgent };
