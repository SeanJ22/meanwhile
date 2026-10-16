import { temporaryPath } from "../civic-data/temporary-path.ts";
import { createHash, randomUUID } from "node:crypto";
import { channel } from "node:diagnostics_channel";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { isSourceAcquisitionFailure, sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { FederalMoneyCapture, FederalMoneySource } from "./model.ts";
import { sortFederalSourceFile } from "./sort.ts";
import { saveFederalMoneyCapture } from "./vault.ts";
import { federalCsvRecords, federalJsonRecords, FEDERAL_MONEY_CHUNK_ROWS, type FederalJsonEnvelope } from "./streams.ts";

export interface FederalBulkContext { readonly root: string; readonly vault: EvidenceStore; readonly signal?: AbortSignal }
export const federalBulkMemory = channel("federal-money:memory");
export interface FederalBulkMetadata { readonly count: number; readonly archiveId: string; readonly total: number | null }
export const federalBulkId = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const indexKey = (id: string, suffix: string) => {
  if (!/^[a-f0-9]{64}$/.test(id) || !/^(complete|[A-Z]{2}\/(metadata|\d+))$/.test(suffix)) throw new Error("Invalid federal bulk index identity.");
  return `project/meanwhile/source/federal-money/bulk/${id}/${suffix}`;
};
async function writeIndex(ctx: FederalBulkContext, id: string, suffix: string, value: unknown): Promise<void> {
  const bytes = Buffer.from(JSON.stringify(value)), key = indexKey(id, suffix);
  if (bytes.length > 64 * 1024) throw new Error("The federal bulk index exceeds its size limit.");
  await ctx.vault.put(key, bytes, { contentHash: `manifest:${id}:${suffix}`, byteLength: bytes.length, contentType: "application/json", objectClass: "MUTABLE_INDEX" });
}
async function readIndex<T>(ctx: FederalBulkContext, id: string, suffix: string): Promise<T | null> {
  const value = await ctx.vault.get(indexKey(id, suffix));
  if (!value) return null;
  if (value.bytes.length > 64 * 1024) throw new Error("The saved federal bulk index exceeds its size limit.");
  return JSON.parse(new TextDecoder().decode(value.bytes)) as T;
}
const workId = (directory: string) => basename(directory).replace(/\.work$/, "");
const immutable = async (vault: EvidenceStore, bytes: Uint8Array, type: string) => {
  const hash = createHash("sha256").update(bytes).digest("hex"), key = `project/meanwhile/source/federal-money/raw/${hash}`;
  await vault.put(key, bytes, { contentHash: `sha256-${hash}`, byteLength: bytes.byteLength, contentType: type }); return key;
};
export function federalBulkDirectory(ctx: FederalBulkContext, id: string): string {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid federal bulk cache identity.");
  return join(ctx.root, id);
}
export async function federalBulkMetadata(ctx: FederalBulkContext, id: string, state: string): Promise<FederalBulkMetadata | null> {
  if (!/^[A-Z]{2}$/.test(state)) throw new Error("Invalid federal bulk state.");
  return readIndex<FederalBulkMetadata>(ctx, id, `${state}/metadata`);
}
export async function completeFederalBulkState(ctx: FederalBulkContext, directory: string, state: string, value: FederalBulkMetadata): Promise<void> {
  await writeIndex(ctx, workId(directory), `${state}/metadata`, value);
}
export async function federalBulkCapture(ctx: FederalBulkContext, id: string, state: string, index: number): Promise<FederalMoneyCapture> {
  if (!Number.isSafeInteger(index) || index < 0 || !/^[A-Z]{2}$/.test(state)) throw new Error("Invalid federal bulk chunk.");
  const capture = await readIndex<FederalMoneyCapture>(ctx, id, `${state}/${index}`);
  if (!capture) throw new Error("The source bulk capture is missing from its evidence vault.");
  return capture;
}
export async function buildFederalBulk(ctx: FederalBulkContext, id: string, build: (directory: string) => Promise<void>): Promise<void> {
  if (await readIndex<boolean>(ctx, id, "complete")) return;
  await mkdir(temporaryPath(ctx.root), { recursive: true });
  const directory = federalBulkDirectory(ctx, id), lock = `${directory}.lock`;
  for (;;) {
    ctx.signal?.throwIfAborted();
    try { await mkdir(temporaryPath(lock)); await writeFile(temporaryPath(join(lock, "pid")), String(process.pid)); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try { const pid = Number(await readFile(join(lock, "pid"), "utf8")); if (pid) process.kill(pid, 0); }
      catch (check) { if ((check as NodeJS.ErrnoException).code === "ESRCH") { await rm(temporaryPath(lock), { recursive: true, force: true }); continue; } }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  const pending = `${directory}.work`;
  try {
    if (await readIndex<boolean>(ctx, id, "complete")) return;
    await mkdir(temporaryPath(pending), { recursive: true }); await build(pending);
    await writeIndex(ctx, id, "complete", true); await rm(temporaryPath(pending), { recursive: true, force: true });
  } catch (error) { if (!ctx.signal?.aborted && (error instanceof SyntaxError || isSourceAcquisitionFailure(error) && error.code === "PUBLISHER_DOCUMENT_INVALID")) await rm(temporaryPath(pending), { recursive: true, force: true }); throw error; }
  finally { await rm(temporaryPath(lock), { recursive: true, force: true }); }
}

export async function federalBulkRangeHeaders(directory: string): Promise<Record<string, string>> {
  try {
    const saved = JSON.parse(await readFile(join(directory, "download.state"), "utf8")) as { complete: boolean; etag: string | null };
    const length = (await stat(join(directory, "download"))).size;
    return !saved.complete && length ? { Range: `bytes=${length}-`, ...(saved.etag ? { "If-Range": saved.etag } : {}) } : {};
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
}
export async function stageFederalBulkBytes(ctx: FederalBulkContext, response: Response, directory: string): Promise<string> {
  const path = join(directory, "download"), checkpoint = join(directory, "download.state");
  if (await completedFederalBulkPath(directory)) { await response.body?.cancel(); return path; }
  if (!response.body) throw new Error("The source download has no response body.");
  let append = false;
  if (response.status === 206) { const range = response.headers.get("content-range")?.match(/^bytes (\d+)-\d+\/\d+$/); if (!range || Number(range[1]) !== (await stat(path)).size) throw new Error("The source resumed download at an unexpected byte offset."); append = true; }
  const file = await open(temporaryPath(path), append ? "a" : "w");
  const state = { complete: false, etag: response.headers.get("etag") };
  await writeFile(temporaryPath(checkpoint), JSON.stringify(state));
  try { for await (const input of Readable.fromWeb(response.body as never)) { ctx.signal?.throwIfAborted(); if (federalBulkMemory.hasSubscribers) federalBulkMemory.publish({ stage: "download", item: path, itemBytes: (input as Buffer).length, liveItems: 1 }); await file.write(input as Buffer); } }
  finally { await file.close(); }
  await writeFile(temporaryPath(checkpoint), JSON.stringify({ ...state, complete: true }));
  return path;
}
export async function completedFederalBulkPath(directory: string): Promise<string | null> {
  try { const saved = JSON.parse(await readFile(join(directory, "download.state"), "utf8")) as { complete: boolean }; const path = join(directory, "download"); return saved.complete && (await stat(path)).isFile() ? path : null; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function vaultFederalBulkBytes(ctx: FederalBulkContext, path: string, sourceUrl: string): Promise<string> {
  const capacity = 4 * 1024 * 1024;
  const buffer = Buffer.allocUnsafe(capacity);
  let used = 0, offset = 0, previous: string | null = null;
  const progressPath = `${path}.vault`;
  try { const saved = JSON.parse(await readFile(progressPath, "utf8")) as { offset: number; previous: string }; offset = saved.offset; previous = saved.previous; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  async function flush() {
    if (federalBulkMemory.hasSubscribers) federalBulkMemory.publish({ stage: "archive-vault", item: `${sourceUrl}@${offset}`, itemBytes: used, liveItems: 1 });
    const bytes = buffer.subarray(0, used), vaultKey = await immutable(ctx.vault, bytes, "application/octet-stream");
    const descriptor = Buffer.from(JSON.stringify({ sourceUrl, offset, byteLength: used, vaultKey, previous }));
    previous = await immutable(ctx.vault, descriptor, "application/json"); offset += used; used = 0;
    await writeFile(temporaryPath(progressPath), JSON.stringify({ offset, previous }));
  }
    for await (const input of createReadStream(path, { start: offset, highWaterMark: 64 * 1024 })) {
      ctx.signal?.throwIfAborted(); const chunk = input as Buffer;
      for (let start = 0; start < chunk.length;) { const length = Math.min(capacity - used, chunk.length - start); chunk.copy(buffer, used, start, start + length); used += length; start += length; if (used === capacity) await flush(); }
    }
    if (used) await flush();
    if (!previous) previous = await immutable(ctx.vault, Buffer.from(JSON.stringify({ sourceUrl, offset: 0, byteLength: 0, vaultKey: null, previous: null })), "application/json");
    return previous;
}
export async function spoolFederalBytes(ctx: FederalBulkContext, path: string, input: AsyncIterable<Uint8Array>): Promise<void> {
  try { if ((await stat(path)).isFile()) return; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  try { if ((await stat(`${path}.ordered`)).isFile()) return; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const temporary = `${path}.partial`, file = await open(temporaryPath(temporary), "w");
  try { for await (const bytes of input) { ctx.signal?.throwIfAborted(); if (federalBulkMemory.hasSubscribers) federalBulkMemory.publish({ stage: "archive-expand", item: path, itemBytes: bytes.length, liveItems: 1 }); await file.write(bytes); } }
  finally { await file.close(); }
  await rename(temporaryPath(temporary), temporaryPath(path));
}
export async function saveFederalBulkBytes(ctx: FederalBulkContext, request: () => Promise<Response>, directory: string, sourceUrl: string): Promise<{ path: string; archiveId: string }> {
  const path = await completedFederalBulkPath(directory) ?? await stageFederalBulkBytes(ctx, await request(), directory);
  return { path, archiveId: await vaultFederalBulkBytes(ctx, path, sourceUrl) };
}

export function federalChunkWriter(ctx: FederalBulkContext, directory: string, state: string, metadata: Omit<FederalMoneyCapture, "vaultKey" | "rawHash" | "byteLength">, start = 0) {
  let count = start, rows = 0, length = 0, buffer: Buffer | null = null;
  const capacity = 2 * 1024 * 1024;
  async function flush() {
    if (!rows || !buffer) return;
    if (metadata.format === "json") buffer[length++] = 93;
    if (federalBulkMemory.hasSubscribers) federalBulkMemory.publish({ stage: "capture-vault", item: `${metadata.url}:${state}:${count}`, itemBytes: length, liveItems: 1, retainedRows: rows, bufferBytes: buffer.length });
    const capture = await saveFederalMoneyCapture({ ...metadata, body: buffer.subarray(0, length) }, ctx.vault);
    await writeIndex(ctx, workId(directory), `${state}/${count++}`, capture); rows = 0; length = 0;
  }
  return {
    async add(row: string, header = "") {
      const rowBytes = Buffer.byteLength(row), json = metadata.format === "json";
      if (rows && (rows >= FEDERAL_MONEY_CHUNK_ROWS || length + rowBytes + (json ? 2 : 0) > capacity)) await flush();
      if (!rows) {
        const prefix = json ? "[" : header, required = Buffer.byteLength(prefix) + rowBytes + (json ? 1 : 0);
        if (!buffer || buffer.length < required) buffer = Buffer.allocUnsafe(Math.max(capacity, required));
        length = buffer.write(prefix);
      } else if (json) buffer![length++] = 44;
      length += buffer!.write(row, length); rows++;
    },
    async finish() { await flush(); return count; },
  };
}
export async function chunkFederalCsvFile(ctx: FederalBulkContext, directory: string, state: string, source: FederalMoneySource, path: string, metadata: Omit<FederalMoneyCapture, "vaultKey" | "rawHash" | "byteLength">, start = 0): Promise<number> {
  path = await sortFederalSourceFile({ source, state, path, metadata, signal: ctx.signal });
  const progressPath = `${path}.chunks`, temporary = `${progressPath}.${randomUUID()}`;
  let progress = { offset: 0, count: start, header: "", complete: false };
  try { progress = JSON.parse(await readFile(progressPath, "utf8")) as typeof progress; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (progress.complete) return progress.count;
  const writer = federalChunkWriter(ctx, directory, state, metadata, progress.count); let rows = 0;
  const checkpoint = async (complete = false) => { progress.count = await writer.finish(); progress.complete = complete; await writeFile(temporaryPath(temporary), JSON.stringify(progress)); await rename(temporaryPath(temporary), temporaryPath(progressPath)); rows = 0; };
  for await (const row of federalCsvRecords(createReadStream(path, { start: progress.offset }))) {
    ctx.signal?.throwIfAborted(); progress.offset += Buffer.byteLength(row);
    if (!progress.header) { progress.header = row; continue; }
    if (row.trim()) { await writer.add(row, progress.header); rows++; }
    if (rows >= FEDERAL_MONEY_CHUNK_ROWS) await checkpoint();
  }
  await checkpoint(true); return progress.count;
}
export async function scanFederalJson(ctx: FederalBulkContext, path: string, arrayKey: string, secrets: readonly string[], onRow?: (row: string) => Promise<void>): Promise<FederalJsonEnvelope> {
  const header = await open(path, "r"); const magic = Buffer.alloc(2); try { await header.read(magic, 0, 2, 0); } finally { await header.close(); }
  const input = createReadStream(path), stream = magic[0] === 0x1f && magic[1] === 0x8b ? input.pipe(createGunzip()) : input;
  const envelope: FederalJsonEnvelope = { rows: 0, found: false };
  try {
    for await (const row of federalJsonRecords(stream, arrayKey, envelope)) { ctx.signal?.throwIfAborted(); if (secrets.some(secret => secret && (row.includes(secret) || row.includes(encodeURIComponent(secret))))) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "SAM.gov: its source response echoed a private credential and cannot be saved."); await onRow?.(row); }
    const control = JSON.stringify(envelope.value); if (secrets.some(secret => secret && (control.includes(secret) || control.includes(encodeURIComponent(secret))))) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "SAM.gov: its source response echoed a private credential and cannot be saved.");
    return envelope;
  } finally { stream.destroy(); input.destroy(); }
}
export async function chunkFederalJson(ctx: FederalBulkContext, directory: string, state: string, path: string, metadata: Omit<FederalMoneyCapture, "vaultKey" | "rawHash" | "byteLength">, arrayKey: string): Promise<{ count: number; envelope: FederalJsonEnvelope }> {
  const spool = `${path}.rows`, envelopePath = `${spool}.envelope`;
  let envelope: FederalJsonEnvelope;
  try { envelope = JSON.parse(await readFile(envelopePath, "utf8")) as FederalJsonEnvelope; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const file = await open(temporaryPath(spool), "w");
    try { envelope = await scanFederalJson(ctx, path, arrayKey, [], async row => { const bytes = Buffer.from(row), header = Buffer.alloc(4); header.writeUInt32LE(bytes.length); await file.writev([header, bytes]); }); }
    finally { await file.close(); }
    await writeFile(temporaryPath(envelopePath), JSON.stringify(envelope));
  }
  const ordered = await sortFederalSourceFile({ source: "sam-gov-entities", state, path: spool, metadata, signal: ctx.signal });
  const progressPath = `${ordered}.chunks`; let progress = { offset: 0, count: 0 };
  try { progress = JSON.parse(await readFile(progressPath, "utf8")) as typeof progress; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const writer = federalChunkWriter(ctx, directory, state, metadata, progress.count), file = await open(ordered, "r"); let rows = 0;
  async function checkpoint() { progress.count = await writer.finish(); await writeFile(temporaryPath(progressPath), JSON.stringify(progress)); rows = 0; }
  try {
    for (;;) {
      ctx.signal?.throwIfAborted(); const header = Buffer.alloc(4), next = await file.read(header, 0, 4, progress.offset); if (!next.bytesRead) break;
      if (next.bytesRead !== 4 || header.readUInt32LE() > 8 * 1024 * 1024) throw new Error("The source JSON row spool is invalid.");
      const bytes = Buffer.alloc(header.readUInt32LE()), body = await file.read(bytes, 0, bytes.length, progress.offset + 4); if (body.bytesRead !== bytes.length) throw new Error("The source JSON row spool is truncated.");
      await writer.add(bytes.toString("utf8")); progress.offset += 4 + bytes.length; rows++; if (rows >= FEDERAL_MONEY_CHUNK_ROWS) await checkpoint();
    }
    await checkpoint(); return { count: progress.count, envelope };
  } finally { await file.close(); }
}
