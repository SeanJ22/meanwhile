/**
 * The retrieval discipline, shared by every adapter that speaks HTTP: identify yourself, go at a human
 * pace, honour `Retry-After`, and serialize requests to shared vendor servers.
 *
 * Every request carries the project's identified User-Agent. A named refusal leaves that website alone
 * and keeps its coverage blank open. A challenge is never answered or scripted past.
 */

import { readCompleteResponse } from "./source-bytes.ts";
import { createHash } from "node:crypto";
import { decodeHTMLStrict } from "entities";
import { recordAcquiredResponse } from "./acquisition-trace.ts";
import { challengeIn } from "./challenge-signatures.ts";
import type { HostStateStore } from "./host-state.ts";
import { currentSourceVendor, withSourceVendor } from "./host-context.ts";
import { nativeSourceFetch, sourceTransportRoot } from "./host-transport.ts";
import { rawCaptureVault } from "../civic-data/raw-capture-remote.ts";
import { vaultSourceResponse } from "./raw-response.ts";
import {
  sourceAcquisitionSecondsRemaining,
  sourceAcquisitionSleep,
} from "./acquisition-deadline.ts";

const REQUEST_SPACING_MS = 400;
const MAX_RETRIES = 2;

/** A publisher's capacity is shared by its tenants, including CivicPlus custom government domains. */
export function sourceHost(url: string, vendor?: string): string {
  const target = new URL(url), host = target.hostname.toLowerCase().replace(/^www\./, "");
  const providers = ["civicplus", "legistar", "civicclerk", "granicus", "boarddocs", "primegov", "escribemeetings", "diligent", "iqm2", "municode", "swagit"];
  if (vendor === "legistar-insite") return "legistar";
  if (vendor && providers.includes(vendor)) return vendor;
  const provider = providers.find(name => host.split(".").some(part => part === name));
  if (provider) return provider;
  if (/(?:^|\.)legistar\d+\.com$/.test(host)) return "legistar";
  if (/\/(?:AgendaCenter|common\/modules\/iCalendar)(?:\/|$)/i.test(target.pathname)) return "civicplus";
  return host;
}

export class SourceReadDeferred extends Error {
  readonly until: number;
  readonly url: string;
  readonly reason: "THROTTLED" | "REFUSED" | "RESOURCE_REFUSED" | "EMPTY";
  readonly attempted: boolean;
  constructor(url: string, until: number, reason: "THROTTLED" | "REFUSED" | "RESOURCE_REFUSED" | "EMPTY", attempted = false) {
    const visible = new URL(url);
    visible.username = ""; visible.password = "";
    for (const key of [...visible.searchParams.keys()]) if (/key|token|secret|password|address/i.test(key)) visible.searchParams.set(key, "redacted");
    super(`SOURCE_READ_DEFERRED:${new Date(until).toISOString()}:${reason}:${visible.href}`);
    this.name = "SourceReadDeferred"; this.url = visible.href; this.until = until; this.reason = reason; this.attempted = attempted;
  }
}

export function sourceReadDeferred(error: unknown): boolean {
  return error instanceof SourceReadDeferred || /SOURCE_READ_DEFERRED:/.test(error instanceof Error ? error.message : String(error));
}

export interface SourceRequestInit extends RequestInit {
  /** A publisher's documented quota, applied by the same shared host clock. Never sent as an HTTP field. */
  minimumSpacingMs?: number;
}

export interface SourceHostPacer {
  fetch(url: string | URL, init?: SourceRequestInit, fetchImpl?: typeof fetch, vendor?: string): Promise<Response>;
  defer(url: string, until: number, vendor?: string): Promise<void>;
}

