import { fetchSource } from "./fetch-source.ts";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { OUTBOUND_USER_AGENT } from "../geo/outbound-agent.ts";
import { openZipFile } from "./archive.ts";
import { decodeUtf8 } from "./prl/streaming.ts";
export interface ArchiveDownloadSpec { id: string; url: string; file: string; format: "csv" | "csv-zip" | "json-zip" }
export interface ArchiveObjectStore {
  put(key: string, body: Uint8Array, contentType?: string): Promise<unknown>;
  get(key: string): Promise<Uint8Array | null>;
  head(key: string): Promise<{ size: number } | null>;
}
export interface ArchiveSourceOpen {
  readonly textChunks: AsyncIterable<string>; readonly sourceSha256: string; readonly finalUrl: string;
  readonly member: string; readonly retrievedAt: string; readonly publishedAt: string | null;
  readonly checkedAt: string; readonly lastCheckStatus: number;
  readonly byteLength: number; readonly unchanged?: boolean;
  readonly outage?: string;
  readonly accept?: () => Promise<void>; readonly dispose: () => Promise<void>;
}

const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024;
interface HeldSource {
  version: 1; url: string; finalUrl: string; sha256: string; bytes: number;
  retrievedAt: string; etag: string | null; lastModified: string | null; chunks: string[];
}

