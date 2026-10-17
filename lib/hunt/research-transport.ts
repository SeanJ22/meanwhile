import { checkedCurlArguments, parseCurlIncluded } from "./public-curl.ts";
import type { PublicLookup } from "./egress.ts";
export { parseCurlIncluded } from "./public-curl.ts";
/**
 * A research read refused as a client is asked again as who we are, through
 * another client. Some bot filters challenge Node's own `fetch` whatever it
 * sends, while `curl` carrying the project's name and its purpose and contact
 * headers is admitted. So a 403 is asked once more through `curl`, with the
 * same `User-Agent` plus `X-Purpose` and `X-Contact`. Nothing answers or
 * evades a challenge: a host that refuses the second client too is recorded
 * as refusing. Never follows a redirect (the caller asks robots.txt of every
 * new origin first) and never throws for a site.
 */

import { nodeResearchGet, type ResearchGet } from "./robots-first-fetch.ts";

/** Runs `curl` with these arguments and returns its stdout. Injected in tests. */
export type ResearchCurlRunner = (args: readonly string[], timeoutMs: number) => Promise<Buffer>;

const IDENTIFICATION = {
  "X-Purpose": "we-the-people civic meeting index (research read)",
  "X-Contact": "https://github.com/SeanJ22/we-the-people",
} as const;

async function nativeCurl(args: readonly string[], timeoutMs: number): Promise<Buffer> {
  const { execFile } = await import("node:child_process");
  return new Promise<Buffer>((resolve, reject) => {
    execFile("curl", [...args], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs + 1_000 }, (error, out) =>
      error ? reject(error) : resolve(out as Buffer),
    );
  });
}

/**
 * The research transport: Node's `fetch` first, and on a 403 the same request once more through `curl` with
 * the project's identification in the fields built for it.
 */
export function identifiedResearchGet(options: { readonly first?: ResearchGet; readonly curl?: ResearchCurlRunner; readonly lookup?: PublicLookup } = {}): ResearchGet {
  const first = options.first ?? nodeResearchGet;
  const runCurl = options.curl ?? nativeCurl;
  return async (request) => {
    const got = await first(request);
    if (got.status !== 403) return got;
    try {
      const args = await checkedCurlArguments(request.url, { signal: AbortSignal.timeout(request.timeoutMs), lookup: options.lookup });
      args.push("--max-time", String(Math.max(1, Math.ceil(request.timeoutMs / 1000))));
      for (const [key, value] of Object.entries({ ...request.headers, ...IDENTIFICATION })) args.push("-H", `${key}: ${value}`);
      args.push(request.url);
      const again = parseCurlIncluded(await runCurl(args, request.timeoutMs));
      if (again.status === null) return got;
      return { status: again.status, body: again.body, contentType: again.contentType, location: again.location, transportError: null };
    } catch {
      // The second client could not run or did not answer: the first answer stands.
      return got;
    }
  };
}
