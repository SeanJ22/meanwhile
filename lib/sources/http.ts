/**
 * The retrieval discipline, shared by every adapter that speaks HTTP.
 *
 * Same manners as `lib/sources/legistar/client.ts`, factored out for the
 * adapters that arrived with the composite: identify yourself, go at a human
 * pace, honour `Retry-After`, and never parallelize against a single tenant.
 * Engineering manners, not hedging — see `CLAUDE.md` on public records.
 *
 * **HONEST IDENTITY, NEVER A DISGUISE.** (2026-09-25.)
 *
 * Sean's decision of 2026-09-25 authorizes reading public pages whatever
 * robots.txt says and "does not extend to bypassing authentication or other
 * access controls". The line this module draws from it: saying who we are is
 * always allowed, pretending to be someone else is not. So every request here
 * carries the project's own identified `User-Agent` (`sourceUserAgent()`), and
 * when a filter refuses Node's own client (a 403, or a challenge page at 200)
 * the SAME identity is asked once more through `curl`, a different HTTP client,
 * with its purpose and contact in the fields built for them
 * (`identificationHeaders`). Measured 2026-09-25 on the Cloudflare-fronted
 * Sutton, Newbury and Kearsarge hosts: Node's client is challenged whatever it
 * sends, and the honestly identified `curl` request is admitted 30 of 30.
 *
 * What was removed that day, because each one misrepresented who we are to get
 * past a filter: the browser profile (a Chrome `User-Agent` and browser
 * navigation headers, asked for first by four wiring rows), rung 3 (the same
 * browser header set after a 403), rung 3b (a plain Chrome `User-Agent` with
 * the project's name taken out), and the browser header sets on the `curl`
 * rung. No challenge or CAPTCHA is ever answered or scripted past: a challenge
 * from the `curl` request is a WALL naming rung 4, and a 401 or 407 is never
 * re-asked at all. `tests/robots-recorded-not-blocking.test.ts` holds this.
 */

