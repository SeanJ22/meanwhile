import { createHash } from "node:crypto";
import { readRawCapture, type RawCaptureRef } from "../../civic-data/raw-capture-vault.ts";
import type { EvidenceStore, ObjectMeta, StoredObject } from "./store.ts";

const POINTER_TYPE = "application/vnd.meanwhile.raw-capture-pointer+json";
const digest = (bytes: Uint8Array) => `sha256-${createHash("sha256").update(bytes).digest("hex")}`;

/** Observation metadata is small and belongs to its source; the response body belongs only to its hash. */
export function rawCapturePointer(ref: RawCaptureRef, original: ObjectMeta): { readonly bytes: Uint8Array; readonly meta: ObjectMeta } {
  const bytes = new TextEncoder().encode(JSON.stringify(ref));
  return { bytes, meta: { ...original, contentType: POINTER_TYPE, contentHash: digest(bytes), byteLength: bytes.byteLength,
    custom: { ...original.custom, rawCapture: JSON.stringify(ref), rawContentType: original.contentType,
      rawContentHash: original.contentHash, rawByteLength: String(original.byteLength) } } };
}

export function rawCapturePointerRef(meta: ObjectMeta): RawCaptureRef | null {
  if (meta.contentType !== POINTER_TYPE) return null;
  const ref = JSON.parse(meta.custom?.rawCapture ?? "null") as RawCaptureRef | null;
  if (!ref || !/^[a-f0-9]{64}$/.test(ref.rawHash) || ref.vaultKey !== `project/freshness/raw/sha256/${ref.rawHash}` ||
      !Number.isSafeInteger(ref.byteLength) || ref.byteLength < 0 || meta.custom?.rawContentHash !== `sha256-${ref.rawHash}` ||
      meta.custom.rawByteLength !== String(ref.byteLength)) throw new Error("RAW_CAPTURE_POINTER_INVALID");
  return ref;
}

export function rawCaptureMetadata(meta: ObjectMeta): ObjectMeta {
  const ref = rawCapturePointerRef(meta);
  if (!ref) return meta;
  const { rawCapture: _ref, rawContentType: contentType, rawContentHash: contentHash, rawByteLength: _length, ...custom } = meta.custom!;
  return { ...meta, contentType, contentHash, byteLength: ref.byteLength, custom };
}

/** Legacy objects already contain their bytes; new observations resolve their one shared response. */
export async function readEvidenceObject(store: EvidenceStore, key: string): Promise<StoredObject | null> {
  const object = await store.get(key);
  return resolveRawCapturePointer(store, object);
}

export async function resolveRawCapturePointer(store: EvidenceStore, object: StoredObject | null): Promise<StoredObject | null> {
  if (!object) return null;
  const ref = rawCapturePointerRef(object.meta);
  if (!ref) return object;
  if (new TextDecoder().decode(object.bytes) !== JSON.stringify(ref)) throw new Error("RAW_CAPTURE_POINTER_INVALID");
  return { key: object.key, meta: rawCaptureMetadata(object.meta), bytes: await readRawCapture(store, ref) };
}
