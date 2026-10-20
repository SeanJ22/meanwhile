import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { checkKnownSourceRetry, recordKnownSourceRetry, resolveKnownReleaseCache, withKnownReleaseLock,
  type KnownRelease, type KnownReleaseOptions } from "../sources/known-release.ts";
import { sourceUserAgent } from "../sources/http.ts";

type FileRelease = Omit<KnownRelease, "bytes"> & { path: string; capture(): Promise<void>; accept(): Promise<void>; dispose(): Promise<void> };
interface Index extends Omit<KnownRelease, "bytes" | "reused"> { version: 1; byteLength: number; chunks: { key: string; sha256: string; size: number }[] }
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const CHUNK = 4 * 1024 * 1024;

/** Source archives live on disk and in bounded vault chunks. The manifest moves
 * only after the parser has consumed and validated the complete archive. */
export async function acquireVoteSourceFile(options: Omit<KnownReleaseOptions, "validate" | "readHeld">): Promise<FileRelease> {
  const url = new URL(options.url);
  if (url.protocol !== "https:" || url.username || url.password || [...url.searchParams.keys()].some(key => /^(key|api[_-]?key|token|secret|access_key)$/i.test(key))) throw new Error("VOTE_SOURCE_URL_INVALID");
  const { store, locks } = await resolveKnownReleaseCache(options);
  const identity = digest(`${options.sourceId}\n${options.releaseId}\n${options.url}`);
  const prefix = `project/freshness/source/${options.sourceId}/files/${identity}`;
  const indexKey = `${prefix}/manifest.json`;
  const directory = await mkdtemp(join(tmpdir(), "meanwhile-vote-source-")), path = join(directory, "source");
  const dispose = () => rm(directory, { recursive: true, force: true });
  try {
    return await withKnownReleaseLock(locks, `vote-source:${identity}`, options.signal, async () => {
      const saved = await store.get(indexKey);
      const now = options.now?.() ?? new Date().toISOString();
      const prior: Index | null = saved ? JSON.parse(new TextDecoder().decode(saved.bytes)) as Index : null;
      if (prior && (prior.version !== 1 || prior.requestedUrl !== options.url || prior.sourceId !== options.sourceId ||
          prior.releaseId !== options.releaseId || !/^[a-f0-9]{64}$/.test(prior.sha256) || prior.byteLength <= 0 || prior.byteLength > options.maxBytes ||
          !Number.isFinite(Date.parse(prior.checkedAt)) || !Array.isArray(prior.chunks) || !prior.chunks.length ||
          prior.chunks.some((chunk, index) => chunk.key !== `${prefix}/${prior!.sha256}/${index}.bin` || !/^[a-f0-9]{64}$/.test(chunk.sha256) || chunk.size <= 0 || chunk.size > CHUNK))) throw new Error("VOTE_SOURCE_INDEX_INVALID");
      let response: Response | null = null;
      if (!prior || options.refresh || Date.parse(now) - Date.parse(prior.checkedAt) >= options.checkAfterMs) {
        await checkKnownSourceRetry(store, options.sourceId, options.url, now);
        const headers = new Headers(options.headers); headers.set("user-agent", sourceUserAgent());
        if (prior?.etag) headers.set("if-none-match", prior.etag);
        else if (prior?.lastModified) headers.set("if-modified-since", prior.lastModified);
        response = await (options.fetchImpl ?? fetch)(options.url, { headers, signal: options.signal, redirect: "follow" });
        const final = new URL(response.url || options.url);
        if (final.protocol !== "https:" || final.username || final.password || !(options.allowedHosts ?? [url.hostname]).includes(final.hostname)) {
          await response.body?.cancel(); throw new Error("VOTE_SOURCE_REDIRECT_REFUSED");
        }
        await recordKnownSourceRetry(store, options.sourceId, options.url, response, now);
        if (response.status !== 200 && (response.status !== 304 || !prior)) {
          await response.body?.cancel(); throw new Error(`VOTE_SOURCE_HTTP_${response.status}`);
        }
      }
      let index: Index, reused = false;
      const hash = createHash("sha256"); let size = 0;
      if (!response || response.status === 304) {
        await response?.body?.cancel();
        const held = prior!;
        async function* chunks() {
          for (const chunk of held.chunks) {
            options.signal.throwIfAborted();
            const object = await store.get(chunk.key);
            if (!object || object.bytes.length !== chunk.size || digest(object.bytes) !== chunk.sha256) throw new Error("VOTE_SOURCE_CHUNK_INVALID");
            hash.update(object.bytes); size += object.bytes.length; yield object.bytes;
          }
        }
        await pipeline(chunks(), createWriteStream(path, { flags: "wx" }));
        if (size !== held.byteLength || hash.digest("hex") !== held.sha256) throw new Error("VOTE_SOURCE_HASH_INVALID");
        index = { ...held, ...(response ? { checkedAt: now, lastCheckStatus: 304 } : {}) }; reused = true;
      } else {
        if (!response.body) throw new Error("VOTE_SOURCE_EMPTY_RESPONSE");
        const declared = Number(response.headers.get("content-length"));
        if (declared > options.maxBytes) { await response.body.cancel(); throw new Error("VOTE_SOURCE_TOO_LARGE"); }
        const reader = response.body.getReader();
        async function* chunks() {
          try { for (;;) {
            options.signal.throwIfAborted(); const chunk = await reader.read(); if (chunk.done) break;
            size += chunk.value.length; if (size > options.maxBytes) throw new Error("VOTE_SOURCE_TOO_LARGE");
            hash.update(chunk.value); yield chunk.value;
          } } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        }
        await pipeline(chunks(), createWriteStream(path, { flags: "wx" }));
        if (!size || declared > 0 && !response.headers.get("content-encoding") && size !== declared) throw new Error("VOTE_SOURCE_TRUNCATED");
        const sha256 = hash.digest("hex"); reused = sha256 === prior?.sha256;
        index = { version: 1, sourceId: options.sourceId, releaseId: options.releaseId, requestedUrl: options.url,
          finalUrl: response.url || options.url, httpStatus: 200, sha256, byteLength: size,
          retrievedAt: reused ? prior!.retrievedAt : now, sourceObservedAt: reused ? prior!.sourceObservedAt : now,
          checkedAt: now, lastCheckStatus: 200, etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified"),
          contentType: response.headers.get("content-type") ?? "application/zip", chunks: reused ? prior!.chunks : [] };
      }
      const capture = async () => {
          if (!index.chunks.length) for await (const bytes of createReadStream(path, { highWaterMark: CHUNK })) {
            const key = `${prefix}/${index.sha256}/${index.chunks.length}.bin`, sha256 = digest(bytes);
            await store.put(key, bytes, { contentType: "application/octet-stream", byteLength: bytes.length, contentHash: `sha256-${sha256}` });
            index.chunks.push({ key, sha256, size: bytes.length });
          }
          const bytes = new TextEncoder().encode(JSON.stringify(index));
          if (!await store.head(`${prefix}/${index.sha256}/source.json`)) await store.put(`${prefix}/${index.sha256}/source.json`, bytes, { contentType: "application/json", byteLength: bytes.length, contentHash: `sha256-${digest(bytes)}` });
        };
      return { ...index, reused, path, vaultKey: `${prefix}/${index.sha256}/source.json`, dispose, capture,
        accept: async () => {
          await capture();
          const bytes = new TextEncoder().encode(JSON.stringify(index));
          await store.put(indexKey, bytes, { contentType: "application/json", byteLength: bytes.length,
            contentHash: `manifest:vote-source:${identity}`, objectClass: "MUTABLE_INDEX" });
        } };
    });
  } catch (error) { await dispose(); throw error; }
}
