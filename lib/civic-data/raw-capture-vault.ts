import { createHash } from "node:crypto";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";

/** Where a raw source response lives: a candidate holds this, never the bytes. */
export interface RawCaptureRef {
  readonly vaultKey: string;
  readonly rawHash: string;
  readonly byteLength: number;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export const rawCaptureKey = (rawHash: string) => `project/freshness/raw/sha256/${rawHash}`;

/** Stored once per content hash; a second holder of the same bytes only checks it is there. */
export async function holdRawCapture(vault: EvidenceStore, _sourceId: string, body: Uint8Array | string, _contentType: string): Promise<RawCaptureRef> {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body, rawHash = sha256(bytes);
  const vaultKey = rawCaptureKey(rawHash);
  const existing = await vault.head(vaultKey);
  if (existing && (existing.contentHash !== `sha256-${rawHash}` || existing.byteLength !== bytes.byteLength)) {
    throw Error(`RAW_CAPTURE_MISSING_OR_CORRUPT:${vaultKey}`);
  }
  if (!existing) {
    // Route, publisher, MIME and observation time belong on the holder. Identical bytes share one object across sources.
    await vault.put(vaultKey, bytes, { contentType: "application/octet-stream", contentHash: `sha256-${rawHash}`, byteLength: bytes.byteLength, objectClass: "IMMUTABLE_BODY" });
  }
  return { vaultKey, rawHash, byteLength: bytes.byteLength };
}

export async function readRawCapture(vault: EvidenceStore, ref: RawCaptureRef): Promise<Uint8Array> {
  if (!/^[a-f0-9]{64}$/.test(ref.rawHash) || ref.vaultKey !== rawCaptureKey(ref.rawHash) ||
      !Number.isSafeInteger(ref.byteLength) || ref.byteLength < 0) {
    throw Error(`RAW_CAPTURE_MISSING_OR_CORRUPT:${ref.vaultKey}`);
  }
  const object = await vault.get(ref.vaultKey);
  if (!object || object.bytes.byteLength !== ref.byteLength || sha256(object.bytes) !== ref.rawHash) {
    throw Error(`RAW_CAPTURE_MISSING_OR_CORRUPT:${ref.vaultKey}`);
  }
  return object.bytes;
}

export async function readRawCaptureText(vault: EvidenceStore, ref: RawCaptureRef): Promise<string> {
  return new TextDecoder("utf-8", { fatal: true }).decode(await readRawCapture(vault, ref));
}
