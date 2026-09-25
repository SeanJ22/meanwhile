/**
 * **A RESEARCH READ REFUSED AS A CLIENT IS ASKED AGAIN AS WHO WE ARE, THROUGH ANOTHER CLIENT.** (2026-09-25.)
 *
 * `pnpm research:fetch` sent every request through Node's own `fetch`. The Cloudflare filter in front of three
 * New Hampshire hosts the runner reads (www.suttonnh.gov, www.newbury.nh.gov, www.kearsarge.org) challenges
 * Node's client whatever it says (403, `cf-mitigated: challenge`), so research sessions recorded those towns as
 * refusing us: a fresh read of Newbury's calendar export was "refused by the town's JavaScript challenge"
 * (commit 7b3e5abb). Measured on 2026-09-25 (22:05-22:20Z), `curl` carrying this project's own name and its
 * purpose and contact headers was admitted 30 times in 30 on the same hosts.
 *
 * So a 403 is asked once more, through `curl`, with the same `User-Agent` the research read already sent plus
 * `X-Purpose` and `X-Contact`. Nothing answers or evades a challenge: a host that refuses the second client too
 * is recorded as refusing, with its own status. Like the Node transport, this never follows a redirect (the
 * caller asks robots.txt of every new origin first) and never throws for a site.
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

/** One `curl -i` response: the first header block, then the body bytes. Never follows a redirect. */
export function parseCurlIncluded(out: Buffer): { status: number | null; contentType: string; location: string | null; body: Uint8Array } {
  const cut = out.indexOf("\r\n\r\n");
  const headEnd = cut < 0 ? out.length : cut;
  const head = out.subarray(0, headEnd).toString("latin1");
  const body = cut < 0 ? new Uint8Array(0) : new Uint8Array(out.subarray(cut + 4));
  const status = /^HTTP\/[\d.]+\s+(\d{3})/.exec(head)?.[1];
  const header = (name: string) => new RegExp(`^${name}:\\s*(.*)$`, "im").exec(head)?.[1]?.trim() ?? null;
  return { status: status ? Number(status) : null, contentType: header("content-type") ?? "", location: header("location"), body };
}

/**
 * The research transport: Node's `fetch` first, and on a 403 the same request once more through `curl` with
 * the project's identification in the fields built for it.
 */
export function identifiedResearchGet(options: { readonly first?: ResearchGet; readonly curl?: ResearchCurlRunner } = {}): ResearchGet {
  const first = options.first ?? nodeResearchGet;
  const runCurl = options.curl ?? nativeCurl;
  return async (request) => {
    const got = await first(request);
    if (got.status !== 403) return got;
    const args = ["-s", "-S", "-i", "--compressed", "--max-time", String(Math.max(1, Math.ceil(request.timeoutMs / 1000)))];
    for (const [key, value] of Object.entries({ ...request.headers, ...IDENTIFICATION })) args.push("-H", `${key}: ${value}`);
    args.push(request.url);
    try {
      const again = parseCurlIncluded(await runCurl(args, request.timeoutMs));
      if (again.status === null) return got;
      return { status: again.status, body: again.body, contentType: again.contentType, location: again.location, transportError: null };
    } catch {
      // The second client could not run or did not answer: the first answer stands.
      return got;
    }
  };
}
