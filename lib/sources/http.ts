/**
 * The retrieval discipline, shared by every adapter that speaks HTTP: identify yourself, go at a human
 * pace, honour `Retry-After`, and never parallelize against a single tenant.
 *
 * Honest identity, never a disguise. Reading public pages whatever robots.txt says is allowed; bypassing
 * authentication or other access controls is not. Every request carries the project's own identified
 * `User-Agent` (`sourceUserAgent()`), and when a filter refuses Node's own client (a 403, or a challenge
 * page at 200) the same identity is asked once more through `curl`, a different HTTP client, with its
 * purpose and contact in the fields built for them (`identificationHeaders`). The client is never
 * dressed as a browser. No challenge or CAPTCHA is ever answered or scripted past: a challenge from the
 * `curl` request is a WALL naming rung 4, and a 401 or 407 is never re-asked.
 * `tests/robots-recorded-not-blocking.test.ts` holds this.
 */

import { readCompleteResponse } from "./source-bytes.ts";
import { decodeHTMLStrict } from "entities";
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
   * The ladder rung this retrieval stopped at: `2` the plain identified fetch (Node's client), `4` the same
   * identity through `curl`. A stored rung 3 (a retired browser-header rung) still reads. Not a terminal
   * state: a wall is one route closed, never a fact about the record.
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
  /** Public lookup APIs such as BoardDocs use form POSTs to read records. */
  form?: Readonly<Record<string, string>>;
  /** Complete response bytes allowed for a binary source. */
  maxBytes?: number;
  /** Overridden in tests so the suite never sleeps or touches the network. */
  fetchImpl?: typeof fetch;
  accept?: string;
  signal?: AbortSignal;
  /**
   * What a real document from this URL must contain. A 200 that is a blank body, a truncated transfer or
   * an unknown error page is a retrieval failure wearing a successful status: a WALL, recorded on its rung
   * and carried forward as a refusal, never handed upward as an empty calendar.
   * - Blank is universal: a whitespace-only 200 is never a document, for any caller.
   * - `expect` is the caller's own format marker (e.g. `BEGIN:VCALENDAR` for an `.ics` feed).
   */
  expect?: {
    /** What the format is called, so the wall names it in the reader's terms. */
    label: string;
    /** A marker every genuine document of this format carries. */
    marker: string;
  };
  /**
   * The escalation seam, declared rather than inferred. A caller that injects both a `fetchImpl` and a
   * `ladder` drives the escalation with its own doubles; a caller injecting only `fetchImpl` gets no
   * escalation; production injects neither and walks the real rungs.
   */
  ladder?: {
    /** Rung 4: the same identity through a different client (`curl`). */
    curl?: (
      url: string,
      headers: Record<string, string>,
      signal?: AbortSignal,
      form?: Readonly<Record<string, string>>,
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
 * Is this 200 a document at all? Returns the reason it is not, or `null`. Separate from `politeGetText`
 * so `tests/http-empty-success.test.ts` can hold it against real bytes.
 */
export function notADocument(text: string, expect?: HttpOptions["expect"]): string | null {
  if (text.trim() === "") return "an empty body";
  if (expect && !text.includes(expect.marker)) {
    return `${expect.label} carrying no ${expect.marker}`;
  }
  return null;
}

/**
 * Identify this project in the headers RFC 9110 provides for it: `From` (the requesting agent's email)
 * and `X-Purpose`. Some WAFs refuse the project suffix in the `User-Agent`, while others allowlist it,
 * so these travel beside the identified `User-Agent`, never instead of it.
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
 * Rung 4: the same identity through a different client. Some filters key on the TLS/HTTP2 client
 * fingerprint rather than the headers, so when the in-process request is refused, the same request is
 * re-issued through the system `curl`. One serialized request, our own name in the `User-Agent`, no
 * retry storm, no challenge answered. `child_process` is imported dynamically so this module stays safe
 * to reach from a client chunk.
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
  form?: Readonly<Record<string, string>>,
): Promise<{
  status: number;
  contentType: string;
  text: string;
  bytes: Uint8Array;
  finalUrl: string;
}> {
  const args = ["-s", "-S", "-L", "--compressed", "-w", "\n%{http_code}\t%{content_type}\t%{url_effective}"];
  if (form) args.push("--data", new URLSearchParams(form).toString());
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
 * A bot-detection interstitial served with HTTP 200 is recognised by `challengeIn`
 * (`./challenge-signatures.ts`). It is recorded as a WALL instead of a document, and never answered,
 * solved or scripted past.
 */
export { challengeIn } from "./challenge-signatures.ts";

/**
 * The one finalizer every transport rung passes through: there is exactly one place a body becomes a
 * return value, so document validity never depends on which rung succeeded.
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
  form?: Readonly<Record<string, string>>,
): Promise<{ status: number; contentType: string; text: string }> {
  let response: Awaited<ReturnType<typeof curl>>;
  try {
    response = await curl(url, curlRequestHeaders(accept), signal, form);
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
  // Whether rung 4 is walked, decided once: true in production (nothing injected) and for a test that
  // supplies the `curl` double.
  const escalates = !options.fetchImpl || options.ladder !== undefined;
  const curl = options.ladder?.curl ?? ((url, headers, signal, form) => curlGetText(url, headers, signal, nativeCurlProcess, form));
  const headers = sourceRequestHeaders(options.accept);
  let lastStatus = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await impl(url, {
      headers: options.form ? { ...headers, "Content-Type": "application/x-www-form-urlencoded" } : headers,
      signal: options.signal,
      ...(options.form ? { method: "POST", body: new URLSearchParams(options.form).toString() } : {}),
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
        return await curlRung(url, curl, options.accept, options.signal, options.expect, options.form);
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
      if (escalates) return await curlRung(url, curl, options.accept, options.signal, options.expect, options.form);
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
 * One polite GET returning bytes (a PDF, an image, a spreadsheet), with the same identification and
 * spacing as every other retrieval. One identified request; a refusal is a WALL on rung 2, and a
 * zero-byte 200 is a failed retrieval.
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
  const bytes = await readCompleteResponse(response, options.maxBytes ?? 32 * 1024 * 1024);
  options.signal?.throwIfAborted();
  // A zero-byte 200 is a failed retrieval, not an empty document.
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
 * Decode the handful of HTML entities that occur in these feeds. Numeric references cover both decimal
 * and hex forms.
 */
export function decodeEntities(value: string): string {
  return value.replace(/&(?:#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/gi, entity => {
    const numeric = /^&#(x[0-9a-f]+|\d+);$/i.exec(entity);
    if (numeric) {
      const digits = numeric[1];
      const code = digits[0].toLowerCase() === "x" ? parseInt(digits.slice(1), 16) : parseInt(digits, 10);
      if (!(code > 0 && code <= 0x10ffff) || code >= 0xd800 && code <= 0xdfff) return entity;
    }
    return decodeHTMLStrict(entity).replace(/\u00a0/g, " ");
  });
}

export { REQUEST_SPACING_MS };
