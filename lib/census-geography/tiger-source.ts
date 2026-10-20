/** Large Census archives stay compressed in the existing evidence vault and
 * are restored to disk a chunk at a time. A complete ZIP must validate before
 * the source index advances, so a broken update cannot replace held evidence. */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, open, rm, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { isSourceAcquisitionFailure, readPublisherBody, requestPublisher, sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import { openZipFile } from "../sources/archive.ts";
import { checkKnownSourceRetry, recordKnownSourceRetry, resolveKnownReleaseCache, withKnownReleaseLock } from "../sources/known-release.ts";
import type { Provenance } from "./contract.ts";
import { censusGeographyUserAgent } from "./http.ts";
import type { CensusSourceOptions } from "./source-release.ts";

const SOURCE_ID = "census-geography-relationships";
const TIGER_ARCHIVE_PARSER = "census-tiger-archive/BD-02";
export const TIGER_SOURCE_CHUNK_BYTES = 4 * 1024 * 1024;
export const TIGER_ARCHIVE_LIMITS = { maxMemberBytes: 4 * 1024 ** 3, maxTotalBytes: 8 * 1024 ** 3 };
const MAX_ARCHIVE_BYTES = 8 * 1024 ** 3;
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
type Validator = NonNullable<Provenance["sourceValidators"]>[number];
interface Chunk { readonly sha256: string; readonly bytes: number }
interface TigerIndex {
  readonly formatVersion: 1;
  readonly url: string;
  readonly finalUrl: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly retrievedAt: string;
  readonly checkedAt: string;
  readonly parserVersion: string;
  readonly chunks: readonly Chunk[];
}
export interface CensusTigerArchive {
  readonly path: string;
  readonly sha256: string;
  readonly sourceValidator: Validator;
  readonly retrievedAt: string;
  readonly reused: boolean;
  dispose(): Promise<void>;
}
function publicUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || [...url.searchParams.keys()].some(key => /^(api[_-]?key|key|token|access_token|secret)$/i.test(key))) {
    throw new Error("CENSUS_TIGER_URL_MUST_BE_PUBLIC");
  }
  return url;
}
function validIndex(value: unknown, url: string): value is TigerIndex {
  const v = value as TigerIndex | null;
  return !!v && v.formatVersion === 1 && v.url === url && typeof v.finalUrl === "string" &&
    /^[a-f0-9]{64}$/.test(v.sha256) && Number.isSafeInteger(v.bytes) && v.bytes > 0 && v.bytes <= MAX_ARCHIVE_BYTES &&
    typeof v.parserVersion === "string" && Number.isFinite(Date.parse(v.retrievedAt)) && Number.isFinite(Date.parse(v.checkedAt)) &&
    Array.isArray(v.chunks) && v.chunks.length === Math.ceil(v.bytes / TIGER_SOURCE_CHUNK_BYTES) &&
    v.chunks.every((chunk, i) => /^[a-f0-9]{64}$/.test(chunk.sha256) && chunk.bytes === Math.min(TIGER_SOURCE_CHUNK_BYTES, v.bytes - i * TIGER_SOURCE_CHUNK_BYTES)) &&
    (v.etag === null || typeof v.etag === "string") && (v.lastModified === null || typeof v.lastModified === "string");
}
async function writeAll(file: FileHandle, bytes: Uint8Array) {
  let at = 0;
  while (at < bytes.byteLength) {
    const written = await file.write(bytes, at, bytes.byteLength - at);
    if (!written.bytesWritten) throw new Error("CENSUS_TIGER_STAGING_WRITE_FAILED");
    at += written.bytesWritten;
  }
}
async function restore(file: FileHandle, index: TigerIndex, store: EvidenceStore, prefix: string, signal: AbortSignal): Promise<boolean> {
  const digest = createHash("sha256");
  for (const chunk of index.chunks) {
    signal.throwIfAborted();
    const held = await store.get(`${prefix}/chunks/${chunk.sha256}.bin`);
    if (!held || held.bytes.byteLength !== chunk.bytes || hash(held.bytes) !== chunk.sha256) return false;
    digest.update(held.bytes);
    await writeAll(file, held.bytes);
  }
  return digest.digest("hex") === index.sha256;
}
async function stageResponse(response: Response, file: FileHandle, signal: AbortSignal): Promise<{ sha256: string; bytes: number }> {
  const declaredText = response.headers.get("content-length"), encoded = response.headers.get("content-encoding");
  const declared = declaredText !== null && /^\d+$/.test(declaredText) ? Number(declaredText) : null;
  if (declared !== null && (!Number.isSafeInteger(declared) || declared > MAX_ARCHIVE_BYTES)) {
    await response.body?.cancel().catch(() => {});
    throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", "Census TIGER archive declared byte bound exceeded");
  }
  const reader = response.body?.getReader();
  if (!reader) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Census TIGER archive response is empty");
  const digest = createHash("sha256");
  let bytes = 0;
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await readPublisherBody("Census TIGER archive", () => reader.read());
      signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_ARCHIVE_BYTES) throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", "Census TIGER archive streamed byte bound exceeded");
      digest.update(chunk.value);
      await writeAll(file, chunk.value);
    }
    if ((!encoded || encoded === "identity") && declared !== null && declared !== bytes) {
      throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", "Census TIGER archive content length mismatch");
    }
    if (!bytes) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Census TIGER archive response is empty");
    return { sha256: digest.digest("hex"), bytes };
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function validateArchive(archive: string, signal: AbortSignal, validate: (path: string) => Promise<void>) {
  try {
    // Finish every member stream: ZIP framing alone does not validate CRCs.
    for (const entry of await openZipFile(archive, TIGER_ARCHIVE_LIMITS)) {
      for await (const chunk of entry.stream()) { signal.throwIfAborted(); void chunk; }
    }
    signal.throwIfAborted();
    await validate(archive);
  } catch (error) {
    signal.throwIfAborted();
    if (isSourceAcquisitionFailure(error)) throw error;
    throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `Census TIGER archive could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function saveChunks(archive: string, store: EvidenceStore, prefix: string, url: string, finalUrl: string, retrievedAt: string, signal: AbortSignal): Promise<Chunk[]> {
  const chunks: Chunk[] = [];
  for await (const chunk of createReadStream(archive, { highWaterMark: TIGER_SOURCE_CHUNK_BYTES })) {
    signal.throwIfAborted();
    const bytes = chunk as Buffer, sha256 = hash(bytes);
    await store.put(`${prefix}/chunks/${sha256}.bin`, bytes, {
      contentType: "application/octet-stream", contentHash: `sha256-${sha256}`, byteLength: bytes.byteLength,
      custom: { sourceId: SOURCE_ID, canonicalUrl: url, retrievalUrl: finalUrl, retrievedAt,
        httpStatus: "200", permission: "NOT_APPLICABLE", transport: "REACHABLE", retentionPolicy: "EVIDENCE_PERMANENT", tier: "RAW" },
    });
    chunks.push({ sha256, bytes: bytes.byteLength });
  }
  return chunks;
}
/** Conditional source checks never download an unchanged archive. Each caller
 * gets its own temporary file; disposing it leaves immutable vault bytes held. */
export async function censusSourceFile(url: string, options: CensusSourceOptions, validate: (path: string) => Promise<void>): Promise<CensusTigerArchive> {
  const origin = publicUrl(url), signal = options.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  const { store, locks } = await resolveKnownReleaseCache(options.cache);
  const identity = hash(`${SOURCE_ID}\n${url}`), prefix = `project/freshness/source/${SOURCE_ID}/tiger/${identity}`;
  const indexKey = `${prefix}/manifest.json`;
  const directory = await mkdtemp(join(tmpdir(), "meanwhile-census-tiger-"));
  const path = join(directory, "source.zip");
  const dispose = () => rm(directory, { recursive: true, force: true });
  /** The staging file exists only inside this call's own temporary directory. */
  const stage = async <T>(work: (file: FileHandle) => Promise<T>): Promise<T> => {
    const file = await open(path, "w");
    try { return await work(file); } finally { await file.close(); }
  };
  try {
    const result = await withKnownReleaseLock(locks, `source-release:tiger:${identity}`, signal, async () => {
      const object = await store.get(indexKey);
      let prior: TigerIndex | null = null;
      if (object) {
        const parsed: unknown = JSON.parse(new TextDecoder().decode(object.bytes));
        if (!validIndex(parsed, url)) throw new Error("CENSUS_TIGER_INDEX_INVALID");
        prior = parsed;
      }
      await checkKnownSourceRetry(store, SOURCE_ID, url, new Date().toISOString());
      const held = prior !== null && await stage(file => restore(file, prior, store, prefix, signal));
      const headers = new Headers({ "user-agent": censusGeographyUserAgent() });
      if (held && prior?.etag) headers.set("if-none-match", prior.etag);
      else if (held && prior?.lastModified) headers.set("if-modified-since", prior.lastModified);
      const response = await requestPublisher("Census TIGER archive", () => (options.fetchImpl ?? fetch)(url, { headers, signal, redirect: "follow" }));
      const finalUrl = response.url || url;
      let final: URL;
      try { final = publicUrl(finalUrl); }
      catch {
        await response.body?.cancel().catch(() => {});
        throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", "Census TIGER archive redirect is not public");
      }
      if (final.hostname !== origin.hostname) {
        await response.body?.cancel().catch(() => {});
        throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", "Census TIGER archive redirect left the publisher host");
      }
      const checkedAt = new Date().toISOString();
      let index: TigerIndex, reused = false;
      if (response.status === 304) {
        await response.body?.cancel().catch(() => {});
        if (!held || !prior) throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", "Census TIGER archive 304 without held bytes");
        await validate(path);
        index = { ...prior, checkedAt, parserVersion: TIGER_ARCHIVE_PARSER };
        reused = true;
      } else {
        if (response.status !== 200) {
          await response.body?.cancel().catch(() => {});
          await recordKnownSourceRetry(store, SOURCE_ID, url, response, checkedAt);
          throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", `Census TIGER archive returned HTTP ${response.status}`);
        }
        const downloaded = await stage(file => stageResponse(response, file, signal));
        await validate(path);
        reused = !!held && prior?.sha256 === downloaded.sha256;
        const retrievedAt = reused && prior ? prior.retrievedAt : checkedAt;
        const chunks = reused && prior ? prior.chunks : await saveChunks(path, store, prefix, url, finalUrl, retrievedAt, signal);
        index = { formatVersion: 1, url, finalUrl, ...downloaded, etag: response.headers.get("etag"),
          lastModified: response.headers.get("last-modified"), retrievedAt, checkedAt, parserVersion: TIGER_ARCHIVE_PARSER, chunks };
      }
      signal.throwIfAborted();
      const bytes = new TextEncoder().encode(JSON.stringify(index));
      await store.put(indexKey, bytes, { contentType: "application/json", contentHash: `manifest:census-tiger:${identity}`,
        byteLength: bytes.byteLength, objectClass: "MUTABLE_INDEX" });
      return { sha256: index.sha256, sourceValidator: { url, etag: index.etag, lastModified: index.lastModified, bytes: index.bytes }, retrievedAt: index.retrievedAt, reused };
    });
    return { path, ...result, dispose };
  } catch (error) { await dispose(); throw error; }
}

export function censusTigerArchive(url: string, options: CensusSourceOptions, validate: (path: string) => Promise<void>): Promise<CensusTigerArchive> {
  const signal = options.signal ?? new AbortController().signal;
  return censusSourceFile(url, options, path => validateArchive(path, signal, validate));
}
