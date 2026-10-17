/**
 * A plain-code sweep of the outbound links in the published reader edge:
 * sources, official sites, join links and agenda PDFs. A known small publisher
 * gets at most its hourly request limit, counted with every other reader of
 * that website; others are read at full speed.
 * Retry-After is honored, and a 429 or 5xx means try later, never dead.
 * Results are kept beside door health as one record per surface.
 */

import type { WebsiteSize } from "../control-plane/scheduler/host-supervision.ts";
import { websiteRequestLimit } from "../control-plane/scheduler/host-supervision.ts";
import { upsertSystemDoor } from "./link-sweep-store.ts";
import { admitWebsiteRequest, holdWebsiteAfter, type WebsitePacing } from "../control-plane/website-pacing.ts";
import { gunzipSync } from "node:zlib";
import { decodeMeetingBlob, type MeetingBodyRecord, type MeetingStateIndex } from "../meetings/body-records.ts";
import { sha256OfJson } from "../meetings/edge-artifacts.ts";
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
export async function collectOutboundLinks(artifacts: AsyncIterable<unknown> | Iterable<unknown>, limit = 200_000): Promise<OutboundLink[]> {
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
  for await (const artifact of artifacts) visit(artifact, [], 0);
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

export interface SweepOptions {
  readonly fetchFn: SweepFetch;
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
      const cap = websiteRequestLimit(options.sizeFor?.(link.url));
      const admitted = await admitWebsiteRequest(options.pacing, link.url, cap, options.now());
      if (!admitted.ok) {
        results.push(admitted.why === "ASKED_TO_WAIT"
          ? { ...link, verdict: "LATER", httpStatus: null, detail: "the publisher asked to be left alone for now" }
          : { ...link, verdict: "WAITING", httpStatus: null, detail: `a small publisher is looked at ${cap} times an hour at most; this link is next in line` });
        continue;
      }
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
        await holdWebsiteAfter(options.pacing, link.url, status, result.retryAfter, options.now());
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

/** What the sweep reads of the published edge: the manifest itself, then each state's body records and agenda text, one body at a time. */
export async function* readEdgeForSweep(store: Pick<ReaderArtifactStore, "readManifest" | "readBytes">): AsyncGenerator<unknown> {
  const stored = await store.readManifest();
  if (stored === null) return;
  const { meetingStates, ...rest } = stored.manifest;
  yield rest;
  const read = async <T>(key: string): Promise<T | null> => {
    const bytes = await store.readBytes(key);
    return bytes === null ? null : decodeMeetingBlob<T>(bytes, key);
  };
  for (const ref of Object.values(meetingStates ?? {})) {
    const bytes = await store.readBytes(ref.key);
    const index = bytes === null ? null : (JSON.parse(gunzipSync(bytes).toString("utf8")) as { value: MeetingStateIndex }).value;
    if (index === null || sha256OfJson(index) !== ref.sha) continue;
    for (const entry of Object.values(index.bodies)) {
      const record = await read<MeetingBodyRecord>(entry.record);
      if (record === null) continue;
      yield record;
      if (record.agenda) { const agenda = await read<unknown>(record.agenda); if (agenda !== null) yield agenda; }
    }
  }
}
