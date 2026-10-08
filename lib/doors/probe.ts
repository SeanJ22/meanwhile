/**
 * One cheap first look per feed before a scheduled read: a conditional request
 * (stored ETag or Last-Modified) or, when the publisher offers neither, a hash
 * of the page bytes. Probes are keyed by URL, so one covers every door behind
 * a feed. `fetchFn` is injected so pacing and Retry-After stay with the caller.
 */

import { createHash } from "node:crypto";

import { WebsiteWait } from "./probe-fetch.ts";
import { isDoorRecord, type DoorRecord, type DoorRepository, type DoorValidators } from "./registry.ts";

export interface ProbeResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  /** Only called when the response carries a body worth hashing. */
  bytes(): Promise<Uint8Array>;
}

export type ProbeFetch = (url: string, headers: Readonly<Record<string, string>>) => Promise<ProbeResponse>;

/** Settings that name the one page or feed a door's read starts from, most specific first. */
const PROBE_URL_KEYS = ["feedUrl", "icalUrl", "pageUrl", "schedulePage", "documentsPage", "documentsUrl", "portalUrl", "serviceBase", "apiBase", "baseUrl", "base"] as const;

export function probeUrlFor(door: DoorRecord): string | null {
  for (const key of PROBE_URL_KEYS) {
    const value = door.config[key];
    if (typeof value === "string" && /^https:\/\//i.test(value.trim())) return value.trim();
  }
  return null;
}

/** WAITING: the website could not be asked now (it asked every reader to wait, or a small publisher's hour is used). */
export type ProbeVerdict = "CHANGED" | "UNCHANGED" | "FAILED" | "WAITING" | "NOT_PROBEABLE";

export interface ProbeResult {
  readonly url: string | null;
  readonly verdict: ProbeVerdict;
  readonly validators: DoorValidators | null;
  /** Requests this probe made: 0 or 1. */
  readonly requests: number;
  readonly detail: string;
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** One first look at one URL against what the last look saw. */
export async function firstLook(url: string, previous: DoorValidators | null | undefined, fetchFn: ProbeFetch, at: string): Promise<ProbeResult> {
  const headers: Record<string, string> = {};
  if (previous?.etag) headers["If-None-Match"] = previous.etag;
  if (previous?.lastModified) headers["If-Modified-Since"] = previous.lastModified;
  let response: ProbeResponse;
  try {
    response = await fetchFn(url, headers);
  } catch (error) {
    if (error instanceof WebsiteWait) return { url, verdict: "WAITING", validators: null, requests: 0, detail: error.message };
    return { url, verdict: "FAILED", validators: null, requests: 1, detail: `the first look could not reach the page (${(error as Error)?.name ?? "error"})` };
  }
  if (response.status === 304) {
    const kept: DoorValidators = { ...(previous as DoorValidators), checkedAt: at };
    return { url, verdict: "UNCHANGED", validators: kept, requests: 1, detail: "the publisher says nothing changed" };
  }
  if (response.status < 200 || response.status >= 300) {
    return { url, verdict: "FAILED", validators: null, requests: 1, detail: `the page answered ${response.status}` };
  }
  const etag = response.headers.get("etag");
  const lastModified = response.headers.get("last-modified");
  const contentHash = sha256(await response.bytes());
  // A first look with no earlier validators is a change: there is nothing to say it is the same.
  const changed = previous == null || previous.contentHash !== contentHash || (previous.contentHash === null && (previous.etag !== etag || previous.lastModified !== lastModified));
  const validators: DoorValidators = { etag, lastModified, contentHash, checkedAt: at, changedAt: changed ? at : (previous?.changedAt ?? null) };
  return { url, verdict: changed ? "CHANGED" : "UNCHANGED", validators, requests: 1, detail: changed ? "the page's content changed since the last look" : "the page's content is the same as the last look" };
}

/**
 * Look once per distinct URL across a set of doors. Doors with no readable
 * start page are NOT_PROBEABLE, which means "read as scheduled", never "skip".
 */
export async function probeDoors(
  doors: readonly DoorRecord[],
  fetchFn: ProbeFetch,
  at: string,
): Promise<ReadonlyMap<string, ProbeResult>> {
  const byUrl = new Map<string, Promise<ProbeResult>>();
  const results = new Map<string, ProbeResult>();
  const validatorsByUrl = new Map<string, DoorValidators | null | undefined>();
  for (const door of doors) {
    const url = probeUrlFor(door);
    if (url !== null && !validatorsByUrl.has(url)) validatorsByUrl.set(url, door.validators);
  }
  for (const door of doors) {
    const url = probeUrlFor(door);
    if (url === null) {
      results.set(door.doorId, { url: null, verdict: "NOT_PROBEABLE", validators: null, requests: 0, detail: "no page to look at first" });
      continue;
    }
    if (!byUrl.has(url)) byUrl.set(url, firstLook(url, validatorsByUrl.get(url), fetchFn, at));
    const shared = await byUrl.get(url)!;
    // Only the first door to need a URL is charged its request.
    const charged = results.size === 0 || ![...results.values()].some((r) => r.url === url);
    results.set(door.doorId, { ...shared, requests: charged ? shared.requests : 0 });
  }
  return results;
}

/** Store what a look saw on its door. A system write: it does not count as a hand edit. */
export async function recordProbe(repo: DoorRepository, doorId: string, result: ProbeResult, at: string): Promise<boolean> {
  if (result.validators === null) return false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const row = await repo.read(doorId);
    if (row === null || !isDoorRecord(row.value)) return false;
    try {
      await repo.compareAndSet(doorId, row.revision, { ...row.value, validators: result.validators, updatedAt: at }, at);
      return true;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  return false;
}
