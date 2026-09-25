/**
 * The retrieval discipline, shared by every adapter that speaks HTTP.
 *
 * Same manners as `lib/sources/legistar/client.ts`, factored out for the
 * adapters that arrived with the composite: identify yourself, go at a human
 * pace, honour `Retry-After`, and never parallelize against a single tenant.
 * Engineering manners, not hedging — see `CLAUDE.md` on public records.
 *
 * **ONE HONEST CLIENT. AN ACCESS CONTROL IS NEVER GOT PAST.** (2026-09-25.)
 *
 * Until 2026-09-25 a 403 here was a rung, not an answer: the request was
 * re-sent with a Chrome browser header set, then with a plain Chrome
 * `User-Agent` that left the project's name out, then through `curl` for a
 * different TLS fingerprint; a challenge page at 200 went straight to `curl`;
 * and a wiring row could ask for the browser profile first. Each of those
 * dressed this client as something it is not to get past a filter that had
 * refused it. Sean's decision of 2026-09-25 authorizes reading public pages
 * whatever robots.txt says and "does not extend to bypassing authentication
 * or other access controls" — and a WAF or bot filter that refuses an
 * identified client is an access control.
 *
 * So every request here is the one identified client (`sourceUserAgent()`,
 * the project's own name and contact), sent once, with the ordinary manners:
 * spacing, bounded retries of a 429 or a 5xx that honour `Retry-After`. A 401,
 * a 403 or a challenge page is a technical failure of the route, thrown as a
 * `SourceHttpError` that names the access control; the partition keeps its
 * last good version and the route is pursued by other public means, never by a
 * disguise. `tests/robots-recorded-not-blocking.test.ts` holds this.
 */

import { recordAcquiredResponse } from "./acquisition-trace.ts";
import { challengeIn } from "./challenge-signatures.ts";

export { challengeIn } from "./challenge-signatures.ts";
import { sourceAcquisitionSleep } from "./acquisition-deadline.ts";

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

export class SourceHttpError extends Error {
  readonly status: number;
  readonly url: string;
  /**
   * The ladder rung this retrieval stopped at (F22, 2026-08-20) — the numbering
   * in `CLAUDE.md` and `docs/source-ladder.md`. Since 2026-09-25 this client
   * walks one rung, `2`, the plain identified fetch: the browser-header,
   * name-dropping and `curl` rungs that used to follow a 403 disguised the
   * client and are gone (see the module header). The field stays so a stored
   * wall keeps its meaning and a stored rung 3 or 4 from before still reads.
   *
   * This is deliberately not a terminal state and there is no `SOURCE_BLOCKED`
   * beside it: a wall is one route closed, never a fact about the record.
   */
  readonly rung: number;

  constructor(message: string, status: number, url: string, rung = 2) {
    super(message);
    this.name = "SourceHttpError";
    this.status = status;
    this.url = url;
    this.rung = rung;
  }
}

export interface HttpOptions {
  /** Overridden in tests so the suite never sleeps or touches the network. */
  fetchImpl?: typeof fetch;
  accept?: string;
  signal?: AbortSignal;
  /**
   * What a real document from this URL must contain — **RULING 43, moved one
   * layer down, to the fetch (NH Hunt 3, 2026-08-21).**
   *
   * `accountedNormalize` made "documents in hand, nothing out, nothing
   * dropped" inexpressible at the NORMALIZE layer, and RULING 43 says in as
   * many words that the fetch layer remains uncovered. This is that gap, and
   * a scheduled job had already fallen into it: on 2026-08-21T13:12Z the
   * `ical` source reported `fetched 3, extracted 0, drops 0`, the zero-row
   * contract refused the result exactly as designed, and `Refresh meetings
   * snapshot` went red. The contract was right and the bug was upstream of
   * it — `parseIcs` was handed a 200 whose body carried no `VEVENT` at all,
   * so the drop loop never executed and there was nothing to count.
   *
   * `challengeIn` below catches a 200 that is a KNOWN interstitial. It cannot
   * catch a 200 that is a blank body, a truncated transfer, or an error page
   * this repo has not met — and each of those is a retrieval failure wearing
   * a successful status code. A document that fails this test is a **WALL**,
   * recorded on its rung and carried forward as a refusal, never handed
   * upward as an empty calendar.
   *
   * Two layers, because they answer different questions:
   *
   * - **Blank is universal and needs no configuration.** A whitespace-only
   *   200 is never a document, for any caller, in any format. Enforced below
   *   for every caller of this function whether or not they declare anything.
   * - **`expect` is the caller's own format**, declared where the caller
   *   knows it: `BEGIN:VCALENDAR` for an `.ics` feed. A caller that cannot
   *   name a marker still gets the blank check.
   */
  expect?: {
    /** What the format is called, so the wall names it in the reader's terms. */
    label: string;
    /** A marker every genuine document of this format carries. */
    marker: string;
  };
}

