import type { WebsiteSize } from "../control-plane/scheduler/host-supervision.ts";
import { fetchSource, runWithSourceFetch, SourceFetchDeferred } from "../sources/fetch-source.ts";
import { upsertSystemDoor } from "./link-sweep-store.ts";
import { type WebsitePacing } from "../control-plane/website-pacing.ts";
import type { ReaderArtifactStore } from "../meetings/edge-store.ts";
import type { DoorRepository } from "./registry.ts";

export const LINK_SURFACES = ["sources", "official sites", "join links", "agenda PDFs", "other links"] as const;
export type LinkSurface = (typeof LINK_SURFACES)[number];

export interface OutboundLink {
  readonly url: string;
  readonly surface: LinkSurface;
}

/** A key name tells which surface a link is on; the edge's JSON is walked, not parsed by a fixed schema. */
function surfaceOf(path: readonly string[], url: string): LinkSurface {
  const key = (path.at(-1) ?? "").toLowerCase();
  if (/join|zoom|webex|teams|livestream|video|stream/.test(key) || /(zoom\.us|webex\.com|teams\.microsoft\.com|meet\.google\.com)/i.test(url)) return "join links";
  if (/agenda|packet|minutes|document|pdf/.test(key) || /\.pdf(\?|#|$)/i.test(url)) return "agenda PDFs";
  if (/official|website|homepage|site|portal/.test(key)) return "official sites";
  if (/source|citation|provenance|endpoint|origin|route|feed/.test(key)) return "sources";
  return "other links";
}

/** Every distinct https link in the published edge's JSON, tagged with the surface its key names. */
export function collectOutboundLinks(artifacts: readonly unknown[], limit = 200_000): OutboundLink[] {
  const found = new Map<string, LinkSurface>();
  const visit = (value: unknown, path: string[], depth: number): void => {
    if (found.size >= limit || depth > 24) return;
    if (typeof value === "string") {
      if (value.length > 2_000 || !/^https:\/\//i.test(value)) return;
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return;
      }
      if (url.username || url.password || !url.hostname.includes(".")) return;
      url.hash = "";
      const key = url.toString();
      if (!found.has(key)) found.set(key, surfaceOf(path, key));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, path, depth + 1);
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) visit(v, [...path, k], depth + 1);
    }
  };
  for (const artifact of artifacts) visit(artifact, [], 0);
  return [...found].map(([url, surface]) => ({ url, surface })).sort((a, b) => (a.url < b.url ? -1 : 1));
}

export type LinkVerdict = "OK" | "DEAD" | "LATER" | "WAITING";

export interface LinkResult extends OutboundLink {
  readonly verdict: LinkVerdict;
  readonly httpStatus: number | null;
  readonly detail: string;
}

export type SweepFetch = typeof fetch;
const DEAD_CODES = new Set(["ENOTFOUND", "EAI_AGAIN_PERMANENT", "ECONNREFUSED"]);

