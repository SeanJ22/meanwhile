import { acquireKnownRelease, checkKnownSourceRetry, recordKnownSourceRetry, resolveKnownReleaseCache, type KnownRelease, type KnownReleaseOptions } from "../sources/known-release.ts";
import { isSourceAcquisitionFailure, readPublisherBody, requestPublisher, sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import type { Provenance } from "./contract.ts";
import { censusGeographyUserAgent } from "./http.ts";

export const CENSUS_ACQUISITION_PARSER = "census-geography/BL-01";

/** Decode source rows without a second complete string or a national row array. */
export function* censusTextLines(bytes: Uint8Array): Generator<string> {
  const decoder = new TextDecoder();
  let remainder = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 64 * 1024) {
    const chunk = remainder + decoder.decode(bytes.subarray(offset, offset + 64 * 1024), { stream: true });
    let start = 0, end: number;
    while ((end = chunk.indexOf("\n", start)) >= 0) {
      yield chunk.slice(start, end).replace(/\r$/, "");
      start = end + 1;
    }
    remainder = chunk.slice(start);
  }
  remainder += decoder.decode();
  if (remainder) yield remainder.replace(/\r$/, "");
}

export interface CensusSourceOptions {
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  /** The same evidence vault and release lock used by other routine sources. */
  readonly cache?: Pick<KnownReleaseOptions, "store" | "locks">;
}

export function censusSourceRelease(url: string, options: CensusSourceOptions, validate?: KnownReleaseOptions["validate"]): Promise<KnownRelease> {
  return acquireKnownRelease({
    ...options.cache,
    sourceId: "census-geography-relationships",
    releaseId: url,
    url,
    parserVersion: CENSUS_ACQUISITION_PARSER,
    signal: options.signal ?? new AbortController().signal,
    maxBytes: 256 * 1024 * 1024,
    checkAfterMs: 0,
    refresh: true,
    fetchImpl: options.fetchImpl,
    headers: { "user-agent": censusGeographyUserAgent() },
    validate: validate ? async (bytes, release) => {
      try { await validate(bytes, release); }
      catch (error) {
        if (isSourceAcquisitionFailure(error)) throw error;
        throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `Census document could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } : undefined,
  });
}

export function sourceValidator(release: KnownRelease): NonNullable<Provenance["sourceValidators"]>[number] {
  return { url: release.requestedUrl, etag: release.etag, lastModified: release.lastModified, bytes: release.bytes.byteLength };
}

/** Confirm held parsed overlaps without rereading the national block archive. */
export async function heldSourcesUnchanged(provenance: Provenance, urls: readonly string[], options: CensusSourceOptions, parserVersion = CENSUS_ACQUISITION_PARSER): Promise<boolean> {
  if (provenance.parserVersion !== parserVersion || !provenance.sourceValidators) return false;
  const validators = urls.map(url => provenance.sourceValidators!.find(row => row.url === url));
  if (validators.some(row => !row || !row.etag && !row.lastModified)) return false;
  const { store } = await resolveKnownReleaseCache(options.cache);
  for (const held of validators) {
    const headers = new Headers({ "user-agent": censusGeographyUserAgent() });
    if (held!.etag) headers.set("if-none-match", held!.etag);
    else if (held!.lastModified) headers.set("if-modified-since", held!.lastModified);
    await checkKnownSourceRetry(store, "census-geography-relationships", held!.url, new Date().toISOString());
    const response = await requestPublisher("Census geography source check", () =>
      (options.fetchImpl ?? fetch)(held!.url, { method: "HEAD", headers, signal: options.signal }));
    await readPublisherBody("Census geography source check", async () => { await response.body?.cancel(); });
    await recordKnownSourceRetry(store, "census-geography-relationships", held!.url, response, new Date().toISOString());
    if (response.status === 304) continue;
    if (response.status === 405 || response.status === 501) return false;
    if (!response.ok) throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", `Census source check returned HTTP ${response.status}: ${held!.url}`);
    const bytes = response.headers.get("content-length"), etag = response.headers.get("etag"), modified = response.headers.get("last-modified");
    if (held!.etag ? etag !== held!.etag : modified !== held!.lastModified) return false;
    if (bytes !== null && held!.bytes !== null && Number(bytes) !== held!.bytes) return false;
  }
  return true;
}

/** Apache's public listings are source evidence for new release and plan discovery. */
export async function censusDirectoryFiles(url: string, options: CensusSourceOptions): Promise<readonly string[]> {
  const release = await censusSourceRelease(url, options);
  const html = new TextDecoder().decode(release.bytes);
  const root = new URL(url);
  return [...new Set([...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].flatMap(match => {
    const child = new URL(match[1].replace(/&amp;/g, "&"), root);
    return child.origin === root.origin && child.pathname.startsWith(root.pathname) && child.pathname !== root.pathname
      ? [child.href] : [];
  }))];
}