/** RB-A9 and every HTTP reader can call this same transport with their own clock and shared state. */
export function createSourceHostPacer(options: {
  store: HostStateStore; clock?: () => number; sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; spacingMs?: number;
}): SourceHostPacer {
  const clock = options.clock ?? Date.now, sleep = options.sleep ?? sourceAcquisitionSleep;
  return { async defer(url, until, vendor) {
    await options.store.withHost(sourceHost(url, vendor), undefined, async state => { state.routes[url] = Math.max(state.routes[url] ?? 0, until); });
  }, async fetch(target, init, fetchImpl = globalThis.fetch, vendor) {
    const url = String(target), address = new URL(url), host = sourceHost(url, vendor), origin = address.origin;
    const { minimumSpacingMs = 0, ...request } = init ?? {};
    const base = options.spacingMs ?? Math.max(["civicplus", "legistar"].includes(host) ? 2_000 : REQUEST_SPACING_MS,
      Number.isFinite(minimumSpacingMs) ? minimumSpacingMs : 0);
    return options.store.withHost(host, init?.signal ?? undefined, async state => {
      init?.signal?.throwIfAborted();
      for (const [route, until] of Object.entries(state.routes)) if (until <= clock()) delete state.routes[route];
      const nativeResource = address.hostname === "webapi.legistar.com" || address.pathname === "/robots.txt" || /\/day\/\d{8}\/?$/.test(address.pathname);
      const document = /\.(?:pdf|docx?|xlsx?|pptx?|csv|ics|jpe?g|png|gif|webp|svg)$/i.test(address.pathname)
        || /\/(?:View\.ashx|FileStream\.ashx|MeetingDetail\.aspx)$|\/ImageRepository\/Document\b|\/AgendaCenter\/ViewFile\/(?:Agenda|Minutes)\b/i.test(address.pathname);
      const refusalKey = nativeResource ? `${origin}${address.pathname}`
        : document ? `${origin}#resource:${createHash("sha256").update(url).digest("hex")}` : origin;
      if (state.refused[origin]) throw new SourceReadDeferred(url, Date.parse("9999-12-31T00:00:00Z"), "REFUSED");
      if (refusalKey !== origin && state.refused[refusalKey]) {
        const until = Date.parse(state.refused[refusalKey]);
        if (until > clock()) throw new SourceReadDeferred(url, until, "RESOURCE_REFUSED");
        delete state.refused[refusalKey];
      }
      if (state.until > clock()) throw new SourceReadDeferred(url, state.until, "THROTTLED");
      if (state.routes[url] > clock()) throw new SourceReadDeferred(url, state.routes[url], "EMPTY");
      state.intervalMs = state.intervalMs > (state.baseMs ?? base) ? Math.max(base, state.intervalMs) : base;
      state.baseMs = base;
      if (state.lastAt !== undefined) state.nextAt = Math.max(state.until, state.lastAt + state.intervalMs);
      const wait = state.nextAt - clock();
      if (wait > 0) await sleep(wait, init?.signal ?? undefined);
      init?.signal?.throwIfAborted();
      const headers = new Headers(init?.headers);
      if (!headers.has("user-agent")) headers.set("user-agent", sourceUserAgent());
      // Keep the caller's header shape for transports that inspect their options.
      const response = await withSourceVendor(vendor ?? currentSourceVendor(), () => fetchImpl(typeof target === "string" ? target : address, { ...request, headers: init?.headers && new Headers(init.headers).has("user-agent") ? init.headers : Object.fromEntries(headers) }))
        .catch(error => {
          state.lastAt = clock(); state.nextAt = state.lastAt + state.intervalMs;
          throw error;
        });
      const now = clock();
      state.lastAt = now;
      state.intervalMs = Math.max(base, state.intervalMs);
      state.nextAt = now + state.intervalMs;
      const retry = response.headers.get("retry-after")?.trim();
      const requested = retry && /^\d+(?:\.\d+)?$/.test(retry) ? now + Number(retry) * 1000 : retry ? Date.parse(retry) : 0;
      const retryAt = Number.isFinite(requested) ? requested : 0;
      if (response.status === 429 || response.status >= 500 && response.headers.get("retry-after")) {
        state.intervalMs = Math.min(60_000, Math.max(base, state.intervalMs) * 2);
        state.healthy = 0;
        state.until = Math.max(now + 60_000, retryAt);
        state.nextAt = Math.max(state.nextAt, state.until);
        await response.body?.cancel().catch(() => {});
        throw new SourceReadDeferred(url, state.until, "THROTTLED", true);
      }
      const challenged = address.pathname !== "/robots.txt" && response.headers.get("cf-mitigated") === "challenge";
      if (response.status === 403 && (challenged || !keyedApiRequest(address, init?.headers))) {
        // A document can become public later. A named site wall stays open for separate work.
        const siteWall = refusalKey === origin || challenged;
        state.refused[siteWall ? origin : refusalKey] = new Date(siteWall ? now : Math.max(now + 3_600_000, retryAt)).toISOString();
      }
      if (response.ok || response.status === 304) {
        if (++state.healthy >= 32) { state.intervalMs = Math.max(base, state.intervalMs / 2); state.healthy = 0; }
      }
      return response;
    });
  } };
}

/**
 * A keyed publisher API (LegiScan, Congress, Google Civic) answers a 403 for that key and record, not as a
 * website refusing our identified reader. Its caller records the failure and asks again on its own schedule,
 * so one refused dataset never holds every other record, or the whole API, behind a permanent site wall.
 */
function keyedApiRequest(address: URL, headers: HeadersInit | undefined): boolean {
  const sent = new Headers(headers);
  return sent.has("authorization") || sent.has("x-api-key") ||
    [...address.searchParams.keys()].some(name => /^(?:key|api_?key|access_?key|access_?token|token)$/i.test(name));
}

