/**
 * DB-51: dead links are found before readers find them.
 *
 * A plain-code sweep (no AI, no model cost) visits the outbound links in the
 * published reader edge: sources, official sites, join links and agenda PDFs.
 * It follows the request rules of rulings §2: a known small local government
 * (under 10,000 people) or school district (under 5,000 students) gets at most
 * ten requests an hour from a pass; every other publisher is read at full
 * speed; Retry-After is honored and a 429 or 5xx is a "try again later", never a
 * dead link. Results are kept beside door health as one record per surface,
 * so Admin can show how many links are dead on each surface.
 *
 * Nothing here names a place.
 */

import type { WebsiteSize } from "../control-plane/scheduler/host-supervision.ts";
import { websiteRequestLimit } from "../control-plane/scheduler/host-supervision.ts";
import { upsertSystemDoor } from "./link-sweep-store.ts";
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

export interface SweepFetchResult {
  readonly status: number;
  /** Seconds, or an HTTP date, as the server sent it. */
  readonly retryAfter?: string | null;
}

/** One cheap look at a URL. May throw a network error carrying a `code` (ENOTFOUND, ECONNREFUSED, ETIMEDOUT...). */
export type SweepFetch = (url: string, method: "HEAD" | "GET") => Promise<SweepFetchResult>;

const DEAD_CODES = new Set(["ENOTFOUND", "EAI_AGAIN_PERMANENT", "ECONNREFUSED"]);

async function look(url: string, fetchFn: SweepFetch): Promise<{ result: SweepFetchResult | null; code: string | null }> {
  try {
    let result = await fetchFn(url, "HEAD");
    // Some servers refuse HEAD; one GET settles it.
    if (result.status === 405 || result.status === 501 || result.status === 403) result = await fetchFn(url, "GET");
    return { result, code: null };
  } catch (error) {
    const code = (error as { code?: unknown; cause?: { code?: unknown } }).code ?? (error as { cause?: { code?: unknown } }).cause?.code;
    return { result: null, code: typeof code === "string" ? code : "FAILED" };
  }
}

function retryAfterMs(value: string | null | undefined, now: number): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value.trim())) return Number(value) * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

export interface SweepOptions {
  readonly fetchFn: SweepFetch;
  readonly now: () => number;
  /** What is known of a link's publisher; unknown means full speed (rulings §2). */
  readonly sizeFor?: (url: string) => WebsiteSize | null | undefined;
  /** Rotates which links a capped host gets this pass, so every link is reached over several passes. */
  readonly rotation?: number;
  /** A pass never spends longer than this waiting on one host's Retry-After; past it the host is left for the next pass. */
  readonly maxWaitMs?: number;
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
  const maxWaitMs = options.maxWaitMs ?? 0;
  const readHost = async ([, hostLinks]: [string, OutboundLink[]]): Promise<void> => {
    const cap = websiteRequestLimit(options.sizeFor?.(hostLinks[0]!.url));
    const rotation = options.rotation ?? 0;
    const start = hostLinks.length === 0 ? 0 : rotation % hostLinks.length;
    const ordered = [...hostLinks.slice(start), ...hostLinks.slice(0, start)];
    let requests = 0;
    let pausedUntil: number | null = null;
    for (const link of ordered) {
      if (cap !== null && requests >= cap) {
        results.push({ ...link, verdict: "WAITING", httpStatus: null, detail: `a small publisher is looked at ${cap} times an hour at most; this link is next in line` });
        continue;
      }
      if (pausedUntil !== null) {
        results.push({ ...link, verdict: "LATER", httpStatus: null, detail: "the publisher asked to be left alone for now" });
        continue;
      }
      requests += 1;
      const { result, code } = await look(link.url, options.fetchFn);
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
        const wait = retryAfterMs(result.retryAfter, options.now());
        if (status === 429 || status === 503 || wait !== null) pausedUntil = options.now() + (wait ?? maxWaitMs);
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

/**
 * Keep the sweep beside door health: one record per surface (door id
 * `links:<surface>`, kind `link-sweep`) holding the counts and the dead
 * addresses found, so Admin can show how many links are dead on each surface.
 * A system write; a surface with no links is recorded as zero, never skipped.
 */
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
