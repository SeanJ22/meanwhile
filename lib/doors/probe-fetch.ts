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
import { sourceUserAgent } from "../sources/http.ts";
import type { ProbeFetch } from "./probe.ts";

export const PROBE_HOST_SPACING_MS = 400;
export const PROBE_TIMEOUT_MS = 15_000;
const MAX_BYTES = 1_048_576;

/** The website cannot be asked now: it asked every reader to wait, or a small publisher's hour is used. Not a failed request. */
export class WebsiteWait extends Error {
  readonly until: number;
  readonly why: "ASKED_TO_WAIT" | "HOURLY_ALLOWANCE";
  constructor(until: number, why: "ASKED_TO_WAIT" | "HOURLY_ALLOWANCE") {
    super(why === "ASKED_TO_WAIT" ? `the website asked to be left alone until ${new Date(until).toISOString()}`
      : `a small publisher's hourly allowance is used until ${new Date(until).toISOString()}`);
    this.name = "WebsiteWait";
    this.until = until;
    this.why = why;
  }
}

export function pacedProbeFetch(input: {
  readonly pacing: WebsitePacing;
  readonly sizeFor?: WebsiteSizeForUrl;
  readonly clock?: () => number;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}): ProbeFetch {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const clock = input.clock ?? Date.now;
  const lastByHost = new Map<string, Promise<void>>();
  return async (url, headers) => {
    const host = new URL(url).hostname.toLowerCase();
    // One request at a time per host, spaced: each waits for the one before it and then for the spacing.
    const before = lastByHost.get(host) ?? Promise.resolve();
    const turn = before.then(() => sleep(PROBE_HOST_SPACING_MS));
    lastByHost.set(host, turn);
    await before;
    const admitted = await admitWebsiteRequest(input.pacing, url, websiteRequestLimit(input.sizeFor?.(url)), clock());
    if (!admitted.ok) throw new WebsiteWait(admitted.until, admitted.why);
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { "User-Agent": sourceUserAgent(), Accept: "*/*", ...headers },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      redirect: "follow",
    });
    await holdWebsiteAfter(input.pacing, url, response.status, response.headers.get("retry-after"), clock());
    return {
      status: response.status,
      headers: response.headers,
      bytes: async () => new Uint8Array((await response.arrayBuffer()).slice(0, MAX_BYTES)),
    };
  };
}