let sharedPacer: Promise<SourceHostPacer> | undefined;
const injectedPacers = new WeakMap<typeof fetch, Promise<SourceHostPacer>>();

/** The only source fetch: production children share host state; an injected transport owns isolated test state. */
export async function sourceFetch(url: string | URL, init?: SourceRequestInit, fetchImpl?: typeof fetch, vendor?: string, sharedTransport = false): Promise<Response> {
  const transport = fetchImpl ?? globalThis.fetch;
  const root = sourceTransportRoot(transport);
  const injected = root !== nativeSourceFetch && !sharedTransport;
  let pacer = injected ? injectedPacers.get(root) : sharedPacer;
  if (!pacer) {
    pacer = import("./host-state.ts").then(({ fileHostState, memoryHostState }) => createSourceHostPacer({
      store: injected ? memoryHostState() : fileHostState(), ...(injected ? { spacingMs: 0 } : {}),
    }));
    if (injected) injectedPacers.set(root, pacer); else sharedPacer = pacer;
  }
  const response = await (await pacer).fetch(url, init, transport, vendor ?? currentSourceVendor());
  return injected ? response : vaultSourceResponse(response, rawCaptureVault(), vendor ?? new URL(url).hostname);
}

export async function deferSourceRead(url: string, until: number): Promise<void> {
  if (until <= Date.now()) return;
  sharedPacer ??= import("./host-state.ts").then(({ fileHostState }) => createSourceHostPacer({ store: fileHostState() }));
  await (await sharedPacer).defer(url, until);
}

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
  const args = ["-s", "-S", "-L", "--include", "--suppress-connect-headers", "--compressed", "-w", "\n%{http_code}\t%{content_type}\t%{url_effective}"];
  if (form) args.push("--data", new URLSearchParams(form).toString());
  const remainingSeconds = sourceAcquisitionSecondsRemaining(signal);
  if (remainingSeconds !== null) args.push("--max-time", String(remainingSeconds));
  for (const [key, value] of Object.entries(headers)) {
    args.push("-H", `${key}: ${value}`);
  }
  args.push(url);

  const response = await sourceFetch(url, { signal, headers }, async () => {
    const stdout = await runProcess(args, { maxBuffer: 32 * 1024 * 1024, signal });
    const cut = stdout.lastIndexOf(0x0a);
    if (cut < 0) throw new SourceHttpError(`curl returned no response trailer for ${url}`, 0, url, 4);
    const [code, contentType = "", finalUrl = url] = stdout.subarray(cut + 1).toString("utf8").split("\t");
    const status = Number(code);
    if (!Number.isInteger(status) || status < 200 || status > 599) throw new SourceHttpError(`curl returned no status for ${url}`, 0, url, 4);
    let start = 0;
    const received = new Headers({ "content-type": contentType });
    while (stdout.subarray(start, start + 5).toString() === "HTTP/") {
      const end = stdout.indexOf("\r\n\r\n", start);
      if (end < 0 || end >= cut) break;
      for (const line of stdout.subarray(start, end).toString().split("\r\n").slice(1)) {
        const colon = line.indexOf(":");
        if (colon > 0) received.set(line.slice(0, colon), line.slice(colon + 1).trim());
      }
      start = end + 4;
    }
    const reply = new Response([204, 304].includes(status) ? null : new Uint8Array(stdout.subarray(start, cut)), { status, headers: received });
    Object.defineProperty(reply, "url", { value: finalUrl });
    return reply;
  }, currentSourceVendor(), runProcess === nativeCurlProcess);
  signal?.throwIfAborted();

  if (!response.ok) throw new SourceHttpError(`HTTP ${response.status} for ${url}`, response.status, url, 4);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { status: response.status, contentType: response.headers.get("content-type") ?? "", text: new TextDecoder().decode(bytes), bytes, finalUrl: response.url || url };
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
 * One polite GET returning the body as text. Defers 429; retries 5xx a small
 * number of times, honouring `Retry-After`; everything else fails immediately.
 * A challenge page may use the same identified curl transport; a 401, 403 or 407 is never re-asked.
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
    const response = await sourceFetch(url, {
      headers: options.form ? { ...headers, "Content-Type": "application/x-www-form-urlencoded" } : headers,
      signal: options.signal,
      ...(options.form ? { method: "POST", body: new URLSearchParams(options.form).toString() } : {}),
    }, impl);
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
      throw new SourceHttpError(
        `HTTP 403 for ${url} — an access control refused the identified client. A WALL, never bypassed with ` +
          "another identity.",
        403,
        url,
        2,
      );
    }

    const retryable = response.status >= 500;
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
  const response = await sourceFetch(url, { headers: sourceRequestHeaders(options.accept), signal: options.signal }, impl);
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
