import type { WebsiteSizeForUrl } from "../control-plane/scheduler/host-supervision.ts";
import type { WebsitePacing } from "../control-plane/website-pacing.ts";
import { fetchSource, runWithSourceFetch, SourceFetchDeferred } from "../sources/fetch-source.ts";
import type { ProbeFetch } from "./probe.ts";

export const PROBE_TIMEOUT_MS = 15_000;
const MAX_BYTES = 1_048_576;

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
  return async (url, headers) => {
    try {
      const response = await runWithSourceFetch({ pacing: input.pacing, websiteSize: input.sizeFor,
        runtime: { transport: input.fetchImpl, now: input.clock, sleep: input.sleep } }, () => fetchSource(url, {
        method: "GET", headers: { Accept: "*/*", ...headers },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), redirect: "follow",
      }));
      return { status: response.status, headers: response.headers,
        bytes: async () => new Uint8Array((await response.arrayBuffer()).slice(0, MAX_BYTES)) };
    } catch (error) {
      if (error instanceof SourceFetchDeferred) throw new WebsiteWait(error.until, error.why);
      throw error;
    }
  };
}