export async function openArchiveSource(dataset: ArchiveDownloadSpec, fetchImpl: typeof fetch = fetchSource,
  archive?: ArchiveObjectStore, reuseIfSha256?: string): Promise<ArchiveSourceOpen> {
  const root = await mkdtemp(join(tmpdir(), "prl-source-"));
  const path = join(root, "source");
  const dispose = () => rm(root, { recursive: true, force: true });
  const sourceKey = `${dataset.id}/source.json`;
  try {
    let held: HeldSource | null = null;
    const saved = await archive?.get(sourceKey);
    if (saved) {
      held = JSON.parse(new TextDecoder().decode(saved)) as HeldSource;
      if (held.version !== 1 || held.url !== dataset.url || !/^[a-f0-9]{64}$/.test(held.sha256) ||
          !Array.isArray(held.chunks) || !held.chunks.length || held.bytes <= 0 || held.bytes > MAX_SOURCE_BYTES) throw new Error("PRL_HELD_SOURCE_INVALID");
    }
    const headers: Record<string, string> = { "user-agent": OUTBOUND_USER_AGENT };
    if (held?.etag) headers["if-none-match"] = held.etag;
    else if (held?.lastModified) headers["if-modified-since"] = held.lastModified;
    let response: Response | null = null, outage: string | undefined;
    try {
      response = await fetchImpl(dataset.url, { headers, redirect: "follow", signal: AbortSignal.timeout(180_000) });
      if (!response.ok && response.status !== 304) throw new Error(`PRL_SOURCE_HTTP_${response.status}`);
    } catch (error) {
      if (!held || !archive) throw error;
      await response?.body?.cancel().catch(() => {});
      outage = error instanceof Error ? error.message : String(error);
      response = null;
    }
    const checkedAt = response ? new Date().toISOString() : held!.retrievedAt;
    const lastCheckStatus = Number(response?.headers.get("x-meanwhile-source-status") ?? response?.status ?? 200);
    if (response?.status === 206) throw new Error("PRL_SOURCE_TRUNCATED");
    if (lastCheckStatus === 304 && held && held.sha256 === reuseIfSha256) {
      return { textChunks: (async function* () {})(), sourceSha256: held.sha256, finalUrl: held.finalUrl,
        member: dataset.file, publishedAt: held.lastModified ? new Date(held.lastModified).toISOString() : null, retrievedAt: held.retrievedAt, checkedAt, lastCheckStatus, byteLength: held.bytes, unchanged: true, dispose };
    }
    const hash = createHash("sha256");
    let size = 0, source: HeldSource;
    if ((!response || lastCheckStatus === 304) && held && archive) {
      const sourceChunks = held.chunks;
      async function* restoredChunks() {
        for (const key of sourceChunks) {
          const chunk = await archive!.get(key);
          if (!chunk || chunk.byteLength > CHUNK_BYTES) throw new Error("PRL_HELD_SOURCE_CHUNK_MISSING");
          hash.update(chunk); size += chunk.byteLength;
          yield chunk;
        }
      }
      await pipeline(restoredChunks(), createWriteStream(path, { flags: "wx" }));
      if (size !== held.bytes || hash.digest("hex") !== held.sha256) throw new Error("PRL_HELD_SOURCE_HASH_MISMATCH");
      source = held;
    } else {
      if (!response?.ok || !response.body) throw new Error(`PRL_SOURCE_HTTP_${response?.status}`);
      const stated = Number(response.headers.get("content-length"));
      if (stated > MAX_SOURCE_BYTES) throw new Error("PRL_SOURCE_TOO_LARGE");
      const reader = response.body.getReader();
      async function* downloadedChunks() {
        try { while (true) {
          const next = await reader.read();
          if (next.done) break;
          const chunk = next.value;
          size += chunk.byteLength;
          if (size > MAX_SOURCE_BYTES) throw new Error("PRL_SOURCE_TOO_LARGE");
          hash.update(chunk);
          yield chunk;
        } } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      }
      await pipeline(downloadedChunks(), createWriteStream(path, { flags: "wx" }));
      if (!size || (stated > 0 && !response.headers.get("content-encoding") && size !== stated)) throw new Error("PRL_SOURCE_TRUNCATED");
      const digest = hash.digest("hex");
      source = held?.sha256 === digest ? { ...held, etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") }
        : { version: 1, url: dataset.url, finalUrl: response.url || dataset.url, sha256: digest, bytes: size,
          retrievedAt: new Date().toISOString(), etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified"), chunks: [] };
    }
    if (archive && !source.chunks.length) {
      for await (const chunk of createReadStream(path, { highWaterMark: CHUNK_BYTES })) {
        const key = `${dataset.id}/sources/${source.sha256}/part-${String(source.chunks.length).padStart(5, "0")}`;
        const stored = await archive.head(key);
        if (!stored || stored.size !== chunk.byteLength) await archive.put(key, chunk, "application/octet-stream");
        source.chunks.push(key);
      }
    }
    if (source.sha256 === reuseIfSha256) {
      if (archive) await archive.put(sourceKey, new TextEncoder().encode(JSON.stringify(source)), "application/json");
      return { textChunks: (async function* () {})(), sourceSha256: source.sha256, finalUrl: source.finalUrl,
        member: dataset.file, publishedAt: source.lastModified ? new Date(source.lastModified).toISOString() : null, retrievedAt: source.retrievedAt, checkedAt, lastCheckStatus, byteLength: source.bytes, unchanged: true, dispose, ...(outage ? { outage } : {}) };
    }
    const entries = dataset.format === "csv" ? null : await openZipFile(path, {
      maxEntries: 8, maxMemberBytes: 32 * 1024 ** 3, maxTotalBytes: 32 * 1024 ** 3, maxDirectoryBytes: 1024 * 1024,
    });
    const extension = dataset.format === "json-zip" ? ".json" : ".csv";
    if (entries && (entries.length !== 1 || !entries[0].name.toLowerCase().endsWith(extension))) throw new Error("PRL_SOURCE_MEMBER_INVALID");
    if (archive) await archive.put(sourceKey, new TextEncoder().encode(JSON.stringify(source)), "application/json");
    let complete = false;
    const bytes = entries ? entries[0].stream() : createReadStream(path);
    async function* textChunks() {
      for await (const chunk of decodeUtf8(bytes)) yield chunk;
      complete = true;
    }
    return { textChunks: textChunks(), sourceSha256: source.sha256, finalUrl: source.finalUrl,
      member: entries?.[0].name ?? dataset.file, publishedAt: source.lastModified ? new Date(source.lastModified).toISOString() : null, retrievedAt: source.retrievedAt, checkedAt, lastCheckStatus, byteLength: source.bytes, dispose, ...(outage ? { outage } : {}),
      accept: async () => {
        if (!complete) throw new Error("PRL_SOURCE_NOT_FULLY_READ");
      } };
  } catch (error) { await dispose(); throw error; }
}
