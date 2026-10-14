import { createHash } from "node:crypto";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { extensionFor } from "../control-plane/evidence/store.ts";
import { netlifyEvidenceStoreFromEnv } from "../control-plane/evidence/netlify-store.ts";

/** Where a raw source response lives: a candidate holds this, never the bytes. */
export interface RawCaptureRef {
  readonly vaultKey: string;
  readonly rawHash: string;
  readonly byteLength: number;
}

/** Raw source bytes live in the shared remote vault, outside the candidate store. */
export function rawCaptureVault(): EvidenceStore {
  const vault = netlifyEvidenceStoreFromEnv();
  if (!vault) throw Error("The shared raw-capture evidence vault is unavailable.");
  return vault;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Stored once per content hash; a second holder of the same bytes only checks it is there. */
export async function holdRawCapture(vault: EvidenceStore, sourceId: string, body: Uint8Array | string, contentType: string): Promise<RawCaptureRef> {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body, rawHash = sha256(bytes);
  const vaultKey = `project/freshness/source/${sourceId}/raw/${rawHash}.${extensionFor(contentType)}`;
  if (!await vault.head(vaultKey)) {
    await vault.put(vaultKey, bytes, { contentType, contentHash: `sha256-${rawHash}`, byteLength: bytes.byteLength, objectClass: "IMMUTABLE_BODY" });
  }
  return { vaultKey, rawHash, byteLength: bytes.byteLength };
}

export async function readRawCapture(vault: EvidenceStore, ref: RawCaptureRef): Promise<Uint8Array> {
  const object = await vault.get(ref.vaultKey);
  if (!object || object.bytes.byteLength !== ref.byteLength || sha256(object.bytes) !== ref.rawHash) {
    throw Error(`RAW_CAPTURE_MISSING_OR_CORRUPT:${ref.vaultKey}`);
  }
  return object.bytes;
}

export async function readRawCaptureText(vault: EvidenceStore, ref: RawCaptureRef): Promise<string> {
  return new TextDecoder("utf-8", { fatal: true }).decode(await readRawCapture(vault, ref));
}
