import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { temporaryPath } from "./temporary-path.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";

/** Where a raw source response lives: a candidate holds this, never the bytes. */
export interface RawCaptureRef {
  readonly vaultKey: string;
  readonly rawHash: string;
  readonly byteLength: number;
  /** A manifest of immutable chunks, preserving the hash of the complete source. */
  readonly chunked?: true;
}

interface RawChunk { readonly vaultKey: string; readonly rawHash: string; readonly byteLength: number }
interface RawChunks { readonly formatVersion: 1; readonly rawHash: string; readonly byteLength: number; readonly chunks: readonly RawChunk[] }
const RAW_CHUNK_BYTES = 1024 * 1024;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Stored once per content hash; a second holder of the same bytes only checks it is there. */
export async function holdRawCapture(vault: EvidenceStore, sourceId: string, body: Uint8Array | string, contentType: string): Promise<RawCaptureRef> {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body, rawHash = sha256(bytes);
  const vaultKey = `project/freshness/source/${sourceId}/raw/${rawHash}`;
  if (!await vault.head(vaultKey)) {
    await vault.put(vaultKey, bytes, { contentType, contentHash: `sha256-${rawHash}`, byteLength: bytes.byteLength, objectClass: "IMMUTABLE_BODY" });
  }
  return { vaultKey, rawHash, byteLength: bytes.byteLength };
}

/** A large source is held and replayed a chunk at a time; workers never need its complete bytes in memory. */
export async function holdRawCaptureFile(vault: EvidenceStore, sourceId: string, path: string, contentType: string): Promise<RawCaptureRef> {
  const source = temporaryPath(path);
  const digest = createHash("sha256"), chunks: RawChunk[] = [];
  let byteLength = 0;
  for await (const value of createReadStream(source, { highWaterMark: RAW_CHUNK_BYTES })) {
    const bytes = value as Buffer, rawHash = sha256(bytes), vaultKey = `project/freshness/source/${sourceId}/raw-chunks/${rawHash}`;
    digest.update(bytes); byteLength += bytes.byteLength;
    if (!await vault.head(vaultKey)) await vault.put(vaultKey, bytes, { contentType, contentHash: `sha256-${rawHash}`, byteLength: bytes.byteLength, objectClass: "IMMUTABLE_BODY" });
    chunks.push({ vaultKey, rawHash, byteLength: bytes.byteLength });
  }
  if (!byteLength) throw new Error("RAW_CAPTURE_FILE_EMPTY");
  const rawHash = digest.digest("hex"), vaultKey = `project/freshness/source/${sourceId}/raw/${rawHash}.chunks.json`;
  const manifest: RawChunks = { formatVersion: 1, rawHash, byteLength, chunks };
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  if (!await vault.head(vaultKey)) await vault.put(vaultKey, bytes, { contentType: "application/json", contentHash: `sha256-${sha256(bytes)}`, byteLength: bytes.byteLength, objectClass: "IMMUTABLE_BODY" });
  return { vaultKey, rawHash, byteLength, chunked: true };
}

