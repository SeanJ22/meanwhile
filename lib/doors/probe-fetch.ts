/**
 * The plain fetch door looks and free method tries use: the identified
 * User-Agent, a human pace per website, a timeout, and at most a megabyte
 * read. Every request first asks the one per-website count every reader
 * shares: a website some reader was asked to leave alone waits, and a small
 * publisher takes from its shared hourly allowance. A 429 or 5xx holds the
 * website for every reader.
 */

import { websiteRequestLimit, type WebsiteSizeForUrl } from "../control-plane/scheduler/host-supervision.ts";
import { admitWebsiteRequest, holdWebsiteAfter, type WebsitePacing } from "../control-plane/website-pacing.ts";
import { sourceFetch, sourceUserAgent, SourceReadDeferred } from "../sources/http.ts";
import type { ProbeFetch } from "./probe.ts";

export const PROBE_TIMEOUT_MS = 15_000;
const MAX_BYTES = 1_048_576;

/** The website cannot be asked now: it asked every reader to wait, or a small publisher's hour is used. Not a failed request. */
export class WebsiteWait extends Error {
  readonly until: number;
  readonly why: "ASKED_TO_WAIT" | "HOURLY_ALLOWANCE" | "NAMED_REFUSAL";
  readonly requests: number;
  constructor(until: number, why: "ASKED_TO_WAIT" | "HOURLY_ALLOWANCE" | "NAMED_REFUSAL", requests = 0) {
    super(why === "NAMED_REFUSAL" ? "the website refuses our identified reader; its coverage stays open for later work"
      : why === "ASKED_TO_WAIT" ? `the website asked to be left alone until ${new Date(until).toISOString()}`
      : `a small publisher's hourly allowance is used until ${new Date(until).toISOString()}`);
    this.name = "WebsiteWait";
    this.until = until;
    this.why = why;
    this.requests = requests;
  }
}

export function pacedProbeFetch(input: {
  readonly pacing: WebsitePacing;
  readonly sizeFor?: WebsiteSizeForUrl;
  readonly clock?: () => number;
  readonly fetchImpl?: typeof fetch;
}): ProbeFetch {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const clock = input.clock ?? Date.now;
  return async (url, headers) => {
    const admitted = await admitWebsiteRequest(input.pacing, url, websiteRequestLimit(input.sizeFor?.(url)), clock());
    if (!admitted.ok) throw new WebsiteWait(admitted.until, admitted.why);
    const response = await sourceFetch(url, {
      method: "GET",
      headers: { "User-Agent": sourceUserAgent(), Accept: "*/*", ...headers },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      redirect: "follow",
    }, fetchImpl).catch(error => {
      if (error instanceof SourceReadDeferred) throw new WebsiteWait(error.until,
        error.reason === "REFUSED" ? "NAMED_REFUSAL" : "ASKED_TO_WAIT", error.attempted ? 1 : 0);
      throw error;
    });
    await holdWebsiteAfter(input.pacing, url, response.status, response.headers.get("retry-after"), clock());
    return {
      status: response.status,
      finalUrl:response.url||url,
      headers: response.headers,
      bytes: async () => new Uint8Array((await response.arrayBuffer()).slice(0, MAX_BYTES)),
    };
  };
}
