/**
 * The retrieval discipline, shared by every adapter that speaks HTTP.
 *
 * Same manners as `lib/sources/legistar/client.ts`, factored out for the
 * adapters that arrived with the composite: identify yourself, go at a human
 * pace, honour `Retry-After`, and never parallelize against a single tenant.
 * Engineering manners, not hedging — see `CLAUDE.md` on public records.
 */

const REQUEST_SPACING_MS = 400;
const MAX_RETRIES = 2;

/**
 * Who is calling, so an administrator seeing this in a log has somewhere to
 * write. The contact address comes from the environment rather than being
 * committed, because a personal email in a public repository is a different
 * decision from a polite User-Agent.
 */
export function sourceUserAgent(): string {
  const contact = process.env.INGEST_CONTACT_EMAIL?.trim();
  const suffix = contact
    ? `contact: ${contact}`
    : "https://github.com/SeanJ22/we-the-people";
  return `we-the-people civic meeting index (${suffix})`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class SourceHttpError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(message: string, status: number, url: string) {
    super(message);
    this.name = "SourceHttpError";
    this.status = status;
    this.url = url;
  }
}

export interface HttpOptions {
  /** Overridden in tests so the suite never sleeps or touches the network. */
  fetchImpl?: typeof fetch;
  accept?: string;
  signal?: AbortSignal;
}

/**
 * One polite GET returning the body as text. Retries 429 and 5xx a small
 * number of times, honouring `Retry-After`; everything else fails immediately.
 */
export async function politeGetText(
  url: string,
  options: HttpOptions = {},
): Promise<{ status: number; contentType: string; text: string }> {
  const impl = options.fetchImpl ?? fetch;
  let lastStatus = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await impl(url, {
      headers: {
        "User-Agent": sourceUserAgent(),
        Accept: options.accept ?? "*/*",
      },
      signal: options.signal,
    });
    lastStatus = response.status;

    if (response.ok) {
      return {
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        text: await response.text(),
      };
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_RETRIES) {
      throw new SourceHttpError(`HTTP ${response.status} for ${url}`, response.status, url);
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    const waitMs =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : REQUEST_SPACING_MS * 2 ** attempt;
    await sleep(waitMs);
  }

  throw new SourceHttpError(`HTTP ${lastStatus} for ${url}`, lastStatus, url);
}

/** One polite GET returning parsed JSON. */
export async function politeGetJson<T>(
  url: string,
  options: HttpOptions = {},
): Promise<T> {
  const { text } = await politeGetText(url, {
    ...options,
    accept: options.accept ?? "application/json",
  });
  return JSON.parse(text) as T;
}

/**
 * Decode the handful of HTML entities that occur in these feeds. Numeric
 * references cover both decimal and hex forms — `&#x27;` reached readers
 * literally in a body name (caught by screenshot, 2026-08-15) because only
 * the decimal spelling was handled.
 */
export function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2019;/gi, "’")
    .replace(/&#8217;/g, "’")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export { REQUEST_SPACING_MS };
