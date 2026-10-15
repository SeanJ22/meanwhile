import { fetchSource } from "./fetch-source.ts";
import { readCompleteResponse } from "./source-bytes.ts";
import { recordAcquiredResponse } from "./acquisition-trace.ts";
import { challengeIn } from "./challenge-signatures.ts";

export const REQUEST_SPACING_MS = 400;

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
  form?: Readonly<Record<string, string>>;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
  accept?: string;
  signal?: AbortSignal;
  expect?: { label: string; marker: string };
}

export function notADocument(text: string, expect?: HttpOptions["expect"]): string | null {
  if (text.trim() === "") return "an empty body";
  return expect && !text.includes(expect.marker) ? `${expect.label} carrying no ${expect.marker}` : null;
}

export function sourceRequestHeaders(accept?: string): Record<string, string> {
  return { "User-Agent": sourceUserAgent(), Accept: accept ?? "*/*", "Accept-Language": "en-US,en;q=0.9" };
}

export { challengeIn } from "./challenge-signatures.ts";

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

export async function politeGetText(
  url: string,
  options: HttpOptions = {},
): Promise<{ status: number; contentType: string; text: string }> {
  const response = await (options.fetchImpl ?? fetchSource)(url, {
    headers: { ...sourceRequestHeaders(options.accept), ...(options.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    signal: options.signal,
    ...(options.form ? { method: "POST", body: new URLSearchParams(options.form).toString() } : {}),
  });
  if (!response.ok) {
    throw new SourceHttpError(`HTTP ${response.status} for ${url}` +
      ([401, 403, 407].includes(response.status) ? " — an access control: a WALL, never bypassed." : ""), response.status, url);
  }
  const text = await response.text();
  options.signal?.throwIfAborted();
  return readValidatedResponse(url, 2, {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    text,
  }, options.expect);
}

export async function politeGetJson<T>(url: string, options: HttpOptions = {}): Promise<T> {
  const { text } = await politeGetText(url, { ...options, accept: options.accept ?? "application/json" });
  return JSON.parse(text) as T;
}

export async function politeGetBytes(
  url: string,
  options: HttpOptions = {},
): Promise<{ status: number; contentType: string; bytes: Uint8Array; rung: number }> {
  const response = await (options.fetchImpl ?? fetchSource)(url, { headers: sourceRequestHeaders(options.accept), signal: options.signal });
  if (!response.ok) throw new SourceHttpError(`HTTP ${response.status} for ${url}. This is a WALL, not an absent document.`, response.status, url);
  const bytes = await readCompleteResponse(response, options.maxBytes ?? 32 * 1024 * 1024);
  options.signal?.throwIfAborted();
  if (bytes.length === 0) throw new SourceHttpError(`${url} answered HTTP ${response.status} with ZERO bytes. That is a failed retrieval, never an empty document.`, response.status, url);
  return { status: response.status, contentType: response.headers.get("content-type") ?? "", bytes, rung: 2 };
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, digits: string) => {
      const code = digits[0].toLowerCase() === "x" ? parseInt(digits.slice(1), 16) : parseInt(digits, 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
    })
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
