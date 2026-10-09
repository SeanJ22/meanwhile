import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OUTBOUND_USER_AGENT } from "../../geo/outbound-agent.ts";
import { openZipFile } from "../archive.ts";
import { decodeUtf8 } from "./streaming.ts";
import type { PrlDataset } from "./inventory.ts";
import type { PrlSourceOpen } from "./ingest.ts";
import type { PrlArchiveStore } from "./archive-store.ts";

const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024;
interface HeldSource {
  version: 1; url: string; finalUrl: string; sha256: string; bytes: number;
  retrievedAt: string; etag: string | null; lastModified: string | null; chunks: string[];
}

/** The complete compressed source is staged on disk, never held in a worker's heap.
 * Captured source bytes survive parser refusals. Only fully decoded, validated
 * sources may later move the canonical civic-data publication pointer. */
export async function openPrlSource(dataset: PrlDataset, fetchImpl: typeof fetch = fetch,
  archive?: PrlArchiveStore, reuseIfSha256?: string): Promise<PrlSourceOpen> {
  const root = await mkdtemp(join(tmpdir(), "prl-source-")), path = join(root, "source");
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
    const response = await fetchImpl(dataset.url, { headers, redirect: "follow", signal: AbortSignal.timeout(180_000) });
    if (response.status === 206) throw new Error("PRL_SOURCE_TRUNCATED");
    if (response.status === 304 && held && held.sha256 === reuseIfSha256) {
      return { textChunks: (async function* () {})(), sourceSha256: held.sha256, finalUrl: held.finalUrl,
        member: dataset.file, retrievedAt: held.retrievedAt, byteLength: held.bytes, unchanged: true, dispose };
    }
    const handle = await open(path, "wx");
    const hash = createHash("sha256");
    let size = 0, source: HeldSource;
    try {
      if (response.status === 304 && held && archive) {
        for (const key of held.chunks) {
          const chunk = await archive.get(key);
          if (!chunk || chunk.byteLength > CHUNK_BYTES) throw new Error("PRL_HELD_SOURCE_CHUNK_MISSING");
          hash.update(chunk); size += chunk.byteLength; await handle.writeFile(chunk);
        }
        if (size !== held.bytes || hash.digest("hex") !== held.sha256) throw new Error("PRL_HELD_SOURCE_HASH_MISMATCH");
        source = held;
      } else {
        if (!response.ok || !response.body) throw new Error(`PRL_SOURCE_HTTP_${response.status}${response.headers.get("retry-after") ? `:Retry-After=${response.headers.get("retry-after")}` : ""}`);
        const stated = Number(response.headers.get("content-length"));
        if (stated > MAX_SOURCE_BYTES) throw new Error("PRL_SOURCE_TOO_LARGE");
        const reader = response.body.getReader();
        try { while (true) {
          const next = await reader.read();
          if (next.done) break;
          const chunk = next.value;
          size += chunk.byteLength;
          if (size > MAX_SOURCE_BYTES) throw new Error("PRL_SOURCE_TOO_LARGE");
          hash.update(chunk); await handle.writeFile(chunk);
        } } catch (error) { await reader.cancel().catch(() => {}); throw error; }
        finally { reader.releaseLock(); }
        if (!size || (stated > 0 && !response.headers.get("content-encoding") && size !== stated)) throw new Error("PRL_SOURCE_TRUNCATED");
        const digest = hash.digest("hex");
        source = held?.sha256 === digest ? { ...held, etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") }
          : { version: 1, url: dataset.url, finalUrl: response.url || dataset.url, sha256: digest, bytes: size,
            retrievedAt: new Date().toISOString(), etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified"), chunks: [] };
      }
    } finally { await handle.close(); }
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
        member: dataset.file, retrievedAt: source.retrievedAt, byteLength: source.bytes, unchanged: true, dispose };
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
      member: entries?.[0].name ?? dataset.file, retrievedAt: source.retrievedAt, byteLength: source.bytes, dispose,
      accept: async () => {
        if (!complete) throw new Error("PRL_SOURCE_NOT_FULLY_READ");
      } };
  } catch (error) { await dispose(); throw error; }
}
