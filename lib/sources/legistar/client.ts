import { sourceUserAgent } from "../http.ts";
import { sourceAcquisitionSleep } from "../acquisition-deadline.ts";

const API_ROOT = "https://webapi.legistar.com/v1";

/** Legistar caps a reply at 1000 rows regardless of what `$top` asks for. */
const PAGE_SIZE = 1000;

/** The runaway stop for `pageById`, named so the error that reports hitting it can name it. */
const MAX_PAGES = 100;

/** Between requests to the same tenant. Serialized, never concurrent. */
const REQUEST_SPACING_MS = 350;

const MAX_RETRIES = 4;

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
  select?: readonly string[];
  filter?: string;
  onRead?: (reading: { url: string; text: string; retrievedAt: string }) => void;
}

// Tenants share a vendor hostname, not a connection slot. Keep paging,
// agenda and outcome reads for one tenant serialized across all callers.
const clientSlots = new Map<string, Promise<void>>();

export function legistarConnectionKey(slug: string): string {
  if (!/^[a-z0-9_-]+$/i.test(slug)) throw new Error("Invalid Legistar client slug");
  return `legistar:${slug.toLowerCase()}`;
}

async function inClientSlot<T>(slug: string, options: RequestOptions, read: () => Promise<T>): Promise<T> {
  const key = legistarConnectionKey(slug);
  const previous = clientSlots.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  clientSlots.set(key, current);
  await previous;
  try {
    options.signal?.throwIfAborted();
    return await read();
  } finally {
    try { await sourceAcquisitionSleep(REQUEST_SPACING_MS, options.signal); }
    finally {
      release();
      if (clientSlots.get(key) === current) clientSlots.delete(key);
    }
  }
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

async function getJson<T>(path: string, options: RequestOptions): Promise<T> {
  return inClientSlot(path.split("/")[0], options, () => getJsonInSlot<T>(path, options));
}

async function getJsonInSlot<T>(path: string, options: RequestOptions): Promise<T> {
  const url = `${API_ROOT}/${path}`;
  let lastStatus = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await requestOnce(url, options);
    lastStatus = response.status;

    if (response.ok) {
      const text = await response.text();
      const body = JSON.parse(text) as T;
      options.onRead?.({ url, text, retrievedAt: new Date().toISOString() });
      options.signal?.throwIfAborted();
      return body;
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

    await sourceAcquisitionSleep(waitMs, options.signal);
  }

  throw new LegistarError(
    `${describeStatus(lastStatus)} for ${url}`,
    lastStatus,
    url,
  );
}

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

  // A runaway stop, not a coverage limit: exiting on the cap after a full last page (the server saying there
  // is more) is reported as a failure, never a clean success.
  while (guard++ < MAX_PAGES) {
    const clauses = [`${idField} gt ${cursor}`];
    if (filter) clauses.push(filter);

    const query = [
      `$filter=${encodeURIComponent(clauses.join(" and "))}`,
      `$orderby=${idField}`,
      `$top=${PAGE_SIZE}`,
      ...(options.select?.length ? [`$select=${encodeURIComponent(options.select.join(","))}`] : []),
    ].join("&");

    const page = await getJson<T[]>(`${path}?${query}`, options);
    if (!Array.isArray(page) || page.length > PAGE_SIZE || page.some(row => !Number.isSafeInteger(idOf(row)) || idOf(row) <= cursor) ||
      new Set(page.map(idOf)).size !== page.length ||
      (page.length === PAGE_SIZE && page.some((row, index) => index > 0 && idOf(row) <= idOf(page[index - 1])))) {
      throw new LegistarError(`${path}: invalid or non-advancing native-id page`, 200, path);
    }
    collected.push(...page);

    if (page.length < PAGE_SIZE) break;

    cursor = Math.max(...page.map(idOf));

    // A-006 · the runaway stop, made a failure boundary. A FULL last page at
    // the cap means the server has more and we stopped asking.
    if (guard >= MAX_PAGES) {
      throw new LegistarError(
        `${path}: reached the ${MAX_PAGES}-page safety cap with a full page still ` +
          `returning. ${collected.length} row(s) were read and an unknown number were ` +
          `left unretrieved past ${idField} ${cursor}. A safety cap is a failure ` +
          "boundary, never an implicit end of data (A-006).",
        200,
        path,
      );
    }
  }

  return collected;
}

export async function fetchEvents<T>(
  slug: string,
  window: { from: string; to: string; bodyId?: number },
  options: RequestOptions = {},
): Promise<T[]> {
  if (window.bodyId !== undefined && (!Number.isSafeInteger(window.bodyId) || window.bodyId <= 0)) throw new Error("LEGISTAR_NATIVE_BODY_INVALID");
  const filter =
    `EventDate ge datetime'${window.from}' and EventDate le datetime'${window.to}'` +
    (window.bodyId === undefined ? "" : ` and EventBodyId eq ${window.bodyId}`);

  return pageById<T>(
    `${slug}/events`,
    "EventId",
    (row) => (row as { EventId: number }).EventId,
    filter,
    options,
  );
}

/** Native body identities on this already-known tenant. */
export async function fetchBodies<T extends { BodyId: number }>(slug: string, options: RequestOptions = {}): Promise<T[]> {
  return pageById<T>(`${slug}/bodies`, "BodyId", row => row.BodyId, undefined, options);
}

export async function fetchPersons<T extends { PersonId: number }>(slug: string, options: RequestOptions = {}): Promise<T[]> {
  return pageById<T>(`${slug}/persons`, "PersonId", row => row.PersonId, options.filter, options);
}

export async function fetchOfficeRecords<T extends { OfficeRecordId: number }>(slug: string, options: RequestOptions = {}): Promise<T[]> {
  return pageById<T>(`${slug}/officerecords`, "OfficeRecordId", row => row.OfficeRecordId, options.filter, options);
}

export async function fetchEventItems<T>(
  slug: string,
  eventId: number,
  options: RequestOptions = {},
): Promise<T[]> {
  return pageById<T>(`${slug}/events/${eventId}/eventitems`, "EventItemId",
    row => (row as { EventItemId: number }).EventItemId, undefined, options);
}

/** One event record by id. Carries the minutes status and minutes pointer. */
export async function fetchEvent<T>(
  slug: string,
  eventId: number,
  options: RequestOptions = {},
): Promise<T> {
  return getJson<T>(`${slug}/events/${eventId}`, options);
}

export async function fetchEventItemVotes<T>(
  slug: string,
  eventItemId: number,
  options: RequestOptions = {},
): Promise<T[]> {
  return getJson<T[]>(
    `${slug}/eventitems/${eventItemId}/votes?$top=${PAGE_SIZE}`,
    options,
  );
}

export { REQUEST_SPACING_MS, PAGE_SIZE, sourceUserAgent as userAgent };