import { recordAcquiredResponse } from "./acquisition-trace.ts";
import { challengeIn } from "./challenge-signatures.ts";
import {
  sourceAcquisitionSecondsRemaining,
  sourceAcquisitionSleep,
} from "./acquisition-deadline.ts";

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
   * in `CLAUDE.md` and `docs/source-ladder.md`: `2` the plain identified fetch
   * (Node's client), `4` the same identity through a different client (`curl`).
   * Rung 3 (the browser header set) was retired on 2026-09-25 because it
   * disguised the client; a stored rung 3 from before still reads.
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
  /**
   * **THE ESCALATION LADDER, MADE REACHABLE BY A TEST** — A-003 (external
   * correctness audit of `336a3eb`, remediated 2026-08-24).
   *
   * The 403 escalation below is guarded by `!options.fetchImpl`, for a reason
   * that is entirely correct: a test's fake fetch is the thing under test and
   * must not be routed around. What that guard also did was make the whole
   * production retry path **unreachable by injection**, so the branch where
   * A-003 lived — a rung returning a body with no document check on it — could
   * not be exercised by any test in this repo.
   *
   * That is the chromium-pin shape (RULING 113): a step whose product nothing
   * observes. The pin was wrong on every platform for months because the only
   * thing that could have caught it was a check nobody had written; this was
   * wrong on one rung because the only thing that could have caught it was a
   * test nobody could write.
   *
   * So the seam is DECLARED rather than inferred. A caller that injects both a
   * `fetchImpl` and a `ladder` is deliberately driving the escalation with its
   * own doubles; a caller that injects only a `fetchImpl` still gets the old
   * behaviour, unchanged, and production — which injects neither — walks the
   * real rungs.
   */
  ladder?: {
    /** Rung 4: the same identity through a different client (`curl`). */
    curl?: (
      url: string,
      headers: Record<string, string>,
      signal?: AbortSignal,
    ) => Promise<{
      status: number;
      contentType: string;
      text: string;
      /** Exact entity bytes and redirect destination, when the transport exposes them. */
      bytes?: Uint8Array;
      finalUrl?: string;
    }>;
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
 * Identify this project in the headers RFC 9110 provides for it.
 *
 * ## The measurement that made this necessary (2026-08-26)
 *
 * Every rung of this ladder appends `we-the-people civic meeting index (…)` to
 * the `User-Agent`, deliberately, so an administrator reading a log has
 * somewhere to write. **The entire `*.nh.gov` family refuses that string.**
 * Isolated one variable at a time against three hosts, unanimously:
 *
 * ```
 * no headers at all                200
 * chrome UA only                   200
 * chrome UA + project suffix       403
 * project UA alone                 403
 * chrome UA + From: header         200
 * chrome UA + From + X-Purpose     200
 * full browser header set + From   200
 * ```
 *
 * Not the TLS fingerprint, which is what the note on `curlGetText` below
 * inferred from an earlier pair of hosts — `curl` carrying the same suffix is
 * refused too. **It is the substring, and nothing else.** Thirty-odd New
 * Hampshire state hosts, including `sos.nh.gov` and `revenue.nh.gov`, were
 * refusing this project specifically for saying who it was in the one field a
 * WAF pattern-matches hardest.
 *
 * `From` is the field HTTP defines for the requesting agent's email address,
 * and `X-Purpose` says what the request is for. Moving the identification
 * there is **more** honest than a suffix on a UA string, not less: it is
 * machine-readable, it is where an administrator's tooling would look for it,
 * and it says the same thing to the same person.
 *
 * **This does not replace the identified `User-Agent` and must not.** Some
 * hosts ALLOWLIST it — `states/nj/NOTES.md` records `morriscountyclerk.org`
 * and `states/az/NOTES.md` records `tucsonaz.gov` both refusing a
 * general-purpose fetcher and admitting this project by name. Dropping the
 * suffix globally would trade one family of hosts for another.
 *
 * **Since 2026-09-25 these headers travel BESIDE the identified `User-Agent`,
 * never instead of it.** The rung that paired them with a clean Chrome
 * `User-Agent` (rung 3b) left our name out of the one field the filter reads,
 * which is a disguise, and it is gone; a host that refuses our name is a wall
 * pursued by other public routes.
 */
export function identificationHeaders(): Record<string, string> {
  const contact = process.env.INGEST_CONTACT_EMAIL?.trim();
  return {
    ...(contact ? { From: contact } : {}),
    "X-Purpose": "we-the-people civic meeting index",
    "X-Contact": contact ?? "https://github.com/SeanJ22/we-the-people",
  };
}

/**
 * The headers of the first request: the project's own identified `User-Agent`
 * and an `Accept`. Exported so a script that must build its own request sends
 * the same honest client rather than a borrowed one.
 */
export function sourceRequestHeaders(accept?: string): Record<string, string> {
  return {
    "User-Agent": sourceUserAgent(),
    Accept: accept ?? "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };
}

/** The `curl` request's headers: the same identity, with purpose and contact in the fields built for them. */
export function curlRequestHeaders(accept?: string): Record<string, string> {
  return { "User-Agent": sourceUserAgent(), Accept: accept ?? "*/*", ...identificationHeaders() };
}

/**
 * Rung 4: the same identity through a different client. It began as the
 * second half of the (retired) browser rung, and the reason it needed
 * measuring rather than assuming: **the headers are not what these hosts read.**
 *
 * Node's `fetch` (undici) sending the exact browser headers above still gets
 * 403 from both hosts; `curl` sending the identical headers gets 200. The
 * filter is keying on the TLS/HTTP2 client fingerprint, not on the
 * `User-Agent` — which means "send a Chrome UA" was never the rung, and a
 * session that had only tried the header swap would have recorded a wall that
 * is not there. So when the in-process request is refused, the same request is
 * re-issued through the system `curl`, a different TLS stack.
 *
 * Same manners either way: one serialized request, our own name in the
 * `User-Agent` (since 2026-09-25 never a browser's), no retry storm, and no
 * challenge answered. `child_process` is imported dynamically so this module
 * stays safe to reach from a client chunk.
 */
export type CurlProcessRunner = (
  args: readonly string[],
  options: { readonly signal?: AbortSignal; readonly maxBuffer: number },
) => Promise<Buffer>;

async function nativeCurlProcess(
  args: readonly string[],
  options: { readonly signal?: AbortSignal; readonly maxBuffer: number },
): Promise<Buffer> {
  const { execFile } = await import("node:child_process");
  return new Promise<Buffer>((resolve, reject) => {
    execFile(
      "curl",
      [...args],
      {
        maxBuffer: options.maxBuffer,
        encoding: "buffer",
        signal: options.signal,
      },
      (error, out) => (error ? reject(error) : resolve(out as Buffer)),
    );
  });
}

export async function curlGetText(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
  runProcess: CurlProcessRunner = nativeCurlProcess,
): Promise<{
  status: number;
  contentType: string;
  text: string;
  bytes: Uint8Array;
  finalUrl: string;
}> {
  const args = ["-s", "-S", "-L", "--compressed", "-w", "\n%{http_code}\t%{content_type}\t%{url_effective}"];
  const remainingSeconds = sourceAcquisitionSecondsRemaining(signal);
  if (remainingSeconds !== null) args.push("--max-time", String(remainingSeconds));
  for (const [key, value] of Object.entries(headers)) {
    args.push("-H", `${key}: ${value}`);
  }
  args.push(url);

  const stdout = await runProcess(args, {
    maxBuffer: 32 * 1024 * 1024,
    signal,
  });
  signal?.throwIfAborted();

  const cut = stdout.lastIndexOf(0x0a);
  if (cut < 0) {
    throw new SourceHttpError(`curl returned no response trailer for ${url}`, 0, url, 4);
  }
  const [code, contentType = "", finalUrl = url] = stdout.subarray(cut + 1).toString("utf8").split("\t");
  const status = Number(code);
  if (!Number.isFinite(status)) {
    throw new SourceHttpError(`curl returned no status for ${url}`, 0, url, 4);
  }
  if (status < 200 || status >= 300) {
    throw new SourceHttpError(`HTTP ${status} for ${url}`, status, url);
  }
  const body = stdout.subarray(0, cut);
  return {
    status,
    contentType,
    text: body.toString("utf8"),
    bytes: new Uint8Array(body),
    finalUrl,
  };
}

/**
 * **A bot-detection interstitial served with HTTP 200** is recognised by
 * `challengeIn` (`./challenge-signatures.ts`, a pure leaf since 2026-09-25 so
 * the access-control rule in `lib/hunt/access-control.ts` can use it). A
 * challenge is an access control: it is recognised so a read is recorded as a
 * WALL instead of a document, and it is never answered, solved or scripted past.
 */
export { challengeIn } from "./challenge-signatures.ts";

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
 * one place a body becomes a return value, and it is this function. A rung
 * that wants to succeed has to come through here.
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
        "than the document. This is a WALL, not an empty page.",
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

/** The access-control statuses Node's client is never re-asked for: authentication, not a filter. */
const AUTHENTICATION_STATUS = new Set([401, 407]);

/**
 * Rung 4, once: the same identity through `curl`, through the one finalizer. A
 * 403 or a challenge page here is a WALL on rung 4 — the filter refused who we
 * are, and nothing else is tried.
 */
async function curlRung(
  url: string,
  curl: NonNullable<NonNullable<HttpOptions["ladder"]>["curl"]>,
  accept: string | undefined,
  signal: AbortSignal | undefined,
  expect: HttpOptions["expect"],
): Promise<{ status: number; contentType: string; text: string }> {
  let response: Awaited<ReturnType<typeof curl>>;
  try {
    response = await curl(url, curlRequestHeaders(accept), signal);
  } catch (error) {
    if (error instanceof SourceHttpError && error.status === 403) {
      throw new SourceHttpError(
        `HTTP 403 for ${url} — refused to our own name on rung 4 as on rung 2. An access control: a WALL, ` +
          "never bypassed with another identity.",
        403,
        url,
        4,
      );
    }
    throw error;
  }
  return readValidatedResponse(url, 4, response, expect);
}

/**
 * One polite GET returning the body as text. Retries 429 and 5xx a small
 * number of times, honouring `Retry-After`; everything else fails immediately.
 * A 403 or a challenge page from Node's client is asked once more with the same
 * identity through `curl` (rung 4); a 401 or 407 is never re-asked.
 */
export async function politeGetText(
  url: string,
  options: HttpOptions = {},
): Promise<{ status: number; contentType: string; text: string }> {
  const impl = options.fetchImpl ?? fetch;
  /*
   * A-003 · WHETHER RUNG 4 IS WALKED, DECIDED ONCE: true in production (nothing
   * injected) and for a test that deliberately supplies the `curl` double.
   */
  const escalates = !options.fetchImpl || options.ladder !== undefined;
  const curl = options.ladder?.curl ?? curlGetText;
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
      const here = {
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        text,
      };
      // A challenge served at 200 to Node's client: the same identity asks once through `curl`.
      if (challengeIn(text) !== null && escalates) {
        return await curlRung(url, curl, options.accept, options.signal, options.expect);
      }
      // A-003: one finalizer. A challenge that is not re-asked is a WALL here.
      return readValidatedResponse(url, 2, here, options.expect);
    }

    if (AUTHENTICATION_STATUS.has(response.status)) {
      throw new SourceHttpError(
        `HTTP ${response.status} for ${url} — authentication is required. An access control: a WALL, never ` +
          "bypassed; no credential is sent and nothing else is tried.",
        response.status,
        url,
        2,
      );
    }

    if (response.status === 403) {
      // The same identity, once, through another client. A refusal there is the wall.
      if (escalates) return await curlRung(url, curl, options.accept, options.signal, options.expect);
      throw new SourceHttpError(
        `HTTP 403 for ${url} — an access control refused the identified client. A WALL, never bypassed with ` +
          "another identity.",
        403,
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
 * One identified request (since 2026-09-25 there is no browser-header second
 * attempt; `curl` cannot carry bytes back intact through the text client). A
 * refusal is a WALL on rung 2 — the error says so — and a zero-byte 200 is a
 * failed retrieval, never an empty document.
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
        ([401, 403, 407].includes(response.status) ? " — an access control, never bypassed." : "."),
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
