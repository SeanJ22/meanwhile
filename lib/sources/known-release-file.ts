import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { holdRawCaptureFile, readRawCaptureChunks, type RawCaptureRef } from "../civic-data/raw-capture-vault.ts";
import { temporaryPath } from "../civic-data/temporary-path.ts";
import { isSourceAcquisitionFailure, readPublisherBody, requestPublisher, sourceAcquisitionFailure, SourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import { sourceUserAgent } from "./http.ts";
import { checkKnownSourceRetry, recordKnownSourceRetry, resolveKnownReleaseCache, withKnownReleaseLock, type KnownRelease, type KnownReleaseOptions } from "./known-release.ts";

export interface KnownReleaseFile extends Omit<KnownRelease, "bytes"> {
  readonly path: string;
  readonly byteLength: number;
  readonly raw: RawCaptureRef;
  dispose(): Promise<void>;
}
export type KnownReleaseFileOptions = Omit<KnownReleaseOptions, "validate" | "readHeld"> & {
  readonly validate?: (path: string, release: KnownReleaseFile) => void | Promise<void>;
  /** Existing local or shared captures can seed the index, retaining their source dates. */
  readonly readHeld?: () => Promise<KnownReleaseFile | null>;
};
export class KnownReleaseFileUnavailable extends SourceAcquisitionFailure {
  readonly held: KnownReleaseFile;
  constructor(failure: SourceAcquisitionFailure, held: KnownReleaseFile) { super(failure.code, failure.message); this.held = held; }
}
type Metadata = Omit<KnownReleaseFile, "path" | "dispose" | "reused">;
interface FileIndex extends Metadata { readonly formatVersion: 2; readonly parsers: readonly string[] }
interface LegacyIndex extends Omit<FileIndex, "formatVersion" | "raw"> { readonly formatVersion: 1; readonly key: string }
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function publicUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || [...url.searchParams.keys()].some(key => /^(api[_-]?key|key|token|access_token|secret)$/i.test(key))) throw new Error("KNOWN_SOURCE_URL_MUST_BE_PUBLIC");
  return url;
}
async function stage(path: string, chunks: AsyncIterable<Uint8Array>, maximum: number, signal: AbortSignal): Promise<{ sha256: string; byteLength: number }> {
  const file = await open(temporaryPath(path), "w"), digest = createHash("sha256"); let byteLength = 0;
  try {
    for await (const bytes of chunks) {
      signal.throwIfAborted(); byteLength += bytes.byteLength;
      if (byteLength > maximum) throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", "KNOWN_SOURCE_BYTE_BOUND_EXCEEDED");
      digest.update(bytes);
      for (let offset = 0; offset < bytes.byteLength;) {
        const written = await file.write(bytes, offset, bytes.byteLength - offset);
        if (!written.bytesWritten) throw new Error("KNOWN_SOURCE_FILE_WRITE_FAILED");
        offset += written.bytesWritten;
      }
    }
  } finally { await file.close(); }
  if (!byteLength) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "KNOWN_SOURCE_EMPTY_RESPONSE");
  return { sha256: digest.digest("hex"), byteLength };
}
function indexValid(index: FileIndex | LegacyIndex, options: KnownReleaseFileOptions): boolean {
  return !!index && [1,2].includes(index.formatVersion) && index.sourceId === options.sourceId && index.releaseId === options.releaseId &&
    index.requestedUrl === options.url && /^[a-f0-9]{64}$/.test(index.sha256) && index.httpStatus === 200 &&
    Number.isSafeInteger(index.byteLength) && index.byteLength > 0 && index.byteLength <= options.maxBytes &&
    [200,304].includes(index.lastCheckStatus) && [index.retrievedAt,index.sourceObservedAt,index.checkedAt].every(at => Number.isFinite(Date.parse(at))) &&
    Array.isArray(index.parsers) && (options.allowedHosts ?? [new URL(options.url).hostname]).includes(publicUrl(index.finalUrl).hostname);
}