/**
 * Is this 200 a document at all?
 *
 * Returns the reason it is not, or `null` when it passes. Kept separate from
 * `politeGetText` so `tests/http-empty-success.test.ts` can hold it directly
 * against the bytes a server actually sent.
 */
export function notADocument(text: string, expect?: HttpOptions["expect"]): string | null {
  if (text.trim() === "") return "an empty body";
  if (expect && !text.includes(expect.marker)) {
    return `${expect.label} carrying no ${expect.marker}`;
  }
  return null;
}

/**
 * The headers of every request this module sends: the project's own identified
 * `User-Agent` and an `Accept`. Exported so a script that must build its own
 * request sends the same honest client rather than a borrowed one.
 */
export function sourceRequestHeaders(accept?: string): Record<string, string> {
  return {
    "User-Agent": sourceUserAgent(),
    Accept: accept ?? "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };
}

/** The access-control statuses: a technical failure of the route, never retried under another identity. */
const ACCESS_CONTROL_STATUS = new Set([401, 403, 407]);

/**
 * **THE ONE FINALIZER EVERY TRANSPORT RUNG PASSES THROUGH** — A-003.
 *
 * Before this existed there were four places a successful body could be
 * returned from `politeGetText`, and only two of them asked whether the body
 * was a document. The two that did not were both inside the 403 escalation:
 *
 * - a rung-3 browser-header 200 was checked with `challengeIn` and NOT with
 *   `notADocument`, so a blank body or an `.ics` URL answering with an HTML
 *   error page was returned as a document;
 * - the rung-4 `curl` fallback was returned raw, with neither check.
 *
 * **So document validity depended on WHICH RUNG happened to succeed** — the
 * same URL, the same bytes, judged or not judged according to how far up the
 * ladder the request had gone. That is not a missing check in one branch; it
 * is a contract that only some code paths were party to.
 *
 * The fix is structural rather than three more call sites: there is exactly
 * one place a body becomes a return value, and it is this function. Since
 * 2026-09-25 those escalation rungs are gone (they disguised the client), and
 * the one identified request still comes through here.
 *
 * @param rung Which rung obtained this body, so a refusal names it honestly.
 */
export function readValidatedResponse(
  url: string,
  rung: number,
  response: {
    status: number;
    contentType: string;
    text: string;
    bytes?: Uint8Array;
    finalUrl?: string;
  },
  expect?: HttpOptions["expect"],
): { status: number; contentType: string; text: string } {
  const wall = challengeIn(response.text);
  if (wall !== null) {
    throw new SourceHttpError(
      `${wall} at ${url} — HTTP ${response.status} carrying a challenge page rather ` +
        "than the document. This is a WALL, not an empty page: an access control, never solved or evaded.",
      response.status,
      url,
      rung,
    );
  }
  const notDoc = notADocument(response.text, expect);
  if (notDoc !== null) {
    throw new SourceHttpError(
      `HTTP ${response.status} from ${url} with ${notDoc} — a status is not a document. ` +
        `This is a WALL on rung ${rung}, not an empty source.`,
      response.status,
      url,
      rung,
    );
  }
  if (response.bytes) {
    recordAcquiredResponse({
      requestedUrl: url,
      finalUrl: response.finalUrl || url,
      httpStatus: response.status,
      bytes: response.bytes,
    });
  }
  return {
    status: response.status,
    contentType: response.contentType,
    text: response.text,
  };
}

/**
 * One polite GET returning the body as text, from the one identified client.
 * Retries 429 and 5xx a small number of times, honouring `Retry-After`;
 * everything else fails immediately. A 401, 403 or 407, and a challenge page,
 * is an access control: thrown at once and never re-sent under another
 * identity (see the module header).
 */
export async function politeGetText(
  url: string,
  options: HttpOptions = {},
): Promise<{ status: number; contentType: string; text: string }> {
  const impl = options.fetchImpl ?? fetch;
  const headers = sourceRequestHeaders(options.accept);
  let lastStatus = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await impl(url, {
      headers,
      signal: options.signal,
    });
    lastStatus = response.status;

    if (response.ok) {
      const text = await response.text();
      options.signal?.throwIfAborted();
      // One finalizer: a challenge page or a body that is not a document is a WALL, never a read.
      return readValidatedResponse(
        url,
        2,
        { status: response.status, contentType: response.headers.get("content-type") ?? "", text },
        options.expect,
      );
    }

    if (ACCESS_CONTROL_STATUS.has(response.status)) {
      throw new SourceHttpError(
        `HTTP ${response.status} for ${url} — an access control refused the identified client. It is a technical ` +
          "failure of this route, recorded as a wall and never bypassed: no other identity, header set or client is tried.",
        response.status,
        url,
        2,
      );
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_RETRIES) {
      throw new SourceHttpError(`HTTP ${response.status} for ${url}`, response.status, url, 2);
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    const waitMs =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : REQUEST_SPACING_MS * 2 ** attempt;
    await sourceAcquisitionSleep(waitMs, options.signal);
  }

  throw new SourceHttpError(`HTTP ${lastStatus} for ${url}`, lastStatus, url, 2);
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
 * One polite GET returning BYTES — a PDF, an image, a spreadsheet.
 * (2026-08-27, the coverage-truth session.)
 *
 * **Why this is here and not private to `pnpm pdf:read`.** Every other
 * retrieval in this repository is identified and spaced by this module, and a
 * binary fetched by a script's own `fetch` call is a second client with its
 * own failure modes and its own idea of who we are.
 *
 * One identified request, like `politeGetText` (since 2026-09-25 there is no
 * browser-header second attempt). A refusal is a WALL on rung 2 — the error
 * says so — and a zero-byte 200 is a failed retrieval, never an empty document.
 */
export async function politeGetBytes(
  url: string,
  options: HttpOptions = {},
): Promise<{ status: number; contentType: string; bytes: Uint8Array; rung: number }> {
  const impl = options.fetchImpl ?? fetch;
  const response = await impl(url, { headers: sourceRequestHeaders(options.accept), signal: options.signal });
  if (!response.ok) {
    throw new SourceHttpError(
      `HTTP ${response.status} for ${url}. This is a WALL on rung 2, not an absent document` +
        (ACCESS_CONTROL_STATUS.has(response.status) ? " — an access control, never bypassed." : "."),
      response.status,
      url,
      2,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  options.signal?.throwIfAborted();
  /*
   * A ZERO-BYTE 200 IS A FAILED RETRIEVAL, NOT AN EMPTY DOCUMENT.
   * The same rule `readValidatedResponse` applies to text, and the same
   * reason: an operation that can return nothing must be asked what it
   * returned, and a caller handed an empty buffer will report that the
   * document says nothing.
   */
  if (bytes.length === 0) {
    throw new SourceHttpError(
      `${url} answered HTTP ${response.status} with ZERO bytes. That is a failed ` +
        "retrieval, never an empty document.",
      response.status,
      url,
      2,
    );
  }
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    bytes,
    rung: 2,
  };
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
