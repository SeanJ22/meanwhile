/**
 * The fetch the hourly first look uses: the identified User-Agent, a human
 * pace per website, a timeout, and at most a megabyte read. A 429 or 503 is a
 * failed look.
 */

import { sourceUserAgent } from "../sources/http.ts";
import type { ProbeFetch } from "./probe.ts";

export const PROBE_HOST_SPACING_MS = 400;
export const PROBE_TIMEOUT_MS = 15_000;
const MAX_BYTES = 1_048_576;

export function pacedProbeFetch(
  fetchImpl: typeof fetch = globalThis.fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): ProbeFetch {
  const lastByHost = new Map<string, Promise<void>>();
  return async (url, headers) => {
    const host = new URL(url).hostname.toLowerCase();
    // One request at a time per host, spaced: each waits for the one before it and then for the spacing.
    const before = lastByHost.get(host) ?? Promise.resolve();
    const turn = before.then(() => sleep(PROBE_HOST_SPACING_MS));
    lastByHost.set(host, turn);
    await before;
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { "User-Agent": sourceUserAgent(), Accept: "*/*", ...headers },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      redirect: "follow",
    });
    return {
      status: response.status,
      headers: response.headers,
      bytes: async () => new Uint8Array((await response.arrayBuffer()).slice(0, MAX_BYTES)),
    };
  };
}