async function look(url: string): Promise<{ result: Response | null; code: string | null }> {
  try {
    let result = await fetchSource(url, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
    if ([403, 405, 501].includes(result.status)) result = await fetchSource(url, { method: "GET", signal: AbortSignal.timeout(15_000) });
    return { result, code: null };
  } catch (error) {
    if (error instanceof SourceFetchDeferred) return { result: null, code: error.why };
    const code = (error as { code?: unknown; cause?: { code?: unknown } }).code ?? (error as { cause?: { code?: unknown } }).cause?.code;
    return { result: null, code: typeof code === "string" ? code : "FAILED" };
  }
}

export interface SweepOptions {
  readonly fetchFn?: SweepFetch;
  readonly now: () => number;
  /** The one count and hold per website every reader shares. */
  readonly pacing: WebsitePacing;
  /** What is known of a link's publisher; unknown means full speed. */
  readonly sizeFor?: (url: string) => WebsiteSize | null | undefined;
  /** Rotates which links a capped host gets this pass, so every link is reached over several passes. */
  readonly rotation?: number;
  /** How many hosts are read at once. */
  readonly concurrency?: number;
}

export async function sweepLinks(links: readonly OutboundLink[], options: SweepOptions): Promise<LinkResult[]> {
  const byHost = new Map<string, OutboundLink[]>();
  for (const link of links) {
    const host = new URL(link.url).hostname.toLowerCase();
    const list = byHost.get(host) ?? [];
    list.push(link);
    byHost.set(host, list);
  }
  const results: LinkResult[] = [];
  const hosts = [...byHost].sort(([a], [b]) => (a < b ? -1 : 1));
  const readHost = async ([, hostLinks]: [string, OutboundLink[]]): Promise<void> => {
    const rotation = options.rotation ?? 0;
    const start = hostLinks.length === 0 ? 0 : rotation % hostLinks.length;
    const ordered = [...hostLinks.slice(start), ...hostLinks.slice(0, start)];
    for (const link of ordered) {
      const { result, code } = await runWithSourceFetch({ pacing: options.pacing, websiteSize: options.sizeFor,
        runtime: { transport: options.fetchFn, now: options.now } }, () => look(link.url));
      if (code === "HOURLY_ALLOWANCE" || code === "ASKED_TO_WAIT") {
        results.push({ ...link, verdict: code === "HOURLY_ALLOWANCE" ? "WAITING" : "LATER", httpStatus: null,
          detail: code === "HOURLY_ALLOWANCE" ? "the publisher's hourly allowance is used; this link is next in line" : "the publisher asked to be left alone for now" });
        continue;
      }
      if (result === null) {
        results.push(DEAD_CODES.has(code ?? "")
          ? { ...link, verdict: "DEAD", httpStatus: null, detail: `the address does not answer (${code})` }
          : { ...link, verdict: "LATER", httpStatus: null, detail: `the look failed (${code}), so the link is not called dead` });
        continue;
      }
      const status = result.status;
      if (status >= 200 && status < 400) results.push({ ...link, verdict: "OK", httpStatus: status, detail: "answers" });
      else if (status === 404 || status === 410) results.push({ ...link, verdict: "DEAD", httpStatus: status, detail: status === 410 ? "the page is gone" : "the page was not found" });
      else {
        results.push({ ...link, verdict: "LATER", httpStatus: status, detail: status === 429 ? "the publisher asked us to slow down" : `the publisher answered ${status}; try again later` });
      }
    }
  };
  const width = Math.max(1, options.concurrency ?? 4);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, hosts.length) }, async () => {
    while (next < hosts.length) await readHost(hosts[next++]!);
  }));
  return results.sort((a, b) => (a.url < b.url ? -1 : 1));
}

export interface SurfaceSummary {
  readonly surface: LinkSurface;
  readonly links: number;
  readonly ok: number;
  readonly dead: number;
  readonly later: number;
  readonly waiting: number;
}

export function summarizeSweep(results: readonly LinkResult[]): SurfaceSummary[] {
  return LINK_SURFACES.map((surface) => {
    const own = results.filter((r) => r.surface === surface);
    const count = (v: LinkVerdict): number => own.filter((r) => r.verdict === v).length;
    return { surface, links: own.length, ok: count("OK"), dead: count("DEAD"), later: count("LATER"), waiting: count("WAITING") };
  });
}


export async function recordSweep(repo: DoorRepository, results: readonly LinkResult[], at: string): Promise<readonly SurfaceSummary[]> {
  const summaries = summarizeSweep(results);
  for (const summary of summaries) {
    const dead = results.filter((r) => r.surface === summary.surface && r.verdict === "DEAD").map((r) => r.url).slice(0, 200);
    await upsertSystemDoor(repo, {
      doorId: `links:${summary.surface.replace(/\s+/g, "-")}`,
      kind: "link-sweep",
      holds: ["links"],
      config: { surface: summary.surface, links: summary.links, ok: summary.ok, dead: summary.dead, later: summary.later, waiting: summary.waiting, sweptAt: at, deadAddresses: dead },
      notes: "Counts from the last sweep of the links readers can follow. A sweep uses no AI.",
    }, at);
  }
  return summaries;
}

/** What the sweep reads of the published edge: the manifest itself (source reports, comment access, routing) and every scope artifact it lists. */
export async function readEdgeForSweep(store: Pick<ReaderArtifactStore, "readManifest" | "readArtifact">): Promise<unknown[]> {
  const stored = await store.readManifest();
  if (stored === null) return [];
  const { scopes, ...rest } = stored.manifest;
  const artifacts: unknown[] = [rest];
  for (const scope of scopes) {
    const artifact = await store.readArtifact(scope.key);
    if (artifact !== null) artifacts.push(artifact);
  }
  return artifacts;
}