/** Same source cache and conditional checks as byte releases, with complete evidence replayed in bounded chunks. */
export async function acquireKnownReleaseFile(options: KnownReleaseFileOptions): Promise<KnownReleaseFile> {
  publicUrl(options.url);
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(options.sourceId) || !options.releaseId || !options.parserVersion ||
    !Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || !Number.isFinite(options.checkAfterMs) || options.checkAfterMs < 0) throw new Error("KNOWN_SOURCE_IDENTITY_INVALID");
  const { store, locks } = await resolveKnownReleaseCache(options);
  const identity = hash(`${options.sourceId}\n${options.releaseId}\n${options.url}`);
  const prefix = `project/freshness/source/${options.sourceId}/releases/${identity}`;
  const key = `${prefix}/manifest.json`;
  const directory = await mkdtemp(join(tmpdir(), "meanwhile-source-release-"));
  const path = join(directory, "source.bin");
  const dispose = () => rm(directory, { recursive: true, force: true });
  const releaseOf = (index: Metadata, reused: boolean): KnownReleaseFile => ({ ...index, path, dispose, reused });
  try {
    return await withKnownReleaseLock(locks, `source-release:${identity}`, options.signal, async () => {
      const now = options.now?.() ?? new Date().toISOString();
      let prior: FileIndex | null = null;
      const writeIndex = async (index: FileIndex) => {
        const bytes = new TextEncoder().encode(JSON.stringify(index));
        await store.put(key, bytes, { contentType: "application/json", contentHash: `manifest:source-release:${identity}`, byteLength: bytes.byteLength, objectClass: "MUTABLE_INDEX" });
      };
      const saveStaged = async (metadata: Omit<Metadata, "raw" | "vaultKey">, parsers: readonly string[]): Promise<FileIndex> => {
        const raw = await holdRawCaptureFile(store, options.sourceId, path, metadata.contentType);
        if (raw.rawHash !== metadata.sha256 || raw.byteLength !== metadata.byteLength) throw new Error("KNOWN_SOURCE_CAPTURE_CHANGED");
        const index: FileIndex = { ...metadata, raw, vaultKey: raw.vaultKey, formatVersion: 2, parsers };
        await writeIndex(index); return index;
      };
      const saved = await store.get(key);
      if (saved) {
        const index = JSON.parse(new TextDecoder().decode(saved.bytes)) as FileIndex | LegacyIndex;
        if (!indexValid(index, options)) throw new Error("KNOWN_SOURCE_INDEX_INVALID");
        let chunks: AsyncIterable<Uint8Array> | null;
        if (index.formatVersion === 2) {
          if (!index.raw?.chunked || index.raw.rawHash !== index.sha256 || index.raw.byteLength !== index.byteLength) throw new Error("KNOWN_SOURCE_INDEX_INVALID");
          chunks = readRawCaptureChunks(store, index.raw);
        } else {
          if (index.key !== `${prefix}/${index.sha256}.bin`) throw new Error("KNOWN_SOURCE_INDEX_INVALID");
          if (!store.stream) throw new Error("KNOWN_SOURCE_STREAMING_VAULT_REQUIRED");
          chunks = await store.stream(index.key);
        }
        if (chunks) {
          const actual = await stage(path, chunks, options.maxBytes, options.signal);
          if (actual.sha256 !== index.sha256 || actual.byteLength !== index.byteLength) throw new Error("KNOWN_SOURCE_HELD_BYTES_INVALID");
          if (index.formatVersion === 2) prior = index;
          else {
            const { key: _key, formatVersion: _format, parsers, ...metadata } = index; void _key; void _format;
            prior = await saveStaged(metadata, parsers);
          }
        }
      }
      if (!prior && options.readHeld) {
        const held = await options.readHeld();
        if (held) {
          try {
            if (held.sourceId !== options.sourceId || held.releaseId !== options.releaseId || held.requestedUrl !== options.url || held.httpStatus !== 200 ||
              ![held.retrievedAt,held.sourceObservedAt,held.checkedAt].every(at => Number.isFinite(Date.parse(at)))) throw new Error("KNOWN_SOURCE_HELD_IDENTITY_INVALID");
            const actual = await stage(path, createReadStream(temporaryPath(held.path)), options.maxBytes, options.signal);
            if (actual.sha256 !== held.sha256 || actual.byteLength !== held.byteLength) throw new Error("KNOWN_SOURCE_HELD_BYTES_INVALID");
            const { path: _path, dispose: _dispose, raw: _raw, reused: _reused, vaultKey: _vaultKey, ...metadata } = held;
            void _path; void _dispose; void _raw; void _reused; void _vaultKey;
            const raw = held.raw;
            const release = { ...metadata, path, raw, dispose, reused: true };
            await options.validate?.(path, release);
            prior = await saveStaged(metadata, [options.parserVersion]);
            return releaseOf(prior, true);
          } finally { await held.dispose(); }
        }
      }
      if (prior) {
        const changed = !prior.parsers.includes(options.parserVersion);
        if (changed || !options.refresh && Date.parse(now)-Date.parse(prior.checkedAt) < options.checkAfterMs) {
          if (changed) { await options.validate?.(path, releaseOf(prior, true)); prior = { ...prior, parsers: [...prior.parsers, options.parserVersion] }; await writeIndex(prior); }
          return releaseOf(prior, true);
        }
      }
      try {
        const headers = new Headers(options.headers); headers.set("user-agent", sourceUserAgent());
        if (prior?.etag) headers.set("if-none-match", prior.etag);
        else if (prior?.lastModified) headers.set("if-modified-since", prior.lastModified);
        await checkKnownSourceRetry(store, options.sourceId, options.url, now);
        const response = await requestPublisher(options.sourceId, () => (options.fetchImpl ?? fetch)(options.url, { headers, signal: options.signal, redirect: "follow" }));
        const finalUrl = response.url || options.url;
        if (!(options.allowedHosts ?? [new URL(options.url).hostname]).includes(publicUrl(finalUrl).hostname)) {
          await response.body?.cancel().catch(() => {});
          throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", "KNOWN_SOURCE_REDIRECT_REFUSED");
        }
        const checkedAt = options.now?.() ?? new Date().toISOString();
        if (response.status === 304) {
          await response.body?.cancel().catch(() => {});
          if (!prior) throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", "KNOWN_SOURCE_304_WITHOUT_BYTES");
          prior = { ...prior, checkedAt, lastCheckStatus: 304 }; await writeIndex(prior); return releaseOf(prior, true);
        }
        if (response.status !== 200) {
          await response.body?.cancel().catch(() => {}); await recordKnownSourceRetry(store, options.sourceId, options.url, response, checkedAt);
          throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", `KNOWN_SOURCE_HTTP_${response.status}`);
        }
        const declaredText = response.headers.get("content-length"), encoding = response.headers.get("content-encoding");
        const declared = declaredText && /^\d+$/.test(declaredText) ? Number(declaredText) : null;
        if (declared !== null && (!Number.isSafeInteger(declared) || declared > options.maxBytes) || !response.body) {
          await response.body?.cancel().catch(() => {}); throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", "KNOWN_SOURCE_BYTE_BOUND_EXCEEDED_OR_EMPTY");
        }
        const reader = response.body.getReader();
        const chunks = (async function* () {
          try { for (;;) { const next = await readPublisherBody(options.sourceId, () => reader.read()); if (next.done) break; yield next.value; } }
          finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        })();
        const actual = await stage(path, chunks, options.maxBytes, options.signal);
        if ((!encoding || encoding === "identity") && declared !== null && declared !== actual.byteLength) throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", "KNOWN_SOURCE_CONTENT_LENGTH_MISMATCH");
        const unchanged = prior?.sha256 === actual.sha256;
        const metadata = { sourceId: options.sourceId, releaseId: options.releaseId, ...actual, requestedUrl: options.url,
          finalUrl: unchanged ? prior!.finalUrl : finalUrl, httpStatus: 200, retrievedAt: unchanged ? prior!.retrievedAt : checkedAt,
          sourceObservedAt: unchanged ? prior!.sourceObservedAt : checkedAt, checkedAt, lastCheckStatus: 200,
          etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified"), contentType: unchanged ? prior!.contentType : response.headers.get("content-type") ?? "application/octet-stream" };
        const raw = unchanged ? prior!.raw : { vaultKey: "", rawHash: actual.sha256, byteLength: actual.byteLength, chunked: true as const };
        await options.validate?.(path, releaseOf({ ...metadata, raw }, !!unchanged));
        prior = unchanged ? { ...prior!, ...metadata, parsers: [...new Set([...prior!.parsers, options.parserVersion])] } : await saveStaged(metadata, [options.parserVersion]);
        if (unchanged) await writeIndex(prior);
        return releaseOf(prior, !!unchanged);
      } catch (error) {
        if (!isSourceAcquisitionFailure(error) || !prior || options.signal.aborted) throw error;
        // A failed new download may have replaced the staging file. Restore the complete last GOOD before returning its dated proof.
        await stage(path, readRawCaptureChunks(store, prior.raw), options.maxBytes, options.signal);
        const held = { ...releaseOf(prior, true), outage: error.message };
        await options.validate?.(path, held);
        throw new KnownReleaseFileUnavailable(error, held);
      }
    });
  } catch (error) {
    if (!(error instanceof KnownReleaseFileUnavailable)) await dispose();
    throw error;
  }
}