export async function* readRawCaptureChunks(vault: EvidenceStore, ref: RawCaptureRef): AsyncGenerator<Uint8Array> {
  if (!ref.chunked) {
    if (!vault.stream) {
      if (ref.byteLength > RAW_CHUNK_BYTES) throw new Error("RAW_CAPTURE_STREAMING_VAULT_REQUIRED");
      yield await readRawCapture(vault, ref); return;
    }
    const stream = await vault.stream(ref.vaultKey);
    if (!stream) throw new Error(`RAW_CAPTURE_MISSING_OR_CORRUPT:${ref.vaultKey}`);
    const digest = createHash("sha256"); let length = 0;
    for await (const bytes of stream) {
      digest.update(bytes); length += bytes.byteLength;
      if (length > ref.byteLength) throw new Error(`RAW_CAPTURE_MISSING_OR_CORRUPT:${ref.vaultKey}`);
      yield bytes;
    }
    if (length !== ref.byteLength || digest.digest("hex") !== ref.rawHash) throw new Error(`RAW_CAPTURE_MISSING_OR_CORRUPT:${ref.vaultKey}`);
    return;
  }
  const saved = await vault.get(ref.vaultKey);
  if (!saved) throw new Error(`RAW_CAPTURE_MISSING_OR_CORRUPT:${ref.vaultKey}`);
  const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(saved.bytes)) as RawChunks;
  if (manifest.formatVersion !== 1 || manifest.rawHash !== ref.rawHash || manifest.byteLength !== ref.byteLength || !Array.isArray(manifest.chunks)) throw new Error("RAW_CAPTURE_MANIFEST_INVALID");
  const digest = createHash("sha256"); let length = 0;
  for (const chunk of manifest.chunks) {
    if (!chunk || !Number.isSafeInteger(chunk.byteLength) || chunk.byteLength <= 0 || chunk.byteLength > RAW_CHUNK_BYTES || !/^[a-f0-9]{64}$/.test(chunk.rawHash)) throw new Error("RAW_CAPTURE_MANIFEST_INVALID");
    const object = await vault.get(chunk.vaultKey);
    if (!object || object.bytes.byteLength !== chunk.byteLength || sha256(object.bytes) !== chunk.rawHash) throw new Error(`RAW_CAPTURE_MISSING_OR_CORRUPT:${chunk.vaultKey}`);
    digest.update(object.bytes); length += object.bytes.byteLength;
    if (length > ref.byteLength) throw new Error("RAW_CAPTURE_MANIFEST_INVALID");
    yield object.bytes;
  }
  if (length !== ref.byteLength || digest.digest("hex") !== ref.rawHash) throw new Error(`RAW_CAPTURE_MISSING_OR_CORRUPT:${ref.vaultKey}`);
}

export async function restoreRawCaptureFile(vault: EvidenceStore, ref: RawCaptureRef, path: string): Promise<void> {
  const destination = temporaryPath(path);
  const file = await open(destination, "w");
  try {
    for await (const bytes of readRawCaptureChunks(vault, ref)) {
      let offset = 0;
      while (offset < bytes.byteLength) {
        const written = await file.write(bytes, offset, bytes.byteLength - offset);
        if (!written.bytesWritten) throw new Error("RAW_CAPTURE_FILE_WRITE_FAILED");
        offset += written.bytesWritten;
      }
    }
  } finally { await file.close(); }
}

/** Move a held national source between vault adapters without reconstructing its complete body. */
export async function copyRawCapture(source: EvidenceStore, target: EvidenceStore, sourceId: string, ref: RawCaptureRef, contentType: string): Promise<RawCaptureRef> {
  if (source === target) return ref;
  const chunks: RawChunk[] = [];
  for await (const original of readRawCaptureChunks(source, ref)) for (let offset = 0; offset < original.byteLength; offset += RAW_CHUNK_BYTES) {
    const bytes = original.subarray(offset, offset + RAW_CHUNK_BYTES), rawHash = sha256(bytes);
    const vaultKey = `project/freshness/source/${sourceId}/raw-chunks/${rawHash}`;
    if (!await target.head(vaultKey)) await target.put(vaultKey, bytes, { contentType, contentHash: `sha256-${rawHash}`, byteLength: bytes.byteLength, objectClass: "IMMUTABLE_BODY" });
    chunks.push({ vaultKey, rawHash, byteLength: bytes.byteLength });
  }
  const vaultKey = `project/freshness/source/${sourceId}/raw/${ref.rawHash}.chunks.json`;
  const bytes = new TextEncoder().encode(JSON.stringify({ formatVersion: 1, rawHash: ref.rawHash, byteLength: ref.byteLength, chunks } satisfies RawChunks));
  if (!await target.head(vaultKey)) await target.put(vaultKey, bytes, { contentType: "application/json", contentHash: `sha256-${sha256(bytes)}`, byteLength: bytes.byteLength, objectClass: "IMMUTABLE_BODY" });
  return { vaultKey, rawHash: ref.rawHash, byteLength: ref.byteLength, chunked: true };
}

async function readRawCapture(vault: EvidenceStore, ref: RawCaptureRef): Promise<Uint8Array> {
  const object = await vault.get(ref.vaultKey);
  if (!object || object.bytes.byteLength !== ref.byteLength || sha256(object.bytes) !== ref.rawHash) {
    throw Error(`RAW_CAPTURE_MISSING_OR_CORRUPT:${ref.vaultKey}`);
  }
  return object.bytes;
}

export async function readRawCaptureText(vault: EvidenceStore, ref: RawCaptureRef): Promise<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  for await (const bytes of readRawCaptureChunks(vault, ref)) text += decoder.decode(bytes, { stream: true });
  return text + decoder.decode();
}
